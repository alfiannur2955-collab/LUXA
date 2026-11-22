# Changelog Fase 5

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
