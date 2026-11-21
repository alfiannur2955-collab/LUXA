import os
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from universal_pipeline import (
    classify_layer_or_material_role,
    classify_layer_or_material_with_confidence,
)


def test_dinding_lantai2_is_wall():
    assert classify_layer_or_material_role("Dinding_Lantai2") == "wall"


def test_score_panel_is_not_roof():
    role = classify_layer_or_material_role("score_panel")
    assert role != "roof"
    assert role == "unknown"


def test_background_is_not_roof():
    role = classify_layer_or_material_role("background")
    assert role != "roof"
    assert role == "unknown"


def test_lands_acer_palmatum_is_unknown():
    role, conf, _ = classify_layer_or_material_with_confidence("LANDS Acer palmatum")
    assert role == "unknown"
    assert conf == 0.0


def test_glass_clear_fast_is_glazing():
    assert classify_layer_or_material_role("Glass - Clear Fast") == "glazing"


def test_insulation_fiberglass_in_curtain_wall_is_spandrel():
    assert classify_layer_or_material_role("Insulation - Fiberglass", context="IfcCurtainWall") == "spandrel"
    assert classify_layer_or_material_role("IFC_CurtainWall (CW-001) :: Insulation - Fiberglass") == "spandrel"


def test_insulated_brick_wall_stays_wall():
    assert classify_layer_or_material_role("Dinding_Bata_Insulation") == "wall"


def test_interior_and_site_are_ignore_not_roof():
    assert classify_layer_or_material_role("Interior :: Partition_Wall") == "ignore"
    assert classify_layer_or_material_role("IfcSite :: Terrain") == "ignore"
    assert classify_layer_or_material_role("Tapak_Tanah") == "ignore"
    assert classify_layer_or_material_role("Core_Lift") == "ignore"


def test_shading_and_frame_token_precision():
    assert classify_layer_or_material_role("Sun_Louver_Fin") == "shading"
    # 'fin' inside 'Finish' must NOT trigger shading!
    assert classify_layer_or_material_role("Finish - Wall :: Metal - Aluminium") == "frame"
    assert classify_layer_or_material_role("CW_Mullion_Transom") == "frame"
