/**
 * Viewer Bottom Pills (`.vbar`) for Fase 4b-1 (`docs/FASE4_UI_SPEC.md` §4.1, §4.7, §5):
 * - Left pill: 4 projections (Persp, 2 titik, Akso, Tampak) + accessible 8-direction + Atas menu
 * - Right pill: Saved views dropdown (apply, rename, delete) + Simpan (S) + Capture 1x/2x/4x (C)
 */

import { computeInitialSunDomeRadiusM, parseDecimalInput } from '../state.js';
import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { DIRECTION_NAMES, formatCameraDirectionLabel, PROJECTION_SHORT } from './cameras.js';

function radiusToLogSlider(radiusM, initR) {
  const minR = Math.max(1, initR * 0.2);
  const maxR = Math.max(minR * 2, initR * 10);
  const clamped = Math.max(minR, Math.min(maxR, Number(radiusM) || initR));
  return Math.round((Math.log(clamped / minR) / Math.log(maxR / minR)) * 1000);
}

function logSliderToRadius(sliderVal, initR) {
  const minR = Math.max(1, initR * 0.2);
  const maxR = Math.max(minR * 2, initR * 10);
  const t = Math.max(0, Math.min(1, Number(sliderVal) / 1000));
  const raw = minR * Math.pow(maxR / minR, t);
  return Math.round(raw * 10) / 10;
}

const PROJECTIONS = [
  { id: 'perspective', label: 'Persp', key: '1' },
  { id: 'two_point', label: '2 titik', key: '2' },
  { id: 'axonometric', label: 'Akso', key: '3' },
  { id: 'elevation', label: 'Tampak', key: '4' },
];

const DIRECTIONS_ORDERED = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL', 'Atas'];

// Track which saved view is currently in inline rename mode
let renamingViewId = null;

export function renderViewerBottomBar(state, handlers) {
  const bar = document.createElement('div');
  bar.className = 'vbar';

  // ==================== LEFT PILL: Projections + Direction ====================
  const leftWrap = document.createElement('div');
  leftWrap.className = 'vbar-anchor';

  const leftPill = document.createElement('div');
  leftPill.className = 'glass pill';
  leftPill.setAttribute('role', 'toolbar');
  leftPill.setAttribute('aria-label', 'Pintasan tampilan');

  const seg = document.createElement('div');
  seg.className = 'seg2';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Proyeksi');

  for (const p of PROJECTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isOn = state.cameraProjection === p.id;
    btn.className = `b${isOn ? ' on' : ''}`;
    btn.title = `Pintasan ${p.key}`;
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    btn.textContent = p.label;
    btn.addEventListener('click', () => handlers.onSetProjection(p.id));
    seg.appendChild(btn);
  }

  const div1 = document.createElement('span');
  div1.className = 'div';
  div1.setAttribute('aria-hidden', 'true');

  const dirBtn = document.createElement('button');
  dirBtn.type = 'button';
  dirBtn.className = `b${state.openPopover === 'direction' ? ' on' : ''}`;
  dirBtn.title = 'Tahan V untuk pie 8 arah';
  dirBtn.setAttribute('aria-haspopup', 'menu');
  dirBtn.setAttribute('aria-expanded', state.openPopover === 'direction' ? 'true' : 'false');
  const dirLabel = formatCameraDirectionLabel(state.cameraProjection, state.cameraDirection || 'TG');
  dirBtn.innerHTML = `${icon('compass', 15)}<span>${dirLabel}</span>${icon('chevronDown', 13)}`;
  dirBtn.addEventListener('click', () =>
    handlers.onTogglePopover(state.openPopover === 'direction' ? null : 'direction'),
  );

  leftPill.append(seg, div1, dirBtn);

  // Fase 4d D2: North rotation ring toggle button (shortcut R)
  if (handlers.onToggleNorthRotateMode) {
    const northBtn = document.createElement('button');
    northBtn.type = 'button';
    northBtn.className = `b${state.northRotateMode ? ' on' : ''}`;
    northBtn.title = 'Putar arah utara dengan cincin D5 (Pintasan R)';
    northBtn.setAttribute('aria-pressed', state.northRotateMode ? 'true' : 'false');
    northBtn.setAttribute('aria-label', 'Putar arah utara (pintasan R)');
    northBtn.innerHTML = `${icon('rotateCw', 14)}<span>Utara</span>`;
    northBtn.addEventListener('click', () => handlers.onToggleNorthRotateMode());
    leftPill.appendChild(northBtn);
  }

  // Fase 4b-2 + 4d D1: Sun playback, hour slider, & Kubah radius popover trigger in left pill
  if (state.step === 'results' && state.analysisData && handlers.onChangeSunHour) {
    const div2 = document.createElement('span');
    div2.className = 'div';
    div2.setAttribute('aria-hidden', 'true');

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = `b${state.sunPlaying ? ' on' : ''}`;
    playBtn.style.padding = '0 8px';
    playBtn.setAttribute(
      'aria-label',
      state.sunPlaying ? 'Jeda animasi matahari, pintasan Spasi' : 'Putar matahari satu hari, pintasan Spasi',
    );
    playBtn.title = state.sunPlaying ? 'Jeda (Spasi)' : 'Putar satu hari (Spasi)';
    playBtn.setAttribute('aria-pressed', state.sunPlaying ? 'true' : 'false');
    playBtn.innerHTML = icon(state.sunPlaying ? 'pause' : 'play', 14);
    playBtn.addEventListener('click', () => handlers.onToggleSunPlay?.());

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '6';
    slider.max = '18';
    slider.step = '1';
    slider.value = String(Math.round(Number(state.sunHour ?? 13)));
    slider.setAttribute('aria-label', 'Jam matahari');
    slider.style.width = '72px';
    slider.style.accentColor = 'var(--sun)';
    slider.addEventListener('input', () => {
      handlers.onChangeSunHour(Number(slider.value));
    });

    const hourTxt = document.createElement('span');
    hourTxt.className = 'num';
    hourTxt.style.fontSize = '12px';
    hourTxt.style.fontWeight = '700';
    hourTxt.style.padding = '0 4px';
    hourTxt.style.whiteSpace = 'nowrap';
    hourTxt.textContent = `${String(Math.round(Number(state.sunHour ?? 13))).padStart(2, '0')}.00`;

    leftPill.append(div2, playBtn, slider, hourTxt);

    if (handlers.onChangeSunDomeRadius) {
      const domeBtn = document.createElement('button');
      domeBtn.type = 'button';
      domeBtn.className = `b${state.openPopover === 'sundome' ? ' on' : ''}`;
      domeBtn.style.padding = '0 7px';
      domeBtn.title = 'Atur radius kubah matahari (meter)';
      domeBtn.setAttribute('aria-haspopup', 'dialog');
      domeBtn.setAttribute('aria-expanded', state.openPopover === 'sundome' ? 'true' : 'false');
      domeBtn.setAttribute('aria-label', 'Atur radius kubah matahari');
      domeBtn.innerHTML = icon('sun', 14);
      domeBtn.addEventListener('click', () =>
        handlers.onTogglePopover(state.openPopover === 'sundome' ? null : 'sundome'),
      );
      leftPill.appendChild(domeBtn);
    }
  }

  leftWrap.appendChild(leftPill);

  // Fase 4d D1: Sun dome manual radius popover (log slider 0.2x..10x + "Radius __ m" input)
  if (state.openPopover === 'sundome' && handlers.onChangeSunDomeRadius) {
    const bbox = state.analysisData?.summary?.bounding_box || state.inspectData?.bounding_box || null;
    const initR = Math.max(4, Number(state.sunDomeInitialRadiusM || computeInitialSunDomeRadiusM(bbox)));
    const curR = Math.max(1, Number(state.sunDomeRadiusM ?? state.config?.settings?.sun_dome_radius_m ?? initR));

    const pop = document.createElement('div');
    pop.className = 'glass vbar-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Radius kubah matahari');

    const ttl = document.createElement('div');
    ttl.className = 'lbl';
    ttl.style.color = 'var(--ink)';
    ttl.style.marginBottom = '8px';
    ttl.textContent = 'Radius kubah matahari (skala logaritmik)';

    const logSlider = document.createElement('input');
    logSlider.type = 'range';
    logSlider.min = '0';
    logSlider.max = '1000';
    logSlider.step = '1';
    logSlider.value = String(radiusToLogSlider(curR, initR));
    logSlider.setAttribute('aria-label', 'Slider logaritmik radius kubah');
    logSlider.style.width = '100%';
    logSlider.style.accentColor = 'var(--sun)';
    logSlider.addEventListener('input', () => {
      handlers.onChangeSunDomeRadius(logSliderToRadius(logSlider.value, initR));
    });

    const inputRow = document.createElement('div');
    inputRow.style.display = 'flex';
    inputRow.style.alignItems = 'center';
    inputRow.style.gap = '6px';
    inputRow.style.marginTop = '8px';

    const lbl = document.createElement('label');
    lbl.className = 'lbl';
    lbl.htmlFor = 'vbar-dome-radius-inp';
    lbl.textContent = 'Radius';

    const inp = document.createElement('input');
    inp.id = 'vbar-dome-radius-inp';
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.className = 'field-input num';
    inp.style.height = '32px';
    inp.style.width = '88px';
    inp.value = fmtId(curR, curR % 1 ? 1 : 0);
    const applyTyped = () => {
      const v = parseDecimalInput(inp.value);
      if (Number.isFinite(v) && v >= 1 && v <= 5000) {
        handlers.onChangeSunDomeRadius(Math.round(v * 10) / 10);
      } else {
        inp.value = fmtId(curR, curR % 1 ? 1 : 0);
      }
    };
    inp.addEventListener('change', applyTyped);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyTyped();
      }
    });

    const unit = document.createElement('span');
    unit.className = 'lbl';
    unit.textContent = 'm';

    inputRow.append(lbl, inp, unit);

    const hint = document.createElement('p');
    hint.className = 'lbl';
    hint.style.margin = '6px 0 0';
    hint.style.fontWeight = '500';
    hint.textContent = 'Atau tarik pegangan bulat di cincin horizon kubah (Shift = 5 m).';

    pop.append(ttl, logSlider, inputRow, hint);
    leftWrap.appendChild(pop);
  }

  // Direction menu popover (keyboard navigable with arrow keys)
  if (state.openPopover === 'direction') {
    const pop = document.createElement('div');
    pop.className = 'glass vbar-popover';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', 'Pilih arah pandang');

    const title = document.createElement('div');
    title.className = 'lbl';
    title.style.marginBottom = '6px';
    title.textContent = 'Arah pandang (atau tahan V)';
    pop.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'dir-menu-grid';

    const buttons = [];
    for (const code of DIRECTIONS_ORDERED) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      const isCur = state.cameraDirection === code;
      b.className = `dir-menu-btn${isCur ? ' on' : ''}`;
      b.setAttribute('aria-label', `Tampak ${DIRECTION_NAMES[code] || code}`);
      b.textContent = code;
      b.addEventListener('click', () => {
        handlers.onSelectDirection(code);
        handlers.onTogglePopover(null);
      });
      buttons.push(b);
      grid.appendChild(b);
    }

    grid.addEventListener('keydown', (e) => {
      const idx = buttons.indexOf(document.activeElement);
      if (idx === -1) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        buttons[(idx + 1) % buttons.length].focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        buttons[(idx - 1 + buttons.length) % buttons.length].focus();
      }
    });

    pop.appendChild(grid);
    leftWrap.appendChild(pop);
    window.requestAnimationFrame(() => {
      const activeIdx = Math.max(0, DIRECTIONS_ORDERED.indexOf(state.cameraDirection));
      buttons[activeIdx]?.focus();
    });
  }

  // ==================== RIGHT PILL: Saved Views + Simpan + Capture ====================
  const rightWrap = document.createElement('div');
  rightWrap.className = 'vbar-anchor';

  const rightPill = document.createElement('div');
  rightPill.className = 'glass pill';
  rightPill.setAttribute('role', 'toolbar');
  rightPill.setAttribute('aria-label', 'View tersimpan dan capture');

  const views = state.config?.saved_views || [];
  const activeView = views.find((v) => v.id === state.activeViewId);
  const defaultDirPhrase = formatCameraDirectionLabel(state.cameraProjection, state.cameraDirection || 'TG');
  const viewTriggerText =
    activeView?.name ||
    (state.cameraProjection === 'elevation'
      ? defaultDirPhrase
      : `${defaultDirPhrase} · ${PROJECTION_SHORT[state.cameraProjection] || 'Persp'}`);

  const viewsBtn = document.createElement('button');
  viewsBtn.type = 'button';
  viewsBtn.className = `b${state.openPopover === 'views' ? ' on' : ''}`;
  viewsBtn.setAttribute('aria-haspopup', 'listbox');
  viewsBtn.setAttribute('aria-expanded', state.openPopover === 'views' ? 'true' : 'false');
  const vtSpan = document.createElement('span');
  vtSpan.style.maxWidth = '122px';
  vtSpan.style.overflow = 'hidden';
  vtSpan.style.textOverflow = 'ellipsis';
  vtSpan.textContent = viewTriggerText;
  viewsBtn.innerHTML = icon('eye', 15);
  viewsBtn.appendChild(vtSpan);
  const chev = document.createElement('span');
  chev.innerHTML = icon('chevronDown', 13);
  viewsBtn.appendChild(chev);
  viewsBtn.addEventListener('click', () => {
    renamingViewId = null;
    handlers.onTogglePopover(state.openPopover === 'views' ? null : 'views');
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'b';
  saveBtn.title = 'Simpan view (Pintasan S)';
  saveBtn.innerHTML = `${icon('plus', 14)}<span>Simpan</span>`;
  saveBtn.addEventListener('click', () => handlers.onSaveView());

  const captureBtn = document.createElement('button');
  captureBtn.type = 'button';
  captureBtn.className = 'b dark';
  captureBtn.title = `Capture PNG ${state.captureScale}x (Pintasan C)`;
  captureBtn.setAttribute('aria-haspopup', 'menu');
  captureBtn.setAttribute('aria-expanded', state.openPopover === 'capture' ? 'true' : 'false');
  captureBtn.innerHTML = `${icon('camera', 15)}<span>Capture</span>`;
  captureBtn.addEventListener('click', () =>
    handlers.onTogglePopover(state.openPopover === 'capture' ? null : 'capture'),
  );

  rightPill.append(viewsBtn, saveBtn, captureBtn);
  rightWrap.appendChild(rightPill);

  // Saved views popover (apply, inline rename, delete)
  if (state.openPopover === 'views') {
    const pop = document.createElement('div');
    pop.className = 'glass vbar-popover vbar-popover-right';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Daftar view tersimpan');

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    head.style.marginBottom = '8px';

    const ttl = document.createElement('span');
    ttl.className = 'lbl';
    ttl.style.color = 'var(--ink)';
    ttl.textContent = `View tersimpan (${views.length})`;

    const addQuick = document.createElement('button');
    addQuick.type = 'button';
    addQuick.className = 'ghost ghost-sm';
    addQuick.style.height = '28px';
    addQuick.textContent = '+ Simpan sekarang';
    addQuick.addEventListener('click', () => handlers.onSaveView());

    head.append(ttl, addQuick);
    pop.appendChild(head);

    if (views.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.style.margin = '4px 0';
      empty.style.fontSize = '12.5px';
      empty.textContent = 'Belum ada view tersimpan. Tekan S atau tombol Simpan; daftar ikut tersimpan di .ottv.json.';
      pop.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'views-list';
      ul.setAttribute('role', 'listbox');

      for (const v of views) {
        const li = document.createElement('li');
        li.className = `views-item${state.activeViewId === v.id ? ' is-active' : ''}`;

        if (renamingViewId === v.id) {
          const form = document.createElement('form');
          form.style.display = 'flex';
          form.style.gap = '4px';
          form.style.width = '100%';
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'field-input';
          inp.style.height = '30px';
          inp.style.fontSize = '12.5px';
          inp.value = v.name;
          inp.setAttribute('aria-label', 'Nama baru untuk view');

          const okBtn = document.createElement('button');
          okBtn.type = 'submit';
          okBtn.className = 'ghost ghost-sm';
          okBtn.style.height = '30px';
          okBtn.textContent = 'Simpan';

          form.addEventListener('submit', (e) => {
            e.preventDefault();
            const nextName = inp.value.trim();
            renamingViewId = null;
            if (nextName) handlers.onRenameView(v.id, nextName);
            else handlers.onRerender();
          });

          form.append(inp, okBtn);
          li.appendChild(form);
          window.requestAnimationFrame(() => inp.focus());
        } else {
          const applyBtn = document.createElement('button');
          applyBtn.type = 'button';
          applyBtn.className = 'views-apply-btn';
          applyBtn.textContent = v.name;
          applyBtn.title = `${PROJECTION_SHORT[v.projection] || v.projection} · ${v.direction || ''}`;
          applyBtn.addEventListener('click', () => {
            handlers.onApplyView(v);
            handlers.onTogglePopover(null);
          });

          const renBtn = document.createElement('button');
          renBtn.type = 'button';
          renBtn.className = 'icon-mini-btn';
          renBtn.setAttribute('aria-label', `Ganti nama ${v.name}`);
          renBtn.title = 'Ganti nama';
          renBtn.innerHTML = icon('edit', 14);
          renBtn.addEventListener('click', () => {
            renamingViewId = v.id;
            handlers.onRerender();
          });

          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'icon-mini-btn st-fail';
          delBtn.setAttribute('aria-label', `Hapus ${v.name}`);
          delBtn.title = 'Hapus view';
          delBtn.innerHTML = icon('trash', 14);
          delBtn.addEventListener('click', () => handlers.onDeleteView(v.id));

          li.append(applyBtn, renBtn, delBtn);
        }

        ul.appendChild(li);
      }

      pop.appendChild(ul);
    }

    rightWrap.appendChild(pop);
  }

  // Capture popover (1x / 2x / 4x resolution + PNG download with LUXA stamp)
  if (state.openPopover === 'capture') {
    const pop = document.createElement('div');
    pop.className = 'glass vbar-popover vbar-popover-right';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Pengaturan capture PNG');

    const ttl = document.createElement('div');
    ttl.className = 'lbl';
    ttl.style.color = 'var(--ink)';
    ttl.style.marginBottom = '8px';
    ttl.textContent = 'Resolusi gambar PNG (dengan cap LUXA)';

    const segScale = document.createElement('div');
    segScale.className = 'seg';
    segScale.setAttribute('role', 'radiogroup');
    segScale.setAttribute('aria-label', 'Resolusi capture');

    for (const sc of [1, 2, 4]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      const isOn = state.captureScale === sc;
      b.setAttribute('aria-checked', isOn ? 'true' : 'false');
      if (isOn) b.classList.add('on');
      b.textContent = `${sc}x`;
      b.addEventListener('click', () => handlers.onSetCaptureScale(sc));
      segScale.appendChild(b);
    }

    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'cta';
    goBtn.style.width = '100%';
    goBtn.style.height = '40px';
    goBtn.style.marginTop = '10px';
    goBtn.style.fontSize = '13px';
    goBtn.innerHTML = `${icon('camera', 16)}<span>Unduh PNG ${state.captureScale}x</span>`;
    goBtn.addEventListener('click', () => {
      handlers.onTogglePopover(null);
      handlers.onCapturePng(state.captureScale);
    });

    pop.append(ttl, segScale, goBtn);
    rightWrap.appendChild(pop);
  }

  bar.append(leftWrap, rightWrap);
  return bar;
}
