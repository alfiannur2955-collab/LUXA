"""
Dev verification tests for lossless `template_prodi.xlsx` XML filling (`template_filler.py` + `report_template_map.py`).
Verifies:
  1. Filling `docs/templates/template_prodi.xlsx` for `fasad_unitized_24lantai.3dm` and
     `archicad_bim_curtainwall.ifc` preserves 100% of `<dataValidation>` and `<x14:dataValidation>`
     tags across all sheets (zero openpyxl save corruption).
  2. `<calcPr ... fullCalcOnLoad="1"/>` is set and cached `<v>` values on formula cells are cleared.
  3. Key cells (`Mat!H6`, `Mat!D6`, `Mat!C11`, `Mat!B16`, `Mat!C32:G32`, orientation rows 65..89)
     are populated cleanly with `H <= C * D` and unused default cells cleared.
  4. City fallback warning fires for cities absent from `'ref.'!A5:A22`.
  5. When LibreOffice (`soffice`) is installed, recalculates the filled workbook headless and asserts
     `'SUMMARY OTTV'!H20` matches engine OTTV (with `sf_source='template_prodi'`) within <= 0.5 W/m2.
"""

import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
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
    xlsx_bytes, warnings, meta = export_template_prodi_xlsx(analysis)

    # 1. Exact preservation of ALL standard & x14 data validations across all 16 sheets
    filled_dvs = inspect_template_validations(xlsx_bytes)
    assert filled_dvs == orig_dvs, f"Data validations berubah: {filled_dvs} != {orig_dvs}"

    # 2. fullCalcOnLoad="1" present in xl/workbook.xml & formula <v> cache cleared on SUMMARY OTTV
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes), "r") as zf:
        wb_xml = zf.read("xl/workbook.xml").decode("utf-8")
        assert 'fullCalcOnLoad="1"' in wb_xml
        sheet_paths = get_sheet_xml_paths(zf)
        sum_xml = zf.read(sheet_paths["SUMMARY OTTV"]).decode("utf-8")
        # H20 formula cell should have no stale <v> cached value
        m_h20 = re.search(r'<c\b[^>]*\br="H20"[^>]*>.*?</c>', sum_xml, re.DOTALL)
        assert m_h20 is not None
        assert "<f>" in m_h20.group(0) or "<f " in m_h20.group(0)
        assert "<v>" not in m_h20.group(0)

    # 3. Verify populated values by reading with openpyxl (read-only inspection ONLY, never saved)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    mat = wb["Mat"]
    assert mat["H6"].value == fixture_name
    assert mat["D6"].value == "Jakarta"
    assert int(mat["C11"].value) >= 1
    assert mat["B16"].value in TEMPLATE_WALL_CATALOG
    assert mat["C32"].value is not None
    assert 0.10 <= float(mat["D32"].value) <= 0.90  # SHGC = SC * 0.86
    assert 0.50 <= float(mat["E32"].value) <= 7.00  # U glazing
    # Unshaded models MUST have Mat!F32 and Mat!G32 cleared (template ships with F32='yes', G32='SE1')
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


def test_template_prodi_city_fallback_warning():
    """City not in `'ref.'!A5:A22` (e.g. 'medan') maps to nearest city ('Pekanbaru') + warning."""
    fixture_path = os.path.join(FIXTURES_DIR, "archicad_bim_curtainwall.ifc")
    cfg = ProjectConfig(settings=SettingsConfig(city_preset="medan", mode="sni", sf_source="template_prodi"))
    analysis = analyze_building_ottv(fixture_path, "archicad_bim_curtainwall.ifc", cfg.to_envelope_parameters())
    # Force original non-template city name into location_info to test mapper directly as well
    analysis_raw_city = dict(analysis)
    analysis_raw_city["location_info"] = dict(analysis["location_info"], id="medan", city="Medan")
    xlsx_bytes, warnings, meta = export_template_prodi_xlsx(analysis_raw_city)
    assert meta["city_excel_label"] == "Pekanbaru"
    assert any("Pekanbaru" in w for w in warnings)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    assert wb["Mat"]["D6"].value == "Pekanbaru"


def test_template_prodi_libreoffice_recalculation_matches_engine():
    """
    If LibreOffice (`soffice`) is installed, recalculates the filled template headless
    and asserts `'SUMMARY OTTV'!H20` matches engine OTTV (with matching wall spec) within <= 0.5 W/m2.
    """
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        pytest.skip("LibreOffice (soffice) tidak terpasang di mesin ini; uji rekalkulasi dilewati.")

    fixture_path = os.path.join(FIXTURES_DIR, "fasad_unitized_24lantai.3dm")
    # Use exact wall parameters matching 'Glass-Back Panel-Insulation' in BO. wallmaterial!B7 (U=0.51, alpha=0.57, w=45.6)
    cfg = ProjectConfig(
        settings=SettingsConfig(
            city_preset="jakarta",
            mode="sni",
            sf_source="template_prodi",
            wall_material_id="tpl_glass_back_insul",
            glazing_material_id="glz_igu_triple_silver",
            custom_materials=[
                CustomMaterialSpec(
                    id="tpl_glass_back_insul",
                    name="Spandrel Glass-Back Panel-Insulation",
                    category="wall",
                    u_value=0.51,
                    alpha=0.57,
                    massa_kg_m2=45.6,
                    sumber="BO. wallmaterial!B7 template_prodi.xlsx",
                    status="nilai_tipikal",
                )
            ],
        )
    )
    analysis = analyze_building_ottv(fixture_path, "fasad_unitized_24lantai.3dm", cfg.to_envelope_parameters())
    xlsx_bytes, _, _ = export_template_prodi_xlsx(analysis)

    with tempfile.TemporaryDirectory() as tmpdir:
        in_xlsx = os.path.join(tmpdir, "filled.xlsx")
        out_dir = os.path.join(tmpdir, "out")
        os.makedirs(out_dir, exist_ok=True)
        with open(in_xlsx, "wb") as f:
            f.write(xlsx_bytes)

        subprocess.run(
            [soffice, "--headless", "--convert-to", "xlsx", "--outdir", out_dir, in_xlsx],
            check=True,
            timeout=90,
        )
        recalc_path = os.path.join(out_dir, "filled.xlsx")
        wb_val = openpyxl.load_workbook(recalc_path, data_only=True)
        h20 = wb_val["SUMMARY OTTV"]["H20"].value
        assert h20 is not None, "'SUMMARY OTTV'!H20 bernilai None setelah rekalkulasi LibreOffice"
        assert abs(float(h20) - float(analysis["ottv_total_wm2"])) <= 0.50
