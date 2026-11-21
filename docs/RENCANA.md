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
- [ ] Buat `docs/` dan simpan PDF SNI 6389:2020 di `docs/SNI-6389-2020.pdf`. Buat juga `docs/AUDIT.md` berisi salinan tab Audit.
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

## Fase 4 — Rombak UX menjadi 4 langkah, mahasiswa dulu

Tujuannya: mahasiswa yang belum pernah memakai tool ini bisa mengunggah model, memeriksanya, dan mendapat angka OTTV yang bisa dijelaskan, dalam waktu kurang dari 10 menit dan tanpa membaca istilah teknis.

**Kerangka layar.** Satu halaman dengan stepper di atas (1 Unggah · 2 Periksa · 3 Atur · 4 Hasil). Viewport 3D selalu di kiri, kira-kira 60% lebar. Panel kanan berisi isi langkah aktif. Tombol "Lanjutan" membuka laci dari kanan.

| Langkah | Isi panel kanan | Yang dihapus / dipindah |
| --- | --- | --- |
| 1. Unggah | Area drag-and-drop untuk semua format. Kartu "Coba dengan contoh" berisi 3 model contoh. Setelah unggah: kartu ringkas "Terdeteksi: Rhino .3dm · meter · Z ke atas · tinggi 86 m" dengan tombol "Ubah". Panduan ekspor per software ditampilkan **hanya** kalau ada masalah (misalnya Brep tanpa mesh). | Form 7 field + pilihan 5 software; bar "Arsitektur Universal 5-Tahap" |
| 2. Periksa model | Kartu kesehatan model: satuan, dimensi, jumlah elemen per peran, luas sisi luar kaca/dinding, WWR. Daftar grup dengan warna peran yang sama di 3D, dropdown peran, dan badge "Perlu dicek" untuk `unknown`. Klik grup = sorot di 3D, dan sebaliknya. Daftar "Elemen disaring" (alasan + tombol "Kembalikan"). Tombol utama: "Model sudah benar → Atur". | Auto-split, ambang rangka/spandrel, override per bidang, pita Z → "Perbaiki peran (lanjutan)" |
| 3. Atur | Pilih kota (54 lokasi Tabel 8), orientasi utara dengan kompas yang bisa diputar, material per peran (kaca, dinding/spandrel, rangka) dengan nilai U/SC/α tampil kecil di bawah nama, dan lantai (otomatis, bisa diubah). Saklar "Mode SNI / Simulasi" dengan penjelasan satu kalimat. | Slider global, override per orientasi, louver parametrik, kubah matahari → Lanjutan/Simulasi |
| 4. Hasil | Angka besar OTTV + status lulus/tidak (batas 35 W/m²). Tabel 8 orientasi. Heatmap 3D (3 mode: OTTV per elemen, peran, orientasi). Kartu "Komponen kalor" dengan rumus. Kartu "Apa yang paling berpengaruh?" (misalnya "Fasad Barat menyumbang 31% beban surya; coba kaca SC lebih rendah"). Tombol Unduh Excel/PDF. | 4 mode heatmap lain, HUD kompas, tabel bidang 6.000 baris (pindah ke Lanjutan sebagai "Data per bidang") |

**Fitur khusus mahasiswa:**

- **Panel "Kenapa angkanya segini?"** di langkah Hasil. Klik satu orientasi untuk melihat rumus OTTV dengan angka yang disubstitusikan, sama seperti lembar Hitungan Manual di laporan.
- **Tooltip "Apa ini?"** pada setiap istilah (WWR, SC, TDek, SF, Uf) dengan satu kalimat penjelasan dan rujukan pasal SNI.
- **Bandingkan dua desain:** simpan hasil sebagai "Varian A", ubah material, lalu tampilkan selisihnya. Ini mendukung tugas studio yang meminta perbandingan alternatif.
- **3 model contoh** yang sudah bersih (kotak sederhana, curtain wall tower, rumah 2 lantai) beserta penjelasan singkat. Sisa 17 preset benchmark pindah ke Lanjutan.

**Hapus dari frontend:** rhino3dm.js/wasm (2,6 MB), `inspect3dmFileClientSide`, bar 5 tahap, label versi ganda, tombol Excel kedua. Semua `innerHTML` yang memuat teks dari file harus lewat fungsi `escapeHtml` (mendukung P5 di Fase 5).

**Selesai kalau:** uji dengan 3 teman mahasiswa memakai `fasad_unitized_24lantai.3dm`. Masing-masing bisa sampai ke angka OTTV dan menjelaskan satu komponen kalor tanpa bantuan. Catat di mana mereka bingung.

```text
PROMPT FASE 4:
Branch fase-4-ux. Bangun ulang frontend sesuai tabel 'Fase 4' di dokumen rencana, memakai API Fase 2 dan mode SNI Fase 3.
- Struktur: stepper 4 langkah (Unggah, Periksa, Atur, Hasil); viewport Three.js tetap di kiri; panel kanan per langkah; laci 'Lanjutan' di kanan.
- Pecah src/main.js dan src/stagingWorkspace.js menjadi modul: viewport.js, steps/upload.js, steps/inspect.js, steps/settings.js, steps/results.js, advanced.js, api.js, state.js (satu objek ProjectConfig sebagai satu-satunya state).
- Hapus: rhino3dm.js/wasm dari public/ dan dist/, inspect3dmFileClientSide, bar 5 tahap, form 5 software, slider global, 4 mode heatmap tambahan, tombol Excel kedua.
- Tambah: kartu kesehatan model, daftar 'Elemen disaring' dengan Kembalikan, badge 'Perlu dicek' untuk peran unknown, pemilih 54 kota, saklar Mode SNI/Simulasi, panel 'Kenapa angkanya segini?' (substitusi rumus per orientasi), tooltip istilah dengan rujukan pasal, fitur bandingkan Varian A/B, 3 model contoh.
- Semua teks UI berbahasa Indonesia awam. Semua penyisipan teks dari file/model lewat escapeHtml() atau textContent.
- Responsif minimal di 1280 px dan 768 px.
Commit per langkah layar.
```

## Fase 5 — Siap publish (P1–P8)

Tujuannya: banyak orang bisa memakai program bersamaan tanpa saling melihat data, dan server tidak tumbang karena satu file besar. Soal login belum diputuskan, jadi versi pertama memakai sesi anonim; desainnya disiapkan agar akun bisa ditambah nanti.

| Kode | Perubahan |
| --- | --- |
| P1, P2 | Sesi anonim: cookie `session_id` acak (HttpOnly, SameSite=Lax). Semua model, config, EPW, dan hasil disimpan di `storage/{session_id}/`. Katalog hanya menampilkan contoh + model milik sesi itu. DELETE hanya untuk milik sesi sendiri. Nama file disimpan dengan id unik, nama asli hanya sebagai label. Data sesi dihapus otomatis setelah 24 jam. |
| P3 | Batas unggah (misalnya 100 MB, bisa diatur lewat env). Cache geometri diganti LRU dengan batas memori. Bersihkan file sementara hasil unzip. |
| P4 | Analisis berjalan sebagai job di background (mulai dengan `ThreadPoolExecutor` atau RQ/Celery + Redis). API mengembalikan `job_id`, frontend menampilkan progres per tahap. Batasi 1 job aktif per sesi. |
| P5 | `escapeHtml` / `textContent` untuk semua teks dari file (sudah di Fase 4). Header Content-Security-Policy. |
| P6 | Semua path lewat environment variable. Hapus `os.add_dll_directory(E:\APPS\QGIS\bin)`. Lengkapi `requirements.txt` (reportlab, openpyxl, ifcopenshell dengan versi terkunci). Buat `Dockerfile` (backend + build frontend statis) dan `docker-compose.yml`. |
| P7 | CORS hanya ke domain sendiri, tanpa `allow_credentials` bersama `*`. Rate limit per IP untuk unggah dan analisis. |
| P8 | Judul laporan diganti (sudah di Fase 3). Tambahkan disclaimer di footer: "Alat bantu akademik. Hasil perlu diverifikasi tenaga ahli sebelum diajukan." |

Pilihan hosting murah untuk tahap awal: satu VPS kecil (2 vCPU, 4 GB RAM) dengan Docker. IfcOpenShell dan raycast cukup berat, jadi hosting serverless dengan batas waktu pendek kurang cocok.

**Selesai kalau:** dua browser berbeda (sesi berbeda) mengunggah model dengan nama sama; masing-masing hanya melihat dan mengunduh miliknya sendiri. Unggahan 300 MB ditolak dengan pesan jelas. Analisis model besar tidak membuat request lain menunggu.

```text
PROMPT FASE 5:
Branch fase-5-publish. Terapkan tabel P1-P8 di dokumen rencana.
- Session middleware (cookie session_id acak, HttpOnly, SameSite=Lax); storage/{session_id}/ untuk model, config, epw, hasil; job pembersihan > 24 jam.
- Batas ukuran unggah via env MAX_UPLOAD_MB (default 100); LRU cache geometri dengan batas.
- Analisis sebagai background job: POST analyze -> job_id; GET /api/jobs/{id} -> status + progres per tahap + analysis_id.
- CORS whitelist via env ALLOWED_ORIGINS; rate limit (slowapi) untuk unggah/analisis; header CSP.
- Hapus semua path absolut Windows; lengkapi requirements.txt dengan versi terkunci; Dockerfile + docker-compose.yml.
- Disclaimer di footer UI dan di laporan.
Tes: tests/test_sessions.py memastikan isolasi data antar dua sesi dan penolakan file terlalu besar. Commit.
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
