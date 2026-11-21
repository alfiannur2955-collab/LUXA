"""
OTTV 3D Parametric Studio — Single Source of Truth Configuration Schema (Fase 2)
================================================================================
Defines Pydantic v2 `ProjectConfig` (version = 2) with 4 UX-aligned sections:
  - `model`    : file, unit_mode, up_axis, z_ground_cutoff_m, exterior_detection_mode,
                 outer_skin_only, restore_filtered
  - `roles`    : per-group roles, disabled_groups, group_wwr_map, group_material_map,
                 face overrides, Z-band overrides, auto-split settings
  - `settings` : city_preset, custom_epw (stored per model!), mode ('sni' | 'simulasi'),
                 materials per role, floor settings, north_angle_deg, design_month
  - `advanced` : NURBS subdivision, parametric louvers, auto-split geometric thresholds

Also provides:
  - `migrate_v1(raw: dict) -> ProjectConfig`: migrates legacy v1 `.ottv.json` files
  - `resolve_material(group, config, ...)`: single canonical material priority rule
    (replaces the removed `use_global_slider_override` flag).
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from materials_and_epw import get_material_by_id
from universal_pipeline import suggest_material_id_for_group


DEFAULT_GLAZING_MAT_ID = "glz_saint_gobain_xtreme_60_28"
DEFAULT_WALL_MAT_ID = "wal_spandrel_rockwool_nichias_50"
DEFAULT_FRAME_MAT_ID = "frm_ykkap_schuco_thermal_break"


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    file: Optional[str] = None
    unit_mode: Literal["auto", "m", "cm", "mm", "ft", "in"] = "auto"
    up_axis: Literal["auto", "Z", "Y"] = "auto"
    z_ground_cutoff_m: float = Field(default=0.0, ge=0.0, le=200.0)
    exterior_detection_mode: Literal["auto", "raycast", "radial", "all"] = "auto"
    outer_skin_only: bool = True
    restore_filtered: List[str] = Field(default_factory=list)


class RolesConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    group_category_overrides: Dict[str, str] = Field(default_factory=dict)
    disabled_groups: List[str] = Field(default_factory=list)
    group_wwr_map: Dict[str, float] = Field(default_factory=dict)
    group_material_map: Dict[str, str] = Field(default_factory=dict)
    face_category_overrides: Dict[str, str] = Field(default_factory=dict)
    face_z_band_overrides: List[Dict[str, Any]] = Field(default_factory=list)
    auto_split_merged_cw: bool = False
    groups_to_auto_split: List[str] = Field(default_factory=list)


class SettingsConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    city_preset: str = "jakarta"
    custom_epw: Optional[Dict[str, Any]] = None
    mode: Literal["sni", "simulasi"] = "simulasi"
    design_month: int = Field(default=9, ge=1, le=12)
    north_angle_deg: float = Field(default=0.0, ge=0.0, le=360.0)

    # Material per role (single source of truth; per-group overrides live in roles.group_material_map)
    glazing_material_id: Optional[str] = DEFAULT_GLAZING_MAT_ID
    wall_material_id: Optional[str] = DEFAULT_WALL_MAT_ID
    frame_material_id: Optional[str] = DEFAULT_FRAME_MAT_ID
    orientation_material_overrides: Dict[str, str] = Field(default_factory=dict)

    # Envelope thermal options
    include_frame_conduction: bool = True
    frame_area_ratio: float = Field(default=0.08, ge=0.0, le=0.35)
    wwr_override: Optional[float] = Field(default=None, ge=0.05, le=0.95)
    delta_t: float = Field(default=5.0, ge=1.0, le=12.0)

    # Floor detection & sectioning
    floor_mode: Literal["auto", "uniform", "custom"] = "auto"
    floor_height_m: float = Field(default=3.60, ge=2.20, le=10.00)
    custom_floor_zones: List[Dict[str, Any]] = Field(default_factory=list)
    section_floor_min: Optional[int] = None
    section_floor_max: Optional[int] = None

    # Fallback numeric thermal values (only used if a role material ID is None or missing in catalog)
    alpha_wall: float = Field(default=0.42, ge=0.10, le=0.95)
    u_wall: float = Field(default=0.62, ge=0.15, le=5.50)
    td_ek: float = Field(default=15.0, ge=8.0, le=18.0)
    u_fenestration: float = Field(default=1.10, ge=0.40, le=6.00)
    sc_glass: float = Field(default=0.23, ge=0.08, le=1.00)
    u_frame: float = Field(default=2.10, ge=0.50, le=7.00)


class AdvancedConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    nurbs_u_div: int = Field(default=4, ge=2, le=28)
    nurbs_v_div: int = Field(default=2, ge=2, le=20)
    enable_parametric_louvers: bool = False
    louver_depth_m: float = Field(default=0.65, ge=0.0, le=2.50)
    louver_spacing_m: float = Field(default=1.10, ge=0.25, le=2.50)
    louver_tilt_deg: float = Field(default=22.0, ge=0.0, le=60.0)
    frame_width_threshold_m: float = Field(default=0.28, ge=0.05, le=1.20)
    spandrel_height_threshold_m: float = Field(default=1.15, ge=0.30, le=2.80)


class ProjectConfig(BaseModel):
    """Unified version-2 project configuration shared by Inspect, Save, and Analyze."""

    model_config = ConfigDict(extra="ignore")

    version: int = Field(default=2)
    model: ModelConfig = Field(default_factory=ModelConfig)
    roles: RolesConfig = Field(default_factory=RolesConfig)
    settings: SettingsConfig = Field(default_factory=SettingsConfig)
    advanced: AdvancedConfig = Field(default_factory=AdvancedConfig)

    def to_envelope_parameters(self) -> Any:
        """Converts ProjectConfig into `ottv_engine.EnvelopeParameters`."""
        from ottv_engine import EnvelopeParameters

        return EnvelopeParameters(
            unit_mode=self.model.unit_mode,
            up_axis=self.model.up_axis,
            exterior_detection_mode=self.model.exterior_detection_mode,
            z_ground_cutoff_m=self.model.z_ground_cutoff_m,
            outer_skin_only=self.model.outer_skin_only,
            restore_filtered=list(self.model.restore_filtered),
            auto_split_merged_cw=self.roles.auto_split_merged_cw,
            groups_to_auto_split=list(self.roles.groups_to_auto_split),
            group_category_overrides=dict(self.roles.group_category_overrides),
            disabled_groups=list(self.roles.disabled_groups),
            group_wwr_map=dict(self.roles.group_wwr_map),
            group_material_map=dict(self.roles.group_material_map),
            face_category_overrides=dict(self.roles.face_category_overrides),
            face_z_band_overrides=copy.deepcopy(self.roles.face_z_band_overrides),
            city_preset=self.settings.city_preset,
            custom_epw_info=copy.deepcopy(self.settings.custom_epw),
            calculation_mode=self.settings.mode,
            design_month=self.settings.design_month,
            north_angle_deg=self.settings.north_angle_deg,
            glazing_material_id=self.settings.glazing_material_id,
            wall_material_id=self.settings.wall_material_id,
            frame_material_id=self.settings.frame_material_id,
            orientation_material_overrides=dict(self.settings.orientation_material_overrides),
            include_frame_conduction=self.settings.include_frame_conduction,
            frame_area_ratio=self.settings.frame_area_ratio,
            wwr_override=self.settings.wwr_override,
            delta_t=self.settings.delta_t,
            floor_mode=self.settings.floor_mode,
            floor_height_m=self.settings.floor_height_m,
            custom_floor_zones=copy.deepcopy(self.settings.custom_floor_zones),
            section_floor_min=self.settings.section_floor_min,
            section_floor_max=self.settings.section_floor_max,
            alpha_wall=self.settings.alpha_wall,
            u_wall=self.settings.u_wall,
            td_ek=self.settings.td_ek,
            u_fenestration=self.settings.u_fenestration,
            sc_glass=self.settings.sc_glass,
            u_frame=self.settings.u_frame,
            nurbs_u_div=self.advanced.nurbs_u_div,
            nurbs_v_div=self.advanced.nurbs_v_div,
            enable_parametric_louvers=self.advanced.enable_parametric_louvers,
            louver_depth_m=self.advanced.louver_depth_m,
            louver_spacing_m=self.advanced.louver_spacing_m,
            louver_tilt_deg=self.advanced.louver_tilt_deg,
            frame_width_threshold_m=self.advanced.frame_width_threshold_m,
            spandrel_height_threshold_m=self.advanced.spandrel_height_threshold_m,
        )


class InspectRequest(BaseModel):
    """Body for `POST /api/models/{id}/inspect` (model + roles + optional advanced)."""

    model_config = ConfigDict(extra="ignore")

    model: ModelConfig = Field(default_factory=ModelConfig)
    roles: RolesConfig = Field(default_factory=RolesConfig)
    advanced: AdvancedConfig = Field(default_factory=AdvancedConfig)


def _clean_choice(val: Any, allowed: tuple[str, ...], default: str) -> str:
    if isinstance(val, str):
        v = val.strip()
        if v in allowed:
            return v
        if v.upper() in allowed:
            return v.upper()
        if v.lower() in allowed:
            return v.lower()
    return default


def migrate_v1(raw: Dict[str, Any]) -> ProjectConfig:
    """
    Migrates a legacy v1 `.ottv.json` dict (from v5.0 staging configs or flat
    PresetAnalyzeRequest payloads) into a valid `ProjectConfig(version=2)`.
    If `raw` is already version 2, validates and normalizes it directly.
    """
    if not isinstance(raw, dict):
        return ProjectConfig()

    if raw.get("version") == 2 or raw.get("versi") == 2:
        data = dict(raw)
        data["version"] = 2
        return ProjectConfig.model_validate(data)

    prof = raw.get("profile") if isinstance(raw.get("profile"), dict) else {}

    # Derive exterior_detection_mode from legacy massing_type/geometry_scope if not explicitly present
    ext_mode = raw.get("exterior_detection_mode")
    if not ext_mode:
        if prof.get("massing_type") == "single_tower" and prof.get("geometry_scope") == "facade_only":
            ext_mode = "radial"
        else:
            ext_mode = "auto"

    auto_split = bool(
        raw.get("auto_split_merged_cw", False)
        or prof.get("element_structure") == "merged_single_layer"
    )

    model_dict: Dict[str, Any] = {
        "file": raw.get("filename") or raw.get("file"),
        "unit_mode": _clean_choice(raw.get("unit_mode", prof.get("unit_mode")), ("auto", "m", "cm", "mm", "ft", "in"), "auto"),
        "up_axis": _clean_choice(raw.get("up_axis", prof.get("up_axis")), ("auto", "Z", "Y"), "auto"),
        "z_ground_cutoff_m": float(raw.get("z_ground_cutoff_m", prof.get("z_ground_cutoff_m", 0.0)) or 0.0),
        "exterior_detection_mode": _clean_choice(ext_mode, ("auto", "raycast", "radial", "all"), "auto"),
        "outer_skin_only": bool(raw.get("outer_skin_only", True)),
        "restore_filtered": list(raw.get("restore_filtered") or []),
    }

    roles_dict: Dict[str, Any] = {
        "group_category_overrides": dict(raw.get("group_category_overrides") or {}),
        "disabled_groups": list(raw.get("disabled_groups") or []),
        "group_wwr_map": dict(raw.get("group_wwr_map") or {}),
        "group_material_map": dict(raw.get("group_material_map") or {}),
        "face_category_overrides": dict(raw.get("face_category_overrides") or {}),
        "face_z_band_overrides": list(raw.get("face_z_band_overrides") or []),
        "auto_split_merged_cw": auto_split,
        "groups_to_auto_split": list(raw.get("groups_to_auto_split") or []),
    }

    settings_dict: Dict[str, Any] = {}
    for key in (
        "city_preset",
        "custom_epw",
        "mode",
        "design_month",
        "north_angle_deg",
        "glazing_material_id",
        "wall_material_id",
        "frame_material_id",
        "orientation_material_overrides",
        "include_frame_conduction",
        "frame_area_ratio",
        "wwr_override",
        "delta_t",
        "floor_mode",
        "floor_height_m",
        "custom_floor_zones",
        "section_floor_min",
        "section_floor_max",
        "alpha_wall",
        "u_wall",
        "td_ek",
        "u_fenestration",
        "sc_glass",
        "u_frame",
    ):
        if key in raw and raw[key] is not None:
            settings_dict[key] = raw[key]
    if "custom_epw_info" in raw and raw["custom_epw_info"] is not None and "custom_epw" not in settings_dict:
        settings_dict["custom_epw"] = raw["custom_epw_info"]

    advanced_dict: Dict[str, Any] = {}
    for key in (
        "nurbs_u_div",
        "nurbs_v_div",
        "enable_parametric_louvers",
        "louver_depth_m",
        "louver_spacing_m",
        "louver_tilt_deg",
        "frame_width_threshold_m",
        "spandrel_height_threshold_m",
    ):
        if key in raw and raw[key] is not None:
            advanced_dict[key] = raw[key]

    return ProjectConfig(
        version=2,
        model=ModelConfig.model_validate(model_dict),
        roles=RolesConfig.model_validate(roles_dict),
        settings=SettingsConfig.model_validate(settings_dict),
        advanced=AdvancedConfig.model_validate(advanced_dict),
    )


def resolve_material(
    group: Union[str, Dict[str, Any], Any],
    config: Union[ProjectConfig, Any],
    category: Optional[str] = None,
    orientation_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Single canonical material priority rule (replaces `use_global_slider_override`).

    Priority order (highest -> lowest):
      1. Orientation material override (`settings.orientation_material_overrides[orientation_code]`)
         when `orientation_code` is provided and target category is glazing/composite_cw
         (or the override material matches the target category).
      2. Explicit per-group override (`roles.group_material_map[group_name]`).
      3. Role default selected in settings:
         - `glazing` / `composite_cw` -> `settings.glazing_material_id`
         - `wall` / `spandrel`        -> `settings.wall_material_id`
         - `frame`                    -> `settings.frame_material_id`
      4. Smart name-based suggestion (`suggest_material_id_for_group`) if role default is None.
      5. Built-in catalog default fallback.

    Returns:
      `{"material_id": str, "material": Optional[dict], "source": str}`
    """
    # Extract group_name & effective category from str / dict / RawGroupMesh
    if isinstance(group, str):
        group_name = group
        inferred_cat = category or "wall"
    elif isinstance(group, dict):
        group_name = str(group.get("group_name") or group.get("name") or "")
        inferred_cat = category or str(group.get("category") or group.get("default_category") or "wall")
    else:
        group_name = str(getattr(group, "group_name", "") or "")
        inferred_cat = category or str(getattr(group, "default_category", "wall") or "wall")

    # Read config fields cleanly from either ProjectConfig or EnvelopeParameters
    if isinstance(config, ProjectConfig):
        group_mat_map = config.roles.group_material_map
        orient_overrides = config.settings.orientation_material_overrides
        role_glz_id = config.settings.glazing_material_id
        role_wal_id = config.settings.wall_material_id
        role_frm_id = config.settings.frame_material_id
    else:
        group_mat_map = getattr(config, "group_material_map", {}) or {}
        orient_overrides = getattr(config, "orientation_material_overrides", {}) or {}
        role_glz_id = getattr(config, "glazing_material_id", DEFAULT_GLAZING_MAT_ID)
        role_wal_id = getattr(config, "wall_material_id", DEFAULT_WALL_MAT_ID)
        role_frm_id = getattr(config, "frame_material_id", DEFAULT_FRAME_MAT_ID)

    expected_mat_cat = (
        "glazing"
        if inferred_cat in ("glazing", "composite_cw")
        else ("frame" if inferred_cat == "frame" else "wall")
    )

    # Priority 1: Orientation override
    if orientation_code and orientation_code in orient_overrides:
        ov_id = orient_overrides[orientation_code]
        ov_mat = get_material_by_id(ov_id)
        if ov_mat is not None and (
            ov_mat.get("category") == expected_mat_cat
            or (inferred_cat in ("glazing", "composite_cw") and ov_mat.get("category") == "glazing")
        ):
            return {"material_id": ov_id, "material": ov_mat, "source": "orientation_override"}

    # Priority 2: Explicit per-group override
    if group_name and group_name in group_mat_map:
        gm_id = group_mat_map[group_name]
        gm_mat = get_material_by_id(gm_id)
        if gm_mat is not None:
            return {"material_id": gm_id, "material": gm_mat, "source": "group_override"}

    # Priority 3: Role-level material selected in settings
    role_id = (
        role_glz_id
        if expected_mat_cat == "glazing"
        else (role_frm_id if expected_mat_cat == "frame" else role_wal_id)
    )
    if role_id:
        r_mat = get_material_by_id(role_id)
        if r_mat is not None:
            return {"material_id": role_id, "material": r_mat, "source": "role_default"}

    # Priority 4: Name-based suggestion when role material is unset
    sug_id = suggest_material_id_for_group(
        group_name=group_name,
        category=inferred_cat,
        default_glazing_id=DEFAULT_GLAZING_MAT_ID,
        default_wall_id=DEFAULT_WALL_MAT_ID,
        default_frame_id=DEFAULT_FRAME_MAT_ID,
    )
    sug_mat = get_material_by_id(sug_id)
    if sug_mat is not None:
        return {"material_id": sug_id, "material": sug_mat, "source": "suggested"}

    # Priority 5: Built-in catalog fallback
    fb_id = (
        DEFAULT_GLAZING_MAT_ID
        if expected_mat_cat == "glazing"
        else (DEFAULT_FRAME_MAT_ID if expected_mat_cat == "frame" else DEFAULT_WALL_MAT_ID)
    )
    return {"material_id": fb_id, "material": get_material_by_id(fb_id), "source": "fallback"}
