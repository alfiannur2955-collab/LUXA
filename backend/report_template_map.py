"""
OTTV 3D Parametric Studio — Template Prodi Cell Mapping (`template_prodi.xlsx`)
===============================================================================
Memetakan hasil analisis `ottv_engine.analyze_building_ottv()` ke sel-sel input pada
`docs/templates/template_prodi.xlsx` untuk diisi secara lossless oleh `template_filler.py`.

Peta sel utama:
  - `Mat!H6`         : Nama proyek
  - `Mat!D6`         : Nama kota persis dari `'ref.'!A5:A22` (pilih terdekat + peringatan jika tidak ada)
  - `Mat!C11`        : Jumlah tipe dinding (1..10)
  - `Mat!B16:B25`    : Nama konstruksi dinding persis dari `BO. wallmaterial!B5:B11`
  - `Mat!C32:G56`    : Tipe fenestrasi `F1..F25` (Nama, SHGC, U, Peneduh 'yes'/'', Kode SH/SV/SE)
  - `Mat!C64:E88`    : Peneduh horisontal `SH1..SH25` (P1, H, kemiringan)
  - `Mat!C106:E125`  : Peneduh vertikal `SV1..SV20` (P2, W, kemiringan)
  - `Mat!C150:G174`  : Peneduh egg-crate `SE1..SE25` (P1, H, P2, W, kemiringan)
  - 8 sheet orientasi (`UTARA`, `TIMURLAUT`, `TIMUR`, `TENGGARA`, `SELATAN`,
    `BARATDAYA`, `BARAT`, `BARATLAUT`) baris `65..89` (maks. 25 segmen per orientasi):
      `C` = tinggi rata-rata lantai, `D` = `luas_segmen / (C * I)`, `F` = `EW k`,
      `G` = `F m` atau `'none'`, `H` = `min(luas_kaca / I, C * D)`, `I` = jumlah lantai.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple

from materials_and_epw import SC_TO_SHGC_RATIO, get_material_by_id, get_material_shgc, migrate_material_id
from sni_tables import resolve_template_prodi_city
from template_filler import fill_xlsx_template


DEFAULT_TEMPLATE_PATH: str = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "docs", "templates", "template_prodi.xlsx")
)

ORIENTATION_TO_SHEET: Dict[str, str] = {
    "U": "UTARA",
    "TL": "TIMURLAUT",
    "T": "TIMUR",
    "TGR": "TENGGARA",
    "S": "SELATAN",
    "BD": "BARATDAYA",
    "B": "BARAT",
    "BL": "BARATLAUT",
}

# 7 nama konstruksi dinding resmi pada `BO. wallmaterial!B5:B11`
TEMPLATE_WALL_CATALOG: Dict[str, Dict[str, float]] = {
    "Brick Wall": {"u": 2.80, "alpha": 0.89, "weight": 273.9},
    "Glass-Back Panel": {"u": 2.54, "alpha": 0.57, "weight": 44.0},
    "Glass-Back Panel-Insulation": {"u": 0.51, "alpha": 0.57, "weight": 45.6},
    "Bata Ringan": {"u": 1.70, "alpha": 0.86, "weight": 174.4},
    "Bata Ringan finish ACP": {"u": 1.18, "alpha": 0.40, "weight": 136.6},
    "Concrete Precast": {"u": 4.29, "alpha": 0.61, "weight": 240.0},
    "Concrete Precast finish ACP": {"u": 2.03, "alpha": 0.40, "weight": 241.4},
}

# Pemetaan langsung ID material dinding program -> nama konstruksi pada `BO. wallmaterial!B5:B11`
PROGRAM_WALL_TO_TEMPLATE_WALL: Dict[str, str] = {
    "wal_bata_merah_plester": "Brick Wall",
    "wal_bata_merah_ekspos": "Brick Wall",
    "wal_bata_ringan_aac_100": "Bata Ringan",
    "wal_bata_ringan_aac_cat_putih": "Bata Ringan finish ACP",
    "wal_spandrel_tanpa_insulasi": "Glass-Back Panel",
    "wal_spandrel_insulasi_50": "Glass-Back Panel-Insulation",
    "wal_acp_insulasi_aac": "Bata Ringan finish ACP",
    "wal_beton_pracetak_120": "Concrete Precast",
    "wal_beton_pracetak_acp": "Concrete Precast finish ACP",
    "wal_panel_insulasi_pir_50": "Glass-Back Panel-Insulation",
}

MAX_WALL_TYPES: int = 10
MAX_FEN_TYPES: int = 25
MAX_SEGMENTS_PER_ORIENTATION: int = 25


def map_wall_material_to_template_name(
    mat_id: Optional[str],
    u_val: Optional[float] = None,
    alpha_val: Optional[float] = None,
    mat_name: str = "",
) -> str:
    """Memetakan material dinding/spandrel program ke salah satu dari 7 nama di `BO. wallmaterial!B5:B11`."""
    mid = migrate_material_id(mat_id) if mat_id else None
    if mid and mid in PROGRAM_WALL_TO_TEMPLATE_WALL:
        return PROGRAM_WALL_TO_TEMPLATE_WALL[mid]

    low = (mat_name or mid or "").lower()
    if "spandrel" in low or "backpan" in low or "shadow" in low:
        if "tanpa" in low or "uninsulated" in low or (u_val is not None and u_val > 1.5):
            return "Glass-Back Panel"
        return "Glass-Back Panel-Insulation"
    if "acp" in low and ("beton" in low or "concrete" in low or "precast" in low):
        return "Concrete Precast finish ACP"
    if "acp" in low or "alucobond" in low:
        return "Bata Ringan finish ACP"
    if "precast" in low or "beton" in low or "concrete" in low:
        return "Concrete Precast"
    if "ringan" in low or "aac" in low or "hebel" in low:
        return "Bata Ringan"
    if "bata" in low or "brick" in low:
        return "Brick Wall"

    # Fallback: pilih dinding template dengan produk (alpha * U) terdekat
    if u_val is not None and alpha_val is not None:
        target_au = float(u_val) * float(alpha_val)
        best_name = min(
            TEMPLATE_WALL_CATALOG.keys(),
            key=lambda k: abs(TEMPLATE_WALL_CATALOG[k]["u"] * TEMPLATE_WALL_CATALOG[k]["alpha"] - target_au),
        )
        return best_name

    return "Glass-Back Panel-Insulation"


def _snap_angle_to_10(deg: float) -> int:
    val = int(round(max(0.0, min(50.0, abs(float(deg)))) / 10.0) * 10)
    return max(0, min(50, val))


def _merge_segments_to_limit(
    segments: List[Dict[str, Any]],
    max_rows: int = MAX_SEGMENTS_PER_ORIENTATION,
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Merges adjacent floor segments sharing `(ew_code, fen_code)` first; if still > `max_rows`,
    progressively merges adjacent segments with smallest combined area and sets `merged_warning=True`.
    """
    if len(segments) <= max_rows:
        return segments, False

    def _combine(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
        tot_fl = a["floor_count"] + b["floor_count"]
        mean_h = (a["mean_height_m"] * a["floor_count"] + b["mean_height_m"] * b["floor_count"]) / max(1, tot_fl)
        tot_area = a["facade_area_m2"] + b["facade_area_m2"]
        tot_glz = a["glazing_area_m2"] + b["glazing_area_m2"]
        # Keep dominant wall/fen codes by area
        dom = a if a["facade_area_m2"] >= b["facade_area_m2"] else b
        fen_code = a["fen_code"] if a["fen_code"] == b["fen_code"] else (
            a["fen_code"] if a["glazing_area_m2"] >= b["glazing_area_m2"] else b["fen_code"]
        )
        return {
            "ew_code": dom["ew_code"],
            "fen_code": fen_code,
            "floor_count": tot_fl,
            "mean_height_m": mean_h,
            "facade_area_m2": tot_area,
            "glazing_area_m2": tot_glz,
        }

    # Pass 1: merge consecutive segments with identical (ew_code, fen_code)
    cur: List[Dict[str, Any]] = []
    for seg in segments:
        if cur and cur[-1]["ew_code"] == seg["ew_code"] and cur[-1]["fen_code"] == seg["fen_code"]:
            cur[-1] = _combine(cur[-1], seg)
        else:
            cur.append(dict(seg))

    if len(cur) <= max_rows:
        return cur, True

    # Pass 2: greedily merge adjacent pair with smallest combined facade area until <= max_rows
    while len(cur) > max_rows:
        best_i = min(range(len(cur) - 1), key=lambda i: cur[i]["facade_area_m2"] + cur[i + 1]["facade_area_m2"])
        cur[best_i] = _combine(cur[best_i], cur[best_i + 1])
        del cur[best_i + 1]

    return cur, True


def build_template_prodi_cell_map(
    analysis: Dict[str, Any],
    project_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Membangun peta sel lengkap `{sheet_name: {cell_ref: value}}` untuk `template_prodi.xlsx`
    beserta daftar `warnings` dan metadata ringkas.
    """
    warnings: List[str] = []
    sheet_updates: Dict[str, Dict[str, Any]] = {}

    summary = analysis.get("summary") or {}
    loc = analysis.get("location_info") or {}
    active_mats = summary.get("active_materials") or {}
    panels = [p for p in (analysis.get("panels") or []) if p.get("active")]
    floor_breakdown = analysis.get("floor_breakdown") or []
    floor_height_by_num = {
        int(fb["floor_number"]): max(0.5, float(fb.get("height_m") or summary.get("floor_height_m") or 3.6))
        for fb in floor_breakdown
        if fb.get("floor_number") is not None
    }
    default_fl_h = max(0.5, float(summary.get("floor_height_m") or 3.6))

    # 1. City & Project Name
    req_city = str(loc.get("id") or loc.get("city") or "jakarta")
    _, city_excel_label, city_warn = resolve_template_prodi_city(req_city)
    if city_warn:
        warnings.append(city_warn)

    proj_title = project_name or str(analysis.get("filename") or "Proyek OTTV 3D")

    # 2. Collect unique wall types (EW 1..EW 10) and fenestration types (F1..F25) + shading definitions
    wall_name_to_ew: Dict[str, str] = {}
    wall_list: List[str] = []

    def _register_wall(tpl_wall_name: str) -> str:
        if tpl_wall_name in wall_name_to_ew:
            return wall_name_to_ew[tpl_wall_name]
        if len(wall_list) >= MAX_WALL_TYPES:
            return wall_name_to_ew[wall_list[-1]]
        wall_list.append(tpl_wall_name)
        ew_code = f"EW {len(wall_list)}"
        wall_name_to_ew[tpl_wall_name] = ew_code
        return ew_code

    # Always register default active wall as EW 1
    default_tpl_wall = map_wall_material_to_template_name(
        active_mats.get("wall_id"),
        u_val=active_mats.get("u_wall"),
        alpha_val=active_mats.get("alpha_wall"),
        mat_name=str(active_mats.get("wall_name") or ""),
    )
    _register_wall(default_tpl_wall)

    sh_entries: List[Tuple[str, float, float, int]] = []  # (code, P1, H, tilt)
    sv_entries: List[Tuple[str, float, float, int]] = []  # (code, P2, W, tilt)
    se_entries: List[Tuple[str, float, float, float, float, int]] = []  # (code, P1, H, P2, W, tilt)
    shade_key_to_code: Dict[Tuple[str, float, float, int], str] = {}

    def _register_shading(r1: float, r2: float, phi1_deg: float) -> Tuple[str, str]:
        r1_q = round(max(0.0, float(r1)), 2)
        r2_q = round(max(0.0, float(r2)), 2)
        tilt_q = _snap_angle_to_10(phi1_deg)
        has_h = r1_q >= 0.05
        has_v = r2_q >= 0.05
        if not has_h and not has_v:
            return "", ""
        if has_h and has_v:
            key = ("SE", r1_q, r2_q, min(40, tilt_q))
            if key not in shade_key_to_code and len(se_entries) < 25:
                code = f"SE{len(se_entries) + 1}"
                h_ref, w_ref = 1.5, 1.5
                se_entries.append((code, round(r1_q * h_ref, 3), h_ref, round(r2_q * w_ref, 3), w_ref, min(40, tilt_q)))
                shade_key_to_code[key] = code
            return "yes", shade_key_to_code.get(key, "SE1")
        if has_h:
            key = ("SH", r1_q, 0.0, tilt_q)
            if key not in shade_key_to_code and len(sh_entries) < 25:
                code = f"SH{len(sh_entries) + 1}"
                h_ref = 1.5
                sh_entries.append((code, round(r1_q * h_ref, 3), h_ref, tilt_q))
                shade_key_to_code[key] = code
            return "yes", shade_key_to_code.get(key, "SH1")
        key = ("SV", 0.0, r2_q, tilt_q)
        if key not in shade_key_to_code and len(sv_entries) < 20:
            code = f"SV{len(sv_entries) + 1}"
            w_ref = 1.5
            sv_entries.append((code, round(r2_q * w_ref, 3), w_ref, tilt_q))
            shade_key_to_code[key] = code
        return "yes", shade_key_to_code.get(key, "SV1")

    fen_key_to_code: Dict[Tuple[str, float, float, str, str], str] = {}
    fen_list: List[Dict[str, Any]] = []

    def _register_fen(
        mat_id: Optional[str],
        mat_name: str,
        u_f: float,
        sc_k: float,
        r1: float,
        r2: float,
        phi1: float,
    ) -> str:
        cat_mat = get_material_by_id(mat_id) if mat_id else None
        # Keep exact SCk = SHGC / 0.86 consistency with template formula `UTARA!T32 = D32/0.86`
        if cat_mat and cat_mat.get("sc") is not None and abs(float(cat_mat["sc"]) - sc_k) < 1e-3:
            shgc_val = round(float(cat_mat["sc"]) * SC_TO_SHGC_RATIO, 4)
        else:
            shgc_val = round(float(sc_k) * SC_TO_SHGC_RATIO, 4) if sc_k > 0 else get_material_shgc(cat_mat)
        u_q = round(float(u_f), 3)
        sh_yn, sh_code = _register_shading(r1, r2, phi1)
        clean_name = (mat_name or "Kaca Standar")[:48]
        fkey = (clean_name, shgc_val, u_q, sh_yn, sh_code)
        if fkey in fen_key_to_code:
            return fen_key_to_code[fkey]
        if len(fen_list) >= MAX_FEN_TYPES:
            return fen_list[-1]["code"]
        fcode = f"F{len(fen_list) + 1}"
        fen_list.append({
            "code": fcode,
            "name": clean_name,
            "shgc": shgc_val,
            "u_value": u_q,
            "shade_yn": sh_yn,
            "shade_code": sh_code,
        })
        fen_key_to_code[fkey] = fcode
        return fcode

    # 3. Group active panels per orientation & floor into template segments
    # Structure: orient_code -> floor_num -> {wall_areas: {ew: area}, glz_areas: {fcode: area}, comp_entries: [...]}
    orient_floor_data: Dict[str, Dict[int, Dict[str, Any]]] = {
        code: {} for code in ORIENTATION_TO_SHEET.keys()
    }

    for p in panels:
        ocode = str(p.get("orientation_code") or "U")
        if ocode not in orient_floor_data:
            continue
        fl_num = int(p.get("floor_number") or 1)
        area = float(p.get("area_m2") or 0.0)
        if area <= 1e-6:
            continue
        wwr_p = max(0.0, min(1.0, float(p.get("wwr_panel") or 0.0)))
        cat = str(p.get("element_type") or "wall")
        bucket = orient_floor_data[ocode].setdefault(fl_num, {
            "wall_areas": {},
            "glz_areas": {},
            "comp_entries": [],
        })

        if wwr_p <= 1e-5:
            tpl_w = map_wall_material_to_template_name(
                p.get("material_id"),
                u_val=p.get("u_wall_eff"),
                alpha_val=p.get("alpha_wall_eff"),
                mat_name=str(p.get("material_name") or ""),
            )
            ew = _register_wall(tpl_w)
            bucket["wall_areas"][ew] = bucket["wall_areas"].get(ew, 0.0) + area
        elif wwr_p >= 1.0 - 1e-5:
            fcode = _register_fen(
                mat_id=p.get("material_id"),
                mat_name=str(p.get("material_name") or active_mats.get("glazing_name") or "Kaca Standar"),
                u_f=float(p.get("u_fen_eff") or active_mats.get("u_fenestration") or 1.10),
                sc_k=float(p.get("sc_glass") or active_mats.get("sc_glass") or 0.23),
                r1=float(p.get("r1_horizontal") or 0.0),
                r2=float(p.get("r2_vertical") or 0.0),
                phi1=float(p.get("phi1_tilt_deg") or 0.0),
            )
            bucket["glz_areas"][fcode] = bucket["glz_areas"].get(fcode, 0.0) + area
        else:
            # Composite curtain wall panel carrying both opaque and glazing portions
            ew = _register_wall(default_tpl_wall)
            fcode = _register_fen(
                mat_id=p.get("material_id"),
                mat_name=str(p.get("material_name") or active_mats.get("glazing_name") or "Kaca Standar"),
                u_f=float(p.get("u_fen_eff") or active_mats.get("u_fenestration") or 1.10),
                sc_k=float(p.get("sc_glass") or active_mats.get("sc_glass") or 0.23),
                r1=float(p.get("r1_horizontal") or 0.0),
                r2=float(p.get("r2_vertical") or 0.0),
                phi1=float(p.get("phi1_tilt_deg") or 0.0),
            )
            bucket["comp_entries"].append((ew, fcode, area, area * wwr_p))

    # Ensure at least F1 is populated on Mat if no glazing panels exist (avoid dangling refs)
    if not fen_list:
        _register_fen(
            mat_id=active_mats.get("glazing_id"),
            mat_name=str(active_mats.get("glazing_name") or "Kaca Standar"),
            u_f=float(active_mats.get("u_fenestration") or 1.10),
            sc_k=float(active_mats.get("sc_glass") or 0.23),
            r1=0.0,
            r2=0.0,
            phi1=0.0,
        )

    # 4. Build `Mat` sheet updates (including clearing pre-filled template defaults!)
    mat_cells: Dict[str, Any] = {
        "H6": proj_title,
        "D6": city_excel_label,
        "C11": len(wall_list),
    }
    for i in range(MAX_WALL_TYPES):
        r = 16 + i
        mat_cells[f"B{r}"] = wall_list[i] if i < len(wall_list) else ""

    for i in range(MAX_FEN_TYPES):
        r = 32 + i
        if i < len(fen_list):
            f = fen_list[i]
            mat_cells[f"C{r}"] = f["name"]
            mat_cells[f"D{r}"] = f["shgc"]
            mat_cells[f"E{r}"] = f["u_value"]
            mat_cells[f"F{r}"] = f["shade_yn"]
            mat_cells[f"G{r}"] = f["shade_code"]
        else:
            mat_cells[f"C{r}"] = ""
            mat_cells[f"D{r}"] = ""
            mat_cells[f"E{r}"] = ""
            mat_cells[f"F{r}"] = ""
            mat_cells[f"G{r}"] = ""

    # Shading tables: SH1..SH25 (C64:E88), SV1..SV20 (C106:E125), SE1..SE25 (C150:G174)
    for i in range(25):
        r = 64 + i
        if i < len(sh_entries):
            _, p1, h_v, tilt_v = sh_entries[i]
            mat_cells[f"C{r}"] = p1
            mat_cells[f"D{r}"] = h_v
            mat_cells[f"E{r}"] = tilt_v
        else:
            mat_cells[f"C{r}"] = ""
            mat_cells[f"D{r}"] = ""
            mat_cells[f"E{r}"] = ""

    for i in range(20):
        r = 106 + i
        if i < len(sv_entries):
            _, p2, w_v, tilt_v = sv_entries[i]
            mat_cells[f"C{r}"] = p2
            mat_cells[f"D{r}"] = w_v
            mat_cells[f"E{r}"] = tilt_v
        else:
            mat_cells[f"C{r}"] = ""
            mat_cells[f"D{r}"] = ""
            mat_cells[f"E{r}"] = ""

    for i in range(25):
        r = 150 + i
        if i < len(se_entries):
            _, p1, h_v, p2, w_v, tilt_v = se_entries[i]
            mat_cells[f"C{r}"] = p1
            mat_cells[f"D{r}"] = h_v
            mat_cells[f"E{r}"] = p2
            mat_cells[f"F{r}"] = w_v
            mat_cells[f"G{r}"] = tilt_v
        else:
            mat_cells[f"C{r}"] = ""
            mat_cells[f"D{r}"] = ""
            mat_cells[f"E{r}"] = ""
            mat_cells[f"F{r}"] = ""
            mat_cells[f"G{r}"] = ""

    sheet_updates["Mat"] = mat_cells

    # 5. Build 8 orientation sheets (rows 65..89)
    segments_summary: Dict[str, int] = {}
    for ocode, sh_name in ORIENTATION_TO_SHEET.items():
        fl_map = orient_floor_data[ocode]
        raw_segs: List[Dict[str, Any]] = []

        for fl_num in sorted(fl_map.keys()):
            b = fl_map[fl_num]
            fh = floor_height_by_num.get(fl_num, default_fl_h)
            w_items = b["wall_areas"]
            g_items = b["glz_areas"]
            c_items = b["comp_entries"]

            # Dominant wall on this floor (or default EW 1)
            if w_items and g_items:
                if len(w_items) == 1:
                    only_ew, w_area_tot = next(iter(w_items.items()))
                    g_tot = sum(g_items.values())
                    for fcode, g_area in sorted(g_items.items()):
                        share = g_area / g_tot if g_tot > 1e-9 else (1.0 / len(g_items))
                        a_seg = w_area_tot * share + g_area
                        raw_segs.append({
                            "ew_code": only_ew,
                            "fen_code": fcode,
                            "floor_count": 1,
                            "mean_height_m": fh,
                            "facade_area_m2": a_seg,
                            "glazing_area_m2": g_area,
                        })
                else:
                    # Multiple wall types on same floor: emit opaque segments + glazing segments paired with dominant wall
                    dom_ew = max(w_items.items(), key=lambda kv: kv[1])[0]
                    for ew, w_a in sorted(w_items.items()):
                        raw_segs.append({
                            "ew_code": ew,
                            "fen_code": "none",
                            "floor_count": 1,
                            "mean_height_m": fh,
                            "facade_area_m2": w_a,
                            "glazing_area_m2": 0.0,
                        })
                    for fcode, g_a in sorted(g_items.items()):
                        raw_segs.append({
                            "ew_code": dom_ew,
                            "fen_code": fcode,
                            "floor_count": 1,
                            "mean_height_m": fh,
                            "facade_area_m2": g_a,
                            "glazing_area_m2": g_a,
                        })
            elif w_items:
                for ew, w_a in sorted(w_items.items()):
                    raw_segs.append({
                        "ew_code": ew,
                        "fen_code": "none",
                        "floor_count": 1,
                        "mean_height_m": fh,
                        "facade_area_m2": w_a,
                        "glazing_area_m2": 0.0,
                    })
            elif g_items:
                for fcode, g_a in sorted(g_items.items()):
                    raw_segs.append({
                        "ew_code": "EW 1",
                        "fen_code": fcode,
                        "floor_count": 1,
                        "mean_height_m": fh,
                        "facade_area_m2": g_a,
                        "glazing_area_m2": g_a,
                    })

            if c_items:
                comp_agg: Dict[Tuple[str, str], Tuple[float, float]] = {}
                for ew, fcode, a_tot_c, a_glz_c in c_items:
                    pa, pg = comp_agg.get((ew, fcode), (0.0, 0.0))
                    comp_agg[(ew, fcode)] = (pa + a_tot_c, pg + a_glz_c)
                for (ew, fcode), (a_tot_c, a_glz_c) in sorted(comp_agg.items()):
                    raw_segs.append({
                        "ew_code": ew,
                        "fen_code": fcode,
                        "floor_count": 1,
                        "mean_height_m": fh,
                        "facade_area_m2": a_tot_c,
                        "glazing_area_m2": a_glz_c,
                    })

        # Always compact consecutive identical (ew_code, fen_code) floors with similar height (<= 0.15 m)
        compact_segs: List[Dict[str, Any]] = []
        for seg in raw_segs:
            if (
                compact_segs
                and compact_segs[-1]["ew_code"] == seg["ew_code"]
                and compact_segs[-1]["fen_code"] == seg["fen_code"]
                and abs(compact_segs[-1]["mean_height_m"] - seg["mean_height_m"]) <= 0.15
            ):
                prev = compact_segs[-1]
                tot_fl = prev["floor_count"] + seg["floor_count"]
                prev["mean_height_m"] = (
                    prev["mean_height_m"] * prev["floor_count"] + seg["mean_height_m"] * seg["floor_count"]
                ) / tot_fl
                prev["floor_count"] = tot_fl
                prev["facade_area_m2"] += seg["facade_area_m2"]
                prev["glazing_area_m2"] += seg["glazing_area_m2"]
            else:
                compact_segs.append(dict(seg))

        final_segs, was_truncated = _merge_segments_to_limit(compact_segs, MAX_SEGMENTS_PER_ORIENTATION)
        if was_truncated:
            warnings.append(
                f"Orientasi {sh_name} memiliki >{MAX_SEGMENTS_PER_ORIENTATION} segmen; "
                f"kelompok lantai berdekatan digabung menjadi {len(final_segs)} baris agar muat pada template."
            )
        segments_summary[sh_name] = len(final_segs)

        ori_cells: Dict[str, Any] = {}
        for i in range(MAX_SEGMENTS_PER_ORIENTATION):
            r = 65 + i
            if i < len(final_segs):
                seg = final_segs[i]
                c_h = round(max(0.1, float(seg["mean_height_m"])), 4)
                i_fl = max(1, int(seg["floor_count"]))
                d_len = round(float(seg["facade_area_m2"]) / (c_h * i_fl), 4)
                # Clamp H <= C * D to prevent #N/A in UTARA!V104
                h_glz = min(round(float(seg["glazing_area_m2"]) / i_fl, 4), round(c_h * d_len, 4))
                ori_cells[f"C{r}"] = c_h
                ori_cells[f"D{r}"] = d_len
                ori_cells[f"F{r}"] = seg["ew_code"]
                ori_cells[f"G{r}"] = seg["fen_code"]
                ori_cells[f"H{r}"] = h_glz if seg["fen_code"] != "none" else 0.0
                ori_cells[f"I{r}"] = i_fl
            else:
                ori_cells[f"C{r}"] = ""
                ori_cells[f"D{r}"] = ""
                ori_cells[f"F{r}"] = ""
                ori_cells[f"G{r}"] = ""
                ori_cells[f"H{r}"] = ""
                ori_cells[f"I{r}"] = ""

        sheet_updates[sh_name] = ori_cells

    return {
        "sheet_updates": sheet_updates,
        "warnings": warnings,
        "meta": {
            "project_name": proj_title,
            "city_excel_label": city_excel_label,
            "wall_types": wall_list,
            "fenestration_types": fen_list,
            "shading_counts": {"SH": len(sh_entries), "SV": len(sv_entries), "SE": len(se_entries)},
            "segments_per_orientation": segments_summary,
        },
    }


def export_template_prodi_xlsx(
    analysis: Dict[str, Any],
    template_path: str = DEFAULT_TEMPLATE_PATH,
    project_name: Optional[str] = None,
) -> Tuple[bytes, List[str], Dict[str, Any]]:
    """
    Mengisi `docs/templates/template_prodi.xlsx` dengan hasil analisis menggunakan
    pure zip/XML (`template_filler.py`) dan mengembalikan `(xlsx_bytes, warnings, meta)`.
    """
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Template prodi tidak ditemukan di: {template_path}")
    mapped = build_template_prodi_cell_map(analysis, project_name=project_name)
    clear_sheets = list(mapped["sheet_updates"].keys()) + ["SUMMARY OTTV", "BO", "BO. wallmaterial"]
    xlsx_bytes = fill_xlsx_template(
        template_source=template_path,
        sheet_updates=mapped["sheet_updates"],
        clear_formula_cache_sheets=clear_sheets,
    )
    return xlsx_bytes, mapped["warnings"], mapped["meta"]
