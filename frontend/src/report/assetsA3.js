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

  // Satu panggung untuk semua gambar (dulu empat panggung terpisah yang masing-masing memuat ulang model dan
  // konteks kota): jauh lebih ringan di laptop. Jeda singkat antar gambar supaya halaman tetap responsif.
  const PAGE = port ? [1680, 2376] : [2376, 1680]; // ±145 dpi di A3, cukup tajam untuk cetak
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${PAGE[0] + 300}px;top:0;width:${PAGE[0]}px;height:${PAGE[1]}px;overflow:hidden;`;
  document.body.appendChild(host);
  const pres = createPresenter({ host, state, appTheme: theme, capture: true, pixelRatio: 1, background: bg, fov: 1, sky: 'birds', shadow: 0.35 });
  const breathe = () => new Promise((r) => setTimeout(r, 30));
  async function cap(fn) { await breathe(); return fn(pres); }
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

  try {
  const iso = await cap((p) => {
    const b = p.bounds, c = [b.center.x, 0, b.center.z], L = b.footprint;
    const n = dirFrom(north, 0);
    const sd = dirFrom(p.sun.azModel, 0);
    return p.shot('sampul', { labels: true, heat: true, dome: false, skyOn: false, quality: 0.86, pose: { az: isoAz, el: ISO_EL }, ...(port ? { fit: { h: 0.34, w: 0.62 }, shiftRight: 0.08, shiftUp: 0.13 } : { fit: { h: 0.56, w: 0.34 }, shiftRight: 0.15, shiftUp: 0.05 }),
      project: [c, [c[0] + n.x * L, 0, c[2] + n.z * L], [c[0] + sd.x * L, 0, c[2] + sd.z * L]] });
  });
  const elev = await cap((p) => {
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
    const r = p.shot('terpanas', { pose: { az: hotAz, el: 0 }, heat: false, dome: false, context: false, skyOn: false, quality: 0.86, ...(port ? { fit: { h: 0.21, w: 0.5 }, shiftRight: 0.02, shiftUp: 0.2 } : { fit: { h: 0.58, w: 0.36 }, shiftRight: 0.13, shiftUp: 0.09 }),
      project: [pLo, pHi, [b.center.x, b.size.y, b.center.z], [b.center.x, 0, b.center.z], ...levels.map((l) => [b.center.x, l.z, b.center.z])] });
    return { ...r, levels, faceW: hi - lo, height: b.size.y };
  });
  // isometri penunjuk: dirender di bingkai halaman lalu dipotong 4:3 di tengah dan diperkecil
  const keyFull = await cap((p) => p.shot('sampul', { pose: { az: isoAz, el: ISO_EL }, dome: false, context: false, skyOn: false, quality: 0.9,
    fit: { h: 0.78 * (Math.min(PAGE[1], PAGE[0] * 0.75) / PAGE[1]), w: 0.7 * Math.min(1, (PAGE[1] * 4 / 3) / PAGE[0]) },
    heat: (code) => (code === (hot.code === 'TG' ? 'TGR' : hot.code) ? p.heatColor(hot.ottv_orientation_wm2) : theme === 'dark' ? '#6E6F78' : '#DEDAD3') }));
  const facades = renderFacades(analysisData, roles, { theme, width: 2400, height: 520 });

  // sampul: pose isometri yang sama, dengan burung
  await breathe();
  const cover = pres.shot('sampul', { heat: true, dome: false, birdsInView: true, quality: 0.9, pose: { az: isoAz, el: ISO_EL },
    ...(port ? { fit: { h: 0.34, w: 0.62 }, shiftRight: 0.08, shiftUp: 0.04 } : { fit: { h: 0.56, w: 0.34 }, shiftRight: 0.15, shiftUp: 0.05 }) });
  pres.destroy(); host.remove();

  const dark = theme === 'dark';
  await breathe();
  const coverImg = await finishImage(cover, { dark, bg, port, cover: true });
  await breathe();
  iso.img = await finishImage(iso.img, { dark, bg, port });
  elev.img = await finishImage(elev.img, { dark, bg, port });
  const keyImg = await cropKey(keyFull, dark);
  return { iso, elev, key: keyImg, cover: coverImg, facades, pageW: PAGE[0], sunText: `${state.sunHour ?? 15}.00` };
  } catch (err) {
    try { pres.destroy(); } catch { /* sudah dilepas */ }
    host.remove();
    throw err;
  }
}

const loadImg = async (src) => { const im = new Image(); im.src = src; await im.decode(); return im; };

/**
 * Rapikan gambar latar halaman dalam satu lintasan kanvas:
 * 1) tema terang: tone mapping menekan putih jadi abu sangat muda, jadi latar diratakan ulang ke putih halaman;
 * 2) semua tepi dileburkan lembut ke warna halaman (tanpa potongan keras di tepi kertas);
 * 3) sampul: tirai gradasi dan tekstur awan tipis ikut dilebur ke gambar (tanpa lapisan masker CSS yang berat saat dicetak).
 */
async function finishImage(src, { dark, bg, port, cover = false }) {
  const im = await loadImg(src);
  const W = im.width, H = im.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  if (!dark) {
    const d = g.getImageData(0, 0, W, H), px = d.data;
    const ref = [px[0], px[1], px[2]];
    if (Math.min(...ref) >= 240) {
      const k = ref.map((r) => 255 / Math.max(1, r));
      for (let i = 0; i < px.length; i += 4) { px[i] = Math.min(255, px[i] * k[0]); px[i + 1] = Math.min(255, px[i + 1] * k[1]); px[i + 2] = Math.min(255, px[i + 2] * k[2]); }
      g.putImageData(d, 0, 0);
    }
  }
  const [r, gg, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  const col = (a) => `rgba(${r},${gg},${b},${a})`;
  // tirai satu sisi: stops = [[posisi 0..1 dari tepi, alfa], ...]
  const side = (ctx, edge, stops) => {
    const [x0, y0, x1, y1] = { l: [0, 0, W, 0], r: [W, 0, 0, 0], t: [0, 0, 0, H], b: [0, H, 0, 0] }[edge];
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [p, a] of stops) gr.addColorStop(p, col(a));
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  };
  // tepi halus di keempat sisi
  const fy = (0.09 * Math.min(W, H)) / H, fx = (0.09 * Math.min(W, H)) / W; // tepi halus ±9% sisi terpendek
  side(g, 'l', [[0, 1], [fx, 0]]); side(g, 'r', [[0, 1], [fx, 0]]);
  side(g, 't', [[0, 1], [fy, 0]]); side(g, 'b', [[0, 1], [fy, 0]]);
  if (cover) {
    // tirai sampul (sama dengan tirai CSS halaman lain), digambar di kanvas terpisah supaya bisa jadi masker awan
    const v = document.createElement('canvas'); v.width = W; v.height = H;
    const vg = v.getContext('2d');
    if (port) {
      side(vg, 't', [[0, 1], [0.16, 0.8], [0.3, 0]]); side(vg, 'b', [[0, 1], [0.36, 1], [0.41, 0.8], [0.5, 0]]);
      side(vg, 'l', [[0, 1], [0.1, 0]]); side(vg, 'r', [[0, 1], [0.1, 0]]);
    } else {
      side(vg, 'l', [[0, 1], [0.3, 0.8], [0.46, 0]]); side(vg, 'b', [[0, 1], [0.14, 1], [0.24, 0.8], [0.36, 0]]);
      side(vg, 'r', [[0, 1], [0.14, 0]]); side(vg, 't', [[0, 1], [0.16, 0]]);
    }
    // awan tipis hanya di peralihan tirai (bukan di bidang teks yang pejal, bukan di atas gedung)
    const cl = cloudLayer(W, H, dark);
    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const mg = m.getContext('2d');
    mg.drawImage(v, 0, 0);
    // masker = tirai yang belum pejal: tekan bagian pejal supaya awan hanya muncul di zona peralihan
    const md = mg.getImageData(0, 0, W, H), mp = md.data;
    for (let i = 3; i < mp.length; i += 4) { const a = mp[i] / 255; mp[i] = Math.round(255 * Math.max(0, 4 * a * (1 - a))); }
    mg.putImageData(md, 0, 0);
    const cg = cl.getContext('2d');
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(m, 0, 0, cl.width, cl.height);
    g.drawImage(v, 0, 0);
    g.drawImage(cl, 0, 0, W, H);
  }
  return c.toDataURL('image/jpeg', 0.86);
}

/** Potong isometri penunjuk 4:3 di tengah, perkecil ke 1200×900, ratakan putih latar (tema terang). */
async function cropKey(src, dark) {
  const im = await loadImg(src);
  const h = Math.min(im.height, im.width * 0.75), w = h * 4 / 3;
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, (im.width - w) / 2, (im.height - h) / 2, w, h, 0, 0, 1200, 900);
  if (!dark) {
    const d = g.getImageData(0, 0, 1200, 900), px = d.data;
    const ref = [px[0], px[1], px[2]];
    if (Math.min(...ref) >= 240) for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, (px[i + k] * 255) / Math.max(1, ref[k]));
    g.putImageData(d, 0, 0);
  }
  return c.toDataURL('image/jpeg', 0.9);
}

/** Tekstur awan tipis (kanvas tembus, setengah resolusi): gugus gumpalan bulat dengan benih tetap. */
function cloudLayer(w, h, dark) {
  const W = Math.round(w / 2), H = Math.round(h / 2);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const col = dark ? '44,45,51' : '236,233,227';
  for (let k = 0; k < 16; k++) {
    const cx = rnd() * W, cy = rnd() * H, spread = (0.05 + rnd() * 0.09) * W;
    for (let i = 0; i < 12; i++) {
      const x = cx + (rnd() - 0.5) * spread * 2, y = cy + (rnd() - 0.5) * spread * 0.6, r = spread * (0.25 + rnd() * 0.4);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const a = dark ? 0.1 + rnd() * 0.08 : 0.22 + rnd() * 0.14;
      gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(0.6, `rgba(${col},${a * 0.4})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  return c;
}

/** HTML laporan lengkap (siap dicetak ke PDF lewat dialog cetak peramban). */
export async function buildReportHtml(state, { theme = 'light', orient = 'land', logoUrl = '', userName = '' } = {}) {
  const assets = await captureReportAssets(state, { theme, orient });
  return buildMockup(state, { assets, theme, orient, logoUrl, userName });
}
