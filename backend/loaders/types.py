"""Tipe data bersama pipeline: RawGroupMesh, Stage1GeometryAudit, skala satuan."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

UNIT_SCALE_TO_METERS: Dict[str, float] = {
    "m": 1.0,
    "cm": 0.01,
    "mm": 0.001,
    "ft": 0.3048,
    "in": 0.0254,
}


@dataclass
class RawGroupMesh:
    """Stores a named group's vertices and quad/tri faces in fast NumPy arrays."""
    group_id: str
    group_name: str
    source_layer: str
    source_material: str
    default_category: str  # 'glazing' | 'wall' | 'spandrel' | 'composite_cw' | 'frame' | 'shading' | 'roof'
    vertices: np.ndarray   # shape (V, 3) float64 in meters, Z-Up
    faces: np.ndarray      # shape (F, 4) int64 (for triangles, col 3 == col 2)
    is_auto_split_child: bool = False
    is_external_bim: Optional[bool] = None
    thermal_u_bim: Optional[float] = None
    # A3-06: diisi bila peran diubah oleh cek geometri di tahap klasifikasi (mis. "kaca" berbentuk batang -> rangka)
    geometry_reclassified_from: Optional[str] = None
    linear_area_fraction: Optional[float] = None


@dataclass
class Stage1GeometryAudit:
    """Metadata produced by Gate 1 (Geometry, Unit & Axis Normalization)."""
    detected_unit: Optional[str] = None
    applied_unit: str = "m"
    scale_factor_to_m: float = 1.0
    unit_source: str = "header"  # 'header' | 'user' | 'bbox_guess'
    unit_needs_confirmation: bool = False
    detected_up_axis: str = "Z"
    applied_up_axis: str = "Z"
    raw_span_xyz: List[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    normalized_span_m: List[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    z_ground_offset_m: float = 0.0
    xy_world_offset_m: List[float] = field(default_factory=lambda: [0.0, 0.0])
    bim_storeys: List[Dict[str, Any]] = field(default_factory=list)
    total_raw_objects: int = 0
    total_raw_faces: int = 0
    geometry_kernel: str = "Standard"
    slivers_removed: int = 0
    interior_elements_filtered: int = 0
    hidden_objects_skipped: int = 0
    missing_mesh: List[Dict[str, Any]] = field(default_factory=list)
    filtered_items: List[Dict[str, Any]] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
