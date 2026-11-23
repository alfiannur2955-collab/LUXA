// Kota generik prosedural: grid 5 x 5 blok (3 x 3 inti + cincin luar yang lebih rendah).
// Angka acak memakai seed tetap, jadi bentuk kota selalu sama setiap dibuka.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CITY = { block: 60, road: 16, seed: 6389, rings: 5 };
const PITCH = CITY.block + CITY.road; // 76

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

export function buildCity(pal) {
  const group = new THREE.Group();
  group.name = 'city';
  const r = rng(CITY.seed);
  const masses = [];
  const trees = [];
  const walks = [];
  const marks = [];
  const half = CITY.block / 2;

  const N = CITY.rings;
  for (let i = -N; i <= N; i++) {
    for (let j = -N; j <= N; j++) {
      const cx = i * PITCH, cz = j * PITCH;
      const ring = Math.max(Math.abs(i), Math.abs(j));
      walks.push(box(cx - half, cz - half, cx + half, cz + half, 0, 0.25));
      if (i === 0 && j === 0) continue; // blok tower
      if (i === 0 && j === 1) {
        // Plaza di selatan tower: dua baris pohon rapi di kiri-kanan, sumbu tengah dibiarkan terbuka ke tower.
        for (const dx of [-22, -14, 14, 22]) for (const dz of [-18, -6, 6, 18]) trees.push([cx + dx, cz + dz, 1]);
        for (let k = 0; k < 66; k++) r(); // jaga urutan angka acak supaya bentuk blok lain tidak berubah
        continue;
      }
      // Blok di depan kamera (barat dan selatan tower) dibuat lebih rendah supaya kaki tower terlihat.
      const front = i <= 0 && j >= 0;
      const maxF = Math.min(ring === 1 ? 12 : ring === 2 ? 9 : 7, front && ring <= 2 ? 6 : 99);
      // Kavling 2 x 2 dengan celah 4 m; kadang dua kavling digabung.
      const lots = [[-half + 1, -half + 1, -2, -2], [2, -half + 1, half - 1, -2], [-half + 1, 2, -2, half - 1], [2, 2, half - 1, half - 1]];
      const merge = r();
      if (merge < 0.22) {
        fillLot(masses, r, cx - half + 1, cz - half + 1, cx + half - 1, cz + half - 1, Math.min(maxF, 4));
      } else if (merge < 0.45) {
        fillLot(masses, r, cx - half + 1, cz - half + 1, cx + half - 1, cz - 2, maxF);
        for (const l of lots.slice(2)) if (r() > 0.12) fillLot(masses, r, cx + l[0], cz + l[1], cx + l[2], cz + l[3], maxF);
      } else {
        for (const l of lots) if (r() > 0.1) fillLot(masses, r, cx + l[0], cz + l[1], cx + l[2], cz + l[3], maxF);
      }
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

  // Pohon: bola sederhana + batang.
  const crown = [], trunk = [];
  for (const [x, z, s] of trees) {
    const c = new THREE.IcosahedronGeometry(2.2 * s, 1);
    c.translate(x, 4.2 * s + 0.25, z);
    crown.push(c.toNonIndexed());
    const t = new THREE.CylinderGeometry(0.18 * s, 0.22 * s, 3 * s, 6);
    t.translate(x, 1.5 * s + 0.25, z);
    trunk.push(t.toNonIndexed());
  }
  const crownMesh = new THREE.Mesh(mergeGeometries(crown), new THREE.MeshStandardMaterial({ color: pal.tree, roughness: 0.95, flatShading: true }));
  crownMesh.castShadow = crownMesh.receiveShadow = true;
  group.add(crownMesh);
  const trunkMesh = new THREE.Mesh(mergeGeometries(trunk), new THREE.MeshStandardMaterial({ color: pal.trunk, roughness: 1 }));
  trunkMesh.castShadow = true;
  group.add(trunkMesh);

  return group;
}
