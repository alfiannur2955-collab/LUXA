// Beranda + Belajar OTTV dalam satu adegan 3D yang tetap.
// Scroll menentukan bab (sumber kebenaran); kamera menyusul dengan redaman; tiap bab menyalakan sorotannya sendiri.
// Modul ini tidak menjalankan apa pun saat diimpor: createStory() membangun adegan di dalam `host`,
// lalu aplikasi memanggil show() / hide() saat pindah langkah. Adegan tetap hidup di antara keduanya.
import * as THREE from 'three';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStage, dirFrom } from './stage.js';
import { SHOTS } from './shots.js';
import { setGlazing, setOverhangDepth, setSkylightArea, sillFor, PODIUM_H, TOWER_TOP, PODIUM_ROOF_AREA, SKY_MAX_AREA } from './tower.js';
import { createFacadeOverlay, createSunMarker, createHeatArrows, createWallSection, createFacadeBands } from './highlights.js';
import { PRESETS, SYMS, PATH_NAMES, chapters, LUX } from './content.js';
import { createClouds } from './clouds.js';
import { createBirds } from './birds.js';
import { createLife } from './life.js';
import { sim, sf, facade, total, glassH, effWwr, glassById, wallById, roofById, LIMIT, fmt, pct } from './sim.js';
import { sceffHorizontal, rttv, tdekWall } from '../learn/ottvCalc.js';
import { SNI } from '../learn/sniData.js';
import { luxSvg } from '../ui/mascot.js';
import { icon } from '../ui/icons.js';
import { escapeHtml } from '../ui/escapeHtml.js';
import { loadUserName, saveUserName, needsUserName, greetingWord } from '../ui/userName.js';
import './learn3d.css';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}.${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const luxRow = (id) => (LUX[id] ? `<div class="l3d-lux" data-lux="${id}">${luxSvg(LUX[id][0], { size: 46 })}<p>${LUX[id][1]}</p></div>` : '');

/**
 * @param {object} o
 * @param {HTMLElement} o.host        wadah adegan (di luar #app supaya tidak terhapus saat aplikasi render ulang)
 * @param {'light'|'dark'} o.theme
 * @param {boolean} o.embedded        true = di dalam aplikasi LUXA (topbar milik aplikasi, tombol aksi memanggil handler)
 * @param {object} o.handlers         onChapter(i), onStartNew(), onResume(saved), onTryExample(), onToggleTheme(), savedAutosave, mascotOn
 */
export function createStory({ host, theme = 'light', embedded = false, handlers = {} }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = hasWebGL();
  let h = { ...handlers };
  let lenis = null; // scroll halus, hanya hidup saat adegan tampil

  const root = document.createElement('div');
  root.className = 'l3d-root';
  root.dataset.theme = theme;
  root.innerHTML = '<div class="l3d-stage"></div>';
  host.appendChild(root);
  const $ = (id) => root.querySelector(`[data-id="${id}"]`);
  const $$ = (s) => root.querySelectorAll(s);

  // Tanpa WebGL hanya Beranda yang tampil (Belajar 3D butuh WebGL).
  const CH = chapters({ gl });
  const story = document.createElement('main');
  story.className = 'l3d-story';
  story.innerHTML = CH.map((c) => `<section class="l3d-sec" id="${c.id}"><article class="l3d-card">${c.html}${luxRow(c.id)}</article></section>`).join('');
  root.appendChild(story);
  const sections = [...story.querySelectorAll('.l3d-sec')];

  const dots = document.createElement('nav');
  dots.className = 'l3d-dots';
  dots.setAttribute('aria-label', 'Bab');
  dots.innerHTML = CH.map((c, i) => `<button type="button" data-i="${i}" aria-label="${c.title}"><span>${c.nav}</span></button>`).join('');
  if (gl) root.appendChild(dots);

  const back = Object.assign(document.createElement('button'), { type: 'button', className: 'l3d-back', textContent: 'Kembali ke sudut bab' });
  if (gl) root.appendChild(back);
  if (!embedded) {
    const themeBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'l3d-theme', textContent: theme === 'dark' ? 'Mode terang' : 'Mode gelap' });
    themeBtn.addEventListener('click', () => h.onToggleTheme?.());
    root.appendChild(themeBtn);
  }

  // ---------- Beranda (kartu pertama) ----------
  function renderHome() {
    const slot = root.querySelector('[data-slot="home"]');
    const name = (loadUserName() || '').trim();
    const saved = h.savedAutosave;
    const resume = saved ? escapeHtml(saved.filename || 'proyek terakhir') : '';
    slot.innerHTML = `
      <div class="l3d-home">
      <h1>${greetingWord()}${name ? `, ${escapeHtml(name)}` : ''}</h1>
      <p class="l3d-home-lead">LUXA menghitung seberapa banyak panas matahari masuk lewat dinding dan kaca bangunanmu, langsung dari model 3D. Kamu bisa lihat sisi mana yang paling panas.</p>
      <div class="l3d-actions l3d-actions-home">
        <button type="button" class="l3d-cta l3d-wide" data-act="start">${icon('upload', 17)}<span>Mulai proyek baru</span></button>
        ${saved ? `<button type="button" class="l3d-ghost" data-act="resume" title="Lanjutkan ${resume}">${icon('undo', 16)}<span>Lanjutkan ${resume}</span></button>` : ''}
        <button type="button" class="l3d-ghost${saved ? '' : ' l3d-wide'}" data-act="example">${icon('play', 16)}<span>Coba model contoh</span></button>
      </div>
      <ul class="l3d-tiles">
        <li>${icon('cube', 18)}<span>Baca .3dm, .ifc, .obj, .glb</span></li>
        <li>${icon('doc', 18)}<span>Rumus dan tabel SNI 6389:2020</span></li>
        <li>${icon('check', 18)}<span>Model tetap di perangkatmu</span></li>
      </ul>
      <div class="l3d-learn">
        <div>
          <h2>Belajar OTTV</h2>
          ${gl
            ? '<p>Sembilan bagian singkat. Scroll ke bawah, kamera membawamu ke bagian bangunan yang dibahas, dan kamu bisa langsung mencobanya.</p>'
            : '<p class="l3d-muted">Belajar OTTV butuh tampilan 3D (WebGL), dan browser atau perangkat ini belum mendukungnya. Coba buka LUXA di browser lain yang lebih baru.</p>'}
        </div>
        ${gl ? '<button type="button" class="l3d-cta l3d-cta-soft" data-act="learn">Mulai belajar</button>' : ''}
      </div>
      </div>`;
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'start') h.onStartNew?.();
    else if (act === 'resume') h.onResume?.(h.savedAutosave);
    else if (act === 'example') h.onTryExample?.();
    else if (act === 'learn') goTo(1);
    else if (act === 'top') goTo(0);
  });

  // ---------- Layar sambutan: nama wajib diisi pada kunjungan pertama ----------
  let gate = null;
  function openGate() {
    gate = document.createElement('div');
    gate.className = 'l3d-gate';
    gate.innerHTML = `
      <form class="l3d-gate-card" aria-labelledby="l3d-gate-title" novalidate>
        <div class="l3d-gate-lux">${luxSvg('wave', { size: 72 })}</div>
        <p class="l3d-kicker">Selamat datang di LUXA</p>
        <h1 id="l3d-gate-title">Halo, aku Lux. Kamu mau dipanggil siapa?</h1>
        <p class="l3d-muted">Nama ini hanya disimpan di browser ini dan dipakai untuk sapaan.</p>
        <label class="l3d-gate-field"><span>Nama panggilan</span><input type="text" name="name" maxlength="30" autocomplete="nickname" required></label>
        <p class="l3d-gate-err" role="alert"></p>
        <button type="submit" class="l3d-cta">Masuk</button>
      </form>`;
    root.appendChild(gate);
    root.classList.add('is-gated');
    document.body.classList.add('l3d-gated');
    const form = gate.querySelector('form');
    const inp = gate.querySelector('input');
    const err = gate.querySelector('.l3d-gate-err');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = inp.value.trim().slice(0, 30);
      if (!v) { err.textContent = 'Isi nama panggilanmu dulu ya.'; inp.focus(); return; }
      saveUserName(v);
      renderHome();
      closeGate();
    });
    requestAnimationFrame(() => inp.focus());
  }
  function closeGate() {
    if (!gate) return;
    const g = gate;
    gate = null;
    g.classList.add('is-out');
    setTimeout(() => g.remove(), reduceMotion ? 0 : 450);
    root.classList.remove('is-gated');
    document.body.classList.remove('l3d-gated');
    lenis?.start();
  }

  renderHome();
  if (needsUserName()) openGate();

  // Tanpa WebGL: hanya kartu Beranda di atas latar polos.
  if (!gl) {
    root.classList.add('is-flat');
    return {
      root,
      get active() { return 0; },
      show() { root.hidden = false; document.body.classList.add('l3d-on'); },
      hide() { root.hidden = true; document.body.classList.remove('l3d-on'); },
      setHandlers(next) { h = { ...h, ...next }; renderHome(); root.classList.toggle('l3d-no-lux', h.mascotOn === false); },
      destroy() { root.remove(); document.body.classList.remove('l3d-on'); },
    };
  }

  // ---------- Adegan + sorotan ----------
  const stage = createStage(root.querySelector('.l3d-stage'), { theme, shadowSize: 2048 });
  const overlay = createFacadeOverlay(stage);
  const clouds = createClouds(stage, { dark: theme === 'dark' });
  const birds = createBirds(stage, { dark: theme === 'dark' });
  const life = createLife(stage, { dark: theme === 'dark', city: stage.city });
  const sun = createSunMarker(stage, { radius: 170 });
  const arrows = createHeatArrows(stage, { dark: theme === 'dark' });
  // Potongan dinding Bab 6: dinding asli fasad Barat di bawah jendela lantai 10 dipotong di z = −9.
  const wallSample = createWallSection(stage, { facadeX: -14, zCut: -9 });
  const V0 = [0, 0, 0];
  const L = {
    sf: [
      stage.addLabel([-14, PODIUM_H + 46, -6], `Barat · SF ${fmt(sf().B)}`, { tag: true, lift: 48 }),
      stage.addLabel([6, PODIUM_H + 40, 14], `Selatan · SF ${fmt(sf().S)}`, { lift: 40 }),
      stage.addLabel([-2, PODIUM_H + 30, 8], `Barat (takik) · SF ${fmt(sf().B)}`, { lift: 30 }),
    ],
    total: stage.addLabel([4, TOWER_TOP + 3, -4], 'OTTV', { tag: true, lift: 30 }),
    heat: {
      wall: stage.addLabel(V0, PATH_NAMES.wall, { lift: 20, maxDist: 260 }),
      glass: stage.addLabel(V0, PATH_NAMES.glass, { lift: 20, maxDist: 260 }),
      solar: stage.addLabel(V0, PATH_NAMES.solar, { tag: true, lift: 26, maxDist: 260 }),
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
  // Bedah rumus: pita fasad yang menyala + label nilai simbol terpilih.
  const bands = createFacadeBands(stage);
  L.sym = stage.addLabel([-14.2, PODIUM_H + 10 * 4 + 2.2, -6], '', { tag: true, lift: 46, maxDist: 600 });
  L.sym.on = false;
  let sym = 'a';

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
      wallH: sill,
      glassH: gh,
      overhangDepth: sim.depth, // overhang Barat: bawahnya 0,10 m di atas kaca, tebal 0,16 m (tower.js)
      overhangBottom: base + sill + gh + 0.10,
    };
  }

  // Pita dinding padat di fasad Barat lantai 10: dari atas overhang lantai 9 sampai ambang kaca lantai 10.
  function wallBand() {
    const gh = glassH('B'), sill = sillFor(gh), base = PODIUM_H + FLOOR * 4;
    const top = base + sill;
    const bottom = Math.min(top - 0.8, base - 4 + sill + gh + 0.3);
    return [bottom, top];
  }

  // ---------- Pembaruan model + angka ----------
  let ottvWeights = { U: 0, T: 0, S: 0, B: 0 };
  const sfWeights = Object.fromEntries(['U', 'T', 'S', 'B'].map((d) => [d, clamp01((sf()[d] - 100) / 100)]));
  const outerColor = (a) => '#' + new THREE.Color('#F7F5F0').lerp(new THREE.Color('#4A4743'), clamp01((a - 0.2) / 0.7)).getHexString();
  function setLux(id, pose, text) {
    const box = root.querySelector(`[data-lux="${id}"]`);
    if (!box || box.dataset.pose === pose + text) return;
    box.dataset.pose = pose + text;
    box.innerHTML = `${luxSvg(pose, { size: 46 })}<p>${text}</p>`;
  }
  function syncModel() {
    setGlazing(stage.tower, { heights: { U: glassH('U'), T: glassH('T'), S: glassH('S'), B: glassH('B') }, depth: sim.depth });
    bands.rebuild(glassH('B'), sillFor(glassH('B')));
  }
  const verdict = (v) => (v <= LIMIT ? `Memenuhi batas SNI (paling tinggi ${fmt(LIMIT)} W/m²)` : `Melebihi batas SNI sebesar ${fmt(v - LIMIT, 1)} W/m²`);
  function refresh() {
    const t = total();
    const w = facade('B');
    // Bab 1
    $('ottv-total').textContent = fmt(t.ottv, 1);
    $('ottv-total-bar').style.width = `${Math.min(100, (t.ottv / 80) * 100)}%`;
    $('ottv-total-bar').classList.toggle('is-over', t.ottv > LIMIT);
    $('ottv-total-verdict').textContent = verdict(t.ottv);
    $('preset-desc').textContent = `Kaca ${pct(effWwr('B'))} · ${glassById(sim.glass).name} · ${wallById(sim.wall).name} · ${sim.depth > 0.02 ? `overhang ${fmt(sim.depth, 2)} m di sisi Barat` : 'tanpa peneduh'}`;
    L.total.setText(`OTTV ${fmt(t.ottv, 1)} W/m²`);
    ottvWeights = Object.fromEntries(Object.entries(t.per).map(([d, f]) => [d, clamp01((f.total - 15) / 50)]));
    // Bab 2
    $('t-wall').textContent = fmt(w.qWall, 1);
    $('t-glass').textContent = fmt(w.qGlass, 1);
    $('t-solar').textContent = fmt(w.qSolar, 1);
    $('t-total').textContent = fmt(w.total, 1);
    $('t-note').textContent = `Contoh: sisi Barat di Jakarta, kaca ${pct(effWwr('B'))}, ${glassById(sim.glass).name.toLowerCase()}, ${wallById(sim.wall).name.toLowerCase()}.`;
    // Bab 3
    $('wwr').value = sim.wwr.B;
    $('wwr-out').textContent = pct(effWwr('B'));
    const sum = w.qWall + w.qGlass + w.qSolar;
    for (const [k, v] of [['wall', w.qWall], ['glass', w.qGlass], ['solar', w.qSolar]]) {
      $(`s-${k}`).style.width = `${(v / Math.max(sum, 70)) * 100}%`;
      $(`w-${k}`).textContent = fmt(v, 1);
    }
    $('w-total').textContent = fmt(w.total, 1);
    L.wwr.setText(`WWR ${pct(effWwr('B'))}`);
    // Bab 5
    const R = sim.depth / glassH('B');
    $('depth').value = sim.depth;
    $('depth-out').textContent = `${fmt(sim.depth, 2)} m`;
    $('r-out').textContent = fmt(R, 2);
    $('sc-out').textContent = fmt(sceffHorizontal('B', R), 2);
    $('sct-out').textContent = fmt(w.scEff, 2);
    $$('[data-glass]').forEach((x) => x.classList.toggle('is-on', x.dataset.glass === sim.glass));
    L.glassH.setText(`Kaca ${fmt(glassH('B'), 1)} m`);
    updateShade();
    // Bab 6
    const wall = wallById(sim.wall), alpha = sim.alpha ?? wall.alpha;
    $$('[data-wall]').forEach((x) => x.classList.toggle('is-on', x.dataset.wall === sim.wall));
    $('alpha').value = alpha;
    $('alpha-out').innerHTML = `<i class="l3d-swatch" style="background:${outerColor(alpha)}"></i>${fmt(alpha, 2)}`;
    $('d-u').textContent = `${fmt(wall.u_value, 2)} W/m²K`;
    $('d-m').textContent = `${fmt(wall.massa_kg_m2)} kg/m²`;
    $('d-td').textContent = `${tdekWall(wall.massa_kg_m2)} K`;
    $('d-q').textContent = fmt(w.qWall, 1);
    $('d-total').textContent = fmt(w.total, 1);
    wallSample.update(sim.wall, outerColor(alpha), wallBand());
    // Bab 7
    for (const d of ['U', 'T', 'S', 'B']) {
      root.querySelector(`[data-side="${d}"]`).value = sim.wwr[d];
      root.querySelector(`[data-side-out="${d}"]`).textContent = pct(effWwr(d));
      root.querySelector(`[data-side-ottv="${d}"]`).textContent = fmt(t.per[d].total, 1);
    }
    $('ottv-total7').textContent = fmt(t.ottv, 1);
    $('ottv-total7-bar').style.width = `${Math.min(100, (t.ottv / 80) * 100)}%`;
    $('ottv-total7-bar').classList.toggle('is-over', t.ottv > LIMIT);
    $('ottv-total7-verdict').textContent = verdict(t.ottv);
    L.side.B.setText(`Barat · ${fmt(t.per.B.total, 1)}`);
    L.side.S.setText(`Selatan · ${fmt(t.per.S.total, 1)}`);
    setLux('bab-7', t.ottv <= LIMIT ? 'happy' : 'think', t.ottv <= LIMIT ? 'Memenuhi! Tetap ingat: yang dinilai angka total, bukan satu fasad.' : LUX['bab-7'][1]);
    // Bab 8
    const rf = roofById(sim.roof), sg = glassById('glz_kaca_tinted_8');
    const r = rttv({ alpha: rf.alpha, ur: rf.u_value, massa: rf.massa_kg_m2, areaRoof: PODIUM_ROOF_AREA, skyRatio: sim.sky, us: sg.u_value, sc: sg.sc, sfRoof: sf().ROOF });
    $$('[data-roof]').forEach((x) => x.classList.toggle('is-on', x.dataset.roof === sim.roof));
    $('sky').value = sim.sky;
    $('sky-out').textContent = sim.sky > 0.001 ? `${pct(sim.sky)} atap (${fmt(sim.sky * PODIUM_ROOF_AREA)} m²)` : 'tanpa skylight';
    $('r-roof').textContent = fmt(r.qRoof, 1);
    $('r-cond').textContent = fmt(r.qCond, 1);
    $('r-solar').textContent = fmt(r.qSolar, 1);
    $('rttv-total').textContent = fmt(r.total, 1);
    $('rttv-bar').style.width = `${Math.min(100, (r.total / 80) * 100)}%`;
    $('rttv-bar').classList.toggle('is-over', r.total > r.limit);
    $('rttv-limit').style.left = `${(r.limit / 80) * 100}%`;
    $('rttv-limit').querySelector('span').textContent = `batas ${fmt(r.limit)}`;
    $('rttv-verdict').textContent = r.total <= r.limit ? `Memenuhi batas ${fmt(r.limit)} W/m²` : `Melebihi batas ${fmt(r.limit)} W/m² sebesar ${fmt(r.total - r.limit, 1)}`;
    L.sky.setText(sim.sky > 0.001 ? `Skylight ${pct(sim.sky)}` : 'Tanpa skylight');
    // Label dan panah yang ikut tinggi kaca
    const a = anchorsWest();
    const out = new THREE.Vector3(-5.4, 0, 0);
    L.heat.wall.setPos(a.wall.clone().add(out));
    L.heat.glass.setPos(a.glass.clone().add(out));
    L.overhang.setPos(a.overhang);
    L.glassH.setPos(a.glassMid);
    arrows.update({ q: w, anchors: a });
    renderSym();
  }

  // ---------- Bedah rumus ----------
  const titleOf = (id) => (CH.find((c) => c.id === id) || {}).title || '';
  function symValues() {
    const w = facade('B'), wall = wallById(sim.wall), g = glassById(sim.glass);
    return {
      w,
      v: { one: fmt(1 - effWwr('B'), 2), a: fmt(sim.alpha ?? wall.alpha, 2), uw: fmt(wall.u_value, 2), wwr: fmt(effWwr('B'), 2), td: fmt(w.tdek), uf: fmt(g.u_value, 2), dt: fmt(SNI.deltaT), sc: fmt(w.scEff, 2), sf: fmt(sf().B) },
    };
  }
  function renderSym() {
    const d = SYMS[sym];
    const { w, v } = symValues();
    $$('[data-sym]').forEach((b) => b.classList.toggle('is-on', b.dataset.sym === sym));
    const unit = /^W/.test(d.unit) ? ` ${d.unit}` : /^K/.test(d.unit) ? ' K' : '';
    $('sym-info').innerHTML = `<p class="l3d-sym-head"><b>${d.sym}</b><span>${d.name}</span></p><p>${d.text}</p>
      <dl><div><dt>Satuan</dt><dd>${d.unit}</dd></div><div><dt>Nilainya dari</dt><dd>${d.from}</dd></div><div><dt>Tower ini</dt><dd>${v[sym]}${unit}</dd></div></dl>
      <button type="button" class="l3d-link" data-goto="${d.goto}">Dibahas di: ${titleOf(d.goto)}</button>`;
    const n = (k) => `<i data-n="${k}"${k === sym ? ' class="on"' : ''}>${v[k]}</i>`;
    const oneN = `<i data-n="one"${sym === 'one' ? ' class="on"' : ''}>1 − ${n('wwr')}</i>`;
    $('sym-num').innerHTML = `${n('a')} · [${n('uw')} · (${oneN}) · ${n('td')}] + ${n('uf')} · ${n('wwr')} · ${n('dt')} + ${n('sc')} · ${n('wwr')} · ${n('sf')}<br>= ${fmt(w.qWall, 1)} + ${fmt(w.qGlass, 1)} + ${fmt(w.qSolar, 1)} = <b>${fmt(w.total, 1)} W/m²</b>`;
    bands.setKind(d.target);
    L.sym.setText(`${d.sym} = ${v[sym]}${unit}`);
  }

  function compass(az) {
    const names = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
    return names[Math.round(az / 45) % 8];
  }
  function setHour(hr) {
    const s = sun.setHour(hr);
    sim.hour = s.hour;
    $('sun-readout').textContent = `Jam ${hhmm(s.hour)} · matahari dari arah ${compass(s.az)}, ketinggian ${fmt(s.el)}°`;
    $('hour5').value = s.hour;
    $('hour5-out').textContent = hhmm(s.hour);
    refresh();
  }
  // Kaca terlindung pada jam terpilih: geometri sudut profil di fasad Barat (normal ke azimut 270°).
  function updateShade() {
    const { az, el } = sun.sun;
    const diff = ((az - 270 + 540) % 360) - 180;
    const out = $('shade-out');
    if (Math.abs(diff) >= 90 || el <= 0) { out.innerHTML = '0%<small>matahari di sisi lain</small>'; return; }
    const tanP = Math.tan(el * Math.PI / 180) / Math.cos(diff * Math.PI / 180);
    out.textContent = pct(clamp01((sim.depth * tanP - 0.1) / glassH('B')));
  }

  // ---------- Kontrol bab ----------
  function markPreset(k) { $$('[data-preset]').forEach((x) => x.classList.toggle('is-on', x.dataset.preset === k)); sim.preset = k; }
  function applyPreset(k) {
    const p = PRESETS[k];
    for (const d of ['U', 'T', 'S', 'B']) sim.wwr[d] = p.wwr;
    sim.glass = p.glass;
    sim.wall = p.wall;
    sim.alpha = null;
    sim.depth = Math.round(p.R * glassH('B') * 20) / 20;
    markPreset(k);
    syncModel();
    refresh();
  }
  const clearPreset = () => markPreset(null);
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  // Panah tampil bergantian; kartu dan label mengikuti panah yang sedang aktif. Arahkan kursor = kunci satu jalur.
  const termBtns = [...$$('[data-term]')];
  let shownTerm = null;
  function syncTerm(k) {
    if (k === shownTerm) return;
    shownTerm = k;
    termBtns.forEach((x) => x.classList.toggle('is-live', x.dataset.term === k));
    for (const [n, l] of Object.entries(L.heat)) l.el.classList.toggle('is-dim', n !== k);
  }
  termBtns.forEach((b) => {
    const k = b.dataset.term;
    const on = () => { arrows.setFocus(k); b.classList.add('is-on'); };
    const off = () => { arrows.setFocus(null); b.classList.remove('is-on'); };
    b.addEventListener('mouseenter', on); b.addEventListener('focus', on);
    b.addEventListener('mouseleave', off); b.addEventListener('blur', off);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sym]');
    if (b) { sym = b.dataset.sym; renderSym(); return; }
    const g = e.target.closest('[data-goto]');
    if (g) goTo(CH.findIndex((c) => c.id === g.dataset.goto));
  });
  $$('[data-glass]').forEach((b) => b.addEventListener('click', () => { sim.glass = b.dataset.glass; clearPreset(); refresh(); }));
  $('wwr').addEventListener('input', (e) => { sim.wwr.B = Number(e.target.value); clearPreset(); syncModel(); refresh(); });
  $('depth').addEventListener('input', (e) => { sim.depth = Number(e.target.value); setOverhangDepth(stage.tower, sim.depth); refresh(); });
  $('hour5').addEventListener('input', (e) => setHour(Number(e.target.value)));
  $$('[data-wall]').forEach((b) => b.addEventListener('click', () => { sim.wall = b.dataset.wall; sim.alpha = null; clearPreset(); refresh(); }));
  $('alpha').addEventListener('input', (e) => { sim.alpha = Number(e.target.value); clearPreset(); refresh(); });
  $$('[data-side]').forEach((inp) => inp.addEventListener('input', () => { sim.wwr[inp.dataset.side] = Number(inp.value); clearPreset(); syncModel(); refresh(); }));
  $$('[data-roof]').forEach((b) => b.addEventListener('click', () => { sim.roof = b.dataset.roof; refresh(); }));
  $('sky').addEventListener('input', (e) => { sim.sky = Number(e.target.value); setSkylightArea(stage.tower, sim.sky * PODIUM_ROOF_AREA); refresh(); });

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
      const span = s.offsetHeight * 0.35; // bab penuh lebih awal, jadi kartu panjang masih menempel di posisinya
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
    if (dragSun) { const hr = sun.hourAtScreen(e.clientX - r.left, e.clientY - r.top); if (hr != null) setHour(hr); }
    else canvas.style.cursor = nearSun(e) ? 'grab' : '';
  });
  canvas.addEventListener('pointerup', () => { if (dragSun) { dragSun = false; controls.enabled = true; } });

  // ---------- Scroll halus (hanya hidup saat adegan tampil) ----------
  const onNativeScroll = () => leaveUserMode();
  function startScroll() {
    if (lenis || reduceMotion) { if (reduceMotion) window.addEventListener('scroll', onNativeScroll, { passive: true }); return; }
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
    lenis.on('scroll', () => { if (Math.abs(lenis.velocity) > 0.5) leaveUserMode(); });
    if (gate) lenis.stop();
  }
  function stopScroll() {
    window.removeEventListener('scroll', onNativeScroll);
    lenis?.destroy();
    lenis = null;
  }
  // Posisi scroll tempat bab i sudah penuh (lihat chapterCoord) dan kartunya masih menempel di atas.
  const scrollYFor = (i) => (i === 0 ? 0 : Math.round(sections[i].offsetTop + sections[i].offsetHeight * 0.35 - window.innerHeight * 0.5 + 40));
  // Lompat ke bagian i. Bagian sebelah: scroll halus seperti biasa. Lompatan jauh (mis. Kembali ke Beranda):
  // kartu memudar, halaman pindah tanpa terlihat menggulir, kamera terbang langsung dalam satu gerakan pelan.
  let flyUntil = 0, jumpTimer = 0;
  function goTo(i, { instant = false } = {}) {
    const ti = Math.max(0, Math.min(CH.length - 1, i));
    const y = scrollYFor(ti);
    if (!instant && Math.abs(ti - active) > 1) {
      clearTimeout(jumpTimer);
      story.classList.add('is-jumping');
      dots.classList.add('is-jumping');
      jumpTimer = setTimeout(() => {
        window.scrollTo(0, y);
        lenis?.resize();
        lenis?.scrollTo(y, { immediate: true, force: true });
        flyUntil = performance.now() + 2600;
        requestAnimationFrame(() => { story.classList.remove('is-jumping'); dots.classList.remove('is-jumping'); });
      }, reduceMotion ? 0 : 260);
      return;
    }
    if (lenis && !instant) { lenis.scrollTo(y, { duration: 1.8 }); return; }
    // Lompat langsung pakai scroll bawaan: batas Lenis bisa belum terukur tepat setelah adegan ditampilkan.
    window.scrollTo(0, y);
    lenis?.resize();
  }
  dots.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) goTo(Number(b.dataset.i));
  });
  // Desktop: pusat bingkai digeser ke kanan kartu teks. HP: kartu di bawah, bingkai tidak digeser.
  function fitFrame() {
    const card = root.querySelector('.l3d-card');
    stickTop = card ? parseFloat(getComputedStyle(card).top) || 0 : 0;
    stage.setFrameInset(window.innerWidth > 720 && card ? card.getBoundingClientRect().right + 16 : 0);
    stage.resize();
  }

  // ---------- Gerak kartu ----------
  // Kartu yang didorong keluar mengecil dan memudar; kartu yang sedang bergerak sedikit meregang mengikuti
  // kecepatan scroll; saat menempel di posisinya kartu memantul pelan (squash lalu kembali).
  const cards = [...root.querySelectorAll('.l3d-card')];
  const docked = cards.map(() => false);
  let stickTop = 0;
  function cardFx() {
    if (reduceMotion) return;
    const v = lenis ? lenis.velocity : 0;
    const stretch = Math.min(0.03, Math.abs(v) * 0.0016);
    const vh = window.innerHeight;
    cards.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < -40 || r.top > vh + 40) {
        if (el.style.transform || el.style.opacity) { el.style.transform = ''; el.style.opacity = ''; }
        docked[i] = false;
        return;
      }
      const dy = r.top - stickTop;
      if (dy < -1) {
        const p = clamp01(-dy / (r.height * 0.7));
        el.style.transformOrigin = 'center top';
        el.style.transform = `scale(${(1 - 0.06 * p).toFixed(4)})`;
        el.style.opacity = (1 - 0.55 * p).toFixed(3);
        docked[i] = false;
      } else if (dy > 1) {
        el.style.transformOrigin = v >= 0 ? 'center top' : 'center bottom';
        el.style.transform = stretch > 0.002 ? `scaleY(${(1 + stretch).toFixed(4)})` : '';
        el.style.opacity = '';
        docked[i] = false;
      } else {
        if (!docked[i]) {
          docked[i] = true;
          el.style.transformOrigin = 'center top';
          if (frames > 10) { el.classList.remove('is-dock'); void el.offsetWidth; el.classList.add('is-dock'); }
        }
        if (el.style.transform || el.style.opacity) { el.style.transform = ''; el.style.opacity = ''; }
      }
    });
  }
  cards.forEach((el) => el.addEventListener('animationend', () => el.classList.remove('is-dock')));

  // ---------- Loop ----------
  const idx = Object.fromEntries(CH.map((c, i) => [c.id, i]));
  const near = (c, i, k = 1.6) => clamp01(1 - Math.abs(c - i) * k);
  const at = (c, id, r = 0.3) => Math.abs(c - idx[id]) < r;
  let last = performance.now(), frames = 0, raf = 0, running = false, active = 0;
  // Diam (tanpa gulir, geser, atau kamera bergerak) → cukup ±30 bingkai/detik untuk awan, burung, dan lalu lintas.
  let lastActive = 0, lastDraw = 0;
  const camPrev = new THREE.Vector3();
  const poke = () => { lastActive = performance.now(); };
  ['wheel', 'pointerdown', 'pointermove', 'keydown', 'touchmove', 'scroll'].forEach((t) => window.addEventListener(t, poke, { passive: true }));
  function tick(now) {
    if (!running) return;
    if (now - lastActive > 900 && now - lastDraw < 31) { raf = requestAnimationFrame(tick); return; }
    lastDraw = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (lenis) lenis.raf(now);
    const c = chapterCoord();
    if (userMode) {
      controls.update();
      stage.applyCamera(stage.camera.position.clone(), controls.target);
    } else {
      const rate = now < flyUntil ? 1.7 : 5.5; // terbang langsung lebih pelan setelah lompatan jauh
      mix(cur, desiredParams(c), reduceMotion ? 1 : 1 - Math.exp(-dt * rate), cur);
      applyParams(cur);
      controls.target.copy(cur.target);
    }
    const camDist = stage.camera.position.distanceTo(controls.target);
    clouds.tick(stage.camera, now / 1000, camDist, reduceMotion);
    birds.tick(now / 1000, camDist, reduceMotion);
    life.tick(now / 1000, dt, camDist, reduceMotion);

    // Sorotan per bab: Bab 1 dan 7 = OTTV per arah, Bab 4 = SF per arah.
    const w1 = Math.max(near(c, idx['bab-1']), near(c, idx['bab-7'])), w4 = near(c, idx['bab-4']);
    if (w1 >= w4) { overlay.setWeights(ottvWeights); overlay.setAmount(w1); } else { overlay.setWeights(sfWeights); overlay.setAmount(w4); }
    wallSample.setAmount(near(c, idx['bab-6'], 2));
    bands.setAmount(near(c, idx.rumus, 2));
    bands.tick(now);
    L.sym.on = at(c, 'rumus');
    arrows.setAmount(near(c, idx['bab-2'], 2.2));
    arrows.tick(stage.camera, window.__l3dT ?? now / 1000, reduceMotion); // __l3dT: jam beku untuk uji otomatis
    if (arrows.solarLabelPos) L.heat.solar.setPos(arrows.solarLabelPos); // label sinar mengikuti arah sinar matahari
    if (!reduceMotion) syncTerm(arrows.active);
    sun.setVisible(c > idx['bab-4'] - 0.45 && c < idx['bab-4'] + 0.55);
    L.total.on = at(c, 'bab-1');
    L.sf.forEach((l) => { l.on = at(c, 'bab-4'); });
    Object.values(L.heat).forEach((l) => { l.on = at(c, 'bab-2'); });
    L.wwr.on = at(c, 'bab-3');
    L.overhang.on = L.glassH.on = at(c, 'bab-5', 0.35);
    Object.values(L.side).forEach((l) => { l.on = at(c, 'bab-7'); });
    L.sky.on = at(c, 'bab-8', 0.45);

    const a = Math.round(c);
    if (a !== active || frames === 0) {
      active = a;
      dots.querySelectorAll('button').forEach((b, i) => b.classList.toggle('is-on', i === active));
      history.replaceState(history.state, '', active === 0 ? location.pathname + location.search : '#' + CH[active].id);
      h.onChapter?.(active);
    }

    cardFx();
    stage.render();
    stage.govern(now, (lvl) => { if (lvl >= 2) clouds.off = true; }, now - lastActive > 900 ? 52 : 36);
    if (camPrev.distanceToSquared(stage.camera.position) > 1e-4) { lastActive = now; camPrev.copy(stage.camera.position); }
    if (++frames === 6) window.__ready = true;
    raf = requestAnimationFrame(tick);
  }
  const onResize = () => fitFrame();
  // Tautan #bab-N yang diubah di bilah alamat: browser melompat ke awal bagian, lalu kita rapikan ke posisi bab penuh.
  const onHash = () => {
    const i = CH.findIndex((c) => '#' + c.id === location.hash);
    if (i >= 0) goTo(i);
  };

  if (sim.preset !== null) applyPreset(sim.preset || 'seimbang');
  else { markPreset(null); syncModel(); refresh(); }
  setOverhangDepth(stage.tower, sim.depth);
  setSkylightArea(stage.tower, sim.sky * PODIUM_ROOF_AREA);
  setHour(sim.hour ?? 15);

  let visible = false, shownOnce = false;
  const api = {
    root,
    get active() { return active; },
    /** Tampilkan adegan di bab `chapter` (0 = Beranda). Bila sudah tampil di bab itu, tidak melakukan apa-apa. */
    show({ chapter = 0 } = {}) {
      let ch = Math.max(0, Math.min(CH.length - 1, chapter | 0));
      // Tampil pertama kali dengan tautan #id bagian: buka bagian itu.
      if (!shownOnce && location.hash) {
        const hi = CH.findIndex((c) => '#' + c.id === location.hash);
        if (hi >= 0) ch = hi;
      }
      shownOnce = true;
      if (visible) {
        if (ch !== active) goTo(ch);
        return;
      }
      visible = true;
      root.hidden = false;
      document.body.classList.add('l3d-on');
      startScroll();
      fitFrame();
      goTo(ch, { instant: true });
      // Datang dari halaman lain: kamera langsung di sudut bab, tanpa terbang dari posisi lama.
      mix(cur, desiredParams(chapterCoord()), 1, cur);
      active = ch;
      frames = 0;
      window.addEventListener('resize', onResize);
      window.addEventListener('hashchange', onHash);
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    },
    hide() {
      if (!visible) return;
      visible = false;
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('hashchange', onHash);
      stopScroll();
      root.hidden = true;
      document.body.classList.remove('l3d-on');
      history.replaceState(history.state, '', location.pathname + location.search);
      window.scrollTo(0, 0);
    },
    setHandlers(next) {
      h = { ...h, ...next };
      renderHome();
      root.classList.toggle('l3d-no-lux', h.mascotOn === false);
    },
    destroy() {
      api.hide();
      controls.dispose();
      stage.dispose();
      root.remove();
      document.body.classList.remove('l3d-gated');
    },
    // Untuk uji otomatis
    _debug: { stage, chapterCoord, setHour, lenis: () => lenis, sim, applyPreset, cur, idx },
  };
  root.hidden = true;
  window.__l3d = api._debug;
  return api;
}
