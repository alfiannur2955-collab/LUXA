"""
Dev verification tests for:
  1. Lossless `template_prodi.xlsx` XML filling (`template_filler.py` + `report_template_map.py`)
     preserving 100% of `<dataValidation>` and `<x14:dataValidation>` tags.
  2. `template_method.py` parity: SF from `'ref.'!A5:J22`, `SCk = SHGC/0.86`, and `SCeff`
     from sheet `BO` (`scefn..scefsw`) using the exact shading codes written to `Mat!F32:G56`.
  3. Upward-facing glazing rule (`nz > 0.50`): shortest dim > 0.30 m -> RTTV skylight;
     shortest dim <= 0.30 m -> `filtered_items` with `reason == 'sisi_tebal_panel'`.
  4. LibreOffice headless (`soffice`) recalculation matching engine OTTV within <= 0.05 W/m2
     for total, every orientation, and all 3 components (wall conduction, glass conduction,
     solar radiation). Emits explicit pytest warning `'TES REKALKULASI TEMPLATE DILEWATI'`
     when `soffice` is not installed.
"""

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import warnings
import zipfile

import openpyxl
import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FIXTURES_DIR = os.path.join(ROOT_DIR, "fixtures")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config_schema import CustomMaterialSpec, ProjectConfig, SettingsConfig
from ottv_engine import analyze_building_ottv
from report_template_map import (
    DEFAULT_TEMPLATE_PATH,
    ORIENTATION_TO_SHEET,
    TEMPLATE_WALL_CATALOG,
    export_template_prodi_xlsx,
)
from template_filler import get_sheet_xml_paths, inspect_template_validations
from template_method import TemplateShadingRegistry, compute_template_radiation_term


SUMMARY_ROW_BY_ORIENT = [
    ("U", 12),
    ("TL", 13),
    ("T", 14),
    ("TGR", 15),
    ("S", 16),
    ("BD", 17),
    ("B", 18),
    ("BL", 19),
]


def _find_soffice() -> str | None:
    for cand in (
        shutil.which("soffice"),
        shutil.which("libreoffice"),
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ):
        if cand and os.path.exists(cand):
            return cand
    return None


@pytest.mark.parametrize(
    "fixture_name",
    [
        "fasad_unitized_24lantai.3dm",
        "archicad_bim_curtainwall.ifc",
    ],
)
def test_fill_template_prodi_preserves_validations_and_populates_cells(fixture_name: str):
    assert os.path.exists(DEFAULT_TEMPLATE_PATH), "docs/templates/template_prodi.xlsx tidak ditemukan"
    orig_dvs = inspect_template_validations(DEFAULT_TEMPLATE_PATH)
    assert orig_dvs["UTARA"]["dv_x14"] == 1
    assert sum(v["dv_std"] for v in orig_dvs.values()) >= 30

    fixture_path = os.path.join(FIXTURES_DIR, fixture_name)
    cfg = ProjectConfig(
        settings=SettingsConfig(
            city_preset="jakarta",
            mode="sni",
            sf_source="template_prodi",
            wall_material_id="wal_spandrel_insulasi_50",
            glazing_material_id="glz_igu_triple_silver",
        )
    )
    analysis = analyze_building_ottv(fixture_path, fixture_name, cfg.to_envelope_parameters())
    xlsx_bytes, tpl_warnings, meta = export_template_prodi_xlsx(analysis)

    # 1. Exact preservation of ALL standard & x14 data validations across all 16 sheets
    filled_dvs = inspect_template_validations(xlsx_bytes)
    assert filled_dvs == orig_dvs, f"Data validations berubah: {filled_dvs} != {orig_dvs}"

    # 2. fullCalcOnLoad="1" present in xl/workbook.xml & formula <v> cache cleared on SUMMARY OTTV
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes), "r") as zf:
        wb_xml = zf.read("xl/workbook.xml").decode("utf-8")
        assert 'fullCalcOnLoad="1"' in wb_xml
        sheet_paths = get_sheet_xml_paths(zf)
        sum_xml = zf.read(sheet_paths["SUMMARY OTTV"]).decode("utf-8")
        m_h20 = re.search(r'<c\b[^>]*\br="H20"[^>]*>.*?</c>', sum_xml, re.DOTALL)
        assert m_h20 is not None
        assert "<f>" in m_h20.group(0) or "<f " in m_h20.group(0)
        assert "<v>" not in m_h20.group(0)

    # 3. Verify populated values by reading with openpyxl (read-only inspection ONLY)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    mat = wb["Mat"]
    assert mat["H6"].value == fixture_name
    assert mat["D6"].value == "Jakarta"
    assert int(mat["C11"].value) >= 1
    assert mat["B16"].value in TEMPLATE_WALL_CATALOG
    assert mat["C32"].value is not None
    assert 0.10 <= float(mat["D32"].value) <= 0.90  # SHGC
    assert 0.50 <= float(mat["E32"].value) <= 7.00  # U glazing
    # Unshaded models MUST have Mat!F32 and Mat!G32 cleared
    assert mat["F32"].value in (None, "")
    assert mat["G32"].value in (None, "")

    # 4. Verify orientation sheets rows 65..89: total area conservation & H <= C*D clamp
    total_tpl_facade_area = 0.0
    total_tpl_glz_area = 0.0
    for sh_name in ORIENTATION_TO_SHEET.values():
        ws = wb[sh_name]
        for r in range(65, 90):
            c_val = ws[f"C{r}"].value
            d_val = ws[f"D{r}"].value
            i_val = ws[f"I{r}"].value
            h_val = ws[f"H{r}"].value
            if c_val is not None and d_val is not None and i_val is not None:
                c_f, d_f, i_f = float(c_val), float(d_val), float(i_val)
                h_f = float(h_val or 0.0)
                assert c_f > 0 and d_f > 0 and i_f >= 1
                assert h_f <= c_f * d_f + 1e-4, f"{sh_name}!H{r}={h_f} > C*D={c_f*d_f}"
                total_tpl_facade_area += c_f * d_f * i_f
                total_tpl_glz_area += h_f * i_f

    assert abs(total_tpl_facade_area - analysis["summary"]["total_envelope_area_m2"]) <= 1.0
    assert abs(total_tpl_glz_area - analysis["summary"]["total_glazing_area_m2"]) <= 1.0

    # 5. For fasad_unitized_24lantai.3dm: thin top glass caps (<= 0.30m) MUST be 'sisi_tebal_panel', NOT RTTV skylight
    if fixture_name == "fasad_unitized_24lantai.3dm":
        assert analysis["rttv"]["skylight_area_m2"] == 0.0
        f_items = analysis["stage1_geometry_audit"]["filtered_items"]
        tp_items = [it for it in f_items if it.get("reason") == "sisi_tebal_panel"]
        assert len(tp_items) == 1
        assert tp_items[0]["face_count"] == 1972


def test_upward_glazing_min_dim_threshold_skylight_vs_sisi_tebal_panel():
    """
    Upward glazing (nz > 0.50) with shortest dim > 0.30 m goes to RTTV skylight;
    shortest dim <= 0.30 m goes to `filtered_items` with `reason == 'sisi_tebal_panel'`.
    """
    fd, tmp_path = tempfile.mkstemp(suffix=".obj")
    os.close(fd)
    try:
        # 4 vertical walls (10x10x4m) + 1 real upward skylight (2.0 x 2.0m = 4.0 m2)
        # + 1 thin upward glass edge cap (2.0 x 0.08m = 0.16 m2, min_dim = 0.08 <= 0.30 m)
        obj_lines = [
            "g Wall_Facade",
            "v 0 0 0", "v 10 0 0", "v 10 0 4", "v 0 0 4", "f 1 2 3 4",
            "v 10 0 0", "v 10 10 0", "v 10 10 4", "v 10 0 4", "f 5 6 7 8",
            "v 10 10 0", "v 0 10 0", "v 0 10 4", "v 10 10 4", "f 9 10 11 12",
            "v 0 10 0", "v 0 0 0", "v 0 0 4", "v 0 10 4", "f 13 14 15 16",
            "g Glass_Skylight_And_Edge",
            # Real skylight 2.0m x 2.0m (nz = +1)
            "v 4 4 4", "v 6 4 4", "v 6 6 4", "v 4 6 4", "f 17 18 19 20",
            # Thin top glass edge 2.0m x 0.08m (nz = +1, min_dim = 0.08 <= 0.30)
            "v 1 0 4", "v 3 0 4", "v 3 0.08 4", "v 1 0.08 4", "f 21 22 23 24",
            # Vertical window 2.0m x 2.0m on South wall
            "v 4 0 1", "v 6 0 1", "v 6 0 3", "v 4 0 3", "f 25 26 27 28",
        ]
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write("\n".join(obj_lines) + "\n")

        cfg = ProjectConfig(
            model=ProjectConfig().model.model_copy(update={"unit_mode": "m", "up_axis": "Z"}),
            settings=SettingsConfig(mode="sni", sf_source="template_prodi"),
        )
        res = analyze_building_ottv(tmp_path, "skylight_edge_test.obj", cfg.to_envelope_parameters())
        assert res["rttv"]["applicable"] is True
        assert abs(res["rttv"]["skylight_area_m2"] - 4.0) <= 0.01
        tp_items = [it for it in res["stage1_geometry_audit"]["filtered_items"] if it.get("reason") == "sisi_tebal_panel"]
        assert len(tp_items) == 1
        assert tp_items[0]["face_count"] == 1
        assert abs(tp_items[0]["area_m2"] - 0.16) <= 0.005
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_template_method_shading_codes_and_shgc_div_086_parity():
    """
    Verifies `template_method.py` computes SF ('ref.'!A5:J22), SCk = SHGC/0.86, and SCeff
    via BO ranges (scefn..scefsw), and `report_template_map.py` writes the exact same codes to Mat!F32:G56.
    """
    reg = TemplateShadingRegistry()
    # Horizontal overhang R1=0.5, tilt=20° on East -> BO scefe -> hew(0.5, 20°) = 0.6550 (ref. scef printed)
    res_rad = compute_template_radiation_term(
        city_preset="jakarta",
        orientation_code="T",
        wwr=0.40,
        glz_mat={"shgc": 0.20, "sc": 0.23, "u_value": 1.10},
        r1=0.50,
        r2=0.0,
        phi1_deg=20.0,
        registry=reg,
    )
    assert res_rad["sf_wm2"] == 179.0
    assert res_rad["shgc"] == 0.20
    assert res_rad["sc_k"] == pytest.approx(0.20 / 0.86, abs=1e-6)
    assert res_rad["shade_yn"] == "yes"
    assert res_rad["shade_code"] == "SH1"
    assert res_rad["bo_scef_range"] == "scefe"
    assert res_rad["sc_eff"] == pytest.approx(0.6550, abs=1e-4)
    assert res_rad["q_solar_wm2"] == pytest.approx(179.0 * 0.40 * (0.20 / 0.86) * 0.6550, abs=1e-4)


def test_template_prodi_city_fallback_warning():
    """City not in `'ref.'!A5:A22` (e.g. 'medan') maps to nearest city ('Pekanbaru') + warning."""
    fixture_path = os.path.join(FIXTURES_DIR, "archicad_bim_curtainwall.ifc")
    cfg = ProjectConfig(settings=SettingsConfig(city_preset="medan", mode="sni", sf_source="template_prodi"))
    analysis = analyze_building_ottv(fixture_path, "archicad_bim_curtainwall.ifc", cfg.to_envelope_parameters())
    analysis_raw_city = dict(analysis)
    analysis_raw_city["location_info"] = dict(analysis["location_info"], id="medan", city="Medan")
    xlsx_bytes, tpl_warnings, meta = export_template_prodi_xlsx(analysis_raw_city)
    assert meta["city_excel_label"] == "Pekanbaru"
    assert any("Pekanbaru" in w for w in tpl_warnings)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    assert wb["Mat"]["D6"].value == "Pekanbaru"


def _assert_libreoffice_matches_engine(
    soffice: str,
    analysis: dict,
    tol_wm2: float = 0.05,
) -> None:
    from pathlib import Path

    xlsx_bytes, _, _ = export_template_prodi_xlsx(analysis)
    with tempfile.TemporaryDirectory() as tmpdir:
        in_xlsx = os.path.join(tmpdir, "filled.xlsx")
        out_dir = os.path.join(tmpdir, "out")
        profile_dir = os.path.join(tmpdir, "lo_profile")
        os.makedirs(out_dir, exist_ok=True)
        os.makedirs(profile_dir, exist_ok=True)
        with open(in_xlsx, "wb") as f:
            f.write(xlsx_bytes)

        profile_uri = Path(profile_dir).resolve().as_uri()
        proc = subprocess.run(
            [
                soffice,
                f"-env:UserInstallation={profile_uri}",
                "--headless",
                "--norestore",
                "--convert-to",
                "xlsx",
                "--outdir",
                out_dir,
                in_xlsx,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert proc.returncode == 0, (
            f"LibreOffice exit={proc.returncode}\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
        )
        recalc_path = os.path.join(out_dir, "filled.xlsx")
        wb_val = openpyxl.load_workbook(recalc_path, data_only=True)
        ws_sum = wb_val["SUMMARY OTTV"]

        h20 = ws_sum["H20"].value
        assert h20 is not None, "'SUMMARY OTTV'!H20 bernilai None setelah rekalkulasi LibreOffice"
        assert abs(float(h20) - float(analysis["ottv_total_wm2"])) <= tol_wm2, (
            f"Total OTTV mismatch: template={h20} vs engine={analysis['ottv_total_wm2']}"
        )

        ori_map = {r["code"]: r for r in analysis["orientation_breakdown"]}
        for code, row_i in SUMMARY_ROW_BY_ORIENT:
            eng = ori_map[code]
            a_tpl = float(ws_sum[f"G{row_i}"].value or 0.0)
            eng_a = float(eng["total_area_m2"] or 0.0)
            if eng_a <= 1e-3:
                assert a_tpl <= 1e-3
                continue
            qw_tpl = float(ws_sum[f"C{row_i}"].value or 0.0) / a_tpl
            qg_tpl = float(ws_sum[f"D{row_i}"].value or 0.0) / a_tpl
            qs_tpl = float(ws_sum[f"E{row_i}"].value or 0.0) / a_tpl
            ottv_tpl = float(ws_sum[f"H{row_i}"].value or 0.0)

            assert abs(ottv_tpl - float(eng["ottv_orientation_wm2"])) <= tol_wm2, (
                f"{code} OTTV mismatch: template={ottv_tpl:.4f} vs engine={eng['ottv_orientation_wm2']}"
            )
            assert abs(qw_tpl - float(eng["q_wall_conduction_wm2"])) <= tol_wm2, (
                f"{code} Q_wall mismatch: template={qw_tpl:.4f} vs engine={eng['q_wall_conduction_wm2']}"
            )
            assert abs(qg_tpl - float(eng["q_glass_conduction_wm2"])) <= tol_wm2, (
                f"{code} Q_glass mismatch: template={qg_tpl:.4f} vs engine={eng['q_glass_conduction_wm2']}"
            )
            assert abs(qs_tpl - float(eng["q_solar_radiation_wm2"])) <= tol_wm2, (
                f"{code} Q_solar mismatch: template={qs_tpl:.4f} vs engine={eng['q_solar_radiation_wm2']}"
            )


def test_template_prodi_libreoffice_recalculation_matches_engine():
    """
    Recalculates filled template via LibreOffice headless (`soffice`) and asserts <= 0.05 W/m2
    parity for total OTTV, every orientation, and all 3 components (wall conduction, glass
    conduction, solar radiation), both unshaded (`fasad_unitized_24lantai.3dm`) and shaded (SH1).
    """
    soffice = _find_soffice()
    if not soffice:
        warnings.warn(
            "TES REKALKULASI TEMPLATE DILEWATI: LibreOffice (soffice) tidak terpasang di mesin ini.",
            UserWarning,
            stacklevel=1,
        )
        pytest.skip("TES REKALKULASI TEMPLATE DILEWATI")

    tpl_wall_mat = CustomMaterialSpec(
        id="tpl_glass_back_insul",
        name="Spandrel Glass-Back Panel-Insulation",
        category="wall",
        u_value=0.51,
        alpha=0.57,
        massa_kg_m2=45.6,
        sumber="BO. wallmaterial!B7 template_prodi.xlsx",
        status="nilai_tipikal",
    )

    # Case A: Real 24-floor tower fixture (unshaded)
    fixture_path = os.path.join(FIXTURES_DIR, "fasad_unitized_24lantai.3dm")
    cfg_a = ProjectConfig(
        settings=SettingsConfig(
            city_preset="jakarta",
            mode="sni",
            sf_source="template_prodi",
            wall_material_id="tpl_glass_back_insul",
            glazing_material_id="glz_igu_triple_silver",
            custom_materials=[tpl_wall_mat],
        )
    )
    analysis_a = analyze_building_ottv(fixture_path, "fasad_unitized_24lantai.3dm", cfg_a.to_envelope_parameters())
    _assert_libreoffice_matches_engine(soffice, analysis_a, tol_wm2=0.05)

    # Case B: Shaded box with horizontal overhang (SH1 -> BO scefn/scefe/scefs/scefw)
    fd, tmp_hb = tempfile.mkstemp(suffix=".hbjson")
    os.close(fd)
    try:
        def _fd(pts):
            return {"type": "Face3D", "boundary": pts}
        overhang = 1.0  # R1 = 1.0 / 2.0 = 0.50 -> SH1
        walls_spec = [
            ("Wall_N", [[10, 10, 0], [0, 10, 0], [0, 10, 4], [10, 10, 4]], [[9, 10, 1], [1, 10, 1], [1, 10, 3], [9, 10, 3]], [[9, 10, 3], [1, 10, 3], [1, 10 + overhang, 3], [9, 10 + overhang, 3]]),
            ("Wall_E", [[10, 0, 0], [10, 10, 0], [10, 10, 4], [10, 0, 4]], [[10, 1, 1], [10, 9, 1], [10, 9, 3], [10, 1, 3]], [[10, 1, 3], [10, 9, 3], [10 + overhang, 9, 3], [10 + overhang, 1, 3]]),
            ("Wall_S", [[0, 0, 0], [10, 0, 0], [10, 0, 4], [0, 0, 4]], [[1, 0, 1], [9, 0, 1], [9, 0, 3], [1, 0, 3]], [[1, 0, 3], [9, 0, 3], [9, -overhang, 3], [1, -overhang, 3]]),
            ("Wall_W", [[0, 10, 0], [0, 0, 0], [0, 0, 4], [0, 10, 4]], [[0, 9, 1], [0, 1, 1], [0, 1, 3], [0, 9, 3]], [[0, 9, 3], [0, 1, 3], [-overhang, 1, 3], [-overhang, 9, 3]]),
        ]
        faces = [
            {
                "identifier": wid,
                "face_type": "Wall",
                "geometry": _fd(w_pts),
                "apertures": [{
                    "identifier": f"Ap_{wid}",
                    "geometry": _fd(ap_pts),
                    "outdoor_shades": [{"identifier": f"Sh_{wid}", "geometry": _fd(sh_pts)}],
                }],
            }
            for wid, w_pts, ap_pts, sh_pts in walls_spec
        ]
        with open(tmp_hb, "w", encoding="utf-8") as f:
            json.dump({"type": "Model", "identifier": "ShadedBox", "units": "Meters", "rooms": [{"identifier": "R1", "faces": faces}]}, f)

        cfg_b = ProjectConfig(
            settings=SettingsConfig(
                city_preset="jakarta",
                mode="sni",
                sf_source="template_prodi",
                wall_material_id="tpl_glass_back_insul",
                glazing_material_id="glz_igu_lowe_standar",
                custom_materials=[tpl_wall_mat],
            )
        )
        analysis_b = analyze_building_ottv(tmp_hb, "shaded_box.hbjson", cfg_b.to_envelope_parameters())
        _assert_libreoffice_matches_engine(soffice, analysis_b, tol_wm2=0.05)
    finally:
        if os.path.exists(tmp_hb):
            os.remove(tmp_hb)
