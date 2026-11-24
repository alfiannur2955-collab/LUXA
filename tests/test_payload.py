"""
A3-04 Fase 1: format kirim ramping (backend/payload.py) + pembongkar frontend (frontend/src/engine/payload.js).

Dijamin:
  - setiap field yang dipakai tampilan sama persis dengan hasil lengkap setelah dibongkar oleh adapter asli
  - ganti material yang dibongkar sama persis dengan hasil ganti material lengkap
  - ukuran kiriman di bawah anggaran
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from ottv_engine import EnvelopeParameters, analyze_building_ottv  # noqa: E402
from payload import ACTIVE_PANEL_FIELDS, REMATERIAL_FIELDS, slim_analysis, slim_rematerial  # noqa: E402
from recommender import rematerial_analysis  # noqa: E402

TWISTED = os.path.join(BACKEND_DIR, "samples", "Fasad_Tower_Twisted.3dm")
NODE = os.environ.get("NODE_EXE") or shutil.which("node")
SCRIPT = os.path.join(ROOT_DIR, "frontend", "scripts", "payload_roundtrip.mjs")

# Anggaran ukuran (byte JSON) untuk model twisted. Diturunkan lagi di Fase 2.
BUDGET_ANALYSIS = 9_000_000
BUDGET_REMATERIAL = 1_000_000


@pytest.fixture(scope="module")
def full():
    if not os.path.isfile(TWISTED):
        pytest.skip("sampel twisted tidak ada")
    p = EnvelopeParameters()
    p.calculation_mode = "sni"
    p.materials_confirmed = True
    r = analyze_building_ottv(TWISTED, "Fasad_Tower_Twisted.3dm", p)
    r["analysis_id"] = "base"
    return json.loads(json.dumps(r, default=str))


@pytest.fixture(scope="module")
def remat(full):
    r = rematerial_analysis(full, glazing_material_id="glz_kaca_lowe_single_8", materials_confirmed=True)
    return json.loads(json.dumps(r, default=str))


def _size(o) -> int:
    return len(json.dumps(o, ensure_ascii=False, default=str))


def test_ukuran_di_bawah_anggaran(full, remat):
    assert _size(slim_analysis(full)) < BUDGET_ANALYSIS
    assert _size(slim_rematerial(remat)) < BUDGET_REMATERIAL


def test_ringkasan_tidak_berubah(full):
    s = slim_analysis(full)
    for k in ("ottv_total_wm2", "summary", "orientation_breakdown", "floor_breakdown", "status_label", "rttv"):
        assert s[k] == full[k], k


@pytest.mark.skipif(not NODE, reason="Node.js tidak ada")
def test_adapter_frontend_membongkar_identik(full, remat, tmp_path):
    sp, rp, op, orp = (str(tmp_path / n) for n in ("slim.json", "remat.json", "out.json", "out_remat.json"))
    with open(sp, "w", encoding="utf-8") as f:
        json.dump(slim_analysis(full), f, ensure_ascii=False)
    with open(rp, "w", encoding="utf-8") as f:
        json.dump(slim_rematerial(remat), f, ensure_ascii=False)
    proc = subprocess.run([NODE, SCRIPT, sp, rp, op, orp], capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-2000:]
    out = json.load(open(op, encoding="utf-8"))
    out_r = json.load(open(orp, encoding="utf-8"))

    assert len(out["panels"]) == len(full["panels"])
    for a, b in zip(full["panels"], out["panels"]):
        assert a["id"] == b["id"]
        assert a["vertices"] == b["vertices"]
        if not a["active"]:
            continue
        for k in ACTIVE_PANEL_FIELDS:
            if k in a:
                assert b[k] == a[k], (a["id"], k, a[k], b[k])
        # engine membulatkan centroid ke mm; rata-rata vertex yang sudah dibulatkan bisa beda satu digit terakhir
        assert max(abs(x - y) for x, y in zip(a["centroid"], b["centroid"])) <= 0.0015

    for key in ("shading_elements", "frame_elements"):
        assert len(out[key]) == len(full[key])
        for ea, eb in zip(full[key], out[key]):
            assert eb["faces"] == ea["faces"]
            assert max(abs(x - y) for va, vb in zip(ea["vertices"], eb["vertices"]) for x, y in zip(va, vb)) <= 1e-3

    assert out_r["ottv_total_wm2"] == remat["ottv_total_wm2"]
    assert out_r["status_label"] == remat["status_label"]
    for a, b in zip(remat["panels"], out_r["panels"]):
        assert a["vertices"] == b["vertices"]
        if a["active"]:
            for k in REMATERIAL_FIELDS:
                assert b[k] == a[k], (a["id"], k)
