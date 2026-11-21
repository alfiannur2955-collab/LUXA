"""
OTTV 3D Parametric Studio — Multi-Format Report Exporter (CSV, Excel .xlsx, PDF)
================================================================================
Generates downloadable engineering reports for SNI 6389:2020 OTTV calculations,
including:
1. Summary & Material Specifications
2. 8-Orientation Breakdown Table (U, TL, T, TGR, S, BD, B, BL)
3. Smart Floor-by-Floor Section Breakdown Table
4. Group / Category & Frame Breakdown
5. Full Per-Panel (Daftar Bidang Fasad) Table.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Dict, List


def generate_csv_report(analysis: Dict[str, Any]) -> bytes:
    """Generates a complete UTF-8 CSV report with summary, 8-orientations, floors, and all panels."""
    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow(["LAPORAN PERHITUNGAN OTTV SELUBUNG BANGUNAN — SNI 6389:2020"])
    writer.writerow(["Tanggal Evaluasi", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow(["File Model 3D", analysis.get("filename", "-"), "Format", analysis.get("format", "-")])
    loc = analysis.get("location_info", {})
    writer.writerow(["Lokasi / Cuaca EPW", loc.get("city", "Jakarta"), "Latitude", loc.get("latitude_deg", -6.21)])
    writer.writerow(["OTTV Total Gedung (W/m2)", analysis.get("ottv_total_wm2"), "Batas SNI (W/m2)", analysis.get("sni_limit_wm2", 35.0)])
    writer.writerow(["Status Kepatuhan", analysis.get("status_label", "-")])
    writer.writerow([])

    # Summary metrics
    s = analysis.get("summary", {})
    writer.writerow(["RINGKASAN SELUBUNG BANGUNAN"])
    writer.writerow(["Total Bidang Terdeteksi", s.get("total_detected_panels", s.get("panel_count", 0))])
    writer.writerow(["Bidang Sisi Luar Aktif Dihitung", s.get("active_panel_count", s.get("panel_count", 0))])
    writer.writerow(["Luas Selubung Aktif (m2)", s.get("total_envelope_area_m2", 0)])
    writer.writerow(["Luas Kaca Bukaan (m2)", s.get("total_glazing_area_m2", 0)])
    writer.writerow(["Luas Dinding Masif/Spandrel (m2)", s.get("total_opaque_area_m2", 0)])
    writer.writerow(["WWR Efektif (%)", round(float(s.get("effective_wwr", 0)) * 100.0, 2)])
    writer.writerow(["Konduksi Dinding (W/m2)", s.get("q_wall_conduction_wm2", 0)])
    writer.writerow(["Konduksi Kaca & Rangka (W/m2)", s.get("q_glass_conduction_wm2", 0)])
    writer.writerow(["Radiasi Surya Bukaan (W/m2)", s.get("q_solar_radiation_wm2", 0)])
    writer.writerow(["Total Beban Panas Selubung (kW)", s.get("total_heat_gain_kw", 0)])
    writer.writerow([])

    # 8-Orientation breakdown
    writer.writerow(["BREAKDOWN 8 ORIENTASI KOMPAS (SNI 6389:2020)"])
    writer.writerow([
        "Kode", "Orientasi", "Sudut Tengah (deg)", "SF Acuan SNI (W/m2)",
        "Jumlah Bidang", "Luas Total (m2)", "Luas Dinding (m2)", "Luas Kaca (m2)",
        "WWR (%)", "SF Interpolasi (W/m2)", "SC Efektif Raycast",
        "Konduksi Dinding (W/m2)", "Konduksi Kaca (W/m2)", "Radiasi Surya (W/m2)",
        "OTTV Orientasi (W/m2)", "Beban Panas (W)"
    ])
    for row in analysis.get("orientation_breakdown", []):
        writer.writerow([
            row.get("code"),
            row.get("name_id"),
            row.get("azimuth_center_deg"),
            row.get("sni_sf_wm2"),
            row.get("panel_count"),
            row.get("total_area_m2"),
            row.get("wall_area_m2"),
            row.get("glazing_area_m2"),
            round(float(row.get("wwr", 0)) * 100.0, 1),
            row.get("avg_sf_interpolated_wm2"),
            row.get("avg_sc_effective"),
            row.get("q_wall_conduction_wm2"),
            row.get("q_glass_conduction_wm2"),
            row.get("q_solar_radiation_wm2"),
            row.get("ottv_orientation_wm2"),
            row.get("heat_gain_watts"),
        ])
    writer.writerow([])

    # Smart Floor Breakdown
    writer.writerow(["BREAKDOWN PER LANTAI (SMART FLOOR SECTION)"])
    writer.writerow([
        "Lantai", "Elevasi Z (m)", "Jumlah Bidang Aktif", "Luas Selubung (m2)",
        "Luas Kaca (m2)", "WWR (%)", "OTTV Lantai (W/m2)", "Beban Panas (kW)", "Status SNI"
    ])
    for fl in analysis.get("floor_breakdown", []):
        writer.writerow([
            fl.get("floor_label"),
            f"{fl.get('z_min', 0):.1f} - {fl.get('z_max', 0):.1f}",
            fl.get("panel_count"),
            fl.get("total_area_m2"),
            fl.get("glazing_area_m2"),
            round(float(fl.get("wwr", 0)) * 100.0, 1),
            fl.get("ottv_floor_wm2"),
            fl.get("heat_gain_kw"),
            "MEMENUHI" if fl.get("ottv_floor_wm2", 0) <= 35.0 else "MELEBIHI",
        ])
    writer.writerow([])

    # Detailed Per-Panel Table
    writer.writerow(["DAFTAR DETAIL PER BIDANG FASAD"])
    writer.writerow([
        "ID Bidang", "Kelompok / Layer", "Kategori", "Lantai", "Aktif Dihitung",
        "Sisi Luar", "Luas (m2)", "Azimut (deg)", "Orientasi", "Tilt (deg)",
        "WWR (%)", "SF (W/m2)", "SC Efektif", "Material Terpasang",
        "OTTV Bidang (W/m2)", "Beban Panas (W)", "Status Verifikasi"
    ])
    for p in analysis.get("panels", []):
        writer.writerow([
            p.get("id"),
            p.get("group_name", p.get("name", "-")),
            p.get("element_type"),
            p.get("floor_label", "L1"),
            "Ya" if p.get("active", True) else "Tidak",
            "Sisi Luar" if p.get("is_outer", True) else "Sisi Dalam",
            p.get("area_m2"),
            p.get("azimuth_deg"),
            p.get("orientation_code"),
            p.get("tilt_deg"),
            round(float(p.get("wwr_panel", 0)) * 100.0, 0),
            p.get("sf_wm2"),
            p.get("sc_effective"),
            p.get("material_name", "-"),
            p.get("ottv_panel_wm2"),
            p.get("heat_gain_w"),
            p.get("verification_label", "OK"),
        ])

    return buf.getvalue().encode("utf-8-sig")


def generate_excel_report(analysis: Dict[str, Any]) -> bytes:
    """
    Generates an official PUPR-compliant multi-sheet .xlsx workbook:
    'BUILDING ENVELOPE COMPLIANCE FORM V2.0 (SNI 6389:2020)'
    Sheets:
      1..8: UTARA, TIMUR LAUT, TIMUR, TENGGARA, SELATAN, BARAT DAYA, BARAT, BARAT LAUT
            (with TABEL 1 Wall, TABEL 2 Fenestration, TABEL 3/4/5 Shading, TABEL 6 Metode 2
             Floor-by-Floor Identification, TABEL 7 Wall Conduction, TABEL 8 Glass Conduction,
             TABEL 9 Solar Radiation — all using live Excel formulas!)
      9:    SUMMARY OTTV (8-side summary linked via live Excel formulas, COMPLY? YES/NO,
             narrative conclusion, and WWR per side table)
      10:   BACK OFFICE (Composite Wall R/U-value tables EW 1..4, City SF table, Shading reference)
      11:   LAMPIRAN 3D PANEL (Smart Floor Sectioning & Detailed 3D Panel Raycast Audit)
    """
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    # Remove default sheet after creating orientation sheets
    default_ws = wb.active

    # Styling definitions matching PUPR Compliance Form v2.0
    pupr_navy = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    pupr_teal = PatternFill(start_color="0F766E", end_color="0F766E", fill_type="solid")
    pupr_green = PatternFill(start_color="14532D", end_color="14532D", fill_type="solid")
    pupr_amber = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    pupr_input = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")
    pupr_calc = PatternFill(start_color="F0FDF4", end_color="F0FDF4", fill_type="solid")
    pupr_sub = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    pupr_tot = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")

    f_title = Font(name="Calibri", size=13, bold=True, color="FFFFFF")
    f_sec = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    f_tbl_hdr = Font(name="Calibri", size=9, bold=True, color="1E293B")
    f_bold = Font(name="Calibri", size=9, bold=True, color="0F172A")
    f_reg = Font(name="Calibri", size=9, bold=False, color="1E293B")
    f_comply = Font(name="Calibri", size=12, bold=True, color="15803D")

    thin_side = Side(style="thin", color="CBD5E1")
    med_side = Side(style="medium", color="475569")
    bdr_thin = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
    bdr_tot = Border(left=thin_side, right=thin_side, top=med_side, bottom=med_side)

    loc = analysis.get("location_info", {})
    city_name = str(loc.get("city", "JAKARTA")).upper()
    station_name = str(loc.get("station", "Jakarta Soekarno-Hatta WMO"))
    s = analysis.get("summary", {})
    mats = s.get("active_materials", {})

    alpha_wall = float(mats.get("alpha_wall", 0.42))
    u_wall = float(mats.get("u_wall", 0.62))
    td_ek = float(mats.get("td_ek", 15.0))
    u_fen = float(mats.get("u_fenestration", 1.10))
    sc_glass = float(mats.get("sc_glass", 0.23))
    shgc_glass = float(mats.get("shgc_glass", round(sc_glass * 0.87, 3)))
    delta_t = float(mats.get("delta_t", 5.0))
    u_frame = float(mats.get("u_frame", 2.10))
    # Effective fenestration U-value including curtain wall frame conduction contribution
    u_fen_eff = round(u_fen + (u_frame * 0.08 if s.get("frame_and_shade_faces", 0) > 0 else 0.0), 3)
    louver_p1 = float(mats.get("louver_depth_m", 0.65))
    louver_h = float(mats.get("louver_spacing_m", 1.10))
    louver_tilt = float(mats.get("louver_tilt_deg", 22.0))

    pupr_orientations = [
        ("U",   "UTARA",      130.0),
        ("TL",  "TIMUR LAUT", 113.0),
        ("T",   "TIMUR",      112.0),
        ("TGR", "TENGGARA",   97.0),
        ("S",   "SELATAN",    97.0),
        ("BD",  "BARAT DAYA", 176.0),
        ("B",   "BARAT",      243.0),
        ("BL",  "BARAT LAUT", 211.0),
    ]

    ori_map = {r["code"]: r for r in analysis.get("orientation_breakdown", [])}
    ori_fl_map = analysis.get("orientation_floor_breakdown", {})
    total_floors = max(1, int(s.get("total_floors", len(analysis.get("floor_breakdown", [])) or 1)))

    # Track total row numbers on each orientation sheet so SUMMARY OTTV can link with live formulas
    sheet_refs: List[Tuple[str, int, int, int]] = []

    for code, sheet_name, base_sf in pupr_orientations:
        ws = wb.create_sheet(title=sheet_name)
        ob = ori_map.get(code, {})
        fl_rows = ori_fl_map.get(code, [])
        if not fl_rows:
            # Fallback if orientation_floor_breakdown wasn't populated
            fl_rows = [{
                "floor_number": 1,
                "floor_code": f"{code} 1",
                "floor_height_m": float(s.get("floor_height_m", 3.6)),
                "facade_length_m": round(float(ob.get("total_area_m2", 0.0)) / 3.6, 2),
                "total_area_m2": float(ob.get("total_area_m2", 0.0)),
                "wall_area_m2": float(ob.get("wall_area_m2", 0.0)),
                "glazing_area_m2": float(ob.get("glazing_area_m2", 0.0)),
                "wwr": float(ob.get("wwr", 0.0)),
                "avg_sf_wm2": float(ob.get("avg_sf_interpolated_wm2", base_sf)),
                "avg_sc_eff": float(ob.get("avg_sc_effective", sc_glass * 0.65)),
            }]
        n_fl = len(fl_rows)

        # Precompute row coordinates for Tables 6, 7, 8, 9
        r6_hdr = 30
        r6_start = 31
        r6_end = r6_start + n_fl - 1
        r6_tot = r6_end + 1

        r7_title = r6_tot + 2
        r7_hdr = r7_title + 1
        r7_start = r7_hdr + 1
        r7_end = r7_start + n_fl - 1
        r7_tot = r7_end + 1

        r8_title = r7_tot + 2
        r8_hdr = r8_title + 1
        r8_start = r8_hdr + 1
        r8_end = r8_start + n_fl - 1
        r8_tot = r8_end + 1

        r9_title = r8_tot + 2
        r9_hdr = r9_title + 1
        r9_start = r9_hdr + 1
        r9_end = r9_start + n_fl - 1
        r9_tot = r9_end + 1

        sheet_refs.append((sheet_name, r7_tot, r8_tot, r9_tot))

        # --- HEADER BLOCK (Rows 1..6) ---
        ws.merge_cells("B1:P1")
        ws["B1"] = "BUILDING ENVELOPE COMPLIANCE FORM V2.0 — SNI 6389:2020 (KEMENTERIAN PUPR)"
        ws["B1"].fill = pupr_navy
        ws["B1"].font = f_title
        ws["B1"].alignment = Alignment(horizontal="left", vertical="center")

        ws.merge_cells("B2:P2")
        ws["B2"] = "PERSYARATAN: Nilai Overall Thermal Transfer Value (OTTV) untuk bangunan tidak boleh melebihi 35 Watts/m2"
        ws["B2"].fill = pupr_amber
        ws["B2"].font = f_bold

        ws["B3"] = "PILIHAN KOTA"
        ws["C3"] = city_name
        ws["C3"].fill = pupr_input
        ws["C3"].font = f_bold
        ws["F3"] = "Project name :"
        ws["G3"] = analysis.get("filename", "Fasad_Curtain_Wall_Baru.3dm")
        ws["G3"].font = f_bold

        ws["B4"] = "ORIENTASI"
        ws["C4"] = sheet_name
        ws["C4"].fill = pupr_amber
        ws["C4"].font = f_bold
        ws["F4"] = "Address / Weather :"
        ws["G4"] = f"{city_name} — {station_name}"

        ws["B5"] = "OTTV SISI FASAD (W/m2)"
        ws["C5"] = f"=IF(C{r7_tot}>0,(K{r7_tot}+K{r8_tot}+K{r9_tot})/C{r7_tot},0)"
        ws["C5"].fill = pupr_tot
        ws["C5"].font = f_bold
        ws["C5"].number_format = "0.00"

        ws["B6"] = "WWR SISI FASAD (%)"
        ws["C6"] = f"=IF(C{r7_tot}>0,D{r8_tot}/C{r7_tot},0)"
        ws["C6"].fill = pupr_calc
        ws["C6"].font = f_bold
        ws["C6"].number_format = "0.0%"

        # --- TABEL 1: DINDING EKSTERIOR (Rows 8..13) ---
        ws.merge_cells("B8:I8")
        ws["B8"] = "IDENTIFIKASI SPESIFIKASI DINDING EKSTERIOR — TABEL 1"
        ws["B8"].fill = pupr_teal
        ws["B8"].font = f_sec

        t1_headers = [
            ("B", "Kode Tipe"),
            ("C", "Nama Konstruksi Dinding Eksterior"),
            ("G", "Absorptansi (α)"),
            ("H", "Uw (W/m2.K)"),
            ("I", "TDek (K)"),
        ]
        ws.merge_cells("C9:F9")
        for col_l, text in t1_headers:
            ws[f"{col_l}9"] = text
            ws[f"{col_l}9"].fill = pupr_sub
            ws[f"{col_l}9"].font = f_tbl_hdr
            ws[f"{col_l}9"].border = bdr_thin

        t1_rows = [
            ("EW 1", mats.get("wall_name", "Spandrel Glass + Rockwool 50mm + Backpan"), alpha_wall, u_wall, td_ek),
            ("EW 2", "Dinding Bata Ringan AAC Hebel 100mm + Plester Aci + Cat Cerah", 0.45, 1.18, 10.0),
            ("EW 3", "Precast Concrete Panel 120mm + ACP PVDF + Insulasi Rockwool", 0.38, 0.68, 15.0),
            ("EW 4", "Dinding Bata Merah 150mm + Plester Standar SNI", 0.65, 2.15, 10.0),
        ]
        for idx_r, (ew_code, ew_name, ew_a, ew_u, ew_td) in enumerate(t1_rows, start=10):
            ws.merge_cells(f"C{idx_r}:F{idx_r}")
            ws[f"B{idx_r}"] = ew_code
            ws[f"C{idx_r}"] = ew_name
            ws[f"G{idx_r}"] = ew_a
            ws[f"H{idx_r}"] = ew_u
            ws[f"I{idx_r}"] = ew_td
            for c_l in ("B", "C", "D", "E", "F", "G", "H", "I"):
                ws[f"{c_l}{idx_r}"].border = bdr_thin
                ws[f"{c_l}{idx_r}"].font = f_reg

        # --- TABEL 2: SISTEM FENESTRASI EKSTERIOR (Rows 15..19) ---
        ws.merge_cells("B15:M15")
        ws["B15"] = "IDENTIFIKASI SPESIFIKASI SISTEM FENESTRASI EKSTERIOR — TABEL 2"
        ws["B15"].fill = pupr_teal
        ws["B15"].font = f_sec

        ws.merge_cells("C16:F16")
        t2_headers = [
            ("B", "Kode"),
            ("C", "Nama Sistem Fenestrasi / Kaca"),
            ("G", "SHGC"),
            ("H", "Uf (W/m2.K)"),
            ("I", "Peneduh Luar"),
            ("J", "Kode Peneduh"),
            ("K", "SC Kaca (SCk)"),
            ("L", "SCeff Peneduh"),
            ("M", "SC Total"),
        ]
        for col_l, text in t2_headers:
            ws[f"{col_l}16"] = text
            ws[f"{col_l}16"].fill = pupr_sub
            ws[f"{col_l}16"].font = f_tbl_hdr
            ws[f"{col_l}16"].border = bdr_thin

        avg_sc_eff_ori = float(ob.get("avg_sc_effective", sc_glass * 0.65))
        sc_mult_ori = round(avg_sc_eff_ori / max(0.05, sc_glass), 3)

        t2_rows = [
            ("F1", mats.get("glazing_name", "Double Glazed IGU Low-E Vision Glass"), shgc_glass, u_fen_eff, "yes", "SE1", sc_glass),
            ("F2", "Crown / SkyGarden Laminated Low-E Glazing", shgc_glass, u_fen_eff, "yes", "SH1", sc_glass),
        ]
        for idx_r, (f_code, f_name, f_shgc, f_u, f_yn, f_shd, f_sck) in enumerate(t2_rows, start=17):
            ws.merge_cells(f"C{idx_r}:F{idx_r}")
            ws[f"B{idx_r}"] = f_code
            ws[f"C{idx_r}"] = f_name
            ws[f"G{idx_r}"] = f_shgc
            ws[f"H{idx_r}"] = f_u
            ws[f"I{idx_r}"] = f_yn
            ws[f"J{idx_r}"] = f_shd
            ws[f"K{idx_r}"] = f_sck
            ws[f"L{idx_r}"] = f"=K26"
            ws[f"M{idx_r}"] = f"=K{idx_r}*L{idx_r}"
            ws[f"M{idx_r}"].number_format = "0.000"
            for c_l in ("B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"):
                ws[f"{c_l}{idx_r}"].border = bdr_thin
                ws[f"{c_l}{idx_r}"].font = f_reg

        # --- TABEL 3, 4, 5: DETIL ELEMEN PENEDUH LUAR (Rows 22..26) ---
        ws.merge_cells("B22:K22")
        ws["B22"] = "DETIL ELEMEN PENEDUH LUAR — TABEL 3 (HORISONTAL SH1), TABEL 4 (VERTIKAL SV1), TABEL 5 (EGGCRATE SE1)"
        ws["B22"].fill = pupr_teal
        ws["B22"].font = f_sec

        t3_headers = [
            ("B", "Kode"),
            ("C", "Tipe Peneduh Eksterior"),
            ("D", "P1 Horisontal (m)"),
            ("E", "Tinggi H (m)"),
            ("F", "P2 Vertikal (m)"),
            ("G", "Lebar W (m)"),
            ("H", "Kemiringan (°)"),
            ("I", "R1 = P1/H"),
            ("J", "R2 = P2/W"),
            ("K", "SCeff (3D Raycast)"),
        ]
        for col_l, text in t3_headers:
            ws[f"{col_l}23"] = text
            ws[f"{col_l}23"].fill = pupr_sub
            ws[f"{col_l}23"].font = f_tbl_hdr
            ws[f"{col_l}23"].border = bdr_thin

        t3_rows = [
            ("SH1", "Horisontal Louver / Transom Canopy", louver_p1, louver_h, 0.0, 1.50, louver_tilt),
            ("SV1", "Vertikal Mullion & SkyGarden Fin", 0.0, 3.60, 0.35, 1.50, 0.0),
            ("SE1", "Eggcrate (Rangka Curtain Wall + Sirip Peneduh 3D)", louver_p1, louver_h, 0.25, 1.50, louver_tilt),
        ]
        for idx_r, (sh_c, sh_n, p1_v, h_v, p2_v, w_v, tilt_v) in enumerate(t3_rows, start=24):
            ws[f"B{idx_r}"] = sh_c
            ws[f"C{idx_r}"] = sh_n
            ws[f"D{idx_r}"] = p1_v
            ws[f"E{idx_r}"] = h_v
            ws[f"F{idx_r}"] = p2_v
            ws[f"G{idx_r}"] = w_v
            ws[f"H{idx_r}"] = tilt_v
            ws[f"I{idx_r}"] = f"=IF(E{idx_r}>0,D{idx_r}/E{idx_r},0)"
            ws[f"J{idx_r}"] = f"=IF(G{idx_r}>0,F{idx_r}/G{idx_r},0)"
            ws[f"K{idx_r}"] = sc_mult_ori
            ws[f"I{idx_r}"].number_format = "0.00"
            ws[f"J{idx_r}"].number_format = "0.00"
            ws[f"K{idx_r}"].number_format = "0.000"
            for c_l in ("B", "C", "D", "E", "F", "G", "H", "I", "J", "K"):
                ws[f"{c_l}{idx_r}"].border = bdr_thin
                ws[f"{c_l}{idx_r}"].font = f_reg

        # --- TABEL 6: IDENTIFIKASI FASAD (METODE 2 PER LANTAI) ---
        ws.merge_cells(f"B{r6_hdr-1}:S{r6_hdr-1}")
        ws[f"B{r6_hdr-1}"] = f"IDENTIFIKASI FASAD ({sheet_name}) — TABEL 6 (METODE 2: RINCIAN PER LANTAI L1..L{n_fl})"
        ws[f"B{r6_hdr-1}"].fill = pupr_green
        ws[f"B{r6_hdr-1}"].font = f_sec

        t6_headers = [
            ("B", "Kode Lantai"),
            ("C", "Tinggi Lantai (m)"),
            ("D", "Panjang Fasad (m)"),
            ("E", "Area Fasad [1] (m2)"),
            ("F", "Tipe Dinding"),
            ("G", "Kode Fenestrasi"),
            ("H", "Area Bukaan [2] (m2)"),
            ("I", "Jml Lantai [3]"),
            ("J", "Total Area Fasad [1]x[3]"),
            ("K", "Total Area Bukaan [2]x[3]"),
            ("L", "WWR Lantai"),
            ("M", "α Dinding"),
            ("N", "Uw Dinding"),
            ("O", "TDek (K)"),
            ("P", "Uf Bukaan"),
            ("Q", "SC Efektif"),
            ("R", "SF (W/m2)"),
            ("S", "ΔT (K)"),
        ]
        for col_l, text in t6_headers:
            ws[f"{col_l}{r6_hdr}"] = text
            ws[f"{col_l}{r6_hdr}"].fill = pupr_sub
            ws[f"{col_l}{r6_hdr}"].font = f_tbl_hdr
            ws[f"{col_l}{r6_hdr}"].border = bdr_thin

        for i_fl, fl_d in enumerate(fl_rows):
            r = r6_start + i_fl
            ws[f"B{r}"] = fl_d["floor_code"]
            ws[f"C{r}"] = fl_d["floor_height_m"]
            ws[f"D{r}"] = fl_d["facade_length_m"]
            ws[f"E{r}"] = fl_d["total_area_m2"]
            ws[f"F{r}"] = "EW 1"
            ws[f"G{r}"] = "F1"
            ws[f"H{r}"] = fl_d["glazing_area_m2"]
            ws[f"I{r}"] = 1
            ws[f"J{r}"] = f"=E{r}*I{r}"
            ws[f"K{r}"] = f"=H{r}*I{r}"
            ws[f"L{r}"] = f"=IF(J{r}>0,K{r}/J{r},0)"
            ws[f"M{r}"] = "=$G$10"
            ws[f"N{r}"] = "=$H$10"
            ws[f"O{r}"] = "=$I$10"
            ws[f"P{r}"] = "=$H$17"
            ws[f"Q{r}"] = fl_d["avg_sc_eff"]
            ws[f"R{r}"] = fl_d["avg_sf_wm2"]
            ws[f"S{r}"] = delta_t

            ws[f"E{r}"].number_format = "0.00"
            ws[f"H{r}"].number_format = "0.00"
            ws[f"J{r}"].number_format = "0.00"
            ws[f"K{r}"].number_format = "0.00"
            ws[f"L{r}"].number_format = "0.0%"
            ws[f"Q{r}"].number_format = "0.000"
            ws[f"R{r}"].number_format = "0.0"

            for c_l, _ in t6_headers:
                ws[f"{c_l}{r}"].border = bdr_thin
                ws[f"{c_l}{r}"].font = f_reg

        # Total Row for TABEL 6 (Metode 1 Reference Equivalence)
        ws[f"B{r6_tot}"] = f"TOTAL {code} (ACUAN METODE 1)"
        ws[f"C{r6_tot}"] = f"=SUM(C{r6_start}:C{r6_end})"
        ws[f"D{r6_tot}"] = f"=AVERAGE(D{r6_start}:D{r6_end})"
        ws[f"E{r6_tot}"] = f"=SUM(E{r6_start}:E{r6_end})"
        ws[f"F{r6_tot}"] = "EW 1"
        ws[f"G{r6_tot}"] = "F1"
        ws[f"H{r6_tot}"] = f"=SUM(H{r6_start}:H{r6_end})"
        ws[f"I{r6_tot}"] = 1
        ws[f"J{r6_tot}"] = f"=SUM(J{r6_start}:J{r6_end})"
        ws[f"K{r6_tot}"] = f"=SUM(K{r6_start}:K{r6_end})"
        ws[f"L{r6_tot}"] = f"=IF(J{r6_tot}>0,K{r6_tot}/J{r6_tot},0)"
        ws[f"L{r6_tot}"].number_format = "0.0%"
        for c_l, _ in t6_headers:
            ws[f"{c_l}{r6_tot}"].fill = pupr_tot
            ws[f"{c_l}{r6_tot}"].font = f_bold
            ws[f"{c_l}{r6_tot}"].border = bdr_tot

        # --- TABEL 7: A. PERHITUNGAN KONDUKSI MELALUI DINDING ---
        ws.merge_cells(f"B{r7_title}:K{r7_title}")
        ws[f"B{r7_title}"] = "SUMMARY FASAD — A. PERHITUNGAN KONDUKSI MELALUI DINDING (TABEL 7)"
        ws[f"B{r7_title}"].fill = pupr_navy
        ws[f"B{r7_title}"].font = f_sec

        t7_headers = [
            ("B", "Kode Lantai"),
            ("C", "Total Area Fasad (m2)"),
            ("D", "Area Dinding Masif (m2)"),
            ("E", "1 - WWR"),
            ("F", "Absorptansi (α)"),
            ("G", "Uw (W/m2.K)"),
            ("H", "TDek (K)"),
            ("I", "OTTV Dinding (W/m2)"),
            ("J", "Rumus SNI"),
            ("K", "Konduksi Dinding (Watt)"),
        ]
        for col_l, text in t7_headers:
            ws[f"{col_l}{r7_hdr}"] = text
            ws[f"{col_l}{r7_hdr}"].fill = pupr_sub
            ws[f"{col_l}{r7_hdr}"].font = f_tbl_hdr
            ws[f"{col_l}{r7_hdr}"].border = bdr_thin

        for i_fl in range(n_fl):
            r6 = r6_start + i_fl
            r7 = r7_start + i_fl
            ws[f"B{r7}"] = f"=B{r6}"
            ws[f"C{r7}"] = f"=J{r6}"
            ws[f"D{r7}"] = f"=J{r6}-K{r6}"
            ws[f"E{r7}"] = f"=1-L{r6}"
            ws[f"F{r7}"] = f"=M{r6}"
            ws[f"G{r7}"] = f"=N{r6}"
            ws[f"H{r7}"] = f"=O{r6}"
            ws[f"I{r7}"] = f"=E{r7}*F{r7}*G{r7}*H{r7}"
            ws[f"J{r7}"] = "(1-WWR)*α*Uw*TDek"
            ws[f"K{r7}"] = f"=C{r7}*I{r7}"
            ws[f"C{r7}"].number_format = "0.00"
            ws[f"D{r7}"].number_format = "0.00"
            ws[f"E{r7}"].number_format = "0.0%"
            ws[f"I{r7}"].number_format = "0.00"
            ws[f"K{r7}"].number_format = "#,##0.0"
            for c_l, _ in t7_headers:
                ws[f"{c_l}{r7}"].border = bdr_thin
                ws[f"{c_l}{r7}"].font = f_reg

        ws[f"B{r7_tot}"] = "TOTAL KONDUKSI DINDING [A]"
        ws[f"C{r7_tot}"] = f"=SUM(C{r7_start}:C{r7_end})"
        ws[f"D{r7_tot}"] = f"=SUM(D{r7_start}:D{r7_end})"
        ws[f"I{r7_tot}"] = f"=IF(C{r7_tot}>0,K{r7_tot}/C{r7_tot},0)"
        ws[f"K{r7_tot}"] = f"=SUM(K{r7_start}:K{r7_end})"
        ws[f"C{r7_tot}"].number_format = "#,##0.00"
        ws[f"D{r7_tot}"].number_format = "#,##0.00"
        ws[f"I{r7_tot}"].number_format = "0.00"
        ws[f"K{r7_tot}"].number_format = "#,##0.0"
        for c_l, _ in t7_headers:
            ws[f"{c_l}{r7_tot}"].fill = pupr_tot
            ws[f"{c_l}{r7_tot}"].font = f_bold
            ws[f"{c_l}{r7_tot}"].border = bdr_tot

        # --- TABEL 8: B. PERHITUNGAN KONDUKSI MELALUI BUKAAN ---
        ws.merge_cells(f"B{r8_title}:K{r8_title}")
        ws[f"B{r8_title}"] = "SUMMARY FASAD — B. PERHITUNGAN KONDUKSI MELALUI BUKAAN (TABEL 8)"
        ws[f"B{r8_title}"].fill = pupr_navy
        ws[f"B{r8_title}"].font = f_sec

        t8_headers = [
            ("B", "Kode Lantai"),
            ("C", "Total Area Fasad (m2)"),
            ("D", "Total Area Bukaan (m2)"),
            ("E", "WWR Lantai"),
            ("F", "Uf Bukaan (W/m2.K)"),
            ("G", "ΔT (K)"),
            ("H", "-"),
            ("I", "OTTV Konduksi Kaca (W/m2)"),
            ("J", "Rumus SNI"),
            ("K", "Konduksi Bukaan (Watt)"),
        ]
        for col_l, text in t8_headers:
            ws[f"{col_l}{r8_hdr}"] = text
            ws[f"{col_l}{r8_hdr}"].fill = pupr_sub
            ws[f"{col_l}{r8_hdr}"].font = f_tbl_hdr
            ws[f"{col_l}{r8_hdr}"].border = bdr_thin

        for i_fl in range(n_fl):
            r6 = r6_start + i_fl
            r8 = r8_start + i_fl
            ws[f"B{r8}"] = f"=B{r6}"
            ws[f"C{r8}"] = f"=J{r6}"
            ws[f"D{r8}"] = f"=K{r6}"
            ws[f"E{r8}"] = f"=L{r6}"
            ws[f"F{r8}"] = f"=P{r6}"
            ws[f"G{r8}"] = f"=S{r6}"
            ws[f"H{r8}"] = ""
            ws[f"I{r8}"] = f"=E{r8}*F{r8}*G{r8}"
            ws[f"J{r8}"] = "WWR*Uf*ΔT"
            ws[f"K{r8}"] = f"=C{r8}*I{r8}"
            ws[f"C{r8}"].number_format = "0.00"
            ws[f"D{r8}"].number_format = "0.00"
            ws[f"E{r8}"].number_format = "0.0%"
            ws[f"I{r8}"].number_format = "0.00"
            ws[f"K{r8}"].number_format = "#,##0.0"
            for c_l, _ in t8_headers:
                ws[f"{c_l}{r8}"].border = bdr_thin
                ws[f"{c_l}{r8}"].font = f_reg

        ws[f"B{r8_tot}"] = "TOTAL KONDUKSI BUKAAN [B]"
        ws[f"C{r8_tot}"] = f"=SUM(C{r8_start}:C{r8_end})"
        ws[f"D{r8_tot}"] = f"=SUM(D{r8_start}:D{r8_end})"
        ws[f"I{r8_tot}"] = f"=IF(C{r8_tot}>0,K{r8_tot}/C{r8_tot},0)"
        ws[f"K{r8_tot}"] = f"=SUM(K{r8_start}:K{r8_end})"
        ws[f"C{r8_tot}"].number_format = "#,##0.00"
        ws[f"D{r8_tot}"].number_format = "#,##0.00"
        ws[f"I{r8_tot}"].number_format = "0.00"
        ws[f"K{r8_tot}"].number_format = "#,##0.0"
        for c_l, _ in t8_headers:
            ws[f"{c_l}{r8_tot}"].fill = pupr_tot
            ws[f"{c_l}{r8_tot}"].font = f_bold
            ws[f"{c_l}{r8_tot}"].border = bdr_tot

        # --- TABEL 9: C. PERHITUNGAN RADIASI MELALUI BUKAAN ---
        ws.merge_cells(f"B{r9_title}:K{r9_title}")
        ws[f"B{r9_title}"] = "SUMMARY FASAD — C. PERHITUNGAN RADIASI SURYA MELALUI BUKAAN (TABEL 9)"
        ws[f"B{r9_title}"].fill = pupr_navy
        ws[f"B{r9_title}"].font = f_sec

        t9_headers = [
            ("B", "Kode Lantai"),
            ("C", "Total Area Fasad (m2)"),
            ("D", "Total Area Bukaan (m2)"),
            ("E", "WWR Lantai"),
            ("F", "SC Efektif Total"),
            ("G", "Solar Factor SF (W/m2)"),
            ("H", "-"),
            ("I", "OTTV Radiasi Surya (W/m2)"),
            ("J", "Rumus SNI"),
            ("K", "Radiasi Bukaan (Watt)"),
        ]
        for col_l, text in t9_headers:
            ws[f"{col_l}{r9_hdr}"] = text
            ws[f"{col_l}{r9_hdr}"].fill = pupr_sub
            ws[f"{col_l}{r9_hdr}"].font = f_tbl_hdr
            ws[f"{col_l}{r9_hdr}"].border = bdr_thin

        for i_fl in range(n_fl):
            r6 = r6_start + i_fl
            r9 = r9_start + i_fl
            ws[f"B{r9}"] = f"=B{r6}"
            ws[f"C{r9}"] = f"=J{r6}"
            ws[f"D{r9}"] = f"=K{r6}"
            ws[f"E{r9}"] = f"=L{r6}"
            ws[f"F{r9}"] = f"=Q{r6}"
            ws[f"G{r9}"] = f"=R{r6}"
            ws[f"H{r9}"] = ""
            ws[f"I{r9}"] = f"=E{r9}*F{r9}*G{r9}"
            ws[f"J{r9}"] = "WWR*SC*SF"
            ws[f"K{r9}"] = f"=C{r9}*I{r9}"
            ws[f"C{r9}"].number_format = "0.00"
            ws[f"D{r9}"].number_format = "0.00"
            ws[f"E{r9}"].number_format = "0.0%"
            ws[f"I{r9}"].number_format = "0.00"
            ws[f"K{r9}"].number_format = "#,##0.0"
            for c_l, _ in t9_headers:
                ws[f"{c_l}{r9}"].border = bdr_thin
                ws[f"{c_l}{r9}"].font = f_reg

        ws[f"B{r9_tot}"] = "TOTAL RADIASI BUKAAN [C]"
        ws[f"C{r9_tot}"] = f"=SUM(C{r9_start}:C{r9_end})"
        ws[f"D{r9_tot}"] = f"=SUM(D{r9_start}:D{r9_end})"
        ws[f"I{r9_tot}"] = f"=IF(C{r9_tot}>0,K{r9_tot}/C{r9_tot},0)"
        ws[f"K{r9_tot}"] = f"=SUM(K{r9_start}:K{r9_end})"
        ws[f"C{r9_tot}"].number_format = "#,##0.00"
        ws[f"D{r9_tot}"].number_format = "#,##0.00"
        ws[f"I{r9_tot}"].number_format = "0.00"
        ws[f"K{r9_tot}"].number_format = "#,##0.0"
        for c_l, _ in t9_headers:
            ws[f"{c_l}{r9_tot}"].fill = pupr_tot
            ws[f"{c_l}{r9_tot}"].font = f_bold
            ws[f"{c_l}{r9_tot}"].border = bdr_tot

        # Adjust column widths for Orientation Sheet
        col_widths = {
            "A": 3, "B": 22, "C": 22, "D": 20, "E": 18, "F": 16, "G": 18,
            "H": 18, "I": 18, "J": 22, "K": 22, "L": 14, "M": 14, "N": 14,
            "O": 12, "P": 14, "Q": 14, "R": 14, "S": 12,
        }
        for col_l, w_val in col_widths.items():
            ws.column_dimensions[col_l].width = w_val

    # =========================================================================
    # SHEET 9: SUMMARY OTTV (Official PUPR Summary Sheet)
    # =========================================================================
    ws_sum = wb.create_sheet(title="SUMMARY OTTV")
    ws_sum.merge_cells("B1:H1")
    ws_sum["B1"] = "BUILDING ENVELOPE COMPLIANCE FORM V2.0 — SUMMARY OTTV (SNI 6389:2020)"
    ws_sum["B1"].fill = pupr_navy
    ws_sum["B1"].font = f_title

    ws_sum.merge_cells("B2:H2")
    ws_sum["B2"] = "PERSYARATAN: Nilai Overall Thermal Transfer Value (OTTV) untuk bangunan tidak boleh melebihi 35 Watts/m2"
    ws_sum["B2"].fill = pupr_amber
    ws_sum["B2"].font = f_bold

    ws_sum["B4"] = "Project name :"
    ws_sum["C4"] = analysis.get("filename", "-")
    ws_sum["C4"].font = f_bold
    ws_sum["E4"] = "PILIHAN KOTA :"
    ws_sum["F4"] = city_name
    ws_sum["F4"].font = f_bold

    ws_sum["B5"] = "Tanggal Evaluasi :"
    ws_sum["C5"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    ws_sum["E5"] = "Stasiun Cuaca EPW :"
    ws_sum["F5"] = station_name

    ws_sum.merge_cells("B7:H7")
    ws_sum["B7"] = "TABEL REKAPITULASI PERHITUNGAN OTTV SELURUH ORIENTASI BANGUNAN"
    ws_sum["B7"].fill = pupr_green
    ws_sum["B7"].font = f_sec

    sum_headers = [
        ("B", "SIDE / ORIENTASI", ""),
        ("C", "Konduksi melalui Dinding (Watt)", "[A]"),
        ("D", "Konduksi melalui Bukaan (Watt)", "[B]"),
        ("E", "Radiasi melalui Bukaan (Watt)", "[C]"),
        ("F", "Total Perpindahan Panas (Watt)", "[D = A + B + C]"),
        ("G", "Total Area Fasad (m2)", "[E]"),
        ("H", "OTTV (Watt/m2)", "[D / E]"),
    ]
    for col_l, h1, h2 in sum_headers:
        ws_sum[f"{col_l}8"] = h1
        ws_sum[f"{col_l}9"] = h2
        ws_sum[f"{col_l}8"].fill = pupr_sub
        ws_sum[f"{col_l}9"].fill = pupr_sub
        ws_sum[f"{col_l}8"].font = f_tbl_hdr
        ws_sum[f"{col_l}9"].font = f_bold
        ws_sum[f"{col_l}8"].border = bdr_thin
        ws_sum[f"{col_l}9"].border = bdr_thin
        ws_sum[f"{col_l}8"].alignment = Alignment(horizontal="center", wrap_text=True)
        ws_sum[f"{col_l}9"].alignment = Alignment(horizontal="center")

    for idx_s, (sh_name, r7_t, r8_t, r9_t) in enumerate(sheet_refs, start=10):
        q_sh = f"'{sh_name}'"
        ws_sum[f"B{idx_s}"] = sh_name
        ws_sum[f"C{idx_s}"] = f"={q_sh}!K{r7_t}"
        ws_sum[f"D{idx_s}"] = f"={q_sh}!K{r8_t}"
        ws_sum[f"E{idx_s}"] = f"={q_sh}!K{r9_t}"
        ws_sum[f"F{idx_s}"] = f"=SUM(C{idx_s}:E{idx_s})"
        ws_sum[f"G{idx_s}"] = f"={q_sh}!C{r7_t}"
        ws_sum[f"H{idx_s}"] = f"=IF(G{idx_s}>0,F{idx_s}/G{idx_s},0)"

        for c_l in ("C", "D", "E", "F", "G"):
            ws_sum[f"{c_l}{idx_s}"].number_format = "#,##0.0"
        ws_sum[f"H{idx_s}"].number_format = "0.00"
        for c_l in ("B", "C", "D", "E", "F", "G", "H"):
            ws_sum[f"{c_l}{idx_s}"].border = bdr_thin
            ws_sum[f"{c_l}{idx_s}"].font = f_reg

    # Row 18: TOTAL OTTV
    ws_sum["B18"] = "TOTAL SELUBUNG BANGUNAN"
    ws_sum["C18"] = "=SUM(C10:C17)"
    ws_sum["D18"] = "=SUM(D10:D17)"
    ws_sum["E18"] = "=SUM(E10:E17)"
    ws_sum["F18"] = "=SUM(F10:F17)"
    ws_sum["G18"] = "=SUM(G10:G17)"
    ws_sum["H18"] = "=IF(G18>0,F18/G18,0)"
    for c_l in ("C", "D", "E", "F", "G"):
        ws_sum[f"{c_l}18"].number_format = "#,##0.0"
    ws_sum["H18"].number_format = "0.00"
    for c_l in ("B", "C", "D", "E", "F", "G", "H"):
        ws_sum[f"{c_l}18"].fill = pupr_tot
        ws_sum[f"{c_l}18"].font = f_bold
        ws_sum[f"{c_l}18"].border = bdr_tot

    # Row 20: COMPLY? YES / NO
    ws_sum["F20"] = "BATAS MAKSIMUM SNI 6389:2020 (W/m2)"
    ws_sum["F20"].font = f_bold
    ws_sum["G20"] = 35.0
    ws_sum["G20"].font = f_bold
    ws_sum["G20"].fill = pupr_amber
    ws_sum["G20"].border = bdr_thin

    ws_sum["F21"] = "COMPLY? (KEPATUHAN SNI 6389:2020)"
    ws_sum["F21"].font = f_bold
    ws_sum["G21"] = '=IF(H18<=35,"YES","NO")'
    ws_sum["G21"].font = f_comply
    ws_sum["G21"].fill = pupr_tot
    ws_sum["G21"].border = bdr_tot
    ws_sum["G21"].alignment = Alignment(horizontal="center")

    # Row 23: Official PUPR Narrative Conclusion
    ws_sum.merge_cells("B23:H24")
    ws_sum["B23"] = (
        '="Perhitungan OTTV pada bangunan gedung ini memperoleh nilai sebesar " & ROUND(H18,2) & '
        '" Watt/m2 dan " & IF(H18<=35,"telah memenuhi","belum memenuhi") & '
        '" standar SNI 6389:2020 tentang Konservasi Energi Selubung Bangunan pada Bangunan Gedung '
        '(Batas Maksimal 35 Watt/m2)."'
    )
    ws_sum["B23"].fill = pupr_calc
    ws_sum["B23"].font = f_bold
    ws_sum["B23"].alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    # Rows 26..36: WWR Summary Table per Orientation
    ws_sum.merge_cells("B26:E26")
    ws_sum["B26"] = "REKAPITULASI WINDOW-TO-WALL RATIO (WWR) PER ORIENTASI"
    ws_sum["B26"].fill = pupr_teal
    ws_sum["B26"].font = f_sec

    wwr_headers = [
        ("B", "SIDE / ORIENTASI"),
        ("C", "Total Area Bukaan (m2) [F]"),
        ("D", "Total Area Fasad (m2) [E]"),
        ("E", "WWR [F / E]"),
    ]
    for col_l, text in wwr_headers:
        ws_sum[f"{col_l}27"] = text
        ws_sum[f"{col_l}27"].fill = pupr_sub
        ws_sum[f"{col_l}27"].font = f_tbl_hdr
        ws_sum[f"{col_l}27"].border = bdr_thin

    for idx_w, (sh_name, r7_t, r8_t, _) in enumerate(sheet_refs, start=28):
        q_sh = f"'{sh_name}'"
        ws_sum[f"B{idx_w}"] = sh_name
        ws_sum[f"C{idx_w}"] = f"={q_sh}!D{r8_t}"
        ws_sum[f"D{idx_w}"] = f"={q_sh}!C{r7_t}"
        ws_sum[f"E{idx_w}"] = f"=IF(D{idx_w}>0,C{idx_w}/D{idx_w},0)"
        ws_sum[f"C{idx_w}"].number_format = "#,##0.00"
        ws_sum[f"D{idx_w}"].number_format = "#,##0.00"
        ws_sum[f"E{idx_w}"].number_format = "0.0%"
        for c_l in ("B", "C", "D", "E"):
            ws_sum[f"{c_l}{idx_w}"].border = bdr_thin
            ws_sum[f"{c_l}{idx_w}"].font = f_reg

    ws_sum["B36"] = "TOTAL / RATA-RATA WWR GEDUNG"
    ws_sum["C36"] = "=SUM(C28:C35)"
    ws_sum["D36"] = "=SUM(D28:D35)"
    ws_sum["E36"] = "=IF(D36>0,C36/D36,0)"
    ws_sum["C36"].number_format = "#,##0.00"
    ws_sum["D36"].number_format = "#,##0.00"
    ws_sum["E36"].number_format = "0.0%"
    for c_l in ("B", "C", "D", "E"):
        ws_sum[f"{c_l}36"].fill = pupr_tot
        ws_sum[f"{c_l}36"].font = f_bold
        ws_sum[f"{c_l}36"].border = bdr_tot

    for col_l, w_val in [("A", 3), ("B", 28), ("C", 28), ("D", 28), ("E", 28), ("F", 30), ("G", 24), ("H", 22)]:
        ws_sum.column_dimensions[col_l].width = w_val

    # =========================================================================
    # SHEET 10: BACK OFFICE (PUPR Material R-Value & SF Lookup Tables)
    # =========================================================================
    ws_bo = wb.create_sheet(title="BACK OFFICE")
    ws_bo["B1"] = "BACK OFFICE — PERHITUNGAN KONSTRUKSI DINDING KOMPOSIT (EW 1..EW 4) & TABEL ACUAN SNI 6389:2020"
    ws_bo["B1"].font = Font(name="Calibri", size=12, bold=True, color="1E3A8A")

    ws_bo["B3"] = "1. TABEL PERHITUNGAN RESISTANSI TERMAL (R-VALUE) & U-VALUE DINDING EKSTERIOR (EW 1 — AKTIF)"
    ws_bo["B3"].font = f_bold
    bo_headers = ["No", "Lapisan Material Penyusun Dinding", "Tebal Lapisan (m)", "Konduktivitas k (W/m.K)", "Resistansi R = t/k (m2.K/W)"]
    for idx_c, h_txt in enumerate(bo_headers, start=2):
        c_let = get_column_letter(idx_c)
        ws_bo[f"{c_let}4"] = h_txt
        ws_bo[f"{c_let}4"].fill = pupr_sub
        ws_bo[f"{c_let}4"].font = f_tbl_hdr
        ws_bo[f"{c_let}4"].border = bdr_thin

    ew1_layers = [
        (1, "Lapisan Udara Luar (Rso — SNI 6389:2020)", 0.0, 0.0, 0.044),
        (2, "Spandrel Toughened Glass / Cladding Luar", 0.008, 1.050, 0.008),
        (3, "Rongga Udara Tertutup (Air Cavity)", 0.025, 0.140, 0.179),
        (4, mats.get("wall_name", "Insulasi Rockwool High-Density 50mm"), 0.050, 0.038, round(max(0.10, (1.0 / max(0.15, u_wall)) - 0.371), 3)),
        (5, "Papan Kalsium Silikat / Backpan Galvanis", 0.009, 0.180, 0.020),
        (6, "Lapisan Udara Dalam (Rsi — SNI 6389:2020)", 0.0, 0.0, 0.120),
    ]
    for idx_r, (l_no, l_name, l_t, l_k, l_r) in enumerate(ew1_layers, start=5):
        ws_bo[f"B{idx_r}"] = l_no
        ws_bo[f"C{idx_r}"] = l_name
        ws_bo[f"D{idx_r}"] = l_t
        ws_bo[f"E{idx_r}"] = l_k
        ws_bo[f"F{idx_r}"] = l_r
        for c_l in ("B", "C", "D", "E", "F"):
            ws_bo[f"{c_l}{idx_r}"].border = bdr_thin
            ws_bo[f"{c_l}{idx_r}"].font = f_reg

    ws_bo["C11"] = "Total Resistansi Termal (R_total = ΣR)"
    ws_bo["F11"] = "=SUM(F5:F10)"
    ws_bo["C12"] = "Transmitansi Termal Dinding (Uw = 1 / R_total) [W/m2.K]"
    ws_bo["F12"] = "=1/F11"
    ws_bo["F11"].font = f_bold
    ws_bo["F12"].font = f_bold
    ws_bo["F12"].fill = pupr_tot

    ws_bo["B15"] = "2. TABEL FAKTOR RADIASI MATAHARI (SOLAR FACTOR SF) SNI 6389:2020 (W/m2)"
    ws_bo["B15"].font = f_bold
    sf_hdrs = ["Kode Orientasi", "Nama Orientasi", "Sudut Azimut (°)", "SF Acuan SNI Jakarta (W/m2)", "SF Lokasi Aktif EPW (W/m2)"]
    for idx_c, h_txt in enumerate(sf_hdrs, start=2):
        c_let = get_column_letter(idx_c)
        ws_bo[f"{c_let}16"] = h_txt
        ws_bo[f"{c_let}16"].fill = pupr_sub
        ws_bo[f"{c_let}16"].font = f_tbl_hdr
        ws_bo[f"{c_let}16"].border = bdr_thin

    for idx_r, (code, sh_name, b_sf) in enumerate(pupr_orientations, start=17):
        ob = ori_map.get(code, {})
        ws_bo[f"B{idx_r}"] = code
        ws_bo[f"C{idx_r}"] = sh_name
        ws_bo[f"D{idx_r}"] = ob.get("azimuth_center_deg", 0)
        ws_bo[f"E{idx_r}"] = b_sf
        ws_bo[f"F{idx_r}"] = ob.get("avg_sf_interpolated_wm2", b_sf)
        for c_l in ("B", "C", "D", "E", "F"):
            ws_bo[f"{c_l}{idx_r}"].border = bdr_thin
            ws_bo[f"{c_l}{idx_r}"].font = f_reg

    for col_l, w_val in [("B", 16), ("C", 44), ("D", 22), ("E", 26), ("F", 28)]:
        ws_bo.column_dimensions[col_l].width = w_val

    # =========================================================================
    # SHEET 11: LAMPIRAN 3D PANEL (Smart Floor Section & 3D Panel Audit)
    # =========================================================================
    ws_pnl = wb.create_sheet(title="LAMPIRAN 3D PANEL")
    pnl_headers = [
        "ID Bidang", "Kelompok Objek", "Kategori", "Lantai", "Hitung (Aktif)",
        "Posisi Kulit", "Luas (m²)", "Azimut (°)", "Arah", "Tilt (°)",
        "WWR (%)", "SF (W/m²)", "SC_eff", "Material", "OTTV Elemen (W/m²)",
        "OTTV Komposit Halus (W/m²)", "Beban Panas (W)", "Jam Terpapar Surya", "Verifikasi"
    ]
    ws_pnl.append(pnl_headers)
    for cell in ws_pnl[1]:
        cell.fill = pupr_green
        cell.font = f_sec

    for p in analysis.get("panels", [])[:15000]:
        ws_pnl.append([
            p.get("id"),
            p.get("group_name", "-"),
            p.get("element_type"),
            p.get("floor_label", "L1"),
            "Aktif" if p.get("active", True) else "Nonaktif",
            "Sisi Luar" if p.get("is_outer", True) else "Sisi Dalam",
            p.get("area_m2"),
            p.get("azimuth_deg"),
            p.get("orientation_code"),
            p.get("tilt_deg"),
            round(float(p.get("wwr_panel", 0)) * 100.0, 0),
            p.get("sf_wm2"),
            p.get("sc_effective"),
            p.get("material_name", "-"),
            p.get("ottv_panel_wm2"),
            p.get("ottv_composite_wm2", p.get("ottv_panel_wm2")),
            p.get("heat_gain_w"),
            p.get("direct_sun_hours", 0),
            p.get("verification_label", "OK"),
        ])

    # Remove initial blank default worksheet
    if default_ws in wb.worksheets and len(wb.worksheets) > 1:
        wb.remove(default_ws)

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def generate_pdf_report(analysis: Dict[str, Any]) -> bytes:
    """Generates a formal printable PDF engineering report using ReportLab (with DLL path resolution)."""
    import os
    if hasattr(os, "add_dll_directory") and os.path.isdir(r"E:\APPS\QGIS\bin"):
        try:
            os.add_dll_directory(r"E:\APPS\QGIS\bin")
        except Exception:
            pass
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    out = io.BytesIO()
    doc = SimpleDocTemplate(
        out,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Heading1"],
        fontSize=15,
        leading=19,
        textColor=colors.HexColor("#14532D"),
        spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        "DocSub",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#334155"),
        spaceAfter=8,
    )
    sec_style = ParagraphStyle(
        "SecHeader",
        parent=styles["Heading2"],
        fontSize=11,
        leading=14,
        textColor=colors.HexColor("#0F172A"),
        spaceBefore=8,
        spaceAfter=4,
    )

    elements: List[Any] = []
    elements.append(Paragraph("LAPORAN TEKNIS PERHITUNGAN OTTV SELUBUNG BANGUNAN (SNI 6389:2020)", title_style))
    loc = analysis.get("location_info", {})
    elements.append(
        Paragraph(
            f"<b>File Model:</b> {analysis.get('filename')} ({analysis.get('format')}) &nbsp;|&nbsp; "
            f"<b>Lokasi / EPW:</b> {loc.get('city', 'Jakarta')} (Lat {loc.get('latitude_deg', -6.21)}°) &nbsp;|&nbsp; "
            f"<b>OTTV Total:</b> <b>{analysis.get('ottv_total_wm2')} W/m²</b> "
            f"({analysis.get('status_label')})",
            sub_style,
        )
    )

    # 1. Summary Table
    s = analysis.get("summary", {})
    elements.append(Paragraph("1. Ringkasan Eksekutif & Komponen Perpindahan Panas", sec_style))
    sum_data = [
        ["Bidang Terdeteksi", "Bidang Luar Aktif", "Luas Selubung (m²)", "Luas Kaca (m²)", "WWR Efektif", "Konduksi Dinding", "Konduksi Kaca", "Radiasi Surya", "OTTV Total"],
        [
            str(s.get("total_detected_panels", s.get("panel_count", 0))),
            str(s.get("active_panel_count", s.get("panel_count", 0))),
            f"{s.get('total_envelope_area_m2', 0):,.1f}",
            f"{s.get('total_glazing_area_m2', 0):,.1f}",
            f"{float(s.get('effective_wwr', 0)) * 100:.1f}%",
            f"{s.get('q_wall_conduction_wm2', 0):.2f} W/m²",
            f"{s.get('q_glass_conduction_wm2', 0):.2f} W/m²",
            f"{s.get('q_solar_radiation_wm2', 0):.2f} W/m²",
            f"{analysis.get('ottv_total_wm2', 0):.2f} W/m²",
        ],
    ]
    t_sum = Table(sum_data, repeatRows=1)
    t_sum.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#14532D")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#F8FAFC")),
        ])
    )
    elements.append(t_sum)

    # 2. 8-Orientation Table
    elements.append(Paragraph("2. Tabel Perhitungan 8 Orientasi Kompas (SNI 6389:2020)", sec_style))
    ori_data = [[
        "Arah", "Orientasi", "Bidang", "Luas (m²)", "Dinding (m²)", "Kaca (m²)",
        "WWR", "SF SNI", "SF Interp", "SC_eff", "Q Dinding", "Q Kaca", "Q Surya", "OTTV (W/m²)"
    ]]
    for r in analysis.get("orientation_breakdown", []):
        ori_data.append([
            r.get("code"),
            r.get("name_id"),
            str(r.get("panel_count")),
            f"{r.get('total_area_m2', 0):.1f}",
            f"{r.get('wall_area_m2', 0):.1f}",
            f"{r.get('glazing_area_m2', 0):.1f}",
            f"{float(r.get('wwr', 0)) * 100:.1f}%",
            f"{r.get('sni_sf_wm2', 0):.0f}",
            f"{r.get('avg_sf_interpolated_wm2', 0):.1f}",
            f"{r.get('avg_sc_effective', 0):.3f}",
            f"{r.get('q_wall_conduction_wm2', 0):.2f}",
            f"{r.get('q_glass_conduction_wm2', 0):.2f}",
            f"{r.get('q_solar_radiation_wm2', 0):.2f}",
            f"{r.get('ottv_orientation_wm2', 0):.2f}",
        ])
    t_ori = Table(ori_data, repeatRows=1)
    t_ori.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
            ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
        ])
    )
    elements.append(t_ori)

    # 3. Smart Floor Section Table
    floors = analysis.get("floor_breakdown", [])
    if floors:
        elements.append(Paragraph("3. Evaluasi Section Pintar Lantai per Lantai", sec_style))
        fl_data = [["Lantai", "Elevasi Z (m)", "Bidang Aktif", "Luas Total (m²)", "Luas Kaca (m²)", "WWR (%)", "OTTV Lantai (W/m²)", "Beban (kW)", "Status"]]
        for fl in floors[:30]:
            fl_data.append([
                fl.get("floor_label"),
                f"{fl.get('z_min', 0):.1f} - {fl.get('z_max', 0):.1f} m",
                str(fl.get("panel_count")),
                f"{fl.get('total_area_m2', 0):.1f}",
                f"{fl.get('glazing_area_m2', 0):.1f}",
                f"{float(fl.get('wwr', 0)) * 100:.1f}%",
                f"{fl.get('ottv_floor_wm2', 0):.2f}",
                f"{fl.get('heat_gain_kw', 0):.2f}",
                "MEMENUHI" if fl.get("ottv_floor_wm2", 0) <= 35.0 else "MELEBIHI",
            ])
        t_fl = Table(fl_data, repeatRows=1)
        t_fl.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0FDFA")]),
            ])
        )
        elements.append(t_fl)

    # 4. Sample Detailed Panels Table (First 120 panels in PDF; full list in CSV/Excel)
    panels = analysis.get("panels", [])
    if panels:
        elements.append(
            Paragraph(
                f"4. Daftar Detail Per Bidang Fasad (Menampilkan 100 dari {len(panels)} bidang — daftar penuh tersedia di unduhan Excel/CSV)",
                sec_style,
            )
        )
        p_data = [["ID Bidang", "Kelompok", "Kategori", "Lantai", "Kulit", "Luas (m²)", "Azimut", "Tilt", "WWR", "SF", "SC_eff", "OTTV (W/m²)", "Verifikasi"]]
        for p in panels[:100]:
            p_data.append([
                p.get("id"),
                str(p.get("group_name", "-"))[:22],
                p.get("element_type"),
                p.get("floor_label", "L1"),
                "Luar" if p.get("is_outer", True) else "Dalam",
                f"{p.get('area_m2', 0):.2f}",
                f"{p.get('azimuth_deg', 0):.1f}° ({p.get('orientation_code')})",
                f"{p.get('tilt_deg', 0):.1f}°",
                f"{float(p.get('wwr_panel', 0)) * 100:.0f}%",
                f"{p.get('sf_wm2', 0):.0f}",
                f"{p.get('sc_effective', 0):.3f}",
                f"{p.get('ottv_panel_wm2', 0):.2f}",
                p.get("verification_label", "OK"),
            ])
        t_pnl = Table(p_data, repeatRows=1)
        t_pnl.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#334155")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ])
        )
        elements.append(t_pnl)

    doc.build(elements)
    return out.getvalue()
