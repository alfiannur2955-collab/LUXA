/**
 * Offscreen PNG Capture (`docs/FASE4_UI_SPEC.md` §4.7):
 * - Renders 3D viewer at 1x, 2x, or 4x resolution
 * - Composites theme gradient background + 3D render + LUXA logo stamp in bottom-right corner
 * - Downloads PNG named `<model>_<view>_<tanggal>.png`
 */

import { fmtId } from '../ui/escapeHtml.js';
import { DIRECTION_NAMES, PROJECTION_SHORT } from './cameras.js';
import { readThemeTokens } from './modes.js';
import { viewer } from './viewer.js';

const logoImageCache = new Map();

function loadLogoImage(src) {
  if (logoImageCache.has(src)) {
    return logoImageCache.get(src);
  }
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  logoImageCache.set(src, promise);
  return promise;
}

function sanitizeFilePart(text, fallback) {
  const clean = String(text || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || fallback;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export async function captureViewerPng(state, { scale = 2 } = {}) {
  const safeScale = [1, 2, 4].includes(Number(scale)) ? Number(scale) : 2;
  const snap = viewer.renderOffscreenSnapshot(safeScale);
  if (!snap || !snap.canvas) {
    throw new Error('Viewer 3D belum siap untuk di-capture.');
  }

  const { canvas: glCanvas, width, height } = snap;
  const tokens = readThemeTokens();
  const isDark = state.theme === 'dark';

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('Konteks gambar 2D tidak tersedia.');
  }

  // 1. Background gradient matching viewer tokens
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, tokens.surface);
  grad.addColorStop(1, tokens.sunken);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. High-res 3D render
  ctx.drawImage(glCanvas, 0, 0, width, height);

  // 3. Corner stamp (bottom-right) with LUXA logo + model, view, OTTV, and date
  const logoSrc = isDark ? '/brand/luxa-logo-dark.svg' : '/brand/luxa-logo.svg';
  const logoImg = await loadLogoImage(logoSrc);

  const today = new Date().toISOString().slice(0, 10);
  const activeView = (state.config?.saved_views || []).find((v) => v.id === state.activeViewId);
  const viewLabel =
    activeView?.name ||
    `${DIRECTION_NAMES[state.cameraDirection] || state.cameraDirection || 'Utama'} · ${
      PROJECTION_SHORT[state.cameraProjection] || 'Persp'
    }`;
  const modelLabel = state.filename || 'Model LUXA';
  const ottvVal = state.analysisData?.ottv_total_wm2;
  const metaLine =
    ottvVal !== undefined && ottvVal !== null
      ? `${viewLabel} · OTTV ${fmtId(ottvVal, 2)} W/m² · ${today}`
      : `${viewLabel} · ${today}`;

  // Scale typography cleanly with capture resolution
  const k = Math.max(1, width / 1280);
  const pad = Math.round(16 * k);
  const margin = Math.round(22 * k);
  const logoH = Math.round(26 * k);
  const logoW = logoImg && logoImg.naturalHeight > 0
    ? Math.round((logoImg.naturalWidth / logoImg.naturalHeight) * logoH)
    : Math.round(92 * k);

  ctx.font = `600 ${Math.round(13 * k)}px "Plus Jakarta Sans", system-ui, sans-serif`;
  const modelW = ctx.measureText(modelLabel).width;
  ctx.font = `500 ${Math.round(11.5 * k)}px "Plus Jakarta Sans", system-ui, sans-serif`;
  const metaW = ctx.measureText(metaLine).width;

  const textBlockW = Math.max(modelW, metaW);
  const gap = Math.round(14 * k);
  const stampW = Math.min(width - margin * 2, pad * 2 + logoW + gap + textBlockW);
  const stampH = Math.round(58 * k);
  const sx = width - margin - stampW;
  const sy = height - margin - stampH;

  ctx.save();
  drawRoundedRect(ctx, sx, sy, stampW, stampH, Math.round(14 * k));
  ctx.fillStyle = isDark ? 'rgba(30, 29, 26, 0.84)' : 'rgba(255, 255, 255, 0.86)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, Math.round(1.2 * k));
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(27, 26, 23, 0.12)';
  ctx.stroke();

  if (logoImg) {
    ctx.drawImage(logoImg, sx + pad, sy + (stampH - logoH) / 2, logoW, logoH);
  } else {
    ctx.fillStyle = tokens.ink;
    ctx.font = `700 ${Math.round(16 * k)}px Montserrat, sans-serif`;
    ctx.fillText('LUXA', sx + pad, sy + Math.round(35 * k));
  }

  const tx = sx + pad + logoW + gap;
  ctx.fillStyle = tokens.ink;
  ctx.font = `700 ${Math.round(13 * k)}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.fillText(modelLabel, tx, sy + Math.round(25 * k));

  ctx.fillStyle = tokens.muted;
  ctx.font = `500 ${Math.round(11.5 * k)}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.fillText(metaLine, tx, sy + Math.round(43 * k));
  ctx.restore();

  const modelPart = sanitizeFilePart(state.filename, 'luxa_model');
  const viewPart = sanitizeFilePart(viewLabel, 'view');
  const downloadName = `${modelPart}_${viewPart}_${today}.png`;

  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Gagal mengonversi capture ke PNG.');
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);

  return { filename: downloadName, width, height, scale: safeScale };
}
