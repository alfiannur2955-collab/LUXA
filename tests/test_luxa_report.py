"""
Laporan Excel LUXA (Fase 5c, backend/luxa_report.py).

  1. Dihitung ulang oleh LibreOffice (bila ada), OTTV total, OTTV per arah dan RTTV di Excel
     sama dengan aplikasi (selisih <= 0,01) dan kolom "Selisih" bernilai 0.
  2. Tidak ada #REF!/#NAME?/Err: dan tidak ada rumus satu-kolom-penuh (mis. G:G).
  3. Semua material yang dipakai tercantum di lembar Material beserta asal datanya.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

import openpyxl
import pytest

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT_DIR, "backend"))

import browser_api  # noqa: E402
from luxa_report import ORIENTATIONS, generate_luxa_report  # noqa: E402

CASES = ["01_kotak_m", "07_silinder", "08_overhang", "09_sirip", "10_double_skin", "16_skylight", "23_tanpa_kaca"]
SOFFICE = shutil.which("soffice") or shutil.which("libreoffice")
WHOLE_COL = re.compile(r"(?<![A-Za-z0-9_])\$?[A-Z]{1,3}:\$?[A-Z]{1,3}(?![0-9A-Za-z_(])")


def _analyze(case):
    src = os.path.join(ROOT_DIR, "fixtures", "synthetic", case, "model.3dm")
    if not os.path.isfile(src):
        pytest.skip(f"{case} tidak ada")
    mid = "rpt_" + case
    browser_api.register_upload(mid, src, "model.3dm", src)
    cfg = browser_api.default_config("model.3dm")
    cfg["model"]["model_scope"] = "full_building"
    slim = browser_api.analyze(mid, cfg)
    # Laporan dibuat dari salinan LENGKAP yang disimpan engine (sama seperti export_report di aplikasi);
    # nilai kembalian analyze() adalah format kirim ramping untuk tampilan (A3-04).
    return browser_api._get_analysis(slim["analysis_id"])


@pytest.mark.parametrize("case", CASES)
def test_structure_no_errors_no_whole_column_refs_and_materials(case):
    a = _analyze(case)
    wb = openpyxl.load_workbook(io.BytesIO(generate_luxa_report(a)))
    assert wb.sheetnames[:3] == ["Dasbor", "Ringkasan", "Material"]
    assert wb.sheetnames[3:11] == [t for _, _, t in ORIENTATIONS]
    assert wb.sheetnames[-3:] == ["Atap RTTV", "Per lantai", "Referensi"]
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str):
                    assert "#REF!" not in v and "#NAME?" not in v, (ws.title, c.coordinate, v)
                    if v.startswith("="):
                        assert not WHOLE_COL.search(v), (ws.title, c.coordinate, v)
    used = {p["material_id"] for p in a["panels"] if p.get("active") and p.get("material_id")}
    ws_m = wb["Material"]
    listed = {ws_m[f"B{r}"].value for r in range(5, ws_m.max_row + 1)}
    assert used <= listed
    for r in range(5, ws_m.max_row + 1):
        if ws_m[f"B{r}"].value:
            assert ws_m[f"M{r}"].value, f"asal data material {ws_m[f'B{r}'].value} kosong"


@pytest.mark.skipif(SOFFICE is None, reason="LibreOffice tidak terpasang")
def test_libreoffice_recalculation_matches_app():
    tmp = tempfile.mkdtemp()
    analyses = {}
    try:
        for case in CASES:
            a = analyses[case] = _analyze(case)
            with open(os.path.join(tmp, f"{case}.xlsx"), "wb") as f:
                f.write(generate_luxa_report(a))
        out = os.path.join(tmp, "out")
        subprocess.run([SOFFICE, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", out]
                       + [os.path.join(tmp, f"{c}.xlsx") for c in CASES],
                       check=True, timeout=240, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for case, a in analyses.items():
            wb = openpyxl.load_workbook(os.path.join(out, f"{case}.xlsx"), data_only=True)
            for ws in wb.worksheets:
                for row in ws.iter_rows():
                    for c in row:
                        if isinstance(c.value, str):
                            assert not c.value.startswith("#") and "Err:" not in c.value, (case, ws.title, c.coordinate, c.value)
            s = wb["Ringkasan"]
            app_ori = {o["code"]: o["ottv_orientation_wm2"] for o in a["orientation_breakdown"]}
            for i, (code, _, _) in enumerate(ORIENTATIONS):
                r = 16 + i
                assert abs(float(s[f"E{r}"].value) - float(app_ori.get(code, 0.0))) <= 0.01, (case, code)
                assert s[f"H{r}"].value == 0, (case, code, s[f"H{r}"].value)
            assert abs(float(s["E24"].value) - float(a["ottv_total_wm2"])) <= 0.01, case
            assert s["H24"].value == 0, case
            rt = a.get("rttv") or {}
            if rt.get("applicable"):
                ws_r = wb["Atap RTTV"]
                assert abs(float(ws_r["B21"].value) - float(rt["rttv_wm2"])) <= 0.01, case
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_ci_excel_six_decimal_uf_and_selisih_formula():
    """Butir 1 (CI Excel): u_fen_eff dibulatkan 6 desimal di engine, rematerial, dan kunci baris Excel;
    rumus Selisih di Ringkasan memakai ROUND(ROUND(E{n},2)-G{n},2); folder .luxa_tmp tidak ada."""
    from recommender import rematerial_analysis

    a = _analyze("01_kotak_m")
    # Pilih kaca dengan U yang menghasilkan U_f > 4 angka di belakang koma
    a_rem = rematerial_analysis(a, glazing_material_id="glz_igu_lowe_selektif", materials_confirmed=True)
    # Cek langsung pada panel 07_silinder (panel melengkung -> U_f pecahan tak habis 4 desimal)
    a_cyl = _analyze("07_silinder")
    a_cyl_rem = rematerial_analysis(a_cyl, glazing_material_id="glz_igu_lowe_selektif", materials_confirmed=True)

    def _has_gt4_decimals(panels):
        for p in panels:
            if p.get("active") and p.get("element_type") == "glazing":
                v = float(p.get("u_fen_eff") or 0.0)
                if abs(v - round(v, 4)) > 1e-7:
                    return True
        return False

    assert _has_gt4_decimals(a_cyl["panels"]), "engine u_fen_eff masih dibulatkan 4 desimal"
    assert _has_gt4_decimals(a_cyl_rem["panels"]), "rematerial u_fen_eff masih dibulatkan 4 desimal"

    wb = openpyxl.load_workbook(io.BytesIO(generate_luxa_report(a_cyl)))
    ws = wb["Ringkasan"]
    for i in range(len(ORIENTATIONS)):
        n = 16 + i
        assert ws[f"H{n}"].value == f"=ROUND(ROUND(E{n},2)-G{n},2)"
    assert ws["H24"].value == "=ROUND(ROUND(E24,2)-G24,2)"

    # Kunci baris lembar orientasi juga menyimpan 6 desimal u_fen_eff
    found_6dec_in_sheet = False
    for _, _, title in ORIENTATIONS:
        ws_o = wb[title]
        for r in range(11, ws_o.max_row):
            val = ws_o[f"K{r}"].value
            if isinstance(val, (int, float)) and abs(float(val) - round(float(val), 4)) > 1e-7:
                found_6dec_in_sheet = True
                break
        if found_6dec_in_sheet:
            break
    assert found_6dec_in_sheet, "luxa_report masih membulatkan u_fen_eff ke 4 desimal"
    assert not os.path.exists(os.path.join(ROOT_DIR, ".luxa_tmp"))

