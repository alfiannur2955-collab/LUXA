// Daftar slide (spesifikasi P0, Tujuh slide) dan sudut kamera tiap slide.
// Sudut dihitung dari ukuran model, jari-jari kubah, dan hasil per arah. Azimut sisi dari engine adalah
// azimut nyata; kamera memakai azimut model (ditambah sudut utara).
import { facesByHeat, fitDistance, heroPose } from './framing.js';

// wide: kubah matahari terlihat utuh. Slide close up menyembunyikan kubah (bola matahari bisa jatuh di depan
// fasad) dan menunjukkan arah matahari dengan penanda di layar.
export const SLIDE_DEFS = [
  { id: 'sampul', name: 'Sampul', wide: true },
  { id: 'ottv', name: 'Nilai OTTV', wide: true },
  { id: 'sisi', name: 'Panas per sisi', wide: true },
  { id: 'terpanas', name: 'Sisi terpanas', wide: false },
  { id: 'kaca', name: 'Kaca dan peneduh', wide: false },
  { id: 'atap', name: 'Atap (RTTV)', wide: false },
  { id: 'penutup', name: 'Penutup', wide: true },
];

/** Slide yang berlaku untuk hasil ini (atap dilewati bila RTTV tidak berlaku). */
export function slidesFor(analysis) {
  const rttv = analysis?.rttv;
  return SLIDE_DEFS.filter((s) => s.id !== 'atap' || (rttv && rttv.applicable && !rttv.disabled));
}

const wrap = (a) => ((a % 360) + 360) % 360;

/** opts: { bounds, dome (jari-jari), breakdown, north, aspect, fov } -> { [id]: { az, el, dist, target } } */
export function posesFor({ bounds, dome, breakdown, north = 0, aspect = 16 / 9, fov = 14 }) {
  const { center, size } = bounds;
  const hero = heroPose(bounds, breakdown, { fov, aspect });
  const heroAz = wrap(hero.az + north);
  const hot = facesByHeat(breakdown)[0];
  const hotAz = wrap((hot ? hot.az : 270) + north);
  const fit = (r, m) => fitDistance(r, fov, aspect, m);
  const wideR = Math.max(bounds.fit, dome);
  const wideT = [center.x, Math.max(center.y * 0.92, dome * 0.32), center.z];
  const midT = [center.x, center.y, center.z];
  // lebar fasad terpanas: proyeksi tapak tegak lurus arah sisi itu
  const a = hotAz * Math.PI / 180;
  const faceW = Math.abs(size.x * Math.cos(a)) + Math.abs(size.z * Math.sin(a));
  return {
    sampul: { az: heroAz, el: 24, dist: fit(wideR, 1.55), target: wideT },
    ottv: { az: wrap(heroAz + 18), el: 30, dist: fit(Math.max(bounds.fit, dome * 0.8), 1.6), target: wideT },
    sisi: { az: heroAz, el: 58, dist: fit(Math.max(bounds.fit, dome * 0.95), 1.45), target: [center.x, center.y * 0.5, center.z] },
    terpanas: { az: hotAz, el: 10, dist: fit(Math.hypot(faceW, size.y) / 2, 1.7), target: midT },
    kaca: { az: wrap(hotAz + 32), el: 14, dist: fit(Math.max(bounds.radius * 0.7, 4), 1.7), target: midT },
    atap: { az: heroAz, el: 62, dist: fit(bounds.fit * 0.9, 1.6), target: [center.x, size.y, center.z] },
    penutup: { az: wrap(heroAz - 50), el: 22, dist: fit(wideR, 1.7), target: wideT },
  };
}
