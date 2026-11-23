// Keadaan simulasi bersama semua bab + hitungan OTTV (memakai rumus dan tabel yang sama dengan engine).
import { SNI } from '../learn/sniData.js';
import { cityById, facadeOttv, totalOttv } from '../learn/ottvCalc.js';
import { facadeAreas, glassHForWwr } from './tower.js';

export const glassById = (id) => SNI.glass.find((g) => g.id === id) || SNI.glass[0];
export const wallById = (id) => SNI.wall.find((w) => w.id === id) || SNI.wall[0];
export const LIMIT = SNI.ottvLimit;
export const DIRS = ['U', 'T', 'S', 'B'];

export const sim = {
  city: 'jakarta',
  glass: 'glz_kaca_tinted_8',
  wall: 'wal_bata_ringan_aac_100',
  alpha: null, // null = ikut material dinding
  wwr: { U: 0.4, T: 0.4, S: 0.4, B: 0.4 },
  depth: 0.7, // overhang fasad Barat (m)
};

export const sf = () => cityById(sim.city).sf;
export const glassH = (dir) => glassHForWwr(sim.wwr[dir]);
export const effWwr = (dir) => glassH(dir) / 4; // WWR yang benar-benar tergambar di model

export function facade(dir) {
  const w = wallById(sim.wall), g = glassById(sim.glass);
  const R = dir === 'B' ? sim.depth / glassH('B') : 0;
  return {
    ...facadeOttv({ alpha: sim.alpha ?? w.alpha, uw: w.u_value, massa: w.massa_kg_m2, wwr: effWwr(dir), uf: g.u_value, sc: g.sc, sf: sf()[dir], overhangR: R, code: dir }),
    R,
  };
}

export function total() {
  const A = facadeAreas();
  const per = Object.fromEntries(DIRS.map((d) => [d, facade(d)]));
  return { per, ottv: totalOttv(DIRS.map((d) => ({ area: A[d], ottv: per[d].total }))) };
}

export const fmt = (x, d = 0) => Number(x).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (x) => `${fmt(x * 100)}%`;
