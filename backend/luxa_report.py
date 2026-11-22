"""
Laporan OTTV LUXA (Fase 5c) — workbook Excel buatan LUXA sendiri.

Strukturnya meniru "Building Envelope Compliance Form V2.0" yang beredar luas (lembar input,
8 lembar arah, ringkasan, pustaka), dengan perbaikan:
  - SC = SHGC / 0,87 di semua tempat (standar datasheet; template lama memakai 0,86).
  - Tabel SF yang dipakai tertulis jelas; SNI 6389:2020 Tabel 8 dan tabel lama ada di Referensi.
  - RTTV atap berfungsi (di template lama nama range-nya rusak, #REF!).
  - Tanpa batas 10/25 baris; luas diambil dari bidang 3D, bukan tinggi x panjang x lantai.
  - Tidak ada rumus satu-kolom-penuh (rawan #SPILL! di Excel 365).
  - Asal-usul material (merek, sumber datasheet), SCeff hasil hitung peneduh 3D, rincian
    per lantai, catatan asumsi, dan baris cek "Excel vs aplikasi" yang harus 0,00.
Semua suku panas memakai rumus Excel hidup supaya bisa ditelusuri sel demi sel.
"""

from __future__ import annotations

import io
from collections import OrderedDict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName

from materials_and_epw import get_material_by_id
from version import __version__
from sni_tables import (
    SNI_DELTA_T_K,
    SNI_OTTV_LIMIT_WM2,
    SNI_TABLE_1_ABSORPTANCE_MATERIALS,
    SNI_TABLE_2_ABSORPTANCE_PAINTS,
    SNI_TABLE_7_WALL_TDEK,
    SNI_TABLE_8_SOLAR_FACTOR,
    SNI_TABLE_9_ROOF_TDEK,
    TEMPLATE_PRODI_SF_TABLE,
)

REPORT_VERSION = f"Laporan OTTV LUXA v{__version__}"
SHGC_TO_SC = 0.87

ORIENTATIONS: List[Tuple[str, str, str]] = [
    ("U", "Utara", "U Utara"),
    ("TL", "Timur Laut", "TL Timur Laut"),
    ("T", "Timur", "T Timur"),
    ("TGR", "Tenggara", "TG Tenggara"),
    ("S", "Selatan", "S Selatan"),
    ("BD", "Barat Daya", "BD Barat Daya"),
    ("B", "Barat", "B Barat"),
    ("BL", "Barat Laut", "BL Barat Laut"),
]
AZIMUTH_RANGE = {
    "U": "337,5°–22,5°", "TL": "22,5°–67,5°", "T": "67,5°–112,5°", "TGR": "112,5°–157,5°",
    "S": "157,5°–202,5°", "BD": "202,5°–247,5°", "B": "247,5°–292,5°", "BL": "292,5°–337,5°",
}

# ---------------------------------------------------------------- styles (LUXA identity)
AMBER = "A35400"
TEAL = "0F766E"
INK = "1F1D1A"
MUTED = "6B665E"
F_TITLE = Font(name="Arial", size=16, bold=True, color=AMBER)
F_BRAND = Font(name="Arial", size=9, color=MUTED)
F_H = Font(name="Arial", size=10, bold=True, color=INK)
F_TH = Font(name="Arial", size=9, bold=True, color="FFFFFF")
F_BODY = Font(name="Arial", size=9, color=INK)
F_NOTE = Font(name="Arial", size=8, italic=True, color=MUTED)
F_RESULT = Font(name="Arial", size=12, bold=True, color=TEAL)
F_OK = Font(name="Arial", size=10, bold=True, color=TEAL)
FILL_TH = PatternFill("solid", fgColor=TEAL)
FILL_INPUT = PatternFill("solid", fgColor="FBF3E6")  # nilai dari model/aplikasi
FILL_CALC = PatternFill("solid", fgColor="FFFFFF")  # rumus Excel
FILL_TOTAL = PatternFill("solid", fgColor="E6F2F0")
FILL_CHECK = PatternFill("solid", fgColor="F1EFE8")
THIN = Side(style="thin", color="D9D4CA")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
NUM2 = "#,##0.00"
NUM3 = "0.000"
NUM4 = "0.0000"


def _set(ws, ref: str, value: Any, font: Font = F_BODY, fill: Optional[PatternFill] = None,
         fmt: Optional[str] = None, align: Optional[Alignment] = None, border: bool = False) -> None:
    c = ws[ref]
    c.value = value
    c.font = font
    if fill is not None:
        c.fill = fill
    if fmt:
        c.number_format = fmt
    if align is not None:
        c.alignment = align
    if border:
        c.border = BOX


def _header(ws, row: int, labels: List[str], height: int = 42) -> None:
    for i, lab in enumerate(labels, start=1):
        _set(ws, f"{get_column_letter(i)}{row}", lab, F_TH, FILL_TH, align=CENTER, border=True)
    ws.row_dimensions[row].height = height


def _brand(ws, title: str, subtitle: str, last_col: str) -> None:
    _set(ws, "A1", title, F_TITLE)
    ws.merge_cells(f"A1:{last_col}1")
    _set(ws, "A2", subtitle, F_BRAND)
    ws.merge_cells(f"A2:{last_col}2")
    ws.row_dimensions[1].height = 24
    ws.sheet_view.showGridLines = False


def _page(ws, landscape: bool = True) -> None:
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.oddFooter.left.text = "LUXA by Alf Studio · " + REPORT_VERSION
    ws.oddFooter.right.text = "Hal. &P dari &N"


def _widths(ws, widths: Dict[str, float]) -> None:
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


def _name(wb: Workbook, name: str, ref: str) -> None:
    dn = DefinedName(name, attr_text=ref)
    try:
        wb.defined_names[name] = dn  # openpyxl >= 3.1
    except TypeError:  # pragma: no cover - older openpyxl
        wb.defined_names.append(dn)


def _fmt_id(v: Optional[float], d: int = 2) -> str:
    if v is None:
        return "-"
    return f"{float(v):,.{d}f}".replace(",", "_").replace(".", ",").replace("_", ".")


# ---------------------------------------------------------------- data shaping

def _material(mid: Optional[str], extra: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not mid:
        return None
    return get_material_by_id(mid, extra_materials=extra)


def _rows_for_orientation(panels: List[Dict[str, Any]], code: str) -> List[Dict[str, Any]]:
    """Group active panels of one orientation into rows with identical thermal inputs.
    Within a row only the areas differ, so the Excel formulas reproduce the app exactly."""
    rows: "OrderedDict[tuple, Dict[str, Any]]" = OrderedDict()
    for p in panels:
        if not p.get("active") or p.get("orientation_code") != code:
            continue
        area = float(p.get("area_m2") or 0.0)
        wwr = float(p.get("wwr_panel") or 0.0)
        a_w = area * (1.0 - wwr)
        a_f = area * wwr
        wall = (round(float(p.get("alpha_wall_eff") or 0), 4), round(float(p.get("u_wall_eff") or 0), 4),
                round(float(p.get("td_ek_eff") or 0), 3)) if a_w > 1e-9 else None
        glass = (round(float(p.get("u_fen_eff") or 0), 4), round(float(p.get("sc_glass") or 0), 6),
                 round(float(p.get("sc_effective") or 0), 6), round(float(p.get("sf_wm2") or 0), 3)) if a_f > 1e-9 else None
        key = (p.get("group_name"), p.get("floor_label") or "", p.get("material_id"), wall, glass)
        r = rows.get(key)
        if r is None:
            r = rows[key] = {
                "group": p.get("group_name") or "-",
                "floor": p.get("floor_label") or "-",
                "material_id": p.get("material_id"),
                "material_name": p.get("material_name") or p.get("material_id") or "-",
                "element": p.get("element_type"),
                "wall": wall, "glass": glass, "a_w": 0.0, "a_f": 0.0, "n": 0,
            }
        r["a_w"] += a_w
        r["a_f"] += a_f
        r["n"] += 1
    return list(rows.values())


# ---------------------------------------------------------------- sheets

def _sheet_orientation(wb: Workbook, analysis: Dict[str, Any], code: str, name: str, title: str,
                       ori_app: Dict[str, Any]) -> Dict[str, str]:
    ws = wb.create_sheet(title)
    _brand(ws, f"OTTV arah {name} ({'TG' if code == 'TGR' else code})",
           f"Azimut {AZIMUTH_RANGE[code]} · {analysis.get('filename', '')} · sel krem = nilai dari model 3D, sel putih = rumus",
           "T")
    rows = _rows_for_orientation(analysis.get("panels") or [], code)
    first = 11
    last = first + max(len(rows), 1) - 1

    labels = ["No", "Kelompok bidang", "Lantai", "Material", "Jumlah bidang",
              "Luas dinding A_w (m²)", "Luas kaca A_f (m²)", "α dinding", "U dinding (W/m²K)", "TD_ek (K)",
              "U kaca (W/m²K)", "SC kaca (=SHGC/0,87)", "SC efektif (peneduh 3D)", "Pengali peneduh",
              "SF (W/m²)", "Konduksi dinding (W)", "Konduksi kaca (W)", "Radiasi kaca (W)", "Total panas (W)", "Catatan"]
    _header(ws, first - 1, labels)
    if not rows:
        _set(ws, f"B{first}", "Tidak ada bidang yang menghadap arah ini.", F_NOTE)
        for col in "FGPQRS":
            _set(ws, f"{col}{first}", 0, F_BODY, FILL_INPUT if col in "FG" else FILL_CALC, NUM2, border=True)
    for i, r in enumerate(rows):
        n = first + i
        _set(ws, f"A{n}", i + 1, border=True, align=CENTER)
        _set(ws, f"B{n}", r["group"], border=True)
        _set(ws, f"C{n}", r["floor"], border=True, align=CENTER)
        _set(ws, f"D{n}", r["material_name"], border=True)
        _set(ws, f"E{n}", r["n"], border=True, align=CENTER)
        _set(ws, f"F{n}", round(r["a_w"], 4), fill=FILL_INPUT, fmt=NUM2, border=True)
        _set(ws, f"G{n}", round(r["a_f"], 4), fill=FILL_INPUT, fmt=NUM2, border=True)
        if r["wall"]:
            _set(ws, f"H{n}", r["wall"][0], fill=FILL_INPUT, fmt="0.00", border=True)
            _set(ws, f"I{n}", r["wall"][1], fill=FILL_INPUT, fmt="0.00", border=True)
            _set(ws, f"J{n}", r["wall"][2], fill=FILL_INPUT, fmt="0.0", border=True)
        else:
            for col in "HIJ":
                _set(ws, f"{col}{n}", None, fill=FILL_INPUT, border=True)
        if r["glass"]:
            uf, sc, sce, sf = r["glass"]
            _set(ws, f"K{n}", uf, fill=FILL_INPUT, fmt="0.00", border=True)
            _set(ws, f"L{n}", sc, fill=FILL_INPUT, fmt=NUM4, border=True)
            _set(ws, f"M{n}", sce, fill=FILL_INPUT, fmt=NUM4, border=True)
            _set(ws, f"N{n}", f"=IF(L{n}=0,0,M{n}/L{n})", fill=FILL_CALC, fmt=NUM3, border=True)
            _set(ws, f"O{n}", sf, fill=FILL_INPUT, fmt="0.0", border=True)
        else:
            for col in "KLMO":
                _set(ws, f"{col}{n}", None, fill=FILL_INPUT, border=True)
            _set(ws, f"N{n}", None, border=True)
        _set(ws, f"P{n}", f"=F{n}*N(H{n})*N(I{n})*N(J{n})", fmt=NUM2, border=True)
        _set(ws, f"Q{n}", f"=G{n}*N(K{n})*DELTA_T", fmt=NUM2, border=True)
        _set(ws, f"R{n}", f"=G{n}*N(M{n})*N(O{n})", fmt=NUM2, border=True)
        _set(ws, f"S{n}", f"=P{n}+Q{n}+R{n}", fmt=NUM2, border=True)
        _set(ws, f"T{n}", "Elemen: " + str(r["element"] or "-"), F_NOTE, border=True)

    rng = lambda col: f"{col}{first}:{col}{last}"  # noqa: E731 - explicit ranges, never whole columns
    # Result block (fixed cells, referenced by Ringkasan)
    blocks = [
        ("B4", "Luas dinding (m²)", "C4", f"=SUM({rng('F')})", NUM2),
        ("B5", "Luas kaca (m²)", "C5", f"=SUM({rng('G')})", NUM2),
        ("B6", "Luas selubung A_o (m²)", "C6", "=C4+C5", NUM2),
        ("B7", "WWR", "C7", "=IF(C6=0,0,C5/C6)", "0.0%"),
        ("E4", "Konduksi dinding (W/m²)", "G4", f"=IF($C$6=0,0,SUM({rng('P')})/$C$6)", NUM2),
        ("E5", "Konduksi kaca (W/m²)", "G5", f"=IF($C$6=0,0,SUM({rng('Q')})/$C$6)", NUM2),
        ("E6", "Radiasi kaca (W/m²)", "G6", f"=IF($C$6=0,0,SUM({rng('R')})/$C$6)", NUM2),
        ("E7", "OTTV arah (W/m²)", "G7", "=G4+G5+G6", NUM2),
        ("I4", "Total panas (W)", "K4", f"=SUM({rng('S')})", NUM2),
        ("I5", "OTTV arah di aplikasi", "K5", round(float(ori_app.get("ottv_orientation_wm2") or 0.0), 2), NUM2),
        ("I6", "Selisih Excel − aplikasi", "K6", "=ROUND(G7-K5,2)", NUM2),
    ]
    for lab_ref, lab, val_ref, val, fmt in blocks:
        _set(ws, lab_ref, lab, F_H)
        is_app = lab.endswith("di aplikasi")
        _set(ws, val_ref, val, F_RESULT if val_ref == "G7" else F_BODY,
             FILL_INPUT if is_app else (FILL_CHECK if "Selisih" in lab else FILL_TOTAL), fmt, border=True)
    _set(ws, "M4", "Rumus per baris:", F_H)
    _set(ws, "M5", "Konduksi dinding = A_w × α × U × TD_ek", F_NOTE)
    _set(ws, "M6", "Konduksi kaca = A_f × U_f × ΔT", F_NOTE)
    _set(ws, "M7", "Radiasi kaca = A_f × SC_ef × SF;  OTTV arah = Σ panas / A_o", F_NOTE)
    _set(ws, "B8", "Kosong pada kolom α/U/TD_ek berarti baris itu hanya kaca (atau hanya dinding untuk kolom kaca).", F_NOTE)
    ws.merge_cells("B8:T8")

    total_row = last + 1
    _set(ws, f"B{total_row}", "Jumlah", F_H, FILL_TOTAL, border=True)
    for col in "EFGPQRS":
        _set(ws, f"{col}{total_row}", f"=SUM({rng(col)})", F_H, FILL_TOTAL, NUM2 if col != "E" else "0", border=True)
    ws.freeze_panes = f"C{first}"
    _widths(ws, {"A": 5, "B": 30, "C": 7, "D": 34, "E": 8, "F": 11, "G": 11, "H": 8, "I": 9, "J": 8, "K": 9,
                 "L": 10, "M": 10, "N": 9, "O": 8, "P": 12, "Q": 12, "R": 12, "S": 13, "T": 16})
    _page(ws)
    q = f"'{title}'"
    return {"area": f"{q}!$C$6", "glass": f"{q}!$C$5", "heat": f"{q}!$K$4", "ottv": f"{q}!$G$7",
            "wall_w": f"SUM({q}!P{first}:P{last})", "cond_w": f"SUM({q}!Q{first}:Q{last})",
            "rad_w": f"SUM({q}!R{first}:R{last})"}


def _sheet_material(wb: Workbook, analysis: Dict[str, Any], extra: List[Dict[str, Any]]) -> None:
    ws = wb.create_sheet("Material")
    _brand(ws, "Material yang dipakai", "Nilai dari katalog LUXA (bawaan SNI, referensi brand dengan datasheet, atau buatan pengguna). "
           "SC dihitung dari SHGC / 0,87.", "Q")
    used: "OrderedDict[str, List[str]]" = OrderedDict()
    for p in analysis.get("panels") or []:
        if p.get("active") and p.get("material_id"):
            code = p.get("orientation_code") or ""
            used.setdefault(p["material_id"], [])
            if code and code not in used[p["material_id"]]:
                used[p["material_id"]].append(code)
    settings = (analysis.get("config") or {}).get("settings") or {}
    roof_id = settings.get("roof_material_id")
    if roof_id and (analysis.get("rttv") or {}).get("applicable"):
        used.setdefault(roof_id, []).append("Atap")
    labels = ["Kategori", "ID", "Nama", "Merek", "Konfigurasi", "U (W/m²K)", "α", "Massa (kg/m²)", "TD_ek (K)",
              "SHGC", "SC (=SHGC/0,87)", "VLT", "Asal data", "Sumber", "Tanggal akses", "Dipakai di", "Catatan"]
    _header(ws, 4, labels)
    cat_id = {"glazing": "Kaca", "wall": "Dinding", "roof": "Atap", "frame": "Rangka"}
    for i, (mid, where) in enumerate(used.items()):
        n = 5 + i
        m = _material(mid, extra) or {"id": mid, "name": mid}
        shgc = m.get("shgc")
        if shgc is None and m.get("sc") is not None:
            shgc = round(float(m["sc"]) * SHGC_TO_SC, 4)
        origin = m.get("origin") or ("user" if m.get("is_custom") else ("brand_reference" if m.get("status") == "datasheet" else "sni_generic"))
        origin_label = {"brand_reference": "Referensi brand", "user": "Buatan pengguna", "sni_generic": "Bawaan SNI"}.get(origin, origin)
        vals = [cat_id.get(m.get("category"), m.get("category")), mid, m.get("name"), m.get("brand"),
                m.get("configuration") or m.get("technology"), m.get("u_value"), m.get("alpha"), m.get("massa_kg_m2"),
                m.get("td_ek"), shgc, None, m.get("vlt"), origin_label, m.get("sumber"), m.get("tanggal_akses"),
                ", ".join("TG" if w == "TGR" else w for w in where), m.get("catatan") or m.get("description")]
        for j, v in enumerate(vals, start=1):
            col = get_column_letter(j)
            _set(ws, f"{col}{n}", v, fill=FILL_INPUT if j in (6, 7, 8, 9, 10, 12) else None, border=True,
                 align=WRAP if j in (3, 5, 14, 16, 17) else None)
        ws.row_dimensions[n].height = 48
        _set(ws, f"K{n}", f'=IF(J{n}="","",J{n}/{SHGC_TO_SC})', fmt=NUM4, border=True)
        _set(ws, f"L{n}", m.get("vlt"), fill=FILL_INPUT, fmt="0%", border=True)
        src = str(m.get("sumber") or "")
        if src.startswith("http"):
            ws[f"N{n}"].hyperlink = src
            ws[f"N{n}"].value = m.get("sumber_judul") or src
            ws[f"N{n}"].font = Font(name="Arial", size=9, color=TEAL, underline="single")
    _widths(ws, {"A": 9, "B": 26, "C": 36, "D": 18, "E": 22, "F": 9, "G": 6, "H": 9, "I": 8, "J": 7, "K": 10,
                 "L": 6, "M": 14, "N": 40, "O": 11, "P": 14, "Q": 30})
    ws.freeze_panes = "C5"
    _page(ws)


def _sheet_roof(wb: Workbook, analysis: Dict[str, Any]) -> Optional[str]:
    rt = analysis.get("rttv") or {}
    ws = wb.create_sheet("Atap RTTV")
    _brand(ws, "RTTV atap", "Rumus SNI 6389:2020 Pasal 4.4: RTTV = α × U_r × TD_ek × (1 − SRR) + U_s × SRR × ΔT + SC_s × SF × SRR", "F")
    if not rt.get("applicable"):
        _set(ws, "A4", "Model ini tidak memiliki atap yang dihitung (RTTV tidak berlaku).", F_H)
        _page(ws, landscape=False)
        return None
    inputs = [
        ("Luas atap masif (m²)", rt.get("opaque_roof_area_m2"), NUM2),
        ("Luas skylight (m²)", rt.get("skylight_area_m2"), NUM2),
        ("α atap", rt.get("alpha_roof"), "0.00"),
        ("U atap U_r (W/m²K)", rt.get("u_roof"), "0.00"),
        ("Massa atap (kg/m²)", rt.get("massa_kg_m2"), "0.0"),
        ("TD_ek atap (K, Tabel 9)", rt.get("td_eq_k"), "0.0"),
        ("U skylight U_s (W/m²K)", rt.get("u_skylight"), "0.00"),
        ("SC skylight", rt.get("sc_skylight"), NUM4),
        ("SF atap (W/m²)", rt.get("sf_roof_wm2"), "0.0"),
    ]
    _set(ws, "A4", "Masukan dari model dan material", F_H)
    for i, (lab, val, fmt) in enumerate(inputs):
        n = 5 + i
        _set(ws, f"A{n}", lab, border=True)
        _set(ws, f"B{n}", val, fill=FILL_INPUT, fmt=fmt, border=True)
    _set(ws, "A15", "Perhitungan (rumus)", F_H)
    calc = [
        ("Luas atap total (m²)", "=B5+B6", NUM2),
        ("SRR (rasio skylight)", "=IF(B16=0,0,B6/B16)", NUM4),
        ("Konduksi atap masif (W/m²)", "=B7*B8*B10*(1-B17)", NUM2),
        ("Konduksi skylight (W/m²)", "=B11*B17*DELTA_T", NUM2),
        ("Radiasi skylight (W/m²)", "=B12*B13*B17", NUM2),
        ("RTTV (W/m²)", "=B18+B19+B20", NUM2),
        ("Batas RTTV (W/m²)", rt.get("limit_wm2"), "0.0"),
        ("Status", '=IF(B21<=B22,"Memenuhi","Tidak memenuhi")', None),
        ("RTTV di aplikasi", rt.get("rttv_wm2"), NUM2),
        ("Selisih Excel − aplikasi", "=ROUND(B21-B24,2)", NUM2),
    ]
    for i, (lab, val, fmt) in enumerate(calc):
        n = 16 + i
        _set(ws, f"A{n}", lab, F_H if lab.startswith("RTTV (") else F_BODY, border=True)
        fill = FILL_INPUT if lab in ("Batas RTTV (W/m²)", "RTTV di aplikasi") else (FILL_CHECK if "Selisih" in lab else FILL_TOTAL)
        _set(ws, f"B{n}", val, F_RESULT if lab.startswith("RTTV (") else F_BODY, fill, fmt, border=True)
    _set(ws, "D5", "Batas: 10 W/m² bila atap tanpa skylight, 35 W/m² bila ada skylight (Pasal 4.4.1).", F_NOTE)
    _widths(ws, {"A": 34, "B": 16, "C": 3, "D": 70})
    _page(ws, landscape=False)
    return "'Atap RTTV'!$B$21"


def _sheet_floors(wb: Workbook, analysis: Dict[str, Any]) -> None:
    ws = wb.create_sheet("Per lantai")
    method = analysis.get("floor_detection_method") or "-"
    _brand(ws, "Rincian per lantai", f"Nilai dari aplikasi. Sumber deteksi lantai: {method}. Jumlah lantai tidak mengubah OTTV total.", "J")
    labels = ["Lantai", "Zona", "z bawah (m)", "z atas (m)", "Tinggi (m)", "Luas selubung (m²)", "Luas kaca (m²)",
              "WWR", "OTTV lantai (W/m²)", "Panas (kW)"]
    _header(ws, 4, labels, height=30)
    floors = analysis.get("floor_breakdown") or []
    if not floors:
        _set(ws, "A5", "Lantai tidak terdeteksi untuk model ini.", F_NOTE)
    for i, f in enumerate(floors):
        n = 5 + i
        vals = [f.get("floor_label"), f.get("zone_type"), f.get("z_min"), f.get("z_max"), f.get("height_m"),
                f.get("total_area_m2"), f.get("glazing_area_m2"), f.get("wwr"), f.get("ottv_floor_wm2"), f.get("heat_gain_kw")]
        fmts = [None, None, NUM2, NUM2, NUM2, NUM2, NUM2, "0.0%", NUM2, NUM2]
        for j, (v, fm) in enumerate(zip(vals, fmts), start=1):
            _set(ws, f"{get_column_letter(j)}{n}", v, fill=FILL_INPUT if j > 2 else None, fmt=fm, border=True)
    _widths(ws, {c: 13 for c in "ABCDEFGHIJ"})
    ws.freeze_panes = "B5"
    _page(ws)


def _sheet_reference(wb: Workbook, analysis: Dict[str, Any]) -> None:
    ws = wb.create_sheet("Referensi")
    _brand(ws, "Referensi dan konstanta", "Sumber: SNI 6389:2020 Konservasi energi selubung bangunan. Tabel SF lama disertakan untuk perbandingan.", "L")
    _set(ws, "A4", "Konstanta", F_H)
    consts = [("ΔT beda suhu rencana (K)", SNI_DELTA_T_K, "Pasal 4.2.2.1", "DELTA_T"),
              ("Batas OTTV (W/m²)", float(analysis.get("sni_limit_wm2") or SNI_OTTV_LIMIT_WM2), "Pasal 4.2.1", "OTTV_LIMIT"),
              ("Konversi SHGC → SC", SHGC_TO_SC, "SC = SHGC / 0,87 (ASHRAE, datasheet produsen)", None)]
    for i, (lab, val, src, nm) in enumerate(consts):
        n = 5 + i
        _set(ws, f"A{n}", lab, border=True)
        _set(ws, f"B{n}", val, fill=FILL_INPUT, border=True)
        _set(ws, f"C{n}", src, F_NOTE)
        if nm:
            _name(wb, nm, f"Referensi!$B${n}")

    used_src = analysis.get("sf_source") or "sni2020"
    city_key = ((analysis.get("sf_source_info") or {}).get("city_key")) or ((analysis.get("location_info") or {}).get("id"))
    cols = ["U", "TL", "T", "TGR", "S", "BD", "B", "BL", "ROOF"]
    head = ["Kota", "U", "TL", "T", "TG", "S", "BD", "B", "BL", "Atap"]

    def table(r0: int, title: str, entries: List[Tuple[str, str, Dict[str, float]]], active: bool) -> int:
        _set(ws, f"A{r0}", title + ("  ← dipakai di laporan ini" if active else ""), F_OK if active else F_H)
        for j, h in enumerate(head, start=1):
            _set(ws, f"{get_column_letter(j)}{r0 + 1}", h, F_TH, FILL_TH, align=CENTER, border=True)
        for i, (key, label, sf) in enumerate(entries):
            n = r0 + 2 + i
            hl = active and key == city_key
            _set(ws, f"A{n}", label, F_H if hl else F_BODY, FILL_TOTAL if hl else None, border=True)
            for j, c in enumerate(cols, start=2):
                _set(ws, f"{get_column_letter(j)}{n}", sf.get(c), F_H if hl else F_BODY, FILL_TOTAL if hl else None, "0", border=True)
        return r0 + 3 + len(entries)

    r = 10
    r = table(r, "Faktor radiasi matahari SF (W/m²) — SNI 6389:2020 Tabel 8",
              [(k, v["city"], v["sf"]) for k, v in SNI_TABLE_8_SOLAR_FACTOR.items()], used_src == "sni2020")
    r = table(r, "Tabel SF lama (template PUPR, untuk perbandingan)",
              [(k, v["label"], v["sf"]) for k, v in TEMPLATE_PRODI_SF_TABLE.items()], used_src == "template_prodi")

    _set(ws, f"A{r}", "TD_ek dinding — SNI 6389:2020 Tabel 7", F_H)
    for i, e in enumerate(SNI_TABLE_7_WALL_TDEK):
        _set(ws, f"A{r + 1 + i}", e["range_label"], border=True)
        _set(ws, f"B{r + 1 + i}", e["td_ek_k"], border=True)
    r += 2 + len(SNI_TABLE_7_WALL_TDEK)
    _set(ws, f"A{r}", "TD_ek atap — SNI 6389:2020 Tabel 9", F_H)
    for i, e in enumerate(SNI_TABLE_9_ROOF_TDEK):
        _set(ws, f"A{r + 1 + i}", e["range_label"], border=True)
        _set(ws, f"B{r + 1 + i}", e["td_ek_k"], border=True)
    r += 2 + len(SNI_TABLE_9_ROOF_TDEK)
    _set(ws, f"A{r}", "Absorptansi α material — SNI 6389:2020 Tabel 1", F_H)
    for i, e in enumerate(SNI_TABLE_1_ABSORPTANCE_MATERIALS):
        _set(ws, f"A{r + 1 + i}", e["material"], border=True)
        _set(ws, f"B{r + 1 + i}", e["alpha"], border=True)
    r2 = r
    _set(ws, f"D{r2}", "Absorptansi α cat — SNI 6389:2020 Tabel 2", F_H)
    for i, e in enumerate(SNI_TABLE_2_ABSORPTANCE_PAINTS):
        label = e.get("color") or e.get("material") or e.get("paint") or str(e)
        _set(ws, f"D{r2 + 1 + i}", label, border=True)
        _set(ws, f"E{r2 + 1 + i}", e.get("alpha"), border=True)
    _widths(ws, {"A": 34, "B": 9, "C": 9, "D": 30, "E": 9, "F": 9, "G": 9, "H": 9, "I": 9, "J": 9})
    _page(ws, landscape=False)


def _sheet_summary(ws, analysis: Dict[str, Any], refs: Dict[str, Dict[str, str]], roof_ref: Optional[str]) -> None:
    cfg = analysis.get("config") or {}
    model = cfg.get("model") or {}
    summ = analysis.get("summary") or {}
    loc = analysis.get("location_info") or {}
    _brand(ws, "Laporan OTTV · SNI 6389:2020",
           f"LUXA by Alf Studio · {REPORT_VERSION} · dibuat {datetime.now().strftime('%d-%m-%Y %H:%M')}", "H")
    info = [
        ("Nama file model", analysis.get("filename")),
        ("Lokasi", loc.get("city") or loc.get("id")),
        ("Tabel SF", analysis.get("sf_source_label")),
        ("Mode perhitungan", analysis.get("mode_label") or analysis.get("calculation_mode")),
        ("Arah utara", f"{_fmt_id(summ.get('north_angle_deg'), 1)}° dari sumbu +Y model"),
        ("Jumlah lantai", f"{summ.get('total_floors') or '-'} ({analysis.get('floor_detection_method') or 'tidak terdeteksi'})"),
        ("Bidang aktif", summ.get("active_panel_count")),
        ("Status hasil", analysis.get("status_label")),
    ]
    scope = model.get("model_scope")
    if scope:
        info.insert(5, ("Isi model", {"full_building": "Bangunan lengkap", "facade_only": "Fasad saja"}.get(scope, scope)))
    for i, (lab, val) in enumerate(info):
        _set(ws, f"A{4 + i}", lab, F_H)
        _set(ws, f"B{4 + i}", val, align=Alignment(horizontal="left"))
        ws.merge_cells(f"B{4 + i}:E{4 + i}")

    r0 = 15  # baris info 4..13 (maks. 10 baris)
    _header(ws, r0, ["Arah", "Luas selubung (m²)", "Luas kaca (m²)", "WWR", "OTTV arah (W/m²)", "Total panas (W)", "OTTV di aplikasi", "Selisih"], height=32)
    app_ori = {o.get("code"): o for o in analysis.get("orientation_breakdown") or []}
    for i, (code, name, title) in enumerate(ORIENTATIONS):
        n = r0 + 1 + i
        rf = refs[code]
        _set(ws, f"A{n}", f"{'TG' if code == 'TGR' else code} · {name}", border=True)
        ws[f"A{n}"].hyperlink = f"#'{title}'!A1"
        _set(ws, f"B{n}", f"={rf['area']}", fmt=NUM2, border=True)
        _set(ws, f"C{n}", f"={rf['glass']}", fmt=NUM2, border=True)
        _set(ws, f"D{n}", f"=IF(B{n}=0,0,C{n}/B{n})", fmt="0.0%", border=True)
        _set(ws, f"E{n}", f"={rf['ottv']}", fmt=NUM2, border=True)
        _set(ws, f"F{n}", f"={rf['heat']}", fmt=NUM2, border=True)
        _set(ws, f"G{n}", round(float((app_ori.get(code) or {}).get("ottv_orientation_wm2") or 0.0), 2), fill=FILL_INPUT, fmt=NUM2, border=True)
        _set(ws, f"H{n}", f"=ROUND(E{n}-G{n},2)", fill=FILL_CHECK, fmt=NUM2, border=True)
    tr = r0 + 9
    a, b = r0 + 1, r0 + 8
    _set(ws, f"A{tr}", "Seluruh selubung", F_H, FILL_TOTAL, border=True)
    _set(ws, f"B{tr}", f"=SUM(B{a}:B{b})", F_H, FILL_TOTAL, NUM2, border=True)
    _set(ws, f"C{tr}", f"=SUM(C{a}:C{b})", F_H, FILL_TOTAL, NUM2, border=True)
    _set(ws, f"D{tr}", f"=IF(B{tr}=0,0,C{tr}/B{tr})", F_H, FILL_TOTAL, "0.0%", border=True)
    _set(ws, f"E{tr}", f"=IF(B{tr}=0,0,F{tr}/B{tr})", F_RESULT, FILL_TOTAL, NUM2, border=True)
    _set(ws, f"F{tr}", f"=SUM(F{a}:F{b})", F_H, FILL_TOTAL, NUM2, border=True)
    _set(ws, f"G{tr}", round(float(analysis.get("ottv_total_wm2") or 0.0), 2), F_H, FILL_INPUT, NUM2, border=True)
    _set(ws, f"H{tr}", f"=ROUND(E{tr}-G{tr},2)", F_H, FILL_CHECK, NUM2, border=True)

    r = tr + 2
    _set(ws, f"A{r}", "OTTV total (W/m²)", F_H)
    _set(ws, f"B{r}", f"=E{tr}", F_RESULT, FILL_TOTAL, NUM2, border=True)
    _set(ws, f"C{r}", f'=IF(B{r}<=OTTV_LIMIT,"Memenuhi (≤ "&TEXT(OTTV_LIMIT,"0")&" W/m²)","Tidak memenuhi (batas "&TEXT(OTTV_LIMIT,"0")&" W/m²)")', F_OK)
    ws.merge_cells(f"C{r}:F{r}")
    _set(ws, f"A{r + 1}", "RTTV atap (W/m²)", F_H)
    if roof_ref:
        _set(ws, f"B{r + 1}", f"={roof_ref}", F_RESULT, FILL_TOTAL, NUM2, border=True)
        _set(ws, f"C{r + 1}", "='Atap RTTV'!B23", F_OK)
    else:
        _set(ws, f"B{r + 1}", "Tidak berlaku", border=True)
    _set(ws, f"A{r + 2}", "Komposisi panas (W/m²)", F_H)
    comp = [("Konduksi dinding", "+".join(refs[c]["wall_w"] for c, _, _ in ORIENTATIONS)),
            ("Konduksi kaca", "+".join(refs[c]["cond_w"] for c, _, _ in ORIENTATIONS)),
            ("Radiasi kaca", "+".join(refs[c]["rad_w"] for c, _, _ in ORIENTATIONS))]
    for i, (lab, expr) in enumerate(comp):
        n = r + 3 + i
        _set(ws, f"A{n}", "  " + lab)
        _set(ws, f"B{n}", f"=IF($B${tr}=0,0,({expr})/$B${tr})", fmt=NUM2, border=True)

    r = r + 7
    _set(ws, f"A{r}", "Catatan dan asumsi", F_H)
    notes: List[str] = []
    notes.append(f"Tabel SF: {analysis.get('sf_source_label') or '-'}.")
    notes.append("SC kaca = SHGC / 0,87. SC efektif memasukkan peneduh luar yang dihitung dari geometri 3D (sirip, overhang, bangunan sendiri).")
    notes.append("Luas diambil dari bidang 3D sisi luar yang aktif; bidang di bawah muka tanah dan sisi dalam tidak dihitung.")
    for w in (summ.get("warnings") or analysis.get("warnings") or []):
        if isinstance(w, dict):
            msg = w.get("message") or ""
            if w.get("code"):
                msg = f"[{w['code']}] {msg}".strip()
        else:
            msg = str(w)
        if msg and msg not in notes:
            notes.append(msg)
    for e in analysis.get("sceff_errata_applied") or []:
        r_txt = f"R1={e.get('r1')}" if e.get("r1") is not None else ""
        if e.get("r2") is not None:
            r_txt = (r_txt + ", " if r_txt else "") + f"R2={e.get('r2')}"
        notes.append(f"Errata SCeff Tabel {e.get('table')} ({r_txt}, {e.get('angle_deg')}°): "
                     f"{float(e.get('printed', 0)):.4f} -> {float(e.get('corrected', 0)):.4f}. {e.get('reason') or ''}".strip())
    if summ.get("is_provisional"):
        notes.append("Status hasil: SEMENTARA, karena ada kejanggalan model yang diterima tanpa perbaikan.")
    notes.append("LUXA adalah alat bantu belajar dan simulasi; laporan ini bukan dokumen kepatuhan resmi.")
    for i, t in enumerate(notes):
        _set(ws, f"A{r + 1 + i}", f"{i + 1}. {t}", align=WRAP)
        ws.merge_cells(f"A{r + 1 + i}:H{r + 1 + i}")
        ws.row_dimensions[r + 1 + i].height = 26 if len(t) > 110 else 14
    _set(ws, f"A{r + 2 + len(notes)}", "Sel krem = nilai dari model/aplikasi · sel putih = rumus Excel · kolom Selisih harus 0,00.", F_NOTE)
    _widths(ws, {"A": 26, "B": 16, "C": 14, "D": 10, "E": 16, "F": 16, "G": 14, "H": 10})
    _page(ws, landscape=False)


def build_luxa_workbook(analysis: Dict[str, Any]) -> Workbook:
    wb = Workbook()
    summary = wb.active
    summary.title = "Ringkasan"
    cfg = analysis.get("config") or {}
    extra = list(((cfg.get("settings") or {}).get("custom_materials")) or [])
    _sheet_reference(wb, analysis)  # defines DELTA_T / OTTV_LIMIT used everywhere
    app_ori = {o.get("code"): o for o in analysis.get("orientation_breakdown") or []}
    refs = {code: _sheet_orientation(wb, analysis, code, name, title, app_ori.get(code) or {})
            for code, name, title in ORIENTATIONS}
    roof_ref = _sheet_roof(wb, analysis)
    _sheet_material(wb, analysis, extra)
    _sheet_floors(wb, analysis)
    _sheet_summary(summary, analysis, refs, roof_ref)
    order = ["Ringkasan", "Material"] + [t for _, _, t in ORIENTATIONS] + ["Atap RTTV", "Per lantai", "Referensi"]
    wb._sheets = [wb[n] for n in order]  # noqa: SLF001 - openpyxl has no public reorder API
    wb.active = 0
    wb.properties.creator = "LUXA by Alf Studio"
    wb.properties.title = f"Laporan OTTV {analysis.get('filename', '')}"
    wb.calculation.fullCalcOnLoad = True
    return wb


def generate_luxa_report(analysis: Dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    build_luxa_workbook(analysis).save(buf)
    return buf.getvalue()
