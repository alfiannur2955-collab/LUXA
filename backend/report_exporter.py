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

    is_comp = bool(analysis.get("is_compliance", True))
    mode_tag = "" if is_comp else " [EKSPLORASI — BUKAN UNTUK KEPATUHAN]"
    writer.writerow([f"Laporan Perhitungan OTTV mengacu SNI 6389:2020{mode_tag}"])
    writer.writerow(["Tanggal Evaluasi", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow(["Mode Perhitungan", analysis.get("mode_label", "Kepatuhan SNI 6389:2020")])
    writer.writerow(["Sumber Tabel SF", analysis.get("sf_source_label", "Tabel 8 SNI 6389:2020")])
    if analysis.get("sceff_table_mode"):
        writer.writerow(["Mode Tabel SCeff", analysis.get("sceff_table_mode"), "Jumlah Errata Dipakai", len(analysis.get("sceff_errata_applied") or [])])
    writer.writerow(["File Model 3D", analysis.get("filename", "-"), "Format", analysis.get("format", "-")])
    loc = analysis.get("location_info", {})
    writer.writerow(["Lokasi / Cuaca EPW", loc.get("city", "Jakarta"), "Latitude", loc.get("latitude_deg", -6.21)])
    writer.writerow(["OTTV Total Gedung (W/m2)", analysis.get("ottv_total_wm2"), "Batas SNI (W/m2)", analysis.get("sni_limit_wm2", 35.0)])
    s = analysis.get("summary", {})
    is_prov = bool(s.get("is_provisional", False))
    warnings_list = s.get("warnings") or analysis.get("warnings") or []
    writer.writerow(["Status Kepatuhan", analysis.get("status_label", "-")])
    writer.writerow(["Hasil Sementara (Provisional)", "Ya — perlu konfirmasi" if is_prov else "Tidak"])
    if warnings_list:
        writer.writerow([])
        writer.writerow(["PERINGATAN / KONFIRMASI YANG DIPERLUKAN"])
        writer.writerow(["Kode Peringatan", "Keterangan"])
        for w in warnings_list:
            writer.writerow([w.get("code", "WARNING"), w.get("message", "")])
    writer.writerow([])

    # Summary metrics
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
    if float(s.get("total_glazing_area_m2") or 0) > 1e-4:
        writer.writerow(["U_f Rata-rata Tiga Zona (W/m2K)", s.get("avg_u_fen_wm2k", 0)])
        writer.writerow(["U_frame Efektif (W/m2K)", s.get("u_frame_eff_wm2k", 0)])
        writer.writerow(["Luas Rangka A_frame (m2)", s.get("total_a_frame_m2", 0)])
        writer.writerow(["Luas Tepi Kaca A_edge (m2)", s.get("total_a_edge_m2", 0)])
        writer.writerow(["Lebar Kusen (mm)", s.get("frame_width_mm", 50.0)])
        writer.writerow(["Sumber Lebar Kusen", s.get("frame_source", "asumsi pengguna")])
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
    """Laporan Excel LUXA (Fase 5c): satu-satunya format Excel. Lihat luxa_report.py."""
    from luxa_report import generate_luxa_report

    return generate_luxa_report(analysis)


def report_filename(analysis: Dict[str, Any], ext: str) -> str:
    import os
    import re as _re

    base = os.path.splitext(analysis.get("filename") or "Model LUXA")[0]
    base = _re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip().replace(" ", "_") or "Model_LUXA"
    return f"Laporan_OTTV_LUXA_{base}.{ext}"


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

    s = analysis.get("summary", {})
    verdict = str(
        analysis.get("verdict")
        or s.get("verdict")
        or (
            "sementara"
            if s.get("is_provisional")
            else (
                "simulasi"
                if str(analysis.get("calculation_mode") or "sni").lower() != "sni"
                else (
                    "memenuhi"
                    if float(analysis.get("ottv_total_wm2") or 0.0) <= float(analysis.get("sni_limit_wm2") or 35.0)
                    else "melebihi"
                )
            )
        )
    )
    ottv_v = float(analysis.get("ottv_total_wm2") or 0.0)
    lim_v = float(analysis.get("sni_limit_wm2") or 35.0)
    if verdict == "simulasi":
        verdict_text = "Simulasi — bukan untuk kepatuhan"
    elif verdict == "sementara":
        verdict_text = "Hasil sementara — perlu konfirmasi"
    elif verdict == "memenuhi":
        verdict_text = f"Memenuhi — Di bawah batas {f'{max(0.0, lim_v - ottv_v):.2f}'.replace('.', ',')} W/m²"
    else:
        verdict_text = f"Melebihi — Lewat {f'{max(0.0, ottv_v - lim_v):.2f}'.replace('.', ',')} W/m²"

    pdf_title = (
        "Laporan Perhitungan OTTV mengacu SNI 6389:2020 — Mode Simulasi (Bukan untuk Kepatuhan)"
        if verdict == "simulasi"
        else "Laporan Perhitungan OTTV mengacu SNI 6389:2020"
    )
    elements: List[Any] = []
    elements.append(Paragraph(pdf_title, title_style))
    loc = analysis.get("location_info", {})
    sf_src_pdf = analysis.get("sf_source_label", "Tabel 8 SNI 6389:2020")
    elements.append(
        Paragraph(
            f"<b>File Model:</b> {analysis.get('filename')} ({analysis.get('format')}) &nbsp;|&nbsp; "
            f"<b>Lokasi:</b> {loc.get('city', 'Jakarta')} &nbsp;|&nbsp; "
            f"<b>Sumber SF:</b> {sf_src_pdf} &nbsp;|&nbsp; "
            f"<b>OTTV Total:</b> <b>{f'{ottv_v:.2f}'.replace('.', ',')} W/m²</b> "
            f"({verdict_text})",
            sub_style,
        )
    )

    # 1. Summary Table
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

    if float(s.get("total_glazing_area_m2") or 0) > 1e-4:
        f_src_pdf = s.get("frame_source", "asumsi pengguna")
        fw_pdf = float(s.get("frame_width_mm") if s.get("frame_width_mm") is not None else 50.0)
        u_cog_pdf = float(
            s.get("avg_u_cog_wm2k")
            if s.get("avg_u_cog_wm2k") is not None
            else (s.get("active_materials") or {}).get("u_cog", 0.0)
        )
        u_fen_pdf = float(s.get("avg_u_fen_wm2k") or 0.0)
        r_pct_pdf = float(s.get("frame_ratio_pct") if s.get("frame_ratio_pct") is not None else (
            100.0 * float(s.get("total_a_frame_m2") or 0.0) / max(1e-4, float(s.get("total_glazing_area_m2") or 0.0))
        ))
        fen_note = " (Lebar kusen asumsi)" if f_src_pdf != "terukur" else ""
        elements.append(Paragraph(f"1b. Fenestrasi Tiga Zona — SNI 6389:2020 butir 4.3.2.2 dan Tabel 3{fen_note}", sec_style))
        fen_data = [
            ["U kaca → U_f (W/m²K)", "U_frame Tabel 3 (W/m²K)", "Fraksi r (%)", "A_frame (m²)", "A_edge (m²)", "Lebar Kusen & Sumber"],
            [
                f"{u_cog_pdf:.2f} → {u_fen_pdf:.2f}".replace(".", ","),
                f"{float(s.get('u_frame_eff_wm2k') or 0):.2f}".replace(".", ","),
                f"{r_pct_pdf:.1f}%".replace(".", ","),
                f"{float(s.get('total_a_frame_m2') or 0):,.2f}".replace(",", "_").replace(".", ",").replace("_", "."),
                f"{float(s.get('total_a_edge_m2') or 0):,.2f}".replace(",", "_").replace(".", ",").replace("_", "."),
                f"{fw_pdf:.1f} mm ({f_src_pdf})".replace(".", ","),
            ],
        ]
        t_fen = Table(fen_data, repeatRows=1)
        t_fen.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#F8FAFC")),
            ])
        )
        elements.append(t_fen)
        if f_src_pdf != "terukur":
            elements.append(Paragraph(
                f"Catatan: Lebar kusen asumsi ({f'{fw_pdf:.1f}'.replace('.', ',')} mm) dipakai karena model tidak memiliki grup rangka terukur.",
                sub_style,
            ))

    warnings_pdf = s.get("warnings") or analysis.get("warnings") or []
    if warnings_pdf:
        elements.append(Paragraph("Peringatan / Konfirmasi yang Diperlukan (Hasil Sementara)", sec_style))
        w_rows = [["Kode", "Keterangan Peringatan"]]
        for w in warnings_pdf:
            w_rows.append([str(w.get("code", "WARNING")), Paragraph(str(w.get("message", "")), sub_style)])
        t_warn = Table(w_rows, colWidths=[45 * mm, 220 * mm], repeatRows=1)
        t_warn.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#B45309")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#F59E0B")),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#FFFBEB")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ])
        )
        elements.append(t_warn)

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
            f"{r.get('avg_sc_effective', 0):.3f}" if float(r.get("glazing_area_m2", 0)) > 1e-4 else "-",
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
                "Simulasi" if verdict == "simulasi" else (
                    "Sementara" if verdict == "sementara" else (
                        "Memenuhi" if fl.get("ottv_floor_wm2", 0) <= lim_v else "Melebihi"
                    )
                ),
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
