"""
Uji klasifikasi nama layer nyata (Audit A3-03 / A3-12).

Yang paling penting: nama tidak boleh salah dengan YAKIN. Nama yang belum dikenal boleh menjadi
'unknown' (hasil otomatis berstatus sementara), tetapi tidak boleh diam-diam menjadi peran lain.
"""

from __future__ import annotations

import os
import sys

import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from loaders.classify import classify_layer_or_material_with_confidence as classify  # noqa: E402

EXPECTED = {
    "glazing": [
        "Kaca Tempered", "Kaca Stopsol", "Glass Curtain", "GLS", "Kaca Mati", "Jendela Nako", "Pintu Kaca",
        "Skylight Atap", "Atap Kaca", "Polycarbonate", "Glass Block", "Kaca Es", "Fixed Glass",
        "Window Glazing Unit", "Vitrage", "Glazed Panel", "Low-E IGU", "Rhino Glass", "Material_Glass_Blue",
        "CW_Vision_Glass", "Crown_Glass_Panels",
    ],
    "wall": [
        "ACP", "Aluminium Composite Panel", "Dinding Bata Ringan", "GRC Panel", "Cladding Kayu", "WPC",
        "Bata Ekspos", "Dinding Partisi Luar", "Precast Panel", "Batu Alam", "Keramik Dinding", "Plester Aci",
        "Hollow Core Wall", "Masonry", "Cat Tembok", "Stone Cladding", "Metal Cladding", "Sandwich Panel",
        "Aluminium Panel",
    ],
    "frame": [
        "Kusen Aluminium", "Kusen", "Mullion", "Rangka Kaca", "Frame", "Profil Aluminium", "Sash",
        "Window Frame", "Door Frame", "Transom Bar", "Kusen Jendela", "CW_Vertical_Mullions",
        "CW_Horizontal_Transoms", "Crown_Horizontal_Rings",
    ],
    "shading": [
        "Sirip", "Kisi-kisi", "Louvre", "Secondary Skin", "Brise Soleil", "Perforated Panel", "Expanded Metal",
        "Kanopi", "Canopy", "Overhang", "Sun Shade", "Shading Fin", "Roster Peneduh", "Tirai Bambu", "Pergola",
        "Vertical Garden", "Krepyak", "Jalusi", "Louvres", "Canopies",
    ],
    "roof": ["Atap Dak", "Atap Genteng", "Roof Tile", "Metal Roof", "Spandek", "Atap Beton", "Roof Garden"],
    "spandrel": ["CW_Spandrel_Panels", "Spandrel Insulasi"],
}
NOT_ENVELOPE = [
    "Lantai", "Railing", "Balustrade", "Tangga", "Kolom", "Balok", "Pohon", "Jalan", "Site", "Furniture",
    "Toilet", "Partisi", "Interior Wall", "Parkir", "Mobil", "Manusia", "Kontur", "Pelat Lantai",
]
# Boleh 'unknown' (aman: hasil sementara), tetapi TIDAK boleh menjadi peran selubung lain.
MAY_BE_UNKNOWN = {"GL-01": "glazing", "Roster": "wall", "Exterior Finish": "wall", "Spigot": "frame", "Bracket": "frame"}


@pytest.mark.parametrize("expected,name", [(k, n) for k, ns in EXPECTED.items() for n in ns])
def test_nama_layer_dikenali(expected, name):
    role, conf, reason = classify(name)
    assert role == expected, f"'{name}' -> {role} ({reason}), seharusnya {expected}"


@pytest.mark.parametrize("name", NOT_ENVELOPE)
def test_bukan_selubung(name):
    role, _, reason = classify(name)
    assert role in ("ignore", "context"), f"'{name}' -> {role} ({reason})"


@pytest.mark.parametrize("name,expected", list(MAY_BE_UNKNOWN.items()))
def test_tak_dikenal_tidak_salah_yakin(name, expected):
    role, _, reason = classify(name)
    assert role in ("unknown", expected), f"'{name}' -> {role} ({reason}): salah dengan yakin"
