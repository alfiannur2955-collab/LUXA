"""
Uji A3-18 — Paritas Mode SNI vs Mode Simulasi
=============================================
Memastikan suku yang seharusnya sama antara Mode SNI dan Mode Simulasi
(luas selubung A_o, luas fenestrasi A_f, WWR, muka kusen terukur A_frame,
A_edge, lebar kusen, U_f 3-zona bawaan, konduksi dinding, konduksi kaca di
Jakarta ΔT=5 K, serta jangkar SF Tabel 8 SNI 6389:2020) benar-benar konsisten.
"""

from __future__ import annotations

import math
import os
import sys

import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config_schema import DEFAULT_FRAME_MAT_ID, ProjectConfig, SettingsConfig  # noqa: E402
from ottv_engine import (  # noqa: E402
    EnvelopeParameters,
    analyze_building_ottv,
    interpolate_sni_solar_factor,
)
from sni_tables import get_sni_city_entry  # noqa: E402


def test_default_frame_material_is_aluminium_standar():
    """Bawaan material kusen harus aluminium standar (U_frame = 8,0, Tabel 3 SNI),
    bukan thermal break yang menurunkan U_f diam-diam di Mode Simulasi."""
    assert DEFAULT_FRAME_MAT_ID == "frm_aluminium_standar"
    assert ProjectConfig().settings.frame_material_id == "frm_aluminium_standar"
    assert EnvelopeParameters().frame_material_id == "frm_aluminium_standar"


def test_simulasi_interpolates_sni2020_table8_city_sf():
    """interpolate_sni_solar_factor dengan sf_table memakai jangkar Tabel 8 SNI 6389:2020."""
    _, jkt = get_sni_city_entry("jakarta")
    sf_jkt = jkt["sf"]
    assert math.isclose(interpolate_sni_solar_factor(0.0, 90.0, 1.0, sf_table=sf_jkt), sf_jkt["U"], abs_tol=1e-2)
    assert math.isclose(interpolate_sni_solar_factor(90.0, 90.0, 1.0, sf_table=sf_jkt), sf_jkt["T"], abs_tol=1e-2)
    assert math.isclose(interpolate_sni_solar_factor(270.0, 90.0, 1.0, sf_table=sf_jkt), sf_jkt["B"], abs_tol=1e-2)
    assert math.isclose(
        interpolate_sni_solar_factor(247.5, 90.0, 1.0, sf_table=sf_jkt),
        0.5 * (sf_jkt["BD"] + sf_jkt["B"]),
        abs_tol=1e-2,
    )


def test_twisted_opsia_sni_vs_simulasi_parity():
    """Pada Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm (Jakarta, konfigurasi bawaan):
    geometri, muka kusen, U_f 3-zona, konduksi dinding, dan konduksi kaca identik di kedua mode,
    dan rata-rata SF Mode Simulasi selaras dengan jangkar Tabel 8 SNI 6389:2020."""
    path = os.path.join(
        ROOT_DIR,
        "corpus",
        "_studi_peneduh",
        "Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm",
    )
    if not os.path.isfile(path):
        pytest.skip("model korpus Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm tidak tersedia")

    fn = os.path.basename(path)
    res_sni = analyze_building_ottv(
        path, fn, ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni")).to_envelope_parameters()
    )
    res_sim = analyze_building_ottv(
        path, fn, ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="simulasi")).to_envelope_parameters()
    )

    s_sni = res_sni["summary"]
    s_sim = res_sim["summary"]

    # Status verdict tetap terpisah sesuai mode
    assert res_sni["verdict"] == "melebihi"
    assert res_sim["verdict"] == "simulasi"

    # Geometri & pembagian zona kusen 100% identik
    for k in (
        "total_envelope_area_m2",
        "total_glazing_area_m2",
        "total_opaque_area_m2",
        "effective_wwr",
        "total_a_frame_m2",
        "total_a_edge_m2",
        "total_a_cog_m2",
        "frame_ratio_pct",
        "frame_width_mm",
        "avg_u_cog_wm2k",
        "u_frame_eff_wm2k",
        "avg_u_fen_wm2k",
    ):
        assert math.isclose(float(s_sni[k]), float(s_sim[k]), abs_tol=1e-3), f"{k}: SNI={s_sni[k]} vs SIM={s_sim[k]}"

    assert s_sni["frame_source"] == s_sim["frame_source"] == "terukur"
    assert s_sni["u_frame_eff_wm2k"] == s_sim["u_frame_eff_wm2k"] == 8.0

    # Konduksi dinding & konduksi kaca (Jakarta ΔT = 5,0 K) identik di kedua mode
    assert math.isclose(s_sni["q_wall_conduction_wm2"], s_sim["q_wall_conduction_wm2"], abs_tol=0.01)
    assert math.isclose(s_sni["q_glass_conduction_wm2"], s_sim["q_glass_conduction_wm2"], abs_tol=0.01)

    # U_f per orientasi identik di seluruh 8 sisi
    by_code_sni = {o["code"]: o for o in res_sni["orientation_breakdown"]}
    by_code_sim = {o["code"]: o for o in res_sim["orientation_breakdown"]}
    for code in by_code_sni:
        assert math.isclose(
            by_code_sni[code]["manual_calc"]["u_f"],
            by_code_sim[code]["manual_calc"]["u_f"],
            abs_tol=1e-3,
        ), f"U_f orientasi {code}"

    # Rata-rata SF Mode Simulasi kini menginterpolasi Tabel 8 SNI 6389:2020 (bukan tabel 2011 lama)
    assert abs(s_sim["avg_sf_wm2"] - s_sni["avg_sf_wm2"]) <= 3.0
    # Sisi Timur tidak lagi jatuh ke ~110 W/m² (nilai 2011)
    assert by_code_sim["T"]["manual_calc"]["sf"] >= 155.0
