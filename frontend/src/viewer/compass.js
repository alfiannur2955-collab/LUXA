/**
 * Interactive North Compass (`docs/FASE4_UI_SPEC.md` §4.5):
 * - 52 px glass ring at top-right (`top: 16px, right: 16px`).
 * - Pointer drag rotates `north_angle_deg` (1° step, Shift = 15°).
 * - Keyboard accessible (`ArrowLeft`/`ArrowRight`, Shift = 15°, Home = 0°).
 * - Immediately updates orientation labels & sun dome, and surfaces `"Hitung ulang"`
 *   chip beneath compass when `needsRecompute` is true.
 */

import { compassDialSvg, icon } from '../ui/icons.js';

function normalizeDeg(deg) {
  return ((Math.round(deg) % 360) + 360) % 360;
}

export function renderInteractiveCompass(state, { onChangeNorth, onRecompute } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'compass-wrap';

  const northDeg = normalizeDeg(Number(state.config?.settings?.north_angle_deg || 0));

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'glass compass compass-interactive';
  btn.setAttribute('role', 'slider');
  btn.setAttribute('aria-label', 'Kompas arah utara, geser atau tekan panah kiri/kanan untuk memutar');
  btn.setAttribute('aria-valuemin', '0');
  btn.setAttribute('aria-valuemax', '359');
  btn.setAttribute('aria-valuenow', String(northDeg));
  btn.setAttribute('aria-valuetext', `${northDeg} derajat`);
  btn.title = `Utara ${northDeg}° · geser untuk memutar (tahan Shift = 15°)`;
  btn.innerHTML = compassDialSvg(northDeg);

  let dragging = false;

  const updateAngleFromPointer = (ev) => {
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = ev.clientX - cx;
    const dy = ev.clientY - cy;
    if (Math.hypot(dx, dy) < 4) return;
    // 0° = up (-Y), clockwise positive
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    const step = ev.shiftKey ? 15 : 1;
    const snapped = normalizeDeg(Math.round(deg / step) * step);
    const svg = btn.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${snapped}deg)`;
    btn.setAttribute('aria-valuenow', String(snapped));
    btn.setAttribute('aria-valuetext', `${snapped} derajat`);
    if (typeof onChangeNorth === 'function') {
      onChangeNorth(snapped);
    }
  };

  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    btn.classList.add('is-dragging');
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without pointerId
    }
    updateAngleFromPointer(e);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    updateAngleFromPointer(e);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    btn.classList.remove('is-dragging');
    try {
      btn.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };
  btn.addEventListener('pointerup', endDrag);
  btn.addEventListener('pointercancel', endDrag);

  btn.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 1;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      next = normalizeDeg(northDeg + step);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      next = normalizeDeg(northDeg - step);
    } else if (e.key === 'Home') {
      next = 0;
    }
    if (next !== null) {
      e.preventDefault();
      if (typeof onChangeNorth === 'function') {
        onChangeNorth(next);
      }
    }
  });

  wrap.appendChild(btn);

  // "Hitung ulang" chip appears right under compass when north angle (or settings) changed after analysis
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
