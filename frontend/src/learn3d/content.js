// Isi teks Beranda + Belajar OTTV: judul bagian, pita rumus, isi kartu, kamus simbol, dan kalimat Lux.
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

// ---------- Simbol rumus ----------
export const SYMS = {
  a: { sym: 'α', name: 'Absorptansi', unit: 'tanpa satuan, 0 sampai 1', target: 'wall', goto: 'bab-6',
    text: 'Seberapa banyak sinar matahari yang diserap permukaan luar dinding. Ditentukan bahan dan warnanya: makin terang warnanya, makin kecil α.',
    from: 'Katalog material (Tabel 1 dan 2 SNI)' },
  uw: { sym: 'Uw', name: 'Transmitan termal dinding', unit: 'W/m²K', target: 'wall', goto: 'bab-6',
    text: 'Seberapa mudah panas merambat menembus dinding yang tidak tembus cahaya, untuk tiap 1 K beda suhu. Makin kecil nilainya, makin rapat dindingnya.',
    from: 'Katalog material' },
  wwr: { sym: 'WWR', name: 'Rasio jendela terhadap dinding', unit: '0 sampai 1', target: 'glass', goto: 'bab-3',
    text: 'Luas jendela (kaca dan kusennya) dibagi luas kotor dinding pada satu arah. Muncul tiga kali di rumus, jadi pengaruhnya besar.',
    from: 'Model 3D-mu' },
  td: { sym: 'TDek', name: 'Beda temperatur ekuivalen', unit: 'K', target: 'wall', goto: 'bab-6',
    text: 'Beda suhu antara ruangan dan dinding luar yang sudah dipanasi matahari. SNI menyederhanakannya menjadi tiga kelas menurut berat dinding.',
    from: 'Tabel 7 SNI (berat dinding)' },
  uf: { sym: 'Uf', name: 'Transmitan termal fenestrasi', unit: 'W/m²K', target: 'glass', goto: 'bab-5',
    text: 'Seberapa mudah panas merambat lewat jendela, gabungan kaca dan kusennya.',
    from: 'Katalog kaca' },
  dt: { sym: 'ΔT', name: 'Beda suhu luar dan dalam', unit: 'K', target: 'glass', goto: 'bab-2',
    text: 'Selisih suhu rencana antara udara luar dan ruangan. SNI menetapkannya tetap 5 K, jadi kamu tidak perlu mencarinya.',
    from: 'Ketetapan SNI (5 K)' },
  sc: { sym: 'SC', name: 'Koefisien peneduh', unit: '0 sampai 1', target: 'glass', goto: 'bab-5',
    text: 'Perbandingan panas matahari yang masuk lewat jendelamu dibanding lewat kaca bening 3 mm tanpa peneduh. SC = SC kaca × SC efektif peneduh.',
    from: 'Katalog kaca + tabel peneduh SNI' },
  sf: { sym: 'SF', name: 'Faktor radiasi matahari', unit: 'W/m²', target: 'glass', goto: 'bab-4',
    text: 'Radiasi matahari rata-rata per jam yang masuk lewat kaca bening 3 mm. Nilainya berbeda untuk tiap kota dan tiap arah fasad.',
    from: 'Tabel 8 SNI (kota dan arah)' },
};

const s = (k, on) => `<b data-s="${k}"${on.includes(k) ? ' class="on"' : ''}>${SYMS[k].sym}</b>`;
// Pita rumus kecil di atas kartu: simbol yang sedang dibahas menyala.
export function strip(kind, on = []) {
  if (kind === 'ottv') return `<p class="l3d-strip" aria-label="Rumus OTTV">OTTV = ${s('a', on)}·[${s('uw', on)}·(1−${s('wwr', on)})·${s('td', on)}] + ${s('uf', on)}·${s('wwr', on)}·${s('dt', on)} + ${s('sc', on)}·${s('wwr', on)}·${s('sf', on)}</p>`;
  if (kind === 'total') return '<p class="l3d-strip" aria-label="Rumus OTTV total">OTTV total = Σ(<b class="on">luas fasad</b> × <b class="on">OTTV fasad</b>) ÷ Σ luas fasad</p>';
  if (kind === 'rttv') return '<p class="l3d-strip" aria-label="Rumus RTTV">RTTV = [α·Ar·Ur·TDek + As·Us·ΔT + As·SC·SF] ÷ Ao</p>';
  return '';
}

// Rumus besar di Bedah rumus: tiap simbol tombol.
const sb = (k) => `<button type="button" data-sym="${k}" aria-label="${SYMS[k].name}">${SYMS[k].sym}</button>`;
const BIG = `OTTV = ${sb('a')} · [ ${sb('uw')} · (1 − ${sb('wwr')}) · ${sb('td')} ] + ${sb('uf')} · ${sb('wwr')} · ${sb('dt')} + ${sb('sc')} · ${sb('wwr')} · ${sb('sf')}`;

// Nama kaca pendek untuk tombol: "Kaca warna (tinted) 8 mm" → "Warna (tinted)".
const shortGlass = (n) => { const t = n.replace(/^Kaca\s*/, '').replace(/\s*8 mm$/, ''); return t.charAt(0).toUpperCase() + t.slice(1); };

// ---------- Bagian ----------
export function chapters({ gl }) {
  const ch = [
    { id: 'beranda', shot: 'beranda', nav: 'Beranda', title: 'Beranda', html: '<div data-slot="home"></div>' },
    { id: 'bab-1', shot: 'bab1', nav: 'OTTV', title: 'OTTV itu apa?', html: `
      <p class="l3d-kicker">Belajar OTTV</p>
      <h2>OTTV itu apa?</h2>
      <p>OTTV (Overall Thermal Transfer Value) adalah rata-rata panas yang masuk lewat dinding dan kaca bangunan, dalam W/m². Makin besar angkanya, makin berat kerja AC untuk mendinginkan ruangan.</p>
      <p>SNI 6389:2020 membatasinya paling tinggi ${fmt(LIMIT)} W/m², untuk bangunan gedung yang memakai sistem tata udara.</p>
      <p>Bandingkan tiga versi tower ini. Makin pekat oranye di fasad, makin besar panas yang masuk lewat fasad itu.</p>
      <div class="l3d-seg" role="group" aria-label="Versi tower">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${p.label}</button>`).join('')}</div>
      <p class="l3d-muted" data-id="preset-desc"></p>
      <div class="l3d-gauge"><div class="l3d-gauge-num"><b data-id="ottv-total">–</b><span>W/m²</span></div><div class="l3d-gauge-bar"><i data-id="ottv-bar"></i><em style="left:${(LIMIT / 80) * 100}%"><span>batas ${fmt(LIMIT)}</span></em></div><p data-id="ottv-verdict" class="l3d-verdict"></p></div>` },
    { id: 'bab-2', shot: 'bab2', nav: 'Jalur panas', title: 'Panas masuk lewat mana?', html: `
      ${strip('ottv', ['a', 'uw', 'wwr', 'td', 'uf', 'dt', 'sc', 'sf'])}
      <h2>Panas masuk lewat mana?</h2>
      <p>Ada tiga jalur. Dua yang pertama adalah konduksi: panas merambat menembus bahan, seperti tanganmu yang ikut panas saat memegang gelas kopi. Jalur ketiga adalah radiasi: sinar matahari menembus kaca lalu memanaskan ruangan, seperti mobil yang diparkir di terik.</p>
      <p>OTTV satu fasad adalah jumlah ketiganya. Arahkan kursor ke tiap suku untuk mengunci jalurnya di model.</p>
      <div class="l3d-terms">
        <button type="button" data-term="wall"><i style="background:${HEAT_COLORS.wall}"></i><span>Konduksi dinding</span><code>α · Uw · (1 − WWR) · TDek</code><b data-id="t-wall">–</b></button>
        <button type="button" data-term="glass"><i style="background:${HEAT_COLORS.glass}"></i><span>Konduksi kaca</span><code>Uf · WWR · ΔT</code><b data-id="t-glass">–</b></button>
        <button type="button" data-term="solar"><i style="background:${HEAT_COLORS.solar}"></i><span>Radiasi lewat kaca</span><code>SC · WWR · SF</code><b data-id="t-solar">–</b></button>
      </div>
      <p class="l3d-sum">OTTV fasad Barat = <b data-id="t-total">–</b> W/m²</p>
      <p class="l3d-note" data-id="t-note"></p>` },
    { id: 'rumus', shot: 'rumus', nav: 'Rumus', title: 'Bedah rumus', html: `
      <p class="l3d-kicker">Bedah rumus</p>
      <h2>Satu per satu simbolnya</h2>
      <p>Klik simbol di rumus untuk melihat artinya, satuannya, dari mana nilainya, dan bagiannya di model.</p>
      <div class="l3d-big" role="group" aria-label="Rumus OTTV satu fasad">${BIG}</div>
      <div class="l3d-sym" data-id="sym-info" aria-live="polite"></div>
      <p class="l3d-muted l3d-num-head">Dengan angka tower ini, fasad Barat:</p>
      <p class="l3d-num" data-id="sym-num"></p>` },
    { id: 'bab-3', shot: 'bab3', nav: 'Kaca', title: 'Makin banyak kaca, makin panas', html: `
      ${strip('ottv', ['wwr'])}
      <h2>Makin banyak kaca, makin panas</h2>
      <p>WWR adalah perbandingan luas jendela (termasuk kusennya) terhadap luas fasad, dihitung per arah. Makin besar WWR, dua suku kaca membesar dan suku dinding mengecil. Karena radiasi lewat kaca jauh lebih besar, OTTV ikut naik.</p>
      <label class="l3d-ctl">WWR fasad Barat <input data-id="wwr" type="range" min="0.1" max="0.85" step="0.05" value="0.4"><output data-id="wwr-out">40%</output></label>
      <div class="l3d-stack" aria-hidden="true"><i data-id="s-wall" style="background:${HEAT_COLORS.wall}"></i><i data-id="s-glass" style="background:${HEAT_COLORS.glass}"></i><i data-id="s-solar" style="background:${HEAT_COLORS.solar}"></i></div>
      <dl class="l3d-stats"><div><dt>Konduksi dinding</dt><dd data-id="w-wall">–</dd></div><div><dt>Konduksi kaca</dt><dd data-id="w-glass">–</dd></div><div><dt>Radiasi lewat kaca</dt><dd data-id="w-solar">–</dd></div></dl>
      <p class="l3d-sum">OTTV fasad Barat = <b data-id="w-total">–</b> W/m²</p>
      <p class="l3d-muted"><b>Coba:</b> turunkan WWR ke 20%, lalu lihat berapa OTTV-nya turun.</p>` },
    { id: 'bab-4', shot: 'bab4', nav: 'Arah', title: 'Arah fasad itu penting', html: `
      ${strip('ottv', ['sf'])}
      <h2>Arah fasad itu penting</h2>
      <p>Tiap arah fasad menerima radiasi matahari yang berbeda. SNI merangkumnya dalam faktor radiasi matahari (SF): radiasi rata-rata per jam yang masuk lewat kaca bening 3 mm. Nilainya berbeda untuk tiap kota dan tiap arah. Makin pekat oranyenya, makin besar SF fasad itu.</p>
      <div class="l3d-sf" aria-label="SF Jakarta per arah, W/m²">${['U', 'T', 'S', 'B'].map((d) => `<div class="l3d-sf-row"><span>${DIR_NAME[d]}</span><i style="--w:${(sf()[d] / 200) * 100}%"></i><b>${fmt(sf()[d])}</b></div>`).join('')}<p class="l3d-muted">SF Jakarta, W/m²</p></div>
      <p><b>Coba:</b> seret matahari di lintasannya. Sore hari sinar menimpa fasad Barat secara langsung, itu sebabnya SF Barat paling tinggi.</p>
      <p class="l3d-readout" data-id="sun-readout">Jam 15.00</p>
      <p class="l3d-note">Bayangan bangunan sekitar hanya ilustrasi. Perhitungan OTTV di LUXA tidak memasukkan bayangan dari bangunan lain.</p>` },
    { id: 'bab-5', shot: 'bab5', nav: 'Peneduh', title: 'Meneduhkan kaca', html: `
      ${strip('ottv', ['sc'])}
      <h2>Meneduhkan kaca</h2>
      <p>Panas matahari lewat kaca diredam koefisien peneduh: SC = SC kaca × SC efektif peneduh. Pilihan kaca saja sudah mengubah banyak:</p>
      <div class="l3d-seg l3d-seg-wrap" role="group" aria-label="Jenis kaca">${SNI.glass.map((g) => `<button type="button" data-glass="${g.id}" title="${g.name}">${shortGlass(g.name)} <small>SC ${fmt(g.sc, 2)}</small></button>`).join('')}</div>
      <p>Overhang menahan sinar langsung sebelum mengenai kaca. Pengaruhnya bergantung pada R = kedalaman overhang ÷ tinggi kaca.</p>
      <label class="l3d-ctl">Kedalaman overhang <input data-id="depth" type="range" min="0" max="1.5" step="0.05" value="0.7"><output data-id="depth-out">0,70 m</output></label>
      <label class="l3d-ctl">Jam <input data-id="hour5" type="range" min="6" max="18" step="0.25" value="15"><output data-id="hour5-out">15.00</output></label>
      <dl class="l3d-stats l3d-stats-4"><div><dt>Rasio R</dt><dd data-id="r-out">–</dd></div><div><dt>SC efektif peneduh</dt><dd data-id="sc-out">–</dd></div><div><dt>SC total</dt><dd data-id="sct-out">–</dd></div><div><dt>Kaca terlindung jam ini</dt><dd data-id="shade-out">–</dd></div></dl>
      <p class="l3d-note">SC efektif peneduh dari tabel SNI, berlaku sepanjang tahun. Persentase kaca terlindung hanya untuk jam yang dipilih.</p>` },
    { id: 'bab-6', shot: 'bab6', nav: 'Dinding', title: 'Warna dan berat dinding', html: `
      ${strip('ottv', ['a', 'uw', 'td'])}
      <h2>Warna dan berat dinding</h2>
      <p>Suku dinding ditentukan tiga hal: nilai U (seberapa mudah panas merambat), absorptansi α (seberapa banyak sinar diserap permukaan), dan berat dinding yang menentukan TDek.</p>
      <ul class="l3d-facts">
        <li><b>Makin terang warnanya, makin kecil α</b>, makin sedikit sinar diserap. Putih semi kilap 0,30 · hijau medium 0,59 · hitam 0,95.</li>
        <li><b>Makin berat dindingnya, makin kecil TDek.</b> Di bawah 125 kg/m² 15 K · 126–195 kg/m² 12 K · di atas 195 kg/m² 10 K.</li>
      </ul>
      <div class="l3d-seg l3d-seg-wrap" role="group" aria-label="Jenis dinding">${SNI.wall.map((w) => `<button type="button" data-wall="${w.id}">${w.name}</button>`).join('')}</div>
      <label class="l3d-ctl">Warna permukaan luar (α) <input data-id="alpha" type="range" min="0.2" max="0.9" step="0.01"><output data-id="alpha-out">–</output></label>
      <dl class="l3d-stats l3d-stats-4"><div><dt>Nilai U</dt><dd data-id="d-u">–</dd></div><div><dt>Berat</dt><dd data-id="d-m">–</dd></div><div><dt>TDek</dt><dd data-id="d-td">–</dd></div><div><dt>Suku dinding</dt><dd data-id="d-q">–</dd></div></dl>
      <p class="l3d-sum">OTTV fasad Barat = <b data-id="d-total">–</b> W/m²</p>
      <p class="l3d-note">Tebal lapisan di potongan dibesarkan supaya terbaca. Nilai U, α, dan berat dari katalog material LUXA; α contoh dari Tabel 2 SNI.</p>` },
    { id: 'bab-7', shot: 'bab7', nav: 'Total', title: 'Menghitung semua sisi', html: `
      ${strip('total')}
      <h2>Menghitung semua sisi</h2>
      <p>OTTV bangunan adalah rata-rata OTTV semua fasad, ditimbang dengan luasnya (luas dinding ditambah jendelanya). Fasad yang luas dan menghadap arah panas paling besar pengaruhnya. Yang dinilai lolos atau tidak adalah angka total ini.</p>
      <div class="l3d-sides">${['U', 'T', 'S', 'B'].map((d) => `<div class="l3d-side"><span>${DIR_NAME[d]}</span><input type="range" min="0.1" max="0.85" step="0.05" data-side="${d}" aria-label="WWR ${DIR_NAME[d]}"><output data-side-out="${d}">–</output><b data-side-ottv="${d}">–</b></div>`).join('')}<p class="l3d-muted">Geser WWR tiap arah. Angka kanan = OTTV fasad itu (W/m²).</p></div>
      <div class="l3d-gauge"><div class="l3d-gauge-num"><b data-id="ottv-total7">–</b><span>W/m² OTTV total</span></div><div class="l3d-gauge-bar"><i data-id="ottv-bar7"></i><em style="left:${(LIMIT / 80) * 100}%"><span>batas ${fmt(LIMIT)}</span></em></div><p data-id="ottv-verdict7" class="l3d-verdict"></p></div>` },
    { id: 'bab-8', shot: 'bab8', nav: 'Atap', title: 'Bonus: atap juga dihitung', html: `
      ${strip('rttv')}
      <h2>Bonus: atap juga dihitung</h2>
      <p>Atap punya ukuran sendiri, RTTV, dengan rumus yang mirip OTTV: Ar luas atap tak tembus cahaya, As luas skylight, Ao luas seluruh atap. Batasnya ${fmt(SNI.rttvLimitSky)} W/m² bila atap memakai skylight, dan ${fmt(SNI.rttvLimitOpaque)} W/m² bila atap tertutup penuh.</p>
      <p>Atap juga punya TDek sendiri dari beratnya: di bawah 50 kg/m² 24 K, 50–230 kg/m² 20 K, di atas 230 kg/m² 16 K. Atap ringan cepat panas.</p>
      <div class="l3d-seg" role="group" aria-label="Jenis atap">${SNI.roof.map((r) => `<button type="button" data-roof="${r.id}">${r.name}</button>`).join('')}</div>
      <label class="l3d-ctl">Luas skylight <input data-id="sky" type="range" min="0" max="${(SKY_MAX_AREA / PODIUM_ROOF_AREA).toFixed(3)}" step="0.005"><output data-id="sky-out">–</output></label>
      <dl class="l3d-stats"><div><dt>Atap</dt><dd data-id="r-roof">–</dd></div><div><dt>Konduksi skylight</dt><dd data-id="r-cond">–</dd></div><div><dt>Radiasi skylight</dt><dd data-id="r-solar">–</dd></div></dl>
      <div class="l3d-gauge"><div class="l3d-gauge-num"><b data-id="rttv-total">–</b><span>W/m² RTTV</span></div><div class="l3d-gauge-bar"><i data-id="rttv-bar"></i><em data-id="rttv-limit"><span></span></em></div><p data-id="rttv-verdict" class="l3d-verdict"></p></div>
      <p class="l3d-note">Contoh: atap podium ${fmt(PODIUM_ROOF_AREA)} m² di luar tapak tower, skylight dari ${glassById('glz_kaca_tinted_8').name.toLowerCase()}, SF atap Jakarta ${fmt(sf().ROOF)} W/m².</p>` },
    { id: 'selesai', shot: 'akhir', nav: 'Selesai', title: 'Giliran desainmu', html: `
      <p class="l3d-kicker">Selesai</p>
      <h2>Giliran desainmu</h2>
      <p>Kamu sudah melihat semua yang membentuk OTTV dan RTTV: WWR, arah hadap, kaca, peneduh, dinding, dan atap. LUXA menghitung semuanya langsung dari model 3D-mu, per fasad dan per arah.</p>
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
  beranda: ['wave', 'Aku Lux. Ayo cek seberapa panas fasad desainmu hari ini.'],
  'bab-1': ['guide', 'Bayangkan bangunan itu cooler box. OTTV = seberapa bocor dindingnya. Coba pilih Hemat.'],
  'bab-2': ['think', 'Radiasi lewat kaca hampir selalu jadi suku terbesar. Perhatikan panah yang paling tebal.'],
  rumus: ['guide', 'Mulai dari α. WWR muncul tiga kali, makanya kaca berpengaruh besar.'],
  'bab-3': ['guide', 'Jendela lebar itu pintu masuk panas yang lebar juga.'],
  'bab-4': ['guide', 'Matahari sore itu pilih kasih: sisi barat yang paling kena.'],
  'bab-5': ['think', 'Overhang itu topi, kaca Low-E itu kacamata hitam. Paling ampuh dipakai dua-duanya.'],
  'bab-6': ['guide', 'Kaos putih vs kaos hitam di siang bolong. Dinding juga begitu.'],
  'bab-7': ['think', 'Mirip nilai rapor: pelajaran dengan SKS besar paling menentukan.'],
  'bab-8': ['report', 'Atap itu topi bangunan, bagian yang paling lama menghadap matahari.'],
  selesai: ['happy', 'Mantap, semua bagian beres. Yuk cek fasad desainmu sendiri.'],
};
