/**
 * Kompas viewer (`docs/RENCANA.md` Fase 4d D2):
 * - 52 px glass ring at top-right (`top: 16px, right: 16px`).
 * - Jarum ikut berputar mengikuti kamera (diperbarui viewer tiap frame lewat `.compass-live`).
 * - Klik: pandangan diputar menghadap utara (utara di atas layar).
 * - Mengubah arah utara proyek tetap lewat cincin putar D5 (`northRing.js`, tombol `R`).
 * - Displays `"Hitung ulang"` chip beneath compass when `needsRecompute` is true.
 */

import { fmtId } from '../ui/escapeHtml.js';
import { compassDialSvg, icon } from '../ui/icons.js';
import { viewer } from './viewer.js';

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

  const indicator = document.createElement('button');
  indicator.type = 'button';
  indicator.className = 'glass compass compass-indicator compass-live';
  indicator.setAttribute('aria-label', `Kompas, utara proyek ${degTxt}. Klik untuk menghadap utara`);
  indicator.title = `Klik: hadap utara · Utara proyek ${degTxt} (tekan R untuk mengubah)`;
  indicator.innerHTML = compassDialSvg(viewer._compassDeg ?? northDeg);
  indicator.addEventListener('click', () => viewer.faceNorth());

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
