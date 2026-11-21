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


def test_railing_balustrade_pagar_are_ignore():
    assert classify_layer_or_material_role("Railing") == "ignore"
    assert classify_layer_or_material_role("Railing Kaca") == "ignore"
    assert classify_layer_or_material_role("Glass Railing") == "ignore"
    assert classify_layer_or_material_role("Balustrade_Glass_Balkon") == "ignore"
    assert classify_layer_or_material_role("Pagar_Besi") == "ignore"


def test_floor_slab_pelat_lantai_are_ignore_not_roof():
    for label in ("pelat lantai", "Pelat_Lantai_2", "plat lantai", "Plat_Lantai_Tipikal", "floor slab", "Floor_Slab_L3"):
        role = classify_layer_or_material_role(label)
        assert role == "ignore", f"{label} expected ignore, got {role}"
        assert role != "roof"
    # Roof slab still stays roof
    assert classify_layer_or_material_role("Roof_Podium_Slab") == "roof"


def test_wall_followed_by_dalam_or_interior_is_ignore():
    assert classify_layer_or_material_role("Dinding Dalam") == "ignore"
    assert classify_layer_or_material_role("Dinding_Bata_Dalam") == "ignore"
    assert classify_layer_or_material_role("Wall Interior") == "ignore"
    assert classify_layer_or_material_role("Wall_Dalam_L2") == "ignore"
    assert classify_layer_or_material_role("Dinding Interior") == "ignore"
    # Interior glass partitions ('kaca dalam' / 'partisi kaca') -> ignore
    assert classify_layer_or_material_role("kaca dalam") == "ignore"
    assert classify_layer_or_material_role("Kaca_Dalam_L2") == "ignore"
    assert classify_layer_or_material_role("partisi kaca") == "ignore"
    assert classify_layer_or_material_role("Partisi_Kaca_Kantor") == "ignore"
    # 'Dinding_Lantai2' still stays wall
    assert classify_layer_or_material_role("Dinding_Lantai2") == "wall"


def test_grc_and_parapet_are_wall():
    assert classify_layer_or_material_role("GRC") == "wall"
    assert classify_layer_or_material_role("Panel_GRC_Fasad") == "wall"
    assert classify_layer_or_material_role("Parapet") == "wall"
    assert classify_layer_or_material_role("Dinding_Parapet") == "wall"


def test_structural_columns_and_beams_are_ignore():
    for label in ("Kolom_Beton", "Column_Structural", "Balok_Induk", "Steel_Beam", "IfcColumn", "IfcBeam"):
        assert classify_layer_or_material_role(label) == "ignore", f"{label} should be ignore"
