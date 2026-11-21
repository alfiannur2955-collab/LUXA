"""
OTTV 3D Parametric Studio — File Signature Detection, Export Tips & Read-Only Inspection
========================================================================================
Fase 2 Architecture (Single Source of Truth):
- No mandatory `source_software` form: `detect_file_signature(filepath)` auto-detects
  the format and authoring signature directly from file headers.
- Adapters only supply contextual `export_tips` (shown when missing meshes, unit guesses,
  or export issues occur).
- `build_staging_inspection_payload(...)` is strictly READ-ONLY (zero disk writes,
  zero solar raycasting) and consumes `ProjectConfig` / `InspectRequest`.
- Config persistence (`load_project_config` / `save_project_config`) stores `.ottv.json`
  version 2 and transparently migrates legacy v1 configs via `migrate_v1`.
"""

from __future__ import annotations

import json
import math
import os
import re
import zipfile
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

from config_schema import InspectRequest, ProjectConfig, migrate_v1
from universal_pipeline import (
    RawGroupMesh,
    build_dynamic_floor_levels,
    classify_layer_or_material_with_confidence,
    load_universal_model_stages_1_and_2,
)


# ============================================================================
# 1. EXPORT TIPS CATALOG (Adapters provide export_tips only — no intake routing)
# ============================================================================

EXPORT_TIPS_BY_SOURCE: Dict[str, Dict[str, Any]] = {
    "archicad": {
        "id": "archicad",
        "name": "Graphisoft Archicad",
        "recommended_format": ".ifc",
        "export_tips": [
            "Format terbaik: Ekspor IFC2x3 / IFC4 (Coordination View / Reference View) agar IfcCurtainWall, IfcPlate, IfcWall, dan IfcBuildingStorey terbaca otomatis.",
            "Pastikan properti IsExternal aktif pada dinding/bukaan agar elemen interior otomatis dipisahkan ke kategori ignore.",
            "Jika mengekspor .3dm dari Archicad, buka di Rhino dalam tampilan Shaded lalu Save (jangan SaveSmall) agar semua Brep membawa render mesh.",
        ],
    },
    "revit": {
        "id": "revit",
        "name": "Autodesk Revit",
        "recommended_format": ".ifc",
        "export_tips": [
            "Format terbaik: Ekspor IFC4 Reference View — lubang jendela (IfcOpeningElement) dipotong otomatis oleh OpenCASCADE.",
            "Pastikan fase/view ekspor hanya menyertakan elemen arsitektur selubung dan level lantai (Levels) tercentang.",
            "Hindari mengekspor furnitur dan partisi interior untuk mempercepat pemrosesan.",
        ],
    },
    "rhino": {
        "id": "rhino",
        "name": "Rhinoceros 3D / Grasshopper",
        "recommended_format": ".3dm",
        "export_tips": [
            "Format terbaik: .3dm langsung — mendukung Mesh, Extrusion, Brep ber-render mesh, dan nested Block Instances.",
            "Pastikan setiap permukaan NURBS/Brep memiliki render mesh: tampilkan viewport Shaded lalu Save (jangan SaveSmall), atau jalankan perintah Mesh sebelum menyimpan.",
            "Objek/Layer yang sedang dimatikan (Hidden/Off) di Rhino otomatis diabaikan saat impor.",
            "Pisahkan Kaca, Spandrel, dan Rangka di Layer atau Material berbeda.",
        ],
    },
    "sketchup_mesh": {
        "id": "sketchup_mesh",
        "name": "SketchUp / Blender / 3ds Max",
        "recommended_format": ".glb",
        "export_tips": [
            "Format terbaik: .glb (transformasi komponen & transparansi kaca PBR ikut terbawa) atau .zip berisi (.obj + .mtl).",
            "Sumbu Y-Up otomatis dikonversi ke Z-Up. Pastikan sisi depan (front face / putih) di SketchUp sudah menghadap keluar sebelum ekspor.",
            "Beri nama grup/material secara deskriptif (mis. Kaca_Vision, Dinding_Luar, Spandrel) agar klasifikasi otomatis akurat.",
        ],
    },
    "honeybee_generic": {
        "id": "honeybee_generic",
        "name": "Ladybug / Honeybee / OpenBIM Lainnya",
        "recommended_format": ".hbjson",
        "export_tips": [
            "Mendukung file .hbjson (Ladybug/Pollination) dengan Aperture & Outdoor Shade terpisah secara eksak.",
            "Juga mendukung ekspor IFC4/IFC4.3 dari Allplan, Vectorworks, Tekla, atau BricsCAD.",
        ],
    },
}

SUPPORTED_MODEL_EXTS = (".ifc", ".3dm", ".obj", ".glb", ".gltf", ".hbjson", ".json", ".stl", ".ply")


def get_export_tips(
    detected_software: Optional[str] = None,
    actual_ext: Optional[str] = None,
) -> Dict[str, Any]:
    """Returns export tips relevant to a detected software signature or file extension."""
    key = (detected_software or "").lower()
    if key not in EXPORT_TIPS_BY_SOURCE:
        ext = (actual_ext or "").lower()
        if ext == ".3dm":
            key = "rhino"
        elif ext == ".ifc":
            key = "archicad"
        elif ext in (".glb", ".gltf", ".obj", ".zip", ".stl", ".ply"):
            key = "sketchup_mesh"
        else:
            key = "honeybee_generic"
    entry = EXPORT_TIPS_BY_SOURCE[key]
    return {
        "source_id": entry["id"],
        "source_name": entry["name"],
        "recommended_format": entry["recommended_format"],
        "tips": list(entry["export_tips"]),
    }


# ============================================================================
# 2. ZIP UNPACKER (.obj + .mtl / .gltf + .bin) & FILE SIGNATURE DETECTOR
# ============================================================================

def unpack_zip_bundle_if_needed(filepath: str, uploads_dir: str) -> Tuple[str, str, List[str]]:
    """
    If `filepath` is a `.zip` archive (e.g. SketchUp/Blender `.obj` + `.mtl` bundle),
    extracts it safely into a subfolder inside `uploads_dir` and returns
    `(resolved_model_path, resolved_display_name, unpack_notes)`.
    """
    ext = os.path.splitext(filepath.lower())[1]
    if ext != ".zip":
        return filepath, os.path.basename(filepath), []

    bundle_slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", os.path.splitext(os.path.basename(filepath))[0]).strip("_") or "bundle"
    extract_dir = os.path.join(uploads_dir, f"_bundle_{bundle_slug}")
    os.makedirs(extract_dir, exist_ok=True)

    extracted_files: List[str] = []
    with zipfile.ZipFile(filepath, "r") as zf:
        for member in zf.infolist():
            if member.is_dir():
                continue
            safe_rel = os.path.normpath(member.filename).lstrip("\\/")
            if safe_rel.startswith("..") or os.path.isabs(safe_rel):
                continue
            dest = os.path.join(extract_dir, safe_rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(member) as src, open(dest, "wb") as dst:
                dst.write(src.read())
            extracted_files.append(dest)

    priority = {e: i for i, e in enumerate(SUPPORTED_MODEL_EXTS)}
    candidates = [
        p for p in extracted_files
        if os.path.splitext(p.lower())[1] in priority
        and not os.path.basename(p).startswith("._")
    ]
    if not candidates:
        raise ValueError("File .zip tidak mengandung model 3D yang didukung (.ifc, .3dm, .obj, .glb, .hbjson).")

    candidates.sort(key=lambda p: (priority[os.path.splitext(p.lower())[1]], -os.path.getsize(p)))
    chosen = candidates[0]
    has_mtl = any(p.lower().endswith(".mtl") for p in extracted_files)
    notes = [f"Arsip ZIP diekstrak: model utama '{os.path.basename(chosen)}'" + (" + file material .MTL terdeteksi." if has_mtl else ".")]
    return chosen, os.path.basename(chosen), notes


def detect_file_signature(filepath: str) -> Dict[str, Any]:
    """
    Inspects file header/magic bytes to detect the actual authoring software & format
    automatically — no pre-upload `source_software` form required.
    """
    ext = os.path.splitext(filepath.lower())[1]
    sig: Dict[str, Any] = {
        "actual_ext": ext,
        "detected_software": None,
        "detected_software_label": "Tidak diketahui",
        "schema_or_version": "",
    }
    try:
        if ext == ".ifc":
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                head = f.read(16000)
            sch_m = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", head, re.IGNORECASE)
            if sch_m:
                sig["schema_or_version"] = sch_m.group(1)
            head_lo = head.lower()
            if "archicad" in head_lo or "graphisoft" in head_lo:
                sig["detected_software"] = "archicad"
                sig["detected_software_label"] = "Graphisoft Archicad (IFC)"
            elif "revit" in head_lo or "autodesk" in head_lo:
                sig["detected_software"] = "revit"
                sig["detected_software_label"] = "Autodesk Revit (IFC)"
            elif "sketchup" in head_lo or "trimble" in head_lo:
                sig["detected_software"] = "sketchup_mesh"
                sig["detected_software_label"] = "SketchUp (IFC)"
            else:
                sig["detected_software"] = "honeybee_generic"
                sig["detected_software_label"] = f"OpenBIM ({sig['schema_or_version'] or 'IFC'})"
        elif ext == ".3dm":
            sig["detected_software"] = "rhino"
            sig["detected_software_label"] = "Rhinoceros 3D (.3dm)"
            with open(filepath, "rb") as f:
                raw_chunk = f.read(65536).decode("latin-1", errors="ignore").lower()
            if "archicad" in raw_chunk or "graphisoft" in raw_chunk:
                sig["detected_software"] = "archicad"
                sig["detected_software_label"] = "Graphisoft Archicad (Ekspor .3dm)"
        elif ext in (".glb", ".gltf"):
            sig["detected_software"] = "sketchup_mesh"
            sig["detected_software_label"] = "Mesh GLB/GLTF (Y-Up PBR)"
        elif ext in (".hbjson", ".json"):
            sig["detected_software"] = "honeybee_generic"
            sig["detected_software_label"] = "Ladybug / Honeybee (.hbjson)"
        elif ext == ".obj":
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                head = f.read(4096).lower()
            if "blender" in head:
                sig["detected_software"] = "sketchup_mesh"
                sig["detected_software_label"] = "Blender (.obj)"
            elif "sketchup" in head:
                sig["detected_software"] = "sketchup_mesh"
                sig["detected_software_label"] = "SketchUp (.obj)"
            elif "rhino" in head:
                sig["detected_software"] = "rhino"
                sig["detected_software_label"] = "Rhinoceros 3D (.obj)"
            else:
                sig["detected_software"] = "sketchup_mesh"
                sig["detected_software_label"] = "Wavefront Mesh (.obj)"
        elif ext in (".stl", ".ply"):
            sig["detected_software"] = "sketchup_mesh"
            sig["detected_software_label"] = f"Polygon Mesh ({ext})"
    except Exception:
        pass
    return sig


# ============================================================================
# 3. READ-ONLY FAST 3D INSPECTION PAYLOAD BUILDER (ZERO RAYCAST, ZERO DISK I/O)
# ============================================================================

def _estimate_group_confidence(rg: RawGroupMesh) -> Tuple[str, str]:
    """
    M7: Evaluates whether a group's auto-assigned role is high-confidence or 'review'
    (including all 'unknown' groups which require explicit user confirmation).
    """
    if rg.default_category == "unknown":
        return "review", "Peran belum dikenali — wajib dikonfirmasi di Periksa Model"
    if rg.is_external_bim is False:
        return "high", "Metadata BIM IsExternal=False (Interior -> ignore)"
    if rg.is_auto_split_child:
        return "high", "Hasil Auto-Split Geometri (Tier 2)"
    _, score, reason = classify_layer_or_material_with_confidence(rg.group_name)
    if score >= 0.80:
        return "high", reason
    return "review", "Nama grup generik/ambigu — mohon verifikasi peran di 3D"


def build_staging_inspection_payload(
    filepath: str,
    display_filename: str,
    model_id: str,
    config: Optional[Union[ProjectConfig, InspectRequest]] = None,
) -> Dict[str, Any]:
    """
    Read-only 3D Staging Inspection builder (ZERO solar raycasting, ZERO disk writes).
    Uses `detect_file_signature(filepath)` for automatic detection and `config.model` +
    `config.roles` + `config.advanced` for normalization & role overrides.
    """
    cfg = config if config is not None else ProjectConfig()
    m_cfg = cfg.model
    r_cfg = cfg.roles
    a_cfg = cfg.advanced

    sig = detect_file_signature(filepath)
    tips_info = get_export_tips(sig.get("detected_software"), sig.get("actual_ext"))

    raw_groups, audit = load_universal_model_stages_1_and_2(
        filepath=filepath,
        unit_mode=m_cfg.unit_mode,
        up_axis=m_cfg.up_axis,
        nurbs_u_div=a_cfg.nurbs_u_div,
        nurbs_v_div=a_cfg.nurbs_v_div,
        auto_split_merged_cw=r_cfg.auto_split_merged_cw,
        groups_to_auto_split=r_cfg.groups_to_auto_split,
        frame_width_threshold_m=a_cfg.frame_width_threshold_m,
        spandrel_height_threshold_m=a_cfg.spandrel_height_threshold_m,
        restore_filtered=m_cfg.restore_filtered,
    )

    cat_overrides = dict(r_cfg.group_category_overrides or {})
    disabled_set = set(r_cfg.disabled_groups or [])
    wwr_map = dict(r_cfg.group_wwr_map or {})
    face_ov = dict(r_cfg.face_category_overrides or {})

    # Global bounding box across all groups
    all_v = np.vstack([rg.vertices for rg in raw_groups])
    b_min = np.min(all_v, axis=0)
    b_max = np.max(all_v, axis=0)
    b_center = 0.5 * (b_min + b_max)
    b_span = b_max - b_min

    # Dynamic preview floor count above ground cutoff Z0
    z0_cut = float(m_cfg.z_ground_cutoff_m or 0.0)
    z_eff_min = max(float(b_min[2]), z0_cut)
    z_eff_max = max(z_eff_min + 2.5, float(b_max[2]))
    preview_floors, floor_method = build_dynamic_floor_levels(
        z_min_bldg=z_eff_min,
        z_max_bldg=z_eff_max,
        floor_mode="auto",
        floor_height_m=3.6,
        bim_storeys=audit.bim_storeys,
    )

    staging_groups: List[Dict[str, Any]] = []
    preview_meshes: List[Dict[str, Any]] = []
    active_envelope_groups = 0
    review_needed_count = 0

    # M11: Shared outer-skin area function identical to analyze_building_ottv()
    from ottv_engine import compute_outer_skin_areas_by_group
    outer_metrics_by_group = compute_outer_skin_areas_by_group(
        raw_groups=raw_groups,
        group_category_overrides=cat_overrides,
        disabled_groups=list(disabled_set),
        z_ground_cutoff_m=z0_cut,
        exterior_detection_mode=m_cfg.exterior_detection_mode,
        bim_storeys=audit.bim_storeys,
        restore_filtered=m_cfg.restore_filtered,
    )
    all_filtered_items = list(audit.filtered_items)

    for rg in raw_groups:
        eff_cat = cat_overrides.get(rg.group_name, rg.default_category)
        is_enabled = rg.group_name not in disabled_set
        conf, conf_reason = _estimate_group_confidence(rg)
        if rg.group_name in cat_overrides:
            conf = "verified"
            conf_reason = "Dikonfirmasi manual oleh pengguna"
        elif conf == "review" and is_enabled and eff_cat not in ("roof", "ignore"):
            review_needed_count += 1

        if is_enabled and eff_cat in ("glazing", "spandrel", "wall", "composite_cw"):
            active_envelope_groups += 1

        vs = rg.vertices
        fs = rg.faces
        g_zmin = float(np.min(vs[:, 2]))
        g_zmax = float(np.max(vs[:, 2]))

        om = outer_metrics_by_group.get(rg.group_name)
        if om is not None:
            outer_area_m2 = round(float(om["outer_area_m2"]), 2)
            outer_faces_cnt = int(om["outer_faces"])
            if om.get("filtered_entry") is not None:
                all_filtered_items.append(om["filtered_entry"])
        else:
            outer_area_m2 = 0.0
            outer_faces_cnt = 0

        staging_groups.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "source_layer": rg.source_layer,
            "source_material": rg.source_material,
            "default_category": rg.default_category,
            "category": eff_cat,
            "enabled": is_enabled,
            "confidence": conf,
            "confidence_reason": conf_reason,
            "is_auto_split_child": rg.is_auto_split_child,
            "composite_wwr": round(float(wwr_map.get(rg.group_name, 0.65)), 2) if eff_cat == "composite_cw" else None,
            "face_count": int(len(fs)),
            "outer_faces": outer_faces_cnt,
            "outer_area_m2": outer_area_m2,
            "raw_area_m2": outer_area_m2,
            "z_range_m": [round(g_zmin, 2), round(g_zmax, 2)],
        })

        # Lightweight preview mesh for 3D Inspection viewport (display only; area uses full mesh above)
        max_prev_faces = 7000
        stride = max(1, int(math.ceil(len(fs) / max_prev_faces))) if len(fs) > max_prev_faces else 1
        fs_vis = fs[::stride]
        uniq_v, inv = np.unique(fs_vis, return_inverse=True)
        vs_compact = np.round(vs[uniq_v], 3)
        fs_compact = inv.reshape(fs_vis.shape)

        tris_out: List[List[int]] = []
        face_ids_out: List[str] = []
        for fi_local, f_row in enumerate(fs_compact):
            orig_fi = fi_local * stride
            f_key = f"{rg.group_id}-F{orig_fi + 1}"
            tris_out.append([int(f_row[0]), int(f_row[1]), int(f_row[2])])
            face_ids_out.append(f_key)
            if f_row[2] != f_row[3]:
                tris_out.append([int(f_row[0]), int(f_row[2]), int(f_row[3])])
                face_ids_out.append(f_key)

        preview_meshes.append({
            "group_id": rg.group_id,
            "group_name": rg.group_name,
            "category": eff_cat,
            "enabled": is_enabled,
            "vertices": vs_compact.tolist(),
            "tris": tris_out,
            "face_ids": face_ids_out,
        })

    max_dim = float(np.max(b_span))
    dims_sane = 1.5 <= max_dim <= 600.0
    z0_valid = z0_cut < float(b_max[2]) - 1.0
    has_envelope = active_envelope_groups > 0
    checklist = [
        {
            "id": "dim_check",
            "label": f"Dimensi Ternormalisasi Wajar ({b_span[0]:.1f} × {b_span[1]:.1f} × {b_span[2]:.1f} m)",
            "passed": dims_sane,
            "severity": "ok" if dims_sane else "error",
            "hint": "" if dims_sane else "Dimensi terlihat terlalu kecil/besar — ubah Satuan Model (mm/cm/m).",
        },
        {
            "id": "z0_check",
            "label": f"Elevasi Muka Tanah Z0 ({z0_cut:.1f} m) & Estimasi {len(preview_floors)} Lantai di Atas Tanah",
            "passed": z0_valid,
            "severity": "ok" if z0_valid else "error",
            "hint": "" if z0_valid else "Batas Z0 melebihi puncak bangunan — turunkan Z0.",
        },
        {
            "id": "envelope_check",
            "label": f"Minimal 1 Grup Selubung Aktif ({active_envelope_groups} grup Kaca/Spandrel/Dinding)",
            "passed": has_envelope,
            "severity": "ok" if has_envelope else "error",
            "hint": "" if has_envelope else "Belum ada grup aktif berjenis Kaca, Spandrel, Dinding, atau CW Komposit.",
        },
        {
            "id": "ambiguity_check",
            "label": (
                "Semua Grup Sudah Jelas / Terverifikasi"
                if review_needed_count == 0
                else f"{review_needed_count} Grup Generik/Unknown Perlu Ditinjau Perannya"
            ),
            "passed": review_needed_count == 0,
            "severity": "ok" if review_needed_count == 0 else "warn",
            "hint": "Tentukan peran grup bertanda 'unknown' sebelum menghitung OTTV final." if review_needed_count > 0 else "",
        },
    ]

    return {
        "status": "inspected",
        "model_id": model_id,
        "filename": display_filename,
        "file_signature": sig,
        "export_tips": tips_info,
        "stage1_audit": {
            "geometry_kernel": audit.geometry_kernel,
            "detected_unit": audit.detected_unit,
            "applied_unit": audit.applied_unit,
            "scale_factor_to_m": audit.scale_factor_to_m,
            "unit_source": audit.unit_source,
            "unit_needs_confirmation": audit.unit_needs_confirmation,
            "detected_up_axis": audit.detected_up_axis,
            "applied_up_axis": audit.applied_up_axis,
            "normalized_span_m": audit.normalized_span_m,
            "z_ground_offset_m": audit.z_ground_offset_m,
            "xy_world_offset_m": audit.xy_world_offset_m,
            "slivers_removed": audit.slivers_removed,
            "interior_elements_filtered": audit.interior_elements_filtered,
            "hidden_objects_skipped": audit.hidden_objects_skipped,
            "missing_mesh": audit.missing_mesh,
            "filtered_items": all_filtered_items,
            "bim_storeys_count": len(audit.bim_storeys),
            "notes": audit.notes,
        },
        "filtered_items": all_filtered_items,
        "missing_mesh": audit.missing_mesh,
        "bounding_box": {
            "min": [round(float(x), 2) for x in b_min],
            "max": [round(float(x), 2) for x in b_max],
            "center": [round(float(x), 2) for x in b_center],
            "span": [round(float(x), 2) for x in b_span],
            "max_span": round(max_dim, 2),
        },
        "estimated_floors": len(preview_floors),
        "floor_detection_method": floor_method,
        "groups": staging_groups,
        "preview_meshes": preview_meshes,
        "face_category_overrides": face_ov,
        "face_z_band_overrides": list(r_cfg.face_z_band_overrides or []),
        "gate_checklist": checklist,
        "can_commit": dims_sane and z0_valid and has_envelope,
    }


# ============================================================================
# 4. EXPLICIT CONFIG PERSISTENCE PER MODEL (.ottv.json v2 with v1 migration)
# ============================================================================

def get_project_config_path(uploads_dir: str, model_id: str, create_dir: bool = False) -> str:
    cfg_dir = os.path.join(uploads_dir, ".staging_configs")
    if create_dir:
        os.makedirs(cfg_dir, exist_ok=True)
    safe_id = re.sub(r"[^a-zA-Z0-9._-]+", "_", model_id).strip("_") or "model"
    return os.path.join(cfg_dir, f"{safe_id}.ottv.json")


def save_project_config(uploads_dir: str, model_id: str, config: ProjectConfig) -> str:
    """Explicitly writes version-2 ProjectConfig to disk (ONLY called by PUT /api/models/{id}/config)."""
    path = get_project_config_path(uploads_dir, model_id, create_dir=True)
    payload = config.model_dump(mode="json")
    payload["version"] = 2
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    return path


def load_project_config(uploads_dir: str, model_id: str) -> Optional[ProjectConfig]:
    """Read-only load of `.ottv.json` (auto-migrates v1 in memory without touching disk)."""
    path = get_project_config_path(uploads_dir, model_id, create_dir=False)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return migrate_v1(raw)
    except Exception:
        return None
