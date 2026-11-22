/**
 * Screen 6: Bandingkan (`docs/FASE4_UI_SPEC.md` §3.6 + mockup 8-bandingkan.html):
 * - Synchronized split 3D viewer (`Sekarang` left, `Alternatif X` right) with
 *   pointer- & keyboard-draggable vertical divider (`cursor: ew-resize`, `ArrowLeft`/`ArrowRight`).
 * - Floating header cards for both designs + bottom-center "Selisih per arah (W/m²)" card.
 * - Right side column: delta summary, "Yang diubah di Alternatif X" (with catalog note e.g. electrochromic),
 *   alternative list + inline "+ Tambah alternatif" builder (runs real `engine.analyze`),
 *   "Pakai Alternatif X" (pushes current design to `designHistory`), and collapsible history restore.
 */

import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { viewer } from '../viewer/viewer.js';

let addFormOpen = false;

function findMaterial(materialsObj, matId) {
  const list = materialsObj?.materials || [];
  return list.find((m) => m.id === matId) || null;
}

function getMaterialCatalogNote(mat) {
  if (!mat) return '';
  if (mat.id === 'glz_kaca_elektrokromik') {
    return 'Nilai katalog kaca elektrokromik adalah kondisi paling gelap. Saat terang, SC-nya lebih tinggi.';
  }
  if (mat.description) {
    return String(mat.description);
  }
  return '';
}

function summarizeDesignSubtitle(config, materials) {
  const glz = findMaterial(materials, config?.settings?.glazing_material_id);
  const name = glz?.name || 'Kaca standar';
  const sc = glz?.sc != null ? `, SC ${fmtId(glz.sc, 2)}` : '';
  return `${name}${sc}`;
}

function makeCompareHeaderCard(label, subtitle, ottvWm2, sniLimit, sideClass) {
  const card = document.createElement('div');
  card.className = `glass compare-pane-head ${sideClass}`;

  const left = document.createElement('div');
  left.style.minWidth = '0';
  const lbl = document.createElement('p');
  lbl.className = 'lbl';
  lbl.style.margin = '0';
  lbl.textContent = label;
  const sub = document.createElement('p');
  sub.className = 'compare-pane-sub';
  sub.title = subtitle;
  sub.textContent = subtitle;
  left.append(lbl, sub);

  const right = document.createElement('div');
  right.style.textAlign = 'right';
  right.style.flexShrink = '0';
  const val = document.createElement('p');
  val.className = 'num compare-pane-val';
  val.textContent = fmtId(ottvWm2, 2);
  const ok = Number(ottvWm2) <= Number(sniLimit || 35);
  const chip = document.createElement('span');
  chip.className = `chip ${ok ? 'st-ok' : 'st-fail'}`;
  chip.style.fontSize = '11px';
  chip.style.padding = '2px 8px';
  chip.textContent = ok ? 'Memenuhi' : 'Tidak memenuhi';
  right.append(val, chip);

  card.append(left, right);
  return card;
}

export function renderCompareScreen(state, handlers) {
  const main = document.createElement('main');
  main.className = 'main main-results';

  const baseAnalysis = state.analysisData;
  const alts = state.alternatives || [];
  const activeAlt = alts.find((a) => a.id === state.activeAlternativeId) || alts[0] || null;
  const splitRatio = Math.max(0.1, Math.min(0.9, Number(state.compareSplitRatio ?? 0.5)));
  const sniLimit = Number(baseAnalysis?.sni_limit_wm2 ?? 35);

  // ==================== LEFT: Split 3D Viewer ====================
  const viewerSec = document.createElement('section');
  viewerSec.className = 'viewer compare-viewer';
  viewerSec.setAttribute('aria-label', 'Viewer bandingkan dua desain');

  const viewerStage = document.createElement('div');
  viewerStage.className = 'viewer-stage';

  const canvasHost = document.createElement('div');
  canvasHost.className = 'viewer-canvas-host';
  viewerStage.appendChild(canvasHost);
  viewerSec.appendChild(viewerStage);

  const baseOttv = Number(baseAnalysis?.ottv_total_wm2 ?? 0);
  const altOttv = activeAlt ? Number(activeAlt.analysisData?.ottv_total_wm2 ?? 0) : null;

  // Left & Right header overlay cards
  const headsLayer = document.createElement('div');
  headsLayer.className = 'compare-heads-row';
  headsLayer.appendChild(
    makeCompareHeaderCard(
      'Sekarang',
      summarizeDesignSubtitle(state.config, state.materials),
      baseOttv,
      sniLimit,
      'is-left',
    ),
  );

  if (activeAlt) {
    headsLayer.appendChild(
      makeCompareHeaderCard(
        `Alternatif ${activeAlt.code}`,
        summarizeDesignSubtitle(activeAlt.config, state.materials),
        altOttv,
        sniLimit,
        'is-right',
      ),
    );
  } else {
    const emptyRight = document.createElement('div');
    emptyRight.className = 'glass compare-pane-head is-right';
    const p = document.createElement('p');
    p.className = 'muted';
    p.style.margin = '0';
    p.style.fontSize = '12.5px';
    p.textContent = 'Buat alternatif di panel kanan untuk membandingkan berdampingan.';
    emptyRight.appendChild(p);
    headsLayer.appendChild(emptyRight);
  }
  viewerStage.appendChild(headsLayer);

  // Draggable vertical divider line + 40px round glass handle (mouse + keyboard arrows)
  if (activeAlt) {
    const pct = (splitRatio * 100).toFixed(2);
    const dividerLine = document.createElement('div');
    dividerLine.className = 'compare-divider-line';
    dividerLine.style.left = `${pct}%`;
    dividerLine.setAttribute('aria-hidden', 'true');

    const handleBtn = document.createElement('button');
    handleBtn.type = 'button';
    handleBtn.className = 'glass compare-divider-handle';
    handleBtn.style.left = `${pct}%`;
    handleBtn.setAttribute('role', 'separator');
    handleBtn.setAttribute('aria-orientation', 'vertical');
    handleBtn.setAttribute('aria-label', 'Geser pembatas perbandingan (panah kiri/kanan atau seret)');
    handleBtn.setAttribute('aria-valuemin', '10');
    handleBtn.setAttribute('aria-valuemax', '90');
    handleBtn.setAttribute('aria-valuenow', String(Math.round(splitRatio * 100)));
    handleBtn.title = 'Seret atau tekan panah kiri/kanan untuk menggeser pembatas';
    handleBtn.innerHTML = icon('compare', 18);

    const applyRatioLive = (nextRatio, commit = false) => {
      const clamped = Math.max(0.1, Math.min(0.9, nextRatio));
      const pStr = `${(clamped * 100).toFixed(2)}%`;
      dividerLine.style.left = pStr;
      handleBtn.style.left = pStr;
      handleBtn.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
      viewer.setCompareSplitRatio(clamped);
      if (commit) {
        handlers.onChangeSplitRatio(clamped);
      }
    };

    let dragging = false;
    handleBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      try {
        handleBtn.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    });
    handleBtn.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = viewerStage.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = (e.clientX - rect.left) / rect.width;
      applyRatioLive(ratio, false);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      const rect = viewerStage.getBoundingClientRect();
      if (rect.width > 0) {
        applyRatioLive((e.clientX - rect.left) / rect.width, true);
      }
      try {
        handleBtn.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    };
    handleBtn.addEventListener('pointerup', endDrag);
    handleBtn.addEventListener('pointercancel', endDrag);

    handleBtn.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.03;
      const cur = Number(handleBtn.getAttribute('aria-valuenow')) / 100;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        applyRatioLive(cur - step, true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        applyRatioLive(cur + step, true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        applyRatioLive(0.15, true);
      } else if (e.key === 'End') {
        e.preventDefault();
        applyRatioLive(0.85, true);
      }
    });

    viewerStage.append(dividerLine, handleBtn);

    // Bottom-center glass card: Selisih per arah (W/m²)
    const baseOri = new Map(
      (baseAnalysis?.orientation_breakdown || [])
        .filter((o) => Number(o.total_area_m2 || 0) > 0.01)
        .map((o) => [o.code, Number(o.ottv_orientation_wm2 || 0)]),
    );
    const altOri = new Map(
      (activeAlt.analysisData?.orientation_breakdown || [])
        .filter((o) => Number(o.total_area_m2 || 0) > 0.01)
        .map((o) => [o.code, Number(o.ottv_orientation_wm2 || 0)]),
    );
    const activeCodes = [...new Set([...baseOri.keys(), ...altOri.keys()])];

    if (activeCodes.length > 0) {
      const diffCard = document.createElement('div');
      diffCard.className = 'glass compare-diff-strip';

      const diffTitle = document.createElement('p');
      diffTitle.className = 'lbl';
      diffTitle.style.margin = '0 0 4px';
      diffTitle.style.textAlign = 'center';
      diffTitle.textContent = 'Selisih per arah (W/m²)';

      const ol = document.createElement('ol');
      ol.className = 'compare-diff-grid';
      ol.style.gridTemplateColumns = `repeat(${Math.min(activeCodes.length, 4)}, minmax(84px, 1fr))`;

      for (const code of activeCodes) {
        const v0 = baseOri.get(code) ?? 0;
        const v1 = altOri.get(code) ?? 0;
        const delta = v1 - v0;
        const li = document.createElement('li');
        li.className = 'compare-diff-cell';

        const cLbl = document.createElement('span');
        cLbl.className = 'lbl';
        cLbl.style.color = 'var(--ink)';
        cLbl.textContent = code;

        const arrow = document.createElement('span');
        arrow.className = 'num';
        arrow.style.fontSize = '12px';
        arrow.innerHTML = `${fmtId(v0, 2)} → <b>${fmtId(v1, 2)}</b>`;

        const dEl = document.createElement('span');
        dEl.className = `num ${delta <= 0 ? 'st-ok' : 'st-fail'}`;
        dEl.style.fontSize = '12px';
        dEl.style.fontWeight = '700';
        const sign = delta > 0 ? '+' : '−';
        dEl.textContent = `${sign}${fmtId(Math.abs(delta), 2)}`;

        li.append(cLbl, arrow, dEl);
        ol.appendChild(li);
      }

      diffCard.append(diffTitle, ol);
      viewerSec.appendChild(diffCard);
    }
  }

  // ==================== RIGHT COLUMN (300px) ====================
  const side = document.createElement('div');
  side.className = 'results-col';

  // 1. Bandingkan summary delta card
  const sumCard = document.createElement('section');
  sumCard.className = 'box';
  sumCard.setAttribute('aria-labelledby', 'cmp-title');

  const cmpHead = document.createElement('div');
  cmpHead.style.display = 'flex';
  cmpHead.style.justifyContent = 'space-between';
  cmpHead.style.alignItems = 'center';

  const cmpTitle = document.createElement('h2');
  cmpTitle.id = 'cmp-title';
  cmpTitle.style.fontSize = '14px';
  cmpTitle.textContent = 'Bandingkan';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'ghost ghost-sm';
  backBtn.style.height = '28px';
  backBtn.textContent = 'Kembali ke Hasil';
  backBtn.addEventListener('click', () => handlers.onExitCompare());

  cmpHead.append(cmpTitle, backBtn);
  sumCard.appendChild(cmpHead);

  if (activeAlt) {
    const delta = altOttv - baseOttv;
    const pct = baseOttv > 1e-4 ? (Math.abs(delta) / baseOttv) * 100 : 0;
    const sign = delta > 0 ? '+' : '−';

    const fig = document.createElement('p');
    fig.className = `num compare-delta-xl ${delta <= 0 ? 'st-ok' : 'st-fail'}`;
    const nSpan = document.createElement('span');
    nSpan.textContent = `${sign}${fmtId(Math.abs(delta), 2)}`;
    const uSpan = document.createElement('span');
    uSpan.className = 'figure-unit';
    uSpan.textContent = ' W/m²';
    fig.append(nSpan, uSpan);

    const desc = document.createElement('p');
    desc.className = 'muted num';
    desc.style.margin = '4px 0 0';
    desc.style.fontSize = '13px';
    const verb = delta <= 0 ? 'turun' : 'naik';
    const passTxt = altOttv <= sniLimit ? 'Lolos batas 35.' : 'Masih di atas batas 35.';
    desc.textContent = `OTTV ${verb} ${fmtId(pct, 1)}%, dari ${fmtId(baseOttv, 2)} ke ${fmtId(altOttv, 2)}. ${passTxt}`;

    sumCard.append(fig, desc);
  } else {
    const emptyP = document.createElement('p');
    emptyP.className = 'muted';
    emptyP.style.margin = '8px 0 0';
    emptyP.style.fontSize = '13px';
    emptyP.textContent =
      'Tambahkan minimal satu alternatif di bawah untuk membandingkan pengaruh penggantian kaca, dinding, atau arah utara.';
    sumCard.appendChild(emptyP);
  }

  side.appendChild(sumCard);

  // 2. Yang diubah di Alternatif X card (with catalog note!)
  if (activeAlt) {
    const chgCard = document.createElement('section');
    chgCard.className = 'box';
    chgCard.setAttribute('aria-labelledby', 'chg-title');

    const chgTitle = document.createElement('h2');
    chgTitle.id = 'chg-title';
    chgTitle.style.fontSize = '14px';
    chgTitle.textContent = `Yang diubah di Alternatif ${activeAlt.code}`;
    chgCard.appendChild(chgTitle);

    const baseGlz = findMaterial(state.materials, state.config?.settings?.glazing_material_id);
    const altGlz = findMaterial(state.materials, activeAlt.config?.settings?.glazing_material_id);
    const baseWall = findMaterial(state.materials, state.config?.settings?.wall_material_id);
    const altWall = findMaterial(state.materials, activeAlt.config?.settings?.wall_material_id);

    const diffRows = [];
    if (altGlz && altGlz.id !== baseGlz?.id) {
      diffRows.push(['Kaca', altGlz.name, true]);
      if (baseGlz?.sc != null && altGlz.sc != null) {
        diffRows.push(['SC', `${fmtId(baseGlz.sc, 2)} → ${fmtId(altGlz.sc, 2)}`, false]);
      }
      if (baseGlz?.u_value != null && altGlz.u_value != null) {
        diffRows.push(['Uf', `${fmtId(baseGlz.u_value, 2)} → ${fmtId(altGlz.u_value, 2)}`, false]);
      }
    }
    if (altWall && altWall.id !== baseWall?.id) {
      diffRows.push(['Dinding', altWall.name, true]);
      if (baseWall?.u_value != null && altWall.u_value != null) {
        diffRows.push(['Uw', `${fmtId(baseWall.u_value, 2)} → ${fmtId(altWall.u_value, 2)}`, false]);
      }
    }
    const baseNorth = Number(state.config?.settings?.north_angle_deg || 0);
    const altNorth = Number(activeAlt.config?.settings?.north_angle_deg || 0);
    if (Math.round(baseNorth) !== Math.round(altNorth)) {
      diffRows.push(['Arah utara', `${Math.round(baseNorth)}° → ${Math.round(altNorth)}°`, false]);
    }
    const baseLouver = Boolean(state.config?.advanced?.enable_parametric_louvers);
    const altLouver = Boolean(activeAlt.config?.advanced?.enable_parametric_louvers);
    if (baseLouver !== altLouver) {
      diffRows.push(['Peneduh kisi', altLouver ? 'Aktif' : 'Nonaktif', false]);
    }

    const tbl = document.createElement('table');
    tbl.className = 'compare-diff-table';
    const tbody = document.createElement('tbody');
    tbody.className = 'num';
    if (diffRows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'muted';
      td.textContent = 'Konfigurasi sama dengan desain sekarang.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      for (const [k, v, bold] of diffRows) {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        td1.className = 'muted';
        if (k === 'Uf') td1.innerHTML = 'U<sub>f</sub>';
        else if (k === 'Uw') td1.innerHTML = 'U<sub>w</sub>';
        else td1.textContent = k;
        const td2 = document.createElement('td');
        td2.style.textAlign = 'right';
        if (bold) td2.style.fontWeight = '600';
        td2.textContent = v;
        tr.append(td1, td2);
        tbody.appendChild(tr);
      }
    }
    tbl.appendChild(tbody);
    chgCard.appendChild(tbl);

    const catalogNote = getMaterialCatalogNote(altGlz) || getMaterialCatalogNote(altWall);
    if (catalogNote) {
      const noteP = document.createElement('p');
      noteP.className = 'lbl';
      noteP.style.margin = '8px 0 0';
      noteP.style.fontWeight = '500';
      noteP.style.lineHeight = '17px';
      noteP.textContent = catalogNote;
      chgCard.appendChild(noteP);
    }

    side.appendChild(chgCard);
  }

  // 3. Alternatif list + inline "+ Tambah alternatif" builder
  const altCard = document.createElement('section');
  altCard.className = 'box';
  altCard.setAttribute('aria-labelledby', 'alt-title');

  const altTitle = document.createElement('h2');
  altTitle.id = 'alt-title';
  altTitle.style.fontSize = '14px';
  altTitle.textContent = 'Alternatif';
  altCard.appendChild(altTitle);

  const altList = document.createElement('div');
  altList.className = 'compare-alt-list';

  for (const alt of alts) {
    const rowWrap = document.createElement('div');
    rowWrap.className = 'compare-alt-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    const isSel = activeAlt && alt.id === activeAlt.id;
    const fullTitle = `${alt.code} · ${alt.name}`;
    btn.className = `ghost compare-alt-btn${isSel ? ' is-active' : ''}`;
    btn.setAttribute('aria-pressed', isSel ? 'true' : 'false');
    btn.title = fullTitle;

    const nameSp = document.createElement('span');
    nameSp.className = 'compare-alt-name';
    nameSp.title = fullTitle;
    nameSp.textContent = fullTitle;

    const valSp = document.createElement('span');
    valSp.className = 'num compare-alt-val';
    valSp.textContent = fmtId(alt.analysisData?.ottv_total_wm2 ?? 0, 2);

    btn.append(nameSp, valSp);
    btn.addEventListener('click', () => handlers.onSelectAlternative(alt.id));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-mini-btn st-fail';
    delBtn.setAttribute('aria-label', `Hapus Alternatif ${alt.code}`);
    delBtn.title = 'Hapus alternatif';
    delBtn.innerHTML = icon('trash', 14);
    delBtn.addEventListener('click', () => handlers.onDeleteAlternative(alt.id));

    rowWrap.append(btn, delBtn);
    altList.appendChild(rowWrap);
  }

  // Toggle "+ Tambah alternatif" builder form
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'ghost compare-add-btn';
  addBtn.disabled = Boolean(state.compareBusy);
  addBtn.innerHTML = `${icon('plus', 14)}<span>${
    state.compareBusy ? 'Menghitung alternatif...' : 'Tambah alternatif'
  }</span>`;
  addBtn.addEventListener('click', () => {
    addFormOpen = !addFormOpen;
    handlers.onRerender();
  });
  altList.appendChild(addBtn);

  if (addFormOpen || alts.length === 0) {
    const form = document.createElement('form');
    form.className = 'glass-thin compare-add-form';

    const glzMats = state.materials?.glazing_materials || [];
    const wallMats = state.materials?.wall_materials || [];

    // Default suggestion: Kaca Elektrokromik if not already active
    const curGlzId = state.config?.settings?.glazing_material_id;
    const defaultAltGlz =
      curGlzId !== 'glz_kaca_elektrokromik' && glzMats.some((m) => m.id === 'glz_kaca_elektrokromik')
        ? 'glz_kaca_elektrokromik'
        : curGlzId;

    const glzLbl = document.createElement('label');
    glzLbl.className = 'lbl';
    glzLbl.textContent = 'Material kaca alternatif';
    const glzSel = document.createElement('select');
    glzSel.className = 'field-select field-select-sm';
    for (const m of glzMats) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (SC ${fmtId(m.sc ?? 0, 2)})`;
      if (m.id === defaultAltGlz) opt.selected = true;
      glzSel.appendChild(opt);
    }

    const wallLbl = document.createElement('label');
    wallLbl.className = 'lbl';
    wallLbl.textContent = 'Material dinding / spandrel';
    const wallSel = document.createElement('select');
    wallSel.className = 'field-select field-select-sm';
    const curWallId = state.config?.settings?.wall_material_id;
    for (const m of wallMats) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (Uw ${fmtId(m.u_value ?? 0, 2)})`;
      if (m.id === curWallId) opt.selected = true;
      wallSel.appendChild(opt);
    }

    const northLbl = document.createElement('label');
    northLbl.className = 'lbl';
    northLbl.textContent = 'Arah utara (derajat)';
    const northInp = document.createElement('input');
    northInp.type = 'number';
    northInp.min = '0';
    northInp.max = '359';
    northInp.className = 'field-input num';
    northInp.style.height = '34px';
    northInp.value = String(Math.round(Number(state.config?.settings?.north_angle_deg || 0)));

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'cta';
    submitBtn.style.height = '40px';
    submitBtn.style.fontSize = '13px';
    submitBtn.disabled = Boolean(state.compareBusy);
    submitBtn.textContent = state.compareBusy ? 'Menghitung...' : 'Hitung alternatif ini';

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const chosenGlz = glzMats.find((m) => m.id === glzSel.value);
      const chosenWall = wallMats.find((m) => m.id === wallSel.value);
      const nextNorth = ((Number(northInp.value) || 0) % 360 + 360) % 360;
      let autoName = chosenGlz && chosenGlz.id !== curGlzId ? chosenGlz.name : '';
      if (!autoName && chosenWall && chosenWall.id !== curWallId) autoName = chosenWall.name;
      if (!autoName && Math.round(nextNorth) !== Math.round(Number(state.config?.settings?.north_angle_deg || 0))) {
        autoName = `Utara ${Math.round(nextNorth)}°`;
      }
      if (!autoName) autoName = chosenGlz?.name || 'Variasi desain';
      addFormOpen = false;
      handlers.onCreateAlternative({
        name: autoName,
        glazingMaterialId: glzSel.value,
        wallMaterialId: wallSel.value,
        northAngleDeg: nextNorth,
      });
    });

    form.append(glzLbl, glzSel, wallLbl, wallSel, northLbl, northInp, submitBtn);
    altList.appendChild(form);
  }

  altCard.appendChild(altList);
  side.appendChild(altCard);

  // 4. Design history (if user promoted an alternative previously)
  const history = state.designHistory || [];
  if (history.length > 0) {
    const histCard = document.createElement('section');
    histCard.className = 'box';
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.className = 'lbl';
    sum.style.color = 'var(--ink)';
    sum.textContent = `Riwayat desain sebelumnya (${history.length})`;
    det.appendChild(sum);

    const ul = document.createElement('div');
    ul.style.display = 'grid';
    ul.style.gap = '6px';
    ul.style.marginTop = '8px';

    for (const h of history) {
      const item = document.createElement('div');
      item.className = 'glass-thin';
      item.style.padding = '8px 10px';
      item.style.borderRadius = '10px';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.gap = '6px';

      const info = document.createElement('div');
      info.style.fontSize = '12px';
      info.innerHTML = `<div style="font-weight:600;"></div><div class="muted num"></div>`;
      info.children[0].textContent = h.label;
      info.children[1].textContent = `OTTV ${fmtId(h.analysisData?.ottv_total_wm2 ?? 0, 2)} W/m²`;

      const restBtn = document.createElement('button');
      restBtn.type = 'button';
      restBtn.className = 'ghost ghost-sm';
      restBtn.style.height = '28px';
      restBtn.textContent = 'Pulihkan';
      restBtn.addEventListener('click', () => handlers.onRestoreHistory(h.id));

      item.append(info, restBtn);
      ul.appendChild(item);
    }

    det.appendChild(ul);
    histCard.appendChild(det);
    side.appendChild(histCard);
  }

  // 5. Bottom CTA: Pakai Alternatif X
  if (activeAlt) {
    const ctaWrap = document.createElement('div');
    ctaWrap.style.display = 'grid';
    ctaWrap.style.gap = '6px';
    ctaWrap.style.marginTop = 'auto';

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'cta';
    applyBtn.textContent = `Pakai Alternatif ${activeAlt.code}`;
    applyBtn.addEventListener('click', () => handlers.onApplyAlternative(activeAlt.id));

    const note = document.createElement('p');
    note.className = 'lbl';
    note.style.margin = '0';
    note.style.textAlign = 'center';
    note.style.fontWeight = '500';
    note.textContent = 'Desain sekarang tetap tersimpan sebagai riwayat.';

    ctaWrap.append(applyBtn, note);
    side.appendChild(ctaWrap);
  }

  main.append(viewerSec, side);

  window.requestAnimationFrame(() => {
    if (canvasHost.isConnected) {
      viewer.setRightInsetPx(0);
      viewer.mount(canvasHost, { showGizmo: false });
      viewer.syncCompareState(state, activeAlt?.analysisData || null, splitRatio);
    }
  });

  return main;
}
