<!-- Disalin otomatis dari doc "Rencana Eksekusi (Antigravity)" (https://claude.ai/artifact/Hwbukz46HzV5je9k9J5ghN). Jangan diedit manual. -->

# Rencana Eksekusi untuk Antigravity

Rencana ini menerjemahkan audit menjadi tugas yang bisa dikerjakan agen coding fase demi fase. Setiap fase punya tujuan, perubahan per file, kriteria selesai, dan prompt siap tempel.

## Cara pakai di Antigravity

Kerjakan satu fase per sesi agen, berurutan dari Fase 0 sampai Fase 6. Jangan lompat ke Fase 4 (UX) sebelum Fase 1 dan 2 selesai, karena layar baru butuh data geometri dan API yang sudah benar.

Aturan untuk setiap sesi:

1. **Selalu mulai dari Fase 0 kalau belum ada git.** Folder proyek saat ini belum punya repositori git, jadi perubahan agen tidak bisa dibatalkan.
2. **Satu fase = satu branch** (`fase-1-geometri`, `fase-2-api`, dst.). Merge ke `main` hanya kalau kriteria selesai terpenuhi.
3. **Tempel konteks yang sama di awal setiap sesi:** tab Audit dari doc ini (minimal tabel M1–M12, P1–P8, dan tabel audit fitur), lalu prompt fase yang sedang dikerjakan.
4. **Agen wajib menjalankan `tools/compare_baseline.py`** (dibuat di Fase 0) sebelum menyatakan fase selesai, dan menempelkan hasilnya.
5. **Jangan ubah rumus OTTV tanpa tes hitungan manual.** Setiap perubahan angka harus bisa dijelaskan oleh tes yang membandingkan dengan hitungan tangan.
6. **Bahasa antarmuka: Indonesia awam.** Istilah teknis hanya di panel Lanjutan atau tooltip.

**Sinkronisasi ke repo (mulai 21 Nov):** Antigravity hanya bisa membaca file di repo. Setiap kali Claude memperbarui rencana ini (review fase, keputusan baru), Claude juga menyalin tab ini ke `docs/RENCANA.md`. Untuk fase yang butuh detail panjang, Claude membuat file spesifikasi tersendiri (contoh: `docs/FASE1C_SPEC.md`). Di setiap prompt, cukup minta Antigravity membaca file tersebut.

Peta file yang paling banyak disentuh:

| File | Isi saat ini | Fase |
| --- | --- | --- |
| `backend/universal_pipeline.py` | Loader semua format, normalisasi, klasifikasi, auto-split, lantai | 1, 6 |
| `backend/ottv_engine.py` | Raycast, deteksi sisi luar, hitung OTTV, heatmap; berisi kode mati | 1, 3, 6 |
| `backend/adapters/__init__.py` | Profil 5 software, payload Inspeksi, config `.ottv.json` | 2 |
| `backend/main.py` | Semua endpoint, katalog preset, state global | 2, 5 |
| `backend/materials_and_epw.py` | Katalog material, preset kota, parser EPW | 3 |
| `backend/report_exporter.py` | Excel, CSV, PDF | 3, 5 |
| `frontend/index.html`, `src/main.js`, `src/stagingWorkspace.js` | Seluruh UI (≈3.500 + ≈1.500 baris JS) | 4 |

## Fase 0 — Persiapan: git, fixture, baseline

Tujuannya: sebelum ada satu baris pun yang diubah, keadaan sekarang tercatat dan bisa dibandingkan.

- [ ] `git init`, buat `.gitignore` (`.venv/`, `node_modules/`, `__pycache__/`, `dist/`, `backend/uploads/`), lalu commit awal "baseline sebelum audit".
- [x] Buat `docs/` dan simpan PDF SNI 6389:2020 di `docs/SNI-6389-2020.pdf`. Buat juga `docs/AUDIT.md` berisi salinan tab Audit.
- [ ] Buat `fixtures/` berisi: `fasad_unitized_24lantai.3dm`, `tes objek archicad.3dm`, `backend/samples/archicad_bim_curtainwall.ifc`, satu HBJSON dari `samples/benchmark_library`, dan satu GLB.
- [ ] Buat `tools/snapshot_baseline.py`. Untuk setiap fixture, panggil `load_universal_model_stages_1_and_2` dan `analyze_building_ottv` dengan parameter default, lalu simpan ke `fixtures/baseline.json`: jumlah grup, kategori per grup, jumlah face per grup, bounding box, `z_ground_offset_m`, jumlah sliver dibuang, luas per peran (sisi luar), WWR, OTTV total, OTTV per orientasi.
- [ ] Buat `tools/compare_baseline.py` yang menjalankan hal sama dan mencetak selisih terhadap `baseline.json` dalam bentuk tabel.
- [ ] Ganti path hardcoded di `run_studio_servers.py` (Node dari `E:\APPS\ARCHICAD 30`) dengan `npm run dev` atau variabel environment, supaya agen bisa menjalankan proyek.

**Selesai kalau:** repo ter-commit, `python tools/snapshot_baseline.py` menghasilkan `baseline.json` untuk 5 fixture, dan `compare_baseline.py` mencetak "0 selisih" bila dijalankan ulang.

```text
PROMPT FASE 0 (tempel ke Antigravity):
Kamu bekerja di proyek OTTV 3D Studio (FastAPI backend di /backend, Vite + Three.js frontend di /frontend). JANGAN mengubah logika perhitungan atau UI di fase ini.
Tugas:
1) git init, buat .gitignore (.venv, node_modules, __pycache__, dist, backend/uploads), commit awal.
2) Buat folder fixtures/ dan salin 5 model uji: fasad_unitized_24lantai.3dm, "tes objek archicad.3dm", backend/samples/archicad_bim_curtainwall.ifc, satu .hbjson dari backend/samples/benchmark_library, satu .glb dari folder yang sama.
3) Buat tools/snapshot_baseline.py: untuk tiap fixture panggil universal_pipeline.load_universal_model_stages_1_and_2() dan ottv_engine.analyze_building_ottv() dengan EnvelopeParameters default; simpan ke fixtures/baseline.json: jumlah grup, kategori & jumlah face per grup, bbox, z_ground_offset_m, slivers_removed, luas sisi luar per peran, WWR, OTTV total dan per 8 orientasi.
4) Buat tools/compare_baseline.py yang menjalankan hal yang sama dan mencetak tabel selisih vs baseline.json.
5) Ganti path Node hardcoded di backend/run_studio_servers.py dengan variabel environment NODE_EXE (default: "node" di PATH).
Kriteria selesai: compare_baseline.py dijalankan dua kali berturut-turut mencetak 0 selisih. Commit dengan pesan "fase-0: baseline & tooling".
```

## Fase 1 — Ketepatan geometri (M1–M12)

Tujuannya: apa yang ada di file = apa yang dihitung. Tidak ada elemen yang dibuang, digeser, atau diubah tanpa tercatat dan bisa dikembalikan.

| Kode | Perubahan | File / fungsi | Cara membuktikan |
| --- | --- | --- | --- |
| M1 | Di loop top-level `.3dm`, lewati objek yang `Attributes.Mode` = InstanceDefinitionObject. Objek itu hanya diproses lewat InstanceReference. | `universal_pipeline.py`, loop `for obj in model.Objects` | Grup pohon di fasad\_unitized tidak lagi punya salinan di titik asal blok; bbox mengecil ke bangunan |
| M9 | Anak blok memakai layer dan material miliknya sendiri. Layer induk hanya cadangan kalau anak ada di layer "By Parent"/Default. Cek visibilitas di semua kedalaman. | `_process_rhino_obj` | Nama grup anak blok memakai layer asli |
| M3 | Kalau face Brep/Extrusion tidak punya render mesh: jangan tessellate surface dasar. Catat sebagai "butuh mesh" dan tampilkan peringatan dengan instruksi ekspor (Rhino: tampilkan Shaded lalu Save, jangan SaveSmall; atau jalankan `Mesh`). Opsional: jalur Rhino.Compute bila tersedia. | cabang Brep/Surface di loader `.3dm` | Untuk tes objek archicad muncul peringatan "60 permukaan tanpa mesh" dan tidak ada geometri yang dikarang |
| M4, M5, M6 | Ubah ketiga filter (sliver, stride, buang face non-vertikal) dari "hapus" menjadi "tandai". Setiap face/grup yang disaring masuk daftar `filtered_items` beserta alasan, luas, dan grup. Default: sliver tetap disaring tapi bisa dikembalikan; stride diganti dengan simplifikasi hanya untuk raycast, tidak untuk tampilan/luas; kaca miring (skylight) tetap dihitung, dan masuk RTTV di Fase 3. | `_filter_thin_edge_slivers_on_group`, merge grup (stride), `_clean_solid_bim_element_faces` | Payload Inspeksi punya `filtered_items`; jumlah luas sebelum dan sesudah filter dilaporkan |
| M7 | Ganti klasifikasi substring dengan pencocokan per token (pisah di `_ - . / :: spasi`), kamus terpisah Indonesia dan Inggris, dan skor keyakinan. Kata yang tidak dikenali menjadi `unknown`, bukan `wall`. `unknown` wajib dikonfirmasi user di Periksa Model. Pindahkan interior dan abaikan ke kategori `ignore`, jangan dicampur dengan `roof`. | `classify_layer_or_material_role` | Unit test: "Dinding\_Lantai2" → wall, "score\_panel" ≠ roof, "background" ≠ roof, pohon → unknown |
| M8 | Kalau satu nama grup berisi chunk dengan kategori berbeda, pecah menjadi sub-grup per kategori (`Nama :: kaca`, `Nama :: dinding`). | merge grup di loader | Tidak ada lagi grup dengan kategori campur |
| M2 | Acuan tanah Z: pakai elevasi storey BIM kalau ada; kalau tidak, ambil dari geometri yang berperan selubung (kaca/dinding/spandrel), bukan dari semua objek. Konteks, pohon, dan tanah tidak boleh menentukan Z0. Tampilkan Z0 di Periksa Model dan bisa diubah. | normalisasi Stage 1 | z\_offset fasad\_unitized dihitung dari fasad, bukan pohon |
| M10 | Untuk OBJ/STL/GLB tanpa info satuan: tampilkan tebakan satuan beserta dimensi hasil (misalnya "Tinggi 86 m — benar?") dan minta konfirmasi, jangan langsung skala diam-diam. | normalisasi Stage 1 | Upload OBJ tapak 700 m memicu dialog konfirmasi |
| M11 | Satu definisi luas: luas sisi luar. Layar Periksa memakai fungsi luas yang sama dengan hasil OTTV. | `adapters.build_staging_inspection_payload`, `ottv_engine` | Luas kaca sama di Periksa dan Hasil (7.900 m², bukan 15.880) |
| M12 | Hapus klaim "perbaikan normal" dari profil, atau implementasikan pembalikan normal per face (bukan per grup) berdasarkan raycast. | `adapters/__init__.py`, `ottv_engine.py` | Teks profil sesuai perilaku nyata |
| — | Hapus parser IFC STEP Python murni. Kalau IfcOpenShell gagal, tampilkan error yang jelas. | `_parse_ifc_file` | IFC rusak menghasilkan pesan yang bisa dipahami |

**Selesai kalau:** semua unit test klasifikasi lulus, `compare_baseline.py` menunjukkan selisih yang **bisa dijelaskan** per fixture (tulis penjelasannya di `docs/CHANGELOG-fase1.md`), dan tidak ada face yang hilang tanpa masuk `filtered_items`.

```text
PROMPT FASE 1 (tempel ke Antigravity, bersama tab Audit bagian "Pembacaan model"):
Kerjakan di branch fase-1-geometri. Fokus HANYA pada backend/universal_pipeline.py, backend/adapters/__init__.py, dan bagian deteksi sisi luar di backend/ottv_engine.py. Jangan ubah UI.
Perbaiki M1-M12 sesuai tabel "Fase 1" di dokumen rencana:
- M1: lewati objek ObjectMode.InstanceDefinitionObject di loop top-level .3dm.
- M9: anak blok pakai layer/material sendiri; cek visibilitas di semua kedalaman.
- M3: Brep tanpa render mesh -> jangan tessellate UnderlyingSurface; kumpulkan ke audit.missing_mesh dengan instruksi ekspor.
- M4/M5/M6: filter tidak menghapus, tapi menandai ke audit.filtered_items [{group, reason, face_count, area_m2}] dan bisa dikembalikan via parameter restore_filtered (list id). Stride hanya untuk mesh raycast, bukan untuk luas/tampilan. Face kaca miring tetap disimpan.
- M7: klasifikasi per token + kategori 'unknown' dan 'ignore'; tambah tests/test_classify.py dengan kasus: Dinding_Lantai2->wall, score_panel bukan roof, background bukan roof, LANDS Acer palmatum->unknown, Glass - Clear Fast->glazing, Insulation - Fiberglass (dalam IfcCurtainWall)->spandrel.
- M8: pecah grup berkategori campur.
- M2: Z0 dari storey BIM atau geometri selubung saja.
- M10: kembalikan audit.unit_needs_confirmation=true bila satuan ditebak dari bbox.
- M11: satu fungsi luas sisi luar dipakai Inspeksi dan Hasil.
- M12: hapus klaim perbaikan normal di SOFTWARE_PROFILES.
- Hapus _parse_ifc_file (fallback STEP).
Setelah selesai jalankan tools/compare_baseline.py, tulis penjelasan tiap selisih di docs/CHANGELOG-fase1.md, jalankan pytest. Commit per kode M.
```

### Review Fase 1 (Nov 21, 2026): lulus dengan catatan, belum boleh di-merge

Secara umum perbaikan M1–M12 sudah dikerjakan dengan baik dan rapi (1 commit per kode M). Saya mengulang tes di salinan repo: `pytest` 9/9 lulus, `compare_baseline.py` 133 selisih, sama persis dengan laporan Antigravity. Ada 5 hal yang harus dibereskan dulu sebelum branch `fase-1-geometri` di-merge ke `main`.

| Dicek | Hasil |
| --- | --- |
| M1 blok ganda | Benar. Pohon di fasad\_unitized ternyata hanya ada di definisi blok dan tidak pernah dipasang di model, jadi wajar 9 grup itu hilang. |
| M2 acuan tanah | Benar. Z0 fasad\_unitized +0,12 m, tes objek +0,05 m. |
| M3 Brep tanpa mesh | Benar secara kode, tapi **penjelasan di CHANGELOG keliru** (lihat catatan 1). |
| M4–M6 filter | Benar. `filtered_items` tercatat: fasad\_unitized 324 m² kaca + 146 m² spandrel (sisi tebal panel), tes objek 61 m² kaca. Stride sudah hilang (rangka 78.577 → 156.832 face). |
| M7 klasifikasi | Jauh lebih baik. Dari 41 nama uji saya, sebagian besar benar; ada 6 yang masih keliru (catatan 3). |
| M8, M9, M10, M11, M12, hapus fallback IFC | Benar. |
| Backend masih bisa di-import | Ya (24 route). |

**Catatan yang wajib dibereskan:**

1. **OTTV tes objek 32,43 W/m² belum bisa dipercaya.** `missing_mesh` mencatat 19.552 face Brep rangka aluminium dan 234 face insulasi yang sekarang **tidak ikut dihitung sama sekali**. Kenaikan OTTV dari 24,44 ke 32,43 sebagian besar terjadi karena rangka asli itu hilang dari perhitungan bayangan, bukan hanya karena "bidang karangan" hilang. Nilai yang benar baru bisa diketahui setelah file disimpan ulang dari Rhino dengan render mesh. Perbaiki paragraf 5 di CHANGELOG, dan pastikan hasil analisis membawa status "tidak lengkap" bila `missing_mesh` tidak kosong.
2. **Grup `unknown` diam-diam dikeluarkan dari perhitungan** saat model masih punya kaca/dinding. Contohnya `09_SkyGarden_Planter_Greenery` di fasad\_unitized kini tidak dihitung sebagai peneduh, padahal tidak ada peringatan di ringkasan hasil. Tambahkan `summary.is_provisional = true` dan `summary.warnings` (daftar grup unknown, `missing_mesh`, `unit_needs_confirmation`) supaya hasil tidak tampil sebagai "Memenuhi SNI" tanpa catatan.
3. **Klasifikasi yang masih keliru:**
   - "Railing kaca balkon" dan "Glass Railing" → glazing. Railing bukan selubung dan akan terhitung sebagai jendela; harus jadi `ignore`.
   - "Pelat Lantai" → roof. Harus `ignore`, karena di Fase 3 `roof` akan masuk RTTV.
   - "dinding dalam" → wall. Kata "dalam" berarti interior, jadi harus `ignore`, sama seperti "Wall\_Interior".
   - "GRC Panel" → unknown. GRC adalah cladding yang umum di Indonesia, jadi harus `wall`.
   - "Parapet" → spandrel. Lebih tepat `wall`.
   - "Kolom" dan "Balok" → unknown. Lebih tepat `ignore` (struktur).
4. **Fixture GLB tidak mewakili bangunan.** Khronos\_Glass\_Transmission adalah scene uji material (bola dan label), jadi hanya membuktikan error ditolak. Tambahkan satu GLB bangunan nyata, misalnya hasil ekspor `fasad_unitized_24lantai.3dm` ke .glb, lalu snapshot ulang khusus fixture baru itu.
5. **Rapikan dokumen di repo.** Pindahkan `NEW/Audit.md` dan `NEW/RENCANA.md` ke `docs/AUDIT.md` dan `docs/RENCANA.md`. Hapus `NEW/SNI-6389_2020-OTTV.pdf` karena sama dengan `docs/SNI-6389-2020.pdf` (PDF 1,1 MB tersimpan dua kali di git).

**Catatan untuk antarmuka (bukan kesalahan Fase 1):** frontend lama belum mengenal peran `unknown`/`ignore`, `filtered_items`, dan `missing_mesh`. Sampai Fase 4 selesai, jangan pakai UI untuk hasil yang serius; dropdown peran di UI lama tidak punya pilihan untuk kedua peran baru itu.

```text
PROMPT FASE 1b (perbaikan review, tetap di branch fase-1-geometri):
1) ottv_engine.analyze_building_ottv: tambahkan summary.is_provisional (bool) dan summary.warnings (list of {code, message, detail}) yang terisi bila ada grup unknown (sebutkan nama grup), audit.missing_mesh tidak kosong (jumlah face per grup), atau audit.unit_needs_confirmation=True. Grup unknown TETAP tidak dihitung, tapi wajib muncul di warnings.
2) classify_layer_or_material_role: railing/balustrade/pagar (termasuk 'railing kaca', 'glass railing') -> ignore; 'pelat lantai'/'floor slab'/'plat lantai' -> ignore (bukan roof); token 'dalam'/'interior' setelah dinding/wall -> ignore; 'grc' -> wall; 'parapet' -> wall; 'kolom'/'column'/'balok'/'beam' -> ignore. Tambahkan semua kasus ini ke tests/test_classify.py.
3) Tambahkan fixture GLB bangunan nyata (ekspor fasad_unitized_24lantai.3dm ke .glb dengan trimesh atau dari Rhino), snapshot hanya untuk fixture baru ini (jangan timpa baseline fixture lama).
4) Pindahkan NEW/Audit.md -> docs/AUDIT.md, NEW/RENCANA.md -> docs/RENCANA.md, hapus folder NEW/ (termasuk PDF duplikat).
5) Revisi paragraf 'tes objek archicad.3dm' poin 1 dan 5 di docs/CHANGELOG-fase1.md: jelaskan bahwa 19.552 face Brep rangka aluminium kini tidak ikut dihitung (missing_mesh) sehingga OTTV 32,43 bersifat sementara sampai file disimpan ulang dengan render mesh.
Jalankan pytest dan compare_baseline.py, lalu commit. Setelah itu merge fase-1-geometri ke main.
```

### Review Fase 1b (Nov 21, 2026): lulus, Fase 1 selesai

Kelima catatan sudah dibereskan, dan branch sudah di-merge ke `main` (commit `9449991`). Hasil uji ulang di salinan repo: `pytest` 18/18 lulus. `compare_baseline.py` tetap 133 selisih untuk fixture lama, artinya baseline lama tidak ditimpa.

| Dicek | Hasil |
| --- | --- |
| `summary.is_provisional` + `warnings` | Berfungsi. fasad\_unitized memunculkan peringatan UNKNOWN\_GROUPS (planter SkyGarden), tes objek memunculkan MISSING\_MESH (19.786 face). |
| Klasifikasi baru | Railing, pelat lantai, dinding dalam, kolom, dan balok → ignore. GRC dan parapet → wall. Semua benar. |
| Fixture GLB bangunan | Bagus sekali sebagai uji silang: `fasad_unitized_24lantai.glb` menghasilkan luas 9.421,80 m² dan WWR 74,7%, sama persis dengan versi .3dm. OTTV 24,49 vs 24,63 W/m², selisih 0,6% (wajar, karena versi GLB tidak punya sisi tebal panel yang perlu disaring). |
| Dokumen di repo | `docs/AUDIT.md` dan `docs/RENCANA.md` sudah pindah, folder `NEW/` dan PDF dobel sudah hilang. |

**Bawa ke Fase 2 (tambahkan di akhir PROMPT FASE 2):**

```text
Tambahan dari review Fase 1b:
- Bila summary.is_provisional=true, status_label tidak boleh berbunyi 'MEMENUHI SNI'. Gunakan 'HASIL SEMENTARA — perlu konfirmasi' dan sertakan daftar summary.warnings di response analyze dan di laporan ekspor.
- Tambahkan .gitattributes (* text=auto eol=lf; *.3dm *.glb *.pdf *.ifc binary) agar file tidak tampil berubah semua hanya karena akhir baris CRLF/LF.
- Kasus kecil klasifikasi: 'kaca dalam'/'partisi kaca' -> ignore (partisi interior), tambahkan ke tests/test_classify.py.
```

Satu hal di luar Antigravity: file `tes objek archicad.3dm` tetap perlu kamu simpan ulang dari Rhino dalam mode Shaded (bukan SaveSmall), supaya rangka aluminiumnya ikut terbaca.

## Fase 2 — Satu sumber kebenaran: API dan konfigurasi

Tujuannya: satu model data konfigurasi proyek dipakai oleh semua layar dan semua perhitungan.

1. **Buat skema `ProjectConfig`** (Pydantic) dengan empat bagian yang mengikuti langkah UX: `model` (file, satuan, sumbu, Z0, `restore_filtered`), `roles` (peran per grup, WWR grup, override per bidang/pita Z, auto-split), `settings` (kota, mode `sni`/`simulasi`, material per peran, lantai, utara), dan `advanced` (subdivisi NURBS, louver parametrik, ambang auto-split). Simpan sebagai `.ottv.json` versi 2, dengan migrasi dari versi lama.
2. **Ganti endpoint** menjadi:
   - `POST /api/models` (unggah, deteksi otomatis, kembalikan `model_id` + hasil deteksi)
   - `POST /api/models/{id}/inspect` (body: bagian `model` + `roles`; tanpa raycast; **tidak menyimpan apa pun**)
   - `PUT /api/models/{id}/config` (simpan eksplisit)
   - `POST /api/models/{id}/analyze` (body: `ProjectConfig` lengkap) mengembalikan `analysis_id`
   - `GET /api/analyses/{analysis_id}/export/{xlsx|csv|pdf}` (ekspor berdasarkan id, bukan "analisis terakhir")
3. **Hapus** `/api/analyze/preset`, `/api/analyze/upload`, `/api/analyze/commit`, `/api/stage/*`, dan `LAST_ANALYSIS_CACHE`.
4. **Hapus `use_global_slider_override`.** Material ditentukan per peran, override per grup opsional di `roles`. Urutan prioritas ditulis di satu fungsi `resolve_material(group)`.
5. **Hapus form "Software asal".** `detect_file_signature` sudah membaca header. Jadikan adapter hanya sebagai "tips ekspor" yang ditampilkan bila ada masalah.

**Selesai kalau:** model yang sama dengan `ProjectConfig` yang sama menghasilkan OTTV identik, entah dipanggil dari layar Periksa atau layar Hasil. Membuka layar Periksa tidak mengubah file apa pun di disk.

```text
PROMPT FASE 2:
Branch fase-2-api. Satukan konfigurasi dan endpoint backend.
1) Buat backend/config_schema.py berisi ProjectConfig (Pydantic v2) dengan bagian model, roles, settings, advanced sesuai dokumen rencana; tambahkan versi=2 dan fungsi migrate_v1(dict) untuk file .ottv.json lama.
2) Ganti endpoint di backend/main.py menjadi: POST /api/models, POST /api/models/{id}/inspect (read-only, tidak menulis file), PUT /api/models/{id}/config, POST /api/models/{id}/analyze -> {analysis_id, ...}, GET /api/analyses/{analysis_id}/export/{fmt}.
3) Hapus /api/analyze/preset, /api/analyze/upload, /api/analyze/commit, /api/stage/*, variabel global LAST_ANALYSIS_CACHE dan ACTIVE_CUSTOM_EPW (EPW custom menjadi bagian settings, disimpan per model).
4) Hapus use_global_slider_override; buat resolve_material(group, config) sebagai satu-satunya aturan prioritas material.
5) Hapus kewajiban source_software; gunakan detect_file_signature untuk deteksi; adapter hanya menyediakan export_tips.
Tes: tests/test_api.py memastikan inspect tidak menulis file, dan analyze dua kali dengan config sama menghasilkan OTTV identik. Frontend boleh rusak sementara; perbaikan UI di Fase 4. Commit.
```

### Review Fase 2 (Nov 21, 2026): lulus, boleh di-merge

Commit `0b4ac30` di branch `fase-2-api` memenuhi semua kriteria selesai. Saya uji di salinan repo yang bersih:

| Dicek | Hasil |
| --- | --- |
| `pytest` | 25/25 lulus, **setelah** saya memasang `reportlab` dan `httpx` sendiri (lihat catatan 1) |
| Angka OTTV tidak berubah | `compare_baseline.py` tetap 133 selisih dengan nilai yang sama seperti Fase 1. Fase 2 murni merapikan struktur, tidak mengubah hitungan. |
| Endpoint lama dihapus | `/api/analyze/preset`, `/api/stage/inspect`, `/api/export/excel` → 404 |
| Inspeksi tidak menulis file | Benar: tidak ada file di `uploads/` yang berubah setelah `POST /inspect` |
| Analisis dua kali dengan config sama | OTTV identik (33,33 W/m²) |
| Ekspor per `analysis_id` | Ya; state global lama sudah diganti penyimpanan berbatas 64 hasil |
| Status sementara | Model dengan `missing_mesh` berlabel "HASIL SEMENTARA — perlu konfirmasi" di response, CSV, dan Excel |
| `.gitattributes`, "kaca dalam" → ignore | Sudah |

**Catatan, bawa ke Fase 3:**

1. **`requirements.txt` belum lengkap.** `reportlab` (dipakai ekspor PDF) tidak tercantum, dan tes butuh `httpx` + `pytest`. Di lingkungan bersih, 1 tes gagal karena ini. Di komputermu tes lulus karena paket itu kebetulan sudah terpasang.
2. **Nilai angka di `settings` membingungkan.** `alpha_wall`, `u_wall`, `td_ek`, `u_fenestration`, `sc_glass`, `u_frame`, dan `delta_t` ada di `settings`, tapi hanya dipakai kalau material tidak dipilih. Mahasiswa akan mengira mengubah angka ini berpengaruh, padahal tidak. Pindahkan ke konsep "Material kustom" saja.
3. **Urutan prioritas material:** override per orientasi saat ini mengalahkan override per grup. Biasanya pilihan yang lebih spesifik (grup) yang menang. Usul: grup > orientasi > default peran.
4. **Mode default masih `simulasi`.** Setelah Fase 3, jadikan `sni` sebagai default karena itu yang dibutuhkan mahasiswa untuk tugas.
5. **Frontend sekarang tidak cocok dengan API baru** (masih 6 panggilan ke endpoint lama). Ini sesuai rencana, tapi artinya aplikasi tidak bisa dipakai lewat browser sampai Fase 4 selesai.

```text
Tambahan dari review Fase 2 (tempel di akhir PROMPT FASE 3):
- Lengkapi backend/requirements.txt (reportlab, openpyxl, ifcopenshell dengan versi terkunci) dan buat requirements-dev.txt (pytest, httpx).
- Hapus alpha_wall, u_wall, td_ek, u_fenestration, sc_glass, u_frame, delta_t dari settings. Ganti dengan settings.custom_materials (list material kustom: kategori, U, SC, alpha, massa_kg_m2, sumber) yang bisa dipilih seperti material katalog. Di mode 'sni', delta_t selalu 5 dan TDek dari massa_kg_m2. Sediakan migrasi config v2 lama.
- Ubah urutan resolve_material menjadi: override grup > override orientasi > default peran > saran nama > default katalog. Perbarui test.
- Jadikan settings.mode default 'sni'.
```

Setelah merge, saran urutan: kerjakan Fase 3 lalu langsung Fase 4, supaya aplikasi cepat bisa dipakai lagi lewat browser.

## Fase 3 — Mode Kepatuhan SNI 6389:2020

Tujuannya: angka "Memenuhi SNI" bisa dicocokkan baris per baris dengan hitungan manual memakai tabel di dokumen standar.

1. **Buat `backend/sni_tables.py`** yang ditranskrip dari `docs/SNI-6389-2020.pdf`. Isinya: Tabel 8 (SF untuk 54 lokasi × 8 orientasi), Tabel 7 (TDek dinding menurut berat), Tabel 9 (TDek atap), tabel α material/cat, dan Tabel A.5–A.16 (SCeff untuk peneduh horizontal, sirip vertikal, dan egg-crate). Setiap entri diberi komentar nomor tabel dan halaman. **Transkripsi wajib dicek manusia** (kamu) dengan membandingkan ke PDF.
2. **Mode `sni`:**
   - SF diambil dari Tabel 8 untuk kota terpilih; arah bidang dibulatkan ke 8 orientasi diskrit (tanpa interpolasi, tanpa zenith boost).
   - ΔT = 5 K tetap.
   - TDek dihitung dari berat dinding per m² (`massa_kg_m2` di katalog material: <125 → 15, 125–195 → 12, >195 → 10).
   - SC = SCk × SCeff. SCeff dari tabel Lampiran A berdasarkan rasio kedalaman peneduh yang diukur dari geometri (overhang/sirip di atas atau samping jendela), bukan raycast.
   - OTTV per orientasi = rata-rata tertimbang luas; OTTV total = Σ(Aᵢ × OTTVᵢ) / ΣAᵢ.
   - **RTTV** untuk atap dan skylight sesuai §4.4 dan ditampilkan terpisah.
3. **Mode `simulasi`:** pertahankan EPW, raycast SCeff, interpolasi SF, dan heatmap komposit, dengan label "Eksplorasi — bukan untuk kepatuhan" di layar dan di laporan.
4. **Katalog material:** tambahkan `massa_kg_m2`, `sumber` (URL/nama datasheet), dan `status` (`datasheet` / `nilai_tipikal`). Hapus kata "Terverifikasi" untuk entri tanpa sumber.
5. **Laporan:** ganti nama "Official PUPR Compliance Form" menjadi "Laporan Perhitungan OTTV mengacu SNI 6389:2020". Tambahkan lembar **"Hitungan Manual"**: untuk setiap orientasi tampilkan Ao, WWR, Uw, α, TDek, Uf, SC, SF, lalu substitusi rumus dan hasilnya. Lembar ini penting untuk mahasiswa yang harus menunjukkan langkah perhitungan.

**Selesai kalau:** ada `tests/test_sni_manual.py` dengan 3 kasus hitungan tangan (satu kotak 4 sisi WWR 40% di Jakarta, satu di Surabaya, satu dengan overhang), dan hasil program sama dengan hitungan tangan sampai 0,01 W/m².

```text
PROMPT FASE 3:
Branch fase-3-sni. Baca docs/SNI-6389-2020.pdf.
1) Transkripsi ke backend/sni_tables.py: Tabel 7 (TDek dinding), Tabel 8 (SF 54 lokasi x 8 orientasi), Tabel 9 (TDek atap), tabel absorptansi, Tabel A.5-A.16 (SCeff). Beri komentar nomor tabel + halaman pada tiap blok. Buat docs/sni_tables_check.md berisi tabel yang sama dalam markdown agar saya bisa memeriksanya terhadap PDF.
2) Tambah settings.mode = 'sni' | 'simulasi' di ProjectConfig. Di mode 'sni': SF diskrit 8 orientasi dari Tabel 8 kota terpilih; deltaT=5; TDek dari massa_kg_m2 material; SC = SCk x SCeff dengan SCeff dari Lampiran A berdasarkan rasio peneduh terukur; RTTV untuk grup atap/skylight sesuai pasal 4.4.
3) Mode 'simulasi' memakai perilaku lama dan diberi flag is_compliance=false di hasil.
4) materials_and_epw.py: tambah massa_kg_m2, sumber, status pada tiap material; hapus label 'Terverifikasi' bila tanpa sumber.
5) report_exporter.py: ganti judul laporan, tambah sheet 'Hitungan Manual' per orientasi dengan substitusi rumus.
6) tests/test_sni_manual.py: 3 kasus hitungan tangan, toleransi 0.01 W/m2.
Commit.
```

### Review Fase 3 (Nov 21, 2026): lulus dengan 1 bug yang wajib diperbaiki

Commit `2d59fc6` di branch `fase-3-sni`. Uji di salinan repo: `pytest` 29/29 lulus. Catatan dari Fase 2 sudah dikerjakan semua: requirements lengkap + `requirements-dev.txt`, angka U/α/SC dipindah ke `custom_materials`, urutan prioritas material grup > orientasi > peran, dan mode default `sni`.

| Dicek | Hasil |
| --- | --- |
| Transkripsi Tabel 8 (SF 54 kota) | **54/54 baris cocok persis** dengan PDF, termasuk kolom atap. Saya cek otomatis terhadap teks PDF. |
| Tabel A.5–A.12 (SCeff peneduh horizontal & vertikal) | **240/240 baris cocok** dengan PDF |
| Tabel 1, 2, 7 (α material, α cat, TDek) | Cocok dengan PDF |
| Tabel A.13–A.16 (egg-crate) | Belum saya cek otomatis; cek beberapa baris secara manual di `docs/sni_tables_check.md` |
| RTTV | Ada, terpisah dari OTTV, batas 10 / 35 W/m², SF atap dari kolom Roof Tabel 8 |
| Lembar "Hitungan Manual" di Excel | Ada, lengkap dengan rumus Pasal 4.2.2.1 dan total Pasal 4.2.2.3, tapi ada bug (catatan 1) |

**Catatan:**

1. **Bug di lembar Hitungan Manual: kolom SC tidak konsisten.** Contoh pada model IFC bawaan: baris Timur dan Barat menampilkan SCk 0,23 × SCeff 1 tapi kolom SC 0,5939. Saya hitung ulang dengan kalkulator: OTTV total 33,91 W/m² hanya tercapai kalau SC = 0,23. Jadi **perhitungannya benar, tapi angka yang ditampilkan salah.** Ini fatal untuk mahasiswa karena lembar ini justru untuk dicek pakai kalkulator. Kolom SC harus selalu sama dengan SCk × SCeff, dan setiap baris harus menghasilkan OTTVᵢ yang sama bila dihitung ulang dari kolom-kolomnya.
2. **Perubahan luas yang belum dijelaskan:** total luas selubung fasad\_unitized turun 26,4 m² (sisi Utara) dibanding Fase 2, tanpa CHANGELOG. Kemungkinan karena bidang miring/datar dipindah ke RTTV, tapi perlu ditulis di `docs/CHANGELOG-fase3.md`.
3. **Kolom `status: datasheet` pada material bermerek** berisi nama katalog, bukan tautan. Ini akan dibereskan oleh Fase 3b (material generik).
4. **Model IFC bawaan punya IfcShadingDevice, tapi SCeff semua arah = 1.** Bisa jadi peneduhnya memang tidak memenuhi kriteria geometri. Perlu dicek di Fase 3b dengan satu kasus nyata.

**Keputusan 21 Nov soal tabel SF:** tabel SF di template prodi dipakai sebagai default karena umum digunakan. Tabel 8 SNI 6389:2020 tetap tersedia sebagai pilihan. Sumber SF yang dipakai wajib tertulis jelas di hasil dan laporan, karena nilai kedua tabel berbeda.

```text
Perbaikan review Fase 3 (tempel di AWAL PROMPT FASE 3b):
- Perbaiki lembar 'Hitungan Manual' di report_exporter: kolom SC = SCk x SCeff persis untuk tiap baris; tambahkan kolom OTTV_i yang dihitung ulang dari kolom yang ditampilkan dan tes bahwa nilainya sama dengan ottv per orientasi dari engine (toleransi 0.01). Bila satu orientasi punya beberapa jenis kaca/peneduh, tulis satu baris per kombinasi, jangan rata-rata.
- Tulis docs/CHANGELOG-fase3.md, termasuk penjelasan penurunan total luas selubung 26,4 m2 pada fasad_unitized.
- Cek SCeff pada model archicad_bim_ifc (punya IfcShadingDevice): jelaskan di changelog mengapa SCeff = 1, atau perbaiki pengukuran rasio peneduh.
```

#### Errata tabel SCeff (Nov 21, 2026)

Laporan verifikasi (`docs/verifikasi_tabel_sni.md`) menemukan **34 sel salah cetak di PDF SNI** pada Tabel A.5–A.16, plus 5 sel yang jumlah digitnya salah. Kode Fase 3 menyalin PDF apa adanya, jadi salah cetak itu ikut terbawa. Contohnya Tabel A.9, R = 0,4, 30° tercetak 0,9325, padahal sel di atas dan bawahnya 0,87 dan 0,80. Seharusnya 0,8325, dan selisih ini mengubah beban surya sekitar 12% untuk kasus itu.

**Cek silang independen:** saya mendeteksi sendiri lonjakan nilai di tabel A.5–A.12 tanpa melihat laporan, dan menemukan 9 sel akar yang **semuanya juga tercantum di laporan** (A.8 R1,0/20° dan R0,6/30°; A.9 R0,3/20° dan R0,4/30°; A.10 R0,4/40° dan R0,4/50°; A.11 R1,7/0° dan R1,8/50°; A.12 R2,1/10°). Koreksi lain yang lebih halus didasarkan pada hitung ulang rumus di laporan, yang tidak saya ulang, tapi polanya masuk akal.

**Keputusan yang saya usulkan:** default memakai **nilai terkoreksi**, karena nilai tercetak yang salah jelas tidak fisik. Tapi setiap koreksi dicatat lengkap (nilai tercetak, nilai koreksi, alasan), dan lembar Hitungan Manual menuliskan catatan bila memakai sel yang dikoreksi. Opsi "ketat PDF" tetap tersedia untuk yang ingin hasil persis sama dengan tabel cetak. Salah cetak data matahari A.1–A.4 tidak perlu diterapkan karena program tidak menghitung ulang dari data mentah.

```text
Errata SCeff (tempel di akhir PROMPT FASE 3b):
- Baca docs/verifikasi_tabel_sni.md. Di backend/sni_tables.py tambahkan SNI_SCEFF_ERRATA: list {table, orientation_key, r1, r2(opsional), angle_deg, printed, corrected, reason} untuk 34 koreksi di Bagian 3, 4, dan 5 laporan, serta 5 perbaikan digit di Bagian 2. Biarkan tabel utama tetap berisi nilai tercetak PDF; terapkan errata saat lookup.
- Tambah settings.sceff_table_mode = 'terkoreksi' (default) | 'ketat_pdf'. lookup_sceff mengembalikan juga flag used_errata dan daftar sel yang dikoreksi.
- Lembar 'Hitungan Manual' dan response analyze mencantumkan catatan bila nilai SCeff berasal dari sel yang dikoreksi (nilai tercetak -> nilai koreksi, nomor tabel).
- Tes: (a) semua kolom tabel horizontal/vertikal setelah errata tidak punya lonjakan > 0,006 terhadap rata-rata tetangganya; (b) mode ketat_pdf mengembalikan nilai tercetak persis; (c) satu kasus overhang yang mengenai sel terkoreksi menghasilkan SCeff berbeda antara dua mode.
```

### Fase 3b — Tambahan dari keputusan 21 Nov (jalankan setelah Fase 3 selesai)

Tiga keputusan baru menyentuh pekerjaan Fase 3, jadi dikerjakan sebagai lanjutan di branch yang sama sebelum merge. Template prodi (`AEKBS_OTTV_fix.xlsx`) sudah disimpan di `docs/templates/template_prodi.xlsx` dan sudah saya bedah strukturnya.

**Struktur template prodi ("Building Envelope Compliance Form V2.0"):**

| Lembar | Isi | Yang diisi program |
| --- | --- | --- |
| `Mat` | Lembar input utama: nama proyek (H6), kota SF (D6, dropdown 18 pilihan), jumlah tipe dinding (C11), nama konstruksi dinding EW 1–EW 10 (B16:B25), tipe fenestrasi F1–F25 (C32:G56: nama, SHGC, U, peneduh yes/no, kode peneduh) dan detail peneduh luar (mulai baris 58) | Semua sel input ini |
| `UTARA` … `BARATLAUT` (8 lembar) | Tabel 6 "Identifikasi Fasad" baris 65–89 (maks. 25 segmen per arah): tinggi antar lantai (C), panjang (D), tipe dinding (F), kode fenestrasi (G), luas bukaan per lantai (H), jumlah lantai (I). Sisanya rumus: konduksi dinding, konduksi bukaan, radiasi bukaan. | Kolom C, D, F, G, H, I |
| `SUMMARY OTTV` | Rekap 8 arah, OTTV total (H20), WWR (H38), status COMPLY | Tidak diisi; dihitung rumus |
| `BO`, `BO. wallmaterial`, `ref.`, `ref. scef` | Pustaka dinding (U, α permukaan × α material, berat → TDek), tabel SF kota, tabel SCeff | Tidak diubah |

**Temuan penting dari template:**

1. **Nilai SF kota di template berbeda dengan SNI 6389:2020 Tabel 8.** Contoh Yogyakarta: template U 135, TL 148, T 151, TGR 116, S 95, BD 126, B 160, BL 151; Tabel 8 SNI 2020: U 152, TL 168, T 170, TGR 130, S 105, BD 139, B 178, BL 168. Jakarta juga berbeda. Baris "SNI" di template sama dengan tabel Jakarta versi lama (U 130 … B 243). Akibatnya angka OTTV dari template **tidak akan sama** dengan Mode SNI program, walaupun input geometrinya identik. **Perlu ditanyakan ke koordinator studio: nilai SF mana yang diminta.**
2. **SC dihitung dari SHGC:** SCk = SHGC / 0,86, lalu dikali SCeff dari tabel peneduh. Program perlu bisa menerima SHGC dan memakai konversi yang sama saat mengisi template.
3. **α dinding = α permukaan (warna) × α material**, dan bisa berbeda per arah. Program sekarang hanya punya satu α per material.
4. **Template memodelkan fasad sebagai segmen "tinggi × panjang × jumlah lantai"**, bukan per bidang 3D. Program harus merangkum bidang per arah menjadi segmen (lihat prompt).
5. **Template memakai dropdown (data validation) versi baru** yang **akan hilang kalau file disimpan ulang dengan openpyxl**. Template juga sudah membawa beberapa nama range yang rusak (`#REF!`), tapi itu bawaan file asli.

**Tiga pekerjaan Fase 3b:**

1. **Laporan Excel mengisi template prodi** (bukan format buatan sendiri), dengan cara yang tidak merusak dropdown.
2. **Pustaka material generik.** Material default diganti dengan nama generik dan nilai tipikal. Produk bermerek hanya boleh ada bila kolom `sumber` berisi tautan datasheet, dan ditampilkan sebagai "Contoh produk".
3. **PDF SNI keluar dari git** (`docs/*.pdf` ke `.gitignore`, `git rm --cached`). Riwayat git dibersihkan sebelum repo pertama kali dipublikasikan.

```text
PROMPT FASE 3b (setelah Fase 3, branch yang sama):
1) Template prodi ada di docs/templates/template_prodi.xlsx. JANGAN membuka-lalu-menyimpan dengan openpyxl karena data validation versi baru (x14) akan hilang. Buat backend/template_filler.py yang mengisi sel langsung di XML dalam zip .xlsx: ubah/isi elemen <c r="..."> pada sheet yang tepat (cari nama sheet lewat xl/workbook.xml dan rels), hapus nilai cache <v> pada sel rumus yang terdampak bila perlu, dan set <calcPr fullCalcOnLoad="1"/> agar Excel menghitung ulang saat dibuka. Pendekatan zip/XML ini harus bisa dipindah ke browser (JSZip) di Fase 5.
2) Peta sel di backend/report_template_map.py:
   - Mat!H6 nama proyek; Mat!D6 kota (harus salah satu nilai di 'ref.'!A5:A22; bila kota program tidak ada di daftar, pilih kota terdekat dan beri peringatan);
   - Mat!C11 jumlah tipe dinding; Mat!B16:B25 nama konstruksi dinding (harus cocok dengan daftar di lembar 'BO. wallmaterial'/BO; buat tabel padanan material program -> nama konstruksi template);
   - Mat!C32:G56 tipe fenestrasi: nama, SHGC, U, peneduh 'yes'/kosong, kode peneduh;
   - Untuk tiap lembar arah (UTARA, TIMURLAUT, TIMUR, TENGGARA, SELATAN, BARATDAYA, BARAT, BARATLAUT) baris 65-89: rangkum bidang-bidang program per kombinasi (tipe dinding, tipe fenestrasi, kelompok lantai) menjadi segmen: C = tinggi antar lantai rata-rata kelompok itu, I = jumlah lantai, D = luas fasad segmen / (C x I), H = luas kaca segmen / I. Maksimal 25 segmen per arah; bila lebih, gabungkan kelompok lantai yang berdekatan dan beri peringatan.
3) Tambahkan dukungan SHGC di katalog material (field shgc); bila hanya SC tersedia, SHGC = SC x 0.86 saat mengisi template.
4) Uji (dev saja): tests/test_report_template.py mengisi template untuk fixture fasad_unitized dan archicad_bim_curtainwall, lalu menghitung ulang memakai LibreOffice headless bila terpasang (lewati tes bila tidak ada). Bandingkan 'SUMMARY OTTV'!H20 dengan hasil program yang dijalankan memakai tabel SF yang sama dengan template ('ref.'!A5:J22). Toleransi 0.5 W/m2 (perbedaan karena penyederhanaan segmen). Pastikan jumlah data validation di file hasil sama dengan di template asli.
5) Tambahkan opsi settings.sf_source = 'sni2020' | 'template_prodi'. 'template_prodi' (DEFAULT, keputusan 21 Nov) memakai tabel di 'ref.'!A5:J22 agar hasil program sama dengan hasil template. 'sni2020' memakai Tabel 8 SNI 6389:2020 sebagai pilihan. Label sumber harus jujur: jangan menyebut 'Tabel 8 SNI 6389:2020' bila yang dipakai tabel template. Tampilkan sumber SF di hasil dan laporan.
6) materials_and_epw.py: ganti katalog default dengan material generik bernilai tipikal (alpha dari tabel absorptansi SNI). Material bermerek hanya dipertahankan bila field 'sumber' berisi URL datasheet; label 'Contoh produk'. Sediakan migrasi id material lama ke id generik terdekat.
7) Tambahkan 'docs/*.pdf' ke .gitignore, jalankan git rm --cached docs/SNI-6389-2020.pdf. JANGAN menjalankan git filter-repo; tulis instruksinya di docs/PUBLISH_CHECKLIST.md, termasuk catatan bahwa template prodi juga perlu izin sebelum ikut dipublikasikan.
Jalankan pytest dan compare_baseline.py. Commit.
```

### Review Fase 3b (Nov 21, 2026): hampir lulus, 2 hal wajib diperbaiki

Commit `2d03b43`. Di salinan repo saya: **35 tes lulus, 1 gagal.** Tes yang gagal adalah tes paling penting, yaitu rekalkulasi template prodi dengan LibreOffice. Di komputermu tes ini **dilewati diam-diam** karena LibreOffice tidak terpasang, jadi Antigravity mengira semuanya lulus.

| Dicek | Hasil |
| --- | --- |
| Template prodi terisi tanpa merusak dropdown | Ya |
| **Rekalkulasi template vs program** (fasad\_unitized, Jakarta, SF template) | Template 27,32 W/m², program 28,48 W/m², selisih 1,16 (batas tes 0,5) |
| Rincian per arah | **Konduksi dinding dan konduksi kaca cocok persis di keempat arah.** Artinya luas, WWR, U, α, dan TDek sudah terbaca dan terpetakan dengan benar. Selisih hanya di suku radiasi surya: Utara 21,16 vs 21,75; Timur 22,71 vs 24,96; Selatan 15,51 vs 15,74; Barat 28,65 vs 30,18 W/m². |
| Errata SCeff | 36 entri, mode `terkoreksi` / `ketat_pdf` ada |
| Katalog material | 25 material generik, semuanya `nilai_tipikal`, tidak ada merek tanpa sumber |
| PDF SNI keluar dari git | Ya (indeks); riwayat dibersihkan nanti sesuai `PUBLISH_CHECKLIST.md`, termasuk catatan izin template prodi |
| CHANGELOG-fase3 | Ada, menjelaskan 26,4 m² dan SCeff IFC (lihat catatan 2) |

**Catatan wajib:**

1. **Angka di aplikasi harus sama dengan angka di Excel template.** Mahasiswa akan melampirkan Excel; kalau aplikasi bilang 28,48 tapi Excel 27,32, dosen akan bingung. Penyebabnya: program menghitung SCeff dari tabel SNI (terkoreksi) dan rasio peneduh terukur, sedangkan template memakai kode peneduh (SE/SV) dan tabel SCeff miliknya sendiri. **Keputusan:** saat `sf_source = template_prodi`, program meniru metode template sepenuhnya: SF template, SCk = SHGC/0,86, SCeff dari tabel dan kode peneduh template yang sama dengan yang ditulis ke lembar `Mat`. Selisih program vs Excel maksimal 0,05 W/m².
2. **Skylight palsu 26,4 m².** Menurut CHANGELOG, 1.972 bidang "tutup atas" panel kaca (sisi tebal kaca yang menghadap ke atas) dipindah ke RTTV sebagai skylight. Itu salah: sisi tebal panel bukan skylight. Bidang kaca menghadap atas hanya boleh dianggap skylight bila sisi terpendeknya lebih dari tebal panel (misalnya > 0,3 m); sisanya masuk `filtered_items` dengan alasan "sisi tebal panel".
3. **Proses tes:** pasang LibreOffice di komputermu (gratis), atau ubah tes agar menulis peringatan besar "TES REKALKULASI DILEWATI" di ringkasan pytest, supaya hal seperti ini tidak lolos lagi.
4. Penjelasan SCeff = 1 pada model IFC bawaan masuk akal: file contoh itu berskema IFC2X3 padahal IfcShadingDevice baru ada di IFC4. Ganti file contoh itu dengan versi IFC4 di Fase 1c.

```text
PROMPT FASE 3c (perbaikan review 3b, branch fase-3-sni):
1) Mode template: bila settings.sf_source == 'template_prodi', engine menghitung suku radiasi persis seperti template: SF dari 'ref.'!A5:J22, SCk = SHGC/0.86, SCeff diambil dari tabel/kode peneduh template (lembar BO: scefn, scefs, scefe, scefw, scefne, scefnw, scefse, scefsw) memakai kode yang sama dengan yang ditulis report_template_map ke Mat!F32:G56. Simpan logika ini di backend/template_method.py.
2) tests/test_report_template.py: toleransi rekalkulasi LibreOffice diperketat menjadi 0.05 W/m2 untuk total DAN per orientasi (bandingkan juga suku konduksi dinding, konduksi kaca, radiasi per arah). Bila soffice tidak ada, tetap skip tapi cetak peringatan jelas lewat pytest warning 'TES REKALKULASI TEMPLATE DILEWATI'.
3) Bidang kaca menghadap atas (normal z > 0.5) hanya dihitung sebagai skylight RTTV bila dimensi terpendek bidang > 0.3 m; selain itu masuk filtered_items dengan reason 'sisi_tebal_panel'. Perbarui CHANGELOG-fase3.md bagian A.
4) Jalankan pytest (dengan LibreOffice terpasang) dan compare_baseline.py. Setelah lulus, merge fase-3-sni ke main.
```

### Review Fase 3c (Nov 21, 2026): lulus, Fase 3 selesai

Commit `e680352`, sudah di-merge ke `main` (`5f8ecf3`). Uji di salinan `main` **dengan LibreOffice terpasang**: `test_report_template.py` 6/6 lulus, tes lain 32/32 lulus.

| Dicek | Hasil |
| --- | --- |
| **Angka aplikasi = angka Excel template prodi** | Lulus dengan toleransi 0,05 W/m², total dan per arah. Ini validasi independen terkuat yang kita punya sejauh ini. |
| Skylight palsu | Hilang: RTTV skylight fasad\_unitized 0 m² |
| Perubahan angka baseline kecil (mis. HBJSON 10,40 → 10,25) | Terjelaskan di CHANGELOG-fase3: α spandrel default berubah 0,42 → 0,40 karena katalog generik |
| `corpus/` di `.gitignore` | Ya, ikut ter-commit di `main` |

**Catatan kecil, bawa ke Fase 1c:** default `EnvelopeParameters` masih `simulasi`, sedangkan default `ProjectConfig` (yang dipakai user) `sni`. Ubah `snapshot_baseline.py` / `compare_baseline.py` dan rapor model agar memakai `ProjectConfig()` default, supaya yang diuji sama dengan yang dipakai mahasiswa.

## Fase 1c — Uji Ragam Model (jalankan setelah Fase 3c di-merge, sebelum Fase 4)

Tujuannya: menjawab dengan data apakah program membaca beragam model dengan benar. Ini masalah utama yang kamu angkat sejak awal. Program ini tidak "dilatih"; model-model ini dipakai untuk **menguji**, jadi yang paling berharga adalah model yang **jawaban benarnya diketahui**.

**Keputusan sumber model (21 Nov):**

| Tingkat | Sumber | Jumlah | Masuk repo? | Yang diuji |
| --- | --- | --- | --- | --- |
| A. Sintetis | Dibuat script sendiri, jawaban dihitung analitis | 20 kasus × 4 format | Ya | Kebenaran angka (luas, WWR, OTTV) + kesamaan antarformat |
| B. BIM terbuka | [Schependomlaan](https://github.com/openBIMstandards/DataSetSchependomlaan) (ArchiCAD, izin akademik), [Duplex Apartment](https://www.wbdg.org/node/9165) (Revit → IFC 2x3), [buildingSMART Certification-datasets](https://github.com/buildingSMART/Certification-datasets) (pilih yang berupa bangunan), [BIMvoice ifcsamples](https://github.com/BIMvoice/ifcsamples) (IFC 4.3: tiga arketipe kantor), STEPtools AC20 (sudah ada) | 6–8 file | **Tidak** (folder lokal `corpus/`, unduh lewat script) | Tidak error, dimensi dan jumlah lantai masuk akal, peran terbaca |
| C. Dunia nyata | 5–10 model tugas studio milikmu sendiri + 3–5 bangunan dari 3D Warehouse | 8–15 file | **Tidak** | Dicek kamu: dimensi benar, kaca terbaca, peran masuk akal |

**Sumber yang dicoret dari daftar Antigravity:** NASA 3D, Smithsonian 3D, Thingiverse, MyMiniFactory, Sloyd (bukan bangunan); Sketchfab, Free3D, CGTrader, TurboSquid, 3DExport, Archive3D, Modelo, ModelsXI, 3dimage, 3dmodelunity (model visual: jendela sering hanya tekstur, lisensi umumnya melarang redistribusi); halaman rhino3d.com resources/download (bukan koleksi model).

**Catatan 3D Warehouse:** file aslinya .skp, yang tidak didukung program. Buka di SketchUp lalu ekspor ke .glb atau .obj. Ini sekaligus menguji jalur ekspor yang akan dipakai mahasiswa.

**20 kasus sintetis (tingkat A)** — tiap kasus punya `expected.json` yang dihitung dengan rumus, bukan dengan engine:

1. Kotak 4 sisi, WWR 40%, meter
2. Kasus 1 dalam milimeter
3. Kasus 1 dengan sumbu Y ke atas (OBJ/GLB)
4. Kasus 1 diputar 30°, plus uji sudut utara
5. Denah L
6. Courtyard (fasad dalam ikut terhitung)
7. Menara silinder 36 segmen (fasad lengkung)
8. Overhang 1 m di atas jendela (SCeff horizontal diketahui)
9. Sirip vertikal (SCeff vertikal diketahui)
10. Double-skin: kaca luar + dinding dalam
11. Blok Rhino bersarang, instance jauh dari titik asal blok
12. Brep Rhino tanpa render mesh (harus muncul peringatan `missing_mesh`)
13. Bangunan + pohon + bidang tanah (tidak boleh memengaruhi Z0 dan luas)
14. IFC4 dengan partisi interior `IsExternal=False`
15. Dinding solid tebal (hanya sisi luar yang terhitung)
16. Skylight di atap (RTTV)
17. Panel kaca bertebal 2 cm (sisi tebal harus disaring, bukan skylight)
18. Koordinat jauh dari titik nol (UTM)
19. Grup tanpa nama ("Layer 0", "Default") → peringatan unknown
20. Satu mesh berisi kaca + rangka dengan material berbeda (GLB)

**Alat "rapor model":** `tools/model_report.py` menjalankan semua file di `fixtures/synthetic/` dan `corpus/`, lalu menulis `docs/RAPOR_MODEL.md` + `.csv`. Isinya per file: format, satuan terdeteksi/terpakai, dimensi, jumlah grup per peran, persentase luas yang unknown, bidang disaring, permukaan tanpa mesh, luas per peran dan per arah, WWR, OTTV, peringatan, dan waktu proses. Untuk tingkat A ada kolom lulus/gagal terhadap `expected.json`. Untuk tingkat B dan C ada kolom kosong untuk catatan cek manual.

**Selesai kalau:**

- Tingkat A: 20/20 lulus (luas ± 0,5%, OTTV ± 0,1 W/m²), dan keempat format dari kasus yang sama memberi luas dalam selisih 0,5%.
- Tingkat B: tidak ada yang error, waktu proses < 60 detik per file, dan grup unknown < 20% luas atau sudah diberi peringatan.
- Tingkat C: kamu sudah mengisi kolom cek manual untuk semua file.
- **Setiap kesalahan baca yang ketemu di B atau C dijadikan kasus sintetis baru**, supaya tidak muncul lagi, termasuk di versi browser nanti.

```text
PROMPT FASE 1c:
Branch fase-1c-ragam-model dari main (setelah fase-3-sni di-merge).
1) tools/make_synthetic.py: buat 20 kasus sintetis sesuai daftar di dokumen rencana (bagian Fase 1c). Setiap kasus diekspor ke .3dm (rhino3dm; kasus 12 berupa Brep tanpa render mesh), .obj, .glb (trimesh), dan .ifc (ifcopenshell.api, skema IFC4: IfcWall dengan IfcOpeningElement + IfcWindow, IfcShadingDevice untuk kasus 8-9, IsExternal untuk kasus 14) bila format itu relevan untuk kasus tersebut. Simpan di fixtures/synthetic/<kasus>/ beserta expected.json berisi luas kaca dan dinding sisi luar per arah, WWR, dan OTTV mode sni + sf_source template_prodi yang DIHITUNG ANALITIS di script (jangan memanggil engine).
2) Ganti backend/samples/archicad_bim_curtainwall.ifc dengan versi IFC4 yang valid (IfcShadingDevice).
3) tools/fetch_corpus.py: unduh korpus tingkat B ke corpus/ (tambahkan corpus/ ke .gitignore): Schependomlaan (zip release), Duplex Apartment IFC (WBDG), beberapa file berupa bangunan dari buildingSMART Certification-datasets, tiga arketipe kantor IFC 4.3 dari BIMvoice/ifcsamples (cek SOURCE.md tiap file). Catat URL, lisensi, dan tanggal unduh di corpus/SOURCES.md.
4) Siapkan corpus/real/ (kosong, di-.gitignore) untuk model tingkat C yang akan diisi manual.
5) tools/model_report.py: jalankan engine pada fixtures/synthetic/ dan corpus/, tulis docs/RAPOR_MODEL.md dan docs/RAPOR_MODEL.csv dengan kolom sesuai dokumen rencana; untuk sintetis bandingkan dengan expected.json (luas +/-0,5%, OTTV +/-0,1 W/m2) dan cek kesamaan antarformat.
6) tests/test_synthetic.py: jalankan semua kasus sintetis sebagai tes pytest.
Jangan memperbaiki engine di fase ini kecuali untuk bug yang ditemukan tes sintetis; setiap perbaikan dicatat di docs/CHANGELOG-fase1c.md. Commit per langkah.
```

### Uji tingkat C pertama: model "Facade only to Alfian" (Nov 21, 2026)

Model fasad dari teman (ArchiCAD), diekspor ke tiga format. Saya jalankan dengan kode Fase 3b, pengaturan default (Mode SNI). Bentuknya menara 12,6 × 14,6 × 53,8 m dengan curtain wall di 4 sisi.

| Format | Waktu baca | Peran terbaca | WWR | OTTV | Status |
| --- | --- | --- | --- | --- | --- |
| .3dm | 9 s | kaca 2 grup, dinding (panel cat oranye) 1, rangka 1 | 86,7% | 38,23 | Sementara: 5.280 bidang rangka tanpa mesh |
| .obj | 1 s | sama dengan .3dm | 86,7% | 38,24 | Sementara: satuan ditebak mm, perlu konfirmasi (benar) |
| .ifc | 28 s | **panel cat oranye terbaca sebagai kaca** | **100%** | **43,52** | "Melebihi batas" (salah) |

**Yang sudah benar:** .3dm dan .obj memberi hasil hampir identik (selisih OTTV 0,01 W/m², luas per arah selisih < 0,2 m²), padahal jalur bacanya berbeda total. Ini bukti perbaikan Fase 1 bekerja pada model nyata. Peringatan mesh hilang dan satuan juga muncul dengan benar.

**Bug baru (B1):** di IFC, panel opak "Paint - Cadmium Orange" di dalam IfcCurtainWall diklasifikasikan sebagai kaca. Penyebabnya, nama gaya tidak dikenali lalu kata `ifcplate` dianggap "panel curtain wall = kaca". Akibatnya WWR jadi 100% dan OTTV naik 5,3 W/m². Aturan yang benar: transparansi material dari IFC dipakai sebagai sinyal utama. Plate dengan transparansi ≤ 0,12 dan tanpa kata kaca menjadi spandrel/dinding.

```text
Tambahan PROMPT FASE 1c (dari uji model teman):
- Perbaiki B1 di universal_pipeline._parse_ifc_with_ifcopenshell: untuk IfcPlate/IfcCurtainWall, bila transparansi material <= 0.12 dan nama gaya/material tidak mengandung kata kaca (glass/glaz/kaca/vision), kategorinya 'spandrel' (bila z-span elemen <= 1.35 m) atau 'wall', bukan 'glazing'. Kata 'ifcplate' saja tidak boleh menentukan kaca.
- Tambahkan kasus sintetis 21: IFC4 curtain wall berisi plate kaca transparan + plate opak bercat, harus menghasilkan WWR yang sama dengan versi .obj-nya.
- Masukkan 'Facade only to Alfian' (.3dm, .obj, .ifc) ke corpus/real/ sebagai kasus tingkat C pertama; kriteria: ketiga format memberi OTTV dalam selisih 0,1 W/m2 setelah B1 diperbaiki.
```

## Review Fase 1c (21 Nov 2026)

Saya memeriksa branch `fase-1c-ragam-model` (commit `2fc0ad8`) di salinan terpisah: menjalankan seluruh pytest, membaca `RAPOR_MODEL.md` dan `CHANGELOG-fase1c.md`, lalu menguji ulang beberapa model korpus. Tidak ada file di repo yang saya ubah.

**Yang sudah beres**

- 22 kasus sintetis (21 sesuai spesifikasi + kasus 22 sebagai regresi IfcCovering dan ID instans) dalam empat format, total 63 baris. Semuanya cocok dengan nilai analitis (luas ±0,5%, OTTV ±0,1 W/m²).
- Paritas antarformat 17/17.
- Model teman: .3dm, .obj, dan .ifc sama-sama OTTV 38,79 W/m², selisih 0,00. Angkanya naik dari 38,23 karena filter tepi tipis sekarang juga berlaku untuk dinding. Kenaikannya sama di ketiga format, jadi wajar.
- Korpus B: 8 model dari 4 sumber, lisensi tercatat di `corpus/SOURCES.md`, folder `corpus/` sudah di-.gitignore.
- Perbaikan B2–B7 masuk akal dan masing-masing dikunci kasus sintetis. Schependomlaan (62 MB) turun dari 130 s ke 30 s.

**Temuan yang harus diperbaiki sebelum Fase 4**

| # | Temuan | Bukti | Dampak |
| --- | --- | --- | --- |
| K1 (kritis) | Cache segitiga raycast `_RAYCAST_TRI_CACHE` (fungsi `_get_tri_raycast_accel`, baru di B7) memakai kunci `id(tris)` + jumlah segitiga. Setelah array lama dibuang, Python bisa memberi alamat memori yang sama ke array baru dengan jumlah segitiga sama, sehingga engine memakai geometri model sebelumnya. | Seluruh pytest dijalankan sekaligus: `04_kotak_putar30.obj` mendapat luas 640 m² (seharusnya 1.600, galat 60%). Dijalankan sendiri: lulus. Di salinan uji, kunci saya ganti dengan hash isi array dan hasilnya 119/119 lulus. | Di server yang terus hidup, mahasiswa yang mengunggah dua model berturut-turut bisa mendapat luas dan OTTV salah tanpa peringatan. RAPOR tidak menangkapnya karena urutan jalannya kebetulan aman. |
| K2 | Bila model tidak punya kaca sama sekali, engine diam-diam memakai `default_wall_wwr = 0.35` untuk semua dinding. | buildingSMART IFC4.3 (tanpa IfcWindow): kaca 17,25 m², WWR 35%, OTTV 20,55, `is_provisional = false`, tanpa peringatan. | Melanggar prinsip "tidak ada asumsi diam-diam": kaca fiktif masuk laporan. Ini perilaku lama yang baru terungkap lewat korpus. |
| K3 | `avg_sc_effective` per orientasi dibagi luas kaca, padahal pembilangnya dijumlah atas semua bidang. | Kasus 1 tampil 0,58 (seharusnya 0,233). Duplex tampil 1,74 (SC di atas 1 mustahil). | Tampil di tabel frontend (`main.js`) dan dipakai `report_exporter.py` untuk menurunkan pengali SCeff di Excel lama. Nilai OTTV-nya sendiri tidak terpengaruh. |
| K4 (kecil) | `report_exporter.py` (ekspor lama, bukan template prodi) masih berisi teks tertanam: baris "Crown / SkyGarden Laminated Low-E Glazing", panjang fasad = luas / 3,6, dan nilai cadangan `sc_glass × 0,65`. | Kode baris 255–400. | Laporan berisi teks proyek lain. Masuk Fase 6: perbaiki, atau hapus ekspor lama bila template prodi sudah jadi format utama. |
| K5 (kecil) | Untuk OBJ/GLB tanpa header satuan, `detected_unit` berisi "m" walau satuan yang diterapkan "mm". | `02_kotak_mm.obj`, `Facade only to Alfian.obj`. | Membingungkan di Kartu Konfirmasi. |

**Perlu dicek visual (belum tentu bug)**

- Duplex: luas selubung 891 m², padahal keliling bbox 71,7 m × tinggi ±7 m ≈ 500 m² (rasio 1,8). Mungkin ada dinding yang dua sisinya terhitung, atau bagian di bawah tanah (z −0,7 m) ikut masuk.
- Schependomlaan: 549 m² untuk bbox 24 × 24 × 15 m (rasio ±0,4). Ada 307 grup unknown (19%) yang tidak dihitung; statusnya sudah sementara.
- Dua model ini contoh kasus yang harus ditangkap Daftar Kejanggalan di Fase 4.

**Tambahan untuk Fase 4 (Daftar Kejanggalan)**

- Bila rasio luas selubung terhadap (keliling bbox × tinggi) di bawah 0,5 atau di atas 1,4, tampilkan kejanggalan "luas fasad tidak wajar".
- Bila tidak ada kaca terdeteksi, Kartu Konfirmasi bertanya: "Bangunan memang tanpa kaca (WWR 0)" atau "Isi WWR asumsi". Tombol Hitung tidak aktif sebelum dijawab.

**Untuk Alfian**

- Isi `corpus/real/` dengan modelmu sendiri (Fasad Curtain Wall Baru) dan 3–5 model studio, lalu isi kolom `cek_dimensi`, `cek_kaca`, `cek_peran` di RAPOR.
- Kirim prompt Fase 1d di bawah ke Antigravity sebelum mulai Fase 4.

```text
PROMPT FASE 1d (perbaikan hasil review Fase 1c):
Baca docs/RENCANA.md bagian "Review Fase 1c". Branch fase-1d-perbaikan dari fase-1c-ragam-model.
1) K1: di backend/ottv_engine.py, _get_tri_raycast_accel tidak boleh memakai id(tris) sebagai kunci cache. Pakai hash isi array (mis. hashlib.blake2b(tris.tobytes()) + shape), atau buang cache global dan simpan cache per panggilan analyze_building_ottv. Periksa juga _PARSED_FILE_CACHE dan analyze_building_ottv._rc_cache: kuncinya harus mencakup ukuran file dan semua masukan yang memengaruhi hasil. Tambahkan tes yang menjalankan 01_kotak_m, 04_kotak_putar30, lalu 01_kotak_m lagi dalam satu proses dan memastikan luas tiap hasil benar. Tambahkan pytest-randomly (atau jalankan seluruh pytest 3x dengan urutan acak) sebagai syarat lulus.
2) K2: bila tidak ada grup kaca, jangan pakai default_wall_wwr diam-diam. Default WWR = 0, tambahkan peringatan NO_GLAZING (is_provisional = true) yang menjelaskan model tidak punya kaca. default_wall_wwr hanya dipakai bila user mengisinya secara eksplisit di ProjectConfig, dan saat itu tetap muncul peringatan ASSUMED_WWR. Tambahkan kasus sintetis 23_tanpa_kaca (kotak dinding saja).
3) K3: avg_sc_effective per orientasi = rata-rata tertimbang luas kaca (jumlah SC x A_kaca / jumlah A_kaca), konsisten dengan summary.avg_sc_effective. Sesuaikan main.js dan report_exporter.py yang memakainya. Tambahkan assert di test_synthetic: 0 <= avg_sc_effective <= 1, dan sama dengan manual_calc.sc bila orientasi itu hanya punya satu kombinasi.
4) K5: untuk format tanpa header satuan, detected_unit = None (tampil "tidak ada di file") dan unit_source = bbox_guess.
5) Commit docs/FASE1C_SPEC.md dan docs/verifikasi_tabel_sni.docx yang belum masuk git. Jalankan ulang tools/model_report.py dan seluruh pytest dua kali berturut-turut; keduanya harus hijau. Catat semua perubahan di docs/CHANGELOG-fase1c.md bagian "Fase 1d".
K4 tidak dikerjakan di sini (masuk Fase 6). Commit per butir.
```

## Review Fase 1d (22 Nov 2026)

Branch `fase-1d-perbaikan` (commit `0cb70d3`) saya periksa di salinan terpisah. Hasilnya **lolos, siap di-merge ke `main`**.

- Seluruh pytest 126/126 hijau, dijalankan dua kali berturut-turut dalam satu sesi. Urutan tes acak lewat `tests/conftest.py`.
- K1: cache raycast sekarang memakai hash isi array (blake2b + shape + dtype), bukan `id(tris)`. Kasus 04 yang dulu meleset 60% sekarang stabil.
- K2: model tanpa kaca tidak lagi diberi WWR 35% diam-diam. buildingSMART IFC4.3 sekarang OTTV 3,72 W/m², status sementara, peringatan `NO_GLAZING`. Kasus sintetis 23 ditambahkan.
- K3: `avg_sc_effective` per arah sekarang 0,2326 untuk model teman dan Duplex (dulu 0,58 dan 1,74).
- K5: format tanpa header satuan memakai `detected_unit = None`.
- Model teman tetap OTTV 38,79 W/m².

## Fase 4 (revisi 22 Nov), pakai bagian ini

Tampilan, alur, dan fitur viewer sudah didiskusikan dan dibuatkan mockup. Semua detail ada di repo:

- `docs/FASE4_UI_SPEC.md`: spesifikasi lengkap (21 keputusan, arsitektur modul, perilaku tiap layar, viewer 3D, pintasan, kebutuhan backend, kriteria selesai per sub-fase).
- `docs/fase4/DESIGN.md` dan `docs/fase4/tokens.json`: design system LUXA (warna dua tema, kaca tiga tingkat, tipografi, motif kompas).
- `docs/fase4/mockup/index.html`: 9 mockup statis yang bisa dibuka langsung di browser.

Fase 4 dipecah empat. Kerjakan berurutan; tiap sub-fase saya review sebelum lanjut. Sebelum mulai, merge `fase-1d-perbaikan` ke `main`.

```text
PROMPT FASE 4a (kerangka dan alur):
Merge fase-1d-perbaikan ke main lebih dulu. Lalu buat branch fase-4a-kerangka dari main.
Baca seluruh docs/FASE4_UI_SPEC.md, docs/fase4/DESIGN.md, docs/fase4/tokens.json, dan buka docs/fase4/mockup/index.html. Spesifikasi menang bila berbeda dengan mockup.
Kerjakan baris '4a' di tabel bagian 10:
- theme.css dari tokens.json (kedua tema) + sakelar tema; kaca tiga tingkat dengan fallback tanpa backdrop-filter dan prefers-reduced-transparency.
- Pecah main.js dan stagingWorkspace.js menjadi modul sesuai bagian 2. engine.js satu-satunya tempat fetch('/api/').
- Shell: bar atas, indikator 4 langkah, rel ikon + label (Model, Material, Lokasi, Tampilan, Bandingkan, Laporan, Bantuan), kartu fitur (satu terbuka, Escape menutup).
- Layar Unggah, Konfirmasi, Inspeksi, Hasil versi dasar, Memuat/galat sesuai bagian 3 dan mockup 1-5. Viewer di 4a cukup mode Klasifikasi dan Heatmap per arah, proyeksi perspektif.
- Backend: build_sanity_flags sesuai bagian 7 butir 1, dikembalikan POST /inspect. Tombol Hitung terkunci sampai Kartu Konfirmasi hijau.
- Simpan/buka .ottv.json dan simpan otomatis localStorage (try/catch). Konfigurasi ke server hanya saat Hitung.
- Hapus semua yang tercantum di bagian 2 'Hapus'.
Kriteria selesai: lihat tabel bagian 10 baris 4a. pytest dan npm run build hijau. Catat di docs/CHANGELOG-fase4.md. Commit per layar.
```

**Tambahan 22 Nov: identitas LUXA.** Nama produk sekarang **LUXA by Alf Studio** dengan logo milik Alfian (digambar ulang sebagai SVG di `docs/fase4/brand/`). Warna aksen `sun` jadi amber dan `ok` jadi toska, keduanya diturunkan dari logo. Spesifikasi, design system, token, dan mockup di repo sudah diperbarui. Kalau Fase 4a sudah berjalan, kirim tambahan ini ke Antigravity:

```text
TAMBAHAN FASE 4a (identitas LUXA):
Nama produk berganti dari OTTVista ke LUXA (by Alf Studio). Baca ulang docs/FASE4_UI_SPEC.md bagian 1 (D1) dan bagian baru 2a, lalu docs/fase4/DESIGN.md bagian Logo dan Warna.
- Salin docs/fase4/brand/*.svg ke frontend/public/brand/, pasang favicon.svg.
- Bar atas sesuai logo: luxa-mark (versi -dark di tema gelap) + 'LUXA' (Montserrat 700) + 'by Alf Studio' (Montserrat 400) di bawahnya. Tanpa keterangan tambahan. Judul tab 'LUXA · <langkah>'.
- Ambil ulang token dari docs/fase4/tokens.json: sun, ok, data-shading, glow-warm, glow-cool berubah; brand-* baru, hanya untuk logo.
- Ganti semua teks 'OTTVista' di UI dan dokumen menjadi 'LUXA'. Jangan ubah nama repo atau paket npm.
Commit terpisah: 'fase-4a: identitas LUXA'.
```

```text
PROMPT FASE 4b-1 (kamera dan view):
Branch fase-4b1-kamera dari main setelah 4a di-merge. Baca ulang docs/FASE4_UI_SPEC.md bagian 4.1, 4.7, 4.8, 5, 6 dan mockup 4, 6, 7.
Kerjakan baris '4b-1' tabel bagian 10: 4 proyeksi (termasuk perspektif 2 titik dengan garis vertikal tegak), tampak 8 arah + Atas, pie menu tahan V, pil bawah kiri dan kanan, view tersimpan (tambah, ganti nama, hapus, ikut .ottv.json), capture PNG 1x/2x/4x dengan cap, gizmo sumbu, semua pintasan bagian 6, palet Ctrl K, daftar pintasan '?', panel Tampilan bagian Kamera.
Pintasan tidak aktif saat fokus di input. Semua bisa dipakai dengan keyboard.
Catat di docs/CHANGELOG-fase4.md. Commit per fitur.
```

```text
PROMPT FASE 4b-2 (analisis di viewer):
Branch fase-4b2-analisis dari main setelah 4b-1 di-merge. Baca docs/FASE4_UI_SPEC.md bagian 4.2 sampai 4.6, 7 butir 2-4, dan mockup 3, 4, 6.
Kerjakan baris '4b-2' tabel bagian 10: seleksi panel (klik, Shift+klik, klik area kosong melepas), label nilai HTML kaca di titik klik, kartu Bidang terpilih, sakelar Heatmap per arah / per panel, mode Orientasi, Kejanggalan, X-ray, kubah matahari dengan skala 50-200% dan Pas ke model, kompas utara yang bisa diputar + chip Hitung ulang, filter paparan matahari + endpoint GET /api/analyses/{id}/exposure + animasi satu hari, pil rumus yang bisa digeser dan dibuka.
Uji dengan corpus/real/Facade only to Alfian.3dm: panel kaca Barat 56,44 W/m2 kontribusi, porsi panas kaca Barat sekitar 32%, filter 23 Sep 13.00 menyalakan Barat dan tidak menyalakan Selatan.
Catat di docs/CHANGELOG-fase4.md. Commit per fitur.
```

```text
PROMPT FASE 4c (bandingkan, workspace, poles):
Branch fase-4c-poles dari main setelah 4b-2 di-merge. Baca docs/FASE4_UI_SPEC.md bagian 3.6, 5, 8, 9 dan mockup 8.
Kerjakan baris '4c' tabel bagian 10: mode Bandingkan (viewer terbelah, pembatas bisa digeser mouse dan keyboard, selisih per arah, daftar alternatif, Pakai alternatif dengan riwayat), workspace v1 (Belajar, Lanjut, Presentasi; urutkan ulang dan sembunyikan item dock), panel Material, Lokasi, Laporan, Bantuan, tooltip istilah dengan rujukan pasal, pemeriksaan aksesibilitas bagian 9, responsif 1440/1280/768 px.
Uji: alternatif kaca elektrokromik (glz_kaca_elektrokromik) untuk model teman harus 27,71 W/m2.
Siapkan docs/UJI_PENGGUNA_FASE4.md berisi skenario uji 3 mahasiswa dengan fasad_unitized_24lantai.3dm dan kolom catatan.
Catat di docs/CHANGELOG-fase4.md. Commit per fitur.
```

## Fase 4 — Rombak UX menjadi 4 langkah, mahasiswa dulu

**Catatan 22 Nov:** bagian Fase 4 di bawah ini adalah rencana awal. Untuk tampilan, alur, dan viewer, yang berlaku adalah "Fase 4 (revisi 22 Nov)" di atas dan `docs/FASE4_UI_SPEC.md`. Jangan kirim PROMPT FASE 4 lama di bawah ke Antigravity.

Tujuannya: mahasiswa yang belum pernah memakai tool ini bisa mengunggah model, memeriksanya, dan mendapat angka OTTV yang bisa dijelaskan, dalam waktu kurang dari 10 menit dan tanpa membaca istilah teknis.

**Kerangka layar.** Satu halaman dengan stepper di atas (1 Unggah · 2 Periksa · 3 Atur · 4 Hasil). Viewport 3D selalu di kiri, kira-kira 60% lebar. Panel kanan berisi isi langkah aktif. Tombol "Lanjutan" membuka laci dari kanan.

| Langkah | Isi panel kanan | Yang dihapus / dipindah |
| --- | --- | --- |
| 1. Unggah | Area drag-and-drop untuk semua format. Kartu "Coba dengan contoh" berisi 3 model contoh. Setelah unggah: kartu ringkas "Terdeteksi: Rhino .3dm · meter · Z ke atas · tinggi 86 m" dengan tombol "Ubah". Panduan ekspor per software ditampilkan **hanya** kalau ada masalah (misalnya Brep tanpa mesh). | Form 7 field + pilihan 5 software; bar "Arsitektur Universal 5-Tahap" |
| 2. Periksa model | Kartu kesehatan model: satuan, dimensi, jumlah elemen per peran, luas sisi luar kaca/dinding, WWR. Daftar grup dengan warna peran yang sama di 3D, dropdown peran, dan badge "Perlu dicek" untuk `unknown`. Klik grup = sorot di 3D, dan sebaliknya. Daftar "Elemen disaring" (alasan + tombol "Kembalikan"). Tombol utama: "Model sudah benar → Atur". | Auto-split, ambang rangka/spandrel, override per bidang, pita Z → "Perbaiki peran (lanjutan)" |
| 3. Atur | Pilih kota (54 lokasi Tabel 8), orientasi utara dengan kompas yang bisa diputar, material per peran (kaca, dinding/spandrel, rangka) dengan nilai U/SC/α tampil kecil di bawah nama, dan lantai (otomatis, bisa diubah). Saklar "Mode SNI / Simulasi" dengan penjelasan satu kalimat. | Slider global, override per orientasi, louver parametrik, kubah matahari → Lanjutan/Simulasi |
| 4. Hasil | Angka besar OTTV + status lulus/tidak (batas 35 W/m²). Tabel 8 orientasi. Heatmap 3D (3 mode: OTTV per elemen, peran, orientasi). Kartu "Komponen kalor" dengan rumus. Kartu "Apa yang paling berpengaruh?" (misalnya "Fasad Barat menyumbang 31% beban surya; coba kaca SC lebih rendah"). Tombol Unduh Excel/PDF. | 4 mode heatmap lain, HUD kompas, tabel bidang 6.000 baris (pindah ke Lanjutan sebagai "Data per bidang") |

**Alur upload → konfirmasi → inspeksi → hitung (keputusan 21 Nov).** Tidak ada form sebelum upload. Program menebak dulu dari file, lalu user mengonfirmasi. Pertanyaan hanya diajukan untuk hal yang tidak bisa dibaca dari file.

1. **Upload**: tarik file, tanpa isian apa pun.
2. **Kartu Konfirmasi** (awal langkah Periksa), terisi otomatis: software pembuat (dari header file), format dan skema, satuan, sumbu vertikal, dimensi bangunan, jumlah lantai, dan sisi yang berkaca. Setiap baris punya tombol "Benar" / "Ubah". Hanya dua pertanyaan baru untuk user:
   - Isi model: fasad saja / gedung lengkap / gedung + tapak.
   - Tinggi bangunan atau jumlah lantai kira-kira (opsional). Bila berbeda > 20% dari hasil baca, tampilkan peringatan kemungkinan salah satuan.
3. **Inspeksi 3D + Daftar Kejanggalan otomatis.** Contoh aturan:
   - Grup berperan kaca, tapi materialnya tidak transparan atau bernama cat/beton/bata.
   - WWR satu sisi > 95% atau sisi tanpa kaca sama sekali padahal sisi lain berkaca.
   - Dimensi bangunan < 2 m atau > 400 m (indikasi salah satuan).
   - Jumlah lantai terbaca berbeda dengan jawaban user.
   - Grup `unknown`, permukaan tanpa mesh (`missing_mesh`), dan bidang disaring dengan luas besar.
   - Setiap kejanggalan punya tombol "Perbaiki" (ubah peran, kembalikan bidang, ubah satuan) atau "Terima apa adanya".
4. **Hitung OTTV**: tombol aktif hanya bila semua kejanggalan sudah diperbaiki atau diterima. Kejanggalan yang diterima tanpa perbaikan membuat hasil berlabel "HASIL SEMENTARA" dan tercantum di laporan.

**Fitur khusus mahasiswa:**

- **Panel "Kenapa angkanya segini?"** di langkah Hasil. Klik satu orientasi untuk melihat rumus OTTV dengan angka yang disubstitusikan, sama seperti lembar Hitungan Manual di laporan.
- **Tooltip "Apa ini?"** pada setiap istilah (WWR, SC, TDek, SF, Uf) dengan satu kalimat penjelasan dan rujukan pasal SNI.
- **Bandingkan dua desain:** simpan hasil sebagai "Varian A", ubah material, lalu tampilkan selisihnya. Ini mendukung tugas studio yang meminta perbandingan alternatif.
- **3 model contoh** yang sudah bersih (kotak sederhana, curtain wall tower, rumah 2 lantai) beserta penjelasan singkat. Sisa 17 preset benchmark pindah ke Lanjutan.

**Hapus dari frontend:** (rhino3dm.js tetap dipertahankan untuk mode browser di Fase 5) `inspect3dmFileClientSide`, bar 5 tahap, label versi ganda, tombol Excel kedua. Semua `innerHTML` yang memuat teks dari file harus lewat fungsi `escapeHtml` (mendukung P5 di Fase 5).

**Selesai kalau:** uji dengan 3 teman mahasiswa memakai `fasad_unitized_24lantai.3dm`. Masing-masing bisa sampai ke angka OTTV dan menjelaskan satu komponen kalor tanpa bantuan. Catat di mana mereka bingung.

```text
PROMPT FASE 4:
Branch fase-4-ux. Bangun ulang frontend sesuai tabel 'Fase 4' di dokumen rencana, memakai API Fase 2 dan mode SNI Fase 3.
- Struktur: stepper 4 langkah (Unggah, Periksa, Atur, Hasil); viewport Three.js tetap di kiri; panel kanan per langkah; laci 'Lanjutan' di kanan.
- Pecah src/main.js dan src/stagingWorkspace.js menjadi modul: viewport.js, steps/upload.js, steps/inspect.js, steps/settings.js, steps/results.js, advanced.js, engine.js, state.js (satu objek ProjectConfig sebagai satu-satunya state).
- engine.js = satu antarmuka untuk semua perhitungan: engine.upload(file), engine.inspect(config), engine.analyze(config), engine.export(analysis, fmt). Implementasi sekarang memanggil API backend; di Fase 5 implementasi ini diganti versi browser (Pyodide) tanpa mengubah layar mana pun. Tidak boleh ada fetch('/api/...') di luar engine.js.
- Hapus: inspect3dmFileClientSide (rhino3dm.js/wasm TETAP dipertahankan untuk Fase 5), bar 5 tahap, form 5 software, slider global, 4 mode heatmap tambahan, tombol Excel kedua.
- Tambah: kartu kesehatan model, daftar 'Elemen disaring' dengan Kembalikan, badge 'Perlu dicek' untuk peran unknown, pemilih 54 kota, saklar Mode SNI/Simulasi, panel 'Kenapa angkanya segini?' (substitusi rumus per orientasi), tooltip istilah dengan rujukan pasal, fitur bandingkan Varian A/B, 3 model contoh, catatan di langkah Periksa bahwa OTTV berlaku untuk selubung ruang ber-AC sehingga grup/lantai non-AC sebaiknya dinonaktifkan.
- Semua teks UI berbahasa Indonesia awam. Semua penyisipan teks dari file/model lewat escapeHtml() atau textContent.
- Responsif minimal di 1280 px dan 768 px.
- Alur keputusan 21 Nov (lihat paragraf 'Alur upload -> konfirmasi -> inspeksi -> hitung'): tanpa form sebelum upload; Kartu Konfirmasi terisi otomatis dari detect_file_signature + audit Stage 1 (software, format/skema, satuan, sumbu, dimensi, jumlah lantai, sisi berkaca) dengan tombol Benar/Ubah; dua pertanyaan user (isi model; tinggi/jumlah lantai kira-kira).
- Backend: tambahkan build_sanity_flags(groups, audit, analysis_preview, user_answers) di adapters/__init__.py yang mengembalikan daftar kejanggalan {code, severity, message, group, fix_action} sesuai aturan di dokumen; dikembalikan oleh POST /inspect. Ikutkan flag 'kaca dengan material opak' (dari transparansi material/nama cat-beton-bata) dan 'WWR sisi > 95%'.
- Tombol Hitung aktif hanya bila semua flag berstatus diperbaiki atau diterima; flag yang diterima masuk summary.warnings dan membuat is_provisional=true.
- Tes: model 'Facade only to Alfian.ifc' (corpus/real) sebelum perbaikan B1 harus memunculkan flag 'kaca dengan material opak' pada grup Paint - Cadmium Orange.
Commit per langkah layar.
```

## Fase 5 — Publish sebagai aplikasi browser (direvisi 21 Nov)

Keputusan: perhitungan berjalan di komputer pengguna, tanpa server. Model tidak pernah diunggah ke mana pun, tidak ada biaya server, dan situsnya cukup di-hosting statis (misalnya GitHub Pages, Netlify, atau Cloudflare Pages). Akibatnya penghambat P1–P4 dan P7 (sesi, folder bersama, RAM server, antrean job, CORS) **hilang dengan sendirinya**. Gantinya ada tantangan baru: ukuran unduhan, kecepatan di laptop mahasiswa, dan kompatibilitas library.

**Kelayakan teknis (perlu dibuktikan dulu):**

| Komponen | Di browser | Risiko |
| --- | --- | --- |
| Mesin Python (numpy, ladybug-geometry, trimesh, kode OTTV) | Jalan di Pyodide (Python versi WebAssembly) di dalam Web Worker | Raycast numpy lebih lambat dibanding Python biasa |
| Pembaca .3dm | rhino3dm Python tidak punya versi Pyodide. Pakai **rhino3dm.js** (sudah ada di frontend) untuk membaca file, lalu kirim mesh ke Python. | Logika loader .3dm harus ditulis ulang di JS atau dijembatani |
| Pembaca IFC | IfcOpenShell punya wheel WebAssembly untuk Pyodide, tapi masih berat dan pengembangnya sendiri mencatat ada model yang gagal dimuat | Ukuran unduhan besar; perlu jalur cadangan (misalnya web-ifc) atau pesan jelas |
| OBJ/GLB/STL/HBJSON | trimesh dan ladybug-geometry murni Python, bisa jalan di Pyodide | Rendah |
| Laporan Excel/PDF | openpyxl murni Python; PDF bisa dibuat di browser (misalnya pdf-lib/jsPDF) | Rendah–sedang |

**Langkah:**

1. **Uji kelayakan dulu (spike, 1 sesi):** jalankan pipeline Fase 1–3 di Pyodide pada 5 fixture. Ukur waktu muat awal, waktu analisis, dan memori di laptop biasa. Target: muat awal < 30 detik (lalu di-cache browser), analisis fasad\_unitized < 60 detik. Kalau tidak tercapai, kita diskusikan ulang (misalnya mode hibrid: browser untuk model kecil, server untuk model besar).
2. **Implementasi `engine.js` versi browser** (antarmukanya sudah dibuat di Fase 4): Pyodide di Web Worker, rhino3dm.js untuk .3dm, wheel IfcOpenShell WASM untuk IFC, progres per tahap ditampilkan ke UI.
3. **Penyimpanan lokal:** proyek dan konfigurasi disimpan di IndexedDB browser, dengan tombol "Unduh proyek (.ottv.json)" dan "Buka proyek" supaya mahasiswa bisa memindahkan pekerjaan antar komputer.
4. **Keamanan yang tetap perlu:** `escapeHtml`/`textContent` untuk teks dari file (P5), header Content-Security-Policy, batas ukuran file sesuai memori perangkat dengan pesan yang jelas.
5. **Build & hosting:** build statis Vite, aset Pyodide dan wheel di-cache (service worker), deploy ke hosting statis. Backend FastAPI tetap disimpan untuk pengembangan dan pengujian, bukan untuk pengguna.
6. **P6, P8:** hapus path Windows yang tersisa; judul laporan sudah diganti di Fase 3; tambahkan disclaimer "Alat bantu akademik, hasil perlu diverifikasi".
7. **Checklist publish** (`docs/PUBLISH_CHECKLIST.md`): PDF SNI sudah keluar dari riwayat git, tidak ada material bermerek tanpa sumber, lisensi diputuskan (open source atau tidak).

**Selesai kalau:** situs statis bisa dibuka dari laptop lain tanpa server Python, model fasad\_unitized bisa dianalisis sepenuhnya di browser dengan hasil sama dengan versi backend (selisih ≤ 0,01 W/m²), dan tab Network di DevTools menunjukkan file model tidak pernah dikirim ke mana pun.

```text
PROMPT FASE 5a (SPIKE, jangan ubah UI):
Branch fase-5a-spike. Buat folder spike-pyodide/ berisi halaman HTML sederhana + Web Worker yang memuat Pyodide, memasang numpy, ladybug-geometry, trimesh, dan wheel IfcOpenShell WASM, lalu menjalankan load_universal_model_stages_1_and_2 + analyze_building_ottv dari backend/ untuk 5 fixture. Untuk .3dm: baca dengan rhino3dm.js di JS, kirim vertices/faces + nama layer/material per objek ke Python sebagai pengganti loader rhino3dm Python. Catat di docs/SPIKE_PYODIDE.md: ukuran unduhan, waktu muat awal, waktu analisis per fixture, memori puncak, dan selisih OTTV vs backend. Jangan optimasi dulu; tujuan hanya mengukur.

PROMPT FASE 5b (setelah spike disetujui):
Branch fase-5b-browser. Implementasikan engine.js versi browser memakai hasil spike: Pyodide di Web Worker, rhino3dm.js untuk .3dm, IfcOpenShell WASM untuk IFC, progres per tahap, penyimpanan proyek di IndexedDB + unduh/buka .ottv.json, ekspor Excel via openpyxl di Pyodide. Tambah service worker untuk cache aset. Pastikan tidak ada request jaringan yang membawa file model. Build statis siap deploy ke GitHub Pages/Netlify. Tes: hasil OTTV browser vs backend untuk 5 fixture, selisih <= 0.01 W/m2.
```

## Fase 6 — Bersih-bersih dan tes

Tujuannya: kode yang tersisa hanya kode yang dipakai, dan setiap angka penting dijaga oleh tes.

- [ ] Hapus kode mati di `ottv_engine.py`: `load_raw_groups_from_file`, `_classify_layer_or_name`, `RawGroupMesh` dan `tessellate_nurbs_surface_with_ladybug` duplikat (impor dari `universal_pipeline`).
- [ ] Hapus `create_sample_*_preset` yang membuat file contoh saat startup; ganti dengan 3 model contoh statis di `samples/`.
- [ ] Hapus `test_ottv_engine.py` lama (usang, gagal, hanya mengecek ≤ 35). Ganti dengan suite pytest: `test_classify.py`, `test_geometry_fidelity.py` (luas dan bbox fixture sesuai baseline yang sudah dijelaskan), `test_sni_manual.py`, `test_api.py`, `test_sessions.py`.
- [ ] Satukan nomor versi di satu tempat (`backend/version.py`) dan tampilkan dari sana.
- [ ] Pecah `universal_pipeline.py` (2.400 baris) per format: `loaders/rhino.py`, `loaders/ifc.py`, `loaders/mesh.py` (OBJ/GLB/STL/PLY), `loaders/hbjson.py`, `normalize.py`, `classify.py`.
- [ ] Tulis `README.md` untuk mahasiswa: cara menjalankan lokal, cara menyiapkan model dari Rhino/ArchiCAD/Revit/SketchUp, dan cara membaca hasil.
- [ ] Tambahkan CI sederhana (GitHub Actions) yang menjalankan pytest pada setiap push.

**Selesai kalau:** `pytest` hijau, tidak ada fungsi yang tidak dipanggil (cek dengan `vulture`), dan README bisa diikuti dari nol oleh orang lain.

```text
PROMPT FASE 6:
Branch fase-6-cleanup. Kerjakan checklist Fase 6 di dokumen rencana: hapus kode mati (pastikan dengan vulture), pecah universal_pipeline.py per format ke backend/loaders/ tanpa mengubah perilaku (compare_baseline.py harus 0 selisih terhadap baseline terakhir), ganti test lama dengan suite pytest, satukan versi di backend/version.py, tulis README.md berbahasa Indonesia untuk mahasiswa, tambah workflow GitHub Actions untuk pytest. Commit per butir.
```
