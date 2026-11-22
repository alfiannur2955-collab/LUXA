"""Pembersih geometri BIM (gabung segitiga koplanar, buang sliver) dan pemecah curtain wall gabungan."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from loaders.types import RawGroupMesh

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
    restore_slivers: bool = False,
    restore_caps: bool = False,
) -> Tuple[np.ndarray, np.ndarray, int, float, int, float]:
    """
    Cleans a single 3D solid BIM element (already in meters) BEFORE merging into a group:
    1. Merges coplanar triangle pairs into clean quads (0% area loss).
    2. M4: Tags thin vertical thickness-edge slivers (`w_xy <= thresh` & small area) and
       allows restoring them via `restore_slivers=True`.
    3. M6: Keeps tilted / skylight glazing faces intact (NEVER deletes non-vertical glazing!).
       Horizontal top/bottom caps on opaque thin spandrel/wall panels are tagged and can be
       restored via `restore_caps=True`.
    Returns `(verts, cleaned_quads, sliver_count, sliver_area_m2, cap_count, cap_area_m2)`.
    """
    if len(verts) < 3 or len(tris) < 1:
        return verts, np.empty((0, 4), dtype=np.int64), 0, 0.0, 0, 0.0

    quads = _merge_coplanar_tris_to_quads(verts, tris)
    if len(quads) == 0 or category not in ("glazing", "spandrel", "wall", "composite_cw"):
        return verts, quads, 0, 0.0, 0, 0.0

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
        return verts, np.empty((0, 4), dtype=np.int64), 0, 0.0, 0, 0.0

    quads = quads[valid]
    areas = areas[valid]
    normals = cross_sum[valid] / (2.0 * areas[:, None])
    p0, p1, p2, p3 = p0[valid], p1[valid], p2[valid], p3[valid]

    f_min = np.minimum(np.minimum(p0, p1), np.minimum(p2, p3))
    f_max = np.maximum(np.maximum(p0, p1), np.maximum(p2, p3))
    spans = f_max - f_min
    w_xy = np.hypot(spans[:, 0], spans[:, 1])

    is_vert = np.abs(normals[:, 2]) <= 0.85
    # M6: If a glazing element is purely horizontal/tilted (skylight), KEEP ALL its faces!
    if not np.any(is_vert):
        if category == "glazing":
            return verts, quads, 0, 0.0, 0, 0.0
        cap_cnt = int(len(quads))
        cap_area = float(np.sum(areas))
        if restore_caps:
            return verts, quads, 0, 0.0, cap_cnt, cap_area
        return verts, np.empty((0, 4), dtype=np.int64), 0, 0.0, cap_cnt, cap_area

    max_vert_area = float(np.max(areas[is_vert]))
    elem_span = np.max(verts, axis=0) - np.min(verts, axis=0)
    min_elem_dim = float(np.min(elem_span))

    sliver_thresh = 0.12 if category in ("glazing", "spandrel") else 0.08
    is_thin_edge = is_vert & (w_xy <= sliver_thresh) & (areas < 0.25 * max_vert_area)

    # M6: For glazing, horizontal thin edge caps (top/bottom panel thickness <= 14 cm, rotation-invariant!)
    # are panel edges; genuine tilted/skylight glazing faces are ALWAYS preserved!
    if category == "glazing":
        e01 = p1 - p0
        e12 = p2 - p1
        e23 = np.where(is_q[valid, None], p3 - p2, p0 - p2)
        e30 = np.where(is_q[valid, None], p0 - p3, np.zeros_like(p0))
        edges_b = np.stack([e01, e12, e23, e30], axis=1)
        elens_b = np.linalg.norm(edges_b, axis=2)
        best_e = edges_b[np.arange(len(quads)), np.argmax(elens_b, axis=1)]
        u_b = best_e / np.maximum(1e-9, np.linalg.norm(best_e, axis=1, keepdims=True))
        v_raw_b = np.cross(normals, u_b)
        v_b = v_raw_b / np.maximum(1e-9, np.linalg.norm(v_raw_b, axis=1, keepdims=True))
        p3_eff_b = np.where(is_q[valid, None], p3, p2)
        pts_b = np.stack([p0, p1, p2, p3_eff_b], axis=1)
        du_b = np.max(np.einsum("nkc,nc->nk", pts_b, u_b), axis=1) - np.min(np.einsum("nkc,nc->nk", pts_b, u_b), axis=1)
        dv_b = np.max(np.einsum("nkc,nc->nk", pts_b, v_b), axis=1) - np.min(np.einsum("nkc,nc->nk", pts_b, v_b), axis=1)
        face_min_dim = np.minimum(du_b, dv_b)
        is_cap = (~is_vert) & (areas < 0.25 * max_vert_area) & ((min_elem_dim <= 0.14) | (face_min_dim <= 0.14))
    elif category == "spandrel" or min_elem_dim <= 0.14:
        is_cap = ~is_vert
    else:
        is_cap = np.zeros(len(quads), dtype=bool)

    sliver_count = int(np.sum(is_thin_edge))
    sliver_area = float(np.sum(areas[is_thin_edge])) if sliver_count > 0 else 0.0
    cap_count = int(np.sum(is_cap))
    cap_area = float(np.sum(areas[is_cap])) if cap_count > 0 else 0.0

    keep = np.ones(len(quads), dtype=bool)
    if not restore_slivers:
        keep &= ~is_thin_edge
    if not restore_caps:
        keep &= ~is_cap

    cleaned = quads[keep]
    return verts, cleaned, sliver_count, sliver_area, cap_count, cap_area


def _filter_thin_edge_slivers_on_group(
    rg: RawGroupMesh,
    restore_filtered_set: Optional[set] = None,
) -> Tuple[int, Optional[Dict[str, Any]]]:
    """
    M4: Non-destructive thin-edge sliver tagging for non-IFC formats (.3dm, .obj, .glb).
    Records exact filtered face count & area into `audit.filtered_items`, and restores
    the faces immediately if `f"sliver::{rg.group_name}"` is in `restore_filtered_set`.
    """
    if rg.default_category not in ("glazing", "spandrel", "wall") or len(rg.faces) < 4:
        return 0, None
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
        return 0, None
    med_area = float(np.percentile(areas[is_vert], 75))
    is_sliver = is_vert & (w_xy <= 0.085) & (areas < 0.22 * med_area) & (areas < 0.25)
    n_sliv = int(np.sum(is_sliver))
    if n_sliv > 0 and n_sliv < len(fs):
        sliv_area = round(float(np.sum(areas[is_sliver])), 4)
        fid = f"sliver::{rg.group_name}"
        is_restored = bool(restore_filtered_set and fid in restore_filtered_set)
        item = {
            "id": fid,
            "group": rg.group_name,
            "reason": "thin_edge_sliver",
            "reason_label": "Tepi tipis ketebalan kaca/spandrel (<= 8,5 cm)",
            "face_count": n_sliv,
            "area_m2": sliv_area,
            "restored": is_restored,
        }
        if not is_restored:
            rg.faces = fs[~is_sliver]
            return n_sliv, item
        return 0, item
    return 0, None


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
