/**
 * Capture PNG LUXA (diperluas 22 Nov):
 * - Dua tata letak: 'overlay' (seperti layar: legenda & info menempel di sudut gambar) dan
 *   'panel' (gambar 3D bersih + strip info di bawah).
 * - Isi bisa dipilih: legenda mode aktif, OTTV total & status, label di model (arah, lintasan
 *   matahari, panel terpilih, penanda kejanggalan), info proyek (+ panah utara).
 * - Mengikuti tampilan aktif: mode warna, filter "terkena matahari", jam & tanggal matahari.
 * - Layar Bandingkan: dua sisi, kartu nilai masing-masing, dan tabel selisih per arah.
 * Semua digambar langsung di kanvas supaya tetap tajam di 2x dan 4x.
 */

import * as THREE from 'three';
import { fmtId } from '../ui/escapeHtml.js';
import { DIRECTION_NAMES, PROJECTION_SHORT } from './cameras.js';
import {
  ORIENTATION_CODES,
  ORIENTATION_NAMES_ID,
  exposureToThreeColor,
  horizontalNeutralColor,
  normalToOrientationCode,
  orientationToCssColor,
  ottvToThreeColor,
  readThemeTokens,
} from './modes.js';
import { viewer } from './viewer.js';
import { resolveViewerMode } from './modes.js';

const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
const logoImageCache = new Map();

export const DEFAULT_CAPTURE_INCLUDE = { legend: true, ottv: true, labels: true, info: true };

function loadLogoImage(src) {
  if (logoImageCache.has(src)) return logoImageCache.get(src);
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

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const css = (c) => (c && typeof c.getStyle === 'function' ? c.getStyle() : String(c || '#888'));
const hourLabel = (h) => `${String(Math.round(Number(h ?? 13))).padStart(2, '0')}.00`;

function fmtDateId(dateStr) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return String(dateStr || '');
  return `${d} ${months[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Isi: legenda, OTTV, info
// ---------------------------------------------------------------------------

function sunlitStats(state) {
  const set = viewer._getSunlitPanelIdSet(state);
  const north = Number(state.config?.settings?.north_angle_deg || 0);
  const aNorth = Number(state.analysisData?.summary?.north_angle_deg || 0);
  let tot = 0;
  let lit = 0;
  const byOri = {};
  for (const p of state.analysisData?.panels || []) {
    if (!p.active) continue;
    const a = Number(p.area_m2 || 0);
    tot += a;
    if (set && set.has(p.id)) {
      lit += a;
      let code = p.orientation_code || 'U';
      if (Math.abs(north - aNorth) > 0.05 && Array.isArray(p.normal)) code = normalToOrientationCode(p.normal[0], p.normal[1], north);
      if (code === 'TGR') code = 'TG';
      byOri[code] = (byOri[code] || 0) + a;
    }
  }
  const top = Object.entries(byOri).sort((x, y) => y[1] - x[1])[0];
  return { pct: tot > 0 ? (lit / tot) * 100 : 0, topName: top ? ORIENTATION_NAMES_ID[top[0]] || top[0] : null };
}

/** Spesifikasi legenda sesuai tampilan aktif: { title, kind:'gradient'|'swatches', ... } */
function buildLegendSpec(state, tokens, mode) {
  if (state.facadeFilter === 'sunlit_now' && state.analysisData) {
    const st = sunlitStats(state);
    return {
      title: `Terkena matahari · ${hourLabel(state.sunHour)}, ${fmtDateId(state.sunDate)}`,
      kind: 'gradient',
      stops: [0, 0.5, 1].map((t) => css(ottvToThreeColor(10 + 45 * t, tokens))),
      ticks: ['sinar miring', 'tegak lurus'],
      extra: [{ color: tokens.wall, label: 'Bayangan' }],
      note: `${fmtId(st.pct, 0)}% fasad terkena${st.topName ? ` · terbanyak: ${st.topName}` : ''}`,
    };
  }
  if (mode === 'heatmap') {
    const gran = state.heatmapGranularity === 'panel' ? 'per panel' : 'per arah';
    return {
      title: `OTTV (W/m²) · ${gran}`,
      kind: 'gradient',
      stops: [0, 10, 20, 25, 30, 35, 42, 50, 60].map((v) => css(ottvToThreeColor(v, tokens))),
      ticks: ['0', '35 batas', '60'],
      tickPos: [0, 35 / 60, 1],
      limitAt: 35 / 60,
    };
  }
  if (mode === 'exposure') {
    const r = viewer.lastSmoothRange;
    return {
      title: `Matahari sepanjang tahun (W/m²)${state.exposureShading !== false ? ' · dengan peneduh' : ''}`,
      kind: 'gradient',
      stops: [0, 0.25, 0.5, 0.75, 1].map((t) => css(exposureToThreeColor(t, tokens))),
      ticks: [`${Math.round(r?.min ?? 80)}`, `${Math.round(r?.max ?? 250)}+`],
      note: 'Hanya tampilan; angka OTTV tidak berubah',
    };
  }
  if (mode === 'orientation') {
    return {
      title: 'Warna menurut arah hadap',
      kind: 'swatches',
      items: [
        ...ORIENTATION_CODES.map((c) => ({ color: orientationToCssColor(c, tokens), label: c })),
        { color: css(horizontalNeutralColor(tokens)), label: 'Atap/datar' },
      ],
    };
  }
  if (mode === 'anomalies') {
    return { title: 'Perlu dicek', kind: 'swatches', items: [{ color: tokens.warn, label: 'Perlu diperiksa' }, { color: tokens.wall, label: 'Elemen lain' }] };
  }
  if (mode === 'xray') {
    return { title: 'X-ray', kind: 'swatches', items: [{ color: tokens.glazing, label: 'Selubung' }, { color: tokens.warn, label: 'Disaring / nonaktif' }] };
  }
  return {
    title: 'Klasifikasi',
    kind: 'swatches',
    items: [
      { color: tokens.glazing, label: 'Kaca' },
      { color: tokens.wall, label: 'Dinding' },
      { color: tokens.shading, label: 'Peneduh' },
      { color: tokens.frame, label: 'Rangka' },
      { color: tokens.roof, label: 'Atap' },
    ],
  };
}

function ottvSpec(analysis) {
  if (!analysis) return null;
  const ottv = Number(analysis.ottv_total_wm2 ?? 0);
  const limit = Number(analysis.sni_limit_wm2 ?? 35);
  const ok = ottv <= limit;
  const rt = analysis.rttv?.applicable ? analysis.rttv : null;
  return {
    value: fmtId(ottv, 2),
    status: ok ? `Memenuhi (≤ ${fmtId(limit, 0)} W/m²)` : `Tidak memenuhi (batas ${fmtId(limit, 0)})`,
    ok,
    rttv: rt ? `RTTV ${fmtId(rt.rttv_wm2, 2)} W/m² · ${rt.rttv_wm2 <= rt.limit_wm2 ? 'memenuhi' : 'tidak memenuhi'}` : null,
    provisional: Boolean(analysis.summary?.is_provisional),
  };
}

function infoLines(state) {
  const activeView = (state.config?.saved_views || []).find((v) => v.id === state.activeViewId);
  const viewLabel =
    activeView?.name ||
    `${DIRECTION_NAMES[state.cameraDirection] || state.cameraDirection || 'Utama'} · ${PROJECTION_SHORT[state.cameraProjection] || 'Persp'}`;
  const loc = state.analysisData?.location_info?.city || state.config?.settings?.city_preset || '';
  const lines = [state.filename || 'Model LUXA'];
  const second = [loc && `Lokasi ${loc}`, viewLabel].filter(Boolean).join(' · ');
  if (second) lines.push(second);
  const sunShown = state.facadeFilter === 'sunlit_now' || state.sunDomeVisible;
  const third = [
    sunShown ? `Matahari ${hourLabel(state.sunHour)}, ${fmtDateId(state.sunDate)}` : null,
    `Utara ${fmtId(Number(state.config?.settings?.north_angle_deg || 0), 0)}°`,
    `Dibuat ${fmtDateId(new Date().toISOString().slice(0, 10))}`,
  ]
    .filter(Boolean)
    .join(' · ');
  lines.push(third);
  return { lines, viewLabel };
}

/** Sudut panah utara di layar (radian, 0 = ke atas), dari kamera aktif. */
function screenNorthAngle() {
  try {
    return (viewer.screenNorthDeg() * Math.PI) / 180;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Penggambar
// ---------------------------------------------------------------------------

function makeDrawer(ctx, k, tokens, isDark) {
  const panelFill = isDark ? 'rgba(30, 29, 26, 0.86)' : 'rgba(255, 255, 255, 0.88)';
  const panelStroke = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(27, 26, 23, 0.12)';
  const font = (w, px) => `${w} ${Math.round(px * k)}px ${FONT}`;
  const text = (s, x, y, { w = 600, px = 12, color = tokens.ink, align = 'left' } = {}) => {
    ctx.font = font(w, px);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
    ctx.textAlign = 'left';
    return ctx.measureText(s).width;
  };
  const measure = (s, w, px) => {
    ctx.font = font(w, px);
    return ctx.measureText(s).width;
  };
  const card = (x, y, w, h) => {
    ctx.save();
    roundRect(ctx, x, y, w, h, 14 * k);
    ctx.fillStyle = panelFill;
    ctx.shadowColor = 'rgba(0,0,0,0.10)';
    ctx.shadowBlur = 18 * k;
    ctx.shadowOffsetY = 4 * k;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1, 1.1 * k);
    ctx.strokeStyle = panelStroke;
    ctx.stroke();
    ctx.restore();
  };

  /** Mengukur & menggambar legenda; dry=true hanya mengembalikan ukuran. */
  const legend = (spec, x, y, dry = false) => {
    const pad = 12 * k;
    const titleH = 16 * k;
    let w = measure(spec.title, 700, 12) + pad * 2;
    let h = pad + titleH;
    const barW = 210 * k;
    if (spec.kind === 'gradient') {
      let extraW = 0;
      for (const e of spec.extra || []) extraW += 22 * k + measure(e.label, 600, 11.5) + 12 * k;
      w = Math.max(w, pad * 2 + barW + extraW);
      h += 10 * k + 18 * k;
    } else {
      let rowW = 0;
      for (const it of spec.items) rowW += 18 * k + measure(it.label, 600, 11.5) + 12 * k;
      w = Math.max(w, pad * 2 + rowW);
      h += 22 * k;
    }
    if (spec.note) {
      w = Math.max(w, pad * 2 + measure(spec.note, 600, 11.5));
      h += 18 * k;
    }
    h += pad * 0.6;
    if (dry) return { w, h };
    text(spec.title, x + pad, y + pad + 11 * k, { w: 700, px: 12 });
    let cy = y + pad + titleH + 4 * k;
    if (spec.kind === 'gradient') {
      const g = ctx.createLinearGradient(x + pad, 0, x + pad + barW, 0);
      spec.stops.forEach((c, i) => g.addColorStop(i / (spec.stops.length - 1), c));
      ctx.save();
      roundRect(ctx, x + pad, cy, barW, 10 * k, 5 * k);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      if (spec.limitAt !== undefined) {
        ctx.fillStyle = tokens.ink;
        ctx.fillRect(x + pad + barW * spec.limitAt - k, cy - 3 * k, 2 * k, 16 * k);
      }
      const pos = spec.tickPos || spec.ticks.map((_, i) => (spec.ticks.length === 1 ? 0 : i / (spec.ticks.length - 1)));
      spec.ticks.forEach((t, i) => {
        const tx = x + pad + barW * pos[i];
        const align = i === 0 ? 'left' : i === spec.ticks.length - 1 ? 'right' : 'center';
        text(t, tx, cy + 24 * k, { w: t.includes('batas') ? 700 : 600, px: 10.5, color: t.includes('batas') ? tokens.ink : tokens.muted, align });
      });
      let ex = x + pad + barW + 14 * k;
      for (const e of spec.extra || []) {
        ctx.fillStyle = e.color;
        roundRect(ctx, ex, cy - 1 * k, 12 * k, 12 * k, 3 * k);
        ctx.fill();
        ex += 18 * k;
        ex += text(e.label, ex, cy + 9.5 * k, { w: 600, px: 11.5 }) + 12 * k;
      }
      cy += 10 * k + 18 * k;
    } else {
      let ix = x + pad;
      for (const it of spec.items) {
        ctx.fillStyle = it.color;
        roundRect(ctx, ix, cy + 2 * k, 12 * k, 12 * k, 3 * k);
        ctx.fill();
        ix += 18 * k;
        ix += text(it.label, ix, cy + 12 * k, { w: 600, px: 11.5 }) + 12 * k;
      }
      cy += 22 * k;
    }
    if (spec.note) text(spec.note, x + pad, cy + 12 * k, { w: 600, px: 11.5, color: tokens.muted });
    return { w, h };
  };

  const ottv = (o, x, y, dry = false) => {
    const pad = 12 * k;
    const valW = measure(o.value, 800, 26) + 6 * k + measure('W/m²', 600, 12);
    const w = Math.max(valW, measure(o.status, 700, 11.5), o.rttv ? measure(o.rttv, 600, 11) : 0, 120 * k) + pad * 2;
    const h = pad + 14 * k + 30 * k + 16 * k + (o.rttv ? 16 * k : 0) + (o.provisional ? 15 * k : 0) + pad * 0.6;
    if (dry) return { w, h };
    text('OTTV total', x + pad, y + pad + 10 * k, { w: 700, px: 11, color: tokens.muted });
    const vw = text(o.value, x + pad, y + pad + 40 * k, { w: 800, px: 26 });
    text('W/m²', x + pad + vw + 6 * k, y + pad + 40 * k, { w: 600, px: 12, color: tokens.muted });
    let cy = y + pad + 40 * k + 18 * k;
    text(o.status, x + pad, cy, { w: 700, px: 11.5, color: o.ok ? tokens.ok : tokens.fail });
    if (o.rttv) {
      cy += 16 * k;
      text(o.rttv, x + pad, cy, { w: 600, px: 11, color: tokens.muted });
    }
    if (o.provisional) {
      cy += 15 * k;
      text('Hasil SEMENTARA', x + pad, cy, { w: 700, px: 11, color: tokens.warn });
    }
    return { w, h };
  };

  const north = (angle, cx, cy, r) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = panelFill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.1 * k);
    ctx.strokeStyle = panelStroke;
    ctx.stroke();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.62);
    ctx.lineTo(r * 0.26, r * 0.34);
    ctx.lineTo(0, r * 0.16);
    ctx.lineTo(-r * 0.26, r * 0.34);
    ctx.closePath();
    ctx.fillStyle = tokens.sun;
    ctx.fill();
    ctx.restore();
    const lx = cx + Math.sin(angle) * r * 1.32;
    const ly = cy - Math.cos(angle) * r * 1.32 + 4 * k;
    text('U', lx, ly, { w: 800, px: 11, align: 'center' });
  };

  return { text, measure, card, legend, ottv, north, font };
}

/** Salin label HTML yang menempel di model (arah, lintasan matahari, panel terpilih, kejanggalan). */
function drawDomLabels(ctx, k, ox, oy) {
  const host = viewer.container;
  if (!host) return;
  const base = host.getBoundingClientRect();
  const stage = host.parentElement || host;
  const layers = stage.querySelectorAll('.viewer-labels-layer, .sundome-labels-layer');
  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  };
  for (const layer of layers) {
    if (!isVisible(layer)) continue;
    const all = [...layer.querySelectorAll('*')].filter((el) => {
      if (!isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > base.left && r.left < base.right && r.bottom > base.top && r.top < base.bottom;
    });
    // 1) latar (kartu kaca, titik pin)
    for (const el of all) {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (!bg || bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg)) continue;
      const r = el.getBoundingClientRect();
      const x = ox + (r.left - base.left) * k;
      const y = oy + (r.top - base.top) * k;
      const rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.height / 2) * k;
      ctx.save();
      roundRect(ctx, x, y, r.width * k, r.height * k, rad);
      ctx.fillStyle = bg;
      ctx.fill();
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopColor) {
        ctx.lineWidth = parseFloat(cs.borderTopWidth) * k;
        ctx.strokeStyle = cs.borderTopColor;
        ctx.stroke();
      }
      ctx.restore();
    }
    // 2) teks (node teks langsung milik elemen)
    for (const el of all) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
      if (!own) continue;
      const cs = getComputedStyle(el);
      const range = document.createRange();
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      range.selectNodeContents(tn);
      const tr = range.getBoundingClientRect();
      const r = tr.width > 0 ? tr : el.getBoundingClientRect();
      const px = parseFloat(cs.fontSize) || 12;
      ctx.save();
      ctx.font = `${cs.fontWeight} ${px * k}px ${FONT}`;
      ctx.fillStyle = cs.color;
      ctx.textBaseline = 'middle';
      if (cs.textShadow && cs.textShadow !== 'none') {
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 4 * k;
      }
      ctx.fillText(own, ox + (r.left - base.left) * k, oy + (r.top - base.top + r.height / 2) * k);
      ctx.restore();
    }
  }
}

function drawCompareOverlays(ctx, d, k, state, tokens, x0, y0, w, splitX, panelMode) {
  const alts = state.alternatives || [];
  const alt = alts.find((a) => a.id === state.activeAlternativeId) || alts[0];
  if (!alt) return;
  const base = state.analysisData;
  const lim = Number(base?.sni_limit_wm2 ?? 35);
  const head = (label, sub, val, x, maxW) => {
    const pad = 12 * k;
    const vTxt = fmtId(val, 2);
    const wv = d.measure(vTxt, 800, 22);
    const ws = Math.min(maxW - wv - pad * 3, Math.max(d.measure(sub, 700, 12.5), d.measure(label, 700, 11)));
    const cw = pad * 3 + ws + wv;
    d.card(x, y0 + 14 * k, cw, 58 * k);
    d.text(label, x + pad, y0 + 14 * k + 22 * k, { w: 700, px: 11, color: tokens.muted });
    let s = sub;
    while (s.length > 4 && d.measure(s, 700, 12.5) > ws) s = `${s.slice(0, -2)}…`;
    d.text(s, x + pad, y0 + 14 * k + 42 * k, { w: 700, px: 12.5 });
    d.text(vTxt, x + cw - pad, y0 + 14 * k + 36 * k, { w: 800, px: 22, align: 'right', color: val <= lim ? tokens.ink : tokens.fail });
  };
  head('Sekarang', state.filename || 'Desain sekarang', Number(base?.ottv_total_wm2 ?? 0), x0 + 14 * k, splitX - x0 - 28 * k);
  const altSub = alt.kind === 'model' ? `Model: ${alt.filename || alt.name}` : alt.name;
  head(`Alternatif ${alt.code}`, altSub, Number(alt.analysisData?.ottv_total_wm2 ?? 0), splitX + 14 * k, x0 + w - splitX - 28 * k);
  // garis pembagi
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(splitX - k, y0, 2 * k, 10000);
  return alt;
}

function compareDiffRows(state, alt) {
  const by = (a) => Object.fromEntries((a?.orientation_breakdown || []).map((o) => [o.code === 'TGR' ? 'TG' : o.code, o]));
  const b = by(state.analysisData);
  const a = by(alt.analysisData);
  return ORIENTATION_CODES.filter((c) => Number(b[c]?.total_area_m2 || 0) > 0 || Number(a[c]?.total_area_m2 || 0) > 0).map((c) => {
    const vb = Number(b[c]?.ottv_orientation_wm2 || 0);
    const va = Number(a[c]?.ottv_orientation_wm2 || 0);
    return { code: c, vb, va, d: va - vb };
  });
}

function drawDiffTable(d, k, tokens, rows, x, y, dry = false) {
  const pad = 12 * k;
  // Lebar kolom dari teks terpanjang, supaya angka antar-arah tidak bertabrakan.
  const cellW = Math.max(
    40 * k,
    ...rows.map((r) => Math.max(
      d.measure(fmtId(r.va, 2), 800, 12),
      d.measure(`dari ${fmtId(r.vb, 2)}`, 500, 10.5),
      d.measure(`+${fmtId(Math.abs(r.d), 2)}`, 800, 11.5),
    )),
  );
  const colW = cellW + 14 * k;
  const w = pad * 2 + Math.max(rows.length, 1) * colW;
  const h = pad + 16 * k + 17 * k * 4 + pad * 0.5;
  if (dry) return { w, h };
  d.text('Selisih per arah (W/m²)', x + w / 2, y + pad + 11 * k, { w: 700, px: 11.5, color: tokens.muted, align: 'center' });
  rows.forEach((r, i) => {
    const cx = x + pad + colW * i + colW / 2;
    d.text(r.code, cx, y + pad + 32 * k, { w: 800, px: 12, align: 'center' });
    d.text(fmtId(r.va, 2), cx, y + pad + 49 * k, { w: 800, px: 12, align: 'center' });
    d.text(`dari ${fmtId(r.vb, 2)}`, cx, y + pad + 65 * k, { w: 500, px: 10.5, color: tokens.muted, align: 'center' });
    d.text(`${r.d > 0 ? '+' : r.d < 0 ? '−' : ''}${fmtId(Math.abs(r.d), 2)}`, cx, y + pad + 82 * k, {
      w: 800,
      px: 11.5,
      align: 'center',
      color: r.d > 0.005 ? tokens.fail : r.d < -0.005 ? tokens.ok : tokens.muted,
    });
  });
  return { w, h };
}

// ---------------------------------------------------------------------------
// Utama
// ---------------------------------------------------------------------------

const MODE_FILE_PART = {
  sunlit: 'matahari_jam',
  heatmap: 'ottv',
  exposure: 'matahari_tahunan',
  orientation: 'orientasi',
  classification: 'klasifikasi',
  anomalies: 'perlu_dicek',
  xray: 'xray',
};

export async function captureViewerPng(state, { scale = 2, layout = 'panel', include = DEFAULT_CAPTURE_INCLUDE } = {}) {
  const safeScale = [1, 2, 4].includes(Number(scale)) ? Number(scale) : 2;
  const inc = { ...DEFAULT_CAPTURE_INCLUDE, ...(include || {}) };
  const isCompare = state.step === 'compare';
  // Menutup popover memicu render ulang halaman; viewer dipasang lagi di frame berikutnya.
  // Tunggu sampai kanvas dan lapisan label sudah menempel di DOM baru, baru diambil.
  const nextFrame = () => new Promise((r) => window.requestAnimationFrame(() => r()));
  for (let i = 0; i < 4 && !(viewer.container && viewer.container.isConnected); i += 1) await nextFrame();
  await nextFrame();
  await nextFrame();
  const snap = viewer.renderOffscreenSnapshot(safeScale);
  if (!snap || !snap.canvas) throw new Error('Viewer 3D belum siap untuk di-capture.');

  const { canvas: glCanvas, width, height } = snap;
  const k = width / Math.max(1, snap.baseWidth || width / safeScale);
  const tokens = readThemeTokens();
  const isDark = state.theme === 'dark';
  const mode = isCompare ? 'heatmap' : resolveViewerMode(state).renderMode;

  const legendSpec = inc.legend ? buildLegendSpec(isCompare ? { ...state, facadeFilter: 'all' } : state, tokens, mode) : null;
  const ottvSp = inc.ottv && !isCompare ? ottvSpec(state.analysisData) : null;
  const info = infoLines(state);
  const logoSrc = isDark ? `${import.meta.env.BASE_URL}brand/luxa-logo-dark.svg` : `${import.meta.env.BASE_URL}brand/luxa-logo.svg`;
  const logoImg = await loadLogoImage(logoSrc);

  // Ukur strip panel (tata letak 'panel')
  const scratch = document.createElement('canvas').getContext('2d');
  const dm = makeDrawer(scratch, k, tokens, isDark);
  const margin = 20 * k;
  let footerH = 0;
  let compareAlt = null;
  let diffRows = [];
  if (isCompare) {
    const alts = state.alternatives || [];
    compareAlt = alts.find((a) => a.id === state.activeAlternativeId) || alts[0] || null;
    if (compareAlt) diffRows = compareDiffRows(state, compareAlt);
  }
  let diffOwnRow = false;
  if (layout === 'panel') {
    const hs = [86 * k];
    let used = margin;
    if (legendSpec) { const sz = dm.legend(legendSpec, 0, 0, true); hs.push(sz.h); used += sz.w + 24 * k; }
    if (ottvSp) { const sz = dm.ottv(ottvSp, 0, 0, true); hs.push(sz.h); used += sz.w + 24 * k; }
    const infoNeed = (inc.info ? 60 * k : 0) + Math.max(...(inc.info ? info.lines : [info.lines[0]]).map((l, i) => dm.measure(l, i === 0 ? 700 : 500, i === 0 ? 13 : 11.5))) + margin;
    let rowH = Math.max(...hs);
    if (isCompare && compareAlt) {
      const tsz = drawDiffTable(dm, k, tokens, diffRows, 0, 0, true);
      if (used + tsz.w + 24 * k + infoNeed > width) {
        // Tidak muat sebaris: tabel selisih turun ke baris kedua, selebar strip.
        diffOwnRow = true;
        footerH = rowH + margin * 3 + tsz.h;
      } else {
        rowH = Math.max(rowH, tsz.h);
      }
    }
    if (!diffOwnRow) footerH = rowH + margin * 2;
  }

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height + footerH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Konteks gambar 2D tidak tersedia.');
  const d = makeDrawer(ctx, k, tokens, isDark);

  // Latar + render 3D
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, tokens.surface);
  grad.addColorStop(1, tokens.sunken);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(glCanvas, 0, 0, width, height);

  if (inc.labels && !isCompare) drawDomLabels(ctx, k, 0, 0);

  if (isCompare && compareAlt) {
    const splitX = Math.round(width * Math.max(0.1, Math.min(0.9, Number(state.compareSplitRatio ?? 0.5))));
    drawCompareOverlays(ctx, d, k, state, tokens, 0, 0, width, splitX, layout === 'panel');
  }

  const northAngle = screenNorthAngle(state);

  if (layout === 'overlay') {
    // Kiri atas: OTTV · kanan atas: panah utara · kiri bawah: legenda · kanan bawah: info + logo
    if (ottvSp) {
      const sz = d.ottv(ottvSp, 0, 0, true);
      d.card(margin, margin, sz.w, sz.h);
      d.ottv(ottvSp, margin, margin);
    }
    if (inc.info) d.north(northAngle, width - margin - 22 * k, (isCompare ? 100 * k : margin) + 22 * k, 20 * k);
    let bottomLeftTop = height - margin;
    if (isCompare && compareAlt) {
      const sz = drawDiffTable(d, k, tokens, diffRows, 0, 0, true);
      const tx = (width - sz.w) / 2;
      d.card(tx, height - margin - sz.h, sz.w, sz.h);
      drawDiffTable(d, k, tokens, diffRows, tx, height - margin - sz.h);
      bottomLeftTop = height - margin - sz.h - 10 * k;
    }
    if (legendSpec) {
      const sz = d.legend(legendSpec, 0, 0, true);
      const ly = Math.min(bottomLeftTop, height - margin) - sz.h;
      d.card(margin, ly, sz.w, sz.h);
      d.legend(legendSpec, margin, ly);
    }
    drawStamp(d, ctx, k, tokens, logoImg, inc.info ? info.lines : [info.lines[0]], width - margin, (isCompare && compareAlt ? bottomLeftTop : height - margin));
  } else {
    // Strip info di bawah gambar
    const fy = height;
    ctx.fillStyle = isDark ? tokens.paper : '#ffffff';
    ctx.fillRect(0, fy, width, footerH);
    ctx.fillStyle = tokens.line;
    ctx.fillRect(0, fy, width, Math.max(1, k));
    let x = margin;
    const top = fy + margin;
    if (ottvSp) {
      const sz = d.ottv(ottvSp, x, top);
      x += sz.w + 24 * k;
    }
    if (legendSpec) {
      const sz = d.legend(legendSpec, x, top);
      x += sz.w + 24 * k;
    }
    if (isCompare && compareAlt) {
      if (diffOwnRow) {
        const tsz = drawDiffTable(d, k, tokens, diffRows, 0, 0, true);
        const ty = fy + footerH - margin - tsz.h;
        ctx.fillStyle = tokens.line;
        ctx.fillRect(margin, ty - margin / 2, width - margin * 2, Math.max(1, k));
        drawDiffTable(d, k, tokens, diffRows, (width - tsz.w) / 2, ty);
      } else {
        const sz = drawDiffTable(d, k, tokens, diffRows, x, top);
        x += sz.w + 24 * k;
      }
    }
    // kanan: logo + info + panah utara
    const rightX = width - margin;
    let infoX = rightX;
    if (inc.info) {
      d.north(northAngle, rightX - 22 * k, top + 26 * k, 20 * k);
      infoX = rightX - 60 * k;
    }
    drawInfoBlock(ctx, d, k, tokens, logoImg, inc.info ? info.lines : [info.lines[0]], infoX, top, Math.max(220 * k, infoX - x));
  }

  const today = new Date().toISOString().slice(0, 10);
  const modelPart = sanitizeFilePart(state.filename, 'luxa_model');
  const viewPart = sanitizeFilePart(isCompare ? `bandingkan_${compareAlt?.code || ''}` : info.viewLabel, 'view');
  const modePart = isCompare ? '' : `_${MODE_FILE_PART[state.facadeFilter === 'sunlit_now' ? 'sunlit' : mode] || 'model'}`;
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '');
  const downloadName = `${modelPart}_${viewPart}${modePart}_${today}_${hhmm}.png`;

  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Gagal mengonversi capture ke PNG.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  return { filename: downloadName, width: out.width, height: out.height, scale: safeScale };
}

/** Kartu kanan bawah (tata letak overlay): logo + baris info, rata kanan di (right, bottom). */
function drawStamp(d, ctx, k, tokens, logoImg, lines, right, bottom) {
  const pad = 14 * k;
  const logoH = 24 * k;
  const logoW = logoImg && logoImg.naturalHeight > 0 ? (logoImg.naturalWidth / logoImg.naturalHeight) * logoH : 90 * k;
  const textW = Math.max(...lines.map((l, i) => d.measure(l, i === 0 ? 700 : 500, i === 0 ? 13 : 11.5)));
  const w = pad * 2 + logoW + 14 * k + textW;
  const h = Math.max(58 * k, pad * 1.6 + 16 * k + (lines.length - 1) * 16 * k);
  const x = right - w;
  const y = bottom - h;
  d.card(x, y, w, h);
  if (logoImg) ctx.drawImage(logoImg, x + pad, y + (h - logoH) / 2, logoW, logoH);
  else d.text('LUXA', x + pad, y + h / 2 + 6 * k, { w: 800, px: 16 });
  const tx = x + pad + logoW + 14 * k;
  let ty = y + (h - (16 * k + (lines.length - 1) * 16 * k)) / 2 + 12 * k;
  lines.forEach((l, i) => {
    d.text(l, tx, ty, { w: i === 0 ? 700 : 500, px: i === 0 ? 13 : 11.5, color: i === 0 ? tokens.ink : tokens.muted });
    ty += 16 * k;
  });
}

/** Blok info di strip panel: rata kanan di xRight. */
function drawInfoBlock(ctx, d, k, tokens, logoImg, lines, xRight, top, maxW) {
  const logoH = 22 * k;
  const logoW = logoImg && logoImg.naturalHeight > 0 ? (logoImg.naturalWidth / logoImg.naturalHeight) * logoH : 88 * k;
  const fit = (s, w, px) => {
    let t = s;
    while (t.length > 4 && d.measure(t, w, px) > maxW) t = `${t.slice(0, -2)}…`;
    return t;
  };
  // Logo di atas (rata kanan), lalu baris info.
  if (logoImg) ctx.drawImage(logoImg, xRight - logoW, top, logoW, logoH);
  else d.text('LUXA', xRight, top + 16 * k, { w: 800, px: 16, align: 'right' });
  let y = top + logoH;
  lines.forEach((l, i) => {
    const px = i === 0 ? 13 : 11.5;
    const w = i === 0 ? 700 : 500;
    y += (i === 0 ? 20 : 16) * k;
    d.text(fit(l, w, px), xRight, y, { w, px, color: i === 0 ? tokens.ink : tokens.muted, align: 'right' });
  });
}
