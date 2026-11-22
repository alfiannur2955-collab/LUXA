/**
 * Accessible toast notification stack (`aria-live="polite"`),
 * with 8-second Undo (`Urungkan`) action support (`docs/RENCANA.md` Fase 4d D4).
 */

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
 * Toast diletakkan di pojok kanan bawah area 3D, tepat di atas bar bawah viewer, supaya hanya
 * menutupi model dan tidak pernah menutupi tombol, kartu, atau kolom kanan. Tanpa viewer
 * (mis. halaman Unggah), toast ada di pojok kanan atas di bawah topbar.
 */
function positionStack() {
  if (!stackEl) return;
  const viewerEl = [...document.querySelectorAll('.viewer')].find((v) => v.offsetParent);
  const st = stackEl.style;
  if (!viewerEl) {
    st.top = '72px';
    st.right = '16px';
    st.bottom = 'auto';
    return;
  }
  const vr = viewerEl.getBoundingClientRect();
  const stack = viewerEl.querySelector('.viewer-bottom-stack');
  const floorY = stack ? stack.getBoundingClientRect().top : vr.bottom - 16;
  st.top = 'auto';
  st.right = `${Math.max(16, window.innerWidth - vr.right + 16)}px`;
  st.bottom = `${Math.max(16, window.innerHeight - floorY + 10)}px`;
}

export function showToast(message, tone = 'ok', durationMs = 4200) {
  const host = ensureStack();
  const item = document.createElement('div');
  item.className = `toast glass is-${tone}`;
  item.setAttribute('role', 'status');
  item.textContent = String(message || '');
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
  item.className = 'toast glass is-warn toast-with-undo';
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
