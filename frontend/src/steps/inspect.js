/**
 * Screen 3: Inspeksi (`docs/FASE4_UI_SPEC.md` §3.3 + mockup 3-inspeksi.html).
 * - Left: 3D viewer in Klasifikasi mode (Heatmap disabled until OTTV is computed).
 * - Right top: "Grup terdeteksi" table (Grup, Klasifikasi with color swatch + dropdown, Luas luar).
 * - Right bottom: Numbered "Daftar kejanggalan" from backend `build_sanity_flags` + "Hitung OTTV" CTA.
 */

import { collectAcceptedProvisionalFlags, evaluateConfirmGate } from '../state.js';
import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { renderInteractiveCompass } from '../viewer/compass.js';
import {
  CATEGORY_LABELS,
  buildOrientationRingLegendSvg,
  categorySwatchStyle,
  horizontalNeutralColor,
  readThemeTokens,
} from '../viewer/modes.js';
import { renderViewerModeBar } from '../viewer/modeBar.js';
import { resolveViewerMode } from '../viewer/modes.js';
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

  const viewerStage = document.createElement('div');
  viewerStage.className = 'viewer-stage';

  const canvasHost = document.createElement('div');
  canvasHost.className = 'viewer-canvas-host';
  viewerStage.appendChild(canvasHost);

  // Interactive North Compass (drag or keyboard arrows)
  viewerStage.appendChild(
    renderInteractiveCompass(state, {
      onChangeNorth: handlers.onChangeNorth,
      onRecompute: handlers.onCalculateOttv,
    }),
  );

  viewerSec.appendChild(viewerStage);

  // Mode bar: Klasifikasi, Orientasi (+ Heatmap/Matahari bila sudah dihitung) | Perlu dicek, Transparan
  const inspView = resolveViewerMode({ ...state, viewerMode: state.viewerMode || 'classification' });
  const activeInspectMode = inspView.mode === 'heatmap' || inspView.mode === 'sun' ? 'classification' : inspView.mode;
  const modeBarEl = renderViewerModeBar(
    { ...state, viewerMode: activeInspectMode },
    (modeId) => {
      if ((modeId === 'heatmap' || modeId === 'sun') && state.analysisData) {
        handlers.onGoToResults();
        handlers.onChangeViewerMode(modeId);
      } else {
        handlers.onChangeViewerMode(modeId);
      }
    },
    { onToggleOverlay: handlers.onToggleOverlay },
  );
  const modeAtBottom = state.workspace?.modeBarPosition === 'bottom';
  if (!modeAtBottom) {
    viewerSec.appendChild(modeBarEl);
  }

  // Bottom overlay stack (T2): legend always sits 12px above bottom pills
  const bottomStack = document.createElement('div');
  bottomStack.className = 'viewer-bottom-stack';
  if (modeAtBottom) {
    bottomStack.appendChild(modeBarEl);
  }

  // Legend (lifted cleanly above bottom pills)
  const legend = document.createElement('div');
  legend.className = `legend legend-lifted num${state.activeRailCard ? ' legend-shifted' : ''}`;
  if (activeInspectMode === 'orientation') {
    const tokens = readThemeTokens();
    const cHoriz = horizontalNeutralColor(tokens);
    const hRgb = `rgb(${Math.round(Math.pow(cHoriz.r, 1 / 2.2) * 255)}, ${Math.round(Math.pow(cHoriz.g, 1 / 2.2) * 255)}, ${Math.round(Math.pow(cHoriz.b, 1 / 2.2) * 255)})`;
    legend.innerHTML = `
      <span class="legend-item" style="gap:8px;">
        ${buildOrientationRingLegendSvg(tokens)}
        <span>Warna menurut arah hadap</span>
      </span>
      <span class="legend-item"><i class="swatch" style="background:${hRgb};"></i>Atap / datar</span>
    `;
  } else {
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
        '<span class="legend-item"><i class="swatch" style="background:var(--warn);border-radius:6px;"></i>Perlu dicek</span>',
      );
    }
    legend.innerHTML = legendParts.join('');
  }
  bottomStack.appendChild(legend);

  if (handlers.vbarHandlers) {
    bottomStack.appendChild(renderViewerBottomBar(state, handlers.vbarHandlers));
  }
  viewerSec.appendChild(bottomStack);

  // Right Top: Grup terdeteksi
  const groupsCard = document.createElement('section');
  groupsCard.className = 'box inspect-side-card inspect-groups-card';
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

  if (state.inspectBusy) {
    const upd = document.createElement('span');
    upd.className = 'lbl inspect-updating';
    upd.innerHTML = '<span class="spin spin-sm" aria-hidden="true"></span>memperbarui';
    grCount.replaceWith(upd);
    upd.after(grCount);
    grCount.style.display = 'none';
  }

  // Daftar grup: baris 1 = nama (bagian setelah '::' tebal, layer kecil) + luas; baris 2 = klasifikasi.
  const list = document.createElement('div');
  list.className = 'inspect-groups-wrap group-list';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Grup terdeteksi');

  const splitName = (full) => {
    const parts = String(full || '').split('::').map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return { main: String(full || ''), sub: '' };
    return { main: parts[parts.length - 1], sub: parts.slice(0, -1).join(' :: ') };
  };

  const renderedNames = new Set();

  for (const g of groups) {
    renderedNames.add(g.group_name);
    const effCat = overrides[g.group_name] || g.category || 'wall';
    const isSelected = state.selectedGroup === g.group_name;

    const row = document.createElement('div');
    row.className = `group-row${isSelected ? ' is-selected' : ''}`;
    row.setAttribute('role', 'listitem');

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'group-row-name';
    nameBtn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    nameBtn.title = `${g.group_name} (klik untuk sorot di model)`;
    const nm = splitName(g.group_name);
    const sw = categorySwatchStyle(effCat);
    const dot = document.createElement('i');
    dot.className = sw.className;
    if (sw.bg) dot.style.background = sw.bg;
    const nmWrap = document.createElement('span');
    nmWrap.className = 'group-row-text';
    const nmMain = document.createElement('span');
    nmMain.className = 'group-row-main';
    nmMain.textContent = nm.main;
    nmWrap.appendChild(nmMain);
    if (nm.sub) {
      const nmSub = document.createElement('span');
      nmSub.className = 'group-row-sub';
      nmSub.textContent = nm.sub;
      nmWrap.appendChild(nmSub);
    }
    nameBtn.append(dot, nmWrap);
    nameBtn.addEventListener('click', () => {
      handlers.onSelectGroup(isSelected ? null : g.group_name);
    });

    const area = document.createElement('span');
    area.className = 'group-row-area num';
    if (effCat === 'frame' || effCat === 'shading' || effCat === 'ignore') {
      area.classList.add('muted');
      area.textContent = '–';
      area.title = 'Tidak dihitung sebagai luas selubung';
    } else {
      area.textContent = `${fmtId(g.outer_area_m2 || 0, 1)} m²`;
    }

    const sel = document.createElement('select');
    sel.className = 'field-select field-select-sm group-row-select';
    sel.setAttribute('aria-label', `Klasifikasi untuk ${g.group_name}`);
    sel.disabled = Boolean(state.inspectBusy);
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

    row.append(nameBtn, area, sel);
    list.appendChild(row);
  }

  // Layer tanpa render mesh
  for (const mm of missingMesh) {
    const mName = typeof mm === 'object' ? mm.layer || mm.name || 'Objek tanpa mesh' : String(mm);
    if (renderedNames.has(mName)) continue;
    const row = document.createElement('div');
    row.className = 'group-row';
    row.setAttribute('role', 'listitem');
    const nm = splitName(mName);
    const nameEl = document.createElement('span');
    nameEl.className = 'group-row-name';
    nameEl.title = mName;
    nameEl.innerHTML = '<span class="group-row-text"><span class="group-row-main"></span></span>';
    nameEl.querySelector('.group-row-main').textContent = nm.main;
    const area = document.createElement('span');
    area.className = 'group-row-area st-warn';
    area.textContent = 'tanpa mesh';
    const chip = document.createElement('span');
    chip.className = 'chip group-row-select';
    chip.textContent = 'Rangka';
    row.append(nameEl, area, chip);
    list.appendChild(row);
  }

  groupsCard.append(grHead, list);

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
  kjTitle.textContent = 'Catatan pemeriksaan';

  const kjChip = document.createElement('span');
  kjChip.className = `chip ${unresolvedWarnFlags.length > 0 ? 'st-warn' : 'st-ok'}`;
  kjChip.textContent =
    unresolvedWarnFlags.length > 0 ? `${unresolvedWarnFlags.length} perlu dicek` : 'Siap dihitung';

  kjTitle.style.whiteSpace = 'normal';
  kjTitle.style.overflow = 'visible';
  kjTitle.style.textOverflow = 'clip';
  kjHead.style.flexWrap = 'wrap';
  kjHead.style.rowGap = '6px';
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
      'Hasil akan berstatus Sementara selama catatan di atas belum diselesaikan.';
  } else {
    note.textContent =
      state.engineMode === 'browser'
        ? 'Konfigurasi proyek disimpan di browser ini saat kamu menekan Hitung OTTV.'
        : 'Konfigurasi proyek disimpan ke server saat kamu menekan Hitung OTTV.';
  }

  ctaWrap.append(calcBtn, note);
  flagsCard.append(kjHead, ul, ctaWrap);

  main.append(viewerSec, groupsCard, flagsCard);

  window.requestAnimationFrame(() => {
    if (canvasHost.isConnected) {
      viewer.setRightInsetPx(0);
      viewer.mount(canvasHost, {
        onPickGroup: (meta) => {
          handlers.onSelectGroup(meta?.groupName || null);
        },
      });
      viewer.syncState({ ...state, viewerMode: activeInspectMode });
    }
  });

  return main;
}
