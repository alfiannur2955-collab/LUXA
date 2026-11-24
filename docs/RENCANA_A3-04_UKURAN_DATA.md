# Rencana Teknis A3-04 — Diet Ukuran Data Hasil

Status: **rencana, belum dikerjakan**. Disusun 24 Nov 2026 dari pengukuran pada model `Fasad_Tower_Twisted.3dm`
(24 lantai, 37 ribu face, mode SNI, Jakarta) dan pembacaan kode `backend/` + `frontend/src/`.

## 1. Masalah

Saat menghitung model twisted, aplikasi publik dan mode Presentasi terasa berat sampai hang di laptop
pengembang (RTX 5070 Ti, 16 GB RAM). Penyebab utamanya ukuran data yang berpindah dari engine ke tampilan.

### Alur data sekarang

```
Python (Pyodide)            Web Worker                 Main thread (UI)
analyze_building_ottv  ->  json.dumps 22 MB  ->  string -> postMessage  ->  JSON.parse 22 MB  ->  viewer
                            (string WASM -> JS)          (salinan kedua)        (memblokir UI)
```

Setiap ganti material (`rematerial`) mengulang alur yang sama untuk ±16,5 MB, karena semua panel
dikirim ulang (hanya `vertices` yang dibuang).

### Pengukuran (model twisted)

| Bagian | Ukuran |
|---|---|
| Hasil hitung (JSON) | **22,4 MB** |
| `panels` (12.096 panel, ±50 field per panel) | 17,9 MB |
| `shading_elements` + `frame_elements` | 4,3 MB |
| Sisa (ringkasan, orientasi, lantai, dll.) | 0,2 MB |
| Payload `rematerial` per ganti material | ±16,5 MB |
| Payload inspeksi (`preview_meshes`) | 4,6 MB |
| Memori puncak Python satu kali hitung (CPython desktop) | 319 MB |

Temuan dari kode:

- **Separuh panel tidak aktif** (6.048 dari 12.096: sisi dalam, di bawah tanah). Viewer hanya memakai
  `vertices` dari panel ini untuk garis tipis di mode X-ray, tetapi semua ±50 field-nya ikut terkirim.
- **19 field tidak dipakai frontend sama sekali**, termasuk 6 field warna heatmap (hex + RGB, ±1,2 MB),
  `verification_label`, `solar_exposure_wm2`, `ottv_composite_wm2`, `azimuth_deg`, `r1/r2/phi1`, dan lain-lain.
  Laporan Excel/PDF tidak terdampak, karena dibuat di Python dari salinan hasil yang tersimpan di engine.
- **String yang sama diulang per panel**: `material_name`, `name`, `group_name`, `material_id`. Totalnya ±1,9 MB,
  padahal hanya ada beberapa grup dan material.
- **Engine menyimpan sampai 4 hasil penuh** di memori Python (`MAX_STORED_ANALYSES = 3` + hasil utama), masing-masing
  berupa list berisi belasan ribu dict.
- **Mesh rangka/peneduh dikirim dua kali**: sekali di inspeksi (`preview_meshes`) dan sekali lagi di hasil.
- Viewer sendiri sudah efisien: geometri digabung (merged BufferGeometry) dan dibangun ulang hanya bila `renderKey`
  berubah. Jadi bebannya ada di **ukuran data dan parsing**, bukan di render Three.js.

### Field panel yang benar-benar dipakai frontend

| Pemakai | Field |
|---|---|
| `viewer/viewer.js` | `id, active, vertices, normal, area_m2, orientation_code, element_type, group_name, ottv_panel_wm2, sc_shading_multiplier, sunlit_mask` |
| `viewer/selection.js` | `id, active, area_m2, centroid, normal, orientation_code, ottv_panel_wm2, heat_gain_w` |
| `viewer/capture.js` | `id, active, area_m2, normal, orientation_code` |
| `report/facade.js` | `active, centroid, group_name, orientation_code, ottv_panel_wm2, tilt_deg, vertices` |
| `present/maket.js` | `active, area_m2, centroid, group_name, orientation_code, vertices` |
| `steps/results.js` (detail panel terpilih) | `alpha_wall_eff, td_ek_eff, u_fen_eff, u_wall_eff, sc_effective, sc_glass, sf_wm2` |
| `engine/local.js` | `id, vertices` (menyambung ulang geometri setelah `rematerial`) |

## 2. Target

| Ukuran | Sekarang | Target |
|---|---|---|
| Hasil hitung model twisted | 22,4 MB | **< 3 MB** |
| Payload ganti material | 16,5 MB | **< 0,3 MB** |
| `JSON.parse` di main thread | belum diukur | **< 100 ms** (tidak ada jeda yang terasa) |
| Angka OTTV, per arah, per panel | — | **identik** (selisih 0) |

Angka OTTV tidak boleh berubah sama sekali. Ini murni perubahan format pengiriman.

## 3. Tahapan

Setiap fase berdiri sendiri: bisa di-commit, diuji, dan dicoba di aplikasi sebelum lanjut.

### Fase 0 — Alat ukur (kecil)

Supaya setiap fase terbukti, bukan dikira-kira.

- `tools/payload_report.py`: ukuran hasil per bagian untuk model twisted dan fixture.
- Uji anggaran di pytest: hasil model twisted harus di bawah batas (awalnya 23 MB, lalu diturunkan tiap fase).
- Penanda waktu `performance.now()` di `engine/local.js` (waktu engine, waktu parse) yang tampil di konsol bila
  URL berisi `?perf=1`, agar waktu nyata di browser bisa dicatat sebelum dan sesudah.

### Fase 1 — Diet cepat tanpa ubah viewer (kecil–sedang, risiko rendah)

Perkiraan: **22,4 → ±6 MB**, rematerial **16,5 → ±0,1 MB**.

1. **Buang field yang tidak dipakai** dari payload ke frontend (tetap ada di salinan Python untuk laporan).
2. **Panel nonaktif dikirim ringkas**: hanya `id`, `active: false`, `vertices`.
3. **String jadi indeks**: `group_name` dan `material_id` per panel diganti angka yang menunjuk ke tabel `groups`
   dan `materials` di tingkat atas hasil. Adapter di `engine/local.js` mengembalikan string-nya, sehingga
   kode tampilan tidak perlu berubah.
4. **Rangka/peneduh sebagai biner base64** (`Float32Array` untuk vertex, `Uint32Array` untuk face), dibongkar di
   `engine/local.js` dan `engine/server.js`.
5. **Rematerial hanya mengirim yang berubah**: per panel aktif cukup `ottv_panel_wm2`, `heat_gain_w`, `sc_effective`
   (dan field detail yang dipakai), dalam urutan id yang sama. Frontend menempelkannya ke hasil sebelumnya,
   memperluas mekanisme `geometry_from: "previous"` yang sudah ada.

File: `backend/browser_api.py`, `backend/main.py` (mode server), `backend/recommender.py`,
`frontend/src/engine/local.js`, `frontend/src/engine/server.js`.

### Fase 2 — Format kolom untuk panel (sedang, risiko sedang)

Perkiraan: **±6 → < 3 MB**.

1. Panel dikirim sebagai **tabel kolom**, bukan list berisi objek: `vertices` (Float32 rata + offset),
   `normal`/`centroid` (Float32), `orientation`/`element_type`/`group` (Uint8/Uint16), `area`/`ottv`/`heat`
   (Float32), `sunlit_mask` (Uint16).
2. Adapter `expandPanels()` di `engine/local.js` membangun objek panel ringan dari kolom. Kode tampilan tetap
   memakai `analysis.panels`, sehingga perubahan di 9 file pemakai bisa bertahap.
3. Jalur panas (`viewer.js`, `selection.js`) dimigrasikan untuk membaca kolom langsung, tanpa membuat 12 ribu objek.
4. Opsional: buffer dikirim dari worker sebagai **Transferable `ArrayBuffer`** (tanpa salinan), memakai buffer
   numpy dari Pyodide, bukan JSON.

### Fase 3 — Detail sesuai permintaan (kecil)

- Operasi baru `panel_detail(analysis_id, panel_ids)`: angka rumus (U, α, TD_ek, SC, SF, R1/R2) untuk panel yang
  diklik. Field detail di payload utama bisa dibuang.

### Fase 4 — Memori engine (besar, opsional, bisa ditunda)

- Simpan hasil di Python sebagai array numpy, bukan list of dict. `rematerial`, `recommender`, dan laporan
  disesuaikan.
- Viewer hasil memakai ulang mesh rangka/peneduh dari inspeksi (tidak dikirim dua kali).
- Inspeksi (`preview_meshes`, 4,6 MB) memakai format biner yang sama.

## 4. Pengaman

- **Paritas nilai**: uji yang membongkar format baru kembali ke objek panel, lalu membandingkannya field demi field
  dengan format lama untuk model twisted, Opsi A, dan semua fixture. Selisih harus 0.
- **Mode server ikut**: `engine/server.js` (FastAPI) memakai format dan adapter yang sama, diuji lewat `tests/test_api.py`.
- **Engine browser diuji di CI** (sekalian menutup A3-09): build aset engine di GitHub Actions supaya
  `test_browser_engine_parity.py` tidak lagi dilewati.
- **Laporan tidak berubah**: Excel/PDF tetap dibuat dari salinan Python. `test_luxa_report.py` harus tetap lulus.
- Setiap fase: 366+ tes lulus, baseline 0 selisih, lalu dicoba di aplikasi (twisted + Opsi A) sebelum commit.

## 5. Risiko

| Risiko | Mitigasi |
|---|---|
| Ada pemakai field yang terlewat (field tiba-tiba `undefined`) | Daftar pemakai di §1 dari grep; adapter mengisi default; mode `?perf=1` mencatat akses field yang hilang selama masa transisi |
| Proyek tersimpan dari versi lama | Proyek hanya menyimpan konfigurasi dan angka OTTV ringkas, bukan daftar panel (dicek di `project.js`); aman |
| Fase 2 menyentuh banyak file tampilan | Adapter `expandPanels()` membuat migrasi bertahap; jalur panas dimigrasikan terakhir |
| Transferable buffer di Pyodide | Opsional; Fase 1–2 sudah mencapai target lewat JSON + base64 |

## 6. Usulan urutan

1. Fase 0 + Fase 1 dalam satu putaran. Hasilnya sudah terasa (±4× lebih kecil, ganti material hampir instan).
2. Uji di aplikasi, catat waktu dengan `?perf=1`.
3. Fase 2 + Fase 3 bila masih terasa berat.
4. Fase 4 belakangan, bila memori menjadi masalah saat membandingkan banyak alternatif.

## 7. Keputusan yang dibutuhkan

1. Setuju mulai dari Fase 0 + 1?
2. Mode engine server (`npm run dev:server`, `engine/server.js`, khusus pengembangan) tetap didukung penuh, atau
   cukup mode browser yang dipakai pengguna (termasuk `start_studio.bat`, yang menyajikan build browser)?
   Rekomendasi: tetap didukung, karena biayanya kecil bila adapter dipakai bersama.
