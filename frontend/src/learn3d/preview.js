// Pratinjau bebas (Tahap 1): kamera bebas, tombol sudut per bab, jam matahari, terang/gelap.
// ?shot=beranda|bab1|bab4|bab5|bab7 &theme=light|dark &labels=0 &ui=0 (untuk tangkapan gambar otomatis)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStage } from './stage.js';
import { PODIUM_H, TOWER_TOP } from './tower.js';
import { sunPosition } from './sun.js';
import './learn3d.css';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
let shot = q.get('shot') || 'beranda';
document.documentElement.dataset.theme = theme;

document.body.classList.add('l3d-on');
const host = Object.assign(document.createElement('div'), { className: 'l3d-stage' });
document.body.appendChild(host);
const stage = createStage(host, { theme });
if (q.get('pp') === '0') stage.raw = true;

// Label contoh. Label kecil hanya muncul saat kamera cukup dekat.
if (q.get('labels') !== '0') {
  stage.addLabel([-14, 74, -10], 'Fasad Barat', { lift: 70, maxDist: 1400 });
  stage.addLabel([-2, PODIUM_H + 22, 2], 'Takik', { lift: 30, maxDist: 1400 });
  stage.addLabel([-20, PODIUM_H, 20], 'Podium', { lift: 44, maxDist: 1400 });
  stage.addLabel([4, TOWER_TOP + 3, -4], 'Tower 20 lantai', { tag: true, lift: 30, maxDist: 1400 });
  stage.addLabel([-14.7, 56.3, -10], 'Overhang 0,7 m', { tag: true, lift: 40, maxDist: 140 });
  stage.addLabel([-14.05, 54.5, -1], 'Kaca 1,7 m', { lift: 30, maxDist: 140 });
}

const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 20;
controls.maxDistance = 2600;
controls.zoomSpeed = 0.8;

const pose = stage.setShot(shot);
controls.target.copy(pose.target);
controls.update();

// Perpindahan sudut sederhana (gerak kamera sungguhan disetel di Tahap 2).
let tween = null;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function goTo(name) {
  shot = name;
  document.querySelectorAll('[data-shot]').forEach((b) => b.classList.toggle('is-on', b.dataset.shot === name));
  const to = stage.poseOf(name);
  stage.applyShadowArea(to.shadowHalf, to.shadowFocus);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stage.applyCamera(to.pos, to.target);
    controls.target.copy(to.target);
    return;
  }
  tween = { t0: performance.now(), ms: 1600, fromPos: stage.camera.position.clone(), fromTarget: controls.target.clone(), to };
}

// Jam matahari: lintasan timur–barat untuk Jakarta pada tanggal hari ini.
const today = new Date();
function setHour(h) {
  const s = sunPosition({ month: today.getMonth() + 1, day: today.getDate(), hour: h });
  stage.setSun(s.az, Math.max(s.el, 2));
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const out = document.getElementById('hour-out');
  if (out) out.textContent = `${String(hh).padStart(2, '0')}.${String(mm).padStart(2, '0')}`;
}

// Panel kontrol kaca
if (q.get('ui') !== '0') {
  const ui = document.createElement('div');
  ui.className = 'l3d-ui';
  const shots = [['beranda', 'Beranda'], ['bab1', 'Bab 1'], ['bab4', 'Bab 4'], ['bab5', 'Bab 5'], ['bab7', 'Bab 7']];
  ui.innerHTML = `
    <div class="l3d-ui-title">Pratinjau Belajar 3D <span>Tahap 1</span></div>
    <div class="l3d-ui-row">${shots.map(([k, t]) => `<button type="button" data-shot="${k}" class="${k === shot ? 'is-on' : ''}">${t}</button>`).join('')}</div>
    <label class="l3d-ui-row l3d-ui-hour">Jam <input id="hour" type="range" min="6" max="18" step="0.25" value="15"> <output id="hour-out">bawaan</output></label>
    <div class="l3d-ui-row"><button type="button" id="theme">${theme === 'dark' ? 'Mode terang' : 'Mode gelap'}</button><span class="l3d-ui-hint">Seret untuk memutar, scroll untuk zoom</span></div>`;
  document.body.appendChild(ui);
  ui.querySelectorAll('[data-shot]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.shot)));
  ui.querySelector('#hour').addEventListener('input', (e) => setHour(Number(e.target.value)));
  ui.querySelector('#theme').addEventListener('click', () => {
    const u = new URL(location.href);
    u.searchParams.set('theme', theme === 'dark' ? 'light' : 'dark');
    u.searchParams.set('shot', shot);
    location.href = u.toString();
  });
}

window.addEventListener('resize', () => stage.resize());

let frames = 0;
const tmpPos = new THREE.Vector3(), tmpTarget = new THREE.Vector3();
(function tick(now) {
  if (tween) {
    const k = Math.min(1, (now - tween.t0) / tween.ms);
    const e = ease(k);
    tmpPos.lerpVectors(tween.fromPos, tween.to.pos, e);
    tmpTarget.lerpVectors(tween.fromTarget, tween.to.target, e);
    stage.applyCamera(tmpPos, tmpTarget);
    controls.target.copy(tmpTarget);
    if (k >= 1) tween = null;
  } else {
    controls.update();
    stage.applyCamera(stage.camera.position.clone(), controls.target);
  }
  stage.render();
  if (++frames === 6) window.__ready = true;
  requestAnimationFrame(tick);
})(performance.now());
window.__stage = stage;
