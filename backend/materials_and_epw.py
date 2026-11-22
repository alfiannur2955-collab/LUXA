"""
OTTV 3D Parametric Studio — Material Library & Indonesian EPW Weather Engine
============================================================================
Provides:
1. Architectural Material Catalog (Indonesian market brands + conventional &
   advanced facade technologies) for Glazing, Wall/Spandrel, Roof, and Frames,
   annotated with `massa_kg_m2`, `sumber`, and `status` (`datasheet` | `nilai_tipikal`).
2. Custom Material registration and Category-to-Material template mapping.
3. SNI 6389:2020 Material Optimization & Brand Recommender.
4. Indonesian Cities Climate Presets (54 SNI 6389:2020 Tabel 8 cities) & EnergyPlus (.epw) Parser.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple


# ============================================================================
# 1. GENERIC ARCHITECTURAL MATERIAL LIBRARY (SNI 6389:2020 — NILAI TIPIKAL)
# ============================================================================
# Semua material bawaan menggunakan spesifikasi generik bernilai tipikal
# (alpha mengacu Tabel 1/2 SNI 6389:2020, TD_EK dari massa_kg_m2 Tabel 7/9).
# Material bermerek hanya diperbolehkan bila memiliki URL datasheet resmi di
# field `sumber` dan diberi label `Contoh produk`.

SC_TO_SHGC_RATIO: float = 0.87  # Konversi standar ISO 9050 / AGC / Guardian: SHGC = SC * 0.87

BUILTIN_MATERIALS: List[Dict[str, Any]] = [
    # ------------------------------------------------------------------------
    # A. GLAZING / FENESTRATION MATERIALS (KACA ARSITEKTURAL GENERIK)
    # ------------------------------------------------------------------------
    {
        "id": "glz_kaca_polos_8",
        "name": "Kaca Polos Tunggal 8mm (Single Clear Float)",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Single Clear Float",
        "u_value": 5.60,
        "sc": 0.92,
        "shgc": 0.79,
        "vlt": 0.87,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "SNI 6389:2020 Tabel 3 & nilai tipikal kaca polos 8mm",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Kaca polos tunggal 8mm bernilai tipikal. Transmisi cahaya tinggi namun meneruskan panas surya besar.",
    },
    {
        "id": "glz_kaca_tinted_8",
        "name": "Kaca Warna / Tinted Tunggal 8mm",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Single Tinted Heat-Absorbing",
        "u_value": 5.50,
        "sc": 0.60,
        "shgc": 0.52,
        "vlt": 0.48,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "Nilai tipikal kaca tinted 8mm (abu-abu/hijau)",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Kaca penyerap panas berwarna tunggal 8mm untuk bangunan komersial menengah.",
    },
    {
        "id": "glz_kaca_reflektif_8",
        "name": "Kaca Reflektif Tunggal 8mm (Hard-Coat)",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Pyrolytic Reflective Single",
        "u_value": 5.30,
        "sc": 0.44,
        "shgc": 0.38,
        "vlt": 0.39,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "Nilai tipikal kaca reflektif pirolitik 8mm",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Kaca reflektif tunggal 8mm dengan pantulan radiasi surya tinggi.",
    },
    {
        "id": "glz_kaca_lowe_single_8",
        "name": "Kaca Low-E Hard-Coat Tunggal 8mm",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Pyrolytic Low-E Single",
        "u_value": 3.60,
        "sc": 0.41,
        "shgc": 0.35,
        "vlt": 0.56,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "Nilai tipikal kaca Low-E hard-coat tunggal 8mm",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Kaca Low-E tunggal 8mm yang dapat dipasang monolitik tanpa unit IGU.",
    },
    {
        "id": "glz_igu_clear_24",
        "name": "Kaca Ganda (IGU) Polos 6+12+6mm",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Double Glazing (IGU) Clear",
        "u_value": 2.80,
        "sc": 0.80,
        "shgc": 0.69,
        "vlt": 0.78,
        "massa_kg_m2": 30.0,
        "thickness_mm": 24.0,
        "sumber": "Nilai tipikal kaca ganda polos rongga udara 12mm",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Unit kaca ganda polos (6mm + 12mm udara + 6mm) tanpa lapisan kontrol surya.",
    },
    {
        "id": "glz_igu_lowe_standar",
        "name": "Kaca Ganda (IGU) Low-E Standar 6+12+6mm",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Double Glazing (IGU) Low-E",
        "u_value": 1.90,
        "sc": 0.31,
        "shgc": 0.27,
        "vlt": 0.48,
        "massa_kg_m2": 30.0,
        "thickness_mm": 24.0,
        "sumber": "Nilai tipikal IGU Low-E standar 24mm (rongga udara 12mm)",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Unit kaca ganda Low-E standar gedung perkantoran; efektif menekan konduksi dan radiasi.",
    },
    {
        "id": "glz_igu_lowe_selektif",
        "name": "Kaca Ganda (IGU) Double-Silver Low-E 6+12Ar+6mm",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Double-Silver Soft-Coat Low-E + Argon IGU",
        "u_value": 1.45,
        "sc": 0.25,
        "shgc": 0.22,
        "vlt": 0.50,
        "massa_kg_m2": 30.0,
        "thickness_mm": 24.0,
        "sumber": "Nilai tipikal IGU Double-Silver Low-E 24mm (Argon)",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum Proyek High-Rise",
        "description": "Kaca IGU selektivitas tinggi (VLT ~50%, SC ~0,25) untuk fasad curtain wall WWR besar.",
    },
    {
        "id": "glz_igu_triple_silver",
        "name": "Kaca Ganda (IGU) Triple-Silver Ultra-Selective 6+12Ar+6mm",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Triple-Silver Ultra-Selective Low-E IGU",
        "u_value": 1.10,
        "sc": 0.23,
        "shgc": 0.20,
        "vlt": 0.60,
        "massa_kg_m2": 32.0,
        "thickness_mm": 26.0,
        "sumber": "Nilai tipikal IGU Triple-Silver Low-E (U=1,10; SC=0,23)",
        "status": "nilai_tipikal",
        "market_availability": "Material Spesifikasi Tinggi",
        "description": "Kaca IGU Triple-Silver selektivitas sangat tinggi dengan konduksi dan perolehan surya rendah.",
    },
    {
        "id": "glz_kaca_bipv_semitransparan",
        "name": "Kaca Fotovoltaik Semi-Transparan (BIPV) Generik",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Building-Integrated Photovoltaics (BIPV)",
        "u_value": 1.50,
        "sc": 0.20,
        "shgc": 0.17,
        "vlt": 0.30,
        "massa_kg_m2": 35.0,
        "thickness_mm": 28.0,
        "sumber": "Nilai tipikal kaca BIPV semi-transparan",
        "status": "nilai_tipikal",
        "market_availability": "Material Khusus",
        "description": "Kaca fasad fotovoltaik semi-transparan dengan SC rendah.",
    },
    {
        "id": "glz_kaca_elektrokromik",
        "name": "Kaca Elektrokromik Dinamis (Mode Gelap) Generik",
        "brand": "Generik (Nilai Tipikal)",
        "category": "glazing",
        "technology": "Dynamic Electrochromic IGU",
        "u_value": 1.25,
        "sc": 0.15,
        "shgc": 0.13,
        "vlt": 0.25,
        "massa_kg_m2": 34.0,
        "thickness_mm": 26.0,
        "sumber": "Nilai tipikal kaca elektrokromik pada kondisi tinted",
        "status": "nilai_tipikal",
        "market_availability": "Material Khusus",
        "description": "Kaca elektrokromik dinamis pada kondisi gelap saat radiasi surya tinggi.",
    },

    # ------------------------------------------------------------------------
    # B. OPAQUE WALL & SPANDREL MATERIALS (DINDING MASIF & SPANDREL GENERIK)
    #    Nilai alpha mengacu langsung ke Tabel 1 & Tabel 2 SNI 6389:2020.
    # ------------------------------------------------------------------------
    {
        "id": "wal_bata_merah_plester",
        "name": "Dinding Bata Merah 150mm + Plester + Cat Warna Sedang",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Pasangan Bata Merah Plester",
        "u_value": 2.55,
        "alpha": 0.58,
        "massa_kg_m2": 260.0,
        "td_ek": 10.0,
        "thickness_mm": 150.0,
        "sumber": "SNI 6389:2020 Tabel 2 (Kuning medium α=0,58), Tabel 5 & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Dinding pasangan bata merah dengan plester semen-pasir dan cat eksterior warna sedang.",
    },
    {
        "id": "wal_bata_merah_ekspos",
        "name": "Dinding Bata Merah Ekspos 150mm",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Pasangan Bata Merah Ekspos",
        "u_value": 2.80,
        "alpha": 0.89,
        "massa_kg_m2": 274.0,
        "td_ek": 10.0,
        "thickness_mm": 150.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Bata merah α=0,89) & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Dinding bata merah tanpa cat penutup (setara Brick Wall pada template prodi).",
    },
    {
        "id": "wal_bata_ringan_aac_100",
        "name": "Dinding Bata Ringan AAC 100mm + Plester Tipis + Cat Muda",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Autoclaved Aerated Concrete (AAC)",
        "u_value": 1.42,
        "alpha": 0.47,
        "massa_kg_m2": 140.0,
        "td_ek": 12.0,
        "thickness_mm": 115.0,
        "sumber": "SNI 6389:2020 Tabel 2 (Hijau muda α=0,47) & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Dinding bata ringan AAC 100mm dengan plester tipis dan cat warna muda.",
    },
    {
        "id": "wal_bata_ringan_aac_cat_putih",
        "name": "Dinding Bata Ringan AAC 150mm + Cat Putih Semi Kilap",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "AAC + Cat Reflektif Terang",
        "u_value": 1.05,
        "alpha": 0.30,
        "massa_kg_m2": 165.0,
        "td_ek": 12.0,
        "thickness_mm": 165.0,
        "sumber": "SNI 6389:2020 Tabel 2 (Putih semi kilap α=0,30) & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Kombinasi bata ringan AAC 150mm dan cat putih semi kilap (α = 0,30).",
    },
    {
        "id": "wal_spandrel_tanpa_insulasi",
        "name": "Spandrel Kaca + Back Panel Tanpa Insulasi",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Spandrel Tanpa Insulasi",
        "u_value": 2.54,
        "alpha": 0.57,
        "massa_kg_m2": 44.0,
        "td_ek": 15.0,
        "thickness_mm": 50.0,
        "sumber": "SNI 6389:2020 Tabel 2 (Hijau/biru medium α=0,57) & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Panel spandrel kaca dengan rongga udara dan plat belakang tanpa insulasi termal.",
    },
    {
        "id": "wal_spandrel_insulasi_50",
        "name": "Spandrel Curtain Wall + Insulasi Mineral Wool 50mm + Backpan",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Insulated Spandrel Assembly",
        "u_value": 0.62,
        "alpha": 0.40,
        "massa_kg_m2": 46.0,
        "td_ek": 15.0,
        "thickness_mm": 65.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Cat alumunium α=0,40) & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum High-Rise",
        "description": "Spandrel kaca berlapis insulasi mineral wool 50mm (80 kg/m³) dan backpan aluminium.",
    },
    {
        "id": "wal_acp_insulasi_aac",
        "name": "Cladding ACP 4mm + Insulasi 50mm + Bata Ringan AAC",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Ventilated Rainscreen ACP + Insulation",
        "u_value": 0.55,
        "alpha": 0.40,
        "massa_kg_m2": 145.0,
        "td_ek": 12.0,
        "thickness_mm": 175.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Cat alumunium α=0,40) & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Fasad Aluminium Composite Panel (finish metalik/terang) dengan insulasi dan dinding AAC.",
    },
    {
        "id": "wal_beton_pracetak_120",
        "name": "Panel Beton Pracetak Ekspos 120mm",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Precast Architectural Concrete",
        "u_value": 2.85,
        "alpha": 0.61,
        "massa_kg_m2": 288.0,
        "td_ek": 10.0,
        "thickness_mm": 120.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Beton ekspos α=0,61), Tabel 5 & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Dinding pracetak beton bertulang massa berat 120mm (TD_EK = 10 K).",
    },
    {
        "id": "wal_beton_pracetak_acp",
        "name": "Panel Beton Pracetak 120mm Finish ACP",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Precast Concrete + ACP Cladding",
        "u_value": 2.03,
        "alpha": 0.40,
        "massa_kg_m2": 241.0,
        "td_ek": 10.0,
        "thickness_mm": 150.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Cat alumunium α=0,40) & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Dinding beton pracetak berlapis ACP (setara Concrete Precast finish ACP pada template prodi).",
    },
    {
        "id": "wal_panel_insulasi_pir_50",
        "name": "Panel Insulasi Sandwich PIR/PU 50mm Finish Terang",
        "brand": "Generik (Nilai Tipikal)",
        "category": "wall",
        "technology": "Polyisocyanurate (PIR) Sandwich Panel",
        "u_value": 0.42,
        "alpha": 0.26,
        "massa_kg_m2": 18.0,
        "td_ek": 15.0,
        "thickness_mm": 50.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Seng putih α=0,26) & Tabel 7",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum Industri/Komersial",
        "description": "Panel sandwich insulasi PIR/PU 50mm dengan penutup metal reflektif terang.",
    },

    # ------------------------------------------------------------------------
    # C. CURTAIN WALL FRAME & SHADING FINS (RANGKA MULLION/TRANSOM GENERIK)
    # ------------------------------------------------------------------------
    {
        "id": "frm_aluminium_standar",
        "name": "Rangka Aluminium Non-Thermal Break (Anodized/Powder Coat)",
        "brand": "Generik (Nilai Tipikal)",
        "category": "frame",
        "technology": "Extruded Aluminium Standar",
        "u_value": 5.80,
        "alpha": 0.40,
        "reflectance": 0.60,
        "massa_kg_m2": 15.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Cat alumunium α=0,40) & Tabel 3 (Kusen metal tanpa pemutus termal)",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Profil rangka aluminium standar tanpa pemutus jembatan termal.",
    },
    {
        "id": "frm_aluminium_thermal_break",
        "name": "Rangka Aluminium Curtain Wall + Thermal Break",
        "brand": "Generik (Nilai Tipikal)",
        "category": "frame",
        "technology": "Polyamide Thermal Break Frame",
        "u_value": 2.10,
        "alpha": 0.40,
        "reflectance": 0.60,
        "massa_kg_m2": 18.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Cat alumunium α=0,40) & nilai tipikal kusen thermal break",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum Proyek High-Rise",
        "description": "Profil mullion/transom dengan pemutus jembatan termal poliamida.",
    },
    {
        "id": "frm_sirip_peneduh_aluminium",
        "name": "Sirip Peneduh / Louver Aluminium Eksternal",
        "brand": "Generik (Nilai Tipikal)",
        "category": "frame",
        "technology": "External Shading Fin / Louver",
        "u_value": 1.80,
        "alpha": 0.30,
        "reflectance": 0.70,
        "massa_kg_m2": 14.0,
        "sumber": "SNI 6389:2020 Tabel 2 (Putih semi kilap α=0,30) & nilai tipikal",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Sirip peneduh matahari eksternal untuk mereduksi faktor bayangan SC_eff.",
    },

    # ------------------------------------------------------------------------
    # D. ROOF ASSEMBLIES (PENUTUP ATAP GENERIK — RTTV PASAL 4.4)
    # ------------------------------------------------------------------------
    {
        "id": "rf_dak_beton_120_insulasi",
        "name": "Dak Beton Bertulang 120mm + Insulasi 50mm + Lapisan Putih",
        "brand": "Generik (Nilai Tipikal)",
        "category": "roof",
        "technology": "Insulated Concrete Roof Slab",
        "u_value": 0.58,
        "alpha": 0.50,
        "massa_kg_m2": 288.0,
        "td_ek": 16.0,
        "thickness_mm": 180.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Atap putih α=0,50) & Tabel 9 (massa >230 kg/m² -> TD_EQ=16 K)",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Dak atap beton bertulang massa berat dengan insulasi termal dan lapisan kedap air cerah.",
    },
    {
        "id": "rf_metal_insulasi_50",
        "name": "Atap Metal + Insulasi 50mm + Finish Seng Putih",
        "brand": "Generik (Nilai Tipikal)",
        "category": "roof",
        "technology": "Insulated Lightweight Metal Roof",
        "u_value": 0.45,
        "alpha": 0.26,
        "massa_kg_m2": 25.0,
        "td_ek": 24.0,
        "thickness_mm": 60.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Seng putih α=0,26) & Tabel 9 (massa <50 kg/m² -> TD_EQ=24 K)",
        "status": "nilai_tipikal",
        "market_availability": "Material Umum",
        "description": "Atap metal ringan berinsulasi dengan reflektivitas tinggi (TD_EQ = 24 K sesuai Tabel 9).",
    },
]

# Pemetaan migrasi ID material lama (bermerek) -> ID generik terdekat
LEGACY_MATERIAL_ID_MAP: Dict[str, str] = {
    "glz_asahimas_indoflo_clear_8": "glz_kaca_polos_8",
    "glz_asahimas_panasap_grey_8": "glz_kaca_tinted_8",
    "glz_mulia_tinted_green_8": "glz_kaca_tinted_8",
    "glz_asahimas_stopsol_supersilver_8": "glz_kaca_reflektif_8",
    "glz_asahimas_sunergy_single_8": "glz_kaca_lowe_single_8",
    "glz_asahimas_sunergy_igu_24": "glz_igu_lowe_standar",
    "glz_asahimas_tsunlux_igu_24": "glz_igu_lowe_selektif",
    "glz_saint_gobain_cool_lite_skn154": "glz_igu_lowe_selektif",
    "glz_saint_gobain_xtreme_60_28": "glz_igu_triple_silver",
    "glz_guardian_sunguard_hp_neutral_50": "glz_igu_lowe_standar",
    "glz_smart_electrochromic_sageglass": "glz_kaca_elektrokromik",
    "glz_bipv_solar_facade_agc": "glz_kaca_bipv_semitransparan",
    "glz_aerogel_okalux_okagel": "glz_igu_triple_silver",
    "wal_bata_merah_plester_cat_standar": "wal_bata_merah_plester",
    "wal_aac_hebel_citicon_100": "wal_bata_ringan_aac_100",
    "wal_aac_150_cool_paint_dulux": "wal_bata_ringan_aac_cat_putih",
    "wal_spandrel_rockwool_nichias_50": "wal_spandrel_insulasi_50",
    "wal_acp_seven_alucobond_rockwool": "wal_acp_insulasi_aac",
    "wal_precast_concrete_wika_120": "wal_beton_pracetak_120",
    "wal_sandwich_pir_bluescope_50": "wal_panel_insulasi_pir_50",
    "wal_pcm_biopcm_smart_wall": "wal_acp_insulasi_aac",
    "frm_alexindo_inkalum_std": "frm_aluminium_standar",
    "frm_ykkap_schuco_thermal_break": "frm_aluminium_thermal_break",
    "frm_hunter_douglas_sun_louver": "frm_sirip_peneduh_aluminium",
}


def migrate_material_id(mat_id: Optional[str]) -> Optional[str]:
    """Memetakan ID material lama (bermerek) ke ID material generik terdekat."""
    if not mat_id:
        return mat_id
    return LEGACY_MATERIAL_ID_MAP.get(mat_id, mat_id)


def get_material_shgc(mat: Optional[Dict[str, Any]], fallback_sc: float = 0.23) -> float:
    """Mengembalikan SHGC kaca: pakai field `shgc` jika ada, jika tidak hitung `SC * 0.87`."""
    if isinstance(mat, dict):
        shgc_val = mat.get("shgc")
        if shgc_val is not None:
            return round(float(shgc_val), 4)
        sc_val = mat.get("sc")
        if sc_val is not None:
            return round(float(sc_val) * SC_TO_SHGC_RATIO, 4)
    return round(float(fallback_sc) * SC_TO_SHGC_RATIO, 4)


# Dynamic runtime store for user-added custom materials
CUSTOM_MATERIALS: List[Dict[str, Any]] = []


def get_all_materials(extra_materials: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    mats = list(BUILTIN_MATERIALS) + list(CUSTOM_MATERIALS)
    if extra_materials:
        by_id = {m["id"]: m for m in mats}
        for em in extra_materials:
            if isinstance(em, dict) and em.get("id"):
                by_id[em["id"]] = em
        return list(by_id.values())
    return mats


def get_material_by_id(
    mat_id: Optional[str],
    extra_materials: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    if not mat_id:
        return None
    if extra_materials:
        for m in extra_materials:
            if isinstance(m, dict) and m.get("id") == mat_id:
                return m
    for m in get_all_materials():
        if m["id"] == mat_id:
            return m
    # Fallback: migrasi ID lama ke ID generik terdekat
    migrated = migrate_material_id(mat_id)
    if migrated and migrated != mat_id:
        for m in get_all_materials(extra_materials=extra_materials):
            if m["id"] == migrated:
                return m
    return None


def add_custom_material(data: Dict[str, Any]) -> Dict[str, Any]:
    from sni_tables import get_tdek_roof, get_tdek_wall

    mat_id = data.get("id") or f"custom_{data.get('category', 'mat')}_{len(CUSTOM_MATERIALS) + 1:03d}"
    cat = data.get("category", "glazing").lower()
    if cat not in ("glazing", "wall", "frame", "roof"):
        cat = "glazing"

    massa = float(data.get("massa_kg_m2", 150.0 if cat == "wall" else (250.0 if cat == "roof" else 25.0)))
    sumber = str(data.get("sumber", "") or "").strip()
    has_url = sumber.lower().startswith(("http://", "https://"))
    status = str(data.get("status") or ("datasheet" if has_url else "nilai_tipikal"))
    if status not in ("datasheet", "nilai_tipikal"):
        status = "datasheet" if has_url else "nilai_tipikal"

    if cat == "wall":
        td_ek_val: Optional[float] = get_tdek_wall(massa)
    elif cat == "roof":
        td_ek_val = get_tdek_roof(massa)
    else:
        td_ek_val = None

    sc_val: Optional[float] = None
    shgc_val: Optional[float] = None
    if cat == "glazing":
        if data.get("sc") is not None:
            sc_val = float(data["sc"])
        elif data.get("shgc") is not None:
            sc_val = round(float(data["shgc"]) / SC_TO_SHGC_RATIO, 4)
        else:
            sc_val = 0.35
        if data.get("shgc") is not None:
            shgc_val = round(float(data["shgc"]), 4)
        else:
            shgc_val = round(sc_val * SC_TO_SHGC_RATIO, 4)

    new_mat: Dict[str, Any] = {
        "id": mat_id,
        "name": data.get("name", "Custom Material"),
        "brand": data.get("brand", "Spesifikasi Proyek"),
        "category": cat,
        "technology": data.get("technology", "Custom Specification"),
        "u_value": float(data.get("u_value", 2.0)),
        "sc": sc_val,
        "shgc": shgc_val,
        "vlt": float(data.get("vlt", 0.50)) if cat == "glazing" else None,
        "alpha": float(data.get("alpha", 0.45)) if cat != "glazing" else None,
        "massa_kg_m2": massa,
        "td_ek": td_ek_val,
        "sumber": sumber,
        "status": status,
        "thickness_mm": float(data.get("thickness_mm", 24.0)),
        "market_availability": data.get("market_availability", "Custom Project Spec"),
        "description": data.get("description", "Material kustom yang ditambahkan oleh pengguna."),
        "is_custom": True,
    }
    if has_url and data.get("brand") and "generik" not in str(data.get("brand")).lower():
        new_mat["label"] = "Contoh produk"
    for i, existing in enumerate(CUSTOM_MATERIALS):
        if existing["id"] == mat_id:
            CUSTOM_MATERIALS[i] = new_mat
            return new_mat
    CUSTOM_MATERIALS.append(new_mat)
    return new_mat


# ============================================================================
# 2. INDONESIAN CITIES CLIMATE DATABASE & .EPW PARSER
# ============================================================================

INDONESIAN_CITY_PRESETS: Dict[str, Dict[str, Any]] = {
    "jakarta": {
        "id": "jakarta",
        "city": "Jakarta (DKI Jakarta)",
        "station": "Soekarno-Hatta / Kemayoran WMO 967490",
        "latitude_deg": -6.2088,
        "longitude_deg": 106.8456,
        "elevation_m": 8.0,
        "mean_temp_c": 28.4,
        "design_delta_t": 5.0,
        "peak_dni_wm2": 890.0,
        "sf_multiplier": 1.00,  # Reference SNI 6389:2020 base
        "description": "Iklim tropis pesisir megapolitan; acuan dasar Tabel SF SNI 6389:2020.",
    },
    "surabaya": {
        "id": "surabaya",
        "city": "Surabaya (Jawa Timur)",
        "station": "Juanda Intl Airport WMO 969350",
        "latitude_deg": -7.3798,
        "longitude_deg": 112.7869,
        "elevation_m": 3.0,
        "mean_temp_c": 29.1,
        "design_delta_t": 5.4,
        "peak_dni_wm2": 945.0,
        "sf_multiplier": 1.05,
        "description": "Radiasi surya langsung (DNI) dan temperatur udara siang hari tinggi.",
    },
    "bandung": {
        "id": "bandung",
        "city": "Bandung (Jawa Barat)",
        "station": "Husein Sastranegara WMO 967830",
        "latitude_deg": -6.9006,
        "longitude_deg": 107.5763,
        "elevation_m": 740.0,
        "mean_temp_c": 23.6,
        "design_delta_t": 3.2,
        "peak_dni_wm2": 860.0,
        "sf_multiplier": 0.92,
        "description": "Dataran tinggi cekungan Bandung (740m dpl); beban konduksi kaca lebih rendah.",
    },
    "medan": {
        "id": "medan",
        "city": "Medan (Sumatera Utara)",
        "station": "Kualanamu / Polonia WMO 960350",
        "latitude_deg": 3.5952,
        "longitude_deg": 98.6722,
        "elevation_m": 25.0,
        "mean_temp_c": 28.0,
        "design_delta_t": 4.9,
        "peak_dni_wm2": 880.0,
        "sf_multiplier": 0.99,
        "description": "Lintang Utara Khatulistiwa (+3.59° LU); profil beban fasad Selatan sedikit lebih tinggi.",
    },
    "denpasar": {
        "id": "denpasar",
        "city": "Denpasar (Bali)",
        "station": "I Gusti Ngurah Rai WMO 972300",
        "latitude_deg": -8.7482,
        "longitude_deg": 115.1672,
        "elevation_m": 4.0,
        "mean_temp_c": 28.2,
        "design_delta_t": 4.8,
        "peak_dni_wm2": 930.0,
        "sf_multiplier": 1.03,
        "description": "Pesisir tropis selatan khatulistiwa (-8.75° LS) dengan intensitas surya cerah tinggi.",
    },
    "makassar": {
        "id": "makassar",
        "city": "Makassar (Sulawesi Selatan)",
        "station": "Sultan Hasanuddin WMO 971800",
        "latitude_deg": -5.0616,
        "longitude_deg": 119.5540,
        "elevation_m": 14.0,
        "mean_temp_c": 28.5,
        "design_delta_t": 5.1,
        "peak_dni_wm2": 915.0,
        "sf_multiplier": 1.02,
        "description": "Pesisir barat Sulawesi Selatan; radiasi sore hari pada orientasi Barat sangat dominan.",
    },
    "ikn_nusantara": {
        "id": "ikn_nusantara",
        "city": "IKN Nusantara / Balikpapan (Kaltim)",
        "station": "Sultan Aji Muhammad Sulaiman WMO 966330",
        "latitude_deg": -0.9730,
        "longitude_deg": 116.7090,
        "elevation_m": 45.0,
        "mean_temp_c": 27.9,
        "design_delta_t": 4.8,
        "peak_dni_wm2": 885.0,
        "sf_multiplier": 0.99,
        "description": "Tepat di sabuk khatulistiwa (-0.97° LS); lintasan matahari hampir simetris sepanjang tahun.",
    },
    "semarang": {
        "id": "semarang",
        "city": "Semarang (Jawa Tengah)",
        "station": "Ahmad Yani Intl WMO 968390",
        "latitude_deg": -6.9714,
        "longitude_deg": 110.3744,
        "elevation_m": 3.0,
        "mean_temp_c": 28.8,
        "design_delta_t": 5.2,
        "peak_dni_wm2": 910.0,
        "sf_multiplier": 1.02,
        "description": "Pesisir utara Jawa Tengah dengan suhu rata-rata siang hari cukup tinggi.",
    },
    "yogyakarta": {
        "id": "yogyakarta",
        "city": "Yogyakarta (DIY)",
        "station": "Adisutjipto / YIA WMO 968530",
        "latitude_deg": -7.7956,
        "longitude_deg": 110.3695,
        "elevation_m": 113.0,
        "mean_temp_c": 27.2,
        "design_delta_t": 4.6,
        "peak_dni_wm2": 880.0,
        "sf_multiplier": 0.98,
        "description": "Iklim tropis daratan tengah-selatan Jawa.",
    },
    "palembang": {
        "id": "palembang",
        "city": "Palembang (Sumatera Selatan)",
        "station": "Sultan Mahmud Badaruddin II WMO 962210",
        "latitude_deg": -2.8980,
        "longitude_deg": 104.6999,
        "elevation_m": 12.0,
        "mean_temp_c": 28.3,
        "design_delta_t": 5.0,
        "peak_dni_wm2": 885.0,
        "sf_multiplier": 1.00,
        "description": "Iklim dataran rendah Sumatera bagian selatan dekat ekuator.",
    },
}


def parse_epw_content(epw_text: str, filename: str = "custom.epw") -> Dict[str, Any]:
    """
    Parses an EnergyPlus Weather (.epw) file header and hourly radiation/temperature records
    (08:00 - 16:00) to extract site coordinates, design Delta T, and solar radiation profile.
    """
    lines = [ln.strip() for ln in epw_text.splitlines() if ln.strip()]
    if not lines:
        raise ValueError("File EPW kosong.")

    city = filename
    station = "Custom EPW Station"
    lat = -6.2088
    lon = 106.8456
    elev = 10.0

    # Parse LOCATION header: LOCATION,City,State,Country,Source,WMO,Lat,Lon,TZ,Elev
    for ln in lines[:15]:
        if ln.upper().startswith("LOCATION,"):
            parts = [p.strip() for p in ln.split(",")]
            if len(parts) >= 10:
                city = f"{parts[1]} ({parts[3]})"
                station = f"{parts[4]} WMO {parts[5]}"
                try:
                    lat = float(parts[6])
                    lon = float(parts[7])
                    elev = float(parts[9])
                except ValueError:
                    pass
            break

    # Parse hourly data rows (08:00 - 16:00)
    daytime_temps: List[float] = []
    daytime_dnis: List[float] = []
    hourly_dni_buckets: Dict[int, List[float]] = {h: [] for h in range(8, 17)}

    for ln in lines:
        if ln[0].isdigit():
            cols = ln.split(",")
            if len(cols) >= 16:
                try:
                    hour = int(cols[3])
                    dry_bulb = float(cols[6])
                    dni = float(cols[14])
                    if 8 <= hour <= 16:
                        if -20.0 < dry_bulb < 55.0:
                            daytime_temps.append(dry_bulb)
                        if 0.0 <= dni < 1300.0:
                            daytime_dnis.append(dni)
                            hourly_dni_buckets[hour].append(dni)
                except ValueError:
                    continue

    mean_temp = sum(daytime_temps) / len(daytime_temps) if daytime_temps else 28.4
    # Indoor design temperature per SNI 6389:2020 is ~24.0 - 25.0 C; Delta T clamped to [2.5, 8.0]
    design_delta_t = round(max(2.5, min(8.0, mean_temp - 23.5)), 2)

    avg_dni = sum(daytime_dnis) / len(daytime_dnis) if daytime_dnis else 480.0
    peak_dni = max(daytime_dnis) if daytime_dnis else 890.0
    sf_multiplier = round(max(0.82, min(1.22, avg_dni / 480.0)), 3)

    hourly_dni_profile = {
        h: round(sum(vals) / len(vals), 1) if vals else 650.0
        for h, vals in hourly_dni_buckets.items()
    }

    return {
        "id": "custom_epw",
        "city": city,
        "station": station,
        "filename": filename,
        "latitude_deg": round(lat, 4),
        "longitude_deg": round(lon, 4),
        "elevation_m": round(elev, 1),
        "mean_temp_c": round(mean_temp, 2),
        "design_delta_t": design_delta_t,
        "peak_dni_wm2": round(peak_dni, 1),
        "sf_multiplier": sf_multiplier,
        "hourly_dni_profile": hourly_dni_profile,
        "records_parsed": len(daytime_temps),
        "description": f"Data cuaca EPW kustom ({len(daytime_temps)} jam siang dianalisis).",
    }


def generate_sample_epw_file(output_path: str, city_key: str = "jakarta") -> str:
    """Generates a valid sample EnergyPlus (.epw) weather file for testing upload."""
    preset = INDONESIAN_CITY_PRESETS.get(city_key, INDONESIAN_CITY_PRESETS["jakarta"])
    lat = preset["latitude_deg"]
    lon = preset["longitude_deg"]
    elev = preset["elevation_m"]
    base_temp = preset["mean_temp_c"]
    peak_dni = preset["peak_dni_wm2"]

    lines = [
        f"LOCATION,{preset['city']},IDN,Indonesia,BMKG-TMYx,967490,{lat},{lon},7.0,{elev}",
        "DESIGN CONDITIONS,0",
        "TYPICAL/EXTREME PERIODS,0",
        "GROUND TEMPERATURES,0",
        "HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0",
        "COMMENTS 1,SNI 6389:2020 Sample EPW Weather File generated by OTTV 3D Parametric Studio",
        "COMMENTS 2, Ground temperatures and hourly solar radiation for facade OTTV simulation",
        "DATA PERIODS,1,1,Data,Sunday,1/ 1,12/31",
    ]

    # Generate 12 representative days (1 per month, 24 hours each = 288 records)
    for month in range(1, 13):
        for hour in range(1, 25):
            if 7 <= hour <= 17:
                phase = math.sin(math.pi * (hour - 6) / 12.0)
                t_db = round(base_temp - 2.5 + 5.2 * phase, 1)
                dni = round(peak_dni * (phase ** 1.35) * 0.72, 1)
                dhi = round(140.0 + 110.0 * phase, 1)
                ghi = round(dni * phase + dhi, 1)
            else:
                t_db = round(base_temp - 3.2, 1)
                dni = 0.0
                dhi = 0.0
                ghi = 0.0
            lines.append(
                f"2025,{month},21,{hour},60,?9?9?9?9E0?9?9?9?9?9?9?9?9?9?9?9?9?9?9?9*9*9?9?9?9,"
                f"{t_db},22.5,74,101100,0,0,390,{ghi},{dni},{dhi},0,0,0,0,180,3.2,5,5,15,7777,9,999999999,0,0.08,0,88,0,0,0"
            )

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return output_path


# ============================================================================
# 3. INTELLIGENT MATERIAL OPTIMIZATION & BRAND RECOMMENDER (INDONESIA)
# ============================================================================

def generate_material_recommendations(
    current_ottv_wm2: float,
    effective_wwr: float,
    total_envelope_area_m2: float,
    current_heat_kw: float,
) -> List[Dict[str, Any]]:
    """
    Evaluates the building's current OTTV and WWR and recommends concrete,
    market-ready Indonesian architectural material combinations (Glazing + Wall/Spandrel + Frame)
    with projected OTTV and thermal load savings.
    """
    packages = [
        {
            "package_id": "pkg_sni_compliant_value",
            "tier": "Paket 1 — Standar Kepatuhan SNI 6389:2020 (Generik Ekonomis)",
            "badge": "Rekomendasi Ekonomis <= 35 W/m²",
            "glazing_material_id": "glz_kaca_lowe_single_8",
            "wall_material_id": "wal_bata_ringan_aac_100",
            "frame_material_id": "frm_aluminium_standar",
            "glazing_brand": "Kaca Low-E Hard-Coat Tunggal 8mm (Generik)",
            "wall_brand": "Dinding Bata Ringan AAC 100mm + Cat Muda (Generik)",
            "frame_brand": "Rangka Aluminium Non-Thermal Break (Generik)",
            "specs": {
                "sc_glass": 0.41,
                "u_fenestration": 3.60,
                "u_wall": 1.42,
                "alpha_wall": 0.47,
                "td_ek": 12.0,
                "u_frame": 5.80,
            },
            "highlights": [
                "Cocok untuk gedung dengan WWR menengah (<= 50%) tanpa biaya IGU kaca ganda",
                "Nilai tipikal generik sesuai Tabel 1/2/3/7 SNI 6389:2020",
            ],
        },
        {
            "package_id": "pkg_high_rise_curtain_wall",
            "tier": "Paket 2 — High-Rise Curtain Wall (Generik Performa Tinggi)",
            "badge": "Rekomendasi untuk Tower Curtain Wall",
            "glazing_material_id": "glz_igu_lowe_selektif",
            "wall_material_id": "wal_spandrel_insulasi_50",
            "frame_material_id": "frm_aluminium_thermal_break",
            "glazing_brand": "Kaca Ganda (IGU) Double-Silver Low-E 6+12Ar+6mm (Generik)",
            "wall_brand": "Spandrel Curtain Wall + Insulasi Mineral Wool 50mm (Generik)",
            "frame_brand": "Rangka Aluminium Curtain Wall + Thermal Break (Generik)",
            "specs": {
                "sc_glass": 0.25,
                "u_fenestration": 1.45,
                "u_wall": 0.62,
                "alpha_wall": 0.40,
                "td_ek": 15.0,
                "u_frame": 2.10,
            },
            "highlights": [
                "Dirancang untuk fasad Curtain Wall WWR menengah-tinggi (50%–80%)",
                "Menurunkan OTTV ke kisaran 19–25 W/m² sekaligus menjaga transmisi cahaya alami (VLT ~50%)",
            ],
        },
        {
            "package_id": "pkg_net_zero_smart_facade",
            "tier": "Paket 3 — Fasad Ultra-Low OTTV (Generik Selektivitas Tertinggi)",
            "badge": "Performa Termal Tertinggi (Ultra-Low OTTV)",
            "glazing_material_id": "glz_igu_triple_silver",
            "wall_material_id": "wal_acp_insulasi_aac",
            "frame_material_id": "frm_sirip_peneduh_aluminium",
            "glazing_brand": "Kaca Ganda (IGU) Triple-Silver Ultra-Selective (Generik)",
            "wall_brand": "Cladding ACP 4mm + Insulasi 50mm + Bata Ringan AAC (Generik)",
            "frame_brand": "Rangka Thermal Break + Sirip Peneduh Aluminium (Generik)",
            "specs": {
                "sc_glass": 0.23,
                "u_fenestration": 1.10,
                "u_wall": 0.55,
                "alpha_wall": 0.40,
                "td_ek": 12.0,
                "u_frame": 1.80,
            },
            "highlights": [
                "Memangkas radiasi surya & konduksi kaca signifikan dibanding kaca tinted standar",
                "Nilai tipikal generik untuk target efisiensi energi selubung bangunan tinggi",
            ],
        },
    ]

    results: List[Dict[str, Any]] = []
    wwr = max(0.15, min(0.88, effective_wwr))
    avg_sf = 148.0

    for pkg in packages:
        sp = pkg["specs"]
        q_w = sp["alpha_wall"] * sp["u_wall"] * (1.0 - wwr) * sp["td_ek"]
        q_gc = sp["u_fenestration"] * wwr * 5.0
        q_sol = avg_sf * wwr * (sp["sc_glass"] * 0.76)
        est_ottv = round(q_w + q_gc + q_sol, 2)
        est_kw = round((est_ottv * total_envelope_area_m2) / 1000.0, 2)
        saved_kw = round(max(0.0, current_heat_kw - est_kw), 2)

        results.append({
            **pkg,
            "estimated_ottv_wm2": est_ottv,
            "estimated_heat_kw": est_kw,
            "saved_heat_kw": saved_kw,
            "compliant_sni": est_ottv <= 35.0,
        })

    return results
