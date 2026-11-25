// Satu sumber kebenaran untuk status 4 kondisi (A3-16):
//   "memenuhi" | "melebihi" | "simulasi" | "sementara"
// Semua tampilan & laporan (Hasil, Presentasi, Laporan A4/A3/Mockup) wajib membaca
// `verdict` dari engine, bukan `compliant` atau `ottv <= 35`.

const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 2) => nf(d).format(Number(v) || 0);

/** Membaca verdict 4 kondisi dari hasil engine (dengan fallback aman untuk berkas lama). */
export function getVerdict(analysis) {
  const raw = analysis?.verdict || analysis?.summary?.verdict;
  if (raw === 'memenuhi' || raw === 'melebihi' || raw === 'simulasi' || raw === 'sementara') {
    return raw;
  }
  if (analysis?.summary?.is_provisional) return 'sementara';
  if (String(analysis?.calculation_mode || 'sni').toLowerCase() !== 'sni') return 'simulasi';
  const ottv = Number(analysis?.ottv_total_wm2 || 0);
  const limit = Number(analysis?.sni_limit_wm2 || 35);
  return ottv <= limit ? 'memenuhi' : 'melebihi';
}

/**
 * Selisih bertanda ke batas SNI (tanpa Math.abs buta).
 * - SNI memenuhi -> "Di bawah batas X W/m²"
 * - SNI melebihi -> "Lewat X W/m²"
 * - Simulasi -> keterangan netral pembanding (tidak pernah memuat kata "Melebihi"/"Lewat"/"Memenuhi")
 * - Sementara -> keterangan perlu konfirmasi (tidak memuat "Melebihi"/"Lewat"/"Memenuhi")
 */
export function formatSignedLimitDelta(ottv, limit, verdict, decimals = 2) {
  const o = Number(ottv) || 0;
  const lim = Number(limit) || 35;
  const diff = o - lim; // > 0 di atas batas, <= 0 di bawah batas

  if (verdict === 'simulasi') {
    if (diff <= 0) {
      const under = lim - o;
      return {
        diff,
        label: 'Pembanding batas SNI',
        short: `Di bawah acuan ${fmt(under, decimals)} W/m²`,
        sentence: `Mode simulasi (bukan untuk kepatuhan). Nilai ini ${fmt(under, decimals)} W/m² di bawah acuan ${fmt(lim, 0)} W/m².`,
      };
    }
    const above = o - lim;
    return {
      diff,
      label: 'Pembanding batas SNI',
      short: `Di atas acuan ${fmt(above, decimals)} W/m²`,
      sentence: `Mode simulasi (bukan untuk kepatuhan). Nilai ini ${fmt(above, decimals)} W/m² di atas acuan ${fmt(lim, 0)} W/m².`,
    };
  }

  if (verdict === 'sementara') {
    return {
      diff,
      label: 'Status verifikasi',
      short: 'Perlu konfirmasi',
      sentence: `Hasil masih sementara — konfirmasi model dan material terlebih dahulu sebelum dibandingkan dengan batas ${fmt(lim, 0)} W/m².`,
    };
  }

  if (diff <= 0) {
    const under = lim - o;
    return {
      diff,
      label: 'Di bawah batas',
      short: `Di bawah batas ${fmt(under, decimals)} W/m²`,
      sentence: `Di bawah batas ${fmt(lim, 0)} W/m² sebesar ${fmt(under, decimals)} W/m².`,
    };
  }

  const over = o - lim;
  return {
    diff,
    label: 'Lewat batas',
    short: `Lewat ${fmt(over, decimals)} W/m²`,
    sentence: `Lewat ${fmt(over, decimals)} W/m² dari batas ${fmt(lim, 0)} W/m².`,
  };
}

/** Paket label, kelas warna, judul, dan selisih untuk 4 kondisi verdict. */
export function verdictInfo(analysis, decimals = 2) {
  const verdict = getVerdict(analysis);
  const ottv = Number(analysis?.ottv_total_wm2 || 0);
  const limit = Number(analysis?.sni_limit_wm2 || 35);
  const delta = formatSignedLimitDelta(ottv, limit, verdict, decimals);

  if (verdict === 'memenuhi') {
    return {
      verdict,
      isSniFinal: true,
      isOk: true,
      isFail: false,
      isSim: false,
      isProv: false,
      tone: 'ok',
      chipClass: 'st-ok',
      pillClass: 'ok',
      statusClass: 'is-ok',
      badge: 'Memenuhi',
      badgeLong: `Memenuhi (≤ ${fmt(limit, 0)} W/m²)`,
      headline: 'Gedung ini memenuhi batas SNI 6389:2020',
      delta,
    };
  }
  if (verdict === 'melebihi') {
    return {
      verdict,
      isSniFinal: true,
      isOk: false,
      isFail: true,
      isSim: false,
      isProv: false,
      tone: 'fail',
      chipClass: 'st-fail',
      pillClass: 'fail',
      statusClass: 'is-fail',
      badge: 'Melebihi',
      badgeLong: `Melebihi batas ${fmt(limit, 0)} W/m²`,
      headline: 'OTTV gedung ini melebihi batas SNI 6389:2020',
      delta,
    };
  }
  if (verdict === 'simulasi') {
    return {
      verdict,
      isSniFinal: false,
      isOk: false,
      isFail: false,
      isSim: true,
      isProv: false,
      tone: 'neutral',
      chipClass: 'st-neutral',
      pillClass: 'neutral',
      statusClass: 'is-neutral',
      badge: 'Simulasi — bukan untuk kepatuhan',
      badgeLong: 'Simulasi — bukan untuk kepatuhan',
      headline: 'Hasil simulasi eksplorasi (bukan untuk kepatuhan)',
      delta,
    };
  }
  return {
    verdict: 'sementara',
    isSniFinal: false,
    isOk: false,
    isFail: false,
    isSim: false,
    isProv: true,
    tone: 'warn',
    chipClass: 'st-warn',
    pillClass: 'warn',
    statusClass: 'is-warn',
    badge: 'Hasil sementara',
    badgeLong: 'Hasil sementara',
    headline: 'Hasil sementara — perlu konfirmasi',
    delta,
  };
}

/** Status pil per sisi: netral di mode simulasi/sementara, memenuhi/melebihi hanya di mode SNI final. */
export function sideVerdict(sideOttv, limit, buildingVerdict) {
  if (buildingVerdict === 'simulasi') {
    return { tone: 'neutral', pillClass: 'neutral', statusClass: 'is-neutral', textClass: 'st-neutral', text: 'Simulasi', isOver: false };
  }
  if (buildingVerdict === 'sementara') {
    return { tone: 'warn', pillClass: 'warn', statusClass: 'is-warn', textClass: 'st-warn', text: 'Sementara', isOver: false };
  }
  const ok = Number(sideOttv) <= Number(limit || 35);
  return ok
    ? { tone: 'ok', pillClass: 'ok', statusClass: 'is-ok', textClass: 'st-ok', text: 'Memenuhi', isOver: false }
    : { tone: 'fail', pillClass: 'fail', statusClass: 'is-fail', textClass: 'st-fail', text: 'Melebihi', isOver: true };
}
