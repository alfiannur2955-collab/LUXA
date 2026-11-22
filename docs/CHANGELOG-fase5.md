# Changelog Fase 5

## Fase 5c — laporan Excel LUXA (22 Nov 2026, dikerjakan Claude)

**Laporan baru (`backend/luxa_report.py`)**
- Satu-satunya laporan Excel. Strukturnya meniru form lama: ringkasan, material, 8 lembar arah, atap, ditambah rincian per lantai dan referensi.
- Lembar: Ringkasan, Material, U/TL/T/TG/S/BD/B/BL, Atap RTTV, Per lantai, Referensi.
- Semua suku panas memakai rumus Excel hidup:
  - konduksi dinding = A_w × α × U × TD_ek;
  - konduksi kaca = A_f × U_f × ΔT;
  - radiasi kaca = A_f × SC_ef × SF.
- Setiap lembar arah dan Ringkasan punya kolom "Selisih Excel − aplikasi" yang harus 0,00. Sudah dicek dengan hitung ulang LibreOffice pada 7 model uji dan sampel Fasad tower twisted.
- Sel krem berisi nilai dari model, sel putih berisi rumus. Konstanta bernama `DELTA_T` dan `OTTV_LIMIT` ada di lembar Referensi.
- Lembar Material mencantumkan merek, konfigurasi, U, α, SHGC, SC (rumus SHGC/0,87), VLT, asal data, sumber datasheet (tautan), dan arah pemakaian.
- Ringkasan memuat status hasil, peringatan beserta kodenya, dan catatan errata SCeff yang dipakai.
- Cetak A4 (arah: landscape), footer bernomor halaman.

**Perbaikan dibanding form lama**
- SC = SHGC/0,87 di semua tempat (form lama memakai 0,86 dan satu kolom sisa 0,87 di UTARA).
- Tabel SF yang dipakai tertulis jelas. Tabel 8 SNI 6389:2020 dan tabel lama sama-sama ada di Referensi.
- RTTV berfungsi (di form lama 17 nama range rusak, termasuk RoofConstructionType).
- Tanpa batas 10 jenis dinding, 25 jenis kaca, atau 25 segmen per arah.
- Tidak ada rumus satu-kolom-penuh (`MATCH($G:$G,…)`) dan tidak ada sheet sisa.

**Default perhitungan**
- `sf_source` bawaan sekarang `sni2020` (SNI 6389:2020 Tabel 8). Tabel lama tetap bisa dipilih sebagai "Tabel SF lama (template PUPR)", dan proyek lama yang menyimpan `template_prodi` tetap terbuka.
- Pembagi SHGC → SC 0,87 di semua mode.
- Akibatnya angka contoh berubah, misalnya kotak sintetis 20,43 → 19,37 W/m² dan model "Facade only to Alfian" 38,79 → 36,76 W/m².

**Dihapus**
- `docs/templates/template_prodi.xlsx`, `backend/report_template_map.py`, `backend/template_filler.py`, `tests/test_report_template.py`, dan generator Excel generik lama.
- Format ekspor `template_prodi` sekarang alias laporan LUXA, jadi tautan lama tetap jalan. Pilihan "Template laporan" di UI diganti tombol "Unduh laporan (.xlsx)" biasa.
- Build tidak lagi mengemas template, dan `LUXA_INCLUDE_TEMPLATE` tidak dipakai lagi.

**Tes dan contoh**
- `tests/test_luxa_report.py`: struktur, tanpa `#REF!`, tanpa rumus kolom penuh, material lengkap, dan hitung ulang LibreOffice.
- `tools/make_synthetic.py` memakai Tabel 8 dan SCeff interpolasi SNI; semua `expected.json` dibuat ulang.
- Tes lama yang membaca lembar "Hitungan Manual" kini menghitung ulang lembar arah LUXA dari isi selnya.
- Contoh laporan: `docs/contoh/Laporan_OTTV_LUXA_Fasad_Tower_Twisted.xlsx`.
- Diuji di browser headless: sampel Kotak 4 lantai → Hitung → Unduh laporan menghasilkan file yang sama dengan aplikasi (selisih 0).

## Fase 5b — engine di browser (22 Nov 2026, dikerjakan Claude)

**Arsitektur**
- `frontend/src/engine.js` kini memilih satu dari dua implementasi dengan fungsi yang sama:
  - `engine/local.js` (bawaan): Web Worker + Pyodide.
  - `engine/server.js`: FastAPI, dijalankan dengan `npm run dev:server`.
- `backend/browser_api.py`: versi tanpa server dari semua endpoint yang dipakai frontend, dengan satu pintu masuk `dispatch()` untuk worker.
  - Model `ValidateMaterialRequest` dipindah ke `config_schema.py`, supaya kedua mode memvalidasi material dengan definisi yang sama.
- `engine/worker.js`: memuat engine bertahap.
  - Saat boot: Pyodide, numpy, pydantic, trimesh, ladybug-geometry, dan backend LUXA.
  - Saat dibutuhkan: rhino3dm.js (file .3dm), IfcOpenShell 0.9.1 modular yang dipasang berurutan (file .ifc), dan openpyxl (ekspor Excel).
- `engine/store.js`: file model dan konfigurasi proyek disimpan di IndexedDB. Setelah halaman dimuat ulang, model dipulihkan otomatis.

**Memori dan ukuran**
- Hanya 2 hasil analisis yang disimpan, dan cache geometri dibersihkan saat ganti model.
- Rematerial mengirim balik nilai saja; geometri panel disambung ulang di halaman.

**Build dan deploy**
- `scripts/build_engine_assets.mjs` dijalankan otomatis dari Vite. Isinya:
  - menyalin aset engine ke `public/luxa-engine/`;
  - mengemas backend dan template prodi (opsional, `LUXA_INCLUDE_TEMPLATE=0`);
  - menyalin file contoh;
  - membuat service worker dengan nama cache berversi.
- `base: './'`, sehingga build berjalan dari subfolder (GitHub Pages) maupun root (Netlify).
- `.github/workflows/deploy-pages.yml` (hanya manual) dan `docs/DEPLOY.md`.

**UI**
- Halaman Unggah menampilkan status engine dan catatan privasi.
- Layar loading menunjukkan tahap pemuatan engine.
- Semua teks yang menyebut "server" mengikuti mode yang dipakai.
- Path logo dan favicon dibuat relatif.

**Perbaikan**
- File .3dm yang dibaca lewat browser sempat terdeteksi sebagai ".hbjson" (`detect_file_signature` kini mengenali `.3dm.json`).
- Tanpa template prodi, unduhan laporan jatuh ke Excel umum disertai catatan.

**Tes**
- `tests/test_browser_api.py`: paritas setiap fungsi dengan endpoint server.
- `tests/test_browser_engine_parity.py`: engine Pyodide dengan aset aplikasi dibandingkan native pada 5 fixture (.3dm ×3, .obj, .ifc), selisih ≤ 0,01 W/m². Hasilnya identik.
- Uji klik di Chromium terhadap build statis:
  - contoh Kotak (20,43 W/m²) dan Facade .3dm (38,80 W/m²);
  - unggah IFC, ganti material, rekomendasi, dan unduh laporan;
  - muat ulang lalu lanjutkan sesi;
  - mode subfolder `/luxa/`.
  Log jaringan tidak memuat satu pun request yang membawa file model.
