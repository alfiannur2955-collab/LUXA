// Aturan kamera Mode Presentasi (spesifikasi P0, Aturan kamera). Semua sudut dihitung dari ukuran model
// dan hasil per arah, jadi pas untuk kotak kecil maupun menara tinggi.
const AZ = { U: 0, TL: 45, T: 90, TGR: 135, TG: 135, S: 180, BD: 225, B: 270, BL: 315 };
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** Sisi yang punya luas, urut dari OTTV tertinggi. */
export function facesByHeat(breakdown) {
  return (breakdown || [])
    .filter((r) => Number(r.total_area_m2) > 1e-6)
    .map((r) => ({ code: r.code, az: Number.isFinite(r.azimuth_center_deg) ? r.azimuth_center_deg : AZ[r.code] ?? 0, ottv: Number(r.ottv_orientation_wm2) || 0, area: Number(r.total_area_m2) }))
    .sort((a, b) => b.ottv - a.ottv);
}

// Jarak supaya bola pembungkus model masuk bingkai (lensa tele 14°). margin 1,7: model mengisi ±60% tinggi layar.
export function fitDistance(radius, fovDeg = 14, aspect = 16 / 9, margin = 1.7) {
  const v = (fovDeg / 2) * Math.PI / 180;
  const h = Math.atan(Math.tan(v) * Math.min(1, aspect));
  return (radius / Math.sin(Math.min(v, h))) * margin;
}

/** Sudut tiga perempat: di antara sisi terpanas dan tetangga terpanasnya. */
export function heroPose(bounds, breakdown, { fov = 14, aspect = 16 / 9 } = {}) {
  const faces = facesByHeat(breakdown);
  let az = 315;
  if (faces.length) {
    const h = faces[0];
    const near = faces.slice(1).filter((f) => angDiff(f.az, h.az) <= 90 + 1e-6).sort((a, b) => b.ottv - a.ottv || angDiff(a.az, h.az) - angDiff(b.az, h.az));
    if (near.length) {
      const n = near[0];
      const d = ((((n.az - h.az) % 360) + 540) % 360) - 180;
      az = h.az + d / 2;
      if (Math.abs(d) < 60) az = h.az + Math.sign(d || 1) * 35; // sisi berdekatan (45°): tetap tiga perempat
    } else az = h.az + 40;
  }
  return { az: ((az % 360) + 360) % 360, el: 27, dist: fitDistance(bounds.fit ?? bounds.radius, fov, aspect), target: [bounds.center.x, bounds.center.y * 0.92, bounds.center.z] };
}

/** Sisi terpanas tegak lurus, rendah: mata pengamat melihat fasad itu penuh. */
export function sidePose(bounds, breakdown, { fov = 14, aspect = 16 / 9 } = {}) {
  const h = facesByHeat(breakdown)[0];
  const az = h ? h.az : 270;
  const { size, center } = bounds;
  // lebar fasad kira-kira = proyeksi tapak ke arah tegak lurus sisi itu
  const a = az * Math.PI / 180;
  const width = Math.abs(size.x * Math.cos(a)) + Math.abs(size.z * Math.sin(a));
  return { az, el: 10, dist: fitDistance(Math.hypot(width, size.y) / 2, fov, aspect), target: [center.x, center.y, center.z] };
}
