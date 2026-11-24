"""Ukuran hasil yang dikirim ke tampilan, lengkap vs ramping (A3-04). Pakai: python tools/payload_report.py [model ...]"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from ottv_engine import EnvelopeParameters, analyze_building_ottv  # noqa: E402
from payload import slim_analysis, slim_rematerial  # noqa: E402
from recommender import rematerial_analysis  # noqa: E402

models = sys.argv[1:] or [os.path.join(ROOT, "backend", "samples", "Fasad_Tower_Twisted.3dm")]
size = lambda o: len(json.dumps(o, ensure_ascii=False, default=str)) / 1e6  # noqa: E731
for fp in models:
    p = EnvelopeParameters()
    p.calculation_mode = "sni"
    p.materials_confirmed = True
    full = analyze_building_ottv(fp, os.path.basename(fp), p)
    full["analysis_id"] = "x"
    slim = slim_analysis(full)
    rm = rematerial_analysis(full, glazing_material_id="glz_kaca_lowe_single_8", materials_confirmed=True)
    print(f"{os.path.basename(fp)}: panel {len(full['panels'])}")
    print(f"  hasil   lengkap {size(full):6.2f} MB -> ramping {size(slim):6.2f} MB")
    print(f"  ganti material  {size(rm):6.2f} MB -> ramping {size(slim_rematerial(rm)):6.2f} MB")
    for k in sorted(slim, key=lambda k: -size(slim[k]))[:4]:
        print(f"    {k:22s} {size(slim[k]):6.2f} MB")
