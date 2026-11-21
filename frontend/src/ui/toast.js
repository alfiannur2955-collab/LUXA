/**
 * Accessible toast notification stack (`aria-live="polite"`).
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
