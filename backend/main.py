"""
OTTV 3D Parametric Studio — Unified API v2 (Fase 2: Single Source of Truth)
===========================================================================
Provides unified REST endpoints built around Pydantic v2 `ProjectConfig`:
- `POST   /api/models`                          : Upload 3D model + auto detect_file_signature
- `GET    /api/models`                          : List uploaded models & reference samples
- `DELETE /api/models/{model_id}`               : Delete uploaded model & its .ottv.json config
- `GET    /api/models/{model_id}/config`        : Read-only load of ProjectConfig v2 (migrates v1)
- `PUT    /api/models/{model_id}/config`        : Explicitly save ProjectConfig v2 to .ottv.json
- `POST   /api/models/{model_id}/inspect`       : Read-only fast 3D inspection (no raycast, no disk write)
- `POST   /api/models/{model_id}/analyze`       : Full OTTV analysis -> {analysis_id, ...}
- `GET    /api/analyses/{analysis_id}/export/{fmt}` : Export xlsx | csv | pdf by analysis_id

All legacy endpoints (/api/analyze/preset, /api/analyze/upload, /api/analyze/commit,
/api/stage/*) and global mutable state (LAST_ANALYSIS_CACHE, ACTIVE_CUSTOM_EPW) are removed.
"""

from __future__ import annotations

from collections import OrderedDict
import hashlib
import os
import re
import shutil
from typing import Any, Dict, List, Literal, Optional, Tuple
import uuid

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from adapters import (
    EXPORT_TIPS_BY_SOURCE,
    build_staging_inspection_payload,
    detect_file_signature,
    get_export_tips,
    get_project_config_path,
    load_project_config,
    save_project_config,
    unpack_zip_bundle_if_needed,
)
from config_schema import InspectRequest, ProjectConfig
from materials_and_epw import (
    INDONESIAN_CITY_PRESETS,
    SC_TO_SHGC_RATIO,
    generate_sample_epw_file,
    get_all_materials,
    parse_epw_content,
    validate_custom_material,
)
from ottv_engine import (
    ORIENTATION_BASE_SF,
    ORIENTATION_NAMES,
    SNI_6389_LIMIT_WM2,
    SNI_SF_ANCHORS,
    analyze_building_ottv,
    compute_panel_exposure_for_date,
    create_sample_hbjson_preset,
    create_sample_ifc_preset,
    create_sample_obj_preset,
    create_sample_rhino_3dm_preset,
)
from recommender import (
    optimize_material_combinations,
    recommend_for_target,
    rematerial_analysis,
)
from report_exporter import (
    generate_csv_report,
    generate_excel_report,
    generate_pdf_report,
)
from universal_pipeline import load_universal_model_stages_1_and_2


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))
SYNTHETIC_DIR = os.path.join(REPO_ROOT, "fixtures", "synthetic")
SAMPLES_DIR = os.path.join(BASE_DIR, "samples")
BENCHMARK_SAMPLES_DIR = os.path.join(SAMPLES_DIR, "benchmark_library")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
EPW_DIR = os.path.join(BASE_DIR, "epw_samples")
os.makedirs(SAMPLES_DIR, exist_ok=True)
os.makedirs(BENCHMARK_SAMPLES_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(EPW_DIR, exist_ok=True)

ALLOWED_3D_EXTENSIONS = (".3dm", ".obj", ".ifc", ".glb", ".gltf", ".hbjson", ".json", ".stl", ".ply", ".zip")

# Bounded per-analysis store keyed by analysis_id (no single global LAST_ANALYSIS_CACHE)
MAX_STORED_ANALYSES = 64
ANALYSIS_STORE: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()


PRESET_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "contoh_kotak_m": {
        "id": "contoh_kotak_m",
        "title": "Kotak 4 lantai (20 × 30 m, jendela pita, WWR 40%)",
        "filename": "01_kotak_m.3dm",
        "synthetic_rel": os.path.join("01_kotak_m", "model.3dm"),
        "format": "3DM",
        "is_uploaded": False,
        "description": "Contoh bawaan kotak 4 lantai 20 × 30 m dengan jendela pita (WWR 40%).",
    },
    "archicad_bim_ifc": {
        "id": "archicad_bim_ifc",
        "title": "ArchiCAD BIM Curtain Wall + Podium (6 Lantai Variatif)",
        "filename": "archicad_bim_curtainwall.ifc",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Model BIM IFC2x3 dengan 6 IFCBUILDINGSTOREY, IFCPLATE, IFCMEMBER & IFCSHADINGDEVICE.",
    },
    "bench_ac20_fzk_haus": {
        "id": "bench_ac20_fzk_haus",
        "title": "AC20 FZK-Haus — Rumah 2 Lantai Full BIM + Interior",
        "filename": "AC20_FZK_Haus.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Sampel standar IFC4 STEPtools/Archicad (13×11×6.5m, 2 lantai).",
    },
    "bench_ac20_institute_var2": {
        "id": "bench_ac20_institute_var2",
        "title": "AC20 Institute Var-2 — Gedung Kampus 5 Lantai (10.3 MB)",
        "filename": "AC20_Institute_Var2.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Gedung pendidikan IFC4 5 lantai (44×19×15.4m).",
    },
    "bench_klassiqua_2026": {
        "id": "bench_klassiqua_2026",
        "title": "Klassiqua Office 2026 — Kantor IFC4X3 (4 Lantai)",
        "filename": "Klassiqua_Office_2026_IFC4x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Arketipe gedung kantor modern IFC4.3.",
    },
    "bench_klassiqua_1998": {
        "id": "bench_klassiqua_1998",
        "title": "Klassiqua Office 1998 — Kantor IFC4X3 (4 Lantai)",
        "filename": "Klassiqua_Office_1998_IFC4x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Arketipe kantor era 1998 IFC4.3.",
    },
    "bench_klassiqua_1970": {
        "id": "bench_klassiqua_1970",
        "title": "Klassiqua Office 1970 — Kantor IFC4X3 (4 Lantai)",
        "filename": "Klassiqua_Office_1970_IFC4x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Arketipe kantor era 1970 IFC4.3.",
    },
    "bench_iso_wall_window": {
        "id": "bench_iso_wall_window",
        "title": "ISO ReferenceView — Dinding + Lubang Boolean Jendela (IFC4)",
        "filename": "ISO_ReferenceView_Wall_Window_IFC4.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Sampel sertifikasi buildingSMART IFC4 untuk pemotongan IfcOpeningElement.",
    },
    "bench_bsi_arch_ifc2x3": {
        "id": "bench_bsi_arch_ifc2x3",
        "title": "buildingSMART Simple Architecture (IFC2x3 — 2 Lantai)",
        "filename": "bSI_Simple_Architecture_IFC2x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Dataset sertifikasi buildingSMART IFC2x3 TC1.",
    },
    "bench_bsi_arch_ifc4": {
        "id": "bench_bsi_arch_ifc4",
        "title": "buildingSMART Simple Architecture (IFC4 — 2 Lantai)",
        "filename": "bSI_Simple_Architecture_IFC4.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Dataset sertifikasi buildingSMART IFC4 ADD2 TC1.",
    },
    "bench_bsi_arch_ifc43": {
        "id": "bench_bsi_arch_ifc43",
        "title": "buildingSMART Simple Architecture (IFC4.3)",
        "filename": "bSI_Simple_Architecture_IFC4x3.ifc",
        "subdir": "benchmark_library",
        "format": "IFC",
        "is_uploaded": False,
        "description": "Dataset sertifikasi buildingSMART IFC4.3 ADD2.",
    },
    "fasad_curtain_wall_baru": {
        "id": "fasad_curtain_wall_baru",
        "title": "Fasad_Curtain_Wall_Baru.3dm — Tower Curtain Wall (24 Lantai)",
        "filename": "Fasad_Curtain_Wall_Baru.3dm",
        "format": "3DM",
        "is_uploaded": False,
        "description": "Model Tower Curtain Wall 24 lantai dengan Spandrel, Vision Glass, Mullion, Transom, & Shading Fins.",
    },
    "rhino_nurbs_tower": {
        "id": "rhino_nurbs_tower",
        "title": "Menara NURBS Nusantara — Fasad Lengkung (5 Lantai)",
        "filename": "nusantara_nurbs_tower.3dm",
        "format": "3DM",
        "is_uploaded": False,
        "description": "Menara organik 5-tier dengan fasad lengkung NURBS.",
    },
    "bioclimatic_office_obj": {
        "id": "bioclimatic_office_obj",
        "title": "Kantor Bioklimatik Oktagonal — 8 Orientasi (4 Lantai)",
        "filename": "bioclimatic_office.obj",
        "format": "OBJ",
        "is_uploaded": False,
        "description": "Gedung kantor 4 lantai 8 orientasi penuh dengan spandrel & kanopi louver.",
    },
    "bench_khronos_glass_glb": {
        "id": "bench_khronos_glass_glb",
        "title": "Khronos PBR Transmission Glass Sample (.glb)",
        "filename": "Khronos_Glass_Transmission.glb",
        "subdir": "benchmark_library",
        "format": "GLB",
        "is_uploaded": False,
        "description": "Sampel resmi Khronos glTF 2.0 (uji material PBR).",
    },
    "bench_khronos_box_glb": {
        "id": "bench_khronos_box_glb",
        "title": "Khronos Textured Unit Mass (.glb)",
        "filename": "Khronos_Textured_Box.glb",
        "subdir": "benchmark_library",
        "format": "GLB",
        "is_uploaded": False,
        "description": "Sampel standar Khronos glTF 2.0 untuk pengujian sumbu Y-Up -> Z-Up.",
    },
    "honeybee_zone_hbjson": {
        "id": "honeybee_zone_hbjson",
        "title": "Model Termal SNI 6389 Honeybee (3 Lantai)",
        "filename": "sni6389_thermal_model.hbjson",
        "format": "HBJSON",
        "is_uploaded": False,
        "description": "Model energi Honeybee JSON dengan Face, Aperture kaca, dan Outdoor Shades.",
    },
    "bench_hb_multizone_office": {
        "id": "bench_hb_multizone_office",
        "title": "Honeybee Multi-Zone Office — Ladybug Official (3 Lantai)",
        "filename": "Honeybee_MultiZone_Office_3F.hbjson",
        "subdir": "benchmark_library",
        "format": "HBJSON",
        "is_uploaded": False,
        "description": "Sampel resmi Ladybug Tools (10×10×9m, 3 lantai, 240 m², WWR 20%).",
    },
    "bench_hb_office_floor": {
        "id": "bench_hb_office_floor",
        "title": "Honeybee Large Office Floor — 30×30m (1 Lantai)",
        "filename": "Honeybee_Office_Floor_30x30m.hbjson",
        "subdir": "benchmark_library",
        "format": "HBJSON",
        "is_uploaded": False,
        "description": "Lantai kantor tipikal 30×30×3m dari Ladybug Tools.",
    },
    "bench_hb_single_family": {
        "id": "bench_hb_single_family",
        "title": "Honeybee Single-Family Home — Hunian (1 Lantai)",
        "filename": "Honeybee_Single_Family_Home.hbjson",
        "subdir": "benchmark_library",
        "format": "HBJSON",
        "is_uploaded": False,
        "description": "Sampel rumah tinggal resmi Ladybug Tools.",
    },
    "bench_hb_patient_room": {
        "id": "bench_hb_patient_room",
        "title": "Honeybee Hospital Patient Room — Ruang Rawat (1 Lantai)",
        "filename": "Honeybee_Patient_Room.hbjson",
        "subdir": "benchmark_library",
        "format": "HBJSON",
        "is_uploaded": False,
        "description": "Sampel ruang rawat rumah sakit resmi Ladybug Tools.",
    },
}


def _slugify_filename(filename: str) -> str:
    """Collision-free deterministic model_id."""
    clean = filename.strip()
    slug = re.sub(r"[^a-zA-Z0-9_.-]+", "_", clean)
    h6 = hashlib.sha1(clean.encode("utf-8")).hexdigest()[:6]
    return f"upload_{slug}_{h6}"


def _store_analysis_record(analysis_id: str, record: Dict[str, Any]) -> None:
    ANALYSIS_STORE[analysis_id] = record
    ANALYSIS_STORE.move_to_end(analysis_id)
    while len(ANALYSIS_STORE) > MAX_STORED_ANALYSES:
        ANALYSIS_STORE.popitem(last=False)


def _resolve_preset_file_path(pdef: Dict[str, Any]) -> str:
    if pdef.get("synthetic_rel"):
        return os.path.join(SYNTHETIC_DIR, pdef["synthetic_rel"])
    subdir = pdef.get("subdir")
    return os.path.join(SAMPLES_DIR, subdir, pdef["filename"]) if subdir else os.path.join(SAMPLES_DIR, pdef["filename"])


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

    for pid, pdef in PRESET_DEFINITIONS.items():
        if pid in paths:
            continue
        cand = _resolve_preset_file_path(pdef)
        if os.path.isfile(cand):
            paths[pid] = cand

    return paths


def _resolve_model_path_readonly(model_id: str) -> Tuple[str, str]:
    """Read-only lookup of a model's `(filepath, display_filename)` without touching disk."""
    # 1. Check reference samples first (strictly read-only check on existing files)
    if model_id in PRESET_DEFINITIONS:
        pdef = PRESET_DEFINITIONS[model_id]
        cand = _resolve_preset_file_path(pdef)
        if os.path.isfile(cand):
            return cand, pdef["filename"]

    # 2. Check uploaded files in UPLOADS_DIR (read-only)
    if os.path.isdir(UPLOADS_DIR):
        for fname in os.listdir(UPLOADS_DIR):
            ext = os.path.splitext(fname.lower())[1]
            if ext not in ALLOWED_3D_EXTENSIONS:
                continue
            fpath = os.path.join(UPLOADS_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            if _slugify_filename(fname) == model_id:
                if ext == ".zip":
                    b_slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", os.path.splitext(fname)[0]).strip("_") or "bundle"
                    b_dir = os.path.join(UPLOADS_DIR, f"_bundle_{b_slug}")
                    if os.path.isdir(b_dir):
                        for root, _, files in os.walk(b_dir):
                            for bf in sorted(files):
                                if os.path.splitext(bf.lower())[1] in ALLOWED_3D_EXTENSIONS and not bf.lower().endswith(".zip"):
                                    return os.path.join(root, bf), bf
                return fpath, fname

    raise HTTPException(status_code=404, detail=f"Model '{model_id}' tidak ditemukan.")


def get_dynamic_model_catalog(readonly: bool = False) -> Tuple[List[Dict[str, Any]], Dict[str, Tuple[str, str]]]:
    """
    Returns `(catalog_list, id_to_path_and_filename_map)` combining uploaded models
    and reference samples. When `readonly=True`, guarantees zero disk writes.
    """
    if readonly:
        sample_paths: Dict[str, str] = {}
        for pid, pdef in PRESET_DEFINITIONS.items():
            cand = _resolve_preset_file_path(pdef)
            if os.path.isfile(cand):
                sample_paths[pid] = cand
    else:
        sample_paths = ensure_sample_files()

    catalog: List[Dict[str, Any]] = []
    path_map: Dict[str, Tuple[str, str]] = {}

    if os.path.isdir(UPLOADS_DIR):
        up_files = []
        for fname in os.listdir(UPLOADS_DIR):
            ext = os.path.splitext(fname.lower())[1]
            if ext in ALLOWED_3D_EXTENSIONS:
                fpath = os.path.join(UPLOADS_DIR, fname)
                if os.path.isfile(fpath):
                    up_files.append((os.path.getmtime(fpath), fname, fpath, ext))
        up_files.sort(key=lambda x: x[0], reverse=True)

        for _, fname, fpath, ext in up_files:
            model_id = _slugify_filename(fname)
            size_mb = round(os.path.getsize(fpath) / (1024.0 * 1024.0), 2)
            fmt = ext.lstrip(".").upper()
            resolved_path = fpath
            resolved_name = fname
            if ext == ".zip":
                if readonly:
                    try:
                        resolved_path, resolved_name = _resolve_model_path_readonly(model_id)
                        fmt = f"ZIP→{os.path.splitext(resolved_name)[1].lstrip('.').upper()}"
                    except HTTPException:
                        continue
                else:
                    try:
                        resolved_path, resolved_name, _ = unpack_zip_bundle_if_needed(fpath, UPLOADS_DIR)
                        fmt = f"ZIP→{os.path.splitext(resolved_name)[1].lstrip('.').upper()}"
                    except Exception:
                        continue
            cfg_exists = os.path.isfile(get_project_config_path(UPLOADS_DIR, model_id, create_dir=False))
            catalog.append({
                "id": model_id,
                "title": f"[Unggahan] {fname} ({fmt} · {size_mb} MB)",
                "filename": resolved_name,
                "format": fmt,
                "size_mb": size_mb,
                "is_uploaded": True,
                "has_config": cfg_exists,
                "description": f"Model kustom yang diunggah pengguna ({fname}).",
            })
            if model_id not in path_map:
                path_map[model_id] = (resolved_path, resolved_name)

    for pid, pdef in PRESET_DEFINITIONS.items():
        if pid in sample_paths:
            spath = sample_paths[pid]
            item = dict(pdef)
            if os.path.isfile(spath):
                item["size_mb"] = round(os.path.getsize(spath) / (1024.0 * 1024.0), 2)
            item["has_config"] = os.path.isfile(get_project_config_path(UPLOADS_DIR, pid, create_dir=False))
            catalog.append(item)
            path_map[pid] = (spath, pdef["filename"])

    return catalog, path_map


app = FastAPI(
    title="OTTV 3D Parametric Studio API v2 (SNI 6389:2020)",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ValidateMaterialRequest(BaseModel):
    id: Optional[str] = None
    name: str
    brand: str = "Buatan saya"
    product_line: str = ""
    category: str = "glazing"  # 'glazing' | 'wall' | 'frame' | 'roof'
    technology: str = "Spesifikasi Kustom"
    configuration: str = ""
    u_value: float = 1.80
    u_value_nfrc_summer: Optional[float] = None
    sc: Optional[float] = None
    shgc: Optional[float] = None
    vlt: Optional[float] = 0.50
    vlr_ext: Optional[float] = None
    alpha: Optional[float] = 0.45
    massa_kg_m2: float = 150.0
    thickness_mm: float = 24.0
    color_hex: str = ""
    sumber: str = ""
    sumber_judul: str = ""
    tanggal_akses: str = ""
    standar_data: str = ""
    status: str = "nilai_tipikal"
    catatan: str = ""
    description: str = ""


@app.on_event("startup")
def on_startup() -> None:
    ensure_sample_files()


# ============================================================================
# HEALTH, CATALOGS & EXPORT TIPS
# ============================================================================

@app.get("/api/health")
def get_health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "api_version": 2,
        "standard": "SNI 6389:2020",
        "sni_limit_wm2": SNI_6389_LIMIT_WM2,
        "sf_table_wm2": ORIENTATION_BASE_SF,
        "orientation_names": ORIENTATION_NAMES,
        "supported_formats": list(ALLOWED_3D_EXTENSIONS) + [".epw"],
    }


@app.get("/api/export-tips")
def list_export_tips() -> Dict[str, Any]:
    return {
        "sources": list(EXPORT_TIPS_BY_SOURCE.values()),
        "allowed_extensions": list(ALLOWED_3D_EXTENSIONS),
    }


@app.get("/api/materials")
def list_materials() -> Dict[str, Any]:
    from sni_tables import SNI_TABLE_1_ABSORPTANCE_MATERIALS, SNI_TABLE_2_ABSORPTANCE_PAINTS

    mats = get_all_materials()
    brands = sorted({str(m.get("brand") or "").strip() for m in mats if m.get("brand")})
    return {
        "materials": mats,
        "glazing_materials": [m for m in mats if m["category"] == "glazing"],
        "wall_materials": [m for m in mats if m["category"] == "wall"],
        "frame_materials": [m for m in mats if m["category"] == "frame"],
        "roof_materials": [m for m in mats if m["category"] == "roof"],
        "brands": brands,
        "sc_to_shgc_ratio": SC_TO_SHGC_RATIO,
        "alpha_table_1": SNI_TABLE_1_ABSORPTANCE_MATERIALS,
        "alpha_table_2": SNI_TABLE_2_ABSORPTANCE_PAINTS,
    }


@app.post("/api/materials/validate")
def validate_material_endpoint(req: ValidateMaterialRequest) -> Dict[str, Any]:
    """Stateless custom material validator: returns normalized material with computed TD_EK, SC, and SHGC."""
    try:
        mat = validate_custom_material(req.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "status": "ok",
        "material": mat,
        "td_ek": mat.get("td_ek"),
        "sc": mat.get("sc"),
        "shgc": mat.get("shgc"),
    }


@app.get("/api/locations")
def list_locations() -> Dict[str, Any]:
    from sni_tables import SNI_TABLE_8_SOLAR_FACTOR, TEMPLATE_PRODI_SF_TABLE

    sni_cities = [
        {"id": slug, "city": entry["city"], "sf": entry["sf"]}
        for slug, entry in SNI_TABLE_8_SOLAR_FACTOR.items()
    ]
    template_prodi_cities = [
        {"id": slug, "city": entry["label"], "sf": entry["sf"]}
        for slug, entry in TEMPLATE_PRODI_SF_TABLE.items()
    ]
    return {
        "cities": list(INDONESIAN_CITY_PRESETS.values()),
        "sni_cities": sni_cities,
        "template_prodi_cities": template_prodi_cities,
        "sni_sf_anchors": [
            {"azimuth_deg": a, "code": c, "name": n, "sf_wm2": sf}
            for a, c, n, sf in SNI_SF_ANCHORS
        ],
    }


@app.post("/api/locations/parse-epw")
async def parse_epw_endpoint(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Stateless EPW parser: returns parsed EPW object to store inside ProjectConfig.settings.custom_epw."""
    raw_bytes = await file.read()
    text = raw_bytes.decode("utf-8", errors="ignore")
    try:
        parsed = parse_epw_content(text, file.filename or "custom.epw")
        return {"status": "ok", "custom_epw": parsed}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Gagal membaca file EPW: {exc}") from exc


@app.get("/api/locations/{city_id}/download-epw")
def download_sample_epw(city_id: str) -> FileResponse:
    city_key = city_id.lower() if city_id.lower() in INDONESIAN_CITY_PRESETS else "jakarta"
    epw_path = os.path.join(EPW_DIR, f"IDN_{city_key}_TMYx.epw")
    generate_sample_epw_file(epw_path, city_key)
    return FileResponse(epw_path, filename=f"IDN_{city_key}_SNI6389.epw", media_type="text/plain")


# ============================================================================
# UNIFIED MODELS & CONFIG ENDPOINTS
# ============================================================================

@app.get("/api/models")
def list_models() -> Dict[str, Any]:
    catalog, _ = get_dynamic_model_catalog(readonly=True)
    return {
        "models": catalog,
        "sni_sf_anchors": [
            {"azimuth_deg": a, "code": c, "name": n, "sf_wm2": sf}
            for a, c, n, sf in SNI_SF_ANCHORS
        ],
    }


@app.post("/api/models")
async def upload_model(file: UploadFile = File(...)) -> Dict[str, Any]:
    """
    Uploads a 3D model file, auto-detects its format/software via `detect_file_signature`,
    runs fast Stage 1 detection (unit, axis, bbox, missing_mesh), and returns `model_id`
    + detection summary + export tips. Does NOT require `source_software`.
    """
    raw_name = os.path.basename(file.filename or "uploaded_model.ifc")
    ext = os.path.splitext(raw_name.lower())[1]
    if ext not in ALLOWED_3D_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Format file '{ext}' tidak didukung. Gunakan {', '.join(ALLOWED_3D_EXTENSIONS)}.",
        )

    saved_path = os.path.join(UPLOADS_DIR, raw_name)
    content = await file.read()
    with open(saved_path, "wb") as out_f:
        out_f.write(content)

    try:
        resolved_path, resolved_name, unpack_notes = unpack_zip_bundle_if_needed(saved_path, UPLOADS_DIR)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    model_id = _slugify_filename(raw_name)
    sig = detect_file_signature(resolved_path)
    tips_info = get_export_tips(sig.get("detected_software"), sig.get("actual_ext"))

    try:
        raw_groups, audit = load_universal_model_stages_1_and_2(filepath=resolved_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Gagal membaca model 3D: {exc}") from exc

    saved_cfg = load_project_config(UPLOADS_DIR, model_id)
    default_cfg = saved_cfg if saved_cfg is not None else ProjectConfig()
    default_cfg.model.file = resolved_name

    catalog, _ = get_dynamic_model_catalog(readonly=True)
    return {
        "model_id": model_id,
        "filename": resolved_name,
        "file_signature": sig,
        "export_tips": tips_info,
        "unpack_notes": unpack_notes,
        "detection": {
            "geometry_kernel": audit.geometry_kernel,
            "detected_unit": audit.detected_unit,
            "detected_unit_label": audit.detected_unit if audit.detected_unit is not None else "tidak ada di file",
            "applied_unit": audit.applied_unit,
            "unit_source": audit.unit_source,
            "unit_needs_confirmation": audit.unit_needs_confirmation,
            "detected_up_axis": audit.detected_up_axis,
            "applied_up_axis": audit.applied_up_axis,
            "normalized_span_m": audit.normalized_span_m,
            "z_ground_offset_m": audit.z_ground_offset_m,
            "group_count": len(raw_groups),
            "unknown_groups": [rg.group_name for rg in raw_groups if rg.default_category == "unknown"],
            "missing_mesh": audit.missing_mesh,
            "filtered_items": audit.filtered_items,
            "bim_storeys_count": len(audit.bim_storeys),
            "notes": audit.notes,
        },
        "config": default_cfg.model_dump(mode="json"),
        "available_models": catalog,
    }


@app.get("/api/models/{model_id}/download")
def download_model_file(model_id: str) -> FileResponse:
    filepath, filename = _resolve_model_path_readonly(model_id)
    return FileResponse(filepath, filename=filename, media_type="application/octet-stream")


@app.get("/api/models/{model_id}/config")
def get_model_config(model_id: str) -> Dict[str, Any]:
    """Read-only retrieval of saved ProjectConfig v2 (migrates legacy v1 in memory if present)."""
    _, filename = _resolve_model_path_readonly(model_id)
    saved = load_project_config(UPLOADS_DIR, model_id)
    if saved is None:
        default_cfg = ProjectConfig()
        default_cfg.model.file = filename
        return {
            "model_id": model_id,
            "saved": False,
            "config": default_cfg.model_dump(mode="json"),
        }
    return {
        "model_id": model_id,
        "saved": True,
        "config": saved.model_dump(mode="json"),
    }


@app.put("/api/models/{model_id}/config")
def put_model_config(model_id: str, config: ProjectConfig) -> Dict[str, Any]:
    """Explicitly persists ProjectConfig (version=2) to `.ottv.json` on disk."""
    _, filename = _resolve_model_path_readonly(model_id)
    cfg = config.model_copy(deep=True)
    cfg.version = 2
    if not cfg.model.file:
        cfg.model.file = filename
    saved_path = save_project_config(UPLOADS_DIR, model_id, cfg)
    return {
        "status": "saved",
        "model_id": model_id,
        "config_path": os.path.basename(saved_path),
        "config": cfg.model_dump(mode="json"),
    }


@app.delete("/api/models/{model_id}")
def delete_uploaded_model(model_id: str) -> Dict[str, Any]:
    """Deletes a user-uploaded model, its .ottv.json config, and any unpacked .zip bundle."""
    if model_id in PRESET_DEFINITIONS:
        raise HTTPException(
            status_code=400,
            detail="Model sampel referensi bawaan tidak dapat dihapus. Hanya model unggahan pengguna yang dapat dihapus.",
        )

    deleted_files: List[str] = []
    if os.path.isdir(UPLOADS_DIR):
        for fname in list(os.listdir(UPLOADS_DIR)):
            fpath = os.path.join(UPLOADS_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            if _slugify_filename(fname) == model_id:
                os.remove(fpath)
                deleted_files.append(fname)
                if fname.lower().endswith(".zip"):
                    b_slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", os.path.splitext(fname)[0]).strip("_") or "bundle"
                    b_dir = os.path.join(UPLOADS_DIR, f"_bundle_{b_slug}")
                    if os.path.isdir(b_dir):
                        shutil.rmtree(b_dir, ignore_errors=True)
                base_no_ext = os.path.splitext(fname)[0]
                mtl_path = os.path.join(UPLOADS_DIR, f"{base_no_ext}.mtl")
                if os.path.isfile(mtl_path):
                    try:
                        os.remove(mtl_path)
                    except OSError:
                        pass

    if not deleted_files:
        raise HTTPException(status_code=404, detail=f"Model unggahan '{model_id}' tidak ditemukan.")

    cfg_path = get_project_config_path(UPLOADS_DIR, model_id, create_dir=False)
    if os.path.isfile(cfg_path):
        try:
            os.remove(cfg_path)
        except OSError:
            pass

    # Purge any in-memory analyses belonging to this deleted model
    for aid in [k for k, v in ANALYSIS_STORE.items() if v.get("model_id") == model_id]:
        ANALYSIS_STORE.pop(aid, None)

    catalog, _ = get_dynamic_model_catalog(readonly=True)
    return {
        "status": "deleted",
        "deleted_model_id": model_id,
        "deleted_files": deleted_files,
        "available_models": catalog,
    }


@app.post("/api/models/{model_id}/inspect")
def inspect_model(
    model_id: str,
    req: Optional[InspectRequest] = Body(default=None),
) -> Dict[str, Any]:
    """
    Strictly READ-ONLY fast 3D inspection (ZERO solar raycasting, ZERO disk writes).
    Accepts `model` + `roles` (+ optional `advanced`), or falls back to saved config / defaults.
    """
    target_path, target_name = _resolve_model_path_readonly(model_id)
    eff_req: InspectRequest
    if req is not None:
        eff_req = req
    else:
        saved = load_project_config(UPLOADS_DIR, model_id)
        eff_req = InspectRequest(
            model=saved.model,
            roles=saved.roles,
            advanced=saved.advanced,
        ) if saved is not None else InspectRequest()

    try:
        return build_staging_inspection_payload(
            filepath=target_path,
            display_filename=target_name,
            model_id=model_id,
            config=eff_req,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Gagal inspeksi model: {exc}") from exc


@app.post("/api/models/{model_id}/analyze")
def analyze_model(
    model_id: str,
    config: Optional[ProjectConfig] = Body(default=None),
) -> Dict[str, Any]:
    """
    Runs full OTTV analysis using unified `ProjectConfig`, stores the result under
    a unique `analysis_id`, and returns `{analysis_id, model_id, config, ...}`.
    Does NOT mutate saved `.ottv.json` on disk (explicit save is `PUT /api/models/{id}/config`).
    """
    target_path, target_name = _resolve_model_path_readonly(model_id)

    if config is not None:
        eff_cfg = config.model_copy(deep=True)
    else:
        saved = load_project_config(UPLOADS_DIR, model_id)
        eff_cfg = saved if saved is not None else ProjectConfig()

    if not eff_cfg.model.file:
        eff_cfg.model.file = target_name

    params = eff_cfg.to_envelope_parameters()
    try:
        result = analyze_building_ottv(target_path, target_name, params)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    analysis_id = uuid.uuid4().hex
    payload = dict(result)
    payload["analysis_id"] = analysis_id
    payload["model_id"] = model_id
    payload["config"] = eff_cfg.model_dump(mode="json")

    accepted_flags = [f for f in (eff_cfg.model.accepted_flags or []) if str(f).strip()]
    if accepted_flags:
        summary = dict(payload.get("summary") or {})
        warnings_list = list(summary.get("warnings") or payload.get("warnings") or [])
        flag_msg = (
            "Kejanggalan diterima tanpa perbaikan sebelum hitung: "
            + ", ".join(str(f) for f in accepted_flags)
            + "."
        )
        if flag_msg not in warnings_list:
            warnings_list.append(flag_msg)
        summary["warnings"] = warnings_list
        summary["is_provisional"] = True
        payload["summary"] = summary
        payload["warnings"] = warnings_list
        payload["status_label"] = "HASIL SEMENTARA — perlu konfirmasi"

    _store_analysis_record(analysis_id, payload)
    return payload


class RematerialRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    glazing_material_id: Optional[str] = None
    wall_material_id: Optional[str] = None
    frame_material_id: Optional[str] = None
    roof_material_id: Optional[str] = None
    orientation_material_overrides: Optional[Dict[str, str]] = None
    group_material_map: Optional[Dict[str, str]] = None
    custom_materials: List[Dict[str, Any]] = Field(default_factory=list)


class RecommendRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mode: Literal["target", "optimize"] = "target"
    target_type: str = "glazing_all"
    target_key: Optional[str] = None
    target_ottv_wm2: float = Field(default=35.0, ge=5.0, le=120.0)
    custom_materials: List[Dict[str, Any]] = Field(default_factory=list)
    filters: Dict[str, Any] = Field(default_factory=dict)
    constraints: Dict[str, Any] = Field(default_factory=dict)


@app.post("/api/analyses/{analysis_id}/rematerial")
def rematerial_analysis_endpoint(
    analysis_id: str,
    req: RematerialRequest,
) -> Dict[str, Any]:
    """
    Fast material swap recomputation reusing geometry & per-panel SF from `analysis_id`
    without reloading 3D geometry or raytracing (< 300 ms).
    """
    base = ANALYSIS_STORE.get(analysis_id)
    if base is None:
        raise HTTPException(
            status_code=404,
            detail=f"Analisis '{analysis_id}' tidak ditemukan atau sudah kedaluwarsa.",
        )

    updated = rematerial_analysis(
        base,
        glazing_material_id=req.glazing_material_id,
        wall_material_id=req.wall_material_id,
        frame_material_id=req.frame_material_id,
        roof_material_id=req.roof_material_id,
        orientation_material_overrides=req.orientation_material_overrides,
        group_material_map=req.group_material_map,
        custom_materials=req.custom_materials,
    )
    # Keep stored config in sync for exports & follow-up calls
    if isinstance(updated.get("config"), dict):
        cfg_s = updated["config"].setdefault("settings", {})
        if req.glazing_material_id is not None:
            cfg_s["glazing_material_id"] = req.glazing_material_id
        if req.wall_material_id is not None:
            cfg_s["wall_material_id"] = req.wall_material_id
        if req.frame_material_id is not None:
            cfg_s["frame_material_id"] = req.frame_material_id
        if req.roof_material_id is not None:
            cfg_s["roof_material_id"] = req.roof_material_id
        if req.orientation_material_overrides is not None:
            cfg_s["orientation_material_overrides"] = dict(req.orientation_material_overrides)
        if req.custom_materials:
            cfg_s["custom_materials"] = list(req.custom_materials)

    new_id = str(updated["analysis_id"])
    _store_analysis_record(new_id, updated)
    return updated


@app.post("/api/analyses/{analysis_id}/recommend")
def recommend_materials_endpoint(
    analysis_id: str,
    req: RecommendRequest,
) -> Dict[str, Any]:
    """
    Engine-accurate material recommender (per-group ranking or optimal multi-orientation combinations).
    Never accepts or stores user prices on the server (prices stay strictly client-side in luxa.prices.v1).
    """
    base = ANALYSIS_STORE.get(analysis_id)
    if base is None:
        raise HTTPException(
            status_code=404,
            detail=f"Analisis '{analysis_id}' tidak ditemukan atau sudah kedaluwarsa.",
        )

    if req.mode == "optimize":
        return optimize_material_combinations(
            base,
            target_ottv_wm2=req.target_ottv_wm2,
            extra_materials=req.custom_materials,
            prices_map=None,
            constraints=req.constraints,
        )
    return recommend_for_target(
        base,
        target_type=req.target_type,
        target_key=req.target_key,
        extra_materials=req.custom_materials,
        prices_map=None,
        filters=req.filters,
    )


@app.get("/api/analyses/{analysis_id}/exposure")
def get_analysis_exposure(
    analysis_id: str,
    date: str = "2026-09-23",
    hours: Optional[str] = None,
    north_angle_deg: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Computes hourly direct solar vectors (06:00..18:00) and per-panel sunlit flags
    for a stored `analysis_id` on any date `YYYY-MM-DD`, reusing the content-hashed
    raycast cache.
    """
    data = ANALYSIS_STORE.get(analysis_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Analisis '{analysis_id}' tidak ditemukan atau sudah kedaluwarsa.",
        )

    parsed_hours: Optional[List[int]] = None
    if hours:
        try:
            parsed_hours = [int(h.strip()) for h in hours.split(",") if h.strip()]
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="Parameter 'hours' harus berupa daftar jam bulat dipisahkan koma (mis. 6,7,...,18).",
            ) from exc

    try:
        return compute_panel_exposure_for_date(
            analysis_data=data,
            date_str=date,
            hours=parsed_hours,
            north_angle_deg=north_angle_deg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/analyses/{analysis_id}/export/{fmt}")
def export_analysis_report(analysis_id: str, fmt: str) -> Response:
    """Exports an analysis report (`xlsx` | `csv` | `pdf`) strictly by `analysis_id`."""
    data = ANALYSIS_STORE.get(analysis_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Analisis '{analysis_id}' tidak ditemukan atau sudah kedaluwarsa.",
        )

    fmt_lo = fmt.strip().lower()
    base = os.path.splitext(data.get("filename", "OTTV_Report"))[0]
    short_id = analysis_id[:8]

    if fmt_lo == "xlsx":
        xlsx_bytes = generate_excel_report(data)
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="Laporan_OTTV_{base}_{short_id}_SNI6389.xlsx"'},
        )
    if fmt_lo == "csv":
        csv_bytes = generate_csv_report(data)
        return Response(
            content=csv_bytes,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="Laporan_OTTV_{base}_{short_id}_SNI6389.csv"'},
        )
    if fmt_lo == "template_prodi":
        from report_template_map import export_template_prodi_xlsx

        try:
            tpl_bytes, tpl_warnings, _ = export_template_prodi_xlsx(data)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        headers = {
            "Content-Disposition": f'attachment; filename="Template_Prodi_OTTV_{base}_{short_id}.xlsx"',
        }
        if tpl_warnings:
            headers["X-Template-Warnings"] = " | ".join(tpl_warnings)[:1000]
        return Response(
            content=tpl_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers,
        )
    if fmt_lo == "pdf":
        pdf_bytes = generate_pdf_report(data)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="Laporan_OTTV_{base}_{short_id}_SNI6389.pdf"'},
        )
    raise HTTPException(
        status_code=400,
        detail=f"Format ekspor '{fmt}' tidak didukung. Gunakan 'xlsx', 'template_prodi', 'csv', atau 'pdf'.",
    )


FRONTEND_DIST_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend", "dist"))
if os.path.isdir(FRONTEND_DIST_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend_static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
