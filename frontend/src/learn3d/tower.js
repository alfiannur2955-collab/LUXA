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

// Denah L: tower 28 x 28 m, takik 12 x 12 m di sudut barat daya.
const L_MAIN = [[-14, -14], [14, -14], [14, 14], [-2, 14], [-2, 2], [-14, 2]];
const L_CROWN = [[-12, -12], [12, -12], [12, 12], [0, 12], [0, 0], [-12, 0]];

// Fasad: sumbu tetap, posisi, rentang, arah normal, kode arah.
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

export function buildTower(pal) {
  const group = new THREE.Group();
  group.name = 'tower';
  const wallMat = new THREE.MeshStandardMaterial({ color: pal.tower, roughness: 0.92, metalness: 0 });
  const glassMat = new THREE.MeshStandardMaterial({ color: pal.glass, roughness: 0.3, metalness: 0.05 });
  const mullMat = new THREE.MeshStandardMaterial({ color: pal.mullion, roughness: 0.9 });
  const edgeMat = new THREE.LineBasicMaterial({ color: pal.edge, transparent: true, opacity: pal.edgeOpacity });

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
  const solidGeo = mergeGeometries(solids.map((g) => g.toNonIndexed()));
  const solid = new THREE.Mesh(solidGeo, wallMat);
  solid.castShadow = solid.receiveShadow = true;
  group.add(solid);
  const edges = new THREE.LineSegments(mergeGeometries(solids.map((g) => new THREE.EdgesGeometry(g, 25))), edgeMat);
  group.add(edges);

  // Kaca, kusen tipis (visual saja), overhang.
  const glass = { U: [], T: [], S: [], Bd: [], Sd: [], B: [] };
  const mull = [];
  const over = { B: [], Bd: [] };
  const addBands = (fs, f0, f1) => {
    for (const f of fs) {
      const len = Math.abs(f.to - f.from) - 0.8;
      const mid = (f.from + f.to) / 2;
      for (let k = f0; k < f1; k++) {
        const base = PODIUM_H + k * floorH;
        const yc = base + TOWER.sillH + TOWER.glassH / 2;
        glass[f.id].push(facadeBox(f, mid, yc, len, TOWER.glassH, 0.08, 0.04));
        const nM = Math.floor(len / 1.5);
        for (let m = 1; m < nM; m++) mull.push(facadeBox(f, mid - len / 2 + m * (len / nM), yc, 0.07, TOWER.glassH, 0.12, 0.06));
        if (OVERHANG_FACADES.has(f.id)) {
          const d = TOWER.overhangDepth;
          over[f.id].push(facadeBox(f, mid, base + TOWER.sillH + TOWER.glassH + 0.18, len + 0.4, 0.16, d, d / 2));
        }
      }
    }
  };
  addBands(FACADES, 0, mainFloors);
  addBands(CROWN_FACADES, mainFloors, floors);

  // Pita kaca podium di keempat sisi.
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
    for (let k = 0; k < P.floors; k++) {
      podGlass.push(facadeBox(f, (f.from + f.to) / 2, k * P.floorH + 0.9 + 1.35, len, 2.7, 0.08, 0.04));
    }
  }

  const parts = {};
  for (const id of Object.keys(glass)) {
    const m = new THREE.Mesh(mergeGeometries(glass[id]), glassMat.clone());
    m.name = 'glass-' + id;
    m.receiveShadow = true;
    group.add(m);
    parts['glass' + id] = m;
  }
  const podGlassMesh = new THREE.Mesh(mergeGeometries(podGlass), glassMat);
  podGlassMesh.receiveShadow = true;
  group.add(podGlassMesh);
  const mullMesh = new THREE.Mesh(mergeGeometries(mull), mullMat);
  mullMesh.castShadow = mullMesh.receiveShadow = true;
  group.add(mullMesh);
  for (const id of Object.keys(over)) {
    const g = mergeGeometries(over[id]);
    const m = new THREE.Mesh(g, wallMat);
    m.name = 'overhang-' + id;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), edgeMat));
    parts['overhang' + id] = m;
  }

  // Skylight di atap podium: dua kelompok (timur dan selatan).
  const sky = [];
  for (const z of [-10, -2, 6]) { const g = new THREE.BoxGeometry(3, 0.6, 5); g.translate(17, PODIUM_H + 0.3, z); sky.push(g); }
  for (const x of [0, 7]) { const g = new THREE.BoxGeometry(5, 0.6, 3); g.translate(x, PODIUM_H + 0.3, 17); sky.push(g); }
  const skyGeo = mergeGeometries(sky);
  const skyMesh = new THREE.Mesh(skyGeo, glassMat);
  skyMesh.name = 'skylights';
  skyMesh.castShadow = skyMesh.receiveShadow = true;
  group.add(skyMesh);
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(skyGeo, 25), edgeMat));
  parts.skylights = skyMesh;

  group.userData.parts = parts;
  return group;
}
