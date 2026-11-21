/**
 * Screen 4: Hasil (`docs/FASE4_UI_SPEC.md` §3.4 + mockup 4-hasil.html & 4b-hasil-gelap.html).
 * - Viewer in Heatmap per arah mode (switchable to Klasifikasi).
 * - Side column: OTTV total hero, Per arah (8 horizontal bars + 35 W/m² dashed line),
 *   RTTV & heat term summary, single "Unduh laporan (.xlsx)" and "Unduh proyek (.ottv.json)".
 */

import { fmtId } from '../ui/escapeHtml.js';
import { compassDialSvg, icon } from '../ui/icons.js';
import { ottvToHeatCssVar } from '../viewer/modes.js';
import { renderViewerBottomBar } from '../viewer/vbar.js';
import { viewer } from '../viewer/viewer.js';

const CANONICAL_ORIENTATIONS = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'];

export function renderResultsScreen(state, handlers) {
  const main = document.createElement('main');
  main.className = 'main main-results';

  const analysis = state.analysisData || {};
  const summary = analysis.summary || {};
  const ottv = Number(analysis.ottv_total_wm2 ?? 0);
  const sniLimit = Number(analysis.sni_limit_wm2 ?? 35);
  const wwrPct = Number(summary.effective_wwr ?? 0) * 100;
  const avgSc = Number(summary.avg_sc_effective ?? 0);
  const isProvisional = Boolean(summary.is_provisional);
  const isCompliant = ottv <= sniLimit;
  const warnings = summary.warnings || analysis.warnings || [];
  const orientList = analysis.orientation_breakdown || [];
  const orientByCode = new Map(orientList.map((o) => [o.code, o]));
  const rttv = analysis.rttv || null;

  // Left: 3D Viewer
  const viewerSec = document.createElement('section');
  viewerSec.className = 'viewer';
  viewerSec.setAttribute('aria-label', 'Viewer 3D hasil OTTV');

  const canvasHost = document.createElement('div');
  canvasHost.className = 'viewer-canvas-host';
  viewerSec.appendChild(canvasHost);

  // Mode bar (Klasifikasi | Heatmap)
  const modeBar = document.createElement('div');
  modeBar.className = 'glass modes';
  modeBar.setAttribute('role', 'toolbar');
  modeBar.setAttribute('aria-label', 'Mode tampilan');

  const isHeat = state.viewerMode !== 'classification';

  const btnCls = document.createElement('button');
  btnCls.type = 'button';
  btnCls.className = isHeat ? '' : 'on';
  btnCls.setAttribute('aria-pressed', isHeat ? 'false' : 'true');
  btnCls.innerHTML = `${icon('grid', 16)}<span>Klasifikasi</span>`;
  btnCls.addEventListener('click', () => handlers.onChangeViewerMode('classification'));

  const btnHeat = document.createElement('button');
  btnHeat.type = 'button';
  btnHeat.className = isHeat ? 'on' : '';
  btnHeat.setAttribute('aria-pressed', isHeat ? 'true' : 'false');
  btnHeat.innerHTML = `${icon('thermometer', 16)}<span>Heatmap</span>`;
  btnHeat.addEventListener('click', () => handlers.onChangeViewerMode('heatmap'));

  modeBar.append(btnCls, btnHeat);
  viewerSec.appendChild(modeBar);

  // Compass (top-right, aligned at top: 16px, height: 52px)
  const northDeg = Number(state.config?.settings?.north_angle_deg || 0);
  const compass = document.createElement('div');
  compass.className = 'glass compass';
  compass.setAttribute('role', 'img');
  compass.setAttribute('aria-label', `Kompas arah utara, ${northDeg} derajat`);
  compass.innerHTML = compassDialSvg(northDeg);
  viewerSec.appendChild(compass);

  // Legend (lifted cleanly above bottom pills)
  const legend = document.createElement('div');
  legend.className = 'legend legend-lifted';
  if (isHeat) {
    legend.innerHTML = `
      <span style="color:var(--ink);">OTTV per arah</span>
      <span class="heat-bar-strip" aria-hidden="true">
        <span style="background:var(--heat-0);"></span>
        <span style="background:var(--heat-1);"></span>
        <span style="background:var(--heat-2);"></span>
        <span style="background:var(--heat-3);"></span>
      </span>
      <span class="num">25 · 32 · 35 W/m²</span>
    `;
  } else {
    legend.innerHTML = `
      <span class="legend-item"><i class="swatch" style="background:var(--data-glazing);"></i>Kaca</span>
      <span class="legend-item"><i class="swatch" style="background:var(--data-wall);"></i>Dinding</span>
      <span class="legend-item"><i class="swatch" style="background:var(--data-shading);"></i>Peneduh</span>
    `;
  }
  viewerSec.appendChild(legend);

  if (handlers.vbarHandlers) {
    viewerSec.appendChild(renderViewerBottomBar(state, handlers.vbarHandlers));
  }

  // Right column (300px)
  const side = document.createElement('div');
  side.className = 'results-col';

  // 1. OTTV total card
  const heroCard = document.createElement('section');
  heroCard.className = 'box';
  heroCard.setAttribute('aria-labelledby', 'ot-title');

  const heroHead = document.createElement('div');
  heroHead.style.display = 'flex';
  heroHead.style.justifyContent = 'space-between';
  heroHead.style.alignItems = 'baseline';
  heroHead.style.gap = '6px';

  const heroTitle = document.createElement('h2');
  heroTitle.id = 'ot-title';
  heroTitle.className = 'lbl';
  heroTitle.style.fontSize = '13px';
  heroTitle.textContent = 'OTTV total';

  const heroMeta = document.createElement('span');
  heroMeta.className = 'lbl num';
  heroMeta.style.fontWeight = '500';
  heroMeta.textContent = `WWR ${fmtId(wwrPct, 1)}% · SC ${fmtId(avgSc, 3)}`;

  heroHead.append(heroTitle, heroMeta);

  const heroVal = document.createElement('p');
  heroVal.className = 'num figure-xl';
  const numSpan = document.createElement('span');
  numSpan.textContent = fmtId(ottv, 2);
  const unitSpan = document.createElement('span');
  unitSpan.className = 'figure-unit';
  unitSpan.textContent = ' W/m²';
  heroVal.append(numSpan, unitSpan);

  const chipRow = document.createElement('div');
  chipRow.style.display = 'flex';
  chipRow.style.gap = '6px';
  chipRow.style.flexWrap = 'wrap';
  chipRow.style.marginTop = '8px';

  if (!isCompliant) {
    const failChip = document.createElement('span');
    failChip.className = 'chip st-fail';
    failChip.innerHTML = `${icon('close', 14)}<span>Tidak memenuhi, batas 35</span>`;
    chipRow.appendChild(failChip);
  } else if (!isProvisional) {
    const okChip = document.createElement('span');
    okChip.className = 'chip st-ok';
    okChip.innerHTML = `${icon('check', 14)}<span>Memenuhi (≤ 35 W/m²)</span>`;
    chipRow.appendChild(okChip);
  }

  if (isProvisional) {
    const provChip = document.createElement('span');
    provChip.className = 'chip st-warn';
    provChip.innerHTML = `${icon('warn', 14)}<span>Sementara</span>`;
    chipRow.appendChild(provChip);
  }

  heroCard.append(heroHead, heroVal, chipRow);

  if (warnings.length > 0) {
    const details = document.createElement('details');
    details.style.marginTop = '10px';
    const sumEl = document.createElement('summary');
    sumEl.className = 'lbl st-warn';
    sumEl.textContent = `Lihat catatan (${warnings.length})`;
    const warnUl = document.createElement('ul');
    warnUl.style.margin = '6px 0 0';
    warnUl.style.paddingLeft = '16px';
    warnUl.style.fontSize = '12px';
    warnUl.style.lineHeight = '17px';
    for (const w of warnings) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = String(w);
      warnUl.appendChild(li);
    }
    details.append(sumEl, warnUl);
    heroCard.appendChild(details);
  }

  if (state.needsRecompute) {
    const recalcBtn = document.createElement('button');
    recalcBtn.type = 'button';
    recalcBtn.className = 'cta';
    recalcBtn.style.width = '100%';
    recalcBtn.style.marginTop = '10px';
    recalcBtn.style.height = '40px';
    recalcBtn.style.fontSize = '13px';
    recalcBtn.innerHTML = `${icon('play', 16)}<span>Hitung ulang OTTV</span>`;
    recalcBtn.addEventListener('click', () => handlers.onRecompute());
    heroCard.appendChild(recalcBtn);
  }

  // 2. Per arah (8 horizontal bars + 35 limit dashed line)
  const orientCard = document.createElement('section');
  orientCard.className = 'box';
  orientCard.setAttribute('aria-labelledby', 'or-title');

  const orHead = document.createElement('div');
  orHead.style.display = 'flex';
  orHead.style.justifyContent = 'space-between';
  orHead.style.alignItems = 'baseline';

  const orTitle = document.createElement('h2');
  orTitle.id = 'or-title';
  orTitle.style.fontSize = '14px';
  orTitle.textContent = 'Per arah (W/m²)';

  const orLimitHint = document.createElement('span');
  orLimitHint.className = 'lbl';
  orLimitHint.style.fontWeight = '500';
  orLimitHint.textContent = 'garis = batas 35';

  orHead.append(orTitle, orLimitHint);

  const maxOrientVal = Math.max(
    70,
    ...orientList.map((o) => Number(o.ottv_orientation_wm2 || 0)),
  );
  const limitPct = Math.min(95, (sniLimit / maxOrientVal) * 100);

  const ol = document.createElement('ol');
  ol.className = 'orient-list';

  for (const code of CANONICAL_ORIENTATIONS) {
    const row = orientByCode.get(code);
    const hasArea = row && Number(row.total_area_m2 || 0) > 0.01;
    const li = document.createElement('li');
    li.className = 'orient-row';

    const codeSpan = document.createElement('span');
    codeSpan.className = 'lbl';
    if (hasArea) codeSpan.style.color = 'var(--ink)';
    codeSpan.textContent = code;

    if (hasArea) {
      const val = Number(row.ottv_orientation_wm2 || 0);
      const widthPct = Math.min(100, Math.max(3, (val / maxOrientVal) * 100));
      const isSelected = state.selectedOrientation === code;

      const track = document.createElement('span');
      track.className = 'orient-track';

      const barBtn = document.createElement('button');
      barBtn.type = 'button';
      barBtn.className = `orient-bar-btn${isSelected ? ' is-selected' : ''}`;
      barBtn.style.width = `${widthPct.toFixed(1)}%`;
      barBtn.style.background = ottvToHeatCssVar(val);
      barBtn.setAttribute('aria-label', `Pilih fasad ${row.name_id || code}, ${fmtId(val, 2)} W/m²`);
      barBtn.title = `${row.name_id || code}: ${fmtId(val, 2)} W/m² (luas ${fmtId(row.total_area_m2, 1)} m²)`;
      barBtn.addEventListener('click', () => {
        handlers.onSelectOrientation(isSelected ? null : code);
      });

      const limitMark = document.createElement('i');
      limitMark.className = 'orient-limit';
      limitMark.style.left = `${limitPct.toFixed(1)}%`;

      track.append(barBtn, limitMark);

      const valSpan = document.createElement('span');
      valSpan.className = 'num';
      valSpan.style.textAlign = 'right';
      valSpan.style.fontWeight = '700';
      valSpan.style.fontSize = '13px';
      valSpan.textContent = fmtId(val, 2);

      li.append(codeSpan, track, valSpan);
    } else {
      const line = document.createElement('span');
      line.className = 'orient-empty-line';
      const dash = document.createElement('span');
      dash.className = 'lbl';
      dash.style.textAlign = 'right';
      dash.style.fontWeight = '500';
      dash.textContent = '–';
      li.append(codeSpan, line, dash);
    }

    ol.appendChild(li);
  }

  orientCard.append(orHead, ol);

  // Selected orientation detail strip
  if (state.selectedOrientation && orientByCode.has(state.selectedOrientation)) {
    const sel = orientByCode.get(state.selectedOrientation);
    const detailDiv = document.createElement('div');
    detailDiv.className = 'glass-thin';
    detailDiv.style.marginTop = '10px';
    detailDiv.style.padding = '8px 10px';
    detailDiv.style.borderRadius = '12px';
    detailDiv.style.fontSize = '12px';
    detailDiv.style.display = 'grid';
    detailDiv.style.gap = '2px';

    const titleLine = document.createElement('div');
    titleLine.style.fontWeight = '700';
    titleLine.textContent = `Fasad ${sel.name_id || sel.code}`;

    const metricLine = document.createElement('div');
    metricLine.className = 'muted num';
    metricLine.textContent = `Luas ${fmtId(sel.total_area_m2, 1)} m² · WWR ${fmtId((sel.wwr || 0) * 100, 1)}% · SF ${fmtId(sel.sni_sf_wm2 || sel.avg_sf_interpolated_wm2, 0)} · SC ${fmtId(sel.avg_sc_effective, 3)}`;

    const noteLine = document.createElement('div');
    noteLine.className = 'lbl';
    noteLine.style.fontWeight = '500';
    noteLine.textContent = 'Status memenuhi atau tidak hanya dinilai dari OTTV total.';

    detailDiv.append(titleLine, metricLine, noteLine);
    orientCard.appendChild(detailDiv);
  }

  // 3. RTTV & Komposisi panas card
  const rttvCard = document.createElement('section');
  rttvCard.className = 'box';
  rttvCard.setAttribute('aria-labelledby', 'rt-title');

  const rtTitle = document.createElement('h2');
  rtTitle.id = 'rt-title';
  rtTitle.style.fontSize = '14px';
  rtTitle.textContent = 'Komposisi panas & RTTV';

  const compGrid = document.createElement('div');
  compGrid.className = 'num';
  compGrid.style.display = 'grid';
  compGrid.style.gridTemplateColumns = '1fr 1fr 1fr';
  compGrid.style.gap = '6px';
  compGrid.style.marginTop = '8px';
  compGrid.style.fontSize = '12px';

  for (const [lbl, val] of [
    ['Dinding', summary.q_wall_conduction_wm2],
    ['Kond. kaca', summary.q_glass_conduction_wm2],
    ['Radiasi', summary.q_solar_radiation_wm2],
  ]) {
    const cell = document.createElement('div');
    cell.className = 'glass-thin';
    cell.style.borderRadius = '10px';
    cell.style.padding = '6px 8px';
    const l = document.createElement('div');
    l.className = 'lbl';
    l.textContent = lbl;
    const v = document.createElement('b');
    v.textContent = `${fmtId(val ?? 0, 2)}`;
    cell.append(l, v);
    compGrid.appendChild(cell);
  }

  const rttvLine = document.createElement('div');
  rttvLine.style.margin = '8px 0 0';
  rttvLine.style.display = 'grid';
  rttvLine.style.gap = '6px';
  if (rttv && rttv.applicable) {
    const rttvVal = Number(rttv.rttv_wm2 ?? 0);
    const rttvLimit = Number(rttv.limit_wm2 ?? 10);
    const rttvOk = rttv.compliant !== undefined && rttv.compliant !== null ? Boolean(rttv.compliant) : rttvVal <= rttvLimit;
    const pTxt = document.createElement('p');
    pTxt.className = 'muted num';
    pTxt.style.margin = '0';
    pTxt.style.fontSize = '12.5px';
    pTxt.textContent = `RTTV atap: ${fmtId(rttvVal, 2)} W/m² (luas atap ${fmtId(rttv.total_roof_area_m2 || 0, 1)} m²).`;

    const rChip = document.createElement('span');
    rChip.className = `chip ${rttvOk ? 'st-ok' : 'st-fail'}`;
    rChip.style.justifySelf = 'start';
    rChip.innerHTML = rttvOk
      ? `${icon('check', 13)}<span>Memenuhi (≤ ${fmtId(rttvLimit, 0)} W/m²)</span>`
      : `${icon('close', 13)}<span>Tidak memenuhi, batas ${fmtId(rttvLimit, 0)}</span>`;
    rttvLine.append(pTxt, rChip);
  } else {
    const pTxt = document.createElement('p');
    pTxt.className = 'muted num';
    pTxt.style.margin = '0';
    pTxt.style.fontSize = '12.5px';
    pTxt.textContent = 'RTTV tidak dihitung (tidak ada atap atau skylight aktif di model).';
    rttvLine.appendChild(pTxt);
  }

  rttvCard.append(rtTitle, compGrid, rttvLine);

  // 4. Downloads at bottom (single Excel button, never say "prodi")
  const dlWrap = document.createElement('div');
  dlWrap.style.display = 'grid';
  dlWrap.style.gap = '8px';
  dlWrap.style.marginTop = 'auto';

  const xlsxBtn = document.createElement('button');
  xlsxBtn.type = 'button';
  xlsxBtn.className = 'cta';
  xlsxBtn.innerHTML = `${icon('download', 18)}<span>Unduh laporan (.xlsx)</span>`;
  xlsxBtn.addEventListener('click', () => handlers.onDownloadExcel());

  const jsonBtn = document.createElement('button');
  jsonBtn.type = 'button';
  jsonBtn.className = 'ghost';
  jsonBtn.style.background = 'var(--glass-thin)';
  jsonBtn.textContent = 'Unduh proyek (.ottv.json)';
  jsonBtn.addEventListener('click', () => handlers.onDownloadProject());

  dlWrap.append(xlsxBtn, jsonBtn);

  side.append(heroCard, orientCard, rttvCard, dlWrap);
  main.append(viewerSec, side);

  window.requestAnimationFrame(() => {
    if (canvasHost.isConnected) {
      viewer.setRightInsetPx(0);
      viewer.mount(canvasHost, {
        onPickGroup: (meta) => {
          if (meta?.orientationCode) {
            handlers.onSelectOrientation(
              state.selectedOrientation === meta.orientationCode ? null : meta.orientationCode,
            );
          } else {
            handlers.onSelectOrientation(null);
          }
        },
      });
      viewer.syncState(state);
    }
  });

  return main;
}
