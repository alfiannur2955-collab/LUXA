/**
 * Screen 4: Hasil (`docs/FASE4_UI_SPEC.md` §3.4 + mockup 4-hasil.html & 4b-hasil-gelap.html).
 * - Viewer in Heatmap per arah mode (switchable to Klasifikasi).
 * - Side column: OTTV total hero, Per arah (8 horizontal bars + 35 W/m² dashed line),
 *   RTTV & heat term summary, single "Unduh laporan (.xlsx)" and "Unduh proyek (.ottv.json)".
 */

import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { makeTermTip } from '../ui/tooltips.js';
import { renderInteractiveCompass } from '../viewer/compass.js';
import { renderFormulaPill } from '../viewer/formulaPill.js';
import {
  ORIENTATION_CODES,
  buildOrientationRingLegendSvg,
  buildExposureGradientCss,
  horizontalNeutralColor,
  orientationToCssColor,
  ottvToHeatCssVar,
  readThemeTokens,
} from '../viewer/modes.js';
import { renderViewerModeBar } from '../viewer/modeBar.js';
import { summarizeSelectedPanels } from '../viewer/selection.js';
import { renderViewerBottomBar } from '../viewer/vbar.js';
import { smoothLegendTicksHtml, viewer } from '../viewer/viewer.js';

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

  const viewerStage = document.createElement('div');
  viewerStage.className = 'viewer-stage';

  const canvasHost = document.createElement('div');
  canvasHost.className = 'viewer-canvas-host';
  viewerStage.appendChild(canvasHost);
  viewerSec.appendChild(viewerStage);

  // Mode bar (Klasifikasi, Orientasi, Heatmap | Kejanggalan, X-ray)
  const activeMode = state.viewerMode || 'heatmap';
  const modeBarEl = renderViewerModeBar({ ...state, viewerMode: activeMode }, handlers.onChangeViewerMode);
  const modeAtBottom = state.workspace?.modeBarPosition === 'bottom';
  if (!modeAtBottom) {
    viewerSec.appendChild(modeBarEl);
  }

  // Interactive North Compass (top-right, aligned at top: 16px, height: 52px) + Hitung ulang chip
  viewerStage.appendChild(
    renderInteractiveCompass(state, {
      onChangeNorth: handlers.onChangeNorth,
      onRecompute: handlers.onRecompute,
    }),
  );

  // Draggable & expandable Formula Pill (top-right, left of compass: top 16px, right 76px, height 52px)
  const formulaPill = renderFormulaPill(state, {
    onToggleExpand: handlers.onToggleFormulaPill,
  });
  if (formulaPill) viewerStage.appendChild(formulaPill);

  // Bottom overlay stack (T2): legend always sits 12px above bottom pills regardless of pill wrapping
  const bottomStack = document.createElement('div');
  bottomStack.className = 'viewer-bottom-stack';
  if (modeAtBottom) {
    bottomStack.appendChild(modeBarEl);
  }

  // Legend (lifted cleanly above bottom pills; shifts right if Tampilan card is open)
  const legend = document.createElement('div');
  legend.className = `legend legend-lifted${state.activeRailCard ? ' legend-shifted' : ''}`;

  if (state.facadeFilter === 'sunlit_now') {
    const hLabel = `${String(Math.round(Number(state.sunHour ?? 13))).padStart(2, '0')}.00`;
    legend.innerHTML = `
      <span class="legend-item"><i class="swatch" style="background:var(--heat-1);"></i>Terkena matahari, ${hLabel}</span>
      <span class="legend-item"><i class="swatch" style="background:var(--data-wall);"></i>Tidak terkena</span>
    `;
  } else if (activeMode === 'heatmap') {
    const gran = state.heatmapGranularity || 'orientation';
    const isSmooth = Boolean(state.heatmapSmooth);
    legend.title = 'Heatmap OTTV (W/m²): per arah atau per panel';
    legend.setAttribute('aria-label', 'Legenda heatmap OTTV');

    const toggleWrap = document.createElement('div');
    toggleWrap.className = 'legend-toggle';
    toggleWrap.setAttribute('role', 'radiogroup');
    toggleWrap.setAttribute('aria-label', 'Skala heatmap');

    for (const [id, lbl] of [
      ['orientation', 'Arah'],
      ['panel', 'Panel'],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.className = gran === id ? 'on' : '';
      b.setAttribute('aria-checked', gran === id ? 'true' : 'false');
      b.setAttribute('aria-pressed', gran === id ? 'true' : 'false');
      b.textContent = lbl;
      b.title = id === 'orientation' ? 'Warna rata-rata per arah' : 'Warna per panel';
      b.addEventListener('click', () => handlers.onChangeHeatmapGranularity(id));
      toggleWrap.appendChild(b);
    }

    // S4: Continuous 168 px gradient bar with 0, 25, "35 batas" (ink mark at 58.3%), 60
    const gradWrap = document.createElement('span');
    gradWrap.className = 'heat-grad-wrap';

    const gradBar = document.createElement('span');
    gradBar.className = 'heat-grad-bar';
    gradBar.setAttribute('aria-hidden', 'true');
    if (isSmooth) {
      gradBar.style.background = buildExposureGradientCss(readThemeTokens());
    }
    const limitMark = document.createElement('i');
    limitMark.className = 'heat-grad-limit';
    gradBar.appendChild(limitMark);

    const gradTicks = document.createElement('span');
    gradTicks.className = 'heat-grad-ticks num';
    if (isSmooth) {
      // Halus: paparan matahari (W/m²) relatif terhadap model ini; tidak mengubah hasil hitung.
      gradTicks.setAttribute('data-luxa-smooth-legend', '');
      gradTicks.innerHTML = smoothLegendTicksHtml(viewer.lastSmoothRange);
      limitMark.style.display = 'none';
      gradWrap.title =
        'Paparan matahari (W/m²), kiri rendah, kanan tinggi: SF menurut arah hadap tiap titik' +
        (gran === 'panel' ? ' × faktor peneduh panel.' : '.') +
        ' Hanya tampilan; angka OTTV tidak berubah.';
    } else {
      gradTicks.innerHTML = '<span>0</span><span>25</span><span class="is-limit">35 batas</span><span>60</span>';
    }
    gradWrap.append(gradBar, gradTicks);

    // S4: Halus vertex-smoothing toggle switch (default off)
    const smoothLbl = document.createElement('label');
    smoothLbl.className = 'legend-smooth-lbl';
    const smoothCb = document.createElement('input');
    smoothCb.type = 'checkbox';
    smoothCb.setAttribute('role', 'switch');
    smoothCb.checked = isSmooth;
    smoothCb.setAttribute('aria-checked', isSmooth ? 'true' : 'false');
    smoothCb.addEventListener('change', () => handlers.onToggleHeatmapSmooth?.(smoothCb.checked));
    smoothLbl.append(smoothCb, document.createTextNode(' Halus'));

    legend.append(toggleWrap, gradWrap, smoothLbl);

    if (isSmooth) {
      const smNote = document.createElement('span');
      smNote.className = 'legend-smooth-note';
      smNote.textContent = 'paparan matahari';
      smNote.title = 'Warna dihitung per titik: SF diinterpolasi di antara 8 arah sesuai arah hadap fasad';
      legend.appendChild(smNote);
    }
  } else if (activeMode === 'orientation') {
    const tokens = readThemeTokens();
    const cHoriz = horizontalNeutralColor(tokens);
    const hRgb = `rgb(${Math.round(Math.pow(cHoriz.r, 1 / 2.2) * 255)}, ${Math.round(Math.pow(cHoriz.g, 1 / 2.2) * 255)}, ${Math.round(Math.pow(cHoriz.b, 1 / 2.2) * 255)})`;
    legend.innerHTML = `
      <span class="legend-item" style="gap:8px;">
        ${buildOrientationRingLegendSvg(tokens)}
        <span>Warna menurut arah hadap</span>
      </span>
      <span class="legend-item"><i class="swatch" style="background:${hRgb};"></i>Atap / datar</span>
    `;
  } else if (activeMode === 'anomalies') {
    legend.innerHTML = `
      <span class="legend-item"><i class="swatch" style="background:var(--warn);"></i>Perlu diperiksa</span>
      <span class="legend-item"><i class="swatch" style="background:var(--data-wall);opacity:0.35;"></i>Elemen lain</span>
    `;
  } else if (activeMode === 'xray') {
    legend.innerHTML = `
      <span class="legend-item"><i class="swatch" style="background:var(--data-glazing);opacity:0.4;"></i>Selubung transparan</span>
      <span class="legend-item"><i class="swatch" style="border:1.5px dashed var(--warn);background:transparent;"></i>Disaring / nonaktif</span>
    `;
  } else {
    legend.innerHTML = `
      <span class="legend-item"><i class="swatch" style="background:var(--data-glazing);"></i>Kaca</span>
      <span class="legend-item"><i class="swatch" style="background:var(--data-wall);"></i>Dinding</span>
      <span class="legend-item"><i class="swatch" style="background:var(--data-shading);"></i>Peneduh</span>
    `;
  }
  bottomStack.appendChild(legend);

  if (handlers.vbarHandlers) {
    bottomStack.appendChild(renderViewerBottomBar(state, handlers.vbarHandlers));
  }
  viewerSec.appendChild(bottomStack);

  // Presentation mode exit pill (`Esc` also exits)
  if (state.workspace?.preset === 'presentasi') {
    const exitPres = document.createElement('button');
    exitPres.type = 'button';
    exitPres.className = 'glass pres-exit-chip';
    exitPres.innerHTML = `${icon('close', 14)}<span>Keluar Presentasi</span><kbd>Esc</kbd>`;
    exitPres.addEventListener('click', () => handlers.onExitPresentation?.());
    viewerStage.appendChild(exitPres);
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

  const tooltipsOn = (state.workspace?.preset || 'belajar') === 'belajar';

  const heroTitle = document.createElement('h2');
  heroTitle.id = 'ot-title';
  heroTitle.className = 'lbl';
  heroTitle.style.fontSize = '13px';
  heroTitle.append(makeTermTip('OTTV', 'OTTV', tooltipsOn), document.createTextNode(' total'));

  const heroMeta = document.createElement('span');
  heroMeta.className = 'lbl num';
  heroMeta.style.fontWeight = '500';
  heroMeta.append(
    makeTermTip('WWR', 'WWR', tooltipsOn),
    document.createTextNode(` ${fmtId(wwrPct, 1)}% · `),
    makeTermTip('SC', 'SC', tooltipsOn),
    document.createTextNode(` ${fmtId(avgSc, 3)}`),
  );

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

  // Fase 4e: Fast material pick & recommender shortcut right from Results hero card
  const matQuickRow = document.createElement('div');
  matQuickRow.style.display = 'grid';
  matQuickRow.style.gridTemplateColumns = '1fr 1fr';
  matQuickRow.style.gap = '6px';
  matQuickRow.style.marginTop = '10px';

  const pickGlzBtn = document.createElement('button');
  pickGlzBtn.type = 'button';
  pickGlzBtn.className = 'ghost ghost-sm';
  pickGlzBtn.style.height = '34px';
  pickGlzBtn.textContent = 'Ganti kaca';
  pickGlzBtn.addEventListener('click', () =>
    handlers.onOpenMaterialPickMode?.({
      lockedCategory: 'glazing',
      targetField: 'glazing_material_id',
      targetOrientCode: null,
      targetLabel: 'Pilih kaca utama',
    }),
  );

  const recBtn = document.createElement('button');
  recBtn.type = 'button';
  recBtn.className = 'ghost ghost-sm';
  recBtn.style.height = '34px';
  recBtn.textContent = 'Rekomendasi';
  recBtn.addEventListener('click', () => handlers.onOpenMaterialRecommend?.());

  matQuickRow.append(pickGlzBtn, recBtn);
  heroCard.appendChild(matQuickRow);

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

  // 1b. Bidang terpilih card (`docs/FASE4_UI_SPEC.md` §4.3 + mockup 4-hasil.html)
  const selSummary = summarizeSelectedPanels(analysis, state.selectedPanelIds);
  const selCard = document.createElement('section');
  selCard.className = 'box';
  selCard.setAttribute('aria-labelledby', 'sel-title');

  const selHead = document.createElement('div');
  selHead.style.display = 'flex';
  selHead.style.justifyContent = 'space-between';
  selHead.style.alignItems = 'baseline';
  selHead.style.gap = '6px';

  const selTitle = document.createElement('h2');
  selTitle.id = 'sel-title';
  selTitle.style.fontSize = '14px';
  selTitle.textContent = 'Bidang terpilih';

  if (selSummary) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'lbl';
    clearBtn.style.border = '0';
    clearBtn.style.background = 'none';
    clearBtn.style.padding = '0';
    clearBtn.style.fontWeight = '500';
    clearBtn.style.textDecoration = 'underline';
    clearBtn.textContent = 'Lepas pilihan';
    clearBtn.addEventListener('click', () => handlers.onClearPanelSelection());
    selHead.append(selTitle, clearBtn);
  } else {
    const hint = document.createElement('span');
    hint.className = 'lbl';
    hint.style.fontWeight = '500';
    hint.textContent = 'Shift+klik pilih banyak';
    selHead.append(selTitle, hint);
  }
  selCard.appendChild(selHead);

  if (!selSummary) {
    const emptyP = document.createElement('p');
    emptyP.className = 'muted';
    emptyP.style.margin = '6px 0 0';
    emptyP.style.fontSize = '12.5px';
    emptyP.style.lineHeight = '18px';
    emptyP.textContent =
      'Klik satu panel di viewer 3D untuk melihat parameter termal, kontribusi W/m², dan porsi panasnya.';
    selCard.appendChild(emptyP);
  } else if (selSummary.isMulti) {
    const subP = document.createElement('p');
    subP.className = 'muted';
    subP.style.margin = '3px 0 8px';
    subP.style.fontSize = '12.5px';
    subP.textContent = `${selSummary.count} panel dipilih · luas total ${fmtId(selSummary.totalAreaM2, 2)} m²`;

    const grid = document.createElement('div');
    grid.className = 'num';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gap = '6px';
    grid.style.fontSize = '12px';

    for (const [k, v] of [
      ['Rata-rata tertimbang', `${fmtId(selSummary.weightedOttvWm2, 2)} W/m²`],
      ['Porsi panas', `${fmtId(selSummary.selectedHeatSharePct, 1)}%`],
    ]) {
      const cell = document.createElement('div');
      cell.className = 'glass-thin';
      cell.style.borderRadius = '10px';
      cell.style.padding = '6px 8px';
      const l = document.createElement('div');
      l.className = 'lbl';
      l.textContent = k;
      const b = document.createElement('b');
      b.textContent = v;
      cell.append(l, b);
      grid.appendChild(cell);
    }

    const noteP = document.createElement('p');
    noteP.className = 'lbl';
    noteP.style.margin = '8px 0 0';
    noteP.style.fontWeight = '500';
    noteP.textContent = 'Status memenuhi atau tidak hanya dinilai dari OTTV total.';

    selCard.append(subP, grid, noteP);
  } else {
    const p = selSummary.primary;
    const subP = document.createElement('p');
    subP.className = 'muted';
    subP.style.margin = '2px 0 8px';
    subP.style.fontSize = '12.5px';
    subP.textContent = `${selSummary.primaryTypeLabel}, fasad ${selSummary.primaryDirName} · grup ${p.group_name || '-'}`;

    const metricsGrid = document.createElement('div');
    metricsGrid.className = 'num';
    metricsGrid.style.display = 'grid';
    metricsGrid.style.gridTemplateColumns = '1fr 1fr 1fr';
    metricsGrid.style.gap = '6px';
    metricsGrid.style.fontSize = '12px';

    const metricSpecs = selSummary.primaryIsGlz
      ? [
          ['SF', fmtId(p.sf_wm2 ?? 0, 0)],
          ['SC', fmtId(p.sc_effective ?? p.sc_glass ?? 0, 3)],
          ['Uf', fmtId(p.u_fen_eff ?? 0, 2)],
        ]
      : [
          ['α', fmtId(p.alpha_wall_eff ?? 0, 2)],
          ['Uw', fmtId(p.u_wall_eff ?? 0, 2)],
          ['TDek', fmtId(p.td_ek_eff ?? 0, 1)],
        ];

    for (const [labelTxt, valTxt] of metricSpecs) {
      const cell = document.createElement('div');
      cell.className = 'glass-thin';
      cell.style.borderRadius = '10px';
      cell.style.padding = '6px 8px';
      const l = document.createElement('div');
      l.className = 'lbl';
      if (labelTxt === 'Uf') {
        l.appendChild(makeTermTip('Uf', 'U<sub>f</sub>', tooltipsOn));
      } else if (labelTxt === 'Uw') {
        l.appendChild(makeTermTip('Uw', 'U<sub>w</sub>', tooltipsOn));
      } else if (labelTxt === 'TDek') {
        l.appendChild(makeTermTip('TDek', 'TD<sub>ek</sub>', tooltipsOn));
      } else if (labelTxt === 'α') {
        l.appendChild(makeTermTip('alpha', 'α', tooltipsOn));
      } else if (labelTxt === 'SF' || labelTxt === 'SC') {
        l.appendChild(makeTermTip(labelTxt, labelTxt, tooltipsOn));
      } else {
        l.textContent = labelTxt;
      }
      const b = document.createElement('b');
      b.textContent = valTxt;
      cell.append(l, b);
      metricsGrid.appendChild(cell);
    }

    const contribP = document.createElement('p');
    contribP.style.margin = '9px 0 0';
    contribP.style.fontSize = '12.5px';
    contribP.style.lineHeight = '18px';
    const bVal = document.createElement('b');
    bVal.className = 'num';
    bVal.textContent = `${fmtId(p.ottv_panel_wm2 ?? 0, 2)} W/m²`;
    const cohortTypeWord = selSummary.primaryIsGlz ? 'kaca' : 'dinding';
    const bPct = document.createElement('b');
    bPct.className = 'num';
    bPct.textContent = `${Math.round(selSummary.cohortHeatSharePct)}%`;
    contribP.append(
      bVal,
      document.createTextNode(
        ` kontribusi panel ini. Seluruh ${cohortTypeWord} ${selSummary.primaryDirName} (${fmtId(selSummary.cohortAreaM2, 2)} m²) menyumbang `,
      ),
      bPct,
      document.createTextNode(' panas yang masuk ke bangunan.'),
    );

    const noteP = document.createElement('p');
    noteP.className = 'lbl';
    noteP.style.margin = '6px 0 0';
    noteP.style.fontWeight = '500';
    noteP.textContent = 'Status memenuhi atau tidak hanya dinilai dari OTTV total.';

    selCard.append(subP, metricsGrid, contribP, noteP);
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

    const pickOrientBtn = document.createElement('button');
    pickOrientBtn.type = 'button';
    pickOrientBtn.className = 'ghost ghost-sm';
    pickOrientBtn.style.height = '30px';
    pickOrientBtn.style.marginTop = '4px';
    pickOrientBtn.style.justifySelf = 'start';
    pickOrientBtn.textContent = `Ganti kaca fasad ${sel.code}`;
    pickOrientBtn.addEventListener('click', () =>
      handlers.onOpenMaterialPickMode?.({
        lockedCategory: 'glazing',
        targetField: null,
        targetOrientCode: sel.code,
        targetLabel: `Pilih kaca fasad ${sel.name_id || sel.code}`,
      }),
    );

    detailDiv.append(titleLine, metricLine, noteLine, pickOrientBtn);
    orientCard.appendChild(detailDiv);
  }

  // 3. RTTV & Komposisi panas card
  const rttvCard = document.createElement('section');
  rttvCard.className = 'box';
  rttvCard.setAttribute('aria-labelledby', 'rt-title');

  const rtTitle = document.createElement('h2');
  rtTitle.id = 'rt-title';
  rtTitle.style.fontSize = '14px';
  rtTitle.append(document.createTextNode('Komposisi panas & '), makeTermTip('RTTV', 'RTTV', tooltipsOn));

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

  // 3b. Lanjut workspace: Tabel per bidang (searchable, click row -> select panel in 3D)
  let advPanelCard = null;
  if (state.workspace?.preset === 'lanjut' || state.advancedMode) {
    const activePanels = (analysis.panels || []).filter((p) => p && p.active);
    advPanelCard = document.createElement('section');
    advPanelCard.className = 'box';
    advPanelCard.setAttribute('aria-labelledby', 'adv-panels-title');

    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.id = 'adv-panels-title';
    sum.className = 'lbl';
    sum.style.color = 'var(--ink)';
    sum.style.fontSize = '13.5px';
    sum.textContent = `Data per bidang (${activePanels.length} panel aktif)`;
    det.appendChild(sum);

    const filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.className = 'field-input';
    filterInput.style.height = '32px';
    filterInput.style.fontSize = '12px';
    filterInput.style.marginTop = '8px';
    filterInput.placeholder = 'Filter arah (B, T...) atau nama grup...';
    filterInput.setAttribute('aria-label', 'Filter tabel panel');

    const wrap = document.createElement('div');
    wrap.className = 'panel-table-wrap';

    const sortedPanels = [...activePanels].sort(
      (a, b) => Number(b.ottv_panel_wm2 || 0) - Number(a.ottv_panel_wm2 || 0),
    );

    const renderRows = (q = '') => {
      wrap.innerHTML = '';
      const ql = q.trim().toLowerCase();
      const matched = ql
        ? sortedPanels.filter(
            (p) =>
              String(p.orientation_code || '').toLowerCase().includes(ql) ||
              String(p.group_name || '').toLowerCase().includes(ql) ||
              String(p.element_type || '').toLowerCase().includes(ql),
          )
        : sortedPanels;
      const top = matched.slice(0, 40);
      const tbl = document.createElement('table');
      tbl.className = 'data-table num';
      tbl.style.fontSize = '11.5px';
      tbl.innerHTML =
        '<thead><tr><th>Arah</th><th>Grup</th><th style="text-align:right;">Luas</th><th style="text-align:right;">W/m²</th></tr></thead>';
      const tb = document.createElement('tbody');
      for (const p of top) {
        const tr = document.createElement('tr');
        if ((state.selectedPanelIds || []).includes(p.id)) tr.classList.add('is-selected');
        const tdA = document.createElement('td');
        tdA.textContent = p.orientation_code || '-';
        const tdG = document.createElement('td');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'group-pick-btn';
        btn.style.fontSize = '11.5px';
        btn.textContent = p.group_name || p.id;
        btn.title = `Pilih panel ${p.id}`;
        btn.addEventListener('click', (ev) => handlers.onPickPanel(p, Boolean(ev.shiftKey)));
        tdG.appendChild(btn);
        const tdArea = document.createElement('td');
        tdArea.style.textAlign = 'right';
        tdArea.textContent = fmtId(p.area_m2 || 0, 1);
        const tdVal = document.createElement('td');
        tdVal.style.textAlign = 'right';
        tdVal.style.fontWeight = '700';
        tdVal.textContent = fmtId(p.ottv_panel_wm2 || 0, 2);
        tr.append(tdA, tdG, tdArea, tdVal);
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      if (matched.length > 40) {
        const more = document.createElement('p');
        more.className = 'lbl';
        more.style.margin = '6px 0 0';
        more.style.fontWeight = '500';
        more.textContent = `Menampilkan 40 tertinggi dari ${matched.length} panel.`;
        wrap.appendChild(more);
      }
    };

    filterInput.addEventListener('input', () => renderRows(filterInput.value));
    renderRows();
    det.append(filterInput, wrap);
    advPanelCard.appendChild(det);
  }

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

  if (advPanelCard) {
    side.append(heroCard, selCard, orientCard, rttvCard, advPanelCard, dlWrap);
  } else {
    side.append(heroCard, selCard, orientCard, rttvCard, dlWrap);
  }
  main.append(viewerSec, side);

  window.requestAnimationFrame(() => {
    if (canvasHost.isConnected) {
      viewer.setRightInsetPx(0);
      viewer.mount(canvasHost, {
        onPickPanel: (panel, ev) => {
          handlers.onPickPanel(panel, Boolean(ev?.shiftKey));
        },
      });
      viewer.syncState(state);
    }
  });

  return main;
}
