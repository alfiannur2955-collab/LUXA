"""
OTTV 3D Parametric Studio — Template Prodi Calculation Method (`template_method.py`)
====================================================================================
Mengimplementasikan perhitungan suku radiasi persis seperti `docs/templates/template_prodi.xlsx`
ketika `settings.sf_source == 'template_prodi'`:
  1. SF diskrit dari `'ref.'!A5:J22` (`TEMPLATE_PRODI_SF_TABLE`), ΔT = 5 K.
  2. SCk = SHGC / 0.86 (persis rumus `UTARA!T32 = D32/0.86`).
  3. SCeff dari tabel/kode peneduh template lembar `BO` (`scefn`, `scefs`, `scefe`, `scefw`,
     `scefne`, `scefnw`, `scefse`, `scefsw`) menggunakan kode peneduh (`SHk`, `SVk`, `SEk`,
     atau kosong) yang SAMA PERSIS dengan yang ditulis `report_template_map.py` ke `Mat!F32:G56`
     dan tabel peneduh `Mat!C64:E88`, `Mat!C106:E125`, `Mat!C150:G174`.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from materials_and_epw import SC_TO_SHGC_RATIO, get_material_shgc

# Hardcoded divisor inside the university Excel workbook `template_prodi.xlsx` (`UTARA!T32 = D32/0.86`).
# Kept distinct from `SC_TO_SHGC_RATIO = 0.87` (used for material conversion & brand datasheets)
# so LibreOffice recalculation of filled `template_prodi.xlsx` remains within <= 0.05 W/m2 parity.
TEMPLATE_PRODI_SHGC_DIVISOR: float = 0.86
from sni_tables import (
    SCEFF_1D_ANGLES_DEG,
    SNI_TABLE_EGGCRATE_SCEFF,
    SNI_TABLE_HORIZONTAL_SCEFF,
    SNI_TABLE_VERTICAL_SCEFF,
    get_sf_for_source,
)

SCEFF_EGG_ANGLES_DEG: Tuple[int, ...] = (0, 10, 20, 30, 40)


# Pemetaan orientasi 8 arah -> nama range lembar `BO` pada `template_prodi.xlsx`
ORIENTATION_TO_BO_SCEF_RANGE: Dict[str, str] = {
    "U": "scefn",
    "S": "scefs",
    "T": "scefe",
    "B": "scefw",
    "TL": "scefne",
    "BL": "scefnw",
    "TGR": "scefse",
    "BD": "scefsw",
}

_ORIENT_TO_PAIR: Dict[str, str] = {
    "U": "U_S",
    "S": "U_S",
    "T": "T_B",
    "B": "T_B",
    "TL": "TL_BL",
    "BL": "TL_BL",
    "TGR": "TGR_BD",
    "BD": "TGR_BD",
}

MAX_SH_COUNT = 25
MAX_SV_COUNT = 20
MAX_SE_COUNT = 25


def excel_rounddown(val: float, digits: int) -> float:
    """Replicates Excel `ROUNDDOWN(val, digits)` for non-negative ratios."""
    if val <= 0.0:
        return 0.0
    factor = 10.0 ** digits
    return math.floor(val * factor + 1e-12) / factor


def excel_mround(val: float, multiple: float) -> float:
    """Replicates Excel `MROUND(val, multiple)` (half rounds away from zero)."""
    if val <= 0.0 or multiple <= 0.0:
        return 0.0
    return round(math.floor((val / multiple) + 0.5 + 1e-12) * multiple, 6)


def snap_tilt_to_template_deg(deg: float, max_deg: int = 50) -> int:
    """Snaps shading tilt angle to valid template columns (0, 10, 20, 30, 40[, 50])."""
    clamped = max(0.0, min(float(max_deg), abs(float(deg))))
    snapped = int(round(clamped / 10.0) * 10)
    return max(0, min(max_deg, snapped))


def compute_template_shgc_and_sck(
    glz_mat: Optional[Dict[str, Any]],
    fallback_sc: float = 0.23,
) -> Tuple[float, float]:
    """
    Menghitung `(SHGC, SCk)` sesuai rumus sel `Mat!D32` dan `UTARA!T32 = D32/0.86` pada `template_prodi.xlsx`:
      - `SHGC` diambil dari field `shgc` material (atau `round(sc * 0.87, 4)` via `SC_TO_SHGC_RATIO` jika `shgc` kosong).
      - `SCk = SHGC / 0.86` (pembagi tetap milik rumus Excel template prodi).
    """
    shgc = get_material_shgc(glz_mat, fallback_sc=fallback_sc)
    sc_k = shgc / TEMPLATE_PRODI_SHGC_DIVISOR
    return shgc, sc_k


def _vlookup_approx_1d(
    table_by_r: Dict[float, Tuple[float, ...]],
    r_val: float,
    tilt_deg: int,
) -> float:
    """
    Replicates Excel approximate `VLOOKUP(T314, hns/vns, col)` (sorted ascending keys 0.1..3.0,
    no `FALSE` exact-match arg -> largest key <= `r_val`, capped at 3.0).
    Uses exact printed `ref. scef` table values (identical to `ketat_pdf`).
    """
    rs = sorted(table_by_r.keys())
    r_clamped = min(rs[-1], max(rs[0], round(float(r_val), 1)))
    chosen_r = rs[0]
    for rk in rs:
        if rk <= r_clamped + 1e-9:
            chosen_r = rk
        else:
            break
    col_idx = SCEFF_1D_ANGLES_DEG.index(tilt_deg) if tilt_deg in SCEFF_1D_ANGLES_DEG else 0
    return float(table_by_r[chosen_r][col_idx])


def _lookup_bo_eggcrate(
    pair_key: str,
    p1: float,
    h_m: float,
    p2: float,
    w_m: float,
    tilt_deg: int,
) -> float:
    """
    Replicates `UTARA!T374:U374` + `BO!F32:M32`:
      - F = ROUNDDOWN(P1/H, 2), G = MROUND(F, 0.2)
      - H = ROUNDDOWN(P2/W, 2), I = MROUND(H, 0.2)
      - IF(OR(F=0, H=0), 0, IF(OR(G<0.2, I<0.2), 1, INDEX(eg*_<min(1.8,G)>, MATCH(I, eg_r2, 1), col)))
    """
    f_val = excel_rounddown(p1 / h_m, 2) if h_m > 0 else 0.0
    h_val = excel_rounddown(p2 / w_m, 2) if w_m > 0 else 0.0
    if f_val <= 0.0 or h_val <= 0.0:
        return 0.0
    g_val = excel_mround(f_val, 0.2)
    i_val = excel_mround(h_val, 0.2)
    if g_val < 0.2 - 1e-9 or i_val < 0.2 - 1e-9:
        return 1.0

    r1_key = round(min(1.8, max(0.2, g_val)), 1)
    r2_key = round(min(1.8, max(0.2, i_val)), 1)
    tbl = SNI_TABLE_EGGCRATE_SCEFF[pair_key]
    tilt_c = min(40, max(0, int(tilt_deg)))
    col_idx = SCEFF_EGG_ANGLES_DEG.index(tilt_c) if tilt_c in SCEFF_EGG_ANGLES_DEG else 0
    return float(tbl[(r1_key, r2_key)][col_idx])


class TemplateShadingRegistry:
    """
    Registri kode peneduh bersama (`SH1..SH25`, `SV1..SV20`, `SE1..SE25`) untuk memastikan
    engine (`ottv_engine.py`) dan pemeta template (`report_template_map.py`) selalu
    menggunakan kode peneduh dan dimensi `Mat!C64..G174` yang identik 100%.
    """

    def __init__(self) -> None:
        self.sh_entries: List[Tuple[str, float, float, int]] = []  # (code, P1, H, tilt)
        self.sv_entries: List[Tuple[str, float, float, int]] = []  # (code, P2, W, tilt)
        self.se_entries: List[Tuple[str, float, float, float, float, int]] = []  # (code, P1, H, P2, W, tilt)
        self._key_to_code: Dict[Tuple[str, float, float, int], str] = {}
        self._by_code: Dict[str, Dict[str, Any]] = {}

    def register(self, r1: float, r2: float, phi1_deg: float) -> Tuple[str, str]:
        """
        Mendaftarkan rasio peneduh terukur `(r1, r2, phi1_deg)` dengan deduplikasi pada bin
        persis rumus lembar `BO` (`ROUNDDOWN(..., 1)` untuk SH/SV dan `MROUND(..., 0.2)` untuk SE),
        memakai `H = 1.0 m` / `W = 1.0 m` agar bebas galat pembulatan pembagian float di Excel.
        Mengembalikan `(shade_yn, shade_code)` yang ditulis ke `Mat!F32:G56`.
        """
        r1_raw = max(0.0, float(r1))
        r2_raw = max(0.0, float(r2))
        tilt_q = snap_tilt_to_template_deg(phi1_deg, max_deg=50)
        has_h = r1_raw >= 0.10 - 1e-9
        has_v = r2_raw >= 0.10 - 1e-9
        if not has_h and not has_v:
            return "", ""

        if has_h and has_v:
            r1_bin = round(min(1.8, excel_mround(excel_rounddown(r1_raw, 2), 0.2)), 1)
            r2_bin = round(min(1.8, excel_mround(excel_rounddown(r2_raw, 2), 0.2)), 1)
            if r1_bin < 0.2 - 1e-9 or r2_bin < 0.2 - 1e-9:
                # BO!M32 mengembalikan 1.0 bila MROUND(R1,0.2)<0.2 atau MROUND(R2,0.2)<0.2
                return "", ""
            tilt_se = min(40, tilt_q)
            key = ("SE", r1_bin, r2_bin, tilt_se)
            if key not in self._key_to_code and len(self.se_entries) < MAX_SE_COUNT:
                code = f"SE{len(self.se_entries) + 1}"
                h_ref, w_ref = 1.0, 1.0
                self.se_entries.append((code, r1_bin, h_ref, r2_bin, w_ref, tilt_se))
                self._key_to_code[key] = code
                self._by_code[code] = {
                    "kind": "SE", "code": code, "p1": r1_bin, "h": h_ref,
                    "p2": r2_bin, "w": w_ref, "tilt": tilt_se,
                }
            return "yes", self._key_to_code.get(key, "SE1")

        if has_h:
            r1_bin = round(min(3.0, excel_rounddown(r1_raw, 1)), 1)
            if r1_bin < 0.1 - 1e-9:
                return "", ""
            key = ("SH", r1_bin, 0.0, tilt_q)
            if key not in self._key_to_code and len(self.sh_entries) < MAX_SH_COUNT:
                code = f"SH{len(self.sh_entries) + 1}"
                h_ref = 1.0
                self.sh_entries.append((code, r1_bin, h_ref, tilt_q))
                self._key_to_code[key] = code
                self._by_code[code] = {
                    "kind": "SH", "code": code, "p1": r1_bin, "h": h_ref, "tilt": tilt_q,
                }
            return "yes", self._key_to_code.get(key, "SH1")

        r2_bin = round(min(3.0, excel_rounddown(r2_raw, 1)), 1)
        if r2_bin < 0.1 - 1e-9:
            return "", ""
        key = ("SV", 0.0, r2_bin, tilt_q)
        if key not in self._key_to_code and len(self.sv_entries) < MAX_SV_COUNT:
            code = f"SV{len(self.sv_entries) + 1}"
            w_ref = 1.0
            self.sv_entries.append((code, r2_bin, w_ref, tilt_q))
            self._key_to_code[key] = code
            self._by_code[code] = {
                "kind": "SV", "code": code, "p2": r2_bin, "w": w_ref, "tilt": tilt_q,
            }
        return "yes", self._key_to_code.get(key, "SV1")

    def lookup_bo_sceff(
        self,
        orientation_code: str,
        shade_yn: str,
        shade_code: str,
    ) -> float:
        """
        Mengevaluasi `IF(F32="yes", VLOOKUP(G32, <scefn..scefsw>, 2, FALSE), 1)` persis seperti
        sheet orientasi & lembar `BO` pada `template_prodi.xlsx`.
        """
        if (shade_yn or "").strip().lower() != "yes" or not shade_code:
            return 1.0
        spec = self._by_code.get(shade_code)
        if spec is None:
            return 1.0

        code_u = (orientation_code or "U").strip().upper()
        pair_key = _ORIENT_TO_PAIR.get(code_u, "U_S")
        kind = spec["kind"]

        if kind == "SH":
            p1, h_m, tilt = float(spec["p1"]), float(spec["h"]), int(spec["tilt"])
            if p1 <= 0.0 or h_m <= 0.0:
                return 0.0
            r_floor = excel_rounddown(p1 / h_m, 1)
            if r_floor < 0.1 - 1e-9:
                return 1.0
            return _vlookup_approx_1d(SNI_TABLE_HORIZONTAL_SCEFF[pair_key], r_floor, tilt)

        if kind == "SV":
            p2, w_m, tilt = float(spec["p2"]), float(spec["w"]), int(spec["tilt"])
            if p2 <= 0.0 or w_m <= 0.0:
                return 0.0
            r_floor = excel_rounddown(p2 / w_m, 1)
            if r_floor < 0.1 - 1e-9:
                return 1.0
            return _vlookup_approx_1d(SNI_TABLE_VERTICAL_SCEFF[pair_key], r_floor, tilt)

        # Egg-crate SE
        return _lookup_bo_eggcrate(
            pair_key=pair_key,
            p1=float(spec["p1"]),
            h_m=float(spec["h"]),
            p2=float(spec["p2"]),
            w_m=float(spec["w"]),
            tilt_deg=int(spec["tilt"]),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sh_entries": [list(e) for e in self.sh_entries],
            "sv_entries": [list(e) for e in self.sv_entries],
            "se_entries": [list(e) for e in self.se_entries],
        }

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "TemplateShadingRegistry":
        reg = cls()
        if not isinstance(data, dict):
            return reg
        for item in data.get("sh_entries") or []:
            code, p1, h_m, tilt = str(item[0]), float(item[1]), float(item[2]), int(item[3])
            reg.sh_entries.append((code, p1, h_m, tilt))
            reg._by_code[code] = {"kind": "SH", "code": code, "p1": p1, "h": h_m, "tilt": tilt}
            reg._key_to_code[("SH", round(p1 / h_m, 2) if h_m else 0.0, 0.0, tilt)] = code
        for item in data.get("sv_entries") or []:
            code, p2, w_m, tilt = str(item[0]), float(item[1]), float(item[2]), int(item[3])
            reg.sv_entries.append((code, p2, w_m, tilt))
            reg._by_code[code] = {"kind": "SV", "code": code, "p2": p2, "w": w_m, "tilt": tilt}
            reg._key_to_code[("SV", 0.0, round(p2 / w_m, 2) if w_m else 0.0, tilt)] = code
        for item in data.get("se_entries") or []:
            code, p1, h_m, p2, w_m, tilt = str(item[0]), float(item[1]), float(item[2]), float(item[3]), float(item[4]), int(item[5])
            reg.se_entries.append((code, p1, h_m, p2, w_m, tilt))
            reg._by_code[code] = {"kind": "SE", "code": code, "p1": p1, "h": h_m, "p2": p2, "w": w_m, "tilt": tilt}
            reg._key_to_code[("SE", round(p1 / h_m, 2) if h_m else 0.0, round(p2 / w_m, 2) if w_m else 0.0, tilt)] = code
        return reg


def compute_template_radiation_term(
    city_preset: Optional[str],
    orientation_code: str,
    wwr: float,
    glz_mat: Optional[Dict[str, Any]],
    r1: float,
    r2: float,
    phi1_deg: float,
    registry: Optional[TemplateShadingRegistry] = None,
    fallback_sc: float = 0.23,
) -> Dict[str, Any]:
    """
    Menghitung suku radiasi surya persis seperti `template_prodi.xlsx`:
      - `SF` dari `'ref.'!A5:J22`
      - `SCk = SHGC / 0.86`
      - `SCeff` dari lembar `BO` (`scefn..scefsw`) berdasarkan kode peneduh bersama
      - `SC = SCk * SCeff`
      - `q_solar_wm2 = SF * WWR * SC`
    """
    reg = registry if registry is not None else TemplateShadingRegistry()
    sf_wm2 = get_sf_for_source(city_preset, orientation_code, "template_prodi")
    shgc, sc_k = compute_template_shgc_and_sck(glz_mat, fallback_sc=fallback_sc)
    shade_yn, shade_code = reg.register(r1, r2, phi1_deg)
    sc_eff = reg.lookup_bo_sceff(orientation_code, shade_yn, shade_code)
    sc_total = sc_k * sc_eff
    q_solar = sf_wm2 * float(wwr) * sc_total
    return {
        "sf_wm2": sf_wm2,
        "shgc": shgc,
        "sc_k": sc_k,
        "shade_yn": shade_yn,
        "shade_code": shade_code,
        "bo_scef_range": ORIENTATION_TO_BO_SCEF_RANGE.get((orientation_code or "U").upper(), "scefn"),
        "sc_eff": sc_eff,
        "sc": sc_total,
        "q_solar_wm2": q_solar,
    }
