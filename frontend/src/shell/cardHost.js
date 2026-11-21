/**
 * Feature card host: displays ONE rail feature card at a time (`glass` tier 1).
 * Pressing Escape or clicking the close button closes it.
 */

import { icon } from '../ui/icons.js';

export function renderCardHost(state, { panelBuilders, onClose }) {
  const host = document.createElement('aside');
  host.className = 'card-host glass';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'false');

  const activeId = state.activeRailCard;
  if (!activeId || !panelBuilders[activeId]) {
    host.hidden = true;
    return host;
  }

  const { title, renderBody } = panelBuilders[activeId];
  host.setAttribute('aria-label', title);

  const head = document.createElement('div');
  head.className = 'card-host-head';

  const h2 = document.createElement('h2');
  h2.textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tbtn';
  closeBtn.style.height = '34px';
  closeBtn.style.minWidth = '34px';
  closeBtn.style.padding = '0';
  closeBtn.setAttribute('aria-label', 'Tutup kartu');
  closeBtn.innerHTML = icon('close', 16);
  closeBtn.addEventListener('click', onClose);

  head.append(h2, closeBtn);
  host.appendChild(head);

  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gap = '12px';
  renderBody(body, state);
  host.appendChild(body);

  return host;
}
