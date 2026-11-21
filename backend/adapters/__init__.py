"""
OTTV 3D Parametric Studio v5.0 — Profile-Driven Multi-Software BIM/CAD Adapters
===============================================================================
Implements 5 dedicated specialist ingestion adapters routed by the user's
Pre-Upload Intake Form (`ModelIntakeProfile`), plus:
- Automatic file signature & software mismatch detection (1-click correction hint)
- Automatic `.zip` unpacking for bundled `.obj + .mtl` or `.gltf + .bin` exports
- Fast Phase-A Staging Preview (< 3s, zero solar raycasting) with Pre-Calculation
  Gate Checklist and `.ottv.json` staging configuration persistence.
"""

from __future__ import annotations

import json
import math
import os
import re
import zipfile
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from universal_pipeline import (
    RawGroupMesh,
    Stage1GeometryAudit,
    load_universal_model_stages_1_and_2,
    build_dynamic_floor_levels,
)


# ============================================================================
# 1. SOFTWARE PROFILES REGISTRY (DRIVES PRE-UPLOAD INTAKE FORM)
# ============================================================================

SOFTWARE_PROFILES: Dict[str, Dict[str, Any]] = {
    "archicad": {
        "id": "archicad",
        "name": "Graphisoft Archicad",
        "subtitle": "Archicad 24 – 30 (BIM Curtain Wall & Building)",
        "badge": "BIM Native · OpenCASCADE",
        "supported_formats": [".ifc", ".3dm", ".obj", ".zip", ".glb"],
        "recommended_format": ".ifc",
        "default_up_axis": "Z",
        "default_unit": "auto",
        "adapter_class": "ArchicadAdapter",
        "export_tips": [
            "Format terbaik: IFC2x3 / IFC4 (Coordination View 2.0) — otomatis memisahkan Kaca, Spandrel, Rangka Mullion lewat SurfaceStyle & memotong lubang jendela.",
            "Jika memakai Rhino (.3dm), aktifkan opsi ekspor Surface/Material agar 1 Curtain Wall terpecah otomatis berdasarkan material.",
            "Jika file masih membawa tanah (IfcSite) atau ruang dalam (IsExternal=False), Adapter Archicad akan menyaringnya otomatis.",
        ],
    },
    "revit": {
        "id": "revit",
        "name": "Autodesk Revit",
        "subtitle": "Revit 2021 – 2026 (BIM Architectural Envelope)",
        "badge": "BIM Native · Boolean Openings",
        "supported_formats": [".ifc", ".obj", ".zip", ".glb"],
        "recommended_format": ".ifc",
        "default_up_axis": "Z",
        "default_unit": "auto",
        "adapter_class": "RevitAdapter",
        "export_tips": [
            "Format terbaik: IFC2x3 / IFC4 Reference View — aktifkan 'Export IFC common property sets' agar metadata IsExternal (Dinding Luar vs Partisi Dalam) terbaca.",
            "Lubang jendela pada IfcWall otomatis dipotong oleh kernel OpenCASCADE (tidak akan dihitung ganda).",
            "Koordinat Survey Point / UTM yang jauh dari (0,0) otomatis dipusatkan agar 3D bebas getaran.",
        ],
    },
    "rhino": {
        "id": "rhino",
        "name": "Rhinoceros 3D / Grasshopper",
        "subtitle": "Rhino 7 / 8 (NURBS, Brep, Blocks, Parametric)",
        "badge": "NURBS + Ladybug Tessellation",
        "supported_formats": [".3dm", ".obj", ".zip", ".hbjson"],
        "recommended_format": ".3dm",
        "default_up_axis": "Z",
        "default_unit": "auto",
        "adapter_class": "RhinoAdapter",
        "export_tips": [
            "Format terbaik: .3dm langsung — mendukung NURBS lengkung, SubD, Extrusion, dan nested Block Instances.",
            "Objek/Layer yang sedang dimatikan (Hidden/Off) di Rhino otomatis diabaikan saat impor.",
            "Pisahkan Kaca, Spandrel, dan Rangka di Layer atau Material berbeda (atau gunakan Auto-Split Tier 2 di tahap Inspeksi).",
        ],
    },
    "sketchup_mesh": {
        "id": "sketchup_mesh",
        "name": "SketchUp / Blender / 3ds Max",
        "subtitle": "Polygon Mesh & 3D Warehouse / Sketchfab",
        "badge": "Y-Up + PBR/MTL Glass + Normal Fix",
        "supported_formats": [".glb", ".gltf", ".obj", ".zip", ".ifc", ".stl"],
        "recommended_format": ".glb",
        "default_up_axis": "Y",
        "default_unit": "auto",
        "adapter_class": "SketchUpMeshAdapter",
        "export_tips": [
            "Format terbaik: .glb (semua transformasi komponen & transparansi kaca PBR ikut terbawa) atau .zip berisi (.obj + .mtl).",
            "Adapter otomatis memperbaiki sumbu Y-Up -> Z-Up dan membalik normal 'muka biru' SketchUp yang menghadap ke dalam.",
            "Jika seluruh bangunan menyatu di 1 grup, gunakan fitur Auto-Split atau Seleksi per Bidang / Lantai langsung di Preview 3D Inspeksi.",
        ],
    },
    "honeybee_generic": {
        "id": "honeybee_generic",
        "name": "Ladybug / Honeybee / Lainnya",
        "subtitle": "HBJSON Thermal Model, Allplan, Vectorworks, Tekla",
        "badge": "Universal Open-Format",
        "supported_formats": [".hbjson", ".json", ".ifc", ".3dm", ".obj", ".zip", ".glb", ".stl", ".ply"],
        "recommended_format": ".hbjson",
        "default_up_axis": "auto",
        "default_unit": "auto",
        "adapter_class": "HoneybeeGenericAdapter",
        "export_tips": [
            "Mendukung file .hbjson (Ladybug/Pollination) dengan Aperture & Outdoor Shade terpisah secara eksak.",
            "Juga cocok untuk ekspor IFC4/IFC4.3 dari Allplan, Vectorworks, Tekla, atau BricsCAD.",
        ],
    },
}


# ============================================================================
# 2. PRE-UPLOAD MODEL INTAKE PROFILE DATACLASS
# ============================================================================

@dataclass
class ModelIntakeProfile:
    """User's Pre-Upload Intake Form criteria that routes & configures the specialist Adapter."""
    source_software: str = "archicad"          # 'archicad' | 'revit' | 'rhino' | 'sketchup_mesh' | 'honeybee_generic'
    expected_format: str = ".ifc"              # '.ifc' | '.3dm' | '.obj' | '.zip' | '.glb' | '.hbjson'
    geometry_scope: str = "facade_only"        # 'facade_only' | 'full_building' | 'site_context_basement'
    element_structure: str = "separated"       # 'separated' | 'merged_single_layer'
    unit_mode: str = "auto"                    # 'auto' | 'mm' | 'cm' | 'm' | 'ft' | 'in'
    massing_type: str = "complex_nonconvex"    # 'single_tower' | 'complex_nonconvex' | 'single_facade'
    up_axis: str = "auto"                      # 'auto' | 'Z' | 'Y'
    z_ground_cutoff_m: float = 0.0             # Ground-plane Z cutoff (excludes basement levels below Z0)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ModelIntakeProfile":
        valid = {k: d[k] for k in cls.__dataclass_fields__.keys() if k in d and d[k] is not None}
        return cls(**valid)


# ============================================================================
# 3. ZIP UNPACKER (.obj + .mtl / .gltf + .bin) & FILE SIGNATURE DETECTOR
# ============================================================================

SUPPORTED_MODEL_EXTS = (".ifc", ".3dm", ".obj", ".glb", ".gltf", ".hbjson", ".json", ".stl", ".ply")


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
            # Prevent path traversal
            safe_rel = os.path.normpath(member.filename).lstrip("\\/")
            if safe_rel.startswith("..") or os.path.isabs(safe_rel):
                continue
            dest = os.path.join(extract_dir, safe_rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(member) as src, open(dest, "wb") as dst:
                dst.write(src.read())
            extracted_files.append(dest)

    # Pick highest-priority 3D model file inside the bundle
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
    for automatic Mismatch Protection in the Staging Inspection screen.
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
            elif "allplan" in head_lo or "vectorworks" in head_lo or "tekla" in head_lo or "buildingsmart" in head_lo:
                sig["detected_software"] = "honeybee_generic"
                sig["detected_software_label"] = f"OpenBIM ({sig['schema_or_version'] or 'IFC'})"
        elif ext == ".3dm":
            sig["detected_software"] = "rhino"
            sig["detected_software_label"] = "Rhinoceros 3D (.3dm)"
            # Check if ArchiCAD exported this .3dm (ArchiCAD writes 'Finish - Wall' / 'Archicad' strings)
            with open(filepath, "rb") as f:
                raw_chunk = f.read(65536).decode("latin-1", errors="ignore").lower()
            if "archicad" in raw_chunk or "graphisoft" in raw_chunk:
                sig["detected_software"] = "archicad"
                sig["detected_software_label"] = "Graphisoft Archicad (Ekspor .3dm)"
        elif ext in (".glb", ".gltf"):
            sig["detected_software"] = "sketchup_mesh"
            sig["detected_software_label"] = "Mesh GLB/GLTF (SketchUp / Blender / 3D)"
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
    except Exception:
        pass
    return sig


# ============================================================================
# 4. DEDICATED SPECIALIST SOFTWARE ADAPTERS
# ============================================================================

class BaseSoftwareAdapter:
    software_id: str = "honeybee_generic"

    def resolve_effective_settings(self, profile: ModelIntakeProfile, actual_ext: str) -> Dict[str, Any]:
        """Translates user's Pre-Upload Intake Profile into specialist engine settings."""
        up_axis = profile.up_axis
        if up_axis == "auto":
            if actual_ext in (".glb", ".gltf"):
                up_axis = "Y"
            elif actual_ext == ".obj":
                # Let universal_pipeline's smart OBJ header + geometric Up-Axis detector decide
                up_axis = "auto"
            else:
                up_axis = SOFTWARE_PROFILES.get(self.software_id, {}).get("default_up_axis", "Z")

        if profile.massing_type == "single_tower" and profile.geometry_scope == "facade_only":
            ext_mode = "radial"
        else:
            ext_mode = "auto"  # 3-Layer Watertight Raycast + BIM IsExternal

        auto_split = profile.element_structure == "merged_single_layer"
        return {
            "unit_mode": profile.unit_mode or "auto",
            "up_axis": up_axis,
            "exterior_detection_mode": ext_mode,
            "auto_split_merged_cw": auto_split,
        }

    def post_process_groups(
        self,
        raw_groups: List[RawGroupMesh],
        audit: Stage1GeometryAudit,
        profile: ModelIntakeProfile,
    ) -> Tuple[List[RawGroupMesh], List[str]]:
        return raw_groups, []


class ArchicadAdapter(BaseSoftwareAdapter):
    software_id = "archicad"

    def post_process_groups(
        self,
        raw_groups: List[RawGroupMesh],
        audit: Stage1GeometryAudit,
        profile: ModelIntakeProfile,
    ) -> Tuple[List[RawGroupMesh], List[str]]:
        notes = [f"Adapter Archicad aktif ({audit.geometry_kernel}): pemisahan SurfaceStyle + filter tepi 2cm + IfcSite."]
        if profile.geometry_scope == "full_building" and audit.interior_elements_filtered > 0:
            notes.append(f"Mode Gedung Penuh: {audit.interior_elements_filtered} elemen interior otomatis ditandai Non-OTTV.")
        return raw_groups, notes


class RevitAdapter(BaseSoftwareAdapter):
    software_id = "revit"

    def post_process_groups(
        self,
        raw_groups: List[RawGroupMesh],
        audit: Stage1GeometryAudit,
        profile: ModelIntakeProfile,
    ) -> Tuple[List[RawGroupMesh], List[str]]:
        notes = [f"Adapter Revit aktif ({audit.geometry_kernel}): Boolean Opening jendela + filter IsExternal + XY Survey recenter."]
        return raw_groups, notes


class RhinoAdapter(BaseSoftwareAdapter):
    software_id = "rhino"

    def post_process_groups(
        self,
        raw_groups: List[RawGroupMesh],
        audit: Stage1GeometryAudit,
        profile: ModelIntakeProfile,
    ) -> Tuple[List[RawGroupMesh], List[str]]:
        notes = [f"Adapter Rhino/GH aktif ({audit.geometry_kernel}): NURBS tessellation + ekspansi Block + abaikan hidden layer."]
        return raw_groups, notes


class SketchUpMeshAdapter(BaseSoftwareAdapter):
    software_id = "sketchup_mesh"

    def resolve_effective_settings(self, profile: ModelIntakeProfile, actual_ext: str) -> Dict[str, Any]:
        cfg = super().resolve_effective_settings(profile, actual_ext)
        if profile.up_axis == "auto" and actual_ext in (".glb", ".gltf"):
            cfg["up_axis"] = "Y"
        return cfg

    def post_process_groups(
        self,
        raw_groups: List[RawGroupMesh],
        audit: Stage1GeometryAudit,
        profile: ModelIntakeProfile,
    ) -> Tuple[List[RawGroupMesh], List[str]]:
        notes = [f"Adapter SketchUp/Mesh aktif ({audit.geometry_kernel}): sumbu {audit.applied_up_axis}-Up + PBR/MTL transparansi + perbaikan normal."]
        return raw_groups, notes


class HoneybeeGenericAdapter(BaseSoftwareAdapter):
    software_id = "honeybee_generic"

    def post_process_groups(
        self,
        raw_groups: List[RawGroupMesh],
        audit: Stage1GeometryAudit,
        profile: ModelIntakeProfile,
    ) -> Tuple[List[RawGroupMesh], List[str]]:
        notes = [f"Adapter Universal/Honeybee aktif ({audit.geometry_kernel})."]
        return raw_groups, notes


ADAPTER_REGISTRY: Dict[str, BaseSoftwareAdapter] = {
    "archicad": ArchicadAdapter(),
    "revit": RevitAdapter(),
    "rhino": RhinoAdapter(),
    "sketchup_mesh": SketchUpMeshAdapter(),
    "honeybee_generic": HoneybeeGenericAdapter(),
}


def get_adapter_for_software(source_software: str) -> BaseSoftwareAdapter:
    return ADAPTER_REGISTRY.get((source_software or "archicad").lower(), HoneybeeGenericAdapter())


# ============================================================================
# 5. PHASE A: FAST 3D STAGING INSPECTION PAYLOAD BUILDER (< 3 SECONDS)
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
    from universal_pipeline import classify_layer_or_material_with_confidence
    _, score, reason = classify_layer_or_material_with_confidence(rg.group_name)
    if score >= 0.80:
        return "high", reason
    return "review", "Nama grup generik/ambigu — mohon verifikasi peran di 3D"


def build_staging_inspection_payload(
    filepath: str,
    display_filename: str,
    model_id: str,
    profile: ModelIntakeProfile,
    group_category_overrides: Optional[Dict[str, str]] = None,
    disabled_groups: Optional[List[str]] = None,
    groups_to_auto_split: Optional[List[str]] = None,
    group_wwr_map: Optional[Dict[str, float]] = None,
    frame_width_threshold_m: float = 0.28,
    spandrel_height_threshold_m: float = 1.15,
    face_category_overrides: Optional[Dict[str, str]] = None,
    auto_split_merged_cw: Optional[bool] = None,
    restore_filtered: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Phase A (Fast Staging & 3D Inspection):
    Runs ONLY the chosen specialist Adapter + Stage 1/2 normalization (ZERO solar raycasting!)
    and returns a lightweight interactive 3D inspection scene, per-group summary with confidence
    badges, mismatch warnings, and Pre-Calculation Gate Checklist.
    """
    adapter = get_adapter_for_software(profile.source_software)
    sig = detect_file_signature(filepath)
    eff_cfg = adapter.resolve_effective_settings(profile, sig["actual_ext"])
    if auto_split_merged_cw is not None:
        eff_cfg["auto_split_merged_cw"] = bool(auto_split_merged_cw)

    raw_groups, audit = load_universal_model_stages_1_and_2(
        filepath=filepath,
        unit_mode=eff_cfg["unit_mode"],
        up_axis=eff_cfg["up_axis"],
        auto_split_merged_cw=eff_cfg["auto_split_merged_cw"],
        groups_to_auto_split=groups_to_auto_split or [],
        frame_width_threshold_m=frame_width_threshold_m,
        spandrel_height_threshold_m=spandrel_height_threshold_m,
        restore_filtered=restore_filtered,
    )
    raw_groups, adapter_notes = adapter.post_process_groups(raw_groups, audit, profile)

    cat_overrides = group_category_overrides or {}
    disabled_set = set(disabled_groups or [])
    wwr_map = group_wwr_map or {}
    face_ov = face_category_overrides or {}

    # Detect software mismatch (e.g. user chose Revit but file header says Archicad)
    mismatch_warning: Optional[Dict[str, Any]] = None
    det_sw = sig.get("detected_software")
    if det_sw and det_sw != profile.source_software and profile.source_software != "honeybee_generic":
        # Allow Archicad .3dm when user chose archicad
        if not (profile.source_software == "archicad" and det_sw == "rhino" and sig["actual_ext"] == ".3dm"):
            rec_prof = SOFTWARE_PROFILES.get(det_sw, {})
            mismatch_warning = {
                "detected_software": det_sw,
                "detected_label": sig.get("detected_software_label", det_sw),
                "selected_software": profile.source_software,
                "message": f"Header file terdeteksi berasal dari {sig.get('detected_software_label')} (bukan {SOFTWARE_PROFILES.get(profile.source_software, {}).get('name', profile.source_software)}).",
                "recommended_software": det_sw,
                "recommended_name": rec_prof.get("name", det_sw),
            }

    # Global bounding box across all groups
    all_v = np.vstack([rg.vertices for rg in raw_groups])
    b_min = np.min(all_v, axis=0)
    b_max = np.max(all_v, axis=0)
    b_center = 0.5 * (b_min + b_max)
    b_span = b_max - b_min

    # Dynamic preview floor count above ground cutoff Z0
    z0_cut = float(profile.z_ground_cutoff_m or 0.0)
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

        # Compute exact raw area & Z range for staging table
        vs = rg.vertices
        fs = rg.faces
        is_q = fs[:, 2] != fs[:, 3]
        p0, p1, p2, p3 = vs[fs[:, 0]], vs[fs[:, 1]], vs[fs[:, 2]], vs[fs[:, 3]]
        c1 = np.cross(p1 - p0, p2 - p0)
        c2 = np.where(is_q[:, None], np.cross(p2 - p0, p3 - p0), 0.0)
        areas = 0.5 * np.linalg.norm(c1 + c2, axis=1)
        g_zmin = float(np.min(vs[:, 2]))
        g_zmax = float(np.max(vs[:, 2]))

        # Approximate above-ground area (for double-skinned solids divide by 2 for preview indicator)
        centroids_z = np.where(is_q, 0.25 * (p0[:, 2] + p1[:, 2] + p2[:, 2] + p3[:, 2]), (p0[:, 2] + p1[:, 2] + p2[:, 2]) / 3.0)
        above_z_mask = centroids_z >= (z0_cut - 0.05)
        raw_area_above = float(np.sum(areas[above_z_mask]))

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
            "raw_area_m2": round(raw_area_above, 1),
            "z_range_m": [round(g_zmin, 2), round(g_zmax, 2)],
        })

        # Serialize lightweight preview mesh for instant 60-FPS 3D Staging Viewport
        # Cap visual display triangles per group ONLY for the staging viewport (never affects Phase B area!)
        max_prev_faces = 7000
        stride = max(1, int(math.ceil(len(fs) / max_prev_faces))) if len(fs) > max_prev_faces else 1
        fs_vis = fs[::stride]
        # Compact vertices referenced by fs_vis
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

    # Pre-Calculation Gate Checklist (4 crisp verification checks before unlocking OTTV)
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
            "hint": "" if dims_sane else "Dimensi terlihat terlalu kecil/besar — ubah Satuan Model (mm/cm/m) di panel kiri.",
        },
        {
            "id": "z0_check",
            "label": f"Elevasi Muka Tanah Z0 ({z0_cut:.1f} m) & Estimasi {len(preview_floors)} Lantai di Atas Tanah",
            "passed": z0_valid,
            "severity": "ok" if z0_valid else "error",
            "hint": "" if z0_valid else "Batas Z0 melebihi puncak bangunan — turunkan slider Z0.",
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
                else f"{review_needed_count} Grup Generik Disarankan Ditinjau Perannya di 3D"
            ),
            "passed": review_needed_count == 0,
            "severity": "ok" if review_needed_count == 0 else "warn",
            "hint": "Klik grup kuning di 3D atau ubah perannya di tabel sebelah kanan." if review_needed_count > 0 else "",
        },
    ]

    can_commit = dims_sane and z0_valid and has_envelope

    return {
        "status": "staged",
        "model_id": model_id,
        "filename": display_filename,
        "profile": profile.to_dict(),
        "effective_settings": eff_cfg,
        "file_signature": sig,
        "mismatch_warning": mismatch_warning,
        "adapter_notes": adapter_notes,
        "stage1_audit": {
            "geometry_kernel": audit.geometry_kernel,
            "detected_unit": audit.detected_unit,
            "applied_unit": audit.applied_unit,
            "scale_factor_to_m": audit.scale_factor_to_m,
            "detected_up_axis": audit.detected_up_axis,
            "applied_up_axis": audit.applied_up_axis,
            "normalized_span_m": audit.normalized_span_m,
            "z_ground_offset_m": audit.z_ground_offset_m,
            "xy_world_offset_m": audit.xy_world_offset_m,
            "slivers_removed": audit.slivers_removed,
            "interior_elements_filtered": audit.interior_elements_filtered,
            "hidden_objects_skipped": audit.hidden_objects_skipped,
            "missing_mesh": audit.missing_mesh,
            "filtered_items": audit.filtered_items,
            "bim_storeys_count": len(audit.bim_storeys),
            "notes": audit.notes,
        },
        "filtered_items": audit.filtered_items,
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
        "gate_checklist": checklist,
        "can_commit": can_commit,
    }


# ============================================================================
# 6. AUTO-SAVE / LOAD STAGING CONFIG PER MODEL (.ottv.json)
# ============================================================================

def get_staging_config_path(uploads_dir: str, model_id: str) -> str:
    cfg_dir = os.path.join(uploads_dir, ".staging_configs")
    os.makedirs(cfg_dir, exist_ok=True)
    safe_id = re.sub(r"[^a-zA-Z0-9._-]+", "_", model_id).strip("_") or "model"
    return os.path.join(cfg_dir, f"{safe_id}.ottv.json")


def save_staging_config(uploads_dir: str, model_id: str, config_dict: Dict[str, Any]) -> str:
    path = get_staging_config_path(uploads_dir, model_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config_dict, f, indent=2, ensure_ascii=False)
    return path


def load_staging_config(uploads_dir: str, model_id: str) -> Optional[Dict[str, Any]]:
    path = get_staging_config_path(uploads_dir, model_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None
