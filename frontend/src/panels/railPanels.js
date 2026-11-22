/**
 * Rail feature cards rendered inside `shell/cardHost.js` (one open at a time, Escape closes).
 * Scoped cleanly for Fase 4a: Model, Material, Lokasi, Tampilan, Bandingkan, Laporan, Bantuan.
 */

import { computeInitialSunDomeRadiusM, parseDecimalInput } from '../state.js';
import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { SNI_GLOSSARY } from '../ui/tooltips.js';
import { ORIENTATION_CODES, ORIENTATION_NAMES_ID } from '../viewer/modes.js';
import { computeSolarPosition } from '../viewer/sundome.js';

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
          let hint = activeMat
            ? `${activeMat.sumber || 'Nilai tipikal katalog'}${activeMat.status === 'datasheet' ? ' · datasheet' : ''}`
            : '';
          if (activeMat?.id === 'glz_kaca_elektrokromik') {
            hint += ' · Catatan: nilai katalog adalah kondisi paling gelap; saat terang SC lebih tinggi.';
          }

          container.appendChild(makeField(label, sel, hint));
        }

        // Lanjut workspace: Per-orientation glazing override (`docs/FASE4_UI_SPEC.md` §5)
        if (state.workspace?.preset === 'lanjut' || state.advancedMode) {
          const ovSec = document.createElement('div');
          ovSec.className = 'psec';
          const ovH = document.createElement('h3');
          ovH.textContent = 'Override kaca per orientasi (Lanjut)';
          ovSec.appendChild(ovH);

          const ovMap = state.config?.settings?.orientation_material_overrides || {};
          const glzList = mats.glazing_materials || [];
          const ovGrid = document.createElement('div');
          ovGrid.style.display = 'grid';
          ovGrid.style.gap = '6px';

          for (const code of ORIENTATION_CODES) {
            const row = document.createElement('div');
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '44px minmax(0, 1fr)';
            row.style.gap = '6px';
            row.style.alignItems = 'center';

            const lbl = document.createElement('span');
            lbl.className = 'lbl';
            lbl.style.color = 'var(--ink)';
            lbl.title = ORIENTATION_NAMES_ID[code] || code;
            lbl.textContent = code;

            const sel = document.createElement('select');
            sel.className = 'field-select field-select-sm';
            sel.setAttribute('aria-label', `Override kaca arah ${ORIENTATION_NAMES_ID[code] || code}`);

            const defOpt = document.createElement('option');
            defOpt.value = '';
            defOpt.textContent = 'Ikuti kaca utama';
            if (!ovMap[code]) defOpt.selected = true;
            sel.appendChild(defOpt);

            for (const gm of glzList) {
              const opt = document.createElement('option');
              opt.value = gm.id;
              opt.textContent = `${gm.name} (SC ${fmtId(gm.sc ?? 0, 2)})`;
              if (ovMap[code] === gm.id) opt.selected = true;
              sel.appendChild(opt);
            }
            sel.addEventListener('change', () =>
              handlers.onChangeOrientationMaterial?.(code, sel.value || null),
            );

            row.append(lbl, sel);
            ovGrid.appendChild(row);
          }

          ovSec.appendChild(ovGrid);
          container.appendChild(ovSec);
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

        // Live SF preview strip for selected city (8 directions)
        const curCity = cities.find((c) => c.id === state.config.settings.city_preset) || cities[0];
        if (curCity) {
          const sfMap = curCity.sf_by_orientation || curCity.sf || null;
          const infoBox = document.createElement('div');
          infoBox.className = 'glass-thin num';
          infoBox.style.padding = '8px 10px';
          infoBox.style.borderRadius = '12px';
          infoBox.style.fontSize = '11.5px';
          const lat = curCity.latitude_deg ?? state.analysisData?.location_info?.latitude_deg;
          const lon = curCity.longitude_deg ?? state.analysisData?.location_info?.longitude_deg;
          if (lat != null && lon != null) {
            const coord = document.createElement('div');
            coord.className = 'lbl';
            coord.style.marginBottom = sfMap ? '6px' : '0';
            coord.textContent = `Koordinat: ${fmtId(lat, 2)}°, ${fmtId(lon, 2)}°`;
            infoBox.appendChild(coord);
          }
          if (sfMap) {
            const sfGrid = document.createElement('div');
            sfGrid.style.display = 'grid';
            sfGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
            sfGrid.style.gap = '4px';
            for (const code of ORIENTATION_CODES) {
              const cell = document.createElement('div');
              cell.style.textAlign = 'center';
              cell.innerHTML = `<div class="lbl">${code}</div><b>${fmtId(sfMap[code] ?? 0, 0)}</b>`;
              sfGrid.appendChild(cell);
            }
            infoBox.appendChild(sfGrid);
          }
          if (infoBox.childElementCount > 0) container.appendChild(infoBox);
        }

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

        // Optional custom EPW weather file upload
        const epwWrap = document.createElement('div');
        epwWrap.className = 'psec';
        const epwH = document.createElement('h3');
        epwH.textContent = 'File cuaca EPW kustom (opsional)';
        epwWrap.appendChild(epwH);

        if (state.config.settings.custom_epw) {
          const activeEpw = document.createElement('div');
          activeEpw.className = 'glass-thin';
          activeEpw.style.padding = '8px 10px';
          activeEpw.style.borderRadius = '10px';
          activeEpw.style.fontSize = '12px';
          activeEpw.style.display = 'flex';
          activeEpw.style.justifyContent = 'space-between';
          activeEpw.style.alignItems = 'center';
          const epwName = document.createElement('span');
          epwName.textContent = `EPW aktif: ${state.config.settings.custom_epw.city || 'Kustom'}`;
          const clrBtn = document.createElement('button');
          clrBtn.type = 'button';
          clrBtn.className = 'ghost ghost-sm';
          clrBtn.style.height = '26px';
          clrBtn.textContent = 'Hapus';
          clrBtn.addEventListener('click', () => handlers.onClearCustomEpw?.());
          activeEpw.append(epwName, clrBtn);
          epwWrap.appendChild(activeEpw);
        } else {
          const epwLbl = document.createElement('label');
          epwLbl.className = 'ghost ghost-sm';
          epwLbl.style.display = 'inline-flex';
          epwLbl.style.alignItems = 'center';
          epwLbl.style.justifyContent = 'center';
          epwLbl.style.gap = '6px';
          const epwInp = document.createElement('input');
          epwInp.type = 'file';
          epwInp.accept = '.epw';
          epwInp.className = 'sr-only';
          epwInp.addEventListener('change', () => {
            if (epwInp.files?.[0]) handlers.onUploadEpw?.(epwInp.files[0]);
          });
          epwLbl.append(epwInp, document.createTextNode('Unggah file cuaca (.epw)'));
          epwWrap.appendChild(epwLbl);
        }
        container.appendChild(epwWrap);

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

        // Section 2: Matahari (mirrors mockup 6-panel-tampilan.html & spec §4.4)
        const sunSec = document.createElement('div');
        sunSec.className = 'psec';
        const sunHead = document.createElement('h3');
        sunHead.innerHTML = `${icon('sun', 14)}<span>Matahari</span>`;
        sunSec.appendChild(sunHead);

        const curDate = state.sunDate || '2026-09-23';
        const PRESET_DATES = [
          ['2026-06-21', '21 Jun'],
          ['2026-09-23', '23 Sep'],
          ['2026-12-21', '21 Des'],
        ];
        const isPreset = PRESET_DATES.some(([d]) => d === curDate);

        const dateSeg = document.createElement('div');
        dateSeg.className = 'seg';
        dateSeg.setAttribute('role', 'radiogroup');
        dateSeg.setAttribute('aria-label', 'Tanggal matahari');

        for (const [iso, lbl] of PRESET_DATES) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'radio');
          const on = curDate === iso;
          b.setAttribute('aria-checked', on ? 'true' : 'false');
          if (on) b.classList.add('on');
          b.textContent = lbl;
          b.addEventListener('click', () => handlers.onChangeSunDate?.(iso));
          dateSeg.appendChild(b);
        }
        const bOther = document.createElement('button');
        bOther.type = 'button';
        bOther.setAttribute('role', 'radio');
        bOther.setAttribute('aria-checked', !isPreset ? 'true' : 'false');
        if (!isPreset) bOther.classList.add('on');
        bOther.textContent = 'Lainnya';
        bOther.addEventListener('click', () => {
          if (isPreset) handlers.onChangeSunDate?.('2026-03-21');
        });
        dateSeg.appendChild(bOther);
        sunSec.appendChild(dateSeg);

        if (!isPreset) {
          const dateInp = document.createElement('input');
          dateInp.type = 'date';
          dateInp.className = 'field-input';
          dateInp.value = curDate;
          dateInp.setAttribute('aria-label', 'Pilih tanggal kustom');
          dateInp.addEventListener('change', () => {
            if (dateInp.value) handlers.onChangeSunDate?.(dateInp.value);
          });
          sunSec.appendChild(dateInp);
        }

        // Jam slider
        const hourRow = document.createElement('div');
        hourRow.className = 'prow';
        const hourLbl = document.createElement('label');
        hourLbl.className = 'lbl';
        hourLbl.htmlFor = 'panel-sun-hour';
        hourLbl.textContent = 'Jam';

        const hourSlider = document.createElement('input');
        hourSlider.id = 'panel-sun-hour';
        hourSlider.type = 'range';
        hourSlider.min = '6';
        hourSlider.max = '18';
        hourSlider.step = '1';
        hourSlider.value = String(Math.round(Number(state.sunHour ?? 13)));
        hourSlider.style.accentColor = 'var(--sun)';
        hourSlider.style.width = '100%';
        hourSlider.addEventListener('input', () => handlers.onChangeSunHour?.(Number(hourSlider.value)));

        const hourVal = document.createElement('span');
        hourVal.className = 'num';
        hourVal.style.fontWeight = '700';
        hourVal.style.width = '44px';
        hourVal.style.textAlign = 'right';
        hourVal.textContent = `${String(Math.round(Number(state.sunHour ?? 13))).padStart(2, '0')}.00`;
        hourRow.append(hourLbl, hourSlider, hourVal);
        sunSec.appendChild(hourRow);

        // Altitude / azimuth micro readout
        const latDeg = Number(state.analysisData?.location_info?.latitude_deg ?? -6.2088);
        const northDeg = Number(state.config?.settings?.north_angle_deg ?? 0);
        const sp = computeSolarPosition(latDeg, curDate, Number(state.sunHour ?? 13), northDeg);
        const sunInfo = document.createElement('div');
        sunInfo.className = 'lbl num';
        sunInfo.style.fontWeight = '500';
        sunInfo.textContent = sp.aboveHorizon
          ? `Tinggi matahari ${Math.round(sp.altitudeDeg)}° · Azimut ${Math.round(sp.azimuthDeg)}°`
          : 'Matahari di bawah ufuk pada jam ini.';
        sunSec.appendChild(sunInfo);

        // Fase 4d D1: Manual sun dome radius (logarithmic slider 0.2x..10x initial radius + numeric "Radius __ m")
        const bbox = state.analysisData?.summary?.bounding_box || state.inspectData?.bounding_box || null;
        const initR = Math.max(4, Number(state.sunDomeInitialRadiusM || computeInitialSunDomeRadiusM(bbox)));
        const curR = Math.max(1, Number(state.sunDomeRadiusM ?? state.config?.settings?.sun_dome_radius_m ?? initR));
        const minR = Math.max(1, initR * 0.2);
        const maxR = Math.max(minR * 2, initR * 10);
        const logVal = Math.round((Math.log(Math.max(minR, Math.min(maxR, curR)) / minR) / Math.log(maxR / minR)) * 1000);

        const domeRow = document.createElement('div');
        domeRow.className = 'prow';
        const domeLbl = document.createElement('label');
        domeLbl.className = 'lbl';
        domeLbl.htmlFor = 'panel-dome-radius-slider';
        domeLbl.textContent = 'Radius kubah';

        const domeSlider = document.createElement('input');
        domeSlider.id = 'panel-dome-radius-slider';
        domeSlider.type = 'range';
        domeSlider.min = '0';
        domeSlider.max = '1000';
        domeSlider.step = '1';
        domeSlider.value = String(logVal);
        domeSlider.style.accentColor = 'var(--sun)';
        domeSlider.style.width = '100%';
        domeSlider.addEventListener('input', () => {
          const t = Math.max(0, Math.min(1, Number(domeSlider.value) / 1000));
          const nextR = Math.round(minR * Math.pow(maxR / minR, t) * 10) / 10;
          handlers.onChangeSunDomeRadius?.(nextR);
        });

        const domeInpWrap = document.createElement('span');
        domeInpWrap.style.display = 'inline-flex';
        domeInpWrap.style.alignItems = 'center';
        domeInpWrap.style.gap = '4px';

        const domeInp = document.createElement('input');
        domeInp.id = 'panel-dome-radius-input';
        domeInp.type = 'text';
        domeInp.inputMode = 'decimal';
        domeInp.className = 'field-input num';
        domeInp.style.width = '64px';
        domeInp.style.height = '28px';
        domeInp.style.padding = '0 6px';
        domeInp.style.textAlign = 'right';
        domeInp.setAttribute('aria-label', 'Radius kubah dalam meter');
        domeInp.value = fmtId(curR, curR % 1 ? 1 : 0);
        const commitTypedR = () => {
          const parsed = parseDecimalInput(domeInp.value);
          if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 5000) {
            handlers.onChangeSunDomeRadius?.(Math.round(parsed * 10) / 10);
          } else {
            domeInp.value = fmtId(curR, curR % 1 ? 1 : 0);
          }
        };
        domeInp.addEventListener('change', commitTypedR);
        domeInp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitTypedR();
          }
        });
        const domeUnit = document.createElement('span');
        domeUnit.className = 'lbl';
        domeUnit.textContent = 'm';
        domeInpWrap.append(domeInp, domeUnit);

        domeRow.append(domeLbl, domeSlider, domeInpWrap);
        sunSec.appendChild(domeRow);

        // Putar satu hari + Putar arah utara (D2) — NO "Pas ke model" button for sun dome per D1!
        const sunActions = document.createElement('div');
        sunActions.style.display = 'flex';
        sunActions.style.gap = '6px';

        const playDayBtn = document.createElement('button');
        playDayBtn.type = 'button';
        playDayBtn.className = 'ghost ghost-sm';
        playDayBtn.style.flex = '1';
        playDayBtn.style.background = 'var(--glass-thin)';
        playDayBtn.innerHTML = `${icon(state.sunPlaying ? 'pause' : 'play', 12)}<span>${
          state.sunPlaying ? 'Jeda' : 'Putar satu hari'
        }</span>`;
        playDayBtn.addEventListener('click', () => handlers.onToggleSunPlay?.());

        const rotNorthBtn = document.createElement('button');
        rotNorthBtn.type = 'button';
        rotNorthBtn.className = `ghost ghost-sm${state.northRotateMode ? ' is-active' : ''}`;
        rotNorthBtn.style.flex = '1';
        rotNorthBtn.style.background = state.northRotateMode ? 'var(--surface)' : 'var(--glass-thin)';
        rotNorthBtn.innerHTML = `${icon('rotateCw', 12)}<span>${
          state.northRotateMode ? 'Selesai putar (R)' : 'Putar utara (R)'
        }</span>`;
        rotNorthBtn.addEventListener('click', () => handlers.onToggleNorthRotateMode?.());

        sunActions.append(playDayBtn, rotNorthBtn);
        sunSec.appendChild(sunActions);
        container.appendChild(sunSec);

        // Section 3: Tampilkan fasad (mirrors mockup 6-panel-tampilan.html & spec §4.6)
        const filterFs = document.createElement('fieldset');
        filterFs.className = 'psec';
        filterFs.style.border = '0';
        filterFs.style.margin = '0';

        const filterLeg = document.createElement('legend');
        filterLeg.style.padding = '0';
        filterLeg.style.width = '100%';
        const filterH = document.createElement('h3');
        filterH.innerHTML = `${icon('layers', 14)}<span>Tampilkan fasad</span>`;
        filterLeg.appendChild(filterH);
        filterFs.appendChild(filterLeg);

        const radioWrap = document.createElement('div');
        radioWrap.style.display = 'grid';
        radioWrap.style.gap = '2px';
        radioWrap.style.fontSize = '13px';

        const filterOpts = [
          ['all', 'Semua arah'],
          ['selected_orientation', 'Arah yang dipilih'],
          ['sunlit_now', 'Yang terkena matahari jam ini'],
        ];
        const curFilter = state.facadeFilter || 'all';
        for (const [val, txt] of filterOpts) {
          const lbl = document.createElement('label');
          lbl.className = 'confirm-radio';
          lbl.style.minHeight = '30px';
          if (curFilter === val) lbl.style.fontWeight = '600';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'luxa_facade_filter';
          radio.value = val;
          radio.checked = curFilter === val;
          radio.disabled = val === 'sunlit_now' && !state.analysisData;
          radio.addEventListener('change', () => {
            if (radio.checked) handlers.onChangeFacadeFilter?.(val);
          });
          const spanTxt = document.createElement('span');
          spanTxt.textContent = txt;
          lbl.append(radio, spanTxt);
          radioWrap.appendChild(lbl);
        }
        filterFs.appendChild(radioWrap);

        const sfNote = document.createElement('p');
        sfNote.className = 'lbl';
        sfNote.style.margin = '0';
        sfNote.style.fontWeight = '500';
        sfNote.style.lineHeight = '17px';
        sfNote.textContent =
          'Filter ini membantu melihat sisi mana yang sedang kena matahari. Angka OTTV tetap memakai faktor SF tahunan dari SNI, jadi tidak berubah saat jam digeser.';
        filterFs.appendChild(sfNote);
        container.appendChild(filterFs);

        // Section 4: Workspace v1 (`docs/FASE4_UI_SPEC.md` §5 + mockup 6-panel-tampilan.html)
        const wsSec = document.createElement('div');
        wsSec.className = 'psec';
        const wsHead = document.createElement('h3');
        wsHead.innerHTML = `${icon('sliders', 14)}<span>Workspace</span>`;
        wsSec.appendChild(wsHead);

        const wsPreset = state.workspace?.preset || 'belajar';
        const wsSeg = document.createElement('div');
        wsSeg.className = 'seg';
        wsSeg.setAttribute('role', 'radiogroup');
        wsSeg.setAttribute('aria-label', 'Preset workspace');

        for (const [id, lbl] of [
          ['belajar', 'Belajar'],
          ['lanjut', 'Lanjut'],
          ['presentasi', 'Presentasi'],
        ]) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'radio');
          const on = wsPreset === id;
          b.setAttribute('aria-checked', on ? 'true' : 'false');
          if (on) b.classList.add('on');
          b.textContent = lbl;
          b.addEventListener('click', () => handlers.onSetWorkspacePreset?.(id));
          wsSeg.appendChild(b);
        }
        wsSec.appendChild(wsSeg);

        const wsDesc = document.createElement('p');
        wsDesc.className = 'lbl';
        wsDesc.style.margin = '0';
        wsDesc.style.fontWeight = '500';
        wsDesc.textContent =
          wsPreset === 'presentasi'
            ? 'Rel dan kolom samping disembunyikan untuk viewer penuh.'
            : wsPreset === 'lanjut'
            ? 'Menampilkan tabel per bidang dan override material per orientasi.'
            : 'Tooltip istilah SNI dengan rujukan pasal aktif.';
        wsSec.appendChild(wsDesc);

        const custBtn = document.createElement('button');
        custBtn.type = 'button';
        custBtn.className = 'lbl';
        custBtn.style.border = '0';
        custBtn.style.background = 'none';
        custBtn.style.padding = '0';
        custBtn.style.textAlign = 'left';
        custBtn.style.textDecoration = 'underline';
        custBtn.textContent = 'Atur urutan dan isi dock';
        custBtn.addEventListener('click', () => handlers.onOpenDockCustomizer?.());
        wsSec.appendChild(custBtn);

        container.appendChild(wsSec);

        // Section 5: Tema
        const modeSec = document.createElement('div');
        modeSec.className = 'psec';
        const modeHead = document.createElement('h3');
        modeHead.textContent = 'Tema';
        modeSec.appendChild(modeHead);

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
      renderBody(container, state) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.style.margin = '0';
        p.textContent = state.analysisData
          ? 'Bandingkan desain sekarang dengan satu atau beberapa alternatif material, peneduh, atau arah utara secara berdampingan.'
          : 'Hitung OTTV terlebih dahulu agar kamu dapat membandingkan alternatif desain berdampingan di viewer terbelah.';
        container.appendChild(p);

        if (state.analysisData) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cta';
          btn.style.height = '42px';
          btn.innerHTML = `${icon('compare', 16)}<span>Buka mode Bandingkan</span>`;
          btn.addEventListener('click', () => handlers.onOpenCompare?.());
          container.appendChild(btn);
        }
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
          const ottv = Number(state.analysisData.ottv_total_wm2 ?? 0);
          const limit = Number(state.analysisData.sni_limit_wm2 ?? 35);
          const isProv = Boolean(state.analysisData.summary?.is_provisional);
          const ok = ottv <= limit;

          const statusBox = document.createElement('div');
          statusBox.className = 'glass-thin num';
          statusBox.style.padding = '10px 12px';
          statusBox.style.borderRadius = '12px';
          statusBox.style.display = 'grid';
          statusBox.style.gap = '4px';

          const line1 = document.createElement('div');
          line1.style.fontWeight = '700';
          line1.textContent = `OTTV total: ${fmtId(ottv, 2)} W/m²`;
          const line2 = document.createElement('div');
          line2.className = `lbl ${isProv ? 'st-warn' : ok ? 'st-ok' : 'st-fail'}`;
          line2.textContent = isProv
            ? 'Status: Sementara (ada kejanggalan yang belum diperbaiki)'
            : ok
            ? `Status: Memenuhi (≤ ${fmtId(limit, 0)} W/m²)`
            : `Status: Tidak memenuhi, batas ${fmtId(limit, 0)}`;
          statusBox.append(line1, line2);
          container.appendChild(statusBox);

          const btnXlsx = document.createElement('button');
          btnXlsx.type = 'button';
          btnXlsx.className = 'cta';
          btnXlsx.innerHTML = `${icon('download', 17)}<span>Unduh laporan (.xlsx)</span>`;
          btnXlsx.addEventListener('click', () => handlers.onDownloadExcel());
          container.appendChild(btnXlsx);

          const noteXlsx = document.createElement('p');
          noteXlsx.className = 'lbl';
          noteXlsx.style.margin = '0';
          noteXlsx.style.fontWeight = '500';
          noteXlsx.textContent =
            'Memuat ringkasan OTTV, rincian 8 arah mata angin, tabel material, dan substitusi hitungan manual.';
          container.appendChild(noteXlsx);

          const rowAlt = document.createElement('div');
          rowAlt.style.display = 'grid';
          rowAlt.style.gridTemplateColumns = '1fr 1fr';
          rowAlt.style.gap = '6px';

          const btnCsv = document.createElement('button');
          btnCsv.type = 'button';
          btnCsv.className = 'ghost ghost-sm';
          btnCsv.textContent = 'Unduh CSV';
          btnCsv.addEventListener('click', () => handlers.onDownloadFormat('csv'));

          const btnPdf = document.createElement('button');
          btnPdf.type = 'button';
          btnPdf.className = 'ghost ghost-sm';
          btnPdf.textContent = 'Unduh PDF';
          btnPdf.addEventListener('click', () => handlers.onDownloadFormat('pdf'));

          rowAlt.append(btnCsv, btnPdf);
          container.appendChild(rowAlt);
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
        const searchInp = document.createElement('input');
        searchInp.type = 'search';
        searchInp.className = 'field-input';
        searchInp.placeholder = 'Cari istilah SNI (OTTV, WWR, SC, SF, TDek)...';
        searchInp.setAttribute('aria-label', 'Cari glosarium istilah SNI');
        container.appendChild(searchInp);

        const glossWrap = document.createElement('div');
        glossWrap.style.display = 'grid';
        glossWrap.style.gap = '8px';

        const entries = Object.values(SNI_GLOSSARY);
        const renderGlossary = (q = '') => {
          glossWrap.innerHTML = '';
          const ql = q.trim().toLowerCase();
          const filtered = ql
            ? entries.filter(
                (e) =>
                  e.term.toLowerCase().includes(ql) ||
                  e.full.toLowerCase().includes(ql) ||
                  e.summary.toLowerCase().includes(ql) ||
                  e.ref.toLowerCase().includes(ql),
              )
            : entries;
          if (filtered.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'muted';
            empty.style.margin = '4px 0';
            empty.style.fontSize = '12.5px';
            empty.textContent = 'Istilah tidak ditemukan.';
            glossWrap.appendChild(empty);
            return;
          }
          for (const e of filtered) {
            const box = document.createElement('div');
            box.className = 'glass-thin';
            box.style.padding = '8px 10px';
            box.style.borderRadius = '12px';

            const head = document.createElement('div');
            head.style.display = 'flex';
            head.style.justifyContent = 'space-between';
            head.style.alignItems = 'baseline';
            head.style.gap = '6px';

            const tEl = document.createElement('strong');
            tEl.style.fontSize = '13px';
            tEl.textContent = `${e.term} (${e.full})`;

            const rEl = document.createElement('span');
            rEl.className = 'lbl';
            rEl.style.fontSize = '10.5px';
            rEl.style.whiteSpace = 'nowrap';
            rEl.textContent = e.ref;

            head.append(tEl, rEl);

            const p = document.createElement('p');
            p.className = 'muted';
            p.style.margin = '4px 0 0';
            p.style.fontSize = '12px';
            p.style.lineHeight = '17px';
            p.textContent = e.summary;

            box.append(head, p);
            glossWrap.appendChild(box);
          }
        };

        searchInp.addEventListener('input', () => renderGlossary(searchInp.value));
        renderGlossary();
        container.appendChild(glossWrap);

        const guideSec = document.createElement('div');
        guideSec.className = 'psec';
        const gHead = document.createElement('h3');
        gHead.textContent = 'Alur kerja & tips ekspor';
        guideSec.appendChild(gHead);

        for (const [h, body] of [
          [
            '4 langkah kerja',
            '1) Unggah model 3D (.3dm, .ifc, .obj, .glb). 2) Konfirmasi satuan, muka tanah, dan isi model. 3) Periksa grup dan kejanggalan. 4) Hitung OTTV, bandingkan alternatif, lalu unduh laporan.',
          ],
          [
            'Tips Rhino (.3dm)',
            'Tampilkan model dalam mode Shaded lalu Save (jangan SaveSmall) agar semua permukaan Brep membawa render mesh.',
          ],
        ]) {
          const item = document.createElement('div');
          const h4 = document.createElement('div');
          h4.style.fontWeight = '600';
          h4.style.fontSize = '12.5px';
          h4.textContent = h;
          const p = document.createElement('p');
          p.className = 'muted';
          p.style.margin = '2px 0 0';
          p.style.fontSize = '12px';
          p.textContent = body;
          item.append(h4, p);
          guideSec.appendChild(item);
        }
        container.appendChild(guideSec);

        const scBtn = document.createElement('button');
        scBtn.type = 'button';
        scBtn.className = 'ghost ghost-sm';
        scBtn.innerHTML = `${icon('keyboard', 15)}<span>Lihat daftar pintasan (?)</span>`;
        scBtn.addEventListener('click', () => handlers.onOpenShortcuts?.());
        container.appendChild(scBtn);
      },
    },
  };
}
