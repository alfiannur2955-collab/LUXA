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
import { renderFormulaSheet } from '../viewer/formulaPill.js';
import { luxSvg } from '../ui/mascot.js';
import {
  ORIENTATION_CODES,
  ORIENTATION_NAMES_ID,
  normalToOrientationCode,
  buildOrientationRingLegendSvg,
  buildExposureGradientCss,
  horizontalNeutralColor,
  orientationToCssColor,
  ottvToHeatCssVar,
  readThemeTokens,
} from '../viewer/modes.js';
import { renderViewerModeBar } from '../viewer/modeBar.js';
import { EXPOSURE_SCALE_LABELS, resolveExposureScale, resolveViewerMode } from '../viewer/modes.js';
import { summarizeSelectedPanels } from '../viewer/selection.js';
import { renderViewerBottomBar } from '../viewer/vbar.js';
import { smoothLegendTicksHtml, viewer } from '../viewer/viewer.js';

const CANONICAL_ORIENTATIONS = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'];


/** Popover skala warna mode Matahari sepanjang tahun. */
function renderExposureScalePopover(state, handlers) {
  const cur = state.config?.settings?.exposure_scale || {};
  const resolved = resolveExposureScale(cur, viewer.lastSmoothRange ? { min: viewer.lastSmoothRange.dataMin, max: viewer.lastSmoothRange.dataMax } : null);
  const pop = document.createElement('div');
  pop.className = 'glass vbar-popover exp-scale-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Skala warna Matahari sepanjang tahun');

  const ttl = document.createElement('div');
  ttl.className = 'lbl';
  ttl.style.color = 'var(--ink)';
  ttl.textContent = 'Skala warna';

  const seg = document.createElement('div');
  seg.className = 'vbar-date-seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Jenis skala');
  const desc = {
    sni: 'Tetap 80–250 W/m² (rentang faktor surya fasad SNI). Warna bisa dibandingkan antar model dan alternatif.',
    auto: 'Direntangkan dari nilai terendah sampai tertinggi model ini. Kontras paling tinggi, tidak untuk membandingkan model.',
    custom: 'Isi batas sendiri, misalnya untuk menonjolkan beda antar arah di satu kota.',
  };
  for (const id of ['sni', 'auto', 'custom']) {
    const b = document.createElement('button');
    b.type = 'button';
    const on = resolved.mode === id;
    b.className = on ? 'on' : '';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.textContent = EXPOSURE_SCALE_LABELS[id];
    b.addEventListener('click', () => {
      const next = { ...cur, mode: id };
      if (id === 'custom' && !(Number(cur.max) - Number(cur.min) >= 1)) {
        next.min = Math.round(resolved.min);
        next.max = Math.round(resolved.max);
      }
      handlers.onSetExposureScale?.(next);
    });
    seg.appendChild(b);
  }

  const note = document.createElement('p');
  note.className = 'lbl';
  note.style.margin = '0';
  note.style.fontWeight = '500';
  note.textContent = desc[resolved.mode];

  pop.append(ttl, seg, note);

  if (resolved.mode === 'custom') {
    const row = document.createElement('div');
    row.className = 'exp-scale-row';
    const mk = (id, label, val) => {
      const wrap = document.createElement('label');
      wrap.className = 'lbl';
      wrap.htmlFor = id;
      wrap.textContent = label;
      const inp = document.createElement('input');
      inp.id = id;
      inp.type = 'number';
      inp.step = '1';
      inp.min = '0';
      inp.max = '600';
      inp.className = 'field-input num';
      inp.value = String(Math.round(Number(val)));
      return [wrap, inp];
    };
    const [l1, iMin] = mk('exp-scale-min', 'Bawah', cur.min ?? resolved.min);
    const [l2, iMax] = mk('exp-scale-max', 'Atas', cur.max ?? resolved.max);
    const unit = document.createElement('span');
    unit.className = 'lbl';
    unit.textContent = 'W/m²';
    const err = document.createElement('p');
    err.className = 'lbl exp-scale-err';
    err.setAttribute('role', 'alert');
    const apply = () => {
      const lo = Number(iMin.value);
      const hi = Number(iMax.value);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > 600) {
        err.textContent = 'Isi angka 0–600.';
        return;
      }
      if (hi - lo < 1) {
        err.textContent = 'Batas atas harus lebih besar dari batas bawah.';
        return;
      }
      err.textContent = '';
      handlers.onSetExposureScale?.({ mode: 'custom', min: Math.round(lo), max: Math.round(hi) });
    };
    for (const inp of [iMin, iMax]) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
        }
      });
      inp.addEventListener('input', () => {
        err.textContent = '';
      });
    }
    row.append(l1, iMin, l2, iMax, unit);
    const actions = document.createElement('div');
    actions.className = 'exp-scale-actions';
    const fromModel = document.createElement('button');
    fromModel.type = 'button';
    fromModel.className = 'ghost ghost-sm';
    fromModel.textContent = 'Pakai rentang model';
    const r = viewer.lastSmoothRange;
    fromModel.disabled = !(r && Number.isFinite(r.dataMin));
    fromModel.addEventListener('click', () => {
      if (!r) return;
      iMin.value = String(Math.floor(r.dataMin));
      iMax.value = String(Math.ceil(r.dataMax));
    });
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'ghost ghost-sm on';
    okBtn.textContent = 'Terapkan';
    okBtn.addEventListener('click', apply);
    actions.append(fromModel, okBtn);
    pop.append(row, err, actions);
  }

  if (viewer.lastSmoothRange && Number.isFinite(viewer.lastSmoothRange.dataMin)) {
    const info = document.createElement('p');
    info.className = 'lbl num';
    info.style.margin = '0';
    info.style.fontWeight = '500';
    info.textContent = `Nilai di model ini: ${Math.round(viewer.lastSmoothRange.dataMin)}–${Math.round(viewer.lastSmoothRange.dataMax)} W/m². Hanya tampilan; angka OTTV tidak berubah.`;
    pop.appendChild(info);
  }
  return pop;
}

const SUN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtSunDateShort(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return 'Hari ini';
  return `${Number(m[3])} ${SUN_MONTHS[Number(m[2]) - 1] || ''}`;
}

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

  // Mode bar: Klasifikasi, Orientasi, Heatmap, Matahari | Perlu dicek, Transparan
  const view = resolveViewerMode({ ...state, viewerMode: state.viewerMode || 'heatmap' });
  const activeMode = view.renderMode;
  const sunNow = view.mode === 'sun' && state.facadeFilter === 'sunlit_now';
  const modeBarEl = renderViewerModeBar({ ...state, viewerMode: view.mode }, handlers.onChangeViewerMode, {
    onToggleOverlay: handlers.onToggleOverlay,
  });
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

  // Rumus OTTV tidak lagi melayang di viewer: ada di kartu "Per arah" (kolom kanan).

  // Bottom overlay stack (T2): legend always sits 12px above bottom pills regardless of pill wrapping
  const bottomStack = document.createElement('div');
  bottomStack.className = 'viewer-bottom-stack';
  if (modeAtBottom) {
    bottomStack.appendChild(modeBarEl);
  }

  // Legend (lifted cleanly above bottom pills; shifts right if Tampilan card is open)
  const legend = document.createElement('div');
  legend.className = 'legend dock-top';

  // Mode Matahari: pilihan Sepanjang tahun / tanggal & jam aktif
  if (view.mode === 'sun') {
    const seg = document.createElement('div');
    seg.className = 'legend-toggle';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Waktu matahari');
    const hh = `${String(Math.round(Number(state.sunHour ?? 13))).padStart(2, '0')}.00`;
    for (const [id, lbl, tip] of [
      ['year', 'Sepanjang tahun', 'Rata-rata paparan setahun menurut arah hadap (faktor SF SNI)'],
      ['now', `${fmtSunDateShort(state.sunDate)} · ${hh}`, 'Sinar langsung pada tanggal dan jam aktif, termasuk bayangan'],
    ]) {
      const on = (id === 'now') === sunNow;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.className = on ? 'on' : '';
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.textContent = lbl;
      b.title = tip;
      b.addEventListener('click', () => handlers.onSetSunView?.(id));
      seg.appendChild(b);
    }
    legend.appendChild(seg);
  }

  if (sunNow) {
    const hLabel = `${String(Math.round(Number(state.sunHour ?? 13))).padStart(2, '0')}.00`;
    legend.setAttribute('aria-label', 'Legenda fasad terkena matahari');
    legend.title =
      'Bidang terkena sinar matahari langsung pada jam ini (bayangan bangunan sendiri, peneduh, dan bangunan sekitar ikut dihitung). ' +
      'Oranye pekat = sinar hampir tegak lurus. Hanya tampilan; angka OTTV tidak berubah.';
    if (state.exposureLoading) {
      legend.insertAdjacentHTML('beforeend', '<span class="legend-item"><span class="spin spin-sm" aria-hidden="true"></span>Menghitung bayangan...</span>');
    } else {
      const set = viewer._getSunlitPanelIdSet(state);
      const north = Number(state.config?.settings?.north_angle_deg || 0);
      const aNorth = Number(state.analysisData?.summary?.north_angle_deg || 0);
      let tot = 0;
      let lit = 0;
      const byOri = {};
      for (const p of state.analysisData?.panels || []) {
        if (!p.active) continue;
        const a = Number(p.area_m2 || 0);
        tot += a;
        if (set && set.has(p.id)) {
          lit += a;
          let code = p.orientation_code || 'U';
          if (Math.abs(north - aNorth) > 0.05 && Array.isArray(p.normal)) code = normalToOrientationCode(p.normal[0], p.normal[1], north);
          byOri[code] = (byOri[code] || 0) + a;
        }
      }
      const pct = tot > 0 ? (lit / tot) * 100 : 0;
      const top = Object.entries(byOri).sort((x, y) => y[1] - x[1])[0];
      const topName = top ? ORIENTATION_NAMES_ID[top[0] === 'TGR' ? 'TG' : top[0]] || top[0] : null;
      legend.insertAdjacentHTML('beforeend', `
        <span class="legend-item" title="Terkena matahari (pucat = sinar miring, pekat = tegak lurus)"><i class="swatch sunlit-grad-swatch" aria-hidden="true"></i><span class="legend-lbl-opt">Terkena</span></span>
        <span class="legend-item" title="Di bayangan"><i class="swatch" style="background:var(--data-wall);"></i><span class="legend-lbl-opt">Bayangan</span></span>
        <span class="legend-item num sunlit-stat"></span>`);
      const topCode = top ? (top[0] === 'TGR' ? 'TG' : top[0]) : null;
      const stat = legend.querySelector('.sunlit-stat');
      stat.textContent = `${fmtId(pct, 0)}% terkena${topCode ? ` · terbanyak ${topCode}` : ''}`;
      stat.title = `${fmtId(pct, 0)}% luas fasad terkena matahari pukul ${hLabel}${topName ? `; terbanyak di arah ${topName}` : ''}.`;
      stat.setAttribute('aria-label', stat.title);
    }
  } else if (activeMode === 'heatmap') {
    const gran = state.heatmapGranularity || 'orientation';
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
      b.textContent = lbl;
      b.title = id === 'orientation' ? 'Warna rata-rata per arah' : 'Warna per panel';
      b.addEventListener('click', () => handlers.onChangeHeatmapGranularity(id));
      toggleWrap.appendChild(b);
    }

    const gradWrap = document.createElement('span');
    gradWrap.className = 'heat-grad-wrap';
    const gradBar = document.createElement('span');
    gradBar.className = 'heat-grad-bar';
    gradBar.setAttribute('aria-hidden', 'true');
    const limitMark = document.createElement('i');
    limitMark.className = 'heat-grad-limit';
    gradBar.appendChild(limitMark);
    const gradTicks = document.createElement('span');
    gradTicks.className = 'heat-grad-ticks num';
    gradTicks.innerHTML = '<span>0</span><span>25</span><span class="is-limit">35 batas</span><span>60</span>';
    gradWrap.append(gradBar, gradTicks);
    legend.append(toggleWrap, gradWrap);
  } else if (activeMode === 'exposure') {
    // Paparan matahari per titik (W/m²), skala relatif model. Hanya tampilan; angka OTTV tidak berubah.
    legend.title =
      'Matahari sepanjang tahun (W/m²): faktor SF menurut arah hadap tiap titik' +
      (state.exposureShading !== false ? ' × peneduh 3D' : '') +
      '. Kiri rendah, kanan tinggi. Hanya tampilan; angka OTTV tidak berubah.';
    legend.setAttribute('aria-label', 'Legenda paparan matahari');

    const gradWrap = document.createElement('span');
    gradWrap.className = 'heat-grad-wrap';
    const gradBar = document.createElement('span');
    gradBar.className = 'heat-grad-bar';
    gradBar.setAttribute('aria-hidden', 'true');
    gradBar.style.background = buildExposureGradientCss(readThemeTokens());
    const gradTicks = document.createElement('span');
    gradTicks.className = 'heat-grad-ticks num';
    gradTicks.setAttribute('data-luxa-smooth-legend', '');
    gradTicks.innerHTML = smoothLegendTicksHtml(viewer.lastSmoothRange);
    gradWrap.append(gradBar, gradTicks);

    const shadeLbl = document.createElement('label');
    shadeLbl.className = 'legend-smooth-lbl';
    shadeLbl.title = 'Hitung bayangan sirip, overhang, dan bagian bangunan sendiri';
    const shadeCb = document.createElement('input');
    shadeCb.type = 'checkbox';
    shadeCb.setAttribute('role', 'switch');
    shadeCb.checked = state.exposureShading !== false;
    shadeCb.addEventListener('change', () => handlers.onToggleExposureShading?.(shadeCb.checked));
    shadeLbl.append(shadeCb, document.createTextNode(' Peneduh'));

    // Skala warna (Tetap SNI / Otomatis / Kustom) — tampilan saja.
    const scMode = resolveExposureScale(state.config?.settings?.exposure_scale).mode;
    const scaleBtn = document.createElement('button');
    scaleBtn.type = 'button';
    scaleBtn.className = `legend-scale-btn${state.openPopover === 'expscale' ? ' on' : ''}`;
    scaleBtn.setAttribute('aria-haspopup', 'dialog');
    scaleBtn.setAttribute('aria-expanded', state.openPopover === 'expscale' ? 'true' : 'false');
    scaleBtn.title = 'Atur skala warna';
    scaleBtn.innerHTML = `<span>Skala: ${EXPOSURE_SCALE_LABELS[scMode]}</span>${icon('chevronDown', 12)}`;
    scaleBtn.addEventListener('click', () => handlers.onTogglePopover?.(state.openPopover === 'expscale' ? null : 'expscale'));
    legend.append(gradWrap, scaleBtn, shadeLbl);
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
  } else {
    legend.innerHTML = `
      <span class="legend-item"><i class="swatch" style="background:var(--data-glazing);"></i>Kaca</span>
      <span class="legend-item"><i class="swatch" style="background:var(--data-wall);"></i>Dinding</span>
      <span class="legend-item"><i class="swatch" style="background:var(--data-shading);"></i>Peneduh</span>
    `;
  }
  if (state.isolatedOrientation) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'legend-iso-chip';
    const nm = ORIENTATION_NAMES_ID[state.isolatedOrientation === 'TGR' ? 'TG' : state.isolatedOrientation] || state.isolatedOrientation;
    chip.innerHTML = `<span>Hanya arah ${nm}</span>${icon('close', 12)}`;
    chip.title = 'Tampilkan semua arah lagi';
    chip.setAttribute('aria-label', `Hanya arah ${nm}. Klik untuk menampilkan semua arah`);
    chip.addEventListener('click', () => handlers.onClearIsolation?.());
    legend.appendChild(chip);
  }
  {
    const t = document.createElement('span');
    t.className = 'dock-title';
    const titles = { heatmap: ['OTTV', 'W/m²'], exposure: ['Matahari', ''], orientation: ['Orientasi', 'arah hadap'], classification: ['Klasifikasi', 'jenis bidang'] };
    const [tt, sub] = titles[view.mode === 'sun' ? 'exposure' : activeMode] || ['Tampilan', ''];
    t.innerHTML = `<b>${tt}</b>${sub ? `<small>${sub}</small>` : ''}`;
    legend.prepend(t);
  }

  // Dok bawah dua tingkat: atas = legenda mode (berubah-ubah), bawah = kontrol (tetap).
  const dock = document.createElement('div');
  dock.className = 'glass viewer-dock';
  dock.appendChild(legend);
  bottomStack.appendChild(dock);

  if (handlers.vbarHandlers) {
    dock.appendChild(renderViewerBottomBar(state, handlers.vbarHandlers));
  }
  if (activeMode === 'exposure' && !sunNow && state.openPopover === 'expscale') {
    dock.appendChild(renderExposureScalePopover(state, handlers));
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
    // Lux ikut senang saat OTTV memenuhi batas.
    if (state.mascotOn !== false) {
      const happy = document.createElement('span');
      happy.className = 'hero-lux';
      happy.title = 'Lux senang: OTTV memenuhi batas SNI';
      happy.innerHTML = luxSvg('happy', { size: 40 });
      chipRow.appendChild(happy);
    }
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
  const orientWithArea = orientList.filter((o) => Number(o.total_area_m2 || 0) > 0.01);
  const highestOrient = orientWithArea.length
    ? orientWithArea.reduce((b, c) => (Number(c.ottv_orientation_wm2 || 0) > Number(b.ottv_orientation_wm2 || 0) ? c : b))
    : null;
  const detailCode =
    state.selectedOrientation && orientByCode.has(state.selectedOrientation) ? state.selectedOrientation : highestOrient?.code || null;
  if (detailCode) {
    const sel = orientByCode.get(detailCode);
    const isHighest = highestOrient && sel.code === highestOrient.code;
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
    titleLine.style.display = 'flex';
    titleLine.style.alignItems = 'baseline';
    titleLine.style.gap = '6px';
    titleLine.innerHTML = '';
    const tName = document.createElement('span');
    tName.textContent = `Fasad ${sel.name_id || sel.code} · ${fmtId(sel.ottv_orientation_wm2 || 0, 2)} W/m²`;
    titleLine.appendChild(tName);
    if (isHighest) {
      const tag = document.createElement('span');
      tag.className = 'chip st-warn chip-xs';
      tag.textContent = 'tertinggi';
      titleLine.appendChild(tag);
    }

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

    const fBtn = document.createElement('button');
    fBtn.type = 'button';
    fBtn.className = `ghost ghost-sm${state.formulaPillExpanded ? ' on' : ''}`;
    fBtn.style.height = '30px';
    fBtn.style.marginTop = '4px';
    fBtn.setAttribute('aria-expanded', state.formulaPillExpanded ? 'true' : 'false');
    fBtn.innerHTML = `${icon('formula', 14)}<span>${state.formulaPillExpanded ? 'Tutup rumus' : 'Rumus'}</span>`;
    fBtn.addEventListener('click', () => handlers.onToggleFormulaPill?.(!state.formulaPillExpanded));

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.flexWrap = 'wrap';
    btnRow.style.gap = '6px';
    btnRow.append(pickOrientBtn, fBtn);
    pickOrientBtn.style.marginTop = '4px';

    detailDiv.append(titleLine, metricLine, noteLine, btnRow);
    if (state.formulaPillExpanded) detailDiv.appendChild(renderFormulaSheet(sel));
    orientCard.appendChild(detailDiv);
  }

  // 3. Komposisi panas (OTTV) + kartu RTTV opsional terpisah
  const rttvCard = document.createElement('section');
  rttvCard.className = 'box';
  rttvCard.setAttribute('aria-labelledby', 'rt-title');

  const rtTitle = document.createElement('h2');
  rtTitle.id = 'rt-title';
  rtTitle.style.fontSize = '14px';
  rtTitle.append(document.createTextNode('Komposisi panas OTTV (W/m²)'));

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

  rttvCard.append(rtTitle, compGrid);

  // RTTV (Pasal 4.4) opsional: tampil bila dinyalakan, atau di Mode lanjut sebagai sakelar.
  const rttvOn = state.config?.settings?.compute_rttv === true;
  const isAdvanced = state.workspace?.preset === 'lanjut' || state.advancedMode;
  let roofCard = null;
  if (rttvOn || isAdvanced) {
    roofCard = document.createElement('section');
    roofCard.className = 'box';
    roofCard.setAttribute('aria-labelledby', 'rf-title');
    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    head.style.gap = '8px';
    const rfTitle = document.createElement('h2');
    rfTitle.id = 'rf-title';
    rfTitle.style.fontSize = '14px';
    rfTitle.style.margin = '0';
    rfTitle.append(makeTermTip('RTTV', 'RTTV', tooltipsOn), document.createTextNode(' atap'));
    const sw = document.createElement('label');
    sw.className = 'legend-smooth-lbl';
    sw.title = 'Hitung RTTV untuk atap dan skylight (SNI 6389:2020 Pasal 4.4)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.setAttribute('role', 'switch');
    cb.checked = rttvOn;
    cb.addEventListener('change', () => handlers.onToggleRttv?.(cb.checked));
    sw.append(cb, document.createTextNode(' Hitung RTTV'));
    head.append(rfTitle, sw);
    roofCard.appendChild(head);

    const body = document.createElement('div');
    body.style.display = 'grid';
    body.style.gap = '6px';
    body.style.marginTop = '8px';
    const p = (txt, cls = 'muted') => {
      const el = document.createElement('p');
      el.className = `${cls} num`;
      el.style.margin = '0';
      el.style.fontSize = '12.5px';
      el.textContent = txt;
      return el;
    };
    if (!rttvOn) {
      body.appendChild(p('Opsional. Nyalakan bila model punya atap atau skylight. Status kepatuhan tetap dinilai dari OTTV.'));
    } else if (state.needsRecompute || rttv?.disabled) {
      body.appendChild(p('Klik Hitung ulang untuk menghitung RTTV.'));
    } else if (rttv && rttv.applicable) {
      const rttvVal = Number(rttv.rttv_wm2 ?? 0);
      const rttvLimit = Number(rttv.limit_wm2 ?? 10);
      const rttvOk = rttv.compliant !== undefined && rttv.compliant !== null ? Boolean(rttv.compliant) : rttvVal <= rttvLimit;
      const val = document.createElement('div');
      val.className = 'num';
      val.style.fontSize = '22px';
      val.style.fontWeight = '800';
      val.innerHTML = `${fmtId(rttvVal, 2)} <span style="font-size:12px;font-weight:600;color:var(--ink-muted)">W/m²</span>`;
      const rChip = document.createElement('span');
      rChip.className = `chip ${rttvOk ? 'st-ok' : 'st-fail'}`;
      rChip.style.justifySelf = 'start';
      rChip.innerHTML = rttvOk
        ? `${icon('check', 13)}<span>Memenuhi (≤ ${fmtId(rttvLimit, 0)} W/m²)</span>`
        : `${icon('close', 13)}<span>Tidak memenuhi, batas ${fmtId(rttvLimit, 0)}</span>`;
      body.append(
        val,
        rChip,
        p(`Atap masif ${fmtId(rttv.opaque_roof_area_m2 || 0, 1)} m² · skylight ${fmtId(rttv.skylight_area_m2 || 0, 1)} m² · SF atap ${fmtId(rttv.sf_roof_wm2 || 0, 0)} W/m²`),
        p(`Batas ${fmtId(rttvLimit, 0)} W/m² karena ${Number(rttv.skylight_area_m2 || 0) > 0 ? 'ada skylight' : 'atap tanpa skylight'} (Pasal 4.4.1).`),
      );
    } else {
      body.appendChild(p('Tidak ada atap atau skylight yang dihitung. Tandai grup Atap, dan kaca yang merupakan skylight, di langkah Inspeksi.'));
    }
    roofCard.appendChild(body);
  }

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
    side.append(heroCard, selCard, orientCard, rttvCard, ...(roofCard ? [roofCard] : []), advPanelCard, dlWrap);
  } else {
    side.append(heroCard, selCard, orientCard, rttvCard, ...(roofCard ? [roofCard] : []), dlWrap);
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
