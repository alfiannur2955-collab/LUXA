"""
Format kirim hasil analisis ke frontend (A3-04 Fase 1, lihat docs/RENCANA_A3-04_UKURAN_DATA.md).

Engine tetap menyimpan hasil LENGKAP (untuk laporan Excel/PDF, ganti material, rekomendasi).
Yang dikirim ke tampilan adalah versi ramping:

  - panel aktif: hanya field yang dipakai frontend; `group_name` & `material_id` berupa indeks ke
    `panel_tables` (dikembalikan ke string oleh frontend/src/engine/payload.js)
  - panel nonaktif: hanya `id`, `active`, `vertices` (dipakai garis X-ray)
  - mesh rangka/peneduh/atap/konteks: biner Float32/Uint32 dalam base64
  - ganti material: hanya kolom angka per panel aktif yang berubah (`panel_updates`)

Angka tidak berubah sedikit pun; frontend membongkarnya kembali ke bentuk lama.
"""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Tuple

import numpy as np

PAYLOAD_FORMAT = "slim-1"

# Field panel aktif yang dipakai frontend (grep frontend/src, Nov 2026) + angka detail panel terpilih.
ACTIVE_PANEL_FIELDS: Tuple[str, ...] = (
    "id", "active", "vertices", "normal", "area_m2", "orientation_code", "element_type",
    "group_name", "material_id", "ottv_panel_wm2", "heat_gain_w", "sunlit_mask", "tilt_deg",
    "sc_shading_multiplier", "floor_number", "floor_label",
    "sc_effective", "sc_glass", "shgc_glass", "sf_wm2", "alpha_wall_eff", "td_ek_eff", "u_fen_eff",
    "u_wall_eff", "q_solar_wm2", "q_wall_wm2",
)
# `centroid` tidak dikirim: frontend menghitungnya dari rata-rata vertex (sama persis dengan engine).
# Field per panel yang dihitung ulang oleh recommender.rematerial_analysis.
REMATERIAL_FIELDS: Tuple[str, ...] = (
    "ottv_panel_wm2", "heat_gain_w", "sc_effective", "sc_glass", "shgc_glass", "u_fen_eff", "u_wall_eff",
    "alpha_wall_eff", "td_ek_eff", "q_wall_wm2", "q_solar_wm2", "material_id",
)
INTERNED_FIELDS: Tuple[str, ...] = ("group_name", "material_id")
MESH_KEYS: Tuple[str, ...] = ("shading_elements", "frame_elements", "roof_elements", "context_elements")


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def encode_mesh(el: Dict[str, Any]) -> Dict[str, Any]:
    v = np.asarray(el.get("vertices") or [], dtype="<f4").reshape(-1)
    f = np.asarray(el.get("faces") or [], dtype="<u4").reshape(-1)
    return {"group_name": el.get("group_name"), "encoding": "f32u32-b64", "vertices_b64": _b64(v), "faces_b64": _b64(f)}


class _Interner:
    def __init__(self) -> None:
        self.values: List[Any] = []
        self._idx: Dict[Any, int] = {}

    def __call__(self, v: Any) -> int:
        if v not in self._idx:
            self._idx[v] = len(self.values)
            self.values.append(v)
        return self._idx[v]


def _strip_heavy(full: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in full.items() if k != "panels" and k not in MESH_KEYS}


def slim_analysis(full: Dict[str, Any]) -> Dict[str, Any]:
    """Hasil hitung penuh -> versi ramping untuk frontend."""
    out = _strip_heavy(full)
    tables = {k: _Interner() for k in INTERNED_FIELDS}
    panels: List[Dict[str, Any]] = []
    for p in full.get("panels") or []:
        if not p.get("active"):
            panels.append({"id": p.get("id"), "active": False, "vertices": p.get("vertices")})
            continue
        q = {k: p[k] for k in ACTIVE_PANEL_FIELDS if k in p}
        for k in INTERNED_FIELDS:
            if k in q:
                q[k] = tables[k](q[k])
        panels.append(q)
    out["panels"] = panels
    out["panel_tables"] = {k: t.values for k, t in tables.items()}
    for k in MESH_KEYS:
        if k in full:
            out[k] = [encode_mesh(e) for e in (full.get(k) or [])]
    out["payload_format"] = PAYLOAD_FORMAT
    return out


def slim_rematerial(full: Dict[str, Any]) -> Dict[str, Any]:
    """Hasil ganti material -> hanya ringkasan + kolom angka panel aktif; geometri dipakai dari hasil sebelumnya."""
    out = _strip_heavy(full)
    act = [p for p in (full.get("panels") or []) if p.get("active")]
    mat = _Interner()
    fields: Dict[str, List[Any]] = {}
    for f in REMATERIAL_FIELDS:
        col = [p.get(f) for p in act]
        if f == "material_id":
            col = [mat(v) for v in col]
        fields[f] = col
    out["panel_updates"] = {"ids": [p.get("id") for p in act], "fields": fields, "tables": {"material_id": mat.values}}
    out["geometry_from"] = "previous"
    out["payload_format"] = PAYLOAD_FORMAT
    return out
