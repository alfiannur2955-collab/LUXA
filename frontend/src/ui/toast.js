/**
 * Accessible toast notification stack (`aria-live="polite"`),
 * with 8-second Undo (`Urungkan`) action support (`docs/RENCANA.md` Fase 4d D4).
 */

let stackEl = null;

function ensureStack() {
  if (stackEl && document.body.contains(stackEl)) return stackEl;
  stackEl = document.createElement('div');
  stackEl.className = 'toast-stack';
  stackEl.setAttribute('aria-live', 'polite');
  stackEl.setAttribute('aria-atomic', 'false');
  document.body.appendChild(stackEl);
  return stackEl;
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
