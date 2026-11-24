# Serah-Terima ke Antigravity — 24 Nov 2026, 23:45 WIB

Dokumen ini untuk agen coding (Antigravity) yang melanjutkan pekerjaan LUXA setelah sesi audit bersama Claude.
Baca seluruhnya sebelum mengubah kode. Riwayat lengkap ada di `docs/LOG_PENGERJAAN.md`; laporan audit di
`docs/AUDIT_PIPELINE_2026-11.md`; rencana ukuran data di `docs/RENCANA_A3-04_UKURAN_DATA.md`.

## 1. Status saat serah-terima

- Branch `main`, commit terakhir kode `e8d604f`. Semua tes lulus (393 lulus, 1 dilewati), `tools/compare_baseline.py` 0 selisih.
- Model acuan `backend/samples/Fasad_Tower_Twisted.3dm` (milik pengguna): OTTV **34,18** (triple-silver, material
  dikonfirmasi). Opsi studi `corpus/_studi_peneduh/Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm`: **30,45**.
- Selesai: AUDIT-01..03, A3-01, A3-02, A3-03, A3-04 Fase 0+1, A3-05, A3-06, A3-07, A3-08, A3-09, A3-10, A3-12 (sebagian), A3-14, A3-15, percepatan
  engine (raycast, peneduh, rematerial, inspeksi, T7: cache indeks-Z, vektorisasi round/serializer, SF/SC/material cache), service worker.
- Belum: A3-11, A3-13 (T5, butuh keputusan), A3-04 Fase 2–4 (T6, opsional; lihat §6).

## 2. Aturan kerja (wajib)

1. **Angka OTTV tidak boleh berubah tanpa disengaja.** Sebelum menyatakan selesai, jalankan:
   ```bash
   python -m pytest -q
   python tools/compare_baseline.py      # harus "0 selisih"
   ```
   Bila perubahan angka memang disengaja: jalankan `python tools/snapshot_baseline.py`, jelaskan setiap selisih di
   pesan commit (model apa, berapa, kenapa), lalu commit `fixtures/baseline.json`. Jangan pernah memperbarui baseline
   hanya supaya CI hijau.
2. **Setiap perbaikan bug = satu uji yang gagal sebelum perbaikan.** Uji geometri/aturan ada di
   `tests/test_invariants.py` (memakai pembangun model di `tools/make_synthetic.py`); uji nama layer di
   `tests/test_classify_names.py`.
3. **Optimasi wajib terbukti identik.** Contoh yang sudah ada: `tests/test_raycast_accel.py` (grid vs brute-force),
   `tests/test_inspect_cache.py` (cache vs hitung baru), `tests/test_payload.py` (format kirim vs hasil lengkap).
4. **Bahasa antarmuka dan pesan peringatan: Indonesia awam.** Koma desimal (`0,23`), bukan titik.
5. **Pesan commit dalam bahasa Indonesia**, kalimat pertama merangkum perubahan, isi menyebut angka terukur.

## 3. Jebakan yang sudah ditemukan (jangan diulang)

| Jebakan | Penjelasan |
|---|---|
| **Pyodide = WebAssembly 32-bit** | `np.repeat(x, counts)` dengan `counts` int64 gagal di browser ("Cannot cast int64 to int32") padahal lolos di Python desktop. Pakai `counts.astype(np.intp)`. Selalu uji jalur browser (lihat §4). |
| **Engine menyimpan hasil lengkap, tampilan menerima versi ramping** | `backend/payload.py` (`slim_analysis`, `slim_rematerial`) dibongkar oleh `frontend/src/engine/payload.js`. Bila tampilan butuh field panel baru, tambahkan ke `ACTIVE_PANEL_FIELDS` (dan `REMATERIAL_FIELDS` bila berubah saat ganti material). Laporan Excel/PDF dibuat dari salinan lengkap di engine (`_get_analysis`), bukan dari nilai kembalian `analyze()`. |
| **`materials_confirmed`** | Default `false` → hasil "HASIL SEMENTARA" (`MATERIAL_NOT_CONFIRMED`). Uji yang bukan tentang material harus mengisi `materials_confirmed=True`. Setiap pilihan material dari pengguna (`applyMaterialPatchFast`) otomatis mengonfirmasi. |
| **Override grup selalu menang** | Urutan material: `group_material_map` > override orientasi > material utama. Memilih material utama menghapus override grup peran itu (`applyPatchToConfigClone` di `main.js`). |
| **Status hasil satu sumber** | `resolve_result_status()` dan `PROVISIONAL_WARNING_CODES` di `ottv_engine.py` dipakai hitung penuh dan `rematerial`. Kode peringatan baru yang perlu tindakan pengguna → tambahkan ke set itu. |
| **Nama layer tidak boleh jadi satu-satunya penentu** | Cek geometri: `loaders/sanity.py` (face kembar, batang = rangka) dijalankan di `universal_pipeline` dan dilaporkan engine. |
| **Peneduh SNI** | SNI Lampiran A hanya mendefinisikan peneduh menempel di tepi jendela (R1 = P/H, R2 = P/W). Peneduh lepas/lebih tinggi: `_superposed_sceff`. Jangkauan 3 m (`SHADE_MAX_GAP_M`, `SHADE_MAX_RISE_M`). |
| **Service worker menahan versi lama** | Setelah build, uji dengan Ctrl+Shift+R; bila masih lama, tutup semua tab lalu buka lagi. |
| **Git di folder ini** | Bila git meninggalkan `.git/*.lock`, pindahkan (jangan hapus saat git lain berjalan). File `.git/stale-*.lock` sisa sesi Claude boleh dihapus. |

## 4. Membangun dan menguji

Pengembang memakai Windows tanpa Node.js. **Pasang Node.js 20 LTS** lebih dulu, lalu sekali: `cd frontend && npm install`.

```bash
# backend (Python 3.10+)
pip install -r backend/requirements.txt -r requirements-dev.txt
python -m pytest -q
python tools/compare_baseline.py

# aset engine browser (WAJIB setiap kali file di backend/ berubah)
cd frontend && npm run engine:assets

# build aplikasi (yang disajikan start_studio.bat di http://127.0.0.1:8000)
npm run build

# ukur
python tools/payload_report.py              # ukuran data hasil
#   buka http://127.0.0.1:8000/?perf=1 lalu lihat konsol: [LUXA perf] ... total_ms parse_ms payload_mb
python tools/log_pengerjaan.py              # perbarui linimasa commit untuk laporan
```

Uji paritas engine browser (Pyodide di Node) berjalan otomatis lewat `tests/test_browser_engine_parity.py` bila aset
engine sudah di-build.

## 5. Peta perubahan sesi ini

| File | Isi |
|---|---|
| `backend/loaders/classify.py` | token & aturan nama layer (jamak, cladding, frasa peneduh, rangka kaca) |
| `backend/loaders/sanity.py` | face kembar, deteksi batang/profil (las vertex per posisi) |
| `backend/loaders/ifc.py` | nama elemen IfcPlate dibaca untuk deteksi kaca |
| `backend/material_hints.py` | saran material dari nama layer (nama generik tanpa saran) |
| `backend/payload.py` | format kirim ramping |
| `backend/ottv_engine.py` | peringatan baru, status bersama, peneduh lepas, pelat menjorok, raycast grid, indeks-Z peneduh, cache sisi luar, serializer per elemen |
| `backend/recommender.py` | rematerial: status/peringatan ikut diperbarui, tanpa deepcopy |
| `frontend/src/engine/payload.js` | pembongkar format ramping, `?perf=1`, memo inspeksi |
| `frontend/src/steps/results.js` | kartu "Material belum dipilih", catatan tampil sebagai teks |
| `frontend/scripts/sw.template.js` | clone respons sebelum dikembalikan |

## 6. Tugas berikutnya (urut prioritas, satu tugas per sesi)

Tempel prompt di bawah ke Antigravity. Setiap prompt sudah memuat kriteria selesai.

### T1 — A3-05: file 3DM tanpa render mesh (TINGGI)

> Baca `docs/SERAH_TERIMA_ANTIGRAVITY.md` dan bagian A3-05 di `docs/AUDIT_PIPELINE_2026-11.md`. File .3dm berisi Brep
> atau Extrusion tanpa render mesh (misal disimpan dengan SaveSmall) saat ini gagal dengan "Tidak ditemukan geometri
> 3D". Tambahkan tesselasi cadangan untuk face PLANAR: ambil loop tepi tiap BrepFace (dan Extrusion via ToBrep bila
> tersedia di rhino3dm), proyeksikan ke bidang face, triangulasi (ear clipping, dukung lubang bila ada loop dalam).
> Terapkan di jalur Python (`backend/loaders/rhino.py`/`universal_pipeline.py`) DAN jalur browser
> (`frontend/src/engine/rhinoExtract.js`) supaya hasil sama. Face non-planar tetap dicatat di `missing_mesh` dengan
> pesan yang menyarankan simpan ulang tanpa SaveSmall. Kriteria selesai: uji baru di `tests/test_invariants.py` yang
> menulis 3dm berisi Brep kotak + Extrusion tanpa mesh dan menghasilkan OTTV sama dengan versi mesh; paritas browser
> lulus; `python -m pytest -q` dan `python tools/compare_baseline.py` (0 selisih) lulus.

### T2 — A3-09: CI menguji engine browser dan laporan (SEDANG)

> Baca `docs/SERAH_TERIMA_ANTIGRAVITY.md`. Di `.github/workflows/tests.yml`, sebelum pytest jalankan
> `bash frontend/scripts/fetch_engine_assets.sh` dan `npm run engine:assets` (di folder frontend, cache
> `frontend/.engine-cache` dengan actions/cache seperti di `deploy-pages.yml`), lalu pasang LibreOffice
> (`sudo apt-get install -y libreoffice-calc`). Tujuannya agar `tests/test_browser_engine_parity.py`,
> `tests/test_payload.py` (Node) dan `test_libreoffice_recalculation_matches_app` tidak lagi dilewati. Pindahkan satu
> model nyata kecil ke `fixtures/` supaya tes yang kini butuh `corpus/` ikut berjalan. Kriteria selesai: log CI
> menunjukkan tes-tes itu dijalankan (bukan skipped) dan hijau.

### T3 — A3-10: peringatan build basi (KECIL)

> Baca `docs/SERAH_TERIMA_ANTIGRAVITY.md`. Di `backend/run_studio_servers.py` (dipanggil `start_studio.bat`), sebelum
> menyajikan `frontend/dist`, bandingkan waktu ubah terbaru di `frontend/src/` dan `backend/*.py` dengan
> `frontend/dist/index.html`. Bila sumber lebih baru, cetak peringatan jelas di konsol: "Build aplikasi lebih lama
> dari kode. Jalankan: cd frontend && npm run build" dan sebutkan bahwa Node.js 20 LTS diperlukan. Kriteria selesai:
> diuji manual (ubah satu file src, jalankan start_studio.bat, peringatan muncul).

### T4 — A3-07: celah sempit antar massa (SEDANG)

> Baca bagian A3-07 di `docs/AUDIT_PIPELINE_2026-11.md`. Saat deteksi sisi luar membuang bidang yang menghadap massa
> lain berjarak < 1,5 m, tambahkan peringatan informatif `NARROW_GAP_FACES` (luas dan grup) di summary.warnings,
> TIDAK mengubah angka default. Tambahkan uji di `tests/test_invariants.py` (dua massa berjarak 1 m → peringatan
> muncul; 6 m → tidak). Kriteria selesai: semua tes + baseline 0 selisih.

### T5 — A3-11 & A3-13: konsistensi rangka (KECIL, perlu keputusan pengguna)

> Baca bagian A3-11 dan A3-13 di audit. Tanyakan dulu ke pengguna: (a) di mode simulasi, apakah konduksi rangka 8%
> diterapkan ke semua kaca (tidak bergantung ada/tidaknya grup rangka)? (b) di mode SNI, apakah muka depan profil
> rangka masuk luas selubung A_o sebagai fenestrasi? Implementasikan sesuai jawaban dengan uji, perbarui baseline
> dengan penjelasan selisih.

### T6 — A3-04 Fase 2: tabel kolom panel (opsional)

> Hanya bila pengguna masih merasa berat. Ikuti `docs/RENCANA_A3-04_UKURAN_DATA.md` Fase 2. Turunkan
> `BUDGET_ANALYSIS` di `tests/test_payload.py` sesuai hasil. Paritas adapter wajib tetap identik.

### T7 — Sisa kecepatan engine (opsional)

> Profil `analyze_building_ottv` di Pyodide dengan skrip seperti `frontend/scripts/engine_parity.mjs` + cProfile.
> Kandidat: 720 ribu panggilan `round()` saat membentuk `panel_records`, `compute_panel_heatmap_color` per panel
> (frontend tidak memakai warnanya), payload inspeksi 4,6 MB (`preview_meshes`). Setiap optimasi wajib uji identik.

## 7. Hal kecil yang perlu diketahui

- Empat file IFC (`fixtures/archicad_bim_curtainwall.ifc`, `backend/samples/benchmark_library/Klassiqua_*.ifc`)
  tercatat berubah karena akhir baris Windows (CRLF); isinya sama. Bersihkan dengan
  `git checkout -- fixtures/archicad_bim_curtainwall.ifc backend/samples/benchmark_library`.
- Folder kosong `Claude outputs/` di root boleh dihapus.
- Repo lokal belum di-push sejak sesi ini (beberapa commit di depan `origin/main`).
