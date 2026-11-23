// Prototipe Tahap 2: scroll halus Beranda → Bab 4 → Bab 5 di satu adegan yang tetap.
// Scroll menentukan bab (sumber kebenaran); kamera menyusul dengan redaman.
import * as THREE from 'three';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStage, dirFrom } from './stage.js';
import { SHOTS } from './shots.js';
import { setOverhangDepth, TOWER, PODIUM_H } from './tower.js';
import { createSfOverlay, createSunMarker, DIR_NAME } from './highlights.js';
import { cityById, sceffHorizontal } from '../learn/ottvCalc.js';
import './learn3d.css';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const CH = [
  { id: 'mulai', shot: 'beranda' },
  { id: 'bab-4', shot: 'bab4' },
  { id: 'bab-5', shot: 'bab5' },
];
const SF = cityById('jakarta').sf;
const fmt = (x, d = 0) => Number(x).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- DOM ----------
document.body.classList.add('l3d-story-page');
const story = document.createElement('main');
story.className = 'l3d-story';
story.innerHTML = `
  <section class="l3d-sec" id="mulai"><article class="l3d-card">
    <p class="l3d-kicker">Belajar OTTV · prototipe Tahap 2</p>
    <h1>Dari kota ke satu jendela</h1>
    <p>Satu adegan yang sama dipakai di semua bab. Saat kamu scroll, kamera berpindah ke sudut yang sedang dibahas.</p>
    <p class="l3d-muted">Scroll pelan ke bawah untuk mulai.</p>
  </article></section>
  <section class="l3d-sec" id="bab-4"><article class="l3d-card">
    <p class="l3d-kicker">Bab 4</p>
    <h2>Arah hadap dan faktor radiasi (SF)</h2>
    <p>Tiap arah fasad menerima radiasi matahari yang berbeda. SNI merangkumnya dalam faktor radiasi (SF): nilai rata-rata per arah untuk tiap kota. Makin pekat oranyenya, makin besar SF fasad itu.</p>
    <div class="l3d-sf" aria-label="SF Jakarta per arah, W/m²">
      ${['U', 'T', 'S', 'B'].map((d) => `<div class="l3d-sf-row"><span>${DIR_NAME[d]}</span><i style="--w:${(SF[d] / 200) * 100}%"></i><b>${fmt(SF[d])}</b></div>`).join('')}
      <p class="l3d-muted">SF Jakarta, W/m²</p>
    </div>
    <p><b>Coba:</b> seret matahari di lintasannya. Sore hari sinar menimpa fasad Barat secara langsung, itu sebabnya SF Barat paling tinggi.</p>
    <p class="l3d-readout" id="sun-readout">Jam 15.00</p>
    <p class="l3d-note">Bayangan bangunan sekitar hanya ilustrasi. Perhitungan OTTV di LUXA tidak memasukkan bayangan dari bangunan lain.</p>
  </article></section>
  <section class="l3d-sec" id="bab-5"><article class="l3d-card">
    <p class="l3d-kicker">Bab 5</p>
    <h2>Kaca dan peneduh</h2>
    <p>Overhang menahan sebagian sinar langsung sebelum mengenai kaca. SNI menghitung pengaruhnya lewat SC efektif, yang bergantung pada rasio R, yaitu kedalaman overhang dibagi tinggi jendela.</p>
    <label class="l3d-ctl">Kedalaman overhang <input id="depth" type="range" min="0" max="1.5" step="0.05" value="0.7"><output id="depth-out">0,70 m</output></label>
    <label class="l3d-ctl">Jam <input id="hour5" type="range" min="6" max="18" step="0.25" value="15"><output id="hour5-out">15.00</output></label>
    <dl class="l3d-stats">
      <div><dt>Rasio R</dt><dd id="r-out">0,41</dd></div>
      <div><dt>Faktor SC efektif (Barat)</dt><dd id="sc-out">0,75</dd></div>
      <div><dt>Kaca terlindung jam ini</dt><dd id="shade-out">–</dd></div>
    </dl>
    <p class="l3d-note">Faktor SC efektif diambil dari tabel SNI (berlaku sepanjang tahun). Persentase kaca terlindung hanya untuk jam yang dipilih.</p>
  </article></section>`;
document.body.appendChild(story);

const dots = document.createElement('nav');
dots.className = 'l3d-dots';
dots.setAttribute('aria-label', 'Bab');
dots.innerHTML = CH.map((c, i) => `<button type="button" data-i="${i}" aria-label="${['Mulai', 'Bab 4', 'Bab 5'][i]}"><span>${['Mulai', 'Bab 4', 'Bab 5'][i]}</span></button>`).join('');
document.body.appendChild(dots);

const back = document.createElement('button');
back.type = 'button';
back.className = 'l3d-back';
back.textContent = 'Kembali ke sudut bab';
document.body.appendChild(back);

const themeBtn = document.createElement('button');
themeBtn.type = 'button';
themeBtn.className = 'l3d-theme';
themeBtn.textContent = theme === 'dark' ? 'Mode terang' : 'Mode gelap';
themeBtn.addEventListener('click', () => {
  const u = new URL(location.href);
  u.searchParams.set('theme', theme === 'dark' ? 'light' : 'dark');
  location.href = u.toString();
});
document.body.appendChild(themeBtn);

// ---------- Adegan ----------
const stage = createStage(document.getElementById('stage'), { theme });
const sfOverlay = createSfOverlay(stage, SF);
const sun = createSunMarker(stage, { radius: 170 });
const sfLabels = [
  stage.addLabel([-14, PODIUM_H + 46, -6], `Barat · SF ${fmt(SF.B)}`, { tag: true, lift: 48 }),
  stage.addLabel([6, PODIUM_H + 40, 14], `Selatan · SF ${fmt(SF.S)}`, { lift: 40 }),
  stage.addLabel([-2, PODIUM_H + 30, 8], `Barat (takik) · SF ${fmt(SF.B)}`, { lift: 30 }),
];
const ohLabels = [
  stage.addLabel([-14.6, 56.3, -10], 'Overhang', { tag: true, lift: 40, maxDist: 160 }),
  stage.addLabel([-14.05, 54.6, -1.5], 'Kaca 1,7 m', { lift: 30, maxDist: 160 }),
];
[...sfLabels, ...ohLabels].forEach((l) => { l.on = false; });

// ---------- Parameter kamera: interpolasi di ruang bola (target, azimut, elevasi, log jarak) ----------
function shotParams(name) {
  const s = SHOTS[name];
  return {
    target: new THREE.Vector3(...s.target), az: s.az, el: s.el, dist: s.dist,
    shadow: s.shadow || 460, focus: new THREE.Vector3(...(s.shadowFocus || [0, 0, 0])),
  };
}
const P = CH.map((c) => shotParams(c.shot));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAz = (a, b, t) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };
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

// Posisi bab kontinu c (0 = Mulai, 1 = Bab 4, 2 = Bab 5) dari posisi scroll.
// 55% awal tiap bagian dipakai kamera berpindah, sisanya untuk membaca dan mencoba.
const sections = [...story.querySelectorAll('.l3d-sec')];
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
  const e = reduceMotion ? (t > 0.35 ? 1 : 0) : ease(t);
  return mix(P[i], P[i + 1], e);
}

const cur = mix(P[0], P[0], 0);
function applyParams(p) {
  const pos = p.target.clone().addScaledVector(dirFrom(p.az, p.el), p.dist);
  stage.applyShadowArea(p.shadow, p.focus);
  stage.applyCamera(pos, p.target);
}

// ---------- Interaksi ----------
const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = false; // roda mouse dipakai scroll; zoom lewat cubit di layar sentuh
controls.maxPolarAngle = Math.PI * 0.49;
let userMode = false;
controls.addEventListener('start', () => {
  if (dragSun) return;
  userMode = true;
  back.classList.add('is-on');
});
function leaveUserMode() {
  if (!userMode) return;
  userMode = false;
  back.classList.remove('is-on');
  // Mulai dari posisi kamera sekarang supaya kembalinya mulus.
  const off = stage.camera.position.clone().sub(controls.target);
  cur.target.copy(controls.target);
  cur.dist = off.length();
  cur.el = Math.asin(off.y / cur.dist) * 180 / Math.PI;
  cur.az = (Math.atan2(off.x, -off.z) * 180 / Math.PI + 360) % 360;
}
back.addEventListener('click', leaveUserMode);

// Seret matahari di lintasannya (Bab 4).
let dragSun = false;
const canvas = stage.renderer.domElement;
function nearSun(e) {
  if (!sun.group.visible) return false;
  const [sx, sy] = sun.discScreen();
  const r = canvas.getBoundingClientRect();
  return Math.hypot(e.clientX - r.left - sx, e.clientY - r.top - sy) < 30;
}
canvas.addEventListener('pointerdown', (e) => {
  if (nearSun(e)) {
    dragSun = true;
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
}, true);
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  if (dragSun) {
    const h = sun.hourAtScreen(e.clientX - r.left, e.clientY - r.top);
    if (h != null) setHour(h);
  } else {
    canvas.style.cursor = nearSun(e) ? 'grab' : '';
  }
});
canvas.addEventListener('pointerup', () => {
  if (dragSun) { dragSun = false; controls.enabled = true; }
});

function compass(az) {
  const names = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
  return names[Math.round(az / 45) % 8];
}
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}.${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
function setHour(h) {
  const s = sun.setHour(h);
  document.getElementById('sun-readout').textContent = `Jam ${hhmm(s.hour)} · matahari dari arah ${compass(s.az)}, ketinggian ${fmt(s.el)}°`;
  const h5 = document.getElementById('hour5');
  if (Number(h5.value) !== s.hour) h5.value = s.hour;
  document.getElementById('hour5-out').textContent = hhmm(s.hour);
  updateShade();
}

// Bab 5: kedalaman overhang dan kaca terlindung pada jam terpilih (geometri sudut profil, fasad Barat).
let depth = TOWER.overhangDepth;
function updateShade() {
  const R = depth / TOWER.glassH;
  document.getElementById('depth-out').textContent = `${fmt(depth, 2)} m`;
  document.getElementById('r-out').textContent = fmt(R, 2);
  document.getElementById('sc-out').textContent = fmt(sceffHorizontal('B', R), 2);
  const pos = sun.group.children[0].position;
  const dir = pos.clone().normalize();
  const el = Math.asin(dir.y) * 180 / Math.PI;
  const az = (Math.atan2(dir.x, -dir.z) * 180 / Math.PI + 360) % 360;
  const diff = ((az - 270 + 540) % 360) - 180;
  const out = document.getElementById('shade-out');
  if (Math.abs(diff) >= 90 || el <= 0) { out.textContent = 'tidak kena sinar langsung'; return; }
  const tanP = Math.tan(el * Math.PI / 180) / Math.cos(diff * Math.PI / 180);
  const shaded = Math.min(1, Math.max(0, (depth * tanP - 0.1) / TOWER.glassH));
  out.textContent = `${fmt(shaded * 100)}%`;
}
document.getElementById('depth').addEventListener('input', (e) => {
  depth = Number(e.target.value);
  setOverhangDepth(stage.tower, depth);
  updateShade();
});
document.getElementById('hour5').addEventListener('input', (e) => setHour(Number(e.target.value)));

// ---------- Scroll halus ----------
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
  lenis.on('scroll', () => { if (Math.abs(lenis.velocity) > 0.5) leaveUserMode(); });
} else {
  window.addEventListener('scroll', leaveUserMode, { passive: true });
}
dots.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const s = sections[Number(b.dataset.i)];
  const y = s.offsetTop + (b.dataset.i === '0' ? 0 : s.offsetHeight * 0.6);
  if (lenis) lenis.scrollTo(y, { duration: 2.2 }); else window.scrollTo(0, y);
});
// Tautan langsung #bab-5 mendarat di sudut yang benar.
if (location.hash) {
  const idx = CH.findIndex((c) => '#' + c.id === location.hash);
  if (idx > 0) {
    const s = sections[idx];
    window.scrollTo(0, s.offsetTop + s.offsetHeight * 0.6);
  }
}

// ---------- Loop ----------
let last = performance.now(), lastHash = '', frames = 0;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (lenis) lenis.raf(now);
  const c = chapterCoord();

  if (userMode) {
    controls.update();
    stage.applyCamera(stage.camera.position.clone(), controls.target);
  } else {
    const want = desiredParams(c);
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 5.5);
    mix(cur, want, k, cur);
    applyParams(cur);
    controls.target.copy(cur.target);
  }

  // Sorotan mengikuti posisi bab.
  sfOverlay.setAmount(clamp01(1 - Math.abs(c - 1) * 1.6));
  sun.setVisible(c > 0.55 && c < 1.55);
  const inBab4 = Math.abs(c - 1) < 0.3, inBab5 = c > 1.8;
  sfLabels.forEach((l) => { l.on = inBab4; });
  ohLabels.forEach((l) => { l.on = inBab5; });

  const active = Math.round(c);
  dots.querySelectorAll('button').forEach((b, i) => b.classList.toggle('is-on', i === active));
  const hash = '#' + CH[active].id;
  if (hash !== lastHash) { lastHash = hash; history.replaceState(null, '', active === 0 ? location.pathname + location.search : hash); }

  stage.render();
  if (++frames === 6) window.__ready = true;
  requestAnimationFrame(tick);
}
setHour(15);
updateShade();
// Desktop: pusat bingkai digeser ke kanan kartu teks. HP: kartu di bawah, bingkai tidak digeser.
function fitFrame() {
  const card = document.querySelector('.l3d-card');
  const wide = window.innerWidth > 720;
  stage.setFrameInset(wide && card ? card.getBoundingClientRect().right + 16 : 0);
  stage.resize();
}
window.addEventListener('resize', fitFrame);
fitFrame();
requestAnimationFrame(tick);
window.__stage = stage;
window.__story = { chapterCoord, setHour, lenis: () => lenis };
