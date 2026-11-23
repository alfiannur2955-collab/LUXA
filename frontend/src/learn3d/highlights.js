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

// Panah pita meliuk (gaya ilustrasi datar): ekor memudar, kepala chevron runcing.
// Dibangun di bidang lokal 2D (x = arah alir, y = lebar), lalu bidangnya dihadapkan ke kamera.
function ribbonGeometry({ L, w0, amp, wave, phase, head, color0, color1 }) {
  const pos = [], col = [];
  const c0 = new THREE.Color(color0), c1 = new THREE.Color(color1);
  const bodyEnd = L - head * 0.15;
  const N = 48;
  const pt = (i) => {
    const t = i / N, x = t * bodyEnd;
    const env = Math.sin(Math.min(1, t / 0.85) * Math.PI) ** 1.2 * (1 - t) ** 0.3; // liukan hilang di dekat kepala
    const y = amp * env * Math.sin((x / wave) * Math.PI * 2 + phase);
    const w = w0 * (0.35 + 0.65 * Math.min(1, t * 1.6)); // ekor tipis, makin tebal ke kepala
    const a = Math.min(1, t / 0.55) ** 1.4; // ekor memudar
    const c = c0.clone().lerp(c1, Math.min(1, t * 1.2));
    return { x, y, w, a, c };
  };
  const push = (x, y, c, a) => { pos.push(x, y, 0); col.push(c.r, c.g, c.b, a); };
  for (let i = 0; i < N; i++) {
    const p = pt(i), q = pt(i + 1);
    push(p.x, p.y + p.w, p.c, p.a); push(p.x, p.y - p.w, p.c, p.a); push(q.x, q.y + q.w, q.c, q.a);
    push(q.x, q.y + q.w, q.c, q.a); push(p.x, p.y - p.w, p.c, p.a); push(q.x, q.y - q.w, q.c, q.a);
  }
  // Kepala: barb melengkung ke belakang dengan takik di tengah
  const e = pt(N), hw = w0;
  const A = [bodyEnd, e.y + hw], B = [L - head * 0.55, e.y + hw * 3.1], T = [L + head * 0.55, e.y], C = [L - head * 0.55, e.y - hw * 3.1], D = [bodyEnd, e.y - hw];
  for (const [p, q2, r] of [[A, B, T], [A, T, D], [D, T, C]]) for (const v of [p, q2, r]) push(v[0], v[1], c1, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return g;
}

// Tiga jalur panas di fasad Barat (Bab 2): tiap jalur beberapa helai pita, tebal mengikuti nilainya.
export const SOLAR_DIR = new THREE.Vector3(-0.35, 0.85, -0.4).normalize();
export const HEAT_COLORS = { wall: '#C27A3E', glass: '#E7B04B', solar: '#F49B1A' };
const TAIL_COLORS = { wall: '#E8B98C', glass: '#F6DCA0', solar: '#FAD199' };
export function createHeatArrows(stage) {
  const group = new THREE.Group();
  group.visible = false;
  stage.scene.add(group);
  const paths = {}; // k → { a, b, strands: [{ mesh, off, phase, len }] }
  let amount = 0, focus = null, w0 = { wall: 0.1, glass: 0.1, solar: 0.1 };
  const mat = () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false });
  const STRANDS = { wall: 2, glass: 2, solar: 3 };
  for (const k of ['wall', 'glass', 'solar']) {
    paths[k] = { a: new THREE.Vector3(), b: new THREE.Vector3(), strands: [] };
    for (let i = 0; i < STRANDS[k]; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat());
      mesh.renderOrder = 5;
      group.add(mesh);
      paths[k].strands.push({ mesh, off: (i - (STRANDS[k] - 1) / 2), phase: i * 1.9, len: 1 - 0.18 * Math.abs(i - (STRANDS[k] - 1) / 2) });
    }
  }
  const tmpX = new THREE.Vector3(), tmpY = new THREE.Vector3(), tmpZ = new THREE.Vector3(), m4 = new THREE.Matrix4();
  const paint = () => {
    group.visible = amount > 0.01;
    for (const [k, p] of Object.entries(paths)) for (const s of p.strands) s.mesh.material.opacity = amount * (focus && focus !== k ? 0.18 : 1);
  };
  return {
    // q: { qWall, qGlass, qSolar } (W/m²); anchors: titik tujuan di fasad.
    update({ q, anchors }) {
      const out = new THREE.Vector3(-1, 0, 0);
      const wOf = (x) => 0.07 + 0.036 * Math.sqrt(Math.max(0, x));
      w0 = { wall: wOf(q.qWall), glass: wOf(q.qGlass), solar: wOf(q.qSolar) };
      paths.wall.b.copy(anchors.wall).addScaledVector(out, 0.1); paths.wall.a.copy(paths.wall.b).addScaledVector(out, 5.2);
      paths.glass.b.copy(anchors.glass).addScaledVector(out, 0.1); paths.glass.a.copy(paths.glass.b).addScaledVector(out, 5.2);
      paths.solar.b.copy(anchors.solar).addScaledVector(out, 0.1); paths.solar.a.copy(paths.solar.b).addScaledVector(SOLAR_DIR, 5.4);
    },
    // Dipanggil tiap frame: hadapkan pita ke kamera dan gerakkan liukannya.
    tick(camera, timeSec, still) {
      if (!group.visible) return;
      for (const [k, p] of Object.entries(paths)) {
        const dir = tmpX.copy(p.b).sub(p.a);
        const L = dir.length();
        dir.normalize();
        const toCam = tmpZ.copy(camera.position).sub(p.a).normalize();
        const side = tmpY.crossVectors(toCam, dir).normalize(); // lebar pita tegak lurus arah alir dan arah pandang
        const normal = new THREE.Vector3().crossVectors(dir, side).normalize();
        m4.makeBasis(dir, side, normal);
        for (const s of p.strands) {
          const len = L * s.len;
          const ph = s.phase + (still ? 0 : timeSec * 1.6);
          s.mesh.geometry.dispose();
          s.mesh.geometry = ribbonGeometry({ L: len, w0: w0[k] * (s.off === 0 ? 1 : 0.7), amp: 0.18 + w0[k] * 0.9, wave: 3.2 + 0.5 * Math.abs(s.off), phase: ph, head: Math.min(0.9, 0.35 + w0[k] * 2.2), color0: TAIL_COLORS[k], color1: HEAT_COLORS[k] });
          s.mesh.quaternion.setFromRotationMatrix(m4);
          // geser helai sejajar lebar pita, ujung kepala tetap di dekat fasad
          s.mesh.position.copy(p.b).addScaledVector(dir, -len - Math.min(0.9, 0.35 + w0[k] * 2.2) * 0.55).addScaledVector(side, s.off * (w0[k] * 5 + 0.25));
        }
      }
    },
    setAmount(a) { amount = a; paint(); },
    setFocus(k) { focus = k; paint(); },
  };
}
