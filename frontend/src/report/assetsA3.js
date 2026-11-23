// Gambar laporan A3: isometri ringkasan, tampak sisi terpanas, isometri penunjuk, fasad terbentang.
// Semua proyeksi sejajar (fov 1°), dirender lewat panggung Mode Presentasi tanpa langit.
import { createPresenter } from '../present/presenter.js';
import { renderFacades } from './facade.js';
import { buildMockup } from './mockupA3.js';
import { sidesOf } from '../present/content.js';
import { dirFrom } from '../learn3d/stage.js';

/** state butuh analysisData, config.roles, config.settings, materials. orient: 'land' | 'port'. */
export async function captureReportAssets(state, { theme = 'light', orient = 'land' } = {}) {
  const port = orient === 'port';
  const { analysisData, config: { roles, settings } = {} } = state;
  const bg = theme === 'dark' ? '#17181B' : '#FFFFFF';
  const north = Number(settings?.north_angle_deg || 0);
  const sides = sidesOf(analysisData);
  const hot = [...sides].sort((x, y) => y.ottv_orientation_wm2 - x.ottv_orientation_wm2)[0];
  const ISO_EL = 35.264; // isometri: arah pandang sepanjang diagonal kubus

  function cap(w, h, fn, { sky = false } = {}) {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-${w + 300}px;top:0;width:${w}px;height:${h}px;overflow:hidden;`;
    document.body.appendChild(host);
    const p = createPresenter({ host, state, appTheme: theme, capture: true, pixelRatio: 1, background: bg, fov: 1, sky, shadow: 0.35 });
    const r = fn(p); p.destroy(); host.remove(); return r;
  }
  // sumbu utama denah dari tepi horizontal panel dinding (rata-rata melingkar 4θ, berbobot luas), supaya isometri
  // selalu memandang diagonal gedung walau gedungnya diputar terhadap utara
  function planAxis() {
    let sx = 0, sy = 0;
    for (const pn of analysisData.panels || []) {
      const vs = pn.vertices;
      if (!pn.active || !Array.isArray(vs) || vs.length < 3 || Math.abs((Number(pn.tilt_deg) || 90) - 90) > 20) continue;
      for (let i = 0; i < vs.length; i++) {
        const p0 = vs[i], p1 = vs[(i + 1) % vs.length], dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
        if (len < 1e-6 || Math.abs(p1[2] - p0[2]) > len * 0.3) continue;
        const t = 4 * Math.atan2(dx, dy);
        sx += Math.cos(t) * len; sy += Math.sin(t) * len;
      }
    }
    return sx || sy ? ((Math.atan2(sy, sx) / 4) * 180) / Math.PI : 0;
  }
  const axis = planAxis();
  const hotAz = ((Number(hot.azimuth_center_deg) || 0) + north + 360) % 360;
  const isoAz = [45, 135, 225, 315].map((a) => (a + axis + north + 720) % 360).sort((a, b) => Math.abs(((a - hotAz + 540) % 360) - 180) - Math.abs(((b - hotAz + 540) % 360) - 180))[0];
  const PAGE = port ? [2100, 2970] : [2970, 2100];

  const iso = cap(...PAGE, (p) => {
    const b = p.bounds, c = [b.center.x, 0, b.center.z], L = b.footprint;
    const n = dirFrom(north, 0);
    const sd = dirFrom(p.sun.azModel, 0);
    return p.shot('sampul', { labels: true, heat: true, dome: false, pose: { az: isoAz, el: ISO_EL }, ...(port ? { fit: { h: 0.34, w: 0.62 }, shiftRight: 0.08, shiftUp: 0.13 } : { fit: { h: 0.56, w: 0.34 }, shiftRight: 0.15, shiftUp: 0.05 }),
      project: [c, [c[0] + n.x * L, 0, c[2] + n.z * L], [c[0] + sd.x * L, 0, c[2] + sd.z * L]] });
  });
  const elev = cap(...PAGE, (p) => {
    const b = p.bounds, s = analysisData.summary;
    // satu level per lantai (bukan disampel di sini): penipisan dilakukan di halaman berdasarkan jarak nyata di kertas
    const byNo = new Map();
    for (const f of analysisData.floor_breakdown || []) if (Number.isFinite(Number(f.z_min)) && !byNo.has(f.floor_number)) byNo.set(f.floor_number, f);
    const levels = [...byNo.values()].sort((a, z) => a.z_min - z.z_min)
      .map((f) => ({ label: String(f.floor_label || `L${f.floor_number}`), z: f.z_min - (s.z_min_m || 0) }))
      .filter((l) => l.z >= -50 && l.z < b.size.y - 0.01);
    levels.push({ label: 'Puncak', z: b.size.y, top: true });
    // siluet asli dari titik panel (sama dengan pergeseran maket), diukur sepanjang sumbu kanan pengamat
    const a = hotAz * Math.PI / 180, rx = -Math.cos(a), rz = -Math.sin(a);
    const bb = s.bounding_box, o = bb ? [bb.center[0], bb.center[1], bb.min[2]] : [0, 0, 0];
    let lo = Infinity, hi = -Infinity, pLo = null, pHi = null;
    for (const pn of analysisData.panels || []) {
      if (!pn.active || !Array.isArray(pn.vertices)) continue;
      for (const vt of pn.vertices) {
        const x = vt[0] - o[0], z = -(vt[1] - o[1]), d = x * rx + z * rz;
        if (d < lo) { lo = d; pLo = [x, 0, z]; }
        if (d > hi) { hi = d; pHi = [x, 0, z]; }
      }
    }
    if (!pLo) { lo = -b.size.x / 2; hi = b.size.x / 2; pLo = [b.center.x + rx * lo, 0, b.center.z + rz * lo]; pHi = [b.center.x + rx * hi, 0, b.center.z + rz * hi]; }
    const r = p.shot('terpanas', { pose: { az: hotAz, el: 0 }, heat: false, dome: false, context: false, ...(port ? { fit: { h: 0.21, w: 0.5 }, shiftRight: 0.02, shiftUp: 0.2 } : { fit: { h: 0.58, w: 0.36 }, shiftRight: 0.13, shiftUp: 0.09 }),
      project: [pLo, pHi, [b.center.x, b.size.y, b.center.z], [b.center.x, 0, b.center.z], ...levels.map((l) => [b.center.x, l.z, b.center.z])] });
    return { ...r, levels, faceW: hi - lo, height: b.size.y };
  });
  const key = cap(1200, 900, (p) => p.shot('sampul', { pose: { az: isoAz, el: ISO_EL }, dome: false, context: false, fit: { h: 0.78, w: 0.7 },
    heat: (code) => (code === (hot.code === 'TG' ? 'TGR' : hot.code) ? p.heatColor(hot.ottv_orientation_wm2) : theme === 'dark' ? '#6E6F78' : '#DEDAD3') }));
  const facades = renderFacades(analysisData, roles, { theme, width: 2400, height: 520 });

  // Tone mapping menekan putih jadi abu sangat muda: ratakan ulang supaya latar gambar = putih halaman.
  async function whiten(src) {
    if (theme === 'dark') return src;
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    const ref = [px[0], px[1], px[2]];
    if (Math.min(...ref) < 240) return src;
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, (px[i + k] * 255) / Math.max(1, ref[k]));
    g.putImageData(d, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  }
  // sampul: pose isometri yang sama, dengan burung (tanpa awan 3D; awan diberikan sebagai tekstur di tirai)
  const cover = cap(...PAGE, (p) => p.shot('sampul', { heat: true, dome: false, birdsInView: true, pose: { az: isoAz, el: ISO_EL },
    ...(port ? { fit: { h: 0.34, w: 0.62 }, shiftRight: 0.08, shiftUp: 0.04 } : { fit: { h: 0.56, w: 0.34 }, shiftRight: 0.15, shiftUp: 0.05 }) }), { sky: 'birds' });
  const coverImg = await whiten(typeof cover === 'string' ? cover : cover?.img);
  iso.img = await whiten(iso.img);
  elev.img = await whiten(elev.img);
  const keyImg = await whiten(key);
  return { iso, elev, key: keyImg, cover: coverImg, clouds: cloudTexture(PAGE[0], PAGE[1], theme === 'dark'), facades, pageW: PAGE[0], sunText: `${state.sunHour ?? 15}.00` };
}

/** Tekstur awan lembut (PNG tembus) untuk tirai gradasi sampul: gumpalan acak berlapis, seragam dengan acuan benih. */
function cloudTexture(w, h, dark) {
  const s = 0.5, W = Math.round(w * s), H = Math.round(h * s);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const col = dark ? '58,59,66' : '255,255,255';
  // gugus awan: tiap gugus = banyak gumpalan bulat yang saling menumpuk
  for (let k = 0; k < 26; k++) {
    const cx = rnd() * W, cy = rnd() * H, spread = (0.06 + rnd() * 0.12) * W;
    for (let i = 0; i < 18; i++) {
      const x = cx + (rnd() - 0.5) * spread * 2, y = cy + (rnd() - 0.5) * spread * 0.7, r = spread * (0.25 + rnd() * 0.45);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const a = dark ? 0.18 + rnd() * 0.12 : 0.32 + rnd() * 0.25;
      gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(0.6, `rgba(${col},${a * 0.45})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  return c.toDataURL('image/png');
}

/** HTML laporan lengkap (siap dicetak ke PDF lewat dialog cetak peramban). */
export async function buildReportHtml(state, { theme = 'light', orient = 'land', logoUrl = '', userName = '' } = {}) {
  const assets = await captureReportAssets(state, { theme, orient });
  return buildMockup(state, { assets, theme, orient, logoUrl, userName });
}
