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

---

## Fase 4b-1 — Perbaikan Review 4a (P1–P3), Kamera 4 Proyeksi, View Tersimpan, Capture, & Pintasan (`fase-4b1-kamera`)

### 1. Perbaikan Review Fase 4a (P1–P3)
- **P1 (`backend/run_studio_servers.py`, `start_studio.bat`)**: `run_studio_servers.py` kini mendeteksi Node.js otomatis lewat `NODE_EXE`, `shutil.which("node")`, `%ProgramFiles%\nodejs`, `%ProgramFiles(x86)%\nodejs`, `%LOCALAPPDATA%\Programs\nodejs`, `%NVM_SYMLINK%`, dan `%APPDATA%\nvm\*`. Bila Node.js tidak ditemukan, ditampilkan pesan bahasa Indonesia yang jelas cara memasang Node LTS dan backend LUXA tetap berjalan di `http://127.0.0.1:8000` (menyajikan build `frontend/dist`). Judul jendela dan banner `start_studio.bat` diperbarui menjadi **LUXA by Alf Studio (SNI 6389:2020)** dengan path relatif `%~dp0`.
- **P2 (`frontend/src/steps/inspect.js`, `theme.css`)**: Nama grup pada tabel *Grup terdeteksi* diubah menjadi tombol `<button type="button">` (`aria-pressed`, baris `aria-selected`) sehingga sepenuhnya dapat dipilih menggunakan keyboard (`Tab` + `Enter`/`Spasi`).
- **P3 (`frontend/src/steps/upload.js`)**: Label kartu contoh menara curtain wall dihapus angka lantainya menjadi `Fasad_Curtain_Wall_Baru.3dm` agar tidak bentrok dengan taksiran lantai engine.

### 2. Kamera 4 Proyeksi, Tampak 8 Arah + Atas, & Gizmo Sumbu
- **`frontend/src/viewer/cameras.js`**: Mengimplementasikan `CameraRig` dengan 4 proyeksi:
  1. **Perspektif** (`1`): `PerspectiveCamera` dengan orbit bebas.
  2. **Perspektif 2 titik** (`2`): `PerspectiveCamera` dengan pitch dikunci horizontal (`minPolarAngle = maxPolarAngle = π/2`) dan pergeseran vertikal via `camera.setViewOffset` sehingga garis vertikal bangunan tetap tegak.
  3. **Aksonometri** (`3`): `OrthographicCamera` pada sudut isometrik (~35,264°) dari kuadran aktif.
  4. **Tampak** (`4`): `OrthographicCamera` tegak lurus fasad pada salah satu dari 8 arah (`U`, `TL`, `T`, `TG`, `S`, `BD`, `B`, `BL`) atau `Atas` (denah) mengikuti `north_angle_deg`.
  - Transisi kamera halus 200 ms dan langsung tanpa animasi di bawah `prefers-reduced-motion`.
- **`frontend/src/viewer/axes.js`**: Gizmo sumbu X (`--fail`), Y (`--ok`), Z (`--data-glazing`) yang berputar sinkron dengan kamera 3D di pojok kanan bawah viewer.

### 3. View Tersimpan (`.ottv.json`) & Capture PNG 1x/2x/4x
- **`backend/config_schema.py` & `tests/test_api.py`**: Menambahkan `saved_views` ke `ProjectConfig` v2 + `migrate_v1` beserta tes round-trip `test_saved_views_roundtrip_in_project_config`.
- **`frontend/src/viewer/views.js`**: Tambah, pilih, ganti nama (*inline*), dan hapus view tersimpan yang otomatis ikut tersimpan di `.ottv.json` dan `localStorage`.
- **`frontend/src/viewer/capture.js`**: Render *offscreen* resolusi `1x` / `2x` / `4x` (dibatasi aman terhadap `maxTextureSize` GPU), digabung dengan latar tema aktif dan cap LUXA (logo lengkap + nama model, nama view, OTTV bila ada, dan tanggal) lalu diunduh sebagai `<model>_<view>_<tanggal>.png`.

### 4. Pil Bawah Viewer, Pie Menu Tahan `V`, Panel Tampilan Kamera, Palet `Ctrl K`, & Daftar Pintasan `?`
- **`frontend/src/viewer/vbar.js`**: Pil bawah kiri (4 proyeksi + pemilih 8 arah & Atas dengan navigasi panah keyboard) dan pil bawah kanan (dropdown view tersimpan, tombol *Simpan*, tombol *Capture* dengan pemilih `1x`/`2x`/`4x`).
- **`frontend/src/viewer/pieMenu.js`**: Pie menu radial 8 arah + *Atas* saat menahan tombol `V` (arahkan mouse atau panah, lepas `V` untuk memilih, `Esc` untuk batal).
- **`frontend/src/panels/railPanels.js`**: Panel **Tampilan** bagian **Kamera** (4 proyeksi, kisi 3×3 8 arah + *Atas*, masukan sudut utara, tombol *Pas ke model*).
- **`frontend/src/ui/shortcuts.js`, `commandPalette.js`, `shortcutsModal.js`**: Seluruh pintasan §6 (`1 2 3 4`, tahan `V`, `F`, `S`, `C`, `Spasi`, `Esc`, `Ctrl K`, `?`) yang otomatis nonaktif saat fokus di kolom input; palet perintah `Ctrl K` mencari aksi, tampak, view tersimpan, dan grup; kartu daftar pintasan `?`.

