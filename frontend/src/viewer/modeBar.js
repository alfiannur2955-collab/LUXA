/**
 * Bar mode tampilan: 4 mode pewarnaan (Klasifikasi, Orientasi, Heatmap, Matahari)
 * + 2 alat periksa yang bisa digabung (Perlu dicek, Transparan).
 * Heatmap & Matahari baru muncul setelah OTTV dihitung.
 */

import { icon } from '../ui/icons.js';
import { VIEWER_MODES, VIEWER_OVERLAYS, resolveViewerMode } from './modes.js';

export function renderViewerModeBar(state, onSelectMode, { onToggleOverlay = null } = {}) {
  const bar = document.createElement('div');
  const atBottom = state.workspace?.modeBarPosition === 'bottom';
  bar.className = `glass modes${atBottom ? ' modes-bottom' : ''}`;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Mode tampilan');

  const hasAnalysis = Boolean(state.analysisData);
  const view = resolveViewerMode(state);

  for (const m of VIEWER_MODES) {
    if (m.needsAnalysis && !hasAnalysis) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    const isOn = view.mode === m.id;
    if (isOn) btn.className = 'on';
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    btn.title = m.hint || m.label;
    btn.innerHTML = `${icon(m.icon, 16)}<span class="modes-lbl">${m.label}</span>`;
    btn.addEventListener('click', () => onSelectMode(m.id));
    bar.appendChild(btn);
  }

  if (typeof onToggleOverlay === 'function') {
    const hr = document.createElement('hr');
    hr.setAttribute('aria-hidden', 'true');
    bar.appendChild(hr);
    for (const o of VIEWER_OVERLAYS) {
      const on = Boolean(view[o.id]);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `modes-tool${on ? ' on' : ''}`;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', o.label);
      btn.title = `${o.label}: ${o.hint}${on ? ' (aktif, klik untuk matikan)' : ''}`;
      btn.innerHTML = `${icon(o.icon, 16)}<span class="modes-lbl">${o.label}</span>`;
      btn.addEventListener('click', () => onToggleOverlay(o.id, !on));
      bar.appendChild(btn);
    }
  }

  return bar;
}
