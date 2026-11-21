/**
 * Screen 5: Memuat & Galat (`docs/FASE4_UI_SPEC.md` §3.5 + mockup 5-memuat-galat.html).
 * - Memuat: 8-line compass loader (stops on prefers-reduced-motion), filename, size,
 *   real stage list, Cancel button.
 * - Galat: what failed, why, actionable bullets, and 2 buttons.
 */

import { compassLoaderSvg, icon } from '../ui/icons.js';

export function renderLoadingScreen(state) {
  const main = document.createElement('main');
  main.className = 'main main-status';

  const box = document.createElement('section');
  box.className = 'box status-box';
  box.setAttribute('aria-labelledby', 'ld-title');
  box.setAttribute('aria-busy', 'true');

  const inner = document.createElement('div');
  inner.className = 'status-inner';

  const loaderWrap = document.createElement('div');
  loaderWrap.innerHTML = compassLoaderSvg();

  const loading = state.loading || {
    title: 'Memproses model',
    subtitle: 'Mohon tunggu sebentar.',
    stages: [],
  };

  const headWrap = document.createElement('div');
  const h1 = document.createElement('h1');
  h1.id = 'ld-title';
  h1.style.margin = '0';
  h1.style.fontSize = '22px';
  h1.style.lineHeight = '28px';
  h1.style.fontWeight = '700';
  h1.textContent = loading.title || 'Memproses model';

  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.style.margin = '4px 0 0';
  sub.textContent = loading.subtitle || '';

  headWrap.append(h1, sub);

  const ol = document.createElement('ol');
  ol.className = 'stage-list';
  ol.setAttribute('aria-live', 'polite');

  for (const st of loading.stages || []) {
    const li = document.createElement('li');

    const iconSlot = document.createElement('span');
    iconSlot.style.display = 'grid';
    iconSlot.style.placeItems = 'center';
    if (st.status === 'done') {
      iconSlot.className = 'st-ok';
      iconSlot.innerHTML = icon('check', 18);
    } else if (st.status === 'running') {
      iconSlot.innerHTML =
        '<span style="width:10px;height:10px;border-radius:5px;background:var(--sun);display:inline-block;"></span>';
    } else {
      iconSlot.innerHTML =
        '<span style="width:10px;height:10px;border-radius:5px;border:1.5px solid var(--line-strong);display:inline-block;"></span>';
    }

    const labelEl = document.createElement('span');
    labelEl.style.fontWeight = st.status === 'running' ? '600' : '500';
    labelEl.textContent = st.label;

    const statusEl = document.createElement('span');
    statusEl.className = 'lbl';
    statusEl.style.fontWeight = '500';
    statusEl.textContent =
      st.status === 'done' ? 'selesai' : st.status === 'running' ? 'berjalan' : 'menunggu';

    li.append(iconSlot, labelEl, statusEl);
    ol.appendChild(li);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ghost';
  cancelBtn.textContent = 'Batalkan';
  cancelBtn.addEventListener('click', () => {
    if (typeof loading.onCancel === 'function') {
      loading.onCancel();
    }
  });

  inner.append(loaderWrap, headWrap, ol, cancelBtn);
  box.appendChild(inner);
  main.appendChild(box);
  return main;
}

export function renderErrorScreen(state) {
  const main = document.createElement('main');
  main.className = 'main main-status';

  const box = document.createElement('section');
  box.className = 'box status-box';
  box.setAttribute('aria-labelledby', 'er-title');

  const inner = document.createElement('div');
  inner.className = 'status-inner';

  const iconBox = document.createElement('div');
  iconBox.className = 'error-icon-box';
  iconBox.innerHTML = icon('warn', 32);

  const err = state.error || {
    title: 'Gagal memproses model',
    detail: 'Terjadi kesalahan saat membaca file.',
    tips: ['Pastikan format file adalah .3dm, .ifc, .obj, atau .glb.', 'Coba unggah ulang file model.'],
  };

  const h1 = document.createElement('h1');
  h1.id = 'er-title';
  h1.style.margin = '0';
  h1.style.fontSize = '22px';
  h1.style.lineHeight = '28px';
  h1.style.fontWeight = '700';
  h1.textContent = err.title || 'Terjadi kendala';

  const detail = document.createElement('p');
  detail.className = 'muted';
  detail.style.margin = '0';
  detail.textContent = err.detail || '';

  const tipsCard = document.createElement('div');
  tipsCard.className = 'error-tips-card';

  const tipsTitle = document.createElement('p');
  tipsTitle.className = 'lbl';
  tipsTitle.style.margin = '0 0 6px';
  tipsTitle.style.color = 'var(--ink)';
  tipsTitle.textContent = 'Yang bisa kamu lakukan';

  const ul = document.createElement('ul');
  ul.style.margin = '0';
  ul.style.paddingLeft = '18px';
  ul.style.fontSize = '13px';
  ul.style.lineHeight = '20px';

  for (const tip of err.tips || []) {
    const li = document.createElement('li');
    li.textContent = tip;
    ul.appendChild(li);
  }

  tipsCard.append(tipsTitle, ul);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.flexWrap = 'wrap';
  actions.style.justifyContent = 'center';

  if (err.primaryAction) {
    const btn1 = document.createElement('button');
    btn1.type = 'button';
    btn1.className = 'cta';
    btn1.textContent = err.primaryAction.label;
    btn1.addEventListener('click', err.primaryAction.onClick);
    actions.appendChild(btn1);
  }

  if (err.secondaryAction) {
    const btn2 = document.createElement('button');
    btn2.type = 'button';
    btn2.className = 'ghost';
    btn2.textContent = err.secondaryAction.label;
    btn2.addEventListener('click', err.secondaryAction.onClick);
    actions.appendChild(btn2);
  }

  inner.append(iconBox, h1, detail, tipsCard, actions);
  box.appendChild(inner);
  main.appendChild(box);
  return main;
}
