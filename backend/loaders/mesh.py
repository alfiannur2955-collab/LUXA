"""Pembaca Wavefront .OBJ + .MTL (transparansi, o/g/usemtl)."""

from __future__ import annotations

import os
from typing import Dict, List, Optional, Tuple

import numpy as np

# ============================================================================
# WAVEFRONT .OBJ + .MTL PARSER WITH TRANSPARENCY & LAYER::USEMTL DECOMPOSITION
# ============================================================================

def _parse_mtl_transparencies(mtl_path: str) -> Dict[str, float]:
    """Reads `newmtl` opacity (`d` or `Tr`) from a companion .mtl file (returns transparency 0..1)."""
    trans: Dict[str, float] = {}
    if not os.path.isfile(mtl_path):
        return trans
    cur_m = ""
    try:
        with open(mtl_path, "r", encoding="utf-8", errors="ignore") as f:
            for raw in f:
                line = raw.strip()
                if line.startswith("newmtl "):
                    cur_m = line[7:].strip()
                elif cur_m and line.startswith("d "):
                    try:
                        d_val = float(line.split()[1])
                        trans[cur_m] = max(0.0, min(1.0, 1.0 - d_val))
                    except ValueError:
                        pass
                elif cur_m and line.startswith("Tr "):
                    try:
                        tr_val = float(line.split()[1])
                        trans[cur_m] = max(0.0, min(1.0, tr_val))
                    except ValueError:
                        pass
    except Exception:
        pass
    return trans


def _parse_obj_with_materials(filepath: str) -> Tuple[Dict[Tuple[str, str], Tuple[np.ndarray, np.ndarray]], Dict[str, float], bool]:
    """
    Fast Wavefront .obj parser that preserves `o` (object), `g` (group), `usemtl` (material),
    companion `.mtl` transparency values, and detects Y-Up authoring signatures (Archicad,
    Blender, SketchUp, Maya, Revit).
    """
    verts_list: List[Tuple[float, float, float]] = []
    v_append = verts_list.append
    cur_obj = "Default_Object"
    cur_grp = ""
    cur_mtl = "Default_Material"
    face_buckets: Dict[Tuple[str, str], List[Tuple[int, int, int, int]]] = {}
    cur_bucket: Optional[List[Tuple[int, int, int, int]]] = None
    cur_bucket_key: Optional[Tuple[str, str]] = None
    mtl_transparencies: Dict[str, float] = {}
    base_dir = os.path.dirname(filepath)
    y_up_hint = False
    n_v = 0

    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            if not raw_line:
                continue
            c0 = raw_line[0]
            if c0 == "v":
                if len(raw_line) > 2 and raw_line[1] == " ":
                    parts = raw_line.split()
                    if len(parts) >= 4:
                        try:
                            v_append((float(parts[1]), float(parts[2]), float(parts[3])))
                            n_v += 1
                        except ValueError:
                            pass
                continue
            if c0 == "f" and len(raw_line) > 2 and raw_line[1] == " ":
                parts = raw_line[2:].split()
                plen = len(parts)
                if plen < 3:
                    continue
                has_slash = "/" in raw_line
                idxs: List[int] = []
                for p in parts:
                    v_str = p.split("/", 1)[0] if has_slash else p
                    try:
                        vi = int(v_str)
                        idxs.append((vi - 1) if vi > 0 else (n_v + vi))
                    except ValueError:
                        pass
                ilen = len(idxs)
                if ilen < 3:
                    continue
                layer_key = cur_grp if cur_grp else cur_obj
                bkey = (layer_key, cur_mtl)
                if bkey != cur_bucket_key:
                    cur_bucket_key = bkey
                    cur_bucket = face_buckets.get(bkey)
                    if cur_bucket is None:
                        cur_bucket = []
                        face_buckets[bkey] = cur_bucket
                if ilen == 3:
                    cur_bucket.append((idxs[0], idxs[1], idxs[2], idxs[2]))
                elif ilen == 4:
                    cur_bucket.append((idxs[0], idxs[1], idxs[2], idxs[3]))
                else:
                    i0 = idxs[0]
                    for k in range(1, ilen - 1):
                        cur_bucket.append((i0, idxs[k], idxs[k + 1], idxs[k + 1]))
                continue

            line = raw_line.strip()
            if not line:
                continue
            if c0 == "#":
                lo = line.lower()
                if any(k in lo for k in ("archicad", "blender", "sketchup", "maya", "cinema 4d", "3ds max", "revit", "y-up")):
                    y_up_hint = True
            elif line.startswith("trace_obj ") or line.startswith("shadow_obj "):
                # Standard Wavefront ArchiCAD OBJ export header (always Y-Up)
                y_up_hint = True
            elif line.startswith("mtllib "):
                mtl_file = line[7:].strip()
                mtl_transparencies.update(_parse_mtl_transparencies(os.path.join(base_dir, mtl_file)))
            elif line.startswith("o "):
                cur_obj = line[2:].strip() or "Object"
            elif line.startswith("g "):
                cur_grp = line[2:].strip()
            elif line.startswith("usemtl "):
                cur_mtl = line[7:].strip() or "Default_Material"

    if not verts_list or not face_buckets:
        return {}, mtl_transparencies, y_up_hint

    all_v = np.array(verts_list, dtype=np.float64)
    out: Dict[Tuple[str, str], Tuple[np.ndarray, np.ndarray]] = {}
    for key, f_list in face_buckets.items():
        if not f_list:
            continue
        f_arr = np.array(f_list, dtype=np.int64)
        uniq_v, inv = np.unique(f_arr, return_inverse=True)
        valid_uniq = np.clip(uniq_v, 0, len(all_v) - 1)
        sub_v = all_v[valid_uniq]
        sub_f = inv.reshape(f_arr.shape)
        out[key] = (sub_v, sub_f)

    return out, mtl_transparencies, y_up_hint
