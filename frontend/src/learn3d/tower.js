// Tower bertakik + podium sesuai Spesifikasi Tahap 0.
// Sumbu dunia: x = timur, z = selatan (utara = -z), y = atas. Satuan meter. Titik nol = pusat podium.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TOWER = {
  podium: { half: 20, floors: 3, floorH: 4.5 },
  tower: { floors: 20, floorH: 4, crownFloors: 2, crownInset: 2 },
  glassH: 1.7,
  sillH: 0.9,
  overhangDepth: 0.7,
};
export const PODIUM_H = TOWER.podium.floors * TOWER.podium.floorH; // 13.5
export const TOWER_TOP = PODIUM_H + TOWER.tower.floors * TOWER.tower.floorH; // 93.5
export const BODY_TOP = PODIUM_H + (TOWER.tower.floors - TOWER.tower.crownFloors) * TOWER.tower.floorH;

// Denah L: tower 28 x 28 m, takik 12 x 12 m di sudut barat daya.
const L_MAIN = [[-14, -14], [14, -14], [14, 14], [-2, 14], [-2, 2], [-14, 2]];
const L_CROWN = [[-12, -12], [12, -12], [12, 12], [0, 12], [0, 0], [-12, 0]];

// Fasad: sumbu tetap, posisi, rentang, arah normal, kode fasad.
function facadesOf(pts) {
  const [a, b, c, d, e, f] = pts;
  return [
    { id: 'U', axis: 'z', at: a[1], from: a[0], to: b[0], n: [0, -1] },
    { id: 'T', axis: 'x', at: b[0], from: b[1], to: c[1], n: [1, 0] },
    { id: 'S', axis: 'z', at: c[1], from: d[0], to: c[0], n: [0, 1] },
    { id: 'Bd', axis: 'x', at: d[0], from: e[1], to: d[1], n: [-1, 0] },
    { id: 'Sd', axis: 'z', at: e[1], from: f[0], to: e[0], n: [0, 1] },
    { id: 'B', axis: 'x', at: f[0], from: a[1], to: f[1], n: [-1, 0] },
  ];
}
export const FACADES = facadesOf(L_MAIN);
const CROWN_FACADES = facadesOf(L_CROWN);
// Kode fasad → arah tabel SNI (fasad dalam takik ikut arahnya).
export const FACADE_DIR = { U: 'U', T: 'T', S: 'S', B: 'B', Sd: 'S', Bd: 'B' };
const OVERHANG_FACADES = new Set(['B', 'Bd']);

function extrudeShape(pts, y0, h) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

// Kotak yang menempel pada fasad: u = posisi sepanjang fasad, y = tengah tinggi, off = jarak keluar.
function facadeBox(f, u, y, len, h, depth, off) {
  const g = f.axis === 'z' ? new THREE.BoxGeometry(len, h, depth) : new THREE.BoxGeometry(depth, h, len);
  const ox = f.n[0] * off, oz = f.n[1] * off;
  if (f.axis === 'z') g.translate(u, y, f.at + oz);
  else g.translate(f.at + ox, y, u);
  return g;
}

// Tinggi kaca per lantai dari WWR (lantai 4 m). Ambang dibuat agar pita kaca berada di tengah lantai.
export const glassHForWwr = (wwr) => Math.min(3.4, Math.max(0.2, wwr * TOWER.tower.floorH));
export const sillFor = (h) => Math.max(0.25, (TOWER.tower.floorH - h) / 2 - 0.15);

export function buildTower(pal) {
  const group = new THREE.Group();
  group.name = 'tower';
  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: pal.tower, roughness: 0.92, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: pal.glass, roughness: 0.3, metalness: 0.05 }),
    mull: new THREE.MeshStandardMaterial({ color: pal.mullion, roughness: 0.9 }),
    edge: new THREE.LineBasicMaterial({ color: pal.edge, transparent: true, opacity: pal.edgeOpacity }),
  };
  group.userData.mats = mats;

  const { floors, floorH, crownFloors } = TOWER.tower;
  const mainFloors = floors - crownFloors;
  const P = TOWER.podium;

  // Massa: podium, badan tower, mahkota, kotak mesin.
  const solids = [
    extrudeShape([[-P.half, -P.half], [P.half, -P.half], [P.half, P.half], [-P.half, P.half]], 0, PODIUM_H),
    extrudeShape(L_MAIN, PODIUM_H, mainFloors * floorH),
    extrudeShape(L_CROWN, PODIUM_H + mainFloors * floorH, crownFloors * floorH),
  ];
  const mech = new THREE.BoxGeometry(8, 3, 6);
  mech.translate(4, TOWER_TOP + 1.5, -4);
  solids.push(mech);
  const solid = new THREE.Mesh(mergeGeometries(solids.map((g) => (g.index ? g.toNonIndexed() : g))), mats.wall);
  solid.castShadow = solid.receiveShadow = true;
  group.add(solid);
  group.add(new THREE.LineSegments(mergeGeometries(solids.map((g) => new THREE.EdgesGeometry(g, 25))), mats.edge));

  // Pita kaca podium di keempat sisi (tetap).
  const h = P.half;
  const podFacades = [
    { axis: 'z', at: -h, from: -h, to: h, n: [0, -1] },
    { axis: 'x', at: h, from: -h, to: h, n: [1, 0] },
    { axis: 'z', at: h, from: -h, to: h, n: [0, 1] },
    { axis: 'x', at: -h, from: -h, to: h, n: [-1, 0] },
  ];
  const podGlass = [];
  for (const f of podFacades) {
    const len = Math.abs(f.to - f.from) - 2;
    for (let k = 0; k < P.floors; k++) podGlass.push(facadeBox(f, (f.from + f.to) / 2, k * P.floorH + 0.9 + 1.35, len, 2.7, 0.08, 0.04));
  }
  const podGlassMesh = new THREE.Mesh(mergeGeometries(podGlass), mats.glass);
  podGlassMesh.receiveShadow = true;
  group.add(podGlassMesh);

  group.userData.parts = { skylights: null, overhangs: [] };
  group.userData.glazingOpts = { heights: { U: TOWER.glassH, T: TOWER.glassH, S: TOWER.glassH, B: TOWER.glassH }, depth: TOWER.overhangDepth };
  setGlazing(group, {});
  setSkylightArea(group, 51);
  return group;
}

// Bangun ulang kaca, kusen tipis (visual), dan overhang.
// heights: tinggi kaca per arah {U,T,S,B} (m); depth: kedalaman overhang di fasad Barat dan Barat takik (m).
export function setGlazing(tower, { heights, depth } = {}) {
  const opts = tower.userData.glazingOpts;
  if (heights) opts.heights = { ...opts.heights, ...heights };
  if (depth != null) opts.depth = depth;
  const { mats } = tower.userData;
  const old = tower.getObjectByName('glazing');
  if (old) {
    tower.remove(old);
    old.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  const g = new THREE.Group();
  g.name = 'glazing';
  const { floors, floorH, crownFloors } = TOWER.tower;
  const mainFloors = floors - crownFloors;
  const glass = [], mull = [], over = {};
  const baseDepth = 1; // overhang dibangun 1 m lalu diskalakan, supaya kedalaman bisa diubah tanpa membangun ulang
  const add = (fs, f0, f1) => {
    for (const f of fs) {
      const gh = opts.heights[FACADE_DIR[f.id]];
      const sill = sillFor(gh);
      const len = Math.abs(f.to - f.from) - 0.8;
      const mid = (f.from + f.to) / 2;
      const nM = Math.max(1, Math.floor(len / 1.5));
      for (let k = f0; k < f1; k++) {
        const base = PODIUM_H + k * floorH;
        const yc = base + sill + gh / 2;
        glass.push(facadeBox(f, mid, yc, len, gh, 0.08, 0.04));
        for (let m = 1; m < nM; m++) mull.push(facadeBox(f, mid - len / 2 + m * (len / nM), yc, 0.07, gh, 0.12, 0.06));
        if (OVERHANG_FACADES.has(f.id)) {
          const key = `${f.id}@${f.at}`;
          (over[key] ||= []).push(facadeBox(f, mid, base + sill + gh + 0.18, len + 0.4, 0.16, baseDepth, baseDepth / 2));
        }
      }
    }
  };
  add(FACADES, 0, mainFloors);
  add(CROWN_FACADES, mainFloors, floors);
  const glassMesh = new THREE.Mesh(mergeGeometries(glass), mats.glass);
  glassMesh.receiveShadow = true;
  g.add(glassMesh);
  const mullMesh = new THREE.Mesh(mergeGeometries(mull), mats.mull);
  mullMesh.castShadow = mullMesh.receiveShadow = true;
  g.add(mullMesh);
  const overhangs = [];
  for (const key of Object.keys(over)) {
    const geo = mergeGeometries(over[key]);
    const m = new THREE.Mesh(geo, mats.wall);
    m.castShadow = m.receiveShadow = true;
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), mats.edge));
    m.userData.pivotX = Number(key.split('@')[1]);
    m.userData.baseDepth = baseDepth;
    g.add(m);
    overhangs.push(m);
  }
  tower.userData.parts.overhangs = overhangs;
  tower.add(g);
  setOverhangDepth(tower, opts.depth);
}

// Ubah kedalaman overhang (meter): kotak diskalakan dari bidang dinding ke luar.
export function setOverhangDepth(tower, depth) {
  tower.userData.glazingOpts.depth = depth;
  for (const m of tower.userData.parts.overhangs) {
    const s = Math.max(depth, 0.001) / m.userData.baseDepth;
    m.visible = depth > 0.02;
    m.scale.x = s;
    m.position.x = m.userData.pivotX * (1 - s);
  }
}

// Luas atap podium di luar tapak tower (m²) dan pengaturan luas skylight (Bab 8).
export const PODIUM_ROOF_AREA = (2 * TOWER.podium.half) ** 2 - (28 * 28 - 12 * 12);
const SKY_SLOTS = [
  ...[-15, -9, -3, 3, 9, 15].map((z) => [17, z, 3, 5]), // jalur timur
  ...[-15, -9, -3, 3, 9].map((x) => [x, 17, 5, 3]), // jalur selatan
];
export const SKY_MAX_AREA = SKY_SLOTS.reduce((a, s) => a + s[2] * s[3], 0);
export function setSkylightArea(tower, area) {
  const { mats, parts } = tower.userData;
  const old = parts.skylights;
  if (old) { tower.remove(old); old.traverse((o) => o.geometry && o.geometry.dispose()); }
  let left = Math.max(0, Math.min(SKY_MAX_AREA, area));
  const geos = [];
  for (const [x, z, w, d] of SKY_SLOTS) {
    if (left <= 0.5) break;
    const full = w * d, k = Math.min(1, left / full);
    left -= full * k;
    const dd = d * k; // panel terakhir dipendekkan sesuai sisa luas
    const g = new THREE.BoxGeometry(w > d ? w * k : w, 0.6, w > d ? d : dd);
    g.translate(x, PODIUM_H + 0.3, z);
    geos.push(g);
  }
  const g = new THREE.Group();
  g.name = 'skylights';
  if (geos.length) {
    const geo = mergeGeometries(geos);
    const m = new THREE.Mesh(geo, mats.glass);
    m.castShadow = m.receiveShadow = true;
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), mats.edge));
    g.add(m);
  }
  tower.add(g);
  parts.skylights = g;
}

// Luas fasad per arah (m²) untuk OTTV total.
export function facadeAreas() {
  const H = (TOWER.tower.floors) * TOWER.tower.floorH;
  const out = { U: 0, T: 0, S: 0, B: 0 };
  for (const f of FACADES) out[FACADE_DIR[f.id]] += Math.abs(f.to - f.from) * H;
  return out;
}
