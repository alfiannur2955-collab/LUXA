/**
 * Topbar shell component:
 * - LUXA brand mark (30px, switches to luxa-mark-dark.svg in dark theme) +
 *   "LUXA" (Montserrat 700) + "by Alf Studio" (Montserrat 400) below, no extra tagline.
 * - 4-step indicator in glass tier 3.
 * - Command palette button, theme toggle, Mode lanjut toggle.
 */

import { icon } from '../ui/icons.js';
import { renderSteps } from './steps.js';

export function renderTopbar(state, handlers) {
  const header = document.createElement('header');
  header.className = 'top';

  // Brand link (returns to Upload screen)
  const brand = document.createElement('a');
  brand.href = '#';
  brand.className = 'brand-link';
  brand.setAttribute('aria-label', 'LUXA by Alf Studio, beranda');
  brand.addEventListener('click', (e) => {
    e.preventDefault();
    handlers.onHome();
  });

  const mark = document.createElement('img');
  mark.className = 'brand-mark';
  mark.src = state.theme === 'dark' ? `${import.meta.env.BASE_URL}brand/luxa-mark-dark.svg` : `${import.meta.env.BASE_URL}brand/luxa-mark.svg`;
  mark.alt = '';
  mark.setAttribute('aria-hidden', 'true');
  mark.width = 30;
  mark.height = 30;

  const textWrap = document.createElement('span');
  textWrap.className = 'brand-text';

  const word = document.createElement('span');
  word.className = 'brand-word';
  word.textContent = 'LUXA';

  const sub = document.createElement('span');
  sub.className = 'brand-sub';
  sub.textContent = 'by Alf Studio';

  textWrap.append(word, sub);
  brand.append(mark, textWrap);

  // 4-step indicator
  const stepsNav = renderSteps(state, { onNavigate: handlers.onNavigateStep });

  // Right-side controls
  const actions = document.createElement('div');
  actions.className = 'top-actions';

  const cmdBtn = document.createElement('button');
  cmdBtn.type = 'button';
  cmdBtn.className = 'tbtn';
  cmdBtn.setAttribute('aria-label', 'Cari perintah');
  cmdBtn.innerHTML = `${icon('search', 17)}<span class="muted cmd-label" style="font-weight:500;">Cari perintah</span><kbd>Ctrl K</kbd>`;
  cmdBtn.addEventListener('click', () => handlers.onOpenCommandPalette());

  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'tbtn';
  const isDark = state.theme === 'dark';
  themeBtn.setAttribute('aria-label', isDark ? 'Tema terang' : 'Tema gelap');
  themeBtn.title = isDark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap';
  themeBtn.innerHTML = icon(isDark ? 'sun' : 'moon', 18);
  themeBtn.addEventListener('click', () => handlers.onToggleTheme());

  const advBtn = document.createElement('button');
  advBtn.type = 'button';
  advBtn.className = `tbtn${state.advancedMode ? ' on' : ''}`;
  advBtn.setAttribute('aria-pressed', state.advancedMode ? 'true' : 'false');
  advBtn.innerHTML = `${icon('sliders', 17)}<span>Mode lanjut</span>`;
  advBtn.addEventListener('click', () => handlers.onToggleAdvanced());

  actions.append(cmdBtn, themeBtn, advBtn);
  header.append(brand, stepsNav, actions);
  return header;
}
