// Kawanan burung siluet yang terbang berputar di atas kota, berulang terus.
// Tiap burung = dua sayap segitiga yang mengepak; kawanan terbang dalam formasi acak mengikuti lintasan elips.
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

// Tiap kawanan punya ketinggian sendiri (selisih ≥ 25 m) sehingga lintasan yang bersilangan tidak bertabrakan.
const FLOCKS = [
  // pusat lintasan, jari-jari (x, z), ketinggian, kecepatan sudut (rad/s), jumlah burung, fase awal
  { c: [-40, 0, 30], r: [210, 150], y: 68, w: 0.07, n: 6, p: 0 },
  { c: [60, 0, -50], r: [170, 230], y: 98, w: -0.055, n: 5, p: 2.1 },
  { c: [0, 0, 200], r: [260, 120], y: 128, w: 0.05, n: 7, p: 4.2 },
  { c: [-120, 0, -100], r: [150, 190], y: 158, w: -0.065, n: 4, p: 1.2 },
];
const MIN_GAP = 15; // jarak minimum antarburung dalam satu kawanan (m), lebih dari rentang sayap terbesar

export function createBirds(stage, { dark = false } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color: dark ? '#DCE0E6' : '#2E2A25', side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const gl = wingGeometry(-1), gr = wingGeometry(1);
  const group = new THREE.Group();
  stage.scene.add(group);
  const birds = [];
  const r = (() => { let a = 77; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  FLOCKS.forEach((f, fi) => {
    // Formasi acak: posisi tiap burung relatif terhadap pemimpin diambil acak, ditolak bila terlalu dekat dengan burung lain.
    const offs = [];
    for (let i = 0; i < f.n; i++) {
      let o = null;
      for (let tries = 0; tries < 200 && !o; tries++) {
        const c = { back: i === 0 ? 0 : 6 + r() * 45, side: i === 0 ? 0 : (r() - 0.5) * 50, up: i === 0 ? 0 : (r() - 0.5) * 12 };
        if (offs.every((q) => Math.hypot(q.back - c.back, q.side - c.side, q.up - c.up) >= MIN_GAP)) o = c;
      }
      offs.push(o || { back: i * MIN_GAP, side: 0, up: 0 });
    }
    offs.forEach((o) => {
      const body = new THREE.Group();
      const L = new THREE.Mesh(gl, mat), R = new THREE.Mesh(gr, mat);
      L.renderOrder = R.renderOrder = 8;
      body.add(L, R);
      body.scale.setScalar(2 + r() * 0.6); // rentang sayap ±9–12 m supaya siluetnya terbaca dari kamera jauh
      group.add(body);
      // goyangan kecil per burung (≤ 2 m) supaya formasi terasa hidup tanpa saling mendekat
      birds.push({ body, L, R, f, fi, ...o, wob: r() * Math.PI * 2, flap: r() * Math.PI * 2, fs: 7 + r() * 3 });
    });
  });
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const pathAt = (f, a, out) => out.set(f.c[0] + Math.cos(a) * f.r[0], f.y + Math.sin(a * 2) * 4, f.c[2] + Math.sin(a) * f.r[1]);
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
        const wob = still ? 0 : Math.sin(t * 0.7 + b.wob);
        b.body.position.copy(pos).addScaledVector(fwd, -b.back).addScaledVector(right, b.side + wob * 1.5);
        b.body.position.y += b.up + wob * 1.2;
        b.body.lookAt(b.body.position.clone().add(fwd));
        const flap = still ? 0.2 : Math.sin(t * b.fs + b.flap) * 0.55 + 0.1;
        b.L.rotation.z = -flap;
        b.R.rotation.z = flap;
      }
    },
  };
}
