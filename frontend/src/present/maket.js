// Maket model pengguna untuk Mode Presentasi: dinding putih, kaca teal, peneduh/atap, alas maket.
// Hanya tampilan: membaca hasil engine (analysisData) apa adanya, tidak menghitung ulang apa pun.
import * as THREE from 'three';

const REF_H = 93.5; // tinggi tower Belajar; awan dan burung diskalakan terhadap angka ini

// Backend (Timur, Utara, Atas) -> Three.js (x = Timur, y = Atas, z = -Utara)
const pushV = (arr, v, o) => arr.push(v[0] - o[0], v[2] - o[2], -(v[1] - o[1]));

function triangulate(out, verts, o) {
  for (let i = 1; i + 1 < verts.length; i++) {
    pushV(out, verts[0], o); pushV(out, verts[i], o); pushV(out, verts[i + 1], o);
  }
}

function meshOf(coords, material) {
  if (!coords.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Kualitas otomatis menurut jumlah segitiga (lihat spesifikasi P0, Aturan tampilan).
export function qualityFor(tris) {
  if (tris <= 20000) return { tier: 'full', ao: true, shadowSize: 4096, edges: 'panels' };
  if (tris <= 60000) return { tier: 'medium', ao: false, shadowSize: 2048, edges: 'creases' };
  return { tier: 'light', ao: false, shadowSize: 2048, edges: 'none' };
}

/**
 * analysis = state.analysisData, roles = state.config.roles.
 * Hasil: { group, bounds, tris, quality, scale, dispose() }. Model digeser supaya pusat tapaknya di (0, 0)
 * dan lantai terbawahnya di y = 0.
 */
export function buildMaket(analysis, roles, pal) {
  const disabled = new Set(roles?.disabled_groups || []);
  const bb = analysis?.summary?.bounding_box;
  const o = bb ? [bb.center[0], bb.center[1], bb.min[2]] : [0, 0, 0];

  const opaque = [], glass = [], context = [], outlines = [];
  for (const p of analysis?.panels || []) {
    if (!p.active || disabled.has(p.group_name) || !Array.isArray(p.vertices) || p.vertices.length < 3) continue;
    const isGlass = p.element_type === 'glazing' || p.element_type === 'composite_cw';
    triangulate(isGlass ? glass : opaque, p.vertices, o);
    const n = p.vertices.length;
    for (let i = 0; i < n; i++) { pushV(outlines, p.vertices[i], o); pushV(outlines, p.vertices[(i + 1) % n], o); }
  }
  for (const key of ['shading_elements', 'frame_elements', 'roof_elements']) {
    for (const el of analysis?.[key] || []) {
      if (!el?.vertices?.length || !el?.faces?.length || disabled.has(el.group_name)) continue;
      for (const f of el.faces) triangulate(context, f.filter((idx, i) => i < 3 || idx !== f[2]).map((idx) => el.vertices[idx]).filter(Boolean), o);
    }
  }
  const tris = (opaque.length + glass.length + context.length) / 9;
  const quality = qualityFor(tris);

  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: pal.tower, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: pal.glass, roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide }),
    ctx: new THREE.MeshStandardMaterial({ color: pal.mullion, roughness: 0.9, side: THREE.DoubleSide }),
    edge: new THREE.LineBasicMaterial({ color: pal.edge, transparent: true, opacity: pal.edgeOpacity * 0.55 }),
  };
  const group = new THREE.Group();
  group.name = 'maket';
  const meshes = [meshOf(opaque, mats.wall), meshOf(glass, mats.glass), meshOf(context, mats.ctx)].filter(Boolean);
  group.add(...meshes);

  // Garis maket: tepi tiap panel untuk model ringan, tepi lipatan saja untuk model sedang, tanpa garis untuk model berat.
  if (quality.edges === 'panels' && outlines.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(outlines, 3));
    group.add(new THREE.LineSegments(g, mats.edge));
  } else if (quality.edges === 'creases') {
    for (const m of meshes) group.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), mats.edge));
  }

  // Ukuran model (sudah tergeser): dipakai kamera, bayangan, awan, dan alas.
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(1, size.length() / 2);
  const maxSpan = Math.max(size.x, size.y, size.z, 1);

  // Alas maket: papan tipis bersudut bulat, sedikit lebih lebar dari tapak.
  const pad = Math.max(size.x, size.z) * 0.18 + 3;
  const w = size.x + pad * 2, d = size.z + pad * 2, rr = Math.min(w, d) * 0.08, th = Math.max(0.3, maxSpan * 0.012);
  const shape = new THREE.Shape();
  const x0 = center.x - w / 2, z0 = center.z - d / 2;
  shape.moveTo(x0 + rr, z0);
  shape.lineTo(x0 + w - rr, z0); shape.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + rr);
  shape.lineTo(x0 + w, z0 + d - rr); shape.quadraticCurveTo(x0 + w, z0 + d, x0 + w - rr, z0 + d);
  shape.lineTo(x0 + rr, z0 + d); shape.quadraticCurveTo(x0, z0 + d, x0, z0 + d - rr);
  shape.lineTo(x0, z0 + rr); shape.quadraticCurveTo(x0, z0, x0 + rr, z0);
  const baseGeo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 10 });
  baseGeo.rotateX(Math.PI / 2); // bentuk di bidang xz, tebal ke bawah
  const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: pal.walk, roughness: 0.95 }));
  base.position.y = -0.02;
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);

  // Lantai tak berujung: hanya menerima bayangan, warnanya tetap latar.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: pal.shadow, opacity: pal.shadowOpacity * 1.6 }));
  floor.rotation.x = -Math.PI / 2;
  floor.scale.setScalar(maxSpan * 40);
  floor.position.y = -th - 0.02;
  floor.receiveShadow = true;
  group.add(floor);

  return {
    group,
    // fit = jari-jari yang dibingkai kamera: model, atau alas maket bila tapaknya jauh lebih lebar dari tingginya
    bounds: { box, size, center, radius, maxSpan, footprint: Math.hypot(size.x, size.z) / 2, fit: Math.max(radius, (Math.hypot(w, d) / 2) * 0.85) },
    tris,
    quality,
    scale: Math.min(3, Math.max(0.2, Math.max(maxSpan, 20) / REF_H)),
    dispose() {
      group.traverse((n) => n.geometry?.dispose?.());
      Object.values(mats).forEach((m) => m.dispose());
      base.material.dispose();
      floor.material.dispose();
    },
  };
}
