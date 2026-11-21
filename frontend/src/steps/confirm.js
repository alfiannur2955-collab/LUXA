/**
 * Screen 2: Konfirmasi (`docs/FASE4_UI_SPEC.md` §3.2 + mockup 2-konfirmasi.html).
 * Floating tier-1 glass card over the 3D viewer.
 * Main CTA stays disabled with a descriptive label until every confirmation row is green.
 */

import { evaluateConfirmGate } from '../state.js';
import { fmtId } from '../ui/escapeHtml.js';
import { compassDialSvg, icon } from '../ui/icons.js';
import { viewer } from '../viewer/viewer.js';

const UNIT_LABELS = {
  m: 'Meter',
  cm: 'Sentimeter',
  mm: 'Milimeter',
  ft: 'Feet',
  in: 'Inci',
};

const SCOPE_OPTIONS = [
  { value: 'facade_only', label: 'Fasad saja' },
  { value: 'full_building', label: 'Gedung lengkap' },
  { value: 'building_site', label: 'Gedung dan tapak' },
];

// Track which rows currently have their inline "Ubah" editor open
const openEditors = new Set();

function makeStatusIcon(isOk) {
  const span = document.createElement('span');
  span.className = `confirm-row-icon ${isOk ? 'st-ok' : 'st-warn'}`;
  span.innerHTML = icon(isOk ? 'check' : 'warn', 19);
  return span;
}

function makeConfirmRow({ id, ok, label, value, sub, onToggleEdit, editorEl, alwaysShowExtraEl }) {
  const row = document.createElement('div');
  row.className = 'confirm-row';

  const body = document.createElement('div');
  const lblEl = document.createElement('div');
  lblEl.className = 'lbl';
  lblEl.textContent = label;

  const valEl = document.createElement('div');
  valEl.className = 'num';
  valEl.style.fontWeight = '600';
  valEl.textContent = value;

  body.append(lblEl, valEl);

  if (sub) {
    const subEl = document.createElement('div');
    subEl.className = 'lbl';
    subEl.style.fontWeight = '500';
    subEl.textContent = sub;
    body.appendChild(subEl);
  }

  if (alwaysShowExtraEl) {
    body.appendChild(alwaysShowExtraEl);
  }

  if (editorEl && openEditors.has(id)) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '8px';
    wrap.style.display = 'grid';
    wrap.style.gap = '6px';
    wrap.appendChild(editorEl);
    body.appendChild(wrap);
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'ghost ghost-sm';
  editBtn.textContent = openEditors.has(id) ? 'Selesai' : 'Ubah';
  editBtn.addEventListener('click', () => {
    if (openEditors.has(id)) {
      openEditors.delete(id);
    } else {
      openEditors.add(id);
    }
    onToggleEdit();
  });

  row.append(makeStatusIcon(ok), body, editBtn);
  return row;
}

export function renderConfirmScreen(state, handlers) {
  const main = document.createElement('main');
  main.className = 'main main-confirm';

  const viewerSec = document.createElement('section');
  viewerSec.className = 'viewer';
  viewerSec.setAttribute('aria-label', 'Viewer 3D');

  const canvasHost = document.createElement('div');
  canvasHost.className = 'viewer-canvas-host';
  viewerSec.appendChild(canvasHost);

  // Left compass
  const compass = document.createElement('div');
  compass.className = 'glass compass compass-left';
  const northDeg = Number(state.config?.settings?.north_angle_deg || 0);
  compass.setAttribute('role', 'img');
  compass.setAttribute('aria-label', `Kompas arah utara, ${northDeg} derajat`);
  compass.innerHTML = compassDialSvg(northDeg);
  viewerSec.appendChild(compass);

  // Bottom-left legend
  const legend = document.createElement('div');
  legend.className = 'legend';
  const zCut = Number(state.config?.model?.z_ground_cutoff_m || 0);
  legend.innerHTML = `
    <span class="legend-item"><i class="swatch" style="background:var(--data-glazing);"></i>Kaca</span>
    <span class="legend-item"><i class="swatch" style="background:var(--data-wall);"></i>Dinding</span>
    <span class="legend-item"><i class="swatch" style="background:none;border:1.5px dashed var(--ink-muted);"></i>Muka tanah z = ${fmtId(zCut, 1)} m</span>
  `;
  viewerSec.appendChild(legend);

  // Floating glass confirmation card
  const ins = state.inspectData || {};
  const audit = ins.stage1_audit || {};
  const sig = ins.file_signature || state.fileSignature || {};
  const bbox = ins.bounding_box || { span: audit.normalized_span_m || [0, 0, 0] };
  const gate = evaluateConfirmGate(state);

  const card = document.createElement('section');
  card.className = 'glass confirm-card';
  card.setAttribute('aria-labelledby', 'kk-title');

  // Card header
  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'start';
  head.style.gap = '12px';

  const headText = document.createElement('div');
  const fileMeta = document.createElement('p');
  fileMeta.className = 'lbl';
  fileMeta.style.margin = '0';
  const swLabel = sig.detected_software_label || 'Model 3D';
  fileMeta.textContent = `${state.filename || ins.filename || 'Model'} · ${swLabel}`;

  const h1 = document.createElement('h1');
  h1.id = 'kk-title';
  h1.style.margin = '2px 0 0';
  h1.style.fontSize = '21px';
  h1.style.lineHeight = '27px';
  h1.style.fontWeight = '700';
  h1.textContent = 'Benar begini model kamu?';

  headText.append(fileMeta, h1);

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'tbtn';
  backBtn.style.height = '36px';
  backBtn.style.minWidth = '36px';
  backBtn.style.padding = '0';
  backBtn.setAttribute('aria-label', 'Kembali ke Unggah');
  backBtn.title = 'Kembali ke Unggah';
  backBtn.innerHTML = icon('close', 16);
  backBtn.addEventListener('click', () => handlers.onBackToUpload());

  head.append(headText, backBtn);

  const lead = document.createElement('p');
  lead.className = 'muted';
  lead.style.margin = '6px 0 4px';
  lead.style.fontSize = '13px';
  lead.textContent = 'Semua di bawah dibaca dari file. Cek satu per satu, ubah kalau salah.';

  card.append(head, lead);

  const rerender = () => handlers.onRerender();

  // Row 1: Satuan
  const appliedUnit = audit.applied_unit || 'm';
  const unitLabel = UNIT_LABELS[appliedUnit] || appliedUnit;
  const unitSourceText =
    state.config.model.unit_mode !== 'auto'
      ? 'Sumber: pilihan kamu'
      : audit.unit_source === 'bbox_guess'
        ? 'Sumber: perkiraan ukuran kotak pembatas (header file tidak mencantumkan satuan)'
        : 'Sumber: header file';

  const unitEditor = document.createElement('select');
  unitEditor.className = 'field-select';
  unitEditor.setAttribute('aria-label', 'Satuan model');
  for (const [val, text] of [
    ['auto', 'Otomatis (baca file)'],
    ['m', 'Meter (m)'],
    ['cm', 'Sentimeter (cm)'],
    ['mm', 'Milimeter (mm)'],
    ['ft', 'Feet (ft)'],
    ['in', 'Inci (in)'],
  ]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    if (state.config.model.unit_mode === val) opt.selected = true;
    unitEditor.appendChild(opt);
  }
  unitEditor.addEventListener('change', () => {
    handlers.onChangeUnit(unitEditor.value);
  });

  let unitPrompt = null;
  if (gate.needsUnit && !gate.unitOk) {
    unitPrompt = document.createElement('div');
    unitPrompt.style.marginTop = '8px';
    unitPrompt.style.display = 'flex';
    unitPrompt.style.gap = '6px';
    unitPrompt.style.flexWrap = 'wrap';
    const confirmUnitBtn = document.createElement('button');
    confirmUnitBtn.type = 'button';
    confirmUnitBtn.className = 'ghost ghost-sm';
    confirmUnitBtn.textContent = `Benar, satuannya ${unitLabel}`;
    confirmUnitBtn.addEventListener('click', () => handlers.onConfirmUnit(appliedUnit));
    unitPrompt.appendChild(confirmUnitBtn);
  }

  card.appendChild(
    makeConfirmRow({
      id: 'unit',
      ok: gate.unitOk,
      label: 'Satuan',
      value: gate.unitOk ? unitLabel : `Perlu dikonfirmasi (${unitLabel}?)`,
      sub: unitSourceText,
      onToggleEdit: rerender,
      editorEl: unitEditor,
      alwaysShowExtraEl: unitPrompt,
    }),
  );

  // Row 2: Sumbu atas
  const upAxis = audit.applied_up_axis || 'Z';
  const axisEditor = document.createElement('select');
  axisEditor.className = 'field-select';
  axisEditor.setAttribute('aria-label', 'Sumbu atas');
  for (const [val, text] of [
    ['auto', 'Otomatis'],
    ['Z', 'Sumbu Z ke atas'],
    ['Y', 'Sumbu Y ke atas'],
  ]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    if (state.config.model.up_axis === val) opt.selected = true;
    axisEditor.appendChild(opt);
  }
  axisEditor.addEventListener('change', () => handlers.onChangeUpAxis(axisEditor.value));

  card.appendChild(
    makeConfirmRow({
      id: 'axis',
      ok: true,
      label: 'Sumbu atas',
      value: upAxis,
      sub: state.config.model.up_axis === 'auto' ? 'Sumber: konvensi format file' : 'Sumber: pilihan kamu',
      onToggleEdit: rerender,
      editorEl: axisEditor,
    }),
  );

  // Row 3: Ukuran bangunan & perkiraan lantai
  const span = bbox.span || [0, 0, 0];
  const estFloors = ins.estimated_floors || 1;
  const floorH = Number(state.config?.settings?.floor_height_m || 3.6);
  const floorEditor = document.createElement('div');
  floorEditor.style.display = 'grid';
  floorEditor.style.gridTemplateColumns = '1fr 1fr';
  floorEditor.style.gap = '6px';

  const fhInput = document.createElement('input');
  fhInput.type = 'number';
  fhInput.step = '0.1';
  fhInput.min = '2.2';
  fhInput.max = '10';
  fhInput.className = 'field-input';
  fhInput.value = String(floorH);
  fhInput.setAttribute('aria-label', 'Tinggi antar lantai (m)');
  fhInput.addEventListener('change', () => {
    const v = Number(fhInput.value);
    if (Number.isFinite(v) && v >= 2.2 && v <= 10) {
      handlers.onChangeFloorHeight(v);
    }
  });

  const expInput = document.createElement('input');
  expInput.type = 'number';
  expInput.min = '1';
  expInput.max = '200';
  expInput.className = 'field-input';
  expInput.placeholder = `Jumlah lantai (${estFloors})`;
  expInput.value = state.config.model.expected_floors ? String(state.config.model.expected_floors) : '';
  expInput.setAttribute('aria-label', 'Jumlah lantai sebenarnya');
  expInput.addEventListener('change', () => {
    const v = Number(expInput.value);
    handlers.onChangeExpectedFloors(Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  });

  floorEditor.append(fhInput, expInput);

  card.appendChild(
    makeConfirmRow({
      id: 'size',
      ok: true,
      label: 'Ukuran bangunan',
      value: `${fmtId(span[0], 1)} × ${fmtId(span[1], 1)} × ${fmtId(span[2], 1)} m`,
      sub: `Sekitar ${estFloors} lantai dengan tinggi ${fmtId(floorH, 1)} m`,
      onToggleEdit: rerender,
      editorEl: floorEditor,
    }),
  );

  // Row 4: Muka tanah (mandatory question when z_ground_offset_m < -0.5 m)
  const zOff = Number(audit.z_ground_offset_m || 0);
  let groundFieldset = null;
  if (gate.needsGround) {
    groundFieldset = document.createElement('fieldset');
    groundFieldset.className = 'confirm-fieldset';
    const leg = document.createElement('legend');
    leg.className = 'lbl';
    leg.style.padding = '0';
    leg.style.marginBottom = '4px';
    leg.textContent = 'Di mana muka tanahnya?';
    groundFieldset.appendChild(leg);

    const opts = [
      { value: 'file_zero', label: 'z = 0 di file adalah muka tanah' },
      { value: 'model_base', label: `Alas model (z = ${fmtId(zOff, 2)} m) adalah muka tanah` },
    ];
    for (const o of opts) {
      const lbl = document.createElement('label');
      lbl.className = 'confirm-radio';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'luxa-ground';
      radio.value = o.value;
      radio.checked = state.confirm.groundChoice === o.value;
      radio.addEventListener('change', () => {
        const cutoff = o.value === 'file_zero' ? Math.abs(zOff) : 0.0;
        handlers.onChooseGround(o.value, cutoff);
      });
      const txt = document.createElement('span');
      txt.textContent = o.label;
      lbl.append(radio, txt);
      groundFieldset.appendChild(lbl);
    }
  }

  const groundEditor = document.createElement('input');
  groundEditor.type = 'number';
  groundEditor.step = '0.1';
  groundEditor.min = '0';
  groundEditor.max = '200';
  groundEditor.className = 'field-input';
  groundEditor.value = String(zCut);
  groundEditor.setAttribute('aria-label', 'Batas muka tanah z0 (m)');
  groundEditor.addEventListener('change', () => {
    const v = Math.max(0, Number(groundEditor.value) || 0);
    handlers.onChooseGround('custom', v);
  });

  const groundVal = gate.groundOk
    ? state.confirm.groundChoice === 'file_zero'
      ? `z = 0 di file (potong ${fmtId(zCut, 2)} m)`
      : `z = ${fmtId(zCut, 2)} m`
    : 'Perlu dipilih';
  const groundSub = gate.needsGround
    ? `Model mulai di z = ${fmtId(zOff, 2)} m, di bawah nol.`
    : 'Alas model berada di muka tanah.';

  card.appendChild(
    makeConfirmRow({
      id: 'ground',
      ok: gate.groundOk,
      label: 'Muka tanah',
      value: groundVal,
      sub: groundSub,
      onToggleEdit: rerender,
      editorEl: groundEditor,
      alwaysShowExtraEl: groundFieldset,
    }),
  );

  // Row 5: Isi model (mandatory per spec §3.2)
  const scopeFieldset = document.createElement('fieldset');
  scopeFieldset.className = 'confirm-fieldset';
  for (const sc of SCOPE_OPTIONS) {
    const lbl = document.createElement('label');
    lbl.className = 'confirm-radio';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'luxa-scope';
    radio.value = sc.value;
    radio.checked = state.config.model.model_scope === sc.value;
    radio.addEventListener('change', () => handlers.onChooseScope(sc.value));
    const txt = document.createElement('span');
    txt.textContent = sc.label;
    lbl.append(radio, txt);
    scopeFieldset.appendChild(lbl);
  }

  const activeScopeObj = SCOPE_OPTIONS.find((s) => s.value === state.config.model.model_scope);
  card.appendChild(
    makeConfirmRow({
      id: 'scope',
      ok: gate.scopeOk,
      label: 'Isi model',
      value: activeScopeObj ? activeScopeObj.label : 'Perlu dipilih',
      sub: 'Membantu menentukan penyaringan sisi dalam dan bangunan tetangga.',
      onToggleEdit: rerender,
      editorEl: null,
      alwaysShowExtraEl: !gate.scopeOk || openEditors.has('scope') ? scopeFieldset : null,
    }),
  );

  // Row 6: Tanpa kaca (only when NO_GLAZING is active)
  if (gate.needsNoGlazing) {
    const ngFieldset = document.createElement('fieldset');
    ngFieldset.className = 'confirm-fieldset';

    const r1Lbl = document.createElement('label');
    r1Lbl.className = 'confirm-radio';
    const r1 = document.createElement('input');
    r1.type = 'radio';
    r1.name = 'luxa-noglazing';
    r1.checked = state.confirm.noGlazingChoice === 'zero_wwr';
    r1.addEventListener('change', () => handlers.onChooseNoGlazing('zero_wwr', null));
    const r1Txt = document.createElement('span');
    r1Txt.textContent = 'Bangunan memang tanpa kaca (WWR 0%)';
    r1Lbl.append(r1, r1Txt);

    const r2Lbl = document.createElement('label');
    r2Lbl.className = 'confirm-radio';
    const r2 = document.createElement('input');
    r2.type = 'radio';
    r2.name = 'luxa-noglazing';
    r2.checked = state.confirm.noGlazingChoice === 'assumed_wwr';
    r2.addEventListener('change', () => {
      const current = state.config.settings.default_wall_wwr ?? 0.3;
      handlers.onChooseNoGlazing('assumed_wwr', current);
    });
    const r2Txt = document.createElement('span');
    r2Txt.textContent = 'Isi WWR asumsi (hasil berstatus Sementara)';
    r2Lbl.append(r2, r2Txt);

    ngFieldset.append(r1Lbl, r2Lbl);

    if (state.confirm.noGlazingChoice === 'assumed_wwr') {
      const wwrInput = document.createElement('input');
      wwrInput.type = 'number';
      wwrInput.min = '5';
      wwrInput.max = '95';
      wwrInput.step = '5';
      wwrInput.className = 'field-input';
      wwrInput.value = String(Math.round((state.config.settings.default_wall_wwr ?? 0.3) * 100));
      wwrInput.setAttribute('aria-label', 'WWR asumsi dalam persen');
      wwrInput.addEventListener('change', () => {
        const pct = Math.min(95, Math.max(5, Number(wwrInput.value) || 30));
        handlers.onChooseNoGlazing('assumed_wwr', pct / 100);
      });
      ngFieldset.appendChild(wwrInput);
    }

    card.appendChild(
      makeConfirmRow({
        id: 'noglazing',
        ok: gate.noGlazingOk,
        label: 'Permukaan kaca',
        value: gate.noGlazingOk
          ? state.confirm.noGlazingChoice === 'assumed_wwr'
            ? `WWR asumsi ${Math.round((state.config.settings.default_wall_wwr || 0) * 100)}%`
            : 'Tanpa kaca (WWR 0%)'
          : 'Tidak ada kaca terdeteksi',
        sub: 'Pilih salah satu agar perhitungan tidak memakai asumsi diam-diam.',
        onToggleEdit: rerender,
        editorEl: null,
        alwaysShowExtraEl: ngFieldset,
      }),
    );
  }

  // Row 7: Lokasi
  const cities =
    state.config.settings.sf_source === 'sni2020'
      ? state.locations.sni_cities
      : state.locations.template_prodi_cities;
  const fallbackCities = cities?.length ? cities : [{ id: 'jakarta', city: 'Jakarta' }];
  const activeCity = fallbackCities.find((c) => c.id === state.config.settings.city_preset);
  const cityEditor = document.createElement('div');
  cityEditor.style.display = 'grid';
  cityEditor.style.gap = '6px';

  const citySel = document.createElement('select');
  citySel.className = 'field-select';
  citySel.setAttribute('aria-label', 'Pilih kota');
  for (const c of fallbackCities) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.city;
    if (c.id === state.config.settings.city_preset) opt.selected = true;
    citySel.appendChild(opt);
  }
  citySel.addEventListener('change', () => handlers.onChangeCity(citySel.value));

  const sfSel = document.createElement('select');
  sfSel.className = 'field-select';
  sfSel.setAttribute('aria-label', 'Sumber tabel faktor surya');
  for (const [val, txt] of [
    ['template_prodi', 'Tabel SF: template laporan'],
    ['sni2020', 'Tabel SF: SNI 6389:2020 (54 kota)'],
  ]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = txt;
    if (state.config.settings.sf_source === val) opt.selected = true;
    sfSel.appendChild(opt);
  }
  sfSel.addEventListener('change', () => handlers.onChangeSfSource(sfSel.value));

  cityEditor.append(citySel, sfSel);

  card.appendChild(
    makeConfirmRow({
      id: 'location',
      ok: true,
      label: 'Lokasi',
      value: activeCity?.city || state.config.settings.city_preset || 'Jakarta',
      sub:
        state.config.settings.sf_source === 'sni2020'
          ? 'Tabel SF: SNI 6389:2020'
          : 'Tabel SF: template laporan',
      onToggleEdit: rerender,
      editorEl: cityEditor,
    }),
  );

  // Row 8: Arah utara
  const northEditor = document.createElement('input');
  northEditor.type = 'number';
  northEditor.min = '0';
  northEditor.max = '359';
  northEditor.step = '1';
  northEditor.className = 'field-input';
  northEditor.value = String(northDeg);
  northEditor.setAttribute('aria-label', 'Sudut arah utara (derajat)');
  northEditor.addEventListener('change', () => {
    const deg = ((Number(northEditor.value) || 0) % 360 + 360) % 360;
    handlers.onChangeNorth(deg);
  });

  card.appendChild(
    makeConfirmRow({
      id: 'north',
      ok: true,
      label: 'Arah utara',
      value: `${fmtId(northDeg, 0)}° (sumbu +Y)`,
      sub: 'Ubah sudut bila sumbu +Y model tidak menghadap utara.',
      onToggleEdit: rerender,
      editorEl: northEditor,
    }),
  );

  // Bottom CTA area
  const spacer = document.createElement('div');
  spacer.style.flex = '1';

  const footer = document.createElement('div');
  footer.style.display = 'grid';
  footer.style.gap = '6px';
  footer.style.paddingTop = '14px';

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'cta';
  cta.disabled = !gate.ready;
  cta.textContent = gate.ready ? 'Lanjut ke Inspeksi' : gate.missingLabel;
  cta.addEventListener('click', () => handlers.onProceedToInspect());

  const hint = document.createElement('p');
  hint.className = 'lbl';
  hint.style.margin = '0';
  hint.style.textAlign = 'center';
  hint.style.fontWeight = '500';
  hint.textContent = gate.ready
    ? 'Semua baris sudah hijau. Lanjut periksa grup dan kejanggalan.'
    : 'Tombol aktif setelah semua baris berwarna hijau.';

  footer.append(cta, hint);
  card.append(spacer, footer);
  viewerSec.appendChild(card);
  main.appendChild(viewerSec);

  // Mount & sync Three.js viewer after insertion
  window.requestAnimationFrame(() => {
    if (canvasHost.isConnected) {
      viewer.mount(canvasHost);
      viewer.syncState({ ...state, viewerMode: 'classification' });
    }
  });

  return main;
}
