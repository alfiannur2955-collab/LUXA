"""
OTTV 3D Parametric Studio — Universal 5-Stage Gatekeeper Pipeline
(Fase 6: fungsi per format ada di backend/loaders/; modul ini memegang alur utama
load_universal_model_stages_1_and_2 dan mengekspor ulang nama lama.) (SNI 6389:2020)
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
import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import rhino3dm
import trimesh
from ladybug_geometry.geometry3d.face import Face3D


# Fase 6: isi per format dipindah ke backend/loaders/. Nama lama tetap bisa diimpor dari modul ini.
import loaders.ifc as _ifc_loader
from loaders.classify import (  # noqa: F401  (diekspor ulang)
    classify_layer_or_material_role,
    classify_layer_or_material_with_confidence,
    suggest_material_id_for_group,
)
from loaders.floors import (  # noqa: F401  (diekspor ulang)
    assign_panels_to_floors,
    build_dynamic_floor_levels,
    enrich_floor_zones_and_presets,
    format_floor_source_label,
)
from loaders.ifc import _parse_ifc_with_ifcopenshell, ifcopenshell  # noqa: F401
from loaders.mesh import _parse_obj_with_materials
from loaders.sanity import looks_like_frame
from loaders.normalize import (  # noqa: F401
    _filter_thin_edge_slivers_on_group,
    _merge_coplanar_tris_to_quads,
    decompose_merged_group_geometrically,
)
from loaders.rhino import _apply_xform, _ladybug_mesh_to_numpy, _rhino_mesh_to_numpy, _xform_to_matrix
from loaders.types import RawGroupMesh, Stage1GeometryAudit, UNIT_SCALE_TO_METERS  # noqa: F401

HAS_IFCOPENSHELL = _ifc_loader.HAS_IFCOPENSHELL  # dibaca ulang saat dipakai; browser_api memperbaruinya


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
    restore_filtered: Optional[List[str]] = None,
) -> Tuple[List[RawGroupMesh], Stage1GeometryAudit]:
    """
    Executes Stage 1 (Geometry, Unit & Axis Normalization) and Stage 2 (Layer::Material +
    Geometric Auto-Splitter) with caching for sub-second interactive response.
    """
    abs_fp = os.path.abspath(filepath)
    mtime = os.path.getmtime(abs_fp) if os.path.exists(abs_fp) else 0.0
    fsize = os.path.getsize(abs_fp) if os.path.exists(abs_fp) else 0
    split_tuple = tuple(sorted(groups_to_auto_split or []))
    restore_tuple = tuple(sorted(restore_filtered or []))
    restore_set = set(restore_tuple)
    cache_key = (
        abs_fp,
        mtime,
        fsize,
        unit_mode,
        up_axis,
        nurbs_u_div,
        nurbs_v_div,
        auto_split_merged_cw,
        split_tuple,
        round(frame_width_threshold_m, 3),
        round(spandrel_height_threshold_m, 3),
        restore_tuple,
    )
    if cache_key in _UNIVERSAL_FILE_CACHE:
        return _UNIVERSAL_FILE_CACHE[cache_key]
    if len(_UNIVERSAL_FILE_CACHE) >= 32:
        _UNIVERSAL_FILE_CACHE.clear()

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
    # A0. RHINO .3DM PRE-EXTRACTED IN THE BROWSER (Fase 5a/5b, Pyodide)
    #     rhino3dm.js reads the .3dm in JavaScript (spike-pyodide/rhino_extract.mjs)
    #     and writes `<name>.3dm.json` with the same chunks the native branch below
    #     produces; classification and grouping stay in Python so both paths agree.
    # ------------------------------------------------------------------------
    pre_extracted_3dm = filepath.lower().endswith(".3dm.json")
    if pre_extracted_3dm:
        ext = ".3dm"
        with open(filepath, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        audit.geometry_kernel = "rhino3dm.js (browser)"
        audit.detected_unit = str(payload.get("unit") or "m")
        audit.detected_up_axis = "Z"
        audit.total_raw_objects = int(payload.get("total_raw_objects") or 0)
        audit.hidden_objects_skipped = int(payload.get("hidden_skipped") or 0)
        for ch in payload.get("chunks") or []:
            v_arr = np.asarray(ch.get("v") or [], dtype=np.float64).reshape(-1, 3)
            f_arr = np.asarray(ch.get("f") or [], dtype=np.int64).reshape(-1, 4)
            g_name = str(ch.get("g") or "Default")
            layer_name = str(ch.get("layer") or "Default")
            mat_name = str(ch.get("mat") or "")
            base_cat = classify_layer_or_material_role(f"{g_name} {layer_name} {mat_name}")
            cat = "ignore" if base_cat == "ignore" else ("glazing" if float(ch.get("transp") or 0.0) > 0.15 else base_cat)
            _add_chunk(g_name, layer_name, str(ch.get("src_mat") or "Default"), cat, v_arr, f_arr)
        for mm in payload.get("missing_mesh") or []:
            audit.missing_mesh.append(dict(mm))
        if audit.missing_mesh:
            audit.notes.append(
                f"Peringatan M3: {sum(int(m.get('face_count', 0)) for m in audit.missing_mesh)} permukaan tanpa render mesh "
                "tidak digambar ulang otomatis. Di Rhino: tampilkan viewport dalam mode Shaded lalu Save "
                "(jangan gunakan SaveSmall), atau jalankan perintah Mesh pada objek Brep/Surface sebelum menyimpan .3dm."
            )
        if audit.hidden_objects_skipped > 0:
            audit.notes.append(f"{audit.hidden_objects_skipped} objek/layer tersembunyi (Hidden/Off) diabaikan otomatis.")

    # ------------------------------------------------------------------------
    # A. RHINO .3DM (BLOCKS, HIDDEN LAYER FILTER, MATERIAL-BY-LAYER, SUBD)
    # ------------------------------------------------------------------------
    if ext == ".3dm" and not pre_extracted_3dm:
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

            base_cat = classify_layer_or_material_role(f"{g_name} {layer_name} {mat_name}")
            cat = "ignore" if base_cat == "ignore" else ("glazing" if m_transp > 0.15 else base_cat)

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
    # B. NATIVE BIM .IFC — STRICT IfcOpenShell (OpenCASCADE C++)
    # ------------------------------------------------------------------------
    elif ext == ".ifc":
        if not (_ifc_loader.HAS_IFCOPENSHELL or HAS_IFCOPENSHELL):
            raise ValueError(
                "IfcOpenShell tidak terpasang di server. Modul IfcOpenShell wajib tersedia "
                "untuk membaca file BIM .IFC secara akurat."
            )
        try:
            (
                ios_chunks,
                ifc_unit,
                ifc_storeys,
                slivers_rm,
                interior_rm,
                kernel_info,
                ifc_filtered_items,
            ) = _parse_ifc_with_ifcopenshell(filepath, restore_filtered_set=restore_set)
        except Exception as e_ios:
            raise ValueError(
                f"File IFC tidak dapat dibaca oleh IfcOpenShell ({type(e_ios).__name__}: {e_ios}). "
                "Pastikan file IFC valid (IFC2x3/IFC4/IFC4.3) dan tidak rusak."
            ) from e_ios

        if not ios_chunks:
            raise ValueError(
                "IfcOpenShell tidak menemukan geometri bangunan yang dapat dibaca pada file IFC ini. "
                "Pastikan elemen selubung (IfcWall/IfcCurtainWall/IfcPlate/IfcWindow) diekspor bersama representasi 3D (Body)."
            )

        coords_already_in_meters = True
        audit.geometry_kernel = kernel_info
        audit.detected_unit = ifc_unit
        audit.detected_up_axis = "Z"
        audit.bim_storeys = ifc_storeys
        audit.total_raw_objects = len(ios_chunks)
        audit.slivers_removed = slivers_rm
        audit.interior_elements_filtered = interior_rm
        audit.filtered_items.extend(ifc_filtered_items)
        for g_name, src_layer, src_mat, cat, v_arr, f_arr, is_ext, u_bim in ios_chunks:
            _add_chunk(g_name, src_layer, src_mat, cat, v_arr, f_arr, is_ext=is_ext, u_bim=u_bim)
        if slivers_rm > 0:
            audit.notes.append(f"Filter BIM membersihkan {slivers_rm} tepi tipis panel solid & menggabung segitiga koplanar.")
        if interior_rm > 0:
            audit.notes.append(f"{interior_rm} elemen interior (IsExternal=False) dipisahkan dari selubung OTTV.")

    # ------------------------------------------------------------------------
    # C. WAVEFRONT .OBJ + .MTL (TRANSPARENCY & LAYER::USEMTL DECOMPOSITION)
    # ------------------------------------------------------------------------
    elif ext == ".obj":
        audit.geometry_kernel = "Wavefront OBJ+MTL Parser"
        audit.detected_unit = None
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
        audit.detected_unit = None
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
            base_cat = classify_layer_or_material_role(f"{node_name} {mat_name}")
            cat = "ignore" if base_cat == "ignore" else ("glazing" if is_pbr_glass else base_cat)
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
    elif not pre_extracted_3dm:
        raise ValueError(f"Format file '{ext}' tidak didukung.")

    # M8: Merge chunks per group — if a group contains mixed categories, split into per-category sub-groups!
    raw_groups: List[RawGroupMesh] = []
    g_counter = 0
    for g_name, chunks in groups_map.items():
        by_cat: Dict[str, List[Tuple[np.ndarray, np.ndarray, str, str, str, Optional[bool], Optional[float]]]] = {}
        for ch in chunks:
            by_cat.setdefault(ch[2], []).append(ch)
        is_mixed = len(by_cat) > 1
        if is_mixed:
            audit.notes.append(
                f"M8: Grup '{g_name}' memiliki kategori campur ({', '.join(sorted(by_cat.keys()))}) -> dipecah per kategori."
            )
        for sub_cat, sub_chunks in by_cat.items():
            g_counter += 1
            eff_g_name = f"{g_name} :: {sub_cat}" if is_mixed else g_name
            v_list = []
            f_list = []
            v_offset = 0
            src_layer = sub_chunks[0][3]
            src_mat = sub_chunks[0][4]
            is_ext_g = sub_chunks[0][5]
            u_bim_g = sub_chunks[0][6]
            for v_arr, f_arr, _, _, _, _, _ in sub_chunks:
                v_list.append(v_arr)
                f_list.append(f_arr + v_offset)
                v_offset += len(v_arr)
            v_merged = np.vstack(v_list)
            f_merged = np.vstack(f_list)

            # M5: NEVER stride-delete polygons from RawGroupMesh (preserves 100% geometry for
            # area & visual display; any raycast simplification happens only on raycast buffers).

            raw_groups.append(
                RawGroupMesh(
                    group_id=f"R-{g_counter}",
                    group_name=eff_g_name,
                    source_layer=src_layer,
                    source_material=src_mat,
                    default_category=sub_cat,
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

    # M10: Resolve unit scale to meters & flag `unit_needs_confirmation=True` whenever unit is guessed from BBox!
    eff_unit = (unit_mode or "auto").lower()
    has_authoritative_unit_header = ext in (".3dm", ".ifc", ".hbjson", ".json")
    if coords_already_in_meters and eff_unit == "auto":
        if max_raw_span > 1500.0:
            scale_to_m = 0.001
            audit.applied_unit = "mm"
            audit.scale_factor_to_m = 0.001
            audit.unit_source = "bbox_guess"
            audit.unit_needs_confirmation = True
            audit.notes.append(f"Koordinat IFC ({max_raw_span:.0f}) masih dalam milimeter meski header berbeda -> ditebak mm (mohon konfirmasi).")
        else:
            scale_to_m = 1.0
            audit.applied_unit = audit.detected_unit or "m"
            audit.scale_factor_to_m = UNIT_SCALE_TO_METERS.get(audit.detected_unit or "m", 1.0)
            audit.unit_source = "header"
            audit.unit_needs_confirmation = False
    else:
        if eff_unit == "auto":
            if has_authoritative_unit_header and audit.detected_unit in UNIT_SCALE_TO_METERS:
                eff_unit = audit.detected_unit
                audit.unit_source = "header"
                audit.unit_needs_confirmation = False
            elif max_raw_span > 3500.0:
                eff_unit = "mm"
                audit.unit_source = "bbox_guess"
                audit.unit_needs_confirmation = True
                audit.notes.append(f"Dimensi mentah ({max_raw_span:.0f}) ditebak milimeter (mm) dari BBox -> mohon konfirmasi satuan.")
            elif max_raw_span > 650.0:
                eff_unit = "cm"
                audit.unit_source = "bbox_guess"
                audit.unit_needs_confirmation = True
                audit.notes.append(f"Dimensi mentah ({max_raw_span:.0f}) ditebak sentimeter (cm) dari BBox -> mohon konfirmasi satuan.")
            else:
                eff_unit = "m"
                audit.unit_source = "bbox_guess"
                if ext in (".obj", ".stl", ".ply"):
                    audit.unit_needs_confirmation = True
                else:
                    audit.unit_needs_confirmation = False
        elif eff_unit not in UNIT_SCALE_TO_METERS:
            eff_unit = "m"
            audit.unit_source = "user"
            audit.unit_needs_confirmation = False
        else:
            audit.unit_source = "user"
            audit.unit_needs_confirmation = False

        scale_to_m = UNIT_SCALE_TO_METERS[eff_unit]
        if coords_already_in_meters:
            # User manually overrode unit on an IfcOpenShell-converted model: undo original scale first
            orig_s = UNIT_SCALE_TO_METERS.get(audit.detected_unit or "m", 1.0)
            scale_to_m = scale_to_m / max(1e-9, orig_s)
        audit.applied_unit = eff_unit
        audit.scale_factor_to_m = round(UNIT_SCALE_TO_METERS[eff_unit], 6)

    if abs(scale_to_m - 1.0) > 1e-9:
        for rg in raw_groups:
            rg.vertices = rg.vertices * scale_to_m

    # M2: Ground Z reference from BIM storey elevations (if available) OR envelope geometry ONLY
    # (glazing/wall/spandrel/composite_cw) — never from trees ('unknown'), site ('ignore'), or context!
    all_v_scaled = np.vstack([rg.vertices for rg in raw_groups])
    s_min = np.min(all_v_scaled, axis=0)
    s_max = np.max(all_v_scaled, axis=0)

    env_groups_for_z = [
        rg for rg in raw_groups
        if rg.default_category in ("glazing", "wall", "spandrel", "composite_cw") and len(rg.vertices) > 0
    ]
    if env_groups_for_z:
        env_v = np.vstack([rg.vertices for rg in env_groups_for_z])
        env_min = np.min(env_v, axis=0)
        env_max = np.max(env_v, axis=0)
    else:
        env_min, env_max = s_min, s_max

    if audit.bim_storeys:
        storey_elevs = [float(st["elevation_m"]) for st in audit.bim_storeys if "elevation_m" in st]
        non_neg = [e for e in storey_elevs if e >= -0.05]
        z_offset = min(non_neg) if non_neg else (min(storey_elevs) if storey_elevs else float(env_min[2]))
        z_ref_src = "BIM storey"
    else:
        z_offset = float(env_min[2])
        z_ref_src = "geometri selubung"

    cx_raw = 0.5 * float(env_min[0] + env_max[0])
    cy_raw = 0.5 * float(env_min[1] + env_max[1])
    audit.z_ground_offset_m = round(z_offset, 3)

    if abs(z_offset) > 0.25:
        for rg in raw_groups:
            rg.vertices[:, 2] -= z_offset
        for st in audit.bim_storeys:
            st["elevation_m"] = round(st["elevation_m"] - z_offset, 3)
        s_max[2] -= z_offset
        s_min[2] -= z_offset
        audit.notes.append(f"M2: Elevasi Z dinolkan sebesar {z_offset:.3f} m berdasarkan {z_ref_src}.")

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

    # M4: Post-scaling non-destructive thin-edge sliver tagging for non-IfcOpenShell formats
    if not coords_already_in_meters:
        non_ifc_sliv = 0
        for rg in raw_groups:
            n_sliv, f_item = _filter_thin_edge_slivers_on_group(rg, restore_filtered_set=restore_set)
            non_ifc_sliv += n_sliv
            if f_item is not None:
                audit.filtered_items.append(f_item)
        if non_ifc_sliv > 0:
            audit.slivers_removed += non_ifc_sliv
            audit.notes.append(f"{non_ifc_sliv} sisi tipis ketebalan kaca/spandrel (<=8.5cm) ditandai di filtered_items (dapat dikembalikan).")

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

    # A3-06/AUDIT-03: cek geometri di tahap klasifikasi supaya inspeksi dan hasil konsisten.
    # Grup "kaca" yang sebagian besar berbentuk batang/profil (mullion, transom) = rangka.
    for rg in final_groups:
        if rg.default_category == "glazing" and not rg.is_auto_split_child:
            is_frame_geo, lin_frac = looks_like_frame(rg)
            if is_frame_geo:
                rg.default_category = "frame"
                rg.geometry_reclassified_from = "glazing"
                rg.linear_area_fraction = round(float(lin_frac), 3)
                audit.notes.append(
                    f"Grup '{rg.group_name}' bernama kaca tetapi {lin_frac * 100:.0f}% luasnya berbentuk batang/profil, "
                    "sehingga dianggap rangka. Ubah perannya bila keliru."
                )

    for idx, rg in enumerate(final_groups):
        rg.group_id = f"R-{idx + 1}"

    audit.total_raw_faces = int(sum(len(rg.faces) for rg in final_groups))
    _UNIVERSAL_FILE_CACHE[cache_key] = (final_groups, audit)
    return final_groups, audit
