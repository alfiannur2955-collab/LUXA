"""
OTTV 3D Parametric Studio — Universal 5-Stage Gatekeeper Pipeline (SNI 6389:2020)
=================================================================================
Provides model-agnostic ingestion, normalization, decomposition, and dynamic floor
detection for ANY 3D architectural/BIM model (.3dm, .obj+.mtl, .ifc, .glb/.gltf, .hbjson):

- STAGE 1 (Geometry, Unit & Axis Normalization):
  * Automatic unit detection & conversion to meters (mm, cm, m, ft, in) + manual override
  * Automatic vertical axis alignment (Z-Up vs Y-Up) & ground elevation zeroing (Z0 = 0.00m)
  * Full Rhino .3dm support including Block Instances (InstanceReference + 4x4 Xform) & Layer::Material
  * Wavefront .obj parser preserving `o`, `g`, and `usemtl` material tags (Layer::Material)
  * Native BIM .ifc STEP parser extracting `IFCBUILDINGSTOREY` elevations & semantic BIM entities
    (`IFCCURTAINWALL`, `IFCPLATE`, `IFCMEMBER`, `IFCWALL`, `IFCWINDOW`, `IFCSLAB`, `IFCSHADINGDEVICE`)

- STAGE 2 (3-Tier Sub-Element Decomposer & 6-Role SNI Classification):
  * Tier 1: Composite `Layer :: Material` separation
  * Tier 2: Geometric Morphology Auto-Splitter (separates merged Curtain Wall into
    Frame/Mullion, Spandrel Panel, and Vision Glass based on slenderness & panel height)
  * Tier 3: Parametric Composite Curtain Wall WWR ratio mode (`composite_cw`)

- STAGE 3 (Model-Driven Dynamic Floor Detection):
  * Mode 1 (`auto`): Detects floors from BIM storeys, slab layers, or Z-edge histogram clustering
  * Mode 2 (`uniform`): Uniform floor-to-floor height (e.g., 3.6m, 4.0m)
  * Mode 3 (`custom`): Custom multi-zone floor table (e.g., Lobby 5.0m, Podium 4.2m, Typical 3.6m)
"""

from __future__ import annotations

import json
import math
import multiprocessing
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import rhino3dm
import trimesh
from ladybug_geometry.geometry3d.face import Face3D
from ladybug_geometry.geometry3d.mesh import Mesh3D
from ladybug_geometry.geometry3d.pointvector import Point3D

# Optional OpenCASCADE C++ BIM kernel via IfcOpenShell (industry standard for ArchiCAD/Revit IFC)
if os.name == "nt" and os.path.isdir(r"E:\APPS\QGIS\bin"):
    try:
        os.add_dll_directory(r"E:\APPS\QGIS\bin")
    except Exception:
        pass

try:
    import ifcopenshell
    import ifcopenshell.geom
    import ifcopenshell.util.unit
    HAS_IFCOPENSHELL = True
except Exception:
    ifcopenshell = None  # type: ignore
    HAS_IFCOPENSHELL = False


UNIT_SCALE_TO_METERS: Dict[str, float] = {
    "m": 1.0,
    "cm": 0.01,
    "mm": 0.001,
    "ft": 0.3048,
    "in": 0.0254,
}


@dataclass
class RawGroupMesh:
    """Stores a named group's vertices and quad/tri faces in fast NumPy arrays."""
    group_id: str
    group_name: str
    source_layer: str
    source_material: str
    default_category: str  # 'glazing' | 'wall' | 'spandrel' | 'composite_cw' | 'frame' | 'shading' | 'roof'
    vertices: np.ndarray   # shape (V, 3) float64 in meters, Z-Up
    faces: np.ndarray      # shape (F, 4) int64 (for triangles, col 3 == col 2)
    is_auto_split_child: bool = False
    is_external_bim: Optional[bool] = None
    thermal_u_bim: Optional[float] = None


@dataclass
class Stage1GeometryAudit:
    """Metadata produced by Gate 1 (Geometry, Unit & Axis Normalization)."""
    detected_unit: str = "m"
    applied_unit: str = "m"
    scale_factor_to_m: float = 1.0
    detected_up_axis: str = "Z"
    applied_up_axis: str = "Z"
    raw_span_xyz: List[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    normalized_span_m: List[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    z_ground_offset_m: float = 0.0
    xy_world_offset_m: List[float] = field(default_factory=lambda: [0.0, 0.0])
    bim_storeys: List[Dict[str, Any]] = field(default_factory=list)
    total_raw_objects: int = 0
    total_raw_faces: int = 0
    geometry_kernel: str = "Standard"
    slivers_removed: int = 0
    interior_elements_filtered: int = 0
    hidden_objects_skipped: int = 0
    missing_mesh: List[Dict[str, Any]] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


def classify_layer_or_material_role(label: str) -> str:
    """
    Classifies a layer/object/material name into one of the 6 SNI 6389:2020 envelope roles:
    - 'shading': External shading fins, louvers, overhangs, canopies, sunscreens
    - 'frame': Mullion, transom, curtain wall frame, structural rings, profiles
    - 'spandrel': Curtain wall spandrel panel, shadow box, backpan insulation
    - 'glazing': Vision glass, window, glazing, fenestration, skylight/crown glass
    - 'roof': Roof, slab, floor plate, ceiling, interior partition, site context
    - 'wall': Opaque wall, concrete, brick, AAC, precast, cladding
    """
    raw = (label or "").strip()
    s = raw.lower()
    # If composite 'Layer :: Material', inspect material token with high priority
    parts = [p.strip().lower() for p in raw.split("::")] if "::" in raw else [s]
    mat_part = parts[-1] if len(parts) > 1 else ""

    # 1. Explicit Shading devices (avoid matching 'fin' inside 'finish'!)
    has_fin_word = bool(re.search(r"\b(fin|fins)\b", s))
    if has_fin_word or any(
        k in s
        for k in (
            "shade",
            "shading",
            "louver",
            "louvre",
            "overhang",
            "brise",
            "canopy",
            "sunscreen",
            "skygarden",
            "ifcshadingdevice",
        )
    ):
        return "shading"

    # 2. Spandrel / Insulation panels (e.g. ArchiCAD 'Insulation - Fiberglass', 'CW_Spandrel')
    if any(
        k in s
        for k in (
            "spandrel",
            "backpan",
            "shadowbox",
            "shadow_box",
            "parapet_glass",
            "insulation",
            "fiberglass",
            "rockwool",
            "mineral wool",
        )
    ):
        return "spandrel"

    # 3. Vision Glass / Fenestration (e.g. ArchiCAD 'Glass - Clear Fast', 'Glass - Blue')
    if any(
        k in s
        for k in (
            "glass",
            "glaz",
            "window",
            "vision",
            "fenestration",
            "aperture",
            "kaca",
            "jendela",
            "ifcwindow",
            "low-e",
            "lowe",
            "stopsol",
            "sunergy",
        )
    ) or any(k in mat_part for k in ("clear", "tinted")):
        return "glazing"

    # 3B. Explicit Cladding / Facade Panel / Insulation boards (must precede generic 'aluminium' frame match!)
    if any(
        k in s
        for k in (
            "cladding",
            "acp",
            "alucobond",
            "facade_panel",
            "xps",
            "eps",
            "precast",
            "concrete",
            "masonry",
            "brick",
            "bata",
            "verputz",
            "plaster",
        )
    ):
        return "wall"

    # 4. Curtain Wall Frame / Mullion / Transom / Aluminium profiles
    if any(
        k in s
        for k in (
            "transom",
            "mullion",
            "rings",
            "_ring",
            "frame",
            "rangka",
            "profile",
            "stiffener",
            "kusen",
            "ifcmember",
            "aluminum_frame",
            "metal - aluminium",
            "metal - aluminum",
            "aluminium",
        )
    ):
        return "frame"

    # 5. Roof / Slab / Floor / Ceiling / Interior / Site / Virtual
    if any(
        k in s
        for k in (
            "roof",
            "atap",
            "slab",
            "floor",
            "lantai",
            "ceiling",
            "plafon",
            "ground",
            "tapak",
            "interior",
            "partisi",
            "core",
            "ifcslab",
            "ifcroof",
            "ifcsite",
            "virtual_",
            "terrain",
            "earthworks",
            "spatialzone",
            "natur erde",
        )
    ):
        return "roof"

    # 6. Generic Curtain Wall plate
    if any(k in s for k in ("curtainwall", "curtain_wall", "ifccurtainwall", "cw_panel", "ifcplate")):
        return "glazing"

    return "wall"


def suggest_material_id_for_group(
    group_name: str,
    category: str,
    default_glazing_id: Optional[str],
    default_wall_id: Optional[str],
    default_frame_id: Optional[str],
) -> str:
    """
    Matches a group/layer/material name against known Indonesian architectural materials,
    falling back cleanly to the category default.
    """
    s = (group_name or "").lower()
    if category == "glazing":
        if "indoflo" in s or "polos" in s or "clear_float" in s or "clear float" in s:
            return "glz_asahimas_indoflo_clear_8"
        if "panasap" in s or "tinted" in s:
            return "glz_asahimas_panasap_grey_8"
        if "mulia" in s:
            return "glz_mulia_tinted_green_8"
        if "stopsol" in s or "reflective" in s or "reflektif" in s:
            return "glz_asahimas_stopsol_supersilver_8"
        if "sunergy" in s and ("igu" in s or "double" in s):
            return "glz_asahimas_sunergy_igu_24"
        if "sunergy" in s:
            return "glz_asahimas_sunergy_single_8"
        if "tsunlux" in s or "planibel" in s:
            return "glz_asahimas_tsunlux_igu_24"
        if "skn" in s or "154" in s:
            return "glz_saint_gobain_cool_lite_skn154"
        if "bipv" in s or "pv" in s or "solar" in s:
            return "glz_bipv_solar_facade_agc"
        if "sage" in s or "electro" in s:
            return "glz_smart_electrochromic_sageglass"
        return default_glazing_id or "glz_saint_gobain_xtreme_60_28"

    if category == "spandrel":
        if "tanpa" in s or "uninsulated" in s:
            return "wal_spandrel_tanpa_insulasi"
        return default_wall_id or "wal_spandrel_rockwool_nichias_50"

    if category in ("wall", "composite_cw"):
        if "bata" in s and "ringan" not in s:
            return "wal_bata_merah_plester_cat_standar"
        if "hebel" in s or "aac" in s or "citicon" in s or "ringan" in s:
            return "wal_aac_hebel_citicon_100"
        if "acp" in s or "alucobond" in s or "seven" in s:
            return "wal_acp_seven_alucobond_rockwool"
        if "precast" in s or "beton" in s or "concrete" in s or "wika" in s:
            return "wal_precast_concrete_wika_120"
        if "pir" in s or "sandwich" in s or "bluescope" in s:
            return "wal_sandwich_pir_bluescope_50"
        return default_wall_id or "wal_spandrel_rockwool_nichias_50"

    return default_frame_id or "frm_ykkap_schuco_thermal_break"


def tessellate_nurbs_surface_with_ladybug(
    surface: rhino3dm.Surface,
    u_div: int = 4,
    v_div: int = 2,
) -> Mesh3D:
    """Uses `ladybug-geometry` Mesh3D to tessellate a curved/NURBS Rhino surface."""
    u_domain = surface.Domain(0)
    v_domain = surface.Domain(1)
    u_min, u_max = u_domain.T0, u_domain.T1
    v_min, v_max = v_domain.T0, v_domain.T1

    u_steps = max(2, int(u_div))
    v_steps = max(2, int(v_div))

    lb_points: List[Point3D] = []
    for i in range(u_steps + 1):
        u = u_min + (u_max - u_min) * (i / u_steps)
        for j in range(v_steps + 1):
            v = v_min + (v_max - v_min) * (j / v_steps)
            pt = surface.PointAt(u, v)
            lb_points.append(Point3D(float(pt.X), float(pt.Y), float(pt.Z)))

    faces: List[Tuple[int, ...]] = []
    stride = v_steps + 1
    for i in range(u_steps):
        for j in range(v_steps):
            idx0 = i * stride + j
            idx1 = (i + 1) * stride + j
            idx2 = (i + 1) * stride + (j + 1)
            idx3 = i * stride + (j + 1)
            faces.append((idx0, idx1, idx2, idx3))

    return Mesh3D(lb_points, faces)


def _rhino_mesh_to_numpy(rh_mesh: rhino3dm.Mesh) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    n_v = len(rh_mesh.Vertices)
    n_f = len(rh_mesh.Faces)
    if n_v < 3 or n_f < 1:
        return None
    verts = np.empty((n_v, 3), dtype=np.float64)
    for i in range(n_v):
        v = rh_mesh.Vertices[i]
        verts[i, 0] = v.X
        verts[i, 1] = v.Y
        verts[i, 2] = v.Z

    faces = np.empty((n_f, 4), dtype=np.int64)
    for i in range(n_f):
        f = rh_mesh.Faces[i]
        faces[i, 0] = f[0]
        faces[i, 1] = f[1]
        faces[i, 2] = f[2]
        faces[i, 3] = f[3] if len(f) >= 4 else f[2]
    return verts, faces


def _ladybug_mesh_to_numpy(lb_mesh: Mesh3D) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    verts_lb = lb_mesh.vertices
    faces_lb = lb_mesh.faces
    if len(verts_lb) < 3 or len(faces_lb) < 1:
        return None
    verts = np.array([[p.x, p.y, p.z] for p in verts_lb], dtype=np.float64)
    faces = np.array(
        [[f[0], f[1], f[2], f[3] if len(f) >= 4 else f[2]] for f in faces_lb],
        dtype=np.int64,
    )
    return verts, faces


def _xform_to_matrix(xf: rhino3dm.Transform) -> np.ndarray:
    """Extracts a 4x4 NumPy transformation matrix from a rhino3dm.Transform."""
    mat = np.eye(4, dtype=np.float64)
    try:
        for r in range(4):
            for c in range(4):
                mat[r, c] = float(getattr(xf, f"M{r}{c}"))
    except Exception:
        pass
    return mat


def _apply_xform(verts: np.ndarray, mat4: np.ndarray) -> np.ndarray:
    if np.allclose(mat4, np.eye(4)):
        return verts
    ones = np.ones((len(verts), 1), dtype=np.float64)
    vh = np.hstack([verts, ones])
    vt = vh @ mat4.T
    return vt[:, :3]


# ============================================================================
# ZERO-DESTRUCTIVE BIM GEOMETRY CLEANERS (QUAD MERGING & SOLID SLIVER FILTER)
# ============================================================================

def _merge_coplanar_tris_to_quads(verts: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """
    Merges pairs of adjacent coplanar triangles sharing a diagonal edge into clean
    quad faces `(a, b, c, d)` with 0.00% area loss. Reduces face count by ~50% on
    triangulated BIM solids (IfcOpenShell / GLB / OBJ) while keeping clean panel edges.
    """
    n_t = len(tris)
    if n_t == 0:
        return np.empty((0, 4), dtype=np.int64)
    if n_t == 1:
        t = tris[0]
        return np.array([[t[0], t[1], t[2], t[2]]], dtype=np.int64)

    v0 = verts[tris[:, 0]]
    v1 = verts[tris[:, 1]]
    v2 = verts[tris[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(cross, axis=1, keepdims=True)
    unit_n = np.where(norms > 1e-12, cross / np.maximum(1e-12, norms), 0.0)

    # Map undirected edge (min_v, max_v) -> list of (tri_idx, opposite_vertex)
    edge_map: Dict[Tuple[int, int], List[Tuple[int, int]]] = {}
    for ti in range(n_t):
        a, b, c = int(tris[ti, 0]), int(tris[ti, 1]), int(tris[ti, 2])
        if a == b or b == c or a == c:
            continue
        for u, v, opp in ((a, b, c), (b, c, a), (c, a, b)):
            key = (u, v) if u < v else (v, u)
            if key not in edge_map:
                edge_map[key] = [(ti, opp)]
            else:
                edge_map[key].append((ti, opp))

    used = np.zeros(n_t, dtype=bool)
    quads: List[Tuple[int, int, int, int]] = []

    for (u, v), entries in edge_map.items():
        if len(entries) != 2:
            continue
        (t1, opp1), (t2, opp2) = entries
        if used[t1] or used[t2] or opp1 == opp2:
            continue
        if float(np.dot(unit_n[t1], unit_n[t2])) < 0.9985:
            continue
        # Preserve winding of t1: find directed order of (u, v) in t1
        a1, b1, c1 = int(tris[t1, 0]), int(tris[t1, 1]), int(tris[t1, 2])
        if (a1 == u and b1 == v) or (b1 == u and c1 == v) or (c1 == u and a1 == v):
            # In t1, edge goes u -> v -> opp1, so quad is (u, opp2, v, opp1)
            q = (u, opp2, v, opp1)
        else:
            # In t1, edge goes v -> u -> opp1, so quad is (v, opp2, u, opp1)
            q = (v, opp2, u, opp1)
        # Quick convexity check: cross products at all 4 corners must align with unit_n[t1]
        p0, p1, p2, p3 = verts[q[0]], verts[q[1]], verts[q[2]], verts[q[3]]
        n_ref = unit_n[t1]
        if (
            np.dot(np.cross(p1 - p0, p2 - p1), n_ref) > 0.0
            and np.dot(np.cross(p2 - p1, p3 - p2), n_ref) > 0.0
            and np.dot(np.cross(p3 - p2, p0 - p3), n_ref) > 0.0
            and np.dot(np.cross(p0 - p3, p1 - p0), n_ref) > 0.0
        ):
            quads.append(q)
            used[t1] = True
            used[t2] = True

    for ti in range(n_t):
        if not used[ti]:
            a, b, c = int(tris[ti, 0]), int(tris[ti, 1]), int(tris[ti, 2])
            if a != b and b != c and a != c:
                quads.append((a, b, c, c))

    return np.array(quads, dtype=np.int64) if quads else np.empty((0, 4), dtype=np.int64)


def _clean_solid_bim_element_faces(
    verts: np.ndarray,
    tris: np.ndarray,
    category: str,
) -> Tuple[np.ndarray, np.ndarray, int]:
    """
    Cleans a single 3D solid BIM element (already in meters) BEFORE merging into a group:
    1. Merges coplanar triangle pairs into clean quads (0% area loss).
    2. For `glazing`, `spandrel`, and `wall` thin solid panels (e.g. 2cm glass box or
       5-15cm spandrel/wall slab), strips thin vertical thickness-edge slivers
       (w_xy <= 0.10m AND area < 25% of largest vertical face on that element) so
       panel thickness edges NEVER leak into exterior OTTV area or wrong compass directions.
    Returns `(verts, cleaned_quads, slivers_removed_count)`.
    """
    if len(verts) < 3 or len(tris) < 1:
        return verts, np.empty((0, 4), dtype=np.int64), 0

    quads = _merge_coplanar_tris_to_quads(verts, tris)
    if len(quads) == 0 or category not in ("glazing", "spandrel", "wall", "composite_cw"):
        return verts, quads, 0

    is_q = quads[:, 2] != quads[:, 3]
    p0 = verts[quads[:, 0]]
    p1 = verts[quads[:, 1]]
    p2 = verts[quads[:, 2]]
    p3 = verts[quads[:, 3]]

    c1 = np.cross(p1 - p0, p2 - p0)
    c2 = np.where(is_q[:, None], np.cross(p2 - p0, p3 - p0), 0.0)
    cross_sum = c1 + c2
    areas = 0.5 * np.linalg.norm(cross_sum, axis=1)
    valid = areas > 1e-5
    if not np.any(valid):
        return verts, np.empty((0, 4), dtype=np.int64), len(quads)

    quads = quads[valid]
    areas = areas[valid]
    normals = cross_sum[valid] / (2.0 * areas[:, None])
    p0, p1, p2, p3 = p0[valid], p1[valid], p2[valid], p3[valid]

    f_min = np.minimum(np.minimum(p0, p1), np.minimum(p2, p3))
    f_max = np.maximum(np.maximum(p0, p1), np.maximum(p2, p3))
    spans = f_max - f_min
    w_xy = np.hypot(spans[:, 0], spans[:, 1])

    is_vert = np.abs(normals[:, 2]) <= 0.85
    if not np.any(is_vert):
        return verts, np.empty((0, 4), dtype=np.int64), len(quads)

    max_vert_area = float(np.max(areas[is_vert]))
    elem_span = np.max(verts, axis=0) - np.min(verts, axis=0)
    min_elem_dim = float(np.min(elem_span))

    # Strip top/bottom caps on thin glazing/spandrel panels & strip thin edge slivers (<= 10cm)
    sliver_thresh = 0.12 if category in ("glazing", "spandrel") else 0.08
    is_thin_edge = is_vert & (w_xy <= sliver_thresh) & (areas < 0.25 * max_vert_area)
    if category in ("glazing", "spandrel") or min_elem_dim <= 0.14:
        keep = is_vert & (~is_thin_edge)
    else:
        keep = ~is_thin_edge

    slivers_removed = int(np.sum(is_thin_edge))
    cleaned = quads[keep]
    return verts, cleaned, slivers_removed


def _filter_thin_edge_slivers_on_group(rg: RawGroupMesh) -> int:
    """
    Post-normalization thin-edge sliver filter for non-IFC formats (.3dm, .obj, .glb)
    whose solid glass/spandrel boxes were merged before element-level splitting.
    """
    if rg.default_category not in ("glazing", "spandrel") or len(rg.faces) < 4:
        return 0
    vs = rg.vertices
    fs = rg.faces
    is_q = fs[:, 2] != fs[:, 3]
    p0, p1, p2, p3 = vs[fs[:, 0]], vs[fs[:, 1]], vs[fs[:, 2]], vs[fs[:, 3]]
    c1 = np.cross(p1 - p0, p2 - p0)
    c2 = np.where(is_q[:, None], np.cross(p2 - p0, p3 - p0), 0.0)
    cross_sum = c1 + c2
    areas = 0.5 * np.linalg.norm(cross_sum, axis=1)
    normals = np.where(areas[:, None] > 1e-6, cross_sum / np.maximum(1e-6, 2.0 * areas[:, None]), 0.0)

    f_min = np.minimum(np.minimum(p0, p1), np.minimum(p2, p3))
    f_max = np.maximum(np.maximum(p0, p1), np.maximum(p2, p3))
    spans = f_max - f_min
    w_xy = np.hypot(spans[:, 0], spans[:, 1])

    is_vert = np.abs(normals[:, 2]) <= 0.85
    if not np.any(is_vert):
        return 0
    med_area = float(np.percentile(areas[is_vert], 75))
    is_sliver = is_vert & (w_xy <= 0.085) & (areas < 0.22 * med_area) & (areas < 0.25)
    n_sliv = int(np.sum(is_sliver))
    if n_sliv > 0 and n_sliv < len(fs):
        rg.faces = fs[~is_sliver]
        return n_sliv
    return 0


# ============================================================================
# WAVEFRONT .OBJ + .MTL PARSER WITH TRANSPARENCY & LAYER::USEMTL DECOMPOSITION
# ============================================================================

def _parse_mtl_transparencies(mtl_path: str) -> Dict[str, float]:
    """Reads `newmtl` opacity (`d` or `Tr`) from a companion .mtl file (returns transparency 0..1)."""
    trans: Dict[str, float] = {}
    if not os.path.isfile(mtl_path):
        return trans
    cur_m = ""
    try:
        with open(mtl_path, "r", encoding="utf-8", errors="ignore") as f:
            for raw in f:
                line = raw.strip()
                if line.startswith("newmtl "):
                    cur_m = line[7:].strip()
                elif cur_m and line.startswith("d "):
                    try:
                        d_val = float(line.split()[1])
                        trans[cur_m] = max(0.0, min(1.0, 1.0 - d_val))
                    except ValueError:
                        pass
                elif cur_m and line.startswith("Tr "):
                    try:
                        tr_val = float(line.split()[1])
                        trans[cur_m] = max(0.0, min(1.0, tr_val))
                    except ValueError:
                        pass
    except Exception:
        pass
    return trans


def _parse_obj_with_materials(filepath: str) -> Tuple[Dict[Tuple[str, str], Tuple[np.ndarray, np.ndarray]], Dict[str, float], bool]:
    """
    Fast Wavefront .obj parser that preserves `o` (object), `g` (group), `usemtl` (material),
    companion `.mtl` transparency values, and detects Y-Up authoring signatures (Archicad,
    Blender, SketchUp, Maya, Revit).
    """
    verts_list: List[Tuple[float, float, float]] = []
    v_append = verts_list.append
    cur_obj = "Default_Object"
    cur_grp = ""
    cur_mtl = "Default_Material"
    face_buckets: Dict[Tuple[str, str], List[Tuple[int, int, int, int]]] = {}
    cur_bucket: Optional[List[Tuple[int, int, int, int]]] = None
    cur_bucket_key: Optional[Tuple[str, str]] = None
    mtl_transparencies: Dict[str, float] = {}
    base_dir = os.path.dirname(filepath)
    y_up_hint = False
    n_v = 0

    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            if not raw_line:
                continue
            c0 = raw_line[0]
            if c0 == "v":
                if len(raw_line) > 2 and raw_line[1] == " ":
                    parts = raw_line.split()
                    if len(parts) >= 4:
                        try:
                            v_append((float(parts[1]), float(parts[2]), float(parts[3])))
                            n_v += 1
                        except ValueError:
                            pass
                continue
            if c0 == "f" and len(raw_line) > 2 and raw_line[1] == " ":
                parts = raw_line[2:].split()
                plen = len(parts)
                if plen < 3:
                    continue
                has_slash = "/" in raw_line
                idxs: List[int] = []
                for p in parts:
                    v_str = p.split("/", 1)[0] if has_slash else p
                    try:
                        vi = int(v_str)
                        idxs.append((vi - 1) if vi > 0 else (n_v + vi))
                    except ValueError:
                        pass
                ilen = len(idxs)
                if ilen < 3:
                    continue
                layer_key = cur_grp if cur_grp else cur_obj
                bkey = (layer_key, cur_mtl)
                if bkey != cur_bucket_key:
                    cur_bucket_key = bkey
                    cur_bucket = face_buckets.get(bkey)
                    if cur_bucket is None:
                        cur_bucket = []
                        face_buckets[bkey] = cur_bucket
                if ilen == 3:
                    cur_bucket.append((idxs[0], idxs[1], idxs[2], idxs[2]))
                elif ilen == 4:
                    cur_bucket.append((idxs[0], idxs[1], idxs[2], idxs[3]))
                else:
                    i0 = idxs[0]
                    for k in range(1, ilen - 1):
                        cur_bucket.append((i0, idxs[k], idxs[k + 1], idxs[k + 1]))
                continue

            line = raw_line.strip()
            if not line:
                continue
            if c0 == "#":
                lo = line.lower()
                if any(k in lo for k in ("archicad", "blender", "sketchup", "maya", "cinema 4d", "3ds max", "revit", "y-up")):
                    y_up_hint = True
            elif line.startswith("trace_obj ") or line.startswith("shadow_obj "):
                # Standard Wavefront ArchiCAD OBJ export header (always Y-Up)
                y_up_hint = True
            elif line.startswith("mtllib "):
                mtl_file = line[7:].strip()
                mtl_transparencies.update(_parse_mtl_transparencies(os.path.join(base_dir, mtl_file)))
            elif line.startswith("o "):
                cur_obj = line[2:].strip() or "Object"
            elif line.startswith("g "):
                cur_grp = line[2:].strip()
            elif line.startswith("usemtl "):
                cur_mtl = line[7:].strip() or "Default_Material"

    if not verts_list or not face_buckets:
        return {}, mtl_transparencies, y_up_hint

    all_v = np.array(verts_list, dtype=np.float64)
    out: Dict[Tuple[str, str], Tuple[np.ndarray, np.ndarray]] = {}
    for key, f_list in face_buckets.items():
        if not f_list:
            continue
        f_arr = np.array(f_list, dtype=np.int64)
        uniq_v, inv = np.unique(f_arr, return_inverse=True)
        valid_uniq = np.clip(uniq_v, 0, len(all_v) - 1)
        sub_v = all_v[valid_uniq]
        sub_f = inv.reshape(f_arr.shape)
        out[key] = (sub_v, sub_f)

    return out, mtl_transparencies, y_up_hint


# ============================================================================
# NATIVE BIM .IFC ENGINE — PRIMARY: IfcOpenShell (OpenCASCADE C++ Kernel)
# ============================================================================

def _parse_ifc_with_ifcopenshell(
    filepath: str,
) -> Tuple[
    List[Tuple[str, str, str, str, np.ndarray, np.ndarray, Optional[bool], Optional[float]]],
    str,
    List[Dict[str, Any]],
    int,
    int,
    str,
]:
    """
    Production-grade BIM IFC2x3 / IFC4 / IFC4X3 loader powered by IfcOpenShell (OpenCASCADE C++).
    Automatically handles:
    - Boolean void subtraction (`IfcOpeningElement` / `IfcRelVoidsElement` so windows never double-count walls!)
    - All BIM geometry primitives (`IfcFacetedBrep`, `IfcExtrudedAreaSolid`, `IfcBooleanClippingResult`,
      `IfcTriangulatedFaceSet`, `IfcPolygonalFaceSet`, `IfcMappedItem`, `IfcSweptDiskSolid`, etc.)
    - Full `IfcLocalPlacement` transform trees & automatic project unit conversion to meters
    - ArchiCAD / Revit `IfcBuildingElementPart` aggregated under `IfcCurtainWall`
    - Physical material transparency (`transparency > 0.12` -> automatic `glazing` detection!)
    - `IfcSurfaceStyle` + `IfcMaterial` semantic group resolution
    - `Pset_*Common.IsExternal` (auto-filters interior partitions) & `ThermalTransmittance`
    - Per-element solid-box thin-edge sliver stripping + coplanar triangle-to-quad merging.
    Returns `(chunks, detected_unit_from_header, storeys, slivers_removed, interior_filtered, kernel_info)`.
    NOTE: Vertices returned by IfcOpenShell are ALREADY in meters!
    """
    model = ifcopenshell.open(filepath)
    schema = str(getattr(model, "schema", "IFC"))
    unit_scale = float(ifcopenshell.util.unit.calculate_unit_scale(model) or 1.0)
    if abs(unit_scale - 0.001) < 1e-5:
        detected_unit = "mm"
    elif abs(unit_scale - 0.01) < 1e-4:
        detected_unit = "cm"
    elif abs(unit_scale - 0.3048) < 1e-3:
        detected_unit = "ft"
    elif abs(unit_scale - 0.0254) < 1e-3:
        detected_unit = "in"
    else:
        detected_unit = "m"

    # 1. Extract native BIM storeys
    storeys: List[Dict[str, Any]] = []
    for st in model.by_type("IfcBuildingStorey"):
        elev = getattr(st, "Elevation", None)
        elev_m = round(float(elev) * unit_scale, 3) if elev is not None else 0.0
        storeys.append({
            "id": st.id(),
            "name": str(getattr(st, "Name", None) or getattr(st, "LongName", None) or f"Storey_{st.id()}"),
            "elevation_m": elev_m,
        })
    storeys.sort(key=lambda s: s["elevation_m"])

    # 2. Build fast lookup: IfcSurfaceStyleRendering.#id -> IfcSurfaceStyle.Name
    style_name_by_rendering_id: Dict[int, str] = {}
    for ss in model.by_type("IfcSurfaceStyle"):
        s_name = str(getattr(ss, "Name", "") or "").strip()
        if not s_name:
            continue
        for sub in (getattr(ss, "Styles", None) or ()):
            style_name_by_rendering_id[sub.id()] = s_name
        style_name_by_rendering_id[ss.id()] = s_name

    # 3. Build parent aggregation map (child_id -> (parent_type, parent_name, parent_elem))
    parent_map: Dict[int, Tuple[str, str, Any]] = {}
    for rel in model.by_type("IfcRelAggregates"):
        rel_obj = getattr(rel, "RelatingObject", None)
        if rel_obj is None:
            continue
        p_type = rel_obj.is_a()
        if p_type in ("IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey"):
            continue
        p_name = str(getattr(rel_obj, "Name", "") or p_type).strip()
        for child in (getattr(rel, "RelatedObjects", None) or ()):
            parent_map[child.id()] = (p_type, p_name, rel_obj)

    # 4. Build element -> IfcMaterial name map
    elem_mat_name: Dict[int, str] = {}
    for rel in model.by_type("IfcRelAssociatesMaterial"):
        m_obj = getattr(rel, "RelatingMaterial", None)
        m_name = ""
        if m_obj is not None:
            if hasattr(m_obj, "Name") and m_obj.Name:
                m_name = str(m_obj.Name).strip()
            elif m_obj.is_a("IfcMaterialLayerSetUsage"):
                ls = getattr(m_obj, "ForLayerSet", None)
                if ls and getattr(ls, "LayerSetName", None):
                    m_name = str(ls.LayerSetName).strip()
            elif m_obj.is_a("IfcMaterialLayerSet") and getattr(m_obj, "LayerSetName", None):
                m_name = str(m_obj.LayerSetName).strip()
        if m_name:
            for obj in (getattr(rel, "RelatedObjects", None) or ()):
                elem_mat_name[obj.id()] = m_name

    def _get_bim_props(el: Any) -> Tuple[Optional[bool], Optional[float]]:
        is_ext: Optional[bool] = None
        u_val: Optional[float] = None
        for rel in (getattr(el, "IsDefinedBy", None) or ()):
            if not rel.is_a("IfcRelDefinesByProperties"):
                continue
            pdef = getattr(rel, "RelatingPropertyDefinition", None)
            if pdef is None or not pdef.is_a("IfcPropertySet"):
                continue
            for prop in (getattr(pdef, "HasProperties", None) or ()):
                if not prop.is_a("IfcPropertySingleValue"):
                    continue
                pname = str(getattr(prop, "Name", "") or "")
                pval = getattr(prop, "NominalValue", None)
                if pval is None:
                    continue
                val = getattr(pval, "wrappedValue", pval)
                if pname == "IsExternal" and isinstance(val, bool):
                    is_ext = val
                elif pname == "ThermalTransmittance":
                    try:
                        u_val = float(val)
                    except (TypeError, ValueError):
                        pass
        return is_ext, u_val

    # 5. Multithreaded OpenCASCADE geometry iteration (already in meters, world coords, openings cut!)
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    # Exclude non-envelope site terrain, earthworks, spatial zones, MEP, furniture, and openings
    exclude_types = (
        "IfcSpace",
        "IfcSpatialZone",
        "IfcSite",
        "IfcEarthworksFill",
        "IfcEarthworksCut",
        "IfcGeographicElement",
        "IfcOpeningElement",
        "IfcFurnishingElement",
        "IfcFurniture",
        "IfcDistributionElement",
        "IfcFlowTerminal",
        "IfcFlowSegment",
        "IfcFlowFitting",
        "IfcAnnotation",
        "IfcVirtualElement",
    )
    num_threads = max(1, min(8, multiprocessing.cpu_count()))
    iterator = ifcopenshell.geom.iterator(settings, model, num_threads, exclude=exclude_types)

    chunks: List[Tuple[str, str, str, str, np.ndarray, np.ndarray, Optional[bool], Optional[float]]] = []
    slivers_removed_total = 0
    interior_filtered_total = 0

    def _resolve_mat_label(m_obj: Any) -> Tuple[str, float]:
        raw_mname = str(getattr(m_obj, "name", "") or "")
        tr = float(getattr(m_obj, "transparency", 0.0) or 0.0)
        m_id_match = re.search(r"(\d+)$", raw_mname)
        if m_id_match and int(m_id_match.group(1)) in style_name_by_rendering_id:
            return style_name_by_rendering_id[int(m_id_match.group(1))], tr
        if raw_mname and not raw_mname.startswith("IfcSurfaceStyle"):
            return raw_mname, tr
        return "", tr

    if iterator.initialize():
        while True:
            shape = iterator.get()
            elem = model.by_id(shape.id)
            if elem is not None:
                etype = elem.is_a()
                p_info = parent_map.get(elem.id())
                p_type, p_name, p_elem = p_info if p_info else ("", "", None)

                is_ext, u_bim = _get_bim_props(elem)
                if is_ext is None and p_elem is not None:
                    is_ext, u_bim_p = _get_bim_props(p_elem)
                    if u_bim is None:
                        u_bim = u_bim_p

                geom = shape.geometry
                verts = np.array(geom.verts, dtype=np.float64).reshape(-1, 3)
                tris = np.array(geom.faces, dtype=np.int64).reshape(-1, 3)

                if len(verts) >= 3 and len(tris) >= 1:
                    mats = list(geom.materials)
                    mat_ids = np.array(geom.material_ids, dtype=np.int64)
                    uniq_mids = [int(m) for m in np.unique(mat_ids) if 0 <= int(m) < len(mats)]
                    layer_label = f"{p_type.replace('Ifc', 'IFC_')} ({p_name})" if p_type else etype.replace("Ifc", "IFC_")
                    mat_fallback = elem_mat_name.get(elem.id()) or str(getattr(elem, "Name", "") or etype)

                    # Split multi-material BIM elements (especially IfcWindow / IfcDoor / IfcCurtainWall)
                    # by material_id so transparent glass panes separate cleanly from opaque wood/aluminium frames!
                    has_transp_mat = any(float(getattr(mats[m], "transparency", 0.0) or 0.0) > 0.12 for m in uniq_mids)
                    has_opaque_mat = any(float(getattr(mats[m], "transparency", 0.0) or 0.0) <= 0.12 for m in uniq_mids)
                    split_by_mat = (len(uniq_mids) > 1) and (
                        (has_transp_mat and has_opaque_mat) or etype in ("IfcWindow", "IfcDoor", "IfcCurtainWall")
                    )

                    sub_batches: List[Tuple[str, float, np.ndarray]] = []
                    if split_by_mat:
                        for mid in uniq_mids:
                            s_lbl, tr = _resolve_mat_label(mats[mid])
                            sub_t = tris[mat_ids == mid]
                            if len(sub_t) > 0:
                                sub_batches.append((s_lbl, tr, sub_t))
                    else:
                        resolved_style = ""
                        max_transp = 0.0
                        for mid in uniq_mids:
                            s_lbl, tr = _resolve_mat_label(mats[mid])
                            max_transp = max(max_transp, tr)
                            if s_lbl and not resolved_style:
                                resolved_style = s_lbl
                        sub_batches.append((resolved_style, max_transp, tris))

                    for resolved_style, tr_val, sub_tris in sub_batches:
                        style_or_mat = resolved_style or mat_fallback
                        if style_or_mat.lower().startswith("virtual_"):
                            continue

                        if is_ext is False:
                            cat = "roof"
                            g_name = f"Interior :: {layer_label} :: {style_or_mat}"
                            interior_filtered_total += 1
                        else:
                            if tr_val > 0.12:
                                cat = "glazing"
                            elif etype in ("IfcShadingDevice",):
                                cat = "shading"
                            elif etype in ("IfcSlab", "IfcRoof", "IfcFooting", "IfcStair", "IfcStairFlight"):
                                cat = "roof"
                            elif etype in ("IfcMember", "IfcRailing", "IfcColumn", "IfcBeam"):
                                cat = "frame"
                            elif etype == "IfcWindow":
                                sm_lo = style_or_mat.lower()
                                if (split_by_mat and has_transp_mat and tr_val <= 0.12) or any(
                                    k in sm_lo for k in ("frame", "mullion", "sash", "kusen", "holz", "wood", "metal", "aluminium", "pvc")
                                ):
                                    cat = "frame"
                                else:
                                    cat = "glazing"
                            elif etype == "IfcDoor":
                                cat = "glazing" if ("glass" in style_or_mat.lower() or tr_val > 0.12) else "wall"
                            else:
                                if resolved_style:
                                    cat = classify_layer_or_material_role(f"{resolved_style} {etype}")
                                else:
                                    cat = classify_layer_or_material_role(f"{style_or_mat} {elem.Name or ''} {etype}")
                                if p_type == "IfcCurtainWall" and cat == "wall":
                                    z_span_el = float(np.max(verts[:, 2]) - np.min(verts[:, 2]))
                                    if z_span_el <= 1.35:
                                        cat = "spandrel"
                            g_name = f"{layer_label} :: {style_or_mat}" if style_or_mat != layer_label else layer_label

                        v_clean, f_clean, n_sliv = _clean_solid_bim_element_faces(verts, sub_tris, cat)
                        slivers_removed_total += n_sliv
                        if len(f_clean) > 0:
                            chunks.append((g_name, layer_label, style_or_mat, cat, v_clean, f_clean, is_ext, u_bim))

            if not iterator.next():
                break

    kernel_info = f"IfcOpenShell {ifcopenshell.version} (OpenCASCADE · {schema})"
    return chunks, detected_unit, storeys, slivers_removed_total, interior_filtered_total, kernel_info


# ============================================================================
# NATIVE BIM .IFC (STEP) UNIVERSAL PARSER & SAMPLE GENERATOR
# ============================================================================

def _parse_ifc_file(
    filepath: str,
) -> Tuple[Dict[Tuple[str, str], List[Tuple[np.ndarray, np.ndarray]]], str, List[Dict[str, Any]]]:
    """
    Universal pure-Python IFC2x3 / IFC4 STEP parser for architectural envelope simulation.
    Extracts:
    - Unit scale ('mm' or 'm') from IFCSIUNIT
    - Native BIM storeys (`IFCBUILDINGSTOREY`) with name and elevation in meters
    - Semantic BIM elements (`IFCCURTAINWALL`, `IFCPLATE`, `IFCMEMBER`, `IFCWALL`,
      `IFCWALLSTANDARDCASE`, `IFCWINDOW`, `IFCSLAB`, `IFCROOF`, `IFCSHADINGDEVICE`)
    - 3D Geometry from `IFCPOLYGONALFACESET`, `IFCTRIANGULATEDFACESET`, `IFCFACETEDBREP`,
      and `IFCEXTRUDEDAREASOLID`.
    """
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    # 1. Detect length unit (MILLI + METRE vs METRE)
    detected_unit = "m"
    if re.search(r"IFCSIUNIT\s*\([^;]*\.LENGTHUNIT\.\s*,\s*\.MILLI\.\s*,\s*\.METRE\.", text, re.IGNORECASE):
        detected_unit = "mm"
    elif re.search(r"IFCSIUNIT\s*\([^;]*\.LENGTHUNIT\.\s*,\s*\.CENTI\.\s*,\s*\.METRE\.", text, re.IGNORECASE):
        detected_unit = "cm"
    unit_scale = UNIT_SCALE_TO_METERS.get(detected_unit, 1.0)

    # Parse all #ID = ENTITYTYPE(args); statements
    entity_map: Dict[int, Tuple[str, str]] = {}
    for m in re.finditer(r"#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([^;]*)\)\s*;", text):
        eid = int(m.group(1))
        etype = m.group(2).upper()
        eargs = m.group(3).strip()
        entity_map[eid] = (etype, eargs)

    # Extract Cartesian Points (#id -> (x, y, z))
    pts_2d3d: Dict[int, Tuple[float, ...]] = {}
    dirs_2d3d: Dict[int, Tuple[float, ...]] = {}
    for eid, (etype, eargs) in entity_map.items():
        if etype == "IFCCARTESIANPOINT":
            cm = re.search(r"\(([-+0-9.,Ee\s]+)\)", eargs)
            if cm:
                coords = [float(x) for x in cm.group(1).split(",") if x.strip()]
                pts_2d3d[eid] = tuple(coords)
        elif etype == "IFCDIRECTION":
            cm = re.search(r"\(([-+0-9.,Ee\s]+)\)", eargs)
            if cm:
                coords = [float(x) for x in cm.group(1).split(",") if x.strip()]
                dirs_2d3d[eid] = tuple(coords)
        elif etype == "IFCCARTESIANPOINTLIST3D":
            pts_list = []
            for pm in re.finditer(r"\(([-+0-9.,Ee\s]+)\)", eargs):
                c = [float(x) for x in pm.group(1).split(",") if x.strip()]
                if len(c) >= 3:
                    pts_list.append((c[0], c[1], c[2]))
            pts_2d3d[eid] = tuple(pts_list)  # type: ignore

    # Extract IFCBUILDINGSTOREY
    storeys: List[Dict[str, Any]] = []
    for eid, (etype, eargs) in entity_map.items():
        if etype == "IFCBUILDINGSTOREY":
            # IFCBUILDINGSTOREY('guid', #owner, 'Name', 'Desc', ..., Elevation)
            strs = re.findall(r"'([^']*)'", eargs)
            name = strs[1] if len(strs) >= 2 and strs[1] else (strs[0] if strs else f"Storey_{eid}")
            nums = re.findall(r"(?<=[,\s])([-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?)\s*$", eargs)
            elev_raw = float(nums[-1]) if nums else 0.0
            storeys.append({
                "id": eid,
                "name": name,
                "elevation_m": round(elev_raw * unit_scale, 3),
            })
    storeys.sort(key=lambda s: s["elevation_m"])

    # Helper: resolve IFCAXIS2PLACEMENT3D & IFCLOCALPLACEMENT into 4x4 matrix
    def _resolve_axis2placement3d(aid: int) -> np.ndarray:
        mat = np.eye(4, dtype=np.float64)
        if aid not in entity_map:
            return mat
        etype, eargs = entity_map[aid]
        if etype != "IFCAXIS2PLACEMENT3D":
            return mat
        refs = [int(x) for x in re.findall(r"#(\d+)", eargs)]
        loc = pts_2d3d.get(refs[0], (0.0, 0.0, 0.0)) if len(refs) >= 1 else (0.0, 0.0, 0.0)
        z_dir = np.array([0.0, 0.0, 1.0], dtype=np.float64)
        x_dir = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        # Parse positional args (Location, Axis, RefDirection)
        parts = [p.strip() for p in eargs.split(",")]
        if len(parts) >= 2 and parts[1].startswith("#"):
            d_z = dirs_2d3d.get(int(parts[1][1:]))
            if d_z and len(d_z) >= 3:
                z_dir = np.array(d_z[:3], dtype=np.float64)
                z_dir /= max(1e-9, np.linalg.norm(z_dir))
        if len(parts) >= 3 and parts[2].startswith("#"):
            d_x = dirs_2d3d.get(int(parts[2][1:]))
            if d_x and len(d_x) >= 3:
                x_dir = np.array(d_x[:3], dtype=np.float64)
                x_dir = x_dir - np.dot(x_dir, z_dir) * z_dir
                n_x = np.linalg.norm(x_dir)
                if n_x > 1e-6:
                    x_dir /= n_x
        y_dir = np.cross(z_dir, x_dir)
        y_dir /= max(1e-9, np.linalg.norm(y_dir))
        x_dir = np.cross(y_dir, z_dir)
        mat[:3, 0] = x_dir
        mat[:3, 1] = y_dir
        mat[:3, 2] = z_dir
        if len(loc) >= 3:
            mat[:3, 3] = [loc[0], loc[1], loc[2]]
        return mat

    placement_cache: Dict[int, np.ndarray] = {}

    def _resolve_local_placement(pid: int, depth: int = 0) -> np.ndarray:
        if pid in placement_cache:
            return placement_cache[pid]
        if depth > 12 or pid not in entity_map:
            return np.eye(4, dtype=np.float64)
        etype, eargs = entity_map[pid]
        if etype != "IFCLOCALPLACEMENT":
            return _resolve_axis2placement3d(pid)
        parts = [p.strip() for p in eargs.split(",")]
        parent_mat = np.eye(4, dtype=np.float64)
        rel_mat = np.eye(4, dtype=np.float64)
        if len(parts) >= 1 and parts[0].startswith("#"):
            parent_mat = _resolve_local_placement(int(parts[0][1:]), depth + 1)
        if len(parts) >= 2 and parts[1].startswith("#"):
            rel_mat = _resolve_axis2placement3d(int(parts[1][1:]))
        res = parent_mat @ rel_mat
        placement_cache[pid] = res
        return res

    # Helper: extract mesh from a geometric representation item (#id)
    def _extract_geom_item(gid: int) -> Optional[Tuple[np.ndarray, np.ndarray]]:
        if gid not in entity_map:
            return None
        etype, eargs = entity_map[gid]

        if etype == "IFCFACETEDBREP":
            refs = [int(x) for x in re.findall(r"#(\d+)", eargs)]
            if not refs:
                return None
            shell_id = refs[0]
            if shell_id not in entity_map:
                return None
            _, s_args = entity_map[shell_id]
            face_ids = [int(x) for x in re.findall(r"#(\d+)", s_args)]
            v_list: List[Tuple[float, float, float]] = []
            f_list: List[Tuple[int, int, int, int]] = []
            for fid in face_ids:
                if fid not in entity_map:
                    continue
                _, f_args = entity_map[fid]
                bound_ids = [int(x) for x in re.findall(r"#(\d+)", f_args)]
                for bid in bound_ids:
                    if bid not in entity_map:
                        continue
                    _, b_args = entity_map[bid]
                    loop_ids = [int(x) for x in re.findall(r"#(\d+)", b_args)]
                    for lid in loop_ids:
                        if lid not in entity_map:
                            continue
                        ltype, l_args = entity_map[lid]
                        if ltype == "IFCPOLYLOOP":
                            pt_ids = [int(x) for x in re.findall(r"#(\d+)", l_args)]
                            pts = [pts_2d3d.get(pid) for pid in pt_ids if pid in pts_2d3d]
                            pts3 = [(p[0], p[1], p[2]) for p in pts if p and len(p) >= 3]
                            if len(pts3) >= 3:
                                base = len(v_list)
                                v_list.extend(pts3)
                                if len(pts3) == 3:
                                    f_list.append((base, base + 1, base + 2, base + 2))
                                elif len(pts3) == 4:
                                    f_list.append((base, base + 1, base + 2, base + 3))
                                else:
                                    for k in range(1, len(pts3) - 1):
                                        f_list.append((base, base + k, base + k + 1, base + k + 1))
            if v_list and f_list:
                return np.array(v_list, dtype=np.float64), np.array(f_list, dtype=np.int64)

        elif etype == "IFCEXTRUDEDAREASOLID":
            # IFCEXTRUDEDAREASOLID(#SweptArea, #Position, #ExtrudedDirection, Depth)
            parts = [p.strip() for p in eargs.split(",")]
            if len(parts) < 4:
                return None
            prof_id = int(parts[0][1:]) if parts[0].startswith("#") else -1
            pos_id = int(parts[1][1:]) if parts[1].startswith("#") else -1
            dir_id = int(parts[2][1:]) if parts[2].startswith("#") else -1
            try:
                depth = float(parts[3])
            except ValueError:
                depth = 1.0

            if prof_id not in entity_map:
                return None
            ptype, p_args = entity_map[prof_id]
            loop_2d: List[Tuple[float, float]] = []
            if ptype == "IFCRECTANGLEPROFILEDEF":
                # IFCRECTANGLEPROFILEDEF(.AREA., 'Name', #Pos, XDim, YDim)
                pp = [x.strip() for x in p_args.split(",")]
                if len(pp) >= 5:
                    try:
                        xdim = float(pp[-2])
                        ydim = float(pp[-1])
                        hx, hy = 0.5 * xdim, 0.5 * ydim
                        loop_2d = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
                    except ValueError:
                        pass
            elif ptype == "IFCARBITRARYCLOSEDPROFILEDEF":
                refs = [int(x) for x in re.findall(r"#(\d+)", p_args)]
                if refs and refs[-1] in entity_map:
                    _, c_args = entity_map[refs[-1]]
                    pt_ids = [int(x) for x in re.findall(r"#(\d+)", c_args)]
                    for pid in pt_ids:
                        p2 = pts_2d3d.get(pid)
                        if p2 and len(p2) >= 2:
                            loop_2d.append((p2[0], p2[1]))
                    if len(loop_2d) > 2 and loop_2d[0] == loop_2d[-1]:
                        loop_2d.pop()

            if len(loop_2d) < 3:
                return None

            ext_dir = dirs_2d3d.get(dir_id, (0.0, 0.0, 1.0))
            dx = (ext_dir[0] if len(ext_dir) >= 1 else 0.0) * depth
            dy = (ext_dir[1] if len(ext_dir) >= 2 else 0.0) * depth
            dz = (ext_dir[2] if len(ext_dir) >= 3 else 1.0) * depth

            n_p = len(loop_2d)
            bot_pts = [(x, y, 0.0) for x, y in loop_2d]
            top_pts = [(x + dx, y + dy, dz) for x, y in loop_2d]
            verts = np.array(bot_pts + top_pts, dtype=np.float64)
            faces: List[Tuple[int, int, int, int]] = []
            for i in range(n_p):
                j = (i + 1) % n_p
                faces.append((i, j, n_p + j, n_p + i))
            pos_mat = _resolve_axis2placement3d(pos_id) if pos_id > 0 else np.eye(4, dtype=np.float64)
            verts = _apply_xform(verts, pos_mat)
            return verts, np.array(faces, dtype=np.int64)

        return None

    # Helper: traverse IFCPRODUCTDEFINITIONSHAPE -> IFCSHAPEREPRESENTATION -> Items
    def _extract_product_meshes(prod_args: str) -> List[Tuple[np.ndarray, np.ndarray]]:
        # Product args typically: ('Guid', #Owner, 'Name', 'Desc', 'ObjType', #ObjectPlacement, #Representation, ...)
        refs = [int(x) for x in re.findall(r"#(\d+)", prod_args)]
        if len(refs) < 2:
            return []
        place_id = -1
        rep_id = -1
        for r in refs:
            if r in entity_map:
                rt, _ = entity_map[r]
                if rt == "IFCLOCALPLACEMENT" and place_id < 0:
                    place_id = r
                elif rt in ("IFCPRODUCTDEFINITIONSHAPE", "IFCSHAPEREPRESENTATION") and rep_id < 0:
                    rep_id = r

        if rep_id < 0:
            return []

        place_mat = _resolve_local_placement(place_id) if place_id > 0 else np.eye(4, dtype=np.float64)

        shape_rep_ids: List[int] = []
        rt, r_args = entity_map[rep_id]
        if rt == "IFCPRODUCTDEFINITIONSHAPE":
            shape_rep_ids = [int(x) for x in re.findall(r"#(\d+)", r_args)]
        else:
            shape_rep_ids = [rep_id]

        meshes: List[Tuple[np.ndarray, np.ndarray]] = []
        for srid in shape_rep_ids:
            if srid not in entity_map:
                continue
            st, s_args = entity_map[srid]
            if st != "IFCSHAPEREPRESENTATION":
                continue
            item_ids = [int(x) for x in re.findall(r"#(\d+)", s_args)]
            for iid in item_ids:
                if iid not in entity_map:
                    continue
                it_type, it_args = entity_map[iid]
                if it_type == "IFCMAPPEDITEM":
                    # IFCMAPPEDITEM(#MappingSource, #MappingTarget)
                    m_refs = [int(x) for x in re.findall(r"#(\d+)", it_args)]
                    if m_refs and m_refs[0] in entity_map:
                        _, ms_args = entity_map[m_refs[0]]
                        ms_refs = [int(x) for x in re.findall(r"#(\d+)", ms_args)]
                        if len(ms_refs) >= 2:
                            origin_mat = _resolve_axis2placement3d(ms_refs[0])
                            sub_sr_id = ms_refs[1]
                            if sub_sr_id in entity_map:
                                _, sub_args = entity_map[sub_sr_id]
                                for sub_iid in [int(x) for x in re.findall(r"#(\d+)", sub_args)]:
                                    gm = _extract_geom_item(sub_iid)
                                    if gm:
                                        v_t = _apply_xform(_apply_xform(gm[0], origin_mat), place_mat)
                                        meshes.append((v_t, gm[1]))
                else:
                    gm = _extract_geom_item(iid)
                    if gm:
                        v_t = _apply_xform(gm[0], place_mat)
                        meshes.append((v_t, gm[1]))
        return meshes

    target_bim_types = {
        "IFCCURTAINWALL": ("BIM_CurtainWall", "Composite_CurtainWall"),
        "IFCPLATE": ("BIM_CurtainWall_Panel", "Glazing_or_Spandrel"),
        "IFCMEMBER": ("BIM_CurtainWall_Frame", "Aluminum_Mullion_Transom"),
        "IFCWINDOW": ("BIM_Window_Glazing", "Vision_Glass"),
        "IFCWALL": ("BIM_Exterior_Wall", "Opaque_Wall"),
        "IFCWALLSTANDARDCASE": ("BIM_Exterior_Wall", "Opaque_Wall"),
        "IFCSHADINGDEVICE": ("BIM_External_Shading", "Sun_Louver_Fin"),
        "IFCSLAB": ("BIM_Floor_Slab", "Concrete_Slab"),
        "IFCROOF": ("BIM_Roof_Slab", "Roof_Assembly"),
    }

    chunks: Dict[Tuple[str, str], List[Tuple[np.ndarray, np.ndarray]]] = {}
    for eid, (etype, eargs) in entity_map.items():
        if etype not in target_bim_types:
            continue
        default_layer, default_mat = target_bim_types[etype]
        strs = re.findall(r"'([^']*)'", eargs)
        elem_name = strs[1] if len(strs) >= 2 and strs[1] else default_layer
        obj_type_tag = strs[3] if len(strs) >= 4 and strs[3] else default_mat

        # Clean layer & material group naming for BIM element
        layer_label = f"{etype.replace('IFC', 'IFC_')}"
        mat_label = obj_type_tag if obj_type_tag else elem_name
        if "spandrel" in elem_name.lower() or "spandrel" in mat_label.lower():
            mat_label = "Spandrel_Panel"
        elif "vision" in elem_name.lower() or "glass" in elem_name.lower() or "kaca" in elem_name.lower():
            mat_label = "Vision_Glass"
        elif "mullion" in elem_name.lower() or "transom" in elem_name.lower() or etype == "IFCMEMBER":
            mat_label = "Mullion_Frame"

        meshes = _extract_product_meshes(eargs)
        if not meshes:
            continue
        key = (layer_label, mat_label)
        if key not in chunks:
            chunks[key] = []
        chunks[key].extend(meshes)

    return chunks, detected_unit, storeys


def create_sample_ifc_preset(output_path: str) -> str:
    """
    Generates a valid, self-contained BIM `.ifc` (IFC2x3 STEP) building model
    simulating an ArchiCAD Curtain Wall + Podium Office (6 Storeys: L1 Lobby 4.8m,
    L2-L3 Podium 4.2m, L4-L6 Tower 3.6m) with IFCBUILDINGSTOREY, IFCPLATE (Vision & Spandrel),
    IFCMEMBER (Mullions), IFCWALL (Opaque Core/Podium Wall), and IFCSHADINGDEVICE (Louvers).
    """
    lines = [
        "ISO-10303-21;",
        "HEADER;",
        "FILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]'),'2;1');",
        "FILE_NAME('archicad_bim_curtainwall.ifc','2026-11-13T12:00:00',('Architect'),('ArchiCAD BIM Export'),'OTTV Studio','ArchiCAD 27','');",
        "FILE_SCHEMA(('IFC2X3'));",
        "ENDSEC;",
        "DATA;",
        "#1 = IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
        "#2 = IFCCARTESIANPOINT((0.,0.,0.));",
        "#3 = IFCDIRECTION((0.,0.,1.));",
        "#4 = IFCDIRECTION((1.,0.,0.));",
        "#5 = IFCAXIS2PLACEMENT3D(#2,#3,#4);",
        "#6 = IFCLOCALPLACEMENT($,#5);",
    ]
    next_id = 10

    def _new_id() -> int:
        nonlocal next_id
        nid = next_id
        next_id += 1
        return nid

    # Define 6 BIM Storeys with variable floor heights (Lobby 4.8m, Podium 2x4.2m, Typical 3x3.6m)
    storey_heights = [
        ("L1_Ground_Lobby", 0.0, 4.8),
        ("L2_Podium_Komersial", 4.8, 4.2),
        ("L3_Podium_Komersial", 9.0, 4.2),
        ("L4_Tipikal_Kantor", 13.2, 3.6),
        ("L5_Tipikal_Kantor", 16.8, 3.6),
        ("L6_Top_Executive", 20.4, 3.6),
    ]

    for s_idx, (s_name, z0, fh) in enumerate(storey_heights):
        sid = _new_id()
        lines.append(f"#{sid} = IFCBUILDINGSTOREY('ST_{s_idx+1}',$,'{s_name}','BIM Storey',$,#6,$,'{s_name}',.ELEMENT.,{z0:.3f});")

    def _add_ifc_quad_entity(etype: str, name: str, mat_tag: str, p0: Tuple[float, float, float], p1: Tuple[float, float, float], p2: Tuple[float, float, float], p3: Tuple[float, float, float]) -> None:
        id_p0, id_p1, id_p2, id_p3 = _new_id(), _new_id(), _new_id(), _new_id()
        lines.append(f"#{id_p0} = IFCCARTESIANPOINT(({p0[0]:.3f},{p0[1]:.3f},{p0[2]:.3f}));")
        lines.append(f"#{id_p1} = IFCCARTESIANPOINT(({p1[0]:.3f},{p1[1]:.3f},{p1[2]:.3f}));")
        lines.append(f"#{id_p2} = IFCCARTESIANPOINT(({p2[0]:.3f},{p2[1]:.3f},{p2[2]:.3f}));")
        lines.append(f"#{id_p3} = IFCCARTESIANPOINT(({p3[0]:.3f},{p3[1]:.3f},{p3[2]:.3f}));")
        id_loop = _new_id()
        lines.append(f"#{id_loop} = IFCPOLYLOOP((#{id_p0},#{id_p1},#{id_p2},#{id_p3}));")
        id_bound = _new_id()
        lines.append(f"#{id_bound} = IFCFACEOUTERBOUND(#{id_loop},.T.);")
        id_face = _new_id()
        lines.append(f"#{id_face} = IFCFACE((#{id_bound}));")
        id_shell = _new_id()
        lines.append(f"#{id_shell} = IFCCLOSEDSHELL((#{id_face}));")
        id_brep = _new_id()
        lines.append(f"#{id_brep} = IFCFACETEDBREP(#{id_shell});")
        id_srep = _new_id()
        lines.append(f"#{id_srep} = IFCSHAPEREPRESENTATION($,'Body','Brep',(#{id_brep}));")
        id_pds = _new_id()
        lines.append(f"#{id_pds} = IFCPRODUCTDEFINITIONSHAPE($,$,(#{id_srep}));")
        id_ent = _new_id()
        lines.append(f"#{id_ent} = {etype}('G_{id_ent}',$,'{name}','ArchiCAD Curtain Wall Tool','{mat_tag}',#6,#{id_pds},'TAG_{id_ent}');")

    # Build 8-sided podium (L1-L3, radius=14.5m) + tower (L4-L6, radius=11.2m)
    for s_idx, (s_name, z0, fh) in enumerate(storey_heights):
        is_podium = s_idx < 3
        radius = 14.5 if is_podium else 11.2
        spandrel_h = 1.05
        zm = z0 + spandrel_h
        z1 = z0 + fh

        for sec in range(8):
            a0 = math.radians(sec * 45.0 - 22.5)
            a1 = math.radians((sec + 1) * 45.0 - 22.5)
            am = 0.5 * (a0 + a1)
            x0, y0 = radius * math.sin(a0), radius * math.cos(a0)
            xm, ym = radius * math.sin(am), radius * math.cos(am)
            x1, y1 = radius * math.sin(a1), radius * math.cos(a1)

            for bx0, by0, bx1, by1 in ((x0, y0, xm, ym), (xm, ym, x1, y1)):
                # 1. Spandrel Panel (IFCPLATE) or Podium Precast Wall (IFCWALL)
                if is_podium and sec in (2, 6):  # East/West podium solid wall bays
                    _add_ifc_quad_entity("IFCWALL", f"Wall_Podium_{s_idx+1}", "Precast_Wall", (bx0, by0, z0), (bx1, by1, z0), (bx1, by1, z1), (bx0, by0, z1))
                    continue

                _add_ifc_quad_entity("IFCPLATE", f"CW_Spandrel_{s_idx+1}", "Spandrel_Panel", (bx0, by0, z0), (bx1, by1, z0), (bx1, by1, zm), (bx0, by0, zm))
                # 2. Vision Glass Panel (IFCPLATE)
                _add_ifc_quad_entity("IFCPLATE", f"CW_Vision_Glass_{s_idx+1}", "Vision_Glass", (bx0, by0, zm), (bx1, by1, zm), (bx1, by1, z1), (bx0, by0, z1))
                # 3. Vertical Mullion Strip (IFCMEMBER)
                mx1, my1 = bx0 + 0.08 * (bx1 - bx0), by0 + 0.08 * (by1 - by0)
                r_m = 1.015
                _add_ifc_quad_entity("IFCMEMBER", f"CW_Mullion_{s_idx+1}", "Mullion_Frame", (bx0 * r_m, by0 * r_m, z0), (mx1 * r_m, my1 * r_m, z0), (mx1 * r_m, my1 * r_m, z1), (bx0 * r_m, by0 * r_m, z1))

            # 4. External Horizontal Overhang Fin (IFCSHADINGDEVICE)
            r_sh = radius + 0.85
            xs0, ys0 = r_sh * math.sin(a0), r_sh * math.cos(a0)
            xs1, ys1 = r_sh * math.sin(a1), r_sh * math.cos(a1)
            _add_ifc_quad_entity("IFCSHADINGDEVICE", f"Sun_Louver_{s_idx+1}", "Sun_Louver_Fin", (x0, y0, z1 - 0.08), (x1, y1, z1 - 0.08), (xs1, ys1, z1 - 0.28), (xs0, ys0, z1 - 0.28))

    lines.append("ENDSEC;")
    lines.append("END-ISO-10303-21;")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return output_path


# ============================================================================
# STAGE 2: TIER 2 GEOMETRIC SUB-ELEMENT AUTO-SPLITTER (FOR MERGED CURTAIN WALLS)
# ============================================================================

def decompose_merged_group_geometrically(
    rg: RawGroupMesh,
    frame_width_threshold_m: float = 0.28,
    spandrel_height_threshold_m: float = 1.15,
    force_split: bool = False,
) -> List[RawGroupMesh]:
    """
    Tier 2 Geometric Sub-Element Decomposer:
    When a user imports a single-layer/single-material Curtain Wall (e.g. from ArchiCAD,
    Revit, or SketchUp where Vision Glass, Spandrel Panels, and Mullion/Transom frames
    are merged in one group), this function inspects each polygon's 3D bounding box
    (width_xy, height_z, aspect_ratio, area) and splits it into up to 3 semantic sub-groups:
    - `<Group> :: [Auto] Frame / Mullion` ('frame')
    - `<Group> :: [Auto] Spandrel Panel` ('spandrel')
    - `<Group> :: [Auto] Vision Glass` ('glazing')
    """
    vs = rg.vertices
    fs = rg.faces
    n_f = len(fs)
    if n_f < 4:
        return [rg]

    p0 = vs[fs[:, 0]]
    p1 = vs[fs[:, 1]]
    p2 = vs[fs[:, 2]]
    p3 = vs[fs[:, 3]]

    f_min = np.minimum(np.minimum(p0, p1), np.minimum(p2, p3))
    f_max = np.maximum(np.maximum(p0, p1), np.maximum(p2, p3))
    spans = f_max - f_min  # (F, 3)

    width_xy = np.hypot(spans[:, 0], spans[:, 1])
    height_z = spans[:, 2]

    min_dim = np.minimum(width_xy, height_z)
    max_dim = np.maximum(width_xy, height_z)
    aspect = max_dim / np.maximum(1e-3, min_dim)

    # 1. Identify slender frame/mullion/transom elements
    is_frame = (min_dim <= frame_width_threshold_m) & (aspect >= 3.4)

    # 2. Among non-frame faces, check if there is a distinct bimodal height distribution
    #    (short spandrel bands vs tall vision glass panels)
    non_frame = ~is_frame
    is_spandrel = np.zeros(n_f, dtype=bool)
    if np.any(non_frame):
        hz_nf = height_z[non_frame]
        has_short = np.any((hz_nf >= 0.25) & (hz_nf <= spandrel_height_threshold_m))
        has_tall = np.any(hz_nf > spandrel_height_threshold_m * 1.12)
        if has_short and has_tall:
            is_spandrel = non_frame & (height_z <= spandrel_height_threshold_m)

    is_vision = non_frame & (~is_spandrel)

    # Only split if either `force_split` is requested OR at least 2 meaningful sub-types were found
    n_frame = int(np.sum(is_frame))
    n_spandrel = int(np.sum(is_spandrel))
    n_vision = int(np.sum(is_vision))
    distinct_buckets = sum(1 for c in (n_frame, n_spandrel, n_vision) if c > 0)

    if not force_split and distinct_buckets <= 1:
        return [rg]

    sub_groups: List[RawGroupMesh] = []
    specs = [
        (is_vision, "Vision Glass", "glazing"),
        (is_spandrel, "Spandrel Panel", "spandrel"),
        (is_frame, "Frame / Mullion", "frame"),
    ]
    sub_idx = 1
    for mask, sub_label, cat in specs:
        if not np.any(mask):
            continue
        sub_fs = fs[mask]
        sub_groups.append(
            RawGroupMesh(
                group_id=f"{rg.group_id}S{sub_idx}",
                group_name=f"{rg.group_name} :: [Auto] {sub_label}",
                source_layer=rg.source_layer,
                source_material=f"[Auto] {sub_label}",
                default_category=cat,
                vertices=vs,
                faces=sub_fs,
                is_auto_split_child=True,
            )
        )
        sub_idx += 1

    return sub_groups if sub_groups else [rg]


# ============================================================================
# STAGE 1 + 2 LOADER: UNIVERSAL MULTI-FORMAT 3D/BIM INGESTION
# ============================================================================

_UNIVERSAL_FILE_CACHE: Dict[Tuple[Any, ...], Tuple[List[RawGroupMesh], Stage1GeometryAudit]] = {}


def load_universal_model_stages_1_and_2(
    filepath: str,
    unit_mode: str = "auto",
    up_axis: str = "auto",
    nurbs_u_div: int = 4,
    nurbs_v_div: int = 2,
    auto_split_merged_cw: bool = False,
    groups_to_auto_split: Optional[List[str]] = None,
    frame_width_threshold_m: float = 0.28,
    spandrel_height_threshold_m: float = 1.15,
) -> Tuple[List[RawGroupMesh], Stage1GeometryAudit]:
    """
    Executes Stage 1 (Geometry, Unit & Axis Normalization) and Stage 2 (Layer::Material +
    Geometric Auto-Splitter) with caching for sub-second interactive response.
    """
    mtime = os.path.getmtime(filepath) if os.path.exists(filepath) else 0.0
    split_tuple = tuple(sorted(groups_to_auto_split or []))
    cache_key = (
        filepath,
        mtime,
        unit_mode,
        up_axis,
        nurbs_u_div,
        nurbs_v_div,
        auto_split_merged_cw,
        split_tuple,
        round(frame_width_threshold_m, 3),
        round(spandrel_height_threshold_m, 3),
    )
    if cache_key in _UNIVERSAL_FILE_CACHE:
        return _UNIVERSAL_FILE_CACHE[cache_key]

    ext = os.path.splitext(filepath.lower())[1]
    audit = Stage1GeometryAudit()
    # group_name -> list of (verts, faces, cat, src_layer, src_mat, is_ext, u_bim)
    groups_map: Dict[str, List[Tuple[np.ndarray, np.ndarray, str, str, str, Optional[bool], Optional[float]]]] = {}
    coords_already_in_meters = False

    def _add_chunk(
        g_name: str,
        src_layer: str,
        src_mat: str,
        cat: str,
        v_arr: np.ndarray,
        f_arr: np.ndarray,
        is_ext: Optional[bool] = None,
        u_bim: Optional[float] = None,
    ) -> None:
        if len(v_arr) < 3 or len(f_arr) < 1:
            return
        if g_name not in groups_map:
            groups_map[g_name] = []
        groups_map[g_name].append((v_arr, f_arr, cat, src_layer, src_mat, is_ext, u_bim))

    # ------------------------------------------------------------------------
    # A. RHINO .3DM (BLOCKS, HIDDEN LAYER FILTER, MATERIAL-BY-LAYER, SUBD)
    # ------------------------------------------------------------------------
    if ext == ".3dm":
        model = rhino3dm.File3dm.Read(filepath)
        if model is None:
            raise ValueError("Gagal membaca file Rhino .3dm.")
        audit.geometry_kernel = "rhino3dm (Rhino 8 NURBS/Mesh/Block)"

        rh_unit = model.Settings.ModelUnitSystem
        rh_unit_map = {
            rhino3dm.UnitSystem.Millimeters: "mm",
            rhino3dm.UnitSystem.Centimeters: "cm",
            rhino3dm.UnitSystem.Meters: "m",
            rhino3dm.UnitSystem.Inches: "in",
            rhino3dm.UnitSystem.Feet: "ft",
        }
        audit.detected_unit = rh_unit_map.get(rh_unit, "m")
        audit.detected_up_axis = "Z"

        # Resolve full layer hierarchy (Parent::Child) & effective visibility
        layer_by_idx = {i: l for i, l in enumerate(model.Layers)}
        layer_by_id = {str(l.Id): l for l in model.Layers}
        zero_guid = "00000000-0000-0000-0000-000000000000"

        def _layer_full_path_and_vis(l_idx: int) -> Tuple[str, bool, int]:
            lyr = layer_by_idx.get(l_idx)
            if lyr is None:
                return "Default", True, -1
            parts = [lyr.Name or f"Layer_{l_idx}"]
            vis = bool(getattr(lyr, "Visible", True))
            r_mat_idx = int(getattr(lyr, "RenderMaterialIndex", -1))
            cur = lyr
            for _ in range(10):
                pid = str(getattr(cur, "ParentLayerId", zero_guid))
                if not pid or pid == zero_guid or pid not in layer_by_id:
                    break
                cur = layer_by_id[pid]
                parts.append(cur.Name or "")
                vis = vis and bool(getattr(cur, "Visible", True))
            full_name = " / ".join(reversed([p for p in parts if p])) or f"Layer_{l_idx}"
            return full_name, vis, r_mat_idx

        layer_info_cache = {i: _layer_full_path_and_vis(i) for i in layer_by_idx}
        mat_names = {i: (m.Name or f"Mat_{i}") for i, m in enumerate(model.Materials)}
        mat_transp = {i: float(getattr(m, "Transparency", 0.0) or 0.0) for i, m in enumerate(model.Materials)}
        idef_map = {str(idef.Id): idef for idef in model.InstanceDefinitions}
        obj_by_id = {str(obj.Attributes.Id): obj for obj in model.Objects}

        audit.total_raw_objects = len(model.Objects)

        hidden_obj_mode = getattr(rhino3dm.ObjectMode, "Hidden", None)
        mat_from_parent = getattr(rhino3dm.ObjectMaterialSource, "MaterialFromParent", None)
        mat_from_object = getattr(rhino3dm.ObjectMaterialSource, "MaterialFromObject", None)
        missing_mesh_counts: Dict[Tuple[str, str, str], int] = {}
        rhino_mesh_export_instruction = (
            "Di Rhino: tampilkan viewport dalam mode Shaded lalu Save (jangan gunakan SaveSmall), "
            "atau jalankan perintah Mesh pada objek Brep/Surface sebelum menyimpan .3dm."
        )

        def _process_rhino_obj(
            obj: Any,
            parent_xform: np.ndarray,
            parent_layer: Optional[str] = None,
            parent_mat_idx: int = -1,
            depth: int = 0,
        ) -> None:
            if depth > 8:
                return
            geom = obj.Geometry
            attr = obj.Attributes

            # M9: Check object & layer visibility at ALL nesting depths (not just depth == 0)
            l_name, l_vis, l_mat_idx = layer_info_cache.get(attr.LayerIndex, ("Default", True, -1))
            is_hidden_mode = hidden_obj_mode is not None and getattr(attr, "Mode", None) == hidden_obj_mode
            if not getattr(attr, "Visible", True) or is_hidden_mode or not l_vis:
                audit.hidden_objects_skipped += 1
                return

            # M9: Block child uses its OWN layer; parent_layer is fallback only for Default / By Parent
            own_layer_clean = (l_name or "").strip()
            if own_layer_clean and own_layer_clean.lower() not in ("default", "by parent", "byparent"):
                layer_name = own_layer_clean
            else:
                layer_name = parent_layer or own_layer_clean or "Default"

            # M9: Block child resolves its OWN material first (respecting ObjectMaterialSource)
            mat_src = getattr(attr, "MaterialSource", None)
            if mat_from_parent is not None and mat_src == mat_from_parent:
                eff_mat_idx = parent_mat_idx if parent_mat_idx >= 0 else l_mat_idx
            elif mat_from_object is not None and mat_src == mat_from_object and attr.MaterialIndex >= 0:
                eff_mat_idx = attr.MaterialIndex
            elif attr.MaterialIndex >= 0:
                eff_mat_idx = attr.MaterialIndex
            elif l_mat_idx >= 0:
                eff_mat_idx = l_mat_idx
            else:
                eff_mat_idx = parent_mat_idx

            mat_name = mat_names.get(eff_mat_idx, "")
            m_transp = mat_transp.get(eff_mat_idx, 0.0)
            obj_name = (attr.Name or "").strip()

            if obj_name and obj_name.lower() != layer_name.lower():
                g_name = obj_name if layer_name == "Default" else f"{layer_name} :: {obj_name}"
                src_mat = mat_name or obj_name
            elif mat_name:
                g_name = f"{layer_name} :: {mat_name}"
                src_mat = mat_name
            else:
                g_name = layer_name
                src_mat = "Default"

            cat = "glazing" if m_transp > 0.15 else classify_layer_or_material_role(f"{g_name} {layer_name} {mat_name}")

            if isinstance(geom, rhino3dm.InstanceReference):
                iref_id = str(geom.ParentIdefId)
                xf_mat = parent_xform @ _xform_to_matrix(geom.Xform)
                idef = idef_map.get(iref_id)
                if idef:
                    for child_id in idef.GetObjectIds():
                        child_obj = obj_by_id.get(str(child_id))
                        if child_obj:
                            _process_rhino_obj(child_obj, xf_mat, layer_name, eff_mat_idx, depth + 1)
                return

            if isinstance(geom, rhino3dm.Mesh):
                res = _rhino_mesh_to_numpy(geom)
                if res:
                    _add_chunk(g_name, layer_name, src_mat, cat, _apply_xform(res[0], parent_xform), res[1])
                return

            if hasattr(rhino3dm, "SubD") and isinstance(geom, rhino3dm.SubD):
                try:
                    brep_sd = geom.ToBrep()
                    if brep_sd:
                        geom = brep_sd
                except Exception:
                    return

            if isinstance(geom, rhino3dm.Extrusion):
                for m_type in (rhino3dm.MeshType.Any, rhino3dm.MeshType.Render, rhino3dm.MeshType.Default):
                    rh_m = geom.GetMesh(m_type)
                    if rh_m and len(rh_m.Faces) > 0:
                        res = _rhino_mesh_to_numpy(rh_m)
                        if res:
                            _add_chunk(g_name, layer_name, src_mat, cat, _apply_xform(res[0], parent_xform), res[1])
                            return
                brep = geom.ToBrep(True)
                if brep:
                    geom = brep

            if isinstance(geom, rhino3dm.Brep):
                for f_i in range(len(geom.Faces)):
                    bf = geom.Faces[f_i]
                    got_mesh = False
                    for m_type in (rhino3dm.MeshType.Any, rhino3dm.MeshType.Render, rhino3dm.MeshType.Default):
                        rh_m = bf.GetMesh(m_type)
                        if rh_m and len(rh_m.Faces) > 0:
                            res = _rhino_mesh_to_numpy(rh_m)
                            if res:
                                _add_chunk(g_name, layer_name, src_mat, cat, _apply_xform(res[0], parent_xform), res[1])
                                got_mesh = True
                                break
                    if not got_mesh:
                        # M3: NEVER tessellate untrimmed UnderlyingSurface — record missing render mesh!
                        mk = (g_name, layer_name, "Brep")
                        missing_mesh_counts[mk] = missing_mesh_counts.get(mk, 0) + 1

            elif isinstance(geom, rhino3dm.Surface):
                # M3: Standalone Surface without stored render mesh — record instead of fabricating untrimmed mesh
                mk = (g_name, layer_name, "Surface")
                missing_mesh_counts[mk] = missing_mesh_counts.get(mk, 0) + 1

        identity4 = np.eye(4, dtype=np.float64)
        idef_obj_mode = getattr(rhino3dm.ObjectMode, "InstanceDefinitionObject", None)
        for obj in model.Objects:
            # M1: Skip block-definition template objects at top level; they are only
            # processed via InstanceReference with their instance 4x4 transform.
            if idef_obj_mode is not None and getattr(obj.Attributes, "Mode", None) == idef_obj_mode:
                continue
            _process_rhino_obj(obj, identity4)

        if missing_mesh_counts:
            total_missing = 0
            for (mg, ml, mtype), cnt in sorted(missing_mesh_counts.items()):
                total_missing += cnt
                audit.missing_mesh.append({
                    "group": mg,
                    "layer": ml,
                    "object_type": mtype,
                    "face_count": int(cnt),
                    "instruction": rhino_mesh_export_instruction,
                })
            audit.notes.append(
                f"Peringatan M3: {total_missing} permukaan tanpa render mesh tidak digambar ulang otomatis. "
                f"{rhino_mesh_export_instruction}"
            )

        if audit.hidden_objects_skipped > 0:
            audit.notes.append(f"{audit.hidden_objects_skipped} objek/layer tersembunyi (Hidden/Off) diabaikan otomatis.")

    # ------------------------------------------------------------------------
    # B. NATIVE BIM .IFC — PRIMARY: IfcOpenShell (OpenCASCADE C++), FALLBACK: STEP
    # ------------------------------------------------------------------------
    elif ext == ".ifc":
        used_ifcopenshell = False
        if HAS_IFCOPENSHELL:
            try:
                (
                    ios_chunks,
                    ifc_unit,
                    ifc_storeys,
                    slivers_rm,
                    interior_rm,
                    kernel_info,
                ) = _parse_ifc_with_ifcopenshell(filepath)
                if ios_chunks:
                    used_ifcopenshell = True
                    coords_already_in_meters = True
                    audit.geometry_kernel = kernel_info
                    audit.detected_unit = ifc_unit
                    audit.detected_up_axis = "Z"
                    audit.bim_storeys = ifc_storeys
                    audit.total_raw_objects = len(ios_chunks)
                    audit.slivers_removed = slivers_rm
                    audit.interior_elements_filtered = interior_rm
                    for g_name, src_layer, src_mat, cat, v_arr, f_arr, is_ext, u_bim in ios_chunks:
                        _add_chunk(g_name, src_layer, src_mat, cat, v_arr, f_arr, is_ext=is_ext, u_bim=u_bim)
                    if slivers_rm > 0:
                        audit.notes.append(f"Filter BIM membersihkan {slivers_rm} tepi tipis panel solid & menggabung segitiga koplanar.")
                    if interior_rm > 0:
                        audit.notes.append(f"{interior_rm} elemen interior (IsExternal=False) dipisahkan dari selubung OTTV.")
            except Exception as e_ios:
                audit.notes.append(f"Fallback STEP parser digunakan ({type(e_ios).__name__}).")

        if not used_ifcopenshell:
            ifc_chunks, ifc_unit, ifc_storeys = _parse_ifc_file(filepath)
            audit.geometry_kernel = "Pure-Python IFC STEP Fallback"
            audit.detected_unit = ifc_unit
            audit.detected_up_axis = "Z"
            audit.bim_storeys = ifc_storeys
            audit.total_raw_objects = len(ifc_chunks)
            for (layer_label, mat_label), m_list in ifc_chunks.items():
                g_name = f"{layer_label} :: {mat_label}" if mat_label != layer_label else layer_label
                cat = classify_layer_or_material_role(f"{layer_label} {mat_label}")
                for v_arr, f_arr in m_list:
                    _add_chunk(g_name, layer_label, mat_label, cat, v_arr, f_arr)

    # ------------------------------------------------------------------------
    # C. WAVEFRONT .OBJ + .MTL (TRANSPARENCY & LAYER::USEMTL DECOMPOSITION)
    # ------------------------------------------------------------------------
    elif ext == ".obj":
        audit.geometry_kernel = "Wavefront OBJ+MTL Parser"
        audit.detected_unit = "m"
        obj_buckets, mtl_transp, obj_y_up_hint = _parse_obj_with_materials(filepath)
        audit.detected_up_axis = "Y" if obj_y_up_hint else "Z"
        if obj_buckets:
            audit.total_raw_objects = len(obj_buckets)
            layers_seen = [k[0] for k in obj_buckets.keys()]
            for (layer_name, mtl_name), (v_arr, f_arr) in obj_buckets.items():
                if mtl_name and mtl_name != "Default_Material" and layers_seen.count(layer_name) > 1:
                    g_name = f"{layer_name} :: {mtl_name}"
                elif mtl_name and mtl_name != "Default_Material" and layer_name in ("Default_Object", "Object", "default"):
                    g_name = mtl_name
                else:
                    g_name = layer_name
                is_transp_glass = mtl_transp.get(mtl_name, 0.0) > 0.15
                cat = "glazing" if is_transp_glass else classify_layer_or_material_role(f"{layer_name} {mtl_name}")
                _add_chunk(g_name, layer_name, mtl_name, cat, v_arr, f_arr)
        else:
            loaded = trimesh.load(filepath, force="scene", process=False)
            dumped = loaded.dump(concatenate=False) if isinstance(loaded, trimesh.Scene) else [loaded]
            for idx_m, tm in enumerate(dumped):
                if len(tm.vertices) < 3 or len(tm.faces) < 1:
                    continue
                name = str(tm.metadata.get("name") or f"OBJ_Part_{idx_m + 1}")
                v_arr = np.asarray(tm.vertices, dtype=np.float64)
                f_in = np.asarray(tm.faces, dtype=np.int64)
                f_arr = np.column_stack([f_in, f_in[:, 2]]) if f_in.shape[1] == 3 else f_in[:, :4]
                cat = classify_layer_or_material_role(name)
                _add_chunk(name, name, "Default", cat, v_arr, f_arr)

    # ------------------------------------------------------------------------
    # D. .GLB / .GLTF (FULL SCENE-GRAPH TRANSFORMS + PBR ALPHA) / .STL / .PLY
    # ------------------------------------------------------------------------
    elif ext in (".glb", ".gltf", ".stl", ".ply"):
        audit.geometry_kernel = f"Trimesh SceneGraph ({ext.upper().lstrip('.')})"
        audit.detected_unit = "m"
        audit.detected_up_axis = "Y" if ext in (".glb", ".gltf") else "Z"
        loaded = trimesh.load(filepath, force="scene", process=False)
        if isinstance(loaded, trimesh.Scene):
            # CRITICAL: Use scene.dump(concatenate=False) to bake ALL scene-graph node transforms!
            dumped_meshes = loaded.dump(concatenate=False)
        else:
            dumped_meshes = [loaded]
        audit.total_raw_objects = len(dumped_meshes)
        for idx_m, tm in enumerate(dumped_meshes):
            if not hasattr(tm, "vertices") or len(tm.vertices) < 3 or len(tm.faces) < 1:
                continue
            node_name = str(tm.metadata.get("name") or f"Mesh_{idx_m + 1}")
            mat_name = ""
            is_pbr_glass = False
            vis = getattr(tm, "visual", None)
            mat = getattr(vis, "material", None) if vis is not None else None
            if mat is not None:
                mat_name = str(getattr(mat, "name", "") or "").strip()
                alpha_mode = str(getattr(mat, "alphaMode", "") or "").upper()
                bcf = getattr(mat, "baseColorFactor", None)
                if alpha_mode == "BLEND":
                    is_pbr_glass = True
                elif bcf is not None and len(bcf) >= 4:
                    alpha_v = float(bcf[3])
                    if alpha_v > 1.0:
                        alpha_v /= 255.0
                    if alpha_v < 0.88:
                        is_pbr_glass = True
            g_name = f"{node_name} :: {mat_name}" if (mat_name and mat_name != node_name) else (mat_name or node_name)
            v_arr = np.asarray(tm.vertices, dtype=np.float64)
            f_in = np.asarray(tm.faces, dtype=np.int64)
            f_arr = _merge_coplanar_tris_to_quads(v_arr, f_in[:, :3]) if f_in.shape[1] == 3 else f_in[:, :4]
            cat = "glazing" if is_pbr_glass else classify_layer_or_material_role(f"{node_name} {mat_name}")
            _add_chunk(g_name, node_name, mat_name or "Default", cat, v_arr, f_arr)

    # ------------------------------------------------------------------------
    # E. HONEYBEE .HBJSON / .JSON
    # ------------------------------------------------------------------------
    elif ext in (".hbjson", ".json"):
        audit.geometry_kernel = "Ladybug-Geometry Honeybee JSON"
        with open(filepath, "r", encoding="utf-8") as f:
            hb_data = json.load(f)
        hb_units = (hb_data.get("units") or "Meters").lower()
        if "milli" in hb_units:
            audit.detected_unit = "mm"
        elif "centi" in hb_units:
            audit.detected_unit = "cm"
        elif "feet" in hb_units or "foot" in hb_units:
            audit.detected_unit = "ft"
        else:
            audit.detected_unit = "m"
        audit.detected_up_axis = "Z"

        def _hb_f3d_to_chunk(g_name: str, cat: str, geom_dict: Dict[str, Any]) -> None:
            try:
                f3d = Face3D.from_dict(geom_dict)
                lb_m = f3d.mesh_grid(x_dim=4.0, y_dim=4.0) if cat in ("wall", "glazing", "spandrel") else f3d.triangulated_mesh3d
                res = _ladybug_mesh_to_numpy(lb_m)
                if res:
                    _add_chunk(g_name, g_name, cat, cat, res[0], res[1])
            except Exception:
                pass

        for sh in hb_data.get("orphaned_shades", []) + hb_data.get("shades", []):
            if sh.get("geometry"):
                _hb_f3d_to_chunk("HB_Outdoor_Shades", "shading", sh["geometry"])

        all_faces = list(hb_data.get("faces", []))
        for rm in hb_data.get("rooms", []):
            for sh in rm.get("outdoor_shades", []):
                if sh.get("geometry"):
                    _hb_f3d_to_chunk("HB_Outdoor_Shades", "shading", sh["geometry"])
            all_faces.extend(rm.get("faces", []))

        audit.total_raw_objects = len(all_faces)
        for fo in all_faces:
            f_type = (fo.get("face_type") or "Wall").lower()
            geom_d = fo.get("geometry")
            if not geom_d:
                continue
            for sh in fo.get("outdoor_shades", []):
                if sh.get("geometry"):
                    _hb_f3d_to_chunk("HB_Outdoor_Shades", "shading", sh["geometry"])
            if "roof" in f_type or "floor" in f_type:
                _hb_f3d_to_chunk("HB_Roof_Floor", "roof", geom_d)
                continue
            aps = fo.get("apertures", [])
            ap_f3ds = []
            for ap in aps:
                for sh in ap.get("outdoor_shades", []):
                    if sh.get("geometry"):
                        _hb_f3d_to_chunk("HB_Aperture_Louvers", "shading", sh["geometry"])
                if ap.get("geometry"):
                    try:
                        ap_f = Face3D.from_dict(ap["geometry"])
                        ap_f3ds.append(ap_f)
                        _hb_f3d_to_chunk("HB_Vision_Glazing", "glazing", ap["geometry"])
                    except Exception:
                        pass
            try:
                base_f = Face3D.from_dict(geom_d)
                if ap_f3ds:
                    punched = Face3D.from_punched_geometry(base_f, ap_f3ds)
                    res = _ladybug_mesh_to_numpy(punched.triangulated_mesh3d)
                else:
                    res = _ladybug_mesh_to_numpy(base_f.mesh_grid(x_dim=4.0, y_dim=4.0))
                if res:
                    _add_chunk("HB_Opaque_Walls", "HB_Opaque_Walls", "wall", "wall", res[0], res[1])
            except Exception:
                _hb_f3d_to_chunk("HB_Opaque_Walls", "wall", geom_d)
    else:
        raise ValueError(f"Format file '{ext}' tidak didukung.")

    # Merge chunks per group — ZERO-DESTRUCTIVE for all surface groups (0% area loss!)
    raw_groups: List[RawGroupMesh] = []
    for g_idx, (g_name, chunks) in enumerate(groups_map.items()):
        v_list = []
        f_list = []
        v_offset = 0
        cat = chunks[0][2]
        src_layer = chunks[0][3]
        src_mat = chunks[0][4]
        is_ext_g = chunks[0][5]
        u_bim_g = chunks[0][6]
        for v_arr, f_arr, _, _, _, _, _ in chunks:
            v_list.append(v_arr)
            f_list.append(f_arr + v_offset)
            v_offset += len(v_arr)
        v_merged = np.vstack(v_list)
        f_merged = np.vstack(f_list)

        # NEVER stride-delete surface polygons (glazing/wall/spandrel/composite_cw) — preserves 100% exact area!
        # Only cap ultra-dense non-area frame/shading meshes above 80,000 faces to protect RAM/raycast latency.
        if cat in ("frame", "shading", "roof") and len(f_merged) > 80000:
            step = max(1, int(math.ceil(len(f_merged) / 80000)))
            f_merged = f_merged[::step]
            audit.notes.append(f"Grup non-selubung '{g_name}' dioptimasi (stride {step}x) untuk performa raycast.")

        raw_groups.append(
            RawGroupMesh(
                group_id=f"R-{g_idx + 1}",
                group_name=g_name,
                source_layer=src_layer,
                source_material=src_mat,
                default_category=cat,
                vertices=v_merged,
                faces=f_merged,
                is_external_bim=is_ext_g,
                thermal_u_bim=u_bim_g,
            )
        )

    if not raw_groups:
        raise ValueError("Tidak ditemukan geometri 3D pada file yang diunggah.")

    # ------------------------------------------------------------------------
    # STAGE 1 NORMALIZATION: AXIS ALIGNMENT (Z-UP vs Y-UP), UNIT SCALING & UTM RECENTER
    # ------------------------------------------------------------------------
    eff_up = (up_axis or "auto").upper()
    if eff_up not in ("Z", "Y"):
        eff_up = audit.detected_up_axis
        # Geometric Up-Axis Guard for unlabeled .obj/.stl/.ply towers lying on Y-axis:
        if ext in (".obj", ".stl", ".ply") and eff_up == "Z":
            v_check = np.vstack([rg.vertices for rg in raw_groups])
            sp_check = np.max(v_check, axis=0) - np.min(v_check, axis=0)
            if sp_check[1] > 1.55 * max(1e-3, sp_check[2]) and sp_check[1] > 1.55 * max(1e-3, sp_check[0]):
                eff_up = "Y"
                audit.detected_up_axis = "Y"
                audit.notes.append("Deteksi geometris: rentang sumbu Y jauh lebih tinggi dari X & Z -> otomatis Y-Up.")
    audit.applied_up_axis = eff_up

    if eff_up == "Y":
        for rg in raw_groups:
            v = rg.vertices.copy()
            rg.vertices[:, 0] = v[:, 0]
            rg.vertices[:, 1] = -v[:, 2]
            rg.vertices[:, 2] = v[:, 1]
        audit.notes.append("Sumbu vertikal dikonversi dari Y-Up ke Z-Up.")

    all_v_raw = np.vstack([rg.vertices for rg in raw_groups])
    raw_min = np.min(all_v_raw, axis=0)
    raw_max = np.max(all_v_raw, axis=0)
    raw_span = raw_max - raw_min
    audit.raw_span_xyz = [round(float(x), 2) for x in raw_span]
    max_raw_span = float(np.max(raw_span))

    # Resolve unit scale to meters (also run BBox sanity guard even on IfcOpenShell if IFC header unit was broken!)
    eff_unit = (unit_mode or "auto").lower()
    if coords_already_in_meters and eff_unit == "auto":
        if max_raw_span > 1500.0:
            scale_to_m = 0.001
            audit.applied_unit = "mm"
            audit.scale_factor_to_m = 0.001
            audit.notes.append(f"Koordinat IFC ({max_raw_span:.0f}) masih dalam milimeter meski header berbeda -> otomatis diskalakan ke meter.")
        else:
            scale_to_m = 1.0
            audit.applied_unit = audit.detected_unit
            audit.scale_factor_to_m = UNIT_SCALE_TO_METERS.get(audit.detected_unit, 1.0)
    else:
        if eff_unit == "auto":
            if audit.detected_unit in UNIT_SCALE_TO_METERS and audit.detected_unit != "m":
                eff_unit = audit.detected_unit
            elif max_raw_span > 3500.0:
                eff_unit = "mm"
                audit.notes.append(f"Dimensi mentah ({max_raw_span:.0f}) terdeteksi milimeter (mm) -> otomatis dikonversi ke meter.")
            elif max_raw_span > 650.0:
                eff_unit = "cm"
                audit.notes.append(f"Dimensi mentah ({max_raw_span:.0f}) terdeteksi sentimeter (cm) -> otomatis dikonversi ke meter.")
            else:
                eff_unit = "m"
        elif eff_unit not in UNIT_SCALE_TO_METERS:
            eff_unit = "m"

        scale_to_m = UNIT_SCALE_TO_METERS[eff_unit]
        if coords_already_in_meters:
            # User manually overrode unit on an IfcOpenShell-converted model: undo original scale first
            orig_s = UNIT_SCALE_TO_METERS.get(audit.detected_unit, 1.0)
            scale_to_m = scale_to_m / max(1e-9, orig_s)
        audit.applied_unit = eff_unit
        audit.scale_factor_to_m = round(UNIT_SCALE_TO_METERS[eff_unit], 6)

    if abs(scale_to_m - 1.0) > 1e-9:
        for rg in raw_groups:
            rg.vertices = rg.vertices * scale_to_m

    # Ground Z zeroing + XY UTM World-Coordinate Recentering (prevents Float32 jitter on Revit/GIS models!)
    all_v_scaled = np.vstack([rg.vertices for rg in raw_groups])
    s_min = np.min(all_v_scaled, axis=0)
    s_max = np.max(all_v_scaled, axis=0)
    z_offset = float(s_min[2])
    cx_raw = 0.5 * float(s_min[0] + s_max[0])
    cy_raw = 0.5 * float(s_min[1] + s_max[1])
    audit.z_ground_offset_m = round(z_offset, 3)

    if abs(z_offset) > 0.25:
        for rg in raw_groups:
            rg.vertices[:, 2] -= z_offset
        for st in audit.bim_storeys:
            st["elevation_m"] = round(st["elevation_m"] - z_offset, 3)
        s_max[2] -= z_offset
        s_min[2] = 0.0

    if max(abs(cx_raw), abs(cy_raw)) > 500.0:
        for rg in raw_groups:
            rg.vertices[:, 0] -= cx_raw
            rg.vertices[:, 1] -= cy_raw
        audit.xy_world_offset_m = [round(cx_raw, 2), round(cy_raw, 2)]
        audit.notes.append(f"Koordinat UTM/Survey ({cx_raw:.0f}m, {cy_raw:.0f}m) dipusatkan otomatis ke (0,0) agar 3D presisi.")

    audit.normalized_span_m = [
        round(float(s_max[0] - s_min[0]), 2),
        round(float(s_max[1] - s_min[1]), 2),
        round(float(s_max[2] - s_min[2]), 2),
    ]

    # Post-scaling thin-edge sliver cleanup for non-IfcOpenShell formats (.3dm, .obj, .glb)
    if not coords_already_in_meters:
        non_ifc_sliv = 0
        for rg in raw_groups:
            non_ifc_sliv += _filter_thin_edge_slivers_on_group(rg)
        if non_ifc_sliv > 0:
            audit.slivers_removed += non_ifc_sliv
            audit.notes.append(f"{non_ifc_sliv} sisi tipis ketebalan kaca/spandrel (<=8cm) dibersihkan otomatis.")

    # ------------------------------------------------------------------------
    # STAGE 2: TIER 2 GEOMETRIC AUTO-SPLITTER FOR MERGED CURTAIN WALL GROUPS
    # ------------------------------------------------------------------------
    split_set = set(groups_to_auto_split or [])
    final_groups: List[RawGroupMesh] = []
    surface_like = [rg for rg in raw_groups if rg.default_category in ("glazing", "wall", "spandrel")]

    for rg in raw_groups:
        explicit_split = rg.group_name in split_set or rg.group_id in split_set
        should_auto_split = explicit_split or (
            auto_split_merged_cw
            and rg.default_category in ("glazing", "wall", "spandrel")
            and (
                len(surface_like) == 1
                or "curtain" in rg.group_name.lower()
                or "cw" in rg.group_name.lower()
            )
        )
        if should_auto_split:
            decomposed = decompose_merged_group_geometrically(
                rg,
                frame_width_threshold_m=frame_width_threshold_m,
                spandrel_height_threshold_m=spandrel_height_threshold_m,
                force_split=explicit_split,
            )
            if len(decomposed) > 1:
                audit.notes.append(
                    f"Grup '{rg.group_name}' dipecah otomatis menjadi {len(decomposed)} sub-elemen (Kaca/Spandrel/Rangka)."
                )
            final_groups.extend(decomposed)
        else:
            final_groups.append(rg)

    for idx, rg in enumerate(final_groups):
        rg.group_id = f"R-{idx + 1}"

    audit.total_raw_faces = int(sum(len(rg.faces) for rg in final_groups))
    _UNIVERSAL_FILE_CACHE[cache_key] = (final_groups, audit)
    return final_groups, audit


# ============================================================================
# STAGE 3: DYNAMIC FLOOR LEVEL DETECTOR & ZONE GENERATOR
# ============================================================================

def build_dynamic_floor_levels(
    z_min_bldg: float,
    z_max_bldg: float,
    floor_mode: str,
    floor_height_m: float,
    bim_storeys: List[Dict[str, Any]],
    panel_z_mins: Optional[np.ndarray] = None,
    panel_z_maxs: Optional[np.ndarray] = None,
    custom_floor_zones: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Constructs the ordered list of building floor definitions `L1 .. LN`
    based on `floor_mode` ('auto' | 'uniform' | 'custom'):
    Returns `(floor_defs, resolution_method_description)`.
    Each item in `floor_defs` has:
      `floor_number`, `floor_label`, `zone_type`, `z_min`, `z_max`, `height_m`
    """
    total_h = max(2.5, z_max_bldg - z_min_bldg)
    fh_default = max(2.4, min(10.0, float(floor_height_m or 3.6)))
    mode = (floor_mode or "auto").lower()

    # 1. CUSTOM FLOOR ZONES MODE (supports both {name, floor_from, floor_to, height_m} & {zone_label, count, height_m})
    if mode == "custom" and custom_floor_zones:
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
            zh = max(2.2, min(15.0, float(zone.get("height_m", fh_default))))
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
        # Fill any remaining height up to z_max_bldg with typical floors
        while cur_z < z_max_bldg - 0.40 and fl_num <= 160:
            z_next = min(z_max_bldg, cur_z + fh_default)
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
            return floor_defs, "Zona Lantai Kustom Pengguna"

    # 2. AUTO-DETECT FROM NATIVE BIM STOREYS (.IFC)
    if mode == "auto" and len(bim_storeys) >= 2:
        floor_defs = []
        for idx, st in enumerate(bim_storeys):
            z0 = max(z_min_bldg, float(st["elevation_m"]))
            z1 = float(bim_storeys[idx + 1]["elevation_m"]) if idx + 1 < len(bim_storeys) else z_max_bldg
            if z1 <= z0 + 0.5:
                z1 = z0 + fh_default
            s_name = st.get("name", f"L{idx+1}")
            z_type = "Podium" if "podium" in s_name.lower() or "lobby" in s_name.lower() else "Tipikal"
            floor_defs.append({
                "floor_number": idx + 1,
                "floor_label": f"L{idx + 1}",
                "bim_storey_name": s_name,
                "zone_type": z_type,
                "z_min": round(z0, 2),
                "z_max": round(z1, 2),
                "height_m": round(z1 - z0, 2),
            })
        return floor_defs, f"BIM Storey Otomatis ({len(floor_defs)} Lantai dari IFC)"

    # 3. AUTO-DETECT FROM GEOMETRIC HORIZONTAL SEAMS (Z-CLUSTERING)
    if mode == "auto" and panel_z_mins is not None and panel_z_maxs is not None and len(panel_z_mins) >= 8:
        p_heights = panel_z_maxs - panel_z_mins
        # Check if panels are full-storey height (2.6m .. 5.5m) or spandrel+vision pairs
        edges = np.concatenate([panel_z_mins, panel_z_maxs])
        edges_rounded = np.round(edges * 5.0) / 5.0  # 0.20m resolution bins
        uniq_z, counts = np.unique(edges_rounded, return_counts=True)
        # Filter prominent horizontal seam lines
        threshold_cnt = max(3, int(len(panel_z_mins) * 0.015))
        prominent_z = uniq_z[counts >= threshold_cnt]

        # Build storey boundaries separated by at least 2.6m
        seams: List[float] = [z_min_bldg]
        for z_val in prominent_z:
            if z_val - seams[-1] >= 2.65 and (z_max_bldg - z_val) >= 2.2:
                # Check if gap is a multiple of typical floor height (e.g. > 6.2m)
                gap = z_val - seams[-1]
                if gap <= 5.6:
                    seams.append(float(z_val))
        seams.append(z_max_bldg)

        # Validate if detected seams cover the building height reasonably
        gaps = np.diff(seams)
        if len(seams) >= 3 and np.all((gaps >= 2.4) & (gaps <= 6.0)):
            # Check if uniform floor_height_m divides total_h cleanly (within 5cm per floor)
            n_unif = max(1, int(round(total_h / fh_default)))
            if abs(total_h - n_unif * fh_default) < 0.25:
                # Uniform cadence matches building height cleanly
                floor_defs = [
                    {
                        "floor_number": fl,
                        "floor_label": f"L{fl}",
                        "zone_type": "Tipikal",
                        "z_min": round(z_min_bldg + (fl - 1) * fh_default, 2),
                        "z_max": round(min(z_max_bldg, z_min_bldg + fl * fh_default), 2),
                        "height_m": round(fh_default, 2),
                    }
                    for fl in range(1, n_unif + 1)
                ]
                return floor_defs, f"Deteksi Geometri Klaster Z ({n_unif} Lantai @ {fh_default:.2f}m)"
            else:
                floor_defs = []
                for idx in range(len(seams) - 1):
                    z0, z1 = seams[idx], seams[idx + 1]
                    floor_defs.append({
                        "floor_number": idx + 1,
                        "floor_label": f"L{idx + 1}",
                        "zone_type": "Tipikal",
                        "z_min": round(z0, 2),
                        "z_max": round(z1, 2),
                        "height_m": round(z1 - z0, 2),
                    })
                return floor_defs, f"Deteksi Klaster Elevasi Z ({len(floor_defs)} Lantai Variatif)"

    # 4. UNIFORM FLOOR HEIGHT MODE (OR FALLBACK)
    total_floors = max(1, min(160, int(math.ceil((total_h - 0.05) / fh_default))))
    floor_defs = []
    for fl in range(1, total_floors + 1):
        z0 = z_min_bldg + (fl - 1) * fh_default
        z1 = min(z_max_bldg, z_min_bldg + fl * fh_default)
        floor_defs.append({
            "floor_number": fl,
            "floor_label": f"L{fl}",
            "zone_type": "Tipikal",
            "z_min": round(z0, 2),
            "z_max": round(z1, 2),
            "height_m": round(max(0.5, z1 - z0), 2),
        })
    method_label = (
        f"Tinggi Lantai Seragam ({total_floors} Lantai @ {fh_default:.2f}m)"
        if mode == "uniform"
        else f"Otomatis Modul Vertikal ({total_floors} Lantai @ {fh_default:.2f}m)"
    )
    return floor_defs, method_label


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
