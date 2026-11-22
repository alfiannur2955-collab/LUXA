/**
 * Read-Only North Compass Indicator (`docs/RENCANA.md` Fase 4d D2):
 * - 52 px glass ring at top-right (`top: 16px, right: 16px`).
 * - Pure directional indicator (non-clickable, non-draggable) with `aria-label="Utara di ...°"`.
 * - North rotation is performed exclusively via the D5 floor rotation ring (`northRing.js`, shortcut `R`).
 * - Displays `"Hitung ulang"` chip beneath compass when `needsRecompute` is true.
 */

import { fmtId } from '../ui/escapeHtml.js';
import { compassDialSvg, icon } from '../ui/icons.js';

function normalizeDeg(deg) {
  const n = Number(deg) || 0;
  return ((n % 360) + 360) % 360;
}

export function renderInteractiveCompass(state, { onRecompute } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'compass-wrap';

  const northDeg = normalizeDeg(state.config?.settings?.north_angle_deg ?? 0);
  const degTxt = Math.abs(northDeg - Math.round(northDeg)) < 0.05
    ? `${Math.round(northDeg)}°`
    : `${fmtId(northDeg, 1)}°`;

  const indicator = document.createElement('div');
  indicator.className = 'glass compass compass-indicator';
  indicator.setAttribute('role', 'img');
  indicator.setAttribute('aria-label', `Utara di ${degTxt}`);
  indicator.title = `Utara di ${degTxt} (tekan R untuk memutar utara)`;
  indicator.innerHTML = compassDialSvg(northDeg);

  wrap.appendChild(indicator);

  // "Hitung ulang" chip appears right under compass after north/geometry/location changes (never auto-recomputes)
  if (state.needsRecompute && state.analysisData && typeof onRecompute === 'function') {
    const recalc = document.createElement('button');
    recalc.type = 'button';
    recalc.className = 'glass compass-recalc-chip';
    recalc.innerHTML = `${icon('play', 13)}<span>Hitung ulang</span>`;
    recalc.title = 'Arah utara atau pengaturan berubah; klik untuk menghitung ulang OTTV';
    recalc.addEventListener('click', () => onRecompute());
    wrap.appendChild(recalc);
  }

  return wrap;
}
