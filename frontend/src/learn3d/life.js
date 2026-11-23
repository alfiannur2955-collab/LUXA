// Kehidupan kota: lalu lintas teratur (lajur kiri, jaga jarak, berhenti di lampu merah), lampu lalu lintas,
// bus, pejalan kaki (lebih ramai di ruang publik), dan air mancur yang memancar.
// Semuanya instanced (satu panggilan gambar per jenis benda) supaya ringan.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

const ROADS = [-3, -2, -1, 0, 1, 2]; // jalan di antara blok k dan k+1 (dekat tower)
const LANE = 2.75; // jarak sumbu lajur dari garis tengah jalan
const SIGNAL = { cycle: 16, xGreen: 6.5, xYellow: 8, zGreen: 14.5 }; // detik dalam satu siklus
// Jarak garis henti dari sumbu jalan yang dipotong: setengah lebar badan jalan + trotoar + sedikit ruang zebra cross.
const STOP_BACK = 5.5 + 2.5 + 1.5;
const COLORS = { green: new THREE.Color('#37C46B'), yellow: new THREE.Color('#F2C230'), red: new THREE.Color('#E5484D') };

function carGeometry(len, h) {
  const body = new THREE.BoxGeometry(len, h * 0.55, 1.8);
  body.translate(0, 0.25 + h * 0.275, 0);
  const cabin = new THREE.BoxGeometry(len * 0.5, h * 0.4, 1.6);
  cabin.translate(-len * 0.06, 0.25 + h * 0.55 + h * 0.2, 0);
  return mergeGeometries([body, cabin]);
}
function lampGeometry(len, front) {
  const g = new THREE.BoxGeometry(0.12, 0.28, 1.5);
  g.translate((front ? 1 : -1) * (len / 2 + 0.04), 0.65, 0);
  return g;
}

export function createLife(stage, { dark = false, city } = {}) {
  const info = city.userData.life;
  const PITCH = info.pitch, half = info.half;
  const r = rng(7031);
  const group = new THREE.Group();
  stage.scene.add(group);
  const roadPos = (k) => k * PITCH + PITCH / 2;
  const L = 4.5 * PITCH; // panjang lajur dari pusat; mobil yang lewat ujung muncul lagi di ujung lain

  // ---------- Lampu lalu lintas di tiap persimpangan dekat tower ----------
  const inter = [];
  for (const kx of ROADS) for (const kz of ROADS) inter.push({ x: roadPos(kx), z: roadPos(kz), off: (((kx + kz) % 4) + 4) % 4 * 2 });
  const stateOf = (it, t) => {
    const u = (t + it.off) % SIGNAL.cycle;
    if (u < SIGNAL.xGreen) return { x: 'green', z: 'red' };
    if (u < SIGNAL.xYellow) return { x: 'yellow', z: 'red' };
    if (u < SIGNAL.zGreen) return { x: 'red', z: 'green' };
    return { x: 'red', z: 'yellow' };
  };
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 5, 6);
  poleGeo.translate(0, 2.5 + 0.25, 0);
  const headGeo = new THREE.BoxGeometry(0.55, 1.3, 0.55);
  headGeo.translate(0, 5.1 + 0.25, 0);
  const poles = new THREE.InstancedMesh(mergeGeometries([poleGeo, headGeo]), new THREE.MeshStandardMaterial({ color: dark ? '#55565C' : '#6F6658', roughness: 0.8 }), inter.length * 4);
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), inter.length * 4);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const C = 7; // tiang di sudut trotoar
  const lampAxis = [];
  inter.forEach((it, n) => {
    [[-C, -C, 'x'], [C, C, 'x'], [-C, C, 'z'], [C, -C, 'z']].forEach(([dx, dz, ax], k) => {
      m4.makeTranslation(it.x + dx, 0, it.z + dz);
      poles.setMatrixAt(n * 4 + k, m4);
      m4.makeTranslation(it.x + dx, 5.1 + 0.25, it.z + dz);
      lamps.setMatrixAt(n * 4 + k, m4);
      lamps.setColorAt(n * 4 + k, COLORS.red);
      lampAxis.push(ax);
    });
  });
  poles.castShadow = true;
  group.add(poles, lamps);

  // ---------- Kendaraan ----------
  // Tiap lajur: sumbu jalan ('x' = jalan memanjang timur-barat, 'z' = utara-selatan), arah ±1, posisi garis lajur.
  // Lajur kiri (Indonesia): ke +x di sisi −z, ke −x di sisi +z; ke +z di sisi +x, ke −z di sisi −x.
  const lanes = [];
  for (const k of ROADS) {
    const c = roadPos(k);
    lanes.push({ axis: 'x', dir: 1, at: c - LANE, c }, { axis: 'x', dir: -1, at: c + LANE, c }, { axis: 'z', dir: 1, at: c + LANE, c }, { axis: 'z', dir: -1, at: c - LANE, c });
  }
  const PALETTE = dark
    ? ['#C9CCD2', '#A9ADB4', '#8E9299', '#D7DADF', '#B8AE9C', '#7E95A3', '#A88A7A']
    : ['#FFFFFF', '#F4F2EE', '#E9E6E0', '#D9D5CD', '#C9BFAE', '#A9B9C2', '#C7A898'];
  const vehicles = [];
  lanes.forEach((ln, li) => {
    // titik henti: sebelum zebra cross tiap persimpangan, menurut arah lajur
    ln.stops = ROADS.map((k) => roadPos(k)).map((pc) => ({
      u: pc * ln.dir - STOP_BACK,
      it: inter.find((x) => (ln.axis === 'x' ? x.x === pc && x.z === ln.c : x.z === pc && x.x === ln.c)),
    })).sort((a, b) => a.u - b.u);
    const n = 4 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const bus = li % 7 === 3 && i === 0;
      vehicles.push({ ln, u: -L + ((i + r() * 0.6) / n) * 2 * L, v: 8, v0: bus ? 7.5 : 9 + r() * 3, len: bus ? 11 : 4.2, bus, color: new THREE.Color(PALETTE[Math.floor(r() * PALETTE.length)]) });
    }
  });
  const cars = vehicles.filter((v) => !v.bus), buses = vehicles.filter((v) => v.bus);
  const mk = (geo, mat, n, shadow) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.castShadow = shadow; m.count = n; group.add(m); return m; };
  const carMesh = mk(carGeometry(4.2, 1.6), new THREE.MeshStandardMaterial({ roughness: 0.7 }), cars.length, true);
  const busMesh = mk(carGeometry(11, 3.1), new THREE.MeshStandardMaterial({ color: dark ? '#C9A64B' : '#E8C46A', roughness: 0.7 }), buses.length, true);
  cars.forEach((v, i) => carMesh.setColorAt(i, v.color));
  // Lampu kendaraan hanya di mode gelap: depan putih, belakang merah.
  const headMat = new THREE.MeshBasicMaterial({ color: '#FFF4D6', toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#FF4D4D', toneMapped: false });
  const lights = dark ? [
    mk(lampGeometry(4.2, true), headMat, cars.length, false), mk(lampGeometry(4.2, false), tailMat, cars.length, false),
    mk(lampGeometry(11, true), headMat, buses.length, false), mk(lampGeometry(11, false), tailMat, buses.length, false),
  ] : [];

  // Urutan per lajur untuk menjaga jarak.
  const byLane = new Map();
  for (const v of vehicles) { if (!byLane.has(v.ln)) byLane.set(v.ln, []); byLane.get(v.ln).push(v); }

  function placeVehicle(v, mesh, idx, lightPair) {
    const s = v.u * v.ln.dir; // koordinat dunia sepanjang sumbu jalan
    if (v.ln.axis === 'x') { p.set(s, 0, v.ln.at); q.setFromAxisAngle(up, v.ln.dir > 0 ? 0 : Math.PI); }
    else { p.set(v.ln.at, 0, s); q.setFromAxisAngle(up, v.ln.dir > 0 ? -Math.PI / 2 : Math.PI / 2); }
    m4.compose(p, q, sc);
    mesh.setMatrixAt(idx, m4);
    if (lightPair) { lightPair[0].setMatrixAt(idx, m4); lightPair[1].setMatrixAt(idx, m4); }
  }

  // ---------- Pejalan kaki ----------
  const walkers = [];
  const sideOff = half + info.sidewalk * 0.8; // di trotoar (bukan badan jalan), sedikit di luar barisan pohon
  // a) mengitari blok di trotoar (blok dekat tower)
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) walkers.push({ kind: 'loop', cx: i * PITCH, cz: j * PITCH, o: sideOff + (r() - 0.5) * 0.8, t: r(), sp: (1.1 + r() * 0.5) * (r() < 0.5 ? 1 : -1) });
  }
  // b) di ruang publik: makin ramai, makin banyak yang berjalan, diam, dan duduk
  for (const sp of info.spots) {
    const busy = { radial: 26, organic: 18, square: 22, plaza: 20 }[sp.kind] || 12;
    for (let k = 0; k < busy; k++) {
      const role = r();
      if (sp.kind === 'organic' && role < 0.6) {
        const path = sp.paths[Math.floor(r() * sp.paths.length)];
        walkers.push({ kind: 'path', path, t: r(), sp: (0.012 + r() * 0.01) * (r() < 0.5 ? 1 : -1), side: (r() - 0.5) * 1.4 });
      } else if ((sp.kind === 'radial' || sp.kind === 'plaza') && role < 0.45) {
        walkers.push({ kind: 'circle', cx: sp.cx, cz: sp.cz, rad: (sp.kind === 'radial' ? 7.5 : 6.5) + r() * 2, t: r() * Math.PI * 2, sp: (0.1 + r() * 0.08) * (r() < 0.5 ? 1 : -1) });
      } else if (sp.kind === 'radial' && role < 0.75) {
        walkers.push({ kind: 'spoke', cx: sp.cx, cz: sp.cz, a: (Math.floor(r() * 8) / 8) * Math.PI * 2 + (r() - 0.5) * 0.08, t: r(), sp: 0.05 + r() * 0.04 });
      } else if (sp.kind === 'square' && role < 0.6) {
        walkers.push({ kind: 'wander', cx: sp.cx, cz: sp.cz, a: [sp.cx + (r() - 0.5) * 44, sp.cz + (r() - 0.5) * 44], b: [sp.cx + (r() - 0.5) * 44, sp.cz + (r() - 0.5) * 44], t: r(), sp: 0.04 + r() * 0.03, pause: r() * 4 });
      } else {
        // diam atau duduk di sekitar air mancur / bangku
        const a = r() * Math.PI * 2, d = sp.kind === 'organic' ? 14 + r() * 3 : 5.6 + r() * 4;
        const ox = sp.kind === 'organic' ? sp.pond[0] : sp.cx, oz = sp.kind === 'organic' ? sp.pond[1] : sp.cz;
        walkers.push({ kind: 'idle', x: ox + Math.cos(a) * d * (sp.kind === 'organic' ? 1.1 : 1), z: oz + Math.sin(a) * d * (sp.kind === 'organic' ? 0.9 : 1), sit: r() < 0.45 });
      }
    }
  }
  const personGeo = new THREE.CylinderGeometry(0.28, 0.3, 1.6, 6);
  personGeo.translate(0, 0.25 + 0.8, 0);
  const people = new THREE.InstancedMesh(personGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), walkers.length);
  const PPL = dark ? ['#D7DADF', '#BFC4CB', '#E7D3B8', '#A9C4CC'] : ['#5E564B', '#7A6E60', '#4F5961', '#8A5E48', '#3E4A52'];
  walkers.forEach((w, i) => people.setColorAt(i, new THREE.Color(PPL[i % PPL.length])));
  group.add(people);
  const loopPos = (w) => {
    // keliling bujur sangkar sisi 2·o, t ∈ [0,1)
    const o = w.o, per = 8 * o, d = ((w.t % 1) + 1) % 1 * per;
    if (d < 2 * o) return [w.cx - o + d, w.cz - o];
    if (d < 4 * o) return [w.cx + o, w.cz - o + (d - 2 * o)];
    if (d < 6 * o) return [w.cx + o - (d - 4 * o), w.cz + o];
    return [w.cx - o, w.cz + o - (d - 6 * o)];
  };

  // ---------- Air mancur ----------
  const DROPS = 70;
  const fountains = info.fountains;
  const dropPos = new Float32Array(fountains.length * DROPS * 3);
  const dropSeed = Array.from({ length: fountains.length * DROPS }, () => [r() * Math.PI * 2, 0.4 + r() * 0.6, r()]);
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ color: dark ? '#A9D2DA' : '#FFFFFF', size: 0.45, transparent: true, opacity: dark ? 0.75 : 0.95, depthWrite: false }));
  drops.frustumCulled = false;
  group.add(drops);

  const tmpColor = new THREE.Color();
  let lastSig = -1;
  return {
    group,
    tick(timeSec, dt, dist, still) {
      // Kehidupan di jalan disembunyikan saat close-up dekat tower (tidak terlihat, hemat hitungan).
      group.visible = dist > 60;
      if (!group.visible) return;
      const t = still ? 0 : timeSec;
      const step = still ? 0 : Math.min(dt, 0.05);

      // Lampu lalu lintas (diperbarui saat fasenya berubah)
      const sig = Math.floor(t * 4);
      if (sig !== lastSig) {
        lastSig = sig;
        inter.forEach((it, n) => {
          const st = stateOf(it, t);
          for (let k = 0; k < 4; k++) lamps.setColorAt(n * 4 + k, COLORS[st[lampAxis[n * 4 + k]]]);
        });
        lamps.instanceColor.needsUpdate = true;
      }

      // Kendaraan: tiap lajur diurutkan, jaga jarak dengan kendaraan di depan, berhenti di lampu merah/kuning.
      for (const [ln, list] of byLane) {
        list.sort((a, b) => a.u - b.u);
        for (let i = 0; i < list.length; i++) {
          const v = list[i];
          const lead = list[(i + 1) % list.length];
          let gap = (lead.u + (i + 1 === list.length ? 2 * L : 0)) - v.u - (lead.len + v.len) / 2 - 3.5;
          const front = v.u + v.len / 2;
          for (const s of ln.stops) {
            if (s.u < front - 0.5) continue; // sudah lewat garis henti
            if (s.it) {
              const st = stateOf(s.it, t)[ln.axis];
              const toStop = s.u - front;
              if (st === 'red' || (st === 'yellow' && toStop > 7)) gap = Math.min(gap, toStop);
            }
            break; // hanya garis henti terdekat di depan
          }
          const target = Math.max(0, Math.min(v.v0, (gap - 0.5) * 0.9));
          v.v += (target - v.v) * Math.min(1, step * 3);
          if (gap < 0.3) v.v = 0;
          v.u += v.v * step;
          if (v.u > L) v.u -= 2 * L;
        }
      }
      cars.forEach((v, i) => placeVehicle(v, carMesh, i, dark ? [lights[0], lights[1]] : null));
      buses.forEach((v, i) => placeVehicle(v, busMesh, i, dark ? [lights[2], lights[3]] : null));
      carMesh.instanceMatrix.needsUpdate = busMesh.instanceMatrix.needsUpdate = true;
      for (const l of lights) l.instanceMatrix.needsUpdate = true;

      // Pejalan kaki
      walkers.forEach((w, i) => {
        let x, z, h = 1;
        if (w.kind === 'loop') { w.t += (w.sp * step) / (8 * w.o); [x, z] = loopPos(w); }
        else if (w.kind === 'path') {
          w.t += w.sp * step; if (w.t > 1 || w.t < 0) { w.sp = -w.sp; w.t = Math.min(1, Math.max(0, w.t)); }
          const f = w.t * (w.path.length - 1), k = Math.min(w.path.length - 2, Math.floor(f)), a = w.path[k], b = w.path[k + 1], u = f - k;
          x = a[0] + (b[0] - a[0]) * u; z = a[1] + (b[1] - a[1]) * u;
          const dx = b[0] - a[0], dz = b[1] - a[1], ll = Math.hypot(dx, dz) || 1;
          x += (-dz / ll) * w.side; z += (dx / ll) * w.side;
        } else if (w.kind === 'circle') { w.t += w.sp * step; x = w.cx + Math.cos(w.t) * w.rad; z = w.cz + Math.sin(w.t) * w.rad; }
        else if (w.kind === 'spoke') {
          w.t += w.sp * step * 0.4; const u = 0.5 - 0.5 * Math.cos(w.t * Math.PI * 2); const rad = 11 + u * 15;
          x = w.cx + Math.cos(w.a) * rad; z = w.cz + Math.sin(w.a) * rad;
        } else if (w.kind === 'wander') {
          if (w.pause > 0) w.pause -= step; else { w.t += w.sp * step; if (w.t >= 1) { w.a = w.b; w.b = [w.cx + (r() - 0.5) * 44, w.cz + (r() - 0.5) * 44]; w.t = 0; w.pause = 1 + r() * 4; } }
          x = w.a[0] + (w.b[0] - w.a[0]) * w.t; z = w.a[1] + (w.b[1] - w.a[1]) * w.t;
        } else { x = w.x; z = w.z; h = w.sit ? 0.6 : 1; }
        m4.makeScale(1, h, 1).setPosition(x, 0, z);
        people.setMatrixAt(i, m4);
      });
      people.instanceMatrix.needsUpdate = true;

      // Air mancur: tetes air melompat dalam lengkung parabola dan jatuh kembali ke kolam
      const T = 1.5;
      fountains.forEach((f, fi) => {
        for (let k = 0; k < DROPS; k++) {
          const [ang, spd, ph] = dropSeed[fi * DROPS + k];
          const u = (((t / T) + ph) % 1);
          const rad = u * f.r * spd;
          const y = f.y + 3.2 * spd * 4 * u * (1 - u);
          const o = (fi * DROPS + k) * 3;
          dropPos[o] = f.x + Math.cos(ang) * rad;
          dropPos[o + 1] = y;
          dropPos[o + 2] = f.z + Math.sin(ang) * rad;
        }
      });
      dropGeo.attributes.position.needsUpdate = true;
    },
  };
}

