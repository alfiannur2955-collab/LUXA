"""
Uji A3-16 (Status 4 kondisi: memenuhi | melebihi | simulasi | sementara):
- Engine (`resolve_result_status`, `analyze_building_ottv`, `rematerial_analysis`) + payload ramping (`slim_analysis`, `slim_rematerial`).
- Laporan Excel (`luxa_report`) dan PDF (`report_exporter`).
- Tampilan JS (`verdict.js`, `present/content.js`, `report/reportHtml.js`, `report/reportA3.js`, `report/mockupA3.js`).
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys

import openpyxl
import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FIXTURES_DIR = os.path.join(ROOT_DIR, "fixtures")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config_schema import ProjectConfig, SettingsConfig
from luxa_report import generate_luxa_report as generate_excel_report
from ottv_engine import analyze_building_ottv, resolve_result_status
from payload import slim_analysis, slim_rematerial
from recommender import rematerial_analysis
from report_exporter import generate_pdf_report


def test_resolve_result_status_4_kondisi():
    """resolve_result_status mengembalikan tepat 4 verdict: memenuhi | melebihi | simulasi | sementara."""
    prov, lbl, comp, v = resolve_result_status(23.98, [], is_sni_mode=False)
    assert (prov, comp, v) == (False, False, "simulasi")
    assert "MELEBIHI" not in lbl.upper() and "LEWAT" not in lbl.upper() and "MEMENUHI" not in lbl.upper()

    prov, lbl, comp, v = resolve_result_status(37.52, [], is_sni_mode=True)
    assert (prov, comp, v) == (False, False, "melebihi")
    assert "MELEBIHI" in lbl.upper()

    prov, lbl, comp, v = resolve_result_status(32.48, [], is_sni_mode=True)
    assert (prov, comp, v) == (False, True, "memenuhi")
    assert "MEMENUHI" in lbl.upper()

    prov, lbl, comp, v = resolve_result_status(20.00, [{"code": "MATERIAL_NOT_CONFIRMED", "message": "x"}], is_sni_mode=True)
    assert (prov, comp, v) == (True, False, "sementara")
    assert "SEMENTARA" in lbl.upper()
    assert "MEMENUHI" not in lbl.upper() and "MELEBIHI" not in lbl.upper()


def test_engine_rematerial_dan_payload_ramping_membawa_verdict():
    """verdict hadir di hasil penuh, rematerial, dan payload ramping untuk keempat kondisi."""
    hb = os.path.join(FIXTURES_DIR, "Honeybee_MultiZone_Office_3F.hbjson")

    # 1. Sementara (materials_confirmed=False)
    res_prov = analyze_building_ottv(hb, "Honeybee_MultiZone_Office_3F.hbjson", ProjectConfig().to_envelope_parameters())
    assert res_prov["verdict"] == "sementara"
    assert res_prov["summary"]["verdict"] == "sementara"
    assert slim_analysis(res_prov)["verdict"] == "sementara"

    # 2. Rematerial -> konfirmasi -> SNI memenuhi
    rem_ok = rematerial_analysis(res_prov, materials_confirmed=True)
    assert rem_ok["verdict"] == "memenuhi"
    assert rem_ok["summary"]["verdict"] == "memenuhi"
    assert slim_rematerial(rem_ok)["verdict"] == "memenuhi"

    # 3. Mode simulasi -> verdict == 'simulasi' (baik hitung penuh maupun rematerial)
    cfg_sim = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="simulasi"))
    res_sim = analyze_building_ottv(hb, "Honeybee_MultiZone_Office_3F.hbjson", cfg_sim.to_envelope_parameters())
    assert res_sim["verdict"] == "simulasi"
    assert res_sim["summary"]["verdict"] == "simulasi"
    assert slim_analysis(res_sim)["verdict"] == "simulasi"
    rem_sim = rematerial_analysis(res_sim, glazing_material_id="glz_igu_triple_silver", materials_confirmed=True)
    assert rem_sim["verdict"] == "simulasi"
    assert slim_rematerial(rem_sim)["verdict"] == "simulasi"


def test_excel_dan_pdf_menghormati_4_verdict():
    """Excel & PDF tidak pernah menulis Memenuhi/Melebihi pada mode simulasi atau hasil sementara."""
    hb = os.path.join(FIXTURES_DIR, "Honeybee_MultiZone_Office_3F.hbjson")
    cfg_sim = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="simulasi"))
    res_sim = analyze_building_ottv(hb, "Honeybee_MultiZone_Office_3F.hbjson", cfg_sim.to_envelope_parameters())

    wb_sim = openpyxl.load_workbook(io.BytesIO(generate_excel_report(res_sim)))
    ws = wb_sim["Ringkasan"]
    # Cari sel status di sebelah "OTTV total (W/m²)"
    status_val = None
    for row in ws.iter_rows():
        if row[0].value == "OTTV total (W/m²)":
            status_val = str(row[2].value or "")
            break
    assert status_val is not None
    assert "Simulasi — bukan untuk kepatuhan" in status_val
    assert "Melebihi" not in status_val and "Lewat" not in status_val and "Memenuhi" not in status_val

    # Hasil sementara
    res_prov = analyze_building_ottv(hb, "Honeybee_MultiZone_Office_3F.hbjson", ProjectConfig().to_envelope_parameters())
    wb_prov = openpyxl.load_workbook(io.BytesIO(generate_excel_report(res_prov)))
    ws_p = wb_prov["Ringkasan"]
    status_p = None
    for row in ws_p.iter_rows():
        if row[0].value == "OTTV total (W/m²)":
            status_p = str(row[2].value or "")
            break
    assert status_p is not None and "Hasil sementara" in status_p
    assert "Memenuhi" not in status_p and "Melebihi" not in status_p

    # SNI melebihi (uji langsung lewat stub salinan hasil 37,52)
    res_fail = dict(res_prov)
    res_fail["verdict"] = "melebihi"
    res_fail["compliant"] = False
    res_fail["ottv_total_wm2"] = 37.52
    res_fail["summary"] = {**res_prov["summary"], "is_provisional": False, "verdict": "melebihi"}
    wb_fail = openpyxl.load_workbook(io.BytesIO(generate_excel_report(res_fail)))
    ws_f = wb_fail["Ringkasan"]
    status_f = None
    for row in ws_f.iter_rows():
        if row[0].value == "OTTV total (W/m²)":
            status_f = str(row[2].value or "")
            break
    assert status_f is not None and "Melebihi — Lewat" in status_f and "Di bawah batas" in status_f

    # PDF valid untuk simulasi & sementara
    assert generate_pdf_report(res_sim).startswith(b"%PDF")
    assert generate_pdf_report(res_prov).startswith(b"%PDF")


def test_frontend_verdict_dan_laporan_html_a3_presentasi():
    """Uji langsung modul JS frontend (verdict.js, present/content.js, reportHtml.js, reportA3.js, mockupA3.js):
    - Simulasi 23,98 TIDAK pernah menghasilkan 'Melebihi' atau 'Lewat'
    - SNI 37,52 -> 'Melebihi' dan 'Lewat 2,52'
    - SNI 32,48 -> 'Memenuhi' dan 'Di bawah batas 2,52'
    - Sementara -> 'Hasil sementara', tanpa Memenuhi/Melebihi di angka utama.
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js tidak tersedia")

    script = r"""
import assert from 'node:assert/strict';
import { getVerdict, verdictInfo, sideVerdict } from './frontend/src/ui/verdict.js';
import { renderCard } from './frontend/src/present/content.js';
import { buildReportHtml } from './frontend/src/report/reportHtml.js';
import { buildReportA3 } from './frontend/src/report/reportA3.js';
import { buildMockup } from './frontend/src/report/mockupA3.js';

function makeAnalysis({ ottv, verdict, mode = 'sni', isProv = false }) {
  return {
    filename: 'Fasad_Tower_Twisted.3dm',
    format: '3DM',
    calculation_mode: mode,
    mode_label: mode === 'sni' ? 'Kepatuhan SNI 6389:2020' : 'Eksplorasi — bukan untuk kepatuhan',
    ottv_total_wm2: ottv,
    sni_limit_wm2: 35,
    margin_to_limit_wm2: Number((35 - ottv).toFixed(2)),
    compliant: verdict === 'memenuhi',
    verdict,
    status_label: verdict,
    sf_source_label: 'Tabel 8 SNI 6389:2020',
    location_info: { city: 'Jakarta', latitude_deg: -6.2, sf_table: { U: 130, TL: 113, T: 112, TGR: 97, S: 97, BD: 176, B: 243, BL: 211 } },
    summary: {
      is_provisional: isProv,
      verdict,
      total_floors: 10,
      total_envelope_area_m2: 1000,
      total_glazing_area_m2: 600,
      effective_wwr: 0.6,
      avg_sc_effective: 0.25,
      avg_shaded_fraction: 0.2,
      avg_u_cog_wm2k: 1.1,
      avg_u_fen_wm2k: 2.85,
      u_frame_eff_wm2k: 8.0,
      total_a_frame_m2: 80,
      total_a_edge_m2: 120,
      frame_width_mm: 87.6,
      frame_source: 'terukur',
      frame_ratio_pct: 13.3,
      q_wall_conduction_wm2: 1.5,
      q_glass_conduction_wm2: 8.5,
      q_solar_radiation_wm2: Math.max(1, ottv - 10),
      active_materials: {
        glazing_id: 'glz_igu_triple_silver', glazing_name: 'Kaca Uji', glazing_brand: 'Uji',
        u_cog: 1.1, u_fenestration: 2.85, sc_glass: 0.25, shgc_glass: 0.22, delta_t: 5,
        wall_id: 'wal_test', wall_name: 'Dinding Uji', wall_brand: 'Uji', u_wall: 0.6, alpha_wall: 0.4, td_ek: 15,
        frame_id: 'frm_aluminium_standar', frame_name: 'Aluminium', u_frame: 8.0,
      },
    },
    orientation_breakdown: [
      { code: 'U', name_id: 'Utara', total_area_m2: 250, wall_area_m2: 100, glazing_area_m2: 150, wwr: 0.6, sni_sf_wm2: 130, ottv_orientation_wm2: ottv - 2, q_wall_conduction_wm2: 1.5, q_glass_conduction_wm2: 8.5, q_solar_radiation_wm2: Math.max(1, ottv - 12), manual_calc: { ao_m2: 250, wwr: 0.6, alpha: 0.4, u_wall: 0.6, td_ek: 15, u_f: 2.85, delta_t: 5, sc_k: 0.25, sc_eff: 0.9, sf: 130 } },
      { code: 'B', name_id: 'Barat', total_area_m2: 250, wall_area_m2: 100, glazing_area_m2: 150, wwr: 0.6, sni_sf_wm2: 243, ottv_orientation_wm2: ottv + 2, q_wall_conduction_wm2: 1.5, q_glass_conduction_wm2: 8.5, q_solar_radiation_wm2: Math.max(1, ottv - 8), manual_calc: { ao_m2: 250, wwr: 0.6, alpha: 0.4, u_wall: 0.6, td_ek: 15, u_f: 2.85, delta_t: 5, sc_k: 0.25, sc_eff: 0.9, sf: 243 } },
    ],
    floor_breakdown: [{ floor_number: 1, floor_label: 'L1', total_area_m2: 1000, ottv_floor_wm2: ottv }],
  };
}

const heatColor = () => '#e8890c';

// 1. Simulasi 23,98 -> TIDAK BOLEH ada kata "Melebihi" atau "Lewat"
const simA = makeAnalysis({ ottv: 23.98, verdict: 'simulasi', mode: 'simulasi' });
assert.equal(getVerdict(simA), 'simulasi');
const svSim = sideVerdict(25.98, 35, 'simulasi');
assert.equal(svSim.tone, 'neutral');
assert.equal(svSim.text, 'Simulasi');

const slides = ['sampul', 'ottv', 'sisi', 'terpanas', 'kaca', 'penutup'];
for (const id of slides) {
  const html = renderCard({ id, name: id }, { index: 0, total: 6, analysis: simA, userName: 'Uji', heatColor });
  assert.ok(!/\bmelebihi\b/i.test(html), `Presentasi slide ${id} simulasi tidak boleh memuat 'Melebihi': ${html}`);
  assert.ok(!/\blewat\s+\d/i.test(html), `Presentasi slide ${id} simulasi tidak boleh memuat 'Lewat X': ${html}`);
}
const rHtmlSim = buildReportHtml({ analysisData: simA, materials: [], config: { settings: {} } }).html;
assert.ok(rHtmlSim.includes('Simulasi — bukan untuk kepatuhan'));
assert.ok(!/\bmelebihi\b/i.test(rHtmlSim), 'reportHtml simulasi tidak boleh memuat Melebihi');
assert.ok(!/\blewat\s+\d/i.test(rHtmlSim), 'reportHtml simulasi tidak boleh memuat Lewat X');

const rA3Sim = buildReportA3({ analysisData: simA, sunHour: 15, sunDate: '2026-09-23' }, { assets: {} }).html;
assert.ok(rA3Sim.includes('Simulasi — bukan untuk kepatuhan'));
assert.ok(!/\bmelebihi\b/i.test(rA3Sim), 'reportA3 simulasi tidak boleh memuat Melebihi');
assert.ok(!/\blewat\s+\d/i.test(rA3Sim), 'reportA3 simulasi tidak boleh memuat Lewat X');

const mockSim = buildMockup({ analysisData: simA, sunHour: 15, sunDate: '2026-09-23' }, { assets: {} });
assert.ok(mockSim.includes('Simulasi — bukan untuk kepatuhan'));
assert.ok(!/\bmelebihi\b/i.test(mockSim), 'mockupA3 simulasi tidak boleh memuat Melebihi');
assert.ok(!/\blewat\s+\d/i.test(mockSim), 'mockupA3 simulasi tidak boleh memuat Lewat X');

// 2. SNI 37,52 -> Melebihi, Lewat 2,52
const failA = makeAnalysis({ ottv: 37.52, verdict: 'melebihi', mode: 'sni' });
const viFail = verdictInfo(failA, 2);
assert.equal(viFail.verdict, 'melebihi');
assert.equal(viFail.badge, 'Melebihi');
assert.equal(viFail.delta.short, 'Lewat 2,52 W/m²');
const cardFail = renderCard({ id: 'ottv', name: 'OTTV' }, { index: 1, total: 6, analysis: failA, userName: 'Uji', heatColor });
assert.ok(cardFail.includes('Melebihi') && cardFail.includes('Lewat 2,52'));
const rHtmlFail = buildReportHtml({ analysisData: failA, materials: [], config: { settings: {} } }).html;
assert.ok(rHtmlFail.includes('Melebihi') && rHtmlFail.includes('Lewat 2,52'));

// 3. SNI 32,48 -> Memenuhi, Di bawah batas 2,52
const okA = makeAnalysis({ ottv: 32.48, verdict: 'memenuhi', mode: 'sni' });
const viOk = verdictInfo(okA, 2);
assert.equal(viOk.verdict, 'memenuhi');
assert.equal(viOk.badge, 'Memenuhi');
assert.equal(viOk.delta.short, 'Di bawah batas 2,52 W/m²');

// 4. Sementara -> Hasil sementara, tanpa Memenuhi/Melebihi di angka utama
const provA = makeAnalysis({ ottv: 28.00, verdict: 'sementara', mode: 'sni', isProv: true });
const viProv = verdictInfo(provA, 2);
assert.equal(viProv.verdict, 'sementara');
assert.equal(viProv.badge, 'Hasil sementara');
const cardProv = renderCard({ id: 'ottv', name: 'OTTV' }, { index: 1, total: 6, analysis: provA, userName: 'Uji', heatColor });
assert.ok(cardProv.includes('Hasil sementara'));
assert.ok(!cardProv.includes('Memenuhi') && !cardProv.includes('Melebihi'));
console.log('ALL_VERDICT_JS_CHECKS_OK');
"""
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        cwd=ROOT_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    assert proc.returncode == 0, f"Node test gagal:\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
    assert "ALL_VERDICT_JS_CHECKS_OK" in proc.stdout


def test_mode_terlihat_lencana_tombol_dan_reset_unggah():
    """A3-17: lencana Mode SNI/Mode Simulasi, tombol 'Kembali ke mode SNI', dan reset mode ke SNI saat unggah model baru."""
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js tidak tersedia")

    script = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { modeBadgeInfo, resetConfigModeToSni } from './frontend/src/ui/verdict.js';

const sniInfo = modeBadgeInfo({ calculation_mode: 'sni' });
assert.equal(sniInfo.label, 'Mode SNI');
assert.equal(sniInfo.showReturnToSni, false);

const simInfo = modeBadgeInfo({ calculation_mode: 'simulasi' });
assert.equal(simInfo.label, 'Mode Simulasi');
assert.equal(simInfo.showReturnToSni, true);
assert.equal(simInfo.returnLabel, 'Kembali ke mode SNI');

const cfg = { settings: { mode: 'simulasi', city_preset: 'jakarta' } };
resetConfigModeToSni(cfg);
assert.equal(cfg.settings.mode, 'sni');

// Verifikasi wiring di Results, Presenter, dan main.js
const resJs = fs.readFileSync('./frontend/src/steps/results.js', 'utf8');
assert.ok(resJs.includes('modeBadgeInfo') && resJs.includes('onSwitchToSniMode'));
const presJs = fs.readFileSync('./frontend/src/present/presenter.js', 'utf8');
assert.ok(presJs.includes('modeBadgeInfo') && presJs.includes('onSwitchToSni'));
const mainJs = fs.readFileSync('./frontend/src/main.js', 'utf8');
assert.ok(mainJs.includes('resetModeToSni: true') && mainJs.includes('handleSwitchToSniMode'));
console.log('MODE_BADGE_CHECKS_OK');
"""
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        cwd=ROOT_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    assert proc.returncode == 0, f"Node test gagal:\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
    assert "MODE_BADGE_CHECKS_OK" in proc.stdout
