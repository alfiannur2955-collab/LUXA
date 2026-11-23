"""Fase 5b: backend/browser_api.py (engine without a server, used by the Pyodide worker)
must give the same answers as the FastAPI endpoints in main.py."""

import json
import os
import shutil
import sys

import pytest
from fastapi.testclient import TestClient

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT_DIR, "backend"))

import browser_api  # noqa: E402
import main as api_main  # noqa: E402

KOTAK = os.path.join(ROOT_DIR, "fixtures", "synthetic", "05_denah_L", "model.3dm")


@pytest.fixture()
def both(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(api_main, "UPLOADS_DIR", str(uploads))
    api_main.ANALYSIS_STORE.clear()
    browser_api.MODELS.clear()
    browser_api.ANALYSES.clear()
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setattr(browser_api, "WORK_DIR", str(work))
    with TestClient(api_main.app) as client:
        yield client, work


def _upload_both(client, work):
    with open(KOTAK, "rb") as fh:
        srv = client.post("/api/models", files={"file": ("denah_L.3dm", fh, "application/octet-stream")}).json()
    local_path = str(work / "denah_L.3dm")
    shutil.copy(KOTAK, local_path)
    up = browser_api.unpack_upload(local_path)
    assert up["needs_3dm_extract"] is True and up["filename"] == "denah_L.3dm"
    loc = browser_api.register_upload("m1", up["resolved_path"], up["filename"], up["resolved_path"], up["unpack_notes"])
    return srv, loc


def test_upload_inspect_analyze_match_server(both):
    client, work = both
    srv, loc = _upload_both(client, work)
    assert loc["detection"] == srv["detection"]
    assert loc["config"] == srv["config"]

    cfg = srv["config"]
    ins_s = client.post(f"/api/models/{srv['model_id']}/inspect", json={"model": cfg["model"], "roles": cfg["roles"]}).json()
    ins_l = browser_api.inspect("m1", {"model": cfg["model"], "roles": cfg["roles"]})
    assert [g["group_name"] for g in ins_l["groups"]] == [g["group_name"] for g in ins_s["groups"]]
    assert [f["code"] for f in ins_l.get("sanity_flags", [])] == [f["code"] for f in ins_s.get("sanity_flags", [])]

    an_s = client.post(f"/api/models/{srv['model_id']}/analyze", json=cfg).json()
    an_l = browser_api.analyze("m1", cfg)
    assert an_l["ottv_total_wm2"] == an_s["ottv_total_wm2"]
    assert len(an_l["panels"]) == len(an_s["panels"])

    ex_s = client.get(f"/api/analyses/{an_s['analysis_id']}/exposure", params={"date": "2026-09-23", "hours": "9,13"}).json()
    ex_l = browser_api.exposure(an_l["analysis_id"], "2026-09-23", [9, 13])
    ex_l = json.loads(json.dumps(ex_l, default=str))
    ex_l.pop("analysis_id", None)
    ex_s.pop("analysis_id", None)
    assert ex_l == ex_s

    patch = {"glazing_material_id": "glz_kaca_lowe_single_8"}
    rm_s = client.post(f"/api/analyses/{an_s['analysis_id']}/rematerial", json=patch).json()
    rm_l = browser_api.rematerial(an_l["analysis_id"], patch)
    assert rm_l["ottv_total_wm2"] == rm_s["ottv_total_wm2"]
    assert rm_l["geometry_from"] == "previous" and "vertices" not in rm_l["panels"][0]

    req = {"mode": "optimize", "target_ottv_wm2": 30.0}
    rc_s = client.post(f"/api/analyses/{an_s['analysis_id']}/recommend", json=req).json()
    rc_l = browser_api.recommend(an_l["analysis_id"], req)
    assert [o["option_id"] for o in rc_l["options"]] == [o["option_id"] for o in rc_s["options"]]

    for fmt in ("xlsx", "csv", "template_prodi"):
        out = browser_api.export_report(an_l["analysis_id"], fmt)
        srv_resp = client.get(f"/api/analyses/{an_s['analysis_id']}/export/{fmt}")
        assert srv_resp.status_code == 200 and len(out["bytes"]) > 1000
    with pytest.raises(browser_api.EngineError):
        browser_api.export_report(an_l["analysis_id"], "pdf")


def test_catalogues_match_server(both):
    client, _ = both
    assert browser_api.list_materials() == client.get("/api/materials").json()
    assert browser_api.list_locations() == client.get("/api/locations").json()
    assert browser_api.export_tips() == client.get("/api/export-tips").json()
    payload = {"name": "Kaca uji", "category": "glazing", "u_value": 2.0, "sc": 0.4, "vlt": 0.5}
    assert browser_api.validate_material(payload) == client.post("/api/materials/validate", json=payload).json()


def test_analysis_store_is_bounded_and_switching_model_clears(both):
    client, work = both
    _upload_both(client, work)
    browser_api._PINNED_ANALYSIS = None
    browser_api.ANALYSES.clear()
    n = browser_api.MAX_STORED_ANALYSES
    ids = [browser_api.analyze("m1")["analysis_id"] for _ in range(n + 1)]
    assert list(browser_api.ANALYSES) == ids[-n:]
    with pytest.raises(browser_api.EngineError) as e:
        browser_api.exposure(ids[0])
    assert e.value.status == 404


def test_old_template_prodi_format_returns_luxa_report(both):
    """Fase 5c: format 'template_prodi' dihapus; tautan lama mendapat laporan LUXA yang sama dengan xlsx."""
    client, work = both
    _upload_both(client, work)
    aid = browser_api.analyze("m1")["analysis_id"]
    old = browser_api.export_report(aid, "template_prodi")
    new = browser_api.export_report(aid, "xlsx")
    assert old["filename"] == new["filename"]
    assert old["filename"].startswith("Laporan_OTTV_LUXA_") and old["filename"].endswith(".xlsx")
    assert old["warnings"] == []
    import openpyxl, io
    assert openpyxl.load_workbook(io.BytesIO(old["bytes"])).sheetnames[:2] == ["Dasbor", "Ringkasan"]



def test_pinned_main_analysis_survives_alternatives_from_other_models(tmp_path):
    """Bandingkan 'Model lain': analisis proyek utama dipin dan tetap bisa diekspor/diubah
    setelah beberapa analisis model lain dihitung (dulu terbuang saat ganti model)."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    a_src = os.path.join(root, "fixtures", "synthetic", "09_sirip", "model.3dm")
    b_src = os.path.join(root, "fixtures", "synthetic", "01_kotak_m", "model.3dm")
    browser_api.register_upload("pin_a", a_src, "sirip.3dm", a_src)
    browser_api.register_upload("pin_b", b_src, "kotak.3dm", b_src)
    cfg = browser_api.default_config("sirip.3dm")
    cfg["model"]["model_scope"] = "full_building"
    main = browser_api.analyze("pin_a", cfg)
    assert browser_api.pin_analysis(main["analysis_id"])["exists"] is True
    try:
        _run_pin_checks(main, cfg)
    finally:
        browser_api._PINNED_ANALYSIS = None


def _run_pin_checks(main, cfg):
    for _ in range(browser_api.MAX_STORED_ANALYSES + 2):
        browser_api.analyze("pin_b", cfg)
    out = browser_api.export_report(main["analysis_id"], "csv")
    assert out["filename"].endswith(".csv") and len(out["bytes"]) > 100
    assert browser_api.pin_analysis("tidak_ada")["exists"] is False


def test_disabled_shading_group_changes_ottv():
    """Bandingkan 'matikan grup': mematikan grup peneduh menghapus bayangannya dari SCeff."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(root, "fixtures", "synthetic", "09_sirip", "model.3dm")
    browser_api.register_upload("dis_a", src, "sirip.3dm", src)
    cfg = browser_api.default_config("sirip.3dm")
    cfg["model"]["model_scope"] = "full_building"
    with_fins = browser_api.analyze("dis_a", cfg)
    shading = [g["group_name"] for g in with_fins["groups"] if g.get("category") == "shading"]
    assert shading
    cfg["roles"]["disabled_groups"] = shading
    no_fins = browser_api.analyze("dis_a", cfg)
    assert no_fins["ottv_total_wm2"] > with_fins["ottv_total_wm2"] + 0.5
