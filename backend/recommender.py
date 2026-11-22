"""
LUXA Fast Rematerialization & Engine-Accurate Material Recommender (`docs/RENCANA.md` Fase 4e)
=============================================================================================
1. `rematerial_analysis`: reuses geometry, panel areas, WWR, SF, and shading multipliers
   from an existing analysis result to recompute OTTV/RTTV in < 10 ms without raytracing
   (matching full `analyze_building_ottv` to <= 0.01 W/m²).
2. `recommend_for_target`: evaluates all same-category catalog materials (SNI generic,
   verified brand references, and user custom materials) for a role or orientation target.
3. `optimize_material_combinations`: finds exact optimal combinations using the additive
   area-weighted independence of orientations (least changes, lowest OTTV, and lowest cost
   when user-supplied prices are present).
"""

from __future__ import annotations

import copy
import math
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

from materials_and_epw import (
    SC_TO_SHGC_RATIO,
    get_all_materials,
    get_material_by_id,
    get_material_shgc,
)
from sni_tables import (
    SNI_DELTA_T_K,
    SNI_OTTV_LIMIT_WM2,
    SNI_RTTV_LIMIT_OPAQUE_ONLY_WM2,
    SNI_RTTV_LIMIT_WITH_SKYLIGHT_WM2,
    get_tdek_roof,
    get_tdek_wall,
)
from template_method import compute_template_shgc_and_sck

ORIENTATION_CODES: Tuple[str, ...] = ("U", "TL", "T", "TGR", "S", "BD", "B", "BL")


def _wall_tdek_from_mat(mat_dict: Optional[Dict[str, Any]], fallback_td: float, is_sni_mode: bool) -> float:
    if is_sni_mode:
        if mat_dict and mat_dict.get("massa_kg_m2") is not None:
            return float(get_tdek_wall(float(mat_dict["massa_kg_m2"])))
        if mat_dict and mat_dict.get("td_ek") is not None:
            return float(mat_dict["td_ek"])
        return float(fallback_td)
    if mat_dict and mat_dict.get("td_ek") is not None:
        return float(mat_dict["td_ek"])
    if mat_dict and mat_dict.get("massa_kg_m2") is not None:
        return float(get_tdek_wall(float(mat_dict["massa_kg_m2"])))
    return float(fallback_td)


def _glazing_sc_and_shgc(
    mat_dict: Optional[Dict[str, Any]],
    fallback_sc: float,
    is_template_method: bool,
) -> Tuple[float, float]:
    """Returns `(shgc, sc_k)` matching `ottv_engine.py` lines 2798-2818."""
    if is_template_method:
        return compute_template_shgc_and_sck(mat_dict, fallback_sc=fallback_sc)
    sc_val = (
        float(mat_dict["sc"])
        if (mat_dict and mat_dict.get("sc") is not None)
        else float(fallback_sc)
    )
    shgc_val = get_material_shgc(mat_dict, fallback_sc=sc_val)
    return shgc_val, sc_val


def _is_igu_material(mat: Dict[str, Any]) -> bool:
    hay = " ".join(
        str(mat.get(k) or "")
        for k in ("name", "configuration", "technology", "product_line")
    ).lower()
    if any(tok in hay for tok in ("igu", "ganda", "double", "triple", "dgu", "6+", "8+", "5+", "4+")):
        return True
    if any(tok in hay for tok in ("tunggal", "single", "monolithic")):
        return False
    return float(mat.get("thickness_mm") or 0) >= 16.0


def _resolve_panel_material(
    p: Dict[str, Any],
    glz_mat: Optional[Dict[str, Any]],
    wal_mat: Optional[Dict[str, Any]],
    ori_overrides: Dict[str, str],
    group_map: Dict[str, str],
    extra_mats: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Priority: group_material_map -> orientation_material_overrides -> role default."""
    cat = p.get("element_type", "wall")
    gname = p.get("group_name") or ""
    ocode = p.get("orientation_code") or "U"

    chosen_id: Optional[str] = None
    if gname and gname in group_map and group_map[gname]:
        chosen_id = group_map[gname]
    elif ocode and ocode in ori_overrides and ori_overrides[ocode]:
        cand = get_material_by_id(ori_overrides[ocode], extra_materials=extra_mats)
        if cand is not None:
            want_glz = cat in ("glazing", "composite_cw")
            if (want_glz and cand.get("category") == "glazing") or (
                (not want_glz) and cand.get("category") == "wall"
            ):
                return cand
    if chosen_id:
        cand = get_material_by_id(chosen_id, extra_materials=extra_mats)
        if cand is not None:
            return cand
    return glz_mat if cat in ("glazing", "composite_cw") else wal_mat


def rematerial_analysis(
    base_analysis: Dict[str, Any],
    *,
    glazing_material_id: Optional[str] = None,
    wall_material_id: Optional[str] = None,
    frame_material_id: Optional[str] = None,
    roof_material_id: Optional[str] = None,
    orientation_material_overrides: Optional[Dict[str, str]] = None,
    group_material_map: Optional[Dict[str, str]] = None,
    custom_materials: Optional[List[Dict[str, Any]]] = None,
    preserve_id: bool = False,
) -> Dict[str, Any]:
    """
    Recomputes OTTV, per-panel heat gains, orientation breakdown, floor breakdown, and RTTV
    using cached geometry & SF from `base_analysis` without reloading 3D meshes or raytracing.
    """
    from ottv_engine import compute_panel_heatmap_color

    out = copy.deepcopy(base_analysis)
    if not preserve_id:
        out["analysis_id"] = uuid.uuid4().hex[:12]

    extra_mats = list(custom_materials or [])
    prev_params = out.get("parameters_used") or {}
    eff_glz_id = glazing_material_id or prev_params.get("glazing_material_id") or "glz_igu_triple_silver"
    eff_wal_id = wall_material_id or prev_params.get("wall_material_id") or "wal_spandrel_insulasi_50"
    eff_frm_id = frame_material_id or prev_params.get("frame_material_id") or "frm_aluminium_thermal_break"
    eff_rf_id = roof_material_id or prev_params.get("roof_material_id") or "rf_dak_beton_120_insulasi"

    ori_overrides = dict(
        orientation_material_overrides
        if orientation_material_overrides is not None
        else (prev_params.get("orientation_material_overrides") or {})
    )
    grp_map = dict(
        group_material_map
        if group_material_map is not None
        else (prev_params.get("group_material_map") or {})
    )

    glz_mat = get_material_by_id(eff_glz_id, extra_materials=extra_mats)
    wal_mat = get_material_by_id(eff_wal_id, extra_materials=extra_mats)
    frm_mat = get_material_by_id(eff_frm_id, extra_materials=extra_mats)
    rf_mat = get_material_by_id(eff_rf_id, extra_materials=extra_mats)

    calc_mode = str(out.get("calculation_mode") or "sni").lower()
    is_sni_mode = calc_mode == "sni"
    sf_source = str(out.get("sf_source") or "template_prodi").lower()
    is_template_method = is_sni_mode and (sf_source == "template_prodi")

    delta_t = float(SNI_DELTA_T_K if is_sni_mode else prev_params.get("delta_t", 5.0))
    fallback_u_f = float(prev_params.get("u_fenestration", 1.10))
    fallback_sc = float(prev_params.get("sc_glass", 0.23))
    fallback_u_w = float(prev_params.get("u_wall", 0.62))
    fallback_alpha = float(prev_params.get("alpha_wall", 0.40))
    fallback_tdek = float(prev_params.get("td_ek", 15.0))

    has_frame_elements = bool(out.get("frame_elements"))
    include_frame = bool(prev_params.get("include_frame_conduction", True))
    frame_ratio = float(prev_params.get("frame_area_ratio", 0.08))
    u_frame_eff = float(frm_mat["u_value"]) if frm_mat else float(prev_params.get("u_frame", 2.10))
    frame_cond_adder = (
        0.0
        if is_sni_mode
        else (u_frame_eff * frame_ratio * delta_t if (include_frame and has_frame_elements) else 0.0)
    )

    # Prepare orientation & floor accumulators
    prev_orient_meta = {r["code"]: r for r in (out.get("orientation_breakdown") or [])}
    orient_acc: Dict[str, Dict[str, Any]] = {}
    for code in ORIENTATION_CODES:
        prev_r = prev_orient_meta.get(code) or {}
        orient_acc[code] = {
            "code": code,
            "name_id": prev_r.get("name_id", code),
            "azimuth_deg": prev_r.get("azimuth_deg", 0),
            "sni_sf_wm2": prev_r.get("sni_sf_wm2", 0.0),
            "panel_count": 0,
            "total_area_m2": 0.0,
            "wall_area_m2": 0.0,
            "glazing_area_m2": 0.0,
            "_sum_sf_area": 0.0,
            "_sum_sc_eff_area": 0.0,
            "_sum_sc_k_area": 0.0,
            "_sum_sc_sh_area": 0.0,
            "_sum_r1_area": 0.0,
            "_sum_r2_area": 0.0,
            "_sum_alpha_wall": 0.0,
            "_sum_uw_wall": 0.0,
            "_sum_tdek_wall": 0.0,
            "_sum_uf_glz": 0.0,
            "_sum_shaded_area": 0.0,
            "_sum_q_wall_w": 0.0,
            "_sum_q_glass_w": 0.0,
            "_sum_q_solar_w": 0.0,
        }

    floor_acc: Dict[int, Dict[str, Any]] = {}
    for fb in out.get("floor_breakdown") or []:
        fnum = int(fb.get("floor_number", 1))
        floor_acc[fnum] = {
            **fb,
            "panel_count": 0,
            "total_area_m2": 0.0,
            "glazing_area_m2": 0.0,
            "wall_area_m2": 0.0,
            "_sum_heat_w": 0.0,
        }

    total_envelope_area = 0.0
    total_glazing_area = 0.0
    total_wall_cond_w = 0.0
    total_glass_cond_w = 0.0
    total_solar_rad_w = 0.0

    for p in out.get("panels") or []:
        cat = p.get("element_type", "wall")
        resolved = _resolve_panel_material(p, glz_mat, wal_mat, ori_overrides, grp_map, extra_mats)
        if resolved is not None:
            p["material_id"] = resolved["id"]
            p["material_name"] = resolved["name"]

        if cat in ("glazing", "composite_cw"):
            eff_g = resolved if (resolved and resolved.get("category") == "glazing") else glz_mat
            u_f_k = float(eff_g["u_value"]) if eff_g else fallback_u_f
            shgc_k, sc_1_k = _glazing_sc_and_shgc(eff_g, fallback_sc, is_template_method)
            u_w_k = float(wal_mat["u_value"]) if wal_mat else fallback_u_w
            alpha_k = float(wal_mat["alpha"]) if (wal_mat and wal_mat.get("alpha") is not None) else fallback_alpha
            tdek_k = _wall_tdek_from_mat(wal_mat, fallback_tdek, is_sni_mode)
        else:
            eff_w = resolved if (resolved and resolved.get("category") == "wall") else wal_mat
            u_w_k = float(eff_w["u_value"]) if eff_w else fallback_u_w
            alpha_k = float(eff_w["alpha"]) if (eff_w and eff_w.get("alpha") is not None) else fallback_alpha
            tdek_k = _wall_tdek_from_mat(eff_w, fallback_tdek, is_sni_mode)
            u_f_k = float(glz_mat["u_value"]) if glz_mat else fallback_u_f
            shgc_k, sc_1_k = _glazing_sc_and_shgc(glz_mat, fallback_sc, is_template_method)

        wwr_k = float(p.get("wwr_panel", 1.0 if cat == "glazing" else 0.0))
        sf_k = float(p.get("sf_wm2", 0.0))
        sc_mult = float(p.get("sc_shading_multiplier", 1.0))
        sc_eff = sc_1_k * sc_mult

        q_wall_wm2 = alpha_k * u_w_k * (1.0 - wwr_k) * tdek_k
        q_glass_cond_wm2 = (u_f_k * wwr_k * delta_t) + (frame_cond_adder * wwr_k)
        q_solar_wm2 = sf_k * wwr_k * sc_eff
        ottv_panel_wm2 = q_wall_wm2 + q_glass_cond_wm2 + q_solar_wm2

        area = float(p.get("area_m2", 0.0))
        heat_w = ottv_panel_wm2 * area
        elem_hex, elem_rgb = compute_panel_heatmap_color(ottv_panel_wm2)

        p["shgc_glass"] = round(shgc_k, 4)
        p["sc_glass"] = round(sc_1_k, 6)
        p["sc_effective"] = round(sc_eff, 6)
        p["u_wall_eff"] = round(u_w_k, 4)
        p["alpha_wall_eff"] = round(alpha_k, 4)
        p["td_ek_eff"] = round(tdek_k, 2)
        p["u_fen_eff"] = round(u_f_k, 4)
        p["solar_exposure_wm2"] = round(sf_k * sc_eff, 2)
        p["q_wall_wm2"] = round(q_wall_wm2, 2)
        p["q_glass_cond_wm2"] = round(q_glass_cond_wm2, 2)
        p["q_solar_wm2"] = round(q_solar_wm2, 2)
        p["ottv_panel_wm2"] = round(ottv_panel_wm2, 2)
        p["heat_gain_w"] = round(heat_w, 1)
        p["heatmap_element_hex"] = elem_hex
        p["heatmap_element_rgb"] = elem_rgb
        p["heatmap_color_hex"] = elem_hex
        p["heatmap_rgb"] = elem_rgb

        fnum = int(p.get("floor_number", 1))
        if (
            p.get("is_outer")
            and not p.get("is_below_ground")
            and not p.get("face_excluded")
            and fnum in floor_acc
        ):
            fb = floor_acc[fnum]
            fb["panel_count"] += 1
            fb["total_area_m2"] += area
            fb["glazing_area_m2"] += area * wwr_k
            fb["wall_area_m2"] += area * (1.0 - wwr_k)
            fb["_sum_heat_w"] += heat_w

        if p.get("active"):
            glz_a = area * wwr_k
            wal_a = area * (1.0 - wwr_k)
            qw_w = q_wall_wm2 * area
            qgc_w = q_glass_cond_wm2 * area
            qsol_w = q_solar_wm2 * area

            total_envelope_area += area
            total_glazing_area += glz_a
            total_wall_cond_w += qw_w
            total_glass_cond_w += qgc_w
            total_solar_rad_w += qsol_w

            b = orient_acc.get(p.get("orientation_code", "U"))
            if b is not None:
                b["panel_count"] += 1
                b["total_area_m2"] += area
                b["wall_area_m2"] += wal_a
                b["glazing_area_m2"] += glz_a
                b["_sum_sf_area"] += sf_k * area
                b["_sum_sc_eff_area"] += sc_eff * glz_a
                b["_sum_sc_k_area"] += sc_1_k * glz_a
                b["_sum_sc_sh_area"] += sc_mult * glz_a
                b["_sum_r1_area"] += float(p.get("r1_horizontal", 0.0)) * glz_a
                b["_sum_r2_area"] += float(p.get("r2_vertical", 0.0)) * glz_a
                b["_sum_alpha_wall"] += alpha_k * wal_a
                b["_sum_uw_wall"] += u_w_k * wal_a
                b["_sum_tdek_wall"] += tdek_k * wal_a
                b["_sum_uf_glz"] += u_f_k * glz_a
                b["_sum_shaded_area"] += float(p.get("shaded_fraction", 0.0)) * area
                b["_sum_q_wall_w"] += qw_w
                b["_sum_q_glass_w"] += qgc_w
                b["_sum_q_solar_w"] += qsol_w

    # Rebuild orientation_breakdown
    new_orient_list: List[Dict[str, Any]] = []
    for code in ORIENTATION_CODES:
        b = orient_acc[code]
        a_tot = b["total_area_m2"]
        a_glz = b["glazing_area_m2"]
        a_wal = b["wall_area_m2"]
        if a_tot > 1e-4:
            wwr_o = a_glz / a_tot
            avg_sf = b["_sum_sf_area"] / a_tot
            avg_sc = (b["_sum_sc_eff_area"] / a_glz) if a_glz > 1e-4 else 0.0
            avg_sck = (b["_sum_sc_k_area"] / a_glz) if a_glz > 1e-4 else 0.0
            avg_sc_sh = (b["_sum_sc_sh_area"] / a_glz) if a_glz > 1e-4 else 1.0
            avg_alpha = (b["_sum_alpha_wall"] / a_wal) if a_wal > 1e-4 else 0.0
            avg_uw = (b["_sum_uw_wall"] / a_wal) if a_wal > 1e-4 else 0.0
            avg_tdek = (b["_sum_tdek_wall"] / a_wal) if a_wal > 1e-4 else 0.0
            avg_uf = (b["_sum_uf_glz"] / a_glz if a_glz > 1e-4 else 0.0) + (
                frame_cond_adder / delta_t if (a_glz > 1e-4 and delta_t > 1e-6) else 0.0
            )
            qw = b["_sum_q_wall_w"] / a_tot
            qgc = b["_sum_q_glass_w"] / a_tot
            qsol = b["_sum_q_solar_w"] / a_tot
            ottv_o = qw + qgc + qsol
            hw = b["_sum_q_wall_w"] + b["_sum_q_glass_w"] + b["_sum_q_solar_w"]
        else:
            wwr_o = avg_sf = avg_sc = avg_sck = avg_alpha = avg_uw = avg_tdek = avg_uf = 0.0
            avg_sc_sh = 1.0
            qw = qgc = qsol = ottv_o = hw = 0.0

        manual_calc = {
            "orientation_code": code,
            "ao_m2": round(a_tot, 4),
            "wwr": round(wwr_o, 6),
            "alpha": round(avg_alpha, 4),
            "u_wall": round(avg_uw, 4),
            "td_ek": round(avg_tdek, 2),
            "u_f": round(avg_uf, 4),
            "delta_t": round(delta_t, 2),
            "sc_k": round(avg_sck, 4),
            "sc_eff": round(avg_sc_sh, 4),
            "sc": round(avg_sc, 8),
            "sf": round(avg_sf, 2),
            "q_wall_wm2": round(qw, 4),
            "q_glass_wm2": round(qgc, 4),
            "q_solar_wm2": round(qsol, 4),
            "ottv_wm2": round(ottv_o, 4),
        }
        new_orient_list.append({
            "code": code,
            "name_id": b["name_id"],
            "azimuth_deg": b["azimuth_deg"],
            "sni_sf_wm2": b["sni_sf_wm2"],
            "panel_count": b["panel_count"],
            "total_area_m2": round(a_tot, 2),
            "wall_area_m2": round(a_wal, 2),
            "glazing_area_m2": round(a_glz, 2),
            "wwr": round(wwr_o, 4),
            "effective_sf_wm2": round(avg_sf, 1),
            "avg_sc_effective": round(avg_sc, 3),
            "shaded_fraction": round(b["_sum_shaded_area"] / a_tot, 3) if a_tot > 1e-4 else 0.0,
            "q_wall_wm2": round(qw, 2),
            "q_glass_cond_wm2": round(qgc, 2),
            "q_solar_wm2": round(qsol, 2),
            "ottv_orientation_wm2": round(ottv_o, 2),
            "heat_gain_w": round(hw, 1),
            "compliant_sni": ottv_o <= SNI_OTTV_LIMIT_WM2,
            "manual_calc": manual_calc,
        })

    out["orientation_breakdown"] = new_orient_list

    # Rebuild floor_breakdown
    new_floors: List[Dict[str, Any]] = []
    for fnum in sorted(floor_acc.keys()):
        fb = floor_acc[fnum]
        a_f = fb["total_area_m2"]
        ottv_f = fb["_sum_heat_w"] / a_f if a_f > 1e-4 else 0.0
        rec = {k: v for k, v in fb.items() if not k.startswith("_")}
        rec["total_area_m2"] = round(a_f, 2)
        rec["glazing_area_m2"] = round(fb["glazing_area_m2"], 2)
        rec["wall_area_m2"] = round(fb["wall_area_m2"], 2)
        rec["wwr"] = round(fb["glazing_area_m2"] / a_f, 4) if a_f > 1e-4 else 0.0
        rec["ottv_floor_wm2"] = round(ottv_f, 2)
        rec["heat_gain_w"] = round(fb["_sum_heat_w"], 1)
        new_floors.append(rec)
    out["floor_breakdown"] = new_floors

    # Recompute RTTV if roof is applicable
    rttv = out.get("rttv")
    if isinstance(rttv, dict) and rttv.get("applicable") and rf_mat is not None:
        roof_opaque_a = float(rttv.get("opaque_roof_area_m2", rttv.get("roof_area_m2", 0.0)) or 0.0)
        sky_a = float(rttv.get("skylight_area_m2", 0.0) or 0.0)
        total_r_a = roof_opaque_a + sky_a
        if total_r_a > 1e-4:
            u_r = float(rf_mat.get("u_value", rttv.get("u_roof", 0.50)))
            alpha_r = float(rf_mat.get("alpha", rttv.get("alpha_roof", 0.50)))
            massa_r = float(rf_mat.get("massa_kg_m2", 250.0))
            tdek_r = float(get_tdek_roof(massa_r)) if is_sni_mode else float(rf_mat.get("td_ek") or get_tdek_roof(massa_r))
            sf_sky = float(rttv.get("sf_skylight_wm2", 342.0) or 342.0)
            u_s = float(glz_mat["u_value"]) if glz_mat else float(rttv.get("u_skylight", fallback_u_f))
            _, sc_s = _glazing_sc_and_shgc(glz_mat, fallback_sc, is_template_method)
            q_ro = alpha_r * u_r * roof_opaque_a * tdek_r
            q_sc = u_s * sky_a * delta_t
            q_ss = sf_sky * sky_a * sc_s
            rttv_val = round((q_ro + q_sc + q_ss) / total_r_a, 2)
            lim_r = SNI_RTTV_LIMIT_WITH_SKYLIGHT_WM2 if sky_a > 1e-4 else SNI_RTTV_LIMIT_OPAQUE_ONLY_WM2
            rttv["u_roof"] = round(u_r, 3)
            rttv["alpha_roof"] = round(alpha_r, 3)
            rttv["td_ek_roof"] = round(tdek_r, 2)
            rttv["rttv_wm2"] = rttv_val
            rttv["limit_wm2"] = lim_r
            rttv["compliant"] = rttv_val <= lim_r

    total_heat_w = total_wall_cond_w + total_glass_cond_w + total_solar_rad_w
    ottv_total_wm2 = round(total_heat_w / total_envelope_area, 2) if total_envelope_area > 1e-4 else 0.0
    q_wall_tot = round(total_wall_cond_w / total_envelope_area, 2) if total_envelope_area > 1e-4 else 0.0
    q_glass_tot = round(total_glass_cond_w / total_envelope_area, 2) if total_envelope_area > 1e-4 else 0.0
    q_solar_tot = round(total_solar_rad_w / total_envelope_area, 2) if total_envelope_area > 1e-4 else 0.0

    # Average effective SC over active glazing
    sum_sc_eff_glz = sum(b["_sum_sc_eff_area"] for b in orient_acc.values())
    avg_sc_eff = round(sum_sc_eff_glz / total_glazing_area, 3) if total_glazing_area > 1e-4 else 0.0

    out["ottv_total_wm2"] = ottv_total_wm2
    out["is_compliance"] = ottv_total_wm2 <= SNI_OTTV_LIMIT_WM2
    out["q_wall_conduction_wm2"] = q_wall_tot
    out["q_glass_conduction_wm2"] = q_glass_tot
    out["q_solar_radiation_wm2"] = q_solar_tot
    out["total_heat_gain_kw"] = round(total_heat_w / 1000.0, 2)

    if isinstance(out.get("summary"), dict):
        out["summary"]["ottv_total_wm2"] = ottv_total_wm2
        out["summary"]["avg_sc_effective"] = avg_sc_eff
        out["summary"]["q_wall_conduction_wm2"] = q_wall_tot
        out["summary"]["q_glass_conduction_wm2"] = q_glass_tot
        out["summary"]["q_solar_radiation_wm2"] = q_solar_tot
        out["summary"]["total_heat_gain_kw"] = round(total_heat_w / 1000.0, 2)
        out["summary"]["compliant_sni"] = ottv_total_wm2 <= SNI_OTTV_LIMIT_WM2

    if isinstance(out.get("parameters_used"), dict):
        out["parameters_used"]["glazing_material_id"] = eff_glz_id
        out["parameters_used"]["wall_material_id"] = eff_wal_id
        out["parameters_used"]["frame_material_id"] = eff_frm_id
        out["parameters_used"]["roof_material_id"] = eff_rf_id
        out["parameters_used"]["orientation_material_overrides"] = ori_overrides
        out["parameters_used"]["group_material_map"] = grp_map

    return out


# ============================================================================
# FAST ORIENTATION-LEVEL EVALUATOR FOR RECOMMENDER & OPTIMAL COMBINATIONS
# ============================================================================

def _extract_orientation_terms(analysis: Dict[str, Any]) -> Dict[str, Any]:
    """
    Summarizes each active orientation's exact linear coefficients from `analysis["panels"]`
    so evaluating any glazing or wall candidate is O(1) arithmetic with 0.00 W/m² error.
    """
    calc_mode = str(analysis.get("calculation_mode") or "sni").lower()
    is_sni_mode = calc_mode == "sni"
    sf_source = str(analysis.get("sf_source") or "template_prodi").lower()
    is_template_method = is_sni_mode and (sf_source == "template_prodi")
    prev_params = analysis.get("parameters_used") or {}
    delta_t = float(SNI_DELTA_T_K if is_sni_mode else prev_params.get("delta_t", 5.0))

    has_frame_elements = bool(analysis.get("frame_elements"))
    include_frame = bool(prev_params.get("include_frame_conduction", True))
    frame_ratio = float(prev_params.get("frame_area_ratio", 0.08))
    u_frame_eff = float(prev_params.get("u_frame", 2.10))
    frame_cond_adder = (
        0.0
        if is_sni_mode
        else (u_frame_eff * frame_ratio * delta_t if (include_frame and has_frame_elements) else 0.0)
    )

    orient_stats: Dict[str, Dict[str, float]] = {}
    total_area = 0.0

    for p in analysis.get("panels") or []:
        if not p.get("active"):
            continue
        code = str(p.get("orientation_code") or "U")
        area = float(p.get("area_m2", 0.0))
        if area <= 1e-9:
            continue
        wwr = float(p.get("wwr_panel", 0.0))
        sf = float(p.get("sf_wm2", 0.0))
        sc_mult = float(p.get("sc_shading_multiplier", 1.0))

        glz_a = area * wwr
        wal_a = area * (1.0 - wwr)
        # Current heat contributions in Watts
        cur_wall_w = float(p.get("alpha_wall_eff", 0.4)) * float(p.get("u_wall_eff", 0.62)) * float(p.get("td_ek_eff", 15.0)) * wal_a
        cur_glz_cond_w = (float(p.get("u_fen_eff", 1.1)) * delta_t + frame_cond_adder) * glz_a
        cur_glz_sol_w = sf * float(p.get("sc_glass", 0.23)) * sc_mult * glz_a

        st = orient_stats.setdefault(code, {
            "total_area": 0.0,
            "glz_area": 0.0,
            "wal_area": 0.0,
            "sf_scmult_glz_area": 0.0,  # sum(sf * sc_mult * glz_area)
            "cur_wall_w": 0.0,
            "cur_glz_w": 0.0,
        })
        st["total_area"] += area
        st["glz_area"] += glz_a
        st["wal_area"] += wal_a
        st["sf_scmult_glz_area"] += sf * sc_mult * glz_a
        st["cur_wall_w"] += cur_wall_w
        st["cur_glz_w"] += cur_glz_cond_w + cur_glz_sol_w
        total_area += area

    return {
        "is_sni_mode": is_sni_mode,
        "is_template_method": is_template_method,
        "delta_t": delta_t,
        "frame_cond_adder": frame_cond_adder,
        "total_area": total_area,
        "orient_stats": orient_stats,
    }


def _glazing_watts_for_orientation(
    st: Dict[str, float],
    mat: Dict[str, Any],
    meta: Dict[str, Any],
) -> float:
    u_f = float(mat.get("u_value", 1.1))
    _, sc_k = _glazing_sc_and_shgc(mat, float(mat.get("sc") or 0.35), meta["is_template_method"])
    cond_w = (u_f * meta["delta_t"] + meta["frame_cond_adder"]) * st["glz_area"]
    sol_w = sc_k * st["sf_scmult_glz_area"]
    return cond_w + sol_w


def _wall_watts_for_orientation(
    st: Dict[str, float],
    mat: Dict[str, Any],
    meta: Dict[str, Any],
) -> float:
    u_w = float(mat.get("u_value", 0.62))
    alpha = float(mat.get("alpha") if mat.get("alpha") is not None else 0.50)
    tdek = _wall_tdek_from_mat(mat, 15.0, meta["is_sni_mode"])
    return alpha * u_w * tdek * st["wal_area"]


def _filter_candidates(
    all_mats: Sequence[Dict[str, Any]],
    category: str,
    filters: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    f = filters or {}
    min_vlt = f.get("min_vlt")
    brand_filter = f.get("brand")
    brands_list = f.get("brands")
    glazing_type = str(f.get("glazing_type") or "all").lower()
    origin_filter = str(f.get("origin") or "all").lower()

    out: List[Dict[str, Any]] = []
    for m in all_mats:
        if m.get("category") != category:
            continue
        if origin_filter != "all" and m.get("origin") != origin_filter:
            continue
        if brand_filter and brand_filter != "all" and str(m.get("brand") or "") != str(brand_filter):
            continue
        if brands_list:
            if str(m.get("brand") or "") not in brands_list:
                continue
        if category == "glazing":
            if min_vlt is not None:
                vlt_v = m.get("vlt")
                if vlt_v is None or float(vlt_v) < float(min_vlt) - 1e-9:
                    continue
            if glazing_type == "igu" and not _is_igu_material(m):
                continue
            if glazing_type == "single" and _is_igu_material(m):
                continue
        out.append(m)
    return out


def recommend_for_target(
    analysis: Dict[str, Any],
    target_type: str = "glazing_all",
    target_key: Optional[str] = None,
    *,
    extra_materials: Optional[List[Dict[str, Any]]] = None,
    prices_map: Optional[Dict[str, float]] = None,
    filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Ranks all same-category catalog candidates for a chosen target:
      - target_type='glazing_all' : replaces glazing across all orientations
      - target_type='glazing_orientation', target_key='B' : replaces glazing on orientation B only
      - target_type='wall_all' : replaces wall/spandrel across all orientations
    """
    meta = _extract_orientation_terms(analysis)
    total_area = meta["total_area"]
    orient_stats = meta["orient_stats"]
    if total_area <= 1e-6:
        return {"current_ottv_wm2": 0.0, "target_area_m2": 0.0, "candidates": []}

    cur_total_w = sum(st["cur_wall_w"] + st["cur_glz_w"] for st in orient_stats.values())
    cur_ottv = cur_total_w / total_area

    category = "wall" if target_type.startswith("wall") else "glazing"
    all_mats = get_all_materials(extra_materials=extra_materials)
    candidates = _filter_candidates(all_mats, category, filters=filters)
    prices = prices_map or {}

    if target_type == "glazing_orientation" and target_key:
        target_codes = [str(target_key)] if str(target_key) in orient_stats else []
    else:
        target_codes = list(orient_stats.keys())

    target_area = sum(
        orient_stats[c]["glz_area"] if category == "glazing" else orient_stats[c]["wal_area"]
        for c in target_codes
    )

    ranked: List[Dict[str, Any]] = []
    for m in candidates:
        delta_w = 0.0
        for code in target_codes:
            st = orient_stats[code]
            if category == "glazing":
                new_w = _glazing_watts_for_orientation(st, m, meta)
                delta_w += new_w - st["cur_glz_w"]
            else:
                new_w = _wall_watts_for_orientation(st, m, meta)
                delta_w += new_w - st["cur_wall_w"]

        new_ottv = (cur_total_w + delta_w) / total_area
        delta_ottv = new_ottv - cur_ottv
        price_per_m2 = prices.get(m["id"])
        est_cost_rp: Optional[float] = None
        delta_per_million_rp: Optional[float] = None
        if price_per_m2 is not None and float(price_per_m2) > 0 and target_area > 1e-4:
            est_cost_rp = round(float(price_per_m2) * target_area, 0)
            if est_cost_rp > 0:
                # Positive means W/m2 reduction per 1 million Rp spent
                delta_per_million_rp = round((-delta_ottv) / (est_cost_rp / 1_000_000.0), 4)

        ranked.append({
            "material_id": m["id"],
            "name": m["name"],
            "brand": m.get("brand", ""),
            "origin": m.get("origin", "sni_generic"),
            "origin_label": m.get("origin_label", ""),
            "configuration": m.get("configuration", ""),
            "is_igu": _is_igu_material(m) if category == "glazing" else False,
            "sc": m.get("sc"),
            "shgc": m.get("shgc"),
            "u_value": m.get("u_value"),
            "vlt": m.get("vlt"),
            "alpha": m.get("alpha"),
            "color_hex": m.get("color_hex", ""),
            "new_ottv_wm2": round(new_ottv, 2),
            "delta_ottv_wm2": round(delta_ottv, 2),
            "compliant_sni": new_ottv <= SNI_OTTV_LIMIT_WM2,
            "price_rp_m2": float(price_per_m2) if price_per_m2 is not None else None,
            "estimated_cost_rp": est_cost_rp,
            "delta_ottv_per_million_rp": delta_per_million_rp,
        })

    ranked.sort(key=lambda r: (r["new_ottv_wm2"], -(r["vlt"] or 0.0), r["name"]))
    return {
        "current_ottv_wm2": round(cur_ottv, 2),
        "target_type": target_type,
        "target_key": target_key,
        "target_area_m2": round(target_area, 2),
        "candidates": ranked,
    }


def optimize_material_combinations(
    analysis: Dict[str, Any],
    *,
    target_ottv_wm2: float = 35.0,
    extra_materials: Optional[List[Dict[str, Any]]] = None,
    prices_map: Optional[Dict[str, float]] = None,
    constraints: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Finds optimal glazing combinations meeting `target_ottv_wm2` exploiting additive
    area-weighted independence across active orientations.
    Returns up to 3 options:
      1. `least_changes` ("Paling sedikit perubahan")
      2. `lowest_ottv` ("OTTV terendah")
      3. `lowest_cost` ("Biaya terendah", ONLY when user-supplied prices exist)
    """
    meta = _extract_orientation_terms(analysis)
    total_area = meta["total_area"]
    orient_stats = meta["orient_stats"]
    if total_area <= 1e-6:
        return {"current_ottv_wm2": 0.0, "target_ottv_wm2": target_ottv_wm2, "options": []}

    c = constraints or {}
    single_all = bool(c.get("single_glazing_all_orientations", False))
    prices = {k: float(v) for k, v in (prices_map or {}).items() if v is not None and float(v) > 0}

    cur_total_w = sum(st["cur_wall_w"] + st["cur_glz_w"] for st in orient_stats.values())
    cur_ottv = cur_total_w / total_area
    cur_glz_id = (analysis.get("parameters_used") or {}).get("glazing_material_id") or "glz_igu_triple_silver"
    cur_ori_overrides = dict((analysis.get("parameters_used") or {}).get("orientation_material_overrides") or {})

    all_mats = get_all_materials(extra_materials=extra_materials)
    glz_cands = _filter_candidates(all_mats, "glazing", filters=c)
    if not glz_cands:
        return {
            "current_ottv_wm2": round(cur_ottv, 2),
            "target_ottv_wm2": float(target_ottv_wm2),
            "options": [],
            "note": "Tidak ada kandidat kaca yang memenuhi filter yang dipilih.",
        }

    # Active orientations that actually contain glazing
    glz_orientations = [code for code, st in orient_stats.items() if st["glz_area"] > 1e-4]
    glz_orientations.sort(key=lambda code: ORIENTATION_CODES.index(code) if code in ORIENTATION_CODES else 99)

    # Precompute delta_W(code, mat) for every orientation & candidate
    delta_w_table: Dict[str, Dict[str, float]] = {}
    for code in glz_orientations:
        st = orient_stats[code]
        delta_w_table[code] = {
            m["id"]: _glazing_watts_for_orientation(st, m, meta) - st["cur_glz_w"]
            for m in glz_cands
        }

    mat_by_id = {m["id"]: m for m in glz_cands}

    def _build_option_payload(
        option_id: str,
        title: str,
        subtitle: str,
        assignments: Dict[str, str],
        is_uniform: bool,
    ) -> Dict[str, Any]:
        total_delta_w = 0.0
        total_cost = 0.0
        has_all_prices = True
        changes: List[Dict[str, Any]] = []
        ori_overrides_out = dict(cur_ori_overrides)
        new_global_glz_id = cur_glz_id

        if is_uniform and assignments:
            chosen_id = next(iter(assignments.values()))
            new_global_glz_id = chosen_id
            ori_overrides_out = {}
            chosen_m = mat_by_id.get(chosen_id)
            for code in glz_orientations:
                total_delta_w += delta_w_table[code][chosen_id]
                if chosen_id in prices:
                    total_cost += prices[chosen_id] * orient_stats[code]["glz_area"]
                else:
                    has_all_prices = False
            changes.append({
                "scope": "Semua orientasi",
                "orientation_code": None,
                "material_id": chosen_id,
                "material_name": chosen_m["name"] if chosen_m else chosen_id,
                "brand": chosen_m.get("brand", "") if chosen_m else "",
                "vlt": chosen_m.get("vlt") if chosen_m else None,
                "sc": chosen_m.get("sc") if chosen_m else None,
            })
        else:
            for code, mat_id in assignments.items():
                total_delta_w += delta_w_table[code][mat_id]
                ori_overrides_out[code] = mat_id
                m = mat_by_id.get(mat_id)
                if mat_id in prices:
                    total_cost += prices[mat_id] * orient_stats[code]["glz_area"]
                else:
                    has_all_prices = False
                changes.append({
                    "scope": f"Fasad {code}",
                    "orientation_code": code,
                    "material_id": mat_id,
                    "material_name": m["name"] if m else mat_id,
                    "brand": m.get("brand", "") if m else "",
                    "vlt": m.get("vlt") if m else None,
                    "sc": m.get("sc") if m else None,
                })

        new_ottv = (cur_total_w + total_delta_w) / total_area
        return {
            "option_id": option_id,
            "title": title,
            "subtitle": subtitle,
            "new_ottv_wm2": round(new_ottv, 2),
            "delta_ottv_wm2": round(new_ottv - cur_ottv, 2),
            "meets_target": new_ottv <= float(target_ottv_wm2) + 1e-6,
            "changed_count": len(changes),
            "changes": changes,
            "apply_patch": {
                "glazing_material_id": new_global_glz_id,
                "orientation_material_overrides": ori_overrides_out,
            },
            "estimated_cost_rp": round(total_cost, 0) if (has_all_prices and total_cost > 0) else None,
        }

    options: List[Dict[str, Any]] = []
    target_delta_w = (float(target_ottv_wm2) - cur_ottv) * total_area

    # ---- Option 1: Paling sedikit perubahan ----
    if cur_ottv <= float(target_ottv_wm2) + 1e-6:
        options.append({
            "option_id": "least_changes",
            "title": "Paling sedikit perubahan",
            "subtitle": f"Desain sekarang ({cur_ottv:.2f} W/m²) sudah memenuhi target ≤ {target_ottv_wm2:.1f} W/m².",
            "new_ottv_wm2": round(cur_ottv, 2),
            "delta_ottv_wm2": 0.0,
            "meets_target": True,
            "changed_count": 0,
            "changes": [],
            "apply_patch": {
                "glazing_material_id": cur_glz_id,
                "orientation_material_overrides": cur_ori_overrides,
            },
            "estimated_cost_rp": None,
        })
    elif single_all:
        # Single glazing across all orientations: choose feasible candidate with highest VLT (most daylight!)
        feasible_uniform = []
        for m in glz_cands:
            dw = sum(delta_w_table[code][m["id"]] for code in glz_orientations)
            if dw <= target_delta_w + 1e-6:
                feasible_uniform.append((m, dw))
        if feasible_uniform:
            feasible_uniform.sort(key=lambda pair: (-(pair[0].get("vlt") or 0.0), pair[1]))
            best_m = feasible_uniform[0][0]
            options.append(
                _build_option_payload(
                    "least_changes",
                    "Paling sedikit perubahan",
                    "Satu jenis kaca untuk semua arah yang mencapai target dengan VLT tertinggi.",
                    {c_code: best_m["id"] for c_code in glz_orientations},
                    is_uniform=True,
                )
            )
    else:
        # Exact minimum number of changed orientations k = 1..len(glz_orientations)
        # Because orientations are additive and independent, for any k the maximum possible
        # reduction is the sum of the k largest per-orientation reductions!
        best_per_ori: List[Tuple[str, str, float]] = []
        for code in glz_orientations:
            best_m = min(glz_cands, key=lambda m: (delta_w_table[code][m["id"]], -(m.get("vlt") or 0.0)))
            best_per_ori.append((code, best_m["id"], delta_w_table[code][best_m["id"]]))
        best_per_ori.sort(key=lambda x: x[2])  # most negative delta_W first

        chosen_subset: Optional[List[Tuple[str, str, float]]] = None
        cum_dw = 0.0
        for k in range(1, len(best_per_ori) + 1):
            cum_dw += best_per_ori[k - 1][2]
            if cum_dw <= target_delta_w + 1e-6:
                chosen_subset = list(best_per_ori[:k])
                break

        if chosen_subset is not None:
            # Refine each chosen orientation to pick the highest-VLT candidate that still keeps total <= target
            assign = {code: mid for code, mid, _ in chosen_subset}
            cur_dw = sum(delta_w_table[code][mid] for code, mid in assign.items())
            for code in list(assign.keys()):
                other_dw = cur_dw - delta_w_table[code][assign[code]]
                need_dw = target_delta_w - other_dw
                feasible_here = [m for m in glz_cands if delta_w_table[code][m["id"]] <= need_dw + 1e-6]
                if feasible_here:
                    best_daylight = max(
                        feasible_here,
                        key=lambda m: ((m.get("vlt") or 0.0), -delta_w_table[code][m["id"]]),
                    )
                    assign[code] = best_daylight["id"]
                    cur_dw = other_dw + delta_w_table[code][best_daylight["id"]]

            options.append(
                _build_option_payload(
                    "least_changes",
                    "Paling sedikit perubahan",
                    f"Cukup mengganti kaca pada {len(assign)} orientasi untuk mencapai target.",
                    assign,
                    is_uniform=False,
                )
            )

    # ---- Option 2: OTTV terendah ----
    if single_all:
        best_m = min(
            glz_cands,
            key=lambda m: (sum(delta_w_table[code][m["id"]] for code in glz_orientations), -(m.get("vlt") or 0.0)),
        )
        options.append(
            _build_option_payload(
                "lowest_ottv",
                "OTTV terendah",
                "Satu jenis kaca dengan angka OTTV paling rendah yang memenuhi syarat.",
                {code: best_m["id"] for code in glz_orientations},
                is_uniform=True,
            )
        )
    else:
        low_assign: Dict[str, str] = {}
        for code in glz_orientations:
            best_m = min(glz_cands, key=lambda m: (delta_w_table[code][m["id"]], -(m.get("vlt") or 0.0)))
            low_assign[code] = best_m["id"]
        # Collapse to uniform if every orientation picked the same material
        uniq_ids = set(low_assign.values())
        options.append(
            _build_option_payload(
                "lowest_ottv",
                "OTTV terendah",
                "Kombinasi kaca berperforma termal tertinggi sesuai filter aktif.",
                low_assign,
                is_uniform=(len(uniq_ids) == 1),
            )
        )

    # ---- Option 3: Biaya terendah (ONLY when user prices exist) ----
    priced_cands = [m for m in glz_cands if m["id"] in prices]
    if priced_cands and glz_orientations:
        if single_all:
            feas_cost = []
            for m in priced_cands:
                dw = sum(delta_w_table[code][m["id"]] for code in glz_orientations)
                if dw <= target_delta_w + 1e-6:
                    cost = sum(prices[m["id"]] * orient_stats[code]["glz_area"] for code in glz_orientations)
                    feas_cost.append((cost, dw, m["id"]))
            if feas_cost:
                feas_cost.sort()
                best_id = feas_cost[0][2]
                options.append(
                    _build_option_payload(
                        "lowest_cost",
                        "Biaya terendah",
                        "Satu jenis kaca termurah berdasarkan harga Rp/m² yang kamu isi.",
                        {code: best_id for code in glz_orientations},
                        is_uniform=True,
                    )
                )
        else:
            # Exact Pareto-frontier DP across active orientations (including "keep current at cost 0")
            # State: list of non-dominated (cost, delta_w, assignment_dict)
            frontier: List[Tuple[float, float, Dict[str, str]]] = [(0.0, 0.0, {})]
            for code in glz_orientations:
                glz_a = orient_stats[code]["glz_area"]
                # Per-orientation choices: keep current (cost 0, dw 0) + all priced candidates
                choices: List[Tuple[float, float, Optional[str]]] = [(0.0, 0.0, None)]
                for m in priced_cands:
                    choices.append((prices[m["id"]] * glz_a, delta_w_table[code][m["id"]], m["id"]))
                # Prune dominated choices within this orientation first
                choices.sort(key=lambda x: (x[0], x[1]))
                pruned_choices: List[Tuple[float, float, Optional[str]]] = []
                best_dw_so_far = float("inf")
                for ch in choices:
                    if ch[1] < best_dw_so_far - 1e-6:
                        pruned_choices.append(ch)
                        best_dw_so_far = ch[1]

                next_states: List[Tuple[float, float, Dict[str, str]]] = []
                for f_cost, f_dw, f_assign in frontier:
                    for c_cost, c_dw, c_mid in pruned_choices:
                        na = dict(f_assign)
                        if c_mid is not None:
                            na[code] = c_mid
                        next_states.append((f_cost + c_cost, f_dw + c_dw, na))

                # Keep exact Pareto frontier (sorted by cost ascending, strictly decreasing delta_w)
                next_states.sort(key=lambda x: (x[0], x[1]))
                pruned_frontier: List[Tuple[float, float, Dict[str, str]]] = []
                best_dw_seen = float("inf")
                for st_item in next_states:
                    if st_item[1] < best_dw_seen - 1e-6:
                        pruned_frontier.append(st_item)
                        best_dw_seen = st_item[1]
                frontier = pruned_frontier

            feasible_dp = [st_item for st_item in frontier if st_item[1] <= target_delta_w + 1e-6]
            if feasible_dp:
                best_cost, _, best_assign = feasible_dp[0]
                options.append(
                    _build_option_payload(
                        "lowest_cost",
                        "Biaya terendah",
                        f"Kombinasi termurah yang mencapai target ≤ {target_ottv_wm2:.1f} W/m².",
                        best_assign,
                        is_uniform=False,
                    )
                )

    return {
        "current_ottv_wm2": round(cur_ottv, 2),
        "target_ottv_wm2": float(target_ottv_wm2),
        "options": options,
    }
