/**
 * Screen 6: Bandingkan (`docs/FASE4_UI_SPEC.md` §3.6 + mockup 8-bandingkan.html):
 * - Versus: dua panel 3D berdampingan (`Sekarang` kiri, `Alternatif X` kanan), masing-masing gedung utuh,
 *   satu kamera bersama (putar/zoom satu panel, keduanya ikut). Berlaku untuk alternatif material dan model.
 * - Floating header cards for both designs + bottom-center "Selisih per arah (W/m²)" card.
 * - Right side column: delta summary, "Yang diubah di Alternatif X" (with catalog note e.g. electrochromic),
 *   alternative list + inline "+ Tambah alternatif" builder (runs real `engine.analyze`),
 *   "Pakai Alternatif X" (pushes current design to `designHistory`), and collapsible history restore.
 */

import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { renderCapturePopover } from '../viewer/vbar.js';
import { viewer } from '../viewer/viewer.js';

let addFormOpen = false;
let addTab = 'settings'; // 'settings' | 'model'
let renamingAltId = null;

const CATEGORY_ID = {
  glazing: 'Kaca',
  wall: 'Dinding',
  spandrel: 'Spandrel',
  frame: 'Rangka',
  shading: 'Peneduh',
  roof: 'Atap',
  composite_cw: 'Curtain wall',
  ignore: 'Diabaikan',
  unknown: 'Belum jelas',
};

function totalHeatKw(analysis) {
  let w = 0;
  for (const o of analysis?.orientation_breakdown || []) w += Number(o.heat_gain_watts || 0);
  return w / 1000;
}

function envelopeArea(analysis) {
  return Number(analysis?.summary?.total_envelope_area_m2 ?? 0);
}

function altSubtitle(alt, state) {
  if (alt.kind === 'model') return `Model: ${alt.filename || alt.name}`;
  if (alt.disabledGroups?.length) return `Tanpa ${alt.disabledGroups.map((g) => g.split(' :: ')[0]).join(', ')}`;
  return summarizeDesignSubtitle(alt.config, state.materials);
}

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
        altSubtitle(activeAlt, state),
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

  // Versus: dua panel sama lebar dengan garis tengah tipis dan lencana VS. Kamera sama, jadi skala gedung setara.
  if (activeAlt) {
    viewerStage.classList.add('is-versus');
    const seam = document.createElement('div');
    seam.className = 'compare-seam';
    seam.setAttribute('aria-hidden', 'true');
    const vs = document.createElement('div');
    vs.className = 'glass compare-vs';
    vs.setAttribute('aria-hidden', 'true');
    vs.textContent = 'VS';
    viewerStage.append(seam, vs);

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

    // Total panas dan luas: penting bila model berbeda (luas selubung tidak sama).
    const hb = totalHeatKw(baseAnalysis);
    const ha = totalHeatKw(activeAlt.analysisData);
    const ab = envelopeArea(baseAnalysis);
    const aa = envelopeArea(activeAlt.analysisData);
    const extra = document.createElement('p');
    extra.className = 'muted num';
    extra.style.margin = '4px 0 0';
    extra.style.fontSize = '12.5px';
    extra.textContent = `Total panas ${fmtId(hb, 1)} → ${fmtId(ha, 1)} kW · luas selubung ${fmtId(ab, 0)} → ${fmtId(aa, 0)} m²`;
    sumCard.appendChild(extra);

    const sb = state.config?.settings || {};
    const sa = activeAlt.config?.settings || {};
    const unfair = [];
    if (sb.city_preset !== sa.city_preset) unfair.push('lokasi');
    if (sb.sf_source !== sa.sf_source) unfair.push('tabel SF');
    if (sb.mode !== sa.mode) unfair.push('mode perhitungan');
    if (unfair.length) {
      const warn = document.createElement('p');
      warn.className = 'lbl st-fail';
      warn.style.margin = '6px 0 0';
      warn.textContent = `Perhatian: ${unfair.join(', ')} berbeda, jadi perbandingan tidak setara.`;
      sumCard.appendChild(warn);
    }
    if (activeAlt.analysisData?.summary?.is_provisional) {
      const prov = document.createElement('p');
      prov.className = 'lbl';
      prov.style.margin = '6px 0 0';
      prov.textContent = 'Hasil alternatif SEMENTARA: ada catatan pemeriksaan yang diterima tanpa perbaikan.';
      sumCard.appendChild(prov);
    }
  } else {
    const emptyP = document.createElement('p');
    emptyP.className = 'muted';
    emptyP.style.margin = '8px 0 0';
    emptyP.style.fontSize = '13px';
    emptyP.textContent =
      'Tambahkan alternatif di bawah: ganti material, matikan grup (mis. tanpa sirip), atau bandingkan dengan model lain.';
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
    if (activeAlt.kind === 'model') {
      const b = baseAnalysis;
      const a = activeAlt.analysisData;
      diffRows.push(['Model', activeAlt.filename || activeAlt.name, true]);
      diffRows.push(['Luas selubung', `${fmtId(envelopeArea(b), 0)} → ${fmtId(envelopeArea(a), 0)} m²`, false]);
      diffRows.push([
        'WWR',
        `${fmtId((b?.summary?.effective_wwr ?? 0) * 100, 1)} → ${fmtId((a?.summary?.effective_wwr ?? 0) * 100, 1)}%`,
        false,
      ]);
      diffRows.push(['Total panas', `${fmtId(totalHeatKw(b), 1)} → ${fmtId(totalHeatKw(a), 1)} kW`, false]);
      if (b?.rttv?.applicable || a?.rttv?.applicable) {
        const rb = b?.rttv?.applicable ? fmtId(b.rttv.rttv_wm2, 2) : '-';
        const ra = a?.rttv?.applicable ? fmtId(a.rttv.rttv_wm2, 2) : '-';
        diffRows.push(['RTTV', `${rb} → ${ra} W/m²`, false]);
      }
      diffRows.push(['Lantai', `${b?.summary?.total_floors ?? '-'} → ${a?.summary?.total_floors ?? '-'}`, false]);
    }
    if (activeAlt.disabledGroups?.length) {
      diffRows.push(['Grup dimatikan', activeAlt.disabledGroups.map((g) => g.split(' :: ')[0]).join(', '), true]);
    }
    if (activeAlt.kind !== 'model' && altGlz && altGlz.id !== baseGlz?.id) {
      diffRows.push(['Kaca', altGlz.name, true]);
      if (baseGlz?.sc != null && altGlz.sc != null) {
        diffRows.push(['SC', `${fmtId(baseGlz.sc, 2)} → ${fmtId(altGlz.sc, 2)}`, false]);
      }
      if (baseGlz?.u_value != null && altGlz.u_value != null) {
        diffRows.push(['Uf', `${fmtId(baseGlz.u_value, 2)} → ${fmtId(altGlz.u_value, 2)}`, false]);
      }
    }
    if (activeAlt.kind !== 'model' && altWall && altWall.id !== baseWall?.id) {
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

    const glzChanged = activeAlt.kind !== 'model' && altGlz && altGlz.id !== baseGlz?.id;
    const wallChanged = activeAlt.kind !== 'model' && altWall && altWall.id !== baseWall?.id;
    const catalogNote = (glzChanged && getMaterialCatalogNote(altGlz)) || (wallChanged && getMaterialCatalogNote(altWall)) || '';
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

    if (renamingAltId === alt.id) {
      const form = document.createElement('form');
      form.style.display = 'flex';
      form.style.gap = '4px';
      form.style.width = '100%';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'field-input';
      inp.style.height = '34px';
      inp.style.fontSize = '12.5px';
      inp.value = alt.name;
      inp.setAttribute('aria-label', `Nama baru untuk Alternatif ${alt.code}`);
      const okBtn = document.createElement('button');
      okBtn.type = 'submit';
      okBtn.className = 'ghost ghost-sm';
      okBtn.style.height = '34px';
      okBtn.textContent = 'Simpan';
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const nextName = inp.value.trim();
        renamingAltId = null;
        if (nextName) handlers.onRenameAlternative?.(alt.id, nextName);
        else handlers.onRerender();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          renamingAltId = null;
          handlers.onRerender();
        }
      });
      form.append(inp, okBtn);
      rowWrap.appendChild(form);
      altList.appendChild(rowWrap);
      window.requestAnimationFrame(() => {
        inp.focus();
        inp.select();
      });
      continue;
    }

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

    const renBtn = document.createElement('button');
    renBtn.type = 'button';
    renBtn.className = 'icon-mini-btn';
    renBtn.setAttribute('aria-label', `Ganti nama Alternatif ${alt.code}`);
    renBtn.title = 'Ganti nama';
    renBtn.innerHTML = icon('edit', 13);
    renBtn.addEventListener('click', () => {
      renamingAltId = alt.id;
      handlers.onRerender();
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'icon-mini-btn';
    dupBtn.setAttribute('aria-label', `Duplikat Alternatif ${alt.code}`);
    dupBtn.title = 'Duplikat alternatif';
    dupBtn.innerHTML = icon('copy', 13);
    dupBtn.addEventListener('click', () => handlers.onDuplicateAlternative?.(alt.id));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-mini-btn st-fail';
    delBtn.setAttribute('aria-label', `Hapus Alternatif ${alt.code}`);
    delBtn.title = 'Hapus alternatif';
    delBtn.innerHTML = icon('trash', 13);
    delBtn.addEventListener('click', () => handlers.onDeleteAlternative(alt.id));

    rowWrap.append(btn, renBtn, dupBtn, delBtn);
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

  if (addFormOpen || alts.length === 0 || state.compareModelDraft) {
    if (state.compareModelDraft) addTab = 'model';
    const wrap = document.createElement('div');
    wrap.className = 'glass-thin compare-add-form';

    const tabs = document.createElement('div');
    tabs.className = 'legend-toggle compare-add-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const [id, lbl] of [
      ['settings', 'Pengaturan'],
      ['model', 'Model lain'],
    ]) {
      const t = document.createElement('button');
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', addTab === id ? 'true' : 'false');
      t.className = addTab === id ? 'on' : '';
      t.textContent = lbl;
      t.addEventListener('click', () => {
        addTab = id;
        handlers.onRerender();
      });
      tabs.appendChild(t);
    }
    wrap.appendChild(tabs);

    if (addTab === 'settings') wrap.appendChild(buildSettingsForm(state, handlers));
    else wrap.appendChild(buildModelForm(state, handlers));
    altList.appendChild(wrap);
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

  // 5. Capture gambar perbandingan (dua sisi + selisih per arah)
  if (activeAlt) {
    const capWrap = document.createElement('div');
    capWrap.className = 'compare-capture-wrap';
    const capBtn = document.createElement('button');
    capBtn.type = 'button';
    capBtn.className = `ghost compare-add-btn${state.openPopover === 'capture' ? ' is-active' : ''}`;
    capBtn.setAttribute('aria-expanded', state.openPopover === 'capture' ? 'true' : 'false');
    capBtn.innerHTML = `${icon('camera', 14)}<span>Simpan gambar perbandingan</span>`;
    capBtn.addEventListener('click', () => handlers.onTogglePopover?.(state.openPopover === 'capture' ? null : 'capture'));
    capWrap.appendChild(capBtn);
    if (state.openPopover === 'capture') {
      const pop = renderCapturePopover(state, handlers);
      pop.classList.add('capture-pop-inline');
      capWrap.appendChild(pop);
    }
    side.appendChild(capWrap);
  }

  // 6. Bottom CTA: Pakai Alternatif X
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


function buildSettingsForm(state, handlers) {
  const form = document.createElement('form');
  form.className = 'compare-add-body';

  const glzMats = state.materials?.glazing_materials || [];
  const wallMats = state.materials?.wall_materials || [];
  const curGlzId = state.config?.settings?.glazing_material_id;
  const curWallId = state.config?.settings?.wall_material_id;

  const glzLbl = document.createElement('label');
  glzLbl.className = 'lbl';
  glzLbl.textContent = 'Material kaca';
  const glzSel = document.createElement('select');
  glzSel.className = 'field-select field-select-sm';
  for (const m of glzMats) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (SC ${fmtId(m.sc ?? 0, 2)})`;
    if (m.id === curGlzId) opt.selected = true;
    glzSel.appendChild(opt);
  }

  const wallLbl = document.createElement('label');
  wallLbl.className = 'lbl';
  wallLbl.textContent = 'Material dinding / spandrel';
  const wallSel = document.createElement('select');
  wallSel.className = 'field-select field-select-sm';
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

  // Matikan grup: misalnya Peneduh untuk membandingkan tanpa sirip/overhang.
  const grpLbl = document.createElement('p');
  grpLbl.className = 'lbl';
  grpLbl.style.margin = '4px 0 0';
  grpLbl.textContent = 'Matikan grup (opsional)';
  const grpHint = document.createElement('p');
  grpHint.className = 'muted';
  grpHint.style.margin = '0';
  grpHint.style.fontSize = '11.5px';
  grpHint.textContent = 'Contoh: matikan grup peneduh untuk melihat OTTV tanpa sirip. Bayangannya ikut hilang dari hitungan.';
  const grpList = document.createElement('div');
  grpList.className = 'compare-group-list';
  const alreadyOff = new Set(state.config?.roles?.disabled_groups || []);
  const groups = (state.analysisData?.groups || [])
    .filter((g) => g.group_name && !alreadyOff.has(g.group_name) && g.category !== 'ignore')
    .sort((x, y) => (x.category === 'shading' ? -1 : 0) - (y.category === 'shading' ? -1 : 0));
  const checks = [];
  for (const g of groups) {
    const row = document.createElement('label');
    row.className = 'compare-group-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = g.group_name;
    const nm = document.createElement('span');
    nm.className = 'compare-group-name';
    nm.textContent = g.group_name.split(' :: ')[0];
    nm.title = g.group_name;
    const cat = document.createElement('span');
    cat.className = 'muted compare-group-cat';
    cat.textContent = CATEGORY_ID[g.category] || g.category || '';
    row.append(cb, nm, cat);
    grpList.appendChild(row);
    checks.push(cb);
  }
  if (!groups.length) {
    const none = document.createElement('p');
    none.className = 'muted';
    none.style.fontSize = '12px';
    none.textContent = 'Tidak ada grup yang bisa dimatikan.';
    grpList.appendChild(none);
  }

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
    const off = checks.filter((c) => c.checked).map((c) => c.value);
    const parts = [];
    if (off.length) parts.push(`Tanpa ${off.map((g) => g.split(' :: ')[0]).join(', ')}`);
    if (chosenGlz && chosenGlz.id !== curGlzId) parts.push(chosenGlz.name);
    if (chosenWall && chosenWall.id !== curWallId) parts.push(chosenWall.name);
    if (Math.round(nextNorth) !== Math.round(Number(state.config?.settings?.north_angle_deg || 0))) parts.push(`Utara ${Math.round(nextNorth)}°`);
    addFormOpen = false;
    handlers.onCreateAlternative({
      name: parts.join(' · ') || 'Variasi desain',
      glazingMaterialId: glzSel.value,
      wallMaterialId: wallSel.value,
      northAngleDeg: nextNorth,
      disabledGroups: off,
    });
  });

  form.append(glzLbl, glzSel, wallLbl, wallSel, northLbl, northInp, grpLbl, grpHint, grpList, submitBtn);
  return form;
}

function buildModelForm(state, handlers) {
  const box = document.createElement('div');
  box.className = 'compare-add-body';
  const d = state.compareModelDraft;

  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.style.margin = '0';
  intro.style.fontSize = '12px';
  intro.textContent =
    'Unggah model kedua (mis. versi dengan peneduh). Lokasi, tabel SF, mode, dan material disamakan dengan proyek ini supaya adil.';
  box.appendChild(intro);

  if (!d || (!d.modelId && !d.busy)) {
    const fileLbl = document.createElement('label');
    fileLbl.className = 'ghost compare-file-btn';
    fileLbl.innerHTML = `${icon('upload', 14)}<span>Pilih file model</span>`;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.3dm,.ifc,.obj,.glb,.gltf,.zip,.hbjson,.json,.stl,.ply';
    inp.className = 'sr-only';
    inp.addEventListener('change', () => {
      if (inp.files?.[0]) handlers.onPrepareModelAlternative(inp.files[0]);
    });
    fileLbl.appendChild(inp);
    box.appendChild(fileLbl);
    if (d?.error) {
      const err = document.createElement('p');
      err.className = 'lbl st-fail';
      err.style.margin = '0';
      err.textContent = d.error;
      box.appendChild(err);
    }
    return box;
  }

  if (d.busy && !d.modelId) {
    const p = document.createElement('p');
    p.className = 'lbl';
    p.style.margin = '0';
    p.textContent = `Membaca ${d.filename}...`;
    box.appendChild(p);
    return box;
  }

  // Cek singkat model kedua
  const head = document.createElement('p');
  head.className = 'lbl';
  head.style.margin = '0';
  head.style.color = 'var(--ink)';
  head.textContent = d.filename;
  const span = d.bbox?.span || [];
  const info = document.createElement('p');
  info.className = 'muted num';
  info.style.margin = '0';
  info.style.fontSize = '12px';
  info.textContent = `${span.map((v) => fmtId(v, 1)).join(' × ')} m · ${d.groupCount} grup${d.floors ? ` · ${d.floors} lantai` : ''}`;
  box.append(head, info);

  const row = (label, el) => {
    const r = document.createElement('label');
    r.className = 'compare-check-row';
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = label;
    r.append(l, el);
    return r;
  };
  const mkSel = (opts, val) => {
    const sel = document.createElement('select');
    sel.className = 'field-select field-select-sm';
    for (const [v, t] of opts) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      if (v === val) o.selected = true;
      sel.appendChild(o);
    }
    return sel;
  };
  const unitSel = mkSel(
    [
      ['auto', `Otomatis (${d.appliedUnit})`],
      ['m', 'Meter'],
      ['cm', 'Sentimeter'],
      ['mm', 'Milimeter'],
      ['ft', 'Kaki'],
      ['in', 'Inci'],
    ],
    d.unitNeedsConfirmation ? d.appliedUnit || 'auto' : 'auto',
  );
  const axisSel = mkSel(
    [
      ['auto', `Otomatis (${d.appliedUpAxis}-atas)`],
      ['Z', 'Z ke atas'],
      ['Y', 'Y ke atas'],
    ],
    'auto',
  );
  const scopeSel = mkSel(
    [
      ['facade_only', 'Fasad saja'],
      ['full_building', 'Gedung lengkap'],
      ['building_site', 'Gedung dan tapak'],
    ],
    d.config?.model?.model_scope || 'full_building',
  );
  const northInp = document.createElement('input');
  northInp.type = 'number';
  northInp.min = '0';
  northInp.max = '359';
  northInp.className = 'field-input num';
  northInp.style.height = '32px';
  northInp.value = String(Math.round(Number(state.config?.settings?.north_angle_deg || 0)));
  northInp.title = 'Samakan dengan proyek ini, atau ubah bila model kedua digambar dengan orientasi lain';

  box.append(row('Satuan', unitSel), row('Sumbu atas', axisSel), row('Isi model', scopeSel), row('Arah utara (°)', northInp));

  const warnFlags = (d.flags || []).filter((f) => f.severity !== 'ok');
  if (warnFlags.length) {
    const fl = document.createElement('p');
    fl.className = 'lbl';
    fl.style.margin = '0';
    fl.style.fontWeight = '500';
    fl.textContent = `Catatan model: ${warnFlags.map((f) => f.title).join('; ')}. Hasil akan ditandai SEMENTARA.`;
    box.appendChild(fl);
  }
  if (d.error) {
    const err = document.createElement('p');
    err.className = 'lbl st-fail';
    err.style.margin = '0';
    err.textContent = d.error;
    box.appendChild(err);
  }

  const btnRow = document.createElement('div');
  btnRow.style.display = 'grid';
  btnRow.style.gridTemplateColumns = 'auto 1fr';
  btnRow.style.gap = '6px';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ghost ghost-sm';
  cancel.style.height = '40px';
  cancel.textContent = 'Batal';
  cancel.addEventListener('click', () => handlers.onCancelModelDraft());
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'cta';
  go.style.height = '40px';
  go.style.fontSize = '13px';
  go.disabled = Boolean(d.busy || state.compareBusy);
  go.textContent = d.busy ? 'Menghitung...' : 'Hitung model ini';
  go.addEventListener('click', () => {
    addFormOpen = false;
    handlers.onCreateModelAlternative({
      unit: unitSel.value,
      upAxis: axisSel.value,
      scope: scopeSel.value,
      northAngleDeg: Number(northInp.value),
      name: d.filename,
    });
  });
  btnRow.append(cancel, go);
  box.appendChild(btnRow);
  return box;
}
