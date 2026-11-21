# CHANGELOG — Fase 1: Ketepatan Geometri (M1–M12)

Branch: `fase-1-geometri`  
Cakupan: `backend/universal_pipeline.py`, `backend/adapters/__init__.py`, deteksi sisi luar di `backend/ottv_engine.py`, `tests/test_classify.py`, serta dukungan pelaporan `ottv_error` pada `tools/snapshot_baseline.py` & `tools/compare_baseline.py`. Tidak ada file UI (`frontend/`) yang diubah.

---

## Ringkasan Perbaikan per Kode M

| Kode | Commit | Ringkasan Perubahan |
| --- | --- | --- |
| **M1** | `4ac0dbb` | Melewati objek dengan `Attributes.Mode == ObjectMode.InstanceDefinitionObject` di loop top-level `.3dm` agar definisi blok tidak diproses dobel di titik asal sebelum instansiasi `InstanceReference`. |
| **M9** | `3f1feb3` | Anak blok Rhino memakai layer dan material miliknya sendiri (`parent_layer` hanya fallback bila `Default`/`By Parent`; menghormati `ObjectMaterialSource`), nama grup mempertahankan layer asli, dan visibilitas objek/layer dicek di semua kedalaman blok. |
| **M3** | `843e6d8` | Brep/Surface tanpa render mesh tidak lagi di-tessellate dari `UnderlyingSurface` (yang sebelumnya mengarang geometri tak terpotong). Seluruh permukaan tanpa mesh dicatat ke `audit.missing_mesh` beserta instruksi ekspor Rhino (tampilkan `Shaded` lalu `Save`, jangan `SaveSmall`, atau jalankan `Mesh`). |
| **M4 / M5 / M6** | `76fb9a9` | Filter sliver, cap horizontal, dan bidang non-vertikal mencatat entri ke `audit.filtered_items` (`id`, `group`, `reason`, `face_count`, `area_m2`, `restored`) dan dapat dikembalikan melalui parameter `restore_filtered`. Stride destruktif 80.000 face pada `RawGroupMesh` dihapus (simplifikasi hanya untuk BVH raycast). Bidang kaca miring / skylight (`glazing` / `composite_cw`) tetap disimpan. |
| **M7** | `b394625`, `a2f6e12` | Klasifikasi diganti dari substring menjadi pencocokan per token (`_ - . / :: spasi` + camelCase) dengan kamus terpisah ID/EN + skor keyakinan. Kata tak dikenali menjadi `unknown` (bukan `wall`), interior/tapak/core dipisahkan ke `ignore` (bukan `roof`). `ottv_engine.py` tidak lagi memaksa grup `unknown` menjadi `wall` secara diam-diam. Ditambahkan `tests/test_classify.py`. |
| **M8** | `d9491da` | Saat merge chunk per grup, grup dengan kategori campur dipecah menjadi sub-grup per kategori (`<nama> :: <kategori>`). |
| **M2** | `41c8105` | `z_ground_offset_m` dihitung dari elevasi storey BIM bila ada, atau hanya dari geometri selubung (`glazing`, `wall`, `spandrel`, `composite_cw`), bukan dari pohon/konteks/tapak. |
| **M10** | `5773d2c` | Menambahkan `audit.unit_source` dan `audit.unit_needs_confirmation = True` ketika satuan ditebak dari bounding box (`.obj`/`.stl`/`.ply` mode otomatis, atau heuristik bbox `>650` / IFC `>1500`). |
| **M11** | `bec4d68` | Mengekstrak fungsi tunggal `resolve_group_outer_skin_faces` & `compute_outer_skin_areas_by_group` di `backend/ottv_engine.py` yang dipakai bersama oleh layar Inspeksi (`adapters.build_staging_inspection_payload`) dan Hasil (`analyze_building_ottv`). |
| **M12** | `029af58` | Menghapus klaim "Normal Fix / perbaikan normal" dari `SOFTWARE_PROFILES["sketchup_mesh"]` dan catatan `SketchUpMeshAdapter.post_process_groups`. |
| **IFC Fallback** | `895af5d` | Menghapus parser fallback STEP Python murni `_parse_ifc_file`. File `.ifc` kini wajib dibaca melalui `IfcOpenShell` dan mengangkat `ValueError` berbahasa Indonesia yang jelas bila gagal atau kosong. |

---

## Ringkasan Output `tools/compare_baseline.py`

| Fixture | Grup (Base → Kini) | Luas Selubung m² (Base → Kini) | WWR (Base → Kini) | OTTV W/m² (Base → Kini) | Jumlah Selisih |
| --- | :---: | :---: | :---: | :---: | :---: |
| `archicad_bim_curtainwall.ifc` | `3 → 3` | `1950.02 → 1950.02` | `84.7% → 84.7%` | `33.86 → 33.86` | **0** |
| `Honeybee_MultiZone_Office_3F.hbjson` | `3 → 3` | `240.00 → 240.00` | `20.0% → 20.0%` | `10.40 → 10.40` | **0** |
| `fasad_unitized_24lantai.3dm` | `18 → 9` | `9439.03 → 9421.80` | `73.7% → 74.7%` | `22.25 → 24.63` | **53** |
| `Khronos_Glass_Transmission.glb` | `22 → 22` | `0.15 → 0.00` | `35.0% → 0.0%` | `8.62 → 0.00` *(error konfirmasi)* | **52** |
| `tes objek archicad.3dm` | `3 → 3` | `1881.99 → 1885.61` | `95.7% → 95.4%` | `24.44 → 32.43` | **28** |

Total: **133 selisih** di 3 fixture, seluruhnya terjelaskan langsung oleh perbaikan M1–M12 di bawah ini.

---

## Penjelasan Detail Setiap Selisih per Fixture

### 1. `archicad_bim_curtainwall.ifc` — **0 selisih**
Model BIM IFC bersih yang sudah diproses `IfcOpenShell` dengan elemen dan peran eksplisit (`IFC_Plate` kaca/spandrel, `IFC_Wall`, `IFC_Member`). Seluruh metrik (jumlah grup, bbox, `z_ground_offset_m`, luas sisi luar, WWR 84.7%, OTTV 33.86 W/m², dan 8 orientasi) tetap **100% identik**.

---

### 2. `Honeybee_MultiZone_Office_3F.hbjson` — **0 selisih**
Model termal Honeybee memiliki tipe permukaan eksplisit (`HB_Opaque_Walls`, `HB_Vision_Glazing`, `HB_Roof_Floor`) dalam satuan meter. Seluruh metrik (luas 240.00 m², WWR 20.0%, OTTV 10.40 W/m², dan 8 orientasi) tetap **100% identik**.

---

### 3. `fasad_unitized_24lantai.3dm` — **53 selisih** (M1, M2, M7, M9)
1. **Penghapusan 9 grup pohon "hantu" (`group_count: 18 → 9`) — penyebab M1 & M9:**
   - Pada baseline, 9 grup vegetasi blok (`By Parent :: LANDS Acer palmatum ...` [5 grup], `Default :: Foliage`, `Default :: LANDS Color 043`, `Default :: LANDS Color 075`, `Default :: Trunk`) muncul sebagai salinan definisi blok di titik asal karena loop `.3dm` tidak melewati `ObjectMode.InstanceDefinitionObject` (M1) dan tidak mengecek visibilitas anak blok (M9).
   - Sebelumnya seluruh 9 grup pohon ini diklasifikasikan keliru sebagai `wall` dengan luas sisi luar palsu `139.19 m²` (`outer_area[wall]: 139.19 → 0.0`) dan menyuntikkan luas & OTTV palsu `3.91 W/m²` pada arah diagonal **TL (14.90 m²), TGR (22.15 m²), BD (13.65 m²), dan BL (16.18 m²)**. Setelah M1/M9, keempat arah diagonal tersebut menjadi tepat **`0.00 m²` (`0.00 W/m²`)** sesuai geometri menara persegi panjang 4 sisi.
2. **Penamaan grup mempertahankan layer asli (`01_Vision_Glass` → `Layer 01 :: 01_Vision_Glass`, dst.) — penyebab M9:**
   - Sebelumnya M9 membuang nama layer ketika `obj_name` terisi. Kini 9 grup fasad mempertahankan prefix layer aslinya (`Layer 01 :: ...`) dengan jumlah face tiap grup tetap **persis sama** (`7976`, `312`, `7920`, `17820`, `17820`, `23142`, `3576`, `492`, `78`).
3. **Klasifikasi ulang 2 grup non-selubung — penyebab M7:**
   - `08_Structure_Slab_Core`: `roof → ignore` (token `core`/`slab` masuk kategori elemen interior/struktur yang diabaikan, tidak lagi dicampur ke `roof`).
   - `09_SkyGarden_Planter_Greenery`: `shading → unknown` (elemen planter/greenery tak dikenali sebagai peneduh arsitektural standar sehingga meminta konfirmasi pengguna).
4. **Koreksi `z_ground_offset_m` (`-0.60 m → +0.12 m`) dan pergeseran `bbox.min/max Z` (`[0.0, 100.6] → [-0.6, 100.0]`) — penyebab M2:**
   - Sebelumnya Z0 tertarik turun ke `-0.6 m` oleh geometri non-selubung/pohon. Kini Z0 diukur semata dari geometri selubung aktif (`01_Vision_Glass` & `03_Spandrel_Panel`), sehingga elevasi fasad benar-benar mulai di `Z = 0.0 m` (`bbox.span` tetap persis `[42.0, 30.0, 100.6]`).
5. **Perubahan luas selubung (`9439.03 → 9421.80 m²`), WWR (`73.7% → 74.7%`), dan OTTV (`22.25 → 24.63 W/m²`) — efek gabungan M1, M2, M7:**
   - Hilangnya `139.19 m²` dinding palsu dari pohon menaikkan WWR dari `73.7%` ke `74.7%` dan menghapus oklusi/bayangan palsu pada raycast sisi luar, sehingga `outer_area[glazing]` naik `+80.83 m²` (`6960.26 → 7041.09`) dan `outer_area[spandrel]` naik `+12.26 m²` (`2369.25 → 2381.51`).
   - Peningkatan rasio kaca serta hilangnya bayangan palsu dari pohon & planter `unknown` menaikkan OTTV pada arah U (`16.71 → 18.71`), T (`20.28 → 22.23`), S (`15.26 → 15.32`), dan B (`36.76 → 41.60`), menghasilkan OTTV total **`24.63 W/m²`**.
   - Verifikasi M11: luas sisi luar di Inspeksi dan di Hasil kini persis sama (`glazing = 7041.09 m²`, `spandrel = 2381.51 m²`).

---

### 4. `Khronos_Glass_Transmission.glb` — **52 selisih** (M7)
1. **Perubahan kategori 22 grup non-bangunan — penyebab M7:**
   - Fixture ini adalah scene uji material PBR Khronos (12 bola `Sphere*`, 9 bidang teks `LabelMaterial`, dan 1 kain `Cloth Backdrop 01`), **bukan model bangunan arsitektural**.
   - Pada baseline, seluruh 22 grup secara keliru jatuh ke default `wall` karena tidak cocok kata kunci apa pun, lalu menghasilkan OTTV semu `8.62 W/m²` dengan luas `0.15 m²` dan WWR sintetis `35.0%`.
   - Setelah M7, 19 grup non-arsitektural (`Cloth Backdrop`, 9 `Label`, 9 `Sphere`) diklasifikasikan jujur sebagai **`unknown`**, sementara 3 bola bernama `*Metal` (`GreenMaskMetal`, `YellowTransMetal`, `RedTransTextureMetal`) cocok token `metal` → **`frame`**.
2. **Penolakan perhitungan OTTV tanpa konfirmasi (`ottv_error` terisi; area/WWR/OTTV `→ 0`) — penyebab M7:**
   - Karena tidak ada satu pun grup selubung teridentifikasi (`glazing`/`wall`/`spandrel`/`composite_cw`) dan terdapat 19 grup `unknown`, `analyze_building_ottv` tidak lagi mengarang hasil OTTV melainkan mengembalikan `ValueError` yang meminta pengguna mengonfirmasi peran grup `unknown` terlebih dahulu di tahap Periksa Model.

---

### 5. `tes objek archicad.3dm` — **28 selisih** (M2, M3, M5, M7)
1. **Penghapusan geometri karangan dari Brep tanpa render mesh (`bbox.span`: `[23.18, 27.72, 40.50]` → `[20.00, 25.00, 38.50]`) — penyebab M3:**
   - Pada baseline, `tes objek archicad.3dm` memiliki ratusan/ribuan face Brep tanpa render mesh (`Insulation - Fiberglass`: 234 face Brep; `Metal - Aluminium`: 19.552 face Brep) yang sebelumnya di-tessellate paksa dari `UnderlyingSurface` tak terpotong sehingga membentuk bidang-bidang raksasa yang mencuat 1,5–3 m keluar bangunan.
   - Setelah M3, seluruh permukaan tanpa render mesh tidak lagi dikarang dan dicatat di `audit.missing_mesh` (2 entri dengan instruksi ekspor Rhino). Dimensi bbox bangunan langsung kembali bersih tepat ke ukuran arsitektural aslinya **`20.0 m × 25.0 m × 38.5 m`**, `slivers_removed` turun `2510 → 2028` (`-482`), face `Glass - Clear Fast` terkoreksi `3934 → 3900` (`-34`), dan face `Insulation - Fiberglass` terkoreksi `2640 → 1170` (`-1470` face karangan hilang).
2. **Pelestarian penuh geometri rangka tanpa stride destruktif (`Finish - Wall :: Metal - Aluminium`: `78.577 → 156.832` face) — penyebab M5:**
   - Sebelumnya grup dengan >80.000 face dipotong setengahnya secara permanen oleh stride destruktif pada tahap load. Kini seluruh `156.832` face mesh asli yang memiliki render mesh tetap utuh (stride hanya diterapkan untuk mesh raycast internal).
3. **Koreksi kategori `Finish - Wall :: Insulation - Fiberglass` (`spandrel → wall`) — penyebab M7:**
   - Token `insulation` hanya diklasifikasikan sebagai `spandrel` bila berada dalam konteks curtain wall (`IfcCurtainWall` / `curtainwall`). Karena objek ini berada di layer `Finish - Wall`, klasifikasi per token menetapkannya secara akurat sebagai **`wall`** (`outer_area[spandrel]: 81.73 → 0.0`, `outer_area[wall]: 0.0 → 85.79 m²`).
4. **Koreksi `z_ground_offset_m` (`-1.05 m → +0.05 m`) — penyebab M2 & M3:**
   - Menghilangnya permukaan Brep karangan yang menjulur di bawah dasar bangunan dan perhitungan Z0 berbasis selubung mengembalikan offset tanah ke `+0.05 m`.
5. **Kenaikan OTTV (`24.44 → 32.43 W/m²`, terutama arah U `16.07 → 31.60`, T `24.67 → 30.41`, B `47.69 → 59.18`) — penyebab M3:**
   - Pada baseline, bidang-bidang Brep `UnderlyingSurface` karangan yang mencuat keluar bangunan bertindak sebagai "peneduh raksasa palsu" yang memblokir radiasi matahari ke kaca fasad Utara, Timur, dan Barat. Setelah bidang karangan tersebut tidak lagi dibuat (M3), paparan radiasi matahari pada fasad kaca dengan WWR 95.4% mencerminkan geometri nyata bangunan (`32.43 W/m²`).
