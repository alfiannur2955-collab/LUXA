"""Tahap 3: deteksi lantai (nama storey/grup, histogram tepi horizontal) dan zona lantai."""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from loaders.types import RawGroupMesh

# ============================================================================
# STAGE 3: DYNAMIC FLOOR LEVEL DETECTOR & ZONE GENERATOR
# ============================================================================

_FLOOR_NAME_EXPLICIT_RE = re.compile(
    r"(?:^|[\s_\-./:])(?:lantai|lt\.?|level|lvl|floor|fl\.?|storey|story)\s*[-_.]?\s*(\d{1,3})(?:$|[\s_\-./:])",
    re.IGNORECASE,
)
_FLOOR_NAME_SHORT_L_RE = re.compile(
    r"(?:^|[\s_\-./:])[lL](\d{1,2})(?:$|[\s_\-./:])"
)
_ROOF_STOREY_RE = re.compile(r"(?:^|[\s_\-./:])(?:roof|atap|dak|rooftop|parapet)(?:$|[\s_\-./:])", re.IGNORECASE)
_SLAB_GROUP_RE = re.compile(r"(?:slab|pelat|plat|lantai|floor|ifcslab)", re.IGNORECASE)


def _format_id_num(val: float, decimals: int = 1) -> str:
    return f"{val:.{decimals}f}".replace(".", ",")


def format_floor_source_label(
    floor_defs: List[Dict[str, Any]],
    method: str,
    span_z_m: float,
    has_glazing: bool = True,
) -> str:
    """Formats the transparent floor detection label shown in Konfirmasi (R4)."""
    n = len(floor_defs)
    if method == "tidak_terdeteksi" or n <= 0:
        return f"Tinggi {_format_id_num(span_z_m, 1)} m · jumlah lantai belum terdeteksi"
    heights = [float(f.get("height_m", 0.0)) for f in floor_defs if float(f.get("height_m", 0.0)) > 0]
    avg_h = sum(heights) / len(heights) if heights else (span_z_m / max(1, n))
    uniform_like = bool(heights) and (max(heights) - min(heights) <= 0.25)

    if method == "zona_kustom":
        return f"{n} lantai · dari zona lantai kustom"
    if method == "ifc_storey":
        if uniform_like:
            return f"{n} lantai @ {_format_id_num(avg_h, 1)} m · dari IFC"
        return f"{n} lantai · dari IFC"
    if method == "nama_layer":
        if uniform_like:
            return f"{n} lantai @ {_format_id_num(avg_h, 1)} m · dari nama layer"
        return f"{n} lantai · dari nama layer"
    if method == "isian_pengguna":
        return f"{n} lantai @ {_format_id_num(avg_h, 1)} m · dari isianmu"
    if method == "geometri_pita":
        src = "dari pita kaca berulang" if has_glazing else "dari geometri berulang"
        if uniform_like:
            return f"{n} lantai @ {_format_id_num(avg_h, 1)} m · {src}"
        # Show typical interior height if first/last floor differs
        typ_heights = heights[1:-1] if len(heights) >= 4 else heights
        typ_h = sum(typ_heights) / len(typ_heights) if typ_heights else avg_h
        return f"{n} lantai @ ~{_format_id_num(typ_h, 1)} m · {src}"
    return f"{n} lantai @ {_format_id_num(avg_h, 1)} m · {method}"


def _extract_horizontal_edge_histogram(
    raw_groups: List[RawGroupMesh],
    z_min_bldg: float,
    z_max_bldg: float,
    disabled_groups: Optional[List[str]] = None,
    group_category_overrides: Optional[Dict[str, str]] = None,
    bin_res: float = 0.05,
) -> Tuple[np.ndarray, float, float]:
    """
    Collects all horizontal edges (|dz| <= 3 cm, length >= 15 cm) of facade faces
    and ignored floor/slab faces into a length-weighted Z histogram at 5 cm resolution.
    """
    dis_set = set(disabled_groups or [])
    ov = dict(group_category_overrides or {})
    span_z = max(0.5, z_max_bldg - z_min_bldg)
    n_bins = int(math.ceil(span_z / bin_res)) + 3
    hist = np.zeros(n_bins, dtype=np.float64)

    for rg in raw_groups:
        if rg.group_name in dis_set or len(rg.faces) == 0:
            continue
        cat = ov.get(rg.group_name, rg.default_category)
        # Include facade/envelope/unknown/frame AND ignored floor/slab groups; skip site/furniture/roof radial caps
        if cat == "roof":
            continue
        if cat == "ignore" and not _SLAB_GROUP_RE.search(rg.group_name or ""):
            continue
        if cat == "shading":
            continue

        vs = rg.vertices
        fs = rg.faces
        is_quad = fs[:, 2] != fs[:, 3]

        edge_pairs = [
            (fs[:, 0], fs[:, 1]),
            (fs[:, 1], fs[:, 2]),
        ]
        if np.any(~is_quad):
            tri_f = fs[~is_quad]
            edge_pairs.append((tri_f[:, 2], tri_f[:, 0]))
        if np.any(is_quad):
            q_f = fs[is_quad]
            edge_pairs.append((q_f[:, 2], q_f[:, 3]))
            edge_pairs.append((q_f[:, 3], q_f[:, 0]))

        for idx0, idx1 in edge_pairs:
            p0 = vs[idx0]
            p1 = vs[idx1]
            dz = np.abs(p1[:, 2] - p0[:, 2])
            hlen = np.hypot(p1[:, 0] - p0[:, 0], p1[:, 1] - p0[:, 1])
            z_mid = 0.5 * (p0[:, 2] + p1[:, 2])
            mask = (
                (dz <= 0.03)
                & (hlen >= 0.15)
                & (z_mid >= z_min_bldg - 0.05)
                & (z_mid <= z_max_bldg + 0.05)
            )
            if not np.any(mask):
                continue
            bins = np.rint((z_mid[mask] - z_min_bldg) / bin_res).astype(np.int64)
            valid = (bins >= 0) & (bins < n_bins)
            if np.any(valid):
                np.add.at(hist, bins[valid], hlen[mask][valid])

    return hist, z_min_bldg, bin_res


def _detect_floors_from_group_names(
    raw_groups: List[RawGroupMesh],
    z_min_bldg: float,
    z_max_bldg: float,
    disabled_groups: Optional[List[str]] = None,
) -> Optional[List[Dict[str, Any]]]:
    """Tier 1c: Extracts explicit floor bands from Rhino layers / block / group names."""
    dis_set = set(disabled_groups or [])
    by_floor: Dict[int, List[Tuple[float, float]]] = {}

    for rg in raw_groups:
        if rg.group_name in dis_set or len(rg.vertices) == 0:
            continue
        name = rg.group_name or ""
        m = _FLOOR_NAME_EXPLICIT_RE.search(name) or _FLOOR_NAME_SHORT_L_RE.search(name)
        if not m:
            continue
        fl_idx = int(m.group(1))
        if fl_idx < 0 or fl_idx > 200:
            continue
        zs = rg.vertices[:, 2]
        zs_above = zs[zs >= z_min_bldg - 0.15]
        if len(zs_above) == 0:
            continue
        z0 = float(np.min(zs_above))
        z1 = float(np.max(zs_above))
        if z1 - z0 < 0.25:
            continue
        by_floor.setdefault(fl_idx, []).append((z0, z1))

    if len(by_floor) < 2:
        return None

    # Order floors by their lower Z elevation
    spans = []
    for fl_idx, pairs in by_floor.items():
        lo = max(z_min_bldg, min(p[0] for p in pairs))
        hi = min(z_max_bldg, max(p[1] for p in pairs))
        if hi - lo >= 0.5:
            spans.append((lo, hi, fl_idx))
    spans.sort(key=lambda t: (t[0], t[2]))
    if len(spans) < 2:
        return None

    # Build contiguous non-overlapping floor definitions
    floor_defs: List[Dict[str, Any]] = []
    for i, (lo, hi, orig_num) in enumerate(spans):
        z0 = z_min_bldg if i == 0 else floor_defs[-1]["z_max"]
        if i + 1 < len(spans):
            next_lo = spans[i + 1][0]
            # Seam at midpoint if overlapping/gapped, or at next_lo if clean
            z1 = next_lo if next_lo > z0 + 1.5 else max(hi, z0 + 2.2)
            z1 = min(z1, z_max_bldg)
        else:
            z1 = z_max_bldg
        if z1 - z0 < 0.8:
            continue
        fl_num = len(floor_defs) + 1
        floor_defs.append({
            "floor_number": fl_num,
            "floor_label": f"L{fl_num}",
            "zone_type": "Tipikal",
            "z_min": round(z0, 2),
            "z_max": round(z1, 2),
            "height_m": round(z1 - z0, 2),
        })

    return floor_defs if len(floor_defs) >= 2 else None


def _detect_floors_from_geometry_histogram(
    hist: np.ndarray,
    z_origin: float,
    bin_res: float,
    z_min_bldg: float,
    z_max_bldg: float,
) -> Optional[List[Dict[str, Any]]]:
    """
    Tier 2 (R4): Autocorrelation on 5 cm edge-length-weighted horizontal Z histogram
    across lag range 2.4..6.0 m. Accepted ONLY when >= 70% of prominent horizontal
    lines fall within +/-15 cm of period multiples (first/last floor may differ).
    """
    total_h = z_max_bldg - z_min_bldg
    if total_h < 4.5 or len(hist) < 50:
        return None

    # Extract prominent horizontal lines (merge adjacent bins within +/-10 cm)
    nz_mask = hist > 0
    if int(np.sum(nz_mask)) < 4:
        return None

    zs_all = z_origin + np.arange(len(hist), dtype=np.float64) * bin_res
    interior_mask = nz_mask & (zs_all > z_min_bldg + 0.20) & (zs_all < z_max_bldg - 0.20)
    if int(np.sum(interior_mask)) < 2:
        return None

    int_weights = hist[interior_mask]
    w_ref = float(np.percentile(int_weights, 85)) if len(int_weights) >= 3 else float(np.max(int_weights))
    thr = max(1e-6, 0.12 * w_ref)

    prom_bins = np.where(hist >= thr)[0]
    if len(prom_bins) < 3:
        return None

    # Merge contiguous / within-10cm prominent bins into weighted-mean Z lines
    prom_z_list: List[float] = []
    prom_w_list: List[float] = []
    cur_bins = [int(prom_bins[0])]
    for b in prom_bins[1:]:
        b_i = int(b)
        if (b_i - cur_bins[-1]) * bin_res <= 0.11:
            cur_bins.append(b_i)
        else:
            ws = hist[cur_bins]
            zs = z_origin + np.array(cur_bins, dtype=np.float64) * bin_res
            prom_z_list.append(float(np.sum(zs * ws) / np.sum(ws)))
            prom_w_list.append(float(np.sum(ws)))
            cur_bins = [b_i]
    ws = hist[cur_bins]
    zs = z_origin + np.array(cur_bins, dtype=np.float64) * bin_res
    prom_z_list.append(float(np.sum(zs * ws) / np.sum(ws)))
    prom_w_list.append(float(np.sum(ws)))

    prom_z = np.array(prom_z_list, dtype=np.float64)
    prom_w = np.array(prom_w_list, dtype=np.float64)
    int_prom = prom_z[(prom_z > z_min_bldg + 0.20) & (prom_z < z_max_bldg - 0.20)]
    if len(int_prom) < 2:
        return None

    # Smooth & cap extreme single-bin outliers before autocorrelation
    med_w = float(np.median(prom_w))
    h_cap = np.minimum(hist, max(1.0, 3.0 * med_w))
    kernel = np.array([0.25, 0.50, 0.25], dtype=np.float64)
    h_smooth = np.convolve(h_cap, kernel, mode="same")

    lag_min = int(round(2.40 / bin_res))
    lag_max = min(len(h_smooth) - 2, int(round(6.00 / bin_res)))
    if lag_max < lag_min:
        return None

    lags = np.arange(lag_min, lag_max + 1, dtype=np.int64)
    ac = np.zeros(len(lags), dtype=np.float64)
    for idx, lag in enumerate(lags):
        ac[idx] = float(np.dot(h_smooth[:-lag], h_smooth[lag:]))

    best_idx = int(np.argmax(ac))
    if ac[best_idx] <= 0.0:
        return None

    best_lag = int(lags[best_idx])
    # Prefer fundamental period over 2x harmonic if half-period is in [2.4, 6.0] and strong
    half_lag = int(round(best_lag / 2.0))
    if half_lag >= lag_min:
        half_idx = half_lag - lag_min
        win_lo = max(0, half_idx - 2)
        win_hi = min(len(ac) - 1, half_idx + 2)
        if float(np.max(ac[win_lo : win_hi + 1])) >= 0.80 * ac[best_idx]:
            best_idx = win_lo + int(np.argmax(ac[win_lo : win_hi + 1]))
            best_lag = int(lags[best_idx])

    p_coarse = best_lag * bin_res

    def _eval_period(period: float) -> Tuple[float, float, List[Tuple[float, List[int]]]]:
        """
        Clusters prominent lines by circular phase modulo `period` within +/-15 cm.
        A cluster counts as periodic only if it spans >= 2 consecutive floor indices.
        """
        tol = 0.15
        rel = prom_z - z_min_bldg
        phases = np.mod(rel, period)
        order = np.argsort(phases)
        used = np.zeros(len(prom_z), dtype=bool)
        periodic_clusters: List[Tuple[float, List[int]]] = []
        matched_mask = np.zeros(len(prom_z), dtype=bool)

        for idx in order:
            if used[idx]:
                continue
            p0 = phases[idx]
            # Circular distance to p0
            diff = np.abs(phases - p0)
            cdiff = np.minimum(diff, period - diff)
            members = np.where((~used) & (cdiff <= tol))[0]
            if len(members) < 2:
                continue
            # Circular mean phase of members
            ang = (phases[members] / period) * (2.0 * math.pi)
            mean_ang = math.atan2(float(np.sum(np.sin(ang) * prom_w[members])), float(np.sum(np.cos(ang) * prom_w[members])))
            mean_phase = ((mean_ang / (2.0 * math.pi)) * period) % period
            # Verify each member is within +/-15 cm of mean_phase + k * period
            signed = ((phases[members] - mean_phase + 0.5 * period) % period) - 0.5 * period
            good = members[np.abs(signed) <= tol]
            if len(good) < 2:
                continue
            ks = sorted({int(round((rel[m] - mean_phase) / period)) for m in good})
            # Must have at least one adjacent floor repetition (k and k+1)
            if len(ks) >= 2 and any((ks[j + 1] - ks[j]) == 1 for j in range(len(ks) - 1)):
                used[good] = True
                matched_mask[good] = True
                periodic_clusters.append((mean_phase, good.tolist()))

        frac_cnt = float(np.sum(matched_mask)) / float(len(prom_z))
        frac_w = float(np.sum(prom_w[matched_mask])) / float(np.sum(prom_w))
        return frac_cnt, frac_w, periodic_clusters

    # Fine-tune period within +/-10 cm of autocorrelation peak (1 cm step)
    best_p = p_coarse
    best_score = (-1.0, -1.0)
    best_clusters: List[Tuple[float, List[int]]] = []
    for delta in np.linspace(-0.10, 0.10, 21):
        p_cand = p_coarse + float(delta)
        if p_cand < 2.40 or p_cand > 6.00:
            continue
        fc, fw, clusters = _eval_period(p_cand)
        # Small tie-breaker preferring closeness to autocorrelation peak
        score = (min(fc, fw), fc + fw - 0.05 * abs(delta))
        if score > best_score:
            best_score = score
            best_p = p_cand
            best_clusters = clusters

    frac_cnt, frac_w, periodic_clusters = _eval_period(best_p)
    if frac_cnt < 0.70 or frac_w < 0.70 or not periodic_clusters:
        return None

    # Determine repeating band span and floor seam anchor
    periodic_indices = [idx for _, idxs in periodic_clusters for idx in idxs]
    z_rep_min = float(np.min(prom_z[periodic_indices]))
    z_rep_max = float(np.max(prom_z[periodic_indices]))

    # Choose floor seam phase: prefer a periodic phase within 20 cm of 0 (floor level),
    # otherwise anchor at the lowest repeating feature offset cleanly to floor level.
    seam_phase: Optional[float] = None
    best_zero_dist = 0.22
    for ph, _ in periodic_clusters:
        d0 = min(ph, best_p - ph)
        if d0 < best_zero_dist:
            best_zero_dist = d0
            seam_phase = ph

    if seam_phase is None:
        # Use phase of the lowest periodic line (or z_rep_min) as floor rhythm
        seam_phase = (z_rep_min - z_min_bldg) % best_p

    # Construct ordered floor seams allowing first & last floor to differ in height
    seams: List[float] = [z_min_bldg]
    # Start periodic grid at first seam >= z_rep_min (so a tall podium below stays L1)
    k_start = int(math.floor((z_rep_min - z_min_bldg - seam_phase) / best_p))
    k_end = int(math.ceil((z_max_bldg - z_min_bldg - seam_phase) / best_p))
    for k in range(k_start, k_end + 1):
        z_s = z_min_bldg + seam_phase + k * best_p
        if z_s <= seams[-1] + 1.8:
            continue
        if z_max_bldg - z_s < 1.8:
            continue
        seams.append(z_s)
    seams.append(z_max_bldg)

    if len(seams) < 3:
        return None

    floor_defs: List[Dict[str, Any]] = []
    for i in range(len(seams) - 1):
        z0 = seams[i]
        z1 = seams[i + 1]
        fl_num = i + 1
        zone_t = "Podium" if (i == 0 and (z1 - z0) > best_p + 0.6) else "Tipikal"
        floor_defs.append({
            "floor_number": fl_num,
            "floor_label": f"L{fl_num}",
            "zone_type": zone_t,
            "z_min": round(z0, 2),
            "z_max": round(z1, 2),
            "height_m": round(z1 - z0, 2),
        })

    return floor_defs


def build_dynamic_floor_levels(
    z_min_bldg: float,
    z_max_bldg: float,
    floor_mode: str = "auto",
    floor_height_m: Optional[float] = None,
    bim_storeys: Optional[List[Dict[str, Any]]] = None,
    panel_z_mins: Optional[np.ndarray] = None,
    panel_z_maxs: Optional[np.ndarray] = None,
    custom_floor_zones: Optional[List[Dict[str, Any]]] = None,
    raw_groups: Optional[List[RawGroupMesh]] = None,
    expected_floors: Optional[int] = None,
    disabled_groups: Optional[List[str]] = None,
    group_category_overrides: Optional[Dict[str, str]] = None,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    R4 Tiered Floor Detection (never silently guesses height / 3.6):
    1. Certain sources (in priority order):
       a) custom_floor_zones (`zona_kustom`)
       b) IfcBuildingStorey (`ifc_storey`)
       c) Layer/group names with floor markers (`nama_layer`)
       d) User input `expected_floors` or explicit `floor_height_m` (`isian_pengguna`)
    2. Geometry: 5 cm length-weighted horizontal edge histogram + autocorrelation in
       [2.4, 6.0] m, accepted only when >= 70% of prominent lines align within +/-15 cm
       (`geometri_pita`).
    3. Uncertain: single zone covering full height, method `tidak_terdeteksi`.
    """
    total_h = max(0.5, z_max_bldg - z_min_bldg)
    mode = (floor_mode or "auto").lower()
    bim_list = list(bim_storeys or [])

    # 1a. CUSTOM FLOOR ZONES MODE
    if custom_floor_zones and (mode == "custom" or len(custom_floor_zones) > 0):
        fh_fill = max(2.2, min(10.0, float(floor_height_m))) if floor_height_m else 3.6
        floor_defs: List[Dict[str, Any]] = []
        cur_z = z_min_bldg
        fl_num = 1
        for zone in custom_floor_zones:
            if "count" in zone and zone["count"] is not None:
                count = max(1, int(zone["count"]))
            elif "floor_from" in zone and "floor_to" in zone:
                count = max(1, int(zone["floor_to"]) - int(zone["floor_from"]) + 1)
            else:
                count = 1
            zh = max(2.2, min(15.0, float(zone.get("height_m", fh_fill))))
            z_label = str(zone.get("name") or zone.get("zone_label") or "Tipikal").strip()
            for _ in range(count):
                if cur_z >= z_max_bldg - 0.15 and len(floor_defs) >= 1:
                    break
                z_next = min(z_max_bldg + 0.5, cur_z + zh)
                floor_defs.append({
                    "floor_number": fl_num,
                    "floor_label": f"L{fl_num}",
                    "zone_type": z_label,
                    "z_min": round(cur_z, 2),
                    "z_max": round(z_next, 2),
                    "height_m": round(z_next - cur_z, 2),
                })
                cur_z = z_next
                fl_num += 1
        while cur_z < z_max_bldg - 0.40 and fl_num <= 160:
            z_next = min(z_max_bldg, cur_z + fh_fill)
            if z_next - cur_z < 1.2 and floor_defs:
                floor_defs[-1]["z_max"] = round(z_max_bldg, 2)
                floor_defs[-1]["height_m"] = round(z_max_bldg - floor_defs[-1]["z_min"], 2)
                break
            floor_defs.append({
                "floor_number": fl_num,
                "floor_label": f"L{fl_num}",
                "zone_type": "Tipikal",
                "z_min": round(cur_z, 2),
                "z_max": round(z_next, 2),
                "height_m": round(z_next - cur_z, 2),
            })
            cur_z = z_next
            fl_num += 1
        if floor_defs:
            return floor_defs, "zona_kustom"

    # Explicit uniform override when mode == 'uniform' and user supplied floor_height_m
    if mode == "uniform" and floor_height_m is not None:
        fh_u = max(2.2, min(10.0, float(floor_height_m)))
        n_u = max(1, min(160, int(math.ceil((total_h - 0.05) / fh_u))))
        floor_defs = []
        for fl in range(1, n_u + 1):
            z0 = z_min_bldg + (fl - 1) * fh_u
            z1 = min(z_max_bldg, z_min_bldg + fl * fh_u)
            floor_defs.append({
                "floor_number": fl,
                "floor_label": f"L{fl}",
                "zone_type": "Tipikal",
                "z_min": round(z0, 2),
                "z_max": round(z1, 2),
                "height_m": round(max(0.5, z1 - z0), 2),
            })
        return floor_defs, "isian_pengguna"

    # 1b. NATIVE BIM STOREYS (.IFC IfcBuildingStorey)
    if bim_list:
        sorted_st = sorted(bim_list, key=lambda s: float(s.get("elevation_m", 0.0)))
        # Filter out storeys strictly below z_min_bldg when higher storeys exist
        above_st = [
            st for idx, st in enumerate(sorted_st)
            if (
                float(st.get("elevation_m", 0.0)) >= z_min_bldg - 0.25
                or (idx + 1 < len(sorted_st) and float(sorted_st[idx + 1].get("elevation_m", 0.0)) > z_min_bldg + 0.5)
            )
        ]
        use_st = above_st if above_st else sorted_st
        floor_defs = []
        for idx, st in enumerate(use_st):
            s_name = str(st.get("name") or f"L{idx + 1}")
            z0 = max(z_min_bldg, float(st.get("elevation_m", z_min_bldg)))
            z1 = float(use_st[idx + 1]["elevation_m"]) if idx + 1 < len(use_st) else z_max_bldg
            # Skip top-only roof marker storey (e.g. 'Roof' at 6.0m when z_max=6.63m)
            if idx == len(use_st) - 1 and _ROOF_STOREY_RE.search(s_name) and (z_max_bldg - z0) < 1.8 and len(floor_defs) >= 1:
                break
            if z1 <= z0 + 0.4:
                continue
            z_type = "Podium" if ("podium" in s_name.lower() or "lobby" in s_name.lower()) else "Tipikal"
            fl_num = len(floor_defs) + 1
            floor_defs.append({
                "floor_number": fl_num,
                "floor_label": f"L{fl_num}",
                "bim_storey_name": s_name,
                "zone_type": z_type,
                "z_min": round(z0, 2),
                "z_max": round(z1, 2),
                "height_m": round(z1 - z0, 2),
            })
        if floor_defs:
            return floor_defs, "ifc_storey"

    # 1c. EXPLICIT LAYER / GROUP NAMES CONTAINING FLOOR MARKERS
    if raw_groups:
        named_floors = _detect_floors_from_group_names(
            raw_groups=raw_groups,
            z_min_bldg=z_min_bldg,
            z_max_bldg=z_max_bldg,
            disabled_groups=disabled_groups,
        )
        if named_floors:
            return named_floors, "nama_layer"

    # 1d. USER INPUT (`expected_floors` in Confirm card)
    # Note: `floor_height_m` in `auto` mode may come from legacy saved configs (3.6);
    # explicit uniform height is handled above when `floor_mode == 'uniform'`.
    if expected_floors is not None and int(expected_floors) >= 1:
        n_user = max(1, min(160, int(expected_floors)))
        fh_u = total_h / n_user
        floor_defs = []
        for fl in range(1, n_user + 1):
            z0 = z_min_bldg + (fl - 1) * fh_u
            z1 = z_max_bldg if fl == n_user else (z_min_bldg + fl * fh_u)
            floor_defs.append({
                "floor_number": fl,
                "floor_label": f"L{fl}",
                "zone_type": "Tipikal",
                "z_min": round(z0, 2),
                "z_max": round(z1, 2),
                "height_m": round(max(0.5, z1 - z0), 2),
            })
        return floor_defs, "isian_pengguna"

    # 2. GEOMETRY: 5 cm length-weighted horizontal edge histogram + autocorrelation [2.4..6.0 m]
    if raw_groups:
        hist, z_orig, bin_res = _extract_horizontal_edge_histogram(
            raw_groups=raw_groups,
            z_min_bldg=z_min_bldg,
            z_max_bldg=z_max_bldg,
            disabled_groups=disabled_groups,
            group_category_overrides=group_category_overrides,
            bin_res=0.05,
        )
        geo_floors = _detect_floors_from_geometry_histogram(
            hist=hist,
            z_origin=z_orig,
            bin_res=bin_res,
            z_min_bldg=z_min_bldg,
            z_max_bldg=z_max_bldg,
        )
        if geo_floors:
            return geo_floors, "geometri_pita"

    # 3. UNCERTAIN: DO NOT GUESS -> single zone covering full height
    return [
        {
            "floor_number": 1,
            "floor_label": "L1",
            "zone_type": "Seluruh bangunan",
            "z_min": round(z_min_bldg, 2),
            "z_max": round(z_max_bldg, 2),
            "height_m": round(total_h, 2),
        }
    ], "tidak_terdeteksi"


def assign_panels_to_floors(
    centroids_z: np.ndarray,
    floor_defs: List[Dict[str, Any]],
) -> np.ndarray:
    """Maps an array of panel centroid Z coordinates to 0-based floor indices [0 .. len(floor_defs)-1]."""
    if not floor_defs:
        return np.zeros(len(centroids_z), dtype=np.int64)
    z_uppers = np.array([fd["z_max"] for fd in floor_defs[:-1]], dtype=np.float64)
    if len(z_uppers) == 0:
        return np.zeros(len(centroids_z), dtype=np.int64)
    return np.searchsorted(z_uppers, centroids_z, side="right").astype(np.int64)


def enrich_floor_zones_and_presets(
    floor_breakdown: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Analyzes actual per-floor facade area & WWR from the current model to assign
    model-driven architectural zone badges ('Podium', 'Tipikal', 'Void / Terbuka', 'Puncak')
    and generates dynamic quick-filter presets for the UI (zero hardcoded floor numbers).
    """
    n_floors = len(floor_breakdown)
    if n_floors == 0:
        return []

    areas = [fb["total_area_m2"] for fb in floor_breakdown if fb["total_area_m2"] > 1.0]
    median_area = float(np.median(areas)) if areas else 1.0

    void_floors: List[int] = []
    podium_floors: List[int] = []
    top_floors: List[int] = []

    for fb in floor_breakdown:
        fl = fb["floor_number"]
        fa = fb["total_area_m2"]
        existing_zone = fb.get("zone_type", "Tipikal")

        if fa < 0.22 * median_area:
            zone_badge = "Void / Terbuka"
            void_floors.append(fl)
        elif existing_zone and existing_zone != "Tipikal":
            zone_badge = existing_zone
            if "podium" in existing_zone.lower() or "lobby" in existing_zone.lower():
                podium_floors.append(fl)
        elif fa > 1.22 * median_area and fl <= max(2, n_floors // 2):
            zone_badge = "Podium"
            podium_floors.append(fl)
        elif fl >= max(2, n_floors - (1 if n_floors >= 8 else 0)) and fb.get("wwr", 0.0) >= 0.85:
            zone_badge = "Puncak"
            top_floors.append(fl)
        else:
            zone_badge = "Tipikal"

        fb["zone_type"] = zone_badge
        fb["floor_label"] = f"L{fl}" if zone_badge == "Tipikal" else f"L{fl} ({zone_badge})"

    # Build dynamic quick-selection chips tailored to the uploaded model's actual floor count
    presets: List[Dict[str, Any]] = [
        {
            "id": "all",
            "label": f"Utuh (L1–L{n_floors})",
            "min_floor": 1,
            "max_floor": n_floors,
        }
    ]

    if n_floors >= 3:
        low_max = max(1, min(6, n_floors // 3))
        if podium_floors:
            low_max = max(podium_floors)
        presets.append({
            "id": "lower",
            "label": f"{'Podium' if podium_floors else 'Zona Bawah'} (L1–L{low_max})",
            "min_floor": 1,
            "max_floor": low_max,
        })

        if void_floors:
            v_min, v_max = min(void_floors), max(void_floors)
            presets.append({
                "id": "void_zone",
                "label": f"Zona Terbuka/Void (L{v_min}–L{v_max})",
                "min_floor": v_min,
                "max_floor": v_max,
            })
        elif n_floors >= 6:
            mid_min = low_max + 1
            mid_max = max(mid_min, n_floors - max(1, n_floors // 4))
            presets.append({
                "id": "mid_zone",
                "label": f"Tipikal Tengah (L{mid_min}–L{mid_max})",
                "min_floor": mid_min,
                "max_floor": mid_max,
            })

        top_min = min(top_floors) if top_floors else max(1, n_floors - max(1, min(3, n_floors // 5)) + 1)
        presets.append({
            "id": "upper",
            "label": f"Zona Atas (L{top_min}–L{n_floors})",
            "min_floor": top_min,
            "max_floor": n_floors,
        })

    return presets
