"""Cache deteksi sisi luar di inspeksi (layar Konfirmasi memanggil inspeksi berulang) tidak boleh mengubah hasil."""

from __future__ import annotations

import json
import os
import sys

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT_DIR, "backend"))

import ottv_engine  # noqa: E402
from adapters import build_staging_inspection_payload  # noqa: E402
from config_schema import InspectRequest  # noqa: E402

MODEL = os.path.join(ROOT_DIR, "fixtures", "synthetic", "06_courtyard", "model.3dm")
REQS = [
    {},
    {"settings": {"floor_height_m": 4.0, "floor_mode": "uniform"}},
    {"model": {"z_ground_cutoff_m": 1.0}},
    {"model": {"exterior_detection_mode": "raycast"}},
    {"roles": {"disabled_groups": ["Atap Beton :: Atap Beton"]}},
]


def _run(req):
    r = build_staging_inspection_payload(filepath=MODEL, display_filename="m.3dm", model_id="m", config=InspectRequest.model_validate(req))
    return json.dumps(r, sort_keys=True, default=str)


def test_hasil_ber_cache_sama_dengan_hitung_baru():
    ottv_engine._OUTER_SKIN_CACHE.clear()
    first = [_run(q) for q in REQS]          # mengisi cache
    again = [_run(q) for q in REQS]          # dari cache
    fresh = []
    for q in REQS:                            # tiap permintaan dihitung tanpa cache
        ottv_engine._OUTER_SKIN_CACHE.clear()
        fresh.append(_run(q))
    assert first == again == fresh
