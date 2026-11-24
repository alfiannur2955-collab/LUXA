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

// Tiga jalur panas di fasad Barat (Bab 2), tampil bergantian (dinding → kaca → sinar), masing-masing dengan
// bahasa gambar yang sesuai fisikanya:
// - Merambat (konduksi, U·TDek dan U·ΔT): riak tipis yang bergerak pelan dari udara luar, tegak lurus bidang;
//   bidang yang dilalui menghangat bertahap. Lewat kaca riaknya lebih lemah (ΔT SNI 5 K vs TDek dinding).
// - Sinar langsung (SC·WWR·SF): berkas lurus searah sinar matahari sebenarnya, cepat; berkas yang mengenai
//   overhang berhenti di permukaannya (dihitung geometris, sama dengan porsi bayangan di Bab 5).
export const SOLAR_DIR = new THREE.Vector3(-0.35, 0.85, -0.4).normalize(); // cadangan arah sinar bila matahari di luar fasad Barat
export const HEAT_COLORS = { wall: '#C8553D', glass: '#E8906F', solar: '#F5B915' };
const ORDER = ['wall', 'glass', 'solar'];
const SLOT = 3.4; // detik per giliran
const FADE = 0.4;
const FACADE_X = -14;
const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

export function createHeatArrows(stage, { dark = false } = {}) {
  const group = new THREE.Group();
  group.visible = false;
  stage.scene.add(group);
  let amount = 0, focus = null, active = 'wall';
  let A = null; // titik jangkar dari story
  let rel = { wall: 1, glass: 0.5, solar: 1 }; // kekuatan relatif (akar q, dinormalkan ke yang terbesar)
  const mk = (order) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
    m.renderOrder = order;
    group.add(m);
    return m;
  };
  const lines = mk(6); // semua garis (berkas, riak) dalam satu geometri yang dibangun ulang tiap bingkai
  // bidang yang dilalui panas: lembar tipis di depan fasad + garis tepinya
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
  glow.rotation.y = Math.PI / 2;
  glow.renderOrder = 4;
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, toneMapped: false }));
  glow.add(rim);
  group.add(glow);

  const pos = [], col = [];
  const toCam = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3(), tmp = new THREE.Vector3();
  let cam = null;
  // pita menghadap kamera melalui titik-titik pts; w = setengah lebar (m), cAt(i) = [THREE.Color, alfa]
  function strip(pts, w, cAt) {
    const n = pts.length;
    if (n < 2) return;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      tan.copy(pts[Math.min(n - 1, i + 1)]).sub(pts[Math.max(0, i - 1)]).normalize();
      toCam.copy(cam.position).sub(pts[i]).normalize();
      side.crossVectors(tan, toCam).normalize().multiplyScalar(typeof w === 'function' ? w(i) : w);
      L.push(pts[i].clone().add(side)); R.push(pts[i].clone().sub(side));
    }
    const put = (v, i) => { const [c, a] = cAt(i); pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b, a); };
    for (let i = 0; i < n - 1; i++) {
      put(L[i], i); put(R[i], i); put(L[i + 1], i + 1);
      put(L[i + 1], i + 1); put(R[i], i); put(R[i + 1], i + 1);
    }
  }
  function flush() {
    lines.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    lines.geometry = g;
    pos.length = 0; col.length = 0;
  }

  // ---- Arah sinar: matahari panggung bila menghadap fasad Barat, selain itu sore hari baku (SF Barat = sinar sore).
  const sunU = new THREE.Vector3();
  function sunDir() {
    sunU.copy(stage.sun.position).sub(stage.sun.target.position).normalize();
    if (sunU.x > -0.15 || sunU.y < 0.12) sunU.set(Math.sin(262 * Math.PI / 180) * Math.cos(40 * Math.PI / 180), Math.sin(40 * Math.PI / 180), -Math.cos(262 * Math.PI / 180) * Math.cos(40 * Math.PI / 180));
    return sunU;
  }
  // Titik akhir berkas yang menuju titik kaca T: T sendiri, atau titik masuknya ke overhang di atas kaca.
  function rayEnd(T, u) {
    const d = A.overhangDepth || 0;
    if (d <= 0.02) return { E: T, blocked: false };
    const ob = A.overhangBottom, ot = ob + 0.16, xo = FACADE_X - d;
    const sB = (ob - T.y) / u.y, xB = T.x + u.x * sB;
    if (xB < xo) return { E: T, blocked: false }; // lewat di luar ujung overhang
    const sT = (ot - T.y) / u.y, xT = T.x + u.x * sT;
    const s = xT >= xo ? sT : (xo - T.x) / u.x; // kena permukaan atas, atau muka ujungnya
    return { E: T.clone().addScaledVector(u, s), blocked: true };
  }
  // Sasaran berkas di bidang kaca: tersebar merata pada tinggi dan lebar pita kaca contoh.
  const RAYS = [[-1.2, 0.86], [-0.6, 0.38], [0, 0.66], [0.6, 0.16], [1.2, 0.52]];
  // tema terang: kuning lebih pekat dan kepala jingga supaya terbaca di fasad krem; tema gelap: kuning terang berkepala putih
  const cSolar = new THREE.Color(dark ? HEAT_COLORS.solar : '#E89A00'), cWhite = new THREE.Color(dark ? '#FFF6D8' : '#D9730D');
  function drawSolar(t, k, still) {
    const u = sunDir();
    const dIn = tmp.copy(u).negate(); // arah rambat sinar (dari matahari ke fasad)
    const gb = A.glass.y - A.glassH / 2;
    const Lr = 6.5, speed = 7, streak = 0.9;
    const wBeam = 0.022, wStreak = 0.05 * (0.75 + 0.25 * rel.solar);
    for (const [dz, fy] of RAYS) {
      const T = new THREE.Vector3(FACADE_X - 0.06, gb + A.glassH * fy, A.solar.z + dz);
      const { E, blocked } = rayEnd(T, u);
      const S = T.clone().addScaledVector(u, Lr);
      const len = S.distanceTo(E);
      if (len < 0.05) continue;
      // garis bantu lintasan (redup), lurus
      strip([S, E], wBeam, (i) => [cSolar, (i ? (dark ? 0.55 : 0.75) : 0.0) * k]);
      if (!still) {
        // butir cahaya yang melaju cepat sepanjang berkas
        for (let j = 0; j < 3; j++) {
          const p = ((t * speed + j * (len / 3) + dz * 1.7) % (len + streak));
          const a0 = Math.max(0, p - streak), a1 = Math.min(len, p);
          if (a1 - a0 < 0.05) continue;
          const P0 = S.clone().addScaledVector(dIn, a0), P1 = S.clone().addScaledVector(dIn, a1);
          strip([P0, P0.clone().lerp(P1, 0.5), P1], (i) => wStreak * (0.4 + 0.3 * i), (i) => [i === 2 ? cWhite : cSolar, [0.0, 0.7, 1][i] * k]);
        }
      }
      if (!blocked) {
        // menembus kaca: lanjutan pendek ke dalam yang memudar
        const In = T.clone().addScaledVector(dIn, 1.1);
        strip([T, In], wBeam * 1.3, (i) => [cSolar, (i ? 0 : 0.8) * k]);
      }
    }
  }
  // Riak konduksi: tiga garis sinus tipis tegak lurus bidang, bergerak pelan dari udara luar ke bidang.
  function drawConduction(kind, t, k, still) {
    const anchor = A[kind], h = kind === 'wall' ? A.wallH : A.glassH;
    const c = new THREE.Color(HEAT_COLORS[kind]);
    const strength = kind === 'wall' ? 1 : 0.62;
    const amp = (0.05 + 0.05 * rel[kind]) * strength, lam = 0.85, v = 0.55;
    const w = (0.016 + 0.012 * rel[kind]) * (kind === 'wall' ? 1 : 0.8);
    const x0 = FACADE_X - 4.6, x1 = FACADE_X - 0.08, N = 46;
    const rows = [-0.32, 0, 0.32];
    rows.forEach((fy, r) => {
      const y = anchor.y + fy * Math.min(1.2, h), z = anchor.z + (r - 1) * 0.55;
      const pts = [], al = [];
      for (let i = 0; i <= N; i++) {
        const x = x0 + (x1 - x0) * (i / N);
        const ph = (2 * Math.PI * (x - x0)) / lam - (still ? 0 : (2 * Math.PI * v * t) / lam) + r * 1.9;
        pts.push(new THREE.Vector3(x, y + amp * Math.sin(ph), z));
        al.push(smooth(i / N / 0.55) * (0.55 + 0.4 * strength));
      }
      strip(pts, w, (i) => [c, al[i] * k]);
      // kepala kecil penunjuk arah di ujung baris tengah
      if (r === 1) {
        const tip = pts[N], hs = 0.13;
        const a1 = tip.clone().add(new THREE.Vector3(-hs, hs * 0.7, 0)), a2 = tip.clone().add(new THREE.Vector3(-hs, -hs * 0.7, 0));
        strip([a1, tip], w * 1.1, () => [c, 0.95 * k]);
        strip([a2, tip], w * 1.1, () => [c, 0.95 * k]);
      }
    });
  }
  function glowFor(kind, warm, k) {
    const h = kind === 'wall' ? A.wallH : A.glassH;
    const a = kind === 'solar' ? A.solar : A[kind];
    glow.position.set(FACADE_X - 0.14, kind === 'solar' ? A.glass.y : a.y, a.z);
    glow.scale.set(3.4, h, 1);
    glowMat.color.set(HEAT_COLORS[kind]);
    rim.material.color.set(HEAT_COLORS[kind]);
    glowMat.opacity = (kind === 'solar' ? 0.12 : 0.3) * warm * k;
    rim.material.opacity = Math.min(1, (kind === 'solar' ? 0.45 : 0.85) * warm) * k;
  }

  const paint = () => { group.visible = amount > 0.01 && !!A; };
  return {
    get active() { return active; },
    /** Posisi label sinar: di pangkal berkas tengah, searah sinar yang sedang dipakai. */
    get solarLabelPos() { return A ? new THREE.Vector3(FACADE_X - 0.06, A.glass.y - A.glassH / 2 + A.glassH * 0.66, A.solar.z).addScaledVector(sunDir(), 5.8) : null; },
    // q: { qWall, qGlass, qSolar } (W/m²); anchors: titik dan ukuran bidang, kedalaman overhang Barat.
    update({ q, anchors }) {
      A = anchors;
      const m = Math.max(1e-6, q.qWall, q.qGlass, q.qSolar);
      rel = { wall: Math.sqrt(Math.max(0, q.qWall) / m), glass: Math.sqrt(Math.max(0, q.qGlass) / m), solar: Math.sqrt(Math.max(0, q.qSolar) / m) };
      paint();
    },
    // Dipanggil tiap frame.
    tick(camera, timeSec, still) {
      if (!group.visible) return;
      cam = camera;
      const slot = Math.floor(timeSec / SLOT);
      const t = timeSec - slot * SLOT;
      active = focus || ORDER[slot % 3];
      const env = focus || still ? 1 : smooth(t / FADE) * smooth((SLOT - t) / FADE);
      const k = amount * env;
      if (active === 'solar') drawSolar(timeSec, k, still);
      else drawConduction(active, timeSec, k, still);
      // bidang: merambat menghangat bertahap; sinar menyala begitu berkas tiba
      const warm = still ? 0.6 : active === 'solar' ? smooth((t - 0.5) / 0.4) : smooth(t / (SLOT * 0.8));
      glowFor(active, warm, k);
      flush();
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
