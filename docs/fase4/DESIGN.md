# LUXA

LUXA (by Alf Studio) adalah alat hitung OTTV dan RTTV (SNI 6389:2020) berbasis model 3D untuk mahasiswa arsitektur. Nama selalu tampil seperti logo: simbol, "LUXA", lalu "by Alf Studio" di bawahnya. Tidak ada keterangan tambahan di samping nama.

## Logo

Lingkaran terbelah diagonal di dalam bingkai: belahan oranye adalah matahari (panas yang masuk), belahan toska adalah teduh (yang ditahan desain), bingkai adalah selubung bangunan. File vektor:

| File | Pakai untuk |
|---|---|
| `luxa-logo.svg` | logo lengkap di latar terang (layar Unggah, laporan) |
| `luxa-logo-dark.svg` | logo lengkap di latar gelap |
| `luxa-logo-mono.svg` | cetak satu warna, cap Capture |
| `luxa-mark.svg`, `luxa-mark-dark.svg` | simbol saja: bar atas, ikon aplikasi |
| `favicon.svg` | favicon, otomatis menyesuaikan tema browser |

Warna logo (`brand-orange`, `brand-teal`, `brand-ink`, `brand-slate`) hanya untuk logo. Jangan mengubah bentuk, rasio, atau warna belahan. Ruang kosong di sekeliling logo minimal setebal sisi kiri bingkai. Tulisan "LUXA" memakai Montserrat Bold dan "by Alf Studio" Montserrat Regular, keduanya sudah dijadikan path di file SVG.

**Design Read.** Aplikasi simulasi teknik 3D untuk mahasiswa arsitektur, dengan bahasa visual tenang dan bersih: permukaan solid di atas kertas hangat, panel kaca hanya yang melayang di atas model. Dial: ENERGY 2 / RHYTHM 2 / MOTION 2.

## Prinsip

1. **Model adalah halaman.** Viewer 3D selalu kotak terbesar di layar, 70 sampai 80% lebar area kerja di laptop. Kartu samping dibuat ringkas, tanpa ruang kosong di dalamnya. Semua angka melayani pertanyaan "apa yang terjadi pada model ini?".
2. **Ikon dulu, kartu kemudian.** Di tampilan utama, fitur hanya tampil sebagai ikon + label pendek di rel. Klik membuka kartu fitur yang sebenarnya. Satu kartu terbuka dalam satu waktu; Escape menutupnya.
3. **Tebak, lalu minta konfirmasi.** Aplikasi mengisi semua yang bisa dibaca dari file, lalu menandai apa yang perlu dicek. Tidak ada asumsi diam-diam.
4. **Setiap angka bisa dibuka.** Klik angka OTTV mana pun membuka rumus dan substitusinya, ditulis seperti di buku teks.

## Warna

Dua warna inti mengikuti logo. **`sun`** (amber, sekeluarga dengan oranye logo) adalah satu-satunya aksen: tombol Hitung, angka OTTV yang sedang dipilih, dan cincin fokus. **`ok`** (toska "teduh") dipakai untuk status Memenuhi dan klasifikasi peneduh. Oranye berarti panas, toska berarti teduh, sama dengan logo. Keduanya digelapkan dari warna logo supaya teks lolos kontras 4,5:1.

Netral: `paper` (latar), `surface` (kotak), `surface-sunken` (input), `ink` dan `ink-muted` (teks). Status memakai `ok`, `warn`, `fail`, selalu dengan ikon dan kata.

Warna data hanya di viewer dan grafik: `data-glazing`, `data-wall`, `data-shading`, `data-unknown` untuk mode Peran; `heat-0` sampai `heat-3` untuk Heatmap. Skala panas berurutan dari terang ke gelap, jadi tetap terbaca oleh pengguna buta warna. Grup unknown selalu diberi arsiran diagonal selain warnanya.

Mode Orientasi memetakan arah mata angin ke putaran warna netral-ke-hangat di sekeliling kompas, bukan delapan warna acak.

## Kaca (liquid glass)

Atas permintaan pemilik produk (21 Nov 2026), kaca dipakai lebih luas daripada batas antislop R-10 (1 sampai 2 elemen). Supaya tetap seimbang, kaca dibagi tiga tingkat:

| Tingkat | Token | Dipakai di | Resep |
|---|---|---|---|
| 1, melayang | `glass` | toolbar mode, kompas, kartu rumus, Kartu Konfirmasi di atas viewer | blur 18px, saturate 1.4, bayangan `float` |
| 2, kartu | `glass-card` | kotak bento di samping viewer | blur 20px, saturate 1.5, tanpa bayangan besar |
| 3, tipis | `glass-thin` | rel ikon, indikator langkah, legenda, tombol sekunder | blur 14px |

Semua kaca memakai tepi 1px `glass-edge` dan sudut `radius-lg` (kartu) atau `radius-md` (kontrol kecil). Tetap solid: viewer 3D itu sendiri, tombol utama (`sun`), tabel di dalam kartu, dan dialog konfirmasi hapus.

Latar halaman `paper` diberi dua cahaya lembut, `glow-warm` di kanan atas dan `glow-cool` di kiri bawah. Alasannya fungsional: kaca di atas putih rata tidak terlihat sebagai kaca. Cahaya hangat sekaligus menggemakan matahari, inti dari OTTV.

Cadangan untuk browser tanpa backdrop-filter dan untuk `prefers-reduced-transparency`: semua tingkat kaca menjadi `surface` penuh.

## Bento grid

Layar kerja tersusun sebagai bento karena isinya memang berbeda ukuran dan bobot: viewer (terbesar), ringkasan OTTV (sedang), kejanggalan (sedang, tinggi), orientasi (lebar), RTTV (kecil). Ukuran kotak mengikuti pentingnya isi. Jarak antar kotak `space-2`, padding `space-4` atau `space-6`, sudut `radius-lg`. Kotak bento rata, tanpa bayangan.

## Tipografi

**Plus Jakarta Sans** untuk semua antarmuka. Alasannya: dirancang untuk identitas Jakarta, terasa lokal, bentuknya geometris bersih, dan angkanya jelas (pakai `tabular-nums` untuk semua angka). **Newsreader Italic** hanya untuk rumus, supaya variabel seperti α, Uw, dan WWR tampil seperti di SNI dan buku teks. Label tidak memakai huruf kapital semua.

## Motif identitas: kompas delapan arah

Delapan arah SNI (U, TL, T, TG, S, BD, B, BL) adalah bahasa visual yang berulang: kompas putar di viewer, chip orientasi di tabel, dan indikator muat berupa delapan garis yang menyala bergiliran. Gerakan ini berhenti di bawah `prefers-reduced-motion`.

## Ikon

Satu set ikon garis 1.5px, dipilih per fungsi (kubus untuk model, kompas untuk orientasi, termometer untuk OTTV, segitiga peringatan untuk kejanggalan). Ikon selalu punya label teks di rel; ikon tanpa label wajib punya `aria-label`. Tidak memakai ikon kilau, bintang, atau robot.

## Gerak

Dial MOTION 2: transisi pendek (160 sampai 220 ms) saat kartu fitur terbuka dan saat mode viewer berganti. Tidak ada animasi berulang selain indikator muat. Semua gerak berhenti di bawah `prefers-reduced-motion`.

## Bahasa dan teks

Bahasa Indonesia baku yang ramah, istilah SNI apa adanya (OTTV, WWR, SC, SF, TDek). Tombol menyebut aksinya: "Hitung OTTV", "Periksa model", "Unduh laporan prodi". Tidak memakai em dash. Status ditulis lengkap: "Memenuhi (≤ 35 W/m²)", "Sementara, perlu konfirmasi".

## Keadaan layar

Setiap kotak data punya tiga keadaan: kosong (menyebut langkah berikutnya, misalnya "Unggah model .3dm, .ifc, .obj, atau .glb untuk mulai"), memuat (kompas delapan garis + tahap yang sedang berjalan + tombol Batal), dan galat (apa yang gagal + apa yang bisa dilakukan).

## Tema

Terang adalah default karena mahasiswa sering mengambil tangkapan layar untuk laporan. Gelap tersedia lewat sakelar, dan semua token sudah lolos kontras di kedua tema.
