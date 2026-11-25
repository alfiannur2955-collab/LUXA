# Audit Pipeline LUXA — November 2026

Audit langkah 3 (setelah langkah 1: baseline + CI, langkah 2: uji invarian). Setiap tahap pipeline diuji
dengan model buatan yang meniru kebiasaan modeling nyata, lalu kode dibaca pada bagian yang hasilnya
mencurigakan. Semua angka di bawah berasal dari engine pada commit `71516e7`, mode SNI, Jakarta.

Skrip probe tidak dimasukkan ke repo. Temuan yang diperbaiki wajib mendapat uji di `tests/test_invariants.py`.

## Skala keparahan

| Tingkat | Arti |
|---|---|
| **KRITIS** | Hasil salah besar, diam-diam, dan **terlihat lolos SNI** pada kasus yang umum |
| **TINGGI** | Hasil salah atau aplikasi tidak bisa dipakai pada kasus yang cukup umum |
| **SEDANG** | Hasil bergantung pada cara modeling, atau ada celah pengaman |
| **RENDAH** | Kenyamanan, pesan, kosmetik |

## Ringkasan

| ID | Tingkat | Tahap | Temuan |
|---|---|---|---|
| A3-01 | KRITIS | Material | Material default = kaca terbaik di katalog, tidak disimpulkan dari nama, tidak wajib dikonfirmasi — **diperbaiki** |
| A3-02 | TINGGI | Peneduh | Peneduh berjarak dari fasad dihitung seolah menempel; ada "tebing" ke nol di 1 m — **diperbaiki** |
| A3-03 | TINGGI | Klasifikasi | Nama yang salah dengan yakin: ACP/Metal Cladding → rangka, Hollow Core Wall → abaikan — **diperbaiki** |
| A3-04 | TINGGI | Performa | Model 24 lantai: hasil 22 MB JSON, memori puncak 319 MB → aplikasi tersendat |
| A3-05 | TINGGI | Baca file | 3DM berisi Brep/Extrusion tanpa render mesh → "tidak ada geometri" — **diperbaiki** |
| A3-06 | SEDANG | Klasifikasi | Cek geometri (AUDIT-03) hanya saat hitung; inspeksi dan hasil tidak konsisten — **diperbaiki** |
| A3-07 | SEDANG | Sisi luar | Dua massa dengan celah ≤ 1 m: fasad yang berhadapan dibuang tanpa peringatan — **diperbaiki** |
| A3-08 | SEDANG | Peneduh | Pelat balkon: dihitung atau tidak bergantung nama ("Slab" ya, "Pelat Lantai" tidak) — **diperbaiki** |
| A3-09 | SEDANG | CI | Paritas engine browser, hitung ulang LibreOffice, dan tes berbasis corpus selalu dilewati di CI — **diperbaiki** |
| A3-10 | SEDANG | Distribusi | `frontend/dist` lokal bisa basi tanpa peringatan; Node.js tidak ada di laptop pengembang — **diperbaiki** |
| A3-11 | SEDANG | Hitung | Mode simulasi: konduksi rangka 8% hanya ditambahkan bila model punya grup rangka — **diperbaiki** |
| A3-12 | RENDAH | Klasifikasi | Token belum dikenal: GL-01, Polycarbonate, Secondary Skin, Perforated, Pergola, Krepyak, Jalusi, Roster, Spandek, dll. — **sebagian besar diperbaiki** |
| A3-13 | RENDAH | Hitung | Mode SNI: muka depan mullion tidak masuk luas selubung A_o — **diperbaiki** |
| A3-14 | TINGGI | Tampilan | Daftar "Lihat catatan" di layar hasil menampilkan "[object Object]" — **diperbaiki** |
| A3-15 | SEDANG | Hitung | Ganti material cepat (`rematerial`) tidak memperbarui status/peringatan — **diperbaiki** |
| A3-16 | TINGGI | Tampilan | Mode simulasi/sementara ditampilkan sebagai "Memenuhi/Melebihi" (pakai `compliant` atau `ottv<=35`) — **diperbaiki** |
| A3-17 | SEDANG | Tampilan | Mode aktif tidak terlihat di Hasil/Presentasi; mode simulasi terbawa saat unggah model baru — **diperbaiki** |
| A3-18 | TINGGI | Hitung | Mode simulasi: kusen bawaan thermal break (U 2,10) dan SF tabel 2011 → U_f dan SF berbeda diam-diam dari mode SNI — **diperbaiki** |
| A3-19 | RENDAH | Belajar | Belajar OTTV memakai U kaca sebagai U_f (tanpa kusen) — **diperbaiki** |

Sudah diperbaiki selama audit (commit `d9238f1`, `71516e7`): nama jamak mullion/transom (AUDIT-01), `crown`
sebagai token kaca, nama elemen IFC tidak dibaca (WWR 0%), penjarangan mesh peneduh merusak tampilan, baseline
basi, face kembar (AUDIT-02), dan batang bernama kaca (AUDIT-03).

---

## A3-01 · KRITIS · Material default adalah kaca terbaik

**Bukti.** Kotak 20×30 m, 4 lantai, WWR 40%, layer bernama "Dinding Bata" dan "Kaca Bening":

| Material yang dipakai | OTTV (W/m²) |
|---|---|
| Default (IGU triple-silver SC 0,23 + spandrel insulasi) | **19,37 — lolos** |
| Kaca polos 8 mm (SC 0,92) + bata merah plester | **79,84** |
| IGU polos 6+12+6 (SC 0,80) + bata merah plester | 66,44 |
| Kaca tinted 8 mm (SC 0,60) + bata merah plester | 58,85 |

Model twisted dengan kaca polos 8 mm: 34,17 → **139,35**.

**Sebab.** `config_schema.DEFAULT_GLAZING_MAT_ID = "glz_igu_triple_silver"`, dan
`DEFAULT_WALL_MAT_ID = "wal_spandrel_insulasi_50"`. Nama layer ("Bening", "Clear", "Stopsol", "Bata", "Hebel")
tidak dipakai untuk memilih material, dan hasil tidak ditandai sementara bila material belum dipilih.
Dinding bata juga mendapat TD_ek 15 K milik spandrel ringan, bukan TD_ek dinding masif.

**Dampak.** Mahasiswa yang lupa atau tidak tahu cara memilih material akan mendapat "memenuhi SNI" untuk
desain yang sebenarnya jauh melampaui batas. Ini mengalahkan tujuan aplikasi.

**Usulan.**
1. Hasil berstatus **sementara** (`MATERIAL_NOT_CONFIRMED`) sampai pengguna memilih atau mengonfirmasi material.
2. Tebak material dari nama layer (Bening/Clear → kaca polos, Stopsol/Reflektif → reflektif, Low-E, IGU, Bata,
   Hebel/AAC, Beton, ACP, Spandrel), tampilkan sebagai saran yang perlu dikonfirmasi.
3. Pertimbangkan default yang netral, misalnya kaca polos dan bata, agar kesalahan cenderung konservatif, bukan optimis.

**Perbaikan (Nov 2026).** `settings.materials_confirmed` (default `false`). Selama belum dikonfirmasi, hasil
berstatus sementara dengan peringatan `MATERIAL_NOT_CONFIRMED` yang memuat saran material dari nama layer
(`backend/material_hints.py`, misalnya "Kaca Bening" → kaca polos 8 mm, "Hebel" → bata ringan AAC). Layar hasil
menampilkan kartu dengan tombol "Pakai saran dari nama layer" dan "Material sudah benar". Setiap pemilihan
material oleh pengguna dihitung sebagai konfirmasi. Saran tidak pernah diterapkan otomatis.

## A3-02 · TINGGI · Peneduh berjarak dihitung seolah menempel

**Bukti.** Kotak dasar 19,37. Kanopi menerus di atas tiap pita kaca:

| Kasus | OTTV |
|---|---|
| Kanopi 1,0 m menempel fasad | 14,72 |
| Kanopi 1,0 m, celah 0,2 m dari fasad | 14,24 (lebih baik dari menempel) |
| Kanopi 1,0 m, celah 1,0 m | 13,13 (= kanopi menempel 2,0 m) |
| Kanopi 1,0 m, celah 1,5 m | **19,37 (tiba-tiba nol)** |
| Kanopi 1,0 m, 0,5 m di atas kaca | 14,72 (sama dengan menempel) |
| Kanopi 1,0 m, 1,0 m di atas kaca | **19,37 (tiba-tiba nol)** |

**Sebab.** `_measure_panel_sni_shading_ratios` mengambil P_h dari tepi terjauh (`d_max`), tanpa mengurangi
celah dari fasad. Kandidat hanya diterima bila `d_min ≤ 1,0 m` dan tepi bawah ≤ `half_h + 0,80 m`, sehingga di
luar batas itu efeknya langsung hilang.

**Dampak.** Kisi atau secondary skin yang dipasang lepas dari fasad (kasus umum, termasuk Opsi A dengan sirip
lepas 3 cm) mendapat manfaat berlebih. Desain yang sedikit berubah bisa "jatuh tebing".

**Usulan.** Cocokkan dengan definisi R1/R2 di SNI 6389:2020 Lampiran A. Bila tabel SNI hanya untuk peneduh
menempel, gunakan proyeksi efektif `P − celah`, atau faktor proyeksi `P/(H + G)` untuk jarak vertikal.
Peralihannya harus halus (tanpa tebing), dan pengguna diberi peringatan bila ada peneduh lepas yang
diperlakukan dengan pendekatan.

**Definisi SNI (Lampiran A Kunci 1–3, Gambar 5–7).** R1 = P/H dan R2 = P/W dengan P panjang peneduh yang
**menempel tepat di tepi jendela**. SNI tidak mendefinisikan peneduh lepas atau lebih tinggi dari jendela.

**Perbaikan (Nov 2026).** Luas bayangan SNI (As = P·(cos Φ tan θ + sin Φ)) linear terhadap P dan dipotong tepi
jendela, sehingga peneduh selebar [celah, celah + kedalaman] = peneduh menempel selebar (celah + kedalaman)
dikurangi peneduh menempel selebar celah. Peneduh setinggi `rise` di atas jendela = bayangan pada bidang setinggi
(H + rise) dikurangi bayangan pada pita `rise`. Semuanya memakai tabel SC SNI yang sama (`_superposed_sceff`).
Peneduh menempel di tepi jendela tetap identik dengan SNI. Kombinasi sirip + overhang (G3 = G1 × G2, tidak linear)
memakai kedalaman efektif tanpa celah. Jangkauan dinaikkan ke 3 m. Peringatan informatif `SHADING_DETACHED_APPROX`.

| Kanopi 1,0 m | celah 0 | 0,2 | 0,6 | 1,0 | 1,5 | 2,5 m |
|---|---|---|---|---|---|---|
| OTTV sesudah | 14,72 | 15,41 | 16,88 | 17,78 | 18,39 | 18,99 |

| Kanopi 1,0 m | naik 0 | 0,3 | 0,5 | 1,0 | 2,0 m |
|---|---|---|---|---|---|
| OTTV sesudah | 14,72 | 15,72 | 16,31 | 17,51 | 18,92 |

Sisa: lompatan kecil (≈ 0,2–0,4 W/m²) saat peneduh melewati batas 3 m.

## A3-03 · TINGGI · Nama yang salah dengan yakin

Dari 94 nama layer nyata yang diuji, nama yang berakhir sebagai `unknown` relatif aman (hasil ditandai
sementara). Yang berbahaya adalah nama yang **salah tapi yakin**:

| Nama | Seharusnya | Terbaca | Akibat |
|---|---|---|---|
| Aluminium Composite Panel, Metal Cladding | dinding | rangka | dinding keluar dari luas selubung |
| Hollow Core Wall | dinding | abaikan (token `core`) | dinding hilang |
| Dinding Partisi Luar | dinding | abaikan (token `partisi`) | dinding hilang |
| Expanded Metal | peneduh | rangka | peneduh tidak dihitung |
| Rangka Kaca, Window Frame | rangka | kaca | sebagian tertolong cek geometri AUDIT-03 |
| Lantai | abaikan | atap | masuk RTTV |

**Usulan.** Token "material" (aluminium, metal) jangan otomatis berarti rangka bila ada kata
panel/cladding/composite. Kata `luar`/`exterior` membatalkan `partisi`/`core`. Tambahkan uji parametrik untuk
setiap nama di atas. Jangka panjang: template layer LUXA opsional.

**Perbaikan (Nov 2026).** Aturan baru di `loaders/classify.py`: panel/cladding logam = dinding; "hollow"
membatalkan "core"; kata "luar/exterior" membatalkan "partisi"; frasa dua kata untuk peneduh (secondary skin,
expanded metal, vertical garden); rangka kuat + kata kaca = rangka; "Lantai" saja = abaikan (bukan atap); token
baru untuk kaca, dinding, peneduh, atap, dan konteks. Uji: `tests/test_classify_names.py`. Hasil 94 nama nyata:
60 → 89 benar; sisanya `unknown` (aman). Dampak nyata: IFC Klassiqua 2026 berisi curtain wall bernama
"AluminiumCladding_2026" yang dulu terbaca rangka; kini dinding, luas selubung +158 m², OTTV 9,59 → 9,09.

## A3-04 · TINGGI · Hasil terlalu berat untuk browser

**Bukti.** Model twisted (24 lantai, 37 ribu face): 9,3 s di Python desktop, memori puncak 319 MB, hasil
**22,3 MB JSON**. Rinciannya: `panels` 17,9 MB, `shading_elements` 2,7 MB, `frame_elements` 1,6 MB.
Di Pyodide (WebAssembly) waktunya diperkirakan beberapa kali lebih lama. Ini cocok dengan keluhan bahwa situs
publik dan mode Presentasi terasa berat.

**Sebab.** Setiap panel mengirim sekitar 45 field, termasuk warna heatmap ganda (hex + RGB, tiga varian) dan
verifikasi teks, sebagai objek JSON.

**Usulan.** Kirim geometri panel sebagai array biner bertipe (`Float32Array` untuk vertex, `Uint8` untuk kode
kategori dan orientasi), hitung warna heatmap di viewer, dan kirim rincian per panel hanya saat panel diklik.
Targetnya di bawah 3 MB untuk model ini.

## A3-05 · TINGGI · Brep/Extrusion tanpa render mesh tidak terbaca

**Bukti.** File 3DM berisi satu Brep kaca dan satu Extrusion dinding (tanpa render mesh) menghasilkan
`ValueError: Tidak ditemukan geometri 3D pada file yang diunggah`.

**Sebab.** rhino3dm tidak punya mesher. Engine hanya membaca render mesh yang tersimpan. File dari
"Save Small", skrip, Grasshopper bake tertentu, atau Rhino Compute sering tidak menyimpannya.

**Usulan.** Tambahkan tesselasi cadangan untuk face planar (mayoritas geometri arsitektur): ambil loop tepi
Brep/Extrusion dan triangulasi poligonnya. Bila tetap gagal, pesannya harus jujur: "file berisi N objek Brep
tanpa render mesh; buka di Rhino, jalankan `RefreshShade`/simpan tanpa Save Small".

**Perbaikan (Nov 2026, commit `1527235`).** Tesselasi cadangan `BrepFace` planar (ear clipping + dukungan loop dalam/lubang via jembatan Eberly) ditambahkan di jalur Python (`backend/loaders/rhino.py`, `backend/universal_pipeline.py`) dan jalur browser (`frontend/src/engine/rhinoExtract.js`), aktif otomatis saat file `.3dm` menghasilkan 0 render mesh (murni `SaveSmall` / Brep + Extrusion). Face non-planar tetap masuk `missing_mesh`; bila seluruh file non-planar, pesan error menyebut jumlah objek/permukaan dan menyarankan `RefreshShade` atau simpan ulang tanpa `SaveSmall`. Pada file campuran, peringatan `MISSING_MESH` menyebut jumlah objek yang dilewati dan menyarankan simpan ulang dari Rhino tanpa `SaveSmall`. Baseline 0 selisih; paritas browser lulus (≤ 0,01 W/m²).

## A3-06 · SEDANG · Inspeksi dan hasil tidak konsisten

Cek geometri AUDIT-03 berjalan di `analyze_building_ottv`, bukan di tahap 1–2. Di layar inspeksi, grup
`CW_Vertical` masih tertulis "kaca", lalu menjadi "rangka" di hasil. **Usulan:** jalankan `looks_like_frame`
pada tahap klasifikasi, dan tampilkan peringatannya di inspeksi agar pengguna memutuskan sebelum menghitung.

**Perbaikan (Nov 2026).** `looks_like_frame` dijalankan di `universal_pipeline` (tahap 2). Grup yang
direklasifikasi membawa `geometry_reclassified_from`, tampil di inspeksi dengan status "review" dan alasannya,
dan engine hanya melaporkannya (`GEOMETRY_RECLASSIFIED`). Pilihan pengguna tetap menang.

## A3-07 · SEDANG · Celah sempit antar massa

Dua massa 20×10 m berhadapan:

| Celah | Kaca geometri | Kaca terhitung |
|---|---|---|
| 6,0 m | 691,2 | 691,2 |
| 2,0 m | 742,4 | 742,4 |
| 1,0 m | 755,2 | **627,2** |
| 0,5 m | 761,6 | **633,6** |

Pada celah ≤ 1 m, fasad yang berhadapan dianggap fasad dalam. Secara fisik masih udara luar (walau sangat
terbayangi), dan pengguna tidak diberi tahu. **Usulan:** tampilkan peringatan "N m² fasad dianggap dalam karena
berhadapan dengan massa lain berjarak < X m", dengan opsi menghitungnya.

**Perbaikan (Nov 2026, commit `ffb6467`).** Ditambahkan deteksi celah sempit `< 1,5 m` (terbuka ke langit agar tidak salah menandai koridor beratap) di `detect_exterior_faces_raycast()` dan `resolve_group_outer_skin_faces()`, yang mengeluarkan peringatan informatif `NARROW_GAP_FACES` (luas m² dan daftar grup) di `summary.warnings` tanpa mengubah angka OTTV maupun status provisional. Teruji di `tests/test_invariants.py` (celah 1,0 m → peringatan muncul; 6,0 m → tidak); baseline 0 selisih.

## A3-08 · SEDANG · Pelat balkon bergantung nama

Pelat 1,5 m di atas tiap pita kaca: "Kanopi" dan "Overhang Beton" → 13,71, "Slab" (terbaca atap) → 13,71,
sedangkan "Plat Balkon" dan "Balkon" (unknown) serta "Pelat Lantai" (abaikan) → 19,37. Hasil untuk apartemen
dengan balkon akan sangat bergantung pada penamaan. **Usulan:** pelat horizontal yang menjorok keluar dari
garis fasad diperlakukan sebagai peneduh berdasarkan geometri, apa pun namanya, dengan peringatan.

**Perbaikan (Nov 2026).** Bidang horizontal dari grup abaikan/tak dikenal ikut diperiksa sebagai peneduh SNI.
Bagian di belakang fasad tidak pernah berada "di depan kaca", jadi yang terhitung hanya bagian yang menjorok
(balkon, pelat kantilever). Peringatan `GEOMETRY_SLAB_SHADING` menyebut grup dan jumlah panelnya. Dampak nyata:
fixture unitized berisi pelat "08_Structure_Slab_Core" yang menjorok hingga 3 m di luar kaca pada beberapa
lantai; kini meneduhi, OTTV 26,79 → 25,03.

## A3-09 · SEDANG · Tes penting selalu dilewati di CI

- `test_browser_engine_parity.py` dilewati bila aset engine browser belum di-build, dan CI tidak mem-build-nya.
  Artinya **engine yang benar-benar dipakai pengguna (Pyodide) tidak pernah diuji otomatis**.
- `test_luxa_report.py::test_libreoffice_recalculation_matches_app` dilewati tanpa LibreOffice.
- Tes yang memakai `corpus/real` dan Duplex IFC dilewati karena `corpus/` di-gitignore.

**Usulan:** di `tests.yml`, jalankan `bash scripts/fetch_engine_assets.sh` + `npm run engine:assets`, pasang
LibreOffice, dan pindahkan satu atau dua model nyata kecil ke `fixtures/`.

**Perbaikan (Nov 2026, commit `5ff7ed5`).** `.github/workflows/tests.yml` kini meng-cache `frontend/.engine-cache`, menjalankan `bash scripts/fetch_engine_assets.sh` dan `npm run engine:assets`, memasang `libreoffice-calc`, serta menjalankan `python -m pytest -q -rs`. Model publik buildingSMART `Duplex_A_20110907.ifc` (2,27 MB) disalin ke `fixtures/real/` agar `test_ifc_duplex_uses_ifc_storeys` berjalan di CI (`Facade only to Alfian.3dm` tetap lokal di `corpus/`). Verifikasi akhir di GitHub Actions berjalan setelah `git push`.

## A3-10 · SEDANG · Build lokal bisa basi

`start_studio.bat` menyajikan `frontend/dist` tanpa memeriksa apakah build itu lebih lama dari kode sumber.
Di laptop pengembang tidak ada Node.js, sehingga `dist` tertinggal sejak 23 Nov tanpa ada yang tahu.
**Usulan:** peringatan di `start_studio.bat`/`run_studio_servers.py` bila `src/` atau `backend/` lebih baru dari
`dist/index.html`, dan pasang Node.js LTS di laptop pengembang.

**Perbaikan (Nov 2026, commit `86f953b`).** Ditambahkan `check_stale_build()` dan `warn_if_build_stale()` di `backend/run_studio_servers.py` sebelum menyajikan `frontend/dist`, membandingkan mtime terbaru di `frontend/src/` dan `backend/**/*.py` terhadap `frontend/dist/index.html` lalu mencetak peringatan jelas menyarankan `cd frontend && npm run build` (memerlukan Node.js 20 LTS). Teruji otomatis di `tests/test_stale_build_warning.py` (4 uji) dan verifikasi langsung pada repositori.

## A3-11 · SEDANG · Konduksi rangka bergantung detail model (mode simulasi)

`frame_cond_adder = U_frame × 8% × ΔT` hanya ditambahkan bila `len(frame_groups) > 0`. Model yang memodelkan
mullion mendapat OTTV lebih tinggi daripada model yang sama tanpa mullion. **Usulan:** terapkan rasio rangka
pada semua kaca (atau hitung dari luas muka rangka terukur), tidak bergantung ada atau tidaknya grup rangka.

**Perbaikan (Nov 2026, T5).** `frame_cond_adder` lama dihapus di `backend/ottv_engine.py` dan `backend/recommender.py`.
Kedua mode (SNI dan simulasi) kini memakai perhitungan `U_f` tiga zona yang sama (`compute_three_zone_uf`, mengacu SNI
6389:2020 butir 4.3.2.2 & Lampiran C) dengan katalog `U_frame` Tabel 3 (aluminium/metal 8,0; kayu 3,0; vinyl/plastik 2,0;
thermal break tidak menurunkan `U_frame` di mode SNI). Teruji di `tests/test_three_zone_uf.py`.

## A3-12 · RENDAH · Token yang belum dikenal

Kaca: GLS, GL-01, Polycarbonate, Vitrage, Glazed Panel. Dinding: WPC, Roster, Batu Alam, Sandwich Panel,
Exterior Finish. Peneduh: Secondary Skin, Perforated Panel, Tirai Bambu, Pergola, Vertical Garden, Krepyak,
Jalusi. Atap: Spandek. Konteks: Tangga, Toilet, Parkir, Mobil, Manusia, Kontur. Semuanya aman (menjadi
`unknown` → hasil sementara), tetapi merepotkan pengguna.

## A3-13 · RENDAH · Muka depan mullion di luar A_o (mode SNI)

Grup rangka tidak menyumbang luas selubung. Muka depan profil (biasanya 3–5% luas fasad curtain wall)
semestinya termasuk fenestrasi. Dampaknya kecil, tetapi perlu diputuskan dan didokumentasikan.

**Perbaikan (Nov 2026, T5).** Fenestrasi kini dihitung sebagai kaca + kusen (`_measure_frame_groups_for_panels` +
`compute_three_zone_uf`). Hanya muka depan rangka yang sejajar fasad (`|cos| ≥ 0,90`) yang dihitung (sisi samping &
kedalaman dibuang); muka kusen menggantikan luas di belakangnya tanpa menambah `A_o` (selisih `A_o` dengan vs tanpa
rangka 0,0% ≤ 3% di semua model), dan muka kusen yang berbatasan dengan spandrel/dinding masuk ke dinding, bukan
fenestrasi. `U_f` dihitung per lembar kaca utuh (komponen tersambung), disertai peringatan review (`FRAME_REVIEW_NEEDED`)
bila `r < 5%`, `r > 30%`, atau lebar kusen `> 200 mm`. Bila tidak ada grup rangka, kusen dihitung di dalam bukaan panel
memakai isian baru `settings.frame_width_mm` (bawaan 50 mm, ikut `materials_confirmed`, dan menampilkan catatan "Lebar
kusen asumsi"). Nilai `U kaca → U_f`, `A_frame`, `A_edge`, fraksi `r`, lebar kusen, dan sumbernya (`terukur`/`asumsi
pengguna`) beserta rujukan SNI 6389:2020 butir 4.3.2.2 dan Tabel 3 tampil di UI Hasil serta laporan Excel dan PDF.
Teruji di `tests/test_three_zone_uf.py` dan paritas browser `tests/test_browser_engine_parity.py`.

---

## Audit pasca-T5 (25 Nov 2026)

### A3-16 · TINGGI · Status 4 kondisi (`verdict`) — diperbaiki (`f4ff3e3`)

**Temuan.** Layar hasil, presentasi, dan laporan memakai `compliant` atau `ottv <= 35`, sehingga hasil mode
simulasi (mis. 23,98) atau hasil sementara bisa tampil sebagai "Memenuhi", dan selisih ditulis dengan `Math.abs`.
**Perbaikan.** Engine mengembalikan `verdict ∈ {memenuhi, melebihi, simulasi, sementara}` dari
`resolve_result_status` (juga di `rematerial` dan payload ramping). Semua tampilan memakai
`frontend/src/ui/verdict.js`; simulasi/sementara berlabel netral, selisih ditulis bertanda ("Di bawah batas X" /
"Lewat X"). Uji: `tests/test_verdict_4_states.py`.

### A3-17 · SEDANG · Mode terlihat — diperbaiki (`0929300`)

**Perbaikan.** Lencana "Mode SNI"/"Mode Simulasi" di Hasil dan Presentasi, tombol "Kembali ke mode SNI", dan mode
kembali ke SNI setiap kali model baru diunggah atau contoh dimuat.

### A3-18 · TINGGI · Paritas mode SNI vs Simulasi — diperbaiki (`44ae5cc`)

**Temuan.** Pada `Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm` (Jakarta, bawaan): geometri, `A_frame`, `A_edge`,
lebar kusen, konduksi dinding identik, tetapi (1) kusen bawaan `frm_aluminium_thermal_break` membuat mode simulasi
memakai `U_frame` 2,10 (U_f 1,354; konduksi kaca 5,46) sementara SNI memakai 8,0 (U_f 2,854; 11,51), dan (2) SF mode
simulasi diinterpolasi dari tabel 2011 lama (rata-rata 147,36 vs Tabel 8 SNI 156,55; sisi Timur 110 vs 171).
**Perbaikan.** Kusen bawaan = `frm_aluminium_standar` (8,0); mode simulasi menginterpolasi SF Tabel 8 kota aktif
(`sf_multiplier` hanya untuk EPW kustom). Angka mode SNI tidak berubah (baseline 0 selisih). Tabel per suku dan
penjelasan selisih: `docs/PARITAS_MODE_SNI_SIMULASI.md`. Uji: `tests/test_mode_parity.py`.

### A3-19 · RENDAH · Belajar OTTV memakai U_f tiga zona — diperbaiki

**Perbaikan.** `frontend/src/learn/ottvCalc.js` → `threeZoneUf` (sama dengan `compute_three_zone_uf`), dipakai
`learn3d/sim.js` dengan kusen aluminium 8,0 lebar 50 mm pada panel contoh 1,5 m × tinggi kaca. Materi menambah
kalimat jembatan termal (SNI 3.8, 4.3.2.2). Uji: `tests/test_learn3d_uf.py` (Lampiran C 4,75 dan cocok dengan engine).

---

## Yang terbukti kokoh

- Rotasi model + arah utara, satuan (m/cm/mm), koordinat UTM, elevasi tidak nol.
- Triangulasi, normal terbalik, satu objek per face.
- Paritas format 3DM, OBJ, GLB, termasuk menara twisted.
- Atrium (kaca dalam tidak dihitung), podium + tower (13 lantai), balkon menjorok, dinding interior,
  pelat lantai bernama jelas, bangunan konteks.
- Hitungan SNI kotak dasar cocok dengan hitung tangan (U 18,05 · T 20,16 · S 14,74 · B 22,56 → 19,37).
- Pesan galat untuk file kosong atau rusak sudah jelas.

## Urutan perbaikan yang diusulkan

1. **A3-01** material: dampaknya terbesar dan perbaikannya relatif kecil (status sementara + saran dari nama).
2. **A3-02** peneduh berjarak: verifikasi definisi SNI dulu, lalu perbaiki dengan uji kontinuitas.
3. **A3-03 + A3-12** klasifikasi: aturan + token + uji parametrik nama.
4. **A3-06 + A3-08** cek geometri dipindah ke tahap inspeksi, pelat menjorok sebagai peneduh.
5. **A3-04** diet payload (paling besar pekerjaannya, paling terasa bagi pengguna).
6. **A3-05, A3-07, A3-09, A3-10, A3-11, A3-13**.
