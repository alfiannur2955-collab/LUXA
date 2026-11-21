# Spesifikasi Fase 4: Rombak UI LUXA

Disusun 22 Nov 2026 dari diskusi Alfian dan Claude. Dokumen ini menggantikan tabel "Fase 4" lama di `docs/RENCANA.md` untuk semua urusan tampilan. Bagian backend lama (Kartu Konfirmasi, `build_sanity_flags`, `engine.js`) tetap berlaku dan diringkas ulang di sini.

## 0. Sumber kebenaran

Baca dalam urutan ini:

1. **Dokumen ini**: perilaku, alur, dan kriteria selesai.
2. **`docs/fase4/DESIGN.md`**: aturan visual (warna, kaca tiga tingkat, bento, tipografi, motif kompas, bahasa).
3. **`docs/fase4/brand/`**: logo LUXA vektor (lengkap, gelap, satu warna, simbol, favicon).
4. **`docs/fase4/tokens.json`**: nilai token persis untuk tema terang dan gelap. Jadikan CSS custom properties (`--paper`, `--sun`, `--glass`, dan seterusnya). Jangan menulis hex langsung di komponen.
5. **`docs/fase4/mockup/*.html`**: mockup statis per layar. Buka `index.html`. Ikuti tata letak, hierarki, dan teksnya. Gambar menara di mockup hanya ilustrasi; viewer asli memakai Three.js dengan geometri model sungguhan.

Kalau dokumen ini dan mockup berbeda, ikuti dokumen ini.

## 1. Keputusan yang sudah dikunci

| # | Keputusan |
|---|---|
| D1 | Nama produk **LUXA by Alf Studio**, selalu tampil sesuai logo (simbol, "LUXA", "by Alf Studio"). Tidak ada keterangan tambahan di samping nama. Logo vektor di `docs/fase4/brand/` (lihat bagian 2a). |
| D2 | Alur: Unggah, Konfirmasi, Inspeksi, Hasil. Tidak ada form sebelum unggah. |
| D3 | Viewer 3D mengambil 70 sampai 80% lebar area kerja. Kolom samping 300 px, isi kartu padat tanpa ruang kosong. |
| D4 | Rel kiri berisi ikon + label: Model, Material, Lokasi, Tampilan, Bandingkan, Laporan, dan Bantuan di bawah. Klik membuka kartu fiturnya; satu kartu terbuka dalam satu waktu; Escape menutup. |
| D5 | Kaca tiga tingkat sesuai `DESIGN.md`: tingkat 1 untuk semua yang melayang di atas viewer, tingkat 2 untuk kartu samping, tingkat 3 untuk rel dan indikator langkah. Latar halaman putih hangat dengan `glow-warm` dan `glow-cool`. |
| D6 | Mode viewer: **Klasifikasi**, Orientasi, Heatmap, Kejanggalan, X-ray. Istilah "Peran" tidak dipakai lagi di UI. |
| D7 | Heatmap default **per arah** (setiap panel diwarnai OTTV arahnya). Sakelar di legenda untuk **per panel** (warna dari `ottv_panel_wm2`). |
| D8 | Klik panel menampilkan label nilai tepat di titik yang diklik (seperti titik ukur Autodesk Forma). Detail di kartu "Bidang terpilih". Klik area kosong viewer untuk melepas pilihan. Nilai panel diberi label **kontribusi**; status Memenuhi/Tidak hanya untuk OTTV total. |
| D9 | Proyeksi: Perspektif, Perspektif 2 titik, Aksonometri, Tampak (paralel). Tampak tersedia untuk 8 arah SNI dan Atas. |
| D10 | Kubah matahari dengan skala 50 sampai 200% dan tombol "Pas ke model". |
| D11 | Orientasi diatur di viewer dengan memutar arah utara (cincin kompas atau angka). Model tidak pernah diputar. Mengubah utara menampilkan chip "Hitung ulang". |
| D12 | View tersimpan: tambah, ganti nama, hapus per view. Menyimpan kamera, proyeksi, mode, skala heatmap, tanggal dan jam matahari, filter fasad. Pilihan properti yang disimpan ada di menu "Lainnya". |
| D13 | Capture PNG 1x, 2x, 4x dengan cap kecil: nama model, tanggal, OTTV total, status. |
| D14 | Filter fasad: semua arah, arah yang dipilih, yang terkena matahari pada jam ini (terhubung slider jam dan tanggal, memperhitungkan bayangan bangunan sekitar). Wajib ada catatan bahwa OTTV memakai SF tahunan dan tidak berubah saat jam digeser. |
| D15 | Bilah bawah viewer: dua pil kaca. Kiri: proyeksi, arah, putar + slider jam. Kanan: daftar view tersimpan, Simpan, Capture. Panel Tampilan lengkap tetap dari rel. |
| D16 | Kartu rumus versi minimal berupa pil (contoh: OTTV_B 49,68 W/m²) yang bisa digeser, dibuka menjadi rumus lengkap dengan substitusi, disematkan, dan diciutkan. |
| D17 | Workspace siap pakai: Belajar (default), Lanjut, Presentasi. v1: urutkan ulang dan sembunyikan item dock, pindah baris mode ke bawah. Drag-dock bebas dan workspace buatan sendiri masuk v2 (setelah publish). |
| D18 | Pintasan keyboard, pie menu 8 arah (tahan V), dan palet perintah Ctrl K. |
| D19 | Mode **Bandingkan**: viewer dibelah dua dengan pembatas yang bisa digeser, kartu selisih per arah, daftar alternatif. Alternatif dihitung engine sungguhan. |
| D20 | Tombol unduh bernama "Unduh laporan (.xlsx)" dan "Unduh proyek (.ottv.json)". Kata "prodi" tidak muncul di UI. |
| D21 | Tema terang default, gelap lewat sakelar. Keduanya wajib lengkap. |

## 2. Arsitektur frontend

Pecah `src/main.js` (3.554 baris) dan `src/stagingWorkspace.js` (1.470 baris) menjadi modul:

```
src/
  state.js            satu objek ProjectConfig + status UI; event emitter kecil
  engine.js           SATU-SATUNYA tempat fetch('/api/...'); diganti versi Pyodide di Fase 5
  theme.css           token dari docs/fase4/tokens.json sebagai CSS variables, kedua tema
  shell/              topbar.js, rail.js, steps.js, cardHost.js (kartu fitur dari rel)
  steps/              upload.js, confirm.js, inspect.js, results.js, status.js
  viewer/             viewer.js, cameras.js, modes.js, selection.js, labels.js,
                      sundome.js, compass.js, exposure.js, views.js, capture.js, axes.js
  panels/             tampilan.js, material.js, lokasi.js, bandingkan.js, laporan.js, bantuan.js
  ui/                 glass.js (helper kelas), pill.js, seg.js, kbd.js, commandPalette.js,
                      pieMenu.js, shortcuts.js, toast.js
  workspace.js        preset Belajar/Lanjut/Presentasi + kustomisasi v1, simpan di localStorage
  project.js          simpan/buka .ottv.json, simpan otomatis di localStorage
```

Aturan:

- `engine.upload(file)`, `engine.inspect(config)`, `engine.analyze(config)`, `engine.exposure(analysisId, date, hours)`, `engine.export(analysis, fmt)`. Tidak boleh ada `fetch('/api/` di luar `engine.js`.
- Semua teks dari file model (nama layer, material, nama file) disisipkan lewat `textContent` atau `escapeHtml()`. Tidak ada `innerHTML` berisi data model.
- Penyimpanan otomatis ke `localStorage` dibungkus `try/catch`. Tidak ada penyimpanan diam-diam ke server: konfigurasi baru ditulis ke server saat Hitung, bukan saat Inspeksi Ulang (temuan audit).
- Hapus: `inspect3dmFileClientSide` (rhino3dm.js/wasm tetap ada untuk Fase 5), bar 5 tahap, form 5 software, slider global, 4 mode heatmap lama, tombol Excel kedua, label versi ganda.

## 2a. Identitas LUXA

- Salin `docs/fase4/brand/*.svg` ke `frontend/public/brand/`. `favicon.svg` jadi favicon (`<link rel="icon" type="image/svg+xml">`); ia menyesuaikan tema browser sendiri.
- Bar atas: `luxa-mark.svg` 30 px (versi `-dark` di tema gelap), tulisan "LUXA" (Montserrat 700, letter-spacing 0,06em) dan di bawahnya "by Alf Studio" (Montserrat 400, 11 px, `ink-muted`), meniru susunan logo. Seluruhnya satu tautan ke layar awal.
- Layar Unggah: `luxa-logo.svg` / `luxa-logo-dark.svg` boleh tampil di kartu "Tentang hasilnya" bersama "LUXA by Alf Studio".
- Judul tab: "LUXA · <nama langkah>". Laporan dan cap Capture memakai logo lengkap (`luxa-logo.svg`) atau `luxa-logo-mono.svg`.
- Warna logo (`brand-*`) hanya untuk logo. Antarmuka memakai `sun` (amber, aksen) dan `ok` (toska, teduh/Memenuhi) yang sudah digelapkan supaya lolos kontras.
- Muat Montserrat 400 dan 700 hanya untuk tulisan LUXA dan "by Alf Studio"; teks lain tetap Plus Jakarta Sans.
- Sebelum publish: cek merek "LUXA" di PDKI DJKI dan ketersediaan domain (tugas Alfian, bukan agen).

## 3. Layar dan alur

Lihat mockup 1 sampai 8. Ringkasan perilaku:

**3.1 Unggah (mockup 1).** Area seret-lepas + tombol "Pilih file model" (`<label>` untuk `<input type=file>`) + "Buka proyek tersimpan (.ottv.json)". Kartu "Belum punya model?" dengan dua contoh: kotak 4 lantai (`fixtures/synthetic/01_kotak_m`) dan `fasad_unitized_24lantai.3dm`. Kartu "Tentang hasilnya" berisi disclaimer. Kalimat "semua dihitung di browser kamu" **hanya** ditampilkan setelah Fase 5; sebelum itu ganti dengan "Model diproses di server LUXA dan tidak dibagikan."

**3.2 Konfirmasi (mockup 2).** Kartu kaca melayang di atas viewer, terisi otomatis dari `detect_file_signature` dan audit Stage 1: satuan (+ sumbernya), sumbu atas, ukuran bangunan, perkiraan lantai, muka tanah, lokasi, arah utara. Tiap baris punya ikon status (centang hijau / segitiga kuning) dan tombol Ubah. Pertanyaan yang harus dijawab:
- **Muka tanah** bila `z0 < -0,5 m`: "z = 0 adalah muka tanah" atau "alas model adalah muka tanah".
- **Isi model**: fasad saja / gedung lengkap / gedung + tapak.
- **Tanpa kaca** bila peringatan `NO_GLAZING`: "Bangunan memang tanpa kaca (WWR 0)" atau "Isi WWR asumsi" (memunculkan `ASSUMED_WWR`).
- **Satuan** bila `unit_source = bbox_guess`.

Tombol utama nonaktif dengan teks yang menyebut apa yang kurang ("Pilih muka tanah dulu") sampai semua baris hijau.

**3.3 Inspeksi (mockup 3).** Viewer + kolom samping: tabel "Grup terdeteksi" (grup, klasifikasi dengan chip warna, luas luar) dan "Daftar kejanggalan" bernomor. Nomor yang sama tampil sebagai penanda di viewer. Setiap kejanggalan punya aksi ("Lihat di model", "Pilih material", "Hitung tanpa rangka", "Mengerti"). Tombol "Hitung OTTV" di bawah dengan keterangan bila hasil akan berstatus Sementara. Mode Heatmap nonaktif sebelum dihitung (tooltip "Tersedia setelah OTTV dihitung").

**3.4 Hasil (mockup 4 dan 4b).** Viewer mode Heatmap + kubah matahari. Kolom samping: OTTV total (angka besar, WWR dan SC kecil di kanan atas, chip status dan Sementara), Bidang terpilih, Per arah (8 baris batang horizontal, garis putus = batas 35, klik baris = pilih fasad itu), lalu Unduh laporan dan Unduh proyek di bawah. Baris atas viewer (mode, pil rumus, kompas) sejajar: semuanya `top: 16px`, tinggi 52 px, sama dengan padding atas kartu OTTV total.

**3.5 Memuat dan galat (mockup 5).** Memuat: kompas 8 garis yang menyala bergiliran (berhenti di `prefers-reduced-motion`), nama file, ukuran, perkiraan waktu, daftar tahap dengan status, tombol Batalkan. Tahap diambil dari progres nyata (polling atau SSE), bukan animasi palsu. Galat: apa yang gagal, kenapa, dan dua aksi.

**3.6 Bandingkan (mockup 8).** Dari rel "Bandingkan". Alternatif dibuat dengan menyalin ProjectConfig lalu mengubah material, peneduh, atau utara; masing-masing dihitung dengan `engine.analyze`. Viewer dibelah dua (pembatas geser, `cursor: ew-resize`, bisa digeser dengan keyboard panah). Kartu selisih per arah di bawah, ringkasan selisih total di samping, daftar alternatif, tombol "Pakai Alternatif A" (desain sekarang tersimpan sebagai riwayat). Bila material alternatif punya catatan katalog (contoh: elektrokromik = kondisi paling gelap), tampilkan catatannya.

## 4. Viewer 3D

**4.1 Proyeksi** (`viewer/cameras.js`)

| Proyeksi | Implementasi | Pintasan |
|---|---|---|
| Perspektif | `PerspectiveCamera`, orbit bebas | 1 |
| Perspektif 2 titik | `PerspectiveCamera` dengan pitch kamera dikunci 0 dan sudut pandang vertikal digeser lewat `camera.setViewOffset` / film offset, sehingga garis vertikal tetap tegak | 2 |
| Aksonometri | `OrthographicCamera`, arah isometrik dari kuadran aktif | 3 |
| Tampak | `OrthographicCamera` tegak lurus fasad arah terpilih (U, TL, T, TG, S, BD, B, BL) atau Atas | 4 |

Arah tampak dihitung dari `north_angle_deg` (azimut dari +Y searah jarum jam, konvensi engine). Transisi antarproyeksi 200 ms, langsung tanpa animasi di bawah `prefers-reduced-motion`.

**4.2 Mode** (`viewer/modes.js`)

- **Klasifikasi**: warna dari token `data-glazing`, `data-wall`, `data-shading`, `data-unknown` (unknown + arsiran diagonal lewat tekstur), rangka abu gelap, atap dan diabaikan transparan.
- **Orientasi**: 8 arah dipetakan ke putaran warna netral-ke-hangat mengikuti kompas.
- **Heatmap**: per arah (default) atau per panel. Skala tetap: < 25, 25 sampai 32, 32 sampai 35, > 35 W/m² memakai `heat-0` sampai `heat-3`. Legenda menampilkan sakelar per arah / per panel.
- **Kejanggalan**: elemen bermasalah menyala dengan warna `warn` dan nomor sesuai daftar; sisanya pudar.
- **X-ray**: semua elemen transparan, bidang yang disaring (`filtered_items`) tampil putus-putus.

**4.3 Seleksi** (`viewer/selection.js`, `viewer/labels.js`). Raycast klik ke panel (`panels[].id`). Shift+klik menambah. Klik area kosong melepas. Label nilai adalah elemen HTML kaca tingkat 1 yang diposisikan dari proyeksi `centroid` setiap frame (bukan sprite), isi: jenis panel + arah, `ottv_panel_wm2` + kata "kontribusi". Kartu "Bidang terpilih": grup, SF, SC, Uf (atau α, Uw, TDek untuk dinding), kontribusi, dan porsi panas: jumlah `heat_gain_w` pilihan dibagi total. Pilihan banyak: luas total dan rata-rata tertimbang luas.

**4.4 Kubah matahari** (`viewer/sundome.js`). Hitung posisi matahari dari `location_info.latitude_deg`, deklinasi, dan sudut jam (rumus vektor E, N, U). Gambar cincin arah U/T/S/B dengan 8 tick, tiga lintasan (21 Jun, 21 Mar / 23 Sep, 21 Des), titik matahari pada tanggal dan jam aktif, garis putus ke pusat. Radius default = 1,6 x setengah diagonal denah model; slider 50 sampai 200%; "Pas ke model" mengembalikan ke default. Info kecil: tinggi dan azimut matahari.

**4.5 Kompas dan utara** (`viewer/compass.js`). Kompas kaca 52 px di kanan atas. Drag cincin memutar utara (langkah 1°, Shift = 15°). Mengubah utara memperbarui label arah dan kubah seketika, lalu menampilkan chip "Hitung ulang" karena OTTV per arah berubah.

**4.6 Paparan matahari** (`viewer/exposure.js`). Untuk bulan rancangan, pakai `panels[].sunlit_mask` dan `solar_vectors` yang sudah ada. Untuk tanggal lain, `engine.exposure()` memanggil endpoint baru (bagian 7) yang menghitung 13 posisi (06.00 sampai 18.00) sekali, lalu animasi memutar hasil itu. Filter "yang terkena matahari jam ini": panel dengan `sunlit_mask[jam] = true` diwarnai `heat-1`, sisanya `data-wall`.

**4.7 View tersimpan dan capture** (`viewer/views.js`, `viewer/capture.js`). View disimpan di ProjectConfig (ikut `.ottv.json`). Capture: render ulang ke canvas offscreen pada 1x/2x/4x, tambahkan cap di pojok kanan bawah, unduh PNG bernama `<model>_<view>_<tanggal>.png`.

**4.8 Sumbu**. Gizmo X (merah, `fail`), Y (hijau, `ok`), Z (biru, `data-glazing`) di pojok kanan bawah viewer.

## 5. Panel, toolbar, dan workspace

- **Bar atas**: nama, indikator langkah (kaca tingkat 3), "Cari perintah Ctrl K", sakelar tema, "Mode lanjut".
- **Baris mode** (kaca tingkat 1, kiri atas viewer, satu baris): Klasifikasi, Orientasi, Heatmap | Kejanggalan, X-ray. Mode aktif blok `ink`.
- **Pil rumus** (kanan atas, di kiri kompas). Bisa digeser (pointer + keyboard), posisinya disimpan per workspace.
- **Panel Tampilan** (mockup 6): bagian Kamera (proyeksi, kisi 8 arah + Atas, arah utara), Matahari (tanggal, jam, skala kubah, putar satu hari, pas ke model), Tampilkan fasad (tiga pilihan + catatan SF), Workspace (preset + "Atur urutan dan isi dock").
- **Workspace v1**: preset menentukan item rel dan pil yang terlihat. Belajar = semua item dengan tooltip istilah aktif. Lanjut = tabel per bidang, override material per orientasi, dan pengaturan pintasan. Presentasi = sembunyikan rel dan kolom samping, viewer penuh, pil bawah tetap. Kustomisasi v1: urutkan ulang dan sembunyikan item dock, pindah baris mode ke bawah. Disimpan di `localStorage` (`luxa.workspace.v1`).

## 6. Pintasan

| Tombol | Aksi |
|---|---|
| 1 2 3 4 | Perspektif, 2 titik, Aksonometri, Tampak |
| tahan V | Pie menu 8 arah (lepas untuk memilih; Escape batal) |
| F | Pas ke model |
| S | Simpan view |
| C | Capture |
| Spasi | Putar matahari satu hari |
| Shift + klik | Tambah ke pilihan |
| Esc | Tutup kartu atau palet |
| Ctrl K | Palet perintah (cari semua aksi, view tersimpan, grup) |
| ? | Daftar pintasan |

Pintasan tidak aktif saat fokus di input teks. Pie menu juga bisa dibuka dengan tombol "Arah" di pil bawah (aksesibel: menu dengan panah kiri/kanan).

## 7. Kebutuhan backend

1. **`build_sanity_flags`** (dari rencana lama) di `adapters/__init__.py`, dikembalikan `POST /inspect`, ditambah aturan baru:
   - rasio luas selubung terhadap (keliling bbox x tinggi) < 0,5 atau > 1,4: "luas fasad tidak wajar";
   - `z0 < -0,5 m`: pertanyaan muka tanah;
   - `NO_GLAZING`: pertanyaan tanpa kaca;
   - grup kaca dengan material opak, WWR sisi > 95%, dimensi < 2 m atau > 400 m, `missing_mesh`, `unknown`, bidang tersaring luas.
2. **`GET /api/analyses/{id}/exposure?date=YYYY-MM-DD`**: `solar_vectors` 06.00 sampai 18.00 dan `sunlit` per panel per jam (pakai ulang raycast yang ada, cache berbasis hash konten).
3. **`analyze` menerima `north_angle_deg` baru** tanpa unggah ulang (sudah lewat ProjectConfig; pastikan cepat karena cache geometri tetap).
4. Respons `analyze` sudah memuat `panels[].ottv_panel_wm2`, `heat_gain_w`, `sunlit_mask`, `centroid`, `normal`: jangan diubah namanya.

## 8. Teks

Bahasa Indonesia baku yang ramah, sama nadanya dengan mockup. Tombol menyebut aksinya. Tidak memakai em dash. Status ditulis lengkap ("Tidak memenuhi, batas 35", "Sementara"). Istilah SNI apa adanya (OTTV, WWR, SC, SF, TDek) dengan tooltip satu kalimat + rujukan pasal di workspace Belajar.

## 9. Aksesibilitas dan kualitas (gerbang antislop)

- Semua kontrol `<button>` atau `<a href>` asli, `cursor: pointer`, nama yang bisa dibaca (ikon saja wajib `aria-label`), status hover/aktif/nonaktif.
- Fokus terlihat (`outline: 2px solid var(--sun)`), urutan Tab mengikuti tampilan, Escape menutup kartu.
- Kontras teks minimal 4,5:1 di kedua tema, termasuk di atas kaca pada titik latar paling hangat.
- `prefers-reduced-motion`: tanpa animasi kamera, kompas memuat diam. `prefers-reduced-transparency` dan browser tanpa `backdrop-filter`: semua kaca jadi `surface` penuh.
- Setiap kotak data punya keadaan kosong, memuat, galat yang menyebut langkah berikutnya.
- Responsif: 1440, 1280, 768 px. Di bawah 860 px rel jadi baris horizontal, baris mode dan pil pindah ke bawah viewer.
- Tidak ada angka karangan di UI. Placeholder ditulis sebagai placeholder.

## 10. Pembagian sub-fase

| Sub-fase | Isi | Selesai kalau |
|---|---|---|
| **4a** Kerangka dan alur | Token dan tema, shell (bar atas, rel, kartu fitur), `state.js`, `engine.js`, layar Unggah, Konfirmasi, Inspeksi, Hasil versi dasar (viewer mode Klasifikasi + Heatmap per arah, kolom samping), Memuat/galat, `build_sanity_flags`, simpan/buka `.ottv.json` | Alur lengkap jalan dengan `Facade only to Alfian.3dm` dan `fixtures/synthetic/01_kotak_m`; tombol Hitung terkunci sampai Konfirmasi hijau; tidak ada `fetch('/api/` di luar `engine.js`; kedua tema lengkap |
| **4b-1** Kamera dan view | 4 proyeksi, 8 arah + Atas, pie menu V, view tersimpan, capture, sumbu, pintasan, palet Ctrl K, daftar pintasan | Semua pintasan bekerja; view tersimpan bertahan setelah muat ulang `.ottv.json`; capture 4x menghasilkan PNG dengan cap |
| **4b-2** Analisis di viewer | Seleksi + label + Bidang terpilih, Heatmap per panel, mode Orientasi/Kejanggalan/X-ray, kubah matahari + skala, kompas utara + Hitung ulang, filter paparan + endpoint exposure + animasi, pil rumus | Klik panel kaca Barat model teman menampilkan 56,44 W/m² kontribusi; porsi panas kaca Barat 32%; filter jam 13.00 tanggal 23 Sep menyalakan fasad Barat dan tidak menyalakan Selatan |
| **4c** Bandingkan, workspace, poles | Mode Bandingkan, workspace v1, panel Material/Lokasi/Laporan/Bantuan, tooltip istilah, aksesibilitas, responsif, uji 3 mahasiswa | Alternatif kaca elektrokromik untuk model teman memberi 27,71 W/m²; uji dengan 3 teman mahasiswa memakai `fasad_unitized_24lantai.3dm`, catat titik bingung di `docs/UJI_PENGGUNA_FASE4.md` |

Setiap sub-fase: branch sendiri dari `main`, commit per layar atau fitur, `pytest` dan `npm run build` hijau, catatan di `docs/CHANGELOG-fase4.md`.

## 11. Bukan bagian Fase 4

Mode browser/Pyodide (Fase 5), akun, drag-dock bebas dan workspace buatan sendiri (v2), logo final, terjemahan Inggris.
