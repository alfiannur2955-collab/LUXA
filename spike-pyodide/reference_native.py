"""Fase 5a spike: OTTV reference values from the native backend (CPython).

Run from the repo root:  python spike-pyodide/reference_native.py
Writes spike-pyodide/results/reference_native.json
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from config_schema import ProjectConfig  # noqa: E402
from ottv_engine import analyze_building_ottv  # noqa: E402

out = {}
for fx in json.loads((ROOT / "spike-pyodide" / "fixtures.json").read_text()):
    p = ROOT / fx["path"]
    if not p.is_file():
        out[fx["id"]] = {"skipped": "file not present"}
        continue
    t0 = time.perf_counter()
    res = analyze_building_ottv(str(p), p.name, ProjectConfig().to_envelope_parameters())
    dt = time.perf_counter() - t0
    out[fx["id"]] = {
        "ottv_total_wm2": res.get("ottv_total_wm2"),
        "rttv_wm2": (res.get("rttv") or {}).get("rttv_wm2"),
        "panels": len(res.get("panels") or []),
        "seconds": round(dt, 2),
    }
    print(fx["id"], out[fx["id"]], flush=True)

(ROOT / "spike-pyodide" / "results").mkdir(exist_ok=True)
(ROOT / "spike-pyodide" / "results" / "reference_native.json").write_text(json.dumps(out, indent=1))
