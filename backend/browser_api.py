"""
LUXA engine API without a server (Fase 5b).

The same operations as the FastAPI endpoints in main.py, as plain functions that take and
return JSON-friendly Python objects. The in-browser engine (frontend/src/engine/worker.js,
Pyodide) calls these; tests/test_browser_api.py checks them against main.py so the two
modes cannot drift apart.

Files live in the Pyodide virtual filesystem under /work. A `.3dm` file arrives already
converted to `<name>.3dm.json` by rhino3dm.js (see universal_pipeline `.3dm.json` branch).
"""

from __future__ import annotations

import gc
import os
import uuid
from payload import slim_analysis, slim_rematerial
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

import ottv_engine
import universal_pipeline
from adapters import (
    EXPORT_TIPS_BY_SOURCE,
    build_staging_inspection_payload,
    detect_file_signature,
    get_export_tips,
    unpack_zip_bundle_if_needed,
)
from config_schema import InspectRequest, ProjectConfig, ValidateMaterialRequest
from materials_and_epw import (
    INDONESIAN_CITY_PRESETS,
    SC_TO_SHGC_RATIO,
    get_all_materials,
    parse_epw_content,
    validate_custom_material,
)
from ottv_engine import (
    SNI_SF_ANCHORS,
    analyze_building_ottv,
    compute_panel_exposure_for_date,
)
from recommender import optimize_material_combinations, recommend_for_target, rematerial_analysis
from universal_pipeline import load_universal_model_stages_1_and_2

ALLOWED_3D_EXTENSIONS = (".3dm", ".obj", ".ifc", ".glb", ".gltf", ".hbjson", ".json", ".stl", ".ply", ".zip")
WORK_DIR = "/work"
MAX_STORED_ANALYSES = 3  # browser memory budget (server keeps 64); the pinned main analysis is extra

MODELS: Dict[str, Tuple[str, str]] = {}  # model_id -> (fs_path, display_name)
ANALYSES: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
_ACTIVE_MODEL: Optional[str] = None
_PINNED_ANALYSIS: Optional[str] = None  # analisis proyek utama; tidak pernah dibuang


class EngineError(Exception):
    """User-facing error; `status` mirrors the HTTP status main.py would return."""

    def __init__(self, detail: str, status: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status = status


# --------------------------------------------------------------------------
# Memory housekeeping
# --------------------------------------------------------------------------

def _store_analysis(aid: str, payload: Dict[str, Any]) -> None:
    ANALYSES[aid] = payload
    ANALYSES.move_to_end(aid)
    evictable = [k for k in ANALYSES if k != _PINNED_ANALYSIS]
    while len(evictable) > MAX_STORED_ANALYSES:
        ANALYSES.pop(evictable.pop(0), None)


def pin_analysis(analysis_id: str) -> Dict[str, Any]:
    """Tandai analisis proyek utama supaya tidak terbuang saat alternatif (atau model lain) dihitung.
    Mengembalikan exists=False bila analisis itu sudah tidak ada (frontend lalu menghitung ulang)."""
    global _PINNED_ANALYSIS
    exists = analysis_id in ANALYSES
    if exists:
        _PINNED_ANALYSIS = analysis_id
    return {"exists": exists, "pinned": _PINNED_ANALYSIS}


def _get_analysis(aid: str) -> Dict[str, Any]:
    data = ANALYSES.get(aid)
    if data is None:
        raise EngineError(f"Analisis '{aid}' tidak ditemukan atau sudah kedaluwarsa. Hitung ulang OTTV.", 404)
    return data


def _switch_model(model_id: str) -> None:
    """Drop geometry caches of other models so the WASM heap stays bounded."""
    global _ACTIVE_MODEL
    if _ACTIVE_MODEL == model_id:
        return
    _ACTIVE_MODEL = model_id
    for mod in (universal_pipeline, ottv_engine):
        for name in ("_UNIVERSAL_FILE_CACHE", "_RAYCAST_TRI_CACHE"):
            cache = getattr(mod, name, None)
            if hasattr(cache, "clear"):
                cache.clear()
    # Analisis model lain tetap disimpan (dibatasi oleh _store_analysis), supaya proyek utama tetap
    # bisa diekspor/diubah materialnya setelah alternatif model lain dihitung di Bandingkan.
    gc.collect()


def enable_ifc() -> bool:
    """Called after the worker installed the IfcOpenShell wheels (loaded on first .ifc)."""
    import ifcopenshell  # noqa: F401
    import ifcopenshell.geom  # noqa: F401
    import ifcopenshell.util.unit  # noqa: F401

    import loaders.ifc as ifc_loader

    ifc_loader.ifcopenshell = ifcopenshell
    ifc_loader.HAS_IFCOPENSHELL = True
    universal_pipeline.ifcopenshell = ifcopenshell
    universal_pipeline.HAS_IFCOPENSHELL = True
    return True


def _resolve(model_id: str) -> Tuple[str, str]:
    if model_id not in MODELS:
        raise EngineError(f"Model '{model_id}' tidak ditemukan.", 404)
    _switch_model(model_id)
    return MODELS[model_id]


# --------------------------------------------------------------------------
# Models & config
# --------------------------------------------------------------------------

def unpack_upload(fs_path: str) -> Dict[str, Any]:
    """Step 1 of upload: unzip if needed. Tells JS when a .3dm must be converted first."""
    ext = os.path.splitext(fs_path.lower())[1]
    if ext not in ALLOWED_3D_EXTENSIONS:
        raise EngineError(f"Format file '{ext}' tidak didukung. Gunakan {', '.join(ALLOWED_3D_EXTENSIONS)}.")
    try:
        resolved, name, notes = unpack_zip_bundle_if_needed(fs_path, WORK_DIR)
    except Exception as exc:
        raise EngineError(str(exc)) from exc
    return {
        "resolved_path": resolved,
        "filename": name,
        "unpack_notes": notes,
        "needs_3dm_extract": resolved.lower().endswith(".3dm"),
        "needs_ifc": resolved.lower().endswith(".ifc"),
    }


def register_upload(model_id: str, engine_path: str, display_name: str, sig_path: str,
                    unpack_notes: Optional[List[str]] = None) -> Dict[str, Any]:
    """Step 2 of upload: Stage 1 detection, same payload as POST /api/models."""
    MODELS[model_id] = (engine_path, display_name)
    _switch_model(model_id)
    sig = detect_file_signature(sig_path)
    tips_info = get_export_tips(sig.get("detected_software"), sig.get("actual_ext"))
    try:
        raw_groups, audit = load_universal_model_stages_1_and_2(filepath=engine_path)
    except Exception as exc:
        raise EngineError(f"Gagal membaca model 3D: {exc}") from exc
    cfg = ProjectConfig()
    cfg.model.file = display_name
    return {
        "model_id": model_id,
        "filename": display_name,
        "file_signature": sig,
        "export_tips": tips_info,
        "unpack_notes": list(unpack_notes or []),
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
        "config": cfg.model_dump(mode="json"),
    }


def register_model(model_id: str, engine_path: str, display_name: str) -> None:
    """Re-register a model after a page reload (bytes restored from IndexedDB)."""
    MODELS[model_id] = (engine_path, display_name)


def default_config(display_name: str) -> Dict[str, Any]:
    cfg = ProjectConfig()
    cfg.model.file = display_name
    return cfg.model_dump(mode="json")


def normalize_config(config: Dict[str, Any], display_name: str) -> Dict[str, Any]:
    """Validate + migrate a stored config like PUT /api/models/{id}/config."""
    cfg = ProjectConfig.model_validate(config or {})
    cfg.version = 2
    if not cfg.model.file:
        cfg.model.file = display_name
    return cfg.model_dump(mode="json")


# --------------------------------------------------------------------------
# Inspect / analyze / exposure / export
# --------------------------------------------------------------------------

def inspect(model_id: str, req: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    path, name = _resolve(model_id)
    eff = InspectRequest.model_validate(req) if req else InspectRequest()
    try:
        return build_staging_inspection_payload(filepath=path, display_filename=name, model_id=model_id, config=eff)
    except Exception as exc:
        raise EngineError(f"Gagal inspeksi model: {exc}") from exc


def analyze(model_id: str, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    path, name = _resolve(model_id)
    eff_cfg = ProjectConfig.model_validate(config) if config else ProjectConfig()
    if not eff_cfg.model.file:
        eff_cfg.model.file = name
    try:
        result = analyze_building_ottv(path, name, eff_cfg.to_envelope_parameters())
    except Exception as exc:
        raise EngineError(str(exc)) from exc

    aid = uuid.uuid4().hex
    payload = dict(result)
    payload["analysis_id"] = aid
    payload["model_id"] = model_id
    payload["config"] = eff_cfg.model_dump(mode="json")

    accepted_flags = [f for f in (eff_cfg.model.accepted_flags or []) if str(f).strip()]
    if accepted_flags:
        summary = dict(payload.get("summary") or {})
        warnings_list = list(summary.get("warnings") or payload.get("warnings") or [])
        flag_msg = "Catatan pemeriksaan diterima tanpa perbaikan sebelum hitung: " + ", ".join(str(f) for f in accepted_flags) + "."
        if flag_msg not in warnings_list:
            warnings_list.append(flag_msg)
        summary["warnings"] = warnings_list
        summary["is_provisional"] = True
        payload["summary"] = summary
        payload["warnings"] = warnings_list
        payload["status_label"] = "HASIL SEMENTARA — perlu konfirmasi"

    _store_analysis(aid, payload)
    return slim_analysis(payload)  # A3-04: engine simpan versi lengkap, tampilan menerima versi ramping


def exposure(analysis_id: str, date: str = "2026-09-23", hours: Optional[List[int]] = None,
             north_angle_deg: Optional[float] = None) -> Dict[str, Any]:
    data = _get_analysis(analysis_id)
    try:
        return compute_panel_exposure_for_date(
            analysis_data=data, date_str=date, hours=hours, north_angle_deg=north_angle_deg,
        )
    except ValueError as exc:
        raise EngineError(str(exc)) from exc


def export_report(analysis_id: str, fmt: str) -> Dict[str, Any]:
    """Returns {bytes, filename, media_type, warnings}. PDF needs reportlab (server only)."""
    data = _get_analysis(analysis_id)
    fmt_lo = (fmt or "").strip().lower()
    if fmt_lo == "template_prodi":  # format lama dihapus di Fase 5c
        fmt_lo = "xlsx"
    from report_exporter import report_filename

    if fmt_lo == "xlsx":
        from report_exporter import generate_excel_report

        return {"bytes": generate_excel_report(data), "filename": report_filename(data, "xlsx"),
                "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "warnings": []}
    if fmt_lo == "csv":
        from report_exporter import generate_csv_report

        return {"bytes": generate_csv_report(data), "filename": report_filename(data, "csv"),
                "media_type": "text/csv; charset=utf-8", "warnings": []}
    if fmt_lo == "pdf":
        raise EngineError("Laporan PDF belum tersedia di versi browser. Unduh versi Excel.", 400)
    raise EngineError(f"Format laporan '{fmt}' tidak dikenal.", 400)


def rematerial(analysis_id: str, req: Dict[str, Any]) -> Dict[str, Any]:
    base = _get_analysis(analysis_id)
    keys = ("glazing_material_id", "wall_material_id", "frame_material_id", "roof_material_id",
            "frame_width_mm", "orientation_material_overrides", "group_material_map")
    kwargs = {k: req.get(k) for k in keys}
    kwargs["custom_materials"] = list(req.get("custom_materials") or [])
    kwargs["materials_confirmed"] = req.get("materials_confirmed")
    updated = rematerial_analysis(base, **kwargs)
    if isinstance(updated.get("config"), dict):
        cfg_s = updated["config"].setdefault("settings", {})
        for k in ("glazing_material_id", "wall_material_id", "frame_material_id", "roof_material_id"):
            if req.get(k) is not None:
                cfg_s[k] = req[k]
        if req.get("frame_width_mm") is not None:
            cfg_s["frame_width_mm"] = float(req["frame_width_mm"])
        if req.get("orientation_material_overrides") is not None:
            cfg_s["orientation_material_overrides"] = dict(req["orientation_material_overrides"])
        if req.get("custom_materials"):
            cfg_s["custom_materials"] = list(req["custom_materials"])
        if req.get("materials_confirmed") is not None:
            cfg_s["materials_confirmed"] = bool(req["materials_confirmed"])
    _store_analysis(str(updated["analysis_id"]), updated)
    return slim_rematerial(updated)  # A3-04: hanya kolom angka panel yang berubah


def recommend(analysis_id: str, req: Dict[str, Any]) -> Dict[str, Any]:
    base = _get_analysis(analysis_id)
    if req.get("mode") == "optimize":
        return optimize_material_combinations(
            base, target_ottv_wm2=float(req.get("target_ottv_wm2", 35.0)),
            extra_materials=req.get("custom_materials") or [], prices_map=None,
            constraints=req.get("constraints") or {},
        )
    return recommend_for_target(
        base, target_type=req.get("target_type", "glazing_all"), target_key=req.get("target_key"),
        extra_materials=req.get("custom_materials") or [], prices_map=None, filters=req.get("filters") or {},
    )


# --------------------------------------------------------------------------
# Catalogues
# --------------------------------------------------------------------------

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


def validate_material(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        mat = validate_custom_material(ValidateMaterialRequest.model_validate(payload or {}).model_dump())
    except ValueError as exc:
        raise EngineError(str(exc), 422) from exc
    return {"status": "ok", "material": mat, "td_ek": mat.get("td_ek"), "sc": mat.get("sc"), "shgc": mat.get("shgc")}


def list_locations() -> Dict[str, Any]:
    from sni_tables import SNI_TABLE_8_SOLAR_FACTOR, TEMPLATE_PRODI_SF_TABLE

    return {
        "cities": list(INDONESIAN_CITY_PRESETS.values()),
        "sni_cities": [{"id": s, "city": e["city"], "sf": e["sf"]} for s, e in SNI_TABLE_8_SOLAR_FACTOR.items()],
        "template_prodi_cities": [{"id": s, "city": e["label"], "sf": e["sf"]} for s, e in TEMPLATE_PRODI_SF_TABLE.items()],
        "sni_sf_anchors": [{"azimuth_deg": a, "code": c, "name": n, "sf_wm2": sf} for a, c, n, sf in SNI_SF_ANCHORS],
    }


def export_tips() -> Dict[str, Any]:
    return {"sources": list(EXPORT_TIPS_BY_SOURCE.values()), "allowed_extensions": list(ALLOWED_3D_EXTENSIONS)}


def parse_epw(text: str, filename: str) -> Dict[str, Any]:
    try:
        return {"status": "ok", "custom_epw": parse_epw_content(text, filename or "custom.epw")}
    except Exception as exc:
        raise EngineError(f"Gagal membaca file EPW: {exc}") from exc


# --------------------------------------------------------------------------
# Single entry point for the Web Worker
# --------------------------------------------------------------------------

_OPS = {
    "unpack_upload": unpack_upload,
    "register_upload": register_upload,
    "register_model": register_model,
    "default_config": default_config,
    "normalize_config": normalize_config,
    "inspect": inspect,
    "analyze": analyze,
    "exposure": exposure,
    "export_report": export_report,
    "rematerial": rematerial,
    "pin_analysis": pin_analysis,
    "recommend": recommend,
    "list_materials": list_materials,
    "validate_material": validate_material,
    "list_locations": list_locations,
    "export_tips": export_tips,
    "parse_epw": parse_epw,
    "enable_ifc": enable_ifc,
}


def dispatch(op: str, args_json: str) -> str:
    """Run one operation; always returns a JSON string {ok, result} or {ok: false, detail, status}.
    Bytes (reports) are returned base64-encoded under result.bytes_b64."""
    import base64
    import json
    import traceback

    try:
        fn = _OPS[op]
        kwargs = json.loads(args_json) if args_json else {}
        result = fn(**kwargs)
        if isinstance(result, dict) and isinstance(result.get("bytes"), (bytes, bytearray)):
            result = dict(result)
            result["bytes_b64"] = base64.b64encode(result.pop("bytes")).decode("ascii")
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False, default=str)
    except EngineError as exc:
        return json.dumps({"ok": False, "detail": exc.detail, "status": exc.status})
    except KeyError as exc:
        if op not in _OPS:
            return json.dumps({"ok": False, "detail": f"Operasi engine '{op}' tidak dikenal.", "status": 400})
        return json.dumps({"ok": False, "detail": f"Data tidak lengkap: {exc}", "status": 400,
                           "trace": traceback.format_exc()[-1500:]})
    except Exception as exc:  # unexpected: keep the trace for the console
        return json.dumps({"ok": False, "detail": str(exc) or exc.__class__.__name__, "status": 500,
                           "trace": traceback.format_exc()[-1500:]})
