"""Fase 5b: the in-browser engine (Pyodide, same assets the app ships in frontend/public/luxa-engine)
must match the native backend within 0.01 W/m2 on 5 fixtures.

Skipped when Node.js or the engine assets are missing (run `npm run engine:fetch` and
`npm run engine:assets` in frontend/ first)."""

import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import browser_api  # noqa: E402

FIXTURES = [
    "fixtures/synthetic/01_kotak_m/model.3dm",
    "fixtures/synthetic/07_silinder/model.3dm",
    "fixtures/synthetic/11_blok_bersarang/model.3dm",
    "fixtures/synthetic/01_kotak_m/model.obj",
    "fixtures/archicad_bim_curtainwall.ifc",
]
SCRIPT = os.path.join(ROOT, "frontend", "scripts", "engine_parity.mjs")
MANIFEST = os.path.join(ROOT, "frontend", "public", "luxa-engine", "manifest.json")
NODE = os.environ.get("NODE_EXE") or shutil.which("node")


def _native(rel: str) -> dict:
    src = os.path.join(ROOT, rel)
    mid = "native-" + rel.replace("/", "_")
    browser_api.register_upload(mid, src, os.path.basename(src), src)
    cfg = browser_api.default_config(os.path.basename(src))
    cfg["model"]["model_scope"] = "full_building"
    res = browser_api.analyze(mid, cfg)
    return {"ottv_total_wm2": res["ottv_total_wm2"], "panels": len(res["panels"])}


@pytest.mark.skipif(not NODE or not os.path.isfile(MANIFEST), reason="Node.js atau aset engine browser tidak ada")
def test_browser_engine_matches_native_on_5_fixtures() -> None:
    proc = subprocess.run(
        [NODE, SCRIPT, *[os.path.join(ROOT, f) for f in FIXTURES]],
        capture_output=True, text=True, timeout=600, cwd=ROOT,
    )
    line = next((ln for ln in proc.stdout.splitlines() if ln.startswith("PARITY_JSON ")), None)
    assert line, f"engine_parity.mjs gagal:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
    browser = json.loads(line[len("PARITY_JSON "):])
    for rel in FIXTURES:
        b = browser[os.path.join(ROOT, rel)]
        assert "error" not in b, f"{rel}: {b.get('error')}"
        n = _native(rel)
        assert abs(b["ottv_total_wm2"] - n["ottv_total_wm2"]) <= 0.01, f"{rel}: browser {b} vs native {n}"
        assert b["panels"] == n["panels"], f"{rel}: browser {b} vs native {n}"
