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


@pytest.mark.skipif(not NODE or not os.path.isfile(MANIFEST), reason="Node.js atau aset engine browser tidak ada")
def test_browser_engine_matches_native_on_meshless_brep_and_extrusion(tmp_path) -> None:
    """A3-05: paritas jalur browser (rhinoExtract.js + Pyodide) vs native Python pada 3DM tanpa render mesh."""
    rhino3dm = pytest.importorskip("rhino3dm")
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters

    def _lm(name: str, transp: float = 0.0):
        lyr = rhino3dm.Layer()
        lyr.Name = name
        li = model.Layers.Add(lyr)
        mat = rhino3dm.Material()
        mat.Name = name
        mat.Transparency = transp
        mi = model.Materials.Add(mat)
        a = rhino3dm.ObjectAttributes()
        a.LayerIndex = li
        a.MaterialIndex = mi
        a.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
        return a

    aw = _lm("Dinding Bata", 0.0)
    ag = _lm("Kaca Jendela", 0.7)
    ar = _lm("Atap Beton", 0.0)

    def _ext_box(x0, y0, x1, y1, z0, z1):
        pl = rhino3dm.Polyline([
            rhino3dm.Point3d(x0, y0, z0), rhino3dm.Point3d(x1, y0, z0),
            rhino3dm.Point3d(x1, y1, z0), rhino3dm.Point3d(x0, y1, z0),
            rhino3dm.Point3d(x0, y0, z0),
        ])
        return rhino3dm.Extrusion.Create(pl.ToPolylineCurve(), z1 - z0, True)

    t = 0.2
    for f in range(2):
        z0 = f * 4.0
        for zb0, zb1 in ((z0, z0 + 1.2), (z0 + 2.8, z0 + 4.0)):
            for x0, y0, x1, y1 in (
                (-10.0, -6.0, 10.0, -6.0 + t),
                (-10.0, 6.0 - t, 10.0, 6.0),
                (10.0 - t, -6.0 + t, 10.0, 6.0 - t),
                (-10.0, -6.0 + t, -10.0 + t, 6.0 - t),
            ):
                model.Objects.AddExtrusion(_ext_box(x0, y0, x1, y1, zb0, zb1), aw)
        zg0, zg1 = z0 + 1.2, z0 + 2.8
        for x0, y0, x1, y1 in (
            (-10.0, -6.0, 10.0, -6.0 + t),
            (-10.0, 6.0 - t, 10.0, 6.0),
            (10.0 - t, -6.0 + t, 10.0, 6.0 - t),
            (-10.0, -6.0 + t, -10.0 + t, 6.0 - t),
        ):
            bb = rhino3dm.BoundingBox(rhino3dm.Point3d(x0, y0, zg0), rhino3dm.Point3d(x1, y1, zg1))
            model.Objects.AddBrep(rhino3dm.Brep.CreateFromBox(rhino3dm.Box(bb)), ag)

    # Atap Extrusion berlubang (loop dalam) di z=8..8.2
    outer = rhino3dm.Polyline([
        rhino3dm.Point3d(-10.0, -6.0, 0.0), rhino3dm.Point3d(10.0, -6.0, 0.0),
        rhino3dm.Point3d(10.0, 6.0, 0.0), rhino3dm.Point3d(-10.0, 6.0, 0.0),
        rhino3dm.Point3d(-10.0, -6.0, 0.0),
    ])
    inner = rhino3dm.Polyline([
        rhino3dm.Point3d(6.0, 4.0, 0.0), rhino3dm.Point3d(14.0, 4.0, 0.0),
        rhino3dm.Point3d(14.0, 8.0, 0.0), rhino3dm.Point3d(6.0, 8.0, 0.0),
        rhino3dm.Point3d(6.0, 4.0, 0.0),
    ])
    roof_ext = rhino3dm.Extrusion.Create(outer.ToPolylineCurve(), 0.2, True)
    roof_ext.AddInnerProfile(inner.ToPolylineCurve())
    roof_ext.Translate(rhino3dm.Vector3d(0.0, 0.0, 8.0))
    model.Objects.AddExtrusion(roof_ext, ar)

    fp = str(tmp_path / "meshless_brep_ext.3dm")
    model.Write(fp, 7)

    proc = subprocess.run(
        [NODE, SCRIPT, fp],
        capture_output=True, text=True, timeout=600, cwd=ROOT,
    )
    line = next((ln for ln in proc.stdout.splitlines() if ln.startswith("PARITY_JSON ")), None)
    assert line, f"engine_parity.mjs gagal:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
    browser = json.loads(line[len("PARITY_JSON "):])[fp]
    assert "error" not in browser, f"meshless browser error: {browser.get('error')}"

    mid = "native-meshless-a305"
    browser_api.register_upload(mid, fp, os.path.basename(fp), fp)
    cfg = browser_api.default_config(os.path.basename(fp))
    cfg["model"]["model_scope"] = "full_building"
    native = browser_api.analyze(mid, cfg)

    assert abs(browser["ottv_total_wm2"] - native["ottv_total_wm2"]) <= 0.01, f"browser {browser} vs native {native['ottv_total_wm2']}"
    assert browser["panels"] == len(native["panels"]), f"browser {browser} vs native {len(native['panels'])}"


@pytest.mark.skipif(not NODE or not os.path.isfile(MANIFEST), reason="Node.js atau aset engine browser tidak ada")
def test_browser_engine_matches_native_with_mullion_frame(tmp_path) -> None:
    """T5 (A3-11/A3-13): paritas browser Pyodide vs native Python pada model kotak dengan mullion (U_f 3-zona)."""
    from test_three_zone_uf import _write_box_3dm

    fp = _write_box_3dm(str(tmp_path / "box_mullion_parity.3dm"), with_mullions=True, frame_w=0.05)
    proc = subprocess.run(
        [NODE, SCRIPT, fp],
        capture_output=True, text=True, timeout=600, cwd=ROOT,
    )
    line = next((ln for ln in proc.stdout.splitlines() if ln.startswith("PARITY_JSON ")), None)
    assert line, f"engine_parity.mjs gagal:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
    browser = json.loads(line[len("PARITY_JSON "):])[fp]
    assert "error" not in browser, f"mullion browser error: {browser.get('error')}"

    mid = "native-mullion-t5"
    browser_api.register_upload(mid, fp, os.path.basename(fp), fp)
    cfg = browser_api.default_config(os.path.basename(fp))
    cfg["model"]["model_scope"] = "full_building"
    native = browser_api.analyze(mid, cfg)

    assert abs(browser["ottv_total_wm2"] - native["ottv_total_wm2"]) <= 0.01, f"browser {browser} vs native {native['ottv_total_wm2']}"
    assert browser["panels"] == len(native["panels"]), f"browser {browser} vs native {len(native['panels'])}"
