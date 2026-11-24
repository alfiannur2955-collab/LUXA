// Sorotan per bab: lapisan warna per fasad, penanda matahari + lintasannya, panah jalur panas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  const col = stage.palette.heat;
  const disc = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
  // cahaya lembut seperti kubah Simulasi dan Presentasi (ukuran bola tetap)
  for (const [k, op] of [[7, 0.85], [10, 0.14]]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: col, transparent: true, opacity: op, depthWrite: false, toneMapped: false }));
    sp.scale.setScalar(9 * k);
    disc.add(sp);
  }
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
  // lintasan tegas (tabung tipis; garis WebGL biasa selalu 1 piksel) + titik jam genap
  const path = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), Math.max(64, pts.length), radius * 0.0028, 6, false),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
  );
  group.add(path);
  for (let h = 6; h <= 18; h += 2) {
    const s = at(h);
    if (s.el <= 0) continue;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.0055, 12, 8), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    dot.position.copy(c).addScaledVector(dirFrom(s.az, s.el), radius);
    group.add(dot);
  }
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

// Tiga jalur panas di fasad Barat (Bab 2): satu panah per jalur, tampil bergantian.
// Tiap giliran: panah melaju dari arah datangnya, membentur bidang (kepala memipih, riak di bidang),
// lalu bidang yang dibentur (dinding atau kaca) menyala sebentar. Urutan: dinding → kaca → radiasi → ulang.
export const SOLAR_DIR = new THREE.Vector3(-0.35, 0.85, -0.4).normalize();
export const HEAT_COLORS = { wall: '#C27A3E', glass: '#E7B04B', solar: '#F49B1A' };
const TAIL_COLORS = { wall: '#E8B98C', glass: '#F6DCA0', solar: '#FAD199' };
const ORDER = ['wall', 'glass', 'solar'];
const SLOT = 2.9; // detik per giliran
const T_HIT = 1.25; // detik sampai kepala membentur bidang
const easeIn = (t) => t * t * t;
const bump = (t, d) => (t > 0 && t < d ? Math.sin((t / d) * Math.PI) : 0);
export function createHeatArrows(stage) {
  const group = new THREE.Group();
  group.visible = false;
  stage.scene.add(group);
  let amount = 0, focus = null, active = 'wall', w0 = { wall: 0.1, glass: 0.1, solar: 0.1 };
  const P = {};
  for (const k of ORDER) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.renderOrder = 6;
    group.add(mesh);
    // Bidang yang dibentur: lembar tipis di depan fasad + garis tepinya.
    const glowMat = new THREE.MeshBasicMaterial({ color: HEAT_COLORS[k], transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
    glow.rotation.y = Math.PI / 2; // bidang YZ, menghadap ±x
    glow.renderOrder = 4;
    const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: HEAT_COLORS[k], transparent: true, opacity: 0, toneMapped: false }));
    glow.add(rim);
    group.add(glow);
    // Riak di titik benturan.
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ color: HEAT_COLORS[k], transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    ripple.rotation.y = Math.PI / 2;
    ripple.renderOrder = 5;
    group.add(ripple);
    P[k] = { mesh, glow, rim, ripple, a: new THREE.Vector3(), b: new THREE.Vector3() };
  }
  const tmpX = new THREE.Vector3(), tmpY = new THREE.Vector3(), tmpZ = new THREE.Vector3(), nrm = new THREE.Vector3(), m4 = new THREE.Matrix4();
  const headOf = (k) => Math.min(0.9, 0.35 + w0[k] * 2.2);
  function drawArrow(k, camera, from, len, alpha, squash) {
    const p = P[k];
    const dir = tmpX.copy(p.b).sub(p.a).normalize();
    const toCam = tmpZ.copy(camera.position).sub(p.a).normalize();
    const side = tmpY.crossVectors(toCam, dir).normalize();
    nrm.crossVectors(dir, side).normalize();
    m4.makeBasis(dir, side, nrm);
    p.mesh.geometry.dispose();
    const head = headOf(k);
    p.mesh.geometry = ribbonGeometry({ L: Math.max(0.3, len), w0: w0[k] * (1 + 0.45 * squash), amp: 0.12 + w0[k] * 0.6, wave: 3.6, phase: 0.6, head: head * (1 - 0.35 * squash), color0: TAIL_COLORS[k], color1: HEAT_COLORS[k] });
    p.mesh.quaternion.setFromRotationMatrix(m4);
    p.mesh.position.copy(from);
    p.mesh.material.opacity = alpha;
  }
  function hitFx(k, t, base) {
    const p = P[k];
    const since = t - T_HIT;
    const flash = since >= 0 ? Math.exp(-since * 2.4) : 0;
    p.glow.material.opacity = (0.55 * flash + base) * amount;
    p.rim.material.opacity = Math.min(1, 0.9 * flash + base * 3) * amount;
    const r = since >= 0 && since < 0.95 ? since / 0.95 : -1;
    p.ripple.visible = r >= 0;
    if (r >= 0) {
      const sc = 0.2 + 0.85 * (1 - (1 - r) ** 2);
      p.ripple.scale.set(sc, sc, sc);
      p.ripple.material.opacity = (1 - r) * 0.85 * amount;
    }
  }
  const paint = () => { group.visible = amount > 0.01; };
  return {
    get active() { return active; },
    // q: { qWall, qGlass, qSolar } (W/m²); anchors: titik benturan + ukuran bidang (wallH, glassH) di fasad.
    update({ q, anchors }) {
      const out = new THREE.Vector3(-1, 0, 0);
      const wOf = (x) => 0.07 + 0.036 * Math.sqrt(Math.max(0, x));
      w0 = { wall: wOf(q.qWall), glass: wOf(q.qGlass), solar: wOf(q.qSolar) };
      const hit = { wall: anchors.wall, glass: anchors.glass, solar: anchors.solar };
      for (const k of ORDER) {
        const p = P[k];
        p.b.copy(hit[k]).addScaledVector(out, 0.12);
        p.a.copy(p.b).addScaledVector(k === 'solar' ? SOLAR_DIR : out, k === 'solar' ? 5.6 : 5.2);
        // bidang yang menyala: pita dinding padat (di bawah ambang) atau pita kaca lantai contoh
        const h = k === 'wall' ? anchors.wallH : anchors.glassH;
        p.glow.position.set(-14.14, hit[k].y, hit[k].z);
        p.glow.scale.set(3.4, h, 1);
        p.ripple.position.set(-14.16, hit[k].y, hit[k].z);
      }
    },
    // Dipanggil tiap frame.
    tick(camera, timeSec, still) {
      if (!group.visible) return;
      if (still) {
        // Gerak dikurangi: tiga panah diam di posisi benturan, bidang menyala tipis.
        for (const k of ORDER) {
          const p = P[k], L = p.a.distanceTo(p.b);
          drawArrow(k, camera, p.a, L - headOf(k) * 0.55, amount, 0);
          hitFx(k, -1, focus && focus !== k ? 0.04 : 0.16);
          p.ripple.visible = false;
        }
        return;
      }
      const slot = Math.floor(timeSec / SLOT);
      const t = timeSec - slot * SLOT;
      active = focus || ORDER[slot % 3];
      for (const k of ORDER) {
        const p = P[k];
        if (k !== active) { p.mesh.material.opacity = 0; p.glow.material.opacity = 0; p.rim.material.opacity = 0; p.ripple.visible = false; continue; }
        const L = p.a.distanceTo(p.b), head = headOf(k);
        const full = L - head * 0.55; // panjang badan sampai ujung kepala tepat di bidang
        // Kepala melaju (makin cepat) dari arah datang sampai membentur bidang, ekor menyusul.
        const prog = Math.min(1, t / T_HIT);
        const tipDist = 0.35 * full + 0.65 * full * easeIn(prog);
        const len = Math.min(full * 0.82, tipDist);
        const dir = tmpX.copy(p.b).sub(p.a).normalize();
        const from = new THREE.Vector3().copy(p.a).addScaledVector(dir, tipDist - len);
        const fadeIn = Math.min(1, t / 0.25);
        const fadeOut = 1 - Math.min(1, Math.max(0, (t - T_HIT - 0.35) / 0.5));
        const squash = bump(t - T_HIT, 0.32);
        drawArrow(k, camera, from, len, amount * fadeIn * fadeOut, squash);
        hitFx(k, t, t > T_HIT ? 0.1 : 0);
      }
    },
    setAmount(a) { amount = a; paint(); },
    setFocus(k) { focus = k; },
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

// ---------- Bedah rumus: pita dinding atau pita kaca di seluruh fasad Barat menyala ----------
export function createFacadeBands(stage, { facadeX = -14, z0 = -13.6, z1 = 1.6, podiumH = 13.5, floors = 18, floorH = 4 } = {}) {
  const group = new THREE.Group();
  group.visible = false;
  stage.scene.add(group);
  const make = (color) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.renderOrder = 4;
    group.add(m);
    return m;
  };
  const meshes = { wall: make(HEAT_COLORS.wall), glass: make(HEAT_COLORS.glass) };
  let amount = 0, kind = null, since = 0;
  function rebuild(gh, sill) {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const strips = { wall: [], glass: [] };
    const add = (k, y0, y1) => {
      if (y1 - y0 < 0.05) return;
      const g = new THREE.PlaneGeometry(len, y1 - y0);
      g.rotateY(Math.PI / 2);
      g.translate(facadeX - 0.16, (y0 + y1) / 2, zc);
      strips[k].push(g);
    };
    for (let k = 0; k < floors; k++) {
      const base = podiumH + k * floorH;
      add('wall', base + 0.05, base + sill);
      add('glass', base + sill, base + sill + gh);
      add('wall', base + sill + gh + 0.3, base + floorH - 0.05);
    }
    for (const k of ['wall', 'glass']) {
      meshes[k].geometry.dispose();
      meshes[k].geometry = strips[k].length ? mergeGeometries(strips[k]) : new THREE.BufferGeometry();
    }
  }
  return {
    rebuild,
    /** kind: 'wall' | 'glass' | null */
    setKind(k) { if (k !== kind) { kind = k; since = performance.now(); } },
    setAmount(a) { amount = a; group.visible = a > 0.01; },
    tick(now) {
      if (!group.visible) return;
      const t = (now - since) / 1000;
      const pulse = 0.28 + 0.12 * Math.sin(t * 3.2) + 0.25 * Math.exp(-t * 3); // nyala saat dipilih, lalu berdenyut pelan
      for (const k of ['wall', 'glass']) meshes[k].material.opacity = k === kind ? pulse * amount : 0;
    },
  };
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(cv);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
