"""
OTTV 3D Parametric Studio — Single Source of Truth Configuration Schema (Fase 2 + Fase 3)
=========================================================================================
Defines Pydantic v2 `ProjectConfig` (version = 2) with 4 UX-aligned sections:
  - `model`    : file, unit_mode, up_axis, z_ground_cutoff_m, exterior_detection_mode,
                 outer_skin_only, restore_filtered
  - `roles`    : per-group roles, disabled_groups, group_wwr_map, group_material_map,
                 face overrides, Z-band overrides, auto-split settings
  - `settings` : city_preset, custom_epw (per model), mode ('sni' default | 'simulasi'),
                 materials per role (glazing, wall, frame, roof), custom_materials list,
                 floor settings, north_angle_deg, design_month
  - `advanced` : NURBS subdivision, parametric louvers, auto-split geometric thresholds

Also provides:
  - `migrate_v1(raw: dict) -> ProjectConfig`: migrates legacy v1 and early v2 `.ottv.json`
    (stripping removed scalar fields alpha_wall/u_wall/td_ek/u_fenestration/sc_glass/u_frame/delta_t
    into `settings.custom_materials` when customized)
  - `resolve_material(group, config, ...)`: single canonical material priority rule:
    override grup > override orientasi > default peran > saran nama > default katalog.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from materials_and_epw import SC_TO_SHGC_RATIO, get_material_by_id, migrate_material_id
from sni_tables import get_tdek_roof, get_tdek_wall
from universal_pipeline import suggest_material_id_for_group


DEFAULT_GLAZING_MAT_ID = "glz_igu_triple_silver"
DEFAULT_WALL_MAT_ID = "wal_spandrel_insulasi_50"
DEFAULT_FRAME_MAT_ID = "frm_aluminium_thermal_break"
DEFAULT_ROOF_MAT_ID = "rf_dak_beton_120_insulasi"


class CustomMaterialSpec(BaseModel):
    """Per-model custom material selectable by ID alongside built-in catalog materials."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    category: Literal["glazing", "wall", "frame", "roof"] = "wall"
    u_value: float = Field(ge=0.05, le=10.0)
    sc: Optional[float] = Field(default=None, ge=0.05, le=1.0)
    shgc: Optional[float] = Field(default=None, ge=0.04, le=1.0)
    alpha: Optional[float] = Field(default=None, ge=0.05, le=0.98)
    vlt: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    vlr_ext: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    u_value_nfrc_summer: Optional[float] = Field(default=None, ge=0.05, le=10.0)
    massa_kg_m2: float = Field(default=150.0, ge=1.0, le=2000.0)
    thickness_mm: Optional[float] = Field(default=None, ge=0.5, le=1000.0)
    product_line: str = ""
    configuration: str = ""
    color_hex: str = ""
    sumber: str = ""
    sumber_judul: str = ""
    tanggal_akses: str = ""
    standar_data: str = ""
    catatan: str = ""
    origin: Literal["sni_generic", "brand_reference", "user"] = "user"
    status: Literal["datasheet", "nilai_tipikal"] = "nilai_tipikal"
    brand: str = "Buatan saya"

    def to_catalog_dict(self) -> Dict[str, Any]:
        if self.category == "wall":
            td_ek: Optional[float] = get_tdek_wall(self.massa_kg_m2)
        elif self.category == "roof":
            td_ek = get_tdek_roof(self.massa_kg_m2)
        else:
            td_ek = None
        sc_val: Optional[float] = None
        shgc_val: Optional[float] = None
        if self.category == "glazing":
            if self.sc is not None:
                sc_val = float(self.sc)
            elif self.shgc is not None:
                sc_val = round(float(self.shgc) / SC_TO_SHGC_RATIO, 4)
            else:
                sc_val = 0.35
            shgc_val = round(float(self.shgc), 4) if self.shgc is not None else round(sc_val * SC_TO_SHGC_RATIO, 4)
        return {
            "id": self.id,
            "name": self.name,
            "brand": self.brand,
            "product_line": self.product_line,
            "category": self.category,
            "configuration": self.configuration,
            "u_value": float(self.u_value),
            "u_value_nfrc_summer": self.u_value_nfrc_summer,
            "sc": sc_val,
            "shgc": shgc_val,
            "vlt": float(self.vlt) if self.vlt is not None else (0.50 if self.category == "glazing" else None),
            "vlr_ext": self.vlr_ext,
            "alpha": float(self.alpha) if self.alpha is not None else (0.50 if self.category != "glazing" else None),
            "massa_kg_m2": float(self.massa_kg_m2),
            "thickness_mm": self.thickness_mm,
            "td_ek": td_ek,
            "color_hex": self.color_hex,
            "sumber": self.sumber,
            "sumber_judul": self.sumber_judul,
            "tanggal_akses": self.tanggal_akses,
            "standar_data": self.standar_data,
            "catatan": self.catatan,
            "origin": self.origin,
            "status": self.status if self.sumber else "nilai_tipikal",
            "is_custom": True,
        }


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    file: Optional[str] = None
    unit_mode: Literal["auto", "m", "cm", "mm", "ft", "in"] = "auto"
    up_axis: Literal["auto", "Z", "Y"] = "auto"
    z_ground_cutoff_m: float = Field(default=0.0, ge=0.0, le=200.0)
    exterior_detection_mode: Literal["auto", "raycast", "radial", "all"] = "auto"
    outer_skin_only: bool = True
    restore_filtered: List[str] = Field(default_factory=list)
    model_scope: Optional[Literal["facade_only", "full_building", "building_site"]] = None
    expected_floors: Optional[int] = Field(default=None, ge=1, le=200)
    accepted_flags: List[str] = Field(default_factory=list)


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
    mode: Literal["sni", "simulasi"] = "sni"
    sf_source: Literal["template_prodi", "sni2020"] = "sni2020"
    sceff_table_mode: Literal["terkoreksi", "ketat_pdf"] = "terkoreksi"
    design_month: int = Field(default=9, ge=1, le=12)
    north_angle_deg: float = Field(default=0.0, ge=0.0, le=360.0)

    # Material per role + per-model custom material catalog
    glazing_material_id: Optional[str] = DEFAULT_GLAZING_MAT_ID
    wall_material_id: Optional[str] = DEFAULT_WALL_MAT_ID
    frame_material_id: Optional[str] = DEFAULT_FRAME_MAT_ID
    roof_material_id: Optional[str] = DEFAULT_ROOF_MAT_ID
    custom_materials: List[CustomMaterialSpec] = Field(default_factory=list)
    orientation_material_overrides: Dict[str, str] = Field(default_factory=dict)

    # Envelope thermal options (delta_t is always 5 K in SNI mode; TD_ek always derived from massa_kg_m2)
    include_frame_conduction: bool = True
    frame_area_ratio: float = Field(default=0.08, ge=0.0, le=0.35)
    wwr_override: Optional[float] = Field(default=None, ge=0.05, le=0.95)
    default_wall_wwr: Optional[float] = Field(default=None, ge=0.0, le=0.95)

    # Floor detection & sectioning (floor_height_m is None unless explicitly filled by user — R4)
    floor_mode: Literal["auto", "uniform", "custom"] = "auto"
    floor_height_m: Optional[float] = Field(default=None, ge=2.20, le=10.00)
    custom_floor_zones: List[Dict[str, Any]] = Field(default_factory=list)
    section_floor_min: Optional[int] = None
    section_floor_max: Optional[int] = None
    sun_dome_radius_m: Optional[float] = Field(default=None, ge=1.0, le=5000.0)
    # Tampilan saja (skala warna mode Matahari sepanjang tahun); tidak dipakai perhitungan.
    exposure_scale: Optional[Dict[str, Any]] = None
    # RTTV (Pasal 4.4) opsional. None = perilaku lama (selalu dihitung, deteksi skylight otomatis).
    compute_rttv: Optional[bool] = None
    # Grup kaca yang ditandai pengguna sebagai skylight. None = deteksi otomatis (kaca menghadap atas).
    rttv_skylight_groups: Optional[List[str]] = None


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
    saved_views: List[Dict[str, Any]] = Field(default_factory=list)

    def custom_material_dicts(self) -> List[Dict[str, Any]]:
        return [cm.to_catalog_dict() for cm in self.settings.custom_materials]

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
            sf_source=self.settings.sf_source,
            sceff_table_mode=self.settings.sceff_table_mode,
            design_month=self.settings.design_month,
            north_angle_deg=self.settings.north_angle_deg,
            glazing_material_id=migrate_material_id(self.settings.glazing_material_id),
            wall_material_id=migrate_material_id(self.settings.wall_material_id),
            frame_material_id=migrate_material_id(self.settings.frame_material_id),
            roof_material_id=migrate_material_id(self.settings.roof_material_id),
            custom_materials=self.custom_material_dicts(),
            orientation_material_overrides=dict(self.settings.orientation_material_overrides),
            include_frame_conduction=self.settings.include_frame_conduction,
            frame_area_ratio=self.settings.frame_area_ratio,
            wwr_override=self.settings.wwr_override,
            default_wall_wwr=self.settings.default_wall_wwr,
            floor_mode=self.settings.floor_mode,
            floor_height_m=self.settings.floor_height_m,
            expected_floors=self.model.expected_floors,
            custom_floor_zones=copy.deepcopy(self.settings.custom_floor_zones),
            section_floor_min=self.settings.section_floor_min,
            section_floor_max=self.settings.section_floor_max,
            compute_rttv=self.settings.compute_rttv,
            rttv_skylight_groups=(
                list(self.settings.rttv_skylight_groups) if self.settings.rttv_skylight_groups is not None else None
            ),
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
    """Body for `POST /api/models/{id}/inspect` (model + roles + optional advanced + user_answers)."""

    model_config = ConfigDict(extra="ignore")

    model: ModelConfig = Field(default_factory=ModelConfig)
    roles: RolesConfig = Field(default_factory=RolesConfig)
    settings: Optional[SettingsConfig] = None
    advanced: AdvancedConfig = Field(default_factory=AdvancedConfig)
    user_answers: Dict[str, Any] = Field(default_factory=dict)


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


def _tdek_to_representative_mass(td_ek: float) -> float:
    """Maps legacy scalar td_ek (15/12/10 K) to a representative wall mass in kg/m2 per Tabel 7."""
    if td_ek >= 13.5:
        return 80.0
    if td_ek >= 11.0:
        return 160.0
    return 240.0


def _migrate_legacy_scalars_into_settings(settings_dict: Dict[str, Any], source_dict: Dict[str, Any]) -> None:
    """
    Converts removed legacy thermal scalar fields (alpha_wall, u_wall, td_ek,
    u_fenestration, sc_glass, u_frame) into `custom_materials` entries when they
    differ from defaults and no explicit material_id override is set.
    """
    custom_mats = list(settings_dict.get("custom_materials") or [])
    existing_ids = {m.get("id") for m in custom_mats if isinstance(m, dict)}

    has_wall_legacy = any(k in source_dict for k in ("alpha_wall", "u_wall", "td_ek"))
    if has_wall_legacy:
        u_w = float(source_dict.get("u_wall", 0.62))
        a_w = float(source_dict.get("alpha_wall", 0.42))
        td_w = float(source_dict.get("td_ek", 15.0))
        # Only synthesize a custom material if values differ from old default spandrel
        if (abs(u_w - 0.62) > 1e-3 or abs(a_w - 0.42) > 1e-3 or abs(td_w - 15.0) > 1e-3) and (
            settings_dict.get("wall_material_id") in (None, DEFAULT_WALL_MAT_ID)
        ):
            mid = "migrated_wall_custom"
            if mid not in existing_ids:
                custom_mats.append({
                    "id": mid,
                    "name": "Dinding Kustom (Migrasi Konfigurasi Lama)",
                    "category": "wall",
                    "u_value": u_w,
                    "alpha": a_w,
                    "massa_kg_m2": _tdek_to_representative_mass(td_w),
                    "sumber": "Migrasi otomatis dari konfigurasi lama",
                    "status": "nilai_tipikal",
                })
                existing_ids.add(mid)
            settings_dict["wall_material_id"] = mid

    has_glz_legacy = any(k in source_dict for k in ("u_fenestration", "sc_glass"))
    if has_glz_legacy:
        u_f = float(source_dict.get("u_fenestration", 1.10))
        sc_g = float(source_dict.get("sc_glass", 0.23))
        if (abs(u_f - 1.10) > 1e-3 or abs(sc_g - 0.23) > 1e-3) and (
            settings_dict.get("glazing_material_id") in (None, DEFAULT_GLAZING_MAT_ID)
        ):
            mid = "migrated_glazing_custom"
            if mid not in existing_ids:
                custom_mats.append({
                    "id": mid,
                    "name": "Kaca Kustom (Migrasi Konfigurasi Lama)",
                    "category": "glazing",
                    "u_value": u_f,
                    "sc": sc_g,
                    "massa_kg_m2": 25.0,
                    "sumber": "Migrasi otomatis dari konfigurasi lama",
                    "status": "nilai_tipikal",
                })
                existing_ids.add(mid)
            settings_dict["glazing_material_id"] = mid

    if "u_frame" in source_dict:
        u_fr = float(source_dict.get("u_frame", 2.10))
        if abs(u_fr - 2.10) > 1e-3 and settings_dict.get("frame_material_id") in (None, DEFAULT_FRAME_MAT_ID):
            mid = "migrated_frame_custom"
            if mid not in existing_ids:
                custom_mats.append({
                    "id": mid,
                    "name": "Rangka Kustom (Migrasi Konfigurasi Lama)",
                    "category": "frame",
                    "u_value": u_fr,
                    "alpha": 0.40,
                    "massa_kg_m2": 18.0,
                    "sumber": "Migrasi otomatis dari konfigurasi lama",
                    "status": "nilai_tipikal",
                })
                existing_ids.add(mid)
            settings_dict["frame_material_id"] = mid

    if custom_mats:
        settings_dict["custom_materials"] = custom_mats


def _migrate_material_ids_in_config(data: Dict[str, Any]) -> None:
    """Memigrasikan ID material lama (bermerek) pada settings & roles ke ID generik terdekat."""
    settings = data.get("settings")
    if isinstance(settings, dict):
        for k in ("glazing_material_id", "wall_material_id", "frame_material_id", "roof_material_id"):
            if settings.get(k):
                settings[k] = migrate_material_id(settings[k])
        ov = settings.get("orientation_material_overrides")
        if isinstance(ov, dict):
            settings["orientation_material_overrides"] = {
                ok: migrate_material_id(mv) for ok, mv in ov.items() if mv
            }
    roles = data.get("roles")
    if isinstance(roles, dict):
        gm = roles.get("group_material_map")
        if isinstance(gm, dict):
            roles["group_material_map"] = {
                gk: migrate_material_id(mv) for gk, mv in gm.items() if mv
            }


def migrate_v1(raw: Dict[str, Any]) -> ProjectConfig:
    """
    Migrates legacy v1 `.ottv.json` OR early v2 `.ottv.json` (which still carried
    scalar thermal fields like alpha_wall/u_wall/td_ek/u_fenestration/sc_glass/u_frame/delta_t
    or legacy branded material IDs) into a clean current `ProjectConfig(version=2)`.
    """
    if not isinstance(raw, dict):
        return ProjectConfig()

    if raw.get("version") == 2 or raw.get("versi") == 2:
        data = copy.deepcopy(raw)
        data["version"] = 2
        s_raw = data.get("settings")
        if isinstance(s_raw, dict):
            _migrate_legacy_scalars_into_settings(s_raw, s_raw)
        _migrate_material_ids_in_config(data)
        return ProjectConfig.model_validate(data)

    prof = raw.get("profile") if isinstance(raw.get("profile"), dict) else {}

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
        "sf_source",
        "sceff_table_mode",
        "design_month",
        "north_angle_deg",
        "glazing_material_id",
        "wall_material_id",
        "frame_material_id",
        "roof_material_id",
        "custom_materials",
        "orientation_material_overrides",
        "include_frame_conduction",
        "frame_area_ratio",
        "wwr_override",
        "floor_mode",
        "floor_height_m",
        "custom_floor_zones",
        "section_floor_min",
        "section_floor_max",
    ):
        if key in raw and raw[key] is not None:
            settings_dict[key] = raw[key]
    if "custom_epw_info" in raw and raw["custom_epw_info"] is not None and "custom_epw" not in settings_dict:
        settings_dict["custom_epw"] = raw["custom_epw_info"]
    _migrate_legacy_scalars_into_settings(settings_dict, raw)
    _migrate_material_ids_in_config({"settings": settings_dict, "roles": roles_dict})

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
        saved_views=list(raw.get("saved_views") or []),
    )


def resolve_material(
    group: Union[str, Dict[str, Any], Any],
    config: Union[ProjectConfig, Any],
    category: Optional[str] = None,
    orientation_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Single canonical material priority rule:
      1. Override grup      (`roles.group_material_map[group_name]`)
      2. Override orientasi (`settings.orientation_material_overrides[orientation_code]`)
      3. Default peran      (`settings.glazing_material_id` / `wall_material_id` / `frame_material_id` / `roof_material_id`)
      4. Saran nama         (`suggest_material_id_for_group`)
      5. Default katalog

    Supports both built-in catalog materials and per-model `settings.custom_materials`.
    Returns `{"material_id": str, "material": Optional[dict], "source": str}`.
    """
    if isinstance(group, str):
        group_name = group
        inferred_cat = category or "wall"
    elif isinstance(group, dict):
        group_name = str(group.get("group_name") or group.get("name") or "")
        inferred_cat = category or str(group.get("category") or group.get("default_category") or "wall")
    else:
        group_name = str(getattr(group, "group_name", "") or "")
        inferred_cat = category or str(getattr(group, "default_category", "wall") or "wall")

    if isinstance(config, ProjectConfig):
        group_mat_map = config.roles.group_material_map
        orient_overrides = config.settings.orientation_material_overrides
        role_glz_id = config.settings.glazing_material_id
        role_wal_id = config.settings.wall_material_id
        role_frm_id = config.settings.frame_material_id
        role_roof_id = config.settings.roof_material_id
        extra_mats = config.custom_material_dicts()
    else:
        group_mat_map = getattr(config, "group_material_map", {}) or {}
        orient_overrides = getattr(config, "orientation_material_overrides", {}) or {}
        role_glz_id = getattr(config, "glazing_material_id", DEFAULT_GLAZING_MAT_ID)
        role_wal_id = getattr(config, "wall_material_id", DEFAULT_WALL_MAT_ID)
        role_frm_id = getattr(config, "frame_material_id", DEFAULT_FRAME_MAT_ID)
        role_roof_id = getattr(config, "roof_material_id", DEFAULT_ROOF_MAT_ID)
        extra_mats = getattr(config, "custom_materials", None) or []

    if inferred_cat in ("glazing", "composite_cw"):
        expected_mat_cat = "glazing"
    elif inferred_cat == "frame":
        expected_mat_cat = "frame"
    elif inferred_cat == "roof":
        expected_mat_cat = "roof"
    else:
        expected_mat_cat = "wall"

    # Priority 1: Explicit per-group override (most specific!)
    if group_name and group_name in group_mat_map:
        gm_id = migrate_material_id(group_mat_map[group_name]) or group_mat_map[group_name]
        gm_mat = get_material_by_id(gm_id, extra_materials=extra_mats)
        if gm_mat is not None:
            return {"material_id": gm_mat["id"], "material": gm_mat, "source": "group_override"}

    # Priority 2: Orientation override
    if orientation_code and orientation_code in orient_overrides:
        ov_id = migrate_material_id(orient_overrides[orientation_code]) or orient_overrides[orientation_code]
        ov_mat = get_material_by_id(ov_id, extra_materials=extra_mats)
        if ov_mat is not None and (
            ov_mat.get("category") == expected_mat_cat
            or (inferred_cat in ("glazing", "composite_cw") and ov_mat.get("category") == "glazing")
        ):
            return {"material_id": ov_mat["id"], "material": ov_mat, "source": "orientation_override"}

    # Priority 3: Role-level material selected in settings
    role_id = {
        "glazing": role_glz_id,
        "frame": role_frm_id,
        "roof": role_roof_id,
        "wall": role_wal_id,
    }.get(expected_mat_cat, role_wal_id)
    if role_id:
        role_id_m = migrate_material_id(role_id) or role_id
        r_mat = get_material_by_id(role_id_m, extra_materials=extra_mats)
        if r_mat is not None:
            return {"material_id": r_mat["id"], "material": r_mat, "source": "role_default"}

    # Priority 4: Name-based suggestion when role material is unset
    if expected_mat_cat != "roof":
        sug_id = suggest_material_id_for_group(
            group_name=group_name,
            category=inferred_cat,
            default_glazing_id=None,
            default_wall_id=None,
            default_frame_id=None,
        )
        # Only count as 'suggested' if suggest_material_id_for_group actually matched a name pattern
        if sug_id and sug_id not in (DEFAULT_GLAZING_MAT_ID, DEFAULT_WALL_MAT_ID, DEFAULT_FRAME_MAT_ID):
            sug_mat = get_material_by_id(sug_id, extra_materials=extra_mats)
            if sug_mat is not None:
                return {"material_id": sug_id, "material": sug_mat, "source": "suggested"}

    # Priority 5: Built-in catalog default fallback
    fb_id = {
        "glazing": DEFAULT_GLAZING_MAT_ID,
        "frame": DEFAULT_FRAME_MAT_ID,
        "roof": DEFAULT_ROOF_MAT_ID,
        "wall": DEFAULT_WALL_MAT_ID,
    }.get(expected_mat_cat, DEFAULT_WALL_MAT_ID)
    return {"material_id": fb_id, "material": get_material_by_id(fb_id, extra_materials=extra_mats), "source": "fallback"}


# Shared by main.py (POST /api/materials/validate) and browser_api.validate_material
class ValidateMaterialRequest(BaseModel):
    id: Optional[str] = None
    name: str
    brand: str = "Buatan saya"
    product_line: str = ""
    category: str = "glazing"  # 'glazing' | 'wall' | 'frame' | 'roof'
    technology: str = "Spesifikasi Kustom"
    configuration: str = ""
    u_value: float = 1.80
    u_value_nfrc_summer: Optional[float] = None
    sc: Optional[float] = None
    shgc: Optional[float] = None
    vlt: Optional[float] = 0.50
    vlr_ext: Optional[float] = None
    alpha: Optional[float] = 0.45
    massa_kg_m2: float = 150.0
    thickness_mm: float = 24.0
    color_hex: str = ""
    sumber: str = ""
    sumber_judul: str = ""
    tanggal_akses: str = ""
    standar_data: str = ""
    status: str = "nilai_tipikal"
    catatan: str = ""
    description: str = ""
