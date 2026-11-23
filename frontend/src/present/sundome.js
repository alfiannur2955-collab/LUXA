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
  // garis tebal (tabung tipis) untuk lingkar tanah dan lintasan aktif: garis WebGL biasa selalu 1 piksel
  const tube = (pts, { color = lineCol, opacity = 0.9, w = 0.0045 } = {}) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const g = new THREE.TubeGeometry(curve, Math.max(32, pts.length * 2), R * w, 6, false);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(g, m);
    group.add(mesh);
    return mesh;
  };
  const at = (azModel, r = R, y = y0) => {
    const a = azModel * Math.PI / 180;
    return new THREE.Vector3(center.x + Math.sin(a) * r, y, center.z - Math.cos(a) * r);
  };

  // Lingkar tanah + garis penanda tiap 45° (arah utama lebih panjang).
  const ring = [];
  for (let i = 0; i <= 128; i++) ring.push(at((i / 128) * 360));
  tube(ring, { opacity: 0.75, w: 0.0028 });
  for (let d = 0; d < 360; d += 45) {
    const major = d % 90 === 0;
    const tick = [at(d + north, R * (major ? 0.92 : 0.96)), at(d + north, R * (major ? 1.07 : 1.03))];
    if (major) tube(tick, { opacity: 0.85, w: 0.003 }); else line(tick, { opacity: 0.6 });
  }
  // Dua busur meridian tipis supaya bentuk kubah terbaca.
  for (const base of [0, 90]) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI;
      const a = (base + north) * Math.PI / 180;
      pts.push(new THREE.Vector3(center.x + Math.sin(a) * Math.cos(t) * R, Math.sin(t) * R, center.z - Math.cos(a) * Math.cos(t) * R));
    }
    line(pts, { opacity: 0.3, dashed: true });
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
    if (pts.length < 2) continue;
    if (active) tube(pts, { color: sunCol, opacity: 1, w: 0.005 });
    else line(pts, { color: sunCol, opacity: 0.55, dashed: true });
  }
  // titik jam di lintasan aktif (6..18) untuk menggeser matahari, plus penanda jam genap
  const samples = [];
  for (let h = 5; h <= 19.001; h += 0.1) {
    const p = computeSolarPosition(lat, date, h, north);
    if (p.altitudeDeg > 0) samples.push({ h: Math.round(h * 10) / 10, p: center.clone().setY(0).addScaledVector(p.threeDir, R) });
  }
  for (let h = 6; h <= 18; h += 2) {
    const p = computeSolarPosition(lat, date, h, north);
    if (p.altitudeDeg <= 0) continue;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.009, 12, 8), new THREE.MeshBasicMaterial({ color: sunCol, toneMapped: false }));
    dot.position.copy(center.clone().setY(0).addScaledVector(p.threeDir, R));
    group.add(dot);
  }

  // Bola matahari + lingkar cahaya lembut + sinar putus-putus ke model.
  let sp = computeSolarPosition(lat, date, hour, north);
  const dir = sp.threeDir.clone();
  if (dir.y < 0.05) { dir.y = 0.05; dir.normalize(); }
  const sunPos = center.clone().setY(0).addScaledVector(dir, R);
  const orbR = R * 0.045;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(orbR, 24, 16), new THREE.MeshBasicMaterial({ color: sunCol, toneMapped: false }));
  orb.position.copy(sunPos);
  group.add(orb);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: sunCol, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
  halo.scale.setScalar(orbR * 8);
  halo.position.copy(sunPos);
  group.add(halo);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: sunCol, transparent: true, opacity: dark ? 0.22 : 0.2, depthWrite: false, toneMapped: false }));
  glow.scale.setScalar(orbR * 13);
  glow.position.copy(sunPos);
  group.add(glow);
  const ray = line([sunPos.clone(), new THREE.Vector3(center.x, center.y, center.z)], { color: sunCol, opacity: 0.75, dashed: true });
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
  const sun = { az: sp.azimuthDeg, alt: sp.altitudeDeg, azModel, el: elDeg, pos: sunPos, above: sp.aboveHorizon, hour };
  const v = new THREE.Vector3();
  return {
    group, radius: R, sun,
    labels,
    dir,
    /** Geser matahari ke jam lain di lintasan aktif (bayangan ikut; hitungan OTTV tidak berubah). */
    setHour(h) {
      sp = computeSolarPosition(lat, date, h, north);
      dir.copy(sp.threeDir);
      if (dir.y < 0.05) { dir.y = 0.05; dir.normalize(); }
      sunPos.copy(center).setY(0).addScaledVector(dir, R);
      orb.position.copy(sunPos); halo.position.copy(sunPos); glow.position.copy(sunPos);
      const arr = ray.geometry.attributes.position.array;
      arr[0] = sunPos.x; arr[1] = sunPos.y; arr[2] = sunPos.z;
      ray.geometry.attributes.position.needsUpdate = true;
      ray.computeLineDistances();
      const az = (Math.atan2(dir.x, -dir.z) * 180 / Math.PI + 360) % 360;
      const el = Math.asin(dir.y) * 180 / Math.PI;
      stage.setSun(az, Math.max(el, 3));
      Object.assign(sun, { az: sp.azimuthDeg, alt: sp.altitudeDeg, azModel: az, el, above: sp.aboveHorizon, hour: h });
    },
    /** Jam terdekat dengan titik layar (px, py), untuk menyeret matahari di sepanjang lintasan. */
    hourAtScreen(px, py, w, h) {
      let best = null, bestD = Infinity;
      for (const smp of samples) {
        v.copy(smp.p).project(stage.camera);
        const d = (((v.x + 1) / 2) * w - px) ** 2 + (((1 - v.y) / 2) * h - py) ** 2;
        if (d < bestD) { bestD = d; best = smp.h; }
      }
      return best;
    },
    /** Posisi bola matahari di layar. */
    sunScreen(w, h) {
      v.copy(sunPos).project(stage.camera);
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h, v.z];
    },
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
