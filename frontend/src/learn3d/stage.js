// Panggung Belajar 3D: renderer, kamera telefoto, matahari, AO, label HTML.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';
import { PALETTES } from './palette.js';
import { buildCity } from './city.js';
import { buildTower } from './tower.js';
import { SHOTS } from './shots.js';

const DEG = Math.PI / 180;
// Matahari bawaan: sore hari di lintasan timur–barat (dari barat, sedikit ke selatan), sama di semua sudut.
// Kamera yang menyesuaikan, supaya matahari datang dari samping dan bayangan terbaca.
const DEFAULT_SUN = [262, 40];

// Arah dari target ke kamera; azimut dari utara searah jarum jam (utara = -z).
export function dirFrom(azDeg, elDeg) {
  const az = azDeg * DEG, el = elDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

// context: false = panggung kosong tanpa kota dan tower contoh (dipakai Mode Presentasi untuk model pengguna).
// autoQuality (bawaan untuk Beranda/Belajar): ketajaman mengikuti luas kanvas, AO setengah resolusi, dan penjaga
// kualitas menurunkan efek bila bingkai lambat (laptop dengan GPU terintegrasi).
export function createStage(container, { theme = 'light', fov = 14, shadowSize = 4096, context = true, autoQuality = context } = {}) {
  const pal = PALETTES[theme];
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  // ketajaman: maks 1,5x, dan dibatasi ±2,6 juta piksel per bingkai (layar penuh 2560×1600 skala 150% → ±1,2x)
  let dprMax = 1.5;
  const autoDpr = () => {
    const a = Math.max(1, container.clientWidth * container.clientHeight);
    return Math.max(1, Math.min(window.devicePixelRatio || 1, dprMax, Math.sqrt(2.6e6 / a)));
  };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = autoQuality ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; // PCF biasa: jauh lebih murah per piksel
  // Peta bayangan digambar sekali per frame. Tanpa ini setiap pass (render, AO) menggambarnya ulang: 3x per frame.
  renderer.shadowMap.autoUpdate = false;
  // Neutral menjaga putih maket tidak pecah di mode terang; di mode gelap kurvanya menekan warna gelap
  // menjadi hitam kebiruan, jadi mode gelap memakai tanpa tone mapping.
  renderer.toneMapping = pal.toneMapping === 'none' ? THREE.NoToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = pal.exposure;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pal.bg);

  const camera = new THREE.PerspectiveCamera(fov, 1, 10, 6000);

  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(pal.sun, pal.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -230; sc.right = 230; sc.top = 230; sc.bottom = -230; sc.near = 1; sc.far = 1200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const city = context ? buildCity(pal) : null;
  const tower = context ? buildTower(pal) : null;
  if (context) scene.add(city, tower);

  const composer = new EffectComposer(renderer);
  const ao = new N8AOPass(scene, camera, 1, 1);
  ao.configuration.aoRadius = 6;
  ao.configuration.distanceFalloff = 1.2;
  ao.configuration.intensity = pal.aoIntensity;
  ao.configuration.color = new THREE.Color(pal.ao);
  ao.configuration.gammaCorrection = false;
  ao.setQualityMode(autoQuality ? 'Medium' : 'High');
  if (autoQuality) ao.configuration.halfRes = true; // setengah resolusi, dihaluskan sadar-kedalaman: hampir tak terlihat bedanya
  // Model berat: AO dimatikan, gambar adegan diambil oleh RenderPass biasa (AO pass sekaligus pass gambar).
  const plainPass = new RenderPass(scene, camera);
  plainPass.enabled = false;
  composer.addPass(plainPass);
  composer.addPass(ao);
  function setAO(on) { ao.enabled = on; plainPass.enabled = !on; }
  const smaa = new SMAAPass(1, 1);
  composer.addPass(smaa);
  composer.addPass(new OutputPass());

  // Lapisan label HTML di atas kanvas.
  const labelLayer = document.createElement('div');
  labelLayer.className = 'l3d-labels';
  container.appendChild(labelLayer);
  const labels = [];

  // Bayangan disesuaikan dengan bingkai: kota lebar memakai area besar, close up memakai area kecil
  // supaya bayangan overhang di kaca tetap tajam.
  const sunState = { az: 250, el: 38, focus: new THREE.Vector3(), half: 230 };
  function applySun() {
    const { az, el, focus, half } = sunState;
    const d = dirFrom(az, el);
    const reach = Math.max(300, half * 3);
    sun.position.copy(focus).addScaledVector(d, reach);
    sun.target.position.copy(focus);
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = reach * 2;
    sc.updateProjectionMatrix();
    const texel = (2 * half) / shadowSize;
    sun.shadow.normalBias = Math.max(0.02, texel * 1.5);
    sun.shadow.bias = -0.0002;
  }
  function setSun(azDeg, elDeg) {
    sunState.az = azDeg; sunState.el = elDeg;
    applySun();
  }

  // Pose kamera sebuah sudut: posisi, titik tuju, dan area bayangan.
  function poseOf(name) {
    const s = SHOTS[name];
    const t = new THREE.Vector3(...s.target);
    return {
      target: t,
      pos: t.clone().addScaledVector(dirFrom(s.az, s.el), s.dist),
      shadowHalf: s.shadow || 460,
      shadowFocus: s.shadowFocus ? new THREE.Vector3(...s.shadowFocus) : new THREE.Vector3(0, 0, 0),
    };
  }

  // Atur kamera ke posisi + titik tuju; near/far mengikuti jarak supaya presisi kedalaman (AO) tetap baik.
  function applyCamera(pos, target) {
    camera.position.copy(pos);
    const dist = pos.distanceTo(target);
    camera.near = Math.max(1, dist * 0.3);
    camera.far = Math.max(dist * 3.5, dist + 1800);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }

  function applyShadowArea(half, focus) {
    sunState.half = half;
    sunState.focus.copy(focus);
    applySun();
  }

  function setShot(name) {
    const p = poseOf(name);
    const s = SHOTS[name];
    if (s.sun) [sunState.az, sunState.el] = s.sun;
    applyShadowArea(p.shadowHalf, p.shadowFocus);
    applyCamera(p.pos, p.target);
    return p;
  }

  function addLabel(pos, text, { tag = false, lift = 46, maxDist = Infinity } = {}) {
    const el = document.createElement('div');
    el.className = 'l3d-label' + (tag ? ' is-tag' : '');
    el.innerHTML = `<span class="l3d-text" style="bottom:${lift + 4}px"></span><i class="l3d-leader" style="height:${lift}px"></i><b class="l3d-dot"></b>`;
    el.querySelector('.l3d-text').textContent = text;
    labelLayer.appendChild(el);
    const l = { el, p: new THREE.Vector3(...pos), maxDist, on: true };
    labels.push(l);
    return {
      set on(b) { l.on = b; el.classList.toggle('is-off', !b); },
      setText(t) { el.querySelector('.l3d-text').textContent = t; },
      setPos(v) { l.p.copy(v); },
      el,
    };
  }

  const v = new THREE.Vector3();
  function placeLabels() {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (const l of labels) {
      v.copy(l.p).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && camera.position.distanceTo(l.p) < l.maxDist;
      l.el.style.display = visible ? '' : 'none';
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
  }

  // Geser pusat bingkai ke kanan sejauh separuh lebar panel teks, supaya objek tidak tertutup kartu.
  let frameInset = 0;
  function applyViewOffset() {
    const w = container.clientWidth, h = container.clientHeight;
    if (frameInset > 0) camera.setViewOffset(w + frameInset, h, 0, 0, w, h);
    else camera.clearViewOffset();
  }
  function setFrameInset(px) {
    frameInset = Math.max(0, px);
    camera.aspect = (container.clientWidth + frameInset) / Math.max(1, container.clientHeight);
    applyViewOffset();
    camera.updateProjectionMatrix();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (autoQuality) renderer.setPixelRatio(autoDpr());
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = (w + frameInset) / h;
    applyViewOffset();
    camera.updateProjectionMatrix();
  }

  // Peta bayangan hanya digambar ulang bila ada yang berubah: arah/area matahari, atau posisi, bentuk, dan
  // keterlihatan benda yang melempar bayangan. Kamera bergerak tidak mengubah bayangan.
  let shadowSig = null;
  function signature() {
    scene.updateMatrixWorld();
    let a = 0, n = 0;
    scene.traverseVisible((o) => {
      if (!o.castShadow) return;
      const e = o.matrixWorld.elements;
      a += e[0] + e[5] * 1.1 + e[10] * 1.3 + e[12] * 1.7 + e[13] * 1.9 + e[14] * 2.3 + n * 0.37;
      if (o.isInstancedMesh) a += o.instanceMatrix.version * 7 + o.count * 3;
      const g = o.geometry;
      if (g) a += g.id * 0.013 + (g.attributes.position?.version || 0) * 11 + (g.drawRange.count === Infinity ? 0 : g.drawRange.count);
      n += 1;
    });
    const L = sun.position, T = sun.target.position;
    return `${n}|${a.toFixed(4)}|${L.x.toFixed(3)},${L.y.toFixed(3)},${L.z.toFixed(3)}|${T.x.toFixed(3)},${T.z.toFixed(3)}|${sc.left}|${sun.shadow.mapSize.x}`;
  }

  // Penjaga kualitas berbasis waktu: setelah 1 dtk pemanasan, amati 1,5 dtk; bila >60% bingkai melewati anggaran
  // (budget ms, mis. 36 saat bergerak, 52 saat diam di ±30 fps) → turun satu tahap lalu amati lagi.
  // Tahap 1: tanpa AO, ketajaman ≤ 1,25x. Tahap 2: ketajaman 1x, peta bayangan 1024. Cukup cepat → berhenti.
  const gov = { t0: 0, last: 0, n: 0, slow: 0, level: 0, done: !autoQuality };
  function govern(t, onLevel, budget = 36) {
    if (gov.done) return;
    const dt = gov.last ? t - gov.last : 0;
    gov.last = t;
    if (!gov.t0) gov.t0 = t + 1000;
    if (!dt || dt > 1500 || t < gov.t0) return; // pemanasan, tab tersembunyi, atau jeda
    gov.n += 1;
    if (dt > budget) gov.slow += 1;
    if (t - gov.t0 < 1500 || gov.n < 6) return;
    const slow = gov.slow / gov.n > 0.6;
    gov.n = 0; gov.slow = 0; gov.t0 = t + 600;
    if (!slow) { gov.done = true; return; }
    gov.level += 1;
    if (gov.level === 1) { setAO(false); dprMax = 1.25; }
    else {
      dprMax = 1;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
      gov.done = true;
    }
    resize();
    onLevel?.(gov.level);
  }

  function render() {
    const sig = signature();
    if (sig !== shadowSig) { renderer.shadowMap.needsUpdate = true; shadowSig = sig; }
    if (api.raw) renderer.render(scene, camera);
    else composer.render();
    placeLabels();
  }

  resize();

  setSun(...DEFAULT_SUN);
  // Lepas semua sumber daya GPU (dipakai saat tema berganti: adegan dibangun ulang dengan palet lain).
  function dispose() {
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
        m.dispose();
      }
    });
    composer.dispose?.();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    labelLayer.remove();
  }

  const api = { renderer, scene, camera, sun, city, tower, ao, composer, palette: pal, raw: false, govern, get quality() { return gov.level; }, setAO, setShot, poseOf, applyCamera, applyShadowArea, setSun, addLabel, resize, render, setFrameInset, dispose };
  return api;
}
