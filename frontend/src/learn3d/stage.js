// Panggung Belajar 3D: renderer, kamera telefoto, matahari, AO, label HTML.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';
import { PALETTES } from './palette.js';
import { buildCity } from './city.js';
import { buildTower } from './tower.js';
import { SHOTS } from './shots.js';

const DEG = Math.PI / 180;
// Matahari bawaan dari barat-barat daya, sama di semua sudut supaya konsisten.
const DEFAULT_SUN = [250, 38];

// Arah dari target ke kamera; azimut dari utara searah jarum jam (utara = -z).
export function dirFrom(azDeg, elDeg) {
  const az = azDeg * DEG, el = elDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export function createStage(container, { theme = 'light', fov = 14, shadowSize = 4096 } = {}) {
  const pal = PALETTES[theme];
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

  const city = buildCity(pal);
  const tower = buildTower(pal);
  scene.add(city, tower);

  const composer = new EffectComposer(renderer);
  const ao = new N8AOPass(scene, camera, 1, 1);
  ao.configuration.aoRadius = 6;
  ao.configuration.distanceFalloff = 1.2;
  ao.configuration.intensity = pal.aoIntensity;
  ao.configuration.color = new THREE.Color(pal.ao);
  ao.configuration.gammaCorrection = false;
  ao.setQualityMode('High');
  composer.addPass(ao);
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

  function setShot(name) {
    const s = SHOTS[name];
    const d = dirFrom(s.az, s.el);
    const t = new THREE.Vector3(...s.target);
    sunState.focus.copy(s.shadowFocus ? new THREE.Vector3(...s.shadowFocus) : new THREE.Vector3(0, 0, 0));
    sunState.half = s.shadow || 460;
    [sunState.az, sunState.el] = s.sun || DEFAULT_SUN;
    applySun();
    camera.position.copy(t).addScaledVector(d, s.dist);
    camera.near = Math.max(2, s.dist * 0.3);
    camera.far = s.dist * 3.5;
    camera.lookAt(t);
    camera.updateProjectionMatrix();
  }

  function addLabel(pos, text, { tag = false, lift = 46 } = {}) {
    const el = document.createElement('div');
    el.className = 'l3d-label' + (tag ? ' is-tag' : '');
    el.innerHTML = `<span class="l3d-text" style="bottom:${lift + 4}px"></span><i class="l3d-leader" style="height:${lift}px"></i><b class="l3d-dot"></b>`;
    el.querySelector('.l3d-text').textContent = text;
    labelLayer.appendChild(el);
    labels.push({ el, p: new THREE.Vector3(...pos) });
  }

  const v = new THREE.Vector3();
  function placeLabels() {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (const l of labels) {
      v.copy(l.p).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = visible ? '' : 'none';
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render() {
    if (api.raw) renderer.render(scene, camera);
    else composer.render();
    placeLabels();
  }

  resize();
  setSun(250, 38);
  const api = { renderer, scene, camera, sun, city, tower, ao, composer, palette: pal, raw: false, setShot, setSun, addLabel, resize, render };
  return api;
}
