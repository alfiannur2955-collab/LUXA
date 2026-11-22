/**
 * Draggable & Expandable Formula Pill (`docs/FASE4_UI_SPEC.md` §3.4, §5 + mockup 4-hasil.html):
 * - Positioned at top-right of viewer, left of compass (`top: 16px, right: 76px, height: 52px`).
 * - Draggable via pointer on grip handle AND via keyboard arrows (`ArrowUp/Down/Left/Right`, Shift = 48px, Home = reset).
 * - Position saved in `localStorage` (`luxa.formulaPillPos.v1`) wrapped in `try/catch`.
 * - Displays `OTTV_<dir>` (Newsreader italic `.formula`) + numeric value + `"Rumus"` toggle
 *   that expands the full SNI 6389:2020 equation with live substituted numbers.
 */

import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { ORIENTATION_NAMES_ID } from './modes.js';
import { summarizeSelectedPanels } from './selection.js';

const POS_STORAGE_KEY = 'luxa.formulaPillPos.v1';

function loadSavedPos() {
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') {
      return { left: parsed.left, top: parsed.top };
    }
  } catch {
    // Ignore storage failures
  }
  return null;
}

function savePos(pos) {
  try {
    if (!pos) {
      window.localStorage.removeItem(POS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify({ left: Math.round(pos.left), top: Math.round(pos.top) }));
    }
  } catch {
    // Ignore storage failures
  }
}

function pickActiveOrientationRow(state) {
  const analysis = state.analysisData;
  if (!analysis) return null;
  const breakdown = (analysis.orientation_breakdown || []).filter((r) => Number(r.total_area_m2 || 0) > 0.01);
  if (breakdown.length === 0) return null;

  const selSummary = summarizeSelectedPanels(analysis, state.selectedPanelIds);
  const wantedCode = selSummary?.primaryDir || state.selectedOrientation || null;
  if (wantedCode) {
    const found = breakdown.find((r) => r.code === wantedCode);
    if (found) return found;
  }

  // Default: orientation with highest OTTV
  return breakdown.reduce((best, cur) =>
    Number(cur.ottv_orientation_wm2 || 0) > Number(best.ottv_orientation_wm2 || 0) ? cur : best,
  );
}

export function renderFormulaPill(state, { onToggleExpand } = {}) {
  const analysis = state.analysisData;
  if (!analysis) return null;

  const row = pickActiveOrientationRow(state);
  const code = row?.code || '';
  const dirName = code ? ORIENTATION_NAMES_ID[code] || code : 'Total';
  const valWm2 = row ? Number(row.ottv_orientation_wm2 || 0) : Number(analysis.ottv_total_wm2 || 0);
  const expanded = Boolean(state.formulaPillExpanded);

  const wrap = document.createElement('div');
  wrap.className = 'formula-pill-wrap';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', `Rumus OTTV ${dirName}, bisa digeser`);

  const savedPos = loadSavedPos();
  if (savedPos) {
    wrap.style.left = `${savedPos.left}px`;
    wrap.style.top = `${savedPos.top}px`;
    wrap.style.right = 'auto';
    // Re-clamp stale saved position if viewport shrunk since last drag
    window.requestAnimationFrame(() => {
      const parent = wrap.parentElement;
      if (!parent || !wrap.isConnected) return;
      const pw = parent.clientWidth || 0;
      const ph = parent.clientHeight || 0;
      const ww = wrap.offsetWidth || 240;
      const wh = bar.offsetHeight || 52;
      if (pw <= 0 || ph <= 0) return;
      if (savedPos.left + ww + 12 > pw || savedPos.top + wh + 12 > ph || savedPos.left < 12 || savedPos.top < 12) {
        wrap.style.left = '';
        wrap.style.top = '';
        wrap.style.right = '';
      }
    });
  }

  // Top bar (height 52px, aligned with modes bar and compass)
  const bar = document.createElement('div');
  bar.className = 'glass formula-pill-bar';

  const gripBtn = document.createElement('button');
  gripBtn.type = 'button';
  gripBtn.className = 'tbtn formula-pill-grip';
  gripBtn.setAttribute('aria-label', 'Geser kartu rumus, gunakan tombol panah untuk menggeser atau Home untuk posisi awal');
  gripBtn.title = 'Geser kartu rumus (atau panah keyboard, Home = posisi awal)';
  gripBtn.innerHTML = icon('grip', 16);

  const symSpan = document.createElement('span');
  symSpan.className = 'formula formula-pill-sym';
  symSpan.innerHTML = code ? `OTTV<sub>${code}</sub>` : 'OTTV';

  const valSpan = document.createElement('span');
  valSpan.className = 'num formula-pill-val';
  valSpan.textContent = `${fmtId(valWm2, 2)} W/m²`;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = `tbtn formula-pill-toggle${expanded ? ' on' : ''}`;
  toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  toggleBtn.setAttribute('aria-label', expanded ? 'Tutup rumus lengkap' : 'Buka rumus lengkap');
  toggleBtn.innerHTML = `${icon('formula', 16)}<span>Rumus</span>`;
  toggleBtn.addEventListener('click', () => onToggleExpand?.(!expanded));

  bar.append(gripBtn, symSpan, valSpan, toggleBtn);
  wrap.appendChild(bar);

  // Expanded equation sheet with substituted SNI 6389:2020 numbers
  if (expanded) {
    const sheet = document.createElement('div');
    sheet.className = 'glass formula-pill-sheet';
    sheet.setAttribute('role', 'region');
    sheet.setAttribute('aria-label', `Substitusi rumus OTTV ${dirName}`);

    const mc = row?.manual_calc || null;
    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    head.style.gap = '8px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '13px';
    title.textContent = code ? `Substitusi SNI 6389:2020 · Fasad ${dirName} (${code})` : 'Ringkasan OTTV Total';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'icon-mini-btn';
    closeBtn.setAttribute('aria-label', 'Tutup rincian rumus');
    closeBtn.innerHTML = icon('close', 14);
    closeBtn.addEventListener('click', () => onToggleExpand?.(false));

    head.append(title, closeBtn);
    sheet.appendChild(head);

    const eq = document.createElement('div');
    eq.className = 'formula formula-eq-line';
    eq.innerHTML = 'OTTV = α·U<sub>w</sub>·(1 − WWR)·TD<sub>ek</sub> + U<sub>f</sub>·WWR·ΔT + SC·WWR·SF';
    sheet.appendChild(eq);

    if (mc) {
      const alpha = Number(mc.alpha ?? 0);
      const uw = Number(mc.u_wall ?? 0);
      const wwr = Number(mc.wwr ?? 0);
      const tdek = Number(mc.td_ek ?? 0);
      const uf = Number(mc.u_f ?? 0);
      const dt = Number(mc.delta_t ?? 5);
      const sc = Number(mc.sc ?? 0);
      const sf = Number(mc.sf ?? 0);
      const qw = Number(mc.q_wall_wm2 ?? 0);
      const qg = Number(mc.q_glass_wm2 ?? 0);
      const qs = Number(mc.q_solar_wm2 ?? 0);
      const tot = Number(mc.ottv_wm2 ?? valWm2);

      const rowsEl = document.createElement('div');
      rowsEl.className = 'formula-rows num';

      const terms = [
        [
          'Konduksi dinding',
          `${fmtId(alpha, 2)} × ${fmtId(uw, 2)} × ${fmtId(1 - wwr, 3)} × ${fmtId(tdek, 1)}`,
          `${fmtId(qw, 2)} W/m²`,
        ],
        [
          'Konduksi kaca',
          `${fmtId(uf, 2)} × ${fmtId(wwr, 3)} × ${fmtId(dt, 1)}`,
          `${fmtId(qg, 2)} W/m²`,
        ],
        [
          'Radiasi surya',
          `${fmtId(sc, 3)} × ${fmtId(wwr, 3)} × ${fmtId(sf, 1)}`,
          `${fmtId(qs, 2)} W/m²`,
        ],
      ];

      for (const [labelTxt, exprTxt, resTxt] of terms) {
        const rDiv = document.createElement('div');
        rDiv.className = 'formula-term-row';
        const lDiv = document.createElement('div');
        lDiv.className = 'lbl';
        lDiv.textContent = labelTxt;
        const eDiv = document.createElement('div');
        eDiv.className = 'muted';
        eDiv.style.fontSize = '11.5px';
        eDiv.textContent = exprTxt;
        const vDiv = document.createElement('b');
        vDiv.style.textAlign = 'right';
        vDiv.textContent = resTxt;
        const leftCol = document.createElement('div');
        leftCol.append(lDiv, eDiv);
        rDiv.append(leftCol, vDiv);
        rowsEl.appendChild(rDiv);
      }

      const sumRow = document.createElement('div');
      sumRow.className = 'formula-sum-row num';
      const sumLbl = document.createElement('span');
      sumLbl.innerHTML = `<span class="formula">OTTV<sub>${code}</sub></span> (luas ${fmtId(mc.ao_m2 ?? 0, 1)} m²)`;
      const sumVal = document.createElement('b');
      sumVal.textContent = `${fmtId(tot, 2)} W/m²`;
      sumRow.append(sumLbl, sumVal);

      sheet.append(rowsEl, sumRow);
    }

    const selSummary = summarizeSelectedPanels(analysis, state.selectedPanelIds);
    if (selSummary && !selSummary.isMulti) {
      const pNote = document.createElement('p');
      pNote.className = 'lbl num';
      pNote.style.margin = '6px 0 0';
      pNote.style.fontWeight = '500';
      pNote.textContent = `Panel terpilih (${selSummary.primaryTypeLabel}): ${fmtId(
        selSummary.primary.ottv_panel_wm2 ?? 0,
        2,
      )} W/m² kontribusi.`;
      sheet.appendChild(pNote);
    }

    wrap.appendChild(sheet);
  }

  // Dragging logic (pointer + keyboard arrows, clamped strictly to viewer bounds)
  const clampAndApply = (left, top) => {
    const parent = wrap.parentElement;
    if (!parent) return;
    const pw = parent.clientWidth || 800;
    const ph = parent.clientHeight || 600;
    const ww = wrap.offsetWidth || 240;
    const wh = bar.offsetHeight || 52;
    const cLeft = Math.max(12, Math.min(pw - ww - 12, left));
    const cTop = Math.max(12, Math.min(ph - wh - 12, top));
    wrap.style.left = `${cLeft}px`;
    wrap.style.top = `${cTop}px`;
    wrap.style.right = 'auto';
    return { left: cLeft, top: cTop };
  };

  let dragState = null;

  gripBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const parent = wrap.parentElement;
    if (!parent) return;
    const pRect = parent.getBoundingClientRect();
    const wRect = wrap.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: wRect.left - pRect.left,
      origTop: wRect.top - pRect.top,
    };
    gripBtn.classList.add('is-dragging');
    try {
      gripBtn.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  });

  gripBtn.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const nextLeft = dragState.origLeft + (e.clientX - dragState.startX);
    const nextTop = dragState.origTop + (e.clientY - dragState.startY);
    clampAndApply(nextLeft, nextTop);
  });

  const endDrag = (e) => {
    if (!dragState) return;
    const nextLeft = dragState.origLeft + (e.clientX - dragState.startX);
    const nextTop = dragState.origTop + (e.clientY - dragState.startY);
    const pos = clampAndApply(nextLeft, nextTop);
    if (pos) savePos(pos);
    dragState = null;
    gripBtn.classList.remove('is-dragging');
    try {
      gripBtn.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };
  gripBtn.addEventListener('pointerup', endDrag);
  gripBtn.addEventListener('pointercancel', endDrag);

  gripBtn.addEventListener('keydown', (e) => {
    const parent = wrap.parentElement;
    if (!parent) return;
    if (e.key === 'Home') {
      e.preventDefault();
      wrap.style.left = '';
      wrap.style.top = '';
      wrap.style.right = '';
      savePos(null);
      return;
    }
    const step = e.shiftKey ? 48 : 16;
    const pRect = parent.getBoundingClientRect();
    const wRect = wrap.getBoundingClientRect();
    let left = wRect.left - pRect.left;
    let top = wRect.top - pRect.top;
    if (e.key === 'ArrowLeft') left -= step;
    else if (e.key === 'ArrowRight') left += step;
    else if (e.key === 'ArrowUp') top -= step;
    else if (e.key === 'ArrowDown') top += step;
    else return;
    e.preventDefault();
    const pos = clampAndApply(left, top);
    if (pos) savePos(pos);
  });

  return wrap;
}
