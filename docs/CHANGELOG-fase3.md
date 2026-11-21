# CHANGELOG — Fase 3 (Kepatuhan SNI 6389:2020, Errata Lampiran A, Katalog Generik & Pengisi Template Prodi)

Branch: `fase-3-sni`

## Ringkasan Perubahan

### 1. Tabel Resmi SNI 6389:2020 & Errata Lampiran A (`backend/sni_tables.py`, `docs/sni_tables_check.md`)
- Transkripsi lengkap dari `docs/SNI-6389-2020.pdf` dengan komentar nomor tabel dan halaman:
  - **Tabel 1 & Tabel 2**: absorptansi radiasi matahari ($\alpha$) dinding, atap, dan cat eksterior.
  - **Tabel 7**: $TD_{EK}$ dinding berdasarkan massa per luas ($<125 \to 15\text{ K}$, $125\text{–}195 \to 12\text{ K}$, $>195 \to 10\text{ K}$).
  - **Tabel 8**: Faktor Radiasi Matahari ($SF$) diskrit 54 lokasi di Indonesia × 8 orientasi + atap horizontal (`ROOF`).
  - **Tabel 9**: $TD_{EQ}$ atap berdasarkan massa ($<50 \to 24\text{ K}$, $50\text{–}230 \to 20\text{ K}$, $>230 \to 16\text{ K}$).
  - **Tabel A.5 – A.16**: $SC_{eff}$ proyeksi horizontal, vertikal, dan egg-crate.
- **Errata Lampiran A (`SNI_SCEFF_ERRATA`)**:
  - Memasukkan seluruh 36 sel anomali cetak PDF hasil audit `docs/verifikasi_tabel_sni.md` (Bagian 2–5).
  - Tabel utama tetap menyimpan nilai tercetak PDF; koreksi diterapkan saat lookup bila `settings.sceff_table_mode == 'terkoreksi'` (default), sedangkan `'ketat_pdf'` mengembalikan angka tercetak PDF apa adanya.
  - Setelah koreksi, seluruh 12 tabel (A.5–A.16) tidak lagi memiliki kenaikan non-monoton maupun lonjakan positif $> 0.006$ terhadap rata-rata tetangga.
  - Sel errata yang benar-benar terpakai selama analisis dikembalikan pada `sceff_errata_applied` dan dicantumkan pada lembar **Hitungan Manual**.

### 2. Sumber Tabel SF (`settings.sf_source`: `'template_prodi'` | `'sni2020'`)
- Default `settings.sf_source` ditetapkan ke `'template_prodi'` agar hasil konsisten dengan tabel `'ref.'!A5:J22` pada `docs/templates/template_prodi.xlsx` (18 kota).
- Pengguna dapat beralih ke `'sni2020'` untuk menggunakan Tabel 8 SNI 6389:2020 (54 kota).
- **Kejujuran pelabelan**: hasil API dan seluruh laporan ekspor (CSV, Excel, PDF) selalu menampilkan sumber SF aktif secara eksplisit (`Tabel SF Template Prodi ('ref.'!A5:J22)` atau `Tabel 8 SNI 6389:2020 (hlm. 11–12)`), dan tidak pernah melabeli `'template_prodi'` sebagai Tabel 8 SNI.
- Bila kota yang dipilih tidak tersedia pada daftar 18 kota template prodi, sistem memilih kota terdekat dan mencatat peringatan `SF_CITY_FALLBACK`.

### 3. Mode Perhitungan & RTTV Pasal 4.4 (`backend/ottv_engine.py`, `backend/config_schema.py`)
- Menambah `settings.mode = 'sni' | 'simulasi'` (default `'sni'` pada `ProjectConfig`).
  - Di mode `'sni'`: $SF$ diskrit 8 orientasi, $\Delta T = 5\text{ K}$, $TD_{EK}$ dari `massa_kg_m2`, $SC = SC_k \times SC_{eff}$ dari Lampiran A berdasarkan rasio peneduh terukur, dan perhitungan **RTTV** (Pasal 4.4) untuk grup atap/skylight.
  - Di mode `'simulasi'`: perilaku raycast & interpolasi lama dipertahankan dengan flag `is_compliance = false` dan label `Eksplorasi — bukan untuk kepatuhan`.
- Menghapus override skalar (`alpha_wall`, `u_wall`, `td_ek`, `u_fenestration`, `sc_glass`, `u_frame`, `delta_t`) dari `ProjectConfig.settings` dan menggantinya dengan `settings.custom_materials` (disertai migrasi otomatis di `migrate_v1`).
- Prioritas material tunggal pada `resolve_material()`: `override grup > override orientasi > default peran > saran nama > default katalog`.

### 4. Katalog Material Generik & Dukungan SHGC (`backend/materials_and_epw.py`)
- Mengganti katalog bawaan menjadi material generik bernilai tipikal (`status: 'nilai_tipikal'`, nilai $\alpha$ dari Tabel 1/2 SNI 6389:2020, dilengkapi `massa_kg_m2`, `shgc`, dan `sumber`).
- Menghapus label `'Terverifikasi'` tanpa sumber datasheet resmi.
- Menyediakan `LEGACY_MATERIAL_ID_MAP` dan `migrate_material_id()` agar ID material lama (bermerek) pada konfigurasi `.ottv.json` lama otomatis bermigrasi ke material generik terdekat.
- Menambahkan field `shgc` pada seluruh material kaca; bila material kustom hanya mengisi `sc`, pengisi template menghitung `SHGC = SC * 0.86` (sesuai rumus `SHGC/0.86` pada sheet orientasi template prodi).

### 5. Perbaikan Lembar `Hitungan Manual` (`backend/report_exporter.py`)
- Mengganti judul laporan menjadi `Laporan Perhitungan OTTV mengacu SNI 6389:2020`.
- Pada lembar **Hitungan Manual**:
  - Bila satu orientasi memiliki beberapa kombinasi jenis kaca dan/atau rasio peneduh, sistem menulis **satu baris per kombinasi** (tidak dirata-ratakan).
  - Kolom `SC` selalu sama persis dengan `SCk × SCeff` untuk setiap baris.
  - Kolom `OTTV_i` dihitung ulang langsung dari kolom yang ditampilkan, dan rata-rata tertimbang luas per orientasi cocok dengan `ottv_orientation_wm2` dari engine dalam toleransi $\le 0.01\text{ W/m}^2$.
  - Menyertakan catatan sumber SF aktif serta daftar sel errata $SC_{eff}$ yang diterapkan.

### 6. Pengisi Template Prodi Tanpa Openpyxl (`backend/template_filler.py`, `backend/report_template_map.py`)
- Membaca dan memodifikasi `docs/templates/template_prodi.xlsx` langsung di level ZIP + XML (`<sheetData>`), tanpa membuka-lalu-menyimpan lewat `openpyxl`, sehingga seluruh `<dataValidation>` standar dan `<x14:dataValidation>` (pada `UTARA`) tetap utuh 100%.
- Menghapus cache `<v>` pada sel rumus terdampak dan menyetel `<calcPr fullCalcOnLoad="1"/>` agar Excel menghitung ulang seluruh rumus saat dibuka.
- Menyediakan endpoint `GET /api/analyses/{analysis_id}/export/template_prodi`.
- Memetakan `Mat!H6`, `Mat!D6`, `Mat!C11`, `Mat!B16:B25` (7 konstruksi `BO. wallmaterial!B5:B11`), `Mat!C32:G56` (termasuk membersihkan nilai bawaan `Mat!F32='yes'`/`G32='SE1'` bila tanpa peneduh), tabel peneduh `SH`/`SV`/`SE`, dan 8 sheet orientasi baris `65..89` (maksimal 25 segmen per orientasi, dengan penggabungan otomatis + peringatan bila melebihi 25, serta clamp `H <= C*D` agar `V104` tidak `#N/A`).

### 7. Kebersihan Repositori & Dependensi
- Menambahkan `docs/*.pdf` ke `.gitignore`, menjalankan `git rm --cached docs/SNI-6389-2020.pdf`, dan menyusun `docs/PUBLISH_CHECKLIST.md`.
- Mengunci versi `reportlab`, `openpyxl`, dan `ifcopenshell` di `backend/requirements.txt` serta menambahkan `backend/requirements-dev.txt` (`pytest`, `httpx`).

---

## Catatan Investigasi Model Uji (`compare_baseline.py`)

### A. Penurunan Total Luas Selubung Vertikal `26,40 m²` pada `fasad_unitized_24lantai.3dm`
- Pada baseline Fase 1, `fasad_unitized_24lantai.3dm` mencatat luas selubung vertikal `9.421,80 m²` (`glazing 5.146,19 m²`, `spandrel 4.275,61 m²`).
- Pada Fase 3, luas selubung vertikal tercatat `9.395,40 m²` — berkurang tepat **`26,40 m²`**.
- **Penyebab teknis & perbaikan aturan dimensi skylight:** Pada geometri panel kaca solid `.3dm` tersebut terdapat `1.972` face tutup sisi atas (*top-edge cap*) panel kaca dengan normal menghadap ke atas ($n_z > 0.50$) dan dimensi terpendek hanya **0,03–0,10 m** (ketebalan panel kaca, bukan skylight). Awalnya face tersebut sempat dialihkan ke RTTV skylight (`26,40 m²`). Kini diterapkan aturan dimensi terpendek bidang:
  - Bidang kaca menghadap atas ($n_z > 0.50$) hanya dihitung sebagai **skylight RTTV** apabila dimensi terpendek bidang **`> 0,30 m`**.
  - Bidang kaca menghadap atas dengan dimensi terpendek **`<= 0,30 m`** tidak dihitung sebagai OTTV maupun RTTV skylight, melainkan dicatat transparan di `stage1_geometry_audit.filtered_items` dengan `reason = 'sisi_tebal_panel'` (dan dapat dipulihkan lewat `restore_filtered`).
  - Akibatnya, pada `fasad_unitized_24lantai.3dm` seluruh `1.972` face tepi atas tipis masuk ke `filtered_items` (`sisi_tebal_panel`) dan `rttv.skylight_area_m2 = 0,0 m²` (akurat karena gedung ini memang tidak memiliki skylight).
- **Catatan tambahan Fase 3b (katalog generik & metode template):**
  - Saat `settings.sf_source == 'template_prodi'`, engine memakai [template_method.py](../backend/template_method.py) sehingga suku radiasi menggunakan $SF$ `'ref.'!A5:J22`, $SC_k = \text{SHGC}/0.86$, dan $SC_{eff}$ dari range `BO` (`scefn..scefsw`) persis seperti `template_prodi.xlsx`.
  - Pada `compare_baseline.py` (mode `simulasi` default), perubahan katalog bawaan dari spandrel bermerek lama ($\alpha = 0.42$) ke spandrel generik SNI Tabel 1 (`wal_spandrel_insulasi_50`, $\alpha = 0.40$ — *Cat alumunium*) juga menurunkan kontribusi konduksi dinding secara kecil (~0,1–0,2 W/m²) pada model uji dengan spandrel.

### B. Mengapa `archicad_bim_curtainwall.ifc` Memiliki `SCeff = 1.0`
- Model sampel `fixtures/archicad_bim_curtainwall.ifc` (dihasilkan oleh `create_sample_ifc_preset`) memiliki entitas `IFCSHADINGDEVICE` di dalam teks file STEP-nya, namun header file mendeklarasikan skema **`FILE_SCHEMA(('IFC2X3'))`**.
- Dalam standar buildingSMART IFC, entitas `IfcShadingDevice` **baru diperkenalkan pada IFC4** dan tidak ada dalam skema `IFC2X3`.
- Ketika `IfcOpenShell` membuka file dengan header `IFC2X3`, entitas `IFCSHADINGDEVICE` tidak dikenali oleh skema dan dilewati (*ignored*), sehingga grup yang terparsir hanya berisi `IfcPlate` (glazing/spandrel), `IfcMember` (frame), dan `IfcWall` (wall) — tidak ada grup `shading` yang terbentuk.
- Akibatnya, pengukuran rasio peneduh SNI (`_measure_panel_sni_shading_ratios`) mendapati $R_1 = 0, R_2 = 0$, sehingga Lampiran A menghasilkan **`SCeff = 1.0`**. Untuk model BIM yang memiliki sirip peneduh `IfcShadingDevice`, file IFC harus diekspor dalam skema **IFC4** (atau elemen peneduh ditempatkan pada `IfcBuildingElementProxy` / `IfcMember` berlabel `Shading` pada IFC2X3).
