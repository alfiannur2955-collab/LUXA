/**
 * Belajar OTTV: 7 bab + bonus RTTV. Tiap bab = materi singkat + satu simulasi kecil.
 * Simulasi memperbarui DOM-nya sendiri (tanpa render ulang aplikasi) supaya slider mulus.
 * Angka memakai rumus & tabel yang sama dengan engine (lihat learn/ottvCalc.js).
 */

import { fmtId } from '../ui/escapeHtml.js';
import { icon } from '../ui/icons.js';
import { renderLux } from '../ui/mascot.js';
import { SNI } from './sniData.js';
import { cityById, facadeOttv, rttv, sceffHorizontal, totalOttv } from './ottvCalc.js';

const DIRS = [
  ['U', 'Utara'],
  ['TL', 'Timur Laut'],
  ['T', 'Timur'],
  ['TGR', 'Tenggara'],
  ['S', 'Selatan'],
  ['BD', 'Barat Daya'],
  ['B', 'Barat'],
  ['BL', 'Barat Laut'],
];
const DIR_NAME = Object.fromEntries(DIRS);

// Keadaan simulasi bertahan selama sesi (pindah bab tidak mengulang dari awal).
const sim = {
  city: 'jakarta',
  wwr: 0.4,
  glass: 'glz_kaca_tinted_8',
  wall: 'wal_bata_ringan_aac_100',
  dir: 'B',
  overhang: 0.5,
  alphaOverride: null,
  sides: { U: { area: 400, wwr: 0.4 }, T: { area: 300, wwr: 0.4 }, S: { area: 400, wwr: 0.4 }, B: { area: 300, wwr: 0.4 } },
  roof: 'rf_dak_beton_120_insulasi',
  sky: 0,
  roofArea: 600,
};

const glassById = (id) => SNI.glass.find((g) => g.id === id) || SNI.glass[0];
const wallById = (id) => SNI.wall.find((w) => w.id === id) || SNI.wall[0];
const roofById = (id) => SNI.roof.find((r) => r.id === id) || SNI.roof[0];

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c) e.append(c);
  return e;
}

function para(...texts) {
  return texts.map((t) => el('p', { class: 'learn-p', html: t }));
}

function slider({ label, min, max, step, value, fmt, onInput }) {
  const out = el('b', { class: 'num', text: fmt(value) });
  const inp = el('input', { type: 'range', min, max, step, value, 'aria-label': label });
  inp.addEventListener('input', () => {
    const v = Number(inp.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  return el('label', { class: 'learn-ctl' }, el('span', { text: label }), inp, out);
}

function select({ label, options, value, onChange }) {
  const s = el('select', { class: 'field-select field-select-sm', 'aria-label': label });
  for (const [v, t] of options) {
    const o = el('option', { value: v, text: t });
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return el('label', { class: 'learn-ctl' }, el('span', { text: label }), s);
}

const fmtW = (v) => `${fmtId(v, 1)} W/m²`;
const pct = (v) => `${Math.round(v * 100)}%`;

/** Batang bertumpuk 3 suku + garis batas. */
function termBar(limit = SNI.ottvLimit, maxV = 80) {
  const wrap = el('div', { class: 'learn-bar' });
  const track = el('div', { class: 'learn-bar-track' });
  const sW = el('i', { class: 'seg seg-wall' });
  const sG = el('i', { class: 'seg seg-glass' });
  const sS = el('i', { class: 'seg seg-solar' });
  const lim = el('i', { class: 'learn-bar-limit' });
  lim.style.left = `${(limit / maxV) * 100}%`;
  track.append(sW, sG, sS, lim);
  const totalEl = el('div', { class: 'learn-bar-total num' });
  const legend = el(
    'div',
    { class: 'learn-legend' },
    el('span', {}, el('i', { class: 'dot seg-wall' }), 'Konduksi dinding ', el('b', { class: 'num lw' })),
    el('span', {}, el('i', { class: 'dot seg-glass' }), 'Konduksi kaca ', el('b', { class: 'num lg' })),
    el('span', {}, el('i', { class: 'dot seg-solar' }), 'Radiasi lewat kaca ', el('b', { class: 'num ls' })),
  );
  wrap.append(track, totalEl, legend);
  const update = (r, lbl = 'OTTV') => {
    const w = (v) => `${Math.min(100, (v / maxV) * 100)}%`;
    sW.style.width = w(r.qWall);
    sG.style.width = w(r.qGlass);
    sS.style.width = w(r.qSolar);
    legend.querySelector('.lw').textContent = fmtId(r.qWall, 1);
    legend.querySelector('.lg').textContent = fmtId(r.qGlass, 1);
    legend.querySelector('.ls').textContent = fmtId(r.qSolar, 1);
    const ok = r.total <= limit;
    totalEl.innerHTML = `${lbl} <b>${fmtId(r.total, 1)}</b> W/m² <span class="chip ${ok ? 'st-ok' : 'st-fail'}">${ok ? `memenuhi (≤ ${limit})` : `melebihi batas ${limit}`}</span>`;
  };
  return { el: wrap, update };
}

function facadeFor(dir, wwr = sim.wwr, glassId = sim.glass, wallId = sim.wall, overhang = sim.overhang) {
  const c = cityById(sim.city);
  const g = glassById(glassId);
  const w = wallById(wallId);
  return facadeOttv({
    alpha: sim.alphaOverride ?? w.alpha,
    uw: w.u_value,
    massa: w.massa_kg_m2,
    wwr,
    uf: g.u_value,
    sc: g.sc,
    sf: c.sf[dir],
    overhangR: overhang,
    code: dir,
  });
}

/** Gambar fasad sederhana: dinding dengan jendela (lebar ∝ WWR) dan overhang. */
function facadeDrawing() {
  const svg = el('div', { class: 'learn-facade' });
  const update = (wwr, overhang = 0) => {
    const W = 220;
    const H = 150;
    const winH = 70;
    const winW = Math.max(4, Math.min(200, (wwr * W * H) / winH));
    const x = (W - winW) / 2;
    const y = 40;
    const oh = Math.min(60, overhang * winH * 0.6);
    svg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Fasad dengan WWR ${pct(wwr)}">
      <rect x="0" y="0" width="${W}" height="${H}" rx="6" fill="var(--data-wall)" opacity="0.55"/>
      <rect x="${x}" y="${y}" width="${winW}" height="${winH}" rx="2" fill="var(--data-glazing)" opacity="0.85"/>
      ${oh > 1 ? `<rect x="${x}" y="${y}" width="${winW}" height="${Math.min(winH, oh)}" fill="var(--ink)" opacity="0.22"/>
      <rect x="${x - 6}" y="${y - 6}" width="${winW + 12}" height="6" rx="1.5" fill="var(--ink)" opacity="0.8"/>
      <text x="${x + winW / 2}" y="${y - 10}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink)">overhang · bayangan di kaca</text>` : ''}
      <text x="8" y="${H - 8}" font-size="11" fill="var(--ink)" font-weight="700">WWR ${pct(wwr)}</text>
    </svg>`;
  };
  return { el: svg, update };
}

// ---------------------------------------------------------------------------
// Bab
// ---------------------------------------------------------------------------

const CHAPTERS = [
  {
    id: 'apa',
    title: 'Apa itu OTTV?',
    lux: 'Bayangkan selubung gedung seperti jaket. Makin bagus jaketnya, makin sedikit panas yang masuk.',
    body: () =>
      para(
        '<b>OTTV</b> (Overall Thermal Transfer Value) adalah rata-rata panas dari luar yang masuk lewat dinding luar bangunan, dihitung dalam <b>watt per meter persegi</b> selubung.',
        'Makin kecil OTTV, makin ringan kerja AC, makin hemat listrik. Karena itu SNI 6389:2020 membatasi OTTV <b>paling tinggi 35 W/m²</b>.',
        'Coba bandingkan tiga fasad yang menghadap Barat di Jakarta di bawah ini.',
      ),
    sim: () => {
      const presets = [
        ['Kaca penuh, kaca polos', { wwr: 0.9, glass: 'glz_kaca_polos_8', wall: 'wal_spandrel_tanpa_insulasi', overhang: 0 }],
        ['Kaca 40%, kaca warna', { wwr: 0.4, glass: 'glz_kaca_tinted_8', wall: 'wal_bata_ringan_aac_100', overhang: 0.5 }],
        ['Hemat', { wwr: 0.3, glass: 'glz_kaca_lowe_single_8', wall: 'wal_bata_ringan_aac_cat_putih', overhang: 0.8 }],
      ];
      const box = el('div', { class: 'learn-sim' });
      for (const [name, p] of presets) {
        const r = facadeFor('B', p.wwr, p.glass, p.wall, p.overhang);
        const bar = termBar();
        bar.update(r);
        box.append(el('div', { class: 'learn-preset' }, el('h4', { text: name }), el('p', { class: 'muted learn-small', text: `WWR ${pct(p.wwr)} · ${glassById(p.glass).name} · ${p.overhang ? `overhang R ${p.overhang}` : 'tanpa peneduh'}` }), bar.el));
      }
      return box;
    },
  },
  {
    id: 'jalur',
    title: 'Tiga jalur panas',
    lux: 'Panas punya tiga jalan masuk. Yang paling besar biasanya lewat kaca.',
    body: () =>
      para(
        '<span class="t-wall">1. Konduksi dinding</span>: dinding dipanaskan matahari lalu meneruskan panasnya ke dalam. Besarnya bergantung pada nilai U dinding, warna (α), dan beda temperatur ekuivalen (TDek) yang ditentukan dari berat dinding.',
        '<span class="t-glass">2. Konduksi kaca</span>: udara luar lebih panas dari dalam. SNI memakai selisih tetap <b>ΔT = 5 K</b>.',
        '<span class="t-solar">3. Radiasi lewat kaca</span>: sinar matahari langsung menembus kaca. Besarnya bergantung pada koefisien peneduh (SC) kaca dan faktor radiasi matahari (SF) arah fasad.',
        'Ketiganya dijumlahkan:',
      ),
    sim: () => {
      const box = el('div', { class: 'learn-sim' });
      const eq = el('div', { class: 'learn-eq formula' });
      const bar = termBar();
      const update = () => {
        const c = cityById(sim.city);
        const g = glassById(sim.glass);
        const w = wallById(sim.wall);
        const r = facadeFor(sim.dir);
        eq.innerHTML = `OTTV = <span class="t-wall">α·U<sub>w</sub>·(1−WWR)·TD<sub>ek</sub></span> + <span class="t-glass">U<sub>f</sub>·WWR·ΔT</span> + <span class="t-solar">SC·WWR·SF</span><br>
          <span class="num learn-small">= <span class="t-wall">${fmtId(w.alpha, 2)}·${fmtId(w.u_value, 2)}·${fmtId(1 - sim.wwr, 2)}·${r.tdek}</span> + <span class="t-glass">${fmtId(g.u_value, 2)}·${fmtId(sim.wwr, 2)}·5</span> + <span class="t-solar">${fmtId(r.scEff, 3)}·${fmtId(sim.wwr, 2)}·${c.sf[sim.dir]}</span></span>`;
        bar.update(r);
      };
      box.append(eq, bar.el, el('p', { class: 'muted learn-small', text: `Contoh: fasad ${DIR_NAME[sim.dir]} ${cityById(sim.city).name}, WWR ${pct(sim.wwr)}, ${glassById(sim.glass).name}.` }));
      update();
      return box;
    },
  },
  {
    id: 'wwr',
    title: 'WWR: seberapa banyak kaca',
    lux: 'Geser WWR dan lihat bagian oranye. Radiasi naik paling cepat saat kaca bertambah.',
    body: () =>
      para(
        '<b>WWR</b> (Window to Wall Ratio) adalah perbandingan luas kaca dengan luas seluruh dinding di satu sisi. WWR 40% berarti 40% bidang fasad itu kaca.',
        'Kaca meneruskan panas jauh lebih banyak daripada dinding, terutama lewat radiasi. Jadi menambah kaca hampir selalu menaikkan OTTV.',
      ),
    sim: () => {
      const box = el('div', { class: 'learn-sim learn-sim-2col' });
      const draw = facadeDrawing();
      const bar = termBar();
      const update = () => {
        draw.update(sim.wwr, sim.overhang);
        bar.update(facadeFor(sim.dir));
      };
      const ctl = el(
        'div',
        { class: 'learn-ctls' },
        slider({ label: 'WWR', min: 0, max: 1, step: 0.05, value: sim.wwr, fmt: pct, onInput: (v) => { sim.wwr = v; update(); } }),
        el('p', { class: 'muted learn-small', text: `Fasad ${DIR_NAME[sim.dir]}, ${cityById(sim.city).name}, ${glassById(sim.glass).name}.` }),
      );
      box.append(el('div', {}, draw.el, ctl), bar.el);
      update();
      return box;
    },
  },
  {
    id: 'arah',
    title: 'Arah hadap dan faktor radiasi (SF)',
    lux: 'Sisi Barat kena matahari sore yang terik. Klik tiap arah di kompas!',
    body: () =>
      para(
        'Matahari tidak menyinari semua sisi sama banyak. SNI memberi <b>faktor radiasi matahari (SF)</b> untuk 8 arah di 54 kota (Tabel 8).',
        'Di Jakarta, sisi <b>Barat</b> paling berat (SF 197) dan <b>Selatan</b> paling ringan (SF 112). Karena itu fasad yang sama bisa memenuhi di satu sisi, tapi melebihi batas di sisi lain.',
      ),
    sim: () => {
      const box = el('div', { class: 'learn-sim learn-sim-2col' });
      const rose = el('div', { class: 'learn-rose' });
      const bar = termBar();
      const info = el('p', { class: 'muted learn-small' });
      const update = () => {
        const c = cityById(sim.city);
        const max = Math.max(...DIRS.map(([d]) => c.sf[d]));
        rose.innerHTML = '';
        DIRS.forEach(([d, n], i) => {
          const a = (i * 45 * Math.PI) / 180;
          const len = 26 + (c.sf[d] / max) * 62;
          const b = el('button', { type: 'button', class: `learn-rose-btn${sim.dir === d ? ' on' : ''}`, title: `${n}: SF ${c.sf[d]}`, 'aria-label': `${n}, SF ${c.sf[d]}` });
          b.style.left = `calc(50% + ${Math.sin(a) * len}px)`;
          b.style.top = `calc(50% - ${Math.cos(a) * len}px)`;
          b.innerHTML = `<b>${d === 'TGR' ? 'TG' : d}</b><small class="num">${c.sf[d]}</small>`;
          b.addEventListener('click', () => {
            sim.dir = d;
            update();
          });
          rose.appendChild(b);
        });
        bar.update(facadeFor(sim.dir));
        info.textContent = `Fasad ${DIR_NAME[sim.dir]} · SF ${c.sf[sim.dir]} W/m² · WWR ${pct(sim.wwr)} · ${glassById(sim.glass).name}`;
      };
      const ctl = select({
        label: 'Kota',
        options: SNI.cities.map((c) => [c.id, c.name]),
        value: sim.city,
        onChange: (v) => {
          sim.city = v;
          update();
        },
      });
      box.append(el('div', {}, ctl, rose), el('div', {}, bar.el, info));
      update();
      return box;
    },
  },
  {
    id: 'kaca',
    title: 'Kaca dan peneduh',
    lux: 'Kacamataku ini juga peneduh lho. Kaca dan overhang bekerja dengan cara yang mirip.',
    body: () =>
      para(
        '<b>SC</b> (koefisien peneduh) menunjukkan seberapa banyak panas matahari yang lolos lewat kaca. Kaca polos sekitar 0,9, kaca Low-E sekitar 0,4.',
        'Peneduh luar seperti <b>overhang</b> menahan sebagian sinar, sehingga SC berubah menjadi <b>SC efektif</b> = SC kaca × faktor peneduh. Faktornya diambil dari tabel SNI berdasarkan <b>R</b> = kedalaman overhang dibagi tinggi jendela, dan arah fasad.',
      ),
    sim: () => {
      const box = el('div', { class: 'learn-sim learn-sim-2col' });
      const draw = facadeDrawing();
      const bar = termBar();
      const info = el('p', { class: 'learn-small num' });
      const update = () => {
        const g = glassById(sim.glass);
        const f = sceffHorizontal(sim.dir, sim.overhang);
        draw.update(sim.wwr, sim.overhang);
        bar.update(facadeFor(sim.dir));
        info.innerHTML = `SC kaca <b>${fmtId(g.sc, 2)}</b> × faktor overhang <b>${fmtId(f, 3)}</b> = SC efektif <b>${fmtId(g.sc * f, 3)}</b>`;
      };
      const ctls = el(
        'div',
        { class: 'learn-ctls' },
        select({ label: 'Jenis kaca', options: SNI.glass.map((g) => [g.id, g.name]), value: sim.glass, onChange: (v) => { sim.glass = v; update(); } }),
        slider({ label: 'Overhang R', min: 0, max: 2, step: 0.1, value: sim.overhang, fmt: (v) => fmtId(v, 1), onInput: (v) => { sim.overhang = v; update(); } }),
        select({ label: 'Arah', options: DIRS, value: sim.dir, onChange: (v) => { sim.dir = v; update(); } }),
      );
      box.append(el('div', {}, draw.el, ctls), el('div', {}, bar.el, info));
      update();
      return box;
    },
  },
  {
    id: 'dinding',
    title: 'Dinding: U, warna, dan berat',
    lux: 'Dinding cat putih memantulkan panas, mirip baju putih saat siang terik.',
    body: () =>
      para(
        '<b>Nilai U</b> menunjukkan seberapa mudah panas menembus dinding. Makin kecil makin baik, misalnya karena ada insulasi.',
        '<b>Warna (α)</b>: dinding gelap menyerap lebih banyak sinar. Cat putih punya α sekitar 0,3, cat gelap bisa di atas 0,7.',
        '<b>Berat dinding</b> menentukan TDek (Tabel 7): di bawah 125 kg/m² = 15 K, 125–195 kg/m² = 12 K, di atas 195 kg/m² = 10 K. Dinding berat menahan panas lebih lama.',
      ),
    sim: () => {
      const box = el('div', { class: 'learn-sim learn-sim-2col' });
      const bar = termBar();
      const info = el('p', { class: 'learn-small num' });
      let alphaCtl = null;
      const update = () => {
        const w = wallById(sim.wall);
        const r = facadeFor(sim.dir);
        bar.update(r);
        info.innerHTML = `U <b>${fmtId(w.u_value, 2)}</b> · α <b>${fmtId(sim.alphaOverride ?? w.alpha, 2)}</b> · berat <b>${w.massa_kg_m2}</b> kg/m² → TDek <b>${r.tdek} K</b>`;
      };
      const ctls = el(
        'div',
        { class: 'learn-ctls' },
        select({
          label: 'Jenis dinding',
          options: SNI.wall.map((w) => [w.id, w.name]),
          value: sim.wall,
          onChange: (v) => {
            sim.wall = v;
            sim.alphaOverride = null;
            const a = alphaCtl.querySelector('input');
            a.value = String(wallById(v).alpha);
            alphaCtl.querySelector('b').textContent = fmtId(wallById(v).alpha, 2);
            update();
          },
        }),
        (alphaCtl = slider({ label: 'Warna (α)', min: 0.2, max: 0.9, step: 0.01, value: sim.alphaOverride ?? wallById(sim.wall).alpha, fmt: (v) => fmtId(v, 2), onInput: (v) => { sim.alphaOverride = v; update(); } })),
        el('p', { class: 'muted learn-small', text: 'Pada WWR besar, porsi dinding kecil, jadi pengaruh dinding juga kecil. Coba ubah WWR di bab 3.' }),
      );
      box.append(ctls, el('div', {}, bar.el, info));
      update();
      return box;
    },
  },
  {
    id: 'total',
    title: 'Dari per arah ke OTTV total',
    lux: 'Sisi yang lebih luas punya suara lebih besar dalam rata-rata.',
    body: () =>
      para(
        'Setiap sisi dihitung OTTV-nya sendiri. Lalu semuanya digabung menjadi <b>rata-rata tertimbang luas</b>: OTTV total = Σ(OTTV<sub>i</sub> × A<sub>i</sub>) ÷ ΣA<sub>i</sub>.',
        'Status memenuhi atau tidak dinilai dari <b>OTTV total</b> ini. Satu sisi boleh di atas 35 asalkan rata-ratanya tetap ≤ 35.',
      ),
    sim: (handlers) => {
      const box = el('div', { class: 'learn-sim' });
      const table = el('div', { class: 'learn-sides' });
      const bar = termBar();
      const update = () => {
        const rows = ['U', 'T', 'S', 'B'].map((d) => {
          const s = sim.sides[d];
          const r = facadeFor(d, s.wwr);
          return { d, ...s, r, ottv: r.total };
        });
        const tot = totalOttv(rows);
        const sumA = rows.reduce((a, r) => a + r.area, 0);
        const agg = ['qWall', 'qGlass', 'qSolar'].reduce((o, k) => ({ ...o, [k]: rows.reduce((a, r) => a + r.r[k] * r.area, 0) / sumA }), {});
        bar.update({ ...agg, total: tot }, 'OTTV total');
        for (const r of rows) {
          const cell = table.querySelector(`[data-ottv="${r.d}"]`);
          if (cell) cell.innerHTML = `<b class="${r.ottv > SNI.ottvLimit ? 't-fail' : ''}">${fmtId(r.ottv, 1)}</b>`;
        }
      };
      table.append(el('div', { class: 'learn-sides-head' }, el('span', { text: 'Sisi' }), el('span', { text: 'Luas' }), el('span', { text: 'WWR' }), el('span', { text: 'OTTV' })));
      for (const d of ['U', 'T', 'S', 'B']) {
        const s = sim.sides[d];
        const area = el('input', { type: 'range', min: 50, max: 800, step: 10, value: s.area, 'aria-label': `Luas sisi ${DIR_NAME[d]}` });
        const aOut = el('small', { class: 'num', text: `${s.area} m²` });
        area.addEventListener('input', () => { s.area = Number(area.value); aOut.textContent = `${s.area} m²`; update(); });
        const w = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.wwr, 'aria-label': `WWR sisi ${DIR_NAME[d]}` });
        const wOut = el('small', { class: 'num', text: pct(s.wwr) });
        w.addEventListener('input', () => { s.wwr = Number(w.value); wOut.textContent = pct(s.wwr); update(); });
        table.append(el('div', { class: 'learn-sides-row' }, el('b', { text: DIR_NAME[d] }), el('span', {}, area, aOut), el('span', {}, w, wOut), el('span', { class: 'num', 'data-ottv': d })));
      }
      const tryBtn = el('button', { type: 'button', class: 'cta', onClick: () => handlers.onTryExample?.() }, el('span', { html: `${icon('play', 16)}` }), el('span', { text: 'Coba di LUXA dengan model contoh' }));
      box.append(table, bar.el, el('p', { class: 'muted learn-small', text: `Kota ${cityById(sim.city).name}, ${glassById(sim.glass).name}, ${wallById(sim.wall).name}.` }), tryBtn);
      update();
      return box;
    },
  },
  {
    id: 'rttv',
    title: 'Bonus: RTTV untuk atap',
    bonus: true,
    lux: 'Atap juga kena matahari, malah paling lama. Ini bonusnya!',
    body: () =>
      para(
        '<b>RTTV</b> (Roof Thermal Transfer Value) mirip OTTV tetapi untuk atap. Rumusnya: RTTV = [α·A<sub>r</sub>·U<sub>r</sub>·TD<sub>ek</sub> + A<sub>s</sub>·U<sub>s</sub>·ΔT + A<sub>s</sub>·SC·SF] ÷ (A<sub>r</sub> + A<sub>s</sub>), dengan A<sub>r</sub> atap masif dan A<sub>s</sub> skylight.',
        'Batasnya <b>10 W/m²</b> bila atap tanpa skylight, dan <b>35 W/m²</b> bila ada skylight. SF atap jauh lebih besar dari dinding (Jakarta 427 W/m²), jadi skylight kecil pun berpengaruh besar.',
        'Di LUXA, RTTV bisa dinyalakan di Mode lanjut.',
      ),
    sim: () => {
      const box = el('div', { class: 'learn-sim learn-sim-2col' });
      const out = el('div', { class: 'learn-rttv num' });
      const update = () => {
        const rf = roofById(sim.roof);
        const g = glassById(sim.glass);
        const c = cityById(sim.city);
        const r = rttv({ alpha: rf.alpha, ur: rf.u_value, massa: rf.massa_kg_m2, areaRoof: sim.roofArea, skyRatio: sim.sky, us: g.u_value, sc: g.sc, sfRoof: c.sf.ROOF });
        const ok = r.total <= r.limit;
        out.innerHTML = `<div class="learn-rttv-val">RTTV <b>${fmtId(r.total, 1)}</b> W/m² <span class="chip ${ok ? 'st-ok' : 'st-fail'}">${ok ? `memenuhi (≤ ${r.limit})` : `melebihi batas ${r.limit}`}</span></div>
          <div class="learn-small">Atap masif ${fmtId(r.qRoof, 1)} · konduksi skylight ${fmtId(r.qCond, 1)} · radiasi skylight ${fmtId(r.qSolar, 1)} W/m²</div>
          <div class="learn-small muted">TDek atap ${r.tdek} K (Tabel 9) · SF atap ${c.name} ${c.sf.ROOF} W/m²</div>`;
      };
      const ctls = el(
        'div',
        { class: 'learn-ctls' },
        select({ label: 'Penutup atap', options: SNI.roof.map((r) => [r.id, r.name]), value: sim.roof, onChange: (v) => { sim.roof = v; update(); } }),
        slider({ label: 'Porsi skylight', min: 0, max: 0.3, step: 0.01, value: sim.sky, fmt: pct, onInput: (v) => { sim.sky = v; update(); } }),
        select({ label: 'Kaca skylight', options: SNI.glass.map((g) => [g.id, g.name]), value: sim.glass, onChange: (v) => { sim.glass = v; update(); } }),
      );
      box.append(ctls, out);
      update();
      return box;
    },
  },
];

export const LEARN_CHAPTER_COUNT = CHAPTERS.length;
export const LEARN_CHAPTER_TITLES = CHAPTERS.map((c) => c.title);

export function renderLearnScreen(state, handlers) {
  const idx = Math.max(0, Math.min(CHAPTERS.length - 1, Number(state.learnChapter) || 0));
  const ch = CHAPTERS[idx];

  const main = el('main', { class: 'main main-learn' });

  const nav = el('nav', { class: 'box learn-nav', 'aria-label': 'Daftar bab' });
  nav.append(
    el('button', { type: 'button', class: 'link-btn learn-back', onClick: () => handlers.onGoHome?.() }, el('span', { html: icon('chevronDown', 14) }), el('span', { text: 'Beranda' })),
    el('h2', { text: 'Belajar OTTV' }),
  );
  const ol = el('ol', { class: 'learn-toc' });
  CHAPTERS.forEach((c, i) => {
    ol.append(
      el(
        'li',
        {},
        el(
          'button',
          { type: 'button', class: i === idx ? 'on' : '', 'aria-current': i === idx ? 'page' : null, onClick: () => handlers.onSetChapter?.(i) },
          el('span', { class: 'learn-toc-n num', text: c.bonus ? '★' : String(i + 1) }),
          el('span', { text: c.title }),
        ),
      ),
    );
  });
  nav.appendChild(ol);

  const art = el('article', { class: 'box learn-main', 'aria-labelledby': 'learn-title' });
  const head = el('header', { class: 'learn-head' });
  head.append(el('div', { class: 'learn-kicker', text: ch.bonus ? 'Bonus' : `Bab ${idx + 1} dari ${CHAPTERS.length - 1}` }), el('h1', { id: 'learn-title', text: ch.title }));
  const guide = renderLux(state, idx === CHAPTERS.length - 1 ? 'happy' : 'guide', { size: 76, say: ch.lux, className: 'learn-lux' });
  art.append(head);
  if (guide) art.append(guide);
  art.append(el('div', { class: 'learn-body' }, ch.body()), ch.sim(handlers));
  art.append(el('p', { class: 'muted learn-note', text: 'Simulasi ini versi sederhana: rumus dan tabel SNI sama dengan LUXA, tetapi tanpa kusen dan tanpa bayangan dari bangunan sendiri. Untuk hasil lengkap, hitung model 3D di LUXA.' }));

  const foot = el('footer', { class: 'learn-foot' });
  foot.append(
    idx > 0 ? el('button', { type: 'button', class: 'ghost', onClick: () => handlers.onSetChapter?.(idx - 1) }, `← ${CHAPTERS[idx - 1].title}`) : el('span'),
    idx < CHAPTERS.length - 1
      ? el('button', { type: 'button', class: 'cta', onClick: () => handlers.onSetChapter?.(idx + 1) }, `${CHAPTERS[idx + 1].title} →`)
      : el('button', { type: 'button', class: 'cta', onClick: () => handlers.onTryExample?.() }, 'Coba di LUXA'),
  );
  art.append(foot);

  main.append(nav, art);
  return main;
}
