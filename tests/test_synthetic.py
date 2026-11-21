"""
Suite Uji 21 Kasus Sintetis & Paritas Antarformat (Fase 1c)
==========================================================
Memverifikasi engine terhadap seluruh 21 kasus di `fixtures/synthetic/*/expected.json`
sesuai spesifikasi `docs/FASE1C_SPEC.md` §6.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Tuple

import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config_schema import ProjectConfig
from ottv_engine import analyze_building_ottv

SYNTHETIC_ROOT = os.path.join(ROOT_DIR, "fixtures", "synthetic")


def _discover_cases() -> List[Dict[str, Any]]:
    cases: List[Dict[str, Any]] = []
    if not os.path.isdir(SYNTHETIC_ROOT):
        return cases
    for folder in sorted(os.listdir(SYNTHETIC_ROOT)):
        exp_path = os.path.join(SYNTHETIC_ROOT, folder, "expected.json")
        if os.path.isfile(exp_path):
            with open(exp_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["_dir"] = os.path.join(SYNTHETIC_ROOT, folder)
            cases.append(data)
    return cases


ALL_CASES = _discover_cases()
CASE_FORMAT_PARAMS: List[Tuple[str, str, Dict[str, Any]]] = [
    (c["case"], fmt, c)
    for c in ALL_CASES
    for fmt in c["formats"]
]
PARITY_CASES: List[Tuple[str, Dict[str, Any]]] = [
    (c["case"], c)
    for c in ALL_CASES
    if len(c["formats"]) >= 2 and not c["expected"].get("error_expected", False)
]


def _run_case_format(case_data: Dict[str, Any], fmt: str, extra_settings: Dict[str, Any] | None = None) -> Dict[str, Any]:
    cfg_dict: Dict[str, Any] = {}
    if case_data.get("config_overrides"):
        cfg_dict.update(case_data["config_overrides"])
    cfg = ProjectConfig(**cfg_dict)
    if extra_settings:
        for k, v in extra_settings.items():
            setattr(cfg.settings, k, v)
    params = cfg.to_envelope_parameters()
    model_path = os.path.join(case_data["_dir"], f"model.{fmt}")
    assert os.path.isfile(model_path), f"File model tidak ditemukan: {model_path}"
    return analyze_building_ottv(model_path, f"{case_data['case']}.{fmt}", params)


def _assert_area_close(actual: float, expected: float, rel_tol: float, label: str) -> None:
    if expected <= 1e-6:
        assert abs(actual) <= 0.05, f"{label}: diharapkan 0.0 m2, hasil {actual:.4f} m2"
    else:
        rel_err = abs(actual - expected) / expected
        assert rel_err <= rel_tol, (
            f"{label}: actual={actual:.4f} m2 vs expected={expected:.4f} m2 "
            f"(galat relatif {rel_err*100:.3f}% > {rel_tol*100:.2f}%)"
        )


def test_all_21_synthetic_cases_present():
    assert len(ALL_CASES) >= 21, f"Diharapkan minimal 21 kasus sintetis, ditemukan {len(ALL_CASES)}"


@pytest.mark.parametrize(
    "case_id,fmt,case_data",
    CASE_FORMAT_PARAMS,
    ids=[f"{c}-{f}" for c, f, _ in CASE_FORMAT_PARAMS],
)
def test_synthetic_case_against_analytical_expected(case_id: str, fmt: str, case_data: Dict[str, Any]):
    exp = dict(case_data["expected"])
    per_fmt = (case_data.get("per_format_overrides") or {}).get(fmt, {})
    exp.update(per_fmt)

    tol = case_data.get("tolerance") or {"area_rel": 0.005, "ottv_abs": 0.1}
    area_rel = float(tol.get("area_rel", 0.005))
    ottv_abs = float(tol.get("ottv_abs", 0.1))

    # Kasus yang diharapkan ditolak atau berstatus sementara (Kasus 19: tanpa nama)
    if exp.get("error_expected", False):
        try:
            res = _run_case_format(case_data, fmt)
        except ValueError as exc:
            assert "selubung" in str(exc).lower() or "fasad" in str(exc).lower() or "grup" in str(exc).lower()
            return
        # Jika tidak raise, wajib provisional dan TIDAK boleh "MEMENUHI"
        assert res["summary"]["is_provisional"] is True
        assert "MEMENUHI" not in res["status_label"].upper()
        codes = {w["code"] for w in res["summary"]["warnings"]}
        for fc in exp.get("flags_expected", []):
            assert fc in codes, f"{case_id}.{fmt}: flag {fc} tidak muncul di {codes}"
        return

    res = _run_case_format(case_data, fmt)

    # 1. Total luas selubung & WWR
    _assert_area_close(
        float(res["summary"]["total_envelope_area_m2"]),
        float(exp["total_envelope_area_m2"]),
        area_rel,
        f"{case_id}.{fmt} total_envelope_area_m2",
    )
    assert abs(float(res["summary"]["effective_wwr"]) - float(exp["wwr_total"])) <= 0.005, (
        f"{case_id}.{fmt} WWR: actual={res['summary']['effective_wwr']} vs expected={exp['wwr_total']}"
    )

    # 2. Luas & OTTV per orientasi
    by_code = {row["code"]: row for row in res["orientation_breakdown"]}
    exp_areas = exp["area_by_orientation"]
    exp_ottvs = exp["ottv_by_orientation"]

    for code, e_ar in exp_areas.items():
        assert code in by_code, f"{case_id}.{fmt}: orientasi {code} tidak ditemukan"
        row = by_code[code]
        _assert_area_close(float(row["glazing_area_m2"]), float(e_ar["glazing"]), area_rel, f"{case_id}.{fmt} {code}.glazing")
        _assert_area_close(float(row["wall_area_m2"]), float(e_ar["wall"]), area_rel, f"{case_id}.{fmt} {code}.wall")
        if code in exp_ottvs:
            act_o = float(row["ottv_orientation_wm2"])
            exp_o = float(exp_ottvs[code])
            assert abs(act_o - exp_o) <= ottv_abs, (
                f"{case_id}.{fmt} OTTV[{code}]: actual={act_o:.3f} vs expected={exp_o:.3f} (tol={ottv_abs})"
            )

    # Pastikan orientasi lain tidak mendapat luas nyasar
    for code, row in by_code.items():
        if code not in exp_areas:
            assert float(row["total_area_m2"]) <= 0.05, (
                f"{case_id}.{fmt}: orientasi tak terduga {code} memiliki luas {row['total_area_m2']} m2"
            )

    # 3. Total OTTV
    act_ottv = float(res["ottv_total_wm2"])
    exp_ottv = float(exp["ottv_total_wm2"])
    assert abs(act_ottv - exp_ottv) <= ottv_abs, (
        f"{case_id}.{fmt} OTTV total: actual={act_ottv:.3f} vs expected={exp_ottv:.3f} (tol={ottv_abs})"
    )

    # 4. RTTV & skylight
    exp_rttv = exp.get("rttv") or {}
    act_rttv = res.get("rttv") or {}
    assert bool(act_rttv.get("applicable")) is bool(exp_rttv.get("applicable")), (
        f"{case_id}.{fmt} rttv.applicable: actual={act_rttv.get('applicable')} vs expected={exp_rttv.get('applicable')}"
    )
    assert abs(float(act_rttv.get("skylight_area_m2", 0.0)) - float(exp_rttv.get("skylight_area_m2", 0.0))) <= 0.1, (
        f"{case_id}.{fmt} skylight_area_m2: actual={act_rttv.get('skylight_area_m2')} vs expected={exp_rttv.get('skylight_area_m2')}"
    )
    if exp_rttv.get("applicable") and "rttv_wm2" in exp_rttv:
        assert abs(float(act_rttv.get("rttv_wm2", 0.0)) - float(exp_rttv["rttv_wm2"])) <= 0.1, (
            f"{case_id}.{fmt} rttv_wm2: actual={act_rttv.get('rttv_wm2')} vs expected={exp_rttv['rttv_wm2']}"
        )

    # 5. Status provisional & warning flags
    assert bool(res["summary"]["is_provisional"]) is bool(exp["is_provisional"]), (
        f"{case_id}.{fmt} is_provisional: actual={res['summary']['is_provisional']} vs expected={exp['is_provisional']} "
        f"(warnings={res['summary']['warnings']})"
    )
    act_codes = {w["code"] for w in res["summary"]["warnings"]}
    for fc in exp.get("flags_expected", []):
        assert fc in act_codes, f"{case_id}.{fmt}: flag {fc} tidak muncul di {act_codes}"

    # 6. Pemeriksaan khusus per kasus
    audit = res["stage1_geometry_audit"]
    if case_id == "12_brep_tanpa_mesh":
        total_missing = sum(int(m.get("face_count", 0)) for m in audit.get("missing_mesh", []))
        assert total_missing > 0, "12_brep_tanpa_mesh harus mencatat missing_mesh > 0"
    elif case_id == "13_konteks":
        assert abs(float(audit.get("z_ground_offset_m", 0.0))) <= 0.05, (
            f"13_konteks.{fmt}: Z0 harus 0 (alas kotak), bukan {audit.get('z_ground_offset_m')}"
        )
        grp_cats = {g["group_name"]: g["category"] for g in res["groups"]}
        assert any("pohon" in k.lower() and v in ("unknown", "ignore") for k, v in grp_cats.items()), grp_cats
        assert any("tanah" in k.lower() and v == "ignore" for k, v in grp_cats.items()), grp_cats
    elif case_id == "17_kaca_tebal":
        assert float(act_rttv.get("skylight_area_m2", 0.0)) == 0.0
        reasons = {it.get("reason") for it in audit.get("filtered_items", [])}
        assert reasons & {"sisi_tebal_panel", "thin_edge_sliver"}, (
            f"17_kaca_tebal.{fmt}: tidak ada filtered_items sisi_tebal_panel/thin_edge_sliver ({audit.get('filtered_items')})"
        )
    elif case_id == "21_ifc_cw_opak" and fmt == "ifc":
        grp_cats = {g["group_name"]: g["category"] for g in res["groups"]}
        assert any("orange" in k.lower() and v in ("spandrel", "wall") for k, v in grp_cats.items()), grp_cats
    elif case_id == "22_ifc_covering_dan_id" and fmt == "ifc":
        wall_grps = [g for g in res["groups"] if g["category"] == "wall"]
        assert len(wall_grps) == 1, f"Dinding bersufiks ID harus tergabung ke 1 grup, dapat: {[g['group_name'] for g in wall_grps]}"
        unk_grps = [g for g in res["groups"] if g["category"] == "unknown"]
        assert len(unk_grps) == 0, f"IfcCovering CEILING/FLOORING tidak boleh unknown: {[g['group_name'] for g in unk_grps]}"
        ign_grps = [g for g in res["groups"] if g["category"] == "ignore"]
        assert len(ign_grps) >= 1, "IfcCovering CEILING/FLOORING harus berstatus ignore"


@pytest.mark.parametrize("case_id,case_data", PARITY_CASES, ids=[c for c, _ in PARITY_CASES])
def test_cross_format_parity(case_id: str, case_data: Dict[str, Any]):
    results = {fmt: _run_case_format(case_data, fmt) for fmt in case_data["formats"]}
    ref_fmt = case_data["formats"][0]
    ref = results[ref_fmt]
    ref_area = float(ref["summary"]["total_envelope_area_m2"])
    ref_wwr = float(ref["summary"]["effective_wwr"])
    ref_ottv = float(ref["ottv_total_wm2"])

    for fmt, res in results.items():
        if fmt == ref_fmt:
            continue
        act_area = float(res["summary"]["total_envelope_area_m2"])
        act_wwr = float(res["summary"]["effective_wwr"])
        act_ottv = float(res["ottv_total_wm2"])
        rel_area = abs(act_area - ref_area) / max(1e-6, ref_area)
        assert rel_area <= 0.005, (
            f"Parity area {case_id} ({ref_fmt} vs {fmt}): {ref_area:.2f} vs {act_area:.2f} m2 ({rel_area*100:.3f}%)"
        )
        assert abs(act_wwr - ref_wwr) <= 0.005, (
            f"Parity WWR {case_id} ({ref_fmt} vs {fmt}): {ref_wwr:.4f} vs {act_wwr:.4f}"
        )
        assert abs(act_ottv - ref_ottv) <= 0.1, (
            f"Parity OTTV {case_id} ({ref_fmt} vs {fmt}): {ref_ottv:.2f} vs {act_ottv:.2f} W/m2"
        )


def test_case04_north_angle_equivalence():
    """
    Varian config Kasus 4: geometri Kasus 1 + north_angle_deg=330 (Utara sejati diputar 30 deg CCW,
    ekuivalen dengan bangunan diputar 30 deg CW) harus menghasilkan luas per orientasi & OTTV identik
    dengan `04_kotak_putar30`.
    """
    c01 = next(c for c in ALL_CASES if c["case"] == "01_kotak_m")
    c04 = next(c for c in ALL_CASES if c["case"] == "04_kotak_putar30")

    res_rot_geom = _run_case_format(c04, "3dm")
    res_rot_cfg = _run_case_format(c01, "3dm", extra_settings={"north_angle_deg": 330.0})

    assert abs(float(res_rot_geom["ottv_total_wm2"]) - float(res_rot_cfg["ottv_total_wm2"])) <= 0.01
    g_map = {r["code"]: r for r in res_rot_geom["orientation_breakdown"]}
    c_map = {r["code"]: r for r in res_rot_cfg["orientation_breakdown"]}
    for code in ("TL", "TGR", "BD", "BL"):
        assert abs(float(g_map[code]["total_area_m2"]) - float(c_map[code]["total_area_m2"])) <= 0.05
        assert abs(float(g_map[code]["ottv_orientation_wm2"]) - float(c_map[code]["ottv_orientation_wm2"])) <= 0.01


def test_k1_cache_isolation_01_04_01_same_process():
    """
    K1 regression: menjalankan 01_kotak_m -> 04_kotak_putar30 -> 01_kotak_m dalam satu proses
    (termasuk gc.collect() agar alamat memori array lama bisa dipakai ulang) harus selalu
    menghasilkan luas total 1600 m2 dan luas per orientasi yang benar tanpa kontaminasi cache.
    """
    import gc

    c01 = next(c for c in ALL_CASES if c["case"] == "01_kotak_m")
    c04 = next(c for c in ALL_CASES if c["case"] == "04_kotak_putar30")

    for fmt in ("obj", "3dm", "glb", "ifc"):
        r1 = _run_case_format(c01, fmt)
        gc.collect()
        r4 = _run_case_format(c04, fmt)
        gc.collect()
        r1_again = _run_case_format(c01, fmt)

        assert abs(float(r1["summary"]["total_envelope_area_m2"]) - 1600.0) <= 1.0, f"r1 {fmt}"
        assert abs(float(r4["summary"]["total_envelope_area_m2"]) - 1600.0) <= 1.0, f"r4 {fmt}"
        assert abs(float(r1_again["summary"]["total_envelope_area_m2"]) - 1600.0) <= 1.0, f"r1_again {fmt}"

        m1 = {r["code"]: r["total_area_m2"] for r in r1["orientation_breakdown"]}
        m4 = {r["code"]: r["total_area_m2"] for r in r4["orientation_breakdown"]}
        m1b = {r["code"]: r["total_area_m2"] for r in r1_again["orientation_breakdown"]}

        assert m1["U"] == 320.0 and m1["T"] == 480.0 and m1["TL"] == 0.0
        assert m4["TL"] == 320.0 and m4["TGR"] == 480.0 and m4["U"] == 0.0
        assert m1b["U"] == 320.0 and m1b["T"] == 480.0 and m1b["TL"] == 0.0
        assert abs(float(r1["ottv_total_wm2"]) - float(r1_again["ottv_total_wm2"])) <= 0.01
