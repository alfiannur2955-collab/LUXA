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

// ---------- Bab 6: sampel dinding yang lapisannya dipisah ----------
// Lapisan dan tebalnya ilustratif; nilai U, α, dan berat diambil dari katalog material.
export const WALL_LAYERS = {
  wal_bata_merah_plester: [['Plester luar', 15, '#E9E3D8'], ['Bata merah', 110, '#B8613F'], ['Plester dalam', 15, '#EFEAE1']],
  wal_bata_ringan_aac_100: [['Plester luar', 10, '#E9E3D8'], ['Bata ringan (AAC)', 100, '#DAD5CA'], ['Plester dalam', 10, '#EFEAE1']],
  wal_bata_ringan_aac_cat_putih: [['Cat putih + plester', 12, '#F7F5F0'], ['Bata ringan (AAC)', 150, '#DAD5CA'], ['Plester dalam', 10, '#EFEAE1']],
  wal_spandrel_tanpa_insulasi: [['Kaca spandrel', 8, '#5E8F8A'], ['Rongga udara', 100, null], ['Panel belakang', 3, '#B9BDC2']],
  wal_spandrel_insulasi_50: [['Kaca spandrel', 8, '#5E8F8A'], ['Insulasi', 50, '#E6CF86'], ['Panel belakang', 3, '#B9BDC2']],
  wal_beton_pracetak_120: [['Beton pracetak', 120, '#B3AEA5']],
};
// Arsiran bidang potong per jenis material (tekstur kanvas).
function hatchTexture(kind, base) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(40,32,24,0.55)';
  x.fillStyle = 'rgba(40,32,24,0.45)';
  x.lineWidth = 2;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 'bata') {
    for (let i = -256; i < 512; i += 22) { x.beginPath(); x.moveTo(i, 256); x.lineTo(i + 256, 0); x.stroke(); }
  } else if (kind === 'aac') {
    x.lineWidth = 1.5;
    for (let i = 0; i < 70; i++) { x.beginPath(); x.arc(rnd() * 256, rnd() * 256, 3 + rnd() * 6, 0, Math.PI * 2); x.stroke(); }
  } else if (kind === 'plester') {
    for (let i = 0; i < 900; i++) x.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
  } else if (kind === 'beton') {
    for (let i = 0; i < 260; i++) x.fillRect(rnd() * 256, rnd() * 256, 2, 2);
    for (let i = 0; i < 40; i++) { const px = rnd() * 256, py = rnd() * 256, r = 4 + rnd() * 5; x.beginPath(); x.moveTo(px, py - r); x.lineTo(px + r, py + r); x.lineTo(px - r, py + r); x.closePath(); x.stroke(); }
  } else if (kind === 'insulasi') {
    for (let y = 10; y < 256; y += 26) { x.beginPath(); for (let i = 0; i <= 256; i += 4) x.lineTo(i, y + Math.sin(i / 14) * 8); x.stroke(); }
  } else if (kind === 'kaca') {
    x.strokeStyle = 'rgba(255,255,255,0.7)';
    for (let i = -256; i < 512; i += 60) { x.beginPath(); x.moveTo(i, 256); x.lineTo(i + 120, 0); x.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const LAYER_KIND = (name) => (/Bata merah/.test(name) ? 'bata' : /AAC|ringan/.test(name) ? 'aac' : /Plester|Cat/.test(name) ? 'plester' : /Beton/.test(name) ? 'beton' : /Insulasi/.test(name) ? 'insulasi' : /Kaca/.test(name) ? 'kaca' : 'polos');

// Potongan dinding (Bab 6): blok dinding di depan fasad Barat, bidang potongnya menghadap selatan.
// origin = pusat muka dalam dinding; lapisan tersusun ke arah luar (−x). Tebal dibesarkan supaya terbaca.
// Potongan dinding Bab 6: sepotong dinding asli fasad Barat dibuang (kotak potong pada material tower),
// lalu dua sisa dinding di kiri-kanan lubang memperlihatkan bidang potong berarsir per lapisan.
// Muka luar lapisan rata dengan bidang fasad, lapisan menerus ke dalam bangunan. Tower lain dibuat agak transparan.
export function createWallSection(stage, { facadeX = -14, zCut, gap = 1.1, stub = 1.3 }) {
  const group = new THREE.Group();
  group.visible = false;
  stage.scene.add(group);
  stage.renderer.localClippingEnabled = true;
  let y0 = 52.5, y1 = 54.5, H = 2, yc = 53.5; // pita dinding padat, disetel lewat update()
  const SCALE = 4;
  const edgeMat = new THREE.LineBasicMaterial({ color: '#2A2620', transparent: true, opacity: 0.85 });
  // Ruang di balik dinding yang terpotong: kotak gelap dilihat dari dalam (sisi belakang) sehingga terbaca sebagai ceruk.
  // Muka ujung ±z tidak digambar: ujung kiri berimpit dengan bidang potong berarsir.
  const nicheMat = new THREE.MeshStandardMaterial({ color: '#7A736A', roughness: 1, side: THREE.BackSide });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  let parts = [], amount = 0, depthT = 0.5;
  const niche = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [nicheMat, nicheMat, nicheMat, nicheMat, hidden, hidden]);
  niche.receiveShadow = true;
  group.add(niche);
  const labels = [0, 1, 2].map(() => stage.addLabel([0, 0, 0], '', { lift: 30, maxDist: 60 }));
  const sideOut = stage.addLabel([0, 0, 0], 'Luar', { tag: true, lift: 18, maxDist: 60 });
  const sideIn = stage.addLabel([0, 0, 0], 'Dalam', { lift: 18, maxDist: 60 });
  const all = [...labels, sideOut, sideIn];
  all.forEach((l) => { l.on = false; });

  // Kotak potong pada material tower: titik di dalam kotak (di sisi negatif keenam bidang) tidak digambar.
  const planes = [0, 1, 2, 3, 4, 5].map(() => new THREE.Plane());
  const mats = stage.tower.userData.mats;
  const towerMats = [mats.wall, mats.glass, mats.mull, mats.edge];
  for (const m of towerMats) { m.clippingPlanes = planes; m.clipIntersection = true; m.needsUpdate = true; }
  function setClip(on) {
    if (!on) { planes[0].set(new THREE.Vector3(1, 0, 0), 1e6); for (let i = 1; i < 6; i++) planes[i].set(new THREE.Vector3(-1, 0, 0), -1e6); return; }
    const x0 = facadeX - 1.2, x1 = facadeX + depthT; // dari luar fasad (termasuk kaca/overhang) sampai muka dalam dinding
    const z0 = zCut - stub, z1 = zCut + gap + stub;
    planes[0].set(new THREE.Vector3(1, 0, 0), -x1);
    planes[1].set(new THREE.Vector3(-1, 0, 0), x0);
    planes[2].set(new THREE.Vector3(0, 1, 0), -y1);
    planes[3].set(new THREE.Vector3(0, -1, 0), y0);
    planes[4].set(new THREE.Vector3(0, 0, 1), -z1);
    planes[5].set(new THREE.Vector3(0, 0, -1), z0);
  }
  setClip(false);

  const texCache = {};
  function cutTexture(kind, color, w, h) {
    texCache[kind + color] ||= hatchTexture(kind, color);
    const t = texCache[kind + color].clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(0.2, w / 0.6), h / 0.6); // satu ubin arsiran ≈ 0,6 m, supaya pola tidak gepeng
    t.needsUpdate = true;
    return t;
  }

  function build(wallId, outerColor, band) {
    if (band) { [y0, y1] = band; H = y1 - y0; yc = (y0 + y1) / 2; }
    for (const p of parts) { group.remove(p); p.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => { if (m !== edgeMat) { m.map?.dispose(); m.dispose(); } }); }); }
    parts = [];
    const layers = WALL_LAYERS[wallId] || WALL_LAYERS.wal_bata_ringan_aac_100;
    const info = [];
    let x = facadeX; // muka luar, lalu ke dalam (+x)
    layers.forEach(([name, mm, color], k) => {
      const t = Math.max(0.05, (mm / 1000) * SCALE);
      const cx = x + t / 2;
      x += t;
      info.push({ name, mm, cx });
      if (!color) return; // rongga udara: dibiarkan kosong
      const kind = LAYER_KIND(name);
      const side = new THREE.MeshStandardMaterial({ color: k === 0 && outerColor ? outerColor : color, roughness: 0.9 });
      // dua sisa dinding: kiri (bidang potong menghadap +z) dan kanan (bidang potong menghadap −z)
      for (const [za, zb, cutIdx] of [[zCut - stub, zCut, 4], [zCut + gap, zCut + gap + stub, 5]]) {
        const cut = new THREE.MeshBasicMaterial({ map: cutTexture(kind, color, t, H), toneMapped: false });
        const ms = [side, side, side, side, side, side];
        ms[cutIdx] = cut; // urutan muka BoxGeometry: +x, −x, +y, −y, +z, −z
        const geo = new THREE.BoxGeometry(t, H, zb - za);
        const mesh = new THREE.Mesh(geo, ms);
        mesh.position.set(cx, yc, (za + zb) / 2);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
        group.add(mesh);
        parts.push(mesh);
      }
    });
    depthT = x - facadeX;
    niche.scale.set(depthT, H, gap);
    niche.position.set(facadeX + depthT / 2, yc, zCut + gap / 2);
    // label di bidang potong kiri: angkat berselang supaya tidak bertumpuk
    const cutZ = zCut + 0.01;
    [...info].reverse().forEach((p, k) => {
      const l = labels[k];
      if (!l) return;
      l.setText(`${p.name} · ${p.mm} mm`);
      l.setPos(new THREE.Vector3(p.cx, y0 + H * 0.7, cutZ));
      l.el.querySelector('.l3d-leader').style.height = `${40 + k * 30}px`;
      l.el.querySelector('.l3d-text').style.bottom = `${44 + k * 30}px`;
      l.count = info.length;
    });
    labels.forEach((l, k) => { l.used = k < info.length; });
    sideOut.setPos(new THREE.Vector3(facadeX - 0.35, y0 + H * 0.12, cutZ));
    sideIn.setPos(new THREE.Vector3(facadeX + depthT + 0.3, y0 + H * 0.12, cutZ));
    paint();
  }
  function paint() {
    const on = amount > 0.01;
    group.visible = on;
    setClip(on);
    // Tower lain memudar supaya potongan menonjol; material dibuat transparan hanya selama dibutuhkan.
    const fade = 1 - 0.6 * amount;
    for (const m of [mats.wall, mats.glass, mats.mull]) {
      const tr = amount > 0.01;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = fade;
    }
    mats.edge.opacity = (mats.edge.userData.base ??= mats.edge.opacity) * fade;
    labels.forEach((l) => { l.on = amount > 0.6 && l.used; });
    sideOut.on = sideIn.on = amount > 0.6;
  }
  return {
    /** band = [y bawah, y atas] pita dinding padat antara overhang lantai bawah dan ambang kaca. */
    update(wallId, outerColor, band) { build(wallId, outerColor, band); },
    setAmount(a) { if (Math.abs(a - amount) > 0.002 || (a === 0 && amount !== 0)) { amount = a; paint(); } },
  };
}
