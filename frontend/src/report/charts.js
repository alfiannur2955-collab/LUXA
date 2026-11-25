// Diagram laporan (SVG), semuanya dari hasil engine. T = token warna tema laporan.
import { computeSolarPosition } from '../viewer/sundome.js';
import { heatColor } from '../present/heat.js';
import { sideName } from '../present/content.js';

const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = (v) => nf(0).format(Number(v) || 0);
const f1 = (v) => nf(1).format(Number(v) || 0);
const f2 = (v) => nf(2).format(Number(v) || 0);
const R = Math.PI / 180;
const pt = (cx, cy, r, deg) => [cx + r * Math.sin(deg * R), cy - r * Math.cos(deg * R)];
const arc = (cx, cy, r, a0, a1) => {
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const CODE_AZ = { U: 0, TL: 45, T: 90, TGR: 135, TG: 135, S: 180, BD: 225, B: 270, BL: 315 };
export const PATHS = [
  { key: 'w', label: 'Dinding', long: 'Panas lewat dinding', field: 'q_wall_conduction_wm2', color: (T) => T.pWall },
  { key: 'g', label: 'Kaca · konduksi', long: 'Panas lewat kaca (suhu)', field: 'q_glass_conduction_wm2', color: (T) => T.pGlass },
  { key: 's', label: 'Kaca · radiasi', long: 'Sinar matahari lewat kaca', field: 'q_solar_radiation_wm2', color: (T) => T.pSun },
];

/** Cincin konsentris tiga jalur panas (porsi dari OTTV), angka OTTV di tengah. */
export function ringChart(summary, total, T, { size = 220 } = {}) {
  const c = size / 2, w = size * 0.07, gap = size * 0.035;
  const vals = PATHS.map((p) => Number(summary[p.field] || 0));
  const sum = vals.reduce((a, b) => a + b, 0) || 1;
  const rings = PATHS.map((p, i) => {
    const r = c - w / 2 - i * (w + gap);
    const share = vals[i] / sum;
    const end = Math.max(2, share * 300); // 300° penuh, celah 60° di kiri bawah untuk label
    return `<path d="${arc(c, c, r, 0, 300)}" stroke="${T.track}" stroke-width="${w}" fill="none" stroke-linecap="round"/>
      <path d="${arc(c, c, r, 0, end)}" stroke="${p.color(T)}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="ring">${rings}
    <text x="${c}" y="${c - 2}" text-anchor="middle" class="ring-n" fill="${T.ink}">${f2(total)}</text>
    <text x="${c}" y="${c + 16}" text-anchor="middle" class="ring-u" fill="${T.muted}">W/m²</text></svg>`;
}

/** Meteran setengah lingkaran 0–60 W/m² dengan tanda batas SNI. */
export function gauge(value, limit, T, { w = 260 } = {}) {
  const cx = w / 2, cy = w * 0.6, r = w * 0.38, max = Math.max(60, limit * 1.6);
  const ang = (v) => -90 + (Math.min(v, max) / max) * 180;
  const stops = [];
  for (let v = 0; v < max; v += max / 60) stops.push(`<path d="${arc(cx, cy, r, ang(v), ang(v + max / 60) + 0.4)}" stroke="${heatColor(v)}" stroke-width="${w * 0.07}" fill="none"/>`);
  const [lx0, ly0] = pt(cx, cy, r - w * 0.07, ang(limit)), [lx1, ly1] = pt(cx, cy, r + w * 0.07, ang(limit));
  const [nx, ny] = pt(cx, cy, r * 0.82, ang(value));
  return `<svg viewBox="0 0 ${w} ${w * 0.7}" class="gauge">${stops.join('')}
    <line x1="${lx0}" y1="${ly0}" x2="${lx1}" y2="${ly1}" stroke="${T.ink}" stroke-width="2" stroke-dasharray="3 2"/>
    <text x="${pt(cx, cy, r + w * 0.15, ang(limit))[0]}" y="${pt(cx, cy, r + w * 0.15, ang(limit))[1] + 3}" text-anchor="middle" class="tiny b" fill="${T.muted}">batas ${f0(limit)}</text>
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${T.ink}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="${T.ink}"/>
    <text x="${cx - r}" y="${cy + 18}" text-anchor="middle" class="tiny" fill="${T.muted}">0</text>
    <text x="${cx + r}" y="${cy + 18}" text-anchor="middle" class="tiny" fill="${T.muted}">${f0(max)}</text></svg>`;
}

/**
 * Diagram lintasan matahari (proyeksi kutub, utara di atas) dengan cincin luar berwarna OTTV tiap sisi.
 * Lintasan 21 Juni, 21 Maret/23 September, 21 Desember; titik jam 06–18; posisi matahari aktif.
 */
export function sunPath({ lat, sides, date = '2026-09-23', hour = 15 }, T, { size = 360 } = {}) {
  const c = size / 2, rIn = size * 0.36, rOut = size * 0.44;
  const rAlt = (alt) => rIn * (1 - alt / 90);
  const yr = String(date).slice(0, 4);
  const sectors = sides.map((r) => {
    const az = Number.isFinite(r.azimuth_center_deg) ? r.azimuth_center_deg : CODE_AZ[r.code] ?? 0;
    const col = heatColor(r.ottv_orientation_wm2);
    const [tx, ty] = pt(c, c, rOut + size * 0.045, az);
    return `<path d="${arc(c, c, (rIn + rOut) / 2 + 2, az - 21, az + 21)}" stroke="${col}" stroke-width="${rOut - rIn - 6}" fill="none"/>
      <text x="${tx}" y="${ty + 4}" text-anchor="middle" class="tiny b" fill="${T.ink}">${r.code === 'TGR' ? 'TG' : r.code}</text>`;
  }).join('');
  const rings = [0, 30, 60].map((alt) => `<circle cx="${c}" cy="${c}" r="${rAlt(alt)}" fill="none" stroke="${T.line}" stroke-width="${alt ? 0.8 : 1.2}"/>
    ${alt ? `<text x="${c + 3}" y="${c - rAlt(alt) + 10}" class="tiny" fill="${T.muted}">${alt}°</text>` : ''}`).join('');
  const spokes = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const [x, y] = pt(c, c, rIn, a); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="${T.line}" stroke-width="0.6"/>`; }).join('');
  const paths = [[`${yr}-06-21`, '21 Jun'], [`${yr}-03-21`, '21 Mar / 23 Sep'], [`${yr}-12-21`, '21 Des']].map(([d, label], i) => {
    const pts = [];
    for (let h = 5; h <= 19.001; h += 0.25) {
      const s = computeSolarPosition(lat, d, h, 0);
      if (s.altitudeDeg >= 0) pts.push(pt(c, c, rAlt(s.altitudeDeg), s.azimuthDeg));
    }
    const dots = [];
    for (let h = 6; h <= 18; h += 2) {
      const s = computeSolarPosition(lat, d, h, 0);
      if (s.altitudeDeg >= 0) { const [x, y] = pt(c, c, rAlt(s.altitudeDeg), s.azimuthDeg); dots.push(`<circle cx="${x}" cy="${y}" r="2.2" fill="${T.pSun}"/>`); if (i === 1) dots.push(`<text x="${x}" y="${y - 6}" text-anchor="middle" class="tiny" fill="${T.muted}">${h}</text>`); }
    }
    void label;
    return `<path d="M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L')}" fill="none" stroke="${T.pSun}" stroke-width="${i === 1 ? 2 : 1.2}" ${i === 1 ? '' : 'stroke-dasharray="4 3"'} opacity="${i === 1 ? 1 : 0.7}"/>${dots.join('')}`;
  }).join('');
  const s = computeSolarPosition(lat, date, hour, 0);
  const sun = s.altitudeDeg > 0 ? (() => { const [x, y] = pt(c, c, rAlt(s.altitudeDeg), s.azimuthDeg); return `<circle cx="${x}" cy="${y}" r="9" fill="${T.pSun}" opacity="0.25"/><circle cx="${x}" cy="${y}" r="5" fill="${T.pSun}"/>`; })() : '';
  const [nx, ny] = pt(c, c, rOut + size * 0.045, 0);
  return `<svg viewBox="0 0 ${size} ${size}" class="sunpath">
    <circle cx="${c}" cy="${c}" r="${rOut}" fill="none" stroke="${T.line}" stroke-width="0.6"/>${sectors}${rings}${spokes}${paths}${sun}
    <text x="${nx}" y="${ny - 10}" text-anchor="middle" class="tiny" fill="${T.muted}">utara</text></svg>`;
}

/**
 * Potongan dinding satu lantai (gaya gambar kerja): pelat, spandrel berinsulasi, kaca, peneduh bila ada,
 * dengan panah tiga jalur panas sebesar nilainya. side = baris orientation_breakdown, summary = analysis.summary.
 */
export function wallSection(side, summary, T, { w = 420, h = 340 } = {}) {
  const H = Number(summary.floor_height_m) || 4;
  const wwr = Math.min(0.95, Math.max(0.05, Number(side.wwr) || 0.4));
  const mat = summary.active_materials || {};
  const shaded = Number(side.manual_calc?.sc_eff ?? 1) < 0.999;
  const px = (h - 70) / H; // piksel per meter
  const x0 = w * 0.5, top = 34, bot = top + H * px;
  const slab = 0.25 * px;
  const glassH = wwr * (H - 0.25) * px, spH = (H - 0.25) * px - glassH;
  const gTop = top + slab, gBot = gTop + glassH;
  const qs = [Number(side.q_wall_conduction_wm2 || 0), Number(side.q_glass_conduction_wm2 || 0), Number(side.q_solar_radiation_wm2 || 0)];
  const qmax = Math.max(...qs, 1);
  const sw = (q) => 2 + (q / qmax) * 9;
  // panah dari luar ke dinding; angka dan nama jalur ditulis di atas pangkal panah
  const arrow = (x1, y1, x2, y2, col, q, label) => {
    const ang = Math.atan2(y2 - y1, x2 - x1), s = sw(q);
    const hx = x2 - Math.cos(ang) * s * 1.6, hy = y2 - Math.sin(ang) * s * 1.6;
    const px1 = hx + Math.sin(ang) * s * 1.3, py1 = hy - Math.cos(ang) * s * 1.3, px2 = hx - Math.sin(ang) * s * 1.3, py2 = hy + Math.cos(ang) * s * 1.3;
    return `<line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="${col}" stroke-width="${s}" stroke-linecap="round"/>
      <polygon points="${x2},${y2} ${px1},${py1} ${px2},${py2}" fill="${col}"/>
      <text x="${x1}" y="${y1 - s / 2 - 6}" class="sm b" fill="${T.ink}">${f2(q)} <tspan class="tiny" font-weight="400" fill="${T.muted}">${label}</tspan></text>`;
  };
  const hatch = `<pattern id="hx" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${T.muted}" stroke-width="0.7" opacity="0.6"/></pattern>
    <pattern id="ins" width="10" height="8" patternUnits="userSpaceOnUse"><path d="M0 4 Q2.5 0 5 4 T10 4" fill="none" stroke="${T.muted}" stroke-width="0.7" opacity="0.7"/></pattern>`;
  const louver = shaded && Number(mat.louver_depth_m) > 0
    ? (() => { const d = Number(mat.louver_depth_m) * px; return `<rect x="${x0 - d}" y="${gTop - 3}" width="${d}" height="5" fill="${T.ink}" opacity="0.8"/><text x="${x0 - d / 2}" y="${gTop - 8}" text-anchor="middle" class="tiny" fill="${T.muted}">peneduh ${f2(mat.louver_depth_m)} m</text>`; })()
    : '';
  const dim = (x, y1, y2, t) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${T.muted}" stroke-width="0.8"/>
    <line x1="${x - 4}" y1="${y1 + 4}" x2="${x + 4}" y2="${y1 - 4}" stroke="${T.muted}" stroke-width="1"/><line x1="${x - 4}" y1="${y2 + 4}" x2="${x + 4}" y2="${y2 - 4}" stroke="${T.muted}" stroke-width="1"/>
    <text x="${x + 8}" y="${(y1 + y2) / 2 + 4}" class="tiny" fill="${T.muted}">${t}</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" class="section">
    <defs>${hatch}</defs>
    <text x="14" y="${top - 16}" class="tiny b" fill="${T.muted}">LUAR</text><text x="${x0 + 30}" y="${top - 16}" class="tiny b" fill="${T.muted}">DALAM</text>
    <rect x="${x0}" y="${top}" width="${w - x0 - 60}" height="${slab}" fill="url(#hx)" stroke="${T.ink}" stroke-width="1"/>
    <rect x="${x0}" y="${bot - slab}" width="${w - x0 - 60}" height="${slab}" fill="url(#hx)" stroke="${T.ink}" stroke-width="1"/>
    <rect x="${x0 - 3}" y="${gTop}" width="6" height="${glassH}" fill="${T.pGlass}" opacity="0.55" stroke="${T.pGlass}"/>
    <line x1="${x0 - 3}" y1="${gTop}" x2="${x0 - 3}" y2="${gBot}" stroke="${T.ink}" stroke-width="0.8"/><line x1="${x0 + 3}" y1="${gTop}" x2="${x0 + 3}" y2="${gBot}" stroke="${T.ink}" stroke-width="0.8"/>
    <rect x="${x0 - 7}" y="${gBot}" width="14" height="${spH}" fill="url(#ins)" stroke="${T.ink}" stroke-width="1"/>
    ${louver}
    ${dim(w - 40, top, bot, `${f1(H)} m`)}
    ${dim(x0 + 16, gTop, gBot, `kaca ${Math.round(wwr * 100)}%`)}
    ${arrow(14, gTop + 6, x0 - 6, gTop + glassH * 0.45, T.pSun, qs[2], 'sinar matahari')}
    ${arrow(14, gTop + glassH * 0.85, x0 - 6, gTop + glassH * 0.85, T.pGlass, qs[1], 'kaca (suhu)')}
    ${arrow(14, gBot + spH * 0.6, x0 - 10, gBot + spH * 0.6, T.pWall, qs[0], 'dinding')}
    <text x="${x0 + 30}" y="${bot - slab - 30}" class="sm b" fill="${T.ink}">${sideName(side.code)}</text>
    <text x="${x0 + 30}" y="${bot - slab - 14}" class="tiny" fill="${T.muted}">OTTV ${f2(side.ottv_orientation_wm2)} W/m²</text></svg>`;
}

/** Siluet gedung per lantai: tiap lantai satu batang, panjang = OTTV lantai, warna skala panas. */
export function floorStack(floors, limit, T, { w = 300, h = 300 } = {}) {
  const list = [...(floors || [])].sort((a, b) => a.floor_number - b.floor_number);
  if (!list.length) return '';
  const max = Math.max(limit * 1.3, ...list.map((f) => f.ottv_floor_wm2));
  const lw = 34, bw = w - lw - 46, rowH = Math.min(18, (h - 24) / list.length), gap = Math.min(3, rowH * 0.18);
  const bars = list.map((f, i) => {
    const y = h - 20 - (i + 1) * rowH;
    const len = (f.ottv_floor_wm2 / max) * bw;
    return `<rect x="${lw}" y="${y + gap / 2}" width="${len}" height="${rowH - gap}" rx="${Math.min(4, rowH / 3)}" fill="${heatColor(f.ottv_floor_wm2)}"/>
      ${rowH >= 11 || i % Math.ceil(11 / rowH) === 0 ? `<text x="${lw - 6}" y="${y + rowH / 2 + 3}" text-anchor="end" class="tiny" fill="${T.muted}">${f.floor_label}</text>` : ''}
      ${rowH >= 14 ? `<text x="${lw + len + 5}" y="${y + rowH / 2 + 3}" class="tiny" fill="${T.ink}">${f1(f.ottv_floor_wm2)}</text>` : ''}`;
  }).join('');
  const lx = lw + (limit / max) * bw;
  return `<svg viewBox="0 0 ${w} ${h}" class="floors">${bars}
    <line x1="${lx}" y1="4" x2="${lx}" y2="${h - 18}" stroke="${T.ink}" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="${lx}" y="${h - 4}" text-anchor="middle" class="tiny" fill="${T.muted}">batas ${f0(limit)}</text></svg>`;
}

/**
 * Penggaris batas (pengganti meteran): lajur skala panas 0–maks, garis batas SNI, penanda nilai,
 * dan kurung selisih ke batas. Hemat tempat dan langsung menjawab "seberapa jauh dari batas".
 */
export function limitRuler(value, limit, T, { w = 520, h = 74, verdict = null } = {}) {
  const max = Math.max(60, limit * 1.6, value * 1.1), x0 = 8, x1 = w - 8, y = 34, th = 10;
  const X = (v) => x0 + (Math.min(v, max) / max) * (x1 - x0);
  const grad = [0, 0.25, 0.5, 0.75, 1].map((t) => `<stop offset="${t}" stop-color="${heatColor(t * max)}"/>`).join('');
  const xv = X(value), xl = X(limit), under = value <= limit;
  const lo = Math.min(xv, xl), hi = Math.max(xv, xl);
  const isNeutral = verdict === 'simulasi' || verdict === 'sementara';
  const strokeCol = isNeutral ? T.muted : (under ? T.ok : T.fail);
  const deltaTxt = verdict === 'simulasi'
    ? (under ? `Di bawah acuan ${f2(limit - value)} W/m²` : `Di atas acuan ${f2(value - limit)} W/m²`)
    : verdict === 'sementara'
      ? 'Hasil sementara — perlu konfirmasi'
      : (under ? `Di bawah batas ${f2(limit - value)} W/m²` : `Lewat ${f2(value - limit)} W/m²`);
  return `<svg viewBox="0 0 ${w} ${h}" class="ruler"><defs><linearGradient id="rg" x1="0" x2="1">${grad}</linearGradient></defs>
    <rect x="${x0}" y="${y}" width="${x1 - x0}" height="${th}" rx="${th / 2}" fill="url(#rg)"/>
    <line x1="${xl}" y1="${y - 8}" x2="${xl}" y2="${y + th + 8}" stroke="${T.ink}" stroke-width="1.6" stroke-dasharray="3 2"/>
    <text x="${xl}" y="${y - 12}" text-anchor="middle" class="tiny b" fill="${T.ink}">${verdict === 'simulasi' ? `acuan ${f0(limit)}` : `batas ${f0(limit)}`}</text>
    <path d="M${lo} ${y + th + 14} V${y + th + 18} H${hi} V${y + th + 14}" fill="none" stroke="${strokeCol}" stroke-width="1.2"/>
    <text x="${(lo + hi) / 2}" y="${y + th + 30}" text-anchor="middle" class="tiny b" fill="${strokeCol}">${deltaTxt}</text>
    <circle cx="${xv}" cy="${y + th / 2}" r="8" fill="${T.surface}" stroke="${T.ink}" stroke-width="2.4"/>
    <text x="${x0}" y="${y - 12}" class="tiny" fill="${T.muted}">0</text><text x="${x1}" y="${y - 12}" text-anchor="end" class="tiny" fill="${T.muted}">${f0(max)} W/m²</text></svg>`;
}

/**
 * Skema 1 m² fasad (pengganti potongan dinding): petak dibagi kaca dan dinding menurut WWR sisi itu, dengan
 * panah tiga jalur panas sebesar nilainya. Hanya memakai angka yang selalu ada untuk model apa pun
 * (WWR dan tiga suku OTTV), jadi tidak menebak tinggi lantai, letak jendela, atau bentuk peneduh.
 */
export function facadeTile(side, T, { w = 420, h = 250 } = {}) {
  const wwr = Math.min(1, Math.max(0, Number(side.wwr) || 0));
  const S = Math.min(h - 40, w * 0.52), tx = w - S - 12, ty = 20;
  const gH = S * wwr, oH = S - gH;
  const qs = [Number(side.q_wall_conduction_wm2 || 0), Number(side.q_glass_conduction_wm2 || 0), Number(side.q_solar_radiation_wm2 || 0)];
  const qmax = Math.max(...qs, 1), sw = (q) => 2 + (q / qmax) * 10;
  const arrow = (x1, y1, x2, y2, col, q, label) => {
    const ang = Math.atan2(y2 - y1, x2 - x1), s = sw(q);
    const hx = x2 - Math.cos(ang) * s * 1.6, hy = y2 - Math.sin(ang) * s * 1.6;
    const a = [hx + Math.sin(ang) * s * 1.3, hy - Math.cos(ang) * s * 1.3], b = [hx - Math.sin(ang) * s * 1.3, hy + Math.cos(ang) * s * 1.3];
    return `<line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="${col}" stroke-width="${s}" stroke-linecap="round"/>
      <polygon points="${x2},${y2} ${a.join(',')} ${b.join(',')}" fill="${col}"/>
      <text x="${x1}" y="${y1 - s / 2 - 6}" class="sm b" fill="${T.ink}">${f2(q)} <tspan class="tiny" font-weight="400" fill="${T.muted}">${label}</tspan></text>`;
  };
  // titik sasaran selalu di dalam bagiannya; pangkal panah diberi jarak minimum supaya label tidak bertumpuk
  const ySun = ty + gH * 0.3, yGc = ty + gH * 0.75, yW = ty + gH + oH * 0.5;
  const sGc = Math.max(yGc, ty + 62), sW = Math.max(yW, sGc + 46);
  return `<svg viewBox="0 0 ${w} ${h}" class="tile">
    <rect x="${tx}" y="${ty}" width="${S}" height="${gH}" fill="${T.pGlass}" opacity="0.32"/>
    <rect x="${tx}" y="${ty + gH}" width="${S}" height="${oH}" fill="${T.pWall}" opacity="0.32"/>
    <rect x="${tx}" y="${ty}" width="${S}" height="${S}" fill="none" stroke="${T.ink}" stroke-width="1.2"/>
    ${gH > 26 ? `<text x="${tx + S - 8}" y="${ty + 18}" text-anchor="end" class="sm b" fill="${T.ink}">Kaca ${f0(wwr * 100)}%</text>` : ''}
    ${oH > 26 ? `<text x="${tx + S - 8}" y="${ty + S - 10}" text-anchor="end" class="sm b" fill="${T.ink}">Dinding ${f0((1 - wwr) * 100)}%</text>` : ''}
    <text x="${tx + S / 2}" y="${ty + S + 16}" text-anchor="middle" class="tiny" fill="${T.muted}">1 m² fasad · 1 m</text>
    ${wwr > 0 ? arrow(8, ty + 12, tx - 4, ySun, T.pSun, qs[2], 'sinar matahari') : ''}
    ${wwr > 0 ? arrow(8, sGc, tx - 4, yGc, T.pGlass, qs[1], 'kaca (suhu)') : ''}
    ${wwr < 1 ? arrow(8, sW, tx - 4, yW, T.pWall, qs[0], 'dinding') : ''}</svg>`;
}
