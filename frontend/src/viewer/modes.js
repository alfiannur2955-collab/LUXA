/**
 * Viewer color & material helpers reading live CSS tokens from theme.css.
 * Zero hardcoded hex values — switches cleanly between light and dark themes.
 */

import * as THREE from 'three';

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
 * Fixed OTTV Heatmap scale (`docs/FASE4_UI_SPEC.md` §4.2):
 * < 25, 25..32, 32..35, > 35 W/m2 -> heat-0 .. heat-3.
 */
export function ottvToHeatTokenKey(ottvWm2) {
  const v = Number(ottvWm2);
  if (!Number.isFinite(v) || v < 25) return 'heat0';
  if (v < 32) return 'heat1';
  if (v <= 35) return 'heat2';
  return 'heat3';
}

export function ottvToHeatCssVar(ottvWm2) {
  const key = ottvToHeatTokenKey(ottvWm2);
  const map = {
    heat0: 'var(--heat-0)',
    heat1: 'var(--heat-1)',
    heat2: 'var(--heat-2)',
    heat3: 'var(--heat-3)',
  };
  return map[key];
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
