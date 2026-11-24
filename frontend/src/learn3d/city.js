// Kota generik prosedural: grid 5 x 5 blok (3 x 3 inti + cincin luar yang lebih rendah).
// Angka acak memakai seed tetap, jadi bentuk kota selalu sama setiap dibuka.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CITY = { block: 60, road: 16, seed: 6389, rings: 5, sidewalk: 2.5 };
export const PITCH = CITY.block + CITY.road; // 76
// Blok yang jadi ruang publik (i, j dalam grid blok). Plaza di selatan tower (0,1) tetap plaza, ditambah air mancur.
const PARKS = { '-1,1': 'radial', '1,1': 'organic', '-2,0': 'square' };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function box(x0, z0, x1, z1, y0, h) {
  const g = new THREE.BoxGeometry(x1 - x0, h, z1 - z0);
  g.translate((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
  return g;
}

function speckleTexture(base, speck) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  const r = rng(11);
  x.fillStyle = speck;
  for (let i = 0; i < 2600; i++) {
    const s = r() < 0.7 ? 1.4 : 2.4;
    x.globalAlpha = 0.45 + r() * 0.5;
    x.fillRect(r() * 256, r() * 256, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Satu kavling 28 x 28 m (atau gabungan) diisi satu jenis massa.
function fillLot(out, r, x0, z0, x1, z1, maxFloors) {
  const fl = () => 2 + Math.floor(r() * (maxFloors - 1));
  const H = (n) => n * 4;
  const kind = r();
  const w = x1 - x0, d = z1 - z0;
  if (kind < 0.42) {
    out.push(box(x0, z0, x1, z1, 0, H(fl())));
  } else if (kind < 0.62) {
    // Denah L
    const h = H(fl());
    const cx = x0 + w * (0.45 + r() * 0.15), cz = z0 + d * (0.45 + r() * 0.15);
    out.push(box(x0, z0, x1, cz, 0, h));
    out.push(box(x0, cz, cx, z1, 0, h));
  } else if (kind < 0.78 && w > 30) {
    // Halaman tengah
    const h = H(Math.min(fl(), 5)), t = 9;
    out.push(box(x0, z0, x1, z0 + t, 0, h));
    out.push(box(x0, z1 - t, x1, z1, 0, h));
    out.push(box(x0, z0 + t, x0 + t, z1 - t, 0, h));
    out.push(box(x1 - t, z0 + t, x1, z1 - t, 0, h));
  } else {
    // Bertingkat mundur
    const h1 = H(2 + Math.floor(r() * 2)), h2 = H(fl());
    out.push(box(x0, z0, x1, z1, 0, h1));
    const i = 4 + r() * 3;
    out.push(box(x0 + i, z0 + i, x1 - i, z1 - i, h1, h2));
  }
  // Kotak mesin kecil di atap, sesekali
  if (r() < 0.45) {
    const top = out[out.length - 1];
    top.computeBoundingBox();
    const bb = top.boundingBox;
    const mx = bb.min.x + 3 + r() * Math.max(1, bb.max.x - bb.min.x - 10);
    const mz = bb.min.z + 3 + r() * Math.max(1, bb.max.z - bb.min.z - 10);
    out.push(box(mx, mz, mx + 4, mz + 3, bb.max.y, 2));
  }
}

// Bidang datar dari poligon (x, z) setebal h di ketinggian y.
function flatShape(pts, y, h) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
function disc(x, z, r, y, h, seg = 48) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}
// Pita jalan setapak mengikuti titik-titik (x, z).
function ribbon(pts, w, y) {
  const pos = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * w / 2, nz = (dx / L) * w / 2;
    pos.push(x0 + nx, y, z0 + nz, x1 + nx, y, z1 + nz, x0 - nx, y, z0 - nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function bench(out, x, z, ang) {
  const g = new THREE.BoxGeometry(2.2, 0.5, 0.7);
  g.rotateY(ang);
  g.translate(x, 0.25 + 0.25, z);
  out.push(g);
}
function fountainAt(parts, x, z, r) {
  parts.masses.push(disc(x, z, r + 0.4, 0.25, 0.8, 40)); // bibir kolam
  parts.water.push(disc(x, z, r, 0.25, 0.82, 40)); // permukaan air sedikit di atas bibir bagian dalam
  parts.masses.push(disc(x, z, 0.6, 0.25, 1.9, 16)); // tiang tengah
  parts.fountains.push({ x, z, y: 2.15, r: r * 0.8 });
}

// Isi satu blok ruang publik. Memakai rng sendiri supaya urutan acak kota tidak berubah.
function buildPark(kind, cx, cz, parts, pr) {
  const half = CITY.block / 2;
  const Y = 0.25;
  if (kind === 'radial') {
    // Taman bundar: rumput, jari-jari jalan setapak, cincin jalan, air mancur di tengah.
    parts.lawn.push(disc(cx, cz, 27, Y, 0.12, 64));
    parts.path.push(disc(cx, cz, 11, Y + 0.12, 0.05, 48));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const g = new THREE.BoxGeometry(17, 0.05, 3);
      g.translate(18.5, Y + 0.145, 0);
      g.rotateY(-a);
      g.translate(cx, 0, cz);
      parts.path.push(g);
      const am = a + Math.PI / 8;
      parts.trees.push([cx + Math.cos(am) * 17.5, cz + Math.sin(am) * 17.5, 1]);
      bench(parts.masses, cx + Math.cos(am) * 9.2, cz + Math.sin(am) * 9.2, -am + Math.PI / 2);
    }
    const ring = new THREE.RingGeometry(23, 25, 64);
    ring.rotateX(-Math.PI / 2);
    ring.translate(cx, Y + 0.17, cz);
    parts.path.push(ring);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.trees.push([cx + sx * 26, cz + sz * 26, 1.1]);
    fountainAt(parts, cx, cz, 4.6);
    parts.spots.push({ kind, cx, cz });
  } else if (kind === 'organic') {
    // Taman organik: rumput bersudut bulat, kolam berbentuk bebas, jalan setapak meliuk, pohon bergerombol.
    const rr = 7, h = half - 2;
    const rect = [];
    for (const [qx, qz, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
      for (let k = 0; k <= 4; k++) {
        const a = ((a0 + k * 22.5) * Math.PI) / 180;
        rect.push([cx + qx * (h - rr) + Math.cos(a) * rr, cz + qz * (h - rr) + Math.sin(a) * rr]);
      }
    }
    parts.lawn.push(flatShape(rect, Y, 0.12));
    const pc = [cx + 9, cz - 7];
    const pond = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const rad = 10.5 * (1 + 0.22 * Math.sin(3 * a + 1) + 0.1 * Math.sin(5 * a + 2));
      pond.push([pc[0] + Math.cos(a) * rad * 1.15, pc[1] + Math.sin(a) * rad * 0.85]);
    }
    parts.water.push(flatShape(pond, Y + 0.12, 0.04));
    const curve = (ctrl) => new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(cx + x, 0, cz + z))).getPoints(48).map((v) => [v.x, v.z]);
    const p1 = curve([[-30, 12], [-16, 16], [-4, 7], [-10, -10], [-3, -22], [5, -30]]);
    const p2 = curve([[-4, 7], [6, 12], [18, 14], [30, 9]]);
    parts.path.push(ribbon(p1, 2.6, Y + 0.16), ribbon(p2, 2.6, Y + 0.16));
    const near = (x, z, pts, d) => pts.some(([a, b]) => Math.hypot(a - x, b - z) < d);
    const placed = [];
    for (let t = 0; t < 400 && placed.length < 26; t++) {
      const x = cx + (pr() - 0.5) * 50, z = cz + (pr() - 0.5) * 50;
      if (Math.hypot((x - pc[0]) / 1.15, (z - pc[1]) / 0.85) < 15) continue;
      if (near(x, z, p1, 3.6) || near(x, z, p2, 3.6)) continue;
      if (placed.some(([a, b]) => Math.hypot(a - x, b - z) < 5.5)) continue;
      placed.push([x, z]);
      parts.trees.push([x, z, 0.8 + pr() * 0.5]);
    }
    bench(parts.masses, pc[0] - 13, pc[1] + 4, 0.4);
    bench(parts.masses, pc[0] + 2, pc[1] + 11, 0);
    parts.spots.push({ kind, cx, cz, paths: [p1, p2], pond: pc });
  } else if (kind === 'square') {
    // Alun-alun: lantai paving, kisi pohon 4 x 4, air mancur di tengah.
    const g = new THREE.BoxGeometry(56, 0.05, 56);
    g.translate(cx, Y + 0.025, cz);
    parts.path.push(g);
    for (const dx of [-21, -10.5, 10.5, 21]) for (const dz of [-21, -10.5, 10.5, 21]) parts.trees.push([cx + dx, cz + dz, 0.95]);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; bench(parts.masses, cx + Math.cos(a) * 7.5, cz + Math.sin(a) * 7.5, -a + Math.PI / 2); }
    fountainAt(parts, cx, cz, 3.8);
    parts.spots.push({ kind, cx, cz });
  }
}

export function buildCity(pal) {
  const group = new THREE.Group();
  group.name = 'city';
  const r = rng(CITY.seed);
  const masses = [];
  const trees = [];
  const walks = [];
  const marks = [];
  const half = CITY.block / 2;
  const parts = { masses, trees, lawn: [], path: [], water: [], fountains: [], spots: [] };
  const pr = rng(CITY.seed + 101);
  const SW = CITY.sidewalk;

  const N = CITY.rings;
  for (let i = -N; i <= N; i++) {
    for (let j = -N; j <= N; j++) {
      const cx = i * PITCH, cz = j * PITCH;
      const ring = Math.max(Math.abs(i), Math.abs(j));
      walks.push(box(cx - half - SW, cz - half - SW, cx + half + SW, cz + half + SW, 0, 0.25)); // blok + trotoar keliling
      if (i === 0 && j === 0) continue; // blok tower
      if (i === 0 && j === 1) {
        // Plaza di selatan tower: dua baris pohon rapi di kiri-kanan, sumbu tengah dibiarkan terbuka ke tower.
        for (const dx of [-22, -14, 14, 22]) for (const dz of [-18, -6, 6, 18]) trees.push([cx + dx, cz + dz, 1]);
        for (let k = 0; k < 66; k++) r(); // jaga urutan angka acak supaya bentuk blok lain tidak berubah
        parts.path.push(disc(cx, cz, 8, 0.25, 0.05, 48));
        fountainAt(parts, cx, cz, 4);
        for (let k = 0; k < 4; k++) bench(masses, cx + (k < 2 ? -9.5 : 9.5), cz + (k % 2 ? 6 : -6), Math.PI / 2);
        parts.spots.push({ kind: 'plaza', cx, cz });
        continue;
      }
      // Blok di depan kamera (barat dan selatan tower) dibuat lebih rendah supaya kaki tower terlihat.
      const front = i <= 0 && j >= 0;
      const maxF = Math.min(ring === 1 ? 12 : ring === 2 ? 9 : 7, front && ring <= 2 ? 6 : 99);
      // Kavling 2 x 2 dengan celah 4 m; kadang dua kavling digabung.
      const lots = [[-half + 1, -half + 1, -2, -2], [2, -half + 1, half - 1, -2], [-half + 1, 2, -2, half - 1], [2, 2, half - 1, half - 1]];
      // Blok ruang publik tetap "menghitung" gedungnya (ke array buangan) supaya urutan acak blok lain sama.
      const park = PARKS[`${i},${j}`];
      const target = park ? [] : masses;
      const merge = r();
      if (merge < 0.22) {
        fillLot(target, r, cx - half + 1, cz - half + 1, cx + half - 1, cz + half - 1, Math.min(maxF, 4));
      } else if (merge < 0.45) {
        fillLot(target, r, cx - half + 1, cz - half + 1, cx + half - 1, cz - 2, maxF);
        for (const l of lots.slice(2)) if (r() > 0.12) fillLot(target, r, cx + l[0], cz + l[1], cx + l[2], cz + l[3], maxF);
      } else {
        for (const l of lots) if (r() > 0.1) fillLot(target, r, cx + l[0], cz + l[1], cx + l[2], cz + l[3], maxF);
      }
      if (park) buildPark(park, cx, cz, parts, pr);
    }
  }

  // Pohon di tapak tower: satu baris rapi di tiap sisi, di antara podium (20 m) dan tepi blok (30 m).
  // Jarak 8 m, sudut diisi sekali saja. Tidak ada pohon di badan jalan.
  const ring = 25;
  for (let k = -3; k <= 3; k++) {
    const u = k * 8;
    trees.push([u, -ring, 1], [u, ring, 1]);
    if (Math.abs(k) < 3) trees.push([-ring, u, 1], [ring, u, 1]);
  }

  // Pohon jalan: di trotoar keliling blok dekat tower, jarak 15 m, tidak di badan jalan maupun di persimpangan.
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const cx = i * PITCH, cz = j * PITCH, o = half + SW / 2;
      for (const u of [-22.5, -7.5, 7.5, 22.5]) trees.push([cx + u, cz - o, 0.75], [cx + u, cz + o, 0.75], [cx - o, cz + u, 0.75], [cx + o, cz + u, 0.75]);
    }
  }

  // Garis tengah jalan putus-putus.
  const ext = (N + 0.5) * PITCH;
  for (let k = -N; k < N; k++) {
    const c = k * PITCH + PITCH / 2;
    for (let t = -ext; t < ext; t += 9) {
      marks.push(box(t, c - 0.15, t + 4.5, c + 0.15, 0.02, 0.02));
      marks.push(box(c - 0.15, t, c + 0.15, t + 4.5, 0.02, 0.02));
    }
  }

  const massMat = new THREE.MeshStandardMaterial({ color: pal.mass, roughness: 0.95, metalness: 0 });
  const massGeo = mergeGeometries(masses);
  const massMesh = new THREE.Mesh(massGeo, massMat);
  massMesh.castShadow = massMesh.receiveShadow = true;
  massMesh.name = 'masses';
  group.add(massMesh);
  const edgeMat = new THREE.LineBasicMaterial({ color: pal.edge, transparent: true, opacity: pal.edgeOpacity * 0.9 });
  group.add(new THREE.LineSegments(mergeGeometries(masses.map((g) => new THREE.EdgesGeometry(g, 25))), edgeMat));

  // Tanah tanpa cahaya yang memudar ke warna latar, plus penangkap bayangan di atasnya,
  // supaya tepi bidang tanah tidak pernah terlihat.
  const groundSize = 4400;
  const gc = document.createElement('canvas');
  gc.width = gc.height = 512;
  const gx = gc.getContext('2d');
  const grad = gx.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, pal.road);
  grad.addColorStop(0.22, pal.road);
  grad.addColorStop(0.5, pal.bg);
  grad.addColorStop(1, pal.bg);
  gx.fillStyle = grad;
  gx.fillRect(0, 0, 512, 512);
  const gtex = new THREE.CanvasTexture(gc);
  gtex.colorSpace = THREE.SRGBColorSpace;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.MeshBasicMaterial({ map: gtex }));
  road.rotation.x = -Math.PI / 2;
  group.add(road);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.ShadowMaterial({ color: pal.shadow, opacity: pal.shadowOpacity }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.01;
  catcher.receiveShadow = true;
  group.add(catcher);

  const walkTex = speckleTexture(pal.walk, pal.speck);
  walkTex.repeat.set(0.03, 0.03);
  const walkGeo = mergeGeometries(walks);
  // UV dunia supaya bintik tidak melar.
  const pos = walkGeo.attributes.position, uv = walkGeo.attributes.uv;
  for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k), pos.getZ(k));
  const walkMesh = new THREE.Mesh(walkGeo, new THREE.MeshStandardMaterial({ map: walkTex, roughness: 1 }));
  walkMesh.receiveShadow = true;
  group.add(walkMesh);

  group.add(new THREE.Mesh(mergeGeometries(marks), new THREE.MeshBasicMaterial({ color: pal.marking })));

  // Ruang publik: rumput, jalan setapak/paving, air.
  const flat = (list, mat) => {
    if (!list.length) return;
    const m = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; })), mat);
    m.receiveShadow = true;
    group.add(m);
  };
  flat(parts.lawn, new THREE.MeshStandardMaterial({ color: pal.lawn, roughness: 1 }));
  flat(parts.path, new THREE.MeshStandardMaterial({ color: pal.path, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  flat(parts.water, new THREE.MeshStandardMaterial({ color: pal.water, roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  // Data untuk kehidupan kota (lalu lintas, pejalan kaki, air mancur).
  group.userData.life = { fountains: parts.fountains, spots: parts.spots, half, sidewalk: SW, pitch: PITCH };

  // Pohon: bola sederhana + batang.
  const crown = [], trunk = [];
  for (const [x, z, s] of trees) {
    const c = new THREE.IcosahedronGeometry(2.2 * s, 1);
    c.translate(x, 4.2 * s + 0.25, z);
    crown.push(c.index ? c.toNonIndexed() : c); // Icosahedron sudah non-indexed: hindari ratusan peringatan konsol
    const t = new THREE.CylinderGeometry(0.18 * s, 0.22 * s, 3 * s, 6);
    t.translate(x, 1.5 * s + 0.25, z);
    trunk.push(t.index ? t.toNonIndexed() : t);
  }
  const crownMesh = new THREE.Mesh(mergeGeometries(crown), new THREE.MeshStandardMaterial({ color: pal.tree, roughness: 0.95, flatShading: true }));
  crownMesh.castShadow = crownMesh.receiveShadow = true;
  group.add(crownMesh);
  const trunkMesh = new THREE.Mesh(mergeGeometries(trunk), new THREE.MeshStandardMaterial({ color: pal.trunk, roughness: 1 }));
  trunkMesh.castShadow = true;
  group.add(trunkMesh);

  return group;
}
