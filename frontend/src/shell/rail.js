/**
 * Left icon + label rail (`Model`, `Material`, `Lokasi`, `Tampilan`, `Bandingkan`, `Laporan`, `Bantuan`).
 */

import { icon } from '../ui/icons.js';

const RAIL_ITEMS = [
  { id: 'model', label: 'Model', icon: 'cube' },
  { id: 'material', label: 'Material', icon: 'layers' },
  { id: 'location', label: 'Lokasi', icon: 'pin' },
  { id: 'display', label: 'Tampilan', icon: 'eye' },
  { id: 'compare', label: 'Bandingkan', icon: 'compare' },
  { id: 'report', label: 'Laporan', icon: 'doc' },
];

export function renderRail(state, { onToggleCard }) {
  const nav = document.createElement('nav');
  nav.className = 'rail';
  nav.setAttribute('aria-label', 'Fitur');

  const inner = document.createElement('div');
  inner.className = 'rail-in glass-thin';

  for (const item of RAIL_ITEMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = state.activeRailCard === item.id;
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
