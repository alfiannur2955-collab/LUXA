// Awan tipis di atas kota + bayangannya di tanah.
// Saat kamera jauh, awan tampil tipis; makin dekat ke tower, awan tersibak keluar lalu hilang.
// Garis pandang kamera → tower selalu bersih dari awan, dan tapak tower bersih dari bayangan awan.
import * as THREE from 'three';

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

// Tekstur awan: kumpulan gumpalan lembut (gradien radial) dalam kanvas, hanya kanal alfa yang dipakai.
function cloudTexture(r) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const n = 16 + Math.floor(r() * 10);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 70;
    const cx = 128 + Math.cos(a) * d * 1.3, cy = 128 + Math.sin(a) * d * 0.8;
    const rad = 26 + r() * 46;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, rad, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const FRAG_CLOUD = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor, uCam, uTarget;
  uniform float uR0, uR1, uOpacity;
  varying vec2 vUv;
  varying vec3 vW;
  float segDist(vec3 p, vec3 a, vec3 b) {
    vec3 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + ab * t));
  }
  void main() {
    float a = texture2D(uMap, vUv).a;
    float m = smoothstep(uR0, uR1, segDist(vW, uCam, uTarget)); // lubang di garis pandang ke tower
    gl_FragColor = vec4(uColor, a * m * uOpacity);
    #include <colorspace_fragment>
  }`;
const FRAG_SHADOW = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity, uClear;
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    float a = texture2D(uMap, vUv).a;
    float m = smoothstep(uClear, uClear * 1.83, length(vW.xz)); // tapak tower bersih
    gl_FragColor = vec4(0.0, 0.0, 0.0, a * m * uOpacity);
  }`;

// scale: ukuran dunia relatif terhadap tower Belajar (1 = tower 93,5 m); target = titik tengah model (garis pandang dibuka).
export function createClouds(stage, { dark = false, count = 26, seed = 2020, scale = 1, target = [0, 45, 0], shadow = 1, opacity = 1, hole = null } = {}) {
  const S = scale;
  const r = rng(seed);
  const textures = [0, 1, 2].map(() => cloudTexture(r));
  const shared = {
    uColor: { value: new THREE.Color(dark ? '#A3ABB8' : '#F7FAFF') },
    uCam: { value: new THREE.Vector3() },
    uTarget: { value: new THREE.Vector3(...target) },
    uR0: { value: hole ? hole[0] : 40 * S },
    uR1: { value: hole ? hole[1] : 115 * S },
    uOpacity: { value: 0 },
  };
  const shadowOpacity = { value: 0 };
  const clear = { value: 48 * S };
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const group = new THREE.Group();
  stage.scene.add(group);
  const items = [];
  for (let i = 0; i < count; i++) {
    const tex = textures[i % 3];
    const cloud = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { ...shared, uMap: { value: tex } },
      vertexShader: VERT, fragmentShader: FRAG_CLOUD, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    const shadow = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uOpacity: shadowOpacity, uClear: clear },
      vertexShader: VERT, fragmentShader: FRAG_SHADOW, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    cloud.renderOrder = 7;
    shadow.renderOrder = 1;
    const ang = (i / count) * Math.PI * 2 + r() * 0.6;
    // Kamera memakai lensa tele (bidang pandang sempit), jadi awan ditaruh rendah (±120–170 m, di atas
    // gedung tertinggi) dan tidak jauh dari tower supaya masuk bingkai.
    // Delapan awan pertama dekat tower (cincin dalam, lebih rendah) supaya terasa bergerak saat kamera mendekat.
    const inner = i < 8;
    const rad = inner ? 60 + r() * 70 : 110 + Math.sqrt(r()) * 240;
    const size = inner ? 70 + r() * 50 : 100 + r() * 90;
    const it = { cloud, shadow, ang, rad: rad * S, y: (inner ? 105 + r() * 35 : 120 + r() * 50) * S, rot: r() * Math.PI * 2, sx: size * S * (1.2 + r() * 0.6), sz: size * S };
    cloud.scale.set(it.sx, 1, it.sz);
    shadow.scale.set(it.sx, 1, it.sz);
    cloud.rotation.y = shadow.rotation.y = it.rot;
    group.add(cloud, shadow);
    items.push(it);
  }
  const base = (dark ? 0.3 : 0.9) * opacity;
  const sunDir = new THREE.Vector3();
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  return {
    group,
    /** dist = jarak kamera ke titik bidiknya (m); still = tanpa gerak (gerak dikurangi). */
    tick(camera, timeSec, dist, still) {
      // 0 = kamera jauh (awan penuh), 1 = dekat (awan tersibak habis)
      const open = clamp01((900 - dist / S) / 700);
      const vis = 1 - THREE.MathUtils.smoothstep(open, 0.62, 0.97); // tetap terlihat sampai kamera cukup dekat
      group.visible = vis > 0.01;
      if (!group.visible) return;
      shared.uOpacity.value = base * vis;
      shadowOpacity.value = (dark ? 0.26 : 0.3) * vis * shadow;
      shared.uCam.value.copy(camera.position);
      sunDir.copy(stage.sun.position).sub(stage.sun.target.position).normalize();
      const push = 1 + 1.2 * open * open; // awan bergeser menjauh dari tower saat kamera mendekat
      const spin = still ? 0 : timeSec * 0.0035; // hanyut pelan mengitari kota
      for (const it of items) {
        const a = it.ang + spin;
        const x = Math.cos(a) * it.rad * push, z = Math.sin(a) * it.rad * push;
        it.cloud.position.set(x, it.y, z);
        // bayangan: proyeksi awan ke tanah searah sinar matahari
        const gy = 0.6 * Math.min(1, S);
        const k = (it.y - gy) / Math.max(0.15, sunDir.y);
        it.shadow.position.set(x - sunDir.x * k, gy, z - sunDir.z * k);
      }
    },
    dispose() {
      textures.forEach((t) => t.dispose());
      geo.dispose();
      stage.scene.remove(group);
    },
  };
}
