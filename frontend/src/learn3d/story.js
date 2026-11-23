// Cerita scroll Belajar OTTV di satu adegan yang tetap.
// Scroll menentukan bab (sumber kebenaran); kamera menyusul dengan redaman; tiap bab menyalakan sorotannya sendiri.
import * as THREE from 'three';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStage, dirFrom } from './stage.js';
import { SHOTS } from './shots.js';
import { setGlazing, setOverhangDepth, setSkylightArea, sillFor, PODIUM_H, TOWER_TOP, PODIUM_ROOF_AREA, SKY_MAX_AREA } from './tower.js';
import { createFacadeOverlay, createSunMarker, createHeatArrows, createWallSample, DIR_NAME, HEAT_COLORS, SOLAR_DIR } from './highlights.js';
import { sim, sf, facade, total, glassH, effWwr, glassById, wallById, roofById, LIMIT, fmt, pct } from './sim.js';
import { sceffHorizontal, rttv, tdekWall } from '../learn/ottvCalc.js';
import { SNI } from '../learn/sniData.js';
import { luxSvg } from '../ui/mascot.js';
import './lux.css';
import './learn3d.css';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s) => document.querySelector(s);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}.${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// ---------- Isi bab ----------
const PRESETS = {
  penuh: { label: 'Kaca penuh', wwr: 0.85, glass: 'glz_kaca_polos_8', wall: 'wal_spandrel_tanpa_insulasi', R: 0 },
  seimbang: { label: 'Seimbang', wwr: 0.4, glass: 'glz_kaca_tinted_8', wall: 'wal_bata_ringan_aac_100', R: 0.44 },
  hemat: { label: 'Hemat', wwr: 0.3, glass: 'glz_kaca_lowe_single_8', wall: 'wal_bata_ringan_aac_cat_putih', R: 0.8 },
};

const CH = [
  { id: 'mulai', shot: 'beranda', nav: 'Mulai', html: `
    <p class="l3d-kicker">Belajar OTTV</p>
    <h1>Panas yang masuk lewat selubung bangunan</h1>
    <p>Satu kota, satu tower contoh. Saat kamu scroll, kamera berpindah ke bagian yang sedang dibahas, dan kamu bisa mencoba langsung di modelnya.</p>
    <p class="l3d-muted">Scroll pelan ke bawah untuk mulai.</p>` },
  { id: 'bab-1', shot: 'bab1', nav: 'Bab 1', html: `
    <p class="l3d-kicker">Bab 1</p>
    <h2>Apa itu OTTV</h2>
    <p>OTTV (Overall Thermal Transfer Value) adalah rata-rata panas yang masuk lewat dinding dan kaca bangunan, dalam W/m². SNI 6389:2020 membatasinya paling tinggi ${fmt(LIMIT)} W/m².</p>
    <p>Bandingkan tiga versi tower ini. Makin pekat oranye di fasad, makin besar panas yang masuk lewat fasad itu.</p>
    <div class="l3d-seg" role="group" aria-label="Versi tower">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${p.label}</button>`).join('')}</div>
    <p class="l3d-muted" id="preset-desc"></p>
    <div class="l3d-gauge"><div class="l3d-gauge-num"><b id="ottv-total">–</b><span>W/m²</span></div><div class="l3d-gauge-bar"><i id="ottv-bar"></i><em style="left:${(LIMIT / 80) * 100}%"><span>batas ${fmt(LIMIT)}</span></em></div><p id="ottv-verdict" class="l3d-verdict"></p></div>` },
  { id: 'bab-2', shot: 'bab2', nav: 'Bab 2', html: `
    <p class="l3d-kicker">Bab 2</p>
    <h2>Tiga jalur panas</h2>
    <p>Panas dari luar masuk ke ruang lewat tiga jalur. OTTV satu fasad adalah jumlah ketiganya. Arahkan kursor ke tiap suku untuk melihat jalurnya di model.</p>
    <div class="l3d-terms">
      <button type="button" data-term="wall"><i style="background:${HEAT_COLORS.wall}"></i><span>Konduksi dinding</span><code>α · Uw · (1 − WWR) · TDek</code><b id="t-wall">–</b></button>
      <button type="button" data-term="glass"><i style="background:${HEAT_COLORS.glass}"></i><span>Konduksi kaca</span><code>Uf · WWR · ΔT</code><b id="t-glass">–</b></button>
      <button type="button" data-term="solar"><i style="background:${HEAT_COLORS.solar}"></i><span>Radiasi lewat kaca</span><code>SC · WWR · SF</code><b id="t-solar">–</b></button>
    </div>
    <p class="l3d-sum">OTTV fasad Barat = <b id="t-total">–</b> W/m²</p>
    <p class="l3d-note" id="t-note"></p>` },
  { id: 'bab-3', shot: 'bab3', nav: 'Bab 3', html: `
    <p class="l3d-kicker">Bab 3</p>
    <h2>Rasio kaca dan dinding (WWR)</h2>
    <p>WWR adalah perbandingan luas kaca terhadap luas fasad. Makin besar WWR, dua suku kaca membesar dan suku dinding mengecil. Karena radiasi lewat kaca jauh lebih besar, OTTV ikut naik.</p>
    <label class="l3d-ctl">WWR fasad Barat <input id="wwr" type="range" min="0.1" max="0.85" step="0.05" value="0.4"><output id="wwr-out">40%</output></label>
    <div class="l3d-stack" aria-hidden="true"><i id="s-wall" style="background:${HEAT_COLORS.wall}"></i><i id="s-glass" style="background:${HEAT_COLORS.glass}"></i><i id="s-solar" style="background:${HEAT_COLORS.solar}"></i></div>
    <dl class="l3d-stats"><div><dt>Konduksi dinding</dt><dd id="w-wall">–</dd></div><div><dt>Konduksi kaca</dt><dd id="w-glass">–</dd></div><div><dt>Radiasi lewat kaca</dt><dd id="w-solar">–</dd></div></dl>
    <p class="l3d-sum">OTTV fasad Barat = <b id="w-total">–</b> W/m²</p>` },
  { id: 'bab-4', shot: 'bab4', nav: 'Bab 4', html: `
    <p class="l3d-kicker">Bab 4</p>
    <h2>Arah hadap dan faktor radiasi (SF)</h2>
    <p>Tiap arah fasad menerima radiasi matahari yang berbeda. SNI merangkumnya dalam faktor radiasi (SF): nilai rata-rata per arah untuk tiap kota. Makin pekat oranyenya, makin besar SF fasad itu.</p>
    <div class="l3d-sf" aria-label="SF Jakarta per arah, W/m²">${['U', 'T', 'S', 'B'].map((d) => `<div class="l3d-sf-row"><span>${DIR_NAME[d]}</span><i style="--w:${(sf()[d] / 200) * 100}%"></i><b>${fmt(sf()[d])}</b></div>`).join('')}<p class="l3d-muted">SF Jakarta, W/m²</p></div>
    <p><b>Coba:</b> seret matahari di lintasannya. Sore hari sinar menimpa fasad Barat secara langsung, itu sebabnya SF Barat paling tinggi.</p>
    <p class="l3d-readout" id="sun-readout">Jam 15.00</p>
    <p class="l3d-note">Bayangan bangunan sekitar hanya ilustrasi. Perhitungan OTTV di LUXA tidak memasukkan bayangan dari bangunan lain.</p>` },
  { id: 'bab-5', shot: 'bab5', nav: 'Bab 5', html: `
    <p class="l3d-kicker">Bab 5</p>
    <h2>Kaca dan peneduh</h2>
    <p>Overhang menahan sebagian sinar langsung sebelum mengenai kaca. SNI menghitung pengaruhnya lewat SC efektif, yang bergantung pada rasio R, yaitu kedalaman overhang dibagi tinggi kaca.</p>
    <label class="l3d-ctl">Kedalaman overhang <input id="depth" type="range" min="0" max="1.5" step="0.05" value="0.7"><output id="depth-out">0,70 m</output></label>
    <label class="l3d-ctl">Jam <input id="hour5" type="range" min="6" max="18" step="0.25" value="15"><output id="hour5-out">15.00</output></label>
    <dl class="l3d-stats"><div><dt>Rasio R</dt><dd id="r-out">–</dd></div><div><dt>Faktor SC efektif (Barat)</dt><dd id="sc-out">–</dd></div><div><dt>Kaca terlindung jam ini</dt><dd id="shade-out">–</dd></div></dl>
    <p class="l3d-note">Faktor SC efektif diambil dari tabel SNI dan berlaku sepanjang tahun. Persentase kaca terlindung hanya untuk jam yang dipilih.</p>` },
  { id: 'bab-6', shot: 'bab6', nav: 'Bab 6', html: `
    <p class="l3d-kicker">Bab 6</p>
    <h2>Dinding: nilai U, warna, dan berat</h2>
    <p>Suku dinding ditentukan tiga hal: nilai U (seberapa mudah panas merambat), absorptansi α (seberapa banyak sinar diserap oleh warna permukaan), dan berat dinding yang menentukan TDek.</p>
    <div class="l3d-seg l3d-seg-wrap" role="group" aria-label="Jenis dinding">${SNI.wall.map((w) => `<button type="button" data-wall="${w.id}">${w.name}</button>`).join('')}</div>
    <label class="l3d-ctl">Warna permukaan luar (α) <input id="alpha" type="range" min="0.2" max="0.9" step="0.01"><output id="alpha-out">–</output></label>
    <dl class="l3d-stats l3d-stats-4"><div><dt>Nilai U</dt><dd id="d-u">–</dd></div><div><dt>Berat</dt><dd id="d-m">–</dd></div><div><dt>TDek</dt><dd id="d-td">–</dd></div><div><dt>Suku dinding</dt><dd id="d-q">–</dd></div></dl>
    <p class="l3d-sum">OTTV fasad Barat = <b id="d-total">–</b> W/m²</p>
    <p class="l3d-note">Lapisan dan tebal di model hanya ilustrasi (tebal dibesarkan supaya terbaca). Nilai U, α, dan berat diambil dari katalog material LUXA.</p>` },
  { id: 'bab-7', shot: 'bab7', nav: 'Bab 7', html: `
    <p class="l3d-kicker">Bab 7</p>
    <h2>Dari per arah ke OTTV total</h2>
    <p>OTTV bangunan adalah rata-rata OTTV semua fasad, ditimbang dengan luasnya. Fasad yang luas dan menghadap arah panas paling besar pengaruhnya.</p>
    <div class="l3d-sides">${['U', 'T', 'S', 'B'].map((d) => `<div class="l3d-side"><span>${DIR_NAME[d]}</span><input type="range" min="0.1" max="0.85" step="0.05" data-side="${d}" aria-label="WWR ${DIR_NAME[d]}"><output data-side-out="${d}">–</output><b data-side-ottv="${d}">–</b></div>`).join('')}<p class="l3d-muted">Geser WWR tiap arah. Angka kanan = OTTV fasad itu (W/m²).</p></div>
    <div class="l3d-gauge"><div class="l3d-gauge-num"><b id="ottv-total7">–</b><span>W/m² OTTV total</span></div><div class="l3d-gauge-bar"><i id="ottv-bar7"></i><em style="left:${(LIMIT / 80) * 100}%"><span>batas ${fmt(LIMIT)}</span></em></div><p id="ottv-verdict7" class="l3d-verdict"></p></div>
    <a class="l3d-cta" href="https://alfiannur2955-collab.github.io/LUXA/" target="_blank" rel="noopener">Coba hitung modelmu di LUXA</a>` },
  { id: 'bab-8', shot: 'bab8', nav: 'Bab 8', html: `
    <p class="l3d-kicker">Bonus · Bab 8</p>
    <h2>Atap dan RTTV</h2>
    <p>Atap punya ukuran sendiri, RTTV. Batasnya ${fmt(SNI.rttvLimitSky)} W/m² bila atap memakai skylight, dan ${fmt(SNI.rttvLimitOpaque)} W/m² bila atap tertutup penuh.</p>
    <div class="l3d-seg" role="group" aria-label="Jenis atap">${SNI.roof.map((r) => `<button type="button" data-roof="${r.id}">${r.name}</button>`).join('')}</div>
    <label class="l3d-ctl">Luas skylight <input id="sky" type="range" min="0" max="${(SKY_MAX_AREA / PODIUM_ROOF_AREA).toFixed(3)}" step="0.005"><output id="sky-out">–</output></label>
    <dl class="l3d-stats"><div><dt>Atap</dt><dd id="r-roof">–</dd></div><div><dt>Konduksi skylight</dt><dd id="r-cond">–</dd></div><div><dt>Radiasi skylight</dt><dd id="r-solar">–</dd></div></dl>
    <div class="l3d-gauge"><div class="l3d-gauge-num"><b id="rttv-total">–</b><span>W/m² RTTV</span></div><div class="l3d-gauge-bar"><i id="rttv-bar"></i><em id="rttv-limit"><span></span></em></div><p id="rttv-verdict" class="l3d-verdict"></p></div>
    <p class="l3d-note">Contoh: atap podium ${fmt(PODIUM_ROOF_AREA)} m² di luar tapak tower, skylight dari ${glassById('glz_kaca_tinted_8').name.toLowerCase()}, SF atap Jakarta ${fmt(sf().ROOF)} W/m².</p>` },
];

// Lux, pemandu kecil di tiap kartu.
const LUX = {
  mulai: ['wave', 'Halo, aku Lux. Yuk mulai dari kotanya dulu.'],
  'bab-1': ['guide', 'Coba pilih Hemat, lalu lihat oranye di fasad memudar.'],
  'bab-2': ['think', 'Radiasi lewat kaca hampir selalu jadi suku terbesar.'],
  'bab-3': ['guide', 'Turunkan WWR ke 20%. OTTV-nya turun berapa?'],
  'bab-4': ['guide', 'Seret matahari ke sore hari, lalu lihat fasad Barat.'],
  'bab-5': ['think', 'Bandingkan overhang 0 m dan 1,5 m pada jam yang sama.'],
  'bab-6': ['guide', 'Warna terang menyerap lebih sedikit panas matahari.'],
  'bab-7': ['think', 'Fasad yang luas dan menghadap barat paling menentukan.'],
  'bab-8': ['report', 'Tanpa skylight, batas RTTV turun jadi 10 W/m².'],
};
const luxRow = (id) => (LUX[id] ? `<div class="l3d-lux" data-lux="${id}">${luxSvg(LUX[id][0], { size: 46 })}<p>${LUX[id][1]}</p></div>` : '');

// ---------- DOM ----------
document.body.classList.add('l3d-story-page');
const story = document.createElement('main');
story.className = 'l3d-story';
story.innerHTML = CH.map((c) => `<section class="l3d-sec" id="${c.id}"><article class="l3d-card">${c.html}${luxRow(c.id)}</article></section>`).join('');
document.body.appendChild(story);
const sections = [...story.querySelectorAll('.l3d-sec')];

const dots = document.createElement('nav');
dots.className = 'l3d-dots';
dots.setAttribute('aria-label', 'Bab');
dots.innerHTML = CH.map((c, i) => `<button type="button" data-i="${i}" aria-label="${c.nav}"><span>${c.nav}</span></button>`).join('');
document.body.appendChild(dots);

const back = Object.assign(document.createElement('button'), { type: 'button', className: 'l3d-back', textContent: 'Kembali ke sudut bab' });
document.body.appendChild(back);
const themeBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'l3d-theme', textContent: theme === 'dark' ? 'Mode terang' : 'Mode gelap' });
themeBtn.addEventListener('click', () => {
  const u = new URL(location.href);
  u.searchParams.set('theme', theme === 'dark' ? 'light' : 'dark');
  location.href = u.toString();
});
document.body.appendChild(themeBtn);

// ---------- Adegan + sorotan ----------
const stage = createStage(document.getElementById('stage'), { theme });
const overlay = createFacadeOverlay(stage);
const sun = createSunMarker(stage, { radius: 170 });
const arrows = createHeatArrows(stage);
const wallSample = createWallSample(stage, { origin: new THREE.Vector3(-14, 54.4, -9) });
const V0 = [0, 0, 0];
const L = {
  sf: [
    stage.addLabel([-14, PODIUM_H + 46, -6], `Barat · SF ${fmt(sf().B)}`, { tag: true, lift: 48 }),
    stage.addLabel([6, PODIUM_H + 40, 14], `Selatan · SF ${fmt(sf().S)}`, { lift: 40 }),
    stage.addLabel([-2, PODIUM_H + 30, 8], `Barat (takik) · SF ${fmt(sf().B)}`, { lift: 30 }),
  ],
  total: stage.addLabel([4, TOWER_TOP + 3, -4], 'OTTV', { tag: true, lift: 30 }),
  heat: {
    wall: stage.addLabel(V0, 'Konduksi dinding', { lift: 20, maxDist: 260 }),
    glass: stage.addLabel(V0, 'Konduksi kaca', { lift: 20, maxDist: 260 }),
    solar: stage.addLabel(V0, 'Radiasi matahari', { tag: true, lift: 26, maxDist: 260 }),
  },
  wwr: stage.addLabel([-14.2, 70, -6], 'WWR 40%', { tag: true, lift: 40, maxDist: 900 }),
  overhang: stage.addLabel(V0, 'Overhang', { tag: true, lift: 40, maxDist: 160 }),
  glassH: stage.addLabel(V0, 'Kaca', { lift: 30, maxDist: 160 }),
};
L.side = {
  B: stage.addLabel([-14, PODIUM_H + 52, -6], 'Barat', { tag: true, lift: 46 }),
  S: stage.addLabel([6, PODIUM_H + 44, 14], 'Selatan', { tag: true, lift: 40 }),
};
L.sky = stage.addLabel([17, PODIUM_H + 0.8, 0], 'Skylight', { tag: true, lift: 40, maxDist: 700 });
const allLabels = [...L.sf, L.total, ...Object.values(L.heat), L.wwr, L.overhang, L.glassH, ...Object.values(L.side), L.sky];
allLabels.forEach((l) => { l.on = false; });

// Titik jangkar di lantai contoh (lantai 10) fasad Barat, mengikuti tinggi kaca.
const FLOOR = 10;
function anchorsWest() {
  const gh = glassH('B'), sill = sillFor(gh), base = PODIUM_H + FLOOR * 4;
  return {
    wall: new THREE.Vector3(-14, base + sill * 0.5, -11),
    glass: new THREE.Vector3(-14, base + sill + gh * 0.5, -6.5),
    solar: new THREE.Vector3(-14, base + sill + gh * 0.4, -1.5),
    overhang: new THREE.Vector3(-14.6, base + sill + gh + 0.18, -10),
    glassMid: new THREE.Vector3(-14.05, base + sill + gh * 0.6, -1.5),
  };
}
const sunDirVec = () => dirFrom(sun.sun.az, Math.max(sun.sun.el, 3));

// ---------- Pembaruan model + angka ----------
let ottvWeights = { U: 0, T: 0, S: 0, B: 0 };
const sfWeights = Object.fromEntries(['U', 'T', 'S', 'B'].map((d) => [d, clamp01((sf()[d] - 100) / 100)]));
const outerColor = (a) => '#' + new THREE.Color('#F7F5F0').lerp(new THREE.Color('#4A4743'), clamp01((a - 0.2) / 0.7)).getHexString();
function setLux(id, pose, text) {
  const box = document.querySelector(`[data-lux="${id}"]`);
  if (!box || box.dataset.pose === pose + text) return;
  box.dataset.pose = pose + text;
  box.innerHTML = `${luxSvg(pose, { size: 46 })}<p>${text}</p>`;
}
function syncModel() {
  setGlazing(stage.tower, { heights: { U: glassH('U'), T: glassH('T'), S: glassH('S'), B: glassH('B') }, depth: sim.depth });
}
function refresh() {
  const t = total();
  const w = facade('B');
  // Bab 1
  $('#ottv-total').textContent = fmt(t.ottv, 1);
  $('#ottv-bar').style.width = `${Math.min(100, (t.ottv / 80) * 100)}%`;
  $('#ottv-bar').classList.toggle('is-over', t.ottv > LIMIT);
  $('#ottv-verdict').textContent = t.ottv <= LIMIT ? `Memenuhi batas SNI (paling tinggi ${fmt(LIMIT)} W/m²)` : `Melebihi batas SNI sebesar ${fmt(t.ottv - LIMIT, 1)} W/m²`;
  $('#preset-desc').textContent = `WWR ${pct(effWwr('B'))} · ${glassById(sim.glass).name} · ${wallById(sim.wall).name} · ${sim.depth > 0.02 ? `overhang ${fmt(sim.depth, 2)} m di fasad Barat` : 'tanpa peneduh'}`;
  L.total.setText(`OTTV ${fmt(t.ottv, 1)} W/m²`);
  ottvWeights = Object.fromEntries(Object.entries(t.per).map(([d, f]) => [d, clamp01((f.total - 15) / 50)]));
  // Bab 2
  $('#t-wall').textContent = fmt(w.qWall, 1);
  $('#t-glass').textContent = fmt(w.qGlass, 1);
  $('#t-solar').textContent = fmt(w.qSolar, 1);
  $('#t-total').textContent = fmt(w.total, 1);
  $('#t-note').textContent = `Contoh: fasad Barat Jakarta, WWR ${pct(effWwr('B'))}, ${glassById(sim.glass).name}, ${wallById(sim.wall).name}, TDek ${w.tdek} K, SC efektif ${fmt(w.scEff, 2)}.`;
  // Bab 3
  $('#wwr').value = sim.wwr.B;
  $('#wwr-out').textContent = pct(effWwr('B'));
  const sum = w.qWall + w.qGlass + w.qSolar;
  for (const [k, v] of [['wall', w.qWall], ['glass', w.qGlass], ['solar', w.qSolar]]) {
    $(`#s-${k}`).style.width = `${(v / Math.max(sum, 70)) * 100}%`;
    $(`#w-${k}`).textContent = fmt(v, 1);
  }
  $('#w-total').textContent = fmt(w.total, 1);
  L.wwr.setText(`WWR ${pct(effWwr('B'))}`);
  // Bab 5
  const R = sim.depth / glassH('B');
  $('#depth').value = sim.depth;
  $('#depth-out').textContent = `${fmt(sim.depth, 2)} m`;
  $('#r-out').textContent = fmt(R, 2);
  $('#sc-out').textContent = fmt(sceffHorizontal('B', R), 2);
  L.glassH.setText(`Kaca ${fmt(glassH('B'), 1)} m`);
  updateShade();
  // Bab 6
  const wall = wallById(sim.wall), alpha = sim.alpha ?? wall.alpha;
  document.querySelectorAll('[data-wall]').forEach((x) => x.classList.toggle('is-on', x.dataset.wall === sim.wall));
  $('#alpha').value = alpha;
  $('#alpha-out').innerHTML = `<i class="l3d-swatch" style="background:${outerColor(alpha)}"></i>${fmt(alpha, 2)}`;
  $('#d-u').textContent = `${fmt(wall.u_value, 2)} W/m²K`;
  $('#d-m').textContent = `${fmt(wall.massa_kg_m2)} kg/m²`;
  $('#d-td').textContent = `${tdekWall(wall.massa_kg_m2)} K`;
  $('#d-q').textContent = fmt(w.qWall, 1);
  $('#d-total').textContent = fmt(w.total, 1);
  wallSample.update(sim.wall, outerColor(alpha));
  // Bab 7
  for (const d of ['U', 'T', 'S', 'B']) {
    document.querySelector(`[data-side="${d}"]`).value = sim.wwr[d];
    document.querySelector(`[data-side-out="${d}"]`).textContent = pct(effWwr(d));
    document.querySelector(`[data-side-ottv="${d}"]`).textContent = fmt(t.per[d].total, 1);
  }
  $('#ottv-total7').textContent = fmt(t.ottv, 1);
  $('#ottv-bar7').style.width = `${Math.min(100, (t.ottv / 80) * 100)}%`;
  $('#ottv-bar7').classList.toggle('is-over', t.ottv > LIMIT);
  $('#ottv-verdict7').textContent = t.ottv <= LIMIT ? `Memenuhi batas SNI (paling tinggi ${fmt(LIMIT)} W/m²)` : `Melebihi batas SNI sebesar ${fmt(t.ottv - LIMIT, 1)} W/m²`;
  L.side.B.setText(`Barat · ${fmt(t.per.B.total, 1)}`);
  L.side.S.setText(`Selatan · ${fmt(t.per.S.total, 1)}`);
  setLux('bab-7', t.ottv <= LIMIT ? 'happy' : 'think', t.ottv <= LIMIT ? 'Memenuhi! Coba juga dengan modelmu sendiri di LUXA.' : LUX['bab-7'][1]);
  // Bab 8
  const rf = roofById(sim.roof), sg = glassById('glz_kaca_tinted_8');
  const r = rttv({ alpha: rf.alpha, ur: rf.u_value, massa: rf.massa_kg_m2, areaRoof: PODIUM_ROOF_AREA, skyRatio: sim.sky, us: sg.u_value, sc: sg.sc, sfRoof: sf().ROOF });
  document.querySelectorAll('[data-roof]').forEach((x) => x.classList.toggle('is-on', x.dataset.roof === sim.roof));
  $('#sky').value = sim.sky;
  $('#sky-out').textContent = sim.sky > 0.001 ? `${pct(sim.sky)} atap (${fmt(sim.sky * PODIUM_ROOF_AREA)} m²)` : 'tanpa skylight';
  $('#r-roof').textContent = fmt(r.qRoof, 1);
  $('#r-cond').textContent = fmt(r.qCond, 1);
  $('#r-solar').textContent = fmt(r.qSolar, 1);
  $('#rttv-total').textContent = fmt(r.total, 1);
  $('#rttv-bar').style.width = `${Math.min(100, (r.total / 80) * 100)}%`;
  $('#rttv-bar').classList.toggle('is-over', r.total > r.limit);
  $('#rttv-limit').style.left = `${(r.limit / 80) * 100}%`;
  $('#rttv-limit span').textContent = `batas ${fmt(r.limit)}`;
  $('#rttv-verdict').textContent = r.total <= r.limit ? `Memenuhi batas ${fmt(r.limit)} W/m²` : `Melebihi batas ${fmt(r.limit)} W/m² sebesar ${fmt(r.total - r.limit, 1)}`;
  L.sky.setText(sim.sky > 0.001 ? `Skylight ${pct(sim.sky)}` : 'Tanpa skylight');
  // Label dan panah yang ikut tinggi kaca dan arah matahari
  const a = anchorsWest();
  const out = new THREE.Vector3(-5.4, 0, 0);
  L.heat.wall.setPos(a.wall.clone().add(out));
  L.heat.glass.setPos(a.glass.clone().add(out));
  const sd = sunDirVec();
  L.heat.solar.setPos(a.solar.clone().addScaledVector(SOLAR_DIR, 5.6));
  L.overhang.setPos(a.overhang);
  L.glassH.setPos(a.glassMid);
  arrows.update({ q: w, anchors: a });
}

function compass(az) {
  const names = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
  return names[Math.round(az / 45) % 8];
}
function setHour(h) {
  const s = sun.setHour(h);
  $('#sun-readout').textContent = `Jam ${hhmm(s.hour)} · matahari dari arah ${compass(s.az)}, ketinggian ${fmt(s.el)}°`;
  $('#hour5').value = s.hour;
  $('#hour5-out').textContent = hhmm(s.hour);
  refresh();
}
// Kaca terlindung pada jam terpilih: geometri sudut profil di fasad Barat (normal ke azimut 270°).
function updateShade() {
  const { az, el } = sun.sun;
  const diff = ((az - 270 + 540) % 360) - 180;
  const out = $('#shade-out');
  if (Math.abs(diff) >= 90 || el <= 0) { out.textContent = 'tidak kena sinar langsung'; return; }
  const tanP = Math.tan(el * Math.PI / 180) / Math.cos(diff * Math.PI / 180);
  out.textContent = pct(clamp01((sim.depth * tanP - 0.1) / glassH('B')));
}

// ---------- Kontrol bab ----------
function applyPreset(k) {
  const p = PRESETS[k];
  for (const d of ['U', 'T', 'S', 'B']) sim.wwr[d] = p.wwr;
  sim.glass = p.glass;
  sim.wall = p.wall;
  sim.alpha = null;
  sim.depth = Math.round(p.R * glassH('B') * 20) / 20;
  document.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('is-on', x.dataset.preset === k));
  syncModel();
  refresh();
}
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
document.querySelectorAll('[data-term]').forEach((b) => {
  const k = b.dataset.term;
  const on = () => { arrows.setFocus(k); b.classList.add('is-on'); for (const [n, l] of Object.entries(L.heat)) l.el.classList.toggle('is-dim', n !== k); };
  const off = () => { arrows.setFocus(null); b.classList.remove('is-on'); for (const l of Object.values(L.heat)) l.el.classList.remove('is-dim'); };
  b.addEventListener('mouseenter', on); b.addEventListener('focus', on);
  b.addEventListener('mouseleave', off); b.addEventListener('blur', off);
});
$('#wwr').addEventListener('input', (e) => {
  sim.wwr.B = Number(e.target.value);
  document.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('is-on'));
  syncModel();
  refresh();
});
$('#depth').addEventListener('input', (e) => { sim.depth = Number(e.target.value); setOverhangDepth(stage.tower, sim.depth); refresh(); });
$('#hour5').addEventListener('input', (e) => setHour(Number(e.target.value)));
document.querySelectorAll('[data-wall]').forEach((b) => b.addEventListener('click', () => { sim.wall = b.dataset.wall; sim.alpha = null; clearPreset(); refresh(); }));
$('#alpha').addEventListener('input', (e) => { sim.alpha = Number(e.target.value); clearPreset(); refresh(); });
document.querySelectorAll('[data-side]').forEach((inp) => inp.addEventListener('input', () => { sim.wwr[inp.dataset.side] = Number(inp.value); clearPreset(); syncModel(); refresh(); }));
document.querySelectorAll('[data-roof]').forEach((b) => b.addEventListener('click', () => { sim.roof = b.dataset.roof; refresh(); }));
$('#sky').addEventListener('input', (e) => { sim.sky = Number(e.target.value); setSkylightArea(stage.tower, sim.sky * PODIUM_ROOF_AREA); refresh(); });
function clearPreset() { document.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('is-on')); }

// ---------- Kamera: interpolasi di ruang bola (target, azimut, elevasi, log jarak) ----------
function shotParams(name) {
  const s = SHOTS[name];
  return { target: new THREE.Vector3(...s.target), az: s.az, el: s.el, dist: s.dist, shadow: s.shadow || 460, focus: new THREE.Vector3(...(s.shadowFocus || [0, 0, 0])) };
}
const P = CH.map((c) => shotParams(c.shot));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAz = (a, b, t) => a + ((((b - a + 540) % 360) - 180) * t);
function mix(a, b, t, out = {}) {
  out.target = (out.target || new THREE.Vector3()).lerpVectors(a.target, b.target, t);
  out.focus = (out.focus || new THREE.Vector3()).lerpVectors(a.focus, b.focus, t);
  out.az = lerpAz(a.az, b.az, t);
  out.el = lerp(a.el, b.el, t);
  out.dist = Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), t));
  out.shadow = Math.exp(lerp(Math.log(a.shadow), Math.log(b.shadow), t));
  return out;
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function chapterCoord() {
  const y = window.scrollY;
  let c = 0;
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i];
    const start = s.offsetTop - window.innerHeight * 0.5; // mulai berpindah saat bagian baru masuk separuh layar
    const span = s.offsetHeight * 0.5;
    if (y >= start) c = i - 1 + Math.min(1, (y - start) / span);
  }
  return c;
}
function desiredParams(c) {
  const i = Math.min(P.length - 2, Math.floor(c));
  const t = c - i;
  return mix(P[i], P[i + 1], reduceMotion ? (t > 0.35 ? 1 : 0) : ease(t));
}
const cur = mix(P[0], P[0], 0);
function applyParams(p) {
  stage.applyShadowArea(p.shadow, p.focus);
  stage.applyCamera(p.target.clone().addScaledVector(dirFrom(p.az, p.el), p.dist), p.target);
}

// ---------- Interaksi kamera + seret matahari ----------
const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = false; // roda mouse dipakai untuk scroll bab
controls.maxPolarAngle = Math.PI * 0.49;
let userMode = false, dragSun = false;
controls.addEventListener('start', () => { if (!dragSun) { userMode = true; back.classList.add('is-on'); } });
function leaveUserMode() {
  if (!userMode) return;
  userMode = false;
  back.classList.remove('is-on');
  const off = stage.camera.position.clone().sub(controls.target);
  cur.target.copy(controls.target);
  cur.dist = off.length();
  cur.el = Math.asin(off.y / cur.dist) * 180 / Math.PI;
  cur.az = (Math.atan2(off.x, -off.z) * 180 / Math.PI + 360) % 360;
}
back.addEventListener('click', leaveUserMode);
const canvas = stage.renderer.domElement;
function nearSun(e) {
  if (!sun.group.visible) return false;
  const [sx, sy] = sun.discScreen();
  const r = canvas.getBoundingClientRect();
  return Math.hypot(e.clientX - r.left - sx, e.clientY - r.top - sy) < 30;
}
canvas.addEventListener('pointerdown', (e) => {
  if (nearSun(e)) { dragSun = true; controls.enabled = false; canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
}, true);
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  if (dragSun) { const h = sun.hourAtScreen(e.clientX - r.left, e.clientY - r.top); if (h != null) setHour(h); }
  else canvas.style.cursor = nearSun(e) ? 'grab' : '';
});
canvas.addEventListener('pointerup', () => { if (dragSun) { dragSun = false; controls.enabled = true; } });

// ---------- Scroll halus ----------
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
  lenis.on('scroll', () => { if (Math.abs(lenis.velocity) > 0.5) leaveUserMode(); });
} else window.addEventListener('scroll', leaveUserMode, { passive: true });
const scrollYFor = (i) => (i === 0 ? 0 : sections[i].offsetTop + sections[i].offsetHeight * 0.6);
dots.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const y = scrollYFor(Number(b.dataset.i));
  if (lenis) lenis.scrollTo(y, { duration: 2.4 }); else window.scrollTo(0, y);
});
if (location.hash) {
  const i = CH.findIndex((c) => '#' + c.id === location.hash);
  if (i > 0) window.scrollTo(0, scrollYFor(i));
}
// Desktop: pusat bingkai digeser ke kanan kartu teks. HP: kartu di bawah, bingkai tidak digeser.
function fitFrame() {
  const card = document.querySelector('.l3d-card');
  stage.setFrameInset(window.innerWidth > 720 && card ? card.getBoundingClientRect().right + 16 : 0);
  stage.resize();
}
window.addEventListener('resize', fitFrame);

// ---------- Loop ----------
const idx = Object.fromEntries(CH.map((c, i) => [c.id, i]));
const near = (c, i, k = 1.6) => clamp01(1 - Math.abs(c - i) * k);
const at = (c, id, r = 0.3) => Math.abs(c - idx[id]) < r;
let last = performance.now(), lastHash = '', frames = 0;
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (lenis) lenis.raf(now);
  const c = chapterCoord();
  if (userMode) {
    controls.update();
    stage.applyCamera(stage.camera.position.clone(), controls.target);
  } else {
    mix(cur, desiredParams(c), reduceMotion ? 1 : 1 - Math.exp(-dt * 5.5), cur);
    applyParams(cur);
    controls.target.copy(cur.target);
  }

  // Sorotan per bab: Bab 1 = OTTV per arah, Bab 4 = SF per arah.
  const w1 = Math.max(near(c, idx['bab-1']), near(c, idx['bab-7'])), w4 = near(c, idx['bab-4']);
  if (w1 >= w4) { overlay.setWeights(ottvWeights); overlay.setAmount(w1); } else { overlay.setWeights(sfWeights); overlay.setAmount(w4); }
  wallSample.setAmount(near(c, idx['bab-6'], 2));
  arrows.setAmount(near(c, idx['bab-2'], 2.2));
  arrows.tick(stage.camera, now / 1000, reduceMotion);
  sun.setVisible(c > idx['bab-4'] - 0.45 && c < idx['bab-4'] + 0.55);
  L.total.on = at(c, 'bab-1');
  L.sf.forEach((l) => { l.on = at(c, 'bab-4'); });
  Object.values(L.heat).forEach((l) => { l.on = at(c, 'bab-2'); });
  L.wwr.on = at(c, 'bab-3');
  L.overhang.on = L.glassH.on = at(c, 'bab-5', 0.35);
  Object.values(L.side).forEach((l) => { l.on = at(c, 'bab-7'); });
  L.sky.on = c > idx['bab-8'] - 0.3;

  const active = Math.round(c);
  dots.querySelectorAll('button').forEach((b, i) => b.classList.toggle('is-on', i === active));
  const hash = '#' + CH[active].id;
  if (hash !== lastHash) { lastHash = hash; history.replaceState(null, '', active === 0 ? location.pathname + location.search : hash); }

  stage.render();
  if (++frames === 6) window.__ready = true;
  requestAnimationFrame(tick);
}

applyPreset('seimbang');
setSkylightArea(stage.tower, sim.sky * PODIUM_ROOF_AREA);
setHour(15);
fitFrame();
requestAnimationFrame(tick);
window.__stage = stage;
window.__story = { chapterCoord, setHour, lenis: () => lenis, sim, applyPreset };
