// Sorotan per bab: lapisan warna SF di fasad tower, penanda matahari + lintasannya.
import * as THREE from 'three';
import { FACADES, PODIUM_H, TOWER } from './tower.js';
import { dirFrom } from './stage.js';
import { sunPosition } from './sun.js';

const BODY_H = (TOWER.tower.floors - TOWER.tower.crownFloors) * TOWER.tower.floorH;

// Kode fasad tower → kode arah di tabel SF (fasad dalam takik memakai arah yang sama).
export const FACADE_DIR = { U: 'U', T: 'T', S: 'S', B: 'B', Sd: 'S', Bd: 'B' };
export const DIR_NAME = { U: 'Utara', T: 'Timur', S: 'Selatan', B: 'Barat' };

// Lapisan oranye tipis di tiap fasad badan tower; pekatnya mengikuti nilai SF.
export function createSfOverlay(stage, sfByDir) {
  const group = new THREE.Group();
  const vals = Object.values(FACADE_DIR).map((d) => sfByDir[d]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const items = [];
  for (const f of FACADES) {
    const len = Math.abs(f.to - f.from);
    const g = new THREE.PlaneGeometry(len, BODY_H);
    const mat = new THREE.MeshBasicMaterial({ color: stage.palette.heat, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g, mat);
    const mid = (f.from + f.to) / 2, y = PODIUM_H + BODY_H / 2, off = 0.12;
    if (f.axis === 'z') { m.position.set(mid, y, f.at + f.n[1] * off); }
    else { m.position.set(f.at + f.n[0] * off, y, mid); m.rotation.y = Math.PI / 2; }
    m.renderOrder = 2;
    const sf = sfByDir[FACADE_DIR[f.id]];
    items.push({ m, weight: 0.12 + 0.5 * ((sf - lo) / Math.max(1, hi - lo)) });
    group.add(m);
  }
  group.visible = false;
  stage.scene.add(group);
  return {
    setAmount(a) {
      group.visible = a > 0.001;
      for (const it of items) it.m.material.opacity = a * it.weight;
    },
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
  const pathGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const path = new THREE.Line(pathGeo, new THREE.LineDashedMaterial({ color: stage.palette.heat, dashSize: 8, gapSize: 6, transparent: true, opacity: 0.85 }));
  path.computeLineDistances();
  group.add(path);
  group.visible = false;
  stage.scene.add(group);

  let hour = 15;
  function setHour(h) {
    hour = Math.min(18, Math.max(6, h));
    const s = at(hour);
    disc.position.copy(c).addScaledVector(dirFrom(s.az, Math.max(s.el, 0)), radius);
    stage.setSun(s.az, Math.max(s.el, 3));
    return { hour, ...s };
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
  return { group, setHour, hourAtScreen, discScreen, get hour() { return hour; }, setVisible(b) { group.visible = b; } };
}
