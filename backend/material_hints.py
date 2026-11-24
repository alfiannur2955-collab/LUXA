"""
Saran material dari nama layer/material model (Audit A3-01).

Engine tidak boleh diam-diam memakai kaca terbaik di katalog. Bila pengguna belum memilih
material, nama layer seperti "Kaca Bening" atau "Dinding Bata" dipakai sebagai SARAN yang
ditampilkan ke pengguna untuk dikonfirmasi. Saran tidak diterapkan otomatis.

Aturan dicek berurutan; yang pertama cocok menang. Token mengikuti `loaders.classify._tokenize_label`.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

from loaders.classify import _singular_variants, _tokenize_label

# (semua token wajib ada, salah satu token ada, material_id)
_GLAZING_RULES: Sequence[Tuple[Sequence[str], Sequence[str], str]] = (
    ((), ("triple", "triplesilver"), "glz_igu_triple_silver"),
    ((), ("elektrokromik", "electrochromic", "smartglass"), "glz_kaca_elektrokromik"),
    ((), ("bipv", "photovoltaic", "pv"), "glz_kaca_bipv_semitransparan"),
    ((), ("selektif", "selective", "spectrally"), "glz_igu_lowe_selektif"),
    (("lowe",), ("igu", "dgu", "ganda", "double", "insulated"), "glz_igu_lowe_standar"),
    ((), ("lowe",), "glz_kaca_lowe_single_8"),
    ((), ("igu", "dgu", "ganda", "double", "insulated"), "glz_igu_clear_24"),
    ((), ("reflektif", "reflective", "stopsol", "panasap", "sunergy", "mirror", "cermin"), "glz_kaca_reflektif_8"),
    ((), ("tinted", "warna", "bronze", "grey", "gray", "riben", "rayban", "gelap", "dark"), "glz_kaca_tinted_8"),
    ((), ("bening", "clear", "polos", "float", "transparan", "transparent", "tempered", "laminated", "kaca", "glass", "jendela", "window"), "glz_kaca_polos_8"),
)

_WALL_RULES: Sequence[Tuple[Sequence[str], Sequence[str], str]] = (
    (("spandrel",), ("tanpa", "uninsulated", "noinsulation"), "wal_spandrel_tanpa_insulasi"),
    ((), ("spandrel", "backpan", "shadowbox"), "wal_spandrel_insulasi_50"),
    ((), ("pir", "sandwich", "pu", "polyurethane"), "wal_panel_insulasi_pir_50"),
    (("acp",), ("beton", "precast", "pracetak", "concrete"), "wal_beton_pracetak_acp"),
    ((), ("acp", "composite", "alucobond"), "wal_acp_insulasi_aac"),
    ((), ("precast", "pracetak", "beton", "concrete", "grc"), "wal_beton_pracetak_120"),
    ((), ("hebel", "aac", "ringan", "celcon", "citicon"), "wal_bata_ringan_aac_100"),
    ((), ("ekspos", "exposed", "expose"), "wal_bata_merah_ekspos"),
    ((), ("bata", "brick", "masonry", "tembok", "plester", "dinding", "wall"), "wal_bata_merah_plester"),
)


def _tokens(label: str) -> set:
    toks = set(_tokenize_label(label or ""))
    return toks | _singular_variants(toks)


def suggest_material_id(labels: Sequence[str], category: str) -> Optional[str]:
    """Saran material untuk grup berkategori `category` ('glazing' | 'wall' | 'spandrel')."""
    toks: set = set()
    for lb in labels:
        toks |= _tokens(lb)
    if category == "spandrel":
        toks.add("spandrel")
        rules = _WALL_RULES
    elif category == "wall":
        rules = _WALL_RULES
    elif category in ("glazing", "composite_cw"):
        rules = _GLAZING_RULES
    else:
        return None
    for must, any_of, mid in rules:
        if all(m in toks for m in must) and (not any_of or any(a in toks for a in any_of)):
            return mid
    return None


def material_suggestions(groups: List[Tuple[str, str, str, str]]) -> List[dict]:
    """groups: (group_name, category, source_layer, source_material) -> daftar saran per grup."""
    out = []
    for name, cat, layer, mat in groups:
        mid = suggest_material_id([layer, mat, name], cat)
        if mid:
            out.append({"group_name": name, "category": cat, "material_id": mid})
    return out
