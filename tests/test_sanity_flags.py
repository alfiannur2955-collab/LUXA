"""Tests for Fase 4a `build_sanity_flags` and inspect/analyze integration."""

from __future__ import annotations

import os
import sys

from fastapi.testclient import TestClient

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from adapters import build_sanity_flags  # noqa: E402
from main import app  # noqa: E402


def _base_groups():
    return [
        {
            "group_id": "G1",
            "group_name": "Glass_Vision",
            "source_layer": "Glass",
            "source_material": "Clear Glass",
            "category": "glazing",
            "enabled": True,
            "face_count": 40,
            "outer_area_m2": 400.0,
        },
        {
            "group_id": "G2",
            "group_name": "Wall_Concrete",
            "source_layer": "Wall",
            "source_material": "Concrete",
            "category": "wall",
            "enabled": True,
            "face_count": 40,
            "outer_area_m2": 600.0,
        },
        {
            "group_id": "G3",
            "group_name": "Roof_Slab",
            "source_layer": "Roof",
            "source_material": "Concrete",
            "category": "roof",
            "enabled": True,
            "face_count": 4,
            "outer_area_m2": 0.0,
        },
    ]


def _base_audit(**overrides):
    data = {
        "applied_unit": "m",
        "unit_source": "file_header",
        "unit_needs_confirmation": False,
        "z_ground_offset_m": 0.0,
        "normalized_span_m": [20.0, 30.0, 14.4],
        "missing_mesh": [],
        "filtered_items": [],
    }
    data.update(overrides)
    return data


def _base_preview(**overrides):
    data = {
        "bounding_box": {"span": [20.0, 30.0, 14.4]},
        "estimated_floors": 4,
        "orientation_areas": {
            "U": {"glazing_m2": 100.0, "opaque_m2": 150.0, "total_m2": 250.0, "wwr": 0.4},
            "S": {"glazing_m2": 100.0, "opaque_m2": 150.0, "total_m2": 250.0, "wwr": 0.4},
        },
        "filtered_items": [],
    }
    data.update(overrides)
    return data


def test_clean_model_has_no_warn_flags():
    flags = build_sanity_flags(_base_groups(), _base_audit(), _base_preview())
    warns = [f for f in flags if f["severity"] in ("warn", "error")]
    assert warns == []


def test_facade_area_ratio_below_and_above_bounds():
    # Perimeter = 2*(20+30) = 100m, height = 14.4m -> ref = 1440 m2
    low_groups = _base_groups()
    low_groups[0]["outer_area_m2"] = 200.0
    low_groups[1]["outer_area_m2"] = 300.0  # ratio = 500/1440 = 0.347 < 0.5
    flags_low = build_sanity_flags(low_groups, _base_audit(), _base_preview())
    codes_low = {f["code"] for f in flags_low}
    assert "FACADE_AREA_RATIO" in codes_low

    high_groups = _base_groups()
    high_groups[0]["outer_area_m2"] = 1200.0
    high_groups[1]["outer_area_m2"] = 1200.0  # ratio = 2400/1440 = 1.667 > 1.4
    flags_high = build_sanity_flags(high_groups, _base_audit(), _base_preview())
    codes_high = {f["code"] for f in flags_high}
    assert "FACADE_AREA_RATIO" in codes_high


def test_z0_below_minus_half_meter_requires_confirmation():
    flags = build_sanity_flags(_base_groups(), _base_audit(z_ground_offset_m=-3.58), _base_preview())
    z_flags = [f for f in flags if f["code"] == "Z0_BELOW_ZERO"]
    assert len(z_flags) == 1
    assert z_flags[0]["requires_confirmation"] is True

    # Cleared once user answers ground_confirmed=True
    flags_done = build_sanity_flags(
        _base_groups(),
        _base_audit(z_ground_offset_m=-3.58),
        _base_preview(),
        user_answers={"ground_confirmed": True},
    )
    assert all(f["code"] != "Z0_BELOW_ZERO" for f in flags_done)


def test_no_glazing_flag_and_confirmation():
    wall_only = [g for g in _base_groups() if g["category"] != "glazing"]
    flags = build_sanity_flags(wall_only, _base_audit(), _base_preview())
    ng = [f for f in flags if f["code"] == "NO_GLAZING"]
    assert len(ng) == 1
    assert ng[0]["requires_confirmation"] is True

    flags_zero = build_sanity_flags(
        wall_only, _base_audit(), _base_preview(), user_answers={"no_glazing_choice": "zero_wwr"}
    )
    assert all(f["code"] != "NO_GLAZING" for f in flags_zero)


def test_glazing_with_opaque_material_flagged():
    groups = _base_groups()
    groups[0]["group_name"] = "Panel_Oranye"
    groups[0]["source_material"] = "Paint - Cadmium Orange"
    flags = build_sanity_flags(groups, _base_audit(), _base_preview())
    opaque_flags = [f for f in flags if f["code"] == "GLAZING_OPAQUE_MATERIAL"]
    assert len(opaque_flags) == 1
    assert opaque_flags[0]["group_name"] == "Panel_Oranye"


def test_high_side_wwr_and_dimensions_and_missing_mesh_and_unknown():
    groups = _base_groups()
    groups.append({
        "group_id": "G4",
        "group_name": "Layer 0",
        "source_layer": "Layer 0",
        "source_material": "",
        "category": "unknown",
        "enabled": True,
        "face_count": 10,
        "outer_area_m2": 20.0,
    })
    audit = _base_audit(
        unit_source="bbox_guess",
        unit_needs_confirmation=True,
        normalized_span_m=[1.2, 1.0, 1.5],
        missing_mesh=[{"layer": "Metal - Aluminium", "count": 5280}],
    )
    preview = _base_preview(
        bounding_box={"span": [1.2, 1.0, 1.5]},
        orientation_areas={
            "B": {"glazing_m2": 98.0, "opaque_m2": 2.0, "total_m2": 100.0, "wwr": 0.98},
        },
        filtered_items=[{"name": "Interior", "area_m2": 85.0, "reason": "interior"}],
    )
    flags = build_sanity_flags(groups, audit, preview, user_answers={"expected_floors": 12})
    codes = {f["code"] for f in flags}
    assert "DIMENSION_OUT_OF_RANGE" in codes
    assert "UNIT_NEEDS_CONFIRMATION" in codes
    assert "MISSING_MESH" in codes
    assert "UNKNOWN_GROUPS" in codes
    assert "HIGH_SIDE_WWR" in codes
    assert "FILTERED_ITEMS_LARGE" in codes
    assert "FLOOR_COUNT_MISMATCH" in codes


def test_api_inspect_returns_sanity_flags_and_analyze_accepts_flags():
    client = TestClient(app)

    r_ins = client.post("/api/models/contoh_kotak_m/inspect", json={})
    assert r_ins.status_code == 200
    body = r_ins.json()
    assert "sanity_flags" in body
    assert isinstance(body["sanity_flags"], list)
    assert body["estimated_floors"] >= 4

    # Analyze with accepted_flags -> provisional + warnings included
    r_ana = client.post(
        "/api/models/contoh_kotak_m/analyze",
        json={"version": 2, "model": {"accepted_flags": ["missing_mesh"]}},
    )
    assert r_ana.status_code == 200
    ana = r_ana.json()
    assert ana["summary"]["is_provisional"] is True
    assert "HASIL SEMENTARA" in ana["status_label"]
    assert any("missing_mesh" in w for w in ana["summary"]["warnings"])
