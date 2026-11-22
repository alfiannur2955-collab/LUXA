"""Utilitas Rhino .3dm: konversi mesh rhino3dm/ladybug ke numpy dan transformasi blok."""

from __future__ import annotations

from typing import Optional, Tuple

import numpy as np
import rhino3dm
from ladybug_geometry.geometry3d.mesh import Mesh3D

def _rhino_mesh_to_numpy(rh_mesh: rhino3dm.Mesh) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    n_v = len(rh_mesh.Vertices)
    n_f = len(rh_mesh.Faces)
    if n_v < 3 or n_f < 1:
        return None
    verts = np.empty((n_v, 3), dtype=np.float64)
    for i in range(n_v):
        v = rh_mesh.Vertices[i]
        verts[i, 0] = v.X
        verts[i, 1] = v.Y
        verts[i, 2] = v.Z

    faces = np.empty((n_f, 4), dtype=np.int64)
    for i in range(n_f):
        f = rh_mesh.Faces[i]
        faces[i, 0] = f[0]
        faces[i, 1] = f[1]
        faces[i, 2] = f[2]
        faces[i, 3] = f[3] if len(f) >= 4 else f[2]
    return verts, faces


def _ladybug_mesh_to_numpy(lb_mesh: Mesh3D) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    verts_lb = lb_mesh.vertices
    faces_lb = lb_mesh.faces
    if len(verts_lb) < 3 or len(faces_lb) < 1:
        return None
    verts = np.array([[p.x, p.y, p.z] for p in verts_lb], dtype=np.float64)
    faces = np.array(
        [[f[0], f[1], f[2], f[3] if len(f) >= 4 else f[2]] for f in faces_lb],
        dtype=np.int64,
    )
    return verts, faces


def _xform_to_matrix(xf: rhino3dm.Transform) -> np.ndarray:
    """Extracts a 4x4 NumPy transformation matrix from a rhino3dm.Transform."""
    mat = np.eye(4, dtype=np.float64)
    try:
        for r in range(4):
            for c in range(4):
                mat[r, c] = float(getattr(xf, f"M{r}{c}"))
    except Exception:
        pass
    return mat


def _apply_xform(verts: np.ndarray, mat4: np.ndarray) -> np.ndarray:
    if np.allclose(mat4, np.eye(4)):
        return verts
    ones = np.ones((len(verts), 1), dtype=np.float64)
    vh = np.hstack([verts, ones])
    vt = vh @ mat4.T
    return vt[:, :3]
