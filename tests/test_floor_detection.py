"""
Tests for R4 tiered floor detection mechanism (`build_dynamic_floor_levels`).
Covers:
- Synthetic cases: 01_kotak_m (4 floors @ 4.0 m), 05_denah_l (4 floors),
  06_courtyard (4 floors), 07_silinder (4 floors), 19_tanpa_nama (4 or tidak_terdeteksi, never 5)
- Real model: corpus/real/Facade only to Alfian.3dm (matches glazing band count = 15)
- IFC Duplex: uses IfcBuildingStorey (`ifc_storey`)
- Certain sources priority: custom_floor_zones, IfcBuildingStorey, layer/group names, expected_floors
- Uncertain fallback: monolithic box without floor bands -> `tidak_terdeteksi` (1 zone, never guesses 3.6 m)
- ProjectConfig.settings.floor_height_m defaults to None (no silent 3.6 m)
"""

from __future__ import annotations

import glob
import os
import sys

import numpy as np
import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from adapters import build_staging_inspection_payload
from config_schema import ProjectConfig
from universal_pipeline import (
    RawGroupMesh,
    build_dynamic_floor_levels,
    load_universal_model_stages_1_and_2,
)


def _detect_from_file(rel_path: str):
    abs_path = os.path.join(ROOT_DIR, rel_path)
    assert os.path.isfile(abs_path), f"Test model not found: {abs_path}"
    raw_groups, audit = load_universal_model_stages_1_and_2(abs_path)
    all_v = np.vstack([g.vertices for g in raw_groups])
    z_min = float(np.min(all_v[:, 2]))
    z_max = float(np.max(all_v[:, 2]))
    floors, method = build_dynamic_floor_levels(
        z_min_bldg=z_min,
        z_max_bldg=z_max,
        floor_mode="auto",
        floor_height_m=None,
        bim_storeys=audit.bim_storeys,
        raw_groups=raw_groups,
    )
    return floors, method, raw_groups, audit


def test_project_config_floor_height_has_no_silent_default():
    cfg = ProjectConfig()
    assert cfg.settings.floor_height_m is None
    assert cfg.model.expected_floors is None


@pytest.mark.parametrize(
    "rel_path,expected_method",
    [
        ("fixtures/synthetic/01_kotak_m/model.3dm", "geometri_pita"),
        ("fixtures/synthetic/01_kotak_m/model.obj", "geometri_pita"),
        ("fixtures/synthetic/01_kotak_m/model.ifc", "ifc_storey"),
    ],
)
def test_01_kotak_m_is_4_floors_at_4m(rel_path, expected_method):
    floors, method, _, _ = _detect_from_file(rel_path)
    assert method == expected_method
    assert len(floors) == 4
    avg_h = sum(float(f["height_m"]) for f in floors) / len(floors)
    assert abs(avg_h - 4.0) <= 0.15


@pytest.mark.parametrize(
    "rel_path",
    [
        "fixtures/synthetic/05_denah_l/model.3dm",
        "fixtures/synthetic/05_denah_l/model.obj",
        "fixtures/synthetic/06_courtyard/model.3dm",
        "fixtures/synthetic/06_courtyard/model.obj",
        "fixtures/synthetic/07_silinder/model.3dm",
        "fixtures/synthetic/07_silinder/model.obj",
    ],
)
def test_05_06_07_synthetic_cases_are_4_floors(rel_path):
    floors, method, _, _ = _detect_from_file(rel_path)
    assert method == "geometri_pita"
    assert len(floors) == 4
    avg_h = sum(float(f["height_m"]) for f in floors) / len(floors)
    assert abs(avg_h - 4.0) <= 0.15


@pytest.mark.parametrize(
    "rel_path",
    [
        "fixtures/synthetic/19_tanpa_nama/model.3dm",
        "fixtures/synthetic/19_tanpa_nama/model.obj",
    ],
)
def test_19_tanpa_nama_is_4_floors_or_undetected_never_5(rel_path):
    floors, method, _, _ = _detect_from_file(rel_path)
    assert len(floors) != 5, "19_tanpa_nama must NEVER silently guess 5 floors (16 / 3.6)"
    assert (len(floors) == 4 and method == "geometri_pita") or (
        len(floors) == 1 and method == "tidak_terdeteksi"
    )


def test_facade_only_to_alfian_matches_glazing_bands():
    rel_path = "corpus/real/Facade only to Alfian.3dm"
    abs_path = os.path.join(ROOT_DIR, rel_path)
    if not os.path.isfile(abs_path):
        pytest.skip("corpus/real/Facade only to Alfian.3dm not present")

    floors, method, raw_groups, _ = _detect_from_file(rel_path)
    # Count distinct glazing bands from Glass - Blue group
    blue_groups = [g for g in raw_groups if "glass - blue" in g.group_name.lower()]
    assert len(blue_groups) >= 1
    fz = blue_groups[0].vertices[blue_groups[0].faces, 2]
    band_count = len(np.unique(np.round(fz.min(axis=1), 1)))
    assert band_count == 15
    assert method == "geometri_pita"
    assert len(floors) == band_count


def test_ifc_duplex_uses_ifc_storeys():
    matches = glob.glob(os.path.join(ROOT_DIR, "corpus", "**", "*Duplex*.ifc"), recursive=True)
    if not matches:
        pytest.skip("Duplex IFC corpus file not present")
    rel_path = os.path.relpath(matches[0], ROOT_DIR)
    floors, method, _, audit = _detect_from_file(rel_path)
    assert len(audit.bim_storeys) >= 2
    assert method == "ifc_storey"
    assert len(floors) >= 2


def test_monolithic_box_without_bands_returns_tidak_terdeteksi():
    # Single 16 m tall box with only z=0 and z=16 horizontal edges (no floor seams or window bands)
    verts = np.array(
        [
            [0.0, 0.0, 0.0],
            [20.0, 0.0, 0.0],
            [20.0, 20.0, 0.0],
            [0.0, 20.0, 0.0],
            [0.0, 0.0, 16.0],
            [20.0, 0.0, 16.0],
            [20.0, 20.0, 16.0],
            [0.0, 20.0, 16.0],
        ],
        dtype=np.float64,
    )
    faces = np.array(
        [
            [0, 1, 5, 4],
            [1, 2, 6, 5],
            [2, 3, 7, 6],
            [3, 0, 4, 7],
        ],
        dtype=np.int64,
    )
    rg = RawGroupMesh(
        group_id="g_polos",
        group_name="Dinding_Polos",
        source_layer="Dinding_Polos",
        source_material="",
        default_category="wall",
        vertices=verts,
        faces=faces,
    )
    floors, method = build_dynamic_floor_levels(
        z_min_bldg=0.0,
        z_max_bldg=16.0,
        floor_mode="auto",
        floor_height_m=None,
        bim_storeys=[],
        raw_groups=[rg],
    )
    assert method == "tidak_terdeteksi"
    assert len(floors) == 1
    assert floors[0]["height_m"] == 16.0


def test_layer_names_and_user_input_sources():
    # Layer names with explicit floor markers (L1, L2, L3)
    groups = []
    for i, z0 in enumerate([0.0, 4.5, 8.0], start=1):
        z1 = [4.5, 8.0, 11.5][i - 1]
        v = np.array(
            [[0, 0, z0], [10, 0, z0], [10, 0, z1], [0, 0, z1]],
            dtype=np.float64,
        )
        f = np.array([[0, 1, 2, 3]], dtype=np.int64)
        groups.append(
            RawGroupMesh(
                group_id=f"g_lt_{i}",
                group_name=f"Dinding_Lantai_{i}",
                source_layer=f"Dinding_Lantai_{i}",
                source_material="",
                default_category="wall",
                vertices=v,
                faces=f,
            )
        )

    floors, method = build_dynamic_floor_levels(
        z_min_bldg=0.0,
        z_max_bldg=11.5,
        raw_groups=groups,
    )
    assert method == "nama_layer"
    assert len(floors) == 3

    # User expected_floors input on monolithic box
    floors_u, method_u = build_dynamic_floor_levels(
        z_min_bldg=0.0,
        z_max_bldg=16.0,
        expected_floors=4,
    )
    assert method_u == "isian_pengguna"
    assert len(floors_u) == 4
    assert floors_u[0]["height_m"] == 4.0


def test_inspect_payload_reports_floor_source_label():
    kotak_path = os.path.join(ROOT_DIR, "fixtures/synthetic/01_kotak_m/model.3dm")
    insp = build_staging_inspection_payload(
        filepath=kotak_path,
        display_filename="model.3dm",
        model_id="contoh_kotak_m",
        config=ProjectConfig(),
    )
    assert insp["estimated_floors"] == 4
    assert abs(float(insp["estimated_floor_height_m"]) - 4.0) <= 0.1
    assert insp["floor_detection_method"] == "geometri_pita"
    assert "4 lantai @ 4,0 m" in insp["floor_source_label"]
    assert "dari pita kaca berulang" in insp["floor_source_label"]
