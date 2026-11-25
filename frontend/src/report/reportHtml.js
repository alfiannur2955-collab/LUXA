// Laporan OTTV bergaya LUXA: dokumen HTML A4 yang dicetak browser ke PDF.
// Hanya menyusun tampilan dari hasil engine; tidak ada angka yang dihitung ulang.
import { escapeHtml as esc } from '../ui/escapeHtml.js';
import { sideVerdict, verdictInfo } from '../ui/verdict.js';
import { sidesOf, sideName, projectName } from '../present/content.js';
import { heatColor } from '../present/heat.js';
import { REPORT_CSS } from './reportCss.js';

const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = (v) => nf(0).format(Number(v) || 0);
const f1 = (v) => nf(1).format(Number(v) || 0);
const f2 = (v) => nf(2).format(Number(v) || 0);
const f3 = (v) => nf(3).format(Number(v) || 0);
const pct = (v) => `${f1((Number(v) || 0) * 100)}%`;
const AZ_RANGE = { U: '337,5°–22,5°', TL: '22,5°–67,5°', T: '67,5°–112,5°', TGR: '112,5°–157,5°', TG: '112,5°–157,5°', S: '157,5°–202,5°', BD: '202,5°–247,5°', B: '247,5°–292,5°', BL: '292,5°–337,5°' };
const PART_C = { w: '#A79E90', g: '#6B9AB8', s: '#F49B1A' };

const pillCls = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
const stats = (items, cls = '') => `<dl class="stats ${cls}" style="--cols:${items.length}">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
function parts(qw, qg, qs) {
  const tot = qw + qg + qs || 1;
  return `<div class="parts">${[['Panas lewat dinding (konduksi)', qw, 'w'], ['Panas lewat kaca (konduksi)', qg, 'g'], ['Sinar matahari lewat kaca (radiasi)', qs, 's']]
    .map(([t, v, k]) => `<div class="part"><span>${t}</span><i style="--w:${Math.max(1.5, (v / tot) * 100).toFixed(1)}%;--c:${PART_C[k]}"></i><b>${f2(v)}</b><em>${f0((v / tot) * 100)}%</em></div>`).join('')}</div>`;
}

/**
 * state: state aplikasi (analysisData, config); opts: { userName, images: { hero, heat }, logoUrl, date, version }
 * Hasil: { html, title } — title dipakai browser sebagai nama file PDF.
 */
export function buildReportHtml(state, { userName = '', images = {}, logoUrl = '', date = new Date(), version = '' } = {}) {
  const a = state.analysisData;
  const s = a.summary || {};
  const mat = s.active_materials || {};
  const limit = Number(a.sni_limit_wm2 || 35);
  const vi = verdictInfo(a, 2);
  const name = projectName(a);
  const sides = sidesOf(a);
  const hot = [...sides].sort((x, y) => y.ottv_orientation_wm2 - x.ottv_orientation_wm2)[0];
  const dateText = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  const who = userName && userName.trim() ? userName.trim() : '';
  const rttv = a.rttv || {};
  const hasRttv = rttv.applicable && !rttv.disabled;
  const prov = vi.isProv ? '<p class="ribbon">Hasil sementara: periksa catatan di aplikasi sebelum dipakai resmi</p>' : '';

  const pages = [];
  const head = `<div class="head">${logoUrl ? `<img src="${esc(logoUrl)}" alt="LUXA">` : '<b>LUXA</b>'}<span>Laporan OTTV · ${vi.isSim ? 'Mode Simulasi' : 'SNI 6389:2020'}</span></div>`;

  // 1. Sampul
  pages.push(`<section class="page cover">${head}
    ${images.hero ? `<img class="hero" src="${images.hero}" alt="Model ${esc(name)}">` : ''}
    <h1>${esc(name)}</h1>
    ${who ? `<p class="by">Disusun oleh <b>${esc(who)}</b></p>` : '<p class="by">&nbsp;</p>'}
    ${prov}
    <div class="band">
      <div class="result">
        <div class="lbl">OTTV total gedung</div>
        <div class="big"><strong>${f2(a.ottv_total_wm2)}</strong><span>W/m² · ${vi.isSim ? `acuan ${f0(limit)} W/m²` : `batas ${f0(limit)} W/m²`}</span></div>
        ${pillCls(vi.pillClass, vi.isSniFinal ? `${vi.badge} · ${vi.delta.short}` : vi.badge)}
      </div>
      <dl class="stats grid2">${[['Lokasi', esc(a.location_info?.city || '-')], ['Tanggal', esc(dateText)], ['Jumlah lantai', f0(s.total_floors)], ['Luas selubung', `${f0(s.total_envelope_area_m2)} m²`]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    </div>
  </section>`);

  // 2. Ringkasan
  const tot = Number(s.q_wall_conduction_wm2 || 0) + Number(s.q_glass_conduction_wm2 || 0) + Number(s.q_solar_radiation_wm2 || 0);
  pages.push(`<section class="page">${head}
    <p class="kicker">Ringkasan</p>
    <h2>${esc(vi.headline)}</h2>
    <p class="lead">Nilai OTTV ${f2(a.ottv_total_wm2)} W/m². ${esc(vi.delta.sentence)}
      OTTV adalah rata-rata panas yang masuk lewat dinding luar dan kaca, per meter persegi selubung.</p>
    <div class="section">${stats([['OTTV total', `${f2(a.ottv_total_wm2)}<small>W/m²</small>`], ['Sisi terpanas', hot ? `${esc(sideName(hot.code))}<small>${f1(hot.ottv_orientation_wm2)} W/m²</small>` : '-'], ['Porsi fenestrasi (kaca + kusen)', pct(s.effective_wwr)]], 'lg')}</div>
    <div class="card section"><h3>Asal panas</h3>${parts(Number(s.q_wall_conduction_wm2 || 0), Number(s.q_glass_conduction_wm2 || 0), Number(s.q_solar_radiation_wm2 || 0))}
      <p class="muted" style="margin:3mm 0 0;font-size:8pt">Jumlah ketiga jalur = ${f2(tot)} W/m², sama dengan OTTV total.</p></div>
    <div class="cols">
      <div>${images.heat ? `<img class="heatimg" src="${images.heat}" alt="Heatmap OTTV per sisi">` : ''}
        <div class="scale"><span>0</span><i></i><span>50+ W/m²</span></div>
        <p class="muted" style="font-size:7.5pt;margin:1.5mm 0 0">Warna model = OTTV tiap sisi. Garis putus = ${vi.isSim ? 'acuan' : 'batas'} ${f0(limit)} W/m².</p></div>
      <div><table><thead><tr><th>Sisi</th><th class="r">Luas (m²)</th><th class="r">WWR</th><th class="r">OTTV</th><th class="r">Status</th></tr></thead><tbody>
        ${sides.map((r) => {
          const sv = sideVerdict(r.ottv_orientation_wm2, limit, vi.verdict);
          return `<tr class="${r.code === hot?.code ? 'hot' : ''}"><td><span class="sw" style="background:${heatColor(r.ottv_orientation_wm2)}"></span>${esc(sideName(r.code))}</td><td class="r">${f1(r.total_area_m2)}</td><td class="r">${pct(r.wwr)}</td><td class="r">${f2(r.ottv_orientation_wm2)}</td><td class="r ${sv.textClass}">${esc(sv.text)}</td></tr>`;
        }).join('')}
        <tr class="total"><td>Gedung</td><td class="r">${f1(s.total_envelope_area_m2)}</td><td class="r">${pct(s.effective_wwr)}</td><td class="r">${f2(a.ottv_total_wm2)}</td><td class="r ${vi.chipClass}">${esc(vi.isSniFinal ? vi.badge : (vi.isSim ? 'Simulasi' : 'Sementara'))}</td></tr>
      </tbody></table></div>
    </div>
  </section>`);

  // 3. Rincian per sisi, tiga sisi per halaman
  const sideCard = (r) => {
    const m = r.manual_calc || {};
    const rows = m.rows || [];
    const sv = sideVerdict(r.ottv_orientation_wm2, limit, vi.verdict);
    return `<div class="side">
      <div class="side-head"><h3>Sisi ${esc(sideName(r.code))} <span class="muted" style="font-weight:500;font-size:8pt">azimut ${AZ_RANGE[r.code] || ''}</span></h3>
        <span class="val">${f2(r.ottv_orientation_wm2)}<small>W/m²</small></span>${pillCls(sv.pillClass, sv.text)}</div>
      ${rows.length > 1 ? `<p class="combo">${rows.length} kombinasi material; nilai di bawah adalah rata-rata tertimbang luas.</p>` : rows[0]?.combination ? `<p class="combo">Material: ${esc(rows[0].combination)}</p>` : ''}
      <dl class="inputs">
        <div><dt>Luas A₀ (m²)</dt><dd>${f1(m.ao_m2 ?? r.total_area_m2)}</dd></div>
        <div><dt>WWR</dt><dd>${f3(m.wwr ?? r.wwr)}</dd></div>
        <div><dt>α dinding</dt><dd>${f2(m.alpha)}</dd></div>
        <div><dt>U dinding</dt><dd>${f2(m.u_wall)}</dd></div>
        <div><dt>TDek (K)</dt><dd>${f1(m.td_ek)}</dd></div>
        <div><dt>U kaca</dt><dd>${f2(m.u_f)}</dd></div>
        <div><dt>ΔT (K)</dt><dd>${f1(m.delta_t)}</dd></div>
        <div><dt>SC kaca</dt><dd>${f3(m.sc_k)}</dd></div>
        <div><dt>Faktor peneduh</dt><dd>${f3(m.sc_eff)}</dd></div>
        <div><dt>SF (W/m²)</dt><dd>${f0(m.sf ?? r.sni_sf_wm2)}</dd></div>
      </dl>
      ${m.formula_substitution ? `<p class="formula">${esc(m.formula_substitution)}</p>` : ''}
      <div class="terms">
        <div style="--c:${PART_C.w}"><span>Dinding</span><b>${f2(r.q_wall_conduction_wm2)}</b></div>
        <div style="--c:${PART_C.g}"><span>Kaca (konduksi)</span><b>${f2(r.q_glass_conduction_wm2)}</b></div>
        <div style="--c:${PART_C.s}"><span>Kaca (radiasi)</span><b>${f2(r.q_solar_radiation_wm2)}</b></div>
      </div>
    </div>`;
  };
  // halaman pertama memuat pengantar, jadi dua sisi; halaman berikutnya tiga sisi
  for (let i = 0; i < sides.length; i += i === 0 ? 2 : 3) {
    const n = i === 0 ? 2 : 3;
    pages.push(`<section class="page">${head}
      ${i === 0 ? `<p class="kicker">Rincian per sisi</p><h2>Hitungan OTTV tiap sisi</h2>
        <p class="lead">Setiap sisi dihitung dengan rumus SNI 6389:2020 memakai nilai di bawah. Angka sama dengan sheet per arah di laporan Excel.</p>` : ''}
      ${sides.slice(i, i + n).map(sideCard).join('')}
    </section>`);
  }

  // 4. Material (+ RTTV bila berlaku)
  const matCard = (title, color, nameText, brand, items) => `<div class="mat"><span class="chip" style="background:${color}"></span><div>
    <h3>${title}</h3><p>${esc(nameText || '-')}${brand ? ` · ${esc(brand)}` : ''}</p>${stats(items)}</div></div>`;
  const hexOf = (id, cat) => {
    const list = Array.isArray(state.materials) ? state.materials : state.materials?.materials || [];
    const m = [...list, ...(state.config?.settings?.custom_materials || [])].find((x) => x?.id === id);
    return m?.color_hex || { glazing: '#6898ba', wall: '#c4bdb2', frame: '#5c5a54', roof: '#8e877c' }[cat];
  };
  pages.push(`<section class="page">${head}
    <p class="kicker">Material</p><h2>Material selubung yang dihitung</h2>
    <p class="lead">Nilai termal di bawah adalah yang dipakai engine. Warna kotak hanya penanda tampilan, tidak ikut dihitung.</p>
    ${matCard('Kaca', hexOf(mat.glazing_id, 'glazing'), mat.glazing_name, mat.glazing_brand, [['SC', f3(mat.sc_glass)], ['SHGC', f3(mat.shgc_glass)], ['U kaca → U_f', `${f2(s.avg_u_cog_wm2k ?? mat.u_cog)} → ${f2(s.avg_u_fen_wm2k ?? mat.u_fenestration)}`], ['ΔT', `${f1(mat.delta_t)} K`]])}
    ${matCard('Dinding', hexOf(mat.wall_id, 'wall'), mat.wall_name, mat.wall_brand, [['α', f2(mat.alpha_wall)], ['U dinding', f2(mat.u_wall)], ['TDek', `${f1(mat.td_ek)} K`], ['', '']].filter((x) => x[0]))}
    ${mat.frame_name ? matCard('Rangka & Kusen (SNI 4.3.2.2 & Tabel 3)', hexOf(mat.frame_id, 'frame'), mat.frame_name, s.frame_source === 'terukur' ? 'Terukur dari model' : 'Lebar kusen asumsi', [['U_frame', f2(s.u_frame_eff_wm2k ?? mat.u_frame)], ['Lebar kusen', `${f1(s.frame_width_mm ?? mat.frame_width_mm ?? 50)} mm (${esc(s.frame_source || 'asumsi pengguna')})`], ['Fraksi rangka r', `${f1(s.frame_ratio_pct ?? (100 * Number(s.total_a_frame_m2 || 0)) / Math.max(0.01, Number(s.total_glazing_area_m2 || 1)))}%`], ['A_frame / A_edge', `${f2(s.total_a_frame_m2 ?? 0)} / ${f2(s.total_a_edge_m2 ?? 0)} m²`]]) : ''}
    ${hasRttv ? (() => {
      const rSv = sideVerdict(Number(rttv.rttv_wm2 || 0), Number(rttv.limit_wm2 ?? 10), vi.verdict);
      return `<div class="card" style="margin-top:6mm"><p class="kicker">Atap</p><h3>RTTV ${f2(rttv.rttv_wm2)} W/m² ${pillCls(rSv.pillClass, rSv.text)}</h3>
      ${stats([['Batas', `${f0(rttv.limit_wm2 ?? 10)} W/m²`], ['Luas atap', `${f1(rttv.total_roof_area_m2)} m²`], ['Skylight', `${f1(rttv.skylight_area_m2)} m²`], ['Porsi skylight', pct(rttv.srr)]])}</div>`;
    })() : ''}
  </section>`);

  // 5. Referensi dan catatan
  const sf = a.location_info?.sf_table || {};
  const order = ['U', 'TL', 'T', 'TGR', 'S', 'BD', 'B', 'BL'];
  pages.push(`<section class="page">${head}
    <p class="kicker">Referensi</p><h2>Rumus, data, dan catatan</h2>
    <div class="card section"><h3>Rumus OTTV (SNI 6389:2020)</h3>
      <p class="formula" style="margin:0">OTTV = α · U<sub>w</sub> · (1 − WWR) · TD<sub>ek</sub> + U<sub>f</sub> · WWR · ΔT + SF · WWR · SC</p>
      <p class="muted" style="font-size:8pt;margin:3mm 0 0">OTTV gedung = rata-rata OTTV tiap sisi, ditimbang luas sisi. Batas SNI: ${f0(limit)} W/m².</p></div>
    <div class="card section"><h3>Faktor radiasi matahari (SF) dipakai</h3>
      <table><thead><tr>${order.map((c) => `<th class="r">${esc(c === 'TGR' ? 'TG' : c)}</th>`).join('')}</tr></thead>
      <tbody><tr>${order.map((c) => `<td class="r">${f0(sf[c])}</td>`).join('')}</tr></tbody></table>
      <p class="muted" style="font-size:8pt;margin:2.5mm 0 0">Sumber: ${esc(a.sf_source_label || 'Tabel 8 SNI 6389:2020')}. Lokasi ${esc(a.location_info?.city || '-')}${a.location_info?.station ? `, stasiun ${esc(a.location_info.station)}` : ''}.</p></div>
    <div class="card"><h3>Catatan</h3><ul class="notes">
      <li>Model: ${esc(a.filename || '-')} (${esc(a.format || '')}). Mode: ${esc(a.mode_label || '-')}.</li>
      ${Number(s.total_glazing_area_m2 || 0) > 0.01 ? `<li>Fenestrasi tiga zona (SNI 6389:2020 butir 4.3.2.2 dan Tabel 3): U kaca ${f2(s.avg_u_cog_wm2k ?? mat.u_cog)} → U<sub>f</sub> ${f2(s.avg_u_fen_wm2k ?? mat.u_fenestration)} W/m²K (U<sub>frame</sub> ${f2(s.u_frame_eff_wm2k ?? mat.u_frame)} W/m²K), A<sub>frame</sub> ${f2(s.total_a_frame_m2 ?? 0)} m² (r = ${f1(s.frame_ratio_pct ?? 0)}%), A<sub>edge</sub> ${f2(s.total_a_edge_m2 ?? 0)} m², lebar kusen ${f1(s.frame_width_mm ?? 50)} mm (sumber: ${esc(s.frame_source || 'asumsi pengguna')}${s.frame_source !== 'terukur' ? ' — Lebar kusen asumsi' : ''}).</li>` : ''}
      <li>Luas, porsi kaca, dan orientasi tiap bidang dibaca otomatis dari model 3D. Periksa hasil pengelompokan bidang di aplikasi bila ada keraguan.</li>
      <li>Rincian tiap bidang dan rumus yang bisa ditelusuri ada di laporan Excel LUXA.</li>
      <li>Laporan ini membantu analisis desain. Untuk pengajuan resmi, sertakan perhitungan yang diperiksa oleh tenaga ahli.</li>
    </ul></div>
  </section>`);

  const total = pages.length;
  const foot = (i) => `<div class="foot"><span>LUXA by Alf Studio${version ? ` · v${esc(version)}` : ''} · ${esc(name)}</span><span>${i + 1} / ${total}</span></div>`;
  const body = pages.map((p, i) => p.replace(/<\/section>$/, `${foot(i)}</section>`)).join('\n');
  const title = `Laporan_OTTV_LUXA_${name.replace(/[^A-Za-z0-9]+/g, '_')}`;
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz@1,6..72&display=swap" rel="stylesheet">
<style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
  return { html, title };
}
