"""
Automated Verification Suite for OTTV 3D Parametric Studio v2.0 (SNI 6389:2020)
"""

import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import ensure_sample_files
from materials_and_epw import (
    INDONESIAN_CITY_PRESETS,
    generate_sample_epw_file,
    get_all_materials,
    parse_epw_content,
)
from ottv_engine import (
    SNI_6389_LIMIT_WM2,
    EnvelopeParameters,
    analyze_building_ottv,
    compute_azimuth_from_normal,
    interpolate_sni_solar_factor,
)
from report_exporter import (
    generate_csv_report,
    generate_excel_report,
    generate_pdf_report,
)


def run_all_tests() -> None:
    print("=== 1. Verifying SNI 6389:2020 Solar Factor (SF) Interpolation ===")
    expected_sf = {
        0.0: 130.0,    # U
        45.0: 113.0,   # TL
        90.0: 112.0,   # T
        135.0: 97.0,   # TGR
        180.0: 97.0,   # S
        225.0: 176.0,  # BD
        270.0: 243.0,  # B
        315.0: 211.0,  # BL
    }
    for angle, sf_ref in expected_sf.items():
        val = interpolate_sni_solar_factor(angle, 90.0)
        assert math.isclose(val, sf_ref, abs_tol=1e-2), f"Mismatch at {angle}: {val} != {sf_ref}"
    mid_bd_b = interpolate_sni_solar_factor(247.5, 90.0)
    assert math.isclose(mid_bd_b, (176.0 + 243.0) / 2.0, abs_tol=1e-2)
    print("  [PASS] All 8 SNI 6389:2020 SF anchors & angular interpolations verified.")

    print("=== 2. Verifying 3D Normal Vector & Compass Azimuth Extraction ===")
    assert math.isclose(compute_azimuth_from_normal(0.0, 1.0, 0.0), 0.0, abs_tol=1e-3)     # North
    assert math.isclose(compute_azimuth_from_normal(1.0, 0.0, 0.0), 90.0, abs_tol=1e-3)    # East
    assert math.isclose(compute_azimuth_from_normal(0.0, -1.0, 0.0), 180.0, abs_tol=1e-3)  # South
    assert math.isclose(compute_azimuth_from_normal(-1.0, 0.0, 0.0), 270.0, abs_tol=1e-3)  # West
    print("  [PASS] 3D Normal -> Compass Azimuth (0-360 deg) verified.")

    print("=== 3. Verifying Indonesian Material Library & EPW Weather Engine ===")
    mats = get_all_materials()
    locs = list(INDONESIAN_CITY_PRESETS.values())
    assert len(mats) >= 24, f"Expected >=24 materials, got {len(mats)}"
    assert len(locs) >= 10, f"Expected >=10 Indonesian cities, got {len(locs)}"
    epw_path = generate_sample_epw_file(os.path.join(os.path.dirname(__file__), "epw_samples", "test_surabaya.epw"), "surabaya")
    with open(epw_path, "r", encoding="utf-8") as f:
        epw_txt = f.read()
    parsed_epw = parse_epw_content(epw_txt, "Surabaya_Test.epw")
    assert "Surabaya" in parsed_epw["city"]
    print(f"  [PASS] Material catalog ({len(mats)} items) & EPW parser ({len(locs)} cities) verified.")

    print("=== 4. Verifying Multi-Format 3D Parsing, High-Speed Raycasting & OTTV <= 35 W/m2 ===")
    sample_paths = ensure_sample_files()
    for preset_id, path in sample_paths.items():
        t0 = time.perf_counter()
        res = analyze_building_ottv(path, os.path.basename(path), EnvelopeParameters())
        dt = time.perf_counter() - t0
        assert "ottv_total_wm2" in res
        assert "orientation_breakdown" in res and len(res["orientation_breakdown"]) == 8
        assert "floor_breakdown" in res and len(res["floor_breakdown"]) >= 1
        assert "groups" in res and len(res["groups"]) >= 1
        assert "panels" in res and len(res["panels"]) > 0
        assert res["ottv_total_wm2"] <= SNI_6389_LIMIT_WM2, (
            f"{preset_id} exceeded 35 W/m2: {res['ottv_total_wm2']}"
        )
        print(
            f"  [PASS] {preset_id} ({res['format']}): OTTV = {res['ottv_total_wm2']} W/m2 "
            f"(<= 35.0 W/m2), Active Panels = {res['summary']['panel_count']}/{res['summary']['total_detected_panels']}, "
            f"Floors = {res['summary']['total_floors']}, Time = {dt:.2f}s"
        )

        if preset_id == "fasad_tower_twisted":
            assert res["summary"]["total_floors"] == 24
            assert "bounding_box" in res["summary"]
            assert res["summary"]["bounding_box"]["recommended_dome_radius"] > 50.0
            assert "ottv_composite_wm2" in res["panels"][0]
            assert "sunlit_mask" in res["panels"][0]
            assert "orientation_floor_breakdown" in res and len(res["orientation_floor_breakdown"]) == 8

            csv_b = generate_csv_report(res)
            xls_b = generate_excel_report(res)
            pdf_b = generate_pdf_report(res)
            assert len(csv_b) > 10000 and len(xls_b) > 10000 and len(pdf_b) > 5000

            import io
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(xls_b), data_only=False)
            expected_sheets = [
                "UTARA", "TIMUR LAUT", "TIMUR", "TENGGARA",
                "SELATAN", "BARAT DAYA", "BARAT", "BARAT LAUT",
                "SUMMARY OTTV", "BACK OFFICE", "LAMPIRAN 3D PANEL",
            ]
            assert wb.sheetnames == expected_sheets, f"Unexpected sheetnames: {wb.sheetnames}"
            assert str(wb["SUMMARY OTTV"]["H18"].value).startswith("=IF(")
            assert str(wb["SUMMARY OTTV"]["G21"].value).startswith("=IF(")
            print(
                f"  [PASS] Report Exports for Fasad_Tower_Twisted.3dm: "
                f"CSV={len(csv_b):,}B, PUPR XLSX ({len(wb.sheetnames)} sheets)={len(xls_b):,}B, PDF={len(pdf_b):,}B"
            )


if __name__ == "__main__":
    run_all_tests()
