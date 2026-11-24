// Isi teks Beranda + Belajar OTTV: judul bagian, isi kartu, kamus simbol, pita rumus, dan kalimat Lux.
// Ditulis untuk pembaca awam: satu gagasan per kalimat, istilah dijelaskan saat pertama muncul.
// Angka dan definisi mengikuti SNI 6389:2020 (Pasal 3, 4.1–4.4, Tabel 1, 2, 7, 8, 9) dan katalog material LUXA.
import { SNI } from '../learn/sniData.js';
import { icon } from '../ui/icons.js';
import { HEAT_COLORS, DIR_NAME } from './highlights.js';
import { PODIUM_ROOF_AREA, SKY_MAX_AREA } from './tower.js';
import { sf, glassById, LIMIT, fmt } from './sim.js';

export const PRESETS = {
  penuh: { label: 'Kaca penuh', wwr: 0.85, glass: 'glz_kaca_polos_8', wall: 'wal_spandrel_tanpa_insulasi', R: 0 },
  seimbang: { label: 'Seimbang', wwr: 0.4, glass: 'glz_kaca_tinted_8', wall: 'wal_bata_ringan_aac_100', R: 0.44 },
  hemat: { label: 'Hemat', wwr: 0.3, glass: 'glz_kaca_lowe_single_8', wall: 'wal_bata_ringan_aac_cat_putih', R: 0.8 },
};

// Nama jalur panas dipakai sama di kartu dan di label 3D.
export const PATH_NAMES = { wall: 'Merambat lewat dinding', glass: 'Merambat lewat kaca', solar: 'Sinar matahari lewat kaca' };

// ---------- Simbol rumus ----------
const K = 'K (kelvin). Beda 1 K sama dengan beda 1 °C';
export const SYMS = {
  a: { sym: 'α', name: 'Penyerapan sinar (absorptansi)', unit: 'angka 0 sampai 1', target: 'wall', goto: 'bab-6',
    text: 'Seberapa banyak sinar matahari diserap permukaan luar dinding. Warna terang menyerap lebih sedikit, jadi α-nya lebih kecil.',
    from: 'Katalog material (Tabel 1 dan 2 SNI)' },
  uw: { sym: 'Uw', name: 'Nilai U dinding', unit: 'W/m²K', target: 'wall', goto: 'bab-6',
    text: 'Seberapa mudah panas menembus dinding. Makin kecil angkanya, makin sedikit panas yang lolos.',
    from: 'Katalog material' },
  one: { sym: '1 − WWR', name: 'Bagian yang berupa dinding', unit: 'angka 0 sampai 1', target: 'wall', goto: 'bab-3',
    text: 'Angka 1 berarti satu sisi bangunan utuh (100%). Dikurangi porsi kaca (WWR), sisanya adalah bagian dinding. Contoh: kaca 40%, maka 1 − 0,40 = 0,60, artinya 60% dinding.',
    from: 'Dihitung dari WWR' },
  wwr: { sym: 'WWR', name: 'Porsi kaca', unit: 'angka 0 sampai 1', target: 'glass', goto: 'bab-3',
    text: 'Berapa bagian dari satu sisi bangunan yang berupa jendela, termasuk kusennya. WWR 0,40 artinya 40% kaca. Muncul tiga kali di rumus, jadi pengaruhnya besar.',
    from: 'Model 3D-mu' },
  td: { sym: 'TDek', name: 'Beda suhu dinding', unit: K, target: 'wall', goto: 'bab-6',
    text: 'Selisih suhu antara dinding luar yang sudah dipanasi matahari dan ruangan di dalam. SNI menyederhanakannya dari berat dinding: makin berat, makin kecil.',
    from: 'Tabel 7 SNI (berat dinding)' },
  uf: { sym: 'Uf', name: 'Nilai U jendela', unit: 'W/m²K', target: 'glass', goto: 'bab-5',
    text: 'Seberapa mudah panas menembus jendela, yaitu kaca bersama kusennya. Makin kecil, makin sedikit panas yang lolos.',
    from: 'Katalog kaca' },
  dt: { sym: 'ΔT', name: 'Beda suhu luar dan dalam', unit: K, target: 'glass', goto: 'bab-2',
    text: 'Selisih suhu udara luar dan ruangan. SNI sudah menetapkannya 5 K, jadi tinggal dipakai.',
    from: 'Ketetapan SNI (5 K)' },
  sc: { sym: 'SC', name: 'Peredam sinar (koefisien peneduh)', unit: 'angka 0 sampai 1', target: 'glass', goto: 'bab-5',
    text: 'Seberapa banyak sinar matahari yang tetap lolos lewat jendelamu, dibanding kaca bening biasa tanpa peneduh. Makin kecil, makin teduh. SC = SC kaca × SC peneduh.',
    from: 'Katalog kaca + tabel peneduh SNI' },
  sf: { sym: 'SF', name: 'Kekuatan sinar per arah', unit: 'W/m²', target: 'glass', goto: 'bab-4',
    text: 'Rata-rata kekuatan sinar matahari yang masuk lewat kaca bening, untuk tiap arah dan tiap kota. Sisi yang paling lama kena matahari, angkanya paling besar.',
    from: 'Tabel 8 SNI (kota dan arah)' },
};

// Pita rumus kecil di bawah kartu: simbol yang sedang dibahas menyala, sisanya pudar.
const sy = (k, on) => `<b${on.includes(k) ? ' class="on"' : ''}>${k === 'one' ? '1' : SYMS[k].sym}</b>`;
export function strip(kind, on = []) {
  const head = '<span class="l3d-strip-h">Di rumus</span>';
  if (kind === 'ottv') return `<p class="l3d-strip">${head}OTTV = ${sy('a', on)}·[${sy('uw', on)}·(${sy('one', on)}−${sy('wwr', on)})·${sy('td', on)}] + ${sy('uf', on)}·${sy('wwr', on)}·${sy('dt', on)} + ${sy('sc', on)}·${sy('wwr', on)}·${sy('sf', on)}</p>`;
  if (kind === 'total') return `<p class="l3d-strip">${head}OTTV total = Σ(<b class="on">luas sisi</b> × <b class="on">OTTV sisi</b>) ÷ Σ luas sisi</p>`;
  if (kind === 'rttv') return `<p class="l3d-strip">${head}RTTV = [α·Ar·Ur·TDek + As·Us·ΔT + As·SC·SF] ÷ Ao<span class="l3d-strip-k">Ar luas atap tertutup · As luas skylight · Ao luas seluruh atap</span></p>`;
  return '';
}

// Rumus besar di Bedah rumus: satu baris per jalur panas, rata di tanda = / +, tiap simbol tombol.
const sb = (k, label) => `<button type="button" data-sym="${k}" aria-label="${SYMS[k].name}">${label || SYMS[k].sym}</button>`;
const op = (t) => `<span class="l3d-op">${t}</span>`;
const row = (k, sign, terms) => `<div class="l3d-big-row" style="--c:${HEAT_COLORS[k]}" title="${PATH_NAMES[k]}"><span class="l3d-big-l">${sign}</span><span class="l3d-big-t">${terms}</span></div>`;
const BIG = [
  row('wall', 'OTTV =', `${sb('a')}${op('·')}${op('[')}${sb('uw')}${op('·')}${op('(')}${sb('one', '1')}${op('−')}${sb('wwr')}${op(')')}${op('·')}${sb('td')}${op(']')}`),
  row('glass', '+', `${sb('uf')}${op('·')}${sb('wwr')}${op('·')}${sb('dt')}`),
  row('solar', '+', `${sb('sc')}${op('·')}${sb('wwr')}${op('·')}${sb('sf')}`),
].join('');

// Nama kaca pendek untuk tombol: "Kaca warna (tinted) 8 mm" → "Warna (tinted)".
const shortGlass = (n) => { const t = n.replace(/^Kaca\s*/, '').replace(/\s*8 mm$/, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
const seg = (cols, label, items) => `<div class="l3d-seg" style="--cols:${cols}" role="group" aria-label="${label}">${items}</div>`;
const gauge = (id, label) => `<div class="l3d-gauge"><div class="l3d-gauge-num"><b data-id="${id}">–</b><span>${label}</span></div><div class="l3d-gauge-bar"><i data-id="${id}-bar"></i><em style="left:${(LIMIT / 80) * 100}%"><span>batas ${fmt(LIMIT)}</span></em></div><p data-id="${id}-verdict" class="l3d-verdict"></p></div>`;

// ---------- Bagian ----------
export function chapters({ gl }) {
  const ch = [
    { id: 'beranda', shot: 'beranda', nav: 'Beranda', title: 'Beranda', html: '<div data-slot="home"></div>' },
    { id: 'bab-1', shot: 'bab1', nav: 'OTTV', title: 'OTTV itu apa?', html: `
      <p class="l3d-kicker">Belajar OTTV</p>
      <h2>OTTV itu apa?</h2>
      <p>Matahari memanaskan dinding dan kaca bangunan, lalu sebagian panasnya masuk ke ruangan. OTTV mengukur rata-rata panas yang masuk itu, dalam W/m² (watt per meter persegi).</p>
      <p>Makin besar OTTV, makin keras AC harus bekerja. Karena itu SNI 6389:2020 membatasinya paling tinggi ${fmt(LIMIT)} W/m² untuk gedung ber-AC.</p>
      <p>Coba bandingkan tiga versi tower ini. Makin oranye sisi bangunannya, makin banyak panas yang masuk lewat sisi itu.</p>
      ${seg(3, 'Versi tower', Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${p.label}</button>`).join(''))}
      <p class="l3d-muted" data-id="preset-desc"></p>
      ${gauge('ottv-total', 'W/m²')}` },
    { id: 'bab-2', shot: 'bab2', nav: 'Jalur panas', title: 'Panas masuk lewat mana?', html: `
      <h2>Panas masuk lewat mana?</h2>
      <p>Lewat tiga jalan. Dua di antaranya merambat menembus bahan, seperti gelas kopi panas yang ikut menghangatkan tanganmu. Satu lagi berupa sinar matahari yang menembus kaca, seperti mobil yang diparkir di bawah terik.</p>
      <p>Panas dari ketiga jalan ini dijumlahkan, dan hasilnya adalah OTTV untuk satu sisi bangunan. Arahkan kursor ke salah satu jalan untuk melihatnya di model.</p>
      <div class="l3d-terms">
        <button type="button" data-term="wall"><i style="background:${HEAT_COLORS.wall}"></i><span>${PATH_NAMES.wall}</span><code>α · Uw · (1 − WWR) · TDek</code><b data-id="t-wall">–</b></button>
        <button type="button" data-term="glass"><i style="background:${HEAT_COLORS.glass}"></i><span>${PATH_NAMES.glass}</span><code>Uf · WWR · ΔT</code><b data-id="t-glass">–</b></button>
        <button type="button" data-term="solar"><i style="background:${HEAT_COLORS.solar}"></i><span>${PATH_NAMES.solar}</span><code>SC · WWR · SF</code><b data-id="t-solar">–</b></button>
      </div>
      <p class="l3d-sum">OTTV sisi Barat = <b data-id="t-total">–</b> W/m²</p>
      <p class="l3d-note" data-id="t-note"></p>
      ${strip('ottv', ['a', 'uw', 'one', 'wwr', 'td', 'uf', 'dt', 'sc', 'sf'])}` },
    { id: 'rumus', shot: 'rumus', nav: 'Rumus', title: 'Bedah rumus', html: `
      <p class="l3d-kicker">Bedah rumus</p>
      <h2>Kenalan dengan simbolnya</h2>
      <p>Rumus OTTV terlihat rumit, padahal isinya hanya tiga jalan panas tadi, satu baris per jalan. Klik simbol mana saja untuk tahu artinya.</p>
      <div class="l3d-big" role="group" aria-label="Rumus OTTV satu sisi bangunan">${BIG}</div>
      <div class="l3d-sym" data-id="sym-info" aria-live="polite"></div>
      <p class="l3d-muted l3d-num-head">Kalau diisi angka tower ini (sisi Barat):</p>
      <p class="l3d-num" data-id="sym-num"></p>` },
    { id: 'bab-3', shot: 'bab3', nav: 'Kaca', title: 'Makin banyak kaca, makin panas', html: `
      <h2>Makin banyak kaca, makin panas</h2>
      <p>WWR adalah porsi kaca di satu sisi bangunan, termasuk kusennya. WWR 40% artinya 40% sisi itu kaca dan 60% dinding.</p>
      <p>Kaca meloloskan panas jauh lebih banyak daripada dinding, terutama lewat sinar matahari. Jadi makin besar WWR, makin besar OTTV.</p>
      <label class="l3d-ctl">Porsi kaca sisi Barat (WWR) <input data-id="wwr" type="range" min="0.1" max="0.85" step="0.05" value="0.4"><output data-id="wwr-out">40%</output></label>
      <div class="l3d-stack" aria-hidden="true"><i data-id="s-wall" style="background:${HEAT_COLORS.wall}"></i><i data-id="s-glass" style="background:${HEAT_COLORS.glass}"></i><i data-id="s-solar" style="background:${HEAT_COLORS.solar}"></i></div>
      <dl class="l3d-stats"><div><dt>Lewat dinding</dt><dd data-id="w-wall">–</dd></div><div><dt>Lewat kaca</dt><dd data-id="w-glass">–</dd></div><div><dt>Sinar lewat kaca</dt><dd data-id="w-solar">–</dd></div></dl>
      <p class="l3d-sum">OTTV sisi Barat = <b data-id="w-total">–</b> W/m²</p>
      <p class="l3d-muted"><b>Coba:</b> turunkan WWR ke 20%, lalu lihat berapa OTTV-nya turun.</p>
      ${strip('ottv', ['one', 'wwr'])}` },
    { id: 'bab-4', shot: 'bab4', nav: 'Arah', title: 'Sisi mana yang paling kepanasan?', html: `
      <h2>Sisi mana yang paling kepanasan?</h2>
      <p>Setiap sisi bangunan menerima sinar matahari dengan kekuatan berbeda. SNI mencatatnya sebagai SF, untuk tiap arah dan tiap kota. Makin oranye sisinya, makin besar SF-nya.</p>
      <div class="l3d-sf" aria-label="SF Jakarta per arah, W/m²">${['U', 'T', 'S', 'B'].map((d) => `<div class="l3d-sf-row"><span>${DIR_NAME[d]}</span><i style="--w:${(sf()[d] / 200) * 100}%"></i><b>${fmt(sf()[d])}</b></div>`).join('')}<p class="l3d-muted">SF Jakarta, W/m²</p></div>
      <p><b>Coba:</b> seret matahari di lintasannya. Sinar sore menyorot lurus ke sisi Barat, itu sebabnya angka Barat paling besar.</p>
      <p class="l3d-readout" data-id="sun-readout">Jam 15.00</p>
      <p class="l3d-note">Bayangan gedung sekitar hanya hiasan. LUXA tidak memasukkan bayangan gedung lain ke hitungan OTTV.</p>
      ${strip('ottv', ['sf'])}` },
    { id: 'bab-5', shot: 'bab5', nav: 'Peneduh', title: 'Meneduhkan kaca', html: `
      <h2>Meneduhkan kaca</h2>
      <p>Sinar yang masuk lewat kaca bisa diredam dengan dua cara: memilih kaca yang lebih teduh, dan memasang peneduh seperti overhang (atap kecil di atas jendela).</p>
      <p>Keduanya digabung dalam SC = SC kaca × SC peneduh. Makin kecil SC, makin sedikit sinar yang lolos.</p>
      ${seg(2, 'Jenis kaca', SNI.glass.map((g) => `<button type="button" data-glass="${g.id}" title="${g.name}">${shortGlass(g.name)}<small>SC ${fmt(g.sc, 2)}</small></button>`).join(''))}
      <p>Overhang makin ampuh kalau makin dalam dibanding tinggi kacanya. Perbandingan ini disebut R.</p>
      <label class="l3d-ctl">Kedalaman overhang <input data-id="depth" type="range" min="0" max="1.5" step="0.05" value="0.7"><output data-id="depth-out">0,70 m</output></label>
      <label class="l3d-ctl">Jam <input data-id="hour5" type="range" min="6" max="18" step="0.25" value="15"><output data-id="hour5-out">15.00</output></label>
      <dl class="l3d-stats l3d-stats-4"><div><dt>R (dalam ÷ tinggi)</dt><dd data-id="r-out">–</dd></div><div><dt>SC peneduh</dt><dd data-id="sc-out">–</dd></div><div><dt>SC total</dt><dd data-id="sct-out">–</dd></div><div><dt>Kaca teduh jam ini</dt><dd data-id="shade-out">–</dd></div></dl>
      <p class="l3d-note">SC peneduh dari tabel SNI, berlaku sepanjang tahun. Persentase kaca teduh hanya untuk jam yang dipilih.</p>
      ${strip('ottv', ['sc'])}` },
    { id: 'bab-6', shot: 'bab6', nav: 'Dinding', title: 'Warna dan berat dinding', html: `
      <h2>Warna dan berat dinding</h2>
      <p>Panas yang merambat lewat dinding dipengaruhi tiga hal:</p>
      <ul class="l3d-facts">
        <li><b>Warna.</b> Makin terang, makin sedikit sinar diserap (α kecil). Putih 0,30 · hijau 0,59 · hitam 0,95.</li>
        <li><b>Bahan.</b> Makin kecil nilai U, makin sulit panas menembus. Lapisan insulasi sangat membantu.</li>
        <li><b>Berat.</b> Makin berat dinding, makin kecil TDek: di bawah 125 kg/m² 15 K · 126–195 kg/m² 12 K · di atas 195 kg/m² 10 K.</li>
      </ul>
      ${seg(2, 'Jenis dinding', SNI.wall.map((w) => `<button type="button" data-wall="${w.id}">${w.name}</button>`).join(''))}
      <label class="l3d-ctl">Warna permukaan luar (α) <input data-id="alpha" type="range" min="0.2" max="0.9" step="0.01"><output data-id="alpha-out">–</output></label>
      <dl class="l3d-stats l3d-stats-4"><div><dt>Nilai U</dt><dd data-id="d-u">–</dd></div><div><dt>Berat</dt><dd data-id="d-m">–</dd></div><div><dt>TDek</dt><dd data-id="d-td">–</dd></div><div><dt>Lewat dinding</dt><dd data-id="d-q">–</dd></div></dl>
      <p class="l3d-sum">OTTV sisi Barat = <b data-id="d-total">–</b> W/m²</p>
      <p class="l3d-note">Tebal lapisan di potongan dibesarkan supaya terbaca. Nilai U, α, dan berat dari katalog material LUXA; contoh α dari Tabel 2 SNI.</p>
      ${strip('ottv', ['a', 'uw', 'td'])}` },
    { id: 'bab-7', shot: 'bab7', nav: 'Total', title: 'Menghitung semua sisi', html: `
      <h2>Menghitung semua sisi</h2>
      <p>Tiap sisi bangunan punya OTTV sendiri. Untuk OTTV seluruh bangunan, semua sisi dirata-rata dengan menimbang luasnya: sisi yang lebih luas lebih berpengaruh.</p>
      <p>Angka total inilah yang dibandingkan dengan batas SNI.</p>
      <div class="l3d-sides">${['U', 'T', 'S', 'B'].map((d) => `<div class="l3d-side"><span>${DIR_NAME[d]}</span><input type="range" min="0.1" max="0.85" step="0.05" data-side="${d}" aria-label="Porsi kaca sisi ${DIR_NAME[d]}"><output data-side-out="${d}">–</output><b data-side-ottv="${d}">–</b></div>`).join('')}<p class="l3d-muted">Geser porsi kaca tiap sisi. Angka kanan = OTTV sisi itu (W/m²).</p></div>
      ${gauge('ottv-total7', 'W/m² OTTV total')}
      ${strip('total')}` },
    { id: 'bab-8', shot: 'bab8', nav: 'Atap', title: 'Atap juga dihitung', html: `
      <h2>Atap juga dihitung</h2>
      <p>Atap punya ukuran sendiri, namanya RTTV. Cara hitungnya mirip OTTV, hanya jendelanya berupa skylight (kaca di atap).</p>
      <p>Batasnya ${fmt(SNI.rttvLimitSky)} W/m² kalau atap punya skylight, dan ${fmt(SNI.rttvLimitOpaque)} W/m² kalau atap tertutup penuh. Atap ringan lebih cepat panas: di bawah 50 kg/m² TDek-nya 24 K, 50–230 kg/m² 20 K, di atas 230 kg/m² 16 K.</p>
      ${seg(2, 'Jenis atap', SNI.roof.map((r) => `<button type="button" data-roof="${r.id}">${r.name}</button>`).join(''))}
      <label class="l3d-ctl">Luas skylight <input data-id="sky" type="range" min="0" max="${(SKY_MAX_AREA / PODIUM_ROOF_AREA).toFixed(3)}" step="0.005"><output data-id="sky-out">–</output></label>
      <dl class="l3d-stats"><div><dt>Lewat atap</dt><dd data-id="r-roof">–</dd></div><div><dt>Merambat lewat skylight</dt><dd data-id="r-cond">–</dd></div><div><dt>Sinar lewat skylight</dt><dd data-id="r-solar">–</dd></div></dl>
      <div class="l3d-gauge"><div class="l3d-gauge-num"><b data-id="rttv-total">–</b><span>W/m² RTTV</span></div><div class="l3d-gauge-bar"><i data-id="rttv-bar"></i><em data-id="rttv-limit"><span></span></em></div><p data-id="rttv-verdict" class="l3d-verdict"></p></div>
      <p class="l3d-note">Contoh: atap podium ${fmt(PODIUM_ROOF_AREA)} m² di luar tapak tower, skylight dari ${glassById('glz_kaca_tinted_8').name.toLowerCase()}, SF atap Jakarta ${fmt(sf().ROOF)} W/m².</p>
      ${strip('rttv')}` },
    { id: 'selesai', shot: 'akhir', nav: 'Selesai', title: 'Giliran desainmu', html: `
      <p class="l3d-kicker">Selesai</p>
      <h2>Giliran desainmu</h2>
      <p>Sekarang kamu sudah kenal semua yang membentuk OTTV dan RTTV: porsi kaca, arah, jenis kaca, peneduh, dinding, dan atap. LUXA menghitung semuanya langsung dari model 3D-mu, untuk tiap sisi bangunan.</p>
      <div class="l3d-actions">
        <button type="button" class="l3d-cta" data-act="start">${icon('upload', 16)}<span>Hitung modelmu</span></button>
        <button type="button" class="l3d-ghost" data-act="example">${icon('play', 16)}<span>Coba model contoh</span></button>
      </div>
      <button type="button" class="l3d-link" data-act="top">Kembali ke Beranda</button>` },
  ];
  return ch.filter((c, i) => gl || i === 0);
}

// Lux: pemandu kecil di tiap kartu, membawa analogi ringan.
export const LUX = {
  beranda: ['wave', 'Aku Lux. Ayo cek seberapa panas sisi-sisi bangunanmu hari ini.'],
  'bab-1': ['guide', 'Bayangkan bangunan itu cooler box. OTTV menunjukkan seberapa bocor dindingnya. Coba pilih Hemat.'],
  'bab-2': ['think', 'Sinar lewat kaca hampir selalu jadi penyumbang terbesar. Lihat bercaknya di lantai ruang: itu panas yang ikut masuk.'],
  rumus: ['guide', 'Mulai dari α. Perhatikan WWR muncul tiga kali, makanya porsi kaca berpengaruh besar.'],
  'bab-3': ['guide', 'Jendela lebar itu pintu masuk panas yang lebar juga.'],
  'bab-4': ['guide', 'Matahari sore itu pilih kasih: sisi Barat yang paling kena.'],
  'bab-5': ['think', 'Overhang itu topi, kaca Low-E itu kacamata hitam. Paling ampuh dipakai dua-duanya.'],
  'bab-6': ['guide', 'Kaos putih vs kaos hitam di siang bolong. Dinding juga begitu.'],
  'bab-7': ['think', 'Mirip nilai rapor: pelajaran dengan SKS besar paling menentukan.'],
  'bab-8': ['report', 'Atap itu topi bangunan, bagian yang paling lama menghadap matahari.'],
  selesai: ['happy', 'Mantap, semua bagian beres. Yuk cek desainmu sendiri.'],
};
