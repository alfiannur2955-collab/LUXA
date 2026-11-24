import os
import sys
import tempfile

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FIXTURES_DIR = os.path.join(ROOT_DIR, "fixtures")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from ottv_engine import EnvelopeParameters, analyze_building_ottv


def test_clean_honeybee_model_is_not_provisional():
    path = os.path.join(FIXTURES_DIR, "Honeybee_MultiZone_Office_3F.hbjson")
    res = analyze_building_ottv(path, "Honeybee_MultiZone_Office_3F.hbjson", EnvelopeParameters(materials_confirmed=True))
    summary = res["summary"]
    assert summary["is_provisional"] is False
    # Hanya catatan informatif lebar kusen asumsi yang boleh muncul (model tanpa grup rangka)
    codes = {w["code"] for w in summary["warnings"]}
    assert codes <= {"ASSUMED_FRAME_WIDTH"}


def test_unknown_group_sets_provisional_warning_and_stays_excluded():
    path = os.path.join(FIXTURES_DIR, "fasad_unitized_24lantai.3dm")
    res = analyze_building_ottv(path, "fasad_unitized_24lantai.3dm", EnvelopeParameters())
    summary = res["summary"]
    assert summary["is_provisional"] is True
    assert res["status_label"] == "HASIL SEMENTARA — perlu konfirmasi"
    assert res["compliant"] is False
    codes = {w["code"]: w for w in summary["warnings"]}
    assert "UNKNOWN_GROUPS" in codes
    w = codes["UNKNOWN_GROUPS"]
    assert "09_SkyGarden_Planter_Greenery" in w["message"]
    # Unknown group must NOT be counted in OTTV surface area
    unk_entries = [g for g in res["groups"] if g["category"] == "unknown"]
    assert len(unk_entries) == 1
    assert unk_entries[0]["outer_area_m2"] == 0.0


def test_missing_mesh_sets_provisional_warning():
    path = os.path.join(FIXTURES_DIR, "tes objek archicad.3dm")
    res = analyze_building_ottv(path, "tes objek archicad.3dm", EnvelopeParameters())
    summary = res["summary"]
    assert summary["is_provisional"] is True
    assert res["status_label"] == "HASIL SEMENTARA — perlu konfirmasi"
    assert res["compliant"] is False
    codes = {w["code"]: w for w in summary["warnings"]}
    assert "MISSING_MESH" in codes
    w = codes["MISSING_MESH"]
    assert w["detail"]["total_face_count"] == 19786
    assert "19552" in w["message"]


def test_unit_guessed_obj_sets_provisional_warning():
    # Simple 10x10x4m box OBJ (no unit header -> unit guessed from bbox -> unit_needs_confirmation=True)
    obj_text = (
        "o Exterior_Wall\n"
        "v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\n"
        "v 0 0 4\nv 10 0 4\nv 10 10 4\nv 0 10 4\n"
        "f 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n"
    )
    fd, tmp_path = tempfile.mkstemp(suffix=".obj")
    try:
        os.write(fd, obj_text.encode("utf-8"))
        os.close(fd)
        res = analyze_building_ottv(tmp_path, "box_unit_test.obj", EnvelopeParameters())
        summary = res["summary"]
        assert summary["is_provisional"] is True
        codes = {w["code"]: w for w in summary["warnings"]}
        assert "UNIT_NEEDS_CONFIRMATION" in codes
        assert codes["UNIT_NEEDS_CONFIRMATION"]["detail"]["applied_unit"] == "m"
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
