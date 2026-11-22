/**
 * Viewer color & material helpers reading live CSS tokens from theme.css.
 * Zero hardcoded hex values — switches cleanly between light and dark themes.
 * Mode tampilan: Klasifikasi, Orientasi, Heatmap, Matahari (sepanjang tahun / waktu aktif),
 * ditambah alat periksa Perlu dicek dan Transparan yang bisa digabung dengan mode apa pun.
 */

import * as THREE from 'three';

export const VIEWER_MODES = [
  { id: 'classification', label: 'Klasifikasi', icon: 'grid', hint: 'Warna menurut jenis bidang: kaca, dinding, peneduh' },
  { id: 'orientation', label: 'Orientasi', icon: 'compass', hint: 'Warna menurut arah hadap fasad' },
  { id: 'heatmap', label: 'Heatmap', icon: 'thermometer', needsAnalysis: true, hint: 'Nilai OTTV per arah atau per panel (hasil SNI)' },
  { id: 'sun', label: 'Matahari', icon: 'sun', needsAnalysis: true, hint: 'Paparan matahari sepanjang tahun, atau sinar langsung pada tanggal dan jam aktif (tampilan saja)' },
];

/** Alat periksa: bisa dinyalakan bersama mode apa pun. */
export const VIEWER_OVERLAYS = [
  { id: 'check', key: 'overlayCheck', label: 'Perlu dicek', icon: 'warn', hint: 'Tandai bagian model yang perlu dicek' },
  { id: 'xray', key: 'overlayXray', label: 'Transparan', icon: 'xray', hint: 'Model tembus pandang; bidang yang disaring tampil putus-putus' },
];

/**
 * Mode tampilan yang efektif dari state (termasuk nilai lama yang tersimpan di proyek/view).
 * Mengembalikan { mode, renderMode, xray, check, sunView }.
 * renderMode = nama internal renderer ('sun' digambar sebagai 'exposure').
 */
export function resolveViewerMode(state) {
  const hasAnalysis = Boolean(state.analysisData?.panels?.length);
  let mode = state.viewerMode || (hasAnalysis ? 'heatmap' : 'classification');
  let xray = Boolean(state.overlayXray);
  let check = Boolean(state.overlayCheck);
  if (mode === 'exposure') mode = 'sun';
  if (mode === 'xray') { mode = 'classification'; xray = true; }
  if (mode === 'anomalies') { mode = 'classification'; check = true; }
  if ((mode === 'heatmap' || mode === 'sun') && !hasAnalysis) mode = 'classification';
  const sunView = state.sunView === 'now' ? 'now' : 'year';
  return { mode, renderMode: mode === 'sun' ? 'exposure' : mode, xray, check, sunView };
}

export const ORIENTATION_CODES = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'];

export const ORIENTATION_NAMES_ID = {
  U: 'Utara',
  TL: 'Timur Laut',
  T: 'Timur',
  TG: 'Tenggara',
  S: 'Selatan',
  BD: 'Barat Daya',
  B: 'Barat',
  BL: 'Barat Laut',
};

export function readThemeTokens() {
  const root = document.getElementById('app') || document.documentElement;
  const cs = window.getComputedStyle(root);
  const get = (name) => cs.getPropertyValue(name).trim();
  return {
    paper: get('--paper'),
    surface: get('--surface'),
    sunken: get('--surface-sunken'),
    ink: get('--ink'),
    muted: get('--ink-muted'),
    line: get('--line'),
    lineStrong: get('--line-strong'),
    sun: get('--sun'),
    ok: get('--ok'),
    warn: get('--warn'),
    fail: get('--fail'),
    glazing: get('--data-glazing'),
    wall: get('--data-wall'),
    shading: get('--data-shading'),
    unknown: get('--data-unknown'),
    frame: get('--data-frame'),
    roof: get('--data-roof'),
    heat0: get('--heat-0'),
    heat1: get('--heat-1'),
    heat2: get('--heat-2'),
    heat3: get('--heat-3'),
  };
}

/**
 * Continuous OKLab OTTV Heatmap scale (`docs/FASE4_UI_SPEC.md` D7 & §4.2):
 * Stops: 0 = heat-0, 25 = heat-1, 35 = heat-2, >= 50 (clamped at 60) = heat-3.
 * Interpolated linearly in OKLab space for perceptually uniform lightness & color-blind legibility.
 */
function _linearRgbToOklab(r, g, b) {
  const l = Math.cbrt(Math.max(0, 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b));
  const m = Math.cbrt(Math.max(0, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b));
  const s = Math.cbrt(Math.max(0, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b));
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function _oklabToLinearRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    Math.max(0, Math.min(1, +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    Math.max(0, Math.min(1, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    Math.max(0, Math.min(1, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
  ];
}

function _linearToSrgbChannel(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const HEAT_STOPS = [
  { val: 0, key: 'heat0' },
  { val: 25, key: 'heat1' },
  { val: 35, key: 'heat2' },
  { val: 50, key: 'heat3' },
];

export function ottvToHeatTokenKey(ottvWm2) {
  const v = Number(ottvWm2);
  if (!Number.isFinite(v) || v < 25) return 'heat0';
  if (v < 32) return 'heat1';
  if (v <= 35) return 'heat2';
  return 'heat3';
}

export function ottvToThreeColor(ottvWm2, tokens) {
  const raw = Number(ottvWm2);
  const v = Number.isFinite(raw) ? Math.max(0, Math.min(60, raw)) : 0;

  let lo = HEAT_STOPS[0];
  let hi = HEAT_STOPS[HEAT_STOPS.length - 1];
  if (v >= 50) {
    return new THREE.Color(tokens.heat3 || tokens.heat0);
  }
  for (let i = 0; i < HEAT_STOPS.length - 1; i += 1) {
    if (v >= HEAT_STOPS[i].val && v <= HEAT_STOPS[i + 1].val) {
      lo = HEAT_STOPS[i];
      hi = HEAT_STOPS[i + 1];
      break;
    }
  }
  const t = hi.val > lo.val ? (v - lo.val) / (hi.val - lo.val) : 0;
  const cLo = new THREE.Color(tokens[lo.key] || tokens.heat0);
  const cHi = new THREE.Color(tokens[hi.key] || tokens.heat3);
  const lab0 = _linearRgbToOklab(cLo.r, cLo.g, cLo.b);
  const lab1 = _linearRgbToOklab(cHi.r, cHi.g, cHi.b);
  const [lr, lg, lb] = _oklabToLinearRgb(
    lab0[0] + (lab1[0] - lab0[0]) * t,
    lab0[1] + (lab1[1] - lab0[1]) * t,
    lab0[2] + (lab1[2] - lab0[2]) * t,
  );
  const out = new THREE.Color();
  out.setRGB(lr, lg, lb);
  return out;
}

function _threeColorToCssRgb(c) {
  const r = Math.round(Math.max(0, Math.min(1, _linearToSrgbChannel(c.r))) * 255);
  const g = Math.round(Math.max(0, Math.min(1, _linearToSrgbChannel(c.g))) * 255);
  const b = Math.round(Math.max(0, Math.min(1, _linearToSrgbChannel(c.b))) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function _oklabLerpThree(cLo, cHi, t) {
  const lab0 = _linearRgbToOklab(cLo.r, cLo.g, cLo.b);
  const lab1 = _linearRgbToOklab(cHi.r, cHi.g, cHi.b);
  const [lr, lg, lb] = _oklabToLinearRgb(
    lab0[0] + (lab1[0] - lab0[0]) * t,
    lab0[1] + (lab1[1] - lab0[1]) * t,
    lab0[2] + (lab1[2] - lab0[2]) * t,
  );
  const out = new THREE.Color();
  out.setRGB(lr, lg, lb);
  return out;
}

export function ottvToHeatCssVar(ottvWm2, tokensOverride = null) {
  const tokens = tokensOverride || readThemeTokens();
  if (!tokens?.heat0) {
    const key = ottvToHeatTokenKey(ottvWm2);
    const map = { heat0: 'var(--heat-0)', heat1: 'var(--heat-1)', heat2: 'var(--heat-2)', heat3: 'var(--heat-3)' };
    return map[key];
  }
  return _threeColorToCssRgb(ottvToThreeColor(ottvWm2, tokens));
}

/**
 * Fase 4d D3: Soft pastel palette for Heatmap "Halus" mode (`docs/fase4/ref-heatmap-halus.png`),
 * derived from the same 0-60 W/m² scale and live CSS tokens (zero hardcoded hex).
 */
function _getPastelHeatStops(tokens) {
  const cLift = new THREE.Color(tokens.surface || tokens.paper || tokens.heat0);
  const cShade = new THREE.Color(tokens.shading || tokens.ok || tokens.heat0);
  const cH0 = new THREE.Color(tokens.heat0);
  const cH1 = new THREE.Color(tokens.heat1);
  const cH2 = new THREE.Color(tokens.heat2);
  const cH3 = new THREE.Color(tokens.heat3);

  // Soft pastel stops: cool sage-cream (0) -> warm pastel amber (25) -> soft coral-peach (35) -> muted rose-terracotta (50+)
  const s0 = _oklabLerpThree(_oklabLerpThree(cH0, cShade, 0.34), cLift, 0.28);
  const s1 = _oklabLerpThree(cH1, cLift, 0.28);
  const s2 = _oklabLerpThree(cH2, cLift, 0.26);
  const s3 = _oklabLerpThree(cH3, cLift, 0.24);
  return [
    { val: 0, color: s0 },
    { val: 25, color: s1 },
    { val: 35, color: s2 },
    { val: 50, color: s3 },
  ];
}

export function ottvToPastelThreeColor(ottvWm2, tokens) {
  const raw = Number(ottvWm2);
  const v = Number.isFinite(raw) ? Math.max(0, Math.min(60, raw)) : 0;
  const stops = _getPastelHeatStops(tokens);
  if (v >= 50) return stops[stops.length - 1].color.clone();
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (v >= stops[i].val && v <= stops[i + 1].val) {
      const t = (v - stops[i].val) / (stops[i + 1].val - stops[i].val);
      return _oklabLerpThree(stops[i].color, stops[i + 1].color, t);
    }
  }
  return stops[0].color.clone();
}

export function ottvToPastelCss(ottvWm2, tokensOverride = null) {
  const tokens = tokensOverride || readThemeTokens();
  return _threeColorToCssRgb(ottvToPastelThreeColor(ottvWm2, tokens));
}

export function buildPastelGradientCss(tokensOverride = null) {
  const tokens = tokensOverride || readThemeTokens();
  const c0 = ottvToPastelCss(0, tokens);
  const c25 = ottvToPastelCss(25, tokens);
  const c35 = ottvToPastelCss(35, tokens);
  const c50 = ottvToPastelCss(50, tokens);
  return `linear-gradient(90deg, ${c0} 0%, ${c25} 41.7%, ${c35} 58.3%, ${c50} 83.3%, ${c50} 100%)`;
}

/**
 * Fase 4d D3: Cyclic 8-direction pastel azimuth palette derived strictly from theme CSS tokens
 * (zero hardcoded hex), matching `ref-heatmap-halus.png` soft pastel aesthetics.
 * Order: U (0°) -> TL (45°) -> T (90°) -> TG (135°) -> S (180°) -> BD (225°) -> B (270°) -> BL (315°).
 */
function _getCyclicPastelOrientationStops(tokens) {
  const cLift = new THREE.Color(tokens.surface || tokens.paper || tokens.wall);
  const cGlz = new THREE.Color(tokens.glazing);
  const cShade = new THREE.Color(tokens.shading);
  const cWall = new THREE.Color(tokens.wall);
  const cH0 = new THREE.Color(tokens.heat0);
  const cH1 = new THREE.Color(tokens.heat1);
  const cH2 = new THREE.Color(tokens.heat2);
  const cFail = new THREE.Color(tokens.fail || tokens.heat3);

  const pastel = (c) => _oklabLerpThree(c, cLift, 0.34);

  return [
    pastel(_oklabLerpThree(cGlz, cShade, 0.35)),  // 0°  U  (pastel cool cyan-blue)
    pastel(_oklabLerpThree(cShade, cH0, 0.32)),   // 45° TL (pastel sage-mint)
    pastel(_oklabLerpThree(cH0, cH1, 0.55)),      // 90° T  (pastel warm yellow-amber)
    pastel(_oklabLerpThree(cH1, cH2, 0.35)),      // 135° TG (pastel apricot)
    pastel(_oklabLerpThree(cH2, cFail, 0.28)),    // 180° S  (pastel soft rose-coral)
    pastel(_oklabLerpThree(cFail, cGlz, 0.38)),   // 225° BD (pastel dusty mauve-pink)
    pastel(_oklabLerpThree(cGlz, cFail, 0.32)),   // 270° B  (pastel lavender-periwinkle)
    pastel(_oklabLerpThree(cGlz, cWall, 0.22)),   // 315° BL (pastel sky slate)
  ];
}

export function azimuthToPastelThreeColor(azimuthDeg, tokens) {
  const stops = _getCyclicPastelOrientationStops(tokens);
  const az = (((Number(azimuthDeg) || 0) % 360) + 360) % 360;
  const f = az / 45;
  const idx0 = Math.floor(f) % 8;
  const idx1 = (idx0 + 1) % 8;
  const t = f - Math.floor(f);
  return _oklabLerpThree(stops[idx0], stops[idx1], t);
}

/**
 * Neutral color for roofs & horizontal surfaces in Orientasi mode (D3).
 */
export function horizontalNeutralColor(tokens) {
  const cRoof = new THREE.Color(tokens.roof || tokens.wall);
  const cLift = new THREE.Color(tokens.surface || tokens.paper || tokens.wall);
  return _oklabLerpThree(cRoof, cLift, 0.30);
}

export function orientationToThreeColor(code, tokens) {
  const idx = ORIENTATION_CODES.indexOf(code);
  if (idx === -1) return horizontalNeutralColor(tokens);
  return azimuthToPastelThreeColor(idx * 45, tokens);
}

export function orientationToCssColor(code, tokens) {
  const c = orientationToThreeColor(code, tokens);
  return _threeColorToCssRgb(c);
}

/**
 * Builds the compact SVG compass color ring for Orientasi legend (D3: "Warna menurut arah hadap").
 */
export function buildOrientationRingLegendSvg(tokensOverride = null) {
  const tokens = tokensOverride || readThemeTokens();
  const r = 13;
  const cx = 20;
  const cy = 20;
  const segs = [];
  const steps = 16;
  for (let i = 0; i < steps; i += 1) {
    const a0 = (i / steps) * 360;
    const a1 = ((i + 1) / steps) * 360;
    const aMid = (a0 + a1) * 0.5;
    const rad0 = ((a0 - 90) * Math.PI) / 180;
    const rad1 = ((a1 - 90) * Math.PI) / 180;
    const x0 = cx + r * Math.cos(rad0);
    const y0 = cy + r * Math.sin(rad0);
    const x1 = cx + r * Math.cos(rad1);
    const y1 = cy + r * Math.sin(rad1);
    const col = _threeColorToCssRgb(azimuthToPastelThreeColor(aMid, tokens));
    segs.push(
      `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${col}" stroke-width="5.5" stroke-linecap="butt"/>`,
    );
  }
  return `
    <svg width="40" height="40" viewBox="0 0 40 40" class="orient-ring-svg" aria-hidden="true">
      ${segs.join('')}
      <text x="20" y="7" text-anchor="middle" font-size="6.5" font-weight="700" fill="var(--ink)">U</text>
      <text x="34.5" y="22.2" text-anchor="middle" font-size="6.5" font-weight="700" fill="var(--ink-muted)">T</text>
      <text x="20" y="37.5" text-anchor="middle" font-size="6.5" font-weight="700" fill="var(--ink-muted)">S</text>
      <text x="5.5" y="22.2" text-anchor="middle" font-size="6.5" font-weight="700" fill="var(--ink-muted)">B</text>
    </svg>
  `;
}

/**
 * Computes compass azimuth (0=U, 90=T, 180=S, 270=B) from a horizontal normal (nx, ny in backend E, N)
 * rotated by `northAngleDeg`.
 */
export function normalToAzimuthDeg(nx, ny, northAngleDeg = 0) {
  return ((Math.atan2(nx, ny) * 180) / Math.PI - (Number(northAngleDeg) || 0) + 720) % 360;
}

/**
 * Computes compass orientation code from a horizontal normal (nx, ny in backend E, N)
 * rotated by `northAngleDeg`.
 */
export function normalToOrientationCode(nx, ny, northAngleDeg = 0) {
  const az = normalToAzimuthDeg(nx, ny, northAngleDeg);
  const idx = Math.floor(((az + 22.5) % 360) / 45);
  return ORIENTATION_CODES[idx] || 'U';
}

let cachedHatchTexture = null;
let cachedHatchSig = '';

export function createUnknownHatchTexture(tokens) {
  const sig = `${tokens.unknown}|${tokens.surface}`;
  if (cachedHatchTexture && cachedHatchSig === sig) {
    return cachedHatchTexture;
  }
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = tokens.unknown;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = tokens.surface;
    ctx.lineWidth = 8;
    for (let i = -size; i < size * 2; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size, size);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedHatchTexture = tex;
  cachedHatchSig = sig;
  return tex;
}

export function makeClassificationMaterial(category, tokens, { highlighted = false, dimmed = false } = {}) {
  const opacityBase = dimmed ? 0.16 : 1.0;

  if (category === 'unknown') {
    const tex = createUnknownHatchTexture(tokens);
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.6,
      metalness: 0.05,
      side: THREE.DoubleSide,
      transparent: dimmed,
      opacity: opacityBase,
      emissive: highlighted ? new THREE.Color(tokens.sun) : new THREE.Color(0x000000),
      emissiveIntensity: highlighted ? 0.35 : 0.0,
    });
  }

  let color = tokens.wall;
  let transparent = dimmed;
  let opacity = opacityBase;

  if (category === 'glazing' || category === 'composite_cw') {
    color = tokens.glazing;
    transparent = true;
    opacity = dimmed ? 0.14 : 0.82;
  } else if (category === 'shading') {
    color = tokens.shading;
  } else if (category === 'frame') {
    color = tokens.frame;
  } else if (category === 'roof' || category === 'ignore') {
    color = tokens.roof;
    transparent = true;
    opacity = dimmed ? 0.08 : 0.28;
  } else {
    color = tokens.wall;
  }

  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: category === 'glazing' ? 0.25 : 0.72,
    metalness: category === 'frame' ? 0.35 : 0.08,
    side: THREE.DoubleSide,
    transparent,
    opacity,
    emissive: highlighted ? new THREE.Color(tokens.sun) : new THREE.Color(0x000000),
    emissiveIntensity: highlighted ? 0.32 : 0.0,
  });
}

export function makeHeatmapMaterial(ottvWm2, tokens, { highlighted = false, dimmed = false } = {}) {
  const key = ottvToHeatTokenKey(ottvWm2);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(tokens[key]),
    roughness: 0.58,
    metalness: 0.06,
    side: THREE.DoubleSide,
    transparent: dimmed,
    opacity: dimmed ? 0.22 : 1.0,
    emissive: highlighted ? new THREE.Color(tokens.sun) : new THREE.Color(0x000000),
    emissiveIntensity: highlighted ? 0.28 : 0.0,
  });
}

export function makeVertexColorMaterial({ transparent = false, opacity = 1.0, depthWrite = true } = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.56,
    metalness: 0.06,
    side: THREE.DoubleSide,
    transparent,
    opacity,
    depthWrite,
  });
}

/**
 * Computes the exact view-space shading multiplier used by `makeColorAccurateMaterial`:
 * - Camera-facing surfaces (0, 0, 1) receive ~0.9924 linear (~0.997 sRGB, ΔE < 0.5 vs legend)
 * - Side/grazing surfaces receive >= 0.88 linear (<= 12% directional depth cue)
 * Keeps Heatmap & Orientasi facade colors faithfully matched to legend swatches in both themes.
 */
export function computeColorAccurateShade(nx, ny, nz) {
  const len = Math.hypot(nx, ny, nz) || 1;
  const x = nx / len;
  const y = ny / len;
  const z = nz / len;
  const lx = 0.28;
  const ly = 0.42;
  const lz = 0.86;
  const llen = Math.hypot(lx, ly, lz);
  const ndv = Math.abs(z);
  const ndl = Math.abs((x * lx + y * ly + z * lz) / llen);
  return 0.88 + 0.12 * (0.55 * ndv + 0.45 * ndl);
}

/**
 * Color-accurate vertex-color material for Heatmap, Orientasi, and solar exposure modes (T1).
 * Preserves exact sRGB legend color on camera-facing surfaces while adding <= 12% view-space
 * directional shading so perpendicular facades still read with crisp 3D volume.
 */
export function makeColorAccurateMaterial({ transparent = false, opacity = 1.0, depthWrite = true } = {}) {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent,
    depthWrite,
    uniforms: {
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec3 vColor;
      varying vec3 vViewNormal;
      void main() {
        vColor = color;
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      varying vec3 vViewNormal;
      void main() {
        vec3 n = normalize(vViewNormal);
        float ndv = abs(n.z);
        float ndl = abs(dot(n, normalize(vec3(0.28, 0.42, 0.86))));
        float shade = 0.88 + 0.12 * (0.55 * ndv + 0.45 * ndl);
        gl_FragColor = vec4(vColor * shade, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function makeXrayMaterial(category, tokens) {
  const color =
    category === 'glazing' || category === 'composite_cw'
      ? tokens.glazing
      : category === 'shading'
      ? tokens.shading
      : tokens.wall;
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.45,
    metalness: 0.05,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.20,
    depthWrite: false,
  });
}

export function makeAnomalyMaterial(isFlagged, tokens) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(isFlagged ? tokens.warn : tokens.wall),
    roughness: isFlagged ? 0.42 : 0.80,
    metalness: 0.05,
    side: THREE.DoubleSide,
    transparent: !isFlagged,
    opacity: isFlagged ? 0.96 : 0.16,
    emissive: isFlagged ? new THREE.Color(tokens.warn) : new THREE.Color(0x000000),
    emissiveIntensity: isFlagged ? 0.25 : 0.0,
  });
}

export const CATEGORY_LABELS = {
  glazing: 'Kaca',
  wall: 'Dinding',
  spandrel: 'Spandrel',
  composite_cw: 'Curtain wall',
  shading: 'Peneduh',
  frame: 'Rangka',
  roof: 'Atap',
  ignore: 'Abaikan',
  unknown: 'Belum dikenali',
};

export function categorySwatchStyle(category) {
  if (category === 'unknown') return { className: 'swatch swatch-unknown', bg: '' };
  const map = {
    glazing: 'var(--data-glazing)',
    composite_cw: 'var(--data-glazing)',
    wall: 'var(--data-wall)',
    spandrel: 'var(--data-wall)',
    shading: 'var(--data-shading)',
    frame: 'var(--data-frame)',
    roof: 'var(--data-roof)',
    ignore: 'var(--line)',
  };
  return { className: 'swatch', bg: map[category] || 'var(--data-wall)' };
}


/**
 * Heatmap Halus = paparan matahari (tampilan saja, tidak mengubah hitungan).
 * Palet pastel hijau -> kuning -> oranye -> koral di OKLCH, gaya peta radiasi, untuk t = 0..1
 * (0 = paparan terendah di model, 1 = tertinggi). Tema gelap memakai lightness lebih rendah.
 */
const EXPOSURE_STOPS_LCH = [
  { t: 0.0, h: 150 },
  { t: 0.35, h: 105 },
  { t: 0.65, h: 70 },
  { t: 1.0, h: 32 },
];

function _exposureLch(t, dark) {
  const tt = Math.max(0, Math.min(1, Number(t) || 0));
  let i = 0;
  while (i < EXPOSURE_STOPS_LCH.length - 2 && tt > EXPOSURE_STOPS_LCH[i + 1].t) i += 1;
  const a = EXPOSURE_STOPS_LCH[i];
  const b = EXPOSURE_STOPS_LCH[i + 1];
  const f = (tt - a.t) / (b.t - a.t);
  const h = a.h + (b.h - a.h) * f;
  const L = dark ? 0.68 - 0.06 * tt : 0.88 - 0.1 * tt;
  const C = (dark ? 0.085 : 0.075) + 0.04 * tt;
  return [L, C, h];
}

function _lchToThree(L, C, hDeg) {
  const hr = (hDeg * Math.PI) / 180;
  const [r, g, b] = _oklabToLinearRgb(L, C * Math.cos(hr), C * Math.sin(hr));
  const out = new THREE.Color();
  out.setRGB(r, g, b);
  return out;
}

function _themeIsDark(tokens) {
  const c = new THREE.Color(tokens.paper || tokens.surface || '#ffffff');
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.18;
}

export function exposureToThreeColor(t, tokens) {
  const [L, C, h] = _exposureLch(t, _themeIsDark(tokens));
  return _lchToThree(L, C, h);
}

export function buildExposureGradientCss(tokensOverride = null) {
  const tokens = tokensOverride || readThemeTokens();
  const parts = [0, 0.25, 0.5, 0.75, 1].map(
    (t) => `${_threeColorToCssRgb(exposureToThreeColor(t, tokens))} ${Math.round(t * 100)}%`,
  );
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
