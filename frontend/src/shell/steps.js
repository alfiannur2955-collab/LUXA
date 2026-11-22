/**
 * 4-Step progress indicator in the topbar (`Unggah`, `Konfirmasi`, `Inspeksi`, `Hasil`).
 */

import { icon } from '../ui/icons.js';

const STEPS = [
  { id: 'upload', num: '1', label: 'Unggah' },
  { id: 'confirm', num: '2', label: 'Konfirmasi' },
  { id: 'inspect', num: '3', label: 'Inspeksi' },
  { id: 'results', num: '4', label: 'Hasil' },
];

const ORDER = { upload: 0, confirm: 1, inspect: 2, results: 3 };

export function renderSteps(state, { onNavigate }) {
  const nav = document.createElement('nav');
  nav.className = 'steps-nav';
  nav.setAttribute('aria-label', 'Langkah');

  const ol = document.createElement('ol');
  ol.className = 'steps glass-thin';

  const activeStep =
    state.step === 'loading' || state.step === 'error'
      ? state.previousStep || 'upload'
      : state.step === 'compare'
      ? 'results'
      : state.step;
  const activeIdx = ORDER[activeStep] ?? 0;

  for (let i = 0; i < STEPS.length; i += 1) {
    const s = STEPS[i];
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'step-btn';

    const isCurrent = s.id === activeStep;
    const isDone = i < activeIdx;
    const canClick =
      s.id === 'upload' ||
      (s.id === 'confirm' && Boolean(state.inspectData)) ||
      (s.id === 'inspect' && Boolean(state.inspectData)) ||
      (s.id === 'results' && Boolean(state.analysisData));

    if (isCurrent) {
      btn.classList.add('on');
      btn.setAttribute('aria-current', 'step');
    } else if (isDone) {
      btn.classList.add('done');
    }

    btn.disabled = !canClick || state.step === 'loading';

    const badge = document.createElement('span');
    badge.className = 'n';
    if (isDone) {
      badge.innerHTML = icon('check', 12);
    } else {
      badge.textContent = s.num;
    }

    const txt = document.createElement('span');
    txt.textContent = s.label;

    btn.append(badge, txt);
    if (canClick && !isCurrent) {
      btn.addEventListener('click', () => onNavigate(s.id));
    }

    li.appendChild(btn);
    ol.appendChild(li);
  }

  nav.appendChild(ol);
  return nav;
}
