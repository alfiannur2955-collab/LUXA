/**
 * Viewer color & material helpers reading live CSS tokens from theme.css.
 * Zero hardcoded hex values — switches cleanly between light and dark themes.
 * Supports all 5 viewer modes (`docs/FASE4_UI_SPEC.md` §4.2):
 * - classification (Klasifikasi)
 * - orientation (Orientasi: 8 compass directions neutral-to-warm)
 * - heatmap (Heatmap per arah / per panel)
 * - anomalies (Kejanggalan: flagged in --warn, rest dimmed)
 * - xray (X-ray: translucent envelope + dashed filtered_items)
 * Plus exposure filter (`sunlit_now`: sunlit = heat-1, shaded = data-wall).
 */

import * as THREE from 'three';

export const VIEWER_MODES = [
  { id: 'classification', label: 'Klasifikasi', icon: 'grid', group: 'view' },
  { id: 'orientation', label: 'Orientasi', icon: 'compass', group: 'view' },
  { id: 'heatmap', label: 'Heatmap', icon: 'thermometer', group: 'view' },
  { id: 'anomalies', label: 'Kejanggalan', icon: 'warn', group: 'check' },
  { id: 'xray', label: 'X-ray', icon: 'xray', group: 'check' },
];

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

export function ottvToHeatCssVar(ottvWm2, tokensOverride = null) {
  const tokens = tokensOverride || readThemeTokens();
  if (!tokens?.heat0) {
    const key = ottvToHeatTokenKey(ottvWm2);
    const map = { heat0: 'var(--heat-0)', heat1: 'var(--heat-1)', heat2: 'var(--heat-2)', heat3: 'var(--heat-3)' };
    return map[key];
  }
  const c = ottvToThreeColor(ottvWm2, tokens);
  const r = Math.round(Math.max(0, Math.min(1, _linearToSrgbChannel(c.r))) * 255);
  const g = Math.round(Math.max(0, Math.min(1, _linearToSrgbChannel(c.g))) * 255);
  const b = Math.round(Math.max(0, Math.min(1, _linearToSrgbChannel(c.b))) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Neutral-to-warm 8-direction palette derived strictly from theme CSS tokens
 * (zero hardcoded hex) following compass rotation U -> TL -> T -> TG -> S -> BD -> B -> BL.
 */
export function orientationToThreeColor(code, tokens) {
  const cGlz = new THREE.Color(tokens.glazing);
  const cWall = new THREE.Color(tokens.wall);
  const cShade = new THREE.Color(tokens.shading);
  const cH0 = new THREE.Color(tokens.heat0);
  const cH1 = new THREE.Color(tokens.heat1);
  const cH2 = new THREE.Color(tokens.heat2);
  const cH3 = new THREE.Color(tokens.heat3);

  switch (code) {
    case 'U':
      return cGlz.clone().lerp(cWall, 0.35);
    case 'TL':
      return cShade.clone().lerp(cH0, 0.35);
    case 'T':
      return cH1.clone().lerp(cH2, 0.25);
    case 'TG':
      return cH0.clone().lerp(cH1, 0.45);
    case 'S':
      return cWall.clone().lerp(cH0, 0.35);
    case 'BD':
      return cH1.clone().lerp(cH2, 0.65);
    case 'B':
      return cH2.clone().lerp(cH3, 0.35);
    case 'BL':
      return cGlz.clone().lerp(cH1, 0.50);
    default:
      return cWall.clone();
  }
}

export function orientationToCssColor(code, tokens) {
  const c = orientationToThreeColor(code, tokens);
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

/**
 * Computes compass orientation code from a horizontal normal (nx, ny in backend E, N)
 * rotated by `northAngleDeg`.
 */
export function normalToOrientationCode(nx, ny, northAngleDeg = 0) {
  const az = ((Math.atan2(nx, ny) * 180) / Math.PI - (Number(northAngleDeg) || 0) + 720) % 360;
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
