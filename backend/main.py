"""
OTTV 3D Parametric Studio v3.0 — Universal 5-Stage Gatekeeper FastAPI Backend (SNI 6389:2020)
=============================================================================================
Provides REST endpoints for:
- Dynamic Model Catalog (persisting multiple user-uploaded .3dm, .obj, .ifc, .glb, .gltf,
  .hbjson, .stl, .ply models alongside reference presets)
- Stage 1: Universal Geometry, Unit (auto/m/cm/mm/ft/in) & Axis (auto/Z/Y) Normalization
- Stage 2: 3-Tier Sub-Element Decomposer (Layer::Material + Geometric Auto-Splitter for
  merged BIM Curtain Walls + Composite WWR Ratio Mode) & 6-Role SNI Classification
- Stage 3: Model-Driven Dynamic Floor Detection (Auto BIM/Slab/Z-Cluster, Uniform, Custom Zones)
- Stage 4: Layer-Bound Material Assignment, Orientation Overrides & Indonesian Brand Optimizer
- Stage 5: Official PUPR Building Envelope Compliance Form v2.0 (.xlsx) Report Generator.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from adapters import (
    SOFTWARE_PROFILES,
    ModelIntakeProfile,
    build_staging_inspection_payload,
    get_adapter_for_software,
    load_staging_config,
    save_staging_config,
    unpack_zip_bundle_if_needed,
)

from materials_and_epw import (
    INDONESIAN_CITY_PRESETS,
    add_custom_material,
    generate_sample_epw_file,
    get_all_materials,
    parse_epw_content,
)
from ottv_engine import (
    ORIENTATION_BASE_SF,
    ORIENTATION_NAMES,
    SNI_6389_LIMIT_WM2,
    SNI_SF_ANCHORS,
    EnvelopeParameters,
    analyze_building_ottv,
    create_sample_hbjson_preset,
    create_sample_ifc_preset,
    create_sample_obj_preset,
    create_sample_rhino_3dm_preset,
)
from report_exporter import (
    generate_csv_report,
    generate_excel_report,
    generate_pdf_report,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLES_DIR = os.path.join(BASE_DIR, "samples")
BENCHMARK_SAMPLES_DIR = os.path.join(SAMPLES_DIR, "benchmark_library")
LAST_UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
EPW_DIR = os.path.join(BASE_DIR, "epw_samples")
os.makedirs(SAMPLES_DIR, exist_ok=True)
os.makedirs(BENCHMARK_SAMPLES_DIR, exist_ok=True)
os.makedirs(LAST_UPLOAD_DIR, exist_ok=True)
os.makedirs(EPW_DIR, exist_ok=True)

ALLOWED_3D_EXTENSIONS = (".3dm", ".obj", ".ifc", ".glb", ".gltf", ".hbjson", ".json", ".stl", ".ply", ".zip")

PRESET_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    # --- FORMAT: .IFC (BIM Native — Archicad / Revit / buildingSMART / IFC4X3) ---
    "archicad_bim_ifc": {
        "id": "archicad_bim_ifc",
        "title": "ArchiCAD BIM Curtain Wall + Podium (6 Lantai Variatif)",
        "filename": "archicad_bim_curtainwall.ifc",
        "format": "IFC",
        "source_software": "archicad",
        "is_uploaded": False,
        "description": "Model BIM IFC2x3 dengan 6 IFCBUILDINGSTOREY (Lobby 4.8m, Podium 4.2m, Tipikal 3.6m), IFCPLATE, IFCMEMBER & IFCSHADINGDEVICE.",
    },
    "bench_ac20_fzk_haus": {
        "id": "bench_ac20_fzk_haus",
        "title": "AC20 FZK-Haus — Rumah 2 Lantai Full BIM + Interior",
        "filename": "AC20_FZK_Haus.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "archicad",
        "is_uploaded": False,
        "description": "Sampel standar IFC4 STEPtools/Archicad (13×11×6.5m, 2 lantai) dengan elemen interior yang disaring otomatis.",
    },
    "bench_ac20_institute_var2": {
        "id": "bench_ac20_institute_var2",
        "title": "AC20 Institute Var-2 — Gedung Kampus 5 Lantai (10.3 MB)",
        "filename": "AC20_Institute_Var2.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "archicad",
        "is_uploaded": False,
        "description": "Gedung pendidikan IFC4 5 lantai (44×19×15.4m, 1.428 m²) lengkap dengan bukaan jendela & struktur interior.",
    },
    "bench_klassiqua_2026": {
        "id": "bench_klassiqua_2026",
        "title": "Klassiqua Office 2026 — Kantor IFC4X3 (4 Lantai)",
        "filename": "Klassiqua_Office_2026_IFC4x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Arketipe gedung kantor modern IFC4.3 (29×15×15m, WWR 63.9%, 1.927 m²).",
    },
    "bench_klassiqua_1998": {
        "id": "bench_klassiqua_1998",
        "title": "Klassiqua Office 1998 — Kantor IFC4X3 (4 Lantai)",
        "filename": "Klassiqua_Office_1998_IFC4x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Arketipe kantor era 1998 IFC4.3 (28.7×15×14.9m, WWR 69.5%, 1.722 m²).",
    },
    "bench_klassiqua_1970": {
        "id": "bench_klassiqua_1970",
        "title": "Klassiqua Office 1970 — Kantor IFC4X3 (4 Lantai)",
        "filename": "Klassiqua_Office_1970_IFC4x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Arketipe kantor era 1970 IFC4.3 (28.6×14.9×14.9m, WWR 48.0%).",
    },
    "bench_iso_wall_window": {
        "id": "bench_iso_wall_window",
        "title": "ISO ReferenceView — Dinding + Lubang Boolean Jendela (IFC4)",
        "filename": "ISO_ReferenceView_Wall_Window_IFC4.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "revit",
        "is_uploaded": False,
        "description": "Sampel sertifikasi buildingSMART IFC4 untuk verifikasi pemotongan IfcOpeningElement pada dinding & jendela.",
    },
    "bench_bsi_arch_ifc2x3": {
        "id": "bench_bsi_arch_ifc2x3",
        "title": "buildingSMART Simple Architecture (IFC2x3 — 2 Lantai)",
        "filename": "bSI_Simple_Architecture_IFC2x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "revit",
        "is_uploaded": False,
        "description": "Dataset sertifikasi buildingSMART IFC2x3 TC1 (6.2×6.6×6.3m, 2 lantai).",
    },
    "bench_bsi_arch_ifc4": {
        "id": "bench_bsi_arch_ifc4",
        "title": "buildingSMART Simple Architecture (IFC4 — 2 Lantai)",
        "filename": "bSI_Simple_Architecture_IFC4.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "revit",
        "is_uploaded": False,
        "description": "Dataset sertifikasi buildingSMART IFC4 ADD2 TC1 (6.2×6.6×6.3m, 2 lantai).",
    },
    "bench_bsi_arch_ifc43": {
        "id": "bench_bsi_arch_ifc43",
        "title": "buildingSMART Simple Architecture (IFC4.3)",
        "filename": "bSI_Simple_Architecture_IFC4x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Dataset sertifikasi buildingSMART IFC4.3 ADD2.",
    },
    # --- FORMAT: .3DM (Rhino 7 / 8 NURBS & Curtain Wall) ---
    "fasad_curtain_wall_baru": {
        "id": "fasad_curtain_wall_baru",
        "title": "Fasad_Curtain_Wall_Baru.3dm — Tower Curtain Wall (24 Lantai)",
        "filename": "Fasad_Curtain_Wall_Baru.3dm",
        "format": "3DM",
        "source_software": "rhino",
        "is_uploaded": False,
        "description": "Model Tower Curtain Wall 24 lantai dengan Spandrel, Vision Glass, Crown Glass, Mullion, Transom, & SkyGarden Fins.",
    },
    "rhino_nurbs_tower": {
        "id": "rhino_nurbs_tower",
        "title": "Menara NURBS Nusantara — Fasad Lengkung (5 Lantai)",
        "filename": "nusantara_nurbs_tower.3dm",
        "format": "3DM",
        "source_software": "rhino",
        "is_uploaded": False,
        "description": "Menara organik 5-tier dengan fasad lengkung NURBS, Low-E Curtain Wall, dan kisi peneduh kinetik.",
    },
    # --- FORMAT: .OBJ (Wavefront Multi-Material) ---
    "bioclimatic_office_obj": {
        "id": "bioclimatic_office_obj",
        "title": "Kantor Bioklimatik Oktagonal — 8 Orientasi (4 Lantai)",
        "filename": "bioclimatic_office.obj",
        "format": "OBJ",
        "source_software": "sketchup_mesh",
        "is_uploaded": False,
        "description": "Gedung kantor 4 lantai 8 orientasi penuh dengan spandrel komposit dan kanopi louver.",
    },
    # --- FORMAT: .GLB (glTF 2.0 PBR Mesh) ---
    "bench_khronos_glass_glb": {
        "id": "bench_khronos_glass_glb",
        "title": "Khronos PBR Transmission Glass Sample (.glb)",
        "filename": "Khronos_Glass_Transmission.glb",
        "subdir": "benchmark_library",
        "format": "GLB",
        "source_software": "sketchup_mesh",
        "is_uploaded": False,
        "description": "Sampel resmi Khronos glTF 2.0 untuk pengujian transparansi material kaca PBR & transformasi SceneGraph.",
    },
    "bench_khronos_box_glb": {
        "id": "bench_khronos_box_glb",
        "title": "Khronos Textured Unit Mass (.glb)",
        "filename": "Khronos_Textured_Box.glb",
        "subdir": "benchmark_library",
        "format": "GLB",
        "source_software": "sketchup_mesh",
        "is_uploaded": False,
        "description": "Sampel standar Khronos glTF 2.0 untuk pengujian sumbu Y-Up -> Z-Up dan normal luar.",
    },
    # --- FORMAT: .HBJSON (Ladybug / Honeybee Thermal Models) ---
    "honeybee_zone_hbjson": {
        "id": "honeybee_zone_hbjson",
        "title": "Model Termal SNI 6389 Honeybee (3 Lantai)",
        "filename": "sni6389_thermal_model.hbjson",
        "format": "HBJSON",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Model energi Honeybee JSON dengan definisi Face, Aperture kaca, dan Outdoor Shades.",
    },
    "bench_hb_multizone_office": {
        "id": "bench_hb_multizone_office",
        "title": "Honeybee Multi-Zone Office — Ladybug Official (3 Lantai)",
        "filename": "Honeybee_MultiZone_Office_3F.hbjson",
        "subdir": "benchmark_library",
        "format": "HBJSON",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Sampel resmi Ladybug Tools (10×10×9m, 3 lantai, 240 m², WWR 20%).",
    },
    "bench_hb_office_floor": {
        "id": "bench_hb_office_floor",
        "title": "Honeybee Large Office Floor — 30×30m (1 Lantai)",
        "filename": "Honeybee_Office_Floor_30x30m.hbjson",
        "subdir": "benchmark_library",
        "format": "HBJSON",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Lantai kantor tipikal 30×30×3m dari Ladybug Tools (360 m², WWR 35%).",
    },
    "bench_hb_single_family": {
        "id": "bench_hb_single_family",
        "title": "Honeybee Single-Family Home — Hunian (1 Lantai)",
        "filename": "Honeybee_Single_Family_Home.hbjson",
        "subdir": "benchmark_library",
        "format": "HBJSON",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Sampel rumah tinggal resmi Ladybug Tools (6.7×15.2×4m, 90 m²).",
    },
    "bench_hb_patient_room": {
        "id": "bench_hb_patient_room",
        "title": "Honeybee Hospital Patient Room — Ruang Rawat (1 Lantai)",
        "filename": "Honeybee_Patient_Room.hbjson",
        "subdir": "benchmark_library",
        "format": "HBJSON",
        "source_software": "honeybee_generic",
        "is_uploaded": False,
        "description": "Sampel ruang rawat rumah sakit resmi Ladybug Tools (5×10.5×3m, 90 m²).",
    },
}

# Store latest custom EPW & latest analysis result for instant report downloads
ACTIVE_CUSTOM_EPW: Optional[Dict[str, Any]] = None
LAST_ANALYSIS_CACHE: Optional[Dict[str, Any]] = None


def _slugify_filename(filename: str) -> str:
    """Collision-free deterministic model_id (e.g. 'Foo bar.ifc' != 'Foo_bar.ifc')."""
    clean = filename.strip()
    slug = re.sub(r"[^a-zA-Z0-9_.-]+", "_", clean)
    h6 = hashlib.sha1(clean.encode("utf-8")).hexdigest()[:6]
    return f"upload_{slug}_{h6}"


def ensure_sample_files() -> Dict[str, str]:
    paths: Dict[str, str] = {}

    p_cw = os.path.join(SAMPLES_DIR, PRESET_DEFINITIONS["fasad_curtain_wall_baru"]["filename"])
    if os.path.exists(p_cw):
        paths["fasad_curtain_wall_baru"] = p_cw

    p_ifc = os.path.join(SAMPLES_DIR, PRESET_DEFINITIONS["archicad_bim_ifc"]["filename"])
    if not os.path.exists(p_ifc):
        create_sample_ifc_preset(p_ifc)
    paths["archicad_bim_ifc"] = p_ifc

    p_3dm = os.path.join(SAMPLES_DIR, PRESET_DEFINITIONS["rhino_nurbs_tower"]["filename"])
    if not os.path.exists(p_3dm):
        create_sample_rhino_3dm_preset(p_3dm)
    paths["rhino_nurbs_tower"] = p_3dm
    if "fasad_curtain_wall_baru" not in paths:
        paths["fasad_curtain_wall_baru"] = p_3dm

    p_obj = os.path.join(SAMPLES_DIR, PRESET_DEFINITIONS["bioclimatic_office_obj"]["filename"])
    if not os.path.exists(p_obj):
        create_sample_obj_preset(p_obj)
    paths["bioclimatic_office_obj"] = p_obj

    p_hb = os.path.join(SAMPLES_DIR, PRESET_DEFINITIONS["honeybee_zone_hbjson"]["filename"])
    if not os.path.exists(p_hb):
        create_sample_hbjson_preset(p_hb)
    paths["honeybee_zone_hbjson"] = p_hb

    # Include all verified real benchmark/training library samples
    for pid, pdef in PRESET_DEFINITIONS.items():
        if pid in paths:
            continue
        subdir = pdef.get("subdir")
        cand = os.path.join(SAMPLES_DIR, subdir, pdef["filename"]) if subdir else os.path.join(SAMPLES_DIR, pdef["filename"])
        if os.path.isfile(cand):
            paths[pid] = cand

    return paths


def get_dynamic_model_catalog() -> Tuple[List[Dict[str, Any]], Dict[str, Tuple[str, str]]]:
    """
    Returns `(catalog_list, id_to_path_and_filename_map)` combining all user-uploaded
    models in `LAST_UPLOAD_DIR` and built-in reference presets.
    """
    sample_paths = ensure_sample_files()
    catalog: List[Dict[str, Any]] = []
    path_map: Dict[str, Tuple[str, str]] = {}

    # 1. Scan user-uploaded models in `uploads/` sorted newest-first
    if os.path.isdir(LAST_UPLOAD_DIR):
        up_files = []
        for fname in os.listdir(LAST_UPLOAD_DIR):
            ext = os.path.splitext(fname.lower())[1]
            if ext in ALLOWED_3D_EXTENSIONS:
                fpath = os.path.join(LAST_UPLOAD_DIR, fname)
                if os.path.isfile(fpath):
                    up_files.append((os.path.getmtime(fpath), fname, fpath, ext))
        up_files.sort(key=lambda x: x[0], reverse=True)

        for idx, (_, fname, fpath, ext) in enumerate(up_files):
            model_id = _slugify_filename(fname)
            size_mb = round(os.path.getsize(fpath) / (1024.0 * 1024.0), 2)
            fmt = ext.lstrip(".").upper()
            resolved_path = fpath
            resolved_name = fname
            if ext == ".zip":
                try:
                    resolved_path, resolved_name, _ = unpack_zip_bundle_if_needed(fpath, LAST_UPLOAD_DIR)
                    fmt = f"ZIP→{os.path.splitext(resolved_name)[1].lstrip('.').upper()}"
                except Exception:
                    continue
            entry = {
                "id": model_id,
                "title": f"[Unggahan] {fname} ({fmt} · {size_mb} MB)",
                "filename": resolved_name,
                "format": fmt,
                "size_mb": size_mb,
                "is_uploaded": True,
                "has_staging_config": load_staging_config(LAST_UPLOAD_DIR, model_id) is not None,
                "description": f"Model kustom yang diunggah pengguna ({fname}).",
            }
            catalog.append(entry)
            if model_id not in path_map:
                path_map[model_id] = (resolved_path, resolved_name)
            if idx == 0:
                # Backward-compatible alias for `last_upload`
                path_map["last_upload"] = (resolved_path, resolved_name)

    # 2. Add reference & training benchmark presets (with file size metadata)
    for pid, pdef in PRESET_DEFINITIONS.items():
        if pid in sample_paths:
            spath = sample_paths[pid]
            item = dict(pdef)
            if os.path.isfile(spath):
                item["size_mb"] = round(os.path.getsize(spath) / (1024.0 * 1024.0), 2)
            catalog.append(item)
            path_map[pid] = (spath, pdef["filename"])

    return catalog, path_map


app = FastAPI(
    title="OTTV 3D Parametric Studio v5.0 API (Multi-Adapter BIM-Native SNI 6389:2020)",
    version="5.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PresetAnalyzeRequest(BaseModel):
    preset_id: str = Field(default="fasad_curtain_wall_baru")
    # Stage 1: Geometry, Unit, Axis, Intake Profile & Ground Cutoff
    source_software: str = Field(default="archicad")
    unit_mode: str = Field(default="auto")
    up_axis: str = Field(default="auto")
    exterior_detection_mode: str = Field(default="auto")
    z_ground_cutoff_m: float = Field(default=0.0, ge=0.0, le=200.0)
    # Stage 2: 3-Tier Sub-Element Decomposer & Role Classification
    auto_split_merged_cw: bool = Field(default=False)
    groups_to_auto_split: List[str] = Field(default_factory=list)
    frame_width_threshold_m: float = Field(default=0.28, ge=0.05, le=1.20)
    spandrel_height_threshold_m: float = Field(default=1.15, ge=0.30, le=2.80)
    group_wwr_map: Dict[str, float] = Field(default_factory=dict)
    face_category_overrides: Dict[str, str] = Field(default_factory=dict)
    face_z_band_overrides: List[Dict[str, Any]] = Field(default_factory=list)
    # Stage 3: Dynamic Floor Detection
    floor_mode: str = Field(default="auto")
    floor_height_m: float = Field(default=3.60, ge=2.20, le=10.00)
    custom_floor_zones: List[Dict[str, Any]] = Field(default_factory=list)
    section_floor_min: Optional[int] = Field(default=None)
    section_floor_max: Optional[int] = Field(default=None)
    # Stage 4: Material Binding & Orientation Overrides
    use_global_slider_override: bool = Field(default=False)
    orientation_material_overrides: Dict[str, str] = Field(default_factory=dict)
    alpha_wall: float = Field(default=0.42, ge=0.10, le=0.95)
    u_wall: float = Field(default=0.62, ge=0.15, le=5.50)
    td_ek: float = Field(default=15.0, ge=8.0, le=18.0)
    u_fenestration: float = Field(default=1.10, ge=0.40, le=6.00)
    delta_t: float = Field(default=5.0, ge=1.0, le=12.0)
    sc_glass: float = Field(default=0.23, ge=0.08, le=1.00)
    wwr_override: Optional[float] = Field(default=None, ge=0.05, le=0.95)
    include_frame_conduction: bool = Field(default=True)
    u_frame: float = Field(default=2.10, ge=0.50, le=7.00)
    frame_area_ratio: float = Field(default=0.08, ge=0.0, le=0.35)
    outer_skin_only: bool = Field(default=True)
    disabled_groups: List[str] = Field(default_factory=list)
    group_category_overrides: Dict[str, str] = Field(default_factory=dict)
    group_material_map: Dict[str, str] = Field(default_factory=dict)
    glazing_material_id: Optional[str] = Field(default="glz_saint_gobain_xtreme_60_28")
    wall_material_id: Optional[str] = Field(default="wal_spandrel_rockwool_nichias_50")
    frame_material_id: Optional[str] = Field(default="frm_ykkap_schuco_thermal_break")
    enable_parametric_louvers: bool = Field(default=False)
    louver_depth_m: float = Field(default=0.65, ge=0.0, le=2.50)
    louver_spacing_m: float = Field(default=1.10, ge=0.25, le=2.50)
    louver_tilt_deg: float = Field(default=22.0, ge=0.0, le=60.0)
    nurbs_u_div: int = Field(default=4, ge=2, le=28)
    nurbs_v_div: int = Field(default=2, ge=2, le=20)
    north_angle_deg: float = Field(default=0.0, ge=0.0, le=360.0)
    city_preset: str = Field(default="jakarta")
    design_month: int = Field(default=9, ge=1, le=12)


class StageInspectRequest(BaseModel):
    model_id: str
    source_software: str = Field(default="archicad")
    expected_format: str = Field(default=".ifc")
    geometry_scope: str = Field(default="facade_only")
    element_structure: str = Field(default="separated")
    unit_mode: str = Field(default="auto")
    massing_type: str = Field(default="complex_nonconvex")
    up_axis: str = Field(default="auto")
    z_ground_cutoff_m: float = Field(default=0.0, ge=0.0, le=200.0)
    auto_split_merged_cw: bool = Field(default=False)
    groups_to_auto_split: List[str] = Field(default_factory=list)
    frame_width_threshold_m: float = Field(default=0.28, ge=0.05, le=1.20)
    spandrel_height_threshold_m: float = Field(default=1.15, ge=0.30, le=2.80)
    group_category_overrides: Dict[str, str] = Field(default_factory=dict)
    disabled_groups: List[str] = Field(default_factory=list)
    group_wwr_map: Dict[str, float] = Field(default_factory=dict)
    face_category_overrides: Dict[str, str] = Field(default_factory=dict)
    face_z_band_overrides: List[Dict[str, Any]] = Field(default_factory=list)


class StageCommitRequest(StageInspectRequest):
    # Optional thermal/location settings passed from Studio on commit
    floor_mode: str = Field(default="auto")
    floor_height_m: float = Field(default=3.60, ge=2.20, le=10.00)
    custom_floor_zones: List[Dict[str, Any]] = Field(default_factory=list)
    glazing_material_id: Optional[str] = Field(default="glz_saint_gobain_xtreme_60_28")
    wall_material_id: Optional[str] = Field(default="wal_spandrel_rockwool_nichias_50")
    frame_material_id: Optional[str] = Field(default="frm_ykkap_schuco_thermal_break")
    group_material_map: Dict[str, str] = Field(default_factory=dict)
    north_angle_deg: float = Field(default=0.0, ge=0.0, le=360.0)
    city_preset: str = Field(default="jakarta")
    design_month: int = Field(default=9, ge=1, le=12)
    outer_skin_only: bool = Field(default=True)
    exterior_detection_mode: Optional[str] = Field(default=None)


class CustomMaterialRequest(BaseModel):
    name: str
    brand: str = "Spesifikasi Kustom Proyek"
    category: str = "glazing"  # 'glazing' | 'wall' | 'frame'
    technology: str = "Custom Specification"
    u_value: float = 1.80
    sc: Optional[float] = 0.32
    vlt: Optional[float] = 0.50
    alpha: Optional[float] = 0.45
    td_ek: Optional[float] = 12.0
    thickness_mm: float = 24.0
    market_availability: str = "Tersedia di Indonesia"
    description: str = "Material kustom yang ditambahkan melalui Studio."


@app.on_event("startup")
def on_startup() -> None:
    ensure_sample_files()


@app.get("/api/health")
def get_health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "version": "5.0.0",
        "standard": "SNI 6389:2020",
        "sni_limit_wm2": SNI_6389_LIMIT_WM2,
        "sf_table_wm2": ORIENTATION_BASE_SF,
        "orientation_names": ORIENTATION_NAMES,
        "supported_formats": list(ALLOWED_3D_EXTENSIONS) + [".epw"],
        "software_adapters": list(SOFTWARE_PROFILES.keys()),
    }


@app.get("/api/intake/profiles")
def get_intake_profiles() -> Dict[str, Any]:
    return {
        "profiles": list(SOFTWARE_PROFILES.values()),
        "profiles_by_id": SOFTWARE_PROFILES,
        "allowed_extensions": list(ALLOWED_3D_EXTENSIONS),
    }


@app.get("/api/presets")
def list_presets() -> Dict[str, Any]:
    catalog, _ = get_dynamic_model_catalog()
    return {
        "presets": catalog,
        "sni_sf_anchors": [
            {"azimuth_deg": a, "code": c, "name": n, "sf_wm2": sf}
            for a, c, n, sf in SNI_SF_ANCHORS
        ],
    }


@app.delete("/api/models/{model_id}")
def delete_uploaded_model(model_id: str) -> Dict[str, Any]:
    """Deletes a user-uploaded model, its .ottv.json staging config, and any unpacked .zip bundle."""
    if model_id in PRESET_DEFINITIONS:
        raise HTTPException(
            status_code=400,
            detail="Model sampel referensi bawaan tidak dapat dihapus. Hanya model unggahan pengguna yang dapat dihapus.",
        )

    deleted_files: List[str] = []
    if os.path.isdir(LAST_UPLOAD_DIR):
        for fname in list(os.listdir(LAST_UPLOAD_DIR)):
            fpath = os.path.join(LAST_UPLOAD_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            if _slugify_filename(fname) == model_id:
                os.remove(fpath)
                deleted_files.append(fname)
                # Also remove extracted .zip bundle directory if present
                if fname.lower().endswith(".zip"):
                    b_slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", os.path.splitext(fname)[0]).strip("_") or "bundle"
                    b_dir = os.path.join(LAST_UPLOAD_DIR, f"_bundle_{b_slug}")
                    if os.path.isdir(b_dir):
                        shutil.rmtree(b_dir, ignore_errors=True)
                # Also remove companion .mtl if same base name
                base_no_ext = os.path.splitext(fname)[0]
                mtl_path = os.path.join(LAST_UPLOAD_DIR, f"{base_no_ext}.mtl")
                if os.path.isfile(mtl_path):
                    try:
                        os.remove(mtl_path)
                    except OSError:
                        pass

    if not deleted_files:
        raise HTTPException(status_code=404, detail=f"Model unggahan '{model_id}' tidak ditemukan.")

    # Remove saved .ottv.json staging config
    cfg_path = os.path.join(LAST_UPLOAD_DIR, ".staging_configs", f"{re.sub(r'[^a-zA-Z0-9._-]+', '_', model_id).strip('_')}.ottv.json")
    if os.path.isfile(cfg_path):
        try:
            os.remove(cfg_path)
        except OSError:
            pass

    # Clear cached analysis if it belonged to the deleted model (prevents stale export/state!)
    global LAST_ANALYSIS_CACHE
    if LAST_ANALYSIS_CACHE is not None and LAST_ANALYSIS_CACHE.get("preset_id") == model_id:
        LAST_ANALYSIS_CACHE = None

    catalog, _ = get_dynamic_model_catalog()
    return {
        "status": "deleted",
        "deleted_model_id": model_id,
        "deleted_files": deleted_files,
        "available_models": catalog,
    }


@app.get("/api/materials")
def list_materials() -> Dict[str, Any]:
    mats = get_all_materials()
    return {
        "materials": mats,
        "glazing_materials": [m for m in mats if m["category"] == "glazing"],
        "wall_materials": [m for m in mats if m["category"] == "wall"],
        "frame_materials": [m for m in mats if m["category"] == "frame"],
    }


@app.post("/api/materials/custom")
def create_custom_material_endpoint(req: CustomMaterialRequest) -> Dict[str, Any]:
    mat = add_custom_material(req.model_dump())
    return {"status": "ok", "material": mat, "all_materials": get_all_materials()}


@app.get("/api/locations")
def list_locations() -> Dict[str, Any]:
    return {
        "cities": list(INDONESIAN_CITY_PRESETS.values()),
        "active_custom_epw": ACTIVE_CUSTOM_EPW,
    }


@app.post("/api/locations/upload-epw")
async def upload_epw_file(file: UploadFile = File(...)) -> Dict[str, Any]:
    global ACTIVE_CUSTOM_EPW
    raw_bytes = await file.read()
    text = raw_bytes.decode("utf-8", errors="ignore")
    try:
        parsed = parse_epw_content(text, file.filename or "custom.epw")
        ACTIVE_CUSTOM_EPW = parsed
        return {"status": "ok", "location": parsed}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Gagal membaca file EPW: {exc}") from exc


@app.get("/api/locations/{city_id}/download-epw")
def download_sample_epw(city_id: str) -> FileResponse:
    city_key = city_id.lower() if city_id.lower() in INDONESIAN_CITY_PRESETS else "jakarta"
    epw_path = os.path.join(EPW_DIR, f"IDN_{city_key}_TMYx.epw")
    generate_sample_epw_file(epw_path, city_key)
    return FileResponse(epw_path, filename=f"IDN_{city_key}_SNI6389.epw", media_type="text/plain")


@app.get("/api/presets/{preset_id}/download")
def download_preset_file(preset_id: str) -> FileResponse:
    _, path_map = get_dynamic_model_catalog()
    if preset_id not in path_map:
        raise HTTPException(status_code=404, detail=f"Model '{preset_id}' tidak ditemukan.")
    filepath, filename = path_map[preset_id]
    return FileResponse(filepath, filename=filename, media_type="application/octet-stream")


@app.post("/api/analyze/preset")
def analyze_preset(req: PresetAnalyzeRequest) -> Dict[str, Any]:
    global LAST_ANALYSIS_CACHE
    catalog, path_map = get_dynamic_model_catalog()
    if req.preset_id not in path_map:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{req.preset_id}' tidak ditemukan atau sudah dihapus. Pilih model aktif yang tersedia.",
        )
    target_path, target_name = path_map[req.preset_id]
    resolved_id = req.preset_id

    params = EnvelopeParameters(
        source_software=req.source_software,
        unit_mode=req.unit_mode,
        up_axis=req.up_axis,
        exterior_detection_mode=req.exterior_detection_mode,
        z_ground_cutoff_m=req.z_ground_cutoff_m,
        auto_split_merged_cw=req.auto_split_merged_cw,
        groups_to_auto_split=req.groups_to_auto_split,
        frame_width_threshold_m=req.frame_width_threshold_m,
        spandrel_height_threshold_m=req.spandrel_height_threshold_m,
        group_wwr_map=req.group_wwr_map,
        face_category_overrides=req.face_category_overrides,
        face_z_band_overrides=req.face_z_band_overrides,
        floor_mode=req.floor_mode,
        floor_height_m=req.floor_height_m,
        custom_floor_zones=req.custom_floor_zones,
        section_floor_min=req.section_floor_min,
        section_floor_max=req.section_floor_max,
        use_global_slider_override=req.use_global_slider_override,
        orientation_material_overrides=req.orientation_material_overrides,
        alpha_wall=req.alpha_wall,
        u_wall=req.u_wall,
        td_ek=req.td_ek,
        u_fenestration=req.u_fenestration,
        delta_t=req.delta_t,
        sc_glass=req.sc_glass,
        wwr_override=req.wwr_override,
        include_frame_conduction=req.include_frame_conduction,
        u_frame=req.u_frame,
        frame_area_ratio=req.frame_area_ratio,
        outer_skin_only=req.outer_skin_only,
        disabled_groups=req.disabled_groups,
        group_category_overrides=req.group_category_overrides,
        group_material_map=req.group_material_map,
        glazing_material_id=req.glazing_material_id,
        wall_material_id=req.wall_material_id,
        frame_material_id=req.frame_material_id,
        enable_parametric_louvers=req.enable_parametric_louvers,
        louver_depth_m=req.louver_depth_m,
        louver_spacing_m=req.louver_spacing_m,
        louver_tilt_deg=req.louver_tilt_deg,
        nurbs_u_div=req.nurbs_u_div,
        nurbs_v_div=req.nurbs_v_div,
        north_angle_deg=req.north_angle_deg,
        city_preset=req.city_preset,
        design_month=req.design_month,
        custom_epw_info=ACTIVE_CUSTOM_EPW if req.city_preset == "custom_epw" else None,
    )

    try:
        res = analyze_building_ottv(target_path, target_name, params)
        res["preset_id"] = resolved_id
        res["available_models"] = catalog
        LAST_ANALYSIS_CACHE = res
        return res
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/analyze/upload")
async def analyze_uploaded_file(
    file: UploadFile = File(...),
    unit_mode: str = Form("auto"),
    up_axis: str = Form("auto"),
    exterior_detection_mode: str = Form("auto"),
    auto_split_merged_cw: bool = Form(False),
    frame_width_threshold_m: float = Form(0.28),
    spandrel_height_threshold_m: float = Form(1.15),
    floor_mode: str = Form("auto"),
    floor_height_m: float = Form(3.60),
    use_global_slider_override: bool = Form(False),
    alpha_wall: float = Form(0.42),
    u_wall: float = Form(0.62),
    td_ek: float = Form(15.0),
    u_fenestration: float = Form(1.10),
    delta_t: float = Form(5.0),
    sc_glass: float = Form(0.23),
    wwr_override: Optional[float] = Form(None),
    include_frame_conduction: bool = Form(True),
    u_frame: float = Form(2.10),
    frame_area_ratio: float = Form(0.08),
    outer_skin_only: bool = Form(True),
    glazing_material_id: Optional[str] = Form("glz_saint_gobain_xtreme_60_28"),
    wall_material_id: Optional[str] = Form("wal_spandrel_rockwool_nichias_50"),
    frame_material_id: Optional[str] = Form("frm_ykkap_schuco_thermal_break"),
    enable_parametric_louvers: bool = Form(False),
    louver_depth_m: float = Form(0.65),
    louver_spacing_m: float = Form(1.10),
    louver_tilt_deg: float = Form(22.0),
    nurbs_u_div: int = Form(4),
    nurbs_v_div: int = Form(2),
    north_angle_deg: float = Form(0.0),
    city_preset: str = Form("jakarta"),
    design_month: int = Form(9),
) -> Dict[str, Any]:
    global LAST_ANALYSIS_CACHE
    raw_name = os.path.basename(file.filename or "uploaded_model.3dm")
    ext = os.path.splitext(raw_name.lower())[1]
    if ext not in ALLOWED_3D_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Format file '{ext}' tidak didukung. Gunakan {', '.join(ALLOWED_3D_EXTENSIONS)}.",
        )

    saved_path = os.path.join(LAST_UPLOAD_DIR, raw_name)
    content = await file.read()
    with open(saved_path, "wb") as out_f:
        out_f.write(content)

    model_id = _slugify_filename(raw_name)
    catalog, _ = get_dynamic_model_catalog()

    params = EnvelopeParameters(
        unit_mode=unit_mode,
        up_axis=up_axis,
        exterior_detection_mode=exterior_detection_mode,
        auto_split_merged_cw=auto_split_merged_cw,
        frame_width_threshold_m=frame_width_threshold_m,
        spandrel_height_threshold_m=spandrel_height_threshold_m,
        floor_mode=floor_mode,
        floor_height_m=floor_height_m,
        use_global_slider_override=use_global_slider_override,
        alpha_wall=alpha_wall,
        u_wall=u_wall,
        td_ek=td_ek,
        u_fenestration=u_fenestration,
        delta_t=delta_t,
        sc_glass=sc_glass,
        wwr_override=wwr_override,
        include_frame_conduction=include_frame_conduction,
        u_frame=u_frame,
        frame_area_ratio=frame_area_ratio,
        outer_skin_only=outer_skin_only,
        glazing_material_id=glazing_material_id,
        wall_material_id=wall_material_id,
        frame_material_id=frame_material_id,
        enable_parametric_louvers=enable_parametric_louvers,
        louver_depth_m=louver_depth_m,
        louver_spacing_m=louver_spacing_m,
        louver_tilt_deg=louver_tilt_deg,
        nurbs_u_div=nurbs_u_div,
        nurbs_v_div=nurbs_v_div,
        north_angle_deg=north_angle_deg,
        city_preset=city_preset,
        design_month=design_month,
        custom_epw_info=ACTIVE_CUSTOM_EPW if city_preset == "custom_epw" else None,
    )

    try:
        result = analyze_building_ottv(saved_path, raw_name, params)
        result["preset_id"] = model_id
        result["available_models"] = catalog
        LAST_ANALYSIS_CACHE = result
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ============================================================================
# v5.0 PROFILE-DRIVEN MULTI-ADAPTER STAGING & COMMIT ENDPOINTS (VIEW 1 -> VIEW 2)
# ============================================================================

@app.post("/api/stage/upload")
async def stage_upload_file(
    file: UploadFile = File(...),
    source_software: str = Form("archicad"),
    expected_format: str = Form(".ifc"),
    geometry_scope: str = Form("facade_only"),
    element_structure: str = Form("separated"),
    unit_mode: str = Form("auto"),
    massing_type: str = Form("complex_nonconvex"),
    up_axis: str = Form("auto"),
    z_ground_cutoff_m: float = Form(0.0),
) -> Dict[str, Any]:
    """
    Phase A (Fast < 3s): Saves uploaded file (auto-unpacks .zip .obj+.mtl bundles),
    routes through the user's chosen Software Specialist Adapter, runs fast geometric
    audit + Mismatch Detection + 3D Staging Preview (ZERO solar raycasting), and
    auto-saves `.ottv.json` staging config.
    """
    raw_name = os.path.basename(file.filename or "uploaded_model.ifc")
    ext = os.path.splitext(raw_name.lower())[1]
    if ext not in ALLOWED_3D_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Format file '{ext}' tidak didukung. Gunakan {', '.join(ALLOWED_3D_EXTENSIONS)}.",
        )

    saved_path = os.path.join(LAST_UPLOAD_DIR, raw_name)
    content = await file.read()
    with open(saved_path, "wb") as out_f:
        out_f.write(content)

    try:
        resolved_path, resolved_name, unpack_notes = unpack_zip_bundle_if_needed(saved_path, LAST_UPLOAD_DIR)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    model_id = _slugify_filename(raw_name)
    catalog, _ = get_dynamic_model_catalog()

    profile = ModelIntakeProfile(
        source_software=source_software,
        expected_format=expected_format or ext,
        geometry_scope=geometry_scope,
        element_structure=element_structure,
        unit_mode=unit_mode,
        massing_type=massing_type,
        up_axis=up_axis,
        z_ground_cutoff_m=float(z_ground_cutoff_m or 0.0),
    )

    try:
        staged = build_staging_inspection_payload(
            filepath=resolved_path,
            display_filename=resolved_name,
            model_id=model_id,
            profile=profile,
            auto_split_merged_cw=(element_structure == "merged_single_layer"),
        )
        if unpack_notes:
            staged["adapter_notes"] = unpack_notes + staged.get("adapter_notes", [])
        staged["available_models"] = catalog
        staged["face_z_band_overrides"] = []

        # Auto-save initial .ottv.json staging config
        save_staging_config(LAST_UPLOAD_DIR, model_id, {
            "model_id": model_id,
            "filename": resolved_name,
            "profile": profile.to_dict(),
            "auto_split_merged_cw": (element_structure == "merged_single_layer"),
            "groups_to_auto_split": [],
            "frame_width_threshold_m": 0.28,
            "spandrel_height_threshold_m": 1.15,
            "group_category_overrides": {},
            "disabled_groups": [],
            "group_wwr_map": {},
            "face_category_overrides": {},
            "face_z_band_overrides": [],
        })
        return staged
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Gagal staging inspeksi model: {exc}") from exc


@app.post("/api/stage/inspect")
def stage_inspect_existing(req: StageInspectRequest) -> Dict[str, Any]:
    """
    Fast Phase-A re-inspection for an already uploaded or preset model whenever the
    user switches Software Adapter, changes Unit/Up-Axis/Z0, toggles Auto-Split Tier 2,
    or updates group/face roles in View 1.
    """
    catalog, path_map = get_dynamic_model_catalog()
    if req.model_id not in path_map:
        raise HTTPException(status_code=404, detail=f"Model '{req.model_id}' tidak ditemukan.")
    target_path, target_name = path_map[req.model_id]

    profile = ModelIntakeProfile(
        source_software=req.source_software,
        expected_format=req.expected_format,
        geometry_scope=req.geometry_scope,
        element_structure=req.element_structure,
        unit_mode=req.unit_mode,
        massing_type=req.massing_type,
        up_axis=req.up_axis,
        z_ground_cutoff_m=req.z_ground_cutoff_m,
    )

    try:
        staged = build_staging_inspection_payload(
            filepath=target_path,
            display_filename=target_name,
            model_id=req.model_id,
            profile=profile,
            group_category_overrides=req.group_category_overrides,
            disabled_groups=req.disabled_groups,
            group_wwr_map=req.group_wwr_map,
            face_category_overrides=req.face_category_overrides,
            auto_split_merged_cw=req.auto_split_merged_cw,
            groups_to_auto_split=req.groups_to_auto_split,
            frame_width_threshold_m=req.frame_width_threshold_m,
            spandrel_height_threshold_m=req.spandrel_height_threshold_m,
        )
        staged["available_models"] = catalog
        staged["face_z_band_overrides"] = req.face_z_band_overrides

        save_staging_config(LAST_UPLOAD_DIR, req.model_id, {
            "model_id": req.model_id,
            "filename": target_name,
            "profile": profile.to_dict(),
            "auto_split_merged_cw": req.auto_split_merged_cw,
            "groups_to_auto_split": req.groups_to_auto_split,
            "frame_width_threshold_m": req.frame_width_threshold_m,
            "spandrel_height_threshold_m": req.spandrel_height_threshold_m,
            "group_category_overrides": req.group_category_overrides,
            "disabled_groups": req.disabled_groups,
            "group_wwr_map": req.group_wwr_map,
            "face_category_overrides": req.face_category_overrides,
            "face_z_band_overrides": req.face_z_band_overrides,
        })
        return staged
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Gagal inspeksi ulang model: {exc}") from exc


@app.get("/api/stage/config/{model_id}")
def get_saved_staging_config(model_id: str) -> Dict[str, Any]:
    cfg = load_staging_config(LAST_UPLOAD_DIR, model_id)
    if cfg is None:
        return {"found": False, "model_id": model_id, "config": None}
    return {"found": True, "model_id": model_id, "config": cfg}


@app.post("/api/stage/config/{model_id}")
def save_custom_staging_config(model_id: str, config: Dict[str, Any]) -> Dict[str, Any]:
    config["model_id"] = model_id
    save_staging_config(LAST_UPLOAD_DIR, model_id, config)
    return {"status": "ok", "model_id": model_id, "config": config}


@app.post("/api/analyze/commit")
def commit_staged_model_to_ottv(req: StageCommitRequest) -> Dict[str, Any]:
    """
    Phase B: Commits a verified Staging Inspection configuration (View 1 -> View 2),
    saves its `.ottv.json` mapping, runs full SNI 6389:2020 OTTV + 3-Layer Exterior Skin
    + Full-Building & Neighbor Shading Solar Raycasting, and returns the complete result.
    """
    global LAST_ANALYSIS_CACHE
    catalog, path_map = get_dynamic_model_catalog()
    if req.model_id not in path_map:
        raise HTTPException(status_code=404, detail=f"Model '{req.model_id}' tidak ditemukan.")
    target_path, target_name = path_map[req.model_id]

    profile = ModelIntakeProfile(
        source_software=req.source_software,
        expected_format=req.expected_format,
        geometry_scope=req.geometry_scope,
        element_structure=req.element_structure,
        unit_mode=req.unit_mode,
        massing_type=req.massing_type,
        up_axis=req.up_axis,
        z_ground_cutoff_m=req.z_ground_cutoff_m,
    )
    adapter = get_adapter_for_software(profile.source_software)
    actual_ext = os.path.splitext(target_path.lower())[1]
    eff_cfg = adapter.resolve_effective_settings(profile, actual_ext)

    # Save verified config for future reuse
    save_staging_config(LAST_UPLOAD_DIR, req.model_id, {
        "model_id": req.model_id,
        "filename": target_name,
        "profile": profile.to_dict(),
        "auto_split_merged_cw": req.auto_split_merged_cw or eff_cfg["auto_split_merged_cw"],
        "groups_to_auto_split": req.groups_to_auto_split,
        "frame_width_threshold_m": req.frame_width_threshold_m,
        "spandrel_height_threshold_m": req.spandrel_height_threshold_m,
        "group_category_overrides": req.group_category_overrides,
        "disabled_groups": req.disabled_groups,
        "group_wwr_map": req.group_wwr_map,
        "face_category_overrides": req.face_category_overrides,
        "face_z_band_overrides": req.face_z_band_overrides,
    })

    ext_det_mode = req.exterior_detection_mode or eff_cfg["exterior_detection_mode"]

    params = EnvelopeParameters(
        source_software=req.source_software,
        unit_mode=eff_cfg["unit_mode"],
        up_axis=eff_cfg["up_axis"],
        exterior_detection_mode=ext_det_mode,
        z_ground_cutoff_m=req.z_ground_cutoff_m,
        auto_split_merged_cw=(req.auto_split_merged_cw or eff_cfg["auto_split_merged_cw"]),
        groups_to_auto_split=req.groups_to_auto_split,
        frame_width_threshold_m=req.frame_width_threshold_m,
        spandrel_height_threshold_m=req.spandrel_height_threshold_m,
        group_wwr_map=req.group_wwr_map,
        group_category_overrides=req.group_category_overrides,
        disabled_groups=req.disabled_groups,
        face_category_overrides=req.face_category_overrides,
        face_z_band_overrides=req.face_z_band_overrides,
        floor_mode=req.floor_mode,
        floor_height_m=req.floor_height_m,
        custom_floor_zones=req.custom_floor_zones,
        glazing_material_id=req.glazing_material_id,
        wall_material_id=req.wall_material_id,
        frame_material_id=req.frame_material_id,
        group_material_map=req.group_material_map,
        north_angle_deg=req.north_angle_deg,
        city_preset=req.city_preset,
        design_month=req.design_month,
        outer_skin_only=req.outer_skin_only,
        custom_epw_info=ACTIVE_CUSTOM_EPW if req.city_preset == "custom_epw" else None,
    )

    try:
        result = analyze_building_ottv(target_path, target_name, params)
        result["preset_id"] = req.model_id
        result["available_models"] = catalog
        result["intake_profile"] = profile.to_dict()
        LAST_ANALYSIS_CACHE = result
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Gagal menghitung OTTV setelah inspeksi: {exc}") from exc


def _get_or_compute_analysis() -> Dict[str, Any]:
    global LAST_ANALYSIS_CACHE
    if LAST_ANALYSIS_CACHE is None:
        raise HTTPException(
            status_code=400,
            detail="Tidak ada model aktif saat ini. Pilih model dari katalog atau impor model terlebih dahulu sebelum mengunduh laporan.",
        )
    return LAST_ANALYSIS_CACHE


@app.api_route("/api/export/excel", methods=["GET", "POST"])
def export_excel_endpoint() -> Response:
    data = _get_or_compute_analysis()
    xlsx_bytes = generate_excel_report(data)
    base = os.path.splitext(data.get("filename", "OTTV_Report"))[0]
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="Laporan_OTTV_PUPR_{base}_SNI6389.xlsx"'},
    )


@app.api_route("/api/export/csv", methods=["GET", "POST"])
def export_csv_endpoint() -> Response:
    data = _get_or_compute_analysis()
    csv_bytes = generate_csv_report(data)
    base = os.path.splitext(data.get("filename", "OTTV_Report"))[0]
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="Laporan_OTTV_{base}_SNI6389.csv"'},
    )


@app.api_route("/api/export/pdf", methods=["GET", "POST"])
def export_pdf_endpoint() -> Response:
    data = _get_or_compute_analysis()
    pdf_bytes = generate_pdf_report(data)
    base = os.path.splitext(data.get("filename", "OTTV_Report"))[0]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Laporan_OTTV_{base}_SNI6389.pdf"'},
    )


FRONTEND_DIST_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend", "dist"))
if os.path.isdir(FRONTEND_DIST_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend_static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
