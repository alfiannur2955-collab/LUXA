"""
Gaya visual laporan Excel LUXA (tanpa mengubah rumus): lembar Dasbor di depan (pita judul, kartu angka,
grafik bawaan Excel, tabel dengan batang data dan label status), lalu semua lembar lain diseragamkan
(pita judul gelap, kepala tabel terang bergaris bawah, label status berwarna).
Dasbor hanya membaca sel Ringkasan/Per lantai lewat rumus, jadi angka tetap satu sumber.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from openpyxl.chart import BarChart, DoughnutChart, LineChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.series import SeriesLabel
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.formatting.rule import DataBarRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

FONT = "Arial"
INK = "1F1D1A"
BAND = "23211E"
MUTED = "857E73"
LINE = "E6E0D6"
TILE = "F6F3EE"
SUN = "E8890C"
OK, OK_BG = "0F6E66", "DDEFEB"
FAIL, FAIL_BG = "B3261E", "FBE3E0"
P_WALL, P_GLASS, P_SUN = "A79E90", "5B95B8", "E8890C"

def F(size=10, bold=False, color=INK, italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)

def fill(c):
    return PatternFill("solid", fgColor=c)

HAIR = Side(style="thin", color=LINE)
UNDER = Border(bottom=Side(style="medium", color=INK))
LEFT = Alignment(horizontal="left", vertical="center")
RIGHT = Alignment(horizontal="right", vertical="center")
MID = Alignment(horizontal="center", vertical="center")


def _band(ws, last_col: int, title: str, sub: str, rows=(1, 2, 3)) -> None:
    for r in rows:
        ws.row_dimensions[r].height = 22 if r != rows[1] else 30
        for c in range(1, last_col + 1):
            ws.cell(r, c).fill = fill(BAND)
    ws.cell(rows[0], 2, "LUXA · LAPORAN OTTV SNI 6389:2020").font = F(8, True, SUN)
    ws.cell(rows[1], 2, title).font = F(20, True, "FFFFFF")
    ws.cell(rows[2], 2, sub).font = F(9, color="CFC8BD")


def _find(ws, text: str, col: int = 1) -> Optional[int]:
    for r in range(1, ws.max_row + 1):
        v = ws.cell(r, col).value
        if isinstance(v, str) and v.strip() == text.strip():
            return r
    return None


def _tile(ws, r0: int, c0: int, ncol: int, label: str, value: str, fmt: str, caption: str, size: int = 24) -> None:
    for r in range(r0, r0 + 4):
        for c in range(c0, c0 + ncol):
            ws.cell(r, c).fill = fill(TILE)
    lab = ws.cell(r0, c0, label); lab.font = F(9, True, MUTED); lab.alignment = Alignment(vertical="bottom", indent=1)
    v = ws.cell(r0 + 1, c0, value); v.font = F(size, True, INK); v.number_format = fmt
    v.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.merge_cells(start_row=r0 + 1, start_column=c0, end_row=r0 + 2, end_column=c0 + ncol - 1)
    cap = ws.cell(r0 + 3, c0, caption); cap.font = F(8, color=MUTED); cap.alignment = Alignment(vertical="top", indent=1)


def _status_fonts(ws, rng: str, cond_cell: str, size: int, bold: bool = True) -> None:
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f"{cond_cell}>OTTV_LIMIT"], font=Font(name=FONT, size=size, bold=bold, color=FAIL)))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f"{cond_cell}<=OTTV_LIMIT"], font=Font(name=FONT, size=size, bold=bold, color=OK)))


def build_dashboard(wb, analysis: Dict[str, Any]) -> None:
    rs = wb["Ringkasan"]
    r0 = _find(rs, "Arah") or 15
    a, b, tr = r0 + 1, r0 + 8, r0 + 9
    comp = [_find(rs, "  Konduksi dinding"), _find(rs, "  Konduksi kaca"), _find(rs, "  Radiasi kaca")]
    rttv_row = _find(rs, "RTTV atap (W/m²)")
    tot_row = _find(rs, "OTTV total (W/m²)")
    E = f"Ringkasan!$E${a}:$E${b}"
    A = f"Ringkasan!$A${a}:$A${b}"
    B = f"Ringkasan!$B${a}:$B${b}"
    OT = f"Ringkasan!$E${tr}"

    # Ringkasan: angka OTTV total dan kalimat status ikut warna status (hijau memenuhi, merah melebihi)
    _status_fonts(rs, f"E{tr}", f"$E${tr}", 12)
    if tot_row:
        _status_fonts(rs, f"B{tot_row}", f"$B${tot_row}", 12)
        _status_fonts(rs, f"C{tot_row}:F{tot_row}", f"$B${tot_row}", 10)

    ws = wb.create_sheet("Dasbor", 0)
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = SUN
    for i, w in enumerate([2.5, 17] + [11] * 11 + [2.5], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    summ = analysis.get("summary") or {}
    loc = (analysis.get("location_info") or {}).get("city") or "-"
    name = str(analysis.get("filename") or "Model").rsplit(".", 1)[0].replace("_", " ")
    sf_lab = str(analysis.get("sf_source_label") or "Tabel 8 SNI 6389:2020").split(" (")[0]
    _band(ws, 14, name, f"{loc}  ·  {analysis.get('mode_label') or 'Kepatuhan SNI 6389:2020'}  ·  faktor matahari: {sf_lab}")
    st = ws.cell(2, 11, f'=IF({OT}<=OTTV_LIMIT,"MEMENUHI","BELUM MEMENUHI")')
    ws.merge_cells("K2:M2")
    st.font = F(11, True, "FFFFFF"); st.alignment = MID
    ws.conditional_formatting.add("K2:M2", FormulaRule(formula=[f"{OT}<=OTTV_LIMIT"], fill=fill(OK), font=Font(name=FONT, size=11, bold=True, color="FFFFFF")))
    ws.conditional_formatting.add("K2:M2", FormulaRule(formula=[f"{OT}>OTTV_LIMIT"], fill=fill(FAIL), font=Font(name=FONT, size=11, bold=True, color="FFFFFF")))

    # ---- kartu angka (baris 5..8)
    _tile(ws, 5, 2, 3, "OTTV gedung", f"={OT}", "#,##0.00", "W/m² · rata-rata tertimbang seluruh selubung")
    _status_fonts(ws, "B6:D7", "$B$6", 24)
    _tile(ws, 5, 5, 3, "Batas SNI 6389:2020", "=OTTV_LIMIT", "0", "W/m²")
    _tile(ws, 5, 8, 3, "Sisa ke batas", f"=OTTV_LIMIT-{OT}", "+#,##0.00;-#,##0.00;0.00", "W/m² · negatif berarti melewati batas")
    _tile(ws, 5, 11, 3, "Porsi kaca (WWR)", f"=Ringkasan!D{tr}", "0.0%", "luas kaca ÷ luas selubung")
    for r, h in ((5, 22), (6, 21), (7, 21), (8, 18), (9, 12)):
        ws.row_dimensions[r].height = h

    # ---- kalimat ringkas (rumus hidup) + kartu kecil RTTV dan total panas (baris 10..13)
    hot = f"INDEX({A},MATCH(MAX({E}),{E},0))"
    cool_v = f'_xlfn.MINIFS({E},{B},">0")'
    cool = f"INDEX({A},MATCH({cool_v},{E},0))"
    lede = ('="OTTV gedung "&FIXED(%s,2)&" W/m², "&IF(%s<=OTTV_LIMIT,"memenuhi","belum memenuhi")&" batas "&FIXED(OTTV_LIMIT,0)&" W/m². '
            'Sisi terpanas "&%s&" ("&FIXED(MAX(%s),2)&" W/m²), sisi paling sejuk "&%s&" ("&FIXED(%s,2)&" W/m²). '
            '"&COUNTIF(%s,">"&OTTV_LIMIT)&" dari "&COUNTIF(%s,">0")&" sisi melewati batas."') % (OT, OT, hot, E, cool, cool_v, E, B)
    ws.cell(10, 2, "Ringkasan").font = F(12, True)
    c = ws.cell(11, 2, lede); c.font = F(10.5, color=INK); c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells("B11:I13")
    for r in (11, 12, 13):
        ws.row_dimensions[r].height = 17
    ws.cell(10, 10, "Atap dan total panas").font = F(12, True)
    rt = (analysis.get("rttv") or {})
    if rttv_row and rt.get("applicable"):
        rv = ws.cell(11, 10, f"=Ringkasan!B{rttv_row}"); rv.number_format = "#,##0.00"
        lab = "RTTV atap (W/m²)"
    else:
        rv = ws.cell(11, 10, "Tidak dihitung"); lab = "RTTV atap"
    rv.font = F(16, True); rv.alignment = Alignment(horizontal="left", vertical="center")
    ws.merge_cells("J11:K12")
    ws.cell(13, 10, lab).font = F(8, color=MUTED)
    tv = ws.cell(11, 12, f"=Ringkasan!F{tr}/1000"); tv.number_format = "#,##0.0"; tv.font = F(16, True)
    tv.alignment = Alignment(horizontal="left", vertical="center")
    ws.merge_cells("L11:M12")
    ws.cell(13, 12, "Total panas masuk (kW)").font = F(8, color=MUTED)
    ws.row_dimensions[14].height = 10

    # ---- tabel OTTV per arah (baris 15..24)
    ws.cell(15, 2, "OTTV per arah").font = F(12, True)
    ws.row_dimensions[15].height = 22
    heads = [(2, "Arah", LEFT), (3, "OTTV (W/m²)", RIGHT), (4, "Terhadap batas", LEFT), (6, "Status", MID),
             (7, "Luas (m²)", RIGHT), (8, "WWR", RIGHT), (9, "Panas (kW)", RIGHT)]
    for c_, h, al in heads:
        cell = ws.cell(16, c_, h); cell.font = F(8, True, MUTED); cell.alignment = al
    for c_ in range(2, 10):
        ws.cell(16, c_).border = UNDER
    ws.merge_cells("D16:E16")
    oris = analysis.get("orientation_breakdown") or []
    vmax = max([float(o.get("ottv_orientation_wm2") or 0) for o in oris] + [float(analysis.get("sni_limit_wm2") or 35) * 1.4])
    for i in range(8):
        r, src = 17 + i, a + i
        ws.row_dimensions[r].height = 19
        ws.cell(r, 2, f"=Ringkasan!A{src}").font = F(10, True)
        o = ws.cell(r, 3, f'=IF(Ringkasan!B{src}=0,"–",Ringkasan!E{src})'); o.number_format = "#,##0.00"; o.font = F(10); o.alignment = RIGHT
        bar = ws.cell(r, 4, f'=IF(Ringkasan!B{src}=0,"",Ringkasan!E{src})'); bar.number_format = ";;;"
        ws.merge_cells(start_row=r, start_column=4, end_row=r, end_column=5)
        s_ = ws.cell(r, 6, f'=IF(Ringkasan!B{src}=0,"–",IF(Ringkasan!E{src}>OTTV_LIMIT,"Melebihi","Memenuhi"))')
        s_.font = F(9, True, MUTED); s_.alignment = MID
        ar = ws.cell(r, 7, f"=Ringkasan!B{src}"); ar.number_format = '#,##0;;"–"'; ar.alignment = RIGHT; ar.font = F(10)
        w = ws.cell(r, 8, f'=IF(Ringkasan!B{src}=0,"–",Ringkasan!D{src})'); w.number_format = "0%"; w.alignment = RIGHT; w.font = F(10)
        k = ws.cell(r, 9, f"=Ringkasan!F{src}/1000"); k.number_format = '#,##0.0;;"–"'; k.alignment = RIGHT; k.font = F(10)
        for c_ in range(2, 10):
            ws.cell(r, c_).border = Border(bottom=HAIR)
    ws.conditional_formatting.add("D17:D24", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=round(vmax, 1), color=SUN, showValue=False))
    ws.conditional_formatting.add("F17:F24", FormulaRule(formula=['F17="Melebihi"'], fill=fill(FAIL_BG), font=Font(name=FONT, size=9, bold=True, color=FAIL)))
    ws.conditional_formatting.add("F17:F24", FormulaRule(formula=['F17="Memenuhi"'], fill=fill(OK_BG), font=Font(name=FONT, size=9, bold=True, color=OK)))
    ws.conditional_formatting.add("C17:C24", FormulaRule(formula=['AND(ISNUMBER(C17),C17>OTTV_LIMIT)'], font=Font(name=FONT, size=10, bold=True, color=FAIL)))
    ws.cell(25, 2, f"Panjang batang = OTTV arah pada skala 0–{vmax:.0f} W/m².").font = F(8, italic=True, color=MUTED)

    # data bantu grafik (kolom tersembunyi P..T)
    labs = ["Dinding", "Kaca, beda suhu", "Sinar lewat kaca"]
    for i, (lab, rr) in enumerate(zip(labs, comp)):
        ws.cell(30 + i, 16, lab)
        ws.cell(30 + i, 17, f"=Ringkasan!B{rr}" if rr else 0)
    for i in range(8):
        ws.cell(30 + i, 18, f"=Ringkasan!A{a + i}")
        ws.cell(30 + i, 19, f"=Ringkasan!E{a + i}")
        ws.cell(30 + i, 20, "=OTTV_LIMIT")

    # donat jalur panas di kanan tabel
    ws.cell(15, 10, "Dari mana panas masuk").font = F(12, True)
    from openpyxl.chart.series import DataPoint
    dn = DoughnutChart(holeSize=60)
    dn.add_data(Reference(ws, min_col=17, min_row=30, max_row=32), titles_from_data=False)
    dn.set_categories(Reference(ws, min_col=16, min_row=30, max_row=32))
    s0 = dn.series[0]
    for idx, col in enumerate((P_WALL, P_GLASS, P_SUN)):
        pt = DataPoint(idx=idx); pt.graphicalProperties.solidFill = col; pt.graphicalProperties.line.solidFill = "FFFFFF"; s0.dPt.append(pt)
    s0.dLbls = DataLabelList(); s0.dLbls.showPercent = True
    for attr in ("showVal", "showCatName", "showSerName", "showLegendKey", "showLeaderLines"):
        setattr(s0.dLbls, attr, False)
    dn.visible_cells_only = False; dn.legend.position = "r"; dn.title = None; dn.height = 5.4; dn.width = 8.4
    ws.add_chart(dn, "J16")

    # grafik OTTV per arah + garis batas, dan per lantai (baris 27..41)
    ws.cell(27, 2, "OTTV per arah terhadap batas").font = F(12, True)
    ws.row_dimensions[27].height = 22
    bc = BarChart(); bc.type = "col"; bc.gapWidth = 70
    bc.add_data(Reference(ws, min_col=19, min_row=30, max_row=37), titles_from_data=False)
    bc.set_categories(Reference(ws, min_col=18, min_row=30, max_row=37))
    bc.series[0].graphicalProperties.solidFill = SUN; bc.series[0].graphicalProperties.line.noFill = True
    bc.series[0].tx = SeriesLabel(v="OTTV arah (W/m²)")
    ln = LineChart(); ln.add_data(Reference(ws, min_col=20, min_row=30, max_row=37), titles_from_data=False)
    ln.series[0].tx = SeriesLabel(v="Batas SNI")
    ln.series[0].graphicalProperties.line.solidFill = INK; ln.series[0].graphicalProperties.line.dashStyle = "dash"
    ln.series[0].graphicalProperties.line.width = 15000; ln.series[0].marker.symbol = "none"; ln.series[0].smooth = False
    bc += ln
    bc.visible_cells_only = False
    bc.y_axis.majorGridlines.spPr = GraphicalProperties(ln=None); bc.y_axis.majorGridlines.spPr.line.solidFill = LINE
    bc.y_axis.title = None; bc.x_axis.title = None; bc.legend.position = "t"; bc.height = 6.4; bc.width = 18.0
    bc.y_axis.delete = False; bc.x_axis.delete = False; bc.y_axis.scaling.min = 0
    ws.add_chart(bc, "B28")
    fl = wb["Per lantai"] if "Per lantai" in wb.sheetnames else None
    if fl is not None and fl.max_row >= 5 and fl.cell(5, 9).value is not None:
        ws.cell(27, 10, "OTTV per lantai").font = F(12, True)
        last = fl.max_row
        fc = BarChart(); fc.type = "bar"; fc.gapWidth = 35
        fc.add_data(Reference(fl, min_col=9, min_row=5, max_row=last), titles_from_data=False)
        fc.set_categories(Reference(fl, min_col=1, min_row=5, max_row=last))
        fc.series[0].graphicalProperties.solidFill = "C9A57A"; fc.series[0].graphicalProperties.line.noFill = True
        fc.legend = None; fc.height = 6.4; fc.width = 8.4; fc.y_axis.delete = False; fc.x_axis.delete = False
        fc.y_axis.majorGridlines.spPr = GraphicalProperties(ln=None); fc.y_axis.majorGridlines.spPr.line.solidFill = LINE
        fc.y_axis.scaling.min = 0
        ws.add_chart(fc, "J28")

    # ---- material selubung (baris 42..47), nilai dari pilihan di aplikasi
    am = summ.get("active_materials") or {}
    ws.cell(42, 2, "Material selubung").font = F(12, True)
    ws.row_dimensions[42].height = 22
    mh = [(2, "Elemen"), (3, "Material"), (9, "U (W/m²K)"), (10, "SC / α"), (11, "SHGC / TD_ek"), (12, "  Merek / sumber")]
    for c_, h in mh:
        cell = ws.cell(43, c_, h); cell.font = F(8, True, MUTED); cell.alignment = LEFT if c_ in (2, 3, 12) else RIGHT
    for c_ in range(2, 14):
        ws.cell(43, c_).border = UNDER
    rows = [
        ("Kaca", am.get("glazing_name"), am.get("u_fenestration"), am.get("sc_glass"), am.get("shgc_glass"), am.get("glazing_brand"), ("0.00", "0.000", "0.00")),
        ("Dinding / spandrel", am.get("wall_name"), am.get("u_wall"), am.get("alpha_wall"), am.get("td_ek"), am.get("wall_brand"), ("0.00", "0.00", '0.0" K"')),
    ]
    if am.get("frame_name"):
        rows.append(("Rangka", am.get("frame_name"), am.get("u_frame"), None, None, None, ("0.00", "0.00", "0.00")))
    for i, (el, nm, u, x1, x2, br, fmts) in enumerate(rows):
        r = 44 + i
        ws.row_dimensions[r].height = 19
        ws.cell(r, 2, el).font = F(10, True)
        ws.cell(r, 3, nm or "-").font = F(10)
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=8)
        for c_, val, fm in ((9, u, fmts[0]), (10, x1, fmts[1]), (11, x2, fmts[2])):
            cell = ws.cell(r, c_, float(val) if isinstance(val, (int, float)) else "–")
            cell.number_format = fm; cell.alignment = RIGHT; cell.font = F(10)
        mb = ws.cell(r, 12, br or ""); mb.font = F(9, color=MUTED); mb.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.merge_cells(start_row=r, start_column=12, end_row=r, end_column=13)
        for c_ in range(2, 14):
            ws.cell(r, c_).border = Border(bottom=HAIR)
    nr = 44 + len(rows) + 1
    ws.cell(nr, 2, "Angka di lembar ini dibaca dari lembar Ringkasan dan Per lantai (rumus), tidak diketik ulang. "
                   "Material = pilihan di aplikasi; nilai lengkap dan asal datanya di lembar Material.").font = F(8, italic=True, color=MUTED)
    for col in range(16, 21):
        ws.column_dimensions[get_column_letter(col)].hidden = True
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1; ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = f"A1:N{nr + 1}"
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.4
    ws.oddFooter.left.text = "LUXA by Alf Studio"
    ws.oddFooter.right.text = "Hal. &P dari &N"
    wb.active = 0


def restyle_sheets(wb) -> None:
    """Seragamkan lembar lain: pita judul gelap, kepala tabel terang bergaris bawah tebal."""
    for ws in wb.worksheets:
        if ws.title == "Dasbor":
            continue
        ws.sheet_view.showGridLines = False
        last = max(ws.max_column, 8)
        for r in (1, 2):
            for c in range(1, last + 1):
                ws.cell(r, c).fill = fill(BAND)
        t = ws.cell(1, 1); t.font = F(15, True, "FFFFFF")
        s = ws.cell(2, 1); s.font = F(9, color="CFC8BD")
        ws.row_dimensions[1].height = 28; ws.row_dimensions[2].height = 18
        for row in ws.iter_rows(min_row=3):
            for cell in row:
                fg = cell.fill.fgColor.rgb if cell.fill and cell.fill.fill_type == "solid" else None
                if fg and fg.endswith("0F766E"):  # kepala tabel lama (teal pekat)
                    cell.fill = PatternFill(fill_type=None)
                    cell.font = F(8, True, MUTED)
                    cell.border = UNDER
                elif fg and fg.endswith("E6F2F0"):  # baris total
                    cell.fill = fill(TILE)
                    cell.border = Border(top=Side(style="thin", color=INK))
                elif cell.border and cell.border.left and cell.border.left.style == "thin":
                    cell.border = Border(bottom=HAIR)
                pass
