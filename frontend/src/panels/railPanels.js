/**
 * Rail feature cards rendered inside `shell/cardHost.js` (one open at a time, Escape closes).
 * Scoped cleanly for Fase 4a: Model, Material, Lokasi, Tampilan, Bandingkan, Laporan, Bantuan.
 */

import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';

function makeField(labelText, controlEl, hintText = '') {
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gap = '4px';

  const lbl = document.createElement('label');
  lbl.className = 'lbl';
  lbl.textContent = labelText;
  wrap.append(lbl, controlEl);

  if (hintText) {
    const hint = document.createElement('div');
    hint.className = 'lbl';
    hint.style.fontWeight = '500';
    hint.textContent = hintText;
    wrap.appendChild(hint);
  }
  return wrap;
}

export function createRailPanelBuilders(handlers) {
  return {
    model: {
      title: 'Model',
      renderBody(container, state) {
        const meta = document.createElement('div');
        meta.className = 'glass-thin';
        meta.style.padding = '10px 12px';
        meta.style.borderRadius = '12px';

        const fn = document.createElement('div');
        fn.style.fontWeight = '700';
        fn.textContent = state.filename || 'Belum ada model aktif';

        const sub = document.createElement('div');
        sub.className = 'lbl';
        sub.style.marginTop = '2px';
        if (state.inspectData?.bounding_box?.span) {
          const sp = state.inspectData.bounding_box.span;
          sub.textContent = `${fmtId(sp[0], 1)} × ${fmtId(sp[1], 1)} × ${fmtId(sp[2], 1)} m · ${state.inspectData.estimated_floors || 0} lantai`;
        } else {
          sub.textContent = 'Unggah file 3D atau pilih contoh bawaan untuk mulai.';
        }

        meta.append(fn, sub);
        container.appendChild(meta);

        const btnNew = document.createElement('button');
        btnNew.type = 'button';
        btnNew.className = 'cta';
        btnNew.style.height = '42px';
        btnNew.innerHTML = `${icon('upload', 16)}<span>Unggah model lain</span>`;
        btnNew.addEventListener('click', () => handlers.onGoToUpload());
        container.appendChild(btnNew);

        if (state.inspectData) {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '1fr 1fr';
          row.style.gap = '8px';

          const b1 = document.createElement('button');
          b1.type = 'button';
          b1.className = 'ghost ghost-sm';
          b1.textContent = 'Buka Konfirmasi';
          b1.addEventListener('click', () => handlers.onNavigateStep('confirm'));

          const b2 = document.createElement('button');
          b2.type = 'button';
          b2.className = 'ghost ghost-sm';
          b2.textContent = 'Buka Inspeksi';
          b2.addEventListener('click', () => handlers.onNavigateStep('inspect'));

          row.append(b1, b2);
          container.appendChild(row);
        }
      },
    },

    material: {
      title: 'Material',
      renderBody(container, state) {
        const mats = state.materials || {};
        const defs = [
          ['Kaca (fenestrasi)', 'glazing_material_id', mats.glazing_materials || []],
          ['Dinding & spandrel', 'wall_material_id', mats.wall_materials || []],
          ['Rangka', 'frame_material_id', mats.frame_materials || []],
          ['Atap', 'roof_material_id', mats.roof_materials || []],
        ];

        for (const [label, fieldKey, list] of defs) {
          const sel = document.createElement('select');
          sel.className = 'field-select';
          const currentId = state.config.settings[fieldKey];
          for (const m of list) {
            const opt = document.createElement('option');
            opt.value = m.id;
            const extra =
              m.category === 'glazing'
                ? `U ${fmtId(m.u_value, 2)} · SC ${fmtId(m.sc ?? 0, 2)}`
                : `U ${fmtId(m.u_value, 2)} · α ${fmtId(m.alpha ?? 0, 2)}`;
            opt.textContent = `${m.name} (${extra})`;
            if (m.id === currentId) opt.selected = true;
            sel.appendChild(opt);
          }
          sel.addEventListener('change', () => handlers.onChangeRoleMaterial(fieldKey, sel.value));

          const activeMat = list.find((m) => m.id === currentId);
          const hint = activeMat
            ? `${activeMat.sumber || 'Nilai tipikal katalog'}${activeMat.status === 'datasheet' ? ' · datasheet' : ''}`
            : '';

          container.appendChild(makeField(label, sel, hint));
        }

        if (state.analysisData) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cta';
          btn.style.height = '42px';
          btn.textContent = 'Hitung ulang dengan material baru';
          btn.addEventListener('click', () => handlers.onRecompute());
          container.appendChild(btn);
        }
      },
    },

    location: {
      title: 'Lokasi',
      renderBody(container, state) {
        const sfSel = document.createElement('select');
        sfSel.className = 'field-select';
        for (const [val, lbl] of [
          ['template_prodi', 'Template laporan (18 kota)'],
          ['sni2020', 'SNI 6389:2020 Tabel 8 (54 kota)'],
        ]) {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = lbl;
          if (state.config.settings.sf_source === val) opt.selected = true;
          sfSel.appendChild(opt);
        }
        sfSel.addEventListener('change', () => handlers.onChangeSfSource(sfSel.value));
        container.appendChild(makeField('Sumber tabel faktor surya (SF)', sfSel));

        const cityList =
          state.config.settings.sf_source === 'sni2020'
            ? state.locations.sni_cities
            : state.locations.template_prodi_cities;
        const cities = cityList?.length ? cityList : [{ id: 'jakarta', city: 'Jakarta' }];

        const citySel = document.createElement('select');
        citySel.className = 'field-select';
        for (const c of cities) {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.city;
          if (c.id === state.config.settings.city_preset) opt.selected = true;
          citySel.appendChild(opt);
        }
        citySel.addEventListener('change', () => handlers.onChangeCity(citySel.value));
        container.appendChild(makeField('Kota proyek', citySel));

        const northInput = document.createElement('input');
        northInput.type = 'number';
        northInput.min = '0';
        northInput.max = '359';
        northInput.step = '1';
        northInput.className = 'field-input';
        northInput.value = String(state.config.settings.north_angle_deg || 0);
        northInput.addEventListener('change', () => {
          const deg = ((Number(northInput.value) || 0) % 360 + 360) % 360;
          handlers.onChangeNorth(deg);
        });
        container.appendChild(
          makeField('Arah utara (derajat dari +Y)', northInput, 'Mengubah arah utara mengubah SF tiap fasad.'),
        );

        const modeSel = document.createElement('select');
        modeSel.className = 'field-select';
        for (const [val, lbl] of [
          ['sni', 'SNI 6389:2020 (ΔT = 5 K, TDek dari massa)'],
          ['simulasi', 'Eksplorasi simulasi (bukan untuk kepatuhan)'],
        ]) {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = lbl;
          if (state.config.settings.mode === val) opt.selected = true;
          modeSel.appendChild(opt);
        }
        modeSel.addEventListener('change', () => handlers.onChangeCalcMode(modeSel.value));
        container.appendChild(makeField('Mode perhitungan', modeSel));

        if (state.analysisData) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cta';
          btn.style.height = '42px';
          btn.textContent = 'Hitung ulang dengan lokasi baru';
          btn.addEventListener('click', () => handlers.onRecompute());
          container.appendChild(btn);
        }
      },
    },

    display: {
      title: 'Tampilan',
      renderBody(container, state) {
        // Section 1: Kamera (mirrors mockup 6-panel-tampilan.html)
        const camSec = document.createElement('div');
        camSec.className = 'psec';
        camSec.style.borderTop = '0';
        camSec.style.paddingTop = '0';

        const camHead = document.createElement('h3');
        camHead.innerHTML = `${icon('eye', 14)}<span>Kamera</span>`;
        camSec.appendChild(camHead);

        const projSeg = document.createElement('div');
        projSeg.className = 'seg';
        projSeg.setAttribute('role', 'radiogroup');
        projSeg.setAttribute('aria-label', 'Proyeksi kamera');

        for (const [id, label, key] of [
          ['perspective', 'Persp', '1'],
          ['two_point', '2 titik', '2'],
          ['axonometric', 'Akso', '3'],
          ['elevation', 'Tampak', '4'],
        ]) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('role', 'radio');
          const isOn = state.cameraProjection === id;
          btn.setAttribute('aria-checked', isOn ? 'true' : 'false');
          if (isOn) btn.classList.add('on');
          btn.title = `Pintasan ${key}`;
          btn.textContent = label;
          btn.addEventListener('click', () => handlers.onSetProjection(id));
          projSeg.appendChild(btn);
        }
        camSec.appendChild(projSeg);

        // 3x3 direction grid + Arah utara
        const dirRow = document.createElement('div');
        dirRow.style.display = 'grid';
        dirRow.style.gridTemplateColumns = '132px minmax(0, 1fr)';
        dirRow.style.gap = '12px';
        dirRow.style.alignItems = 'center';

        const dirGrid = document.createElement('div');
        dirGrid.className = 'cam-dir-grid';
        dirGrid.setAttribute('role', 'group');
        dirGrid.setAttribute('aria-label', 'Arah tampak');

        const gridCells = [
          ['BL', 'Barat Laut'],
          ['U', 'Utara'],
          ['TL', 'Timur Laut'],
          ['B', 'Barat'],
          ['Atas', 'Atas'],
          ['T', 'Timur'],
          ['BD', 'Barat Daya'],
          ['S', 'Selatan'],
          ['TG', 'Tenggara'],
        ];
        for (const [code, fullName] of gridCells) {
          const b = document.createElement('button');
          b.type = 'button';
          const isCur = state.cameraDirection === code;
          b.className = `dir-menu-btn${isCur ? ' on' : ''}`;
          b.setAttribute('aria-label', `Tampak ${fullName}`);
          b.setAttribute('aria-pressed', isCur ? 'true' : 'false');
          b.textContent = code;
          b.addEventListener('click', () => handlers.onSelectDirection(code));
          dirGrid.appendChild(b);
        }

        const northCol = document.createElement('div');
        northCol.style.display = 'grid';
        northCol.style.gap = '6px';

        const northLbl = document.createElement('label');
        northLbl.className = 'lbl';
        northLbl.htmlFor = 'panel-north-angle';
        northLbl.textContent = 'Arah utara';

        const northRow = document.createElement('div');
        northRow.style.display = 'flex';
        northRow.style.gap = '6px';
        northRow.style.alignItems = 'center';

        const northInp = document.createElement('input');
        northInp.id = 'panel-north-angle';
        northInp.type = 'number';
        northInp.min = '0';
        northInp.max = '359';
        northInp.className = 'field-input num';
        northInp.style.width = '68px';
        northInp.value = String(state.config?.settings?.north_angle_deg || 0);
        northInp.addEventListener('change', () => {
          const deg = ((Number(northInp.value) || 0) % 360 + 360) % 360;
          handlers.onChangeNorth(deg);
        });

        const degUnit = document.createElement('span');
        degUnit.className = 'muted';
        degUnit.textContent = 'derajat';
        northRow.append(northInp, degUnit);

        const pieHint = document.createElement('p');
        pieHint.className = 'lbl';
        pieHint.style.margin = '0';
        pieHint.style.fontWeight = '500';
        pieHint.innerHTML = 'Tahan <kbd>V</kbd> untuk pie 8 arah. Tekan <kbd>F</kbd> untuk pas ke model.';

        northCol.append(northLbl, northRow, pieHint);
        dirRow.append(dirGrid, northCol);
        camSec.appendChild(dirRow);

        const fitBtn = document.createElement('button');
        fitBtn.type = 'button';
        fitBtn.className = 'ghost ghost-sm';
        fitBtn.textContent = 'Pas ke model (F)';
        fitBtn.addEventListener('click', () => handlers.onFitCamera());
        camSec.appendChild(fitBtn);

        container.appendChild(camSec);

        // Section 2: Mode warna & Tema
        const modeSec = document.createElement('div');
        modeSec.className = 'psec';
        const modeHead = document.createElement('h3');
        modeHead.textContent = 'Mode warna & tema';
        modeSec.appendChild(modeHead);

        const modeWrap = document.createElement('div');
        modeWrap.className = 'seg';

        const bCls = document.createElement('button');
        bCls.type = 'button';
        if (state.viewerMode === 'classification') bCls.classList.add('on');
        bCls.textContent = 'Klasifikasi';
        bCls.addEventListener('click', () => handlers.onChangeViewerMode('classification'));

        const bHeat = document.createElement('button');
        bHeat.type = 'button';
        if (state.viewerMode === 'heatmap') bHeat.classList.add('on');
        bHeat.disabled = !state.analysisData;
        bHeat.title = state.analysisData ? '' : 'Tersedia setelah OTTV dihitung';
        bHeat.textContent = 'Heatmap';
        bHeat.addEventListener('click', () => handlers.onChangeViewerMode('heatmap'));

        modeWrap.append(bCls, bHeat);
        modeSec.appendChild(modeWrap);

        const themeBtn = document.createElement('button');
        themeBtn.type = 'button';
        themeBtn.className = 'ghost ghost-sm';
        themeBtn.textContent = state.theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap';
        themeBtn.addEventListener('click', () => handlers.onToggleTheme());
        modeSec.appendChild(themeBtn);

        container.appendChild(modeSec);
      },
    },

    compare: {
      title: 'Bandingkan',
      renderBody(container) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.style.margin = '0';
        p.textContent =
          'Perbandingan berdampingan antar alternatif desain akan hadir di tahap berikutnya. Sementara ini kamu dapat mengunduh beberapa file .ottv.json untuk menyimpan variasi material atau orientasi.';
        container.appendChild(p);
      },
    },

    report: {
      title: 'Laporan',
      renderBody(container, state) {
        if (!state.analysisData) {
          const p = document.createElement('p');
          p.className = 'muted';
          p.style.margin = '0';
          p.textContent = 'Hitung OTTV terlebih dahulu untuk mengunduh laporan hasil.';
          container.appendChild(p);
        } else {
          const btnXlsx = document.createElement('button');
          btnXlsx.type = 'button';
          btnXlsx.className = 'cta';
          btnXlsx.innerHTML = `${icon('download', 17)}<span>Unduh laporan (.xlsx)</span>`;
          btnXlsx.addEventListener('click', () => handlers.onDownloadExcel());
          container.appendChild(btnXlsx);

          const btnCsv = document.createElement('button');
          btnCsv.type = 'button';
          btnCsv.className = 'ghost';
          btnCsv.textContent = 'Unduh ringkasan (.csv)';
          btnCsv.addEventListener('click', () => handlers.onDownloadFormat('csv'));
          container.appendChild(btnCsv);
        }

        const btnProj = document.createElement('button');
        btnProj.type = 'button';
        btnProj.className = 'ghost';
        btnProj.textContent = 'Unduh proyek (.ottv.json)';
        btnProj.disabled = !state.modelId;
        btnProj.addEventListener('click', () => handlers.onDownloadProject());
        container.appendChild(btnProj);
      },
    },

    help: {
      title: 'Bantuan',
      renderBody(container) {
        const sections = [
          [
            'Alur kerja 4 langkah',
            '1) Unggah model 3D (.3dm, .ifc, .obj, .glb). 2) Konfirmasi satuan, muka tanah, dan isi model. 3) Periksa klasifikasi grup dan kejanggalan. 4) Hitung OTTV dan unduh laporan.',
          ],
          [
            'OTTV (Overall Thermal Transfer Value)',
            'Nilai perpindahan termal menyeluruh selubung bangunan sesuai SNI 6389:2020. Batas kepatuhan adalah 35 W/m².',
          ],
          [
            'WWR, SC, SF, dan TDek',
            'WWR adalah rasio luas kaca terhadap luas fasad. SC adalah koefisien peneduh (SCk × SCeff). SF adalah faktor radiasi surya per arah (Tabel 8). TDek adalah beda temperatur ekuivalen dinding berdasarkan massa (Tabel 7).',
          ],
          [
            'Tips ekspor Rhino (.3dm)',
            'Tampilkan model dalam mode Shaded lalu Save (jangan SaveSmall) agar semua permukaan Brep membawa render mesh.',
          ],
        ];

        for (const [h, body] of sections) {
          const item = document.createElement('div');
          item.style.paddingBottom = '10px';
          item.style.borderBottom = '1px solid var(--line)';
          const h3 = document.createElement('div');
          h3.style.fontWeight = '700';
          h3.style.marginBottom = '4px';
          h3.textContent = h;
          const p = document.createElement('p');
          p.className = 'muted';
          p.style.margin = '0';
          p.style.fontSize = '13px';
          p.textContent = body;
          item.append(h3, p);
          container.appendChild(item);
        }
      },
    },
  };
}
