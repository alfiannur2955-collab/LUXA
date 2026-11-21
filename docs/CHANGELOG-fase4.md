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

---

## Fase 4b-2 — Perbaikan Review 4b-1 (R1–R5), Deteksi Lantai Bertingkat, & Analisis Interaktif di Viewer (`fase-4b2-analisis`)

### 1. Perbaikan Review Fase 4b-1 (R1–R5)
- **R1 (`frontend/src/steps/results.js`, `tests/test_api.py`)**: Membaca `rttv.applicable` (bukan `rttv.has_roof`) sehingga RTTV atap (contoh kotak: `4,64 W/m²`, atap `600 m²`, batas `10 W/m²`) tampil dengan chip status kepatuhan. Ditambahkan tes kontrak API `test_ui_response_contract_rttv_and_panel_fields` di `tests/test_api.py`.
- **R2 (`frontend/src/viewer/viewer.js`, `modes.js`, `theme.css`)**: Menambahkan garis tepi tipis (`THREE.EdgesGeometry`, warna `--line-strong`) di semua mode viewer, dan memperjelas kontras latar viewer tema gelap (`--paper` ke `--surface`) terhadap `heat-0`.
- **R3 (`frontend/src/theme.css`)**: Memindahkan `.toast-stack` ke tengah bawah layar di atas pil bawah viewer (`bottom: 82px`) agar tidak menutupi tombol Unduh di kolom samping.
- **R4 (`backend/universal_pipeline.py`, `config_schema.py`, `ottv_engine.py`, `adapters/__init__.py`, `frontend/src/steps/confirm.js`, `state.js`, `tests/test_floor_detection.py`)**: Mengganti mekanisme deteksi lantai dengan pendekatan bertingkat tanpa menebak `tinggi / 3,6`:
  1. Sumber pasti: zona kustom pengguna (`zona_kustom`), `IfcBuildingStorey` (`ifc_storey`), nama layer/grup berpenanda lantai (`nama_layer`), lalu isian jumlah lantai/tinggi pengguna (`isian_pengguna`).
  2. Geometri (`geometri_pita`): histogram tepi horizontal berbobot panjang tepi (resolusi 5 cm) + autokorelasi rentang `2,4–6,0 m`, diterima hanya bila ≥ 70% garis menonjol jatuh dalam ±15 cm kelipatan periode.
  3. Tidak yakin (`tidak_terdeteksi`): 1 zona penuh tanpa tebakan dan tanpa menahan tombol lanjut; `floor_height_m` di `ProjectConfig` default `None`.
  4. Sumber deteksi dan catatan bahwa jumlah lantai tidak mengubah OTTV total selalu tertulis di Kartu Konfirmasi.
  - 17 tes baru di `tests/test_floor_detection.py` (01 kotak = 4 lantai @ 4,0 m, 05/06/07 = 4 lantai, 19 tanpa nama = 4 lantai / tidak terdeteksi, `Facade only to Alfian.3dm` = 15 lantai cocok pita kaca, IFC Duplex = `ifc_storey`). OTTV seluruh kasus sintetis tidak berubah.
- **R5 (`frontend/src/viewer/cameras.js`, `viewer.js`, `steps/confirm.js`)**: Pembingkaian kamera memperhitungkan ruang kanan yang tertutup Kartu Konfirmasi (`setRightInsetPx`) serta memberi margin ≥ 10% di sekeliling model.

### 2. Endpoint `GET /api/analyses/{id}/exposure`
- Menambahkan `compute_solar_vectors_for_date` dan `compute_panel_exposure_for_date` di `backend/ottv_engine.py` (memakai ulang *raycast* dan *cache* berbasis hash konten) serta rute `GET /api/analyses/{analysis_id}/exposure?date=YYYY-MM-DD` di `backend/main.py` untuk 13 posisi matahari (`06.00–18.00`).
- Menambahkan `tests/test_exposure.py` yang juga memverifikasi kriteria wajib pada `corpus/real/Facade only to Alfian.3dm`: panel kaca Barat `56,44 W/m²`, porsi panas seluruh kaca Barat ~`32%`, dan filter `23 Sep` `13.00` menyalakan fasad Barat serta tidak menyalakan fasad Selatan.

### 3. Seleksi Panel, Label HTML Kaca, Kartu Bidang Terpilih, & 5 Mode Viewer
- **`frontend/src/viewer/selection.js` & `labels.js`**: Klik panel (`panels[].id`) via pemetaan segitiga O(1), `Shift+klik` multi-seleksi, klik area kosong melepas. Label nilai berupa elemen HTML kaca tingkat 1 yang diproyeksikan dari `centroid` setiap frame (bukan *sprite*).
- **`frontend/src/steps/results.js`**: Kartu **Bidang terpilih** (grup, `SF`/`SC`/`Uf` atau `α`/`Uw`/`TDek`, kontribusi panel, porsi panas terhadap total bangunan, serta ringkasan luas total & rata-rata tertimbang saat multi-seleksi).
- **`frontend/src/viewer/modeBar.js`, `modes.js`, `viewer.js`**: Kelima mode viewer aktif (**Klasifikasi**, **Orientasi** 8 arah netral-ke-hangat, **Heatmap** dengan sakelar **Per arah / Per panel** di legenda, **Kejanggalan** sorot `--warn` + pin bernomor, dan **X-ray** transparan + garis putus-putus untuk bidang disaring).

### 4. Kubah Matahari, Kompas Utara Interaktif, Filter Paparan, & Pil Rumus
- **`frontend/src/viewer/sundome.js`**: Kubah matahari 3D dari `location_info.latitude_deg`, cincin arah `U/T/S/B` + 8 tick, tiga lintasan (`21 Jun`, `21 Mar / 23 Sep`, `21 Des`), bola matahari aktif + garis putus ke pusat, radius default `1,6 ×` setengah diagonal denah, skala `50–200%` + *Pas ke model*, dan info tinggi/azimut matahari.
- **`frontend/src/viewer/compass.js`**: Kompas kaca 52 px interaktif (seret pointer atau panah keyboard, langkah `1°`, `Shift` = `15°`), langsung memutar orientasi & kubah matahari, serta menampilkan chip **Hitung ulang**.
- **`frontend/src/viewer/exposure.js`, `panels/railPanels.js`, `viewer/vbar.js`**: Filter **Tampilkan fasad** (*Semua arah* / *Arah yang dipilih* / *Yang terkena matahari jam ini* mewarnai panel terpapar `heat-1` dan teduh `data-wall`, beserta catatan SF tahunan SNI), slider jam & tombol putar satu hari (`Spasi`, nonaktif pada `prefers-reduced-motion`).
- **`frontend/src/viewer/formulaPill.js`**: Pil rumus kaca tingkat 1 di kiri kompas (`top: 16px, right: 76px, height: 52px`), dapat digeser via pointer maupun panah keyboard (posisi tersimpan di `localStorage`), dan dibuka untuk menampilkan persamaan SNI 6389:2020 beserta substitusi angka dari `manual_calc`.

---

## Fase 4c — Perbaikan Review 4b-2 (S1–S4), Mode Bandingkan, Workspace v1, Tooltip SNI, & Poles (`fase-4c-poles`)

### 1. Perbaikan Review Fase 4b-2 (S1–S4)
- **S1 (`tests/conftest.py`, `tests/test_floor_detection.py`)**: Memperbaiki kapitalisasi path `05_denah_l` -> `05_denah_L` dan menambahkan pengaman `pytest_sessionstart` di `tests/conftest.py` yang memverifikasi seluruh path `fixtures/...` di `tests/test_*.py` dengan pengecekan huruf besar-kecil persis agar tidak pernah lolos di Windows lalu gagal di Linux/CI.
- **S2 (`frontend/src/viewer/sundome.js`)**: Radius kubah matahari bawaan diubah menjadi `max(1,6 × setengah diagonal denah, 0,6 × tinggi bangunan)` agar proporsional pada gedung tinggi. Label lintasan (`21 Jun`, `21 Mar / 23 Sep`, `21 Des`) ditempatkan di sisi luar busur dan disembunyikan otomatis bila menumpuk di atas proyeksi 2D badan bangunan.
- **S3 (`frontend/src/viewer/cameras.js`, `vbar.js`, `views.js`, `ui/commandPalette.js`, `main.js`)**: Pil bawah, palet `Ctrl K`, dan nama view tersimpan kini membedakan posisi kamera 3D (`dari Tenggara`, `dari Barat`) pada Perspektif / 2 titik / Aksonometri dan `Tampak Barat` / `Tampak Atas` khusus untuk proyeksi Tampak. Arah kamera ikut diperbarui otomatis setelah orbit selesai.
- **S4 (`frontend/src/viewer/modes.js`, `viewer.js`, `steps/results.js`, `views.js`, `theme.css`)**: Heatmap menggunakan **skala warna kontinu OKLab** (`0 = heat-0`, `25 = heat-1`, `35 = heat-2`, `50–60+ = heat-3`) dengan bilah gradasi 168 px bertanda batas tegas `35 batas` (`--ink`), serta sakelar **Halus** (default mati) yang mencampur warna antar-vertex tertimbang luas, menulis `"tampilan dihaluskan"` di legenda saat aktif, ikut tersimpan di `saved_views`, dan tetap menjaga nilai asli panel saat diklik.

### 2. Mode Bandingkan (Viewer Terbelah) & Tes Kaca Elektrokromik
- **`frontend/src/steps/compare.js` & `frontend/src/viewer/viewer.js`**: Viewer 3D terbelah tersinkronisasi (*scissor rendering* berbagi satu kamera & orbit) menampilkan **Sekarang** (kiri) dan **Alternatif** (kanan), dilengkapi pembatas geser (`cursor: ew-resize`, pointer & panah keyboard `ArrowLeft`/`ArrowRight`/`Home`/`End`), kartu **Selisih per arah (W/m²)** di bawah, ringkasan selisih total, tabel **Yang diubah** beserta catatan katalog material (mis. kondisi paling gelap pada kaca elektrokromik), pembuat **+ Tambah alternatif** (memanggil `engine.analyze` dari salinan `ProjectConfig`), dan tombol **Pakai Alternatif** yang menyimpan desain sebelumnya ke **Riwayat desain**.
- **`tests/test_compare_electrochromic.py`**: Memverifikasi `corpus/real/Facade only to Alfian.3dm` dengan konfigurasi bawaan memberi `38,79 W/m²`, sedangkan alternatif `glz_kaca_elektrokromik` memberi **`27,71 W/m²`** (lolos batas 35).

### 3. Workspace v1 & Kustomisasi Dock
- **`frontend/src/ui/workspace.js`, `shell/rail.js`, `panels/railPanels.js`, `steps/results.js`, `main.js`**: Tiga preset workspace (**Belajar**, **Lanjut**, **Presentasi**) tersimpan di `localStorage` (`luxa.workspace.v1`):
  - **Belajar**: tooltip istilah SNI aktif di seluruh kartu hasil.
  - **Lanjut**: menampilkan **Data per bidang** (tabel panel dapat dicari & diklik ke 3D) dan **Override kaca per orientasi** di panel Material.
  - **Presentasi**: menyembunyikan rel kiri dan kolom samping untuk viewer penuh dengan pil bawah tetap tampil dan tombol `Keluar Presentasi (Esc)`.
  - Dialog **Atur urutan dan isi dock** (aksesibel keyboard) untuk mengurutkan ulang, menyembunyikan item rel, dan memindahkan posisi baris mode ke atas/bawah viewer.

### 4. Panel Material, Lokasi, Laporan, Bantuan, Tooltip Istilah SNI, Aksesibilitas, & Uji Pengguna
- **`frontend/src/ui/tooltips.js`**: Tooltip aksesibel (fokus, klik, hover) dengan penjelasan satu kalimat dan rujukan pasal/tabel SNI 6389:2020 untuk `OTTV`, `WWR`, `SC`, `SF`, `TDek`, `Uf`, `Uw`, `α`, dan `RTTV`.
- **`frontend/src/panels/railPanels.js`**: Panel **Material** (catatan katalog + override per orientasi di Lanjut), **Lokasi** (54 kota Tabel 8 + 18 kota template, pratinjau SF 8 arah, unggah EPW kustom), **Laporan** (status kepatuhan + unduh `.xlsx`, `.csv`, `.pdf`, `.ottv.json`), dan **Bantuan** (glosarium SNI yang dapat dicari + panduan ekspor + tombol pintasan `?`).
- **`frontend/src/theme.css`**: Poles aksesibilitas §9 dan responsif pada `1440`, `1280`, dan `768 px` (tanpa luapan horizontal, penataan ulang legenda/mode/pil/bandingkan di bawah `860 px`).
- **`docs/UJI_PENGGUNA_FASE4.md`**: Skenario uji 3 mahasiswa arsitektur (< 10 menit) memakai `Fasad_Curtain_Wall_Baru.3dm` (atau model studio pilihan) lengkap dengan lembar catatan pengamatan.



