/**
 * Left icon + label rail (`Model`, `Material`, `Lokasi`, `Tampilan`, `Bandingkan`, `Laporan`, `Bantuan`).
 */

import { icon } from '../ui/icons.js';
import { DEFAULT_RAIL_ORDER, RAIL_ITEM_META } from '../ui/workspace.js';

export function renderRail(state, { onToggleCard }) {
  const nav = document.createElement('nav');
  nav.className = 'rail';
  nav.setAttribute('aria-label', 'Fitur');

  const inner = document.createElement('div');
  inner.className = 'rail-in glass-thin';

  const order = state.workspace?.railOrder || DEFAULT_RAIL_ORDER;
  const hidden = new Set(state.workspace?.hiddenRailItems || []);

  for (const id of order) {
    const item = RAIL_ITEM_META[id];
    if (!item) continue;
    if (hidden.has(id) && !item.lockVisible) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive =
      state.activeRailCard === item.id ||
      (item.id === 'compare' && state.step === 'compare') ||
      (item.id === 'material' && Boolean(state.materialCatalog?.open));
    btn.className = `rail-btn${isActive ? ' on' : ''}`;
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.innerHTML = `${icon(item.icon, 21)}<span>${item.label}</span>`;
    btn.addEventListener('click', () => onToggleCard(item.id));
    inner.appendChild(btn);
  }

  const sp = document.createElement('span');
  sp.className = 'rail-sp';
  inner.appendChild(sp);

  const helpBtn = document.createElement('button');
  helpBtn.type = 'button';
  const helpActive = state.activeRailCard === 'help';
  helpBtn.className = `rail-btn${helpActive ? ' on' : ''}`;
  helpBtn.setAttribute('aria-pressed', helpActive ? 'true' : 'false');
  helpBtn.innerHTML = `${icon('help', 21)}<span>Bantuan</span>`;
  helpBtn.addEventListener('click', () => onToggleCard('help'));
  inner.appendChild(helpBtn);

  nav.appendChild(inner);
  return nav;
}
