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
    const isHeatDisabled = m.id === 'heatmap' && !hasAnalysis;
    const isOn = activeMode === m.id && !isHeatDisabled;
    if (isOn) btn.className = 'on';
    btn.disabled = isHeatDisabled;
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    if (isHeatDisabled) {
      btn.title = 'Tersedia setelah OTTV dihitung';
    }
    btn.innerHTML = `${icon(m.icon, 16)}<span>${m.label}</span>`;
    btn.addEventListener('click', () => {
      if (!isHeatDisabled) onSelectMode(m.id);
    });
    bar.appendChild(btn);
  }

  return bar;
}
