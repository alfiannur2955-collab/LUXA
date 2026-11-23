/**
 * Workspace v1 (`docs/FASE4_UI_SPEC.md` §5):
 * - 3 presets:
 *   1. `belajar`    : all dock items, SNI term tooltips active
 *   2. `lanjut`     : panel-level data table, per-orientation material override, shortcut hints
 *   (Presentasi kini lapisan tersendiri, present/presenter.js; preset lama 'presentasi' dibaca sebagai 'belajar'.)
 * - Dock v1 customization: reorder rail items, show/hide rail items, move mode bar top/bottom.
 * - Persisted in `localStorage` (`luxa.workspace.v1`) wrapped in `try/catch`.
 */

import { icon } from './icons.js';

export const WORKSPACE_STORAGE_KEY = 'luxa.workspace.v1';

export const DEFAULT_RAIL_ORDER = ['model', 'material', 'location', 'display', 'compare', 'report'];

export const RAIL_ITEM_META = {
  model: { id: 'model', label: 'Model', icon: 'cube', lockVisible: false },
  material: { id: 'material', label: 'Material', icon: 'layers', lockVisible: false },
  location: { id: 'location', label: 'Lokasi', icon: 'pin', lockVisible: false },
  display: { id: 'display', label: 'Tampilan', icon: 'eye', lockVisible: true },
  compare: { id: 'compare', label: 'Bandingkan', icon: 'compare', lockVisible: false },
  report: { id: 'report', label: 'Laporan', icon: 'doc', lockVisible: false },
};

export function createDefaultWorkspace() {
  return {
    preset: 'belajar', // 'belajar' | 'lanjut'
    railOrder: [...DEFAULT_RAIL_ORDER],
    hiddenRailItems: [],
    modeBarPosition: 'top', // 'top' | 'bottom'
  };
}

export function sanitizeWorkspace(raw) {
  const base = createDefaultWorkspace();
  if (!raw || typeof raw !== 'object') return base;
  const preset = ['belajar', 'lanjut'].includes(raw.preset) ? raw.preset : 'belajar';
  const order = [];
  if (Array.isArray(raw.railOrder)) {
    for (const id of raw.railOrder) {
      if (RAIL_ITEM_META[id] && !order.includes(id)) order.push(id);
    }
  }
  for (const id of DEFAULT_RAIL_ORDER) {
    if (!order.includes(id)) order.push(id);
  }
  const hidden = Array.isArray(raw.hiddenRailItems)
    ? raw.hiddenRailItems.filter((id) => RAIL_ITEM_META[id] && !RAIL_ITEM_META[id].lockVisible)
    : [];
  const modeBarPosition = raw.modeBarPosition === 'bottom' ? 'bottom' : 'top';
  return {
    preset,
    railOrder: order,
    hiddenRailItems: [...new Set(hidden)],
    modeBarPosition,
  };
}

export function loadWorkspace() {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return createDefaultWorkspace();
    return sanitizeWorkspace(JSON.parse(raw));
  } catch {
    return createDefaultWorkspace();
  }
}

export function saveWorkspace(ws) {
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(sanitizeWorkspace(ws)));
  } catch {
    // Ignore storage failures in private browsing
  }
}

export function moveRailItemInWorkspace(ws, itemId, delta) {
  const next = sanitizeWorkspace(ws);
  const idx = next.railOrder.indexOf(itemId);
  if (idx === -1) return next;
  const target = idx + delta;
  if (target < 0 || target >= next.railOrder.length) return next;
  const copy = [...next.railOrder];
  const [removed] = copy.splice(idx, 1);
  copy.splice(target, 0, removed);
  return { ...next, railOrder: copy };
}

export function toggleRailItemHidden(ws, itemId) {
  const next = sanitizeWorkspace(ws);
  if (!RAIL_ITEM_META[itemId] || RAIL_ITEM_META[itemId].lockVisible) return next;
  const exists = next.hiddenRailItems.includes(itemId);
  const hiddenRailItems = exists
    ? next.hiddenRailItems.filter((x) => x !== itemId)
    : [...next.hiddenRailItems, itemId];
  return { ...next, hiddenRailItems };
}

/**
 * Accessible dialog for Workspace v1 dock customization ("Atur urutan dan isi dock").
 */
export function renderDockCustomizerModal(state, handlers) {
  if (!state.dockCustomizerOpen) return null;
  const ws = sanitizeWorkspace(state.workspace);

  const backdrop = document.createElement('div');
  backdrop.className = 'cmd-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) handlers.onClose();
  });

  const dialog = document.createElement('div');
  dialog.className = 'glass modal-card dock-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'dock-modal-title');

  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'center';
  head.style.marginBottom = '10px';

  const title = document.createElement('h2');
  title.id = 'dock-modal-title';
  title.style.margin = '0';
  title.style.fontSize = '16px';
  title.textContent = 'Atur menu samping';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tbtn';
  closeBtn.style.height = '34px';
  closeBtn.style.minWidth = '34px';
  closeBtn.style.padding = '0';
  closeBtn.setAttribute('aria-label', 'Tutup pengaturan menu samping');
  closeBtn.innerHTML = icon('close', 16);
  closeBtn.addEventListener('click', () => handlers.onClose());
  head.append(title, closeBtn);

  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.style.margin = '0 0 10px';
  hint.style.fontSize = '12.5px';
  hint.textContent =
    'Urutkan atau sembunyikan item pada rel kiri. Perubahan tersimpan otomatis di browser ini.';

  const list = document.createElement('ul');
  list.className = 'dock-cust-list';

  ws.railOrder.forEach((id, idx) => {
    const meta = RAIL_ITEM_META[id];
    if (!meta) return;
    const isHidden = ws.hiddenRailItems.includes(id);

    const li = document.createElement('li');
    li.className = 'dock-cust-row glass-thin';

    const lbl = document.createElement('label');
    lbl.className = 'dock-cust-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !isHidden;
    cb.disabled = Boolean(meta.lockVisible);
    cb.setAttribute('aria-label', `Tampilkan ${meta.label} di menu samping`);
    cb.addEventListener('change', () => handlers.onToggleHide(id));

    const ico = document.createElement('span');
    ico.innerHTML = icon(meta.icon, 16);
    const txt = document.createElement('span');
    txt.style.fontWeight = '600';
    txt.textContent = meta.label + (meta.lockVisible ? ' (selalu tampil)' : '');
    lbl.append(cb, ico, txt);

    const arrows = document.createElement('div');
    arrows.style.display = 'inline-flex';
    arrows.style.gap = '4px';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'ghost ghost-sm';
    upBtn.style.height = '28px';
    upBtn.style.padding = '0 8px';
    upBtn.disabled = idx === 0;
    upBtn.setAttribute('aria-label', `Naikkan ${meta.label}`);
    upBtn.textContent = '↑';
    upBtn.addEventListener('click', () => handlers.onMove(id, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'ghost ghost-sm';
    downBtn.style.height = '28px';
    downBtn.style.padding = '0 8px';
    downBtn.disabled = idx === ws.railOrder.length - 1;
    downBtn.setAttribute('aria-label', `Turunkan ${meta.label}`);
    downBtn.textContent = '↓';
    downBtn.addEventListener('click', () => handlers.onMove(id, 1));

    arrows.append(upBtn, downBtn);
    li.append(lbl, arrows);
    list.appendChild(li);
  });

  // Mode bar position selector (top vs bottom)
  const posSec = document.createElement('div');
  posSec.className = 'psec';
  const posTitle = document.createElement('h3');
  posTitle.textContent = 'Posisi baris mode tampilan';
  const posSeg = document.createElement('div');
  posSeg.className = 'seg';
  posSeg.setAttribute('role', 'radiogroup');
  posSeg.setAttribute('aria-label', 'Posisi baris mode');

  for (const [val, lblTxt] of [
    ['top', 'Atas viewer'],
    ['bottom', 'Bawah viewer'],
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    const on = ws.modeBarPosition === val;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    if (on) b.classList.add('on');
    b.textContent = lblTxt;
    b.addEventListener('click', () => handlers.onSetModeBarPosition(val));
    posSeg.appendChild(b);
  }
  posSec.append(posTitle, posSeg);

  const foot = document.createElement('div');
  foot.style.display = 'flex';
  foot.style.justifyContent = 'space-between';
  foot.style.gap = '8px';
  foot.style.marginTop = '12px';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'ghost ghost-sm';
  resetBtn.textContent = 'Kembalikan bawaan';
  resetBtn.addEventListener('click', () => handlers.onReset());

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'cta';
  doneBtn.style.height = '38px';
  doneBtn.style.fontSize = '13px';
  doneBtn.textContent = 'Selesai';
  doneBtn.addEventListener('click', () => handlers.onClose());

  foot.append(resetBtn, doneBtn);
  dialog.append(head, hint, list, posSec, foot);
  backdrop.appendChild(dialog);

  return backdrop;
}
