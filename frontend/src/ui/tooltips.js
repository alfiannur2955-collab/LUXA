/**
 * Accessible SNI 6389:2020 Term Tooltips (`docs/FASE4_UI_SPEC.md` §5 & §8):
 * - Plain Indonesian one-sentence explanation + exact SNI 6389:2020 clause/table reference.
 * - Keyboard accessible (`Tab` focus / `Enter` toggle / `Esc` close) and hover-friendly.
 * - Active by default in `Belajar` workspace.
 */

export const SNI_GLOSSARY = {
  OTTV: {
    term: 'OTTV',
    full: 'Overall Thermal Transfer Value',
    summary: 'Nilai perpindahan termal menyeluruh selubung dinding luar bangunan ber-AC. Batas kepatuhan SNI adalah 35 W/m².',
    ref: 'SNI 6389:2020 Pasal 5.1',
  },
  WWR: {
    term: 'WWR',
    full: 'Window-to-Wall Ratio',
    summary: 'Perbandingan luas bidang kaca terhadap luas total selubung fasad luar pada suatu arah atau seluruh bangunan.',
    ref: 'SNI 6389:2020 Pasal 3.12 & 5.1',
  },
  SC: {
    term: 'SC',
    full: 'Shading Coefficient',
    summary: 'Koefisien peneduh efektif (SC kaca × SCeff peneduh) yang menentukan porsi radiasi matahari yang masuk lewat kaca.',
    ref: 'SNI 6389:2020 Pasal 3.6 & 5.4',
  },
  SF: {
    term: 'SF',
    full: 'Solar Factor (Faktor Radiasi Surya)',
    summary: 'Intensitas radiasi surya rata-rata tahunan (W/m²) pada bidang vertikal untuk setiap arah mata angin dan kota.',
    ref: 'SNI 6389:2020 Tabel 8',
  },
  TDek: {
    term: 'TDek',
    full: 'Beda Temperatur Ekuivalen',
    summary: 'Selisih temperatur ekuivalen dinding tak tembus cahaya (K) berdasarkan massa permukaan dinding (kg/m²).',
    ref: 'SNI 6389:2020 Tabel 7',
  },
  Uf: {
    term: 'Uf',
    full: 'Transmitansi Termal Fenestrasi',
    summary: 'Koefisien perpindahan panas konduksi melalui bidang kaca dan rangka (W/m²·K).',
    ref: 'SNI 6389:2020 Pasal 5.2',
  },
  Uw: {
    term: 'Uw',
    full: 'Transmitansi Termal Dinding',
    summary: 'Koefisien perpindahan panas konduksi melalui dinding masif atau panel spandrel (W/m²·K).',
    ref: 'SNI 6389:2020 Pasal 5.2',
  },
  alpha: {
    term: 'α',
    full: 'Absorbtansi Radiasi Matahari',
    summary: 'Fraksi radiasi surya yang diserap permukaan luar dinding; cat warna terang memiliki α lebih rendah daripada warna gelap.',
    ref: 'SNI 6389:2020 Tabel 5',
  },
  RTTV: {
    term: 'RTTV',
    full: 'Roof Thermal Transfer Value',
    summary: 'Nilai perpindahan termal menyeluruh untuk atap bangunan (batas 10 W/m² atap masif, 25 W/m² dengan skylight).',
    ref: 'SNI 6389:2020 Pasal 6.1',
  },
};

/**
 * Creates an inline term label wrapped in an accessible tooltip button when `enabled` is true.
 * `displayHtml` must be static trusted markup (e.g. `U<sub>f</sub>` or plain term code).
 */
export function makeTermTip(termKey, displayHtml, enabled = true) {
  const entry = SNI_GLOSSARY[termKey];
  if (!entry || !enabled) {
    const sp = document.createElement('span');
    sp.innerHTML = displayHtml;
    return sp;
  }

  const wrap = document.createElement('span');
  wrap.className = 'term-tip-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'term-tip-btn';
  btn.setAttribute('aria-label', `${entry.term} (${entry.full}): ${entry.summary} (${entry.ref})`);
  btn.innerHTML = displayHtml;

  const pop = document.createElement('span');
  pop.className = 'glass term-tip-pop';
  pop.setAttribute('role', 'tooltip');

  const titleEl = document.createElement('strong');
  titleEl.style.display = 'block';
  titleEl.style.fontSize = '12px';
  titleEl.style.color = 'var(--ink)';
  titleEl.textContent = `${entry.term} · ${entry.full}`;

  const descEl = document.createElement('span');
  descEl.style.display = 'block';
  descEl.style.marginTop = '3px';
  descEl.textContent = entry.summary;

  const refEl = document.createElement('span');
  refEl.className = 'term-tip-ref';
  refEl.textContent = entry.ref;

  pop.append(titleEl, descEl, refEl);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.toggle('is-open');
  });
  btn.addEventListener('blur', () => {
    wrap.classList.remove('is-open');
  });

  wrap.append(btn, pop);
  return wrap;
}
