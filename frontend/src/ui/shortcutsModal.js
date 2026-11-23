/**
 * Keyboard Shortcuts Reference Card (`?`, `docs/FASE4_UI_SPEC.md` §6 + mockup 7-pintasan.html).
 */

import { icon } from './icons.js';

const SHORTCUT_ROWS = [
  { keys: ['1', '2', '3', '4'], desc: 'Perspektif, 2 titik, aksonometri, tampak' },
  { keys: ['tahan', 'V'], desc: 'Pie 8 arah pandang & Orientasi (lepas untuk memilih; Esc batal)' },
  { keys: ['R'], desc: 'Atur arah utara (Shift = langkah 15° · Esc selesai)' },
  { keys: ['F'], desc: 'Pas kamera ke model' },
  { keys: ['S'], desc: 'Simpan view kamera' },
  { keys: ['C'], desc: 'Simpan gambar PNG' },
  { keys: ['Spasi'], desc: 'Putar matahari satu hari' },
  { keys: ['Shift', 'klik'], desc: 'Tambah panel ke pilihan' },
  { keys: ['Esc'], desc: 'Selesai atur arah utara, tutup kartu, palet, atau menu arah; di Presentasi: keluar' },
  { keys: ['Ctrl', 'K'], desc: 'Cari perintah' },
  { keys: ['?'], desc: 'Daftar pintasan ini' },
];

export function renderShortcutsModal(state, { onClose }) {
  if (!state.shortcutsModalOpen) return null;

  const card = document.createElement('section');
  card.className = 'glass shortcuts-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'ks-title');

  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'center';
  head.style.gap = '8px';

  const titleWrap = document.createElement('div');
  titleWrap.style.display = 'flex';
  titleWrap.style.alignItems = 'center';
  titleWrap.style.gap = '8px';

  const h2 = document.createElement('h2');
  h2.id = 'ks-title';
  h2.style.margin = '0';
  h2.style.fontSize = '15px';
  h2.textContent = 'Pintasan keyboard';

  const qKbd = document.createElement('kbd');
  qKbd.textContent = '?';
  titleWrap.append(h2, qKbd);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tbtn';
  closeBtn.style.height = '32px';
  closeBtn.style.minWidth = '32px';
  closeBtn.style.padding = '0';
  closeBtn.setAttribute('aria-label', 'Tutup daftar pintasan');
  closeBtn.innerHTML = icon('close', 15);
  closeBtn.addEventListener('click', onClose);

  head.append(titleWrap, closeBtn);

  const ul = document.createElement('ul');
  ul.className = 'shortcuts-list';

  for (const row of SHORTCUT_ROWS) {
    const li = document.createElement('li');

    const keysCell = document.createElement('span');
    keysCell.style.display = 'inline-flex';
    keysCell.style.gap = '3px';
    keysCell.style.alignItems = 'center';
    keysCell.style.flexWrap = 'nowrap';
    keysCell.style.fontSize = '11px';
    keysCell.style.color = 'var(--ink-muted)';

    for (const k of row.keys) {
      if (k === 'tahan') {
        const txt = document.createElement('span');
        txt.textContent = 'tahan';
        keysCell.appendChild(txt);
      } else {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keysCell.appendChild(kbd);
      }
    }

    const descCell = document.createElement('span');
    descCell.style.lineHeight = '17px';
    descCell.textContent = row.desc;

    li.append(keysCell, descCell);
    ul.appendChild(li);
  }

  const footer = document.createElement('p');
  footer.className = 'lbl';
  footer.style.margin = '10px 0 0';
  footer.style.fontWeight = '500';
  footer.textContent = 'Pintasan otomatis nonaktif saat kursor berada di kolom teks.';

  card.append(head, ul, footer);
  return card;
}
