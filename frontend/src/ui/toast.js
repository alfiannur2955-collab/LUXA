/**
 * Accessible toast notification stack (`aria-live="polite"`),
 * with 8-second Undo (`Urungkan`) action support (`docs/RENCANA.md` Fase 4d D4).
 */
import { luxSvg } from './mascot.js';

let stackEl = null;

function ensureStack() {
  if (!(stackEl && document.body.contains(stackEl))) {
    stackEl = document.createElement('div');
    stackEl.className = 'toast-stack';
    stackEl.setAttribute('aria-live', 'polite');
    stackEl.setAttribute('aria-atomic', 'false');
    document.body.appendChild(stackEl);
  }
  positionStack();
  return stackEl;
}

/**
 * Toast di pojok kanan bawah area 3D (ruang yang biasanya kosong), di atas elemen bawah viewer yang
 * bersinggungan dengan pojok itu. Tanpa viewer (mis. halaman Unggah), di pojok kanan bawah layar.
 */
const TOAST_W = 380;
function positionStack() {
  if (!stackEl) return;
  const viewerEl = [...document.querySelectorAll('.viewer')].find((v) => v.offsetParent);
  const st = stackEl.style;
  st.top = 'auto';
  st.left = 'auto';
  st.transform = 'none';
  if (!viewerEl) {
    st.right = '20px';
    st.bottom = '20px';
    st.width = `${Math.min(TOAST_W, window.innerWidth - 32)}px`;
    return;
  }
  const vr = viewerEl.getBoundingClientRect();
  let w = Math.min(TOAST_W, vr.width - 32);
  // elemen bawah viewer di pojok kanan bawah (bar bawah, kartu selisih Bandingkan): bila sisa ruang di
  // kanannya cukup, notifikasi menyempit dan tetap di pojok; kalau tidak, naik ke atas elemen itu
  let floorY = vr.bottom - 16;
  for (const el of viewerEl.querySelectorAll('.viewer-bottom-stack, .compare-diff-strip, .legend')) {
    const r = el.getBoundingClientRect();
    if (!(r.height > 0 && r.top > vr.top + vr.height / 2)) continue;
    if (r.right <= vr.right - 16 - w) continue;
    const room = vr.right - 16 - (r.right + 12);
    if (room >= 240) w = Math.min(w, room);
    else floorY = Math.min(floorY, r.top - 10);
  }
  st.right = `${Math.max(16, Math.round(window.innerWidth - vr.right + 16))}px`;
  st.width = `${Math.round(w)}px`;
  st.bottom = `${Math.max(16, Math.round(window.innerHeight - floorY))}px`;
}

/** Satu notifikasi biasa dalam satu waktu: yang baru menggantikan yang lama, tidak menumpuk. */
function clearPlain(host) {
  host.querySelectorAll('.toast:not(.toast-with-undo)').forEach((t) => t.remove());
}

export function showToast(message, tone = 'ok', durationMs = 4200, { lux = null } = {}) {
  const host = ensureStack();
  clearPlain(host);
  const item = document.createElement('div');
  item.className = `toast is-${tone}${lux ? ' has-lux' : ''}`;
  item.setAttribute('role', 'status');
  if (lux) {
    // Maskot Lux kecil di samping pesan (dekoratif).
    item.innerHTML = luxSvg(lux, { size: 34 });
    const t = document.createElement('span');
    t.textContent = String(message || '');
    item.appendChild(t);
  } else {
    item.textContent = String(message || '');
  }
  host.appendChild(item);

  window.setTimeout(() => {
    item.remove();
  }, durationMs);
}

/**
 * Displays an 8-second toast with an inline "Urungkan" (Undo) button (D4).
 * Deletes never show a blocking modal (except browser project deletion).
 */
export function showUndoToast(message, onUndo, durationMs = 8000) {
  const host = ensureStack();
  const item = document.createElement('div');
  item.className = 'toast is-warn toast-with-undo';
  item.setAttribute('role', 'status');

  const msg = document.createElement('span');
  msg.style.flex = '1';
  msg.textContent = String(message || '');

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'toast-undo-btn';
  undoBtn.textContent = 'Urungkan';

  let undone = false;
  const timer = window.setTimeout(() => {
    item.remove();
  }, durationMs);

  undoBtn.addEventListener('click', () => {
    if (undone) return;
    undone = true;
    window.clearTimeout(timer);
    item.remove();
    try {
      onUndo?.();
    } catch (err) {
      console.error('[LUXA undo error]', err);
    }
  });

  item.append(msg, undoBtn);
  host.appendChild(item);
}
