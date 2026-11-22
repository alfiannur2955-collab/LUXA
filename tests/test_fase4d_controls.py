"""Tests for Fase 4d (SC/SHGC 0.87 ratio, sun_dome_radius_m config persistence, D1/D2/D4 artifacts)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config_schema import CustomMaterialSpec, ProjectConfig, SettingsConfig
from materials_and_epw import SC_TO_SHGC_RATIO, get_material_shgc


def test_sc_to_shgc_ratio_is_087() -> None:
    assert SC_TO_SHGC_RATIO == pytest.approx(0.87, abs=1e-9)
    # Material with SC only -> SHGC = SC * 0.87
    assert get_material_shgc({"sc": 0.50}) == pytest.approx(0.435, abs=1e-4)
    # CustomMaterialSpec auto-computes SC = SHGC / 0.87
    spec = CustomMaterialSpec(
        id="usr_test_glz",
        name="Test Glass",
        category="glazing",
        u_value=1.8,
        shgc=0.435,
    )
    cat = spec.to_catalog_dict()
    assert cat["sc"] == pytest.approx(0.50, abs=1e-3)
    assert cat["shgc"] == pytest.approx(0.435, abs=1e-4)


def test_project_config_persists_sun_dome_radius_m() -> None:
    cfg = ProjectConfig(settings=SettingsConfig(sun_dome_radius_m=42.5, north_angle_deg=137.5))
    dumped = cfg.model_dump(mode="json")
    assert dumped["settings"]["sun_dome_radius_m"] == 42.5
    assert dumped["settings"]["north_angle_deg"] == 137.5
    restored = ProjectConfig.model_validate(dumped)
    assert restored.settings.sun_dome_radius_m == 42.5
    assert restored.settings.north_angle_deg == 137.5


def test_fase4d_docs_and_controls_present() -> None:
    audit_md = ROOT_DIR / "docs" / "AUDIT_CRUD.md"
    assert audit_md.is_file()
    txt = audit_md.read_text(encoding="utf-8")
    for entity in ("Material kustom", "saved_views", "alternatives", "luxa.projects.v1", "Urungkan"):
        assert entity in txt

    # Compass is read-only indicator (no pointerdown drag handler)
    compass_src = (ROOT_DIR / "frontend" / "src" / "viewer" / "compass.js").read_text(encoding="utf-8")
    assert "pointerdown" not in compass_src
    assert "Utara di" in compass_src

    # NorthRingController exists for D2
    north_ring_src = (ROOT_DIR / "frontend" / "src" / "viewer" / "northRing.js").read_text(encoding="utf-8")
    assert "1.15 * halfPlanDiag" in north_ring_src

    # SunDomeController has no 50-200% clamp and no Pas ke model sun dome button
    panels_src = (ROOT_DIR / "frontend" / "src" / "panels" / "railPanels.js").read_text(encoding="utf-8")
    assert "onResetSunDomeScale" not in panels_src
