"""
Tes unit inti (pengganti backend/test_ottv_engine.py lama, Fase 6).

  - Interpolasi SF sudut untuk mode simulasi.
  - Normal bidang -> azimut kompas.
  - Katalog material, daftar kota, dan parser EPW.
  - Sampel publik "Fasad tower twisted": 24 lantai, 8 arah, laporan CSV/Excel/PDF terbentuk.
"""
import io
import math
import os
import sys

import openpyxl
import pytest

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT_DIR, "backend"))

from materials_and_epw import (  # noqa: E402
    INDONESIAN_CITY_PRESETS,
    generate_sample_epw_file,
    get_all_materials,
    parse_epw_content,
)
from ottv_engine import (  # noqa: E402
    analyze_building_ottv,
    compute_azimuth_from_normal,
    interpolate_sni_solar_factor,
)
from config_schema import ProjectConfig  # noqa: E402
from report_exporter import generate_csv_report, generate_excel_report  # noqa: E402
from version import __version__  # noqa: E402


def test_version_is_semver():
    parts = __version__.split(".")
    assert len(parts) == 3 and all(p.isdigit() for p in parts)


def test_sf_interpolation_anchors_and_midpoint():
    anchors = {0.0: 130.0, 45.0: 113.0, 90.0: 112.0, 135.0: 97.0, 180.0: 97.0, 225.0: 176.0, 270.0: 243.0, 315.0: 211.0}
    for angle, ref in anchors.items():
        assert math.isclose(interpolate_sni_solar_factor(angle, 90.0), ref, abs_tol=1e-2), angle
    assert math.isclose(interpolate_sni_solar_factor(247.5, 90.0), (176.0 + 243.0) / 2.0, abs_tol=1e-2)


@pytest.mark.parametrize("n,az", [((0, 1, 0), 0.0), ((1, 0, 0), 90.0), ((0, -1, 0), 180.0), ((-1, 0, 0), 270.0)])
def test_normal_to_compass_azimuth(n, az):
    assert math.isclose(compute_azimuth_from_normal(*n), az, abs_tol=1e-3)


def test_material_catalog_cities_and_epw(tmp_path):
    assert len(get_all_materials()) >= 24
    assert len(INDONESIAN_CITY_PRESETS) >= 10
    epw = generate_sample_epw_file(str(tmp_path / "surabaya.epw"), "surabaya")
    with open(epw, "r", encoding="utf-8") as f:
        parsed = parse_epw_content(f.read(), "Surabaya_Test.epw")
    assert "Surabaya" in parsed["city"]


def test_public_sample_fasad_tower_twisted_and_reports():
    path = os.path.join(ROOT_DIR, "backend", "samples", "Fasad_Tower_Twisted.3dm")
    if not os.path.isfile(path):
        pytest.skip("sampel tidak ada")
    res = analyze_building_ottv(path, "Fasad_Tower_Twisted.3dm", ProjectConfig().to_envelope_parameters())
    assert res["summary"]["total_floors"] == 24
    assert len(res["orientation_breakdown"]) == 8
    assert res["summary"]["bounding_box"]["recommended_dome_radius"] > 50.0
    assert "sunlit_mask" in res["panels"][0]
    assert len(generate_csv_report(res)) > 10000
    wb = openpyxl.load_workbook(io.BytesIO(generate_excel_report(res)))
    assert wb.sheetnames[0] == "Ringkasan"
    pytest.importorskip("reportlab")
    from report_exporter import generate_pdf_report

    assert generate_pdf_report(res)[:4] == b"%PDF"
