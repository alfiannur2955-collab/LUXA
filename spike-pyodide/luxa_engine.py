"""Fase 5a spike: Python side of the in-browser engine (runs inside Pyodide).

Mirrors the FastAPI endpoints that frontend/src/engine.js calls, so Fase 5b only
has to swap engine.js' fetch() calls for worker messages:
  inspect   -> POST /api/models/{id}/inspect
  analyze   -> POST /api/models/{id}/analyze
  exposure  -> GET  /api/analyses/{id}/exposure
  export    -> GET  /api/analyses/{id}/export/{fmt}   (xlsx, csv)
  rematerial / recommend / list_materials
All inputs and outputs are JSON strings (export returns bytes).
"""

import json
import sys
import time
import types
import uuid
from collections import OrderedDict


class _Any:
    def __init__(self, *a, **k):
        pass


def _install_rhino_stub() -> None:
    """rhino3dm (C++) has no Pyodide build; .3dm files are read by rhino3dm.js in JS."""
    mod = types.ModuleType("rhino3dm")
    mod.__getattr__ = lambda name: type(name, (_Any,), {})  # PEP 562
    sys.modules["rhino3dm"] = mod


_install_rhino_stub()
if "/backend" not in sys.path:
    sys.path.insert(0, "/backend")

_t0 = time.perf_counter()
from adapters import build_staging_inspection_payload  # noqa: E402
from config_schema import InspectRequest, ProjectConfig  # noqa: E402
from materials_and_epw import get_all_materials  # noqa: E402
from ottv_engine import analyze_building_ottv, compute_panel_exposure_for_date  # noqa: E402
from recommender import optimize_material_combinations, recommend_for_target, rematerial_analysis  # noqa: E402
from report_exporter import generate_csv_report, generate_excel_report  # noqa: E402

IMPORT_SECONDS = time.perf_counter() - _t0

MODELS = {}  # model_id -> (fs_path, display_name)
ANALYSES: "OrderedDict[str, dict]" = OrderedDict()  # small LRU like ANALYSIS_STORE
MAX_ANALYSES = 4
LAST_TIMING = {}


def _store(aid: str, payload: dict) -> None:
    ANALYSES[aid] = payload
    ANALYSES.move_to_end(aid)
    while len(ANALYSES) > MAX_ANALYSES:
        ANALYSES.popitem(last=False)


def _dump(obj) -> str:
    t = time.perf_counter()
    s = json.dumps(obj, ensure_ascii=False, default=str)
    LAST_TIMING["json_dump_s"] = round(time.perf_counter() - t, 3)
    LAST_TIMING["json_mb"] = round(len(s) / 1048576, 2)
    return s


def register_model(model_id: str, fs_path: str, display_name: str) -> None:
    MODELS[model_id] = (fs_path, display_name)


def inspect(model_id: str, req_json: str = "") -> str:
    path, name = MODELS[model_id]
    req = InspectRequest.model_validate_json(req_json) if req_json else InspectRequest()
    t = time.perf_counter()
    out = build_staging_inspection_payload(filepath=path, display_filename=name, model_id=model_id, config=req)
    LAST_TIMING["py_s"] = round(time.perf_counter() - t, 3)
    return _dump(out)


def analyze(model_id: str, config_json: str = "") -> str:
    path, name = MODELS[model_id]
    cfg = ProjectConfig.model_validate_json(config_json) if config_json else ProjectConfig()
    if not cfg.model.file:
        cfg.model.file = name
    t = time.perf_counter()
    result = analyze_building_ottv(path, name, cfg.to_envelope_parameters())
    LAST_TIMING["py_s"] = round(time.perf_counter() - t, 3)
    aid = uuid.uuid4().hex
    payload = dict(result)
    payload.update({"analysis_id": aid, "model_id": model_id, "config": cfg.model_dump(mode="json")})
    _store(aid, payload)
    return _dump(payload)


def exposure(analysis_id: str, date: str, hours_json: str = "", north=None) -> str:
    hours = json.loads(hours_json) if hours_json else None
    t = time.perf_counter()
    out = compute_panel_exposure_for_date(
        analysis_data=ANALYSES[analysis_id], date_str=date, hours=hours, north_angle_deg=north
    )
    LAST_TIMING["py_s"] = round(time.perf_counter() - t, 3)
    return _dump(out)


def export_report(analysis_id: str, fmt: str = "xlsx") -> bytes:
    data = ANALYSES[analysis_id]
    t = time.perf_counter()
    if fmt == "xlsx":
        out = generate_excel_report(data)
    elif fmt == "csv":
        out = generate_csv_report(data)
    else:
        raise ValueError(f"Format '{fmt}' belum tersedia di versi browser (spike).")
    LAST_TIMING["py_s"] = round(time.perf_counter() - t, 3)
    return out if isinstance(out, (bytes, bytearray)) else str(out).encode("utf-8")


def rematerial(analysis_id: str, patch_json: str) -> str:
    patch = json.loads(patch_json)
    t = time.perf_counter()
    updated = rematerial_analysis(ANALYSES[analysis_id], **patch)
    LAST_TIMING["py_s"] = round(time.perf_counter() - t, 3)
    _store(str(updated["analysis_id"]), updated)
    return _dump(updated)


def recommend(analysis_id: str, req_json: str) -> str:
    req = json.loads(req_json)
    base = ANALYSES[analysis_id]
    t = time.perf_counter()
    if req.get("mode") == "optimize":
        out = optimize_material_combinations(
            base, target_ottv_wm2=float(req.get("target_ottv_wm2", 35.0)),
            extra_materials=req.get("custom_materials") or [], prices_map=None,
            constraints=req.get("constraints") or {},
        )
    else:
        out = recommend_for_target(
            base, target_type=req.get("target_type", "glazing_all"), target_key=req.get("target_key"),
            extra_materials=req.get("custom_materials") or [], prices_map=None, filters=req.get("filters") or {},
        )
    LAST_TIMING["py_s"] = round(time.perf_counter() - t, 3)
    return _dump(out)


def list_materials() -> str:
    mats = get_all_materials()
    return _dump({"materials": mats})


def last_timing() -> str:
    return json.dumps(LAST_TIMING)


def run_analysis(path: str, name: str) -> str:
    """Node probe helper: analyze a file path with the default config, return a summary."""
    mid = "probe-" + name
    register_model(mid, path, name)
    full = json.loads(analyze(mid))
    return json.dumps({
        "ottv_total_wm2": full.get("ottv_total_wm2"),
        "rttv_wm2": (full.get("rttv") or {}).get("rttv_wm2"),
        "panels": len(full.get("panels") or []),
        "py_seconds": LAST_TIMING.get("py_s"),
        "json_mb": LAST_TIMING.get("json_mb"),
        "json_dump_s": LAST_TIMING.get("json_dump_s"),
    })
