"""
Uji A3-19 — Belajar OTTV memakai U_f tiga zona (kusen aluminium 8,0, lebar 50 mm)
==================================================================================
1. `threeZoneUf` (frontend/src/learn/ottvCalc.js) cocok dengan contoh Lampiran C (U_f = 4,75)
   dan dengan `compute_three_zone_uf` di engine Python untuk panel contoh Belajar.
2. `frontend/src/learn3d/sim.js` memakai U_f tiga zona (bukan U kaca saja).
3. Materi Belajar memuat kalimat jembatan termal dengan rujukan SNI 3.8 dan 4.3.2.2.
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

from ottv_engine import compute_three_zone_uf  # noqa: E402

FRONT = os.path.join(ROOT_DIR, "frontend", "src")


def _node_eval(code: str) -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js tidak tersedia")
    proc = subprocess.run(
        [node, "--input-type=module", "-e", code],
        cwd=os.path.join(ROOT_DIR, "frontend"),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_three_zone_uf_js_matches_lampiran_c_and_engine():
    url = "file:///" + os.path.join(FRONT, "learn", "ottvCalc.js").replace("\\", "/")
    out = _node_eval(
        f"""
import {{ threeZoneUf, U_FRAME_ALUMINIUM, FRAME_WIDTH_M }} from '{url}';
const lc = threeZoneUf({{ width: 1, height: 1, uCog: 3.0, uFrame: 8.0, frameWidth: 0.05 }});
const panel = threeZoneUf({{ width: 1.5, height: 1.6, uCog: 5.5 }});
console.log(JSON.stringify({{ lc, panel, uFrame: U_FRAME_ALUMINIUM, fw: FRAME_WIDTH_M }}));
"""
    )
    assert out["uFrame"] == 8.0
    assert out["fw"] == 0.05
    lc = out["lc"]
    assert abs(lc["uf"] - 4.75) < 1e-9
    assert abs(lc["aFrame"] - 0.19) < 1e-9
    assert abs(lc["aEdge"] - 0.32) < 1e-9
    assert abs(lc["aCog"] - 0.49) < 1e-9

    py = compute_three_zone_uf(area_m2=1.5 * 1.6, perimeter_m=2 * (1.5 + 1.6), u_cog=5.5, u_frame=8.0, frame_width_m=0.05)
    assert abs(out["panel"]["uf"] - py["u_f"]) < 1e-9
    assert out["panel"]["uf"] > 5.5  # kusen aluminium menaikkan U jendela


def test_learn3d_sim_uses_three_zone_uf():
    src = open(os.path.join(FRONT, "learn3d", "sim.js"), encoding="utf-8").read()
    assert "threeZoneUf" in src
    assert "U_FRAME_ALUMINIUM" in src and "FRAME_WIDTH_M" in src
    assert "uf: tz.uf" in src
    assert "uf: g.u_value" not in src
    story = open(os.path.join(FRONT, "learn3d", "story.js"), encoding="utf-8").read()
    assert "uf: fmt(w.uf, 2)" in story


def test_learn3d_content_thermal_bridge_sentence():
    src = open(os.path.join(FRONT, "learn3d", "content.js"), encoding="utf-8").read()
    assert "jembatan termal" in src
    assert "3.8" in src and "4.3.2.2" in src
    assert "THERMAL_BRIDGE_TEXT" in src
