# CHANGELOG — Fase 1c (Ragam Model, Uji Sintetis & Korpus)

Branch: `fase-1c-ragam-model`

## Perbaikan Engine yang Ditemukan di Fase 1c

### B1 — Klasifikasi `IfcPlate` / `IfcCurtainWall` Opak & Konsistensi Filter Tepi Tipis
- **Masalah:** Di `backend/universal_pipeline.py` (`_parse_ifc_with_ifcopenshell`), elemen `IfcPlate` di dalam `IfcCurtainWall` yang memiliki material opak (`transparency <= 0.12`) tanpa kata kunci kaca (misalnya `Paint - Cadmium Orange` pada `Facade only to Alfian.ifc`) jatuh ke cabang `cat == "unknown" -> "glazing"`, sehingga seluruh panel spandrel/dinding opak dihitung sebagai kaca (`WWR = 100%`, OTTV `43.94 W/m²`, selisih `+5.34 W/m²` terhadap `.3dm`/`.obj`). Selain itu, `_filter_thin_edge_slivers_on_group` pada format non-IFC hanya menyaring `glazing`/`spandrel` dan melewatkan sisi ketebalan tipis `<= 8.5 cm` pada kategori `wall`.
- **Perbaikan:**
  1. Pada `_parse_ifc_with_ifcopenshell`, untuk `IfcPlate` / `IfcCurtainWall`: bila `transparency <= 0.12` dan nama gaya/material tidak mengandung kata kunci kaca (`glass`, `glaz`, `kaca`, `vision`), elemen diklasifikasikan sebagai `'spandrel'` (bila rentang Z elemen `<= 1.35 m`) atau `'wall'`, bukan `'glazing'`. Token `ifcplate` saja tidak pernah menentukan kaca.
  2. Pada `_filter_thin_edge_slivers_on_group`, menyamakan penyaringan tepi tipis panel (`<= 8.5 cm`, tercatat di `filtered_items`) untuk kategori `wall` agar konsisten dengan `_clean_solid_bim_element_faces` pada `.ifc`.
- **Hasil Verifikasi (`corpus/real/Facade only to Alfian`):**
  - `.3dm`: `OTTV = 38.79 W/m²`, `WWR = 87.2%`, `glz = 2206.57 m²`, `opq = 324.14 m²`
  - `.obj`: `OTTV = 38.79 W/m²`, `WWR = 87.2%`, `glz = 2206.58 m²`, `opq = 324.13 m²`
  - `.ifc`: `OTTV = 38.79 W/m²`, `WWR = 87.2%`, `glz = 2206.57 m²`, `opq = 324.10 m²`
  - Selisih antar ketiga format: **`0.00 W/m²`** (memenuhi kriteria `<= 0.1 W/m²`).

### Sampel IFC4 (`backend/samples/archicad_bim_curtainwall.ifc`)
- Mengganti generator `create_sample_ifc_preset` di `backend/universal_pipeline.py` dan file `backend/samples/archicad_bim_curtainwall.ifc` ke skema **IFC4** resmi via `ifcopenshell.api` sehingga seluruh 6 entitas `IfcShadingDevice` terparsir oleh `IfcOpenShell` dan menghasilkan $SC_{eff} \approx 0.82\text{–}0.85$ (tidak lagi `1.0`).

### B2 — Klasifikasi `"Atap Beton"` / `"Dak Beton"` / `"Concrete Roof"` Salah Masuk `wall`
- **Terungkap oleh:** Kasus sintetis `01_kotak_m` s.d. `21_ifc_cw_opak` (non-IFC `.3dm`/`.obj`/`.glb`), khususnya `06_courtyard` (hilang 640 m² karena `roof_tris` kosong) dan `16_skylight` (RTTV meleset ke `104.8 W/m²` karena atap opak tidak terdeteksi).
- **Masalah:** Di `backend/universal_pipeline.py` (`classify_layer_or_material_with_confidence`), aturan token dinding (`_WALL_TOKENS`, termasuk `beton`/`concrete`) dieksekusi lebih awal daripada token atap (`_ROOF_TOKENS`). Akibatnya nama seperti `"Atap Beton"`, `"Dak Beton"`, atau `"Concrete Roof"` diklasifikasikan sebagai `wall` (lalu disaring sebagai bidang horizontal non-vertikal), sehingga `roof_groups` kosong pada format non-IFC.
- **Perbaikan:** Menambahkan aturan `5b` sebelum aturan dinding: bila terdapat token atap eksplisit (`atap`, `roof`, `dak`, `ifcroof`) tanpa token kepala dinding (`dinding`, `wall`, `tembok`, `parapet`, `ifcwall`), peran dikembalikan sebagai `'roof'` (confidence `0.94`).

### B3 — Sisi Bawah Ketebalan Kaca Solid (`nz < -0.50`) Bocor ke OTTV Utara pada Kaca Tebal & Model Terputar
- **Terungkap oleh:** Kasus sintetis `17_kaca_tebal` (`U.glazing = 134.4 m²`, selisih `+6.4 m²`) dan `04_kotak_putar30.ifc` (`U.glazing = 4.0 m²` tak terduga).
- **Masalah:**
  1. Di `backend/ottv_engine.py` (`resolve_group_outer_skin_faces`), penyaring sisi bawah kaca hanya memeriksa `(nz < -0.85) & (areas < 0.25)`. Panel jendela pita panjang (`20–30 m × 0.02 m`) memiliki luas sisi bawah `0.40–0.60 m² >= 0.25 m²`, sehingga lolos dengan normal `(0, 0, -1)` dan terhitung sebagai orientasi Utara (`atan2(0, 0) = 0°`).
  2. Di `backend/universal_pipeline.py` (`_clean_solid_bim_element_faces`), deteksi ketebalan tipis `min_elem_dim <= 0.14` memakai bounding box sejajar sumbu dunia (*world AABB*), sehingga gagal ketika kaca diputar 30° (`04_kotak_putar30.ifc`).
- **Perbaikan:**
  1. Di `resolve_group_outer_skin_faces`, menerapkan pemeriksaan dimensi terpendek bidang (`<= 0.30 m` -> `sisi_tebal_panel`) untuk sisi kaca menghadap bawah (`nz < -0.50`) serta menyaring semua bidang horizontal menghadap bawah (`nz < -0.85` -> `horizontal_edge_cap`).
  2. Di `_clean_solid_bim_element_faces`, menambahkan perhitungan dimensi terpendek in-plane yang invarian terhadap rotasi (`face_min_dim <= 0.14`).

### B4 — Pengukuran Rasio Sirip Vertikal (`R2`) pada Jendela Pita & False-Positive Overhang dari Tutup Atas Sirip Solid
- **Terungkap oleh:** Kasus sintetis `09_sirip` (`.3dm`/`.obj`/`.glb` mendapat `SCeff = 1.0`, sedangkan `.ifc` over-shaded `17.57 W/m²` vs analitis `18.66 W/m²`).
- **Masalah:** Di `backend/ottv_engine.py` (`_measure_panel_sni_shading_ratios`):
  1. Sirip vertikal hanya dicari tepat di tepi kiri/kanan panel (`±half_w`) dan dibagi lebar penuh jendela (`win_w = 20–30 m`), sehingga sirip berjarak `1.5 m` di depan jendela pita menghasilkan `R2 = 0.03` (diabaikan).
  2. Tutup horizontal tipis (`2 cm`) di ujung atas sirip vertikal solid IFC (`IfcShadingDevice`) memiliki `|nz| >= 0.35`, sehingga salah dideteksi sebagai overhang horizontal (`R1`).
- **Perbaikan:**
  1. Penyaring overhang (`R1`) kini mengecualikan tutup tipis sirip vertikal dan mensyaratkan cakupan lebar horizontal `>= 35%` lebar jendela.
  2. Pengukuran sirip vertikal (`R2`) kini menyaring segitiga sirip berdasarkan arah normal (`|tn · t_ax| >= 0.50`), mengelompokkan posisi `t` sirip (toleransi `0.12 m` untuk dua sisi sirip solid), dan menghitung jarak antar-sirip (`median` bila `>= 3` sirip) sehingga `R2 = P_v / W_fin` akurat pada jendela pita maupun jendela tunggal (dan turut memperbaiki deteksi sirip vertikal pada `fasad_unitized_24lantai.3dm`).

### B5 — Rongga Double-Skin Facade (`<= 1.80 m`) Salah Dianggap Courtyard Terbuka
- **Terungkap oleh:** Kasus sintetis `10_double_skin` (`.3dm`/`.obj`/`.glb` menghasilkan `3302.4 m²` = kulit luar + dinding dalam, seharusnya `1702.4 m²`).
- **Masalah:** Di `backend/ottv_engine.py` (`detect_exterior_faces_raycast`), Langkah 4 (pemeriksaan courtyard terbuka ke langit) mempromosikan semua bidang yang terhalang horizontal namun tidak beratap langsung di depannya, tanpa membedakan antara courtyard nyata (lebar `> 1.80 m`, mis. `10 m` pada `06_courtyard`) dan celah rongga fasad ganda (`0.80 m` pada `10_double_skin`).
- **Perbaikan:** Membatasi promosi courtyard pada Langkah 4 hanya untuk bidang dengan jarak halangan depan `t_center > 1.80 m`.

### Catatan Konvensi `north_angle_deg` (Kasus 4)
- Di engine (`ottv_engine.py`), `north_angle_deg` didefinisikan sebagai azimut **Utara Sejati searah jarum jam dari sumbu +Y model** (`azimuth = (raw_deg - north_angle_deg) % 360`). Dengan demikian, memutar bangunan 30° searah jarum jam (`04_kotak_putar30`, sisi `U->TL`, `T->TGR`, `S->BD`, `B->BL`) secara geometris ekuivalen dengan geometri `01_kotak_m` + `north_angle_deg = 330°` (Utara Sejati diputar 30° berlawanan jarum jam). Diverifikasi di `tests/test_synthetic.py::test_case04_north_angle_equivalence`.

### B6 — Klasifikasi `IfcCovering` (`CEILING`/`FLOORING`/`ROOFING`/`CLADDING`)
- **Terungkap oleh:** Korpus Tingkat B `Duplex_A_20110907.ifc` (`13` elemen `IfcCovering` bertipe `CEILING` masuk `unknown` sebesar `12,18%` luas).
- **Perbaikan:** Di `backend/universal_pipeline.py` (`_parse_ifc_with_ifcopenshell`), membaca atribut `PredefinedType` pada `IfcCovering`: `CEILING`/`FLOORING` -> `'ignore'`, `ROOFING` -> `'roof'`, `CLADDING` -> `'wall'`; tipe lain/kosong tetap melalui klasifier teks.

### B7 — Ledakan Grup Sufiks ID Instans IFC & Optimasi Eksak Raycast/Peneduh (`Schependomlaan.ifc` 62 MB: `130 s -> 30 s`)
- **Terungkap oleh:** Korpus Tingkat B `Schependomlaan.ifc` (62,06 MB, 89.752 face) awalnya menghasilkan **3.505 grup** (tiap elemen ArchiCAD memiliki sufiks `_(#948940)`) dan memakan waktu **130,3 detik** (`> 60 s` kriteria selesai §7).
- **Perbaikan:**
  1. Di `_parse_ifc_with_ifcopenshell`, menghapus sufiks ID instans numerik ArchiCAD (`_(#123456)`) dan Revit (`:123456`) pada fallback nama material, sehingga `Schependomlaan.ifc` menyusut bersih dari `3.505` -> `436` grup.
  2. Di `backend/ottv_engine.py` (`_raycast_arbitrary_rays_against_tris`), menambahkan cache akselerasi segitiga + pra-filter *2D bounding-circle* (dan AABB XY untuk sinar vertikal) sebelum Möller-Trumbore 1D float64 (100% eksak secara matematis, menyaring >98% pasangan mustahil) -> waktu raycast turun dari `59,75 s` menjadi `10,56 s`.
  3. Di `_measure_panel_sni_shading_ratios`, menambahkan pra-filter AABB 3D (`±12,5 m` XY, band Z jendela) yang 100% eksak terhadap `sni_shading_tris` -> waktu pengukuran peneduh turun dari `~50 s` menjadi `2,71 s`.
  4. Total waktu `Schependomlaan.ifc` turun dari **130,3 s** menjadi **~29,9 s** (`< 60 s`).
- **Kasus Sintetis Regresi:** Ditambahkan kasus `22_ifc_covering_dan_id` (`fixtures/synthetic/22_ifc_covering_dan_id/model.ifc`) untuk mengunci perbaikan B6 & B7 secara permanen di `tests/test_synthetic.py`.
