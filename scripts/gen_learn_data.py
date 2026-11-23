"""Membuat frontend/src/learn/sniData.js untuk modul Belajar OTTV dari tabel SNI & katalog material backend.

Jalankan dari akar repo:  python scripts/gen_learn_data.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import materials_and_epw as m  # noqa: E402
import sni_tables as t  # noqa: E402

items = m.BUILTIN_MATERIALS if isinstance(m.BUILTIN_MATERIALS, list) else list(m.BUILTIN_MATERIALS.values())
byid = {x["id"]: x for x in items}


def pick(names, keys):
    out = []
    for i, short in names.items():
        x = byid[i]
        d = {k: x.get(k) for k in keys}
        d["id"] = i
        d["name"] = short
        out.append(d)
    return out


glass = pick({
    "glz_kaca_polos_8": "Kaca polos 8 mm",
    "glz_kaca_tinted_8": "Kaca warna (tinted) 8 mm",
    "glz_kaca_reflektif_8": "Kaca reflektif 8 mm",
    "glz_kaca_lowe_single_8": "Kaca Low-E 8 mm",
}, ["u_value", "sc"])
wall = pick({
    "wal_bata_merah_plester": "Bata merah + plester",
    "wal_bata_ringan_aac_100": "Bata ringan 100 mm",
    "wal_bata_ringan_aac_cat_putih": "Bata ringan 150 mm cat putih",
    "wal_spandrel_tanpa_insulasi": "Spandrel tanpa insulasi",
    "wal_spandrel_insulasi_50": "Spandrel + insulasi 50 mm",
    "wal_beton_pracetak_120": "Beton pracetak 120 mm",
}, ["u_value", "alpha", "massa_kg_m2"])
roof = pick({
    "rf_dak_beton_120_insulasi": "Dak beton + insulasi",
    "rf_metal_insulasi_50": "Atap metal + insulasi",
}, ["u_value", "alpha", "massa_kg_m2"])
cities = [{"id": k, "name": c["city"], "sf": c["sf"]} for k, c in t.SNI_TABLE_8_SOLAR_FACTOR.items()]
sceff = {code: [t.get_sceff_horizontal(code, r / 10) for r in range(0, 21)] for code in ["U", "TL", "T", "TGR", "S", "BD", "B", "BL"]}
data = {
    "cities": cities, "glass": glass, "wall": wall, "roof": roof, "sceffHorizontal": sceff,
    "tdekWall": [[125, 15], [195, 12], [1e9, 10]], "tdekRoof": [[50, 24], [230, 20], [1e9, 16]],
    "deltaT": t.SNI_DELTA_T_K, "ottvLimit": 35.0,
    "rttvLimitSky": t.SNI_RTTV_LIMIT_WITH_SKYLIGHT_WM2, "rttvLimitOpaque": t.SNI_RTTV_LIMIT_OPAQUE_ONLY_WM2,
}
src = ("/**\n * Data SNI 6389:2020 untuk modul Belajar (dibuat otomatis dari backend/sni_tables.py dan katalog material).\n"
       " * Jangan diedit manual; jalankan ulang skrip pembuatnya bila tabel berubah.\n */\n"
       "export const SNI = " + json.dumps(data, ensure_ascii=False) + ";\n")
with open(os.path.join(ROOT, "frontend", "src", "learn", "sniData.js"), "w", encoding="utf-8") as fh:
    fh.write(src)
print("sniData.js ditulis,", len(src), "byte")
