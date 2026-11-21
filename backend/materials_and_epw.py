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
# 1. INDONESIAN & ADVANCED ARCHITECTURAL MATERIAL LIBRARY (SNI 6389:2020)
# ============================================================================

BUILTIN_MATERIALS: List[Dict[str, Any]] = [
    # ------------------------------------------------------------------------
    # A. GLAZING / FENESTRATION MATERIALS (KACA ARSITEKTURAL)
    # ------------------------------------------------------------------------
    {
        "id": "glz_asahimas_indoflo_clear_8",
        "name": "Indoflo Clear Float Glass 8mm (Single)",
        "brand": "PT Asahimas Flat Glass Tbk (AMG)",
        "category": "glazing",
        "technology": "Konvensional (Single Float)",
        "u_value": 5.60,
        "sc": 0.92,
        "shgc": 0.80,
        "vlt": 0.87,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "Katalog Teknis PT Asahimas Flat Glass Tbk — Indoflo Clear 8mm",
        "status": "datasheet",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Kaca polos standar 8mm. Transmisi cahaya tinggi namun meneruskan panas surya sangat besar.",
    },
    {
        "id": "glz_asahimas_panasap_grey_8",
        "name": "Panasap Dark Grey / Green Tinted 8mm (Single)",
        "brand": "PT Asahimas Flat Glass Tbk (AMG)",
        "category": "glazing",
        "technology": "Tinted Heat-Absorbing Glass",
        "u_value": 5.50,
        "sc": 0.60,
        "shgc": 0.52,
        "vlt": 0.48,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "Katalog Teknis PT Asahimas Flat Glass Tbk — Panasap 8mm",
        "status": "datasheet",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Kaca penyerap panas berwarna (Dark Grey/Euro Grey/Green) yang umum dipakai pada gedung komersial menengah.",
    },
    {
        "id": "glz_mulia_tinted_green_8",
        "name": "Mulia Float Tinted Green / Grey 8mm",
        "brand": "PT Mulia Industrindo Tbk (Mulia Glass)",
        "category": "glazing",
        "technology": "Tinted Heat-Absorbing Glass",
        "u_value": 5.55,
        "sc": 0.63,
        "shgc": 0.55,
        "vlt": 0.54,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Kaca warna produksi lokal Mulia Glass untuk reduksi silau matahari dan beban panas moderat.",
    },
    {
        "id": "glz_asahimas_stopsol_supersilver_8",
        "name": "Stopsol Supersilver Green / Dark Blue 8mm",
        "brand": "PT Asahimas Flat Glass Tbk (AMG)",
        "category": "glazing",
        "technology": "Pyrolytic Hard-Coat Reflective",
        "u_value": 5.30,
        "sc": 0.44,
        "shgc": 0.38,
        "vlt": 0.39,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "Katalog Teknis PT Asahimas Flat Glass Tbk — Stopsol Supersilver 8mm",
        "status": "datasheet",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Kaca reflektif berlapis oksida logam pirolitik tahan cuaca dengan pantulan radiasi surya tinggi.",
    },
    {
        "id": "glz_asahimas_sunergy_single_8",
        "name": "Sunergy Clear / Green 8mm (Single Hard-Coat Low-E)",
        "brand": "PT Asahimas Flat Glass Tbk (AMG)",
        "category": "glazing",
        "technology": "Pyrolytic Low-E (Lapisan Emisivitas Rendah)",
        "u_value": 3.60,
        "sc": 0.41,
        "shgc": 0.36,
        "vlt": 0.56,
        "massa_kg_m2": 20.0,
        "thickness_mm": 8.0,
        "sumber": "Katalog Teknis PT Asahimas Flat Glass Tbk — Sunergy 8mm",
        "status": "datasheet",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Kaca Low-E hard-coat produksi Asahimas yang dapat dipasang secara monolitik (single) maupun laminasi.",
    },
    {
        "id": "glz_asahimas_sunergy_igu_24",
        "name": "Sunergy Green IGU Double Glazing (6mm + 12mm Air + 6mm)",
        "brand": "PT Asahimas Flat Glass Tbk (AMG)",
        "category": "glazing",
        "technology": "Double Glazing (IGU) Hard-Coat Low-E",
        "u_value": 1.90,
        "sc": 0.31,
        "shgc": 0.27,
        "vlt": 0.48,
        "massa_kg_m2": 30.0,
        "thickness_mm": 24.0,
        "sumber": "Katalog Teknis PT Asahimas Flat Glass Tbk — Sunergy IGU 24mm",
        "status": "datasheet",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Unit kaca ganda (IGU) standar gedung perkantoran Grade-A di Jakarta & Surabaya; efektif menekan konduksi & radiasi.",
    },
    {
        "id": "glz_asahimas_tsunlux_igu_24",
        "name": "T-Sunlux / Planibel Double-Silver Low-E IGU (6+12Ar+6)",
        "brand": "PT Asahimas Flat Glass Tbk / AGC",
        "category": "glazing",
        "technology": "Double-Silver Soft-Coat Low-E + Argon IGU",
        "u_value": 1.45,
        "sc": 0.25,
        "shgc": 0.22,
        "vlt": 0.50,
        "massa_kg_m2": 30.0,
        "thickness_mm": 24.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia di Indonesia (Proyek High-Rise)",
        "description": "Kaca IGU performa tinggi dengan selektivitas tinggi (VLT 50%, SC 0.25) untuk fasad curtain wall WWR besar.",
    },
    {
        "id": "glz_saint_gobain_cool_lite_skn154",
        "name": "Cool-Lite SKN 154 Double-Silver Low-E IGU (6+12Ar+6)",
        "brand": "Saint-Gobain Glass Indonesia",
        "category": "glazing",
        "technology": "Double-Silver Magnetron Low-E IGU",
        "u_value": 1.35,
        "sc": 0.28,
        "shgc": 0.24,
        "vlt": 0.50,
        "massa_kg_m2": 30.0,
        "thickness_mm": 24.0,
        "sumber": "Saint-Gobain Glass Technical Datasheet — COOL-LITE SKN 154",
        "status": "datasheet",
        "market_availability": "Tersedia di Indonesia (Distributor Resmi)",
        "description": "Kaca kontrol surya netral Saint-Gobain untuk bangunan hijau berstandar Greenship GBCI & BCA Green Mark.",
    },
    {
        "id": "glz_saint_gobain_xtreme_60_28",
        "name": "Cool-Lite Xtreme 60/28 Triple-Silver Low-E IGU",
        "brand": "Saint-Gobain Glass",
        "category": "glazing",
        "technology": "Triple-Silver Ultra-Selective Low-E IGU",
        "u_value": 1.10,
        "sc": 0.23,
        "shgc": 0.20,
        "vlt": 0.60,
        "massa_kg_m2": 32.0,
        "thickness_mm": 26.0,
        "sumber": "Saint-Gobain Glass Technical Datasheet — COOL-LITE XTREME 60/28",
        "status": "datasheet",
        "market_availability": "Tersedia (Impor Proyek Premium Indonesia)",
        "description": "Teknologi kaca Triple-Silver mutakhir dengan rasio Light-to-Solar Gain (LSG = 2.14) sangat tinggi.",
    },
    {
        "id": "glz_guardian_sunguard_hp_neutral_50",
        "name": "SunGuard HP Neutral 50 IGU (6+12Air+6)",
        "brand": "Guardian Glass Southeast Asia",
        "category": "glazing",
        "technology": "Sputtered Solar Control Low-E IGU",
        "u_value": 1.60,
        "sc": 0.33,
        "shgc": 0.29,
        "vlt": 0.49,
        "massa_kg_m2": 30.0,
        "thickness_mm": 24.0,
        "sumber": "Guardian Glass Technical Datasheet — SunGuard HP Neutral 50",
        "status": "datasheet",
        "market_availability": "Tersedia di Pasar Asia Tenggara & Indonesia",
        "description": "Kaca Low-E sputtered regional ASEAN yang populer untuk menara komersial dengan tampilan netral.",
    },
    {
        "id": "glz_smart_electrochromic_sageglass",
        "name": "SageGlass / View Dynamic Electrochromic IGU (Tinted State)",
        "brand": "Saint-Gobain SageGlass / View Inc.",
        "category": "glazing",
        "technology": "Smart Electrochromic Dynamic Tinting Glass",
        "u_value": 1.25,
        "sc": 0.15,
        "shgc": 0.13,
        "vlt": 0.25,
        "massa_kg_m2": 34.0,
        "thickness_mm": 26.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Teknologi Baru (Smart Building / Bandara / IKN)",
        "description": "Kaca pintar elektrokromik yang menggelap otomatis saat radiasi matahari terik (SC turun hingga 0.11-0.15).",
    },
    {
        "id": "glz_bipv_solar_facade_agc",
        "name": "SunEwat / Onyx Solar BIPV Semi-Transparent PV Glass",
        "brand": "AGC SunEwat / Onyx Solar",
        "category": "glazing",
        "technology": "Building-Integrated Photovoltaics (BIPV)",
        "u_value": 1.50,
        "sc": 0.20,
        "shgc": 0.17,
        "vlt": 0.30,
        "massa_kg_m2": 35.0,
        "thickness_mm": 28.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Teknologi Baru (Green Mark / Net-Zero Building)",
        "description": "Kaca fasad fotovoltaik semi-transparan untuk crown/skylight/curtain wall yang sekaligus memanen energi surya.",
    },
    {
        "id": "glz_aerogel_okalux_okagel",
        "name": "Okagel Translucent Silica Aerogel Insulated Glazing",
        "brand": "Okalux / Cabot Aerogel",
        "category": "glazing",
        "technology": "Nano-Porous Silica Aerogel Daylight Glazing",
        "u_value": 0.65,
        "sc": 0.28,
        "shgc": 0.24,
        "vlt": 0.45,
        "massa_kg_m2": 34.0,
        "thickness_mm": 32.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Teknologi Baru Spesialis",
        "description": "Panel kaca berinsulasi nano-aerogel dengan difusi cahaya alami bebas silau dan U-value sangat rendah (0.65 W/m²K).",
    },

    # ------------------------------------------------------------------------
    # B. OPAQUE WALL & SPANDREL MATERIALS (DINDING MASIF & SPANDREL)
    # ------------------------------------------------------------------------
    {
        "id": "wal_bata_merah_plester_cat_standar",
        "name": "Bata Merah 150mm + Plester Aci + Cat Eksterior Standar",
        "brand": "Lokal Indonesia + Mortar Utama (MU)",
        "category": "wall",
        "technology": "Konstruksi Masonry Konvensional",
        "u_value": 2.55,
        "alpha": 0.65,
        "massa_kg_m2": 260.0,
        "td_ek": 10.0,
        "thickness_mm": 150.0,
        "sumber": "SNI 6389:2020 Tabel 5 & Tabel 7 (nilai tipikal pasangan bata merah 150mm)",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia Sangat Luas di Seluruh Indonesia",
        "description": "Dinding pasangan bata merah tradisional dengan plester semen-pasir dan cat warna sedang.",
    },
    {
        "id": "wal_aac_hebel_citicon_100",
        "name": "Bata Ringan AAC 100mm (Hebel / Citicon / Blesscon) + Mortar Tipis",
        "brand": "PT Jaya Celcon Prima (Hebel) / Citicon / Blesscon / MU",
        "category": "wall",
        "technology": "Autoclaved Aerated Concrete (AAC)",
        "u_value": 1.42,
        "alpha": 0.52,
        "massa_kg_m2": 140.0,
        "td_ek": 12.0,
        "thickness_mm": 115.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Standar Utama Gedung Tinggi di Indonesia",
        "description": "Dinding bata ringan pori mikro (AAC) dengan konduktivitas termal rendah (λ ≈ 0.14 W/mK).",
    },
    {
        "id": "wal_aac_150_cool_paint_dulux",
        "name": "Bata Ringan AAC 150mm + Cat Reflektif Surya (KeepCool / Solareflect)",
        "brand": "Hebel/Citicon + Dulux Weathershield KeepCool / Nippon Solareflect",
        "category": "wall",
        "technology": "AAC + High-SRI Solar Reflective Coating",
        "u_value": 1.05,
        "alpha": 0.28,
        "massa_kg_m2": 165.0,
        "td_ek": 12.0,
        "thickness_mm": 165.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Kombinasi bata ringan 150mm dan cat pemantul inframerah (SRI tinggi, α = 0.28) yang memangkas konduksi dinding >60%.",
    },
    {
        "id": "wal_spandrel_tanpa_insulasi",
        "name": "Spandrel Kaca 6mm + Shadow Box Tanpa Insulasi",
        "brand": "Curtain Wall Konvensional",
        "category": "wall",
        "technology": "Spandrel Tanpa Insulasi (Generasi Lama)",
        "u_value": 3.10,
        "alpha": 0.68,
        "massa_kg_m2": 35.0,
        "td_ek": 15.0,
        "thickness_mm": 50.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Umum pada Gedung Lama",
        "description": "Panel spandrel kaca dengan rongga udara dan plat aluminium belakang tanpa rockwool; konduksi panas tinggi.",
    },
    {
        "id": "wal_spandrel_rockwool_nichias_50",
        "name": "Spandrel Curtain Wall + Rockwool 50mm (80 kg/m³) + Backpan",
        "brand": "Asahimas + Nichias Tombo / CSR Bradford Rockwool",
        "category": "wall",
        "technology": "Insulated Spandrel Assembly",
        "u_value": 0.62,
        "alpha": 0.42,
        "massa_kg_m2": 45.0,
        "td_ek": 15.0,
        "thickness_mm": 65.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Standar Gedung Hijau High-Rise Indonesia",
        "description": "Spandrel kaca berlapis mineral rockwool 50mm (Nichias Tombo) dan aluminium foil vapor barrier.",
    },
    {
        "id": "wal_acp_seven_alucobond_rockwool",
        "name": "Cladding ACP 4mm (SEVEN / Alucobond) + Rockwool 50mm + AAC",
        "brand": "ACP SEVEN / Alucobond / Goodsense + Rockwool",
        "category": "wall",
        "technology": "Ventilated Rainscreen ACP + Thermal Insulation",
        "u_value": 0.55,
        "alpha": 0.36,
        "massa_kg_m2": 145.0,
        "td_ek": 12.0,
        "thickness_mm": 175.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Fasad Aluminium Composite Panel (PVDF Finish terang/silver) dengan rongga udara dan insulasi rockwool.",
    },
    {
        "id": "wal_precast_concrete_wika_120",
        "name": "Panel Beton Pracetak (Precast Facade) 120mm",
        "brand": "WIKA Beton / Jaya Beton / Adhi Persada Beton",
        "category": "wall",
        "technology": "Precast Architectural Concrete",
        "u_value": 2.85,
        "alpha": 0.60,
        "massa_kg_m2": 288.0,
        "td_ek": 10.0,
        "thickness_mm": 120.0,
        "sumber": "SNI 6389:2020 Tabel 5 & Tabel 7 (beton bertulang 120mm, ρ=2400 kg/m³)",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Dinding pracetak beton bertulang massa berat (TD_ek = 10 K).",
    },
    {
        "id": "wal_sandwich_pir_bluescope_50",
        "name": "Insulated Sandwich Panel PIR/PU 50mm + Colorbond Coolmax",
        "brand": "NS BlueScope Lysaght / Bondor Indonesia",
        "category": "wall",
        "technology": "Polyisocyanurate (PIR) High-R Panel",
        "u_value": 0.42,
        "alpha": 0.26,
        "massa_kg_m2": 18.0,
        "td_ek": 15.0,
        "thickness_mm": 50.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia di Indonesia (Industri & Komersial Modern)",
        "description": "Panel insulasi PIR tertutup dengan baja lapis Colorbond Coolmax reflektansi tinggi.",
    },
    {
        "id": "wal_pcm_biopcm_smart_wall",
        "name": "Dinding Komposit Insulasi + Phase Change Material (BioPCM) + GRC",
        "brand": "GRC Board / Knauf + Phase Change Energy Solutions",
        "category": "wall",
        "technology": "Phase Change Material (PCM) Latent Heat Storage",
        "u_value": 0.48,
        "alpha": 0.32,
        "massa_kg_m2": 210.0,
        "td_ek": 10.0,
        "thickness_mm": 150.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Teknologi Baru (High-Performance Green Building)",
        "description": "Teknologi penyimpan panas laten (PCM titik leleh 25°C) yang meredam puncak gelombang panas siang hari.",
    },

    # ------------------------------------------------------------------------
    # C. CURTAIN WALL FRAME & SHADING FINS (RANGKA MULLION/TRANSOM & PENEDUH)
    # ------------------------------------------------------------------------
    {
        "id": "frm_alexindo_inkalum_std",
        "name": "Aluminium Mullion/Transom Non-Thermal Break (Anodized/Powder Coat)",
        "brand": "PT Alexindo / Inkalum / YKK AP Indonesia",
        "category": "frame",
        "technology": "Extruded Aluminium 6063-T5 Standar",
        "u_value": 5.80,
        "alpha": 0.45,
        "reflectance": 0.55,
        "massa_kg_m2": 15.0,
        "sumber": "SNI 6389:2020 Tabel 3 (Kusen alumunium/metal tanpa pemutus termal)",
        "status": "datasheet",
        "market_availability": "Standar Utama Curtain Wall Indonesia",
        "description": "Profil rangka aluminium ekstrusi lokal tanpa pemutus jembatan termal (non-thermal break).",
    },
    {
        "id": "frm_ykkap_schuco_thermal_break",
        "name": "Aluminium Curtain Wall + Polyamide Thermal Break",
        "brand": "YKK AP / Schüco / Technal",
        "category": "frame",
        "technology": "Polyamide 6.6 Reinforced Thermal Break Frame",
        "u_value": 2.10,
        "alpha": 0.35,
        "reflectance": 0.65,
        "massa_kg_m2": 18.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia untuk Proyek Premium di Indonesia",
        "description": "Profil mullion/transom dengan isolator poliamida yang memangkas konduksi panas rangka aluminium >60%.",
    },
    {
        "id": "frm_hunter_douglas_sun_louver",
        "name": "Aerofoil Sun Louver & Fin Aluminium / Terracotta",
        "brand": "Hunter Douglas Architectural / NBK Terracotta",
        "category": "frame",
        "technology": "Bioclimatic External Shading Fin System",
        "u_value": 1.80,
        "alpha": 0.30,
        "reflectance": 0.70,
        "massa_kg_m2": 14.0,
        "sumber": "",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia di Indonesia",
        "description": "Sirip peneduh matahari eksternal berbentuk aerofoil untuk mereduksi faktor bayangan SC_eff secara optimal.",
    },

    # ------------------------------------------------------------------------
    # D. ROOF ASSEMBLIES (PENUTUP ATAP UNTUK RTTV PASAL 4.4)
    # ------------------------------------------------------------------------
    {
        "id": "rf_dak_beton_120_insulasi",
        "name": "Dak Beton Bertulang 120mm + Insulasi Rockwool 50mm + Waterproofing Cerah",
        "brand": "Konstruksi Atap Beton Standar SNI",
        "category": "roof",
        "technology": "Insulated Concrete Roof Slab",
        "u_value": 0.58,
        "alpha": 0.50,
        "massa_kg_m2": 288.0,
        "td_ek": 16.0,
        "thickness_mm": 180.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Atap putih α=0,50) & Tabel 9 (massa >230 kg/m² -> TD_EQ=16 K)",
        "status": "nilai_tipikal",
        "market_availability": "Standar Gedung Tinggi Indonesia",
        "description": "Dak atap beton bertulang massa berat dengan lapisan insulasi termal dan pelapis kedap air cerah.",
    },
    {
        "id": "rf_metal_insulasi_50",
        "name": "Atap Metal Zincalume + Insulasi Glasswool/Rockwool 50mm + Aluminium Foil",
        "brand": "BlueScope Lysaght / Standar SNI",
        "category": "roof",
        "technology": "Insulated Lightweight Metal Roof",
        "u_value": 0.45,
        "alpha": 0.26,
        "massa_kg_m2": 25.0,
        "td_ek": 24.0,
        "thickness_mm": 60.0,
        "sumber": "SNI 6389:2020 Tabel 1 (Seng putih α=0,26) & Tabel 9 (massa <50 kg/m² -> TD_EQ=24 K)",
        "status": "nilai_tipikal",
        "market_availability": "Tersedia Luas di Indonesia",
        "description": "Atap metal ringan berinsulasi dengan reflektivitas tinggi (TD_EQ = 24 K sesuai Tabel 9).",
    },
]

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
    return None


def add_custom_material(data: Dict[str, Any]) -> Dict[str, Any]:
    from sni_tables import get_tdek_roof, get_tdek_wall

    mat_id = data.get("id") or f"custom_{data.get('category', 'mat')}_{len(CUSTOM_MATERIALS) + 1:03d}"
    cat = data.get("category", "glazing").lower()
    if cat not in ("glazing", "wall", "frame", "roof"):
        cat = "glazing"

    massa = float(data.get("massa_kg_m2", 150.0 if cat == "wall" else (250.0 if cat == "roof" else 25.0)))
    sumber = str(data.get("sumber", "") or "").strip()
    status = str(data.get("status") or ("datasheet" if sumber else "nilai_tipikal"))
    if status not in ("datasheet", "nilai_tipikal"):
        status = "datasheet" if sumber else "nilai_tipikal"

    if cat == "wall":
        td_ek_val: Optional[float] = get_tdek_wall(massa)
    elif cat == "roof":
        td_ek_val = get_tdek_roof(massa)
    else:
        td_ek_val = None

    new_mat: Dict[str, Any] = {
        "id": mat_id,
        "name": data.get("name", "Custom Material"),
        "brand": data.get("brand", "Custom / Spesifikasi Proyek"),
        "category": cat,
        "technology": data.get("technology", "Custom Specification"),
        "u_value": float(data.get("u_value", 2.0)),
        "sc": float(data.get("sc", 0.35)) if cat == "glazing" else None,
        "shgc": round(float(data.get("sc", 0.35)) * 0.87, 3) if cat == "glazing" else None,
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
            "tier": "Paket 1 — Standar Kepatuhan SNI 6389:2020 (Value Engineering)",
            "badge": "Rekomendasi Ekonomis <= 35 W/m²",
            "glazing_material_id": "glz_asahimas_sunergy_single_8",
            "wall_material_id": "wal_aac_hebel_citicon_100",
            "frame_material_id": "frm_alexindo_inkalum_std",
            "glazing_brand": "Asahimas Sunergy Clear/Green 8mm (Single Low-E)",
            "wall_brand": "Bata Ringan AAC Hebel/Citicon 100mm + Mortar MU",
            "frame_brand": "Aluminium Mullion Alexindo / YKK AP Standar",
            "specs": {
                "sc_glass": 0.41,
                "u_fenestration": 3.60,
                "u_wall": 1.42,
                "alpha_wall": 0.52,
                "td_ek": 12.0,
                "u_frame": 5.80,
            },
            "highlights": [
                "Cocok untuk gedung dengan WWR menengah (<= 50%) tanpa biaya IGU kaca ganda",
                "Kaca pirolitik hard-coat tahan cuaca tropis & mudah difabrikasi lokal",
            ],
        },
        {
            "package_id": "pkg_high_rise_curtain_wall",
            "tier": "Paket 2 — High-Rise Curtain Wall Grade-A (Greenship Gold)",
            "badge": "Rekomendasi Terbaik untuk Tower Curtain Wall",
            "glazing_material_id": "glz_asahimas_tsunlux_igu_24",
            "wall_material_id": "wal_spandrel_rockwool_nichias_50",
            "frame_material_id": "frm_ykkap_schuco_thermal_break",
            "glazing_brand": "Asahimas T-Sunlux / Saint-Gobain Cool-Lite SKN 154 Double-Silver Low-E IGU",
            "wall_brand": "Spandrel Kaca + Rockwool Nichias Tombo 50mm (80 kg/m³) + Backpan",
            "frame_brand": "YKK AP / Schüco Aluminium Curtain Wall + Polyamide Thermal Break",
            "specs": {
                "sc_glass": 0.25,
                "u_fenestration": 1.45,
                "u_wall": 0.62,
                "alpha_wall": 0.42,
                "td_ek": 15.0,
                "u_frame": 2.10,
            },
            "highlights": [
                "Dirancang khusus untuk fasad Curtain Wall WWR menengah-tinggi (50%–80%) pada menara komersial",
                "Menurunkan OTTV ke kisaran 19–25 W/m² sekaligus menjaga transmisi cahaya alami (VLT 50%)",
            ],
        },
        {
            "package_id": "pkg_net_zero_smart_facade",
            "tier": "Paket 3 — Smart Facade & Greenship Platinum / IKN Net-Zero",
            "badge": "Performa Termal Tertinggi (Ultra-Low OTTV)",
            "glazing_material_id": "glz_saint_gobain_xtreme_60_28",
            "wall_material_id": "wal_acp_seven_alucobond_rockwool",
            "frame_material_id": "frm_hunter_douglas_sun_louver",
            "glazing_brand": "Saint-Gobain Cool-Lite Xtreme 60/28 Triple-Silver IGU + BIPV Crown",
            "wall_brand": "ACP SEVEN/Alucobond PVDF + Rockwool 50mm + Cat Reflektif KeepCool",
            "frame_brand": "YKK AP Thermal Break + Sirip Peneduh Hunter Douglas Aerofoil",
            "specs": {
                "sc_glass": 0.23,
                "u_fenestration": 1.10,
                "u_wall": 0.55,
                "alpha_wall": 0.36,
                "td_ek": 12.0,
                "u_frame": 1.80,
            },
            "highlights": [
                "Memangkas radiasi surya & konduksi kaca hingga >55% dibanding kaca tinted biasa",
                "Memenuhi standar Greenship GBCI Platinum & Bangunan Gedung Hijau (BGH) Utama",
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
