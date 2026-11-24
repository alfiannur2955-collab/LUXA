"""Pembaca IFC lewat IfcOpenShell (kernel OpenCASCADE)."""

from __future__ import annotations

import multiprocessing
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from loaders.classify import classify_layer_or_material_role
from loaders.normalize import _clean_solid_bim_element_faces

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


# ============================================================================
# NATIVE BIM .IFC ENGINE — PRIMARY: IfcOpenShell (OpenCASCADE C++ Kernel)
# ============================================================================

def _parse_ifc_with_ifcopenshell(
    filepath: str,
    restore_filtered_set: Optional[set] = None,
) -> Tuple[
    List[Tuple[str, str, str, str, np.ndarray, np.ndarray, Optional[bool], Optional[float]]],
    str,
    List[Dict[str, Any]],
    int,
    int,
    str,
    List[Dict[str, Any]],
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
    # M4/M6: Accumulate filtered slivers & horizontal caps per group for audit.filtered_items
    sliver_stats_by_grp: Dict[str, List[float]] = {}  # g_name -> [count, area_m2]
    cap_stats_by_grp: Dict[str, List[float]] = {}     # g_name -> [count, area_m2]
    rf_set = restore_filtered_set or set()

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
                    raw_mat_fb = elem_mat_name.get(elem.id()) or str(getattr(elem, "Name", "") or etype)
                    # Strip per-instance ArchiCAD/Revit numeric ID suffixes (e.g. '_(#948940)' or ':123456')
                    # so identical element types group cleanly instead of exploding into thousands of 1-element groups.
                    mat_fallback = re.sub(r"[_\s]*\(#\d+\)\s*$", "", raw_mat_fb).strip()
                    mat_fallback = re.sub(r":\d{5,}\s*$", "", mat_fallback).strip() or raw_mat_fb

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
                            # M7: Interior BIM elements belong to 'ignore' (not mixed with 'roof')
                            cat = "ignore"
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
                            elif etype == "IfcCovering":
                                cov_pt = str(getattr(elem, "PredefinedType", "") or "").upper()
                                if cov_pt in ("CEILING", "FLOORING"):
                                    cat = "ignore"
                                elif cov_pt == "ROOFING":
                                    cat = "roof"
                                elif cov_pt == "CLADDING":
                                    cat = "wall"
                                else:
                                    cat = classify_layer_or_material_role(f"{style_or_mat} {elem.Name or ''}", context=p_type)
                            elif etype == "IfcDoor":
                                cat = "glazing" if ("glass" in style_or_mat.lower() or tr_val > 0.12) else "wall"
                            elif etype in ("IfcPlate", "IfcCurtainWall") or p_type == "IfcCurtainWall":
                                # Nama elemen & ObjectType ikut dibaca: banyak ekspor (mis. Archicad) tidak membawa
                                # material/style sama sekali, petunjuk satu-satunya ada di nama (CW_Vision_Glass_4).
                                el_hint = f"{elem.Name or ''} {getattr(elem, 'ObjectType', '') or ''}".strip()
                                sm_lo = f"{style_or_mat} {el_hint}".lower()
                                has_glass_kw = any(k in sm_lo for k in ("glass", "glaz", "kaca", "vision"))
                                if tr_val <= 0.12 and not has_glass_kw:
                                    # B1: Opaque IfcPlate/IfcCurtainWall without glass keyword -> spandrel (z<=1.35m) or wall, NEVER glazing.
                                    base_cat = classify_layer_or_material_role(f"{style_or_mat} {el_hint}".strip(), context=p_type)
                                    if base_cat in ("frame", "shading", "ignore", "spandrel"):
                                        cat = base_cat
                                    else:
                                        sub_v_idx = np.unique(sub_tris)
                                        z_span_el = float(np.max(verts[sub_v_idx, 2]) - np.min(verts[sub_v_idx, 2])) if len(sub_v_idx) > 0 else 0.0
                                        cat = "spandrel" if z_span_el <= 1.35 else "wall"
                                else:
                                    cat = "glazing"
                            else:
                                if resolved_style:
                                    cat = classify_layer_or_material_role(f"{resolved_style} {etype}", context=p_type)
                                else:
                                    cat = classify_layer_or_material_role(f"{style_or_mat} {elem.Name or ''} {etype}", context=p_type)
                            g_name = f"{layer_label} :: {style_or_mat}" if style_or_mat != layer_label else layer_label

                        restore_sliv = f"sliver::{g_name}" in rf_set
                        restore_caps = f"cap::{g_name}" in rf_set
                        v_clean, f_clean, n_sliv, a_sliv, n_cap, a_cap = _clean_solid_bim_element_faces(
                            verts, sub_tris, cat, restore_slivers=restore_sliv, restore_caps=restore_caps
                        )
                        if n_sliv > 0:
                            st = sliver_stats_by_grp.setdefault(g_name, [0.0, 0.0])
                            st[0] += n_sliv
                            st[1] += a_sliv
                            if not restore_sliv:
                                slivers_removed_total += n_sliv
                        if n_cap > 0:
                            st = cap_stats_by_grp.setdefault(g_name, [0.0, 0.0])
                            st[0] += n_cap
                            st[1] += a_cap
                        if len(f_clean) > 0:
                            chunks.append((g_name, layer_label, style_or_mat, cat, v_clean, f_clean, is_ext, u_bim))

            if not iterator.next():
                break

    ifc_filtered_items: List[Dict[str, Any]] = []
    for g_name, (cnt, area) in sorted(sliver_stats_by_grp.items()):
        fid = f"sliver::{g_name}"
        ifc_filtered_items.append({
            "id": fid,
            "group": g_name,
            "reason": "thin_edge_sliver",
            "reason_label": "Tepi tipis ketebalan panel BIM (<= 12 cm)",
            "face_count": int(cnt),
            "area_m2": round(float(area), 4),
            "restored": fid in rf_set,
        })
    for g_name, (cnt, area) in sorted(cap_stats_by_grp.items()):
        fid = f"cap::{g_name}"
        ifc_filtered_items.append({
            "id": fid,
            "group": g_name,
            "reason": "horizontal_cap",
            "reason_label": "Sisi atas/bawah penutup ketebalan panel solid",
            "face_count": int(cnt),
            "area_m2": round(float(area), 4),
            "restored": fid in rf_set,
        })

    kernel_info = f"IfcOpenShell {ifcopenshell.version} (OpenCASCADE · {schema})"
    return (
        chunks,
        detected_unit,
        storeys,
        slivers_removed_total,
        interior_filtered_total,
        kernel_info,
        ifc_filtered_items,
    )
