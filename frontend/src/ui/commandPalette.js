/**
 * Command Palette (`Ctrl K`, `docs/FASE4_UI_SPEC.md` §6 + mockup 7-pintasan.html).
 * Searches all actions, projections, 8 directions + Atas, saved views, and detected groups.
 * All dynamic model/group/view text is inserted strictly via `textContent`.
 */

import { DIRECTION_NAMES, formatCameraDirectionLabel } from '../viewer/cameras.js';
import { icon } from './icons.js';

function buildCommandItems(state, actions) {
  const items = [];
  const hasViewer = Boolean(state.inspectData || state.analysisData);

  if (hasViewer) {
    items.push(
      { id: 'proj-persp', label: 'Proyeksi Perspektif', hint: '1', keywords: 'kamera proyeksi persp 1', run: () => actions.onSetProjection('perspective') },
      { id: 'proj-2pt', label: 'Proyeksi Perspektif 2 titik', hint: '2', keywords: 'kamera proyeksi 2 titik tegak', run: () => actions.onSetProjection('two_point') },
      { id: 'proj-akso', label: 'Proyeksi Aksonometri', hint: '3', keywords: 'kamera proyeksi akso isometrik', run: () => actions.onSetProjection('axonometric') },
      { id: 'proj-tampak', label: 'Proyeksi Tampak (ortografik)', hint: '4', keywords: 'kamera proyeksi tampak elevasi', run: () => actions.onSetProjection('elevation') },
    );

    for (const code of ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL', 'Atas']) {
      const name = DIRECTION_NAMES[code] || code;
      const lbl = formatCameraDirectionLabel(state.cameraProjection, code);
      items.push({
        id: `dir-${code}`,
        label: code === 'Atas' ? 'Tampak Atas (denah)' : lbl,
        hint: code === 'Atas' ? 'V lalu Atas' : `V lalu ${code}`,
        keywords: `tampak arah kamera dari ${name.toLowerCase()} ${code.toLowerCase()}`,
        run: () => actions.onSelectDirection(code),
      });
    }

    items.push(
      { id: 'north-rotate', label: state.northRotateMode ? 'Selesai atur arah utara' : 'Atur arah utara', hint: 'R', keywords: 'putar utara rotasi north kompas r', run: () => actions.onToggleNorthRotateMode?.() },
      { id: 'mode-orient', label: 'Mode tampilan Orientasi (warna arah hadap)', hint: 'Mode', keywords: 'mode orientasi arah hadap azimut warna', run: () => actions.onChangeViewerMode?.('orientation') },
      { id: 'mode-sun', label: 'Mode tampilan Matahari', hint: 'Mode', keywords: 'mode matahari paparan sinar bayangan terkena', run: () => actions.onChangeViewerMode?.('sun') },
      { id: 'tool-xray', label: state.overlayXray ? 'Matikan Transparan' : 'Nyalakan Transparan', hint: 'Alat', keywords: 'transparan xray tembus pandang', run: () => actions.onToggleOverlay?.('xray', !state.overlayXray) },
      { id: 'tool-check', label: state.overlayCheck ? 'Matikan Perlu dicek' : 'Nyalakan Perlu dicek', hint: 'Alat', keywords: 'perlu dicek periksa catatan kejanggalan', run: () => actions.onToggleOverlay?.('check', !state.overlayCheck) },
      { id: 'cam-fit', label: 'Pas kamera ke model', hint: 'F', keywords: 'fit zoom pas model kamera', run: () => actions.onFitCamera() },
      { id: 'view-save', label: 'Simpan view sekarang', hint: 'S', keywords: 'simpan view kamera', run: () => actions.onSaveView() },
      { id: 'cap-1x', label: 'Simpan gambar (1x)', hint: 'PNG', keywords: 'simpan gambar capture screenshot png 1x', run: () => actions.onCapturePng(1) },
      { id: 'cap-2x', label: 'Simpan gambar (2x)', hint: 'C', keywords: 'simpan gambar capture screenshot png 2x', run: () => actions.onCapturePng(2) },
      { id: 'cap-4x', label: 'Simpan gambar resolusi tinggi (4x)', hint: '4x', keywords: 'simpan gambar capture screenshot png 4x hd', run: () => actions.onCapturePng(4) },
    );

    for (const v of state.config?.saved_views || []) {
      items.push({
        id: `view-${v.id}`,
        label: `Buka view: ${v.name}`,
        hint: 'View tersimpan',
        keywords: `view tersimpan ${String(v.name || '').toLowerCase()}`,
        run: () => actions.onApplyView(v),
      });
    }

    for (const g of state.inspectData?.groups || []) {
      items.push({
        id: `grp-${g.group_id || g.group_name}`,
        label: `Sorot grup: ${g.group_name}`,
        hint: 'Grup',
        keywords: `grup pilih sorot ${String(g.group_name || '').toLowerCase()}`,
        run: () => actions.onSelectGroup(g.group_name),
      });
    }
  }

  items.push(
    { id: 'panel-tampilan', label: 'Buka panel Tampilan (Kamera)', hint: 'Panel', keywords: 'panel tampilan kamera', run: () => actions.onOpenPanel('display') },
    { id: 'panel-material', label: 'Buka panel Material', hint: 'Panel', keywords: 'panel material kaca dinding', run: () => actions.onOpenPanel('material') },
    { id: 'panel-lokasi', label: 'Buka panel Lokasi', hint: 'Panel', keywords: 'panel lokasi kota utara', run: () => actions.onOpenPanel('location') },
    { id: 'panel-laporan', label: 'Buka panel Laporan', hint: 'Panel', keywords: 'panel laporan ekspor excel', run: () => actions.onOpenPanel('report') },
    { id: 'theme-toggle', label: state.theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap', hint: 'Tema', keywords: 'tema gelap terang dark light', run: () => actions.onToggleTheme() },
    { id: 'shortcuts-open', label: 'Tampilkan daftar pintasan keyboard', hint: '?', keywords: 'pintasan shortcut keyboard bantuan', run: () => actions.onOpenShortcuts() },
  );

  if (state.analysisData) {
    items.push({
      id: 'dl-xlsx',
      label: 'Unduh laporan (.xlsx)',
      hint: 'Excel',
      keywords: 'unduh laporan excel xlsx',
      run: () => actions.onDownloadExcel(),
    });
  }
  if (state.modelId) {
    items.push({
      id: 'dl-proj',
      label: 'Unduh proyek (.ottv.json)',
      hint: 'JSON',
      keywords: 'unduh simpan proyek ottv json',
      run: () => actions.onDownloadProject(),
    });
  }

  return items;
}

export function renderCommandPalette(state, actions) {
  if (!state.commandPaletteOpen) return null;

  const backdrop = document.createElement('div');
  backdrop.className = 'cmd-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) actions.onClose();
  });

  const dialog = document.createElement('div');
  dialog.className = 'glass cmd-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Cari perintah');

  const searchRow = document.createElement('div');
  searchRow.className = 'cmd-search-row';
  searchRow.innerHTML = icon('search', 18);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Cari perintah, tampak, view tersimpan, atau grup...';
  input.setAttribute('aria-label', 'Cari perintah');

  const escKbd = document.createElement('kbd');
  escKbd.textContent = 'Esc';
  searchRow.append(input, escKbd);

  const list = document.createElement('ul');
  list.className = 'cmd-list';
  list.setAttribute('role', 'listbox');

  const allItems = buildCommandItems(state, actions);
  let filtered = allItems;
  let activeIdx = 0;

  function renderList() {
    list.innerHTML = '';
    if (filtered.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.style.padding = '12px 10px';
      li.style.fontSize = '13px';
      li.textContent = 'Tidak ada perintah yang cocok.';
      list.appendChild(li);
      return;
    }

    filtered.forEach((item, idx) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cmd-item-btn${idx === activeIdx ? ' is-active' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', idx === activeIdx ? 'true' : 'false');

      const lbl = document.createElement('span');
      lbl.textContent = item.label;

      const hint = document.createElement('span');
      hint.className = 'muted';
      hint.style.fontSize = '12px';
      hint.textContent = item.hint || '';

      btn.append(lbl, hint);
      btn.addEventListener('pointerenter', () => {
        activeIdx = idx;
        renderList();
      });
      btn.addEventListener('click', () => {
        actions.onClose();
        item.run();
      });

      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    filtered = q
      ? allItems.filter(
          (it) => it.label.toLowerCase().includes(q) || (it.keywords && it.keywords.includes(q)),
        )
      : allItems;
    activeIdx = 0;
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        activeIdx = (activeIdx + 1) % filtered.length;
        renderList();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) {
        activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
        renderList();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = filtered[activeIdx];
      if (chosen) {
        actions.onClose();
        chosen.run();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      actions.onClose();
    }
  });

  renderList();
  dialog.append(searchRow, list);
  backdrop.appendChild(dialog);

  window.requestAnimationFrame(() => input.focus());
  return backdrop;
}
