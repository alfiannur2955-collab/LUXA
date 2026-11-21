/**
 * Screen 3: Inspeksi (`docs/FASE4_UI_SPEC.md` §3.3 + mockup 3-inspeksi.html).
 * - Left: 3D viewer in Klasifikasi mode (Heatmap disabled until OTTV is computed).
 * - Right top: "Grup terdeteksi" table (Grup, Klasifikasi with color swatch + dropdown, Luas luar).
 * - Right bottom: Numbered "Daftar kejanggalan" from backend `build_sanity_flags` + "Hitung OTTV" CTA.
 */

import { collectAcceptedProvisionalFlags, evaluateConfirmGate } from '../state.js';
import { fmtId } from '../ui/escapeHtml.js';
import { compassDialSvg, icon } from '../ui/icons.js';
import { CATEGORY_LABELS, categorySwatchStyle } from '../viewer/modes.js';
import { renderViewerBottomBar } from '../viewer/vbar.js';
import { viewer } from '../viewer/viewer.js';

const ROLE_OPTIONS = [
  ['glazing', 'Kaca'],
  ['wall', 'Dinding'],
  ['spandrel', 'Spandrel'],
  ['composite_cw', 'Curtain wall'],
  ['shading', 'Peneduh'],
  ['frame', 'Rangka'],
  ['roof', 'Atap'],
  ['ignore', 'Abaikan'],
];

export function renderInspectScreen(state, handlers) {
  const main = document.createElement('main');
  main.className = 'main main-inspect';

  const ins = state.inspectData || {};
  const groups = ins.groups || [];
  const flags = ins.sanity_flags || [];
  const missingMesh = ins.missing_mesh || [];
  const gate = evaluateConfirmGate(state);

  // Compute summary glazing & wall areas for viewer legend
  let glazingArea = 0;
  let wallArea = 0;
  let hasUnknown = false;
  const overrides = state.config?.roles?.group_category_overrides || {};
  for (const g of groups) {
    if (!g.enabled) continue;
    const cat = overrides[g.group_name] || g.category;
    const area = Number(g.outer_area_m2 || 0);
    if (cat === 'glazing' || cat === 'composite_cw') glazingArea += area;
    else if (cat === 'wall' || cat === 'spandrel') wallArea += area;
    if (cat === 'unknown') hasUnknown = true;
  }

  // Left: 3D Viewer
  const viewerSec = document.createElement('section');
  viewerSec.className = 'viewer';
  viewerSec.style.gridRow = '1 / 3';
  viewerSec.setAttribute('aria-label', 'Viewer 3D');

  const canvasHost = document.createElement('div');
  canvasHost.className = 'viewer-canvas-host';
  viewerSec.appendChild(canvasHost);

  // Mode bar (Klasifikasi active, Heatmap disabled until analyzed)
  const modeBar = document.createElement('div');
  modeBar.className = 'glass modes';
  modeBar.setAttribute('role', 'toolbar');
  modeBar.setAttribute('aria-label', 'Mode tampilan');

  const btnCls = document.createElement('button');
  btnCls.type = 'button';
  btnCls.className = 'on';
  btnCls.setAttribute('aria-pressed', 'true');
  btnCls.innerHTML = `${icon('grid', 16)}<span>Klasifikasi</span>`;

  const btnHeat = document.createElement('button');
  btnHeat.type = 'button';
  btnHeat.disabled = !state.analysisData;
  btnHeat.title = state.analysisData ? 'Lihat heatmap OTTV per arah' : 'Tersedia setelah OTTV dihitung';
  btnHeat.setAttribute('aria-pressed', 'false');
  btnHeat.innerHTML = `${icon('thermometer', 16)}<span>Heatmap</span>`;
  if (state.analysisData) {
    btnHeat.addEventListener('click', () => handlers.onGoToResults());
  }

  modeBar.append(btnCls, btnHeat);
  viewerSec.appendChild(modeBar);

  // Compass
  const northDeg = Number(state.config?.settings?.north_angle_deg || 0);
  const compass = document.createElement('div');
  compass.className = 'glass compass';
  compass.setAttribute('role', 'img');
  compass.setAttribute('aria-label', `Kompas arah utara, ${northDeg} derajat`);
  compass.innerHTML = compassDialSvg(northDeg);
  viewerSec.appendChild(compass);

  // Legend (lifted cleanly above bottom pills)
  const legend = document.createElement('div');
  legend.className = 'legend legend-lifted num';
  const legendParts = [
    `<span class="legend-item"><i class="swatch" style="background:var(--data-glazing);"></i>Kaca ${fmtId(glazingArea, 1)} m²</span>`,
    `<span class="legend-item"><i class="swatch" style="background:var(--data-wall);"></i>Dinding ${fmtId(wallArea, 1)} m²</span>`,
  ];
  if (hasUnknown) {
    legendParts.push(
      '<span class="legend-item"><i class="swatch swatch-unknown"></i>Belum dikenali</span>',
    );
  }
  if (flags.some((f) => f.severity === 'warn' || f.severity === 'error')) {
    legendParts.push(
      '<span class="legend-item"><i class="swatch" style="background:var(--warn);border-radius:6px;"></i>Kejanggalan</span>',
    );
  }
  legend.innerHTML = legendParts.join('');
  viewerSec.appendChild(legend);

  if (handlers.vbarHandlers) {
    viewerSec.appendChild(renderViewerBottomBar(state, handlers.vbarHandlers));
  }

  // Right Top: Grup terdeteksi
  const groupsCard = document.createElement('section');
  groupsCard.className = 'box';
  groupsCard.setAttribute('aria-labelledby', 'gr-title');

  const grHead = document.createElement('div');
  grHead.style.display = 'flex';
  grHead.style.justifyContent = 'space-between';
  grHead.style.alignItems = 'baseline';

  const grTitle = document.createElement('h2');
  grTitle.id = 'gr-title';
  grTitle.textContent = 'Grup terdeteksi';

  const grCount = document.createElement('span');
  grCount.className = 'lbl num';
  grCount.textContent = `${groups.length} grup`;

  grHead.append(grTitle, grCount);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'inspect-groups-wrap';

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <colgroup>
      <col style="width: 39%;" />
      <col style="width: 39%;" />
      <col style="width: 22%;" />
    </colgroup>
    <thead>
      <tr>
        <th scope="col">Grup</th>
        <th scope="col">Klasifikasi</th>
        <th scope="col" style="text-align:right;">Luas</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');
  tbody.className = 'num';

  const renderedNames = new Set();

  for (const g of groups) {
    renderedNames.add(g.group_name);
    const effCat = overrides[g.group_name] || g.category || 'wall';
    const isSelected = state.selectedGroup === g.group_name;
    const tr = document.createElement('tr');
    if (isSelected) {
      tr.classList.add('is-selected');
    }
    tr.setAttribute('aria-selected', isSelected ? 'true' : 'false');

    const tdName = document.createElement('td');
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'group-pick-btn';
    nameBtn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    nameBtn.title = g.group_name;
    nameBtn.textContent = g.group_name;
    nameBtn.addEventListener('click', () => {
      handlers.onSelectGroup(isSelected ? null : g.group_name);
    });
    tdName.appendChild(nameBtn);

    const tdRole = document.createElement('td');
    const roleWrap = document.createElement('div');
    roleWrap.style.display = 'inline-flex';
    roleWrap.style.alignItems = 'center';
    roleWrap.style.gap = '6px';

    const sw = categorySwatchStyle(effCat);
    const dot = document.createElement('i');
    dot.className = sw.className;
    if (sw.bg) dot.style.background = sw.bg;

    const sel = document.createElement('select');
    sel.className = 'field-select field-select-sm';
    sel.style.width = 'auto';
    sel.style.maxWidth = '110px';
    sel.setAttribute('aria-label', `Klasifikasi untuk ${g.group_name}`);

    if (effCat === 'unknown') {
      const unkOpt = document.createElement('option');
      unkOpt.value = 'unknown';
      unkOpt.textContent = CATEGORY_LABELS.unknown;
      unkOpt.selected = true;
      sel.appendChild(unkOpt);
    }
    for (const [val, lbl] of ROLE_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = lbl;
      if (effCat === val) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      handlers.onChangeGroupCategory(g.group_name, sel.value);
    });

    roleWrap.append(dot, sel);
    tdRole.appendChild(roleWrap);

    const tdArea = document.createElement('td');
    tdArea.style.textAlign = 'right';
    tdArea.style.whiteSpace = 'nowrap';
    if (effCat === 'frame' || effCat === 'shading' || effCat === 'ignore') {
      tdArea.className = 'muted';
      tdArea.textContent = '–';
    } else {
      tdArea.textContent = `${fmtId(g.outer_area_m2 || 0, 1)} m²`;
    }

    tr.append(tdName, tdRole, tdArea);
    tbody.appendChild(tr);
  }

  // Append missing-mesh-only layers (no render mesh)
  for (const mm of missingMesh) {
    const mName = typeof mm === 'object' ? mm.layer || mm.name || 'Objek tanpa mesh' : String(mm);
    if (renderedNames.has(mName)) continue;
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = mName;

    const tdRole = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = 'Rangka';
    tdRole.appendChild(chip);

    const tdArea = document.createElement('td');
    tdArea.style.textAlign = 'right';
    tdArea.className = 'st-warn';
    tdArea.textContent = 'tanpa mesh';

    tr.append(tdName, tdRole, tdArea);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  groupsCard.append(grHead, tableWrap);

  // Right Bottom: Daftar kejanggalan + Hitung OTTV
  const flagsCard = document.createElement('section');
  flagsCard.className = 'box inspect-side-card';
  flagsCard.setAttribute('aria-labelledby', 'kj-title');

  const warnFlags = flags.filter((f) => f.severity === 'warn' || f.severity === 'error');
  const unresolvedWarnFlags = warnFlags.filter((f) => !state.acknowledgedFlags[f.id]);
  const hasBlockingError = flags.some((f) => f.severity === 'error' && !state.acknowledgedFlags[f.id]);

  const kjHead = document.createElement('div');
  kjHead.style.display = 'flex';
  kjHead.style.justifyContent = 'space-between';
  kjHead.style.alignItems = 'baseline';

  const kjTitle = document.createElement('h2');
  kjTitle.id = 'kj-title';
  kjTitle.textContent = 'Daftar kejanggalan';

  const kjChip = document.createElement('span');
  kjChip.className = `chip ${unresolvedWarnFlags.length > 0 ? 'st-warn' : 'st-ok'}`;
  kjChip.textContent =
    unresolvedWarnFlags.length > 0 ? `${unresolvedWarnFlags.length} perlu dicek` : 'Siap dihitung';

  kjHead.append(kjTitle, kjChip);

  const ul = document.createElement('ul');
  ul.className = 'flag-list';

  let warnIndex = 0;
  for (const flag of flags) {
    const isWarnOrErr = flag.severity === 'warn' || flag.severity === 'error';
    const isAck = Boolean(state.acknowledgedFlags[flag.id]);
    if (isWarnOrErr) warnIndex += 1;

    const li = document.createElement('li');
    li.className = 'flag-item';

    const badge = document.createElement('span');
    if (isAck) {
      badge.className = 'flag-badge is-ok';
      badge.innerHTML = icon('check', 20);
    } else if (flag.severity === 'error') {
      badge.className = 'flag-badge is-error';
      badge.textContent = String(warnIndex);
    } else if (flag.severity === 'warn') {
      badge.className = 'flag-badge';
      badge.textContent = String(warnIndex);
    } else {
      badge.className = 'flag-badge is-info';
      badge.innerHTML = icon('help', 20);
    }

    const content = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.style.fontWeight = '600';
    titleEl.textContent = flag.title;

    const descEl = document.createElement('p');
    descEl.className = 'muted';
    descEl.style.margin = '2px 0 0';
    descEl.style.fontSize = '12.5px';
    descEl.style.lineHeight = '18px';
    descEl.textContent = flag.detail;

    content.append(titleEl, descEl);

    if (!isAck && Array.isArray(flag.actions) && flag.actions.length > 0) {
      const actRow = document.createElement('div');
      actRow.className = 'flag-actions';

      for (const act of flag.actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghost ghost-sm';

        if (act === 'lihat_model') {
          btn.textContent = 'Lihat di model';
          btn.addEventListener('click', () => handlers.onFocusFlagInModel(flag));
        } else if (act === 'ubah_dinding') {
          btn.textContent = 'Ubah jadi Dinding';
          btn.addEventListener('click', () => {
            if (flag.group_name) {
              handlers.onChangeGroupCategory(flag.group_name, 'wall');
            }
          });
        } else if (act === 'hitung_tanpa_rangka') {
          btn.textContent = 'Hitung tanpa rangka';
          btn.addEventListener('click', () => handlers.onAcknowledgeFlag(flag, 'hitung_tanpa_rangka'));
        } else if (act === 'buka_konfirmasi') {
          btn.textContent = 'Buka Konfirmasi';
          btn.addEventListener('click', () => handlers.onBackToConfirm());
        } else if (act === 'pilih_material') {
          btn.textContent = 'Pilih material';
          btn.addEventListener('click', () => handlers.onOpenMaterialPanel());
        } else {
          btn.textContent = 'Mengerti';
          btn.addEventListener('click', () => handlers.onAcknowledgeFlag(flag, 'mengerti'));
        }

        actRow.appendChild(btn);
      }

      content.appendChild(actRow);
    } else if (isAck) {
      const ackNote = document.createElement('p');
      ackNote.className = 'lbl st-ok';
      ackNote.style.margin = '4px 0 0';
      ackNote.textContent = state.acknowledgedFlags[flag.id].provisional
        ? 'Diterima (hasil akan berstatus Sementara).'
        : 'Sudah dicatat.';
      content.appendChild(ackNote);
    }

    li.append(badge, content);
    ul.appendChild(li);
  }

  // Confirmed ground summary row (mirrors mockup 3-inspeksi.html line 116)
  if (state.confirm.groundConfirmed) {
    const li = document.createElement('li');
    li.className = 'flag-item';
    const b = document.createElement('span');
    b.className = 'flag-badge is-ok';
    b.innerHTML = icon('check', 20);
    const c = document.createElement('div');
    const t = document.createElement('div');
    t.style.fontWeight = '600';
    t.textContent = 'Muka tanah dikonfirmasi';
    const p = document.createElement('p');
    p.className = 'muted';
    p.style.margin = '2px 0 0';
    p.style.fontSize = '12.5px';
    p.textContent =
      state.confirm.groundChoice === 'file_zero'
        ? 'z = 0 di file adalah muka tanah.'
        : 'Alas model digunakan sebagai muka tanah.';
    c.append(t, p);
    li.append(b, c);
    ul.appendChild(li);
  }

  // Bottom Hitung OTTV CTA (locked until Konfirmasi is green and no blocking errors)
  const ctaWrap = document.createElement('div');
  ctaWrap.style.display = 'grid';
  ctaWrap.style.gap = '6px';
  ctaWrap.style.paddingTop = '12px';
  ctaWrap.style.marginTop = 'auto';

  const acceptedProvisional = collectAcceptedProvisionalFlags(state);
  const willBeProvisional =
    acceptedProvisional.length > 0 ||
    unresolvedWarnFlags.some((f) => f.accept_makes_provisional) ||
    state.config.settings.default_wall_wwr !== null;

  const calcLocked = !gate.ready || hasBlockingError;
  const calcBtn = document.createElement('button');
  calcBtn.type = 'button';
  calcBtn.className = 'cta';
  calcBtn.disabled = calcLocked;

  if (!gate.ready) {
    calcBtn.textContent = gate.missingLabel || 'Selesaikan Konfirmasi dulu';
  } else if (hasBlockingError) {
    calcBtn.textContent = 'Perbaiki ukuran bangunan dulu';
  } else {
    calcBtn.innerHTML = `${icon('play', 18)}<span>Hitung OTTV</span>`;
  }
  calcBtn.addEventListener('click', () => handlers.onCalculateOttv());

  const note = document.createElement('p');
  note.className = 'lbl';
  note.style.margin = '0';
  note.style.textAlign = 'center';
  note.style.fontWeight = '500';
  if (!gate.ready) {
    note.textContent = 'Kembali ke Konfirmasi untuk melengkapi baris yang masih kuning.';
  } else if (willBeProvisional) {
    note.textContent =
      'Hasil akan berstatus Sementara selama kejanggalan di atas belum diperbaiki.';
  } else {
    note.textContent = 'Konfigurasi proyek disimpan ke server saat kamu menekan Hitung OTTV.';
  }

  ctaWrap.append(calcBtn, note);
  flagsCard.append(kjHead, ul, ctaWrap);

  main.append(viewerSec, groupsCard, flagsCard);

  window.requestAnimationFrame(() => {
    if (canvasHost.isConnected) {
      viewer.mount(canvasHost, {
        onPickGroup: (meta) => {
          handlers.onSelectGroup(meta?.groupName || null);
        },
      });
      viewer.syncState({ ...state, viewerMode: 'classification' });
    }
  });

  return main;
}
