/**
 * Unified 5-mode viewer toolbar (`docs/FASE4_UI_SPEC.md` §4.2 & §5):
 * Klasifikasi, Orientasi, Heatmap | Kejanggalan, X-ray
 */

import { icon } from '../ui/icons.js';
import { VIEWER_MODES } from './modes.js';

export function renderViewerModeBar(state, onSelectMode) {
  const bar = document.createElement('div');
  const atBottom = state.workspace?.modeBarPosition === 'bottom';
  bar.className = `glass modes${atBottom ? ' modes-bottom' : ''}`;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Mode tampilan');

  const hasAnalysis = Boolean(state.analysisData);
  const activeMode = state.viewerMode || (hasAnalysis ? 'heatmap' : 'classification');

  let prevGroup = null;
  for (const m of VIEWER_MODES) {
    if (prevGroup && prevGroup !== m.group) {
      const hr = document.createElement('hr');
      hr.setAttribute('aria-hidden', 'true');
      bar.appendChild(hr);
    }
    prevGroup = m.group;

    const btn = document.createElement('button');
    btn.type = 'button';
    const isHeatDisabled = (m.id === 'heatmap' || m.id === 'exposure') && !hasAnalysis;
    const isOn = activeMode === m.id && !isHeatDisabled;
    if (isOn) btn.className = 'on';
    btn.disabled = isHeatDisabled;
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    // Ringkas: hanya mode aktif yang menampilkan label; lainnya ikon + tooltip.
    btn.title = isHeatDisabled ? `${m.label}: tersedia setelah OTTV dihitung` : m.hint || m.label;
    btn.setAttribute('aria-label', m.label);
    btn.innerHTML = `${icon(m.icon, 16)}<span class="modes-lbl">${m.label}</span>`;
    btn.addEventListener('click', () => {
      if (!isHeatDisabled) onSelectMode(m.id);
    });
    bar.appendChild(btn);
  }

  return bar;
}
