"""
OTTV 3D Parametric Studio — Generator Rapor Evaluasi Ragam Model (`tools/model_report.py`)
==========================================================================================
Menjalankan engine dengan `ProjectConfig()` default pada seluruh korpus:
  - Tingkat A: `fixtures/synthetic/` (21 kasus sintetis + `expected.json`)
  - Tingkat B: `corpus/` (selain `corpus/real/`, model BIM publik)
  - Tingkat C: `corpus/real/` (model mahasiswa/praktik nyata)

Menulis hasil lengkap ke:
  - `docs/RAPOR_MODEL.csv`
  - `docs/RAPOR_MODEL.md` (diawali ringkasan sesuai `docs/FASE1C_SPEC.md` §5)
"""

from __future__ import annotations

import csv
import datetime
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from adapters import detect_file_signature
from config_schema import ProjectConfig
from ottv_engine import analyze_building_ottv
from universal_pipeline import _UNIVERSAL_FILE_CACHE, load_universal_model_stages_1_and_2

SUPPORTED_EXTS = {".3dm", ".obj", ".glb", ".gltf", ".ifc", ".hbjson"}
ORIENT_CODES = ["U", "TL", "T", "TGR", "S", "BD", "B", "BL"]
ROLE_KEYS = ["glazing", "wall", "spandrel", "frame", "shading", "roof", "ignore", "unknown"]

CSV_COLUMNS = [
    "file",
    "tier",
    "format",
    "kernel",
    "software_detected",
    "unit_detected",
    "unit_applied",
    "unit_source",
    "up_axis",
    "span_x_m",
    "span_y_m",
    "span_z_m",
    "z0_m",
    "groups_total",
    "groups_glazing",
    "groups_wall",
    "groups_spandrel",
    "groups_frame",
    "groups_shading",
    "groups_roof",
    "groups_ignore",
    "groups_unknown",
    "unknown_area_pct",
    "filtered_count",
    "filtered_area_m2",
    "missing_mesh_faces",
    "area_glazing_m2",
    "area_wall_m2",
    "area_U",
    "area_TL",
    "area_T",
    "area_TGR",
    "area_S",
    "area_BD",
    "area_B",
    "area_BL",
    "wwr",
    "ottv_wm2",
    "rttv_wm2",
    "is_provisional",
    "warnings",
    "time_load_s",
    "time_analyze_s",
    "expected_result",
    "parity_group",
    "parity_ok",
    "cek_dimensi",
    "cek_kaca",
    "cek_peran",
    "catatan",
]


def _group_mesh_area(rg: Any) -> float:
    vs = rg.vertices
    fs = rg.faces
    if len(vs) < 3 or len(fs) < 1:
        return 0.0
    is_q = fs[:, 2] != fs[:, 3]
    p0, p1, p2, p3 = vs[fs[:, 0]], vs[fs[:, 1]], vs[fs[:, 2]], vs[fs[:, 3]]
    c1 = np.cross(p1 - p0, p2 - p0)
    a1 = 0.5 * np.linalg.norm(c1, axis=1)
    c2 = np.cross(p2 - p0, p3 - p0)
    a2 = np.where(is_q, 0.5 * np.linalg.norm(c2, axis=1), 0.0)
    return float(np.sum(a1 + a2))


def _discover_targets() -> List[Dict[str, Any]]:
    targets: List[Dict[str, Any]] = []

    # Tier A: fixtures/synthetic/*/model.<ext>
    syn_root = os.path.join(ROOT_DIR, "fixtures", "synthetic")
    if os.path.isdir(syn_root):
        for folder in sorted(os.listdir(syn_root)):
            cdir = os.path.join(syn_root, folder)
            exp_path = os.path.join(cdir, "expected.json")
            if not os.path.isfile(exp_path):
                continue
            with open(exp_path, "r", encoding="utf-8") as f:
                exp_data = json.load(f)
            for fmt in exp_data.get("formats", []):
                fpath = os.path.join(cdir, f"model.{fmt}")
                if os.path.isfile(fpath):
                    targets.append({
                        "tier": "A",
                        "path": fpath,
                        "rel": os.path.relpath(fpath, ROOT_DIR).replace("\\", "/"),
                        "case_data": exp_data,
                        "fmt": fmt,
                        "parity_group": folder if (len(exp_data.get("formats", [])) >= 2 and not exp_data["expected"].get("error_expected")) else "",
                    })

    # Tier B: corpus/ (excluding corpus/real/)
    corpus_root = os.path.join(ROOT_DIR, "corpus")
    real_root = os.path.normpath(os.path.join(corpus_root, "real"))
    tier_b_files: List[str] = []
    tier_c_files: List[str] = []
    if os.path.isdir(corpus_root):
        for dirpath, dirnames, filenames in os.walk(corpus_root):
            dirnames.sort()
            norm_dp = os.path.normpath(dirpath)
            is_real = norm_dp == real_root or norm_dp.startswith(real_root + os.sep)
            for fn in sorted(filenames):
                ext = os.path.splitext(fn)[1].lower()
                if ext in SUPPORTED_EXTS:
                    full = os.path.join(dirpath, fn)
                    if is_real:
                        tier_c_files.append(full)
                    else:
                        tier_b_files.append(full)

    def _add_corpus_files(tier_label: str, files: List[str]) -> None:
        # Group by (dir, stem) for parity detection
        stem_counts: Dict[Tuple[str, str], int] = {}
        for fp in files:
            key = (os.path.dirname(fp), os.path.splitext(os.path.basename(fp))[0])
            stem_counts[key] = stem_counts.get(key, 0) + 1
        for fp in files:
            key = (os.path.dirname(fp), os.path.splitext(os.path.basename(fp))[0])
            pg = os.path.relpath(os.path.join(key[0], key[1]), ROOT_DIR).replace("\\", "/") if stem_counts[key] >= 2 else ""
            targets.append({
                "tier": tier_label,
                "path": fp,
                "rel": os.path.relpath(fp, ROOT_DIR).replace("\\", "/"),
                "case_data": None,
                "fmt": os.path.splitext(fp)[1].lstrip(".").lower(),
                "parity_group": pg,
            })

    _add_corpus_files("B", tier_b_files)
    _add_corpus_files("C", tier_c_files)
    return targets


def _check_tier_a_expected(res: Optional[Dict[str, Any]], err: Optional[Exception], case_data: Dict[str, Any], fmt: str) -> str:
    exp = dict(case_data["expected"])
    per_fmt = (case_data.get("per_format_overrides") or {}).get(fmt, {})
    exp.update(per_fmt)
    tol = case_data.get("tolerance") or {"area_rel": 0.005, "ottv_abs": 0.1}
    area_rel = float(tol.get("area_rel", 0.005))
    ottv_abs = float(tol.get("ottv_abs", 0.1))

    if exp.get("error_expected", False):
        if err is not None:
            return "PASS (ditolak sesuai harapan)"
        assert res is not None
        if res["summary"]["is_provisional"] and "MEMENUHI" not in res["status_label"].upper():
            return "PASS (provisional sesuai harapan)"
        return "FAIL: seharusnya ditolak/provisional"

    if err is not None or res is None:
        return f"FAIL: {type(err).__name__}: {err}"

    reasons: List[str] = []
    act_a = float(res["summary"]["total_envelope_area_m2"])
    exp_a = float(exp["total_envelope_area_m2"])
    if exp_a > 1e-6 and abs(act_a - exp_a) / exp_a > area_rel:
        reasons.append(f"area {act_a:.2f}!={exp_a:.2f}")
    act_wwr = float(res["summary"]["effective_wwr"])
    exp_wwr = float(exp["wwr_total"])
    if abs(act_wwr - exp_wwr) > 0.005:
        reasons.append(f"WWR {act_wwr:.3f}!={exp_wwr:.3f}")
    act_ottv = float(res["ottv_total_wm2"])
    exp_ottv = float(exp["ottv_total_wm2"])
    if abs(act_ottv - exp_ottv) > ottv_abs:
        reasons.append(f"OTTV {act_ottv:.2f}!={exp_ottv:.2f}")

    by_code = {r["code"]: r for r in res["orientation_breakdown"]}
    for code, e_o in exp.get("ottv_by_orientation", {}).items():
        if code in by_code and abs(float(by_code[code]["ottv_orientation_wm2"]) - float(e_o)) > ottv_abs:
            reasons.append(f"OTTV[{code}] {by_code[code]['ottv_orientation_wm2']:.2f}!={e_o:.2f}")

    exp_rttv = exp.get("rttv") or {}
    act_rttv = res.get("rttv") or {}
    if bool(act_rttv.get("applicable")) is not bool(exp_rttv.get("applicable")):
        reasons.append(f"rttv.app {act_rttv.get('applicable')}!={exp_rttv.get('applicable')}")
    if abs(float(act_rttv.get("skylight_area_m2", 0.0)) - float(exp_rttv.get("skylight_area_m2", 0.0))) > 0.1:
        reasons.append(f"sky {act_rttv.get('skylight_area_m2')}!={exp_rttv.get('skylight_area_m2')}")

    if bool(res["summary"]["is_provisional"]) is not bool(exp["is_provisional"]):
        reasons.append(f"prov {res['summary']['is_provisional']}!={exp['is_provisional']}")
    act_flags = {w["code"] for w in res["summary"]["warnings"]}
    for fl in exp.get("flags_expected", []):
        if fl not in act_flags:
            reasons.append(f"missing flag {fl}")

    return "PASS" if not reasons else ("FAIL: " + "; ".join(reasons))


def evaluate_target(target: Dict[str, Any]) -> Dict[str, Any]:
    fp = target["path"]
    rel = target["rel"]
    tier = target["tier"]
    fmt = target["fmt"]
    case_data = target["case_data"]

    row: Dict[str, Any] = {col: "" for col in CSV_COLUMNS}
    row["file"] = rel
    row["tier"] = tier
    row["format"] = fmt
    row["parity_group"] = target["parity_group"]

    try:
        sig = detect_file_signature(fp)
        sw = sig.get("software_hint") or sig.get("software") or sig.get("application") or ""
        if not sw and isinstance(sig, dict):
            sw = str(sig.get("detected_software") or sig.get("schema") or "")
        row["software_detected"] = str(sw)
    except Exception:
        row["software_detected"] = ""

    cfg_dict = dict(case_data.get("config_overrides") or {}) if case_data else {}
    cfg = ProjectConfig(**cfg_dict)
    params = cfg.to_envelope_parameters()

    # Clear stage 1/2 cache for accurate time_load_s measurement
    _UNIVERSAL_FILE_CACHE.clear()

    raw_groups = None
    audit1 = None
    t_load = 0.0
    t_an = 0.0
    res: Optional[Dict[str, Any]] = None
    err: Optional[Exception] = None

    try:
        t0 = time.perf_counter()
        raw_groups, audit1 = load_universal_model_stages_1_and_2(
            fp,
            unit_mode=params.unit_mode,
            up_axis=params.up_axis,
            nurbs_u_div=params.nurbs_u_div,
            nurbs_v_div=params.nurbs_v_div,
            auto_split_merged_cw=params.auto_split_merged_cw,
            groups_to_auto_split=params.groups_to_auto_split,
            frame_width_threshold_m=params.frame_width_threshold_m,
            spandrel_height_threshold_m=params.spandrel_height_threshold_m,
            restore_filtered=params.restore_filtered,
        )
        t_load = time.perf_counter() - t0
    except Exception as exc:
        t_load = time.perf_counter() - t0
        err = exc

    if audit1 is not None and raw_groups is not None:
        row["kernel"] = audit1.geometry_kernel
        row["unit_detected"] = audit1.detected_unit if audit1.detected_unit is not None else "tidak ada di file"
        row["unit_applied"] = audit1.applied_unit
        row["unit_source"] = audit1.unit_source
        row["up_axis"] = audit1.applied_up_axis
        row["span_x_m"] = audit1.normalized_span_m[0]
        row["span_y_m"] = audit1.normalized_span_m[1]
        row["span_z_m"] = audit1.normalized_span_m[2]
        row["z0_m"] = audit1.z_ground_offset_m
        row["groups_total"] = len(raw_groups)

        role_counts = {k: 0 for k in ROLE_KEYS}
        tot_raw_area = 0.0
        unk_raw_area = 0.0
        for rg in raw_groups:
            cat = rg.default_category if rg.default_category in role_counts else "unknown"
            role_counts[cat] += 1
            ga = _group_mesh_area(rg)
            tot_raw_area += ga
            if cat == "unknown":
                unk_raw_area += ga
        for rk in ROLE_KEYS:
            row[f"groups_{rk}"] = role_counts[rk]
        row["unknown_area_pct"] = round(100.0 * unk_raw_area / tot_raw_area, 2) if tot_raw_area > 1e-6 else 0.0
        row["missing_mesh_faces"] = sum(int(m.get("face_count", 0)) for m in (audit1.missing_mesh or []))

        # Stage 3-5 analysis (cache warm from Stage 1-2)
        t1 = time.perf_counter()
        try:
            res = analyze_building_ottv(fp, os.path.basename(fp), params)
        except Exception as exc:
            err = exc
        t_an = time.perf_counter() - t1

    row["time_load_s"] = round(t_load, 3)
    row["time_analyze_s"] = round(t_an, 3)

    if res is not None:
        audit_r = res["stage1_geometry_audit"]
        f_items = audit_r.get("filtered_items") or []
        row["filtered_count"] = sum(int(it.get("face_count", 0)) for it in f_items)
        row["filtered_area_m2"] = round(sum(float(it.get("area_m2", 0.0)) for it in f_items), 2)
        row["area_glazing_m2"] = res["summary"]["total_glazing_area_m2"]
        row["area_wall_m2"] = res["summary"]["total_opaque_area_m2"]
        by_code = {o["code"]: o for o in res["orientation_breakdown"]}
        for c in ORIENT_CODES:
            row[f"area_{c}"] = by_code[c]["total_area_m2"] if c in by_code else 0.0
        row["wwr"] = round(float(res["summary"]["effective_wwr"]) * 100.0, 2)
        row["ottv_wm2"] = res["ottv_total_wm2"]
        rttv = res.get("rttv") or {}
        row["rttv_wm2"] = rttv["rttv_wm2"] if rttv.get("applicable") else ""
        row["is_provisional"] = res["summary"]["is_provisional"]
        row["warnings"] = ";".join(w["code"] for w in res["summary"]["warnings"])
    elif err is not None:
        row["is_provisional"] = True
        row["warnings"] = f"ERROR:{type(err).__name__}: {str(err)[:90]}"

    if tier == "A" and case_data is not None:
        row["expected_result"] = _check_tier_a_expected(res, err, case_data, fmt)
    else:
        row["expected_result"] = ""

    row["_total_env_area"] = float(res["summary"]["total_envelope_area_m2"]) if res is not None else None
    row["_ottv_val"] = float(res["ottv_total_wm2"]) if res is not None else None
    row["_unexpected_error"] = (
        err is not None and not (tier == "A" and case_data and case_data["expected"].get("error_expected", False))
    )
    return row


def compute_parity(rows: List[Dict[str, Any]]) -> None:
    by_pg: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        pg = r["parity_group"]
        if pg:
            by_pg.setdefault(pg, []).append(r)

    for pg, grp in by_pg.items():
        if len(grp) < 2:
            for r in grp:
                r["parity_group"] = ""
                r["parity_ok"] = ""
            continue
        if any(r["_total_env_area"] is None or r["_ottv_val"] is None for r in grp):
            ok = False
        else:
            areas = [r["_total_env_area"] for r in grp]
            ottvs = [r["_ottv_val"] for r in grp]
            a_min, a_max = min(areas), max(areas)
            rel_diff = (a_max - a_min) / max(1e-6, a_max)
            ottv_diff = max(ottvs) - min(ottvs)
            ok = (rel_diff <= 0.005) and (ottv_diff <= 0.1)
        for r in grp:
            r["parity_ok"] = "OK" if ok else "FAIL"


def write_outputs(rows: List[Dict[str, Any]]) -> None:
    csv_path = os.path.join(ROOT_DIR, "docs", "RAPOR_MODEL.csv")
    md_path = os.path.join(ROOT_DIR, "docs", "RAPOR_MODEL.md")

    with open(csv_path, "w", newline="", encoding="utf-8") as fc:
        writer = csv.DictWriter(fc, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in CSV_COLUMNS})

    # Ringkasan
    tier_counts = {t: sum(1 for r in rows if r["tier"] == t) for t in ("A", "B", "C")}
    tier_a_rows = [r for r in rows if r["tier"] == "A"]
    tier_a_pass = sum(1 for r in tier_a_rows if str(r["expected_result"]).startswith("PASS"))
    tier_a_fail = len(tier_a_rows) - tier_a_pass

    parity_groups = sorted({r["parity_group"] for r in rows if r["parity_group"]})
    parity_fail = sorted({r["parity_group"] for r in rows if r["parity_group"] and r["parity_ok"] != "OK"})
    err_files = [r["file"] for r in rows if r["_unexpected_error"]]
    slow_files = [
        f"{r['file']} ({float(r['time_load_s']) + float(r['time_analyze_s']):.1f}s)"
        for r in rows
        if (float(r["time_load_s"] or 0.0) + float(r["time_analyze_s"] or 0.0)) > 60.0
    ]

    tier_b_unk_unwarned = [
        r["file"]
        for r in rows
        if r["tier"] == "B"
        and float(r["unknown_area_pct"] or 0.0) >= 20.0
        and not r["warnings"]
    ]

    today = datetime.date.today().isoformat()
    md: List[str] = [
        "# RAPOR EVALUASI RAGAM MODEL — Fase 1c",
        "",
        f"Tanggal evaluasi: `{today}` · Konfigurasi: `ProjectConfig()` default (`mode=sni`, `sf_source=template_prodi`, Jakarta, `north=0°`).",
        "",
        "## Ringkasan",
        "",
        f"- **Jumlah file per tingkat:** Tingkat A (sintetis) = **{tier_counts['A']}** · Tingkat B (publik) = **{tier_counts['B']}** · Tingkat C (nyata) = **{tier_counts['C']}** · Total = **{len(rows)}** file",
        f"- **Tingkat A (21 kasus sintetis):** **{tier_a_pass} PASS** / **{tier_a_fail} FAIL**",
        f"- **Paritas antarformat:** **{len(parity_groups) - len(parity_fail)}/{len(parity_groups)} OK**" + (f" (gagal: {', '.join(parity_fail)})" if parity_fail else " (0 gagal)"),
        f"- **File error tak terduga:** **{len(err_files)}**" + (f" (`{', '.join(err_files)}`)" if err_files else ""),
        f"- **File > 60 detik:** **{len(slow_files)}**" + (f" ({', '.join(slow_files)})" if slow_files else ""),
        f"- **Tingkat B unknown >= 20% tanpa peringatan:** **{len(tier_b_unk_unwarned)}**",
        "",
        "CSV lengkap (semua 50 kolom): [`docs/RAPOR_MODEL.csv`](RAPOR_MODEL.csv).",
        "",
    ]

    def _append_table(title: str, sub_rows: List[Dict[str, Any]], cols: List[str]) -> None:
        md.append(f"## {title}")
        md.append("")
        if not sub_rows:
            md.append("_Belum ada file pada tingkat ini._")
            md.append("")
            return
        md.append("| " + " | ".join(cols) + " |")
        md.append("|" + "|".join("---" for _ in cols) + "|")
        for r in sub_rows:
            vals = [str(r.get(c, "")).replace("|", "/") for c in cols]
            md.append("| " + " | ".join(vals) + " |")
        md.append("")

    # Tampilkan seluruh kolom penuh per tingkat (terpecah per tingkat agar mudah dibaca, lengkap semua kolom §5)
    _append_table("Tingkat B — Korpus Publik", [r for r in rows if r["tier"] == "B"], CSV_COLUMNS)
    _append_table("Tingkat C — Korpus Nyata (`corpus/real/`)", [r for r in rows if r["tier"] == "C"], CSV_COLUMNS)
    _append_table("Tingkat A — 21 Kasus Sintetis (`fixtures/synthetic/`)", [r for r in rows if r["tier"] == "A"], CSV_COLUMNS)

    with open(md_path, "w", encoding="utf-8") as fm:
        fm.write("\n".join(md) + "\n")

    print(f"Ditulis: {csv_path} dan {md_path}")
    print(f"Ringkasan: A={tier_counts['A']} ({tier_a_pass} PASS/{tier_a_fail} FAIL), B={tier_counts['B']}, C={tier_counts['C']}, parity_fail={len(parity_fail)}, errors={len(err_files)}, >60s={len(slow_files)}")


def main() -> None:
    targets = _discover_targets()
    print(f"Mengevaluasi {len(targets)} file (A/B/C)...")
    rows: List[Dict[str, Any]] = []
    for i, t in enumerate(targets, 1):
        print(f"  [{i:3d}/{len(targets)}] [{t['tier']}] {t['rel']} ...", flush=True)
        r = evaluate_target(t)
        rows.append(r)
        print(
            f"           -> A_glz={r['area_glazing_m2']} A_wal={r['area_wall_m2']} "
            f"WWR={r['wwr']}% OTTV={r['ottv_wm2']} unk={r['unknown_area_pct']}% "
            f"t={r['time_load_s']}+{r['time_analyze_s']}s {r['expected_result']} {r['warnings']}",
            flush=True,
        )
    compute_parity(rows)
    write_outputs(rows)


if __name__ == "__main__":
    main()
