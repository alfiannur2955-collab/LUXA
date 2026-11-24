# Laporan Pagi — 25 November 2026

Ringkasan pekerjaan otomatis sesi malam pada branch `main` (tanpa menjalankan server studio, tanpa `git push`, tanpa mengubah `fixtures/baseline.json`, dan tanpa menghapus file apa pun).

---

## 1. Status Akhir & Ringkasan Verifikasi

- **Branch**: `main` (bersih, siap ditinjau dan di-push bila Anda setuju).
- **Build aset & aplikasi**: `npm run engine:assets` (versi aset `131685a0a577`) + `npm run build` (`vite build`, `4,22 detik`) **LULUS**.
- **Pengujian penuh (`python -m pytest -q`)**: **393 lulus, 1 dilewati** (`test_luxa_report.py::test_libreoffice_recalculation_matches_app` karena LibreOffice Calc tidak terpasang di laptop lokal; di GitHub Actions CI sudah diaktifkan), **0 gagal** (`75,36 detik`), termasuk seluruh uji paritas engine browser (Pyodide 32-bit WASM di Node).
- **Baseline (`python tools/compare_baseline.py`)**: **0 selisih** (100% identik dengan `fixtures/baseline.json` di keenam fixture).

---

## 2. Daftar Tugas yang Selesai

### 1) T2 — A3-09: CI menguji engine browser, laporan LibreOffice, dan fixture IFC nyata
- **Commit kode**: `5ff7ed5` (*A3-09: aktifkan uji engine browser, LibreOffice, dan fixture IFC nyata di CI*)
- **Commit dokumen**: `f986ce6` (*docs: tandai A3-09 selesai di audit, serah-terima, dan perbarui log git otomatis*)
- **Ringkasan perubahan**:
  - `.github/workflows/tests.yml`: menambahkan `actions/cache@v4` untuk `frontend/.engine-cache` (kunci cache sama dengan `deploy-pages.yml`), menjalankan `bash scripts/fetch_engine_assets.sh` + `npm run engine:assets`, memasang `libreoffice-calc`, dan menjalankan `python -m pytest -q -rs` agar ringkasan tes yang dilewati (jika ada) selalu terlihat di log CI.
  - Menyalin **hanya** `Duplex_A_20110907.ifc` (`2,27 MB`, lisensi publik buildingSMART) ke `fixtures/real/Duplex_A_20110907.ifc` dan mengarahkan `tests/test_floor_detection.py::test_ifc_duplex_uses_ifc_storeys` ke lokasi tersebut (`Facade only to Alfian.3dm` tetap lokal di `corpus/`).
- **Verifikasi**: `386 lulus, 1 dilewati, 0 gagal`; `compare_baseline` **0 selisih**.

### 2) T4 — A3-07: Peringatan informatif celah sempit antar massa (`NARROW_GAP_FACES`)
- **Commit kode**: `ffb6467` (*A3-07: peringatan informatif NARROW_GAP_FACES untuk celah sempit antar massa*)
- **Commit dokumen**: `4da4971` (*docs: tandai A3-07 selesai di audit dan serah-terima*)
- **Ringkasan perubahan**:
  - `backend/ottv_engine.py`: menambahkan deteksi celah sempit `< 1,5 m` (`NARROW_GAP_THRESHOLD_M = 1.50`) di `detect_exterior_faces_raycast(..., return_narrow_gap=True)` dan `resolve_group_outer_skin_faces()`, dengan pemeriksaan tambahan sinar `+Z` terbuka ke langit agar koridor beratap di dalam bangunan tidak salah terdeteksi.
  - Menambahkan peringatan informatif `NARROW_GAP_FACES` (luas total m² dengan koma desimal, jumlah bidang, dan rincian grup) ke `summary.warnings`, **tanpa** memasukkannya ke `PROVISIONAL_WARNING_CODES` dan **tanpa** mengubah angka OTTV default.
  - `tests/test_invariants.py`: menambahkan 2 uji baru (`test_celah_sempit_1m_munculkan_peringatan_narrow_gap_faces` — gagal sebelum perbaikan, lulus setelahnya; dan `test_celah_lebar_6m_tidak_munculkan_peringatan_narrow_gap_faces`).
- **Verifikasi**: `388 lulus, 1 dilewati, 0 gagal`; `compare_baseline` **0 selisih**; `npm run engine:assets && npm run build` lulus.

### 3) T7 — Optimasi kecepatan engine OTTV (terbukti identik lewat uji)
- **Commit kode**: `e8d604f` (*T7: percepatan engine OTTV 2,3x-2,9x dengan paritas angka identik*)
- **Ringkasan perubahan** (`backend/ottv_engine.py`, `backend/recommender.py`):
  1. **Cache ember-Z + AABB per rentang `(b0, b1)`** pada `_build_shading_z_index` / `_z_index_candidates` + **precompute normal segitiga peneduh** (`shading_norm_info`) serta proyeksi 2D langsung menggantikan `einsum` 3D di `_measure_panel_sni_shading_ratios`.
     - Panggilan `_unique_hash`: **`582` → `8`** (`806 ms` → `21 ms`).
     - Total waktu `_measure_panel_sni_shading_ratios`: **`2.038 ms` → `469 ms`** (**4,35× lebih cepat**).
  2. **Vektorisasi `np.round(...).tolist()`** sebelum loop pembuatan `panel_records`.
     - Panggilan `builtins.round`: **`697.763` → `298.595`** (turun **57,2%**).
  3. **Prahitung tabel SF 8 orientasi** untuk mode SNI sebelum loop panel (`12.105` panggilan `get_sf_for_source` → **`8` lookup**).
  4. **Cache lokal** untuk `lookup_sceff_detailed` per `(orientasi, r1, r2, phi1)` dan parameter material per `(material_id, kategori)` (menghilangkan `12.106` panggilan berulang `get_material_by_id` / `get_all_materials`).
  5. **Vektorisasi ekstraksi segitiga** di `_serialize_raw_groups` (`201 ms` → `73 ms`, **2,75× lebih cepat**).
  6. **Melewati `compute_panel_heatmap_color` per panel** di `analyze_building_ottv` dan `rematerial_analysis` (`24.192` → **`0` panggilan**; frontend menghitung warna heatmap sendiri di `viewer/modes.js` dan `backend/payload.py` memang tidak mengirim field `heatmap_*`; fungsi `compute_panel_heatmap_color` tetap dipertahankan di modul agar kompatibel bila ada impor eksternal).
- **Dampak terukur**:
  - `backend/samples/Fasad_Tower_Twisted.3dm` (12.096 panel): waktu hitung hangat turun dari **`3.604 ms`** (ber-profil) menjadi **`1.562 ms`** (ber-profil) / **`1.245 ms`** (median 3 run tanpa profiler) — **2,3×–2,9× lebih cepat**; OTTV tetap persis **`34,18 W/m²`**.
  - `fixtures/fasad_unitized_24lantai.3dm`: turun dari **`5,13 detik`** → **`2,58 detik`** (**2,0× lebih cepat**); OTTV tetap persis **`25,03 W/m²`**.
  - `fixtures/fasad_unitized_24lantai.glb`: turun dari **`8,98 detik`** → **`6,11 detik`**; OTTV tetap persis **`25,03 W/m²`**.
- **Uji paritas baru** (`tests/test_engine_speed_parity.py`, 5 tes): memverifikasi `_measure_panel_sni_shading_ratios` (dengan cache indeks-Z + normal prahitung vs *brute-force* tanpa indeks-Z) menghasilkan `(R1, R2, phi1)` dan `detail` **100% identik** di `08_overhang`, `09_sirip`, dan `Fasad_Tower_Twisted.3dm`, serta `_z_index_candidates` ber-cache identik dengan tanpa cache.
- **Verifikasi**: `393 lulus, 1 dilewati, 0 gagal`; `compare_baseline` **0 selisih**; `npm run engine:assets && npm run build` lulus; seluruh uji paritas Pyodide (32-bit WASM) lulus.

---

## 3. Apa yang Dibatalkan atau Dilewati (dan Alasannya)

- **Tidak ada tugas yang dibatalkan karena gagal.** Seluruh tugas yang direncanakan (T2, T4, T7) lulus penuh pada percobaan pertama dengan `0 selisih` baseline.
- **T5 (`A3-11` & `A3-13`)**: **dilewati** sesuai instruksi Anda karena memerlukan keputusan desain perhitungan rangka.
- **T6 (`A3-04` Fase 2 — tabel kolom panel)**: **dilewati** sesuai instruksi Anda.
- **Sub-kandidat T7 `preview_meshes` (inspeksi 4,6 MB)**: sengaja **tidak diubah** malam ini karena mengubah format `preview_meshes` membutuhkan perubahan kontrak data antara backend dan viewer frontend (berisiko menyentuh UI tanpa verifikasi klik browser langsung). Semua optimasi T7 yang diterapkan malam ini murni di dalam engine dengan paritas angka 100% teruji.

---

## 4. Keputusan yang Diambil Sendiri (Prinsip Paling Aman, 0 Perubahan OTTV)

1. **`NARROW_GAP_FACES` bersifat informatif (tidak masuk `PROVISIONAL_WARNING_CODES`)**: dipilih agar model yang memiliki celah sempit mendapat peringatan jelas (luas m² dan daftar grup) tanpa mengubah status `compliant` atau `is_provisional` secara mendadak dan tanpa menyentuh angka OTTV.
2. **Filter langit terbuka (`+Z`) pada deteksi celah sempit (A3-07)**: saat `roof_tris` tersedia, hanya bidang di celah sempit yang terbuka ke langit (bukan di bawah atap/koridor interior) yang dilaporkan sebagai `NARROW_GAP_FACES`, untuk mencegah peringatan palsu pada koridor sempit di dalam bangunan.
3. **Menjaga fungsi `compute_panel_heatmap_color()` tetap ada di `ottv_engine.py`**: hanya panggilan per-panel yang tidak dipakai oleh frontend/laporan/tes yang dilewati, sehingga tidak memutus kompatibilitas skrip lain yang mungkin mengimpor fungsi tersebut.
4. **Urutan segitiga quad di `_serialize_raw_groups`**: seluruh segitiga pertama `[f0, f1, f2]` ditumpuk bersama segitiga kedua quad `[f0, f2, f3]` lewat `np.vstack` (himpunan segitiga persis sama, hanya untuk mesh tampilan rangka/peneduh/atap/konteks — tidak menyentuh perhitungan OTTV).

---

## 5. Yang Perlu Anda Konfirmasi

1. **`git push` ke `origin/main`**: commit lokal malam ini (`1527235` sampai laporan ini) belum di-push. Bila Anda siap, jalankan `git push` lalu periksa tab **Actions → Tes** di GitHub untuk memastikan log CI hijau dengan Pyodide + LibreOffice + `Duplex_A_20110907.ifc` ikut berjalan.
2. **Keputusan desain T5 (`A3-11` & `A3-13`)** bila ingin dikerjakan berikutnya:
   - *(a) A3-11 (mode simulasi)*: apakah konduksi rangka 8% diterapkan ke semua kaca (tidak bergantung ada/tidaknya grup rangka di model)?
   - *(b) A3-13 (mode SNI)*: apakah muka depan profil rangka masuk luas selubung $A_o$ sebagai fenestrasi?
3. **T6 (`A3-04` Fase 2) & `preview_meshes`**: setelah T7 mempercepat hitung 2,3×–2,9×, silakan coba buka `Fasad_Tower_Twisted.3dm` di browser (ingat **Ctrl+Shift+R** agar service worker memuat versi `131685a0a577`) dan beri tahu apakah terasa sudah cukup ringan atau masih perlu T6 / kompresi `preview_meshes`.
