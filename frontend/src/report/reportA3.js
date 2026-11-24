// Laporan OTTV A3 (eksplorasi): sampul, ringkasan dasbor, sisi terpanas. theme: light|dark, orient: landscape|portrait.
import { escapeHtml as esc } from '../ui/escapeHtml.js';
import { sidesOf, sideName, projectName } from '../present/content.js';
import { heatColor } from '../present/heat.js';
import { ringChart, sunPath, limitRuler, facadeTile, PATHS } from './charts.js';
import { A3_CSS } from './a3Css.js';

const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = (v) => nf(0).format(Number(v) || 0);
const f1 = (v) => nf(1).format(Number(v) || 0);
const f2 = (v) => nf(2).format(Number(v) || 0);
const f3 = (v) => nf(3).format(Number(v) || 0);
const pct = (v) => `${f0((Number(v) || 0) * 100)}%`;
const LIGHT = { ink: '#1E1F24', muted: '#6F675B', line: 'rgba(30,31,36,0.16)', track: 'rgba(30,31,36,0.08)', pWall: '#A79E90', pGlass: '#4F8FB5', pSun: '#E8890C', ok: '#0F6E66', fail: '#B3261E', surface: '#FFFFFF' };
const DARK = { ink: '#F1EEE8', muted: '#AAA59C', line: 'rgba(255,255,255,0.18)', track: 'rgba(255,255,255,0.1)', pWall: '#B9B3A8', pGlass: '#7FB6D8', pSun: '#F6B24A', ok: '#5EC4BA', fail: '#F2867E', surface: '#1F2024' };
const pill = (ok, t) => `<span class="pill ${ok ? 'ok' : 'fail'}">${t || (ok ? 'Memenuhi SNI' : 'Melebihi batas')}</span>`;

export function buildReportA3(state, { theme = 'dark', orient = 'landscape', userName = '', assets = {}, logoUrl = '', date = new Date(), version = '' } = {}) {
  const T = theme === 'dark' ? DARK : LIGHT;
  const a = state.analysisData;
  const s = a.summary || {};
  const limit = Number(a.sni_limit_wm2 || 35);
  const ok = Boolean(a.compliant);
  const name = projectName(a);
  const sides = sidesOf(a);
  const hot = [...sides].sort((x, y) => y.ottv_orientation_wm2 - x.ottv_orientation_wm2)[0];
  const dateText = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  const lat = Number(a.location_info?.latitude_deg ?? -6.2);
  const L = orient === 'landscape';
  const blobs = '<i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>';
  const brand = `<div class="brand">${logoUrl ? `<img src="${esc(logoUrl)}" alt="LUXA">` : ''}Laporan OTTV · SNI 6389:2020<br>${esc(name)}</div>`;
  const hd = (no, title, en) => `<div class="hd"><div class="sec"><span class="no">${no}</span><div><h2>${title}</h2><div class="en">${en}</div></div></div>${brand}</div>`;
  const pages = [];

  // 01 Sampul
  pages.push(`<section class="page">
    ${assets.hero ? `<img class="cover-img" src="${assets.hero}" alt="">` : blobs}
    <div class="glass cover-panel">
      ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="LUXA">` : ''}
      <div>
        <p class="kick">Laporan OTTV · SNI 6389:2020</p>
        <h1>${esc(name)}</h1>
        ${userName ? `<p class="by">Disusun oleh <b>${esc(userName)}</b></p>` : ''}
      </div>
      <div class="cover-res">
        <div class="lbl">OTTV total gedung</div>
        <div class="big">${f2(a.ottv_total_wm2)}<span class="unit">W/m²</span></div>
        <div style="margin-top:4mm">${pill(ok)} <span class="unit" style="font-size:9pt">batas ${f0(limit)} W/m²</span></div>
        <dl class="meta">
          <div><dt>Lokasi</dt><dd>${esc(a.location_info?.city || '-')}</dd></div>
          <div><dt>Tanggal</dt><dd>${esc(dateText)}</dd></div>
          <div><dt>Jumlah lantai</dt><dd>${f0(s.total_floors)}</dd></div>
          <div><dt>Luas selubung</dt><dd>${f0(s.total_envelope_area_m2)} m²</dd></div>
        </dl>
      </div>
    </div>
    <div class="glass sunchip"><i></i>Matahari ${esc(String(state.sunHour ?? 15))}.00 · ${esc(new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date(state.sunDate || '2026-09-23')))}</div>
  </section>`);

  // 02 Ringkasan. Urutan baca: jawaban (judul) > OTTV + penggaris batas > tiga angka pendukung > rincian.
  const maxS = Math.max(limit * 1.35, ...sides.map((x) => x.ottv_orientation_wm2));
  const sideRows = sides.map((r) => {
    const okS = r.ottv_orientation_wm2 <= limit;
    return `<div class="srow${r.code === hot?.code ? ' hot' : ''}"><span>${esc(sideName(r.code))}</span><i style="--w:${((r.ottv_orientation_wm2 / maxS) * 100).toFixed(1)}%;--c:${heatColor(r.ottv_orientation_wm2)}"></i><b class="${okS ? 'ok' : 'fail'}">${f1(r.ottv_orientation_wm2)}</b></div>`;
  }).join('');
  const total = PATHS.reduce((t, p) => t + Number(s[p.field] || 0), 0) || 1;
  const legend = PATHS.map((p) => `<div><i style="background:${p.color(T)}"></i><span>${p.label}</span><b>${f2(s[p.field])}</b><em>${f0((Number(s[p.field] || 0) / total) * 100)}%</em></div>`).join('');
  const comp = assets.compass;
  const compassHtml = comp ? `<div class="compass"><div class="cw" style="aspect-ratio:${comp.aspect}"><img src="${comp.img}" alt="Kompas panas 3D">${comp.labels.map((l) => `<span class="clabel" style="left:${l.top.x}%;top:${l.top.y - 2}%"><span>${l.code === 'TGR' ? 'TG' : l.code}</span>${f1(l.v)}</span>`).join('')}</div></div>` : '';
  const solarShare = Number(s.q_solar_radiation_wm2 || 0) / total;
  const answer = ok ? `OTTV ${f2(a.ottv_total_wm2)} W/m², memenuhi batas SNI` : `OTTV ${f2(a.ottv_total_wm2)} W/m², melebihi batas SNI`;
  pages.push(`<section class="page">${blobs}
    <div class="inner">
      ${hd('02', 'Ringkasan hasil', 'Seberapa jauh dari batas, dari jalur mana, dan dari sisi mana panas masuk')}
      <div class="sum">
        <div class="panel kpi-main">
          <p class="kick">OTTV total gedung</p>
          <div class="kpi-row"><div class="big">${f2(a.ottv_total_wm2)}<span class="unit">W/m²</span></div>${pill(ok)}</div>
          ${limitRuler(a.ottv_total_wm2, limit, T)}
        </div>
        <div class="panel kpi"><p class="kick">Sisi terpanas</p><div class="mid">${esc(sideName(hot?.code))}</div><p class="note">${f1(hot?.ottv_orientation_wm2)} W/m² · ${hot?.ottv_orientation_wm2 <= limit ? 'memenuhi' : 'melebihi batas'}</p></div>
        <div class="panel kpi"><p class="kick">Porsi kaca (WWR)</p><div class="mid">${pct(s.effective_wwr)}</div><p class="note">${f0(s.total_glazing_area_m2)} dari ${f0(s.total_envelope_area_m2)} m²</p></div>
        <div class="panel kpi"><p class="kick">Sinar lewat kaca</p><div class="mid">${f0(solarShare * 100)}%</div><p class="note">bagian terbesar dari OTTV</p></div>
        <div class="panel paths"><p class="kick">Asal panas · tiga jalur rumus SNI</p>
          <div class="ringwrap">${ringChart(s, a.ottv_total_wm2, T, { size: 200 })}<div class="legend">${legend}</div></div></div>
        <div class="panel comp"><p class="kick">Kompas panas 3D · tinggi = OTTV sisi, cincin = batas ${f0(limit)}</p>${compassHtml}</div>
        <div class="panel side-list"><p class="kick">OTTV per sisi (W/m²) · <span class="ok">memenuhi</span> / <span class="fail">melebihi</span></p><div class="sides">${sideRows}</div></div>
      </div>
    </div>
    <div class="ft"><span>LUXA by Alf Studio${version ? ` · v${esc(version)}` : ''} · ${esc(name)}</span><span>2</span></div>
  </section>`);

  // 03 Sisi terpanas
  const m = hot?.manual_calc || {};
  const fac = assets.facades;
  const facLabels = fac ? fac.labels.map((l) => `<span class="${l.code === hot?.code ? 'hot' : ''}" style="left:${l.x}%">${l.code === 'TGR' ? 'TG' : l.code}<b>${f1(l.v)}</b></span>`).join('') : '';
  pages.push(`<section class="page">${blobs}
    <div class="inner">
      ${hd('03', `Sisi ${esc(sideName(hot?.code))}`, 'Sisi dengan OTTV tertinggi, dari gambar sampai rumus')}
      <div class="deep">
        <div class="photo">${assets.terpanas ? `<img src="${assets.terpanas}" alt="">` : ''}
          <div class="glass over"><p class="kick">OTTV sisi ${esc(sideName(hot?.code))}</p><div class="big">${f2(hot?.ottv_orientation_wm2)}<span class="unit">W/m²</span></div>
          <div class="over-meta">${pill(hot?.ottv_orientation_wm2 <= limit, hot?.ottv_orientation_wm2 <= limit ? 'Memenuhi' : 'Melebihi batas')}<span>${f0(hot?.total_area_m2)} m² · kaca ${pct(hot?.wwr)}</span></div></div>
        </div>
        <div class="panel tilep"><p class="kick">Ke mana panas masuk · skema 1 m² fasad</p>${facadeTile(hot, T, L ? { w: 340, h: 300 } : { w: 420, h: 260 })}
          <p class="note">Tebal panah = besar panas (W/m²). Skema proporsi kaca dan dinding sisi ini, bukan potongan gedung.</p></div>
        <div class="panel calc"><p class="kick">Nilai yang dihitung</p>
          <dl class="inputs">
            <div><dt>Luas A₀</dt><dd>${f0(m.ao_m2 ?? hot?.total_area_m2)} m²</dd></div><div><dt>WWR</dt><dd>${f3(m.wwr ?? hot?.wwr)}</dd></div>
            <div><dt>α dinding</dt><dd>${f2(m.alpha)}</dd></div><div><dt>U dinding</dt><dd>${f2(m.u_wall)}</dd></div><div><dt>TDek</dt><dd>${f1(m.td_ek)} K</dd></div>
            <div><dt>U<sub>f</sub> 3-zona</dt><dd>${f2(m.u_f)}</dd></div><div><dt>ΔT</dt><dd>${f1(m.delta_t)} K</dd></div><div><dt>SC kaca</dt><dd>${f3(m.sc_k)}</dd></div>
            <div><dt>Faktor peneduh</dt><dd>${f3(m.sc_eff)}</dd></div><div><dt>SF</dt><dd>${f0(m.sf ?? hot?.sni_sf_wm2)}</dd></div>
          </dl>
          ${Number(s.total_glazing_area_m2 || 0) > 0.01 ? `<p class="note" style="margin-top:2mm">Kusen 3-zona: U<sub>f</sub> rata-rata ${f2(s.avg_u_fen_wm2k ?? m.u_f)} W/m²K · A<sub>frame</sub> ${f2(s.total_a_frame_m2 ?? 0)} m² · A<sub>edge</sub> ${f2(s.total_a_edge_m2 ?? 0)} m² · lebar kusen ${f1(s.frame_width_mm ?? 50)} mm (${esc(s.frame_source || 'asumsi pengguna')}${s.frame_source !== 'terukur' ? ' · Lebar kusen asumsi' : ''}).</p>` : ''}
          ${m.formula_substitution ? `<p class="formula">${esc(m.formula_substitution)}</p>` : ''}
        </div>
        <div class="panel facp"><div class="facp-hd"><p class="kick">Fasad terbentang 360° · selubung dibuka searah jarum jam, tiap panel diwarnai OTTV-nya</p>
          <div class="scale"><span>0</span><i></i><span>50+ W/m²</span></div></div>
          ${fac ? `<div class="facades"><div class="fw" style="--ar:${fac.aspect}"><img src="${fac.img}" alt=""><div class="flabels">${facLabels}</div></div></div>` : ''}
        </div>
      </div>
    </div>
    <div class="ft"><span>LUXA by Alf Studio · ${esc(name)}</span><span>3</span></div>
  </section>`);

  const title = `Laporan_OTTV_LUXA_${name.replace(/[^A-Za-z0-9]+/g, '_')}`;
  const size = L ? 'A3 landscape' : 'A3 portrait';
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Newsreader:ital,opsz@1,6..72&display=swap" rel="stylesheet">
<style>${A3_CSS}@page { size: ${size}; }</style></head><body class="rp ${theme} ${orient}">${pages.join('\n')}</body></html>`;
  return { html, title };
}
