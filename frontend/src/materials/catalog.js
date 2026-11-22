/**
 * LUXA Square-Card Material Catalog, Detail Panel, Material Form, & Recommender Overlay
 * (`docs/RENCANA.md` Fase 4e):
 * - Covers the viewer area as a large Liquid Glass overlay (`Esc` closes).
 * - Unifies Mode Jelajah (rail) and Mode Pilih (from "Ganti material" on role/orientation)
 *   using the exact same ~168px square card component.
 * - Keeps user prices strictly client-side in `luxa.prices.v1` (never transmitted to server).
 */

import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { parseDecimalInput } from '../state.js';
import {
  SC_TO_SHGC_RATIO,
  computeLocalLowestCostOption,
  enrichCandidatesWithLocalPrices,
  exportUserMaterialsJson,
  importUserMaterialsJson,
  loadUserPrices,
  lookupTdekLocal,
  setUserPrice,
} from './store.js';

const CATEGORY_TABS = [
  ['glazing', 'Kaca'],
  ['wall', 'Dinding'],
  ['roof', 'Atap'],
  ['frame', 'Rangka'],
];

const ORIGIN_BADGE_LABELS = {
  sni_generic: 'Bawaan SNI',
  brand_reference: 'Referensi brand',
  user: 'Buatan saya',
};

const ROLE_FIELD_BY_CAT = {
  glazing: 'glazing_material_id',
  wall: 'wall_material_id',
  roof: 'roof_material_id',
  frame: 'frame_material_id',
};

// Local UI filter/selection state (persists smoothly while browsing)
const ui = {
  search: '',
  category: 'glazing',
  brand: 'all',
  scMin: 0.05,
  scMax: 1.0,
  uMin: 0.05,
  uMax: 7.0,
  vltMin: 0.0,
  vltMax: 1.0,
  sort: 'sc_asc',
  selectedDetailId: null,
  formMode: null, // null | { kind: 'create' | 'edit' | 'duplicate', draft }
  // Recommender tab state
  recTargetType: 'glazing_all',
  recTargetKey: null,
  recMinVlt: 0,
  recBrand: 'all',
  recGlazingType: 'all',
  recLoading: false,
  recTargetResult: null,
  optTargetOttv: 35,
  optMinVlt: 0,
  optUniform: false,
  optBrand: 'all',
  optLoading: false,
  optResult: null,
  lastAnalysisId: null,
};

function isValidHexColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.trim());
}

function resolveThemeTokenHex(varName) {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (isValidHexColor(raw)) return raw;
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx && raw) {
      ctx.fillStyle = raw;
      if (isValidHexColor(ctx.fillStyle)) return ctx.fillStyle;
    }
  } catch {
    // ignore in non-DOM test environments
  }
  return '';
}

function makeSwatchStyle(mat) {
  const hex = isValidHexColor(mat?.color_hex) ? mat.color_hex.trim() : '';
  if (!hex) {
    return mat?.category === 'glazing'
      ? 'background: linear-gradient(135deg, var(--data-glazing), var(--surface-sunken));'
      : 'background: var(--data-wall);';
  }
  if (mat?.category === 'glazing') {
    return `background: linear-gradient(135deg, color-mix(in srgb, ${hex} 78%, white 22%) 0%, ${hex} 58%, color-mix(in srgb, ${hex} 80%, black 20%) 100%);`;
  }
  return `background: linear-gradient(180deg, ${hex} 0%, color-mix(in srgb, ${hex} 88%, black 12%) 100%);`;
}

function getActiveMaterialIdForTarget(state, cfg) {
  const catState = state.materialCatalog;
  if (!catState) return null;
  if (catState.targetOrientCode) {
    return (
      cfg?.settings?.orientation_material_overrides?.[catState.targetOrientCode] ||
      cfg?.settings?.glazing_material_id ||
      null
    );
  }
  if (catState.targetField) {
    return cfg?.settings?.[catState.targetField] || null;
  }
  return null;
}

function filterAndSortMaterials(materials, lockedCategory) {
  const effCat = lockedCategory || ui.category;
  const q = ui.search.trim().toLowerCase();

  let list = (materials || []).filter((m) => m.category === effCat);
  if (q) {
    list = list.filter((m) => {
      const hay = `${m.name || ''} ${m.brand || ''} ${m.product_line || ''} ${m.configuration || ''} ${m.technology || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if (ui.brand && ui.brand !== 'all') {
    list = list.filter((m) => String(m.brand || '') === ui.brand);
  }
  if (effCat === 'glazing') {
    list = list.filter((m) => {
      const sc = Number(m.sc ?? 0.5);
      const u = Number(m.u_value ?? 2.0);
      const vlt = Number(m.vlt ?? 0.5);
      return (
        sc >= ui.scMin - 1e-6 &&
        sc <= ui.scMax + 1e-6 &&
        u >= ui.uMin - 1e-6 &&
        u <= ui.uMax + 1e-6 &&
        vlt >= ui.vltMin - 1e-6 &&
        vlt <= ui.vltMax + 1e-6
      );
    });
  } else {
    list = list.filter((m) => {
      const u = Number(m.u_value ?? 1.0);
      return u >= ui.uMin - 1e-6 && u <= ui.uMax + 1e-6;
    });
  }

  list = [...list];
  if (ui.sort === 'name_asc') {
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  } else if (ui.sort === 'u_asc') {
    list.sort((a, b) => Number(a.u_value ?? 99) - Number(b.u_value ?? 99));
  } else if (ui.sort === 'vlt_desc') {
    list.sort((a, b) => Number(b.vlt ?? -1) - Number(a.vlt ?? -1));
  } else {
    // sc_asc (or alpha_asc for opaque)
    list.sort((a, b) => {
      if (effCat === 'glazing') return Number(a.sc ?? 99) - Number(b.sc ?? 99);
      return Number(a.alpha ?? 99) - Number(b.alpha ?? 99);
    });
  }
  return list;
}

function buildSquareMaterialCard(mat, { isActiveOnTarget, mode, onCardClick, onInfoClick }) {
  const card = document.createElement('article');
  card.className = `mat-card glass-thin${isActiveOnTarget ? ' is-current' : ''}`;
  card.dataset.materialId = mat.id;

  const mainBtn = document.createElement('button');
  mainBtn.type = 'button';
  mainBtn.className = 'mat-card-hit';
  mainBtn.title = `${mat.name} (${mat.brand || ''})`;
  mainBtn.addEventListener('click', () => onCardClick(mat));

  const swatch = document.createElement('div');
  swatch.className = `mat-card-swatch${mat.category === 'glazing' ? ' is-glass' : ''}`;
  swatch.setAttribute('style', makeSwatchStyle(mat));

  const originKey = mat.origin || (mat.is_custom ? 'user' : 'sni_generic');
  const badge = document.createElement('span');
  badge.className = `mat-origin-badge is-${originKey}`;
  badge.textContent = ORIGIN_BADGE_LABELS[originKey] || 'Bawaan SNI';
  swatch.appendChild(badge);

  if (isActiveOnTarget) {
    const curBadge = document.createElement('span');
    curBadge.className = 'mat-active-badge';
    curBadge.textContent = 'Dipakai';
    swatch.appendChild(curBadge);
  }

  const body = document.createElement('div');
  body.className = 'mat-card-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'mat-card-name';
  nameEl.textContent = mat.name;

  const brandEl = document.createElement('div');
  brandEl.className = 'mat-card-brand';
  brandEl.textContent = mat.brand || 'Generik SNI';

  const stats = document.createElement('div');
  stats.className = 'mat-card-stats num';
  if (mat.category === 'glazing') {
    const vltTxt = mat.vlt != null ? `${Math.round(Number(mat.vlt) * 100)}%` : '-';
    stats.innerHTML = `
      <span><b>SC</b> ${fmtId(mat.sc ?? 0, 2)}</span>
      <span><b>U</b> ${fmtId(mat.u_value ?? 0, 2)}</span>
      <span><b>VLT</b> ${vltTxt}</span>
    `;
  } else {
    stats.innerHTML = `
      <span><b>α</b> ${fmtId(mat.alpha ?? 0, 2)}</span>
      <span><b>U</b> ${fmtId(mat.u_value ?? 0, 2)}</span>
      <span><b>${Math.round(Number(mat.massa_kg_m2 ?? 0))}</b> kg</span>
    `;
  }

  body.append(nameEl, brandEl, stats);
  mainBtn.append(swatch, body);

  // Corner "i" button opens detail panel in BOTH Mode Pilih and Mode Jelajah
  const infoBtn = document.createElement('button');
  infoBtn.type = 'button';
  infoBtn.className = 'glass mat-card-info-btn';
  infoBtn.setAttribute('aria-label', `Detail spesifikasi ${mat.name}`);
  infoBtn.title = 'Lihat detail spesifikasi';
  infoBtn.innerHTML = icon('info', 14);
  infoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onInfoClick(mat);
  });

  card.append(mainBtn, infoBtn);
  return card;
}

function renderDetailDrawer(mat, state, handlers) {
  const prices = loadUserPrices();
  const originKey = mat.origin || (mat.is_custom ? 'user' : 'sni_generic');
  const isUser = originKey === 'user';

  const panel = document.createElement('aside');
  panel.className = 'glass mat-detail-panel';
  panel.setAttribute('aria-label', `Detail ${mat.name}`);

  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'flex-start';
  head.style.gap = '8px';

  const titleWrap = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.style.margin = '0';
  h3.style.fontSize = '15px';
  h3.textContent = mat.name;
  const sub = document.createElement('div');
  sub.className = 'lbl';
  sub.textContent = `${mat.brand || 'Generik'}${mat.product_line ? ` · ${mat.product_line}` : ''} · ${ORIGIN_BADGE_LABELS[originKey] || ''}`;
  titleWrap.append(h3, sub);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-mini-btn';
  closeBtn.setAttribute('aria-label', 'Tutup detail material');
  closeBtn.innerHTML = icon('close', 15);
  closeBtn.addEventListener('click', () => {
    ui.selectedDetailId = null;
    handlers.onRerender();
  });
  head.append(titleWrap, closeBtn);

  const bigSwatch = document.createElement('div');
  bigSwatch.className = `mat-detail-swatch${mat.category === 'glazing' ? ' is-glass' : ''}`;
  bigSwatch.setAttribute('style', makeSwatchStyle(mat));

  // Specs table
  const tbl = document.createElement('table');
  tbl.className = 'compare-diff-table';
  const tbody = document.createElement('tbody');
  tbody.className = 'num';

  const rows = [];
  if (mat.category === 'glazing') {
    rows.push(['SC (ISO 9050)', fmtId(mat.sc ?? 0, 2)]);
    rows.push(['SHGC', fmtId(mat.shgc ?? (mat.sc ?? 0) * SC_TO_SHGC_RATIO, 2)]);
    rows.push(['U-value', `${fmtId(mat.u_value ?? 0, 2)} W/m²K`]);
    if (mat.u_value_nfrc_summer != null) {
      rows.push(['U-value NFRC Summer', `${fmtId(mat.u_value_nfrc_summer, 2)} W/m²K`]);
    }
    if (mat.vlt != null) rows.push(['VLT (cahaya tampak)', `${fmtId(Number(mat.vlt) * 100, 1)}%`]);
    if (mat.vlr_ext != null) rows.push(['VLR eksterior', `${fmtId(Number(mat.vlr_ext) * 100, 1)}%`]);
  } else {
    rows.push(['U-value', `${fmtId(mat.u_value ?? 0, 2)} W/m²K`]);
    if (mat.alpha != null) rows.push(['Absorbtansi (α)', fmtId(mat.alpha, 2)]);
    if (mat.massa_kg_m2 != null) rows.push(['Massa jenis luas', `${fmtId(mat.massa_kg_m2, 1)} kg/m²`]);
    const tdek = mat.td_ek ?? lookupTdekLocal(mat.category, mat.massa_kg_m2);
    if (tdek != null) rows.push(['TD_ek (SNI)', `${fmtId(tdek, 1)} K`]);
  }
  if (mat.thickness_mm != null) rows.push(['Ketebalan', `${fmtId(mat.thickness_mm, 1)} mm`]);
  if (mat.configuration) rows.push(['Konfigurasi', mat.configuration]);
  if (mat.standar_data) rows.push(['Standar data', mat.standar_data]);

  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.className = 'muted';
    td1.textContent = k;
    const td2 = document.createElement('td');
    td2.style.textAlign = 'right';
    td2.style.fontWeight = '600';
    td2.textContent = String(v);
    tr.append(td1, td2);
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);

  // Source link + access date
  const srcBox = document.createElement('div');
  srcBox.className = 'mat-detail-source';
  const sumberStr = String(mat.sumber || '').trim();
  if (sumberStr.startsWith('http://') || sumberStr.startsWith('https://')) {
    const a = document.createElement('a');
    a.href = sumberStr;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = mat.sumber_judul || 'Dokumen datasheet resmi produsen';
    srcBox.appendChild(a);
    if (mat.tanggal_akses) {
      const dt = document.createElement('div');
      dt.className = 'lbl';
      dt.textContent = `Diakses ${mat.tanggal_akses}`;
      srcBox.appendChild(dt);
    }
  } else if (sumberStr) {
    const sp = document.createElement('div');
    sp.className = 'lbl';
    sp.textContent = `Sumber: ${sumberStr}`;
    srcBox.appendChild(sp);
  }

  const noteTxt = String(mat.catatan || mat.description || '').trim();
  const noteEl = document.createElement('p');
  noteEl.className = 'muted';
  noteEl.style.fontSize = '12px';
  noteEl.style.margin = '4px 0 0';
  noteEl.textContent = noteTxt;

  // Optional local price (saved strictly in luxa.prices.v1, NEVER sent to server!)
  const priceWrap = document.createElement('div');
  priceWrap.className = 'glass-thin';
  priceWrap.style.padding = '8px 10px';
  priceWrap.style.borderRadius = '10px';
  priceWrap.style.display = 'grid';
  priceWrap.style.gap = '4px';

  const priceLbl = document.createElement('label');
  priceLbl.className = 'lbl';
  priceLbl.htmlFor = `mat-price-${mat.id}`;
  priceLbl.textContent = 'Harga estimasi lokal (Rp/m², opsional · hanya disimpan di browser)';

  const priceRow = document.createElement('div');
  priceRow.style.display = 'flex';
  priceRow.style.gap = '6px';
  const priceInp = document.createElement('input');
  priceInp.id = `mat-price-${mat.id}`;
  priceInp.type = 'number';
  priceInp.min = '0';
  priceInp.step = '50000';
  priceInp.placeholder = 'Mis. 1250000';
  priceInp.className = 'field-input num';
  priceInp.style.height = '32px';
  priceInp.value = prices[mat.id] ? String(prices[mat.id]) : '';
  const savePriceBtn = document.createElement('button');
  savePriceBtn.type = 'button';
  savePriceBtn.className = 'ghost ghost-sm';
  savePriceBtn.style.height = '32px';
  savePriceBtn.textContent = 'Simpan';
  savePriceBtn.addEventListener('click', () => {
    setUserPrice(mat.id, priceInp.value);
    handlers.onPriceUpdated?.(mat.name, Number(priceInp.value) || 0);
  });
  priceRow.append(priceInp, savePriceBtn);
  priceWrap.append(priceLbl, priceRow);

  // "Pakai untuk..." selector
  const applyBox = document.createElement('div');
  applyBox.style.display = 'grid';
  applyBox.style.gap = '6px';

  const applySel = document.createElement('select');
  applySel.className = 'field-select field-select-sm';
  applySel.setAttribute('aria-label', 'Pilih target pemasangan material');
  if (mat.category === 'glazing') {
    const targets = [
      ['role:glazing_material_id', 'Kaca utama (semua orientasi)'],
      ['ori:U', 'Kaca Fasad Utara (U)'],
      ['ori:T', 'Kaca Fasad Timur (T)'],
      ['ori:S', 'Kaca Fasad Selatan (S)'],
      ['ori:B', 'Kaca Fasad Barat (B)'],
      ['ori:TL', 'Kaca Fasad Timur Laut (TL)'],
      ['ori:TGR', 'Kaca Fasad Tenggara (TGR)'],
      ['ori:BD', 'Kaca Fasad Barat Daya (BD)'],
      ['ori:BL', 'Kaca Fasad Barat Laut (BL)'],
    ];
    for (const [val, lbl] of targets) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = lbl;
      applySel.appendChild(o);
    }
  } else {
    const field = ROLE_FIELD_BY_CAT[mat.category] || 'wall_material_id';
    const lblMap = { wall: 'Dinding & spandrel utama', roof: 'Atap utama', frame: 'Rangka jendela utama' };
    const o = document.createElement('option');
    o.value = `role:${field}`;
    o.textContent = lblMap[mat.category] || 'Selubung utama';
    applySel.appendChild(o);
  }

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'cta';
  applyBtn.style.height = '38px';
  applyBtn.style.fontSize = '13px';
  applyBtn.textContent = 'Pakai untuk target ini';
  applyBtn.addEventListener('click', () => {
    const val = applySel.value;
    if (val.startsWith('ori:')) {
      handlers.onApplyMaterialToOrientation(val.slice(4), mat);
    } else {
      handlers.onApplyMaterialToRole(val.slice(5), mat);
    }
  });
  applyBox.append(applySel, applyBtn);

  // CRUD actions: Duplikat & ubah (all), plus Ubah & Hapus ONLY for origin === 'user'
  const crudRow = document.createElement('div');
  crudRow.style.display = 'flex';
  crudRow.style.flexWrap = 'wrap';
  crudRow.style.gap = '6px';

  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.className = 'ghost ghost-sm';
  dupBtn.style.flex = '1';
  dupBtn.innerHTML = `${icon('copy', 13)}<span>Duplikat & ubah</span>`;
  dupBtn.addEventListener('click', () => {
    ui.formMode = {
      kind: 'duplicate',
      draft: {
        ...mat,
        id: '',
        name: `${mat.name} (Salinan)`,
        brand: isUser ? mat.brand : 'Buatan saya',
        origin: 'user',
      },
    };
    handlers.onRerender();
  });
  crudRow.appendChild(dupBtn);

  if (isUser) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ghost ghost-sm';
    editBtn.innerHTML = `${icon('edit', 13)}<span>Ubah</span>`;
    editBtn.addEventListener('click', () => {
      ui.formMode = { kind: 'edit', draft: { ...mat } };
      handlers.onRerender();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ghost ghost-sm st-fail';
    delBtn.innerHTML = `${icon('trash', 13)}<span>Hapus</span>`;
    delBtn.addEventListener('click', () => {
      handlers.onRequestDeleteUserMaterial(mat, () => {
        if (ui.selectedDetailId === mat.id) ui.selectedDetailId = null;
      });
    });
    crudRow.append(editBtn, delBtn);
  }

  panel.append(head, bigSwatch, tbl);
  if (srcBox.childNodes.length) panel.appendChild(srcBox);
  if (noteTxt) panel.appendChild(noteEl);
  panel.append(priceWrap, applyBox, crudRow);
  return panel;
}

function renderMaterialForm(state, handlers) {
  const { kind, draft } = ui.formMode;
  const prices = loadUserPrices();
  const cat = draft.category || 'glazing';

  const form = document.createElement('form');
  form.className = 'glass mat-form-panel';
  form.setAttribute('aria-label', kind === 'edit' ? 'Ubah material kustom' : 'Buat material baru');

  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'center';
  const h3 = document.createElement('h3');
  h3.style.margin = '0';
  h3.style.fontSize = '15px';
  h3.textContent =
    kind === 'edit' ? 'Ubah material buatan saya' : kind === 'duplicate' ? 'Duplikat & ubah material' : 'Tambah material baru';
  const cancelTop = document.createElement('button');
  cancelTop.type = 'button';
  cancelTop.className = 'icon-mini-btn';
  cancelTop.setAttribute('aria-label', 'Tutup form material');
  cancelTop.innerHTML = icon('close', 15);
  cancelTop.addEventListener('click', () => {
    ui.formMode = null;
    handlers.onRerender();
  });
  head.append(h3, cancelTop);
  form.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'mat-form-grid';

  const makeRow = (label, inputEl, errEl = null) => {
    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '3px';
    const lbl = document.createElement('label');
    lbl.className = 'lbl';
    lbl.textContent = label;
    wrap.append(lbl, inputEl);
    if (errEl) wrap.appendChild(errEl);
    return wrap;
  };

  // Category select (disabled when editing existing material)
  const catSel = document.createElement('select');
  catSel.className = 'field-select field-select-sm';
  catSel.disabled = kind === 'edit';
  for (const [cid, clbl] of CATEGORY_TABS) {
    const o = document.createElement('option');
    o.value = cid;
    o.textContent = clbl;
    if (cid === cat) o.selected = true;
    catSel.appendChild(o);
  }
  catSel.addEventListener('change', () => {
    ui.formMode = {
      kind,
      draft: {
        ...draft,
        category: catSel.value,
        u_value: catSel.value === 'glazing' ? 1.8 : 1.2,
        sc: catSel.value === 'glazing' ? 0.35 : null,
        shgc: catSel.value === 'glazing' ? Math.round(0.35 * SC_TO_SHGC_RATIO * 100) / 100 : null,
        vlt: catSel.value === 'glazing' ? 0.50 : null,
        alpha: catSel.value !== 'glazing' ? 0.50 : null,
        massa_kg_m2: catSel.value === 'roof' ? 240 : catSel.value === 'wall' ? 150 : 20,
      },
    };
    handlers.onRerender();
  });

  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.className = 'field-input';
  nameInp.required = true;
  nameInp.placeholder = 'Mis. Kaca Low-E Hijau 8mm';
  nameInp.value = draft.name || '';
  const nameErr = document.createElement('span');
  nameErr.className = 'mat-field-err';

  const brandInp = document.createElement('input');
  brandInp.type = 'text';
  brandInp.className = 'field-input';
  brandInp.placeholder = 'Buatan saya / nama proyek';
  brandInp.value = draft.brand || 'Buatan saya';

  const uInp = document.createElement('input');
  uInp.type = 'text';
  uInp.inputMode = 'decimal';
  uInp.className = 'field-input num';
  uInp.value = String(draft.u_value ?? (cat === 'glazing' ? 1.8 : 1.2));
  const uErr = document.createElement('span');
  uErr.className = 'mat-field-err';

  grid.append(makeRow('Kategori', catSel), makeRow('Nama material *', nameInp, nameErr), makeRow('Brand / label', brandInp), makeRow('U-value (W/m²K) *', uInp, uErr));

  let scInp = null;
  let shgcInp = null;
  let vltInp = null;
  let configInp = null;
  let alphaInp = null;
  let massaInp = null;
  let tdekPreview = null;
  const scErr = document.createElement('span');
  scErr.className = 'mat-field-err';
  const vltErr = document.createElement('span');
  vltErr.className = 'mat-field-err';
  const alphaErr = document.createElement('span');
  alphaErr.className = 'mat-field-err';

  if (cat === 'glazing') {
    const initSc = Number(draft.sc ?? 0.35);
    const initShgc = Number(draft.shgc ?? Math.round(initSc * SC_TO_SHGC_RATIO * 1000) / 1000);

    scInp = document.createElement('input');
    scInp.type = 'text';
    scInp.inputMode = 'decimal';
    scInp.className = 'field-input num';
    scInp.value = String(initSc);

    shgcInp = document.createElement('input');
    shgcInp.type = 'text';
    shgcInp.inputMode = 'decimal';
    shgcInp.className = 'field-input num';
    shgcInp.value = String(initShgc);

    // Two-way auto-sync SC <-> SHGC with factor 0.87
    scInp.addEventListener('input', () => {
      const v = parseDecimalInput(scInp.value);
      if (Number.isFinite(v) && v >= 0.05 && v <= 1.0) {
        shgcInp.value = String(Math.round(v * SC_TO_SHGC_RATIO * 1000) / 1000);
        scErr.textContent = '';
      } else {
        scErr.textContent = 'SC harus 0,05 – 1,00';
      }
    });
    shgcInp.addEventListener('input', () => {
      const v = parseDecimalInput(shgcInp.value);
      if (Number.isFinite(v) && v >= 0.04 && v <= 1.0) {
        scInp.value = String(Math.round((v / SC_TO_SHGC_RATIO) * 1000) / 1000);
        scErr.textContent = '';
      } else {
        scErr.textContent = 'SHGC harus 0,04 – 1,00';
      }
    });

    vltInp = document.createElement('input');
    vltInp.type = 'text';
    vltInp.inputMode = 'decimal';
    vltInp.className = 'field-input num';
    vltInp.value = String(draft.vlt ?? 0.5);
    vltInp.addEventListener('input', () => {
      const v = parseDecimalInput(vltInp.value);
      vltErr.textContent = Number.isFinite(v) && v >= 0 && v <= 1 ? '' : 'VLT harus 0 – 1,0';
    });

    configInp = document.createElement('input');
    configInp.type = 'text';
    configInp.className = 'field-input';
    configInp.placeholder = 'Mis. IGU 6 + 12 Udara + 6 mm';
    configInp.value = draft.configuration || '';

    grid.append(
      makeRow('SC (ISO 9050 · auto SHGC × 0,87) *', scInp, scErr),
      makeRow('SHGC (auto SC ÷ 0,87)', shgcInp),
      makeRow('VLT (0 – 1,0)', vltInp, vltErr),
      makeRow('Konfigurasi', configInp),
    );
  } else {
    alphaInp = document.createElement('input');
    alphaInp.type = 'text';
    alphaInp.inputMode = 'decimal';
    alphaInp.className = 'field-input num';
    alphaInp.value = String(draft.alpha ?? 0.5);
    alphaInp.addEventListener('input', () => {
      const v = parseDecimalInput(alphaInp.value);
      alphaErr.textContent = Number.isFinite(v) && v >= 0.05 && v <= 0.98 ? '' : 'α harus 0,05 – 0,98';
    });

    // SNI Tabel 1 & 2 finish/paint picker for α
    const alphaPresetSel = document.createElement('select');
    alphaPresetSel.className = 'field-select field-select-sm';
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = 'Pilih warna/finishing dari Tabel 1 & 2 SNI...';
    alphaPresetSel.appendChild(defOpt);
    for (const item of state.materials?.alpha_table_1 || []) {
      const o = document.createElement('option');
      o.value = String(item.alpha);
      o.textContent = `Tabel 1: ${item.material} (α = ${fmtId(item.alpha, 2)})`;
      alphaPresetSel.appendChild(o);
    }
    for (const item of state.materials?.alpha_table_2 || []) {
      const o = document.createElement('option');
      o.value = String(item.alpha);
      o.textContent = `Tabel 2 Cat: ${item.paint} (α = ${fmtId(item.alpha, 2)})`;
      alphaPresetSel.appendChild(o);
    }
    alphaPresetSel.addEventListener('change', () => {
      if (alphaPresetSel.value) {
        alphaInp.value = alphaPresetSel.value;
        alphaErr.textContent = '';
      }
    });

    massaInp = document.createElement('input');
    massaInp.type = 'text';
    massaInp.inputMode = 'decimal';
    massaInp.className = 'field-input num';
    massaInp.value = String(draft.massa_kg_m2 ?? (cat === 'roof' ? 240 : 150));

    tdekPreview = document.createElement('span');
    tdekPreview.className = 'lbl num';
    const updateTdek = () => {
      const mv = parseDecimalInput(massaInp.value);
      const td = lookupTdekLocal(cat, mv);
      tdekPreview.textContent = td != null ? `TD_ek otomatis (Tabel SNI): ${td} K` : 'Isi massa 1–2000 kg/m²';
    };
    updateTdek();
    massaInp.addEventListener('input', updateTdek);

    grid.append(
      makeRow('Absorbtansi α (0,05 – 0,98) *', alphaInp, alphaErr),
      makeRow('Pemilih warna/finishing SNI', alphaPresetSel),
      makeRow('Massa (kg/m²) *', massaInp, tdekPreview),
    );
  }

  const thickInp = document.createElement('input');
  thickInp.type = 'text';
  thickInp.inputMode = 'decimal';
  thickInp.className = 'field-input num';
  thickInp.value = String(draft.thickness_mm ?? (cat === 'glazing' ? 24 : 100));

  const colorInp = document.createElement('input');
  colorInp.type = 'color';
  colorInp.className = 'field-input';
  colorInp.style.height = '34px';
  colorInp.style.padding = '2px 4px';
  const defaultHex = resolveThemeTokenHex(cat === 'glazing' ? '--data-glazing' : '--data-wall');
  colorInp.value = isValidHexColor(draft.color_hex) ? draft.color_hex : defaultHex;

  const sumberInp = document.createElement('input');
  sumberInp.type = 'text';
  sumberInp.className = 'field-input';
  sumberInp.placeholder = 'URL datasheet atau keterangan (opsional)';
  sumberInp.value = draft.sumber || '';

  const priceInp = document.createElement('input');
  priceInp.type = 'number';
  priceInp.min = '0';
  priceInp.step = '50000';
  priceInp.className = 'field-input num';
  priceInp.placeholder = 'Opsional, hanya di browser';
  priceInp.value = draft.id && prices[draft.id] ? String(prices[draft.id]) : '';

  const noteInp = document.createElement('input');
  noteInp.type = 'text';
  noteInp.className = 'field-input';
  noteInp.placeholder = 'Catatan tambahan (opsional)';
  noteInp.value = draft.catatan || draft.description || '';

  grid.append(
    makeRow('Tebal (mm)', thickInp),
    makeRow('Warna swatch', colorInp),
    makeRow('Sumber (opsional)', sumberInp),
    makeRow('Harga lokal (Rp/m², opsional)', priceInp),
    makeRow('Catatan', noteInp),
  );

  uInp.addEventListener('input', () => {
    const v = parseDecimalInput(uInp.value);
    uErr.textContent = Number.isFinite(v) && v >= 0.05 && v <= 10 ? '' : 'U harus 0,05 – 10,0';
  });

  const formErr = document.createElement('div');
  formErr.className = 'mat-field-err';
  formErr.style.marginTop = '6px';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  actions.style.marginTop = '12px';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ghost ghost-sm';
  cancelBtn.textContent = 'Batal';
  cancelBtn.addEventListener('click', () => {
    ui.formMode = null;
    handlers.onRerender();
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'cta';
  saveBtn.style.height = '38px';
  saveBtn.style.padding = '0 18px';
  saveBtn.style.fontSize = '13px';
  saveBtn.textContent = kind === 'edit' ? 'Simpan perubahan' : 'Simpan material';

  actions.append(cancelBtn, saveBtn);
  form.append(grid, formErr, actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nm = nameInp.value.trim();
    const uVal = parseDecimalInput(uInp.value);
    if (!nm) {
      nameErr.textContent = 'Nama wajib diisi.';
      return;
    }
    if (!Number.isFinite(uVal) || uVal < 0.05 || uVal > 10) {
      uErr.textContent = 'Nilai U harus 0,05 – 10,0 W/m²K.';
      return;
    }

    const payload = {
      id: kind === 'edit' ? draft.id : undefined,
      name: nm,
      brand: brandInp.value.trim() || 'Buatan saya',
      category: cat,
      u_value: uVal,
      thickness_mm: parseDecimalInput(thickInp.value) || (cat === 'glazing' ? 24 : 100),
      color_hex: colorInp.value,
      sumber: sumberInp.value.trim(),
      catatan: noteInp.value.trim(),
    };

    if (cat === 'glazing') {
      const scV = parseDecimalInput(scInp.value);
      const shgcV = parseDecimalInput(shgcInp.value);
      const vltV = parseDecimalInput(vltInp.value);
      if (!Number.isFinite(scV) || scV < 0.05 || scV > 1.0) {
        scErr.textContent = 'SC harus 0,05 – 1,00.';
        return;
      }
      payload.sc = scV;
      payload.shgc = Number.isFinite(shgcV) ? shgcV : Math.round(scV * SC_TO_SHGC_RATIO * 1000) / 1000;
      payload.vlt = Number.isFinite(vltV) ? Math.max(0, Math.min(1, vltV)) : 0.5;
      payload.configuration = configInp.value.trim();
      payload.massa_kg_m2 = 20;
    } else {
      const aV = parseDecimalInput(alphaInp.value);
      const mV = parseDecimalInput(massaInp.value);
      if (!Number.isFinite(aV) || aV < 0.05 || aV > 0.98) {
        alphaErr.textContent = 'α harus 0,05 – 0,98.';
        return;
      }
      payload.alpha = aV;
      payload.massa_kg_m2 = Number.isFinite(mV) && mV >= 1 ? mV : 150;
    }

    saveBtn.disabled = true;
    try {
      const saved = await handlers.onValidateAndSaveUserMaterial(payload, Number(priceInp.value) || 0);
      ui.formMode = null;
      if (saved?.id) ui.selectedDetailId = saved.id;
      handlers.onRerender();
    } catch (err) {
      formErr.textContent = err.message || 'Gagal memvalidasi material.';
      saveBtn.disabled = false;
    }
  });

  return form;
}

function renderRecommendTab(state, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'mat-rec-wrap';

  if (!state.analysisData) {
    const empty = document.createElement('div');
    empty.className = 'glass-thin';
    empty.style.padding = '20px';
    empty.style.borderRadius = '14px';
    empty.innerHTML = '<b>Hitung OTTV terlebih dahulu</b><p class="muted" style="margin:6px 0 0;font-size:13px;">Rekomendasi material menggunakan data luas, WWR, dan SF tiap bidang dari analisis terakhirmu.</p>';
    wrap.appendChild(empty);
    return wrap;
  }

  const aid = state.analysisData.analysis_id;
  if (ui.lastAnalysisId !== aid) {
    ui.lastAnalysisId = aid;
    ui.recTargetResult = null;
    ui.optResult = null;
  }

  const prices = loadUserPrices();
  const hasAnyPrices = Object.keys(prices).length > 0;
  const activeOrients = (state.analysisData.orientation_breakdown || []).filter((o) => Number(o.total_area_m2 || 0) > 0.1);
  const allBrands = state.materials?.brands || [];

  // Disclaimer banner (mandatory per Fase 4e)
  const disc = document.createElement('p');
  disc.className = 'lbl mat-rec-disclaimer';
  disc.textContent = 'Angka brand dari datasheet produsen dan bisa berubah. Konfirmasi ke distributor sebelum spesifikasi.';
  wrap.appendChild(disc);

  // ==================== SECTION A: PER GRUP ====================
  const secA = document.createElement('section');
  secA.className = 'glass-thin mat-rec-section';

  const hA = document.createElement('h3');
  hA.style.margin = '0 0 8px';
  hA.style.fontSize = '14px';
  hA.textContent = 'Peringkat kandidat per target';
  secA.appendChild(hA);

  const controlsA = document.createElement('div');
  controlsA.className = 'mat-rec-controls';

  // Target selector
  const targetSel = document.createElement('select');
  targetSel.className = 'field-select field-select-sm';
  targetSel.setAttribute('aria-label', 'Target material');
  const targetOpts = [
    ['glazing_all|', 'Kaca (semua orientasi)'],
    ...activeOrients.map((o) => [`glazing_orientation|${o.code}`, `Kaca Fasad ${o.code} (${fmtId(o.ottv_orientation_wm2, 2)} W/m²)`]),
    ['wall_all|', 'Dinding & spandrel (semua orientasi)'],
  ];
  const curTargetComposite = `${ui.recTargetType}|${ui.recTargetKey || ''}`;
  for (const [val, lbl] of targetOpts) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = lbl;
    if (val === curTargetComposite) o.selected = true;
    targetSel.appendChild(o);
  }
  targetSel.addEventListener('change', () => {
    const [tType, tKey] = targetSel.value.split('|');
    ui.recTargetType = tType;
    ui.recTargetKey = tKey || null;
    triggerTargetFetch();
  });

  // Min VLT filter
  const vltSel = document.createElement('select');
  vltSel.className = 'field-select field-select-sm';
  vltSel.setAttribute('aria-label', 'VLT minimum');
  for (const [v, lbl] of [[0, 'VLT: semua'], [0.25, 'VLT ≥ 25%'], [0.40, 'VLT ≥ 40%'], [0.50, 'VLT ≥ 50%'], [0.60, 'VLT ≥ 60%']]) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = lbl;
    if (Math.abs(ui.recMinVlt - v) < 0.01) o.selected = true;
    vltSel.appendChild(o);
  }
  vltSel.addEventListener('change', () => {
    ui.recMinVlt = Number(vltSel.value) || 0;
    triggerTargetFetch();
  });

  // Brand filter
  const brandSel = document.createElement('select');
  brandSel.className = 'field-select field-select-sm';
  brandSel.setAttribute('aria-label', 'Filter brand');
  const bAll = document.createElement('option');
  bAll.value = 'all';
  bAll.textContent = 'Semua brand';
  brandSel.appendChild(bAll);
  for (const b of allBrands) {
    const o = document.createElement('option');
    o.value = b;
    o.textContent = b;
    if (ui.recBrand === b) o.selected = true;
    brandSel.appendChild(o);
  }
  brandSel.addEventListener('change', () => {
    ui.recBrand = brandSel.value;
    triggerTargetFetch();
  });

  // Single vs IGU
  const typeSel = document.createElement('select');
  typeSel.className = 'field-select field-select-sm';
  typeSel.setAttribute('aria-label', 'Jenis kaca tunggal atau IGU');
  for (const [v, lbl] of [['all', 'Tunggal & IGU'], ['single', 'Kaca tunggal'], ['igu', 'Kaca ganda (IGU)']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = lbl;
    if (ui.recGlazingType === v) o.selected = true;
    typeSel.appendChild(o);
  }
  typeSel.addEventListener('change', () => {
    ui.recGlazingType = typeSel.value;
    triggerTargetFetch();
  });

  controlsA.append(targetSel, vltSel, brandSel, typeSel);
  secA.appendChild(controlsA);

  const triggerTargetFetch = async () => {
    ui.recLoading = true;
    handlers.onRerender();
    try {
      const res = await handlers.onFetchRecommendTarget({
        target_type: ui.recTargetType,
        target_key: ui.recTargetKey,
        filters: {
          min_vlt: ui.recMinVlt > 0 ? ui.recMinVlt : null,
          brand: ui.recBrand,
          glazing_type: ui.recGlazingType,
        },
      });
      ui.recTargetResult = res;
    } finally {
      ui.recLoading = false;
      handlers.onRerender();
    }
  };

  if (!ui.recTargetResult && !ui.recLoading) {
    window.requestAnimationFrame(() => triggerTargetFetch());
  }

  if (ui.recLoading) {
    const ld = document.createElement('p');
    ld.className = 'muted';
    ld.style.fontSize = '12.5px';
    ld.textContent = 'Menghitung peringkat kandidat dari katalog...';
    secA.appendChild(ld);
  } else if (ui.recTargetResult) {
    const enriched = enrichCandidatesWithLocalPrices(
      ui.recTargetResult.candidates || [],
      ui.recTargetResult.target_area_m2,
      prices,
    );
    const tblWrap = document.createElement('div');
    tblWrap.className = 'mat-rec-table-wrap';
    const tbl = document.createElement('table');
    tbl.className = 'data-table';
    tbl.innerHTML = `<thead><tr><th>Material</th><th class="num">OTTV baru</th><th class="num">ΔOTTV</th><th class="num">VLT</th>${hasAnyPrices ? '<th class="num">Δ/Rp jt</th>' : ''}<th>Aksi</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    tbody.className = 'num';

    for (const row of enriched.slice(0, 25)) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.style.fontWeight = '600';
      const nDiv = document.createElement('div');
      nDiv.textContent = row.name;
      const bDiv = document.createElement('div');
      bDiv.className = 'lbl';
      bDiv.textContent = `${row.brand}${row.configuration ? ` · ${row.configuration}` : ''}`;
      tdName.append(nDiv, bDiv);

      const tdOttv = document.createElement('td');
      tdOttv.className = row.compliant_sni ? 'st-ok' : 'st-fail';
      tdOttv.style.fontWeight = '700';
      tdOttv.textContent = fmtId(row.new_ottv_wm2, 2);

      const tdDelta = document.createElement('td');
      tdDelta.className = row.delta_ottv_wm2 <= 0 ? 'st-ok' : 'st-fail';
      const sign = row.delta_ottv_wm2 > 0 ? '+' : '−';
      tdDelta.textContent =
        Math.abs(row.delta_ottv_wm2) < 0.005 ? 'tidak berubah' : `${sign}${fmtId(Math.abs(row.delta_ottv_wm2), 2)}`;

      const tdVlt = document.createElement('td');
      tdVlt.textContent = row.vlt != null ? `${Math.round(row.vlt * 100)}%` : '-';

      tr.append(tdName, tdOttv, tdDelta, tdVlt);
      if (hasAnyPrices) {
        const tdCost = document.createElement('td');
        tdCost.textContent = row.delta_ottv_per_million_rp != null ? fmtId(row.delta_ottv_per_million_rp, 2) : '-';
        tr.appendChild(tdCost);
      }

      const tdAct = document.createElement('td');
      tdAct.style.whiteSpace = 'nowrap';
      const patch =
        ui.recTargetType === 'glazing_orientation' && ui.recTargetKey
          ? { orientation_material_overrides: { ...(state.config?.settings?.orientation_material_overrides || {}), [ui.recTargetKey]: row.material_id } }
          : ui.recTargetType === 'wall_all'
          ? { wall_material_id: row.material_id }
          : { glazing_material_id: row.material_id };

      const altBtn = document.createElement('button');
      altBtn.type = 'button';
      altBtn.className = 'ghost ghost-sm';
      altBtn.style.height = '28px';
      altBtn.style.marginRight = '4px';
      altBtn.textContent = 'Alternatif';
      altBtn.title = 'Jadikan alternatif di Bandingkan';
      altBtn.addEventListener('click', () => handlers.onPromoteRecommendToCompare(row.name, patch));

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'cta';
      applyBtn.style.height = '28px';
      applyBtn.style.padding = '0 10px';
      applyBtn.style.fontSize = '11.5px';
      applyBtn.textContent = 'Terapkan';
      applyBtn.addEventListener('click', () => handlers.onApplyRecommendPatch(row.name, patch));

      tdAct.append(altBtn, applyBtn);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    tblWrap.appendChild(tbl);
    secA.appendChild(tblWrap);
  }
  wrap.appendChild(secA);

  // ==================== SECTION B: CARI KOMBINASI OPTIMAL ====================
  const secB = document.createElement('section');
  secB.className = 'glass-thin mat-rec-section';

  const hB = document.createElement('h3');
  hB.style.margin = '0 0 8px';
  hB.style.fontSize = '14px';
  hB.textContent = 'Cari kombinasi optimal';
  secB.appendChild(hB);

  const controlsB = document.createElement('div');
  controlsB.className = 'mat-rec-controls';

  const tgtInp = document.createElement('input');
  tgtInp.type = 'number';
  tgtInp.min = '10';
  tgtInp.max = '80';
  tgtInp.step = '1';
  tgtInp.className = 'field-input num';
  tgtInp.style.height = '34px';
  tgtInp.style.width = '110px';
  tgtInp.value = String(ui.optTargetOttv);
  tgtInp.setAttribute('aria-label', 'Target OTTV (W/m²)');
  tgtInp.title = 'Target OTTV maksimum (W/m²)';
  tgtInp.addEventListener('change', () => {
    ui.optTargetOttv = Math.max(10, Math.min(80, Number(tgtInp.value) || 35));
  });

  const optVltSel = document.createElement('select');
  optVltSel.className = 'field-select field-select-sm';
  for (const [v, lbl] of [[0, 'VLT min: bebas'], [0.30, 'VLT ≥ 30%'], [0.45, 'VLT ≥ 45%'], [0.55, 'VLT ≥ 55%']]) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = lbl;
    if (Math.abs(ui.optMinVlt - v) < 0.01) o.selected = true;
    optVltSel.appendChild(o);
  }
  optVltSel.addEventListener('change', () => {
    ui.optMinVlt = Number(optVltSel.value) || 0;
  });

  const uniLbl = document.createElement('label');
  uniLbl.className = 'legend-smooth-lbl';
  const uniCb = document.createElement('input');
  uniCb.type = 'checkbox';
  uniCb.checked = ui.optUniform;
  uniCb.addEventListener('change', () => {
    ui.optUniform = uniCb.checked;
  });
  uniLbl.append(uniCb, document.createTextNode(' Satu jenis kaca semua arah'));

  const runOptBtn = document.createElement('button');
  runOptBtn.type = 'button';
  runOptBtn.className = 'cta';
  runOptBtn.style.height = '34px';
  runOptBtn.style.padding = '0 14px';
  runOptBtn.style.fontSize = '12.5px';
  runOptBtn.disabled = ui.optLoading;
  runOptBtn.textContent = ui.optLoading ? 'Mencari...' : 'Cari kombinasi optimal';
  runOptBtn.addEventListener('click', async () => {
    ui.optLoading = true;
    handlers.onRerender();
    try {
      const res = await handlers.onFetchRecommendOptimize({
        target_ottv_wm2: ui.optTargetOttv,
        constraints: {
          min_vlt: ui.optMinVlt > 0 ? ui.optMinVlt : null,
          single_glazing_all_orientations: ui.optUniform,
          brand: ui.optBrand !== 'all' ? ui.optBrand : null,
        },
      });
      // Compute local "Biaya terendah" client-side if user filled prices (prices never sent to server!)
      const opts = [...(res?.options || [])];
      if (hasAnyPrices && ui.recTargetResult?.candidates) {
        const totalGlzArea = activeOrients.reduce((s, o) => s + Number(o.glazing_area_m2 || 0), 0);
        const localCostOpt = computeLocalLowestCostOption(
          ui.recTargetResult.candidates,
          Number(state.analysisData.ottv_total_wm2 || 0),
          ui.optTargetOttv,
          totalGlzArea,
          prices,
          state.config?.settings?.glazing_material_id,
        );
        if (localCostOpt && !opts.some((o) => o.option_id === 'lowest_cost')) {
          opts.push(localCostOpt);
        }
      }
      ui.optResult = { ...res, options: opts };
    } finally {
      ui.optLoading = false;
      handlers.onRerender();
    }
  });

  controlsB.append(tgtInp, optVltSel, uniLbl, runOptBtn);
  secB.appendChild(controlsB);

  if (ui.optResult) {
    const cardsRow = document.createElement('div');
    cardsRow.className = 'mat-opt-grid';
    for (const opt of ui.optResult.options || []) {
      const c = document.createElement('div');
      c.className = 'glass mat-opt-card';
      const title = document.createElement('div');
      title.style.fontWeight = '700';
      title.style.fontSize = '13.5px';
      title.textContent = opt.title;

      const sub = document.createElement('div');
      sub.className = 'lbl';
      sub.style.fontWeight = '500';
      sub.textContent = opt.subtitle;

      const metric = document.createElement('div');
      metric.className = `num ${opt.meets_target ? 'st-ok' : 'st-fail'}`;
      metric.style.fontSize = '20px';
      metric.style.fontWeight = '700';
      metric.style.margin = '6px 0';
      const sign = opt.delta_ottv_wm2 > 0 ? '+' : '−';
      metric.textContent =
        Math.abs(opt.delta_ottv_wm2) < 0.005
          ? `${fmtId(opt.new_ottv_wm2, 2)} W/m²`
          : `${fmtId(opt.new_ottv_wm2, 2)} W/m² (${sign}${fmtId(Math.abs(opt.delta_ottv_wm2), 2)})`;

      const chList = document.createElement('ul');
      chList.className = 'mat-opt-changes';
      for (const ch of opt.changes || []) {
        const li = document.createElement('li');
        li.textContent = `${ch.scope}: ${ch.material_name}`;
        chList.appendChild(li);
      }

      if (opt.estimated_cost_rp != null) {
        const costP = document.createElement('div');
        costP.className = 'lbl num';
        costP.textContent = `Estimasi biaya lokal: Rp ${Math.round(opt.estimated_cost_rp).toLocaleString('id-ID')}`;
        c.appendChild(costP);
      }

      const actRow = document.createElement('div');
      actRow.style.display = 'flex';
      actRow.style.gap = '6px';
      actRow.style.marginTop = '8px';

      const altB = document.createElement('button');
      altB.type = 'button';
      altB.className = 'ghost ghost-sm';
      altB.style.flex = '1';
      altB.textContent = 'Jadikan alternatif';
      altB.addEventListener('click', () => handlers.onPromoteRecommendToCompare(opt.title, opt.apply_patch));

      const appB = document.createElement('button');
      appB.type = 'button';
      appB.className = 'cta';
      appB.style.flex = '1';
      appB.style.height = '32px';
      appB.style.fontSize = '12px';
      appB.textContent = 'Terapkan';
      appB.addEventListener('click', () => handlers.onApplyRecommendPatch(opt.title, opt.apply_patch));

      actRow.append(altB, appB);
      // Review 4e: an option with no changes (design already meets the target) has nothing to apply.
      const hasChanges = Number(opt.changed_count ?? (opt.changes || []).length) > 0;
      if (hasChanges) c.append(title, sub, metric, chList, actRow);
      else c.append(title, sub, metric);
      cardsRow.appendChild(c);
    }
    secB.appendChild(cardsRow);
  }

  wrap.appendChild(secB);
  return wrap;
}

export function renderMaterialCatalogOverlay(state, handlers) {
  const catState = state.materialCatalog;
  if (!catState?.open) return null;

  const mode = catState.mode || 'browse'; // 'browse' | 'pick'
  const tab = catState.tab || 'catalog'; // 'catalog' | 'recommend'
  const lockedCategory = mode === 'pick' ? catState.lockedCategory || 'glazing' : null;
  const effCategory = lockedCategory || ui.category;

  const allMaterials = state.materials?.materials || [];
  const activeOnTarget = getActiveMaterialIdForTarget(state, state.config);

  const backdrop = document.createElement('div');
  backdrop.className = 'mat-catalog-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) handlers.onClose();
  });

  const overlay = document.createElement('section');
  overlay.className = 'glass mat-catalog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'mat-cat-title');

  // Header
  const head = document.createElement('div');
  head.className = 'mat-catalog-head';

  const titleGroup = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.id = 'mat-cat-title';
  h2.style.margin = '0';
  h2.style.fontSize = '18px';
  h2.textContent =
    mode === 'pick' && catState.targetLabel
      ? catState.targetLabel
      : 'Katalog Material & Rekomendasi';

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'seg';
  tabsWrap.style.marginTop = '6px';
  tabsWrap.style.maxWidth = '320px';
  tabsWrap.setAttribute('role', 'tablist');

  for (const [tid, tlbl] of [
    ['catalog', `Katalog (${allMaterials.length})`],
    ['recommend', 'Rekomendasi'],
  ]) {
    const tb = document.createElement('button');
    tb.type = 'button';
    tb.setAttribute('role', 'tab');
    tb.setAttribute('aria-selected', tab === tid ? 'true' : 'false');
    if (tab === tid) tb.classList.add('on');
    tb.textContent = tlbl;
    tb.addEventListener('click', () => handlers.onSwitchTab(tid));
    tabsWrap.appendChild(tb);
  }
  titleGroup.append(h2, tabsWrap);

  const headActions = document.createElement('div');
  headActions.style.display = 'flex';
  headActions.style.gap = '6px';
  headActions.style.alignItems = 'center';
  headActions.style.flexWrap = 'wrap';

  const addNewBtn = document.createElement('button');
  addNewBtn.type = 'button';
  addNewBtn.className = 'cta';
  addNewBtn.style.height = '36px';
  addNewBtn.style.padding = '0 14px';
  addNewBtn.style.fontSize = '12.5px';
  addNewBtn.innerHTML = `${icon('plus', 14)}<span>Material baru</span>`;
  addNewBtn.addEventListener('click', () => {
    ui.formMode = {
      kind: 'create',
      draft: {
        category: effCategory,
        brand: 'Buatan saya',
        u_value: effCategory === 'glazing' ? 1.8 : 1.2,
        sc: effCategory === 'glazing' ? 0.35 : null,
        vlt: effCategory === 'glazing' ? 0.50 : null,
        alpha: effCategory !== 'glazing' ? 0.50 : null,
        massa_kg_m2: effCategory === 'roof' ? 240 : 150,
      },
    };
    handlers.onSwitchTab('catalog');
  });

  const expBtn = document.createElement('button');
  expBtn.type = 'button';
  expBtn.className = 'ghost ghost-sm';
  expBtn.style.height = '36px';
  expBtn.textContent = 'Ekspor JSON';
  expBtn.title = 'Ekspor semua material buatan saya ke JSON';
  expBtn.addEventListener('click', () => {
    const n = exportUserMaterialsJson();
    handlers.onToast?.(`Diekspor ${n} material kustom ke JSON.`, 'ok');
  });

  const impInput = document.createElement('input');
  impInput.type = 'file';
  impInput.accept = '.json';
  impInput.style.display = 'none';
  impInput.addEventListener('change', async () => {
    const file = impInput.files?.[0];
    if (!file) return;
    try {
      const n = await importUserMaterialsJson(file);
      handlers.onUserMaterialsChanged?.(`Diimpor ${n} material kustom dari JSON.`);
    } catch (err) {
      handlers.onToast?.(err.message || 'Gagal mengimpor JSON material.', 'fail');
    }
    impInput.value = '';
  });

  const impBtn = document.createElement('button');
  impBtn.type = 'button';
  impBtn.className = 'ghost ghost-sm';
  impBtn.style.height = '36px';
  impBtn.textContent = 'Impor JSON';
  impBtn.addEventListener('click', () => impInput.click());

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tbtn';
  closeBtn.style.height = '36px';
  closeBtn.setAttribute('aria-label', 'Tutup katalog material (Esc)');
  closeBtn.innerHTML = `${icon('close', 15)}<kbd>Esc</kbd>`;
  closeBtn.addEventListener('click', () => {
    ui.formMode = null;
    handlers.onClose();
  });

  headActions.append(addNewBtn, expBtn, impBtn, impInput, closeBtn);
  head.append(titleGroup, headActions);
  overlay.appendChild(head);

  // Body
  const body = document.createElement('div');
  body.className = 'mat-catalog-body';

  if (tab === 'recommend') {
    body.appendChild(renderRecommendTab(state, handlers));
  } else {
    // Quick role-target strip in browse mode so user can jump straight to Mode Pilih for any role
    if (mode === 'browse') {
      const roleBar = document.createElement('div');
      roleBar.className = 'mat-role-strip';
      const byId = new Map(allMaterials.map((m) => [m.id, m]));
      const roleItems = [
        ['glazing', 'glazing_material_id', 'Kaca utama'],
        ['wall', 'wall_material_id', 'Dinding utama'],
        ['roof', 'roof_material_id', 'Atap utama'],
        ['frame', 'frame_material_id', 'Rangka utama'],
      ];
      for (const [rcat, field, lbl] of roleItems) {
        const curMat = byId.get(state.config?.settings?.[field]);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'glass-thin mat-role-chip';
        const l1 = document.createElement('span');
        l1.className = 'lbl';
        l1.textContent = `${lbl} · Ganti`;
        const l2 = document.createElement('strong');
        l2.textContent = curMat?.name || 'Pilih material';
        btn.append(l1, l2);
        btn.addEventListener('click', () =>
          handlers.onOpenPickMode({
            lockedCategory: rcat,
            targetField: field,
            targetOrientCode: null,
            targetLabel: `Pilih ${lbl.toLowerCase()}`,
          }),
        );
        roleBar.appendChild(btn);
      }
      body.appendChild(roleBar);
    }

    // Toolbar: search + category chips + brand filter + dual sliders (SC/U/VLT) + sort
    const toolbar = document.createElement('div');
    toolbar.className = 'mat-toolbar';

    const row1 = document.createElement('div');
    row1.className = 'mat-toolbar-row';

    let renderGridNow = () => {};

    const searchInp = document.createElement('input');
    searchInp.type = 'search';
    searchInp.className = 'field-input mat-search-inp';
    searchInp.placeholder = 'Cari nama kaca, seri, atau brand (mis. Stopray, SunGuard, COOL-LITE)...';
    searchInp.setAttribute('aria-label', 'Cari material di katalog');
    searchInp.value = ui.search;
    searchInp.addEventListener('input', () => {
      ui.search = searchInp.value;
      renderGridNow();
    });

    const catGroup = document.createElement('div');
    catGroup.className = 'seg';
    catGroup.setAttribute('role', 'radiogroup');
    catGroup.setAttribute('aria-label', 'Kategori material');
    for (const [cid, clbl] of CATEGORY_TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      const isOn = effCategory === cid;
      b.setAttribute('aria-checked', isOn ? 'true' : 'false');
      if (isOn) b.classList.add('on');
      b.disabled = Boolean(lockedCategory && lockedCategory !== cid);
      b.textContent = clbl;
      b.addEventListener('click', () => {
        ui.category = cid;
        ui.brand = 'all';
        handlers.onRerender();
      });
      catGroup.appendChild(b);
    }

    const brandsInCat = [...new Set(allMaterials.filter((m) => m.category === effCategory).map((m) => m.brand).filter(Boolean))].sort();
    const brandSel = document.createElement('select');
    brandSel.className = 'field-select field-select-sm';
    brandSel.style.maxWidth = '190px';
    brandSel.setAttribute('aria-label', 'Filter brand');
    const optAllB = document.createElement('option');
    optAllB.value = 'all';
    optAllB.textContent = 'Semua brand';
    brandSel.appendChild(optAllB);
    for (const b of brandsInCat) {
      const o = document.createElement('option');
      o.value = b;
      o.textContent = b;
      if (ui.brand === b) o.selected = true;
      brandSel.appendChild(o);
    }
    brandSel.addEventListener('change', () => {
      ui.brand = brandSel.value;
      handlers.onRerender();
    });

    const sortSel = document.createElement('select');
    sortSel.className = 'field-select field-select-sm';
    sortSel.style.maxWidth = '165px';
    sortSel.setAttribute('aria-label', 'Urutkan material');
    for (const [sv, sl] of [
      ['sc_asc', effCategory === 'glazing' ? 'SC terendah' : 'α terendah'],
      ['u_asc', 'U-value terendah'],
      ...(effCategory === 'glazing' ? [['vlt_desc', 'VLT tertinggi']] : []),
      ['name_asc', 'Nama A–Z'],
    ]) {
      const o = document.createElement('option');
      o.value = sv;
      o.textContent = sl;
      if (ui.sort === sv) o.selected = true;
      sortSel.appendChild(o);
    }
    sortSel.addEventListener('change', () => {
      ui.sort = sortSel.value;
      handlers.onRerender();
    });

    row1.append(searchInp, catGroup, brandSel, sortSel);
    toolbar.appendChild(row1);

    // Dual range filter row (SC, U, VLT)
    const row2 = document.createElement('div');
    row2.className = 'mat-sliders-row num';

    const makeDualRange = (label, min, max, step, curMin, curMax, onChange, fmtFn) => {
      const box = document.createElement('div');
      box.className = 'mat-dual-box';
      const top = document.createElement('div');
      top.className = 'lbl';
      top.textContent = `${label}: ${fmtFn(curMin)} – ${fmtFn(curMax)}`;
      const pair = document.createElement('div');
      pair.style.display = 'flex';
      pair.style.gap = '4px';
      const r1 = document.createElement('input');
      r1.type = 'range';
      r1.min = String(min);
      r1.max = String(max);
      r1.step = String(step);
      r1.value = String(curMin);
      r1.setAttribute('aria-label', `${label} minimum`);
      const r2 = document.createElement('input');
      r2.type = 'range';
      r2.min = String(min);
      r2.max = String(max);
      r2.step = String(step);
      r2.value = String(curMax);
      r2.setAttribute('aria-label', `${label} maksimum`);
      r1.addEventListener('input', () => {
        const nextMin = Math.min(Number(r1.value), Number(r2.value));
        r1.value = String(nextMin);
        top.textContent = `${label}: ${fmtFn(nextMin)} – ${fmtFn(Number(r2.value))}`;
        onChange(nextMin, Number(r2.value));
      });
      r2.addEventListener('input', () => {
        const nextMax = Math.max(Number(r2.value), Number(r1.value));
        r2.value = String(nextMax);
        top.textContent = `${label}: ${fmtFn(Number(r1.value))} – ${fmtFn(nextMax)}`;
        onChange(Number(r1.value), nextMax);
      });
      pair.append(r1, r2);
      box.append(top, pair);
      return box;
    };

    if (effCategory === 'glazing') {
      row2.append(
        makeDualRange('SC', 0.05, 1.0, 0.05, ui.scMin, ui.scMax, (a, b) => { ui.scMin = a; ui.scMax = b; renderGridNow(); }, (v) => fmtId(v, 2)),
        makeDualRange('U', 0.5, 7.0, 0.2, ui.uMin, ui.uMax, (a, b) => { ui.uMin = a; ui.uMax = b; renderGridNow(); }, (v) => fmtId(v, 1)),
        makeDualRange('VLT', 0, 1.0, 0.05, ui.vltMin, ui.vltMax, (a, b) => { ui.vltMin = a; ui.vltMax = b; renderGridNow(); }, (v) => `${Math.round(v * 100)}%`),
      );
    } else {
      row2.append(
        makeDualRange('U-value', 0.1, 7.0, 0.2, ui.uMin, ui.uMax, (a, b) => { ui.uMin = a; ui.uMax = b; renderGridNow(); }, (v) => fmtId(v, 1)),
      );
    }
    toolbar.appendChild(row2);
    body.appendChild(toolbar);

    // Split area: Left = 168px square card grid, Right = Detail Panel or Material Form
    const detailMat = ui.selectedDetailId ? allMaterials.find((m) => m.id === ui.selectedDetailId) : null;
    const hasSide = Boolean(ui.formMode || detailMat);

    const contentSplit = document.createElement('div');
    contentSplit.className = `mat-catalog-split${hasSide ? ' has-side' : ''}`;

    const gridWrap = document.createElement('div');
    gridWrap.className = 'mat-grid-scroll';

    renderGridNow = () => {
      gridWrap.innerHTML = '';
      const filtered = filterAndSortMaterials(allMaterials, lockedCategory);
      if (filtered.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.style.padding = '16px';
        empty.textContent = 'Tidak ada material yang cocok dengan filter aktif.';
        gridWrap.appendChild(empty);
      } else {
        const grid = document.createElement('div');
        grid.className = 'mat-cards-grid';
        for (const m of filtered) {
          const cardEl = buildSquareMaterialCard(m, {
            isActiveOnTarget: Boolean(activeOnTarget && activeOnTarget === m.id),
            mode,
            onCardClick: (clicked) => {
              if (mode === 'pick') {
                if (catState.targetOrientCode) {
                  handlers.onApplyMaterialToOrientation(catState.targetOrientCode, clicked);
                } else {
                  const field = catState.targetField || ROLE_FIELD_BY_CAT[clicked.category] || 'glazing_material_id';
                  handlers.onApplyMaterialToRole(field, clicked);
                }
                handlers.onClose();
              } else {
                ui.formMode = null;
                ui.selectedDetailId = clicked.id;
                handlers.onRerender();
              }
            },
            onInfoClick: (clicked) => {
              ui.formMode = null;
              ui.selectedDetailId = clicked.id;
              handlers.onRerender();
            },
          });
          grid.appendChild(cardEl);
        }
        gridWrap.appendChild(grid);
      }
    };
    renderGridNow();

    contentSplit.appendChild(gridWrap);

    if (ui.formMode) {
      contentSplit.appendChild(renderMaterialForm(state, handlers));
    } else if (detailMat) {
      contentSplit.appendChild(renderDetailDrawer(detailMat, state, handlers));
    }

    body.appendChild(contentSplit);

    // Bottom disclaimer
    const foot = document.createElement('p');
    foot.className = 'lbl';
    foot.style.margin = '4px 0 0';
    foot.style.fontWeight = '500';
    foot.textContent = 'Angka brand dari datasheet produsen dan bisa berubah. Konfirmasi ke distributor sebelum spesifikasi.';
    body.appendChild(foot);
  }

  overlay.appendChild(body);
  backdrop.appendChild(overlay);
  return backdrop;
}
