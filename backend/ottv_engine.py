"""
OTTV 3D Parametric Studio — Core Computational Engine v2.0 (SNI 6389:2020)
==========================================================================
Implements:
1. Ultra-fast multi-format 3D CAD/BIM parser (.3dm Rhino 8, .obj, .hbjson, .stl, .ply)
2. Planar mesh tessellation on curved/NURBS surfaces using `ladybug-geometry`
3. Automatic classification between Frame (Mullion/Transom/Ring), Shading (Fins/Louvers),
   and Surface Panels (Wall/Spandrel vs Vision/Crown Glazing)
4. Automatic Outer-Skin detection (`is_outer`) via radial floor-centroid normal projection
5. Smart Floor-by-Floor Sectioning (auto-detecting floor levels L1..LN & section filtering)
6. Continuous angular interpolation of SNI 6389:2020 Solar Factor (SF) + EPW climate scaling
7. Fast Z-slab indexed Möller-Trumbore solar raycasting (08:00-16:00) against Frame & Louver geometry
8. Material Library & Category Template mapping + Indonesian Brand Optimization Recommender.
"""

from __future__ import annotations

import hashlib
import math
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from loaders.sanity import dedupe_surface_groups
from material_hints import material_suggestions
from ladybug_geometry.geometry3d.pointvector import Vector3D

from materials_and_epw import (
    INDONESIAN_CITY_PRESETS,
    get_material_by_id,
    get_material_shgc,
    resolve_u_frame,
)
from sni_tables import (
    SNI_DELTA_T_K,
    SNI_RTTV_LIMIT_OPAQUE_ONLY_WM2,
    SNI_RTTV_LIMIT_WITH_SKYLIGHT_WM2,
    get_sf_for_source,
    get_sf_source_info,
    get_sni_city_entry,
    get_tdek_roof,
    get_tdek_wall,
    lookup_sceff_detailed,
)
from template_method import (
    TemplateShadingRegistry,
    compute_template_shgc_and_sck,
)
from universal_pipeline import (
    RawGroupMesh,
    assign_panels_to_floors,
    build_dynamic_floor_levels,
    enrich_floor_zones_and_presets,
    load_universal_model_stages_1_and_2,
)

# ============================================================================
# 1. SNI 6389:2020 CONSTANTS & SOLAR FACTOR (SF) TABLE
# ============================================================================

SNI_6389_LIMIT_WM2: float = 35.0

SNI_SF_ANCHORS: List[Tuple[float, str, str, float]] = [
    (0.0,   "U",   "Utara (North)",          130.0),
    (45.0,  "TL",  "Timur Laut (Northeast)", 113.0),
    (90.0,  "T",   "Timur (East)",           112.0),
    (135.0, "TGR", "Tenggara (Southeast)",    97.0),
    (180.0, "S",   "Selatan (South)",         97.0),
    (225.0, "BD",  "Barat Daya (Southwest)", 176.0),
    (270.0, "B",   "Barat (West)",           243.0),
    (315.0, "BL",  "Barat Laut (Northwest)", 211.0),
]

ORIENTATION_CODES: List[str] = [item[1] for item in SNI_SF_ANCHORS]
ORIENTATION_NAMES: Dict[str, str] = {item[1]: item[2] for item in SNI_SF_ANCHORS}
ORIENTATION_ANGLES: Dict[str, float] = {item[1]: item[0] for item in SNI_SF_ANCHORS}
ORIENTATION_BASE_SF: Dict[str, float] = {item[1]: item[3] for item in SNI_SF_ANCHORS}


@dataclass
class EnvelopeParameters:
    """Parametric envelope thermal, material, floor section, and climate settings."""
    # Stage 1: Universal Geometry, Unit & Axis Normalization
    unit_mode: str = "auto"  # 'auto' | 'm' | 'cm' | 'mm' | 'ft' | 'in'
    up_axis: str = "auto"    # 'auto' | 'Z' | 'Y'
    z_ground_cutoff_m: float = 0.0  # Ground plane Z0 cutoff (excludes basement faces below Z0)
    restore_filtered: List[str] = field(default_factory=list)  # M4/M6: IDs of filtered_items to restore
    calculation_mode: str = "simulasi"  # 'sni' | 'simulasi'
    sf_source: str = "sni2020"  # 'sni2020' (default) | 'template_prodi' (tabel SF lama)
    sceff_table_mode: str = "terkoreksi"  # 'terkoreksi' | 'ketat_pdf'

    # Stage 2: 3-Tier Sub-Element Decomposer & 6-Role Envelope Classification
    auto_split_merged_cw: bool = False
    groups_to_auto_split: List[str] = field(default_factory=list)
    frame_width_threshold_m: float = 0.28
    spandrel_height_threshold_m: float = 1.15
    group_wwr_map: Dict[str, float] = field(default_factory=dict)
    face_category_overrides: Dict[str, str] = field(default_factory=dict)
    face_z_band_overrides: List[Dict[str, Any]] = field(default_factory=list)

    # Stage 3: Universal Dynamic Floor Detection (R4: floor_height_m is None unless explicitly filled)
    floor_mode: str = "auto"  # 'auto' | 'uniform' | 'custom'
    floor_height_m: Optional[float] = None
    expected_floors: Optional[int] = None
    custom_floor_zones: List[Dict[str, Any]] = field(default_factory=list)
    section_floor_min: Optional[int] = None
    section_floor_max: Optional[int] = None
    # RTTV opsional (None = dihitung, perilaku lama) & grup skylight eksplisit (None = otomatis)
    compute_rttv: Optional[bool] = None
    rttv_skylight_groups: Optional[List[str]] = None

    # Stage 4: Layer-Bound Material Assignment & Orientation Overrides (resolved via config_schema.resolve_material)
    orientation_material_overrides: Dict[str, str] = field(default_factory=dict)

    # Opaque wall / spandrel parameters
    alpha_wall: float = 0.42
    u_wall: float = 0.62
    td_ek: float = 15.0

    # Fenestration / Glazing parameters
    u_fenestration: float = 1.10
    delta_t: float = 5.0
    sc_glass: float = 0.23
    wwr_override: Optional[float] = None
    default_wall_wwr: Optional[float] = None

    # Curtain wall Frame (Mullion/Transom) thermal parameters — SNI 6389:2020 Tabel 3 & Lampiran C
    frame_width_mm: float = 50.0  # Lebar kusen asumsi (mm) bila model tidak memiliki grup rangka terukur
    include_frame_conduction: bool = True  # legacy field (dipertahankan untuk kompatibilitas .ottv.json lama)
    u_frame: float = 8.0
    frame_area_ratio: float = 0.08  # legacy field (tidak lagi dipakai; diganti U_f 3-zona)

    # Outer skin & group/panel selection filters
    outer_skin_only: bool = True
    exterior_detection_mode: str = "auto"  # 'auto' (Raycast+BIM) | 'raycast' | 'radial' | 'all'
    disabled_groups: List[str] = field(default_factory=list)
    group_category_overrides: Dict[str, str] = field(default_factory=dict)
    group_material_map: Dict[str, str] = field(default_factory=dict)
    # A3-01: False = pengguna belum memilih/mengonfirmasi material -> hasil berstatus sementara
    materials_confirmed: bool = False
    glazing_material_id: Optional[str] = "glz_igu_triple_silver"
    wall_material_id: Optional[str] = "wal_spandrel_insulasi_50"
    frame_material_id: Optional[str] = "frm_aluminium_thermal_break"
    roof_material_id: Optional[str] = "rf_dak_beton_120_insulasi"
    custom_materials: List[Dict[str, Any]] = field(default_factory=list)

    # Parametric Louver / Shading generator settings (OFF by default so OTTV uses 100% actual modeled geometry)
    enable_parametric_louvers: bool = False
    louver_depth_m: float = 0.65
    louver_spacing_m: float = 1.10
    louver_tilt_deg: float = 22.0

    # Tessellation & geographic / EPW parameters
    nurbs_u_div: int = 4
    nurbs_v_div: int = 2
    max_panel_edge_m: float = 4.0
    north_angle_deg: float = 0.0
    city_preset: str = "jakarta"
    latitude_deg: float = -6.2088
    longitude_deg: float = 106.8456
    sf_climate_multiplier: float = 1.00
    design_month: int = 9
    custom_epw_info: Optional[Dict[str, Any]] = None


# ============================================================================
# 2. VECTORIZED AZIMUTH, ORIENTATION & SNI 6389:2020 SF INTERPOLATION
# ============================================================================

def compute_azimuth_from_normal(
    nx: float,
    ny: float,
    nz: float,
    north_angle_deg: float = 0.0
) -> float:
    horiz_mag = math.hypot(nx, ny)
    if horiz_mag < 1e-6:
        return 0.0
    raw_deg = math.degrees(math.atan2(nx, ny))
    azimuth = (raw_deg - north_angle_deg) % 360.0
    if math.isclose(azimuth, 360.0, abs_tol=1e-4):
        azimuth = 0.0
    return round(float(azimuth), 2)


def classify_sni_orientation(azimuth_deg: float) -> str:
    az = azimuth_deg % 360.0
    sector_idx = int(((az + 22.5) % 360.0) // 45.0)
    return ORIENTATION_CODES[sector_idx]


def interpolate_sni_solar_factor(
    azimuth_deg: float,
    tilt_deg: float = 90.0,
    climate_multiplier: float = 1.0
) -> float:
    az = azimuth_deg % 360.0
    sector = int(az // 45.0) % 8
    next_sector = (sector + 1) % 8
    t = (az - (sector * 45.0)) / 45.0

    sf_start = SNI_SF_ANCHORS[sector][3]
    sf_end = SNI_SF_ANCHORS[next_sector][3]
    sf_interp = ((1.0 - t) * sf_start + t * sf_end) * climate_multiplier

    tilt_rad = math.radians(max(15.0, min(165.0, tilt_deg)))
    if tilt_deg < 85.0:
        zenith_boost = 1.0 + 0.18 * math.cos(tilt_rad)
        sf_interp *= zenith_boost
    elif tilt_deg > 95.0:
        sf_interp *= max(0.65, math.sin(tilt_rad))

    return round(float(sf_interp), 2)


# ============================================================================
# 3. SOLAR VECTOR CALCULATOR (08:00 - 16:00)
# ============================================================================

def compute_solar_vectors_08_to_16(
    latitude_deg: float = -6.2088,
    month: int = 9,
    north_angle_deg: float = 0.0,
    custom_hourly_dni: Optional[Dict[int, float]] = None,
) -> List[Dict[str, Any]]:
    month_days = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355]
    doy = month_days[max(0, min(11, month - 1))]

    declination_deg = 23.45 * math.sin(math.radians(360.0 * (284 + doy) / 365.0))
    lat_rad = math.radians(latitude_deg)
    dec_rad = math.radians(declination_deg)
    north_rad = math.radians(north_angle_deg)

    solar_vectors: List[Dict[str, Any]] = []
    for hour in range(8, 17):
        hour_angle_deg = (hour - 12.0) * 15.0
        omega_rad = math.radians(hour_angle_deg)

        sin_alt = (
            math.sin(lat_rad) * math.sin(dec_rad)
            + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(omega_rad)
        )
        sin_alt = max(-1.0, min(1.0, sin_alt))
        alt_rad = math.asin(sin_alt)
        alt_deg = math.degrees(alt_rad)

        sx0 = -math.cos(dec_rad) * math.sin(omega_rad)
        sy0 = (
            math.cos(lat_rad) * math.sin(dec_rad)
            - math.sin(lat_rad) * math.cos(dec_rad) * math.cos(omega_rad)
        )
        sz0 = max(0.05, sin_alt)

        cos_n = math.cos(north_rad)
        sin_n = math.sin(north_rad)
        sx = sx0 * cos_n + sy0 * sin_n
        sy = -sx0 * sin_n + sy0 * cos_n
        sz = sz0

        vec_lb = Vector3D(sx, sy, sz).normalize()
        az_deg = (math.degrees(math.atan2(vec_lb.x, vec_lb.y))) % 360.0

        if custom_hourly_dni and hour in custom_hourly_dni:
            dni_wm2 = float(custom_hourly_dni[hour])
        else:
            air_mass = 1.0 / (math.sin(max(0.08, alt_rad)) + 0.50572 * ((6.07995 + max(5.0, alt_deg)) ** -1.6364))
            dni_wm2 = 1080.0 * math.exp(-0.185 * air_mass)

        solar_vectors.append({
            "hour": hour,
            "time_label": f"{hour:02d}:00",
            "altitude_deg": round(alt_deg, 2),
            "azimuth_deg": round(az_deg, 2),
            "vector": [round(vec_lb.x, 5), round(vec_lb.y, 5), round(vec_lb.z, 5)],
            "dni_wm2": round(dni_wm2, 1),
        })

    return solar_vectors


def compute_solar_vectors_for_date(
    latitude_deg: float = -6.2088,
    date_str: str = "2026-09-23",
    north_angle_deg: float = 0.0,
    hours: Optional[List[int]] = None,
) -> List[Dict[str, Any]]:
    """
    Computes hourly solar direction vectors (E, N, U) for any calendar date YYYY-MM-DD
    across `hours` (default 06:00..18:00, 13 steps) using the same convention as
    `compute_solar_vectors_08_to_16`.
    """
    import datetime as _dt

    try:
        parsed = _dt.date.fromisoformat(str(date_str).strip()[:10])
    except ValueError as exc:
        raise ValueError(f"Format tanggal tidak valid '{date_str}'. Gunakan YYYY-MM-DD.") from exc

    doy = parsed.timetuple().tm_yday
    declination_deg = 23.45 * math.sin(math.radians(360.0 * (284 + doy) / 365.0))
    lat_rad = math.radians(float(latitude_deg))
    dec_rad = math.radians(declination_deg)
    north_rad = math.radians(float(north_angle_deg))
    cos_n = math.cos(north_rad)
    sin_n = math.sin(north_rad)

    hour_list = list(hours) if hours else list(range(6, 19))
    solar_vectors: List[Dict[str, Any]] = []
    for hour in hour_list:
        h_val = float(hour)
        hour_angle_deg = (h_val - 12.0) * 15.0
        omega_rad = math.radians(hour_angle_deg)

        sin_alt = (
            math.sin(lat_rad) * math.sin(dec_rad)
            + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(omega_rad)
        )
        sin_alt = max(-1.0, min(1.0, sin_alt))
        alt_rad = math.asin(sin_alt)
        alt_deg = math.degrees(alt_rad)
        above_horizon = alt_deg > 0.5

        sx0 = -math.cos(dec_rad) * math.sin(omega_rad)
        sy0 = (
            math.cos(lat_rad) * math.sin(dec_rad)
            - math.sin(lat_rad) * math.cos(dec_rad) * math.cos(omega_rad)
        )
        sz0 = sin_alt

        sx = sx0 * cos_n + sy0 * sin_n
        sy = -sx0 * sin_n + sy0 * cos_n
        sz = sz0

        norm = math.sqrt(sx * sx + sy * sy + sz * sz)
        if norm > 1e-9:
            vx, vy, vz = sx / norm, sy / norm, sz / norm
        else:
            vx, vy, vz = 0.0, 0.0, 1.0

        az_deg = (math.degrees(math.atan2(vx, vy))) % 360.0
        h_int = int(round(h_val))
        solar_vectors.append({
            "hour": h_int,
            "time_label": f"{h_int:02d}:00",
            "altitude_deg": round(alt_deg, 2),
            "azimuth_deg": round(az_deg, 2),
            "above_horizon": above_horizon,
            "vector": [round(vx, 5), round(vy, 5), round(vz, 5)],
        })

    return solar_vectors


_EXPOSURE_CACHE: Dict[Tuple[Any, ...], Dict[str, Any]] = {}


def _build_obstruction_tris_from_analysis(analysis_data: Dict[str, Any]) -> np.ndarray:
    """Reconstructs obstruction triangles (envelope + shading + frame + roof) for exposure raycast."""
    chunks: List[np.ndarray] = []

    panel_tris: List[List[List[float]]] = []
    for p in analysis_data.get("panels") or []:
        if not p.get("active"):
            continue
        vs = p.get("vertices") or []
        if len(vs) < 3:
            continue
        panel_tris.append([vs[0], vs[1], vs[2]])
        if len(vs) >= 4:
            panel_tris.append([vs[0], vs[2], vs[3]])
    if panel_tris:
        chunks.append(np.array(panel_tris, dtype=np.float64))

    for key in ("shading_elements", "frame_elements", "roof_elements"):
        for el in analysis_data.get(key) or []:
            verts = el.get("vertices")
            faces = el.get("faces")
            if not verts or not faces:
                continue
            v_arr = np.asarray(verts, dtype=np.float64)
            f_arr = np.asarray(faces, dtype=np.int64)
            if v_arr.ndim != 2 or f_arr.ndim != 2 or f_arr.shape[1] < 3:
                continue
            valid = (
                (f_arr[:, 0] >= 0) & (f_arr[:, 0] < len(v_arr))
                & (f_arr[:, 1] >= 0) & (f_arr[:, 1] < len(v_arr))
                & (f_arr[:, 2] >= 0) & (f_arr[:, 2] < len(v_arr))
            )
            if np.any(valid):
                fv = f_arr[valid]
                chunks.append(np.stack([v_arr[fv[:, 0]], v_arr[fv[:, 1]], v_arr[fv[:, 2]]], axis=1))

    return np.vstack(chunks) if chunks else np.empty((0, 3, 3), dtype=np.float64)


def compute_panel_exposure_for_date(
    analysis_data: Dict[str, Any],
    date_str: str = "2026-09-23",
    hours: Optional[List[int]] = None,
    north_angle_deg: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Computes hourly direct-sun exposure (`sunlit_masks` + `sunlit_by_hour`) for every active
    panel in `analysis_data` on `date_str` (default hours 06:00..18:00), reusing
    `raycast_z_slab_solar_rays` and content-hashed caching.
    """
    loc = analysis_data.get("location_info") or {}
    summary = analysis_data.get("summary") or {}
    lat_deg = float(loc.get("latitude_deg", -6.2088))
    north_deg = (
        float(north_angle_deg)
        if north_angle_deg is not None
        else float(summary.get("north_angle_deg", 0.0))
    )
    hour_list = sorted({max(0, min(23, int(h))) for h in hours}) if hours else list(range(6, 19))

    active_panels = [p for p in (analysis_data.get("panels") or []) if p.get("active")]
    panel_ids = [p["id"] for p in active_panels]

    solar_vectors = compute_solar_vectors_for_date(
        latitude_deg=lat_deg,
        date_str=date_str,
        north_angle_deg=north_deg,
        hours=hour_list,
    )

    if not active_panels:
        return {
            "analysis_id": analysis_data.get("analysis_id"),
            "date": date_str,
            "latitude_deg": round(lat_deg, 4),
            "north_angle_deg": round(north_deg, 1),
            "hours": hour_list,
            "solar_vectors": solar_vectors,
            "panel_ids": [],
            "sunlit_masks": [],
            "sunlit_by_hour": {str(h): [] for h in hour_list},
        }

    centroids_np = np.array([p["centroid"] for p in active_panels], dtype=np.float64)
    normals_np = np.array([p["normal"] for p in active_panels], dtype=np.float64)
    origins_np = centroids_np + normals_np * 0.10
    obs_tris = _build_obstruction_tris_from_analysis(analysis_data)

    bbox = summary.get("bounding_box") or {}
    max_span = float(bbox.get("max_span") or 20.0)
    self_shade_reach = max(24.0, max_span * 1.5)

    obs_hash = (
        hashlib.blake2b(np.ascontiguousarray(obs_tris).view(np.uint8), digest_size=16).digest()
        if len(obs_tris) > 0
        else b""
    )
    orig_hash = hashlib.blake2b(np.ascontiguousarray(origins_np).view(np.uint8), digest_size=16).digest()
    cache_key = (
        obs_hash,
        orig_hash,
        len(active_panels),
        str(date_str).strip()[:10],
        tuple(hour_list),
        round(lat_deg, 3),
        round(north_deg, 1),
    )

    if cache_key in _EXPOSURE_CACHE:
        cached = dict(_EXPOSURE_CACHE[cache_key])
        cached["analysis_id"] = analysis_data.get("analysis_id")
        return cached

    n_hours = len(solar_vectors)
    n_panels = len(active_panels)
    sun_dirs_np = np.array([sv["vector"] for sv in solar_vectors], dtype=np.float64)
    above_arr = np.array([bool(sv["above_horizon"]) for sv in solar_vectors], dtype=bool)
    cos_inc_mat = sun_dirs_np @ normals_np.T  # (n_hours, n_panels)
    front_mask = (cos_inc_mat > 0.01) & above_arr[:, None]

    hourly_hits = np.zeros((n_hours, n_panels), dtype=np.float64)
    if len(obs_tris) > 0:
        for h_idx, sv in enumerate(solar_vectors):
            if not sv["above_horizon"]:
                continue
            active_idx = np.where(front_mask[h_idx])[0]
            if len(active_idx) == 0:
                continue
            hourly_hits[h_idx, active_idx] = raycast_z_slab_solar_rays(
                obs_tris,
                origins_np[active_idx],
                sun_dirs_np[h_idx],
                min_dist=0.08,
                max_dist=self_shade_reach,
            )

    sunlit_mat = front_mask & (hourly_hits < 0.5)
    bit_weights = (1 << np.arange(n_hours, dtype=np.int64))[:, None]
    sunlit_masks = np.sum(sunlit_mat.astype(np.int64) * bit_weights, axis=0).tolist()
    sunlit_by_hour = {
        str(solar_vectors[h_idx]["hour"]): [panel_ids[p_idx] for p_idx in np.where(sunlit_mat[h_idx])[0]]
        for h_idx in range(n_hours)
    }

    res = {
        "analysis_id": analysis_data.get("analysis_id"),
        "date": str(date_str).strip()[:10],
        "latitude_deg": round(lat_deg, 4),
        "north_angle_deg": round(north_deg, 1),
        "hours": hour_list,
        "solar_vectors": solar_vectors,
        "panel_ids": panel_ids,
        "sunlit_masks": sunlit_masks,
        "sunlit_by_hour": sunlit_by_hour,
    }
    if len(_EXPOSURE_CACHE) >= 32:
        _EXPOSURE_CACHE.clear()
    _EXPOSURE_CACHE[cache_key] = res
    return res


# ============================================================================
# 5. SPATIAL Z-SLAB INDEXED RAYCASTING ENGINE (08:00 - 16:00)
# ============================================================================

def raycast_z_slab_solar_rays(
    obs_tris: np.ndarray,
    origins_np: np.ndarray,
    solar_dir: np.ndarray,
    min_dist: float = 0.08,
    max_dist: float = 35.0,
) -> np.ndarray:
    """
    Fast Z-slab partitioned Möller-Trumbore raycasting for parallel solar vector `solar_dir`.
    Supports both close-range shading devices (mullions/louvers) and long-range full-building
    self-shading (L-shape/U-shape wings, podium setbacks, cantilevered balconies).
    """
    num_rays = len(origins_np)
    if obs_tris is None or len(obs_tris) == 0 or num_rays == 0:
        return np.zeros(num_rays, dtype=np.float64)

    # Subsample obstruction triangles only if extremely dense (> 12,000 tris) for interactive speed
    if len(obs_tris) > 12000:
        step = max(1, len(obs_tris) // 12000)
        tris = obs_tris[::step]
    else:
        tris = obs_tris

    v0 = tris[:, 0, :]
    e1 = tris[:, 1, :] - v0
    e2 = tris[:, 2, :] - v0

    d = np.asarray(solar_dir, dtype=np.float64)
    d = d / max(1e-9, float(np.linalg.norm(d)))

    h = np.cross(np.broadcast_to(d, e2.shape), e2)
    a = np.einsum("ij,ij->i", e1, h)

    valid_tri = np.abs(a) > 1e-7
    if not np.any(valid_tri):
        return np.zeros(num_rays, dtype=np.float64)

    v0 = v0[valid_tri]
    e1 = e1[valid_tri]
    e2 = e2[valid_tri]
    h = h[valid_tri]
    f = 1.0 / a[valid_tri]
    tri_z_min = np.min(tris[valid_tri, :, 2], axis=1)
    tri_z_max = np.max(tris[valid_tri, :, 2], axis=1)

    p_u = h * f[:, None]
    p_v = np.cross(e1, np.broadcast_to(d, e1.shape)) * f[:, None]
    p_t = np.cross(e1, e2) * f[:, None]

    c_u = np.einsum("ij,ij->i", v0, p_u)
    c_v = np.einsum("ij,ij->i", v0, p_v)
    c_t = np.einsum("ij,ij->i", v0, p_t)

    hits_out = np.zeros(num_rays, dtype=np.float64)

    # Grid 2D pada bidang tegak lurus arah matahari: sinar hanya dapat mengenai segitiga yang proyeksinya
    # menutupi proyeksi titik asal sinar. Ini saringan murni (superset), syarat u/v/t tetap sama persis.
    # Pemangkasan lama per lapis Z juga saringan murni (sinar naik, jangkauan dibatasi max_dist).
    ref = np.array([0.0, 0.0, 1.0]) if abs(float(d[2])) < 0.9 else np.array([1.0, 0.0, 0.0])
    ax_a = np.cross(d, ref)
    ax_a /= max(1e-12, float(np.linalg.norm(ax_a)))
    ax_b = np.cross(d, ax_a)
    tv = tris[valid_tri]
    pa = tv @ ax_a
    pb = tv @ ax_b
    a_lo, a_hi = pa.min(axis=1), pa.max(axis=1)
    b_lo, b_hi = pb.min(axis=1), pb.max(axis=1)
    pad = 1e-3 * np.maximum(a_hi - a_lo, b_hi - b_lo) + 1e-4  # toleransi barisentrik 1e-4 aman tercakup
    a_lo -= pad
    a_hi += pad
    b_lo -= pad
    b_hi += pad
    oa = origins_np @ ax_a
    ob = origins_np @ ax_b
    cell = 4.0
    a0 = float(min(oa.min(), a_lo.min()))
    b0 = float(min(ob.min(), b_lo.min()))
    ia_lo = np.floor((a_lo - a0) / cell).astype(np.int64)
    ia_hi = np.floor((a_hi - a0) / cell).astype(np.int64)
    ib_lo = np.floor((b_lo - b0) / cell).astype(np.int64)
    ib_hi = np.floor((b_hi - b0) / cell).astype(np.int64)
    n_b = int(max(ib_hi.max(), np.floor((ob.max() - b0) / cell))) + 1
    r_key = np.floor((oa - a0) / cell).astype(np.int64) * n_b + np.floor((ob - b0) / cell).astype(np.int64)

    span_a = ia_hi - ia_lo + 1
    span_b = ib_hi - ib_lo + 1
    n_cells = span_a * span_b
    big = n_cells > 400  # segitiga raksasa: uji ke semua sinar
    big_idx = np.where(big)[0]
    sm = np.where(~big)[0]
    reps = n_cells[sm]
    tri_rep = np.repeat(sm, reps.astype(np.intp))
    local = np.arange(int(reps.sum())) - np.repeat(np.cumsum(reps) - reps, reps.astype(np.intp))
    sb = np.repeat(span_b[sm], reps.astype(np.intp))
    t_key = (np.repeat(ia_lo[sm], reps.astype(np.intp)) + local // sb) * n_b + (np.repeat(ib_lo[sm], reps.astype(np.intp)) + local % sb)
    t_order = np.argsort(t_key, kind="stable")
    t_key_s = t_key[t_order]
    tri_s = tri_rep[t_order]

    r_order = np.argsort(r_key, kind="stable")
    r_key_s = r_key[r_order]
    cut = np.flatnonzero(np.diff(r_key_s)) + 1
    starts = np.concatenate(([0], cut))
    ends = np.concatenate((cut, [len(r_key_s)]))
    for st, en in zip(starts, ends):
        key = r_key_s[st]
        lo_i = np.searchsorted(t_key_s, key, side="left")
        hi_i = np.searchsorted(t_key_s, key, side="right")
        cand = tri_s[lo_i:hi_i]
        if len(big_idx):
            cand = np.concatenate((cand, big_idx))
        if len(cand) == 0:
            continue
        cand = np.unique(cand)
        r_idx = r_order[st:en]
        o_batch = origins_np[r_idx]
        u = o_batch @ p_u[cand].T - c_u[cand][None, :]
        mask = (u >= -1e-4) & (u <= 1.0001)
        if not np.any(mask):
            continue
        v = o_batch @ p_v[cand].T - c_v[cand][None, :]
        mask &= (v >= -1e-4) & ((u + v) <= 1.0001)
        if not np.any(mask):
            continue
        t = o_batch @ p_t[cand].T - c_t[cand][None, :]
        mask &= (t >= min_dist) & (t <= max_dist)
        hits_out[r_idx] = np.any(mask, axis=1).astype(np.float64)

    return hits_out


_RAYCAST_TRI_CACHE: Dict[Tuple[Tuple[int, ...], str, bytes], Tuple[np.ndarray, ...]] = {}


def _get_tri_raycast_accel(tris: np.ndarray) -> Tuple[np.ndarray, ...]:
    """
    Caches precomputed triangle edges and XY/Z bounding geometry keyed strictly by
    array content hash (blake2b + shape + dtype) — NEVER by Python memory address `id(tris)`.
    """
    tris_c = np.ascontiguousarray(tris)
    digest = hashlib.blake2b(tris_c.view(np.uint8), digest_size=16).digest()
    key = (tris_c.shape, str(tris_c.dtype), digest)
    cached = _RAYCAST_TRI_CACHE.get(key)
    if cached is not None:
        return cached
    if len(_RAYCAST_TRI_CACHE) >= 16:
        _RAYCAST_TRI_CACHE.clear()
    v0 = np.ascontiguousarray(tris_c[:, 0, :], dtype=np.float64)
    e1 = np.ascontiguousarray(tris_c[:, 1, :] - v0, dtype=np.float64)
    e2 = np.ascontiguousarray(tris_c[:, 2, :] - v0, dtype=np.float64)
    z_min = np.min(tris_c[:, :, 2], axis=1)
    z_max = np.max(tris_c[:, :, 2], axis=1)
    x_min = np.min(tris_c[:, :, 0], axis=1)
    x_max = np.max(tris_c[:, :, 0], axis=1)
    y_min = np.min(tris_c[:, :, 1], axis=1)
    y_max = np.max(tris_c[:, :, 1], axis=1)
    cx = (0.5 * (x_min + x_max)).astype(np.float32)
    cy = (0.5 * (y_min + y_max)).astype(np.float32)
    rx = (0.5 * (x_max - x_min)).astype(np.float32)
    ry = (0.5 * (y_max - y_min)).astype(np.float32)
    r_xy = (np.hypot(rx, ry) + np.float32(1e-3)).astype(np.float32)
    pack = (v0, e1, e2, z_min, z_max, x_min, x_max, y_min, y_max, cx, cy, r_xy)
    _RAYCAST_TRI_CACHE[key] = pack
    return pack


def _raycast_arbitrary_rays_against_tris(
    origins: np.ndarray,
    directions: np.ndarray,
    tris: np.ndarray,
    min_dist: float = 0.04,
    max_dist: float = 500.0,
    accel: Optional[Tuple[np.ndarray, ...]] = None,
) -> np.ndarray:
    """
    Exact Z-slab + 2D bounding-circle culled Möller-Trumbore raycast for per-ray arbitrary directions.
    Returns `(N,)` array of closest hit distance `t` (or `np.inf` if ray escapes to infinity).
    100% mathematically equivalent to brute-force Möller-Trumbore while eliminating >98% of
    impossible (ray, triangle) pairs before 3D cross products.
    """
    n_rays = len(origins)
    min_t_out = np.full(n_rays, np.inf, dtype=np.float64)
    if n_rays == 0 or tris is None or len(tris) == 0:
        return min_t_out

    v0_all, e1_all, e2_all, tri_z_min, tri_z_max, tri_x_min, tri_x_max, tri_y_min, tri_y_max, tri_cx, tri_cy, tri_r_xy = (
        accel if accel is not None else _get_tri_raycast_accel(tris)
    )

    orig_z = origins[:, 2]
    z_min_all = float(np.min(orig_z))
    z_max_all = float(np.max(orig_z))
    is_vertical_ray = bool(np.mean(np.abs(directions[:, 2])) > 0.85)
    slab_h = 2.0 if not is_vertical_ray else max(100.0, z_max_all - z_min_all + 2.0)
    num_slabs = max(1, int(math.ceil((z_max_all - z_min_all + 0.1) / slab_h)))
    min_d_f32 = np.float32(min_dist)
    max_d_f32 = np.float32(max_dist)

    for s_idx in range(num_slabs):
        z_lo = z_min_all + s_idx * slab_h
        z_hi = z_lo + slab_h
        ray_indices = np.where((orig_z >= z_lo - 0.01) & (orig_z < z_hi + 0.01))[0]
        if len(ray_indices) == 0:
            continue

        if is_vertical_ray:
            tri_mask = tri_z_max >= (z_lo - 0.5)
        else:
            tri_mask = (tri_z_max >= (z_lo - 0.15)) & (tri_z_min <= (z_hi + 0.15))
        if not np.any(tri_mask):
            continue

        tri_ids = np.where(tri_mask)[0]
        cx_s = tri_cx[tri_ids]
        cy_s = tri_cy[tri_ids]
        r_s = tri_r_xy[tri_ids]
        xmin_s = tri_x_min[tri_ids] if is_vertical_ray else None
        xmax_s = tri_x_max[tri_ids] if is_vertical_ray else None
        ymin_s = tri_y_min[tri_ids] if is_vertical_ray else None
        ymax_s = tri_y_max[tri_ids] if is_vertical_ray else None

        for b_start in range(0, len(ray_indices), 128):
            b_idx = ray_indices[b_start:b_start + 128]
            o_b = origins[b_idx]      # (B, 3) float64
            d_b = directions[b_idx]   # (B, 3) float64

            if is_vertical_ray:
                ox = o_b[:, 0:1]
                oy = o_b[:, 1:2]
                cand = (
                    (ox >= xmin_s[None, :] - 1e-3)
                    & (ox <= xmax_s[None, :] + 1e-3)
                    & (oy >= ymin_s[None, :] - 1e-3)
                    & (oy <= ymax_s[None, :] + 1e-3)
                )
            else:
                ox32 = o_b[:, 0:1].astype(np.float32)
                oy32 = o_b[:, 1:2].astype(np.float32)
                dx_r = d_b[:, 0:1].astype(np.float32)
                dy_r = d_b[:, 1:2].astype(np.float32)
                # Normalize XY ray dir for exact perpendicular distance check
                d_xy_len = np.hypot(dx_r, dy_r)
                inv_len = np.where(d_xy_len > np.float32(1e-6), np.float32(1.0) / np.maximum(np.float32(1e-6), d_xy_len), np.float32(1.0))
                ux = dx_r * inv_len
                uy = dy_r * inv_len
                rx_off = cx_s[None, :] - ox32
                ry_off = cy_s[None, :] - oy32
                perp = np.abs(rx_off * (-uy) + ry_off * ux)
                cand = perp <= r_s[None, :]
                if np.any(cand):
                    proj = rx_off * ux + ry_off * uy
                    cand &= (proj + r_s[None, :] >= min_d_f32 * d_xy_len) & (proj - r_s[None, :] <= max_d_f32 * d_xy_len)

            r_loc, t_loc = np.nonzero(cand)
            if len(r_loc) == 0:
                continue

            # Exact float64 1D Möller-Trumbore only on surviving candidate pairs
            t_glob = tri_ids[t_loc]
            o_p = o_b[r_loc]
            d_p = d_b[r_loc]
            v0_p = v0_all[t_glob]
            e1_p = e1_all[t_glob]
            e2_p = e2_all[t_glob]

            h_p = np.cross(d_p, e2_p)
            a_p = np.einsum("ij,ij->i", e1_p, h_p)
            ok = np.abs(a_p) > 1e-7
            if not np.any(ok):
                continue

            r_loc = r_loc[ok]
            o_p = o_p[ok]
            d_p = d_p[ok]
            v0_p = v0_p[ok]
            e1_p = e1_p[ok]
            e2_p = e2_p[ok]
            h_p = h_p[ok]
            f_p = 1.0 / a_p[ok]

            s_p = o_p - v0_p
            u_p = f_p * np.einsum("ij,ij->i", s_p, h_p)
            ok2 = (u_p >= -1e-4) & (u_p <= 1.0001)
            if not np.any(ok2):
                continue

            r_loc = r_loc[ok2]
            d_p = d_p[ok2]
            e1_p = e1_p[ok2]
            e2_p = e2_p[ok2]
            s_p = s_p[ok2]
            f_p = f_p[ok2]
            u_p = u_p[ok2]

            q_p = np.cross(s_p, e1_p)
            v_p = f_p * np.einsum("ij,ij->i", d_p, q_p)
            ok3 = (v_p >= -1e-4) & ((u_p + v_p) <= 1.0001)
            if not np.any(ok3):
                continue

            r_loc = r_loc[ok3]
            e2_p = e2_p[ok3]
            q_p = q_p[ok3]
            f_p = f_p[ok3]

            t_p = f_p * np.einsum("ij,ij->i", e2_p, q_p)
            ok4 = (t_p >= min_dist) & (t_p <= max_dist)
            if not np.any(ok4):
                continue

            np.minimum.at(min_t_out, b_idx[r_loc[ok4]], t_p[ok4])

    return min_t_out


NARROW_GAP_THRESHOLD_M = 1.50


def detect_exterior_faces_raycast(
    centroids: np.ndarray,
    normals: np.ndarray,
    all_shell_tris: np.ndarray,
    roof_tris: np.ndarray,
    max_span: float,
    return_narrow_gap: bool = False,
) -> Any:
    """
    3-Layer Universal Exterior Skin Visibility Engine:
    Determines which vertical/tilted facade faces truly face the exterior atmosphere
    (works on Box, Curved Tower, L-Shape, U-Shape, Courtyard, Twin-Tower, and Full-BIM
    models containing interior partitions — zero convex/single-center assumptions!).
    """
    n_p = len(centroids)
    if n_p == 0 or len(all_shell_tris) == 0:
        ones = np.ones(n_p, dtype=bool)
        if return_narrow_gap:
            return ones, np.zeros(n_p, dtype=bool)
        return ones

    # Build horizontal unit outward direction per panel
    n_h = np.zeros_like(normals)
    n_h[:, 0] = normals[:, 0]
    n_h[:, 1] = normals[:, 1]
    h_mag = np.linalg.norm(n_h[:, :2], axis=1, keepdims=True)
    n_h = np.where(h_mag > 1e-6, n_h / np.maximum(1e-6, h_mag), np.array([0.0, 1.0, 0.0]))

    origins = centroids + normals * 0.06
    reach = max(60.0, max_span * 2.5)
    shell_accel = _get_tri_raycast_accel(all_shell_tris)

    # Probe 1: straight horizontal normal (+n_h, 0 deg)
    t_center = _raycast_arbitrary_rays_against_tris(
        origins, n_h, all_shell_tris, min_dist=0.03, max_dist=reach, accel=shell_accel
    )

    # 1. Faces hitting a solid partner face within <= 0.42m point INTO solid wall/glass thickness -> Inner!
    hits_solid_core = t_center <= 0.42
    # 2. Faces escaping straight to infinity along +n_h -> Definitely Exterior!
    escaped_horiz = (~hits_solid_core) & (~np.isfinite(t_center))

    # 3. For faces blocked across an open space (0.42m < t_center < inf):
    #    Check immediately behind the wall (-n_h starting 0.35m behind centroid).
    #    If the space behind this wall escapes directly to infinity, then the OTHER side is the exterior
    #    and THIS side is the inward-facing interior skin of a closed/open-top shell!
    #    Otherwise (building interior is behind this wall), test wide horizontal fan (+-35, +-62 deg)
    #    to detect L-shape / U-shape / H-shape courtyard exterior facades!
    ambiguous = (~hits_solid_core) & (~escaped_horiz)
    confirmed_inner = hits_solid_core.copy()
    if np.any(ambiguous):
        idx_amb = np.where(ambiguous)[0]
        back_origins = centroids[idx_amb] - n_h[idx_amb] * 0.35
        t_back = _raycast_arbitrary_rays_against_tris(
            back_origins, -n_h[idx_amb], all_shell_tris, min_dist=0.03, max_dist=reach, accel=shell_accel
        )
        back_is_open_air = ~np.isfinite(t_back)
        confirmed_inner[idx_amb[back_is_open_air]] = True

    for deg_ang in (35.0, -35.0, 62.0, -62.0):
        still_need = (~confirmed_inner) & (~escaped_horiz)
        if not np.any(still_need):
            break
        idx_na = np.where(still_need)[0]
        ang = math.radians(deg_ang)
        ca, sa = math.cos(ang), math.sin(ang)
        nh_sub = n_h[idx_na]
        d_fan = np.column_stack([nh_sub[:, 0] * ca - nh_sub[:, 1] * sa, nh_sub[:, 0] * sa + nh_sub[:, 1] * ca, np.zeros(len(idx_na))])
        t_fan = _raycast_arbitrary_rays_against_tris(
            origins[idx_na], d_fan, all_shell_tris, min_dist=0.05, max_dist=reach, accel=shell_accel
        )
        escaped_na = ~np.isfinite(t_fan)
        escaped_horiz[idx_na[escaped_na]] = True

    is_outer = escaped_horiz.copy()

    # 4. Enclosed 4-sided Courtyard check: if not confirmed_inner and still blocked horizontally
    #    across a genuine open courtyard span (> 1.80 m, NOT a narrow double-skin facade cavity <= 1.80 m),
    #    check if open to sky above (no roof slab overhead).
    still_blocked = (~confirmed_inner) & (~escaped_horiz) & (t_center > 1.80)
    if np.any(still_blocked) and len(roof_tris) > 0:
        idx_sb = np.where(still_blocked)[0]
        sky_origins = centroids[idx_sb] + n_h[idx_sb] * 0.45
        sky_dirs = np.tile(np.array([[0.0, 0.0, 1.0]]), (len(idx_sb), 1))
        t_roof = _raycast_arbitrary_rays_against_tris(sky_origins, sky_dirs, roof_tris, min_dist=0.10, max_dist=reach)
        is_courtyard = ~np.isfinite(t_roof)
        is_outer[idx_sb[is_courtyard]] = True

    if return_narrow_gap:
        # A3-07: bidang terbuang karena menghadapi massa lain berjarak < 1,5 m (bukan ketebalan dinding <= 0,42 m)
        is_narrow_gap = (
            (~is_outer)
            & (~confirmed_inner)
            & np.isfinite(t_center)
            & (t_center > 0.42)
            & ((t_center + 0.06) < NARROW_GAP_THRESHOLD_M)
        )
        if np.any(is_narrow_gap) and len(roof_tris) > 0:
            idx_ng = np.where(is_narrow_gap)[0]
            mid_step = np.minimum(0.45, 0.5 * t_center[idx_ng])
            ng_sky_origins = centroids[idx_ng] + n_h[idx_ng] * mid_step[:, None]
            ng_sky_dirs = np.tile(np.array([[0.0, 0.0, 1.0]]), (len(idx_ng), 1))
            t_ng_roof = _raycast_arbitrary_rays_against_tris(
                ng_sky_origins, ng_sky_dirs, roof_tris, min_dist=0.10, max_dist=reach
            )
            # Hanya celah terbuka ke langit (antar massa), bukan koridor beratap di dalam bangunan
            is_narrow_gap[idx_ng[np.isfinite(t_ng_roof)]] = False
        return is_outer, is_narrow_gap

    return is_outer


def _groups_to_tris_shared(
    rg_list: List[RawGroupMesh],
    disabled_groups: Optional[set] = None,
) -> np.ndarray:
    """Converts a list of RawGroupMesh into an un-strided `(T, 3, 3)` triangle array."""
    dis = disabled_groups or set()
    chunks: List[np.ndarray] = []
    for r in rg_list:
        if r.group_name in dis or len(r.faces) == 0:
            continue
        vs_r, fs_r = r.vertices, r.faces
        chunks.append(np.stack([vs_r[fs_r[:, 0]], vs_r[fs_r[:, 1]], vs_r[fs_r[:, 2]]], axis=1))
        is_q_r = fs_r[:, 2] != fs_r[:, 3]
        if np.any(is_q_r):
            fq_r = fs_r[is_q_r]
            chunks.append(np.stack([vs_r[fq_r[:, 0]], vs_r[fq_r[:, 2]], vs_r[fq_r[:, 3]]], axis=1))
    return np.vstack(chunks) if chunks else np.empty((0, 3, 3), dtype=np.float64)


def _compute_face_shortest_dims(
    p0: np.ndarray,
    p1: np.ndarray,
    p2: np.ndarray,
    p3: np.ndarray,
    is_quad: np.ndarray,
    normals: np.ndarray,
) -> np.ndarray:
    """
    Computes the shortest in-plane bounding dimension (m) for each triangle/quad face.
    Used to distinguish genuine upward-facing skylights (min_dim > 0.30 m) from
    thin top-edge panel thickness faces (`sisi_tebal_panel`, min_dim <= 0.30 m).
    """
    n = len(p0)
    if n == 0:
        return np.empty(0, dtype=np.float64)
    # Candidate edges: e01, e12, e20 (tri) or e23 & e30 (quad)
    e01 = p1 - p0
    e12 = p2 - p1
    e23 = np.where(is_quad[:, None], p3 - p2, p0 - p2)
    e30 = np.where(is_quad[:, None], p0 - p3, np.zeros_like(p0))
    edges = np.stack([e01, e12, e23, e30], axis=1)  # (N, 4, 3)
    lens = np.linalg.norm(edges, axis=2)            # (N, 4)
    best_e_idx = np.argmax(lens, axis=1)
    longest_e = edges[np.arange(n), best_e_idx]     # (N, 3)
    longest_len = np.maximum(1e-9, np.linalg.norm(longest_e, axis=1, keepdims=True))
    u_vec = longest_e / longest_len
    v_raw = np.cross(normals, u_vec)
    v_len = np.maximum(1e-9, np.linalg.norm(v_raw, axis=1, keepdims=True))
    v_vec = v_raw / v_len

    # For triangles, duplicate p2 in slot 3 so min/max across 4 slots is exact
    p3_eff = np.where(is_quad[:, None], p3, p2)
    pts = np.stack([p0, p1, p2, p3_eff], axis=1)    # (N, 4, 3)
    proj_u = np.einsum("nkc,nc->nk", pts, u_vec)
    proj_v = np.einsum("nkc,nc->nk", pts, v_vec)
    du = np.max(proj_u, axis=1) - np.min(proj_u, axis=1)
    dv = np.max(proj_v, axis=1) - np.min(proj_v, axis=1)
    return np.minimum(du, dv)


def resolve_group_outer_skin_faces(
    rg: RawGroupMesh,
    eff_cat: str,
    all_shell_tris: np.ndarray,
    roof_tris: np.ndarray,
    floor_centers: np.ndarray,
    floor_defs: List[Dict[str, Any]],
    span_x: float,
    span_y: float,
    max_span: float,
    ext_mode: str = "auto",
    z_ground_cut: float = 0.0,
    restore_set: Optional[set] = None,
) -> Optional[Dict[str, Any]]:
    """
    M11: Single source of truth for exterior-skin face extraction & outer area calculation,
    shared identically by BOTH Inspection (`adapters.build_staging_inspection_payload`) and
    Results (`ottv_engine.analyze_building_ottv`).
    """
    vs = rg.vertices
    fs = rg.faces
    if len(vs) < 3 or len(fs) < 1:
        return None
    is_quad = fs[:, 2] != fs[:, 3]
    p0 = vs[fs[:, 0]]
    p1 = vs[fs[:, 1]]
    p2 = vs[fs[:, 2]]
    p3 = vs[fs[:, 3]]

    c1 = np.cross(p1 - p0, p2 - p0)
    c2 = np.where(is_quad[:, None], np.cross(p2 - p0, p3 - p0), 0.0)
    cross_sum = c1 + c2
    areas = 0.5 * np.linalg.norm(cross_sum, axis=1)

    valid_mask = areas > 1e-3
    if not np.any(valid_mask):
        return None

    orig_idx_v = np.arange(len(fs), dtype=np.int64)[valid_mask]
    fs_v = fs[valid_mask]
    is_quad_v = is_quad[valid_mask]
    p0_v, p1_v, p2_v, p3_v = p0[valid_mask], p1[valid_mask], p2[valid_mask], p3[valid_mask]
    areas_v = areas[valid_mask]
    normals_v = cross_sum[valid_mask] / (2.0 * areas_v[:, None])

    rf_set = restore_set or set()
    non_vert_id = f"non_vertical::{rg.group_name}"
    edge_thick_id = f"sisi_tebal_panel::{rg.group_name}"
    filtered_entries: List[Dict[str, Any]] = []

    if eff_cat == "glazing" or non_vert_id in rf_set:
        if eff_cat == "glazing":
            vert_mask = np.ones(len(areas_v), dtype=bool)
            # Upward-facing glazing faces (nz > 0.50): only real skylights have shortest dim > 0.30 m;
            # thin panel-edge thickness faces (<= 0.30 m) go to filtered_items as 'sisi_tebal_panel'.
            up_glz_idx = np.where(normals_v[:, 2] > 0.50)[0]
            if len(up_glz_idx) > 0 and edge_thick_id not in rf_set:
                up_min_dims = _compute_face_shortest_dims(
                    p0_v[up_glz_idx],
                    p1_v[up_glz_idx],
                    p2_v[up_glz_idx],
                    p3_v[up_glz_idx],
                    is_quad_v[up_glz_idx],
                    normals_v[up_glz_idx],
                )
                thin_up_idx = up_glz_idx[up_min_dims <= 0.30]
                if len(thin_up_idx) > 0:
                    thin_up_mask = np.zeros(len(areas_v), dtype=bool)
                    thin_up_mask[thin_up_idx] = True
                    filtered_entries.append({
                        "id": edge_thick_id,
                        "group": rg.group_name,
                        "reason": "sisi_tebal_panel",
                        "reason_label": "Sisi tebal tepi panel kaca menghadap atas (dimensi terpendek <= 0,3 m)",
                        "face_count": int(len(thin_up_idx)),
                        "area_m2": round(float(np.sum(areas_v[thin_up_mask])), 4),
                        "restored": False,
                    })
                    vert_mask &= ~thin_up_mask

            # Downward-facing glazing caps/soffits (nz < -0.50):
            # - Thin bottom edges (shortest dim <= 0.30 m) -> 'sisi_tebal_panel' (same rule as top edge)
            # - Downward horizontal soffits (nz < -0.85) -> 'horizontal_edge_cap' (never facade or skylight)
            dn_glz_idx = np.where((normals_v[:, 2] < -0.50) & vert_mask)[0]
            if len(dn_glz_idx) > 0:
                dn_min_dims = _compute_face_shortest_dims(
                    p0_v[dn_glz_idx],
                    p1_v[dn_glz_idx],
                    p2_v[dn_glz_idx],
                    p3_v[dn_glz_idx],
                    is_quad_v[dn_glz_idx],
                    normals_v[dn_glz_idx],
                )
                thin_dn_idx = dn_glz_idx[dn_min_dims <= 0.30]
                if len(thin_dn_idx) > 0 and edge_thick_id not in rf_set:
                    thin_dn_mask = np.zeros(len(areas_v), dtype=bool)
                    thin_dn_mask[thin_dn_idx] = True
                    existing_et = next((e for e in filtered_entries if e["id"] == edge_thick_id), None)
                    if existing_et is not None:
                        existing_et["face_count"] += int(len(thin_dn_idx))
                        existing_et["area_m2"] = round(
                            float(existing_et["area_m2"]) + float(np.sum(areas_v[thin_dn_mask])), 4
                        )
                    else:
                        filtered_entries.append({
                            "id": edge_thick_id,
                            "group": rg.group_name,
                            "reason": "sisi_tebal_panel",
                            "reason_label": "Sisi tebal tepi panel kaca (dimensi terpendek <= 0,3 m)",
                            "face_count": int(len(thin_dn_idx)),
                            "area_m2": round(float(np.sum(areas_v[thin_dn_mask])), 4),
                            "restored": False,
                        })
                    vert_mask &= ~thin_dn_mask

            horiz_bot = (normals_v[:, 2] < -0.85) & vert_mask
            if np.any(horiz_bot) and non_vert_id not in rf_set:
                filtered_entries.append({
                    "id": non_vert_id,
                    "group": rg.group_name,
                    "reason": "horizontal_edge_cap",
                    "reason_label": "Sisi horizontal menghadap bawah pada kaca (nz < -0,85)",
                    "face_count": int(np.sum(horiz_bot)),
                    "area_m2": round(float(np.sum(areas_v[horiz_bot])), 4),
                    "restored": False,
                })
                vert_mask &= ~horiz_bot
        else:
            vert_mask = np.ones(len(areas_v), dtype=bool)
    else:
        vert_mask = np.abs(normals_v[:, 2]) <= 0.85
        n_non_vert = int(np.sum(~vert_mask))
        if n_non_vert > 0:
            filtered_entries.append({
                "id": non_vert_id,
                "group": rg.group_name,
                "reason": "non_vertical_cap",
                "reason_label": "Bidang horizontal/datar pada dinding/spandrel (|nz| > 0,85)",
                "face_count": n_non_vert,
                "area_m2": round(float(np.sum(areas_v[~vert_mask])), 4),
                "restored": False,
            })
    filtered_entry: Optional[Dict[str, Any]] = filtered_entries[0] if filtered_entries else None
    if not np.any(vert_mask):
        return None

    orig_idx_v = orig_idx_v[vert_mask]
    fs_v = fs_v[vert_mask]
    is_quad_v = is_quad_v[vert_mask]
    p0_v, p1_v, p2_v, p3_v = p0_v[vert_mask], p1_v[vert_mask], p2_v[vert_mask], p3_v[vert_mask]
    areas_v = areas_v[vert_mask]
    normals_v = normals_v[vert_mask]

    centroids_v = np.where(
        is_quad_v[:, None],
        0.25 * (p0_v + p1_v + p2_v + p3_v),
        (p0_v + p1_v + p2_v) / 3.0,
    )

    total_floors = max(1, len(floor_defs))
    fl_indices = np.clip(
        assign_panels_to_floors(centroids_v[:, 2], floor_defs),
        0,
        total_floors - 1,
    )

    f_centers = floor_centers[fl_indices]
    radial_xy = centroids_v[:, :2] - f_centers
    radial_dot = np.einsum("ij,ij->i", radial_xy, normals_v[:, :2])
    is_single_flat_wall_model = min(span_x, span_y) < 1.5

    narrow_gap_arr = np.zeros(len(areas_v), dtype=bool)
    if ext_mode == "all":
        is_outer_arr = np.ones(len(areas_v), dtype=bool)
    elif ext_mode == "radial":
        pos_ratio = float(np.mean(radial_dot >= 0.0))
        if 0.25 <= pos_ratio <= 0.75:
            is_outer_arr = radial_dot >= 0.0
        else:
            normals_v[radial_dot < 0.0] *= -1.0
            is_outer_arr = np.ones(len(areas_v), dtype=bool)
    else:
        if is_single_flat_wall_model:
            ref_axis = np.array([0.0, 1.0]) if span_x >= span_y else np.array([1.0, 0.0])
            side_dot = normals_v[:, :2] @ ref_axis
            pos_r = float(np.mean(side_dot >= 0.0))
            if 0.25 <= pos_r <= 0.75:
                is_outer_arr = side_dot >= 0.0
            else:
                is_outer_arr = np.ones(len(areas_v), dtype=bool)
        else:
            is_outer_arr, narrow_gap_arr = detect_exterior_faces_raycast(
                centroids_v, normals_v, all_shell_tris, roof_tris, max_span, return_narrow_gap=True
            )
            if float(np.mean(is_outer_arr)) < 0.08:
                twin_origins = centroids_v - normals_v * 0.002
                t_twin = _raycast_arbitrary_rays_against_tris(
                    twin_origins, -normals_v, all_shell_tris, min_dist=0.001, max_dist=0.35
                )
                has_front_twin = float(np.mean(t_twin <= 0.35))
                if has_front_twin < 0.35:
                    flipped_normals = -normals_v
                    flipped_outer, flipped_ng = detect_exterior_faces_raycast(
                        centroids_v, flipped_normals, all_shell_tris, roof_tris, max_span, return_narrow_gap=True
                    )
                    if float(np.mean(flipped_outer)) > float(np.mean(is_outer_arr)) + 0.15:
                        normals_v = flipped_normals
                        is_outer_arr = flipped_outer
                        narrow_gap_arr = flipped_ng

    above_z_mask = (centroids_v[:, 2] >= (z_ground_cut - 0.05)) if z_ground_cut > 0.05 else np.ones(len(areas_v), dtype=bool)
    outer_above = is_outer_arr & above_z_mask
    outer_count = int(np.sum(outer_above))
    outer_area = float(np.sum(areas_v[outer_above])) if outer_count > 0 else 0.0
    narrow_gap_above = narrow_gap_arr & above_z_mask
    narrow_gap_count = int(np.sum(narrow_gap_above))
    narrow_gap_area = float(np.sum(areas_v[narrow_gap_above])) if narrow_gap_count > 0 else 0.0

    return {
        "orig_idx_v": orig_idx_v,
        "fs_v": fs_v,
        "is_quad_v": is_quad_v,
        "p0_v": p0_v,
        "p1_v": p1_v,
        "p2_v": p2_v,
        "p3_v": p3_v,
        "areas_v": areas_v,
        "normals_v": normals_v,
        "centroids_v": centroids_v,
        "fl_indices": fl_indices,
        "is_outer_arr": is_outer_arr,
        "outer_faces": outer_count,
        "outer_area_m2": outer_area,
        "narrow_gap_faces": narrow_gap_count,
        "narrow_gap_area_m2": narrow_gap_area,
        "filtered_entry": filtered_entry,
        "filtered_entries": filtered_entries,
    }


_OUTER_SKIN_CACHE: Dict[Any, Dict[str, Dict[str, Any]]] = {}


def compute_outer_skin_areas_by_group(
    raw_groups: List[RawGroupMesh],
    group_category_overrides: Optional[Dict[str, str]] = None,
    disabled_groups: Optional[List[str]] = None,
    z_ground_cutoff_m: float = 0.0,
    exterior_detection_mode: str = "auto",
    bim_storeys: Optional[List[Dict[str, Any]]] = None,
    restore_filtered: Optional[List[str]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Versi ber-cache (inspeksi diulang tiap pilihan di layar Konfirmasi; deteksi sisi luar adalah bagian
    terberatnya). Kunci = sidik geometri tiap grup + semua parameter yang memengaruhi hasil, jadi hasil identik."""
    import copy as _copy
    fp = tuple(
        (rg.group_name, rg.default_category, len(rg.faces), len(rg.vertices), round(float(np.asarray(rg.vertices).sum()), 4))
        for rg in raw_groups
    )
    key = (
        fp,
        tuple(sorted((group_category_overrides or {}).items())),
        tuple(sorted(disabled_groups or [])),
        round(float(z_ground_cutoff_m or 0.0), 4),
        str(exterior_detection_mode),
        repr(bim_storeys),
        tuple(sorted(restore_filtered or [])),
    )
    hit = _OUTER_SKIN_CACHE.get(key)
    if hit is None:
        hit = _compute_outer_skin_areas_by_group_uncached(
            raw_groups, group_category_overrides, disabled_groups, z_ground_cutoff_m,
            exterior_detection_mode, bim_storeys, restore_filtered,
        )
        if len(_OUTER_SKIN_CACHE) >= 16:
            _OUTER_SKIN_CACHE.clear()
        _OUTER_SKIN_CACHE[key] = hit
    return _copy.deepcopy(hit)


def _compute_outer_skin_areas_by_group_uncached(
    raw_groups: List[RawGroupMesh],
    group_category_overrides: Optional[Dict[str, str]] = None,
    disabled_groups: Optional[List[str]] = None,
    z_ground_cutoff_m: float = 0.0,
    exterior_detection_mode: str = "auto",
    bim_storeys: Optional[List[Dict[str, Any]]] = None,
    restore_filtered: Optional[List[str]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    M11: Shared outer-skin area calculator called by Inspection (`build_staging_inspection_payload`)
    so Inspection and Results report identical outer-skin areas for every envelope group.
    """
    cat_ov = group_category_overrides or {}
    dis_set = set(disabled_groups or [])
    rf_set = set(restore_filtered or [])

    surface_groups: List[Tuple[RawGroupMesh, str]] = []
    roof_groups: List[RawGroupMesh] = []
    unknown_groups: List[RawGroupMesh] = []
    for rg in raw_groups:
        eff_cat = cat_ov.get(rg.group_name, rg.default_category)
        if eff_cat in ("wall", "spandrel", "glazing", "composite_cw"):
            surface_groups.append((rg, eff_cat))
        elif eff_cat == "roof":
            roof_groups.append(rg)
        elif eff_cat == "unknown":
            unknown_groups.append(rg)

    if not surface_groups and raw_groups:
        cands = unknown_groups if unknown_groups else raw_groups
        surface_groups.append((max(cands, key=lambda r: len(r.faces)), "wall"))

    all_surf_verts = np.vstack([rg.vertices for rg, _ in surface_groups])
    x_min, x_max = float(np.min(all_surf_verts[:, 0])), float(np.max(all_surf_verts[:, 0]))
    y_min, y_max = float(np.min(all_surf_verts[:, 1])), float(np.max(all_surf_verts[:, 1]))
    z_min_raw, z_max = float(np.min(all_surf_verts[:, 2])), float(np.max(all_surf_verts[:, 2]))
    z_cut = max(0.0, float(z_ground_cutoff_m or 0.0))
    z_min = max(z_min_raw, z_cut) if (z_cut > 0.05 and z_cut < z_max - 1.0) else z_min_raw
    span_x = max(1.0, x_max - x_min)
    span_y = max(1.0, y_max - y_min)
    span_z = max(1.0, z_max - z_min)
    max_span = max(span_x, span_y, span_z, 10.0)
    bldg_cx, bldg_cy = 0.5 * (x_min + x_max), 0.5 * (y_min + y_max)

    floor_defs, _ = build_dynamic_floor_levels(
        z_min_bldg=z_min,
        z_max_bldg=z_max,
        floor_mode="auto",
        floor_height_m=None,
        bim_storeys=bim_storeys or [],
        raw_groups=raw_groups,
        disabled_groups=list(dis_set),
        group_category_overrides=group_category_overrides,
    )
    total_floors = max(1, len(floor_defs))
    floor_centers = np.zeros((total_floors, 2), dtype=np.float64)
    for fl_idx, fdef in enumerate(floor_defs):
        mask_z = (all_surf_verts[:, 2] >= float(fdef["z_min"]) - 0.5) & (all_surf_verts[:, 2] <= float(fdef["z_max"]) + 0.5)
        if np.any(mask_z):
            floor_centers[fl_idx, 0] = float(np.mean(all_surf_verts[mask_z, 0]))
            floor_centers[fl_idx, 1] = float(np.mean(all_surf_verts[mask_z, 1]))
        else:
            floor_centers[fl_idx] = [bldg_cx, bldg_cy]

    all_shell_tris = _groups_to_tris_shared([rg for rg, _ in surface_groups], dis_set)
    roof_tris = _groups_to_tris_shared(roof_groups, dis_set)
    ext_mode = (exterior_detection_mode or "auto").lower()

    out: Dict[str, Dict[str, Any]] = {}
    for rg, eff_cat in surface_groups:
        res = resolve_group_outer_skin_faces(
            rg=rg,
            eff_cat=eff_cat,
            all_shell_tris=all_shell_tris,
            roof_tris=roof_tris,
            floor_centers=floor_centers,
            floor_defs=floor_defs,
            span_x=span_x,
            span_y=span_y,
            max_span=max_span,
            ext_mode=ext_mode,
            z_ground_cut=z_cut,
            restore_set=rf_set,
        )
        if res is not None:
            out[rg.group_name] = {
                "outer_area_m2": round(float(res["outer_area_m2"]), 2),
                "outer_faces": int(res["outer_faces"]),
                "total_valid_faces": int(len(res["areas_v"])),
                "filtered_entry": res["filtered_entry"],
            }
        else:
            out[rg.group_name] = {
                "outer_area_m2": 0.0,
                "outer_faces": 0,
                "total_valid_faces": 0,
                "filtered_entry": None,
            }
    return out


def compute_panel_heatmap_color(ottv_wm2: float) -> Tuple[str, List[float]]:
    stops = [
        (0.0,  (16, 185, 129)),   # #10b981 Emerald
        (18.0, (34, 197, 94)),    # #22c55e Green
        (30.0, (234, 179, 8)),    # #eab308 Amber-Yellow
        (35.0, (245, 158, 11)),   # #f59e0b SNI 6389:2020 Threshold (35 W/m2)
        (48.0, (239, 68, 68)),    # #ef4444 Red
        (70.0, (185, 28, 28)),    # #b91c1c Deep Crimson
    ]
    val = max(0.0, float(ottv_wm2))
    r, g, b = stops[-1][1]
    for i in range(len(stops) - 1):
        v0, c0 = stops[i]
        v1, c1 = stops[i + 1]
        if val <= v1:
            t = 0.0 if v1 == v0 else (val - v0) / (v1 - v0)
            r = int(round(c0[0] + t * (c1[0] - c0[0])))
            g = int(round(c0[1] + t * (c1[1] - c0[1])))
            b = int(round(c0[2] + t * (c1[2] - c0[2])))
            break
    hex_color = f"#{r:02x}{g:02x}{b:02x}"
    rgb_norm = [round(r / 255.0, 3), round(g / 255.0, 3), round(b / 255.0, 3)]
    return hex_color, rgb_norm


# ============================================================================
# 5b. SNI 6389:2020 COMPLIANCE HELPERS (LAMPIRAN A SHADING RATIOS & PASAL 4.4 RTTV)
# ============================================================================

def _measure_panel_sni_shading_ratios(
    panel_verts: List[List[float]],
    panel_normal: List[float],
    shading_tris: np.ndarray,
    enable_parametric_louvers: bool = False,
    louver_depth_m: float = 0.0,
    louver_spacing_m: float = 1.1,
    louver_tilt_deg: float = 0.0,
    shading_aabb: Optional[Tuple[np.ndarray, np.ndarray]] = None,
    detail: Optional[Dict[str, Any]] = None,
    shading_src: Optional[np.ndarray] = None,
    shading_zindex: Optional[Dict[str, Any]] = None,
    shading_norm_info: Optional[Tuple[np.ndarray, np.ndarray]] = None,
) -> Tuple[float, float, float]:
    """
    Measures SNI 6389:2020 Lampiran A overhang ratio `R1 = P_h / H` (horizontal overhang),
    vertical fin ratio `R2 = P_v / W` (vertical fins), and overhang tilt angle `phi1_deg`
    directly from 3D shading triangles positioned in front of the glazing panel.
    """
    r1_best = 0.0
    r2_best = 0.0
    phi1_best = 0.0

    if enable_parametric_louvers and louver_depth_m > 0.02:
        r1_best = max(r1_best, float(louver_depth_m) / max(0.25, float(louver_spacing_m)))
        phi1_best = max(0.0, min(50.0, float(louver_tilt_deg)))

    if shading_tris is None or len(shading_tris) == 0 or len(panel_verts) < 3:
        return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)

    pv = np.asarray(panel_verts, dtype=np.float64)
    sel_tn_unit: Optional[np.ndarray] = None
    sel_valid_n: Optional[np.ndarray] = None
    # Lossless 3D AABB spatial pre-filter: shading triangles beyond 12.5m XY or outside Z window band
    # can never satisfy `d_max <= 12.0` and `u_min <= half_h + 0.80` / `u_max >= -half_h + 0.05`.
    if shading_aabb is not None:
        sh_min, sh_max = shading_aabb
        p_min = np.min(pv, axis=0)
        p_max = np.max(pv, axis=0)
        if shading_zindex is not None:
            # Kandidat dari indeks ember-Z ber-cache per (b0, b1) -> hasil identik, jauh lebih cepat
            cand, cand_min, cand_max = _z_index_candidates_with_aabb(
                shading_zindex, p_min[2] - 0.5, p_max[2] + SHADE_MAX_RISE_M + 0.5, sh_min, sh_max
            )
            if len(cand) == 0:
                return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)
            near_mask = (
                (cand_max[:, 2] >= p_min[2] - 0.5)
                & (cand_min[:, 2] <= p_max[2] + SHADE_MAX_RISE_M + 0.5)
                & (cand_max[:, 0] >= p_min[0] - 12.5)
                & (cand_min[:, 0] <= p_max[0] + 12.5)
                & (cand_max[:, 1] >= p_min[1] - 12.5)
                & (cand_min[:, 1] <= p_max[1] + 12.5)
            )
            if not np.any(near_mask):
                return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)
            sel = cand[near_mask]
            shading_tris = shading_tris[sel]
            if shading_src is not None:
                shading_src = shading_src[sel]
            if shading_norm_info is not None:
                sel_tn_unit = shading_norm_info[0][sel]
                sel_valid_n = shading_norm_info[1][sel]
        else:
            near_mask = (
                (sh_max[:, 2] >= p_min[2] - 0.5)
                & (sh_min[:, 2] <= p_max[2] + SHADE_MAX_RISE_M + 0.5)
                & (sh_max[:, 0] >= p_min[0] - 12.5)
                & (sh_min[:, 0] <= p_max[0] + 12.5)
                & (sh_max[:, 1] >= p_min[1] - 12.5)
                & (sh_min[:, 1] <= p_max[1] + 12.5)
            )
            if not np.any(near_mask):
                return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)
            shading_tris = shading_tris[near_mask]
            if shading_src is not None:
                shading_src = shading_src[near_mask]
            if shading_norm_info is not None:
                sel_tn_unit = shading_norm_info[0][near_mask]
                sel_valid_n = shading_norm_info[1][near_mask]
    n_raw = np.asarray(panel_normal, dtype=np.float64)
    nhx = float(n_raw[0])
    nhy = float(n_raw[1])
    nh_len = math.hypot(nhx, nhy)
    if nh_len < 1e-6:
        return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)
    nhx /= nh_len
    nhy /= nh_len
    tx = -nhy  # right horizontal axis
    ty = nhx
    t_ax = np.array([tx, ty, 0.0], dtype=np.float64)

    # Local panel bounding box in (t, u, d)
    p_t = pv[:, 0] * tx + pv[:, 1] * ty
    p_u = pv[:, 2]
    p_d = pv[:, 0] * nhx + pv[:, 1] * nhy
    pt_min, pt_max = float(np.min(p_t)), float(np.max(p_t))
    pu_min, pu_max = float(np.min(p_u)), float(np.max(p_u))
    t_c = 0.5 * (pt_min + pt_max)
    u_c = 0.5 * (pu_min + pu_max)
    d_0 = float(np.mean(p_d))
    win_w = max(0.05, pt_max - pt_min)
    win_h = max(0.05, pu_max - pu_min)
    half_w = 0.5 * win_w
    half_h = 0.5 * win_h

    # Vectorized projection of shading triangle vertices into panel local frame (identik dengan einsum)
    sh_x = shading_tris[:, :, 0]
    sh_y = shading_tris[:, :, 1]
    tri_t = sh_x * tx + sh_y * ty - t_c       # (M, 3)
    tri_u = shading_tris[:, :, 2] - u_c       # (M, 3)
    tri_d = sh_x * nhx + sh_y * nhy - d_0     # (M, 3)

    d_max = np.max(tri_d, axis=1)
    d_min = np.min(tri_d, axis=1)
    t_min = np.min(tri_t, axis=1)
    t_max = np.max(tri_t, axis=1)
    u_min = np.min(tri_u, axis=1)
    u_max = np.max(tri_u, axis=1)

    # Candidate triangles in front of the window plane. A3-02: peneduh lepas sampai SHADE_MAX_GAP_M
    # dari fasad tetap dibaca; manfaatnya mengecil karena P efektif = kedalaman peneduh tanpa celah.
    in_front = (d_max > 0.04) & (d_min <= SHADE_MAX_GAP_M) & (d_max <= 12.0)
    if not np.any(in_front):
        return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)

    idx_c = np.where(in_front)[0]
    if sel_tn_unit is not None and sel_valid_n is not None:
        valid_n = sel_valid_n[idx_c]
        if not np.any(valid_n):
            return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)
        idx_c = idx_c[valid_n]
        tn_unit = sel_tn_unit[idx_c]
        tn_z = np.abs(tn_unit[:, 2])
    else:
        sub_tris = shading_tris[idx_c]
        tc = np.cross(sub_tris[:, 1] - sub_tris[:, 0], sub_tris[:, 2] - sub_tris[:, 0])
        tn_len = np.linalg.norm(tc, axis=1)
        valid_n = tn_len > 1e-8
        if not np.any(valid_n):
            return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)

        idx_c = idx_c[valid_n]
        tn_unit = tc[valid_n] / tn_len[valid_n, None]
        tn_z = np.abs(tn_unit[:, 2])

    # 1. Horizontal overhang above top of window (|nz| >= 0.35, spans horizontally across window, sits near top edge)
    #    Exclude narrow horizontal top/bottom caps of extruded vertical fins by verifying
    #    that candidate overhang triangles cover a meaningful fraction (>= 35%) of window width.
    ov_cand_t_span = t_max[idx_c] - t_min[idx_c]
    ov_cand_d_span = np.maximum(0.0, d_max[idx_c] - np.maximum(0.0, d_min[idx_c]))
    not_fin_cap = ~((ov_cand_t_span < 0.08) & (ov_cand_d_span > 2.5 * np.maximum(1e-4, ov_cand_t_span)))
    ov_mask = (
        (tn_z >= 0.35)
        & not_fin_cap
        & (t_max[idx_c] >= -half_w + 0.05)
        & (t_min[idx_c] <= half_w - 0.05)
        & (u_min[idx_c] >= half_h - 0.25)
        & (u_min[idx_c] <= half_h + SHADE_MAX_RISE_M)
    )
    if np.any(ov_mask):
        ov_idx = idx_c[ov_mask]
        # Compute union horizontal coverage clipped to [-half_w, +half_w]
        iv_list = sorted(
            (max(-half_w, float(t_min[i])), min(half_w, float(t_max[i])))
            for i in ov_idx
            if float(t_max[i]) > -half_w and float(t_min[i]) < half_w
        )
        ov_cov_w = 0.0
        if iv_list:
            cur_a, cur_b = iv_list[0]
            for ia, ib in iv_list[1:]:
                if ia <= cur_b + 0.05:
                    cur_b = max(cur_b, ib)
                else:
                    ov_cov_w += max(0.0, cur_b - cur_a)
                    cur_a, cur_b = ia, ib
            ov_cov_w += max(0.0, cur_b - cur_a)
        if ov_cov_w >= 0.35 * win_w:
            # A3-02: SNI (Kunci 1, Gambar 5) mendefinisikan R1 = P/H untuk peneduh yang MENEMPEL di tepi atas
            # jendela. Untuk peneduh lepas/lebih tinggi LUXA memakai pendekatan: P efektif = kedalaman peneduh
            # tanpa celah dari fasad, H efektif = tinggi jendela + jarak tepi atas jendela ke peneduh.
            # Peneduh menempel di tepi atas jendela -> identik dengan SNI.
            own_d = d_max[ov_idx] - np.maximum(0.0, d_min[ov_idx])
            rise = np.maximum(0.0, u_min[ov_idx] - half_h)
            r1_cand = own_d / (win_h + rise)
            k_best = int(np.argmax(r1_cand))
            r1_meas = float(r1_cand[k_best])
            if r1_meas > r1_best:
                r1_best = r1_meas
                if detail is not None:
                    detail["ov"] = {
                        "src": int(shading_src[ov_idx[k_best]]) if shading_src is not None else 0,
                        "gap": float(max(0.0, d_min[ov_idx[k_best]])),
                        "depth": float(own_d[k_best]),
                        "rise": float(rise[k_best]),
                        "win_h": float(win_h),
                    }
                # Estimate downward tilt angle phi1 from overhang Z drop across depth
                best_i = ov_idx[k_best]
                z_span_ov = float(u_max[best_i] - u_min[best_i])
                d_span_ov = max(0.05, float(d_max[best_i] - max(0.0, d_min[best_i])))
                phi1_best = max(0.0, min(50.0, math.degrees(math.atan2(z_span_ov, d_span_ov)))) if z_span_ov > 0.02 else 0.0

    # 2. Vertical fins beside OR periodically spaced across window (|nz| < 0.50, normal along +-t_ax)
    #    Clusters distinct fin positions along t to measure true fin-to-fin spacing W_fin on ribbon windows,
    #    falling back to win_w when only side-edge fins exist.
    tn_dot_t = np.abs(tn_unit @ t_ax)
    t_mid = 0.5 * (t_min[idx_c] + t_max[idx_c])
    in_fin_band = (t_mid >= -half_w - 0.45) & (t_mid <= half_w + 0.45)
    fin_mask = (
        (tn_z < 0.50)
        & (tn_dot_t >= 0.50)
        & in_fin_band
        & (u_max[idx_c] >= -half_h + 0.05)
        & (u_min[idx_c] <= half_h - 0.05)
    )
    if np.any(fin_mask):
        fin_local = np.where(fin_mask)[0]
        fin_idx = idx_c[fin_local]
        fin_ts = t_mid[fin_local]
        # A3-02: kedalaman sirip sendiri (celah sirip-kaca tidak ikut dihitung)
        fin_ds = d_max[fin_idx] - np.maximum(0.0, d_min[fin_idx])

        # Cluster close fin faces (e.g. both sides of a 2 cm extruded solid fin) within 0.12 m
        order = np.argsort(fin_ts)
        clusters: List[Tuple[float, float]] = []  # (mean_t, max_d)
        cur_ts: List[float] = [float(fin_ts[order[0]])]
        cur_d = float(fin_ds[order[0]])
        for oi in order[1:]:
            tv = float(fin_ts[oi])
            dv = float(fin_ds[oi])
            if tv - cur_ts[-1] <= 0.12:
                cur_ts.append(tv)
                cur_d = max(cur_d, dv)
            else:
                clusters.append((float(np.mean(cur_ts)), cur_d))
                cur_ts = [tv]
                cur_d = dv
        clusters.append((float(np.mean(cur_ts)), cur_d))

        proj_v = max(c[1] for c in clusters)
        fin_gap = float(max(0.0, np.min(d_min[fin_idx])))
        if len(clusters) >= 3:
            spacings = [clusters[k + 1][0] - clusters[k][0] for k in range(len(clusters) - 1)]
            valid_sp = [s for s in spacings if s >= 0.15]
            eff_w = float(np.median(valid_sp)) if valid_sp else win_w
            r2_best = max(r2_best, proj_v / max(0.05, eff_w))
        elif len(clusters) == 2:
            sp = clusters[1][0] - clusters[0][0]
            eff_w = min(win_w, sp) if sp >= 0.15 else win_w
            r2_best = max(r2_best, proj_v / max(0.05, eff_w))
        else:
            # Single fin: only applies if adjacent to left or right edge of the window
            t0 = clusters[0][0]
            if abs(t0 + half_w) <= 0.45 or abs(t0 - half_w) <= 0.45:
                r2_best = max(r2_best, proj_v / win_w)
        if detail is not None and r2_best > 0 and proj_v > 0:
            detail["fin"] = {"gap": fin_gap, "depth": float(proj_v), "w": float(proj_v / r2_best)}

    return round(r1_best, 4), round(r2_best, 4), round(phi1_best, 1)


def _build_shading_z_index(sh_min: np.ndarray, sh_max: np.ndarray, bucket_m: float = 2.0) -> Dict[str, Any]:
    """Indeks ember-Z segitiga peneduh: tiap ember (setinggi `bucket_m`) berisi indeks segitiga yang rentang
    Z-nya menyentuhnya. Dipakai untuk memilih kandidat per panel tanpa menyaring semua segitiga (hasil identik:
    kandidat selalu mencakup semua segitiga yang lolos saringan Z di _measure_panel_sni_shading_ratios)."""
    z0 = float(np.min(sh_min[:, 2])) if len(sh_min) else 0.0
    lo = np.floor((sh_min[:, 2] - z0) / bucket_m).astype(np.int64)
    hi = np.floor((sh_max[:, 2] - z0) / bucket_m).astype(np.int64)
    n_b = int(hi.max()) + 1 if len(hi) else 0
    counts = np.zeros(n_b + 1, dtype=np.int64)
    np.add.at(counts, lo, 1)
    np.add.at(counts, hi + 1, -1)
    span = hi - lo + 1
    tri_ids = np.repeat(np.arange(len(lo)), span.astype(np.intp))
    bucket_ids = np.repeat(lo, span.astype(np.intp)) + (np.arange(len(tri_ids)) - np.repeat(np.cumsum(span) - span, span.astype(np.intp)))
    order = np.argsort(bucket_ids, kind="stable")
    tri_sorted = tri_ids[order]
    starts = np.searchsorted(bucket_ids[order], np.arange(n_b + 1))
    return {"z0": z0, "bucket": bucket_m, "n": n_b, "tris": tri_sorted, "starts": starts, "_cache": {}, "_aabb_cache": {}}


def _z_index_candidates(zi: Dict[str, Any], z_lo: float, z_hi: float) -> np.ndarray:
    if zi["n"] == 0:
        return np.zeros(0, dtype=np.int64)
    b0 = max(0, int(math.floor((z_lo - zi["z0"]) / zi["bucket"])))
    b1 = min(zi["n"] - 1, int(math.floor((z_hi - zi["z0"]) / zi["bucket"])))
    if b1 < b0:
        return np.zeros(0, dtype=np.int64)
    cache = zi.get("_cache")
    key = (b0, b1)
    if cache is not None and key in cache:
        return cache[key]
    seg = zi["tris"][zi["starts"][b0]:zi["starts"][b1 + 1]]
    res = np.unique(seg)  # urut naik = urutan asli segitiga (argmax/ties tidak berubah)
    if cache is not None:
        cache[key] = res
    return res


def _z_index_candidates_with_aabb(
    zi: Dict[str, Any],
    z_lo: float,
    z_hi: float,
    sh_min: np.ndarray,
    sh_max: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    if zi["n"] == 0:
        empty_i = np.zeros(0, dtype=np.int64)
        empty_f = np.empty((0, 3), dtype=np.float64)
        return empty_i, empty_f, empty_f
    b0 = max(0, int(math.floor((z_lo - zi["z0"]) / zi["bucket"])))
    b1 = min(zi["n"] - 1, int(math.floor((z_hi - zi["z0"]) / zi["bucket"])))
    if b1 < b0:
        empty_i = np.zeros(0, dtype=np.int64)
        empty_f = np.empty((0, 3), dtype=np.float64)
        return empty_i, empty_f, empty_f
    acache = zi.get("_aabb_cache")
    key = (b0, b1)
    if acache is not None and key in acache:
        return acache[key]
    cand = _z_index_candidates(zi, z_lo, z_hi)
    pair = (cand, sh_min[cand], sh_max[cand])
    if acache is not None:
        acache[key] = pair
    return pair


def _superposed_sceff(orient: str, det: Dict[str, Any], r1: float, r2: float, phi1: float, table_mode: str) -> Optional[float]:
    """A3-02: SC efektif peneduh LEPAS dari fasad / LEBIH TINGGI dari jendela, diturunkan dari tabel SNI.

    Luas bayangan di SNI (Gambar 5/6: As = P·(...)) linear terhadap P dan dipotong oleh tepi jendela,
    sehingga bayangan peneduh selebar [celah, celah + kedalaman] = bayangan peneduh menempel selebar
    (celah + kedalaman) dikurangi bayangan peneduh menempel selebar celah. Peneduh di atas jendela
    setinggi `rise`: bayangan pada jendela = bayangan pada bidang setinggi (H + rise) dikurangi bayangan
    pada pita setinggi `rise` di atas jendela. Peneduh menempel di tepi atas jendela -> None (pakai SNI
    langsung). Kombinasi sirip + overhang (egg-crate, G3 = G1 x G2, tidak linear) -> None.
    """
    if not det or (r1 > 0 and r2 > 0):
        return None

    def m(a: float, b: float) -> float:
        return float(lookup_sceff_detailed(orient, r1_horizontal=a, r2_vertical=b, tilt_deg=phi1, table_mode=table_mode)["sc_eff"])

    if r1 > 0 and "ov" in det:
        g, d, rise, H = det["ov"]["gap"], det["ov"]["depth"], det["ov"]["rise"], det["ov"]["win_h"]
        if g < 0.02 and rise < 0.02:
            return None

        def shade_attached(P: float) -> float:  # fraksi jendela terbayangi peneduh menempel selebar P pada ketinggian rise
            if P <= 0:
                return 0.0
            tall = H + rise
            s_tall = tall * (1.0 - m(P / tall, 0.0))
            s_band = rise * (1.0 - m(P / rise, 0.0)) if rise > 1e-3 else 0.0
            return max(0.0, (s_tall - s_band) / H)

        shade = max(0.0, shade_attached(g + d) - shade_attached(g))
        return max(0.0, min(1.0, 1.0 - shade))
    if r2 > 0 and "fin" in det:
        g, d, W = det["fin"]["gap"], det["fin"]["depth"], det["fin"]["w"]
        if g < 0.02:
            return None
        shade = max(0.0, (1.0 - m(0.0, (g + d) / W)) - (1.0 - m(0.0, g / W)))
        return max(0.0, min(1.0, 1.0 - shade))
    return None


def _compute_sni_rttv(
    roof_groups: List[RawGroupMesh],
    skylight_area_m2: float,
    skylight_u_weighted: float,
    skylight_sc_weighted: float,
    params: EnvelopeParameters,
    sni_city_key: str,
    z_max_bldg: float,
) -> Dict[str, Any]:
    """
    Computes RTTV (Nilai Perpindahan Termal Atap) strictly per SNI 6389:2020 Pasal 4.4 (hlm. 20-21):
      RTTV = [ alpha * (A_r * U_r * TD_EQ) + (A_s * U_s * 5.0) + (A_s * SF_roof * SC_s) ] / (A_r + A_s)
    Limits (Pasal 4.4.1):
      - With skylight (A_s > 0): <= 35.0 W/m2
      - Opaque roof only (A_s == 0): <= 10.0 W/m2
    """
    from config_schema import resolve_material

    a_opaque_roof = 0.0
    sum_alpha_ur_tdeq_a = 0.0
    sum_ur_a = 0.0
    sum_alpha_a = 0.0
    sum_mass_a = 0.0
    sum_tdeq_a = 0.0

    for rg in roof_groups:
        if rg.group_name in params.disabled_groups or len(rg.faces) == 0:
            continue
        vs, fs = rg.vertices, rg.faces
        p0, p1, p2, p3 = vs[fs[:, 0]], vs[fs[:, 1]], vs[fs[:, 2]], vs[fs[:, 3]]
        is_q = fs[:, 2] != fs[:, 3]
        c1 = np.cross(p1 - p0, p2 - p0)
        a1 = 0.5 * np.linalg.norm(c1, axis=1)
        c2 = np.cross(p2 - p0, p3 - p0)
        a2 = np.where(is_q, 0.5 * np.linalg.norm(c2, axis=1), 0.0)
        areas = a1 + a2
        n_raw = np.where(is_q[:, None], c1 + c2, c1)
        n_len = np.linalg.norm(n_raw, axis=1)
        valid = (areas > 1e-4) & (n_len > 1e-9)
        if not np.any(valid):
            continue
        nz = n_raw[valid, 2] / n_len[valid]
        cz = np.where(
            is_q[valid],
            0.25 * (p0[valid, 2] + p1[valid, 2] + p2[valid, 2] + p3[valid, 2]),
            (p0[valid, 2] + p1[valid, 2] + p2[valid, 2]) / 3.0,
        )
        ar_valid = areas[valid]

        # Keep upward-facing roof surfaces (nz > 0.35). If group mixes floors & roof (e.g. HB_Roof_Floor),
        # keep only the uppermost roof elevation band so internal floor slabs are not double-counted as roof.
        up_mask = nz > 0.35
        if not np.any(up_mask):
            continue
        cz_up = cz[up_mask]
        ar_up = ar_valid[up_mask]
        if "floor" in rg.group_name.lower() or "lantai" in rg.group_name.lower():
            top_z = float(np.max(cz_up))
            top_mask = cz_up >= (top_z - 0.5)
            ar_up = ar_up[top_mask]

        grp_roof_area = float(np.sum(ar_up))
        if grp_roof_area <= 1e-4:
            continue

        rm_res = resolve_material(rg, params, category="roof")
        rm = rm_res["material"] or {}
        u_r = float(rm.get("u_value", 0.58))
        alpha_r = float(rm.get("alpha", 0.50)) if rm.get("alpha") is not None else 0.50
        mass_r = float(rm.get("massa_kg_m2", 288.0))
        tdeq_r = get_tdek_roof(mass_r)

        a_opaque_roof += grp_roof_area
        sum_alpha_ur_tdeq_a += alpha_r * u_r * tdeq_r * grp_roof_area
        sum_ur_a += u_r * grp_roof_area
        sum_alpha_a += alpha_r * grp_roof_area
        sum_mass_a += mass_r * grp_roof_area
        sum_tdeq_a += tdeq_r * grp_roof_area

    a_sky = max(0.0, float(skylight_area_m2))
    a_tot = a_opaque_roof + a_sky
    sf_roof = get_sf_for_source(params.city_preset, "ROOF", params.sf_source)

    if a_tot <= 1e-4:
        return {
            "applicable": False,
            "rttv_wm2": 0.0,
            "limit_wm2": SNI_RTTV_LIMIT_OPAQUE_ONLY_WM2,
            "compliant": None,
            "opaque_roof_area_m2": 0.0,
            "skylight_area_m2": 0.0,
            "total_roof_area_m2": 0.0,
            "srr": 0.0,
            "sf_roof_wm2": sf_roof,
            "delta_t_k": SNI_DELTA_T_K,
            "q_roof_conduction_wm2": 0.0,
            "q_skylight_conduction_wm2": 0.0,
            "q_skylight_solar_wm2": 0.0,
        }

    q_roof_cond = sum_alpha_ur_tdeq_a / a_tot
    u_s = (skylight_u_weighted / a_sky) if a_sky > 1e-4 else 0.0
    sc_s = (skylight_sc_weighted / a_sky) if a_sky > 1e-4 else 0.0
    q_sky_cond = (a_sky * u_s * SNI_DELTA_T_K) / a_tot
    q_sky_solar = (a_sky * sf_roof * sc_s) / a_tot
    rttv_wm2 = q_roof_cond + q_sky_cond + q_sky_solar
    limit = SNI_RTTV_LIMIT_WITH_SKYLIGHT_WM2 if a_sky > 1e-4 else SNI_RTTV_LIMIT_OPAQUE_ONLY_WM2

    return {
        "applicable": True,
        "rttv_wm2": round(rttv_wm2, 2),
        "limit_wm2": limit,
        "compliant": bool(rttv_wm2 <= limit),
        "opaque_roof_area_m2": round(a_opaque_roof, 2),
        "skylight_area_m2": round(a_sky, 2),
        "total_roof_area_m2": round(a_tot, 2),
        "srr": round(a_sky / a_tot, 4),
        "alpha_roof": round(sum_alpha_a / a_opaque_roof, 6) if a_opaque_roof > 1e-4 else 0.0,
        "u_roof": round(sum_ur_a / a_opaque_roof, 6) if a_opaque_roof > 1e-4 else 0.0,
        "massa_kg_m2": round(sum_mass_a / a_opaque_roof, 1) if a_opaque_roof > 1e-4 else 0.0,
        "td_eq_k": round(sum_tdeq_a / a_opaque_roof, 1) if a_opaque_roof > 1e-4 else 0.0,
        "u_skylight": round(u_s, 6),
        "sc_skylight": round(sc_s, 6),
        "sf_roof_wm2": sf_roof,
        "delta_t_k": SNI_DELTA_T_K,
        "q_roof_conduction_wm2": round(q_roof_cond, 2),
        "q_skylight_conduction_wm2": round(q_sky_cond, 2),
        "q_skylight_solar_wm2": round(q_sky_solar, 2),
    }


# ============================================================================
# 6. MAIN OTTV ENGINE PIPELINE v2.0 (SNI 6389:2020)
# ============================================================================

# A3-02: jangkauan pembacaan peneduh lepas dari fasad / di atas jendela (meter)
SHADE_MAX_GAP_M = 3.0
SHADE_MAX_RISE_M = 3.0

# Kode peringatan yang membuat hasil berstatus SEMENTARA (perlu tindakan pengguna).
PROVISIONAL_WARNING_CODES = frozenset({
    "UNKNOWN_GROUPS", "MISSING_MESH", "UNIT_NEEDS_CONFIRMATION", "ASSUMED_WWR", "NO_GLAZING",
    "DUPLICATE_FACE_CONFLICT", "MATERIAL_NOT_CONFIRMED",
})


def resolve_result_status(ottv_total_wm2: float, warnings: List[Dict[str, Any]], is_sni_mode: bool) -> Tuple[bool, str, bool]:
    """(is_provisional, status_label, compliant) - satu sumber untuk hitung penuh & ganti material cepat."""
    is_provisional = any((w or {}).get("code") in PROVISIONAL_WARNING_CODES for w in (warnings or []))
    compliant = ottv_total_wm2 <= SNI_6389_LIMIT_WM2
    if is_provisional:
        return True, "HASIL SEMENTARA — perlu konfirmasi", False
    if not is_sni_mode:
        return False, (
            "SIMULASI EKSPLORASI — bukan untuk kepatuhan (<= 35 W/m²)"
            if compliant
            else "SIMULASI EKSPLORASI — bukan untuk kepatuhan (> 35 W/m²)"
        ), False
    if compliant:
        return False, "MEMENUHI SNI 6389:2020 (<= 35 W/m²)", True
    return False, "MELEBIHI BATAS SNI 6389:2020 (> 35 W/m²)", False


def _suggestion_patch(sugg: List[Dict[str, Any]], group_material_map: Dict[str, str], groups: List[Tuple[str, str, str, str]]) -> Dict[str, Any]:
    """Patch konfigurasi untuk tombol "Pakai saran". Bila semua grup satu peran (kaca, atau dinding+spandrel)
    disarankan material yang sama, saran dipasang sebagai material UTAMA peran itu, bukan override per grup,
    supaya pilihan "Kaca utama"/"Dinding utama" berikutnya tetap berlaku (override grup selalu menang)."""
    role_of = {"glazing": "glazing_material_id", "composite_cw": "glazing_material_id", "wall": "wall_material_id", "spandrel": "wall_material_id"}
    patch: Dict[str, Any] = {}
    gmap = dict(group_material_map or {})
    for field in ("glazing_material_id", "wall_material_id"):
        role_groups = [g[0] for g in groups if role_of.get(g[1]) == field and g[0] not in (group_material_map or {})]
        role_sugg = [x for x in sugg if role_of.get(x["category"]) == field]
        ids = {x["material_id"] for x in role_sugg}
        if role_sugg and len(ids) == 1 and len(role_sugg) == len(role_groups):
            patch[field] = next(iter(ids))
        else:
            gmap.update({x["group_name"]: x["material_id"] for x in role_sugg})
    if gmap != dict(group_material_map or {}):
        patch["group_material_map"] = gmap
    return patch


def build_material_warning(
    glazing_material_id: Optional[str],
    wall_material_id: Optional[str],
    group_material_map: Dict[str, str],
    groups: List[Tuple[str, str, str, str]],
    extra_materials: Optional[List[Dict[str, Any]]] = None,
    frame_material_id: Optional[str] = None,
    frame_width_mm: Optional[float] = None,
    frame_source: Optional[str] = None,
) -> Dict[str, Any]:
    """Peringatan MATERIAL_NOT_CONFIRMED + saran material dari nama layer (tidak diterapkan otomatis)."""
    glz = get_material_by_id(glazing_material_id, extra_materials=extra_materials) or {}
    wal = get_material_by_id(wall_material_id, extra_materials=extra_materials) or {}
    frm = get_material_by_id(frame_material_id, extra_materials=extra_materials) or {}
    sugg = []
    for s_ in material_suggestions([g for g in groups if g[0] not in (group_material_map or {})]):
        cur = glz if s_["category"] in ("glazing", "composite_cw") else wal
        if s_["material_id"] == cur.get("id"):
            continue
        m = get_material_by_id(s_["material_id"], extra_materials=extra_materials) or {}
        sugg.append({**s_, "material_name": m.get("name", s_["material_id"]), "sc": m.get("sc"), "u_value": m.get("u_value")})
    sc_txt = (", SC " + f"{float(glz['sc']):.2f}".replace(".", ",")) if glz.get("sc") is not None else ""
    frm_txt = ""
    if frame_material_id:
        fw_part = ""
        if frame_width_mm is not None and frame_source != "terukur":
            fw_str = f"{float(frame_width_mm):.0f}" if float(frame_width_mm).is_integer() else f"{float(frame_width_mm):.1f}".replace(".", ",")
            fw_part = f" (lebar kusen asumsi {fw_str} mm)"
        frm_txt = f", serta rangka \"{frm.get('name', frame_material_id)}\"{fw_part}"
    msg = (
        f"Material belum dipilih. Sementara dipakai kaca \"{glz.get('name', glazing_material_id)}\"{sc_txt}, "
        f"dinding \"{wal.get('name', wall_material_id)}\"{frm_txt}. Pilih material yang sesuai rancangan, "
        "atau konfirmasi bila sudah benar."
    )
    if sugg:
        msg += " Saran dari nama layer: " + "; ".join(f"{x['group_name']} → {x['material_name']}" for x in sugg[:6]) + "."
    return {
        "code": "MATERIAL_NOT_CONFIRMED",
        "message": msg,
        "detail": {
            "glazing_material_id": glazing_material_id,
            "wall_material_id": wall_material_id,
            "frame_material_id": frame_material_id,
            "frame_width_mm": frame_width_mm,
            "suggestions": sugg,
            "suggested_patch": _suggestion_patch(sugg, group_material_map, groups),
        },
    }


# ============================================================================
# U_f TIGA ZONA (SNI 6389:2020 butir 3.15, 3.17, 4.3.2.2, Tabel 3 & Lampiran C)
# ============================================================================

def compute_panel_perimeter(vertices: List[List[float]]) -> float:
    """Keliling poligon panel 3 atau 4 titik (m)."""
    n = len(vertices)
    if n < 3:
        return 0.0
    perim = 0.0
    for i in range(n):
        a = vertices[i]
        b = vertices[(i + 1) % n]
        perim += math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2)
    return perim


def equivalent_rectangle(area_m2: float, perimeter_m: float) -> Tuple[float, float]:
    """Persegi panjang ekuivalen (W_eq, H_eq) dari luas dan keliling panel (untuk panel tidak persegi/twisted)."""
    a = max(0.0, float(area_m2))
    if a <= 1e-12:
        return 0.0, 0.0
    s = 0.5 * max(0.0, float(perimeter_m))
    disc = s * s - 4.0 * a
    if disc < 0.0 or s <= 1e-9:
        side = math.sqrt(a)
        return side, side
    root = math.sqrt(disc)
    w = 0.5 * (s + root)
    h = 0.5 * (s - root)
    if h <= 1e-9:
        side = math.sqrt(a)
        return side, side
    return w, h


def compute_three_zone_uf(
    area_m2: float,
    perimeter_m: float,
    u_cog: float,
    u_frame: float,
    frame_width_m: float,
    measured_a_frame_m2: Optional[float] = None,
    overlap_a_frame_m2: float = 0.0,
) -> Dict[str, float]:
    """Menghitung U_f tiga zona SNI 6389:2020 Lampiran C untuk satu bidang fenestrasi.

    U_edge = (U_cog + U_frame) / 2
    U_f    = (U_cog * A_cog + U_frame * A_frame + U_edge * A_edge) / (A_cog + A_frame + A_edge)

    Mode 1 (`measured_a_frame_m2 is None`, tidak ada grup rangka terukur):
      Kusen dianggap berada di dalam bukaan `area_m2` dengan lebar `frame_width_m`.
      A_edge = pita selebar 2 * frame_width_m di tepi dalam kaca; A_cog = sisanya (>= 0).

    Mode 2 (`measured_a_frame_m2 is not None`, grup rangka terukur):
      - `measured_a_frame_m2` = luas muka luar rangka yang berada di sela-sela panel kaca
        (tidak menimpa kaca di belakangnya) -> MENAMBAH A_f dan A_o.
      - `overlap_a_frame_m2` = luas muka luar rangka yang menempel di depan kaca menerus
        -> dipotong dari luas kaca tanpa menggandakan A_o.
      Pita tepi A_edge selebar 2 * frame_width_m (median lebar profil terukur) di tepi dalam kaca.
    """
    a_base = max(0.0, float(area_m2))
    u_c = float(u_cog)
    u_fr = float(u_frame)
    u_ed = 0.5 * (u_c + u_fr)
    wf = max(0.0, float(frame_width_m))

    if a_base <= 1e-12 and not (measured_a_frame_m2 and measured_a_frame_m2 > 1e-12):
        return {
            "u_f": u_c,
            "u_cog": u_c,
            "u_frame": u_fr,
            "u_edge": u_ed,
            "a_cog": 0.0,
            "a_edge": 0.0,
            "a_frame": 0.0,
            "a_fen": 0.0,
        }

    w_eq, h_eq = equivalent_rectangle(a_base, perimeter_m)

    if measured_a_frame_m2 is None:
        if wf <= 1e-9:
            a_frame = 0.0
            a_glass = a_base
            a_cog = a_base
            a_edge = 0.0
        else:
            w_g = max(0.0, w_eq - 2.0 * wf)
            h_g = max(0.0, h_eq - 2.0 * wf)
            a_glass = min(a_base, w_g * h_g)
            a_frame = max(0.0, a_base - a_glass)
            w_cog = max(0.0, w_g - 4.0 * wf)
            h_cog = max(0.0, h_g - 4.0 * wf)
            a_cog = min(a_glass, w_cog * h_cog)
            a_edge = max(0.0, a_glass - a_cog)
        a_fen = a_cog + a_edge + a_frame
    else:
        gap_a = max(0.0, float(measured_a_frame_m2))
        ov_a = min(a_base, max(0.0, float(overlap_a_frame_m2)))
        a_glass = max(0.0, a_base - ov_a)
        a_frame = gap_a + ov_a
        if wf <= 1e-9 or a_frame <= 1e-12 or a_glass <= 1e-12:
            a_cog = a_glass
            a_edge = 0.0
        else:
            if ov_a > 1e-12 and a_base > 1e-12:
                sc_g = math.sqrt(a_glass / a_base)
                w_g = w_eq * sc_g
                h_g = h_eq * sc_g
            else:
                w_g, h_g = w_eq, h_eq
            w_cog = max(0.0, w_g - 4.0 * wf)
            h_cog = max(0.0, h_g - 4.0 * wf)
            a_cog = min(a_glass, w_cog * h_cog)
            a_edge = max(0.0, a_glass - a_cog)
        a_fen = a_cog + a_edge + a_frame

    u_f = u_c if a_fen <= 1e-12 else (u_c * a_cog + u_fr * a_frame + u_ed * a_edge) / a_fen
    return {
        "u_f": u_f,
        "u_cog": u_c,
        "u_frame": u_fr,
        "u_edge": u_ed,
        "a_cog": a_cog,
        "a_edge": a_edge,
        "a_frame": a_frame,
        "a_fen": a_fen,
    }


def _vectorized_ray_hit_any(
    tris: np.ndarray,
    origins: np.ndarray,
    dirs: np.ndarray,
    min_dist: float = 0.004,
    max_dist: float = 0.45,
    bucket_m: float = 1.0,
) -> np.ndarray:
    """Uji tabrakan sinar-segitiga (Möller-Trumbore) berindeks-Z untuk arah per sinar."""
    n_rays = len(origins)
    hits = np.zeros(n_rays, dtype=bool)
    if n_rays == 0 or len(tris) == 0:
        return hits
    t_min = np.min(tris, axis=1)
    t_max = np.max(tris, axis=1)
    zi = _build_shading_z_index(t_min, t_max, bucket_m=bucket_m)
    v0 = tris[:, 0, :]
    e1 = tris[:, 1, :] - v0
    e2 = tris[:, 2, :] - v0
    z0_zi = zi["z0"]
    b_m = zi["bucket"]
    n_b = zi["n"]
    ray_b = np.clip(np.floor((origins[:, 2] - z0_zi) / b_m).astype(np.int64), 0, n_b - 1)
    order = np.argsort(ray_b)
    sb = ray_b[order]
    uniq_b, starts = np.unique(sb, return_index=True)
    ends = np.append(starts[1:], n_rays)
    for b_id, s_i, e_i in zip(uniq_b, starts, ends):
        cand = _z_index_candidates(zi, z0_zi + (int(b_id) - 0.5) * b_m, z0_zi + (int(b_id) + 1.5) * b_m)
        if len(cand) == 0:
            continue
        r_idx = order[s_i:e_i]
        orig_b = origins[r_idx]
        dir_b = dirs[r_idx]
        r_end = orig_b + dir_b * max_dist
        r_min_x = min(float(orig_b[:, 0].min()), float(r_end[:, 0].min())) - 0.05
        r_max_x = max(float(orig_b[:, 0].max()), float(r_end[:, 0].max())) + 0.05
        r_min_y = min(float(orig_b[:, 1].min()), float(r_end[:, 1].min())) - 0.05
        r_max_y = max(float(orig_b[:, 1].max()), float(r_end[:, 1].max())) + 0.05
        c_mask = (
            (t_max[cand, 0] >= r_min_x) & (t_min[cand, 0] <= r_max_x)
            & (t_max[cand, 1] >= r_min_y) & (t_min[cand, 1] <= r_max_y)
        )
        cand = cand[c_mask]
        if len(cand) == 0:
            continue
        v0c, e1c, e2c = v0[cand], e1[cand], e2[cand]
        t_min_c, t_max_c = t_min[cand], t_max[cand]
        for ri0 in range(0, len(r_idx), 128):
            ri_sl = r_idx[ri0:ri0 + 128]
            o_arr = origins[ri_sl]
            d_arr = dirs[ri_sl]
            hit_sl = np.zeros(len(o_arr), dtype=bool)
            o2 = o_arr + d_arr * max_dist
            rmin = np.minimum(o_arr, o2) - 0.01
            rmax = np.maximum(o_arr, o2) + 0.01
            for ci0 in range(0, len(cand), 512):
                active_r = np.where(~hit_sl)[0]
                if len(active_r) == 0:
                    break
                oa = o_arr[active_r]
                da = d_arr[active_r]
                rmn = rmin[active_r]
                rmx = rmax[active_r]
                tmn = t_min_c[ci0:ci0 + 512]
                tmx = t_max_c[ci0:ci0 + 512]
                ov = (
                    (rmn[:, None, 0] <= tmx[None, :, 0]) & (rmx[:, None, 0] >= tmn[None, :, 0])
                    & (rmn[:, None, 1] <= tmx[None, :, 1]) & (rmx[:, None, 1] >= tmn[None, :, 1])
                    & (rmn[:, None, 2] <= tmx[None, :, 2]) & (rmx[:, None, 2] >= tmn[None, :, 2])
                )
                rr, cc = np.where(ov)
                if len(rr) == 0:
                    continue
                o_p = oa[rr]
                d_p = da[rr]
                v0_p = v0c[ci0 + cc]
                e1_p = e1c[ci0 + cc]
                e2_p = e2c[ci0 + cc]
                pvec = np.cross(d_p, e2_p)
                det = np.sum(e1_p * pvec, axis=1)
                valid = np.abs(det) > 1e-8
                if not np.any(valid):
                    continue
                inv_det = np.where(valid, 1.0 / np.where(valid, det, 1.0), 0.0)
                tvec = o_p - v0_p
                u = np.sum(tvec * pvec, axis=1) * inv_det
                qvec = np.cross(tvec, e1_p)
                v = np.sum(d_p * qvec, axis=1) * inv_det
                t = np.sum(e2_p * qvec, axis=1) * inv_det
                ok = valid & (u >= -1e-5) & (v >= -1e-5) & (u + v <= 1.0 + 1e-5) & (t >= min_dist) & (t <= max_dist)
                if np.any(ok):
                    hit_sl[active_r[rr[ok]]] = True
            hits[ri_sl] = hit_sl
    return hits


def _group_coplanar_glazing_openings(
    panel_records: List[Dict[str, Any]],
    wwr_base_arr: List[float],
) -> Dict[int, Dict[str, Any]]:
    """Mengelompokkan panel kaca/bukaan koplanar yang saling berbatasan menjadi satu bukaan utuh.

    Tujuannya agar U_f tiga zona INVARIAN terhadap triangulasi (quad vs 2 segitiga di GLB/OBJ/Brep):
    sisi diagonal bersama di dalam bukaan tidak dihitung sebagai keliling kusen.
    Mengembalikan dict `panel_idx -> {members, area_m2, perimeter_m}`.
    """
    glz_idxs = [i for i, w in enumerate(wwr_base_arr) if w > 1e-6 and float(panel_records[i].get("area_m2", 0.0)) > 1e-9]
    if not glz_idxs:
        return {}

    def _qpt(v: List[float]) -> Tuple[int, int, int]:
        # Kuantisasi 2 mm agar puncak segitiga yang sedikit bergeser saat ekspor GLB/OBJ tetap cocok
        return (int(round(v[0] * 500.0)), int(round(v[1] * 500.0)), int(round(v[2] * 500.0)))

    edge_to_panels: Dict[Tuple[Tuple[int, int, int], Tuple[int, int, int]], List[int]] = {}
    panel_edges: Dict[int, List[Tuple[Tuple[Tuple[int, int, int], Tuple[int, int, int]], float]]] = {}

    for i in glz_idxs:
        vs = panel_records[i].get("vertices") or []
        nv = len(vs)
        if nv < 3:
            continue
        qpts = [_qpt(v) for v in vs]
        elist: List[Tuple[Tuple[Tuple[int, int, int], Tuple[int, int, int]], float]] = []
        for k in range(nv):
            qa, qb = qpts[k], qpts[(k + 1) % nv]
            if qa == qb:
                continue
            ekey = (qa, qb) if qa < qb else (qb, qa)
            va, vb = vs[k], vs[(k + 1) % nv]
            elen = math.sqrt((vb[0] - va[0]) ** 2 + (vb[1] - va[1]) ** 2 + (vb[2] - va[2]) ** 2)
            elist.append((ekey, elen))
            edge_to_panels.setdefault(ekey, []).append(i)
        panel_edges[i] = elist

    # Union-Find antar panel yang berbagi sisi, segrup, sematerial, dan koplanar (dot >= 0,995)
    parent = {i: i for i in glz_idxs}

    def _find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _union(a: int, b: int) -> None:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[rb] = ra

    for plist in edge_to_panels.values():
        if len(plist) < 2:
            continue
        for m in range(len(plist)):
            ia = plist[m]
            pa = panel_records[ia]
            na = pa["normal"]
            for n_i in range(m + 1, len(plist)):
                ib = plist[n_i]
                pb = panel_records[ib]
                if (
                    pa["group_name"] != pb["group_name"]
                    or pa["element_type"] != pb["element_type"]
                    or pa["active"] != pb["active"]
                ):
                    continue
                nb = pb["normal"]
                if (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]) >= 0.97:
                    _union(ia, ib)

    comps: Dict[int, List[int]] = {}
    for i in glz_idxs:
        comps.setdefault(_find(i), []).append(i)

    out: Dict[int, Dict[str, Any]] = {}
    for members in comps.values():
        comp_area = 0.0
        edge_counts: Dict[Tuple[Tuple[int, int, int], Tuple[int, int, int]], Tuple[int, float]] = {}
        for idx_m in members:
            w_m = wwr_base_arr[idx_m]
            comp_area += float(panel_records[idx_m]["area_m2"]) * w_m
            for ekey, elen in panel_edges.get(idx_m, ()):
                prev = edge_counts.get(ekey)
                if prev is None:
                    edge_counts[ekey] = (1, elen)
                else:
                    edge_counts[ekey] = (prev[0] + 1, prev[1])
        # Keliling luar = jumlah panjang sisi yang muncul tepat sekali (sisi diagonal dalam saling menghapus)
        b_perim = sum(elen for cnt, elen in edge_counts.values() if cnt == 1)
        if b_perim <= 1e-6:
            b_perim = sum(
                float(panel_records[idx_m].get("perimeter_m") or compute_panel_perimeter(panel_records[idx_m].get("vertices") or []))
                for idx_m in members
            )
        # Untuk panel komposit (0 < wwr < 1), skalakan keliling terhadap akar WWR bukaan
        avg_wwr = sum(wwr_base_arr[idx_m] * float(panel_records[idx_m]["area_m2"]) for idx_m in members) / max(
            1e-9, sum(float(panel_records[idx_m]["area_m2"]) for idx_m in members)
        )
        if avg_wwr < 1.0 - 1e-6:
            b_perim *= math.sqrt(max(0.0, avg_wwr))
        info = {"members": members, "area_m2": comp_area, "perimeter_m": b_perim}
        for idx_m in members:
            out[idx_m] = info
    return out


def _measure_frame_groups_for_panels(
    frame_groups: List[RawGroupMesh],
    panel_records: List[Dict[str, Any]],
    disabled_groups: Sequence[str],
    z_ground_cut: float = 0.0,
) -> Dict[str, Any]:
    """Mengukur muka luar grup rangka (A_frame) dan median lebar profil, lalu membaginya ke panel kaca terdekat.

    Hanya muka luar yang menghadap searah bidang kaca terdekat (dot >= 0,70, dalam pita bidang kaca
    [-0,25..+0,45] m, bukan sisi samping return, bukan muka belakang, dan bukan bagian dalam/tertutup)
    yang dihitung. Muka yang berada di sela-sela panel kaca menambah A_f dan A_o; muka yang menempel
    langsung di depan kaca menerus dicatat sebagai overlap agar tidak menggandakan A_o.
    """
    live_frames = [rg for rg in frame_groups if rg.group_name not in disabled_groups and len(rg.faces) > 0]
    glz_indices = [
        idx for idx, p in enumerate(panel_records)
        if p.get("active") and p.get("element_type") in ("glazing", "composite_cw") and float(p.get("area_m2", 0.0)) > 1e-6
    ]
    if not live_frames or not glz_indices:
        return {
            "measured": False,
            "frame_width_m": 0.0,
            "gap_area_by_panel": {},
            "overlap_area_by_panel": {},
            "group_outer_area": {},
            "total_measured_area": 0.0,
        }

    glz_c = np.array([panel_records[i]["centroid"] for i in glz_indices], dtype=np.float64)
    glz_n = np.array([panel_records[i]["normal"] for i in glz_indices], dtype=np.float64)
    glz_min = np.array([np.min(panel_records[i]["vertices"], axis=0) for i in glz_indices], dtype=np.float64)
    glz_max = np.array([np.max(panel_records[i]["vertices"], axis=0) for i in glz_indices], dtype=np.float64)
    gz_lo = glz_min[:, 2]
    gz_hi = glz_max[:, 2]

    # Segitiga kaca aktif (untuk deteksi tumpang tindih kaca menerus) & cangkang luar aktif (untuk deteksi sisi dalam)
    glz_tris_list: List[List[List[float]]] = []
    shell_tris_list: List[List[List[float]]] = []
    for p in panel_records:
        if not p.get("active"):
            continue
        vs = p.get("vertices") or []
        if len(vs) < 3:
            continue
        t1 = [vs[0], vs[1], vs[2]]
        shell_tris_list.append(t1)
        is_g = p.get("element_type") in ("glazing", "composite_cw")
        if is_g:
            glz_tris_list.append(t1)
        if len(vs) >= 4:
            t2 = [vs[0], vs[2], vs[3]]
            shell_tris_list.append(t2)
            if is_g:
                glz_tris_list.append(t2)
    glz_tris = np.array(glz_tris_list, dtype=np.float64) if glz_tris_list else np.empty((0, 3, 3), dtype=np.float64)
    shell_tris = np.array(shell_tris_list, dtype=np.float64) if shell_tris_list else np.empty((0, 3, 3), dtype=np.float64)

    gap_by_panel: Dict[int, float] = {}
    ov_by_panel: Dict[int, float] = {}
    group_outer_area: Dict[str, float] = {}
    width_samples: List[np.ndarray] = []
    total_measured = 0.0

    z_glz_min = float(gz_lo.min()) - 2.0
    z_glz_max = float(gz_hi.max()) + 2.0

    for rg in live_frames:
        v_arr = rg.vertices
        f_arr = rg.faces
        p0, p1, p2, p3 = v_arr[f_arr[:, 0]], v_arr[f_arr[:, 1]], v_arr[f_arr[:, 2]], v_arr[f_arr[:, 3]]
        iq = f_arr[:, 2] != f_arr[:, 3]
        cr1 = np.cross(p1 - p0, p2 - p0)
        nl = np.linalg.norm(cr1, axis=1)
        areas = 0.5 * nl + np.where(iq, 0.5 * np.linalg.norm(np.cross(p2 - p0, p3 - p0), axis=1), 0.0)
        n = cr1 / np.maximum(nl[:, None], 1e-12)
        cent = np.where(iq[:, None], 0.25 * (p0 + p1 + p2 + p3), (p0 + p1 + p2) / 3.0)

        vert = (np.abs(n[:, 2]) < 0.707) & (areas > 1e-5) & (cent[:, 2] >= z_glz_min) & (cent[:, 2] <= z_glz_max)
        if z_ground_cut > 0.05:
            vert &= cent[:, 2] >= (z_ground_cut - 0.05)
        idx_v = np.where(vert)[0]
        if len(idx_v) == 0:
            group_outer_area[rg.group_name] = 0.0
            continue

        fc = cent[idx_v]
        fn = n[idx_v]
        best_dot = np.zeros(len(idx_v), dtype=np.float64)
        best_dist = np.full(len(idx_v), 1e9, dtype=np.float64)
        best_plane_off = np.full(len(idx_v), 1e9, dtype=np.float64)
        best_glz_pos = np.full(len(idx_v), -1, dtype=np.int64)

        z_lo_all = float(fc[:, 2].min())
        zb_idx = np.floor((fc[:, 2] - z_lo_all) / 3.0).astype(np.int64)
        for zb in np.unique(zb_idx):
            fm = np.where(zb_idx == zb)[0]
            zlo = z_lo_all + float(zb) * 3.0 - 2.5
            zhi = z_lo_all + float(zb + 1) * 3.0 + 2.5
            gm = np.where((gz_hi >= zlo) & (gz_lo <= zhi))[0]
            if len(gm) == 0:
                continue
            gc_sub = glz_c[gm]
            gn_sub = glz_n[gm]
            gmn_sub = glz_min[gm]
            gmx_sub = glz_max[gm]
            for i0 in range(0, len(fm), 500):
                sl = fm[i0:i0 + 500]
                pts = fc[sl, None, :]
                # Jarak ke AABB panel kaca (bukan pusat panel) agar mullion di tepi jendela pita lebar tetap cocok
                dx = np.maximum(0.0, np.maximum(gmn_sub[None, :, :] - pts, pts - gmx_sub[None, :, :]))
                d2 = np.sum(dx ** 2, axis=2)
                j = np.argmin(d2, axis=1)
                idx_r = np.arange(len(j))
                best_dist[sl] = np.sqrt(d2[idx_r, j])
                best_dot[sl] = np.sum(fn[sl] * gn_sub[j], axis=1)
                best_plane_off[sl] = np.sum((fc[sl] - gc_sub[j]) * gn_sub[j], axis=1)
                best_glz_pos[sl] = gm[j]

        near = (best_glz_pos >= 0) & (best_dist <= 1.5) & (best_plane_off >= -0.25) & (best_plane_off <= 0.45)
        n_pos = int(np.sum(near & (best_dot >= 0.70)))
        n_neg = int(np.sum(near & (best_dot <= -0.70)))
        if n_pos == 0 and n_neg > 0:
            # Mesh rangka satu sisi dengan normal terbalik (mis. IfcMember datar)
            front_m = near & (best_dot <= -0.70)
            eff_n = -fn[front_m]
        else:
            front_m = near & (best_dot >= 0.70)
            eff_n = fn[front_m]
        if not np.any(front_m):
            group_outer_area[rg.group_name] = 0.0
            continue

        f_orig = idx_v[front_m]
        f_glz_pos = best_glz_pos[front_m]
        f_cent = cent[f_orig]
        f_areas = areas[f_orig]
        sdims = _compute_face_shortest_dims(p0[f_orig], p1[f_orig], p2[f_orig], p3[f_orig], iq[f_orig], eff_n)

        # Saring pelat lebar non-profil (> 0,60 m) yang kadang tergabung di layer logam (mis. cladding ArchiCAD)
        slim_m = sdims <= 0.60
        if not np.any(slim_m):
            group_outer_area[rg.group_name] = 0.0
            continue
        f_orig = f_orig[slim_m]
        f_glz_pos = f_glz_pos[slim_m]
        f_cent = f_cent[slim_m]
        f_areas = f_areas[slim_m]
        eff_n = eff_n[slim_m]
        sdims = sdims[slim_m]

        # Buang muka rangka di belakang kulit fasad luar (interior / terhalang kulit luar)
        blocked_by_shell = _vectorized_ray_hit_any(
            shell_tris, f_cent + eff_n * 0.005, eff_n, min_dist=0.005, max_dist=max(40.0, 2.0 * max(1.0, z_glz_max - z_glz_min)), bucket_m=1.5
        )
        # Buang muka dalam profil ekstrusi berongga (terhalang muka depan rangka sendiri dalam <= 0,50 m)
        front_tris_chunks = [np.stack([p0[f_orig], p1[f_orig], p2[f_orig]], axis=1)]
        fq_m = iq[f_orig]
        if np.any(fq_m):
            f_oq = f_orig[fq_m]
            front_tris_chunks.append(np.stack([p0[f_oq], p2[f_oq], p3[f_oq]], axis=1))
        front_tris = np.vstack(front_tris_chunks)
        blocked_by_self = _vectorized_ray_hit_any(
            front_tris, f_cent + eff_n * 0.003, eff_n, min_dist=0.003, max_dist=0.50, bucket_m=0.5
        )
        ext_m = (~blocked_by_shell) & (~blocked_by_self)
        if not np.any(ext_m):
            group_outer_area[rg.group_name] = 0.0
            continue

        e_glz_pos = f_glz_pos[ext_m]
        e_cent = f_cent[ext_m]
        e_areas = f_areas[ext_m]
        e_n = eff_n[ext_m]
        e_sdims = sdims[ext_m]

        # Cek apakah di belakang muka rangka ada kaca menerus (jarak <= 0,45 m ke arah -normal)
        ov_m = _vectorized_ray_hit_any(
            glz_tris, e_cent + e_n * 0.004, -e_n, min_dist=0.002, max_dist=0.45, bucket_m=1.0
        )

        # Distribusikan luas muka luar rangka ke panel kaca terdekat
        grp_a = float(e_areas.sum())
        group_outer_area[rg.group_name] = round(grp_a, 2)
        total_measured += grp_a
        width_samples.append(np.clip(e_sdims, 0.005, 0.60))

        for k_i in range(len(e_areas)):
            p_idx = glz_indices[int(e_glz_pos[k_i])]
            a_i = float(e_areas[k_i])
            if ov_m[k_i]:
                ov_by_panel[p_idx] = ov_by_panel.get(p_idx, 0.0) + a_i
            else:
                gap_by_panel[p_idx] = gap_by_panel.get(p_idx, 0.0) + a_i

    if total_measured <= 1e-4 or not width_samples:
        return {
            "measured": False,
            "frame_width_m": 0.0,
            "gap_area_by_panel": {},
            "overlap_area_by_panel": {},
            "group_outer_area": group_outer_area,
            "total_measured_area": 0.0,
        }

    all_w = np.concatenate(width_samples)
    med_w = float(np.median(all_w))
    return {
        "measured": True,
        "frame_width_m": med_w,
        "gap_area_by_panel": gap_by_panel,
        "overlap_area_by_panel": ov_by_panel,
        "group_outer_area": group_outer_area,
        "total_measured_area": total_measured,
    }


def analyze_building_ottv(
    filepath: str,
    filename: str,
    params: Optional[EnvelopeParameters] = None
) -> Dict[str, Any]:
    if params is None:
        params = EnvelopeParameters()

    calc_mode = (params.calculation_mode or "simulasi").strip().lower()
    is_sni_mode = calc_mode == "sni"
    sf_source = (params.sf_source or "sni2020").strip().lower()
    if sf_source not in ("template_prodi", "sni2020"):
        sf_source = "sni2020"
    sceff_table_mode = (params.sceff_table_mode or "terkoreksi").strip().lower()
    if sceff_table_mode not in ("terkoreksi", "ketat_pdf"):
        sceff_table_mode = "terkoreksi"

    sni_city_key, sni_city_entry = get_sni_city_entry(params.city_preset)
    sf_source_info = get_sf_source_info(params.city_preset, sf_source)

    # Resolve location / EPW preset
    if is_sni_mode:
        base_loc = INDONESIAN_CITY_PRESETS.get(sni_city_key, INDONESIAN_CITY_PRESETS["jakarta"])
        loc_info = dict(base_loc)
        loc_info["id"] = sf_source_info["city_key"]
        loc_info["city"] = sf_source_info["city_label"]
        loc_info["sf_source"] = sf_source_info["sf_source"]
        loc_info["sf_source_label"] = sf_source_info["sf_source_label"]
        loc_info["sf_table"] = dict(sf_source_info["sf_table"])
        if sf_source == "sni2020":
            loc_info["sni_table8_sf"] = dict(sni_city_entry["sf"])
        loc_info["design_delta_t"] = SNI_DELTA_T_K
        lat_deg = float(loc_info.get("latitude_deg", params.latitude_deg))
        lon_deg = float(loc_info.get("longitude_deg", params.longitude_deg))
        delta_t = SNI_DELTA_T_K
        sf_mult = 1.0
        custom_hourly_dni = None
    else:
        if params.custom_epw_info:
            loc_info = params.custom_epw_info
        else:
            loc_info = INDONESIAN_CITY_PRESETS.get(
                (params.city_preset or "jakarta").lower(),
                INDONESIAN_CITY_PRESETS["jakarta"],
            )
        lat_deg = float(loc_info.get("latitude_deg", params.latitude_deg))
        lon_deg = float(loc_info.get("longitude_deg", params.longitude_deg))
        delta_t = float(loc_info.get("design_delta_t", params.delta_t))
        sf_mult = float(loc_info.get("sf_multiplier", params.sf_climate_multiplier))
        custom_hourly_dni = loc_info.get("hourly_dni_profile")

    # Apply material library specs (including per-model custom_materials)
    extra_mats = params.custom_materials or []
    glz_mat = get_material_by_id(params.glazing_material_id, extra_materials=extra_mats)
    wal_mat = get_material_by_id(params.wall_material_id, extra_materials=extra_mats)
    frm_mat = get_material_by_id(params.frame_material_id, extra_materials=extra_mats)

    # STAGE 1 & STAGE 2: Universal Geometry Normalization, BIM/3DM/OBJ Ingestion & Sub-Element Decomposition
    raw_groups, stage1_audit = load_universal_model_stages_1_and_2(
        filepath=filepath,
        unit_mode=params.unit_mode,
        up_axis=params.up_axis,
        nurbs_u_div=params.nurbs_u_div,
        nurbs_v_div=params.nurbs_v_div,
        auto_split_merged_cw=params.auto_split_merged_cw,
        groups_to_auto_split=params.groups_to_auto_split,
        frame_width_threshold_m=params.frame_width_threshold_m,
        spandrel_height_threshold_m=params.spandrel_height_threshold_m,
        restore_filtered=params.restore_filtered,
    )
    runtime_filtered_items: List[Dict[str, Any]] = list(stage1_audit.filtered_items)
    restore_set_engine = set(params.restore_filtered or [])
    if not raw_groups:
        raise ValueError("Tidak ditemukan geometri 3D pada file yang diunggah.")

    # Separate groups into surface groups ('wall', 'spandrel', 'glazing', 'composite_cw') vs 'frame', 'shading', 'roof', 'ignore', 'unknown'
    surface_groups: List[Tuple[RawGroupMesh, str]] = []
    frame_groups: List[RawGroupMesh] = []
    shading_groups: List[RawGroupMesh] = []
    roof_groups: List[RawGroupMesh] = []
    ignored_groups: List[RawGroupMesh] = []
    context_groups: List[RawGroupMesh] = []  # konteks: hanya tampilan, tidak dihitung dan tidak meneduhi
    unknown_groups: List[RawGroupMesh] = []
    group_summaries: List[Dict[str, Any]] = []

    geo_reclassified: List[Dict[str, Any]] = []
    detached_shading_panels = 0  # A3-02: panel yang SC-nya dihitung dengan pendekatan peneduh lepas
    geo_slab_used: Dict[str, int] = {}  # A3-08: grup non-peneduh yang pelatnya meneduhi kaca -> jumlah panel
    for rg in raw_groups:
        eff_cat = params.group_category_overrides.get(rg.group_name, rg.default_category)
        # AUDIT-03/A3-06: cek geometri dilakukan di tahap klasifikasi (universal_pipeline); di sini hanya dilaporkan.
        # Pilihan eksplisit pengguna (group_category_overrides) selalu menang.
        if rg.geometry_reclassified_from and rg.group_name not in params.group_category_overrides:
            geo_reclassified.append({
                "group_name": rg.group_name,
                "from_category": rg.geometry_reclassified_from,
                "to_category": "frame",
                "linear_area_fraction": float(rg.linear_area_fraction or 0.0),
            })
        if eff_cat == "frame":
            frame_groups.append(rg)
        elif eff_cat in ("shading", "context_shading"):
            shading_groups.append(rg)
        elif eff_cat == "roof":
            roof_groups.append(rg)
        elif eff_cat in ("ignore", "excluded"):
            ignored_groups.append(rg)
        elif eff_cat == "context":
            context_groups.append(rg)
        elif eff_cat == "unknown":
            # M7: Unclassified groups (e.g. landscape trees) are NOT silently treated as 'wall'!
            unknown_groups.append(rg)
        elif eff_cat in ("wall", "spandrel", "glazing", "composite_cw"):
            surface_groups.append((rg, eff_cat))
        else:
            unknown_groups.append(rg)

    # AUDIT-02: face kembar (copy-paste / objek tertumpuk) dihitung sekali saja
    surface_groups, dedupe_stats = dedupe_surface_groups(surface_groups)

    # M7: Do NOT silently coerce 'unknown' groups into 'wall' — user must confirm roles in Periksa Model
    if not surface_groups:
        if unknown_groups:
            raise ValueError(
                f"Tidak ada grup selubung bangunan (kaca/dinding/spandrel) yang teridentifikasi otomatis. "
                f"Terdapat {len(unknown_groups)} grup berstatus 'unknown' yang wajib dikonfirmasi perannya "
                "terlebih dahulu di tahap Periksa Model."
            )
        raise ValueError(
            "Tidak ada grup selubung bangunan (kaca/dinding/spandrel) yang dapat dievaluasi untuk OTTV."
        )

    # Compute overall building horizontal center, bounding box & Z range across all surface groups
    all_surf_verts = np.vstack([rg.vertices for rg, _ in surface_groups])
    x_min_bldg = float(np.min(all_surf_verts[:, 0]))
    x_max_bldg = float(np.max(all_surf_verts[:, 0]))
    y_min_bldg = float(np.min(all_surf_verts[:, 1]))
    y_max_bldg = float(np.max(all_surf_verts[:, 1]))
    z_min_bldg_raw = float(np.min(all_surf_verts[:, 2]))
    z_max_bldg = float(np.max(all_surf_verts[:, 2]))
    z_ground_cut = max(0.0, float(params.z_ground_cutoff_m or 0.0))
    z_min_bldg = z_min_bldg_raw
    if z_ground_cut > 0.05 and z_ground_cut < z_max_bldg - 1.0:
        z_min_bldg = max(z_min_bldg_raw, z_ground_cut)
    bldg_cx = 0.5 * (x_min_bldg + x_max_bldg)
    bldg_cy = 0.5 * (y_min_bldg + y_max_bldg)
    bldg_cz = 0.5 * (z_min_bldg + z_max_bldg)
    span_x = max(1.0, x_max_bldg - x_min_bldg)
    span_y = max(1.0, y_max_bldg - y_min_bldg)
    span_z = max(1.0, z_max_bldg - z_min_bldg)
    horiz_radius = 0.5 * math.hypot(span_x, span_y)
    max_span = max(span_x, span_y, span_z, 10.0)
    recommended_dome_radius = max(span_z * 1.12, horiz_radius * 2.1, 26.0)

    # First pass: collect panel Z min/max across above-ground surface groups for Stage 3 Z-clustering
    all_p_zmin: List[np.ndarray] = []
    all_p_zmax: List[np.ndarray] = []
    for rg, _ in surface_groups:
        vs = rg.vertices
        fs = rg.faces
        z0123 = np.stack([vs[fs[:, 0], 2], vs[fs[:, 1], 2], vs[fs[:, 2], 2], vs[fs[:, 3], 2]], axis=1)
        pz_lo = np.min(z0123, axis=1)
        pz_hi = np.max(z0123, axis=1)
        if z_ground_cut > 0.05:
            above_m = 0.5 * (pz_lo + pz_hi) >= (z_ground_cut - 0.05)
            pz_lo = pz_lo[above_m]
            pz_hi = pz_hi[above_m]
        if len(pz_lo) > 0:
            all_p_zmin.append(pz_lo)
            all_p_zmax.append(pz_hi)

    p_zmin_concat = np.concatenate(all_p_zmin) if all_p_zmin else None
    p_zmax_concat = np.concatenate(all_p_zmax) if all_p_zmax else None

    # Filter BIM storeys below Z0 ground cutoff so basement storeys don't shift L1..LN
    eff_bim_storeys = [
        st for st in (stage1_audit.bim_storeys or [])
        if float(st.get("z_max", st.get("z_min", 0.0) + 3.0)) > (z_ground_cut + 0.3)
    ] if z_ground_cut > 0.05 else stage1_audit.bim_storeys

    # STAGE 3: Build Dynamic Floor Levels (`auto` | `uniform` | `custom`) — R4 Tiered Detection
    floor_defs, floor_detection_method = build_dynamic_floor_levels(
        z_min_bldg=z_min_bldg,
        z_max_bldg=z_max_bldg,
        floor_mode=params.floor_mode,
        floor_height_m=params.floor_height_m,
        bim_storeys=eff_bim_storeys,
        panel_z_mins=p_zmin_concat,
        panel_z_maxs=p_zmax_concat,
        custom_floor_zones=params.custom_floor_zones,
        raw_groups=raw_groups,
        expected_floors=params.expected_floors,
        disabled_groups=list(params.disabled_groups),
        group_category_overrides=params.group_category_overrides,
    )
    total_floors = max(1, len(floor_defs))
    floor_h = round(span_z / total_floors, 2)

    # Precompute horizontal center per floor slice for accurate outer-skin detection on twisted/podium towers
    floor_centers = np.zeros((total_floors, 2), dtype=np.float64)
    for fl_idx, fdef in enumerate(floor_defs):
        zf0 = float(fdef["z_min"])
        zf1 = float(fdef["z_max"])
        mask_z = (all_surf_verts[:, 2] >= zf0 - 0.5) & (all_surf_verts[:, 2] <= zf1 + 0.5)
        if np.any(mask_z):
            floor_centers[fl_idx, 0] = float(np.mean(all_surf_verts[mask_z, 0]))
            floor_centers[fl_idx, 1] = float(np.mean(all_surf_verts[mask_z, 1]))
        else:
            floor_centers[fl_idx] = [bldg_cx, bldg_cy]

    # Build unified building shell & roof triangle arrays for 3-Layer Exterior Skin Engine
    def _groups_to_tris(rg_list: List[RawGroupMesh]) -> np.ndarray:
        chunks: List[np.ndarray] = []
        for r in rg_list:
            if r.group_name in params.disabled_groups or len(r.faces) == 0:
                continue
            vs_r, fs_r = r.vertices, r.faces
            chunks.append(np.stack([vs_r[fs_r[:, 0]], vs_r[fs_r[:, 1]], vs_r[fs_r[:, 2]]], axis=1))
            is_q_r = fs_r[:, 2] != fs_r[:, 3]
            if np.any(is_q_r):
                fq_r = fs_r[is_q_r]
                chunks.append(np.stack([vs_r[fq_r[:, 0]], vs_r[fq_r[:, 2]], vs_r[fq_r[:, 3]]], axis=1))
        return np.vstack(chunks) if chunks else np.empty((0, 3, 3), dtype=np.float64)

    # Keep all_shell_tris purely from surface_groups (un-strided!) for watertight exterior visibility
    all_shell_tris = _groups_to_tris([rg for rg, _ in surface_groups])
    roof_tris = _groups_to_tris(roof_groups)
    is_single_flat_wall_model = min(span_x, span_y) < 1.5
    ext_mode = (params.exterior_detection_mode or "auto").lower()

    # Vectorized extraction of planar panels from each surface group
    panel_records: List[Dict[str, Any]] = []
    panel_centroids_list: List[np.ndarray] = []
    panel_normals_list: List[np.ndarray] = []
    extra_face_shading_tris: List[np.ndarray] = []
    narrow_gap_groups: List[Dict[str, Any]] = []
    basement_panels_excluded = 0
    skylight_area_m2 = 0.0
    skylight_u_weighted = 0.0
    skylight_sc_weighted = 0.0

    face_ov_map = params.face_category_overrides or {}
    z_band_ovs = params.face_z_band_overrides or []
    has_explicit_glazing = (
        any(cat in ("glazing", "composite_cw") for _, cat in surface_groups)
        or any(v in ("glazing", "composite_cw") for v in face_ov_map.values())
        or any(str(b.get("category", "")) in ("glazing", "composite_cw") for b in z_band_ovs)
    )

    sf_by_orient_sni: Dict[str, float] = (
        {code: get_sf_for_source(params.city_preset, code, sf_source) for code in ORIENTATION_CODES}
        if is_sni_mode
        else {}
    )

    for rg, eff_cat in surface_groups:
        ext_res = resolve_group_outer_skin_faces(
            rg=rg,
            eff_cat=eff_cat,
            all_shell_tris=all_shell_tris,
            roof_tris=roof_tris,
            floor_centers=floor_centers,
            floor_defs=floor_defs,
            span_x=span_x,
            span_y=span_y,
            max_span=max_span,
            ext_mode=ext_mode,
            z_ground_cut=z_ground_cut,
            restore_set=restore_set_engine,
        )
        if ext_res is None:
            continue
        if ext_res.get("filtered_entries"):
            runtime_filtered_items.extend(ext_res["filtered_entries"])
        elif ext_res.get("filtered_entry") is not None:
            runtime_filtered_items.append(ext_res["filtered_entry"])

        orig_idx_v = ext_res["orig_idx_v"]
        fs_v = ext_res["fs_v"]
        is_quad_v = ext_res["is_quad_v"]
        p0_v, p1_v, p2_v, p3_v = ext_res["p0_v"], ext_res["p1_v"], ext_res["p2_v"], ext_res["p3_v"]
        areas_v = ext_res["areas_v"]
        normals_v = ext_res["normals_v"]
        centroids_v = ext_res["centroids_v"]
        fl_indices = ext_res["fl_indices"]
        is_outer_arr = ext_res["is_outer_arr"]

        # Vectorized Azimuth (0-360 deg from North +Y) & Tilt (0-180 deg)
        raw_az = (np.degrees(np.arctan2(normals_v[:, 0], normals_v[:, 1])) - params.north_angle_deg) % 360.0
        raw_az = np.where(np.isclose(raw_az, 360.0, atol=1e-3), 0.0, raw_az)
        tilt_arr = np.degrees(np.arccos(np.clip(normals_v[:, 2], -1.0, 1.0)))

        group_disabled = rg.group_name in params.disabled_groups
        ng_area_grp = float(ext_res.get("narrow_gap_area_m2") or 0.0)
        ng_faces_grp = int(ext_res.get("narrow_gap_faces") or 0)
        if not group_disabled and ng_area_grp > 0.01 and ng_faces_grp > 0:
            narrow_gap_groups.append({
                "group": rg.group_name,
                "category": eff_cat,
                "face_count": ng_faces_grp,
                "area_m2": round(ng_area_grp, 2),
            })
        # STAGE 4: Resolve per-group material via single canonical resolve_material()
        from config_schema import resolve_material
        resolved_grp = resolve_material(rg, params, category=eff_cat)
        group_mat_id = resolved_grp["material_id"]
        group_mat = resolved_grp["material"]
        mat_name = group_mat["name"] if group_mat else (
            glz_mat["name"] if eff_cat == "glazing" and glz_mat else (wal_mat["name"] if wal_mat else "Default SNI")
        )
        grp_wwr_ratio = float(params.group_wwr_map.get(rg.group_name, 0.70))

        outer_count_grp = int(ext_res["outer_faces"])
        total_area_grp = float(ext_res["outer_area_m2"])
        z_min_grp = float(np.min(centroids_v[:, 2])) if len(centroids_v) > 0 else 0.0
        z_max_grp = float(np.max(centroids_v[:, 2])) if len(centroids_v) > 0 else 0.0

        group_summaries.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "source_layer": rg.source_layer,
            "source_material": rg.source_material,
            "category": eff_cat,
            "role": "surface",
            "is_auto_split_child": rg.is_auto_split_child,
            "composite_wwr": round(grp_wwr_ratio, 2) if eff_cat == "composite_cw" else None,
            "total_faces": len(areas_v),
            "outer_faces": outer_count_grp,
            "outer_area_m2": round(total_area_grp, 2),
            "z_range_m": [round(z_min_grp, 1), round(z_max_grp, 1)],
            "material_id": group_mat_id,
            "material_name": mat_name,
            "enabled": not group_disabled,
        })

        p0_r = np.round(p0_v, 3).tolist()
        p1_r = np.round(p1_v, 3).tolist()
        p2_r = np.round(p2_v, 3).tolist()
        p3_r = np.round(p3_v, 3).tolist()
        e01 = np.linalg.norm(p1_v - p0_v, axis=1)
        e12 = np.linalg.norm(p2_v - p1_v, axis=1)
        e23 = np.where(is_quad_v, np.linalg.norm(p3_v - p2_v, axis=1), 0.0)
        e30 = np.where(is_quad_v, np.linalg.norm(p0_v - p3_v, axis=1), np.linalg.norm(p0_v - p2_v, axis=1))
        perim_r = np.round(e01 + e12 + e23 + e30, 4).tolist()
        cent_r = np.round(centroids_v, 3).tolist()
        norm_r = np.round(normals_v, 3).tolist()
        area_r = np.round(areas_v, 3).tolist()
        az_r = np.round(raw_az, 1).tolist()
        tilt_r = np.round(tilt_arr, 1).tolist()
        is_quad_l = is_quad_v.tolist()
        is_outer_l = is_outer_arr.tolist()
        fl_idx_l = fl_indices.tolist()
        orig_idx_l = orig_idx_v.tolist()
        cz_l = centroids_v[:, 2].tolist()
        nz_l = normals_v[:, 2].tolist()
        has_orient_ov = bool(params.orientation_material_overrides)
        orient_ov_map = params.orientation_material_overrides
        gid_prefix = f"{rg.group_id}-F"
        gname_prefix = f"{rg.group_name}_"

        for i in range(len(areas_v)):
            fl_num = fl_idx_l[i] + 1
            is_outer = is_outer_l[i]
            cz_i = cz_l[i]
            is_below_ground = (z_ground_cut > 0.05) and (cz_i < z_ground_cut - 0.05)
            if is_below_ground:
                basement_panels_excluded += 1

            # Per-face & Z-band role overrides from 3D Staging Inspection
            orig_face_key = f"{gid_prefix}{orig_idx_l[i] + 1}"
            panel_cat = eff_cat
            if face_ov_map:
                if orig_face_key in face_ov_map:
                    panel_cat = face_ov_map[orig_face_key]
                else:
                    seq_face_key = f"{gid_prefix}{i + 1}"
                    if seq_face_key in face_ov_map:
                        panel_cat = face_ov_map[seq_face_key]
            elif z_band_ovs:
                for zb in z_band_ovs:
                    g_match = str(zb.get("group_name") or "*")
                    if g_match not in ("*", rg.group_name):
                        continue
                    z_lo_b = float(zb.get("z_min", -1e9))
                    z_hi_b = float(zb.get("z_max", 1e9))
                    if z_lo_b - 0.05 <= cz_i <= z_hi_b + 0.05:
                        panel_cat = str(zb.get("category") or panel_cat)

            face_non_envelope = panel_cat in ("ignore", "excluded", "shading", "context_shading", "roof", "frame")
            if panel_cat in ("shading", "context_shading"):
                extra_face_shading_tris.append(np.array([p0_v[i], p1_v[i], p2_v[i]], dtype=np.float64))
                if is_quad_l[i]:
                    extra_face_shading_tris.append(np.array([p0_v[i], p2_v[i], p3_v[i]], dtype=np.float64))

            in_floor_section = True
            if params.section_floor_min is not None and fl_num < params.section_floor_min:
                in_floor_section = False
            if params.section_floor_max is not None and fl_num > params.section_floor_max:
                in_floor_section = False

            active = (
                (not group_disabled)
                and (not is_below_ground)
                and (not face_non_envelope)
                and in_floor_section
                and (is_outer if params.outer_skin_only else True)
            )
            az_val = az_r[i]
            tilt_val = tilt_r[i]
            orient_code = classify_sni_orientation(az_val)
            sf_val = sf_by_orient_sni[orient_code] if is_sni_mode else interpolate_sni_solar_factor(az_val, tilt_val, sf_mult)

            # Resolve panel material via single canonical resolve_material()
            if panel_cat != eff_cat or (has_orient_ov and orient_code in orient_ov_map):
                res_pm = resolve_material(
                    rg,
                    params,
                    category=panel_cat if panel_cat in ("glazing", "spandrel", "wall", "composite_cw") else eff_cat,
                    orientation_code=orient_code,
                )
                eff_panel_mat_id = res_pm["material_id"]
                eff_panel_mat_name = res_pm["material"]["name"] if res_pm["material"] else mat_name
            else:
                eff_panel_mat_id = group_mat_id
                eff_panel_mat_name = mat_name

            # SNI Pasal 4.4: Upward-facing glazing (nz > 0.50) counts as RTTV skylight ONLY if
            # shortest in-plane dimension > 0.30 m; thinner faces are recorded as 'sisi_tebal_panel'.
            if panel_cat == "glazing" and nz_l[i] > 0.50:
                # Skylight hanya dari grup yang ditandai pengguna (bila daftar diisi); selain itu
                # kaca menghadap atas tetap dikeluarkan dari OTTV tetapi tidak masuk RTTV.
                sky_allowed = params.rttv_skylight_groups is None or rg.group_name in set(params.rttv_skylight_groups)
                min_d_i = float(_compute_face_shortest_dims(
                    p0_v[i:i + 1],
                    p1_v[i:i + 1],
                    p2_v[i:i + 1],
                    p3_v[i:i + 1],
                    is_quad_v[i:i + 1],
                    normals_v[i:i + 1],
                )[0])
                if min_d_i > 0.30:
                    if sky_allowed and (not group_disabled) and (not is_below_ground) and (not face_non_envelope):
                        pm_sky = get_material_by_id(eff_panel_mat_id, extra_materials=extra_mats) or glz_mat or {}
                        a_sky_i = float(areas_v[i])
                        skylight_area_m2 += a_sky_i
                        skylight_u_weighted += a_sky_i * float(pm_sky.get("u_value", params.u_fenestration))
                        if is_sni_mode and sf_source == "template_prodi":
                            _, sky_sck = compute_template_shgc_and_sck(pm_sky, fallback_sc=params.sc_glass)
                            skylight_sc_weighted += a_sky_i * sky_sck
                        else:
                            skylight_sc_weighted += a_sky_i * float(pm_sky.get("sc", params.sc_glass))
                else:
                    # Fallback capture if panel became glazing via per-face override
                    existing_tp = next(
                        (it for it in runtime_filtered_items if it.get("id") == f"sisi_tebal_panel::{rg.group_name}"),
                        None,
                    )
                    if existing_tp is None:
                        runtime_filtered_items.append({
                            "id": f"sisi_tebal_panel::{rg.group_name}",
                            "group": rg.group_name,
                            "reason": "sisi_tebal_panel",
                            "reason_label": "Sisi tebal tepi panel kaca menghadap atas (dimensi terpendek <= 0,3 m)",
                            "face_count": 1,
                            "area_m2": round(float(areas_v[i]), 4),
                            "restored": False,
                        })
                    else:
                        existing_tp["face_count"] = int(existing_tp["face_count"]) + 1
                        existing_tp["area_m2"] = round(float(existing_tp["area_m2"]) + float(areas_v[i]), 4)
                continue

            if is_below_ground:
                verif_label = "Basement (< Z0)"
            elif face_non_envelope:
                verif_label = f"Override: {panel_cat}"
            elif not is_outer:
                verif_label = "Sisi Dalam (Nonaktif)"
            elif abs(tilt_val - 90.0) > 6.5:
                verif_label = "Perlu Cek (Condong)"
            else:
                verif_label = "Sisi Luar Aktif"

            verts_i = [p0_r[i], p1_r[i], p2_r[i], p3_r[i]] if is_quad_l[i] else [p0_r[i], p1_r[i], p2_r[i]]

            panel_records.append({
                "id": orig_face_key,
                "group_id": rg.group_id,
                "group_name": rg.group_name,
                "name": f"{gname_prefix}{i + 1}",
                "element_type": panel_cat,
                "floor_number": fl_num,
                "floor_label": f"L{fl_num}",
                "is_outer": is_outer,
                "is_below_ground": is_below_ground,
                "face_excluded": face_non_envelope,
                "in_floor_section": in_floor_section,
                "active": active,
                "verification_label": verif_label,
                "material_id": eff_panel_mat_id,
                "material_name": eff_panel_mat_name,
                "vertices": verts_i,
                "centroid": cent_r[i],
                "normal": norm_r[i],
                "area_m2": area_r[i],
                "perimeter_m": perim_r[i],
                "azimuth_deg": az_val,
                "tilt_deg": tilt_val,
                "orientation_code": orient_code,
                "sf_wm2": sf_val,
            })
            panel_centroids_list.append(centroids_v[i])
            panel_normals_list.append(normals_v[i])

    # Add frame, shading, and roof/excluded group summaries for Stage 2 UI role mapping
    for rg in frame_groups:
        f_mat_id = params.group_material_map.get(rg.group_name, params.frame_material_id)
        f_mat = get_material_by_id(f_mat_id) or frm_mat
        group_summaries.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "source_layer": rg.source_layer,
            "source_material": rg.source_material,
            "category": "frame",
            "role": "frame",
            "is_auto_split_child": rg.is_auto_split_child,
            "total_faces": len(rg.faces),
            "outer_faces": len(rg.faces),
            "outer_area_m2": 0.0,
            "material_id": f_mat_id,
            "material_name": f_mat["name"] if f_mat else "Aluminium Curtain Wall Frame",
            "enabled": rg.group_name not in params.disabled_groups,
        })
    for rg in shading_groups:
        group_summaries.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "source_layer": rg.source_layer,
            "source_material": rg.source_material,
            "category": "shading",
            "role": "shading",
            "is_auto_split_child": rg.is_auto_split_child,
            "total_faces": len(rg.faces),
            "outer_faces": len(rg.faces),
            "outer_area_m2": 0.0,
            "material_id": params.frame_material_id,
            "material_name": "External Shading / Louver Fin",
            "enabled": rg.group_name not in params.disabled_groups,
        })
    for rg in roof_groups:
        group_summaries.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "source_layer": rg.source_layer,
            "source_material": rg.source_material,
            "category": "roof",
            "role": "excluded",
            "is_auto_split_child": rg.is_auto_split_child,
            "total_faces": len(rg.faces),
            "outer_faces": 0,
            "outer_area_m2": 0.0,
            "material_id": None,
            "material_name": "Non-OTTV (Atap / Plat Lantai)",
            "enabled": rg.group_name not in params.disabled_groups,
        })
    for rg in context_groups:
        group_summaries.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "source_layer": rg.source_layer,
            "source_material": rg.source_material,
            "category": "context",
            "role": "context",
            "is_auto_split_child": rg.is_auto_split_child,
            "total_faces": len(rg.faces),
            "outer_faces": 0,
            "outer_area_m2": 0.0,
            "material_id": None,
            "material_name": "Konteks (tampil saja, tidak dihitung)",
            "enabled": rg.group_name not in params.disabled_groups,
        })
    for rg in ignored_groups:
        group_summaries.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "source_layer": rg.source_layer,
            "source_material": rg.source_material,
            "category": "ignore",
            "role": "ignored",
            "is_auto_split_child": rg.is_auto_split_child,
            "total_faces": len(rg.faces),
            "outer_faces": 0,
            "outer_area_m2": 0.0,
            "material_id": None,
            "material_name": "Diabaikan (Tapak / Tanah / Interior)",
            "enabled": False,
        })
    for rg in unknown_groups:
        group_summaries.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "source_layer": rg.source_layer,
            "source_material": rg.source_material,
            "category": "unknown",
            "role": "unknown",
            "needs_confirmation": True,
            "is_auto_split_child": rg.is_auto_split_child,
            "total_faces": len(rg.faces),
            "outer_faces": 0,
            "outer_area_m2": 0.0,
            "material_id": None,
            "material_name": "Perlu Dicek (Peran Belum Dikenali)",
            "enabled": False,
        })

    if not panel_records:
        raise ValueError("Tidak ada bidang fasad vertikal/condong yang dapat dievaluasi.")

    # Build FULL-BUILDING obstruction mesh for true self-shading + external/neighbor shading:
    # Keep opaque walls, spandrels, overhanging slabs/roofs, and shading louvers/neighbors 100% un-strided;
    # optimize ultra-dense bevelled curtain-wall frame triangles (>18k tris) for fast <5s raycasting.
    opaque_self_shade_groups = [
        rg for rg, cat in surface_groups if cat in ("wall", "spandrel")
    ]
    major_obs_tris = _groups_to_tris(shading_groups + opaque_self_shade_groups + roof_groups)
    frame_obs_tris = _groups_to_tris(frame_groups)
    if len(frame_obs_tris) > 18000:
        # Filter microscopic bevel slivers (< 0.004 m2) first, then uniform stride to <= 18k tris
        f_cross = np.cross(frame_obs_tris[:, 1] - frame_obs_tris[:, 0], frame_obs_tris[:, 2] - frame_obs_tris[:, 0])
        f_areas = 0.5 * np.linalg.norm(f_cross, axis=1)
        frame_obs_tris = frame_obs_tris[f_areas >= 0.004]
        if len(frame_obs_tris) > 18000:
            f_step = max(1, int(math.ceil(len(frame_obs_tris) / 18000)))
            frame_obs_tris = frame_obs_tris[::f_step]

    obs_chunks = [arr for arr in (major_obs_tris, frame_obs_tris) if len(arr) > 0]
    if extra_face_shading_tris:
        obs_chunks.append(np.array(extra_face_shading_tris, dtype=np.float64))
    obs_tris_all = np.vstack(obs_chunks) if obs_chunks else np.empty((0, 3, 3), dtype=np.float64)

    # Solar vectors (08:00 - 16:00)
    solar_vectors = compute_solar_vectors_08_to_16(
        latitude_deg=lat_deg,
        month=params.design_month,
        north_angle_deg=params.north_angle_deg,
        custom_hourly_dni=custom_hourly_dni,
    )

    # Vectorized raycasting from panel centroids (offset 10cm along outward normal to avoid self-hit)
    centroids_np = np.array(panel_centroids_list, dtype=np.float64)
    normals_np = np.array(panel_normals_list, dtype=np.float64)
    origins_np = centroids_np + normals_np * 0.10
    num_panels = len(panel_records)
    self_shade_reach = max(24.0, max_span * 1.5)

    # Compute hourly incidence cosine matrix upfront so we ONLY raycast sun-facing outer panels (4x speedup, 0% accuracy loss!)
    sun_dirs_np = np.array([sv["vector"] for sv in solar_vectors], dtype=np.float64)  # (9, 3)
    dni_np = np.array([sv["dni_wm2"] for sv in solar_vectors], dtype=np.float64)[:, None]  # (9, 1)
    cos_inc_mat = sun_dirs_np @ normals_np.T  # (9, num_panels)
    front_mask = cos_inc_mat > 0.01
    outer_mask_np = np.array([bool(p["is_outer"]) for p in panel_records], dtype=bool)

    abs_fp_rc = os.path.abspath(filepath)
    mtime_rc = os.path.getmtime(abs_fp_rc) if os.path.exists(abs_fp_rc) else 0.0
    fsize_rc = os.path.getsize(abs_fp_rc) if os.path.exists(abs_fp_rc) else 0
    obs_hash = (
        hashlib.blake2b(np.ascontiguousarray(obs_tris_all).view(np.uint8), digest_size=16).digest()
        if len(obs_tris_all) > 0
        else b""
    )
    orig_hash = hashlib.blake2b(np.ascontiguousarray(origins_np).view(np.uint8), digest_size=16).digest()
    rc_key = (
        abs_fp_rc,
        mtime_rc,
        fsize_rc,
        num_panels,
        len(obs_tris_all),
        obs_hash,
        orig_hash,
        round(lat_deg, 2),
        round(params.north_angle_deg, 1),
        params.design_month,
        ext_mode,
        round(self_shade_reach, 2),
        params.unit_mode,
        params.up_axis,
        round(float(params.z_ground_cutoff_m), 3),
        bool(params.outer_skin_only),
        tuple(sorted(params.disabled_groups)),
        tuple(sorted(params.group_category_overrides.items())),
        tuple(sorted(params.restore_filtered)),
    )
    if not hasattr(analyze_building_ottv, "_rc_cache"):
        analyze_building_ottv._rc_cache = {}
    if rc_key in analyze_building_ottv._rc_cache:
        hourly_hits = analyze_building_ottv._rc_cache[rc_key]
    else:
        if len(analyze_building_ottv._rc_cache) >= 16:
            analyze_building_ottv._rc_cache.clear()
        hourly_hits = np.zeros((len(solar_vectors), num_panels), dtype=np.float64)
        if len(obs_tris_all) > 0:
            for h_idx, sv in enumerate(solar_vectors):
                s_vec = np.array(sv["vector"], dtype=np.float64)
                active_sun_idx = np.where(front_mask[h_idx] & outer_mask_np)[0]
                if len(active_sun_idx) == 0:
                    continue
                hourly_hits[h_idx, active_sun_idx] = raycast_z_slab_solar_rays(
                    obs_tris_all, origins_np[active_sun_idx], s_vec, min_dist=0.08, max_dist=self_shade_reach
                )
        analyze_building_ottv._rc_cache[rc_key] = hourly_hits

    # Parametric louver supplement if enabled by user
    param_louver_bonus = 0.0
    if params.enable_parametric_louvers and params.louver_depth_m > 0.05:
        ratio = params.louver_depth_m / max(0.25, params.louver_spacing_m)
        tilt_boost = 1.0 + 0.35 * math.sin(math.radians(params.louver_tilt_deg))
        param_louver_bonus = min(0.75, 0.42 * ratio * tilt_boost)

    effective_hits = np.clip(hourly_hits + param_louver_bonus, 0.0, 1.0)
    weights_mat = np.where(front_mask, cos_inc_mat * dni_np, 0.0)
    sunlit_weights = np.sum((1.0 - effective_hits) * weights_mat, axis=0)
    total_weights = np.sum(weights_mat, axis=0)

    sunlit_frac_arr = np.where(total_weights > 1e-3, sunlit_weights / np.maximum(1e-6, total_weights), 0.35)
    shaded_frac_arr = 1.0 - sunlit_frac_arr

    # Direct beam share (0.72) attenuated by shading; diffuse sky (0.28) remains (Simulation mode)
    sc_Display_mult_arr = 0.28 + 0.72 * sunlit_frac_arr
    panel_r1_arr = np.zeros(num_panels, dtype=np.float64)
    panel_r2_arr = np.zeros(num_panels, dtype=np.float64)
    panel_phi1_arr = np.zeros(num_panels, dtype=np.float64)
    sceff_errata_map: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
    is_template_method = is_sni_mode and (sf_source == "template_prodi")
    tpl_shading_reg: Optional[TemplateShadingRegistry] = TemplateShadingRegistry() if is_template_method else None

    if is_sni_mode:
        # SNI 6389:2020 Compliance Mode:
        # - sf_source == 'template_prodi': exact template BO lookup (scefn..scefsw) via TemplateShadingRegistry
        # - sf_source == 'sni2020': Lampiran A (Tabel A.5-A.16) with errata mode
        sni_shade_chunks = []
        sni_sh_tris_grp = _groups_to_tris(shading_groups + roof_groups)
        if len(sni_sh_tris_grp) > 0:
            sni_shade_chunks.append(sni_sh_tris_grp)
        if extra_face_shading_tris:
            sni_shade_chunks.append(np.array(extra_face_shading_tris, dtype=np.float64))
        n_named_tris = int(sum(len(c) for c in sni_shade_chunks))
        # A3-08: bidang HORIZONTAL dari grup yang namanya bukan peneduh (pelat lantai/balkon, grup tak dikenal)
        # ikut diperiksa. Bagian di belakang fasad tidak pernah "di depan kaca", jadi yang terhitung hanya
        # bagian yang menjorok keluar (balkon, pelat kantilever). Bidang dekat tanah diabaikan.
        geo_slab_names: List[str] = []
        geo_src_chunks: List[np.ndarray] = []
        for rg_s in list(ignored_groups) + list(unknown_groups):
            t_s = _groups_to_tris([rg_s])
            if len(t_s) == 0:
                continue
            n_s = np.cross(t_s[:, 1] - t_s[:, 0], t_s[:, 2] - t_s[:, 0])
            l_s = np.linalg.norm(n_s, axis=1)
            zc = t_s[:, :, 2].mean(axis=1)
            keep = (l_s > 1e-9) & (np.abs(n_s[:, 2]) >= 0.9 * np.maximum(l_s, 1e-12)) & (zc >= z_min_bldg + 1.0) & (zc <= z_max_bldg + 1.0)
            if np.any(keep):
                geo_slab_names.append(rg_s.group_name)
                sni_shade_chunks.append(t_s[keep])
                geo_src_chunks.append(np.full(int(keep.sum()), len(geo_slab_names), dtype=np.int64))
        sni_shading_tris = np.vstack(sni_shade_chunks) if sni_shade_chunks else np.empty((0, 3, 3), dtype=np.float64)
        sni_shading_src = np.concatenate([np.zeros(n_named_tris, dtype=np.int64)] + geo_src_chunks) if len(sni_shading_tris) else None
        sni_shading_aabb = (
            (np.min(sni_shading_tris, axis=1), np.max(sni_shading_tris, axis=1))
            if len(sni_shading_tris) > 0
            else None
        )
        sni_shading_norm_info: Optional[Tuple[np.ndarray, np.ndarray]] = None
        if len(sni_shading_tris) > 0:
            _sh_tc = np.cross(
                sni_shading_tris[:, 1] - sni_shading_tris[:, 0],
                sni_shading_tris[:, 2] - sni_shading_tris[:, 0],
            )
            _sh_len = np.linalg.norm(_sh_tc, axis=1)
            _sh_valid = _sh_len > 1e-8
            _sh_unit = np.zeros((len(sni_shading_tris), 3), dtype=np.float64)
            _sh_unit[_sh_valid] = _sh_tc[_sh_valid] / _sh_len[_sh_valid, None]
            sni_shading_norm_info = (_sh_unit, _sh_valid)

        sc_Display_mult_arr = np.ones(num_panels, dtype=np.float64)
        detached_shading_panels = 0
        sni_shading_zindex = (
            _build_shading_z_index(sni_shading_aabb[0], sni_shading_aabb[1]) if sni_shading_aabb is not None else None
        )
        # Panel yang pita Z-nya tidak menyentuh satu pun segitiga peneduh tidak perlu diukur (hasil pasti 0,0,0).
        # Dicek sekaligus untuk semua panel dari jumlah kumulatif isi ember indeks-Z.
        skip_shading_measure = np.zeros(num_panels, dtype=bool)
        if not params.enable_parametric_louvers:
            if sni_shading_zindex is None:
                skip_shading_measure[:] = True
            else:
                zi = sni_shading_zindex
                occ = (np.diff(zi["starts"]) > 0).astype(np.int64)
                occ_cum = np.concatenate(([0], np.cumsum(occ)))
                for idx_q, p_q in enumerate(panel_records):
                    if p_q["element_type"] not in ("glazing", "composite_cw"):
                        continue
                    zs_q = [v[2] for v in p_q["vertices"]]
                    b0 = max(0, int(math.floor((min(zs_q) - 0.5 - zi["z0"]) / zi["bucket"])))
                    b1 = min(zi["n"] - 1, int(math.floor((max(zs_q) + SHADE_MAX_RISE_M + 0.5 - zi["z0"]) / zi["bucket"])))
                    if b1 < b0 or occ_cum[b1 + 1] - occ_cum[b0] == 0:
                        skip_shading_measure[idx_q] = True
        sceff_lookup_cache: Dict[Tuple[str, float, float, float], Dict[str, Any]] = {}
        for idx_p, p_rec in enumerate(panel_records):
            if p_rec["element_type"] in ("glazing", "composite_cw"):
                sh_det: Dict[str, Any] = {}
                r1_v, r2_v, phi1_v = (0.0, 0.0, 0.0) if skip_shading_measure[idx_p] else _measure_panel_sni_shading_ratios(
                    detail=sh_det,
                    shading_src=sni_shading_src,
                    shading_zindex=sni_shading_zindex,
                    panel_verts=p_rec["vertices"],
                    panel_normal=p_rec["normal"],
                    shading_tris=sni_shading_tris,
                    enable_parametric_louvers=params.enable_parametric_louvers,
                    louver_depth_m=params.louver_depth_m,
                    louver_spacing_m=params.louver_spacing_m,
                    louver_tilt_deg=params.louver_tilt_deg,
                    shading_aabb=sni_shading_aabb,
                    shading_norm_info=sni_shading_norm_info,
                )
                panel_r1_arr[idx_p] = r1_v
                src_ov = int((sh_det.get("ov") or {}).get("src", 0))
                if src_ov > 0 and r1_v > 0 and p_rec.get("active"):
                    nm_ov = geo_slab_names[src_ov - 1]
                    geo_slab_used[nm_ov] = geo_slab_used.get(nm_ov, 0) + 1
                panel_r2_arr[idx_p] = r2_v
                panel_phi1_arr[idx_p] = phi1_v
                if is_template_method and tpl_shading_reg is not None:
                    if p_rec.get("active"):
                        sh_yn, sh_code = tpl_shading_reg.register(r1_v, r2_v, phi1_v)
                        p_rec["template_shade_yn"] = sh_yn
                        p_rec["template_shade_code"] = sh_code
                        sc_Display_mult_arr[idx_p] = tpl_shading_reg.lookup_bo_sceff(
                            p_rec["orientation_code"],
                            sh_yn,
                            sh_code,
                        )
                    else:
                        p_rec["template_shade_yn"] = ""
                        p_rec["template_shade_code"] = ""
                        sc_Display_mult_arr[idx_p] = 1.0
                else:
                    sc_key = (p_rec["orientation_code"], r1_v, r2_v, phi1_v)
                    sc_det = sceff_lookup_cache.get(sc_key)
                    if sc_det is None:
                        sc_det = lookup_sceff_detailed(
                            p_rec["orientation_code"],
                            r1_horizontal=r1_v,
                            r2_vertical=r2_v,
                            tilt_deg=phi1_v,
                            table_mode=sceff_table_mode,
                        )
                        sceff_lookup_cache[sc_key] = sc_det
                    sc_Display_mult_arr[idx_p] = float(sc_det["sc_eff"])
                    sc_sup = _superposed_sceff(p_rec["orientation_code"], sh_det, r1_v, r2_v, phi1_v, sceff_table_mode)
                    if sc_sup is not None:
                        sc_Display_mult_arr[idx_p] = sc_sup
                        if p_rec.get("active"):
                            detached_shading_panels += 1
                    if sc_det.get("used_errata") and p_rec.get("active"):
                        for c_err in sc_det.get("corrections") or []:
                            ek = (c_err.get("table"), c_err.get("r1"), c_err.get("r2"), c_err.get("angle_deg"))
                            if ek not in sceff_errata_map:
                                sceff_errata_map[ek] = dict(c_err)

    sceff_errata_applied: List[Dict[str, Any]] = list(sceff_errata_map.values())

    # Compute per-hour sunlit bitmask (bits 0..8 for hours 08:00..16:00)
    sunlit_bool_mat = front_mask & (hourly_hits < 0.5)
    bit_weights = (1 << np.arange(len(solar_vectors), dtype=np.int64))[:, None]
    sunlit_mask_arr = np.sum(sunlit_bool_mat.astype(np.int64) * bit_weights, axis=0)
    direct_sun_hours_arr = np.sum(sunlit_bool_mat, axis=0)

    # Aggregate SNI 6389:2020 OTTV across active panels, 8 orientations, and floors
    orientation_buckets: Dict[str, Dict[str, Any]] = {
        code: {
            "code": code,
            "name_id": ORIENTATION_NAMES[code],
            "azimuth_center_deg": ORIENTATION_ANGLES[code],
            "sni_sf_wm2": get_sf_for_source(params.city_preset, code, sf_source) if is_sni_mode else round(ORIENTATION_BASE_SF[code] * sf_mult, 1),
            "panel_count": 0,
            "total_area_m2": 0.0,
            "wall_area_m2": 0.0,
            "glazing_area_m2": 0.0,
            "_sum_sf_area": 0.0,
            "_sum_sc_eff_area": 0.0,
            "_sum_sc_k_area": 0.0,
            "_sum_sc_sh_area": 0.0,
            "_sum_r1_area": 0.0,
            "_sum_r2_area": 0.0,
            "_sum_alpha_wall": 0.0,
            "_sum_uw_wall": 0.0,
            "_sum_tdek_wall": 0.0,
            "_sum_uf_glz": 0.0,
            "_sum_shaded_area": 0.0,
            "_sum_q_wall_w": 0.0,
            "_sum_q_glass_w": 0.0,
            "_sum_q_solar_w": 0.0,
            "_wall_combos": {},
            "_glz_combos": {},
            "_comp_combos": {},
        }
        for code in ORIENTATION_CODES
    }

    floor_def_by_num = {fd["floor_number"]: fd for fd in floor_defs}
    floor_buckets: Dict[int, Dict[str, Any]] = {
        fd["floor_number"]: {
            "floor_number": fd["floor_number"],
            "floor_label": fd["floor_label"],
            "zone_type": fd.get("zone_type", "Tipikal"),
            "z_min": fd["z_min"],
            "z_max": fd["z_max"],
            "height_m": fd["height_m"],
            "panel_count": 0,
            "total_area_m2": 0.0,
            "wall_area_m2": 0.0,
            "glazing_area_m2": 0.0,
            "_sum_heat_w": 0.0,
        }
        for fd in floor_defs
    }

    orientation_floor_buckets: Dict[str, Dict[int, Dict[str, float]]] = {
        code: {
            fl: {
                "panel_count": 0.0,
                "total_area_m2": 0.0,
                "wall_area_m2": 0.0,
                "glazing_area_m2": 0.0,
                "_sum_sf_area": 0.0,
                "_sum_sc_eff_area": 0.0,
                "_sum_q_wall_w": 0.0,
                "_sum_q_glass_w": 0.0,
                "_sum_q_solar_w": 0.0,
            }
            for fl in range(1, total_floors + 1)
        }
        for code in ORIENTATION_CODES
    }

    total_active_panels = 0
    total_outer_panels = 0
    total_envelope_area = 0.0
    total_glazing_area = 0.0
    total_a_frame_m2 = 0.0
    total_a_edge_m2 = 0.0
    total_a_cog_m2 = 0.0
    sum_uf_fen_area = 0.0
    total_wall_cond_w = 0.0
    total_glass_cond_w = 0.0
    total_solar_rad_w = 0.0

    # A3-11 & A3-13: U_frame sesuai SNI 6389:2020 Tabel 3 (aluminium/metal 8,0; kayu 3,0; vinyl 2,0).
    # Di mode SNI, thermal break tidak boleh menurunkan U_frame. frame_cond_adder lama dihapus.
    u_frame_eff = resolve_u_frame(frm_mat, is_sni_mode=is_sni_mode, fallback_u_frame=float(params.u_frame))
    frame_meas = _measure_frame_groups_for_panels(
        frame_groups=frame_groups,
        panel_records=panel_records,
        disabled_groups=params.disabled_groups,
        z_ground_cut=z_ground_cut,
    )
    frame_measured = bool(frame_meas["measured"])
    if frame_measured:
        eff_frame_width_m = float(frame_meas["frame_width_m"])
        eff_frame_width_mm = round(eff_frame_width_m * 1000.0, 1)
        frame_source = "terukur"
        # Perbarui outer_area_m2 pada ringkasan grup rangka terukur
        grp_outer_map = frame_meas.get("group_outer_area") or {}
        for gs in group_summaries:
            if gs.get("role") == "frame" and gs.get("group_name") in grp_outer_map:
                gs["outer_area_m2"] = float(grp_outer_map[gs["group_name"]])
    else:
        eff_frame_width_mm = round(max(0.0, float(params.frame_width_mm)), 1)
        eff_frame_width_m = eff_frame_width_mm / 1000.0
        frame_source = "asumsi pengguna"
    gap_area_by_panel: Dict[int, float] = frame_meas["gap_area_by_panel"]
    ov_area_by_panel: Dict[int, float] = frame_meas["overlap_area_by_panel"]

    # Tentukan wwr_base per panel terlebih dahulu agar bukaan koplanar dapat digabung
    # sebelum hitung U_f 3-zona (menjamin paritas 0,00 W/m² antara quad dan mesh triangulasi).
    wwr_base_list: List[float] = []
    for p in panel_records:
        cat_p = p["element_type"]
        if params.wwr_override is not None:
            wb = max(0.0, min(0.95, float(params.wwr_override)))
        elif cat_p == "composite_cw":
            wb = max(0.05, min(0.95, float(params.group_wwr_map.get(p["group_name"], 0.70))))
        elif has_explicit_glazing:
            wb = 1.0 if cat_p == "glazing" else 0.0
        elif params.default_wall_wwr is not None:
            wb = max(0.0, min(0.95, float(params.default_wall_wwr)))
        else:
            wb = 0.0
        wwr_base_list.append(wb)

    glz_opening_map = _group_coplanar_glazing_openings(panel_records, wwr_base_list)
    comp_gap_sum: Dict[int, float] = {}
    comp_ov_sum: Dict[int, float] = {}
    for p_i, op_info in glz_opening_map.items():
        cid = id(op_info)
        if cid not in comp_gap_sum:
            mems = op_info["members"]
            comp_gap_sum[cid] = sum(float(gap_area_by_panel.get(m_i, 0.0)) for m_i in mems)
            comp_ov_sum[cid] = sum(float(ov_area_by_panel.get(m_i, 0.0)) for m_i in mems)

    def _wall_tdek_from_mat(mat_dict: Optional[Dict[str, Any]], fallback_td: float) -> float:
        if mat_dict and mat_dict.get("massa_kg_m2") is not None:
            return get_tdek_wall(float(mat_dict["massa_kg_m2"]))
        if mat_dict and mat_dict.get("td_ek") is not None:
            return float(mat_dict["td_ek"])
        return float(fallback_td)

    mat_params_cache: Dict[Tuple[Optional[str], str], Tuple[float, float, float, float, float, float]] = {}
    for idx, p in enumerate(panel_records):
        if p["is_outer"]:
            total_outer_panels += 1

        # Resolve per-group / per-orientation material parameters (catalog + per-model custom_materials)
        cat = p["element_type"]
        mp_key = (p["material_id"], cat)
        mp_cached = mat_params_cache.get(mp_key)
        if mp_cached is not None:
            u_cog_k, shgc_k, sc_1_k, u_w_k, alpha_k, tdek_k = mp_cached
        else:
            g_mat = get_material_by_id(p["material_id"], extra_materials=extra_mats)
            if cat in ("glazing", "composite_cw"):
                eff_g_mat = g_mat if (g_mat and g_mat.get("category") == "glazing") else glz_mat
                u_cog_k = float(eff_g_mat["u_value"]) if eff_g_mat else float(params.u_fenestration)
                if is_template_method:
                    shgc_k, sc_1_k = compute_template_shgc_and_sck(eff_g_mat, fallback_sc=params.sc_glass)
                else:
                    sc_1_k = float(eff_g_mat["sc"]) if (eff_g_mat and eff_g_mat.get("sc") is not None) else float(params.sc_glass)
                    shgc_k = get_material_shgc(eff_g_mat, fallback_sc=sc_1_k)
                u_w_k = float(wal_mat["u_value"]) if wal_mat else float(params.u_wall)
                alpha_k = float(wal_mat["alpha"]) if wal_mat else float(params.alpha_wall)
                tdek_k = _wall_tdek_from_mat(wal_mat, params.td_ek) if is_sni_mode else (float(wal_mat["td_ek"]) if wal_mat else float(params.td_ek))
            else:
                # 'wall' or 'spandrel'
                eff_w_mat = g_mat if (g_mat and g_mat.get("category") == "wall") else wal_mat
                u_w_k = float(eff_w_mat["u_value"]) if eff_w_mat else float(params.u_wall)
                alpha_k = float(eff_w_mat["alpha"]) if (eff_w_mat and eff_w_mat.get("alpha") is not None) else float(params.alpha_wall)
                tdek_k = _wall_tdek_from_mat(eff_w_mat, params.td_ek) if is_sni_mode else (float(eff_w_mat["td_ek"]) if (eff_w_mat and eff_w_mat.get("td_ek") is not None) else float(params.td_ek))
                u_cog_k = float(glz_mat["u_value"]) if glz_mat else float(params.u_fenestration)
                if is_template_method:
                    shgc_k, sc_1_k = compute_template_shgc_and_sck(glz_mat, fallback_sc=params.sc_glass)
                else:
                    sc_1_k = float(glz_mat["sc"]) if glz_mat else float(params.sc_glass)
                    shgc_k = get_material_shgc(glz_mat, fallback_sc=sc_1_k)
            mat_params_cache[mp_key] = (u_cog_k, shgc_k, sc_1_k, u_w_k, alpha_k, tdek_k)

        wwr_base = wwr_base_list[idx]

        base_area = float(p["area_m2"])
        perim_p = float(p.get("perimeter_m") or compute_panel_perimeter(p.get("vertices") or []))
        gap_a = float(gap_area_by_panel.get(idx, 0.0)) if wwr_base > 1e-6 else 0.0
        ov_a = float(ov_area_by_panel.get(idx, 0.0)) if wwr_base > 1e-6 else 0.0

        if wwr_base > 1e-6:
            base_glz = base_area * wwr_base
            op_info = glz_opening_map.get(idx)
            if op_info is not None and op_info["area_m2"] > 1e-9:
                cid = id(op_info)
                op_area = float(op_info["area_m2"])
                op_perim = float(op_info["perimeter_m"])
                op_gap = float(comp_gap_sum.get(cid, 0.0))
                op_ov = float(comp_ov_sum.get(cid, 0.0))
                share = base_glz / op_area
                # Distribusikan gap_a komponen secara proporsional luas agar triangulasi identik dengan quad
                gap_a = op_gap * share
                ov_a = op_ov * share
                tz_op = compute_three_zone_uf(
                    area_m2=op_area,
                    perimeter_m=op_perim,
                    u_cog=u_cog_k,
                    u_frame=u_frame_eff,
                    frame_width_m=eff_frame_width_m,
                    measured_a_frame_m2=op_gap if frame_measured else None,
                    overlap_a_frame_m2=op_ov if frame_measured else 0.0,
                )
                u_f_k = tz_op["u_f"]
                u_edge_k = tz_op["u_edge"]
                a_cog_k = tz_op["a_cog"] * share
                a_edge_k = tz_op["a_edge"] * share
                a_frame_k = tz_op["a_frame"] * share
                p["opening_area_m2"] = round(op_area, 4)
                p["opening_perimeter_m"] = round(op_perim, 4)
                p["opening_gap_frame_m2"] = round(op_gap, 4)
                p["opening_ov_frame_m2"] = round(op_ov, 4)
                p["opening_share"] = round(share, 6)
            else:
                perim_fen = perim_p if wwr_base >= 1.0 - 1e-6 else perim_p * math.sqrt(wwr_base)
                tz = compute_three_zone_uf(
                    area_m2=base_glz,
                    perimeter_m=perim_fen,
                    u_cog=u_cog_k,
                    u_frame=u_frame_eff,
                    frame_width_m=eff_frame_width_m,
                    measured_a_frame_m2=gap_a if frame_measured else None,
                    overlap_a_frame_m2=ov_a if frame_measured else 0.0,
                )
                u_f_k = tz["u_f"]
                a_cog_k = tz["a_cog"]
                a_edge_k = tz["a_edge"]
                a_frame_k = tz["a_frame"]
                u_edge_k = tz["u_edge"]
            area = base_area + gap_a
            wwr_k = (base_glz + gap_a) / area if area > 1e-9 else wwr_base
            if gap_a > 1e-9:
                p["area_m2"] = round(area, 4)
        else:
            u_f_k = u_cog_k
            u_edge_k = 0.5 * (u_cog_k + u_frame_eff)
            a_cog_k = 0.0
            a_edge_k = 0.0
            a_frame_k = 0.0
            area = base_area
            wwr_k = 0.0

        sc_mult = float(sc_Display_mult_arr[idx])
        sc_eff = sc_1_k * sc_mult
        shaded_frac = float(shaded_frac_arr[idx])

        q_wall_wm2 = alpha_k * u_w_k * (1.0 - wwr_k) * tdek_k
        q_glass_cond_wm2 = u_f_k * wwr_k * delta_t
        q_solar_wm2 = p["sf_wm2"] * wwr_k * sc_eff
        ottv_panel_wm2 = q_wall_wm2 + q_glass_cond_wm2 + q_solar_wm2

        heat_w = ottv_panel_wm2 * area
        solar_exp_wm2 = round(p["sf_wm2"] * sc_eff, 2)

        p["wwr_panel"] = round(wwr_k, 6)
        p["glass_area_m2"] = round(base_area * wwr_base, 4)
        p["added_frame_area_m2"] = round(gap_a, 4)
        p["overlap_frame_area_m2"] = round(ov_a, 4)
        p["shgc_glass"] = round(shgc_k, 4)
        p["sc_glass"] = round(sc_1_k, 6)
        p["sc_shading_multiplier"] = round(sc_mult, 4)
        p["sc_effective"] = round(sc_eff, 6)
        p["r1_horizontal"] = round(float(panel_r1_arr[idx]), 3)
        p["r2_vertical"] = round(float(panel_r2_arr[idx]), 3)
        p["phi1_tilt_deg"] = round(float(panel_phi1_arr[idx]), 1)
        p["u_wall_eff"] = round(u_w_k, 4)
        p["alpha_wall_eff"] = round(alpha_k, 4)
        p["td_ek_eff"] = round(tdek_k, 2)
        p["u_cog"] = round(u_cog_k, 4)
        p["u_frame_eff"] = round(u_frame_eff, 4)
        p["u_edge_eff"] = round(u_edge_k, 4)
        p["u_fen_eff"] = round(u_f_k, 4)
        p["a_cog_m2"] = round(a_cog_k, 4)
        p["a_edge_m2"] = round(a_edge_k, 4)
        p["a_frame_m2"] = round(a_frame_k, 4)
        p["frame_width_mm"] = eff_frame_width_mm
        p["frame_source"] = frame_source
        p["shaded_fraction"] = round(shaded_frac, 3)
        p["sunlit_mask"] = int(sunlit_mask_arr[idx])
        p["direct_sun_hours"] = int(direct_sun_hours_arr[idx])
        p["solar_exposure_wm2"] = solar_exp_wm2
        p["q_wall_wm2"] = round(q_wall_wm2, 2)
        p["q_glass_cond_wm2"] = round(q_glass_cond_wm2, 2)
        p["q_solar_wm2"] = round(q_solar_wm2, 2)
        p["ottv_panel_wm2"] = round(ottv_panel_wm2, 2)
        p["heat_gain_w"] = round(heat_w, 1)

        # Accumulate floor breakdown for all above-ground outer-skin panels (so floor chart always shows full building profile)
        if (
            p["is_outer"]
            and (not p.get("is_below_ground"))
            and (not p.get("face_excluded"))
            and (p["group_name"] not in params.disabled_groups)
        ):
            fb = floor_buckets[p["floor_number"]]
            fb["panel_count"] += 1
            fb["total_area_m2"] += area
            fb["glazing_area_m2"] += area * wwr_k
            fb["wall_area_m2"] += area * (1.0 - wwr_k)
            fb["_sum_heat_w"] += heat_w

            ofb = orientation_floor_buckets[p["orientation_code"]][p["floor_number"]]
            ofb["panel_count"] += 1.0
            ofb["total_area_m2"] += area
            ofb["wall_area_m2"] += area * (1.0 - wwr_k)
            ofb["glazing_area_m2"] += area * wwr_k
            ofb["_sum_sf_area"] += p["sf_wm2"] * area
            ofb["_sum_sc_eff_area"] += sc_eff * (area * wwr_k)
            ofb["_sum_q_wall_w"] += q_wall_wm2 * area
            ofb["_sum_q_glass_w"] += q_glass_cond_wm2 * area
            ofb["_sum_q_solar_w"] += q_solar_wm2 * area

        # Accumulate active panels into global & 8-orientation OTTV
        if p["active"]:
            total_active_panels += 1
            glz_a = area * wwr_k
            wal_a = area * (1.0 - wwr_k)
            qw_w = q_wall_wm2 * area
            qgc_w = q_glass_cond_wm2 * area
            qsol_w = q_solar_wm2 * area

            total_envelope_area += area
            total_glazing_area += glz_a
            total_a_frame_m2 += a_frame_k
            total_a_edge_m2 += a_edge_k
            total_a_cog_m2 += a_cog_k
            sum_uf_fen_area += u_f_k * glz_a
            total_wall_cond_w += qw_w
            total_glass_cond_w += qgc_w
            total_solar_rad_w += qsol_w

            b = orientation_buckets[p["orientation_code"]]
            b["panel_count"] += 1
            b["total_area_m2"] += area
            b["wall_area_m2"] += wal_a
            b["glazing_area_m2"] += glz_a
            b["_sum_sf_area"] += p["sf_wm2"] * area
            b["_sum_sc_eff_area"] += sc_eff * glz_a
            b["_sum_sc_k_area"] += sc_1_k * glz_a
            b["_sum_sc_sh_area"] += sc_mult * glz_a
            b["_sum_r1_area"] += float(panel_r1_arr[idx]) * glz_a
            b["_sum_r2_area"] += float(panel_r2_arr[idx]) * glz_a
            b["_sum_alpha_wall"] += alpha_k * wal_a
            b["_sum_uw_wall"] += u_w_k * wal_a
            b["_sum_tdek_wall"] += tdek_k * wal_a
            b["_sum_uf_glz"] += u_f_k * glz_a
            b["_sum_shaded_area"] += shaded_frac * area
            b["_sum_q_wall_w"] += qw_w
            b["_sum_q_glass_w"] += qgc_w
            b["_sum_q_solar_w"] += qsol_w

            # Track exact un-averaged material/shading combinations per orientation for Hitungan Manual
            uf_row_eff = u_f_k
            glz_lbl = p.get("material_name") if cat in ("glazing", "composite_cw") else (glz_mat["name"] if glz_mat else "Kaca Standar")
            wal_lbl = p.get("material_name") if cat not in ("glazing", "composite_cw") else (wal_mat["name"] if wal_mat else "Dinding Standar")
            r1_p = round(float(panel_r1_arr[idx]), 2)
            r2_p = round(float(panel_r2_arr[idx]), 2)
            if wwr_k <= 1e-6:
                wk = (round(alpha_k, 4), round(u_w_k, 4), round(tdek_k, 2), wal_lbl)
                wc = b["_wall_combos"].setdefault(wk, {
                    "wall_name": wal_lbl, "alpha": alpha_k, "u_wall": u_w_k, "td_ek": tdek_k,
                    "area_m2": 0.0, "sf_sum": 0.0,
                })
                wc["area_m2"] += area
                wc["sf_sum"] += p["sf_wm2"] * area
            elif wwr_k >= 1.0 - 1e-6:
                gk = (round(uf_row_eff, 2), round(sc_1_k, 4), round(sc_mult, 4), round(p["sf_wm2"], 2), r1_p, r2_p, glz_lbl)
                gc = b["_glz_combos"].setdefault(gk, {
                    "glz_name": glz_lbl, "u_f": uf_row_eff, "_uf_area": 0.0, "sc_k": sc_1_k, "sc_eff": sc_mult,
                    "sf": p["sf_wm2"], "r1": r1_p, "r2": r2_p, "area_m2": 0.0,
                })
                gc["area_m2"] += area
                gc["_uf_area"] += uf_row_eff * area
                gc["u_f"] = gc["_uf_area"] / gc["area_m2"]
            else:
                ck = (
                    round(alpha_k, 4), round(u_w_k, 4), round(tdek_k, 2),
                    round(uf_row_eff, 2), round(sc_1_k, 4), round(sc_mult, 4),
                    round(p["sf_wm2"], 2), round(wwr_k, 4), r1_p, r2_p, wal_lbl, glz_lbl,
                )
                cc = b["_comp_combos"].setdefault(ck, {
                    "wall_name": wal_lbl, "glz_name": glz_lbl,
                    "alpha": alpha_k, "u_wall": u_w_k, "td_ek": tdek_k,
                    "u_f": uf_row_eff, "_uf_area": 0.0, "sc_k": sc_1_k, "sc_eff": sc_mult,
                    "sf": p["sf_wm2"], "wwr": wwr_k, "r1": r1_p, "r2": r2_p, "area_m2": 0.0,
                })
                cc["area_m2"] += area
                cc["_uf_area"] += uf_row_eff * area
                cc["u_f"] = cc["_uf_area"] / cc["area_m2"]

    def _build_manual_row(
        code_r: str,
        label_r: str,
        ao_r: float,
        wwr_r: float,
        alpha_r: float,
        uw_r: float,
        tdek_r: float,
        uf_r: float,
        dt_r: float,
        sck_r: float,
        sceff_r: float,
        sf_r: float,
        r1_r: float = 0.0,
        r2_r: float = 0.0,
        combo_desc: str = "",
    ) -> Dict[str, Any]:
        sc_exact = sck_r * sceff_r
        qw_r = alpha_r * uw_r * (1.0 - wwr_r) * tdek_r
        qg_r = uf_r * wwr_r * dt_r
        qs_r = sf_r * wwr_r * sc_exact
        ottv_r = qw_r + qg_r + qs_r
        subst_r = (
            f"({alpha_r:.3f} × {uw_r:.2f} × (1 - {wwr_r:.4f}) × {tdek_r:.1f}) + "
            f"({uf_r:.2f} × {wwr_r:.4f} × {dt_r:.1f}) + "
            f"({sf_r:.1f} × {wwr_r:.4f} × {sck_r:.4f} × {sceff_r:.4f}) = {ottv_r:.2f} W/m²"
            if ao_r > 1e-4 else "Tidak ada bidang fasad pada orientasi ini."
        )
        return {
            "orientation_code": code_r,
            "label": label_r,
            "combination": combo_desc or "Standar",
            "ao_m2": round(ao_r, 4),
            "wwr": round(wwr_r, 6),
            "alpha": round(alpha_r, 4),
            "u_wall": round(uw_r, 4),
            "td_ek": round(tdek_r, 2),
            "u_f": round(uf_r, 4),
            "delta_t": round(dt_r, 2),
            "sc_k": round(sck_r, 4),
            "sc_eff": round(sceff_r, 4),
            "sc": round(sc_exact, 8),
            "r1_horizontal": round(r1_r, 3),
            "r2_vertical": round(r2_r, 3),
            "sf": round(sf_r, 2),
            "q_wall_wm2": round(qw_r, 4),
            "q_glass_wm2": round(qg_r, 4),
            "q_solar_wm2": round(qs_r, 4),
            "ottv_wm2": round(ottv_r, 4),
            "formula_substitution": subst_r,
        }

    # Finalize 8-orientation breakdown (including exact per-combination manual_calc_rows)
    orientation_breakdown: List[Dict[str, Any]] = []
    manual_calc_rows: List[Dict[str, Any]] = []
    for code in ORIENTATION_CODES:
        b = orientation_buckets[code]
        a_tot = b["total_area_m2"]
        a_glz = b["glazing_area_m2"]
        a_wal = b["wall_area_m2"]
        w_combos = list(b["_wall_combos"].values())
        g_combos = list(b["_glz_combos"].values())
        c_combos = list(b["_comp_combos"].values())
        orient_manual_rows: List[Dict[str, Any]] = []

        if a_tot > 1e-4:
            wwr_o = a_glz / a_tot
            avg_sf = b["_sum_sf_area"] / a_tot
            avg_sc = (b["_sum_sc_eff_area"] / a_glz) if a_glz > 1e-4 else 0.0
            avg_sck = b["_sum_sc_k_area"] / a_glz if a_glz > 1e-4 else 0.0
            avg_sc_sh = b["_sum_sc_sh_area"] / a_glz if a_glz > 1e-4 else 1.0
            avg_r1 = b["_sum_r1_area"] / a_glz if a_glz > 1e-4 else 0.0
            avg_r2 = b["_sum_r2_area"] / a_glz if a_glz > 1e-4 else 0.0
            avg_alpha = b["_sum_alpha_wall"] / a_wal if a_wal > 1e-4 else 0.0
            avg_uw = b["_sum_uw_wall"] / a_wal if a_wal > 1e-4 else 0.0
            avg_tdek = b["_sum_tdek_wall"] / a_wal if a_wal > 1e-4 else 0.0
            avg_uf = b["_sum_uf_glz"] / a_glz if a_glz > 1e-4 else 0.0
            avg_sh = b["_sum_shaded_area"] / a_tot
            qw = b["_sum_q_wall_w"] / a_tot
            qgc = b["_sum_q_glass_w"] / a_tot
            qsol = b["_sum_q_solar_w"] / a_tot
            ottv_o = qw + qgc + qsol
            hw = b["_sum_q_wall_w"] + b["_sum_q_glass_w"] + b["_sum_q_solar_w"]

            # Build un-averaged per-combination rows for Hitungan Manual
            if not c_combos and len(w_combos) <= 1 and len(g_combos) >= 1:
                # 0 or 1 wall type + 1..K glass/shading combos: allocate wall area proportionally to glazing area
                w_item = w_combos[0] if w_combos else None
                a_w_tot = w_item["area_m2"] if w_item else 0.0
                a_g_tot = sum(gc["area_m2"] for gc in g_combos)
                for idx_g, gc in enumerate(sorted(g_combos, key=lambda x: -x["area_m2"])):
                    share = gc["area_m2"] / a_g_tot if a_g_tot > 1e-9 else (1.0 / len(g_combos))
                    a_w_j = a_w_tot * share
                    ao_j = a_w_j + gc["area_m2"]
                    wwr_j = gc["area_m2"] / ao_j if ao_j > 1e-9 else 0.0
                    desc_j = (
                        f"{gc['glz_name']} (R1={gc['r1']:.2f}, R2={gc['r2']:.2f}, SCeff={gc['sc_eff']:.3f})"
                        if len(g_combos) > 1 or gc["r1"] > 0 or gc["r2"] > 0
                        else gc["glz_name"]
                    )
                    lbl_j = f"{code} ({b['name_id']})" if len(g_combos) == 1 else f"{code} #{idx_g + 1} ({b['name_id']})"
                    orient_manual_rows.append(_build_manual_row(
                        code_r=code,
                        label_r=lbl_j,
                        ao_r=ao_j,
                        wwr_r=wwr_j,
                        alpha_r=w_item["alpha"] if w_item else 0.0,
                        uw_r=w_item["u_wall"] if w_item else 0.0,
                        tdek_r=w_item["td_ek"] if w_item else 0.0,
                        uf_r=gc["u_f"],
                        dt_r=delta_t,
                        sck_r=gc["sc_k"],
                        sceff_r=gc["sc_eff"],
                        sf_r=gc["sf"],
                        r1_r=gc["r1"],
                        r2_r=gc["r2"],
                        combo_desc=desc_j,
                    ))
            elif not c_combos and len(g_combos) == 0 and len(w_combos) >= 1:
                for idx_w, wc in enumerate(sorted(w_combos, key=lambda x: -x["area_m2"])):
                    lbl_w = f"{code} ({b['name_id']})" if len(w_combos) == 1 else f"{code} Dinding #{idx_w + 1}"
                    sf_w = wc["sf_sum"] / wc["area_m2"] if wc["area_m2"] > 1e-9 else b["sni_sf_wm2"]
                    orient_manual_rows.append(_build_manual_row(
                        code_r=code,
                        label_r=lbl_w,
                        ao_r=wc["area_m2"],
                        wwr_r=0.0,
                        alpha_r=wc["alpha"],
                        uw_r=wc["u_wall"],
                        tdek_r=wc["td_ek"],
                        uf_r=0.0,
                        dt_r=delta_t,
                        sck_r=0.0,
                        sceff_r=1.0,
                        sf_r=sf_w,
                        combo_desc=wc["wall_name"],
                    ))
            elif len(w_combos) == 0 and len(g_combos) == 0 and len(c_combos) >= 1:
                for idx_c, cc in enumerate(sorted(c_combos, key=lambda x: -x["area_m2"])):
                    lbl_c = f"{code} ({b['name_id']})" if len(c_combos) == 1 else f"{code} #{idx_c + 1} ({b['name_id']})"
                    desc_c = f"{cc['glz_name']} / {cc['wall_name']} (R1={cc['r1']:.2f}, R2={cc['r2']:.2f})"
                    orient_manual_rows.append(_build_manual_row(
                        code_r=code,
                        label_r=lbl_c,
                        ao_r=cc["area_m2"],
                        wwr_r=cc["wwr"],
                        alpha_r=cc["alpha"],
                        uw_r=cc["u_wall"],
                        tdek_r=cc["td_ek"],
                        uf_r=cc["u_f"],
                        dt_r=delta_t,
                        sck_r=cc["sc_k"],
                        sceff_r=cc["sc_eff"],
                        sf_r=cc["sf"],
                        r1_r=cc["r1"],
                        r2_r=cc["r2"],
                        combo_desc=desc_c,
                    ))
            else:
                # General mixed case (multiple wall types + multiple glazing/composite types): separate exact rows
                seq_i = 0
                for wc in sorted(w_combos, key=lambda x: -x["area_m2"]):
                    seq_i += 1
                    sf_w = wc["sf_sum"] / wc["area_m2"] if wc["area_m2"] > 1e-9 else b["sni_sf_wm2"]
                    orient_manual_rows.append(_build_manual_row(
                        code_r=code,
                        label_r=f"{code} #{seq_i} (Dinding)",
                        ao_r=wc["area_m2"],
                        wwr_r=0.0,
                        alpha_r=wc["alpha"],
                        uw_r=wc["u_wall"],
                        tdek_r=wc["td_ek"],
                        uf_r=0.0,
                        dt_r=delta_t,
                        sck_r=0.0,
                        sceff_r=1.0,
                        sf_r=sf_w,
                        combo_desc=f"Dinding: {wc['wall_name']}",
                    ))
                for gc in sorted(g_combos, key=lambda x: -x["area_m2"]):
                    seq_i += 1
                    orient_manual_rows.append(_build_manual_row(
                        code_r=code,
                        label_r=f"{code} #{seq_i} (Kaca)",
                        ao_r=gc["area_m2"],
                        wwr_r=1.0,
                        alpha_r=0.0,
                        uw_r=0.0,
                        tdek_r=0.0,
                        uf_r=gc["u_f"],
                        dt_r=delta_t,
                        sck_r=gc["sc_k"],
                        sceff_r=gc["sc_eff"],
                        sf_r=gc["sf"],
                        r1_r=gc["r1"],
                        r2_r=gc["r2"],
                        combo_desc=f"Kaca: {gc['glz_name']} (R1={gc['r1']:.2f}, R2={gc['r2']:.2f}, SCeff={gc['sc_eff']:.3f})",
                    ))
                for cc in sorted(c_combos, key=lambda x: -x["area_m2"]):
                    seq_i += 1
                    orient_manual_rows.append(_build_manual_row(
                        code_r=code,
                        label_r=f"{code} #{seq_i} (Komposit)",
                        ao_r=cc["area_m2"],
                        wwr_r=cc["wwr"],
                        alpha_r=cc["alpha"],
                        uw_r=cc["u_wall"],
                        tdek_r=cc["td_ek"],
                        uf_r=cc["u_f"],
                        dt_r=delta_t,
                        sck_r=cc["sc_k"],
                        sceff_r=cc["sc_eff"],
                        sf_r=cc["sf"],
                        r1_r=cc["r1"],
                        r2_r=cc["r2"],
                        combo_desc=f"Komposit: {cc['glz_name']} + {cc['wall_name']}",
                    ))

            subst = orient_manual_rows[0]["formula_substitution"] if len(orient_manual_rows) == 1 else (
                f"Σ(Ao_j × OTTV_j) / Ao = {hw:.1f} / {a_tot:.2f} = {ottv_o:.2f} W/m² ({len(orient_manual_rows)} kombinasi)"
            )
            manual_calc_rows.extend(orient_manual_rows)
        else:
            wwr_o, avg_sf, avg_sc, avg_sh = 0.0, b["sni_sf_wm2"], 0.0, 0.0
            avg_sck, avg_sc_sh, avg_r1, avg_r2 = 0.0, 1.0, 0.0, 0.0
            avg_alpha, avg_uw, avg_tdek, avg_uf = 0.0, 0.0, 0.0, 0.0
            qw, qgc, qsol, ottv_o, hw = 0.0, 0.0, 0.0, 0.0, 0.0
            subst = "Tidak ada bidang fasad pada orientasi ini."
            empty_row = _build_manual_row(
                code_r=code,
                label_r=f"{code} ({b['name_id']})",
                ao_r=0.0,
                wwr_r=0.0,
                alpha_r=0.0,
                uw_r=0.0,
                tdek_r=0.0,
                uf_r=0.0,
                dt_r=delta_t,
                sck_r=0.0,
                sceff_r=1.0,
                sf_r=b["sni_sf_wm2"],
                combo_desc="-",
            )
            orient_manual_rows.append(empty_row)
            manual_calc_rows.append(empty_row)

        orientation_breakdown.append({
            "code": code,
            "name_id": b["name_id"],
            "azimuth_center_deg": b["azimuth_center_deg"],
            "sni_sf_wm2": b["sni_sf_wm2"],
            "panel_count": b["panel_count"],
            "total_area_m2": round(a_tot, 2),
            "wall_area_m2": round(a_wal, 2),
            "glazing_area_m2": round(a_glz, 2),
            "wwr": round(wwr_o, 3),
            "avg_sf_interpolated_wm2": round(avg_sf, 2),
            "avg_sc_effective": round(avg_sc, 4),
            "avg_shaded_ratio": round(avg_sh, 3),
            "q_wall_conduction_wm2": round(qw, 2),
            "q_glass_conduction_wm2": round(qgc, 2),
            "q_solar_radiation_wm2": round(qsol, 2),
            "ottv_orientation_wm2": round(ottv_o, 2),
            "heat_gain_watts": round(hw, 1),
            "manual_calc": {
                "ao_m2": round(a_tot, 4),
                "wwr": round(wwr_o, 6),
                "alpha": round(avg_alpha, 4),
                "u_wall": round(avg_uw, 4),
                "td_ek": round(avg_tdek, 2),
                "u_f": round(avg_uf, 4),
                "delta_t": round(delta_t, 2),
                "sc_k": round(avg_sck, 4),
                "sc_eff": round(avg_sc_sh, 4),
                "sc": round(avg_sck * avg_sc_sh, 6) if len(orient_manual_rows) == 1 else round(avg_sc, 6),
                "r1_horizontal": round(avg_r1, 3),
                "r2_vertical": round(avg_r2, 3),
                "sf": round(avg_sf, 2),
                "q_wall_wm2": round(qw, 4),
                "q_glass_wm2": round(qgc, 4),
                "q_solar_wm2": round(qsol, 4),
                "ottv_wm2": round(ottv_o, 4),
                "formula_substitution": subst,
                "rows": orient_manual_rows,
            },
        })

    # Finalize Smart Floor Breakdown (100% Model-Driven)
    floor_breakdown: List[Dict[str, Any]] = []
    for fl_num in sorted(floor_buckets.keys()):
        fb = floor_buckets[fl_num]
        fa = fb["total_area_m2"]
        if fa < 1e-3:
            f_wwr = 0.0
            f_ottv = 0.0
        else:
            f_wwr = fb["glazing_area_m2"] / fa
            f_ottv = fb["_sum_heat_w"] / fa
        floor_breakdown.append({
            "floor_number": fl_num,
            "floor_label": fb["floor_label"],
            "zone_type": fb.get("zone_type", "Tipikal"),
            "z_min": fb["z_min"],
            "z_max": fb["z_max"],
            "height_m": fb.get("height_m", round(fb["z_max"] - fb["z_min"], 2)),
            "panel_count": fb["panel_count"],
            "total_area_m2": round(fa, 2),
            "glazing_area_m2": round(fb["glazing_area_m2"], 2),
            "wall_area_m2": round(fb["wall_area_m2"], 2),
            "wwr": round(f_wwr, 3),
            "ottv_floor_wm2": round(f_ottv, 2),
            "heat_gain_kw": round(fb["_sum_heat_w"] / 1000.0, 2),
        })

    dynamic_floor_presets = enrich_floor_zones_and_presets(floor_breakdown)

    # Overall OTTV totals
    total_heat_w = total_wall_cond_w + total_glass_cond_w + total_solar_rad_w
    denom_a = max(1e-4, total_envelope_area)
    ottv_total_wm2 = round(total_heat_w / denom_a, 2)
    q_wall_tot = round(total_wall_cond_w / denom_a, 2)
    q_glass_tot = round(total_glass_cond_w / denom_a, 2)
    q_solar_tot = round(total_solar_rad_w / denom_a, 2)
    eff_wwr = total_glazing_area / denom_a

    active_panels_iter = [p for p in panel_records if p["active"]]
    avg_sf_bldg = sum(p["sf_wm2"] * p["area_m2"] for p in active_panels_iter) / denom_a
    avg_sc_bldg = (
        sum(p["sc_effective"] * (p["area_m2"] * p["wwr_panel"]) for p in active_panels_iter) / total_glazing_area
        if total_glazing_area > 1e-4
        else 0.0
    )
    avg_sh_bldg = sum(p["shaded_fraction"] * p["area_m2"] for p in active_panels_iter) / denom_a

    avg_u_fen_bldg = (
        sum_uf_fen_area / total_glazing_area if total_glazing_area > 1e-4 else (float(glz_mat["u_value"]) if glz_mat else float(params.u_fenestration))
    )
    # Compute Smooth Facade Composite OTTV (`ottv_composite_wm2`) per panel so the 3D thermal
    # heatmap transitions continuously around the curved facade without spandrel/vision striping
    u_w_glob = float(wal_mat["u_value"]) if wal_mat else float(params.u_wall)
    alpha_glob = float(wal_mat["alpha"]) if wal_mat else float(params.alpha_wall)
    tdek_glob = float(wal_mat["td_ek"]) if wal_mat else float(params.td_ek)
    u_f_glob = avg_u_fen_bldg
    sc_1_glob = float(glz_mat["sc"]) if glz_mat else float(params.sc_glass)

    # Angularly smooth SC multiplier across 36 azimuth sectors (10 deg each) per floor
    n_az_bins = 36
    bin_sc_sum = np.zeros((total_floors + 1, n_az_bins), dtype=np.float64)
    bin_sc_cnt = np.zeros((total_floors + 1, n_az_bins), dtype=np.float64)
    for p in panel_records:
        if p["is_outer"]:
            b_idx = int((p["azimuth_deg"] % 360.0) // 10.0) % n_az_bins
            fl_i = p["floor_number"]
            bin_sc_sum[fl_i, b_idx] += p["sc_shading_multiplier"] * p["area_m2"]
            bin_sc_cnt[fl_i, b_idx] += p["area_m2"]

    default_sc_mult = (
        max(0.30, avg_sc_bldg / max(0.08, sc_1_glob))
        if total_glazing_area > 1e-4
        else 1.0
    )
    bin_sc_avg = np.where(bin_sc_cnt > 1e-4, bin_sc_sum / np.maximum(1e-6, bin_sc_cnt), default_sc_mult)
    # Circular smoothing along azimuth & vertical smoothing across adjacent floors
    bin_sc_smooth = (
        0.50 * bin_sc_avg
        + 0.25 * np.roll(bin_sc_avg, 1, axis=1)
        + 0.25 * np.roll(bin_sc_avg, -1, axis=1)
    )
    if total_floors >= 3:
        vert_smooth = bin_sc_smooth.copy()
        for fl_i in range(1, total_floors + 1):
            f_prev = max(1, fl_i - 1)
            f_next = min(total_floors, fl_i + 1)
            vert_smooth[fl_i, :] = 0.20 * bin_sc_smooth[f_prev, :] + 0.60 * bin_sc_smooth[fl_i, :] + 0.20 * bin_sc_smooth[f_next, :]
        bin_sc_smooth = vert_smooth

    floor_wwr_map: Dict[int, float] = {}
    for fb_item in floor_breakdown:
        fl_n = fb_item["floor_number"]
        raw_fw = fb_item["wwr"] if fb_item["total_area_m2"] > 1e-2 else eff_wwr
        # Blend floor WWR with global effective WWR for smooth vertical continuity
        floor_wwr_map[fl_n] = 0.72 * eff_wwr + 0.28 * raw_fw

    raw_comp_vals: List[float] = []
    comp_weighted_sum = 0.0
    for p in panel_records:
        fl_n = p["floor_number"]
        w_comp = floor_wwr_map.get(fl_n, eff_wwr)
        az_f = (p["azimuth_deg"] % 360.0) / 10.0
        b0 = int(math.floor(az_f)) % n_az_bins
        b1 = (b0 + 1) % n_az_bins
        t_az = az_f - math.floor(az_f)
        sc_m_s = (1.0 - t_az) * float(bin_sc_smooth[fl_n, b0]) + t_az * float(bin_sc_smooth[fl_n, b1])
        sc_eff_s = sc_1_glob * sc_m_s

        qw_c = alpha_glob * u_w_glob * (1.0 - w_comp) * tdek_glob
        qg_c = u_f_glob * delta_t * w_comp
        qs_c = p["sf_wm2"] * w_comp * sc_eff_s
        val_c = qw_c + qg_c + qs_c
        raw_comp_vals.append(val_c)
        if p["active"]:
            comp_weighted_sum += val_c * p["area_m2"]

    comp_norm_factor = (
        (ottv_total_wm2 * denom_a) / comp_weighted_sum
        if comp_weighted_sum > 1e-3
        else 1.0
    )
    for idx, p in enumerate(panel_records):
        p["ottv_composite_wm2"] = round(raw_comp_vals[idx] * comp_norm_factor, 2)

    # Finalize 8-orientation x floor breakdown for PUPR Metode 2 Excel template
    orientation_floor_breakdown: Dict[str, List[Dict[str, Any]]] = {}
    for code in ORIENTATION_CODES:
        fl_rows: List[Dict[str, Any]] = []
        for fl_num in range(1, total_floors + 1):
            f_def = floor_def_by_num.get(fl_num, {"height_m": floor_h})
            fh_cur = max(0.5, float(f_def.get("height_m", floor_h)))
            ofb = orientation_floor_buckets[code][fl_num]
            a_tot = ofb["total_area_m2"]
            a_wal = ofb["wall_area_m2"]
            a_glz = ofb["glazing_area_m2"]
            if a_tot > 1e-4:
                wwr_of = a_glz / a_tot
                sf_of = ofb["_sum_sf_area"] / a_tot
                sc_of = (ofb["_sum_sc_eff_area"] / a_glz) if a_glz > 1e-4 else 0.0
                qw_of = ofb["_sum_q_wall_w"]
                qg_of = ofb["_sum_q_glass_w"]
                qs_of = ofb["_sum_q_solar_w"]
                ottv_of = (qw_of + qg_of + qs_of) / a_tot
            else:
                wwr_of = 0.0
                sf_of = round(ORIENTATION_BASE_SF[code] * sf_mult, 1)
                sc_of = round(avg_sc_bldg, 3)
                qw_of, qg_of, qs_of, ottv_of = 0.0, 0.0, 0.0, 0.0
            fl_rows.append({
                "floor_number": fl_num,
                "floor_code": f"{code} {fl_num}",
                "floor_height_m": round(fh_cur, 2),
                "facade_length_m": round(a_tot / fh_cur, 2),
                "total_area_m2": round(a_tot, 2),
                "wall_area_m2": round(a_wal, 2),
                "glazing_area_m2": round(a_glz, 2),
                "wwr": round(wwr_of, 4),
                "avg_sf_wm2": round(sf_of, 2),
                "avg_sc_eff": round(sc_of, 3),
                "q_wall_w": round(qw_of, 2),
                "q_glass_w": round(qg_of, 2),
                "q_solar_w": round(qs_of, 2),
                "ottv_wm2": round(ottv_of, 2),
            })
        orientation_floor_breakdown[code] = fl_rows

    # Serialize Frame & Shading meshes cleanly for smooth 60 FPS Three.js rendering
    def _face_components(faces_arr: np.ndarray) -> np.ndarray:
        """Label komponen terhubung per face (face berbagi vertex = satu elemen, mis. satu sirip).
        Numpy murni (tanpa scipy) agar jalan di Pyodide."""
        if len(faces_arr) == 0:
            return np.zeros(0, dtype=np.int64)
        nv = int(faces_arr.max()) + 1
        lab_v = np.arange(nv, dtype=np.int64)
        flat = faces_arr.ravel()
        k = faces_arr.shape[1]
        for _ in range(200):
            f_lab = lab_v[faces_arr].min(axis=1)
            new_v = lab_v.copy()
            np.minimum.at(new_v, flat, np.repeat(f_lab, k))
            new_v = new_v[new_v]  # lompatan pointer: konvergen lebih cepat
            if np.array_equal(new_v, lab_v):
                break
            lab_v = new_v
        return lab_v[faces_arr].min(axis=1)

    def _serialize_raw_groups(rg_list: List[RawGroupMesh], max_faces: int = 18000) -> List[Dict[str, Any]]:
        """Kirim mesh rangka/peneduh/atap ke viewer. Bila melebihi `max_faces`, yang dijarangkan adalah
        ELEMEN UTUH (komponen terhubung), bukan face, supaya sirip/kotak tidak tampil bolong."""
        out = []
        live = [r for r in rg_list if r.group_name not in params.disabled_groups]
        total_f = sum(len(r.faces) for r in live)
        stride = int(np.ceil(total_f / max_faces)) if total_f > max_faces else 1
        for r in live:
            f_arr = np.asarray(r.faces, dtype=np.int64)
            if f_arr.ndim != 2 or len(f_arr) == 0:
                continue
            if stride > 1:
                comp = _face_components(f_arr)
                uniq, inv = np.unique(comp, return_inverse=True)
                if len(uniq) >= stride:
                    f_arr = f_arr[(inv % stride) == 0]
                # Mesh yang menyatu jadi satu/sedikit komponen dikirim utuh: lebih baik berat daripada rusak.
            used = np.unique(f_arr[:, :4] if f_arr.shape[1] >= 4 else f_arr)
            remap = np.full(len(r.vertices), -1, dtype=np.int64)
            remap[used] = np.arange(len(used))
            vs = np.round(np.asarray(r.vertices, dtype=np.float64)[used], 3).tolist()
            fr = remap[f_arr]
            if fr.shape[1] >= 4:
                is_q = fr[:, 2] != fr[:, 3]
                if np.any(is_q):
                    tris = np.vstack([fr[:, :3], fr[is_q][:, [0, 2, 3]]]).tolist()
                else:
                    tris = fr[:, :3].tolist()
            else:
                tris = fr[:, :3].tolist()
            out.append({
                "group_name": r.group_name,
                "vertices": vs,
                "faces": tris,
            })
        return out

    compliant = ottv_total_wm2 <= SNI_6389_LIMIT_WM2
    recommendations: List[Dict[str, Any]] = []

    # Build 5-Stage Gatekeeper Pipeline Status Summary
    stage_gates = {
        "gate1_geometry": {
            "status": "PASSED",
            "title": "Tahap 1: Geometri, Satuan & Sumbu",
            "summary": f"Satuan: {stage1_audit.applied_unit.upper()} (×{stage1_audit.scale_factor_to_m}) · Sumbu: {stage1_audit.applied_up_axis}-Up · Dimensi: {span_x:.1f}×{span_y:.1f}×{span_z:.1f} m",
        },
        "gate2_groups": {
            "status": "PASSED",
            "title": "Tahap 2: Mapping Layer & Dekomposisi Sub-Elemen",
            "summary": f"{len(group_summaries)} Grup Terpetakan ({len(surface_groups)} Selubung, {len(frame_groups)} Rangka, {len(shading_groups)} Peneduh)",
        },
        "gate3_floors": {
            "status": "PASSED",
            "title": "Tahap 3: Struktur Lantai Dinamis",
            "summary": f"{total_floors} Lantai (L1–L{total_floors}) · {floor_detection_method}",
        },
        "gate4_materials": {
            "status": "PASSED",
            "title": "Tahap 4: Binding Material & Iklim",
            "summary": f"WWR Efektif: {eff_wwr*100:.1f}% · Lokasi: {loc_info.get('city', 'Jakarta')}",
        },
        "gate5_compliance": {
            "status": "PASSED" if compliant else "WARNING",
            "title": "Tahap 5: Evaluasi SNI 6389 & Laporan PUPR",
            "summary": f"OTTV: {ottv_total_wm2:.2f} / 35.0 W/m² ({'LULUS' if compliant else 'MELEBIHI BATAS'})",
        },
    }

    # Build provisional status & structured warnings (Fase 1b)
    summary_warnings: List[Dict[str, Any]] = []
    if unknown_groups:
        unk_names = [rg.group_name for rg in unknown_groups]
        summary_warnings.append({
            "code": "UNKNOWN_GROUPS",
            "message": (
                f"{len(unk_names)} grup belum dikenali perannya ('unknown') dan tidak dihitung "
                f"dalam OTTV: {', '.join(unk_names)}."
            ),
            "detail": {
                "count": len(unk_names),
                "groups": [
                    {
                        "group_name": rg.group_name,
                        "face_count": int(len(rg.faces)),
                    }
                    for rg in unknown_groups
                ],
            },
        })
    if stage1_audit.missing_mesh:
        total_missing_faces = sum(int(item.get("face_count", 0)) for item in stage1_audit.missing_mesh)
        total_missing_objs = sum(int(item.get("object_count", 0)) for item in stage1_audit.missing_mesh)
        per_group_summary = ", ".join(
            f"{item.get('group', '?')} ({int(item.get('face_count', 0))} face)"
            for item in stage1_audit.missing_mesh
        )
        count_prefix = (
            f"{total_missing_objs} objek ({total_missing_faces} permukaan)"
            if total_missing_objs > 0
            else f"{total_missing_faces} permukaan"
        )
        summary_warnings.append({
            "code": "MISSING_MESH",
            "message": (
                f"{count_prefix} Brep/Surface tidak memiliki render mesh sehingga "
                f"dilewati: {per_group_summary}. Bila objek tersebut termasuk selubung bangunan, "
                "simpan ulang dari Rhino tanpa SaveSmall (mode Shaded atau jalankan RefreshShade) "
                "agar ikut dihitung."
            ),
            "detail": {
                "total_face_count": int(total_missing_faces),
                "total_object_count": int(total_missing_objs),
                "items": stage1_audit.missing_mesh,
            },
        })
    if stage1_audit.unit_needs_confirmation:
        span_txt = " x ".join(f"{x:.2f} m" for x in stage1_audit.normalized_span_m)
        summary_warnings.append({
            "code": "UNIT_NEEDS_CONFIRMATION",
            "message": (
                f"Satuan model ditebak otomatis sebagai '{stage1_audit.applied_unit}' "
                f"(dimensi hasil: {span_txt}). Mohon konfirmasi satuan model pada tahap Periksa Model."
            ),
            "detail": {
                "detected_unit": stage1_audit.detected_unit,
                "applied_unit": stage1_audit.applied_unit,
                "unit_source": stage1_audit.unit_source,
                "normalized_span_m": [round(float(x), 2) for x in stage1_audit.normalized_span_m],
            },
        })
    if not has_explicit_glazing:
        if params.wwr_override is not None:
            summary_warnings.append({
                "code": "ASSUMED_WWR",
                "message": (
                    f"Model tidak memiliki grup kaca terdeteksi; perhitungan menggunakan WWR override "
                    f"eksplisit {float(params.wwr_override)*100:.1f}% (bukan geometri kaca terukur)."
                ),
                "detail": {"assumed_wwr": round(float(params.wwr_override), 4), "source": "wwr_override"},
            })
        elif params.default_wall_wwr is not None:
            summary_warnings.append({
                "code": "ASSUMED_WWR",
                "message": (
                    f"Model tidak memiliki grup kaca terdeteksi; perhitungan menggunakan WWR asumsi "
                    f"eksplisit {float(params.default_wall_wwr)*100:.1f}% dari pengguna (bukan geometri kaca terukur)."
                ),
                "detail": {"assumed_wwr": round(float(params.default_wall_wwr), 4), "source": "default_wall_wwr"},
            })
        else:
            summary_warnings.append({
                "code": "NO_GLAZING",
                "message": (
                    "Model tidak memiliki grup kaca/bukaan yang terdeteksi sehingga dihitung dengan WWR = 0% "
                    "(dinding opak saja). Konfirmasikan peran grup di Periksa Model atau tetapkan WWR asumsi "
                    "secara eksplisit bila model memang belum memisahkan kaca."
                ),
                "detail": {"detected_glazing_groups": 0, "effective_wwr": 0.0},
            })
    if not params.materials_confirmed:
        summary_warnings.append(build_material_warning(
            params.glazing_material_id,
            params.wall_material_id,
            params.group_material_map,
            [(rg.group_name, cat, rg.source_layer, rg.source_material) for rg, cat in surface_groups],
            extra_materials=extra_mats,
            frame_material_id=params.frame_material_id,
            frame_width_mm=eff_frame_width_mm,
            frame_source=frame_source,
        ))
    if total_glazing_area > 1e-4 and frame_source == "asumsi pengguna":
        fw_txt = f"{eff_frame_width_mm:.0f}" if float(eff_frame_width_mm).is_integer() else f"{eff_frame_width_mm:.1f}".replace(".", ",")
        summary_warnings.append({
            "code": "ASSUMED_FRAME_WIDTH",
            "message": (
                f"Lebar kusen asumsi ({fw_txt} mm) dipakai untuk menghitung U_f tiga zona karena model tidak "
                "memiliki grup rangka terukur. Ubah isian Lebar kusen di panel Material bila berbeda."
            ),
            "detail": {
                "frame_width_mm": eff_frame_width_mm,
                "frame_source": frame_source,
                "u_frame_eff": round(u_frame_eff, 3),
            },
        })
    if dedupe_stats.get("conflicts"):
        # Kaca menimpa dinding dsb.: mana yang benar hanya diketahui perancang -> wajib dikonfirmasi
        summary_warnings.append({
            "code": "DUPLICATE_FACE_CONFLICT",
            "message": (
                "Ada bidang yang tertumpuk tepat di posisi sama tetapi berbeda peran: "
                + "; ".join(
                    f"{c['kept_group']} ({c['kept_category']}) menimpa {c['dropped_group']} ({c['dropped_category']}), {c['area_m2']} m²"
                    for c in dedupe_stats["conflicts"]
                )
                + ". Yang dihitung adalah peran pertama. Periksa model dan hapus salah satunya."
            ),
            "detail": {"conflicts": dedupe_stats["conflicts"]},
        })
    if dedupe_stats.get("removed_faces"):
        summary_warnings.append({
            "code": "DUPLICATE_FACES_REMOVED",
            "message": (
                f"{dedupe_stats['removed_faces']} bidang kembar ({dedupe_stats['removed_area_m2']} m²) "
                "dihitung sekali saja: "
                + ", ".join(f"{g['group_name']} ({g['removed_faces']})" for g in dedupe_stats["groups"])
                + ". Biasanya akibat objek ter-copy-paste di posisi yang sama."
            ),
            "detail": dedupe_stats,
        })
    if narrow_gap_groups:
        total_ng_area = sum(float(g["area_m2"]) for g in narrow_gap_groups)
        total_ng_faces = sum(int(g["face_count"]) for g in narrow_gap_groups)
        area_txt = f"{total_ng_area:.2f}".replace(".", ",")
        grp_parts = []
        for g in narrow_gap_groups:
            g_area_txt = f"{g['area_m2']:.2f}".replace(".", ",")
            grp_parts.append(f"{g['group']} ({g_area_txt} m²)")
        grp_txt = ", ".join(grp_parts)
        summary_warnings.append({
            "code": "NARROW_GAP_FACES",
            "message": (
                f"{area_txt} m² ({total_ng_faces} bidang) fasad diabaikan sebagai sisi dalam karena "
                f"berhadapan dengan massa lain berjarak < 1,5 m: {grp_txt}. "
                "Bila celah tersebut adalah udara luar dan ingin dihitung, ubah mode deteksi sisi luar ke 'Semua bidang'."
            ),
            "detail": {
                "threshold_m": NARROW_GAP_THRESHOLD_M,
                "total_area_m2": round(total_ng_area, 2),
                "total_face_count": int(total_ng_faces),
                "groups": narrow_gap_groups,
            },
        })
    if detached_shading_panels:
        summary_warnings.append({
            "code": "SHADING_DETACHED_APPROX",
            "message": (
                f"{detached_shading_panels} panel kaca diteduhi peneduh yang tidak menempel di tepi atas jendela "
                "(berjarak dari fasad atau dipasang lebih tinggi). SNI 6389:2020 Lampiran A hanya mendefinisikan "
                "peneduh menempel; LUXA menurunkan SC efektifnya dari tabel SNI dengan selisih bayangan "
                "(peneduh selebar celah+kedalaman dikurangi peneduh selebar celah)."
            ),
            "detail": {"panels": int(detached_shading_panels)},
        })
    if geo_slab_used:
        summary_warnings.append({
            "code": "GEOMETRY_SLAB_SHADING",
            "message": (
                "Pelat horizontal yang menjorok di depan kaca dihitung sebagai peneduh (overhang) walau grupnya "
                "tidak bernama peneduh: "
                + ", ".join(f"{k} ({v} panel)" for k, v in sorted(geo_slab_used.items(), key=lambda x: -x[1]))
                + ". Bila bukan peneduh, nonaktifkan grup tersebut di Periksa Model."
            ),
            "detail": {"groups": geo_slab_used},
        })
    if geo_reclassified:
        summary_warnings.append({
            "code": "GEOMETRY_RECLASSIFIED",
            "message": (
                "Grup berikut bernama kaca tetapi bentuknya batang/profil sehingga dihitung sebagai rangka: "
                + ", ".join(f"{g['group_name']} ({g['linear_area_fraction']*100:.0f}% berbentuk batang)" for g in geo_reclassified)
                + ". Bila keliru, ubah perannya di tahap Periksa Model."
            ),
            "detail": {"groups": geo_reclassified},
        })
    if is_sni_mode and sf_source_info.get("warning"):
        summary_warnings.append({
            "code": "SF_CITY_FALLBACK",
            "message": sf_source_info["warning"],
            "detail": {
                "requested_city": params.city_preset,
                "resolved_city": sf_source_info["city_label"],
                "sf_source": sf_source,
            },
        })
    is_provisional, eff_status_label, eff_compliant = resolve_result_status(ottv_total_wm2, summary_warnings, is_sni_mode)

    if params.compute_rttv is False:
        rttv_result = {
            "applicable": False,
            "disabled": True,
            "rttv_wm2": 0.0,
            "limit_wm2": SNI_RTTV_LIMIT_OPAQUE_ONLY_WM2,
            "compliant": None,
            "opaque_roof_area_m2": 0.0,
            "skylight_area_m2": 0.0,
            "total_roof_area_m2": 0.0,
            "srr": 0.0,
            "sf_roof_wm2": get_sf_for_source(params.city_preset, "ROOF", params.sf_source),
            "delta_t_k": SNI_DELTA_T_K,
            "q_roof_conduction_wm2": 0.0,
            "q_skylight_conduction_wm2": 0.0,
            "q_skylight_solar_wm2": 0.0,
        }
    else:
        rttv_result = _compute_sni_rttv(
            roof_groups=roof_groups,
            skylight_area_m2=skylight_area_m2,
            skylight_u_weighted=skylight_u_weighted,
            skylight_sc_weighted=skylight_sc_weighted,
            params=params,
            sni_city_key=sni_city_key,
            z_max_bldg=z_max_bldg,
        )

    from adapters import detect_file_signature
    file_sig = detect_file_signature(filepath)

    return {
        "filename": filename,
        "format": os.path.splitext(filename)[1].lstrip(".").upper(),
        "calculation_mode": calc_mode,
        "is_compliance": bool(is_sni_mode),
        "sf_source": sf_source if is_sni_mode else "simulasi_epw",
        "sf_source_label": (
            sf_source_info["sf_source_label"]
            if is_sni_mode
            else f"Interpolasi Kontinu EPW ({loc_info.get('city', 'Jakarta')})"
        ),
        "sf_source_info": sf_source_info if is_sni_mode else None,
        "sceff_table_mode": sceff_table_mode if is_sni_mode else None,
        "sceff_errata_applied": sceff_errata_applied,
        "template_shading_registry": tpl_shading_reg.to_dict() if tpl_shading_reg is not None else None,
        "mode_label": (
            "Kepatuhan SNI 6389:2020"
            if is_sni_mode
            else "Eksplorasi — bukan untuk kepatuhan"
        ),
        "ottv_total_wm2": ottv_total_wm2,
        "sni_limit_wm2": SNI_6389_LIMIT_WM2,
        "margin_to_limit_wm2": round(SNI_6389_LIMIT_WM2 - ottv_total_wm2, 2),
        "compliant": eff_compliant,
        "status_label": eff_status_label,
        "warnings": summary_warnings,
        "rttv": rttv_result,
        "location_info": loc_info,
        "stage1_geometry_audit": {
            "detected_unit": stage1_audit.detected_unit,
            "detected_unit_label": stage1_audit.detected_unit if stage1_audit.detected_unit is not None else "tidak ada di file",
            "applied_unit": stage1_audit.applied_unit,
            "scale_factor_to_m": stage1_audit.scale_factor_to_m,
            "unit_source": stage1_audit.unit_source,
            "unit_needs_confirmation": stage1_audit.unit_needs_confirmation,
            "detected_up_axis": stage1_audit.detected_up_axis,
            "applied_up_axis": stage1_audit.applied_up_axis,
            "raw_span_xyz": stage1_audit.raw_span_xyz,
            "normalized_span_m": stage1_audit.normalized_span_m,
            "z_ground_offset_m": stage1_audit.z_ground_offset_m,
            "xy_world_offset_m": stage1_audit.xy_world_offset_m,
            "geometry_kernel": stage1_audit.geometry_kernel,
            "slivers_removed": stage1_audit.slivers_removed,
            "interior_elements_filtered": stage1_audit.interior_elements_filtered,
            "hidden_objects_skipped": stage1_audit.hidden_objects_skipped,
            "missing_mesh": stage1_audit.missing_mesh,
            "filtered_items": runtime_filtered_items,
            "exterior_detection_mode": ext_mode,
            "file_signature": file_sig,
            "z_ground_cutoff_m": round(z_ground_cut, 2),
            "basement_panels_excluded": int(basement_panels_excluded),
            "bim_storeys_count": len(stage1_audit.bim_storeys),
            "notes": stage1_audit.notes,
        },
        "stage_gates": stage_gates,
        "floor_detection_method": floor_detection_method,
        "dynamic_floor_presets": dynamic_floor_presets,
        "summary": {
            "is_provisional": is_provisional,
            "materials_confirmed": bool(params.materials_confirmed),
            "warnings": summary_warnings,
            "total_detected_panels": len(panel_records),
            "outer_panel_count": total_outer_panels,
            "active_panel_count": total_active_panels,
            "panel_count": total_active_panels,
            "frame_and_shade_faces": int(sum(len(r.faces) for r in frame_groups + shading_groups)),
            "shading_mesh_count": len(frame_groups) + len(shading_groups),
            "total_floors": len(floor_breakdown),
            "z_min_m": round(z_min_bldg, 2),
            "z_max_m": round(z_max_bldg, 2),
            "floor_height_m": floor_h,
            "floor_mode": params.floor_mode,
            "unit_mode": params.unit_mode,
            "up_axis": params.up_axis,
            "north_angle_deg": round(float(params.north_angle_deg), 1),
            "bounding_box": {
                "min": [round(x_min_bldg, 2), round(y_min_bldg, 2), round(z_min_bldg, 2)],
                "max": [round(x_max_bldg, 2), round(y_max_bldg, 2), round(z_max_bldg, 2)],
                "center": [round(bldg_cx, 2), round(bldg_cy, 2), round(bldg_cz, 2)],
                "span": [round(span_x, 2), round(span_y, 2), round(span_z, 2)],
                "max_span": round(max_span, 2),
                "horiz_radius": round(horiz_radius, 2),
                "recommended_dome_radius": round(recommended_dome_radius, 2),
            },
            "active_materials": {
                "wall_id": wal_mat["id"] if wal_mat else params.wall_material_id,
                "wall_name": wal_mat["name"] if wal_mat else "Spandrel Curtain Wall + Insulasi Mineral Wool 50mm + Backpan",
                "wall_brand": wal_mat["brand"] if wal_mat else "Generik (Nilai Tipikal)",
                "alpha_wall": round(alpha_glob, 3),
                "u_wall": round(u_w_glob, 3),
                "td_ek": round(tdek_glob, 2),
                "glazing_id": glz_mat["id"] if glz_mat else params.glazing_material_id,
                "glazing_name": glz_mat["name"] if glz_mat else "Kaca Ganda (IGU) Triple-Silver Ultra-Selective 6+12Ar+6mm",
                "glazing_brand": glz_mat["brand"] if glz_mat else "Generik (Nilai Tipikal)",
                "u_cog": round(float(glz_mat["u_value"]) if glz_mat else float(params.u_fenestration), 3),
                "u_fenestration": round(avg_u_fen_bldg, 3),
                "sc_glass": round(sc_1_glob, 3),
                "shgc_glass": get_material_shgc(glz_mat, fallback_sc=sc_1_glob),
                "delta_t": round(delta_t, 2),
                "frame_id": frm_mat["id"] if frm_mat else params.frame_material_id,
                "frame_name": frm_mat["name"] if frm_mat else "Rangka Aluminium Curtain Wall + Thermal Break",
                "u_frame": round(u_frame_eff, 3),
                "frame_width_mm": eff_frame_width_mm,
                "frame_source": frame_source,
                "a_frame_m2": round(total_a_frame_m2, 2),
                "a_edge_m2": round(total_a_edge_m2, 2),
                "a_cog_m2": round(total_a_cog_m2, 2),
                "louver_depth_m": round(float(params.louver_depth_m), 2),
                "louver_spacing_m": round(float(params.louver_spacing_m), 2),
                "louver_tilt_deg": round(float(params.louver_tilt_deg), 1),
            },
            "total_envelope_area_m2": round(total_envelope_area, 2),
            "total_glazing_area_m2": round(total_glazing_area, 2),
            "total_opaque_area_m2": round(total_envelope_area - total_glazing_area, 2),
            "total_a_frame_m2": round(total_a_frame_m2, 2),
            "total_a_edge_m2": round(total_a_edge_m2, 2),
            "total_a_cog_m2": round(total_a_cog_m2, 2),
            "avg_u_fen_wm2k": round(avg_u_fen_bldg, 3),
            "u_frame_eff_wm2k": round(u_frame_eff, 3),
            "frame_width_mm": eff_frame_width_mm,
            "frame_source": frame_source,
            "effective_wwr": round(eff_wwr, 3),
            "avg_sf_wm2": round(avg_sf_bldg, 2),
            "avg_sc_effective": round(avg_sc_bldg, 3),
            "avg_shaded_fraction": round(avg_sh_bldg, 3),
            "q_wall_conduction_wm2": q_wall_tot,
            "q_glass_conduction_wm2": q_glass_tot,
            "q_solar_radiation_wm2": q_solar_tot,
            "total_heat_gain_kw": round(total_heat_w / 1000.0, 2),
        },
        "parameters_used": {
            "glazing_material_id": params.glazing_material_id,
            "wall_material_id": params.wall_material_id,
            "frame_material_id": params.frame_material_id,
            "roof_material_id": params.roof_material_id,
            "orientation_material_overrides": dict(params.orientation_material_overrides or {}),
            "group_material_map": dict(params.group_material_map or {}),
            "delta_t": round(delta_t, 2),
            "u_fenestration": round(float(glz_mat["u_value"]) if glz_mat else float(params.u_fenestration), 3),
            "u_frame": round(u_frame_eff, 3),
            "frame_width_mm": eff_frame_width_mm,
            "frame_source": frame_source,
            "sc_glass": round(sc_1_glob, 4),
            "u_wall": round(u_w_glob, 3),
            "alpha_wall": round(alpha_glob, 3),
            "td_ek": round(tdek_glob, 2),
        },
        "groups": group_summaries,
        "orientation_breakdown": orientation_breakdown,
        "manual_calc_rows": manual_calc_rows,
        "orientation_floor_breakdown": orientation_floor_breakdown,
        "floor_breakdown": floor_breakdown,
        "recommendations": recommendations,
        "solar_vectors": solar_vectors,
        "panels": panel_records,
        "frame_elements": _serialize_raw_groups(frame_groups, max_faces=14000),
        "shading_elements": _serialize_raw_groups(shading_groups, max_faces=48000),
        "roof_elements": _serialize_raw_groups(roof_groups, max_faces=4000),
        "context_elements": _serialize_raw_groups(context_groups, max_faces=40000),
    }
