// "Fasad terbentang": tiap sisi gedung dibuka menjadi tampak datar berjajar, tiap panel diwarnai OTTV panelnya.
// Digambar di kanvas (model besar bisa puluhan ribu panel), hasil gambar PNG + posisi label tiap sisi.
import { heatColor } from '../present/heat.js';


export function renderFacades(analysis, roles, { theme = 'light', width = 2400, height = 700 } = {}) {
  const disabled = new Set(roles?.disabled_groups || []);
  const bb = analysis?.summary?.bounding_box;
  const cx = bb ? bb.center[0] : 0, cy = bb ? bb.center[1] : 0;
  const panels = (analysis?.panels || []).filter((p) => p.active && !disabled.has(p.group_name) && p.vertices?.length && Math.abs(Number(p.tilt_deg ?? 90) - 90) < 60);
  if (!panels.length) return null;
  // Bukaan silinder: sumbu u = azimut dari utara searah jarum jam (dibaca dari luar: kiri ke kanan = U, T, S, B),
  // dikali jari-jari rata-rata supaya skala horizontal mendekati meter; sumbu z = tinggi.
  const azOf = (x, y) => ((Math.atan2(x - cx, y - cy) * 180) / Math.PI + 360) % 360;
  let rSum = 0, rN = 0, z0 = Infinity, z1 = -Infinity;
  for (const p of panels) for (const v of p.vertices) { rSum += Math.hypot(v[0] - cx, v[1] - cy); rN++; z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); }
  const rAvg = rSum / rN || 1;
  const circ = 2 * Math.PI * rAvg;
  const polys = panels.map((p) => {
    const ce = p.centroid || p.vertices[0];
    const a0 = azOf(ce[0], ce[1]);
    const pts = p.vertices.map((v) => {
      let a = azOf(v[0], v[1]);
      if (a - a0 > 180) a -= 360; else if (a0 - a > 180) a += 360; // panel di garis sambung tidak terbelah
      return [(a / 360) * circ, v[2]];
    });
    return { pts, c: heatColor(p.ottv_panel_wm2) };
  });
  const pad = 16;
  const scale = Math.min((width - pad * 2) / circ, (height - pad * 2) / (z1 - z0));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(circ * scale + pad * 2); cv.height = Math.ceil((z1 - z0) * scale + pad * 2);
  const g = cv.getContext('2d');
  const line = theme === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.55)';
  for (const p of polys) {
    for (const shift of [0, -circ, circ]) { // panel yang melewati 0°/360° digambar juga di sisi seberang
      g.beginPath();
      p.pts.forEach(([u, z], i) => { const X = pad + (u + shift) * scale, Y = cv.height - pad - (z - z0) * scale; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
      g.closePath(); g.fillStyle = p.c; g.fill();
      if (polys.length < 3000) { g.strokeStyle = line; g.lineWidth = 0.6; g.stroke(); }
    }
  }
  const breakdown = (analysis.orientation_breakdown || []).filter((r) => Number(r.total_area_m2) > 1e-6);
  const labels = breakdown.map((r) => ({ code: r.code === 'TG' ? 'TGR' : r.code, x: ((pad + (Number(r.azimuth_center_deg) / 360) * circ * scale) / cv.width) * 100, v: r.ottv_orientation_wm2 }));
  return { img: cv.toDataURL('image/png'), labels, aspect: cv.width / cv.height };
}
