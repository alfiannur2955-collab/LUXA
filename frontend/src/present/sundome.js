// Kubah matahari Mode Presentasi: lingkar tanah dengan arah mata angin, lintasan matahari, bola matahari,
// dan garis sinar ke model. Arah cahaya panggung memakai arah matahari yang sama, jadi bayangan selalu
// punya sumber yang terlihat.
import * as THREE from 'three';
import { computeSolarPosition } from '../viewer/sundome.js';
import { computeInitialSunDomeRadiusM } from '../state.js';

const DIRS = [['U', 0], ['T', 90], ['S', 180], ['B', 270]];

/**
 * Jari-jari kubah: ukuran yang dipakai viewer (atau yang diatur pengguna), tetapi tidak lebih rendah dari
 * gedung, supaya matahari tidak pernah tampak "di dalam" tinggi gedung.
 */
export function domeRadius(state, bounds) {
  const bb = state.analysisData?.summary?.bounding_box;
  const app = Number(state.sunDomeRadiusM ?? state.config?.settings?.sun_dome_radius_m) || computeInitialSunDomeRadiusM(bb);
  return Math.max(app, bounds.size.y * 1.1, bounds.footprint * 1.6, 8);
}

export function createDome(stage, { radius, lat = -6.2088, date = '2026-09-23', hour = 15, north = 0, center = new THREE.Vector3(), dark = false }) {
  const R = radius;
  const group = new THREE.Group();
  group.name = 'kubah-matahari';
  const sunCol = new THREE.Color(dark ? '#F6B24A' : '#E8890C');
  const lineCol = new THREE.Color(dark ? '#9A9BA2' : '#8C8273');
  const y0 = 0.05;
  const line = (pts, { color = lineCol, opacity = 0.5, dashed = false } = {}) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: R * 0.03, gapSize: R * 0.025, depthWrite: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const l = new THREE.Line(g, m);
    if (dashed) l.computeLineDistances();
    group.add(l);
    return l;
  };
  const at = (azModel, r = R, y = y0) => {
    const a = azModel * Math.PI / 180;
    return new THREE.Vector3(center.x + Math.sin(a) * r, y, center.z - Math.cos(a) * r);
  };

  // Lingkar tanah + garis penanda tiap 45° (arah utama lebih panjang).
  const ring = [];
  for (let i = 0; i <= 128; i++) ring.push(at((i / 128) * 360));
  line(ring, { opacity: 0.55 });
  for (let d = 0; d < 360; d += 45) {
    const major = d % 90 === 0;
    line([at(d + north, R * (major ? 0.93 : 0.96)), at(d + north, R * (major ? 1.06 : 1.03))], { opacity: major ? 0.7 : 0.45 });
  }
  // Dua busur meridian tipis supaya bentuk kubah terbaca.
  for (const base of [0, 90]) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI;
      const a = (base + north) * Math.PI / 180;
      pts.push(new THREE.Vector3(center.x + Math.sin(a) * Math.cos(t) * R, Math.sin(t) * R, center.z - Math.cos(a) * Math.cos(t) * R));
    }
    line(pts, { opacity: 0.18, dashed: true });
  }

  // Lintasan matahari: tanggal aktif tegas, 21 Juni dan 21 Desember putus-putus tipis.
  const year = String(date).slice(0, 4) || '2026';
  const arcs = [[date, true], [`${year}-06-21`, false], [`${year}-12-21`, false]];
  for (const [d, active] of arcs) {
    if (!active && d === date) continue;
    const pts = [];
    for (let h = 5; h <= 19.001; h += 0.2) {
      const sp = computeSolarPosition(lat, d, h, north);
      if (sp.altitudeDeg >= 0) pts.push(center.clone().setY(0).addScaledVector(sp.threeDir, R));
    }
    if (pts.length > 1) line(pts, { color: sunCol, opacity: active ? 0.85 : 0.35, dashed: !active });
  }

  // Bola matahari + lingkar cahaya lembut + sinar putus-putus ke model.
  const sp = computeSolarPosition(lat, date, hour, north);
  const dir = sp.threeDir.clone();
  if (dir.y < 0.05) { dir.y = 0.05; dir.normalize(); }
  const sunPos = center.clone().setY(0).addScaledVector(dir, R);
  const orbR = R * 0.035;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(orbR, 24, 16), new THREE.MeshBasicMaterial({ color: sunCol, toneMapped: false }));
  orb.position.copy(sunPos);
  group.add(orb);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: sunCol, transparent: true, opacity: dark ? 0.55 : 0.45, depthWrite: false, toneMapped: false }));
  halo.scale.setScalar(orbR * 7);
  halo.position.copy(sunPos);
  group.add(halo);
  line([sunPos, new THREE.Vector3(center.x, center.y, center.z)], { color: sunCol, opacity: 0.55, dashed: true });
  group.traverse((o) => {
    o.raycast = () => {};
    o.renderOrder = 5;
    if (o.material) { o.material.transparent = true; o.material.userData.base = o.material.opacity ?? 1; }
  });
  stage.scene.add(group);

  // Arah cahaya panggung = arah matahari (azimut model dari -z searah jarum jam).
  const azModel = (Math.atan2(dir.x, -dir.z) * 180 / Math.PI + 360) % 360;
  const elDeg = Math.asin(dir.y) * 180 / Math.PI;
  stage.setSun(azModel, Math.max(elDeg, 3));

  // Label arah mata angin (HTML) di luar lingkar.
  const labels = DIRS.map(([t, d]) => ({ p: at(d + north, R * 1.16), el: Object.assign(document.createElement('span'), { className: 'lxp-compass', textContent: t }) }));
  return {
    group, radius: R, sun: { az: sp.azimuthDeg, alt: sp.altitudeDeg, azModel, el: elDeg, pos: sunPos, above: sp.aboveHorizon },
    labels,
    dir,
    /** 0 = tersembunyi (slide close up), 1 = penuh. */
    setOpacity(k) {
      group.visible = k > 0.01;
      group.traverse((o) => { if (o.material) o.material.opacity = o.material.userData.base * k; });
      labels.forEach((l) => { l.el.style.opacity = k; });
    },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
      stage.scene.remove(group);
      labels.forEach((l) => l.el.remove());
    },
  };
}

function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
