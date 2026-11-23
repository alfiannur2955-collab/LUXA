// Isi kartu Mode Presentasi (spesifikasi P0, Tata letak kartu kaca): penanda, judul satu kalimat,
// satu angka utama, rincian dalam grid, catatan. Semua angka dibaca dari hasil engine apa adanya.
import { escapeHtml as esc } from '../ui/escapeHtml.js';

const NAMES = { U: 'Utara', TL: 'Timur Laut', T: 'Timur', TG: 'Tenggara', TGR: 'Tenggara', S: 'Selatan', BD: 'Barat Daya', B: 'Barat', BL: 'Barat Laut' };
const AZ_ORDER = ['U', 'TL', 'T', 'TGR', 'TG', 'S', 'BD', 'B', 'BL'];
export const sideName = (code) => NAMES[code] || code;

const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
export const f1 = (v) => nf(1).format(Number(v) || 0);
const f2 = (v) => nf(2).format(Number(v) || 0);
const f0 = (v) => nf(0).format(Number(v) || 0);
const pct = (v) => `${f0((Number(v) || 0) * 100)}%`;
const W = '<span class="lxp-unit">W/m²</span>';

export function sidesOf(analysis) {
  return (analysis?.orientation_breakdown || [])
    .filter((r) => Number(r.total_area_m2) > 1e-6)
    .sort((a, b) => AZ_ORDER.indexOf(a.code) - AZ_ORDER.indexOf(b.code));
}
const hottest = (analysis) => [...sidesOf(analysis)].sort((a, b) => b.ottv_orientation_wm2 - a.ottv_orientation_wm2)[0];

export function projectName(analysis) {
  const raw = String(analysis?.filename || 'Model').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return raw.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// Batang porsi tiga suku OTTV (sama urutan dengan rumus SNI).
function parts(qw, qg, qs) {
  const tot = qw + qg + qs || 1;
  const rows = [['Panas lewat dinding', qw, 'w'], ['Panas lewat kaca (suhu)', qg, 'g'], ['Sinar matahari lewat kaca', qs, 's']];
  return `<div class="lxp-parts">${rows.map(([t, v, k]) => `
    <div class="lxp-part"><span>${t}</span><i class="is-${k}" style="--w:${Math.max(2, (v / tot) * 100).toFixed(1)}%"></i><b>${f1(v)}</b></div>`).join('')}
  </div>`;
}
const stats = (items) => `<dl class="lxp-stats" style="--cols:${items.length}">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const status = (ok) => `<span class="lxp-status ${ok ? 'is-ok' : 'is-fail'}">${ok ? 'Memenuhi' : 'Melebihi'}</span>`;

export function renderCard(slide, ctx) {
  const { index, total, analysis: a, userName, heatColor } = ctx;
  const s = a.summary || {};
  const limit = Number(a.sni_limit_wm2 || 35);
  const ottv = Number(a.ottv_total_wm2 || 0);
  const ok = Boolean(a.compliant);
  const hot = hottest(a);
  const kicker = `<p class="lxp-kicker">${index + 1} / ${total} · ${esc(slide.name)}</p>`;
  const prov = s.is_provisional ? '<p class="lxp-ribbon">Hasil sementara</p>' : '';

  switch (slide.id) {
    case 'sampul': {
      const by = userName && userName.trim() ? `<p class="lxp-by">Dibuat oleh <b>${esc(userName.trim())}</b></p>` : '';
      return `${prov}<p class="lxp-kicker">Presentasi OTTV · SNI 6389:2020</p>
        <h1 class="lxp-title is-cover">${esc(projectName(a))}</h1>${by}
        ${stats([['Lokasi', esc(a.location_info?.city || '-')], ['Lantai', f0(s.total_floors)], ['Luas selubung', `${f0(s.total_envelope_area_m2)} m²`]])}
        <p class="lxp-note">Geser, tekan panah, atau pakai clicker untuk lanjut.</p>`;
    }
    case 'ottv': {
      const m = Math.abs(Number(a.margin_to_limit_wm2 ?? limit - ottv));
      return `${prov}${kicker}
        <h2 class="lxp-title">${ok ? 'Gedung ini memenuhi batas SNI' : 'OTTV gedung ini melebihi batas SNI'}</h2>
        <div class="lxp-big"><strong>${f1(ottv)}</strong>${W}${status(ok)}</div>
        <p class="lxp-sub">Batas SNI ${f0(limit)} W/m². ${ok ? `Masih ${f1(m)} W/m² di bawah batas.` : `Lebih ${f1(m)} W/m² dari batas.`}</p>
        ${parts(Number(s.q_wall_conduction_wm2 || 0), Number(s.q_glass_conduction_wm2 || 0), Number(s.q_solar_radiation_wm2 || 0))}
        <p class="lxp-note">OTTV = rata-rata panas yang masuk lewat selubung per m², dijumlah dari tiga jalur di atas.</p>`;
    }
    case 'sisi': {
      const sides = sidesOf(a);
      const over = sides.filter((r) => r.ottv_orientation_wm2 > limit).length;
      const max = Math.max(limit * 1.3, ...sides.map((r) => r.ottv_orientation_wm2));
      return `${kicker}
        <h2 class="lxp-title">Sisi ${esc(sideName(hot?.code))} paling panas</h2>
        <div class="lxp-big"><strong>${over}</strong><span class="lxp-unit">dari ${sides.length} sisi melebihi batas</span></div>
        <div class="lxp-sides">${sides.map((r) => `
          <div class="lxp-side${r.code === hot?.code ? ' is-hot' : ''}"><span>${esc(sideName(r.code))}</span>
            <i style="--w:${((r.ottv_orientation_wm2 / max) * 100).toFixed(1)}%;--c:${heatColor(r.ottv_orientation_wm2)}"></i><b>${f1(r.ottv_orientation_wm2)}</b></div>`).join('')}
          <div class="lxp-limit" style="--x:${((limit / max) * 100).toFixed(1)}"><span>batas ${f0(limit)}</span></div>
        </div>
        <p class="lxp-note">Warna di model = OTTV tiap sisi (W/m²). Makin gelap, makin panas.</p>`;
    }
    case 'terpanas': {
      if (!hot) return `${kicker}<h2 class="lxp-title">Tidak ada data per sisi</h2>`;
      return `${kicker}
        <h2 class="lxp-title">Sisi ${esc(sideName(hot.code))} menerima panas terbanyak</h2>
        <div class="lxp-big"><strong>${f1(hot.ottv_orientation_wm2)}</strong>${W}${status(hot.ottv_orientation_wm2 <= limit)}</div>
        ${stats([['Luas', `${f0(hot.total_area_m2)} m²`], ['Porsi kaca', pct(hot.wwr)], ['Faktor matahari', `${f0(hot.sni_sf_wm2)}`]])}
        ${parts(Number(hot.q_wall_conduction_wm2 || 0), Number(hot.q_glass_conduction_wm2 || 0), Number(hot.q_solar_radiation_wm2 || 0))}
        <p class="lxp-note">Faktor matahari (SF, W/m²) dari Tabel 8 SNI: makin besar, makin kuat sinar yang diterima sisi ini.</p>`;
    }
    case 'kaca': {
      const tot = Number(s.q_wall_conduction_wm2 || 0) + Number(s.q_glass_conduction_wm2 || 0) + Number(s.q_solar_radiation_wm2 || 0) || 1;
      const share = Number(s.q_solar_radiation_wm2 || 0) / tot;
      const mat = s.active_materials || {};
      return `${kicker}
        <h2 class="lxp-title">${share >= 0.5 ? 'Sebagian besar panas masuk lewat sinar di kaca' : 'Kaca bukan jalur panas terbesar'}</h2>
        <div class="lxp-big"><strong>${f0(share * 100)}%</strong><span class="lxp-unit">OTTV berasal dari sinar lewat kaca</span></div>
        ${stats([['Porsi kaca', pct(s.effective_wwr)], ['SC efektif', f2(s.avg_sc_effective)], ['Terteduhi', pct(s.avg_shaded_fraction)]])}
        <p class="lxp-mat"><span>Kaca</span>${esc(mat.glazing_name || '-')}</p>
        <p class="lxp-note">SC efektif = berapa bagian sinar yang lolos lewat kaca setelah dihitung peneduhnya. Makin kecil, makin sejuk.</p>`;
    }
    case 'atap': {
      const r = a.rttv || {};
      const rok = r.compliant !== false;
      return `${kicker}
        <h2 class="lxp-title">${rok ? 'Atap memenuhi batas RTTV' : 'RTTV atap melebihi batas'}</h2>
        <div class="lxp-big"><strong>${f1(r.rttv_wm2)}</strong>${W}${status(rok)}</div>
        <p class="lxp-sub">Batas SNI ${f0(r.limit_wm2 ?? 10)} W/m².</p>
        ${stats([['Luas atap', `${f0(r.total_roof_area_m2)} m²`], ['Skylight', `${f0(r.skylight_area_m2)} m²`], ['Porsi skylight', pct(r.srr)]])}
        <p class="lxp-note">RTTV = panas yang masuk lewat atap per m² luas atap.</p>`;
    }
    case 'penutup': {
      const steps = nextSteps(a, hot, limit);
      return `${kicker}
        <h2 class="lxp-title">${ok ? 'Desain ini memenuhi SNI 6389:2020' : `Perlu turun ${f1(ottv - limit)} W/m² untuk memenuhi SNI`}</h2>
        <ol class="lxp-steps">${steps.map((t) => `<li>${t}</li>`).join('')}</ol>
        <div class="lxp-actions">
          <button type="button" class="lxp-btn" data-act="first">Ulangi dari awal</button>
          <button type="button" class="lxp-btn" data-act="exit">Keluar</button>
        </div>
        <p class="lxp-note">Saran ini arahan umum dari hasil hitung. Cek ulang lewat simulasi sebelum memutuskan.</p>`;
    }
    default:
      return kicker;
  }
}

/** Saran penutup berbasis aturan: jalur panas terbesar dan sisi terpanas. Tidak menghitung angka baru. */
export function nextSteps(a, hot, limit) {
  const s = a.summary || {};
  const qw = Number(s.q_wall_conduction_wm2 || 0), qg = Number(s.q_glass_conduction_wm2 || 0), qs = Number(s.q_solar_radiation_wm2 || 0);
  const side = hot ? `sisi ${esc(sideName(hot.code))}` : 'sisi terpanas';
  const out = [];
  if (a.compliant) {
    out.push('Pertahankan spesifikasi kaca dan peneduh saat pengadaan, karena nilai OTTV bergantung pada keduanya.');
    if (hot && hot.ottv_orientation_wm2 > limit) out.push(`${side[0].toUpperCase()}${side.slice(1)} masih di atas batas. Peneduh tambahan di sana memberi ruang aman.`);
    else out.push(`Bila desain berubah, cek lagi ${side} lebih dulu karena paling peka terhadap matahari.`);
  } else {
    if (qs >= qw && qs >= qg) {
      out.push(`Pilih kaca dengan SC lebih kecil, terutama di ${side}.`);
      out.push(`Tambahkan peneduh (overhang atau sirip) di ${side}.`);
    }
    if (hot && Number(hot.wwr) > 0.5) out.push(`Kurangi porsi kaca di ${side} (sekarang ${f0(hot.wwr * 100)}%).`);
    if (qw > qs) out.push('Pakai dinding dengan nilai U lebih kecil atau warna lebih terang (α kecil).');
    if (qg > qs && qg > qw) out.push('Pakai kaca ganda atau kaca dengan nilai U lebih kecil.');
  }
  out.push('Buka langkah Bandingkan di LUXA untuk mencoba pilihan material lain.');
  return out.slice(0, 3);
}
