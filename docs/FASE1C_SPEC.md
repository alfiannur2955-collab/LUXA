# Spesifikasi Fase 1c — Uji Ragam Model

Dokumen ini berdiri sendiri. Antigravity: baca seluruhnya sebelum mengerjakan butir 1, 3, 5, 6 Fase 1c.
Butir 2 (IFC4 sample), 4 (corpus/real) dan perbaikan B1 sudah selesai di commit 5baf5f8 dan 6662eb6.

## 0. Prinsip

- Model sintetis dipakai untuk MENGUJI, bukan melatih. Nilai yang diharapkan (expected) dihitung
  ANALITIS oleh script pembuat model dari geometri yang ia buat sendiri.
- Script pembuat expected TIDAK boleh memanggil `analyze_building_ottv`, `load_universal_model_stages_1_and_2`,
  atau fungsi klasifikasi/raycast engine. Boleh memakai data konstanta: katalog material
  (`materials_and_epw`), tabel SF/SCeff (`sni_tables`, tabel template di `template_method`) hanya sebagai
  tabel angka.
- Pengaturan analisis untuk semua kasus: `ProjectConfig()` default (mode `sni`, `sf_source = template_prodi`,
  kota Jakarta, utara 0°) kecuali kasus menyebut lain.
- Material: dinding = material katalog default peran dinding; kaca = material katalog default peran kaca.
  Script membaca nilai U, alpha, SC/SHGC, massa dari katalog untuk menghitung expected.

## 1. Geometri dasar ("kotak standar")

- Denah 20 m (sumbu X, sisi Utara/Selatan) × 30 m (sumbu Y, sisi Timur/Barat), sumbu +Y = Utara.
- 4 lantai × tinggi 4,0 m = 16 m. Alas di z = 0.
- Jendela pita (ribbon) di setiap lantai, selebar penuh sisi, ambang 1,2 m, tinggi 1,6 m
  → WWR tiap sisi = 1,6 / 4,0 = 40%.
- Dinding dan kaca berupa permukaan satu lapis (tanpa tebal) kecuali kasus menyebut lain.
- Nama/material: dinding = "Dinding Bata" (material "Dinding Bata", opak);
  kaca = "Kaca Jendela" (material "Kaca Jendela", transparan: .mtl `d 0.3`, GLB `alphaMode BLEND`,
  3dm material Transparency 0.7, IFC `IfcWindow` + IfcSurfaceStyle transparansi 0.7).
- Atap datar opak bernama "Atap Beton" (masuk RTTV, bukan OTTV).
- Luas per sisi: Utara & Selatan 20×16 = 320 m² (kaca 128, dinding 192);
  Timur & Barat 30×16 = 480 m² (kaca 192, dinding 288). Total 1.600 m², WWR 40%.

## 2. Daftar 21 kasus

| # | Folder | Format | Isi | Yang diharapkan |
|---|---|---|---|---|
| 1 | `01_kotak_m` | 3dm, obj, glb, ifc | Kotak standar, meter | Luas & WWR seperti §1; OTTV dihitung rumus |
| 2 | `02_kotak_mm` | 3dm, obj, glb, ifc | Kasus 1, koordinat ×1000 (mm); header satuan mm pada 3dm & IFC | Sama dengan kasus 1; OBJ/GLB memunculkan `unit_needs_confirmation` |
| 3 | `03_kotak_yup` | obj, glb | Kasus 1 dengan sumbu Y ke atas | Sama dengan kasus 1 |
| 4 | `04_kotak_putar30` | 3dm, obj, glb, ifc | Kasus 1 diputar 30° searah jarum jam di denah | Sisi pindah ke TL/TGR/BD/BL (azimut 30/120/210/300). Varian config: geometri kasus 1 + `north_angle_deg = 30` harus memberi hasil sama |
| 5 | `05_denah_L` | 3dm, obj, glb, ifc | Denah L: kotak 30×30 dikurangi kuadran 15×15 (pojok Timur Laut), 16 m, jendela pita | Luas per arah dihitung dari 6 sisi |
| 6 | `06_courtyard` | 3dm, obj, glb, ifc | Kotak 30×30 dengan void 10×10 di tengah, terbuka ke langit | Fasad dalam courtyard ikut terhitung sebagai fasad luar |
| 7 | `07_silinder` | 3dm, obj, glb | Silinder r = 10 m, 36 segmen, 16 m, jendela pita | Luas tiap segmen dikelompokkan ke 8 arah menurut azimut normal |
| 8 | `08_overhang` | 3dm, obj, glb, ifc | Kasus 1 + overhang horizontal 1,0 m tepat di atas setiap jendela, semua sisi | SCeff horizontal dari tabel template untuk R = 1,0/1,6 per arah; IFC memakai `IfcShadingDevice` |
| 9 | `09_sirip` | 3dm, obj, glb, ifc | Kasus 1 + sirip vertikal tebal 0, kedalaman 0,6 m, jarak 1,5 m | SCeff vertikal dari tabel template untuk R = 0,6/1,5 |
| 10 | `10_double_skin` | 3dm, obj, glb | Kotak opak (kasus 1 tanpa jendela) + kulit kaca penuh berjarak 0,8 m di luarnya | Kebijakan program: hanya kulit terluar yang dihitung (WWR 100%); dinding dalam tidak terhitung |
| 11 | `11_blok_bersarang` | 3dm | Panel jendela sebagai blok di dalam blok "lantai", diinstans 4× (tiap lantai); definisi blok berada di (1000, 1000, 0) | Sama dengan kasus 1; tidak ada geometri ganda di titik asal blok |
| 12 | `12_brep_tanpa_mesh` | 3dm | Kasus 1 dengan dinding sebagai Brep tanpa render mesh, kaca sebagai mesh | `missing_mesh` > 0, `is_provisional = true`, luas dinding tidak terhitung |
| 13 | `13_konteks` | 3dm, obj, glb | Kasus 1 + 5 pohon ("Pohon"), bidang tanah 100×100 m di z = −0,5 ("Tanah"), bangunan tetangga 20×20×30 m berjarak 20 m di Barat ("Bangunan Tetangga") | Z0 = alas kotak; luas & OTTV mode sni sama dengan kasus 1; pohon = unknown/ignore, tanah = ignore |
| 14 | `14_ifc_interior` | ifc | IFC4: dinding luar `IsExternal = TRUE` + 3 partisi dalam `IsExternal = FALSE` | Partisi tidak terhitung; hasil = kasus 1 |
| 15 | `15_dinding_tebal` | obj, glb, ifc | Dinding solid tebal 0,2 m (dimensi luar = kotak standar) | Hanya sisi luar terhitung; hasil = kasus 1 |
| 16 | `16_skylight` | 3dm, obj, glb, ifc | Kasus 1 + skylight datar 4×4 m di atap | RTTV berlaku; luas skylight 16 m²; OTTV sama dengan kasus 1 |
| 17 | `17_kaca_tebal` | 3dm, obj, glb | Kaca sebagai kotak tebal 20 mm | Sisi tebal disaring (`sisi_tebal_panel` / sliver), bukan skylight; hasil = kasus 1 |
| 18 | `18_utm` | 3dm, obj, glb, ifc | Kasus 1 digeser ke (500000, 9300000, 25) | Dipusatkan ulang; hasil = kasus 1 |
| 19 | `19_tanpa_nama` | 3dm, obj, glb | Kasus 1 tetapi semua grup bernama "Layer 0" / "Default", tanpa material | Grup `unknown` + peringatan; analisis ditolak atau berstatus sementara (bukan "Memenuhi") |
| 20 | `20_mesh_multimaterial` | glb | Satu node berisi primitif kaca (BLEND) + primitif rangka opak | Dipecah per material; luas kaca = kasus 1 |
| 21 | `21_ifc_cw_opak` | ifc, obj | IFC4 curtain wall: plate kaca transparan + plate opak bercat ("Paint - Orange"), plus versi .obj dengan material sama | WWR & OTTV IFC = OBJ (selisih ≤ 0,1 W/m²); plate opak = spandrel/dinding |

Lokasi file: `fixtures/synthetic/<folder>/model.<ext>` + `expected.json` (+ `model.mtl` untuk OBJ).

## 3. Format `expected.json`

```json
{
  "case": "01_kotak_m",
  "formats": ["3dm", "obj", "glb", "ifc"],
  "config_overrides": {},
  "expected": {
    "area_by_orientation": {"U": {"glazing": 128.0, "wall": 192.0}, "T": {"glazing": 192.0, "wall": 288.0}, "...": {}},
    "total_envelope_area_m2": 1600.0,
    "wwr_total": 0.40,
    "ottv_total_wm2": 0.0,
    "ottv_by_orientation": {"U": 0.0},
    "rttv": {"applicable": false, "skylight_area_m2": 0.0},
    "is_provisional": false,
    "flags_expected": [],
    "error_expected": false
  },
  "tolerance": {"area_rel": 0.005, "ottv_abs": 0.1},
  "derivation": "Teks singkat cara menghitung, termasuk nilai U, alpha, SC, SF, TDek yang dipakai"
}
```

`ottv_*` diisi script dengan rumus SNI: OTTV_i = α·Uw·(1−WWR)·TDek + Uf·WWR·ΔT + SF·WWR·SC
(SF tabel template Jakarta, ΔT = 5, TDek dari massa material, SC = SHGC/0,86 × SCeff template).

## 4. `tools/fetch_corpus.py` (tingkat B, ke `corpus/`, sudah di-.gitignore)

- Schependomlaan: https://github.com/openBIMstandards/DataSetSchependomlaan (zip release; model desain IFC dari ArchiCAD; izin akademik).
- Duplex Apartment IFC 2x3: https://www.wbdg.org/node/9165 (Revit → IFC).
- buildingSMART Certification-datasets: https://github.com/buildingSMART/Certification-datasets — ambil hanya file yang berupa bangunan (bukan elemen tunggal).
- BIMvoice ifcsamples: https://github.com/BIMvoice/ifcsamples — tiga arketipe kantor IFC 4.3; cek `SOURCE.md` tiap file, ambil hanya yang lisensinya mengizinkan.
- Tulis `corpus/SOURCES.md`: URL, lisensi, tanggal unduh, ukuran. Jika unduhan gagal, catat dan lanjutkan.

Tingkat C ada di `corpus/real/` (diisi manual; sudah berisi "Facade only to Alfian" .3dm/.obj/.mtl/.ifc).

## 5. `tools/model_report.py` → `docs/RAPOR_MODEL.md` + `docs/RAPOR_MODEL.csv`

Satu baris per file. Kolom:

| Kolom | Isi |
|---|---|
| `file`, `tier` | Path relatif; A / B / C |
| `format`, `kernel` | Ekstensi; `audit.geometry_kernel` |
| `software_detected` | Dari `detect_file_signature` |
| `unit_detected`, `unit_applied`, `unit_source` | Dari audit Stage 1 |
| `up_axis` | Sumbu vertikal terpakai |
| `span_x_m`, `span_y_m`, `span_z_m`, `z0_m` | Dimensi & offset tanah |
| `groups_total` | Jumlah grup |
| `groups_glazing` … `groups_unknown` | Jumlah grup per peran (glazing, wall, spandrel, frame, shading, roof, ignore, unknown) |
| `unknown_area_pct` | Persen luas permukaan berperan unknown |
| `filtered_count`, `filtered_area_m2` | Dari `filtered_items` |
| `missing_mesh_faces` | Total face tanpa render mesh |
| `area_glazing_m2`, `area_wall_m2` | Luas sisi luar |
| `area_U` … `area_BL` | Luas per 8 arah |
| `wwr`, `ottv_wm2`, `rttv_wm2` | Hasil analisis (ProjectConfig default) |
| `is_provisional`, `warnings` | Status sementara; kode peringatan dipisah `;` |
| `time_load_s`, `time_analyze_s` | Waktu proses |
| `expected_result` | Tingkat A: PASS / FAIL + alasan singkat; B/C: kosong |
| `parity_group`, `parity_ok` | Kasus/model yang sama dalam format berbeda; OK bila luas selisih ≤ 0,5% dan OTTV ≤ 0,1 W/m² |
| `cek_dimensi`, `cek_kaca`, `cek_peran`, `catatan` | Kosong, diisi manual oleh Alfian untuk tingkat B & C |

`RAPOR_MODEL.md` dibuka dengan ringkasan: jumlah file per tingkat, PASS/FAIL tingkat A, parity gagal, file error, file > 60 s.

## 6. `tests/test_synthetic.py`

- Parametrize semua `fixtures/synthetic/*/expected.json` × format.
- Bandingkan luas (relatif 0,5%), WWR, OTTV (0,1 W/m²), RTTV, `is_provisional`, flag yang diharapkan.
- Tes parity antarformat per kasus.

## 7. Kriteria selesai

- Tingkat A: 21/21 kasus lulus di semua formatnya; parity lulus.
- Tingkat B: tidak ada error; < 60 s per file; unknown < 20% luas atau ada peringatan.
- Tingkat C: rapor terisi; kolom cek manual menunggu Alfian.
- Setiap bug yang ditemukan diperbaiki dan dicatat di `docs/CHANGELOG-fase1c.md`; bug dari tingkat B/C dijadikan kasus sintetis baru (22, 23, …).
