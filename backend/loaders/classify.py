"""Klasifikasi peran selubung dari nama layer/material (kamus ID + EN) dan saran material."""

from __future__ import annotations

import re
from typing import List, Optional, Tuple


# ============================================================================
# M7: TOKEN-BASED ENVELOPE ROLE CLASSIFIER (ID + EN DICTIONARIES + CONFIDENCE)
# ============================================================================

_SHADING_TOKENS_ID = frozenset({"peneduh", "sirip", "kanopi", "kisi"})
_SHADING_TOKENS_EN = frozenset({
    "shade", "shading", "louver", "louvre", "fin", "fins", "overhang",
    "brise", "soleil", "canopy", "sunscreen", "skygarden", "ifcshadingdevice",
})
_SHADING_TOKENS = _SHADING_TOKENS_ID | _SHADING_TOKENS_EN

_SPANDREL_TOKENS_ID = frozenset({"spandrel"})
_SPANDREL_TOKENS_EN = frozenset({"spandrel", "backpan", "shadowbox"})
_SPANDREL_TOKENS = _SPANDREL_TOKENS_ID | _SPANDREL_TOKENS_EN

_INSULATION_TOKENS = frozenset({"insulation", "insulasi", "fiberglass", "rockwool", "mineralwool", "glasswool"})
_CURTAINWALL_CONTEXT_TOKENS = frozenset({"curtainwall", "curtain", "cw", "ifccurtainwall", "ifcplate", "spandrel"})

_GLAZING_TOKENS_ID = frozenset({"kaca", "jendela", "bukaan"})
_GLAZING_TOKENS_EN = frozenset({
    "glass", "glas", "glazing", "glaze", "window", "vision", "fenestration",
    "aperture", "skylight", "lowe", "stopsol", "sunergy", "ifcwindow",
})
_GLAZING_TOKENS = _GLAZING_TOKENS_ID | _GLAZING_TOKENS_EN
_GLAZING_MAT_QUALIFIERS = frozenset({"clear", "tinted"})

_WALL_TOKENS_ID = frozenset({"dinding", "tembok", "bata", "beton", "plester", "hebel", "fasad", "grc", "parapet"})
_WALL_TOKENS_EN = frozenset({
    "wall", "cladding", "acp", "alucobond", "precast", "concrete", "masonry",
    "brick", "aac", "plaster", "verputz", "facade", "ifcwall", "ifcwallstandardcase",
    "grc", "parapet",
})
_WALL_TOKENS = _WALL_TOKENS_ID | _WALL_TOKENS_EN
_SOLID_MASONRY_TOKENS = frozenset({"bata", "brick", "masonry", "concrete", "beton", "precast", "hebel", "aac", "grc"})

_FRAME_TOKENS_ID = frozenset({"rangka", "kusen", "profil"})
_FRAME_TOKENS_EN = frozenset({
    "mullion", "transom", "frame", "ring", "rings", "profile", "stiffener",
    "sash", "aluminium", "aluminum", "metal", "ifcmember",
})
_FRAME_TOKENS = _FRAME_TOKENS_ID | _FRAME_TOKENS_EN

_ROOF_TOKENS_ID = frozenset({"atap", "dak", "plafon"})
_ROOF_TOKENS_EN = frozenset({"roof", "slab", "ceiling", "ifcslab", "ifcroof"})
_ROOF_TOKENS = _ROOF_TOKENS_ID | _ROOF_TOKENS_EN
_FLOOR_ONLY_TOKENS = frozenset({"floor", "lantai"})

_IGNORE_TOKENS_ID = frozenset({
    "interior", "partisi", "tapak", "tanah", "furnitur", "perabot",
    "pagar", "kolom", "balok",
})
_IGNORE_TOKENS_EN = frozenset({
    "interior", "partition", "site", "terrain", "earthworks", "ground", "soil",
    "furniture", "furnishing", "virtual", "spatialzone", "core",
    "ifcsite", "ifcspace", "ifcfurnishingelement", "natur", "erde",
    "railing", "balustrade", "column", "beam", "ifccolumn", "ifcbeam",
})
_IGNORE_TOKENS = _IGNORE_TOKENS_ID | _IGNORE_TOKENS_EN
# Konteks: lingkungan sekitar (jalan, blok kota, taman, pohon). Ditampilkan, tidak dihitung, tidak meneduhi.
_CONTEXT_TOKENS = frozenset({
    "context", "konteks", "lingkungan", "surrounding", "surroundings", "neighbor", "neighbour", "neighbors",
    "neighbours", "tetangga", "road", "roads", "street", "jalan", "jalanan", "asphalt", "aspal", "sidewalk",
    "pavement", "trotoar", "parcel", "kavling", "park", "taman", "landscape", "lansekap", "lanskap",
    "tree", "trees", "pohon", "trunk",
})
_WALL_HEAD_TOKENS = frozenset({"dinding", "wall", "tembok", "ifcwall", "ifcwallstandardcase"})
_ENVELOPE_INTERIOR_HEAD_TOKENS = _WALL_HEAD_TOKENS | frozenset({"kaca", "glass", "glazing", "jendela", "window"})
_ROOF_EXPLICIT_TOKENS = frozenset({"atap", "roof", "dak", "ifcroof"})


def _tokenize_label(text: str) -> List[str]:
    """Splits a layer/material label into clean lowercase alphanumeric tokens (handles camelCase & digits)."""
    if not text:
        return []
    # Split camelCase (e.g. IfcCurtainWall -> Ifc Curtain Wall) and letter-digit (Lantai2 -> Lantai 2)
    expanded = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    expanded = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", expanded)
    expanded = re.sub(r"([a-zA-Z])(\d)", r"\1 \2", expanded)
    expanded = re.sub(r"(\d)([a-zA-Z])", r"\1 \2", expanded)
    raw_toks = re.split(r"[\s_\-./:,;()\[\]{}]+", expanded.lower())
    out = [t for t in raw_toks if t]
    # Also preserve joined compound forms for exact IFC class names & low-e
    raw_lo = text.lower()
    if "low-e" in raw_lo or "lowe" in raw_lo:
        out.append("lowe")
    for ifc_cls in (
        "ifcshadingdevice", "ifccurtainwall", "ifcwindow", "ifcwall",
        "ifcwallstandardcase", "ifcmember", "ifcplate", "ifcslab",
        "ifcroof", "ifcsite", "ifcspace", "ifcfurnishingelement",
    ):
        if ifc_cls in raw_lo:
            out.append(ifc_cls)
    return out


def _singular_variants(tokens) -> set:
    """Bentuk tunggal dari token jamak bahasa Inggris (mullions -> mullion, louvres -> louvre,
    canopies -> canopy) agar nama layer jamak tetap dikenali. Token asli tetap dipertahankan."""
    out = set()
    for t in tokens:
        if len(t) <= 3 or not t.isalpha():
            continue
        if t.endswith("ies") and len(t) > 4:
            out.add(t[:-3] + "y")
        elif t.endswith(("ses", "xes", "ches", "shes")):
            out.add(t[:-2])
        elif t.endswith("s") and not t.endswith(("ss", "us", "is")):
            out.add(t[:-1])
    return out


def classify_layer_or_material_with_confidence(
    label: str,
    context: Optional[str] = None,
) -> Tuple[str, float, str]:
    """
    M7: Token-based role classifier returning `(role, confidence_0_to_1, reason)`.
    Roles: 'shading' | 'spandrel' | 'glazing' | 'wall' | 'frame' | 'roof' | 'context' | 'ignore' | 'unknown'.
    Unrecognized labels return 'unknown' (NEVER silently defaulted to 'wall').
    """
    raw = (label or "").strip()
    ctx = (context or "").strip()

    # Separate composite 'Layer :: Material' segments so material tokens take priority over generic layer names
    segments = [seg.strip() for seg in raw.split("::")] if "::" in raw else [raw]
    mat_seg = segments[-1] if len(segments) > 1 else ""
    layer_seg = " ".join(segments[:-1]) if len(segments) > 1 else segments[0]

    mat_tokens_seq = _tokenize_label(mat_seg)
    layer_tokens_seq = _tokenize_label(layer_seg)
    ctx_tokens_seq = _tokenize_label(ctx)
    all_tokens_seq = layer_tokens_seq + mat_tokens_seq + ctx_tokens_seq

    mat_tokens = set(mat_tokens_seq)
    layer_tokens = set(layer_tokens_seq)
    ctx_tokens = set(ctx_tokens_seq)
    # Nama jamak (CW_Vertical_Mullions, Louvres, Canopies) dicocokkan juga dalam bentuk tunggal
    mat_tokens |= _singular_variants(mat_tokens)
    layer_tokens |= _singular_variants(layer_tokens)
    ctx_tokens |= _singular_variants(ctx_tokens)
    all_tokens = mat_tokens | layer_tokens | ctx_tokens

    # 0. Konteks sekitar (jalan, blok kota, taman, pohon): tampil di layar, tidak masuk hitungan
    if all_tokens & _CONTEXT_TOKENS and not (all_tokens & _SHADING_TOKENS & (layer_tokens | mat_tokens) - {"canopy"}):
        matched = sorted(all_tokens & _CONTEXT_TOKENS)
        return "context", 0.9, f"Token konteks sekitar: {', '.join(matched)}"

    # 1. Explicit Ignore (Interior, Site, Terrain, Partition, Core, Railing/Balustrade/Pagar, Kolom/Balok)
    if all_tokens & _IGNORE_TOKENS:
        matched = sorted(all_tokens & _IGNORE_TOKENS)
        return "ignore", 0.92, f"Token non-selubung/abaikan: {', '.join(matched)}"

    # 1b. Ordered Indonesian/English interior wall/glazing pattern: 'dalam'/'interior' after dinding/wall/kaca/glass -> ignore
    env_head_indices = [i for i, t in enumerate(all_tokens_seq) if t in _ENVELOPE_INTERIOR_HEAD_TOKENS]
    if env_head_indices:
        first_head_idx = env_head_indices[0]
        if any(t in ("dalam", "interior") for t in all_tokens_seq[first_head_idx + 1:]):
            return "ignore", 0.93, "Elemen interior/dalam (bukan selubung luar)"

    # 1c. Floor slab ('pelat lantai' / 'plat lantai' / 'floor slab') -> ignore (NOT roof!)
    if not (all_tokens & _ROOF_EXPLICIT_TOKENS):
        if (("pelat" in all_tokens or "plat" in all_tokens) and "lantai" in all_tokens) or (
            "floor" in all_tokens and ("slab" in all_tokens or "ifcslab" in all_tokens)
        ):
            return "ignore", 0.92, "Pelat lantai internal (bukan atap)"

    # 2. Explicit Shading devices ('fin'/'fins' as exact token, never inside 'finish')
    if all_tokens & _SHADING_TOKENS:
        matched = sorted(all_tokens & _SHADING_TOKENS)
        return "shading", 0.95, f"Token peneduh: {', '.join(matched)}"

    # 3. Explicit Spandrel tokens OR Insulation in CurtainWall context
    if all_tokens & _SPANDREL_TOKENS:
        matched = sorted(all_tokens & _SPANDREL_TOKENS)
        return "spandrel", 0.95, f"Token spandrel: {', '.join(matched)}"

    has_insulation = bool(all_tokens & _INSULATION_TOKENS)
    has_cw_ctx = bool((all_tokens & _CURTAINWALL_CONTEXT_TOKENS) or ("curtain" in all_tokens and "wall" in all_tokens))
    has_solid_masonry = bool(all_tokens & _SOLID_MASONRY_TOKENS)
    if has_insulation and has_cw_ctx and not has_solid_masonry:
        matched = sorted(all_tokens & _INSULATION_TOKENS)
        return "spandrel", 0.90, f"Insulasi dalam konteks Curtain Wall: {', '.join(matched)}"

    # 4. Glazing / Fenestration (check material tokens & overall tokens)
    if (all_tokens & _GLAZING_TOKENS) or (
        (mat_tokens & _GLAZING_MAT_QUALIFIERS) and (has_cw_ctx or bool(all_tokens & _GLAZING_TOKENS))
    ):
        matched = sorted((all_tokens & _GLAZING_TOKENS) | (mat_tokens & _GLAZING_MAT_QUALIFIERS))
        return "glazing", 0.95, f"Token kaca/bukaan: {', '.join(matched)}"

    # 5. Material-level Frame tokens take priority over generic layer name (e.g. 'A-WALL :: Metal - Aluminium')
    if mat_tokens & _FRAME_TOKENS:
        matched = sorted(mat_tokens & _FRAME_TOKENS)
        return "frame", 0.92, f"Token rangka/logam pada material: {', '.join(matched)}"

    # 5b. Explicit Roof tokens ('atap'/'roof'/'dak'/'ifcroof') beat generic masonry material tokens
    #     like 'beton'/'concrete' (e.g. 'Atap Beton', 'Dak Beton', 'Concrete Roof') unless paired
    #     with an explicit vertical wall head token ('dinding'/'wall'/'tembok'/'parapet').
    if (all_tokens & _ROOF_EXPLICIT_TOKENS) and not (all_tokens & (_WALL_HEAD_TOKENS | {"parapet"})):
        matched = sorted(all_tokens & _ROOF_EXPLICIT_TOKENS)
        return "roof", 0.94, f"Token atap eksplisit: {', '.join(matched)}"

    # 6. Explicit Solid Masonry / Cladding / Wall tokens (beats 'lantai'/'floor' in e.g. 'Dinding_Lantai2'!)
    #    Exclude 'wall' if it ONLY came from 'curtain wall' without solid wall indicators.
    wall_hits = (all_tokens & _WALL_TOKENS) - ({"wall"} if has_cw_ctx and not (all_tokens & (_WALL_TOKENS - {"wall"})) else set())
    if wall_hits and not (all_tokens & _FRAME_TOKENS):
        return "wall", 0.90, f"Token dinding masif: {', '.join(sorted(wall_hits))}"

    # 7. Frame / Mullion / Transom tokens anywhere in label
    if all_tokens & _FRAME_TOKENS:
        matched = sorted(all_tokens & _FRAME_TOKENS)
        return "frame", 0.90, f"Token rangka/mullion: {', '.join(matched)}"

    # 8. Wall hits even when paired with non-dominant words (e.g. generic wall + insulation)
    if wall_hits:
        return "wall", 0.85, f"Token dinding: {', '.join(sorted(wall_hits))}"

    # 9. Roof / Slab / Ceiling (and standalone 'floor'/'lantai' ONLY when no wall/glazing matched)
    if all_tokens & _ROOF_TOKENS:
        matched = sorted(all_tokens & _ROOF_TOKENS)
        return "roof", 0.92, f"Token atap/plat: {', '.join(matched)}"
    if all_tokens & _FLOOR_ONLY_TOKENS:
        matched = sorted(all_tokens & _FLOOR_ONLY_TOKENS)
        return "roof", 0.78, f"Token lantai/plat datar: {', '.join(matched)}"

    # 10. Generic Curtain Wall plate without specific glass/spandrel/frame material
    if has_cw_ctx:
        return "glazing", 0.75, "Konteks Curtain Wall / IfcPlate"

    # 11. Unrecognized -> 'unknown' (requires user confirmation in Periksa Model!)
    return "unknown", 0.0, "Tidak ada token peran yang dikenali — perlu konfirmasi pengguna"


def classify_layer_or_material_role(label: str, context: Optional[str] = None) -> str:
    """
    M7: Classifies a layer/object/material name into one of 8 roles:
    'shading' | 'spandrel' | 'glazing' | 'wall' | 'frame' | 'roof' | 'ignore' | 'unknown'.
    """
    role, _, _ = classify_layer_or_material_with_confidence(label, context=context)
    return role


def suggest_material_id_for_group(
    group_name: str,
    category: str,
    default_glazing_id: Optional[str],
    default_wall_id: Optional[str],
    default_frame_id: Optional[str],
) -> str:
    """
    Matches a group/layer/material name against generic architectural materials,
    falling back cleanly to the category default.
    """
    s = (group_name or "").lower()
    if category == "glazing":
        if "indoflo" in s or "polos" in s or "clear_float" in s or "clear float" in s:
            return "glz_kaca_polos_8"
        if "panasap" in s or "tinted" in s or "mulia" in s:
            return "glz_kaca_tinted_8"
        if "stopsol" in s or "reflective" in s or "reflektif" in s:
            return "glz_kaca_reflektif_8"
        if "sunergy" in s and ("igu" in s or "double" in s):
            return "glz_igu_lowe_standar"
        if "sunergy" in s:
            return "glz_kaca_lowe_single_8"
        if "tsunlux" in s or "planibel" in s or "skn" in s or "154" in s:
            return "glz_igu_lowe_selektif"
        if "bipv" in s or "pv" in s or "solar" in s:
            return "glz_kaca_bipv_semitransparan"
        if "sage" in s or "electro" in s:
            return "glz_kaca_elektrokromik"
        return default_glazing_id or "glz_igu_triple_silver"

    if category == "spandrel":
        if "tanpa" in s or "uninsulated" in s:
            return "wal_spandrel_tanpa_insulasi"
        return default_wall_id or "wal_spandrel_insulasi_50"

    if category in ("wall", "composite_cw"):
        if "bata" in s and "ringan" not in s:
            return "wal_bata_merah_plester"
        if "hebel" in s or "aac" in s or "citicon" in s or "ringan" in s:
            return "wal_bata_ringan_aac_100"
        if "acp" in s or "alucobond" in s or "seven" in s:
            return "wal_acp_insulasi_aac"
        if "precast" in s or "beton" in s or "concrete" in s or "wika" in s:
            return "wal_beton_pracetak_120"
        if "pir" in s or "sandwich" in s or "bluescope" in s:
            return "wal_panel_insulasi_pir_50"
        return default_wall_id or "wal_spandrel_insulasi_50"

    return default_frame_id or "frm_aluminium_thermal_break"
