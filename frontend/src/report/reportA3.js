// Laporan OTTV A3 (eksplorasi): sampul, ringkasan dasbor, sisi terpanas. theme: light|dark, orient: landscape|portrait.
import { escapeHtml as esc } from '../ui/escapeHtml.js';
import { sidesOf, sideName, projectName } from '../present/content.js';
import { heatColor } from '../present/heat.js';
import { ringChart, gauge, sunPath, wallSection, floorStack, PATHS } from './charts.js';
import { A3_CSS } from './a3Css.js';

const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = (v) => nf(0).format(Number(v) || 0);
const f1 = (v) => nf(1).format(Number(v) || 0);
const f2 = (v) => nf(2).format(Number(v) || 0);
const f3 = (v) => nf(3).format(Number(v) || 0);
const pct = (v) => `${f0((Number(v) || 0) * 100)}%`;
const LIGHT = { ink: '#1E1F24', muted: '#6F675B', line: 'rgba(30,31,36,0.16)', track: 'rgba(30,31,36,0.08)', pWall: '#A79E90', pGlass: '#4F8FB5', pSun: '#E8890C' };
const DARK = { ink: '#F1EEE8', muted: '#AAA59C', line: 'rgba(255,255,255,0.18)', track: 'rgba(255,255,255,0.1)', pWall: '#B9B3A8', pGlass: '#7FB6D8', pSun: '#F6B24A' };
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

  // 02 Ringkasan (dasbor)
  const sideRows = sides.map((r) => {
    const max = Math.max(limit * 1.35, ...sides.map((x) => x.ottv_orientation_wm2));
    const okS = r.ottv_orientation_wm2 <= limit;
    return `<div class="srow${r.code === hot?.code ? ' hot' : ''}"><span>${esc(sideName(r.code))}</span><i style="--w:${((r.ottv_orientation_wm2 / max) * 100).toFixed(1)}%;--c:${heatColor(r.ottv_orientation_wm2)}"></i><b>${f1(r.ottv_orientation_wm2)}</b><span class="st ${okS ? 'ok' : 'fail'}">${okS ? 'Memenuhi' : 'Melebihi'}</span></div>`;
  }).join('');
  const total = PATHS.reduce((t, p) => t + Number(s[p.field] || 0), 0) || 1;
  const legend = PATHS.map((p) => `<div><i style="background:${p.color(T)}"></i><span>${p.label}</span><b>${f2(s[p.field])}</b><em>${f0((Number(s[p.field] || 0) / total) * 100)}%</em></div>`).join('');
  const comp = assets.compass;
  const compassHtml = comp ? `<div class="compass"><div class="cw" style="aspect-ratio:${comp.aspect}"><img src="${comp.img}" alt="Kompas panas 3D">${comp.labels.map((l) => `<span class="clabel" style="left:${l.top.x}%;top:${l.top.y - 2}%"><span>${l.code === 'TGR' ? 'TG' : l.code}</span>${f1(l.v)}</span>`).join('')}</div></div>` : '';
  pages.push(`<section class="page">${blobs}
    <div class="inner" style="grid-template-rows:auto 1fr">
      ${hd('02', 'Ringkasan hasil', 'Ke mana panas masuk, dari sisi mana, dan seberapa jauh dari batas')}
      <div class="dash">
        <div class="glass card">
          <p class="kick">OTTV total</p>
          <div class="big">${f2(a.ottv_total_wm2)}<span class="unit">W/m²</span></div>
          <div style="margin:3mm 0 2mm">${pill(ok)}</div>
          ${gauge(a.ottv_total_wm2, limit, T)}
        </div>
        <div class="glass card">
          <p class="kick">Asal panas</p><p class="ttl">${Number(s.q_solar_radiation_wm2) / total >= 0.5 ? 'Sinar matahari lewat kaca paling besar' : 'Panas terbagi beberapa jalur'}</p>
          <p class="sub">Tiga jalur rumus SNI, dijumlah menjadi OTTV.</p>
          <div class="ringwrap">${ringChart(s, a.ottv_total_wm2, T)}<div class="legend">${legend}</div></div>
        </div>
        <div class="glass card">
          <p class="kick">Lintasan matahari</p><p class="ttl">${esc(a.location_info?.city || '')} · ${f1(Math.abs(lat))}° ${lat < 0 ? 'LS' : 'LU'}</p>
          ${sunPath({ lat, sides, date: state.sunDate, hour: Number(state.sunHour ?? 15) }, T, { size: 300 })}
          <div class="keys"><span><i class="solid"></i>21 Mar / 23 Sep</span><span><i class="dash"></i>21 Jun · 21 Des</span><span><i class="dot"></i>matahari saat ini</span></div>
        </div>
        <div class="glass card ${L ? 'span2' : 'span2 order-last'}">
          <p class="kick">Kompas panas 3D</p><p class="ttl">Tinggi juring = OTTV tiap sisi, cincin kaca = batas ${f0(limit)} W/m²</p>
          ${compassHtml}
        </div>
        <div class="glass card">
          <p class="kick">Per sisi</p><p class="ttl">Sisi ${esc(sideName(hot?.code))} paling panas</p>
          <div class="sides">${sideRows}</div>
          ${L ? '' : ''}
        </div>
      </div>
    </div>
    <div class="ft"><span>LUXA by Alf Studio${version ? ` · v${esc(version)}` : ''}</span><span>2</span></div>
  </section>`);

  // 03 Sisi terpanas
  const m = hot?.manual_calc || {};
  const fac = assets.facades;
  pages.push(`<section class="page">${blobs}
    <div class="inner" style="grid-template-rows:auto 1fr">
      ${hd('03', `Sisi ${esc(sideName(hot?.code))}`, 'Sisi dengan OTTV tertinggi, dibedah dari gambar sampai rumus')}
      <div class="deep">
        <div class="glass photo ${L ? '' : 'span2'}">${assets.terpanas ? `<img src="${assets.terpanas}" alt="">` : ''}
          <div class="glass over"><p class="kick">OTTV sisi ${esc(sideName(hot?.code))}</p><div class="big">${f2(hot?.ottv_orientation_wm2)}<span class="unit">W/m²</span></div>
          <div style="margin-top:3mm">${pill(hot?.ottv_orientation_wm2 <= limit, hot?.ottv_orientation_wm2 <= limit ? 'Memenuhi' : 'Melebihi batas')}</div></div>
        </div>
        <div class="glass card">
          <p class="kick">Potongan dinding</p><p class="ttl">Tebal panah = besar panas tiap jalur (W/m²)</p>
          ${wallSection(hot, s, T)}
        </div>
        <div class="glass card ${L ? '' : ''}">
          <p class="kick">Nilai yang dihitung</p>
          <dl class="inputs">
            <div><dt>Luas A₀</dt><dd>${f0(m.ao_m2 ?? hot?.total_area_m2)} m²</dd></div><div><dt>WWR</dt><dd>${f3(m.wwr ?? hot?.wwr)}</dd></div>
            <div><dt>α dinding</dt><dd>${f2(m.alpha)}</dd></div><div><dt>U dinding</dt><dd>${f2(m.u_wall)}</dd></div><div><dt>TDek</dt><dd>${f1(m.td_ek)} K</dd></div>
            <div><dt>U kaca</dt><dd>${f2(m.u_f)}</dd></div><div><dt>ΔT</dt><dd>${f1(m.delta_t)} K</dd></div><div><dt>SC kaca</dt><dd>${f3(m.sc_k)}</dd></div>
            <div><dt>Faktor peneduh</dt><dd>${f3(m.sc_eff)}</dd></div><div><dt>SF</dt><dd>${f0(m.sf ?? hot?.sni_sf_wm2)}</dd></div>
          </dl>
          ${m.formula_substitution ? `<p class="formula">${esc(m.formula_substitution)}</p>` : ''}
        </div>
        <div class="glass card ${L ? '' : 'span2'}">
          <p class="kick">Fasad terbentang 360°</p><p class="ttl">Selubung dibuka melingkar dari utara searah jarum jam; tiap panel diwarnai OTTV-nya</p>
          ${fac ? `<div class="facades"><div class="fw" style="aspect-ratio:${fac.aspect}"><img src="${fac.img}" alt=""><div class="flabels">${fac.labels.map((l) => `<span class="${l.code === hot?.code ? 'hot' : ''}" style="left:${l.x}%">${l.code === 'TGR' ? 'TG' : l.code}<b>${f1(l.v)}</b></span>`).join('')}</div></div></div>` : ''}
          <div class="scale"><span>0</span><i></i><span>50+ W/m²</span></div>
        </div>
      </div>
    </div>
    <div class="ft"><span>LUXA by Alf Studio</span><span>3</span></div>
  </section>`);

  const title = `Laporan_OTTV_LUXA_${name.replace(/[^A-Za-z0-9]+/g, '_')}`;
  const size = L ? 'A3 landscape' : 'A3 portrait';
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Newsreader:ital,opsz@1,6..72&display=swap" rel="stylesheet">
<style>${A3_CSS}@page { size: ${size}; }</style></head><body class="rp ${theme} ${orient}">${pages.join('\n')}</body></html>`;
  return { html, title };
}
