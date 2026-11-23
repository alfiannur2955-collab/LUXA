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
 * Toast ditengahkan di bagian bawah area 3D, tepat di atas elemen bawah viewer (bar bawah, kartu selisih
 * Bandingkan), supaya hanya menutupi model dan tidak menutupi tombol, kartu, atau kolom kanan. Tanpa viewer
 * (mis. halaman Unggah), toast ditengahkan di bawah layar.
 */
function positionStack() {
  if (!stackEl) return;
  const viewerEl = [...document.querySelectorAll('.viewer')].find((v) => v.offsetParent);
  const st = stackEl.style;
  st.top = 'auto';
  st.right = 'auto';
  if (!viewerEl) {
    st.left = '50%';
    st.bottom = '24px';
    st.width = '';
    return;
  }
  const vr = viewerEl.getBoundingClientRect();
  let floorY = vr.bottom - 16;
  for (const el of viewerEl.querySelectorAll('.viewer-bottom-stack, .compare-diff-strip')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) floorY = Math.min(floorY, r.top);
  }
  st.left = `${Math.round(vr.left + vr.width / 2)}px`;
  st.width = `${Math.round(Math.min(460, vr.width - 32))}px`;
  st.bottom = `${Math.max(16, Math.round(window.innerHeight - floorY + 10))}px`;
}

export function showToast(message, tone = 'ok', durationMs = 4200, { lux = null } = {}) {
  const host = ensureStack();
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
