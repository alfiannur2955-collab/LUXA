import io
import json
import os
import sys

import openpyxl
import pytest
from fastapi.testclient import TestClient

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FIXTURES_DIR = os.path.join(ROOT_DIR, "fixtures")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import main as api_main
from config_schema import (
    ModelConfig,
    ProjectConfig,
    RolesConfig,
    SettingsConfig,
    migrate_v1,
    resolve_material,
)
from ottv_engine import EnvelopeParameters


def _snapshot_tree(root_dir: str):
    """Returns a deterministic set of (relpath, size, mtime_ns) for all files & dirs."""
    snap = set()
    if not os.path.exists(root_dir):
        return snap
    for dirpath, dirnames, filenames in os.walk(root_dir):
        rel_d = os.path.relpath(dirpath, root_dir)
        snap.add(("D", rel_d, 0, 0))
        for fn in filenames:
            fp = os.path.join(dirpath, fn)
            st = os.stat(fp)
            snap.add(("F", os.path.relpath(fp, root_dir), st.st_size, st.st_mtime_ns))
    return snap


@pytest.fixture()
def isolated_client(tmp_path, monkeypatch):
    uploads_dir = str(tmp_path / "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    monkeypatch.setattr(api_main, "UPLOADS_DIR", uploads_dir)
    api_main.ANALYSIS_STORE.clear()
    with TestClient(api_main.app) as client:
        yield client, uploads_dir


def test_project_config_v2_and_migrate_v1():
    cfg = ProjectConfig()
    assert cfg.version == 2
    assert cfg.model.unit_mode == "auto"
    assert cfg.settings.mode == "sni"
    # Removed scalar thermal overrides must NOT exist on SettingsConfig
    for removed in ("alpha_wall", "u_wall", "td_ek", "u_fenestration", "sc_glass", "u_frame", "delta_t"):
        assert not hasattr(cfg.settings, removed), f"Scalar {removed} should be removed from SettingsConfig"

    legacy_v1 = {
        "model_id": "upload_tower_123456",
        "filename": "tower.3dm",
        "profile": {
            "source_software": "rhino",
            "unit_mode": "mm",
            "up_axis": "Z",
            "z_ground_cutoff_m": 3.5,
            "massing_type": "single_tower",
            "geometry_scope": "facade_only",
            "element_structure": "merged_single_layer",
        },
        "group_category_overrides": {"Layer 01 :: Wall": "spandrel"},
        "disabled_groups": ["Tree_Block"],
        "group_wwr_map": {"CW_Merged": 0.65},
        "frame_width_threshold_m": 0.35,
        "city_preset": "surabaya",
        "custom_epw_info": {"city": "Custom City", "latitude_deg": -7.25},
        "u_wall": 1.85,
        "alpha_wall": 0.55,
        "td_ek": 12.0,
    }
    migrated = migrate_v1(legacy_v1)
    assert isinstance(migrated, ProjectConfig)
    assert migrated.version == 2
    assert migrated.model.file == "tower.3dm"
    assert migrated.model.unit_mode == "mm"
    assert migrated.model.z_ground_cutoff_m == 3.5
    assert migrated.model.exterior_detection_mode == "radial"
    assert migrated.roles.auto_split_merged_cw is True
    assert migrated.roles.group_category_overrides == {"Layer 01 :: Wall": "spandrel"}
    assert migrated.roles.disabled_groups == ["Tree_Block"]
    assert migrated.settings.city_preset == "surabaya"
    assert migrated.settings.custom_epw == {"city": "Custom City", "latitude_deg": -7.25}
    assert migrated.advanced.frame_width_threshold_m == 0.35
    # Legacy custom wall scalars migrated into settings.custom_materials
    assert migrated.settings.wall_material_id == "migrated_wall_custom"
    assert any(cm.id == "migrated_wall_custom" and cm.u_value == 1.85 for cm in migrated.settings.custom_materials)

    # Also test migrating an early v2 config that still had scalar fields
    early_v2 = {
        "version": 2,
        "settings": {"city_preset": "jakarta", "u_fenestration": 2.4, "sc_glass": 0.45, "delta_t": 5.0},
    }
    mig_v2 = migrate_v1(early_v2)
    assert mig_v2.settings.glazing_material_id == "migrated_glazing_custom"
    assert any(cm.id == "migrated_glazing_custom" and cm.sc == 0.45 for cm in mig_v2.settings.custom_materials)

    # Round-trip v2 dict stays v2
    migrated_again = migrate_v1(migrated.model_dump(mode="json"))
    assert migrated_again.model_dump() == migrated.model_dump()


def test_resolve_material_priority_rule():
    from config_schema import CustomMaterialSpec

    cfg = ProjectConfig(
        roles=RolesConfig(
            # Also exercises automatic migration of legacy branded IDs -> generic IDs
            group_material_map={"Glass_Group_A": "glz_asahimas_panasap_grey_8"},
        ),
        settings=SettingsConfig(
            glazing_material_id="glz_kaca_reflektif_8",
            wall_material_id="custom_wall_project",
            custom_materials=[
                CustomMaterialSpec(
                    id="custom_wall_project",
                    name="Dinding Bata Kustom",
                    category="wall",
                    u_value=1.50,
                    alpha=0.50,
                    massa_kg_m2=160.0,
                    sumber="Uji Lab Proyek",
                    status="datasheet",
                )
            ],
            orientation_material_overrides={"B": "glz_saint_gobain_cool_lite_skn154"},
        ),
    )

    # Priority 1: Group override beats orientation override and role default (legacy ID migrated -> glz_kaca_tinted_8)
    r1 = resolve_material("Glass_Group_A", cfg, category="glazing", orientation_code="B")
    assert r1["material_id"] == "glz_kaca_tinted_8"
    assert r1["source"] == "group_override"

    # Priority 2: Orientation override beats role default (legacy ID migrated -> glz_igu_lowe_selektif)
    r2 = resolve_material("Generic_Glazing", cfg, category="glazing", orientation_code="B")
    assert r2["material_id"] == "glz_igu_lowe_selektif"
    assert r2["source"] == "orientation_override"

    # Priority 3: Role default (including per-model custom_materials!) applies directly
    r3 = resolve_material("Generic_Glazing", cfg, category="glazing", orientation_code="U")
    assert r3["material_id"] == "glz_kaca_reflektif_8"
    assert r3["source"] == "role_default"

    r3_custom = resolve_material("Generic_Wall", cfg, category="wall", orientation_code="U")
    assert r3_custom["material_id"] == "custom_wall_project"
    assert r3_custom["material"]["td_ek"] == 12.0
    assert r3_custom["source"] == "role_default"

    # Priority 4: Name-based suggestion when role default is None
    cfg_no_default = ProjectConfig(settings=SettingsConfig(glazing_material_id=None))
    r4 = resolve_material("Kaca_Polos_Clear", cfg_no_default, category="glazing")
    assert r4["material_id"] == "glz_kaca_polos_8"
    assert r4["source"] == "suggested"

    # Priority 5: Built-in catalog default fallback when role default is None & name unmatched
    r5 = resolve_material("Panel_Kaca_Umum", cfg_no_default, category="glazing")
    assert r5["source"] == "fallback"


def test_inspect_is_strictly_readonly_does_not_write_files(isolated_client):
    client, uploads_dir = isolated_client
    hb_path = os.path.join(FIXTURES_DIR, "Honeybee_MultiZone_Office_3F.hbjson")

    with open(hb_path, "rb") as f:
        up_resp = client.post(
            "/api/models",
            files={"file": ("Honeybee_MultiZone_Office_3F.hbjson", f, "application/json")},
        )
    assert up_resp.status_code == 200, up_resp.text
    up_data = up_resp.json()
    model_id = up_data["model_id"]
    assert up_data["file_signature"]["actual_ext"] == ".hbjson"
    assert "export_tips" in up_data

    # Snapshot uploads_dir and samples_dir BEFORE calling inspect
    before_uploads = _snapshot_tree(uploads_dir)
    before_samples = _snapshot_tree(api_main.SAMPLES_DIR)

    inspect_body = {
        "model": {"unit_mode": "m", "up_axis": "Z", "z_ground_cutoff_m": 0.0},
        "roles": {"group_category_overrides": {"HB_Opaque_Walls": "wall"}},
    }
    resp = client.post(f"/api/models/{model_id}/inspect", json=inspect_body)
    assert resp.status_code == 200, resp.text
    insp = resp.json()
    assert insp["status"] == "inspected"
    assert insp["model_id"] == model_id
    assert len(insp["groups"]) == 3

    # Snapshot AFTER calling inspect -> MUST be 100% identical (zero files or dirs created/modified)
    after_uploads = _snapshot_tree(uploads_dir)
    after_samples = _snapshot_tree(api_main.SAMPLES_DIR)
    assert after_uploads == before_uploads
    assert after_samples == before_samples


def test_put_config_saves_v2_and_get_migrates_v1(isolated_client):
    client, uploads_dir = isolated_client
    hb_path = os.path.join(FIXTURES_DIR, "Honeybee_MultiZone_Office_3F.hbjson")
    with open(hb_path, "rb") as f:
        model_id = client.post(
            "/api/models",
            files={"file": ("Honeybee_MultiZone_Office_3F.hbjson", f, "application/json")},
        ).json()["model_id"]

    cfg = ProjectConfig(
        model=ModelConfig(unit_mode="m", z_ground_cutoff_m=0.0),
        settings=SettingsConfig(
            city_preset="bandung",
            custom_epw={"city": "Bandung Custom", "latitude_deg": -6.91, "sf_multiplier": 0.94},
        ),
    )
    put_resp = client.put(f"/api/models/{model_id}/config", json=cfg.model_dump(mode="json"))
    assert put_resp.status_code == 200, put_resp.text
    assert put_resp.json()["config"]["version"] == 2

    get_resp = client.get(f"/api/models/{model_id}/config")
    assert get_resp.status_code == 200
    g_data = get_resp.json()
    assert g_data["saved"] is True
    assert g_data["config"]["version"] == 2
    assert g_data["config"]["settings"]["city_preset"] == "bandung"
    assert g_data["config"]["settings"]["custom_epw"]["city"] == "Bandung Custom"

    # Overwrite with a legacy v1 .ottv.json and confirm GET transparently migrates it to v2
    cfg_file = os.path.join(uploads_dir, ".staging_configs", f"{model_id}.ottv.json")
    with open(cfg_file, "w", encoding="utf-8") as f:
        json.dump({"filename": "Honeybee_MultiZone_Office_3F.hbjson", "profile": {"unit_mode": "m"}, "city_preset": "medan"}, f)

    mig_resp = client.get(f"/api/models/{model_id}/config")
    assert mig_resp.status_code == 200
    assert mig_resp.json()["config"]["version"] == 2
    assert mig_resp.json()["config"]["settings"]["city_preset"] == "medan"


def test_analyze_twice_same_config_produces_identical_ottv(isolated_client):
    client, _ = isolated_client
    hb_path = os.path.join(FIXTURES_DIR, "Honeybee_MultiZone_Office_3F.hbjson")
    with open(hb_path, "rb") as f:
        model_id = client.post(
            "/api/models",
            files={"file": ("Honeybee_MultiZone_Office_3F.hbjson", f, "application/json")},
        ).json()["model_id"]

    cfg = ProjectConfig(
        settings=SettingsConfig(
            city_preset="jakarta",
            north_angle_deg=15.0,
            glazing_material_id="glz_asahimas_stopsol_supersilver_8",
        )
    )
    body = cfg.model_dump(mode="json")

    r1 = client.post(f"/api/models/{model_id}/analyze", json=body)
    r2 = client.post(f"/api/models/{model_id}/analyze", json=body)
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text

    d1, d2 = r1.json(), r2.json()
    assert d1["analysis_id"] != d2["analysis_id"]
    assert d1["ottv_total_wm2"] == d2["ottv_total_wm2"]
    assert d1["summary"]["total_envelope_area_m2"] == d2["summary"]["total_envelope_area_m2"]
    assert d1["summary"]["effective_wwr"] == d2["summary"]["effective_wwr"]
    assert d1["orientation_breakdown"] == d2["orientation_breakdown"]
    assert d1["summary"]["is_provisional"] is False
    assert "MEMENUHI SNI" in d1["status_label"]


def test_provisional_status_label_and_exports_by_analysis_id(isolated_client):
    client, _ = isolated_client
    arch_path = os.path.join(FIXTURES_DIR, "tes objek archicad.3dm")
    with open(arch_path, "rb") as f:
        model_id = client.post(
            "/api/models",
            files={"file": ("tes objek archicad.3dm", f, "application/octet-stream")},
        ).json()["model_id"]

    res = client.post(f"/api/models/{model_id}/analyze", json=ProjectConfig().model_dump(mode="json"))
    assert res.status_code == 200, res.text
    data = res.json()
    aid = data["analysis_id"]

    # Provisional model MUST NOT claim 'MEMENUHI SNI'
    assert data["summary"]["is_provisional"] is True
    assert data["compliant"] is False
    assert data["status_label"] == "HASIL SEMENTARA — perlu konfirmasi"
    assert "MEMENUHI SNI" not in data["status_label"].upper()
    assert any(w["code"] == "MISSING_MESH" for w in data["summary"]["warnings"])

    # Export CSV by analysis_id and verify status_label & warning appear
    csv_resp = client.get(f"/api/analyses/{aid}/export/csv")
    assert csv_resp.status_code == 200
    csv_text = csv_resp.content.decode("utf-8-sig")
    assert "HASIL SEMENTARA" in csv_text
    assert "MISSING_MESH" in csv_text

    # Export XLSX by analysis_id and verify SUMMARY OTTV shows provisional status & warning
    xlsx_resp = client.get(f"/api/analyses/{aid}/export/xlsx")
    assert xlsx_resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_resp.content))
    ws_sum = wb["SUMMARY OTTV"]
    assert ws_sum["G21"].value == "HASIL SEMENTARA — perlu konfirmasi"
    sum_values = [cell.value for row in ws_sum.iter_rows(min_row=38, max_row=45) for cell in row if cell.value]
    assert any("MISSING_MESH" in str(v) for v in sum_values)

    # Export PDF by analysis_id
    pdf_resp = client.get(f"/api/analyses/{aid}/export/pdf")
    assert pdf_resp.status_code == 200
    assert pdf_resp.content.startswith(b"%PDF")

    # Export Template Prodi by analysis_id (pure zip/XML)
    tpl_resp = client.get(f"/api/analyses/{aid}/export/template_prodi")
    assert tpl_resp.status_code == 200
    assert tpl_resp.content[:2] == b"PK"

    # Unknown analysis_id -> 404; invalid format -> 400
    assert client.get("/api/analyses/nonexistent_id/export/csv").status_code == 404
    assert client.get(f"/api/analyses/{aid}/export/docx").status_code == 400


def test_legacy_endpoints_and_globals_removed(isolated_client):
    client, _ = isolated_client

    assert not hasattr(api_main, "LAST_ANALYSIS_CACHE")
    assert not hasattr(api_main, "ACTIVE_CUSTOM_EPW")
    assert "use_global_slider_override" not in EnvelopeParameters.__dataclass_fields__
    assert "source_software" not in EnvelopeParameters.__dataclass_fields__

    registered_paths = {getattr(r, "path", "") for r in api_main.app.routes}
    for removed_path in (
        "/api/analyze/preset",
        "/api/analyze/upload",
        "/api/analyze/commit",
        "/api/stage/upload",
        "/api/stage/inspect",
        "/api/stage/config/{model_id}",
        "/api/export/excel",
        "/api/export/csv",
        "/api/export/pdf",
        "/api/intake/profiles",
    ):
        assert removed_path not in registered_paths, f"Legacy route {removed_path} still registered!"

    for method, path in (
        ("POST", "/api/analyze/preset"),
        ("POST", "/api/analyze/upload"),
        ("POST", "/api/analyze/commit"),
        ("POST", "/api/stage/upload"),
        ("POST", "/api/stage/inspect"),
        ("GET", "/api/stage/config/foo"),
        ("GET", "/api/export/excel"),
    ):
        resp = client.request(method, path)
        assert resp.status_code in (404, 405), f"{method} {path} should be removed (404/405), got {resp.status_code}"
