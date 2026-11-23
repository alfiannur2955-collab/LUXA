/**
 * Kalkulator sederhana untuk modul Belajar. Rumus dan tabel sama dengan engine
 * (SNI 6389:2020 Pasal 4.3 & 4.4, Tabel 7, 8, 9, A.5–A.8), tanpa kusen dan tanpa
 * bayangan bangunan sendiri.
 */
import { SNI } from './sniData.js';

/** Tabel 7: TDek dinding dari berat (kg/m²). */
export function tdekWall(massa) {
  const m = Number(massa);
  if (m < 125) return 15;
  if (m <= 195) return 12;
  return 10;
}

/** Tabel 9: TDek atap dari berat (kg/m²). */
export function tdekRoof(massa) {
  const m = Number(massa);
  if (m < 50) return 24;
  if (m <= 230) return 20;
  return 16;
}

/** SC efektif peneduh horizontal (overhang) untuk rasio R = kedalaman / tinggi jendela. */
export function sceffHorizontal(code, r) {
  const arr = SNI.sceffHorizontal[code] || SNI.sceffHorizontal.U;
  const x = Math.max(0, Math.min(2, Number(r) || 0)) * 10;
  const i0 = Math.floor(x);
  const i1 = Math.min(arr.length - 1, i0 + 1);
  const t = x - i0;
  return arr[i0] + (arr[i1] - arr[i0]) * t;
}

export function cityById(id) {
  return SNI.cities.find((c) => c.id === id) || SNI.cities.find((c) => c.id === 'jakarta') || SNI.cities[0];
}

/**
 * OTTV satu sisi fasad (W/m²):
 * OTTV = α·Uw·(1 − WWR)·TDek + Uf·WWR·ΔT + SC·WWR·SF
 */
export function facadeOttv({ alpha, uw, massa, wwr, uf, sc, sf, overhangR = 0, code = 'U' }) {
  const w = Math.max(0, Math.min(1, Number(wwr) || 0));
  const td = tdekWall(massa);
  const scEff = sc * sceffHorizontal(code, overhangR);
  const qWall = alpha * uw * (1 - w) * td;
  const qGlass = uf * w * SNI.deltaT;
  const qSolar = scEff * w * sf;
  return { qWall, qGlass, qSolar, total: qWall + qGlass + qSolar, tdek: td, scEff, scFactor: sceffHorizontal(code, overhangR) };
}

/** OTTV total = rata-rata tertimbang luas dari tiap sisi. */
export function totalOttv(sides) {
  let sumA = 0;
  let sumQ = 0;
  for (const s of sides) {
    sumA += s.area;
    sumQ += s.area * s.ottv;
  }
  return sumA > 0 ? sumQ / sumA : 0;
}

/**
 * RTTV (Pasal 4.4.2.1):
 * RTTV = [α·Ar·Ur·TDek + As·Us·ΔT + As·SC·SF] / (Ar + As)
 */
export function rttv({ alpha, ur, massa, areaRoof, skyRatio, us, sc, sfRoof }) {
  const ao = Math.max(0, areaRoof);
  const as = ao * Math.max(0, Math.min(1, skyRatio));
  const ar = ao - as;
  const td = tdekRoof(massa);
  const qRoof = ao > 0 ? (alpha * ar * ur * td) / ao : 0;
  const qCond = ao > 0 ? (as * us * SNI.deltaT) / ao : 0;
  const qSolar = ao > 0 ? (as * sc * sfRoof) / ao : 0;
  const total = qRoof + qCond + qSolar;
  const limit = as > 0 ? SNI.rttvLimitSky : SNI.rttvLimitOpaque;
  return { qRoof, qCond, qSolar, total, tdek: td, limit, as, ar };
}
