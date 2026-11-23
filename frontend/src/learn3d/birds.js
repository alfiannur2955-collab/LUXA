// Kawanan burung siluet yang terbang berputar di atas kota, berulang terus.
// Tiap burung = dua sayap segitiga yang mengepak; kawanan terbang membentuk huruf V mengikuti lintasan elips.
// Burung memudar saat kamera close-up supaya tidak menutupi bagian yang sedang dibahas.
import * as THREE from 'three';

function wingGeometry(side) {
  // Sayap kiri (side = -1) atau kanan (+1); poros kepak di garis badan (x = 0), kepala ke arah +z.
  const g = new THREE.BufferGeometry();
  const s = side;
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.55, 0, 0, -0.45, s * 1.15, 0.05, 0.05,
    s * 1.15, 0.05, 0.05, 0, 0, -0.45, s * 2.3, -0.05, -0.35,
  ], 3));
  g.computeVertexNormals();
  return g;
}

const FLOCKS = [
  // pusat lintasan, jari-jari (x, z), ketinggian, kecepatan sudut (rad/s), jumlah burung, fase awal
  { c: [-40, 0, 30], r: [210, 150], y: 95, w: 0.07, n: 7, p: 0 },
  { c: [60, 0, -50], r: [170, 230], y: 120, w: -0.055, n: 5, p: 2.1 },
  { c: [0, 0, 200], r: [260, 120], y: 80, w: 0.05, n: 6, p: 4.2 },
];

export function createBirds(stage, { dark = false } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color: dark ? '#111215' : '#2E2A25', side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const gl = wingGeometry(-1), gr = wingGeometry(1);
  const group = new THREE.Group();
  stage.scene.add(group);
  const birds = [];
  const r = (() => { let a = 77; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  FLOCKS.forEach((f, fi) => {
    for (let i = 0; i < f.n; i++) {
      const body = new THREE.Group();
      const L = new THREE.Mesh(gl, mat), R = new THREE.Mesh(gr, mat);
      L.renderOrder = R.renderOrder = 8;
      body.add(L, R);
      const scale = 2 + r() * 0.6; // rentang sayap ±9–12 m supaya siluetnya terbaca dari kamera jauh
      body.scale.setScalar(scale);
      group.add(body);
      // formasi V: burung ke-i mundur dan menyamping dari pemimpin
      const rank = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
      birds.push({ body, L, R, f, fi, back: rank * 12 + r() * 3, side: side * rank * 9, up: (r() - 0.5) * 3, flap: r() * Math.PI * 2, fs: 7 + r() * 3 });
    }
  });
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const pathAt = (f, a, out) => out.set(f.c[0] + Math.cos(a) * f.r[0], f.y + Math.sin(a * 2) * 6, f.c[2] + Math.sin(a) * f.r[1]);
  return {
    group,
    /** dist = jarak kamera ke titik bidik (m); still = gerak dikurangi. */
    tick(timeSec, dist, still) {
      const vis = THREE.MathUtils.smoothstep(dist, 140, 320); // hilang saat close-up
      mat.opacity = 0.85 * vis;
      group.visible = vis > 0.01;
      if (!group.visible) return;
      for (const b of birds) {
        const f = b.f;
        const t = still ? 0 : timeSec;
        const a = f.p + t * f.w;
        pathAt(f, a, pos);
        pathAt(f, a + 0.01 * Math.sign(f.w), ahead);
        fwd.copy(ahead).sub(pos).normalize();
        right.set(fwd.z, 0, -fwd.x).normalize();
        // posisi dalam formasi relatif terhadap pemimpin
        b.body.position.copy(pos).addScaledVector(fwd, -b.back).addScaledVector(right, b.side).add(new THREE.Vector3(0, b.up, 0));
        b.body.lookAt(b.body.position.clone().add(fwd));
        const flap = still ? 0.2 : Math.sin(t * b.fs + b.flap) * 0.55 + 0.1;
        b.L.rotation.z = -flap;
        b.R.rotation.z = flap;
      }
    },
  };
}
