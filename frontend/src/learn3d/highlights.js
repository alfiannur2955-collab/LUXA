// Sorotan per bab: lapisan warna per fasad, penanda matahari + lintasannya, panah jalur panas.
import * as THREE from 'three';
import { FACADES, FACADE_DIR, BODY_TOP, PODIUM_H } from './tower.js';
import { dirFrom } from './stage.js';
import { sunPosition } from './sun.js';

export { FACADE_DIR };
export const DIR_NAME = { U: 'Utara', T: 'Timur', S: 'Selatan', B: 'Barat' };

// Lapisan oranye tipis di tiap fasad badan tower. Bobot 0–1 per fasad diatur oleh bab yang aktif.
export function createFacadeOverlay(stage) {
  const group = new THREE.Group();
  const items = {};
  const H = BODY_TOP - PODIUM_H;
  for (const f of FACADES) {
    const len = Math.abs(f.to - f.from);
    const mat = new THREE.MeshBasicMaterial({ color: stage.palette.heat, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), mat);
    const mid = (f.from + f.to) / 2, y = PODIUM_H + H / 2, off = 0.12;
    if (f.axis === 'z') m.position.set(mid, y, f.at + f.n[1] * off);
    else { m.position.set(f.at + f.n[0] * off, y, mid); m.rotation.y = Math.PI / 2; }
    m.renderOrder = 2;
    items[f.id] = { m, w: 0 };
    group.add(m);
  }
  group.visible = false;
  stage.scene.add(group);
  let amount = 0;
  const paint = () => {
    group.visible = amount > 0.001;
    for (const it of Object.values(items)) it.m.material.opacity = amount * (0.06 + 0.55 * it.w);
  };
  return {
    // w: { U, T, S, B } bobot per arah (0–1); fasad takik mengikuti arahnya.
    setWeights(w) { for (const [id, it] of Object.entries(items)) it.w = w[FACADE_DIR[id]] ?? 0; paint(); },
    setAmount(a) { amount = a; paint(); },
  };
}

// Penanda matahari di kubah + lintasan hari ini (timur ke barat).
export function createSunMarker(stage, { radius = 330, center = [0, 0, 0] } = {}) {
  const c = new THREE.Vector3(...center);
  const group = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: stage.palette.heat }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 16), new THREE.MeshBasicMaterial({ color: stage.palette.heat, transparent: true, opacity: 0.22, depthWrite: false }));
  disc.add(halo);
  group.add(disc);

  const today = new Date();
  const at = (h) => sunPosition({ month: today.getMonth() + 1, day: today.getDate(), hour: h });
  const pts = [];
  const samples = [];
  for (let h = 5.5; h <= 18.5; h += 0.05) {
    const s = at(h);
    if (s.el < -2) continue;
    const p = c.clone().addScaledVector(dirFrom(s.az, Math.max(s.el, 0)), radius);
    pts.push(p);
    samples.push({ h, p, s });
  }
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: stage.palette.heat, dashSize: 8, gapSize: 6, transparent: true, opacity: 0.85 }));
  path.computeLineDistances();
  group.add(path);
  group.visible = false;
  stage.scene.add(group);

  let hour = 15, cur = at(15);
  function setHour(h) {
    hour = Math.min(18, Math.max(6, h));
    cur = at(hour);
    disc.position.copy(c).addScaledVector(dirFrom(cur.az, Math.max(cur.el, 0)), radius);
    stage.setSun(cur.az, Math.max(cur.el, 3));
    return { hour, ...cur };
  }

  // Jam terdekat dengan posisi pointer di layar (untuk menyeret matahari di lintasannya).
  const v = new THREE.Vector3();
  function hourAtScreen(px, py) {
    const el = stage.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    let best = null, bestD = Infinity;
    for (const smp of samples) {
      if (smp.h < 6 || smp.h > 18) continue;
      v.copy(smp.p).project(stage.camera);
      const dx = ((v.x + 1) / 2) * w - px, dy = ((1 - v.y) / 2) * h - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = smp.h; }
    }
    return best;
  }
  function discScreen() {
    const el = stage.renderer.domElement;
    v.copy(disc.position).project(stage.camera);
    return [((v.x + 1) / 2) * el.clientWidth, ((1 - v.y) / 2) * el.clientHeight];
  }

  setHour(hour);
  return {
    group, setHour, hourAtScreen, discScreen,
    get hour() { return hour; },
    get sun() { return cur; },
    setVisible(b) { group.visible = b; },
  };
}

// Panah 3D: batang + kepala, dari titik a ke titik b, tebal r.
function arrowGeometry(a, b, r) {
  const dir = b.clone().sub(a);
  const L = dir.length();
  const head = Math.min(L * 0.35, r * 4.5);
  const shaft = new THREE.CylinderGeometry(r, r, Math.max(0.01, L - head), 18);
  shaft.translate(0, (L - head) / 2, 0);
  const cone = new THREE.ConeGeometry(r * 2.4, head, 18);
  cone.translate(0, L - head / 2, 0);
  const g = new THREE.BufferGeometry();
  const merged = [shaft.toNonIndexed(), cone.toNonIndexed()];
  const pos = [], nor = [];
  for (const m of merged) { pos.push(...m.attributes.position.array); nor.push(...m.attributes.normal.array); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

// Tiga panah jalur panas di fasad Barat (Bab 2).
export const SOLAR_DIR = new THREE.Vector3(-0.35, 0.85, -0.4).normalize();
export const HEAT_COLORS = { wall: '#C27A3E', glass: '#E7B04B', solar: '#F49B1A' };
export function createHeatArrows(stage) {
  const group = new THREE.Group();
  const meshes = {};
  for (const k of ['wall', 'glass', 'solar']) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: HEAT_COLORS[k], roughness: 0.6, emissive: HEAT_COLORS[k], emissiveIntensity: 0.25, transparent: true, opacity: 1 }));
    m.castShadow = false;
    meshes[k] = m;
    group.add(m);
  }
  group.visible = false;
  stage.scene.add(group);
  let amount = 0, focus = null;
  const paint = () => {
    group.visible = amount > 0.01;
    for (const [k, m] of Object.entries(meshes)) m.material.opacity = amount * (focus && focus !== k ? 0.22 : 1);
  };
  return {
    // q: { qWall, qGlass, qSolar } (W/m²); anchors: titik tujuan di fasad; sunDir: arah ke matahari.
    update({ q, anchors, sunDir }) {
      const rad = (x) => 0.06 + 0.06 * Math.sqrt(Math.max(0, x));
      const out = new THREE.Vector3(-1, 0, 0);
      const set = (k, a, b, r) => { meshes[k].geometry.dispose(); meshes[k].geometry = arrowGeometry(a, b, r); };
      set('wall', anchors.wall.clone().addScaledVector(out, 5.5), anchors.wall.clone().addScaledVector(out, 0.15), rad(q.qWall));
      set('glass', anchors.glass.clone().addScaledVector(out, 5.5), anchors.glass.clone().addScaledVector(out, 0.15), rad(q.qGlass));
      // Arah sinar ilustratif (tinggi dari barat), supaya panah tidak mengarah ke kamera.
      const sd = SOLAR_DIR.clone();
      set('solar', anchors.solar.clone().addScaledVector(sd, 6), anchors.solar.clone().addScaledVector(out, 0.15), rad(q.qSolar));
    },
    setAmount(a) { amount = a; paint(); },
    setFocus(k) { focus = k; paint(); },
  };
}
