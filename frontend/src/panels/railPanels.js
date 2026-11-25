/**
 * Rail feature cards rendered inside `shell/cardHost.js` (one open at a time, Escape closes).
 * Scoped cleanly for Fase 4a: Model, Material, Lokasi, Tampilan, Bandingkan, Laporan, Bantuan.
 */

import { listSavedProjects } from '../project.js';
import { computeInitialSunDomeRadiusM, parseDecimalInput } from '../state.js';
import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { luxSvg } from '../ui/mascot.js';
import { SNI_GLOSSARY } from '../ui/tooltips.js';
import { ORIENTATION_CODES, ORIENTATION_NAMES_ID } from '../viewer/modes.js';
import { computeSolarPosition } from '../viewer/sundome.js';

let renamingProjectId = null;

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

        // Fase 4d D4: Browser-saved projects library (Create, Open, Inline Rename, Duplicate, Delete w/ named confirm)
        const projSec = document.createElement('div');
        projSec.className = 'psec';
        const pHead = document.createElement('div');
        pHead.style.display = 'flex';
        pHead.style.justifyContent = 'space-between';
        pHead.style.alignItems = 'center';
        const pTitle = document.createElement('h3');
        pTitle.textContent = 'Proyek tersimpan di browser';
        pHead.appendChild(pTitle);

        if (state.modelId) {
          const saveProjBtn = document.createElement('button');
          saveProjBtn.type = 'button';
          saveProjBtn.className = 'ghost ghost-sm';
          saveProjBtn.style.height = '28px';
          saveProjBtn.textContent = '+ Simpan';
          saveProjBtn.addEventListener('click', () => handlers.onSaveBrowserProject?.());
          pHead.appendChild(saveProjBtn);
        }
        projSec.appendChild(pHead);

        const savedProjects = listSavedProjects();
        if (savedProjects.length === 0) {
          const emptyP = document.createElement('p');
          emptyP.className = 'lbl';
          emptyP.style.margin = '0';
          emptyP.style.fontWeight = '500';
          emptyP.textContent = 'Belum ada proyek tersimpan di browser. Klik "+ Simpan" untuk menyimpan snapshot proyek aktif.';
          projSec.appendChild(emptyP);
        } else {
          const ul = document.createElement('ul');
          ul.className = 'views-list';
          for (const proj of savedProjects) {
            const li = document.createElement('li');
            li.className = 'views-item';
            if (renamingProjectId === proj.id) {
              const form = document.createElement('form');
              form.style.display = 'flex';
              form.style.gap = '4px';
              form.style.width = '100%';
              const inp = document.createElement('input');
              inp.type = 'text';
              inp.className = 'field-input';
              inp.style.height = '30px';
              inp.style.fontSize = '12.5px';
              inp.value = proj.name;
              inp.setAttribute('aria-label', 'Nama baru proyek');
              const ok = document.createElement('button');
              ok.type = 'submit';
              ok.className = 'ghost ghost-sm';
              ok.style.height = '30px';
              ok.textContent = 'Simpan';
              form.addEventListener('submit', (e) => {
                e.preventDefault();
                const nn = inp.value.trim();
                renamingProjectId = null;
                if (nn) handlers.onRenameBrowserProject?.(proj.id, nn);
                else handlers.onRerender?.();
              });
              inp.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  renamingProjectId = null;
                  handlers.onRerender?.();
                }
              });
              form.append(inp, ok);
              li.appendChild(form);
              window.requestAnimationFrame(() => {
                inp.focus();
                inp.select();
              });
            } else {
              const openBtn = document.createElement('button');
              openBtn.type = 'button';
              openBtn.className = 'views-apply-btn';
              openBtn.textContent = proj.name;
              openBtn.title = proj.ottv_total_wm2 != null
                ? `${proj.name} · OTTV ${fmtId(proj.ottv_total_wm2, 2)} W/m²`
                : proj.name;
              openBtn.addEventListener('click', () => handlers.onOpenBrowserProject?.(proj));

              const ren = document.createElement('button');
              ren.type = 'button';
              ren.className = 'icon-mini-btn';
              ren.setAttribute('aria-label', `Ganti nama proyek ${proj.name}`);
              ren.title = 'Ganti nama';
              ren.innerHTML = icon('edit', 14);
              ren.addEventListener('click', () => {
                renamingProjectId = proj.id;
                handlers.onRerender?.();
              });

              const dup = document.createElement('button');
              dup.type = 'button';
              dup.className = 'icon-mini-btn';
              dup.setAttribute('aria-label', `Duplikat proyek ${proj.name}`);
              dup.title = 'Duplikat proyek';
              dup.innerHTML = icon('copy', 14);
              dup.addEventListener('click', () => handlers.onDuplicateBrowserProject?.(proj.id));

              const del = document.createElement('button');
              del.type = 'button';
              del.className = 'icon-mini-btn st-fail';
              del.setAttribute('aria-label', `Hapus proyek ${proj.name}`);
              del.title = 'Hapus proyek';
              del.innerHTML = icon('trash', 14);
              del.addEventListener('click', () => handlers.onDeleteBrowserProject?.(proj));

              li.append(openBtn, ren, dup, del);
            }
            ul.appendChild(li);
          }
          projSec.appendChild(ul);
        }
        container.appendChild(projSec);
      },
    },

    material: {
      title: 'Material',
      renderBody(container, state) {
        const openCatBtn = document.createElement('button');
        openCatBtn.type = 'button';
        openCatBtn.className = 'cta';
        openCatBtn.style.height = '40px';
        openCatBtn.style.fontSize = '13px';
        openCatBtn.innerHTML = `${icon('material', 16)}<span>Buka Katalog & Rekomendasi</span>`;
        openCatBtn.addEventListener('click', () => handlers.onOpenMaterialCatalog?.('browse', 'catalog'));
        container.appendChild(openCatBtn);

        const mats = state.materials || {};
        const defs = [
          ['Kaca (fenestrasi)', 'glazing', 'glazing_material_id', mats.glazing_materials || []],
          ['Dinding & spandrel', 'wall', 'wall_material_id', mats.wall_materials || []],
          ['Rangka', 'frame', 'frame_material_id', mats.frame_materials || []],
          ['Atap', 'roof', 'roof_material_id', mats.roof_materials || []],
        ];

        for (const [label, cat, fieldKey, list] of defs) {
          const rowCtrl = document.createElement('div');
          rowCtrl.style.display = 'flex';
          rowCtrl.style.gap = '6px';

          const sel = document.createElement('select');
          sel.className = 'field-select';
          sel.style.flex = '1';
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

          const pickBtn = document.createElement('button');
          pickBtn.type = 'button';
          pickBtn.className = 'ghost ghost-sm';
          pickBtn.style.height = '38px';
          pickBtn.style.padding = '0 10px';
          pickBtn.textContent = 'Ganti';
          pickBtn.addEventListener('click', () =>
            handlers.onOpenMaterialPickMode?.({
              lockedCategory: cat,
              targetField: fieldKey,
              targetOrientCode: null,
              targetLabel: `Pilih ${label.toLowerCase()}`,
            }),
          );
          rowCtrl.append(sel, pickBtn);

          const activeMat = list.find((m) => m.id === currentId);
          let hint = activeMat
            ? `${activeMat.brand || activeMat.sumber || 'Nilai tipikal katalog'}`
            : '';
          if (activeMat?.id === 'glz_kaca_elektrokromik') {
            hint += ' · Catatan: nilai katalog adalah kondisi paling gelap; saat terang SC lebih tinggi.';
          }
          if (
            cat === 'frame' &&
            (state.config?.settings?.mode || 'sni') === 'sni' &&
            activeMat?.sni_u_frame != null &&
            Math.abs(Number(activeMat.sni_u_frame) - Number(activeMat.u_value)) > 0.05
          ) {
            hint += ` · Mode SNI Tabel 3: dihitung U_frame ${fmtId(activeMat.sni_u_frame, 1)} W/m²K (thermal break tidak menurunkan U_frame di mode SNI).`;
          }

          container.appendChild(makeField(label, rowCtrl, hint));

          if (cat === 'frame') {
            const summ = state.analysisData?.summary || null;
            const isMeasured = summ?.frame_source === 'terukur';
            const fwVal = isMeasured
              ? Number(summ?.frame_width_mm ?? 50)
              : Number(state.config?.settings?.frame_width_mm ?? 50);
            const modVal = Number(state.config?.settings?.glass_module_width_mm ?? summ?.glass_module_width_mm ?? 1500);

            const pairGrid = document.createElement('div');
            pairGrid.style.display = 'grid';
            pairGrid.style.gridTemplateColumns = '1fr 1fr';
            pairGrid.style.gap = '8px';

            const fwRow = document.createElement('div');
            fwRow.style.display = 'flex';
            fwRow.style.alignItems = 'center';
            fwRow.style.gap = '6px';

            const fwInp = document.createElement('input');
            fwInp.type = 'number';
            fwInp.className = 'field-input num';
            fwInp.min = '0';
            fwInp.max = '300';
            fwInp.step = '5';
            fwInp.value = String(Number.isFinite(fwVal) ? fwVal : 50);
            fwInp.style.flex = '1';
            fwInp.style.minWidth = '0';
            fwInp.setAttribute('aria-label', 'Lebar kusen dalam milimeter');
            fwInp.disabled = isMeasured;
            fwInp.addEventListener('change', () => {
              const num = Math.max(0, Math.min(300, Number(fwInp.value)));
              if (!Number.isFinite(num)) return;
              fwInp.value = String(num);
              handlers.onChangeFrameWidthMm?.(num);
            });

            const unitSpan = document.createElement('span');
            unitSpan.className = 'lbl';
            unitSpan.textContent = 'mm';
            fwRow.append(fwInp, unitSpan);

            const modRow = document.createElement('div');
            modRow.style.display = 'flex';
            modRow.style.alignItems = 'center';
            modRow.style.gap = '6px';

            const modInp = document.createElement('input');
            modInp.type = 'number';
            modInp.className = 'field-input num';
            modInp.min = '0';
            modInp.max = '10000';
            modInp.step = '100';
            modInp.value = String(Number.isFinite(modVal) ? modVal : 1500);
            modInp.style.flex = '1';
            modInp.style.minWidth = '0';
            modInp.setAttribute('aria-label', 'Lebar modul kaca dalam milimeter');
            modInp.disabled = isMeasured;
            modInp.addEventListener('change', () => {
              const num = Math.max(0, Math.min(10000, Number(modInp.value)));
              if (!Number.isFinite(num)) return;
              modInp.value = String(num);
              handlers.onChangeGlassModuleWidthMm?.(num);
            });

            const modUnit = document.createElement('span');
            modUnit.className = 'lbl';
            modUnit.textContent = 'mm';
            modRow.append(modInp, modUnit);

            const fwHint = isMeasured
              ? `Terukur otomatis dari grup rangka (${fmtId(fwVal, 1)} mm).`
              : 'Asumsi bila tanpa grup rangka (bawaan 50 mm).';
            const modHint = isMeasured
              ? 'Tidak dipakai karena rangka sudah terukur.'
              : 'Pecahan modul virtual bukaan kaca lebar (bawaan 1.500 mm, tinggi = tinggi lantai).';

            pairGrid.append(
              makeField('Lebar kusen', fwRow, fwHint),
              makeField('Modul kaca', modRow, modHint),
            );
            container.appendChild(pairGrid);
          }
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
          ['sni2020', 'SNI 6389:2020 Tabel 8 (54 kota)'],
          ['template_prodi', 'Tabel SF lama (template PUPR, 18 kota)'],
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
              cell.innerHTML = `<div class="lbl">${code}</div><b>${fmtId(sfMap[code] ?? (code === 'TG' ? sfMap.TGR : sfMap.TG) ?? 0, 0)}</b>`;
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
        // Kartu ini khusus pengaturan. Kontrol yang sering dipakai (kamera, jam, tanggal,
        // mode warna) ada langsung di viewer.
        const mkSec = (iconName, title, first = false) => {
          const sec = document.createElement('div');
          sec.className = 'psec';
          if (first) {
            sec.style.borderTop = '0';
            sec.style.paddingTop = '0';
          }
          const h = document.createElement('h3');
          h.innerHTML = `${iconName ? icon(iconName, 14) : ''}<span>${title}</span>`;
          sec.appendChild(h);
          return sec;
        };
        const note = (txt) => {
          const p = document.createElement('p');
          p.className = 'lbl';
          p.style.margin = '6px 0 0';
          p.style.fontWeight = '500';
          p.textContent = txt;
          return p;
        };

        // 1) Arah utara proyek (angka presisi)
        const northSec = mkSec('compass', 'Arah utara proyek', true);
        const northRow = document.createElement('div');
        northRow.style.display = 'flex';
        northRow.style.gap = '8px';
        northRow.style.alignItems = 'center';
        northRow.style.flexWrap = 'wrap';
        const northInp = document.createElement('input');
        northInp.id = 'panel-north-angle';
        northInp.type = 'number';
        northInp.min = '0';
        northInp.max = '359';
        northInp.step = '0.1';
        northInp.className = 'field-input num';
        northInp.style.width = '76px';
        northInp.setAttribute('aria-label', 'Arah utara dalam derajat');
        northInp.value = String(state.config?.settings?.north_angle_deg || 0);
        northInp.addEventListener('change', () => {
          const deg = ((Number(northInp.value) || 0) % 360 + 360) % 360;
          handlers.onChangeNorth(deg);
        });
        const degUnit = document.createElement('span');
        degUnit.className = 'muted';
        degUnit.textContent = 'derajat';
        const ringBtn = document.createElement('button');
        ringBtn.type = 'button';
        ringBtn.className = `ghost ghost-sm${state.northRotateMode ? ' on' : ''}`;
        ringBtn.textContent = state.northRotateMode ? 'Selesai (R)' : 'Atur di model (R)';
        ringBtn.addEventListener('click', () => handlers.onToggleNorthRotateMode?.());
        northRow.append(northInp, degUnit, ringBtn);
        northSec.append(northRow, note('Mengubah arah utara perlu Hitung ulang. Kompas di viewer hanya untuk navigasi: klik untuk menghadap utara.'));
        container.appendChild(northSec);

        // 2) Tata letak
        const layoutSec = mkSec('sliders', 'Tata letak');
        const posLbl = document.createElement('div');
        posLbl.className = 'lbl';
        posLbl.style.marginBottom = '6px';
        posLbl.textContent = 'Posisi bar mode tampilan';
        const posSeg = document.createElement('div');
        posSeg.className = 'seg';
        posSeg.setAttribute('role', 'radiogroup');
        posSeg.setAttribute('aria-label', 'Posisi bar mode tampilan');
        const curPos = state.workspace?.modeBarPosition === 'bottom' ? 'bottom' : 'top';
        for (const [val, txt] of [
          ['top', 'Atas viewer'],
          ['bottom', 'Bawah viewer'],
        ]) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = curPos === val ? 'on' : '';
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', curPos === val ? 'true' : 'false');
          b.textContent = txt;
          b.addEventListener('click', () => handlers.onSetModeBarPosition?.(val));
          posSeg.appendChild(b);
        }
        const custBtn = document.createElement('button');
        custBtn.type = 'button';
        custBtn.className = 'ghost ghost-sm';
        custBtn.style.marginTop = '10px';
        custBtn.textContent = 'Atur menu samping';
        custBtn.addEventListener('click', () => handlers.onOpenDockCustomizer?.());
        layoutSec.append(posLbl, posSeg, custBtn);
        container.appendChild(layoutSec);

        // 3) Maskot
        const luxSec = mkSec('sun', 'Maskot Lux');
        const luxLbl = document.createElement('label');
        luxLbl.className = 'legend-smooth-lbl';
        const luxCb = document.createElement('input');
        luxCb.type = 'checkbox';
        luxCb.setAttribute('role', 'switch');
        luxCb.checked = state.mascotOn !== false;
        luxCb.addEventListener('change', () => handlers.onToggleMascot?.(luxCb.checked));
        luxLbl.append(luxCb, document.createTextNode(' Tampilkan Lux di Beranda, Belajar, dan saat menghitung'));
        luxSec.appendChild(luxLbl);
        container.appendChild(luxSec);

        // 4) Pintasan
        const keySec = mkSec('keyboard', 'Pintasan keyboard');
        const list = document.createElement('ul');
        list.className = 'display-keys';
        for (const [k, d] of [
          ['V', 'Tahan untuk menu arah pandang'],
          ['F', 'Pas ke model'],
          ['R', 'Atur arah utara'],
          ['Spasi', 'Putar matahari satu hari'],
          ['S', 'Simpan view'],
          ['C', 'Simpan gambar'],
        ]) {
          const li = document.createElement('li');
          li.innerHTML = `<kbd>${k}</kbd><span>${d}</span>`;
          list.appendChild(li);
        }
        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = 'ghost ghost-sm';
        allBtn.style.marginTop = '8px';
        allBtn.textContent = 'Semua pintasan';
        allBtn.addEventListener('click', () => handlers.onOpenShortcuts?.());
        keySec.append(list, allBtn);
        container.appendChild(keySec);
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
          if (state.mascotOn !== false) {
            const row = document.createElement('div');
            row.className = 'empty-lux';
            row.innerHTML = luxSvg('report', { size: 52 });
            row.appendChild(p);
            container.appendChild(row);
          } else {
            container.appendChild(p);
          }
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
            ? 'Status: Sementara (ada catatan yang belum diselesaikan)'
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
            '1) Unggah model 3D (.3dm, .ifc, .obj, .glb). 2) Konfirmasi satuan, muka tanah, dan isi model. 3) Periksa grup dan catatan pemeriksaan. 4) Hitung OTTV, bandingkan alternatif, lalu unduh laporan.',
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
        const ver = document.createElement('p');
        ver.className = 'muted';
        ver.style.margin = '12px 0 0';
        ver.style.fontSize = '12px';
        ver.textContent = `LUXA versi ${typeof __LUXA_VERSION__ !== 'undefined' ? __LUXA_VERSION__ : '-'}`;
        container.appendChild(ver);
      },
    },
  };
}
