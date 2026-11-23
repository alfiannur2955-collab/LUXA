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
    format_floor_source_label,
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
    if filepath.lower().endswith(".3dm.json"):
        # Browser engine: rhino3dm.js output; detect from the original .3dm kept beside it.
        original = filepath[: -len(".json")]
        filepath = original if os.path.isfile(original) else filepath
        ext = ".3dm"
    else:
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
            if not filepath.lower().endswith(".3dm"):
                return sig
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

_OPAQUE_MATERIAL_KEYWORDS = (
    "paint",
    "cat_",
    "cat ",
    "cat-",
    "concrete",
    "beton",
    "brick",
    "bata",
    "plaster",
    "plester",
    "metal",
    "alum",
    "steel",
    "baja",
    "wood",
    "kayu",
    "stone",
    "batu",
    "ceramic",
    "keramik",
    "granite",
    "granit",
    "marble",
    "marmer",
    "spandrel",
    "opaque",
    "opak",
    "gypsum",
    "gipsum",
    "masonry",
    "precast",
    "cladding",
    "acp",
    "stucco",
)

_GLASS_NAME_KEYWORDS = (
    "glass",
    "glaz",
    "kaca",
    "vision",
    "window",
    "jendela",
    "igu",
    "low-e",
    "lowe",
    "transparan",
    "transparent",
)

_ORIENTATION_LABELS_ID = {
    "U": "Utara",
    "TL": "Timur Laut",
    "T": "Timur",
    "TG": "Tenggara",
    "S": "Selatan",
    "BD": "Barat Daya",
    "B": "Barat",
    "BL": "Barat Laut",
}


def _has_opaque_material_cue(group: Dict[str, Any]) -> bool:
    """Returns True if a group classified as glazing carries opaque material/name cues."""
    transparency = group.get("transparency")
    if transparency is not None:
        try:
            if float(transparency) <= 0.12:
                return True
        except (TypeError, ValueError):
            pass

    mat_str = str(group.get("source_material") or "").strip().lower()
    name_str = str(group.get("group_name") or "").strip().lower()
    layer_str = str(group.get("source_layer") or "").strip().lower()

    # Check source_material first: an explicit opaque material (e.g. "Paint - Cadmium Orange")
    # on a glazing group is always suspicious unless it also says glass/kaca.
    if mat_str and not any(gk in mat_str for gk in _GLASS_NAME_KEYWORDS):
        if any(ok in mat_str for ok in _OPAQUE_MATERIAL_KEYWORDS):
            return True

    combined = f"{name_str} {layer_str}".strip()
    if combined and not any(gk in combined for gk in _GLASS_NAME_KEYWORDS):
        if any(ok in combined for ok in _OPAQUE_MATERIAL_KEYWORDS):
            return True

    return False


def _compute_preview_orientation_areas(
    raw_groups: List[RawGroupMesh],
    cat_overrides: Dict[str, str],
    disabled_set: set,
    z0_cut: float,
    north_angle_deg: float = 0.0,
) -> Dict[str, Dict[str, float]]:
    """
    Fast read-only per-orientation glazing vs opaque area summary (zero raycasting).
    Used by `build_sanity_flags` to detect extreme side WWR (> 95%) during inspection.
    """
    codes = ("U", "TL", "T", "TG", "S", "BD", "B", "BL")
    bins: Dict[str, Dict[str, float]] = {
        c: {"glazing_m2": 0.0, "opaque_m2": 0.0, "total_m2": 0.0} for c in codes
    }
    for rg in raw_groups:
        if rg.group_name in disabled_set:
            continue
        cat = cat_overrides.get(rg.group_name, rg.default_category)
        if cat not in ("glazing", "wall", "spandrel", "composite_cw"):
            continue
        vs = rg.vertices
        fs = rg.faces
        if len(fs) == 0:
            continue
        p0 = vs[fs[:, 0]]
        p1 = vs[fs[:, 1]]
        p2 = vs[fs[:, 2]]
        p3 = vs[fs[:, 3]]
        c1 = np.cross(p1 - p0, p2 - p0)
        c2 = np.cross(p2 - p0, p3 - p0)
        n_vec = c1 + c2
        n_len = np.linalg.norm(n_vec, axis=1)
        valid = n_len > 1e-6
        if not np.any(valid):
            continue
        areas = 0.5 * n_len[valid]
        normals = n_vec[valid] / n_len[valid, None]
        centroids = 0.25 * (p0[valid] + p1[valid] + p2[valid] + p3[valid])

        # Vertical / near-vertical envelope faces above z0
        mask = (np.abs(normals[:, 2]) < 0.50) & (centroids[:, 2] >= z0_cut - 0.05)
        if not np.any(mask):
            continue
        n_m = normals[mask]
        a_m = areas[mask]
        # Azimuth clockwise from +Y (0 = North, 90 = East) minus north_angle_deg
        az = (np.degrees(np.arctan2(n_m[:, 0], n_m[:, 1])) - float(north_angle_deg)) % 360.0
        idx = ((az + 22.5) // 45.0).astype(int) % 8
        for i_bin in range(8):
            sel = idx == i_bin
            if not np.any(sel):
                continue
            a_sum = float(np.sum(a_m[sel]))
            b = bins[codes[i_bin]]
            if cat == "glazing":
                b["glazing_m2"] += a_sum
            elif cat == "composite_cw":
                b["glazing_m2"] += a_sum * 0.65
                b["opaque_m2"] += a_sum * 0.35
            else:
                b["opaque_m2"] += a_sum
            b["total_m2"] += a_sum

    for b in bins.values():
        b["glazing_m2"] = round(b["glazing_m2"], 2)
        b["opaque_m2"] = round(b["opaque_m2"], 2)
        b["total_m2"] = round(b["total_m2"], 2)
        b["wwr"] = round(b["glazing_m2"] / b["total_m2"], 4) if b["total_m2"] > 1e-3 else 0.0
    return bins


def build_sanity_flags(
    groups: List[Dict[str, Any]],
    audit: Union[Dict[str, Any], Any],
    analysis_preview: Optional[Dict[str, Any]] = None,
    user_answers: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Fase 4a (`docs/FASE4_UI_SPEC.md` §7.1): Evaluates sanity checks on inspected
    groups, Stage 1 audit, lightweight preview metrics, and user answers.
    Returns structured flags for the Inspect screen ("Daftar kejanggalan") and
    Konfirmasi gating.
    """
    answers = dict(user_answers or {})
    preview = dict(analysis_preview or {})

    def _audit_get(key: str, default: Any = None) -> Any:
        if isinstance(audit, dict):
            return audit.get(key, default)
        return getattr(audit, key, default)

    flags: List[Dict[str, Any]] = []

    bbox = preview.get("bounding_box") or {}
    span = bbox.get("span") or _audit_get("normalized_span_m") or [0.0, 0.0, 0.0]
    dx = float(span[0]) if len(span) > 0 else 0.0
    dy = float(span[1]) if len(span) > 1 else 0.0
    dz = float(span[2]) if len(span) > 2 else 0.0
    max_dim = max(dx, dy, dz)

    # 1. Dimension out of reasonable building range (< 2 m or > 400 m)
    if max_dim > 0.0 and (max_dim < 2.0 or dz < 2.0 or max_dim > 400.0):
        flags.append({
            "id": "dimension_out_of_range",
            "code": "DIMENSION_OUT_OF_RANGE",
            "severity": "error" if (max_dim < 1.0 or max_dim > 600.0) else "warn",
            "title": "Ukuran bangunan di luar rentang wajar",
            "detail": (
                f"Dimensi terbaca {dx:.1f} × {dy:.1f} × {dz:.1f} m "
                "(wajar antara 2 m sampai 400 m). Periksa satuan file di langkah Konfirmasi."
            ),
            "requires_confirmation": False,
            "accept_makes_provisional": True,
            "actions": ["buka_konfirmasi", "mengerti"],
        })

    # 2. Unit needs confirmation (unit_source == 'bbox_guess')
    unit_needs_conf = bool(_audit_get("unit_needs_confirmation", False)) or (
        str(_audit_get("unit_source", "")) == "bbox_guess"
    )
    if unit_needs_conf and not answers.get("unit_confirmed"):
        flags.append({
            "id": "unit_needs_confirmation",
            "code": "UNIT_NEEDS_CONFIRMATION",
            "severity": "warn",
            "title": "Satuan file tidak tertulis di header",
            "detail": (
                f"Satuan diperkirakan {_audit_get('applied_unit', 'm')} dari ukuran kotak pembatas. "
                "Konfirmasi satuan model di langkah Konfirmasi."
            ),
            "requires_confirmation": True,
            "accept_makes_provisional": True,
            "actions": ["buka_konfirmasi"],
        })

    # 3. Ground level z0 < -0.5 m
    z_offset = float(_audit_get("z_ground_offset_m", 0.0) or 0.0)
    if z_offset < -0.5 and not answers.get("ground_confirmed"):
        flags.append({
            "id": "z0_below_zero",
            "code": "Z0_BELOW_ZERO",
            "severity": "warn",
            "title": f"Model mulai di bawah nol (z = {z_offset:.2f} m)",
            "detail": (
                "Tentukan apakah z = 0 di file adalah muka tanah atau alas model adalah muka tanah "
                "di langkah Konfirmasi."
            ),
            "requires_confirmation": True,
            "accept_makes_provisional": True,
            "actions": ["buka_konfirmasi"],
        })

    # 4. Missing render mesh (e.g. Rhino Brep saved without Shaded mesh)
    missing_mesh = _audit_get("missing_mesh") or []
    if missing_mesh:
        total_missing = 0
        layer_names: List[str] = []
        for item in missing_mesh:
            if isinstance(item, dict):
                total_missing += int(item.get("count", 1) or 1)
                lname = str(item.get("layer") or item.get("group") or item.get("name") or "").strip()
                if lname and lname not in layer_names:
                    layer_names.append(lname)
            else:
                total_missing += 1
        layer_hint = f" (grup: {', '.join(layer_names[:3])})" if layer_names else ""
        flags.append({
            "id": "missing_mesh",
            "code": "MISSING_MESH",
            "severity": "warn",
            "title": f"{total_missing:,} bidang tanpa render mesh".replace(",", "."),
            "detail": (
                f"Objek tanpa render mesh tidak ikut dihitung{layer_hint}. "
                "Di Rhino, ganti tampilan ke Shaded lalu simpan ulang file (jangan SaveSmall)."
            ),
            "requires_confirmation": False,
            "accept_makes_provisional": True,
            "actions": ["lihat_model", "hitung_tanpa_rangka"],
            "meta": {"count": total_missing, "layers": layer_names},
        })

    # 5. Unknown groups
    unknown_groups = [
        g for g in groups
        if g.get("enabled", True) and g.get("category") == "unknown"
    ]
    if unknown_groups:
        u_names = [str(g.get("group_name") or "") for g in unknown_groups]
        flags.append({
            "id": "unknown_groups",
            "code": "UNKNOWN_GROUPS",
            "severity": "warn",
            "title": f"{len(unknown_groups)} grup belum dikenali klasifikasinya",
            "detail": (
                f"Grup {', '.join(u_names[:3])} belum punya klasifikasi pasti. "
                "Pilih Kaca, Dinding, Peneduh, Atap, atau Abaikan pada tabel grup."
            ),
            "requires_confirmation": False,
            "accept_makes_provisional": True,
            "group_names": u_names,
            "actions": ["lihat_model", "mengerti"],
        })

    # 6. Active glazing check (NO_GLAZING)
    active_glazing_groups = [
        g for g in groups
        if g.get("enabled", True)
        and g.get("category") in ("glazing", "composite_cw")
        and (float(g.get("outer_area_m2", 0.0) or 0.0) > 0.0 or int(g.get("face_count", 0) or 0) > 0)
    ]
    has_assumed_wwr = answers.get("default_wall_wwr") is not None
    if not active_glazing_groups and not has_assumed_wwr and answers.get("no_glazing_choice") != "zero_wwr":
        flags.append({
            "id": "no_glazing",
            "code": "NO_GLAZING",
            "severity": "warn",
            "title": "Tidak ada grup kaca yang terdeteksi",
            "detail": (
                "Model tidak memiliki permukaan kaca aktif (WWR 0%). "
                "Konfirmasi apakah bangunan memang tanpa kaca atau isi WWR asumsi."
            ),
            "requires_confirmation": True,
            "accept_makes_provisional": True,
            "actions": ["buka_konfirmasi", "mengerti"],
        })

    # 7. Glazing group carrying an opaque material / name cue
    for g in groups:
        if not g.get("enabled", True):
            continue
        if g.get("category") != "glazing":
            continue
        if _has_opaque_material_cue(g):
            gname = str(g.get("group_name") or "grup")
            mat_label = str(g.get("source_material") or gname)
            flags.append({
                "id": f"glazing_opaque_{g.get('group_id', gname)}",
                "code": "GLAZING_OPAQUE_MATERIAL",
                "severity": "warn",
                "group_id": g.get("group_id"),
                "group_name": gname,
                "title": f"Grup kaca \"{gname}\" memakai material tidak tembus pandang",
                "detail": (
                    f"Material atau nama grup ({mat_label}) terlihat seperti bahan masif. "
                    "Ubah klasifikasinya ke Dinding atau periksa di model."
                ),
                "requires_confirmation": False,
                "accept_makes_provisional": True,
                "actions": ["lihat_model", "ubah_dinding", "mengerti"],
            })

    # 8. Envelope area vs (bbox perimeter x height) ratio < 0.5 or > 1.4
    total_outer_env = sum(
        float(g.get("outer_area_m2", 0.0) or 0.0)
        for g in groups
        if g.get("enabled", True) and g.get("category") in ("glazing", "spandrel", "wall", "composite_cw")
    )
    bbox_perim = 2.0 * (dx + dy)
    ref_shell_area = bbox_perim * dz
    if ref_shell_area > 1.0 and total_outer_env > 0.0:
        area_ratio = total_outer_env / ref_shell_area
        if area_ratio < 0.5 or area_ratio > 1.4:
            flags.append({
                "id": "facade_area_ratio_anomaly",
                "code": "FACADE_AREA_RATIO",
                "severity": "warn",
                "title": "Luas fasad tidak wajar",
                "detail": (
                    f"Luas selubung luar {total_outer_env:.1f} m² adalah {area_ratio:.2f} kali "
                    f"keliling kotak pembatas × tinggi ({ref_shell_area:.1f} m²; wajar 0,50 sampai 1,40). "
                    "Periksa apakah ada sisi dalam ikut terhitung, lapisan ganda, atau model belum lengkap."
                ),
                "requires_confirmation": False,
                "accept_makes_provisional": True,
                "actions": ["lihat_model", "mengerti"],
                "meta": {"ratio": round(area_ratio, 3), "outer_area_m2": round(total_outer_env, 2)},
            })

    # 9. Orientation side WWR > 95%
    orient_areas = preview.get("orientation_areas") or {}
    high_wwr_sides: List[Tuple[str, float]] = []
    for code, metrics in orient_areas.items():
        tot_a = float(metrics.get("total_m2", 0.0) or 0.0)
        wwr_v = float(metrics.get("wwr", 0.0) or 0.0)
        if tot_a > 1.0 and wwr_v > 0.95:
            high_wwr_sides.append((code, wwr_v))
    if high_wwr_sides:
        side_desc = ", ".join(
            f"{_ORIENTATION_LABELS_ID.get(c, c)} ({w * 100:.0f}%)" for c, w in high_wwr_sides
        )
        flags.append({
            "id": "side_wwr_extreme",
            "code": "HIGH_SIDE_WWR",
            "severity": "warn",
            "title": "WWR sisi fasad di atas 95%",
            "detail": (
                f"Rasio kaca pada sisi {side_desc} melebihi 95%. "
                "Periksa apakah panel spandrel atau dinding masif ikut tergolong Kaca."
            ),
            "requires_confirmation": False,
            "accept_makes_provisional": True,
            "actions": ["lihat_model", "mengerti"],
            "meta": {"sides": [{"code": c, "wwr": w} for c, w in high_wwr_sides]},
        })

    # 10. Filtered items with large area (> 5 m2 or > 5% of outer area)
    filtered_items = preview.get("filtered_items")
    if filtered_items is None:
        filtered_items = _audit_get("filtered_items") or []
    filtered_area = sum(
        float(it.get("area_m2", 0.0) or 0.0)
        for it in filtered_items
        if isinstance(it, dict)
    )
    if filtered_area > 5.0 and (total_outer_env <= 0.0 or filtered_area > 0.05 * total_outer_env):
        flags.append({
            "id": "filtered_items_large",
            "code": "FILTERED_ITEMS_LARGE",
            "severity": "info",
            "title": f"{filtered_area:.1f} m² bidang disaring otomatis",
            "detail": (
                "Sebagian bidang dikeluarkan otomatis karena termasuk sisi dalam, sisi tebal panel, "
                "atau di bawah muka tanah."
            ),
            "requires_confirmation": False,
            "accept_makes_provisional": False,
            "actions": ["mengerti"],
            "meta": {"filtered_area_m2": round(filtered_area, 2), "item_count": len(filtered_items)},
        })

    # 11. Floor count mismatch vs user answer (> 20%)
    est_floors = int(preview.get("estimated_floors", 0) or 0)
    exp_floors = answers.get("expected_floors")
    if exp_floors is not None and est_floors > 0:
        try:
            exp_f = int(exp_floors)
            if exp_f > 0 and abs(est_floors - exp_f) / float(exp_f) > 0.20:
                flags.append({
                    "id": "floor_count_mismatch",
                    "code": "FLOOR_COUNT_MISMATCH",
                    "severity": "warn",
                    "title": f"Perkiraan {est_floors} lantai berbeda dari masukanmu ({exp_f} lantai)",
                    "detail": "Periksa satuan file atau elevasi muka tanah di langkah Konfirmasi.",
                    "requires_confirmation": False,
                    "accept_makes_provisional": True,
                    "actions": ["buka_konfirmasi", "mengerti"],
                })
        except (TypeError, ValueError):
            pass

    # 12. No roof info flag
    has_roof = any(g.get("enabled", True) and g.get("category") == "roof" for g in groups)
    if not has_roof:
        flags.append({
            "id": "no_roof",
            "code": "NO_ROOF",
            "severity": "info",
            "title": "Tidak ada atap di model",
            "detail": "RTTV tidak dihitung. Wajar untuk model fasad saja.",
            "requires_confirmation": False,
            "accept_makes_provisional": False,
            "actions": ["mengerti"],
        })

    return flags


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

    # Kotak pembatas gedung: konteks sekitar (jalan, blok kota) tidak ikut, supaya ukuran dan kamera fokus ke gedung
    _bld = [rg for rg in raw_groups if cat_overrides.get(rg.group_name, rg.default_category) != "context"]
    all_v = np.vstack([rg.vertices for rg in (_bld or raw_groups)])
    b_min = np.min(all_v, axis=0)
    b_max = np.max(all_v, axis=0)
    b_center = 0.5 * (b_min + b_max)
    b_span = b_max - b_min

    # Dynamic preview floor count above ground cutoff Z0 (R4 Tiered Detection — never silently guesses 3.6m)
    z0_cut = float(m_cfg.z_ground_cutoff_m or 0.0)
    z_eff_min = max(float(b_min[2]), z0_cut) if z0_cut > 0.05 else float(b_min[2])
    z_eff_max = max(z_eff_min + 0.5, float(b_max[2]))
    s_cfg = getattr(cfg, "settings", None)
    eff_bim_storeys = (
        [
            st
            for st in (audit.bim_storeys or [])
            if float(st.get("z_max", st.get("elevation_m", 0.0) + 3.0)) > (z0_cut + 0.3)
        ]
        if z0_cut > 0.05
        else audit.bim_storeys
    )
    preview_floors, floor_method = build_dynamic_floor_levels(
        z_min_bldg=z_eff_min,
        z_max_bldg=z_eff_max,
        floor_mode=getattr(s_cfg, "floor_mode", "auto") if s_cfg else "auto",
        floor_height_m=getattr(s_cfg, "floor_height_m", None) if s_cfg else None,
        bim_storeys=eff_bim_storeys,
        custom_floor_zones=getattr(s_cfg, "custom_floor_zones", None) if s_cfg else None,
        raw_groups=raw_groups,
        expected_floors=m_cfg.expected_floors,
        disabled_groups=list(disabled_set),
        group_category_overrides=cat_overrides,
    )
    has_glazing_group = any(
        (rg.group_name not in disabled_set)
        and (cat_overrides.get(rg.group_name, rg.default_category) in ("glazing", "composite_cw"))
        for rg in raw_groups
    )
    span_z_eff = max(0.5, z_eff_max - z_eff_min)
    floor_source_label = format_floor_source_label(
        floor_defs=preview_floors,
        method=floor_method,
        span_z_m=span_z_eff,
        has_glazing=has_glazing_group,
    )
    detected_floor_count = None if floor_method == "tidak_terdeteksi" else len(preview_floors)
    detected_floor_height = (
        None
        if floor_method == "tidak_terdeteksi"
        else round(
            sum(float(fl.get("height_m", 0.0)) for fl in preview_floors) / max(1, len(preview_floors)),
            2,
        )
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
        elif conf == "review" and is_enabled and eff_cat not in ("roof", "ignore", "context"):
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

    orientation_preview = _compute_preview_orientation_areas(
        raw_groups=raw_groups,
        cat_overrides=cat_overrides,
        disabled_set=disabled_set,
        z0_cut=z0_cut,
        north_angle_deg=float(getattr(getattr(cfg, "settings", None), "north_angle_deg", 0.0) or 0.0),
    )

    user_answers: Dict[str, Any] = dict(getattr(cfg, "user_answers", None) or {})
    if m_cfg.expected_floors is not None and "expected_floors" not in user_answers:
        user_answers["expected_floors"] = m_cfg.expected_floors
    if m_cfg.model_scope is not None and "model_scope" not in user_answers:
        user_answers["model_scope"] = m_cfg.model_scope
    if getattr(getattr(cfg, "settings", None), "default_wall_wwr", None) is not None:
        user_answers["default_wall_wwr"] = cfg.settings.default_wall_wwr

    bbox_dict = {
        "min": [round(float(x), 2) for x in b_min],
        "max": [round(float(x), 2) for x in b_max],
        "center": [round(float(x), 2) for x in b_center],
        "span": [round(float(x), 2) for x in b_span],
        "max_span": round(max_dim, 2),
    }

    sanity_flags = build_sanity_flags(
        groups=staging_groups,
        audit=audit,
        analysis_preview={
            "bounding_box": bbox_dict,
            "estimated_floors": detected_floor_count,
            "orientation_areas": orientation_preview,
            "filtered_items": all_filtered_items,
        },
        user_answers=user_answers,
    )

    return {
        "status": "inspected",
        "model_id": model_id,
        "filename": display_filename,
        "file_signature": sig,
        "export_tips": tips_info,
        "stage1_audit": {
            "geometry_kernel": audit.geometry_kernel,
            "detected_unit": audit.detected_unit,
            "detected_unit_label": audit.detected_unit if audit.detected_unit is not None else "tidak ada di file",
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
        "bounding_box": bbox_dict,
        "estimated_floors": detected_floor_count,
        "estimated_floor_height_m": detected_floor_height,
        "floor_detection_method": floor_method,
        "floor_source_label": floor_source_label,
        "floor_levels": preview_floors,
        "groups": staging_groups,
        "preview_meshes": preview_meshes,
        "orientation_preview": orientation_preview,
        "sanity_flags": sanity_flags,
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
