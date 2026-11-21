# Changelog Fase 4 — Antarmuka LUXA by Alf Studio

Dokumen ini mencatat perubahan arsitektur antarmuka dan pendukung backend pada Fase 4 berdasarkan [FASE4_UI_SPEC.md](FASE4_UI_SPEC.md), [DESIGN.md](fase4/DESIGN.md), [tokens.json](fase4/tokens.json), dan aset di [fase4/brand/](fase4/brand/).

---

## Fase 4a — Kerangka, Identitas LUXA, dan Alur 4 Langkah (`fase-4a-kerangka`)

### 1. Identitas Produk LUXA by Alf Studio & Sistem Tema
- Menyalinkan seluruh aset merek (`favicon.svg`, `luxa-mark.svg`, `luxa-mark-dark.svg`, `luxa-logo.svg`, `luxa-logo-dark.svg`, `luxa-logo-mono.svg`) ke `frontend/public/brand/` dan menghubungkan `favicon.svg` di `frontend/index.html`.
- Memuat tipografi `Plus Jakarta Sans` (antarmuka, `tabular-nums` untuk angka), `Newsreader` italic (rumus), dan `Montserrat` 400/700 khusus untuk kata `LUXA` dan `by Alf Studio`.
- Membuat `frontend/src/theme.css` langsung dari `docs/fase4/tokens.json` untuk tema terang (default) dan tema gelap (`.app.dark` / `[data-theme="dark"]`), termasuk 3 tingkat permukaan kaca cair (`--glass`, `--glass-card`, `--glass-thin`, `--glass-edge`), latar cahaya hangat/sejuk (`--glow-warm`, `--glow-cool`), fallback solid otomatis untuk `@supports not (backdrop-filter: blur(1px))` dan `@media (prefers-reduced-transparency: reduce)`, serta penonaktifan animasi pada `@media (prefers-reduced-motion: reduce)`.
- Mengganti seluruh penyebutan `OTTVista` yang tersisa di dokumen spesifikasi (`luxa.workspace.v1`) dan antarmuka menjadi `LUXA`, tanpa mengubah nama repositori atau nama paket npm.

### 2. Backend `build_sanity_flags`, Contoh Bawaan, & Status Sementara
- Menambahkan `build_sanity_flags(groups, audit, analysis_preview, user_answers)` di `backend/adapters/__init__.py` dan mengembalikannya sebagai `sanity_flags` pada `POST /api/models/{id}/inspect` (tetap *read-only*, tanpa menulis berkas atau menjalankan *raycast* surya).
- Aturan pemeriksaan kejanggalan yang diterapkan:
  - Rasio luas selubung luar terhadap `(keliling bbox × tinggi) < 0,5` atau `> 1,4` (`FACADE_AREA_RATIO` — "Luas fasad tidak wajar").
  - `z_ground_offset_m < -0,5 m` (`Z0_BELOW_ZERO` — pertanyaan wajib muka tanah).
  - Tidak ada grup kaca aktif (`NO_GLAZING` — pertanyaan wajib tanpa kaca vs WWR asumsi).
  - Grup berkategori kaca dengan material/nama tidak tembus pandang (`GLAZING_OPAQUE_MATERIAL`).
  - WWR satu sisi fasad `> 95%` (`HIGH_SIDE_WWR`).
  - Dimensi bangunan `< 2 m` atau `> 400 m` (`DIMENSION_OUT_OF_RANGE`).
  - Objek tanpa *render mesh* (`MISSING_MESH`), grup `unknown` (`UNKNOWN_GROUPS`), bidang tersaring otomatis berukuran besar (`FILTERED_ITEMS_LARGE`), satuan tebakan kotak pembatas (`UNIT_NEEDS_CONFIRMATION`), selisih perkiraan lantai `> 20%` (`FLOOR_COUNT_MISMATCH`), dan info tanpa atap (`NO_ROOF`).
- Menambahkan field `model_scope`, `expected_floors`, dan `accepted_flags` pada `ModelConfig` (`backend/config_schema.py`) serta `user_answers` pada `InspectRequest`. Bila `accepted_flags` tidak kosong saat `POST /api/models/{id}/analyze`, daftar peringatan dimasukkan ke `summary.warnings` dan status hasil otomatis ditandai `is_provisional = True` (`HASIL SEMENTARA — perlu konfirmasi`).
- Menambahkan preset contoh `contoh_kotak_m` (`fixtures/synthetic/01_kotak_m/model.3dm`) di `backend/main.py` berdampingan dengan `fasad_curtain_wall_baru` agar dua kartu contoh pada layar Unggah dapat langsung dijalankan.
- Menambahkan `tests/test_sanity_flags.py` untuk menguji seluruh aturan `build_sanity_flags` beserta integrasi API `/inspect` dan `/analyze`.

### 3. Arsitektur Frontend Modular & Penghapusan Kode Lama
- Memecah `frontend/src/main.js` (3.554 baris) dan menghapus `frontend/src/stagingWorkspace.js` (1.470 baris) serta `frontend/src/style.css` menjadi struktur modular:
  - `src/state.js`: satu `ProjectConfig` v2 + status antarmuka + gerbang konfirmasi terpusat (`evaluateConfirmGate`).
  - `src/engine.js`: **satu-satunya** berkas yang memanggil `fetch('/api/...')` (`upload`, `inspect`, `analyze`, `saveConfig`, `loadConfig`, `exposure`, `export`, katalog material & lokasi).
  - `src/project.js`: simpan/buka `.ottv.json` dan simpan otomatis `localStorage` terbungkus `try/catch` (`luxa.project.v1`, `luxa.theme.v1`). Konfigurasi hanya ditulis ke server saat pengguna menekan **Hitung OTTV**, bukan saat inspeksi ulang.
  - `src/shell/`: `topbar.js` (merek LUXA 30 px + indikator 4 langkah + tombol tema/mode lanjut/perintah), `steps.js`, `rail.js`, `cardHost.js` (satu kartu fitur terbuka pada satu waktu, tombol `Escape` menutup).
  - `src/steps/`: `upload.js` (dengan keterangan pemrosesan di server LUXA, bukan klaim browser), `confirm.js` (kartu kaca melayang di atas viewer 3D dengan validasi baris wajib sebelum tombol aktif), `inspect.js` (tabel *Grup terdeteksi* + *Daftar kejanggalan* bernomor + tombol *Hitung OTTV* terkunci sampai Konfirmasi hijau), `results.js` (viewer Heatmap per arah, kartu OTTV total, grafik batang 8 arah dengan garis batas 35 W/m², ringkasan RTTV & komposisi panas, satu tombol `Unduh laporan (.xlsx)` dan `Unduh proyek (.ottv.json)`), serta `status.js` (kompas memuat 8 garis dan layar galat informatif).
  - `src/viewer/`: `viewer.js` dan `modes.js` (Three.js kamera perspektif, mode *Klasifikasi* termasuk tekstur arsiran diagonal untuk `unknown`, dan mode *Heatmap* per arah skala tetap `<25 / 25–32 / 32–35 / >35 W/m²` membaca token CSS aktif).
  - `src/panels/railPanels.js`: kartu fitur rel (`Model`, `Material`, `Lokasi`, `Tampilan`, `Bandingkan`, `Laporan`, `Bantuan`).
  - `src/ui/`: `escapeHtml.js`, `icons.js`, `glass.js`, `toast.js`. Seluruh teks yang berasal dari berkas model dimasukkan melalui `textContent`.
- Menghapus seluruh elemen lama sesuai spesifikasi: `inspect3dmFileClientSide` (`public/rhino3dm.js` dan `public/rhino3dm.wasm` tetap dipertahankan untuk Fase 5), bar 5 tahap, formulir 5 software sebelum unggah, slider global, 4 mode heatmap lama, tombol Excel kedua, label versi ganda, kata "Peran", dan kata "prodi" pada teks antarmuka.

### 4. Verifikasi
- `pytest tests/` lulus seluruhnya (termasuk 7 tes baru di `tests/test_sanity_flags.py` dan seluruh 126 tes dari Fase 1–3).
- Build produksi Vite (`vite build`) lulus tanpa galat.
- Audit statis memastikan nol `fetch('/api/` di luar `frontend/src/engine.js`, nol `OTTVista`, nol `Peran`, nol `inspect3dmFileClientSide`, dan nol hex warna keras di komponen UI.
