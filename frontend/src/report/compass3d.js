// "Kompas panas 3D": tiap sisi gedung jadi prisma juring di arahnya, tinggi = OTTV sisi itu, warna skala panas;
// cincin tembus pandang = batas SNI. Gaya isometrik seperti grafik kontribusi 3D. Hasil: gambar + posisi label.
import * as THREE from 'three';
import { createStage, dirFrom } from '../learn3d/stage.js';
import { heatColor } from '../present/heat.js';

const CODE_AZ = { U: 0, TL: 45, T: 90, TGR: 135, TG: 135, S: 180, BD: 225, B: 270, BL: 315 };

export function renderCompass3d(sides, limit, { theme = 'light', width = 1400, height = 1100, pixelRatio = 1 } = {}) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${width + 200}px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(host);
  const stage = createStage(host, { theme, context: false, shadowSize: 2048, fov: 14 });
  stage.renderer.setPixelRatio(pixelRatio);
  stage.resize();
  const dark = theme === 'dark';
  stage.scene.background = null;
  stage.renderer.setClearColor(0x000000, 0);
  const g = new THREE.Group();
  stage.scene.add(g);
  const S = 10, hLimit = 5.5, rIn = 0.34 * S, rOut = 1.0 * S;
  const max = Math.max(limit * 1.35, ...sides.map((r) => r.ottv_orientation_wm2));
  const hOf = (v) => (v / limit) * hLimit;

  // alas bundar + garis mata angin
  const base = new THREE.Mesh(new THREE.CylinderGeometry(rOut * 1.18, rOut * 1.18, 0.35, 96), new THREE.MeshStandardMaterial({ color: dark ? '#2C2D33' : '#F3F1EC', roughness: 0.95 }));
  base.position.y = -0.18; base.receiveShadow = true; g.add(base);
  const ringMat = new THREE.LineBasicMaterial({ color: dark ? '#6A6B72' : '#B9B1A4', transparent: true, opacity: 0.8 });
  for (const r of [rIn, rOut]) {
    const pts = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * r, 0.02, -Math.cos(a) * r)); }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
  }
  const tops = [];
  for (const r of sides) {
    const az = Number.isFinite(r.azimuth_center_deg) ? r.azimuth_center_deg : CODE_AZ[r.code] ?? 0;
    const a0 = (az - 19.5) * Math.PI / 180, a1 = (az + 19.5) * Math.PI / 180;
    const sh = new THREE.Shape();
    const seg = 16;
    for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * (i / seg); const p = [Math.sin(a) * rOut, Math.cos(a) * rOut]; i ? sh.lineTo(...p) : sh.moveTo(...p); }
    for (let i = seg; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / seg); sh.lineTo(Math.sin(a) * rIn, Math.cos(a) * rIn); }
    const h = Math.max(0.15, hOf(r.ottv_orientation_wm2));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 4 });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: heatColor(r.ottv_orientation_wm2), roughness: 0.7 }));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: dark ? '#000000' : '#5A4E42', transparent: true, opacity: 0.25 })));
    const am = az * Math.PI / 180, rm = (rIn + rOut) / 2;
    tops.push({ code: r.code, v: r.ottv_orientation_wm2, p: new THREE.Vector3(Math.sin(am) * rm, h, -Math.cos(am) * rm), base: new THREE.Vector3(Math.sin(am) * rOut * 1.3, 0, -Math.cos(am) * rOut * 1.3) });
  }
  // bidang batas SNI: cincin kaca tipis di ketinggian batas
  const lim = new THREE.Mesh(new THREE.RingGeometry(rIn * 0.6, rOut * 1.08, 96), new THREE.MeshBasicMaterial({ color: dark ? '#9FD3CE' : '#138E86', transparent: true, opacity: dark ? 0.16 : 0.12, side: THREE.DoubleSide, depthWrite: false }));
  lim.rotation.x = -Math.PI / 2; lim.position.y = hLimit; g.add(lim);
  const lp = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; lp.push(new THREE.Vector3(Math.sin(a) * rOut * 1.08, hLimit, -Math.cos(a) * rOut * 1.08)); }
  const limLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lp), new THREE.LineDashedMaterial({ color: dark ? '#CDEBE8' : '#0F6E66', dashSize: 0.5, gapSize: 0.35 }));
  limLine.computeLineDistances(); g.add(limLine);

  const target = new THREE.Vector3(0, hLimit * 0.32, 0);
  const dist = (rOut * 0.86) / Math.sin(7 * Math.PI / 180); // tinggi gambar pas dengan piringan + prisma
  stage.setSun(235, 48);
  stage.applyShadowArea(rOut * 2, new THREE.Vector3());
  stage.applyCamera(target.clone().addScaledVector(dirFrom(205, 34), dist), target);
  stage.render();
  const img = stage.renderer.domElement.toDataURL('image/png');
  const proj = (v) => { const q = v.clone().project(stage.camera); return { x: ((q.x + 1) / 2) * 100, y: ((1 - q.y) / 2) * 100 }; };
  const labels = tops.map((t) => ({ code: t.code, v: t.v, top: proj(t.p), base: proj(t.base) }));
  const limitAt = proj(new THREE.Vector3(rOut * 1.08 * Math.sin(-0.9), hLimit, -rOut * 1.08 * Math.cos(-0.9)));
  stage.dispose();
  host.remove();
  return { img, labels, limitAt, aspect: width / height };
}
