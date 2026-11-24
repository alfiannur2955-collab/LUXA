# Log Pengerjaan LUXA (otomatis dari git)

Dibuat 24 Nov 2026 23:40 WIB oleh `tools/log_pengerjaan.py`. Jangan edit manual; jalankan ulang skripnya.
Ringkasan naratif dan angka hasil ada di `docs/LOG_PENGERJAAN.md`.

Total 217 commit dalam 4 hari kerja.

| Tanggal | Commit | Jam pertama–terakhir (WIB) |
|---|---|---|
| Sabtu, 21 Nov 2026 | 32 | 17:35–23:09 |
| Minggu, 22 Nov 2026 | 115 | 01:04–23:57 |
| Senin, 23 Nov 2026 | 41 | 00:37–21:55 |
| Selasa, 24 Nov 2026 | 29 | 01:35–23:31 |

## Sabtu, 21 Nov 2026

| Jam | Commit | Perubahan |
|---|---|---|
| 17:35 | `6da0eb5` | baseline sebelum audit |
| 17:39 | `bc33447` | fase-0: baseline & tooling |
| 17:44 | `09146cb` | fase-1(M1): lewati InstanceDefinitionObject di loop top-level .3dm |
| 17:44 | `94d2ed0` | fase-1(M9): anak blok Rhino pakai layer/material sendiri dan cek visibilitas semua kedalaman |
| 17:45 | `03a6708` | fase-1(M3): catat Brep/Surface tanpa render mesh ke audit.missing_mesh tanpa tessellate UnderlyingSurface |
| 17:49 | `ab0e5be` | fase-1(M4/M5/M6): catat filtered_items + restore_filtered, hapus stride destruktif, simpan kaca miring |
| 17:50 | `1fe1448` | fase-1(M7): klasifikasi per token ID/EN dengan kategori unknown & ignore + tests/test_classify.py |
| 17:51 | `b048bb2` | fase-1(M8): pecah grup dengan kategori campur menjadi sub-grup per kategori |
| 17:51 | `b60659d` | fase-1(M2): hitung z_ground_offset_m dari storey BIM atau geometri selubung saja |
| 17:52 | `5da3c88` | fase-1(M10): tandai audit.unit_needs_confirmation=True bila satuan ditebak dari bbox |
| 17:55 | `450119e` | fase-1(M11): satu fungsi luas sisi luar dipakai bersama di Inspeksi dan Hasil |
| 17:58 | `3bdbf97` | fase-1(M12): hapus klaim perbaikan normal di SOFTWARE_PROFILES dan SketchUpMeshAdapter |
| 17:59 | `b3a6142` | fase-1: hapus fallback parser IFC STEP (_parse_ifc_file) dan wajibkan IfcOpenShell |
| 18:05 | `b36d5b4` | fase-1(M7): tolak koersi diam-diam grup unknown jadi wall di ottv_engine & dukung ottv_error di compare_baseline |
| 18:07 | `bf6c74e` | fase-1: dokumentasi changelog M1-M12 dan penjelasan selisih baseline |
| 18:21 | `7eff01a` | fase-1b: summary.is_provisional/warnings, aturan klasifikasi baru, fixture GLB bangunan nyata, pindah docs & revisi changelog |
| 18:21 | `5d77302` | Merge branch 'fase-1-geometri' (Fase 1 + 1b Ketepatan Geometri M1-M12) |
| 18:38 | `9cd1a93` | fase-2: ProjectConfig v2, unified API endpoints, resolve_material, status provisional & test_api |
| 19:04 | `9a005c1` | fase-3: tabel SNI 6389:2020, mode sni/simulasi, RTTV, custom_materials, Hitungan Manual & test_sni_manual |
| 20:13 | `47307ca` | fase-3b: errata SCeff, sumber SF template_prodi, katalog generik, Hitungan Manual per kombinasi, pengisi XML template prodi |
| 21:05 | `55081a4` | fase-3c: template_method parity BO scef, skylight min_dim > 0.3m (sisi_tebal_panel), uji LibreOffice 0.05 W/m2 |
| 21:05 | `93750e9` | Merge branch 'fase-3-sni' into main |
| 21:20 | `feefac9` | fase-1c: perbaiki B1 IfcPlate opak (Alfian 0.00 W/m2 antarformat) & ganti archicad_bim_curtainwall.ifc ke IFC4 |
| 21:21 | `99832df` | fase-1c: snapshot_baseline & compare_baseline pakai ProjectConfig() default (mode sni) |
| 21:51 | `34e5e1d` | feat(fase-1c): 21 synthetic cases, analytical test suite, and engine fixes B2-B5 |
| 22:19 | `563c280` | feat(fase-1c): add Tier B public BIM corpus fetcher (8/8 models) |
| 22:34 | `e59d81b` | feat(fase-1c): model report (A/B/C), Tier B fixes B6-B7, and case 22 regression |
| 22:52 | `365371d` | fix(fase-1d/K1): content-hashed raycast cache and complete file/param cache keys |
| 22:56 | `bedd944` | fix(fase-1d/K2): remove silent default_wall_wwr=0.35, emit NO_GLAZING/ASSUMED_WWR, add case 23 |
| 22:58 | `674c70d` | fix(fase-1d/K3): weight avg_sc_effective strictly by glazing area across engine, report, and UI |
| 23:01 | `454f302` | fix(fase-1d/K5): set detected_unit=None and unit_source=bbox_guess for headerless formats |
| 23:09 | `7007f2e` | docs(fase-1d): commit spec/verifikasi docs, update RAPOR_MODEL, CHANGELOG, and random-order pytest hook |

## Minggu, 22 Nov 2026

| Jam | Commit | Perubahan |
|---|---|---|
| 01:04 | `073f027` | Merge branch 'fase-1d-perbaikan' into main |
| 01:07 | `d825c15` | fase-4a: identitas LUXA |
| 01:13 | `d0885b1` | fase-4a: backend build_sanity_flags, contoh bawaan, dan tes |
| 01:15 | `9305b19` | fase-4a: arsitektur modul inti (state, engine, project, ui, shell, viewer) |
| 01:16 | `892add5` | fase-4a: layar Unggah, Memuat, dan Galat |
| 01:17 | `61fe1a3` | fase-4a: layar Konfirmasi (Kartu Konfirmasi floating glass) |
| 01:18 | `901af9c` | fase-4a: layar Inspeksi (Grup terdeteksi & Daftar kejanggalan) |
| 01:24 | `7ff544f` | fase-4a: layar Hasil, kartu fitur rel, hapus kode lama, dan CHANGELOG-fase4.md |
| 01:41 | `ad83498` | fase-4a: poles responsif topbar, tinggi viewer, dan tabel grup |
| 01:47 | `995ac05` | Merge branch 'fase-4a-kerangka' into main |
| 01:49 | `e576314` | docs: sinkron RENCANA (review 4a) |
| 01:50 | `f93390f` | fase-4b1: perbaikan review 4a |
| 01:53 | `b749b62` | fase-4b1: kamera 4 proyeksi, tampak 8 arah + Atas, dan gizmo sumbu |
| 01:56 | `960ec21` | fase-4b1: view tersimpan (.ottv.json) dan capture PNG 1x/2x/4x dengan cap |
| 01:58 | `c807b48` | fase-4b1: pil bawah viewer, pie menu tahan V, dan panel Tampilan bagian Kamera |
| 02:01 | `2355a1c` | fase-4b1: pintasan keyboard, palet perintah Ctrl K, daftar pintasan ?, dan CHANGELOG |
| 02:08 | `8fd0eac` | fase-4b1: bungkus pil bawah viewer agar tidak terpotong di layar sempit |
| 02:23 | `9dc8dce` | docs: sinkron RENCANA (review 4b-1) |
| 02:23 | `e971877` | Merge branch 'fase-4b1-kamera' into main |
| 02:32 | `00746c5` | docs: sinkron RENCANA (mekanisme deteksi lantai R4) |
| 02:32 | `86970f5` | fase-4b2: perbaikan review 4b-1 |
| 02:46 | `20c054e` | fase-4b2: deteksi lantai bertingkat (R4) |
| 02:49 | `19feed2` | fase-4b2: endpoint GET /api/analyses/{id}/exposure dan tes |
| 02:56 | `c424cae` | fase-4b2: seleksi panel, label HTML kaca, Bidang terpilih, dan 5 mode viewer |
| 03:00 | `a544c7b` | fase-4b2: kubah matahari, kompas utara interaktif, dan filter paparan matahari |
| 03:03 | `0522d41` | fase-4b2: pil rumus interaktif dan CHANGELOG-fase4.md |
| 03:11 | `9f44907` | fase-4b2: poles catatan R4 di Konfirmasi dan migrasi floor_height_m lama |
| 03:46 | `68cd8aa` | docs: sinkron RENCANA, FASE4_UI_SPEC, dan mockup (review 4b-2 & skala heatmap kontinu) |
| 03:48 | `7f9fef3` | Merge branch 'fase-4b2-analisis' into main |
| 03:56 | `9073497` | fase-4c: perbaikan review 4b-2 |
| 04:02 | `1c8126a` | fase-4c: mode Bandingkan viewer terbelah dan tes elektrokromik 27,71 W/m2 |
| 04:06 | `2ed9676` | fase-4c: workspace v1 (Belajar, Lanjut, Presentasi) dan kustomisasi dock |
| 04:49 | `d01cc5b` | fase-4c: panel Material, Lokasi, Laporan, Bantuan dan tooltip istilah SNI |
| 05:02 | `705cbac` | fase-4c: poles aksesibilitas & responsif, UJI_PENGGUNA_FASE4.md, dan CHANGELOG-fase4.md |
| 05:18 | `bec1b48` | fase-4c: poles Escape di Presentasi dan tata letak viewer 1280px |
| 10:37 | `debe9eb` | docs: sinkron RENCANA (review 4c) |
| 10:42 | `771d105` | fase-4c-akhir: warna fasad Heatmap & Orientasi cocok legenda (T1) |
| 10:45 | `f0fbd8d` | fase-4c-akhir: legenda di atas pil bawah tanpa tertutup di 1280 & 1440px (T2) |
| 10:48 | `2d97b1d` | fase-4c-akhir: tata letak responsif <= 860px pindah kontrol ke bawah viewer (T3) |
| 10:50 | `ece3c91` | fase-4c-akhir: nama alternatif dua baris dan tombol penuh di Bandingkan (T4) |
| 11:05 | `dc8f33f` | fase-4c-akhir: jaga posisi pil rumus 1240px dan catatan CHANGELOG-fase4.md |
| 11:05 | `599ed29` | Merge branch 'fase-4c-poles' into main |
| 11:56 | `8f78631` | docs: sinkron RENCANA (review 4c-akhir, Fase 4d & 4e), material_library.json, dan ref-heatmap-halus.png |
| 12:00 | `7ceabf4` | fase-4-sisa: perbaikan Z1 (pil rumus 1280px) dan Z2 (NODE_EXE & timeout 60s) |
| 12:00 | `6854123` | Merge branch 'fase-4-sisa' into main |
| 12:05 | `c5b64c1` | fase-4d: samakan SC_TO_SHGC_RATIO ke 0,87 dan tambah sun_dome_radius_m di skema |
| 12:11 | `8dda36a` | fase-4d: skala kubah manual (D1) dan rotasi utara cincin gaya D5 (D2) |
| 12:15 | `551a0d1` | fase-4d: heatmap Halus 1mm + normal <30deg + palet pastel dan mode Orientasi (D3) |
| 12:22 | `66edbdf` | fase-4d: audit CRUD + Urungkan 8 dtk + proyek browser (D4), tes 4d, dan CHANGELOG |
| 12:22 | `e0b98b8` | Merge branch 'fase-4d-kontrol' into main |
| 12:41 | `0a544d2` | fase-4e: katalog 62 brand JSON, validasi stateless, rematerial cepat, dan backend/recommender.py |
| 12:59 | `d38b9f3` | fase-4e: katalog material kartu persegi, rematerial cepat, CRUD lokal, dan tab rekomendasi |
| 13:00 | `e57b771` | Merge branch 'fase-4e-katalog' into main |
| 13:20 | `1a77242` | review 4d/4e: heatmap Halus per jenis elemen, pegangan kubah terlihat, poles rekomendasi |
| 13:20 | `09ad460` | Merge branch 'fase-4-review-fix' into main |
| 13:50 | `556fded` | fase-5a: spike engine di browser (Pyodide 0.29.5 + IfcOpenShell WASM + rhino3dm.js) |
| 13:50 | `c0d03ea` | Merge branch 'fase-5a-spike' into main |
| 13:51 | `3988086` | docs: sinkron RENCANA (review 4d/4e, hasil Fase 5a, prompt 5b) |
| 14:13 | `425b1a5` | fase-5b (wip): engine browser — browser_api, worker Pyodide, klien lokal, aset & service worker |
| 14:34 | `b42982a` | fase-5b: engine browser siap pakai — paritas, fallback template, deteksi .3dm, deploy Pages |
| 14:34 | `8796143` | Merge branch 'fase-5b-browser' into main |
| 14:35 | `7c65663` | docs: sinkron RENCANA (hasil Fase 5b, prompt 6 mulai dari K4) |
| 15:42 | `7c11977` | contoh publik "Fasad tower twisted" dan template laporan ikut di setiap build |
| 15:43 | `06fe779` | Merge branch 'fase-5b-poles' into main |
| 15:47 | `10da8eb` | docs: sinkron RENCANA (keputusan 22 Nov sore, rencana Fase 5c template LUXA) |
| 16:06 | `e68601d` | fase-5c: laporan Excel LUXA menggantikan template lama; SF default SNI 2020, SC = SHGC/0,87 |
| 16:16 | `51d39d1` | fase-5c: changelog, checklist publish, sinkron RENCANA |
| 16:16 | `c7189fc` | Merge fase-5c-template-luxa: laporan Excel LUXA, SF default SNI 2020, SC = SHGC/0,87 |
| 16:27 | `83b4c66` | fase-6: hapus kode mati (loader lama di ottv_engine, generator contoh, fungsi tak terpakai) |
| 16:29 | `b4d870b` | fase-6: versi tunggal di backend/version.py; tes lama diganti tests/test_core_units.py |
| 16:34 | `9b9b457` | fase-6: pecah universal_pipeline.py per bagian ke backend/loaders/ |
| 16:36 | `11ad8f1` | fase-6: README untuk mahasiswa, workflow pytest, bersihkan file sisa di root |
| 16:38 | `d5c13ee` | fase-6: tes warna heatmap dilewati bila node_modules belum ada; CI memasang dependensi frontend |
| 16:40 | `253fe6c` | fase-6: changelog dan sinkron RENCANA |
| 16:41 | `9cfa313` | Merge fase-6-cleanup: kode mati, loaders/, versi tunggal, README, CI |
| 17:21 | `55f85d4` | perbaikan: seret putar utara tidak lagi macet (kursor kepalan permanen) dan tidak lag |
| 17:23 | `9f93da9` | Merge perbaikan-putar-utara: seret putar utara tidak macet dan tidak lag |
| 17:28 | `c3e7d57` | ui: bar bawah viewer jadi satu baris, pintasan tampilan pakai ikon |
| 17:28 | `c0b6287` | ui: legenda heatmap lebih ringkas agar muat satu baris |
| 17:29 | `7dcba89` | ui: rapatkan jarak bar bawah |
| 17:30 | `e6615ca` | ui: ikon bar bawah sedikit lebih kecil di layar <= 1400 px agar tetap satu baris |
| 17:30 | `f7f7917` | Merge ui-bar-satu-baris: bar bawah viewer satu baris dengan ikon |
| 17:43 | `d59b4db` | sw: halaman dicek ulang ke server setiap dibuka supaya deploy baru langsung terlihat |
| 17:57 | `60d8f7c` | viewer: Orientasi pakai roda warna pastel OKLCH dan ikut mewarnai rangka/peneduh; Heatmap Halus dihitung per titik dari azimut |
| 18:00 | `839f757` | viewer: Heatmap Halus memakai skala relatif model (Rendah -> Tinggi) dengan legenda rentang nilai |
| 18:02 | `419727c` | Merge halus-azimut: Orientasi roda warna pastel, Heatmap Halus per titik dengan skala relatif |
| 18:07 | `061bdcc` | viewer: Heatmap Halus menampilkan paparan matahari (SF menurut azimut x peneduh), Orientasi dikembalikan |
| 18:09 | `c9870ae` | ui: legenda paparan matahari ringkas (angka rendah - W/m2 - tinggi) |
| 18:09 | `3b403c9` | Merge heatmap-paparan: Halus = paparan matahari mulus, Orientasi dikembalikan |
| 18:18 | `f71486b` | lokasi: SF Tenggara tampil (kunci TG/TGR) |
| 18:21 | `255a5e1` | audit UI: mode Paparan di bar utama, toast kecil di pojok, kartu kiri mendorong area kerja, tanpa geser horizontal |
| 18:25 | `6372adc` | toast: di pojok kanan bawah area 3D, di atas bar viewer (tidak menutupi tombol atau kartu) |
| 18:29 | `13a3a25` | viewer: label 'Matahari jam - tinggi - azimut' tidak lagi melayang (jadi tooltip jam di bar bawah) |
| 18:30 | `4a24c3b` | tes: material warna akurat juga untuk mode Paparan |
| 18:32 | `3d4a781` | Merge audit-ui: rapikan tumpukan UI, mode Paparan, toast kecil, kartu tanpa geser horizontal |
| 18:45 | `c0ce389` | bandingkan: alternatif matikan grup dan model lain; analisis utama dipin di engine browser |
| 18:51 | `8b2f809` | bandingkan: toast tidak menumpuk kartu selisih, tab ringkas, catatan katalog hanya bila material berubah |
| 18:53 | `f12f10c` | tes: analisis utama dipin bertahan saat model lain dihitung; matikan grup peneduh mengubah OTTV |
| 18:54 | `abeac32` | tes: batas penyimpanan analisis mengikuti MAX_STORED_ANALYSES dan pin |
| 18:57 | `55cae93` | Merge bandingkan-model: alternatif matikan grup dan model lain |
| 19:20 | `75bd79e` | ui: tombol Lanjut ke Inspeksi beranimasi saat memproses; daftar grup Inspeksi dirapikan |
| 20:31 | `947befa` | ui: judul kartu Inspeksi satu baris, chip status tidak terlipat |
| 20:31 | `f4585db` | ui: kartu Grup terdeteksi ikut aturan judul satu baris |
| 20:34 | `fb57f5e` | Merge busy-dan-grup: animasi proses Lanjut ke Inspeksi, daftar grup Inspeksi rapi |
| 20:37 | `fa36c2e` | viewer: tombol 'terkena matahari jam ini' di bar bawah, gradasi sudut datang, angka ringkas di legenda |
| 20:40 | `1fcdcaa` | ui: legenda terkena matahari ringkas (jam · persen · arah), detail di tooltip |
| 20:44 | `129e10e` | ui: legenda terkena matahari muat satu baris di layar <= 1400 px |
| 20:46 | `f1a8490` | Merge terkena-matahari: tampilan fasad terkena matahari pada jam aktif |
| 21:37 | `99df898` | capture: legenda, OTTV, label di model, info proyek; dua tata letak; capture Bandingkan |
| 22:45 | `3118f00` | Capture: tunggu viewer terpasang ulang, label ikut, tabel selisih tidak bertabrakan |
| 22:46 | `2774648` | Merge capture-lengkap: export gambar lengkap (legenda, OTTV, label, info, Bandingkan) |
| 22:59 | `1567ad1` | Kompas hidup: jarum ikut kamera, klik = hadap utara |
| 22:59 | `e0ca74a` | Merge kompas-hidup |
| 23:57 | `a27a180` | Audit tampilan: 4 mode + 2 alat periksa, Matahari gabungan, bar bawah & kartu Tampilan dirapikan, istilah diganti |
| 23:57 | `9ac0354` | Merge audit-tampilan |

## Senin, 23 Nov 2026

| Jam | Commit | Perubahan |
|---|---|---|
| 00:37 | `c2176b2` | Dok bawah dua tingkat, kartu samping melayang, warna Matahari selaras, rumus pindah ke kartu Per arah |
| 00:37 | `e23cfe8` | Merge dok-warna-rumus |
| 00:59 | `031723a` | Skala warna Matahari sepanjang tahun bisa diatur: Tetap SNI / Otomatis / Kustom |
| 00:59 | `f2dde98` | Merge skala-matahari |
| 01:10 | `5daa3f1` | Export gambar: panel info jadi kartu kaca melayang |
| 01:10 | `b051841` | Merge export-kaca |
| 06:29 | `0296f4d` | RTTV jadi opsional (Mode lanjut), skylight ditandai pengguna; satu tombol rumus |
| 06:29 | `2fb9ea5` | Merge rttv-opsional |
| 07:59 | `ec7c6ca` | Beranda, Belajar OTTV (7 bab + bonus RTTV), video demo, dan maskot Lux |
| 07:59 | `29fb21e` | Merge beranda-belajar-lux |
| 09:38 | `bbfe112` | Belajar 3D Tahap 1: adegan diam (kota prosedural, tower bertakik + podium, maket + AO, label) |
| 09:44 | `c95b9cd` | Belajar 3D: kota 11 x 11 blok memenuhi bingkai, kamera lebih dekat |
| 09:49 | `2aaa911` | Belajar 3D: kamera geser ke barat, garis tepi dan tekstur bintik dipertegas, matahari dari selatan |
| 09:54 | `7820663` | Belajar 3D: label kartu kaca (glassmorphism), matahari kembali ke arah awal di semua sudut |
| 09:57 | `96a8d40` | Belajar 3D: matahari sore di lintasan timur-barat, kamera dari selatan-barat daya |
| 10:00 | `95e8125` | Belajar 3D: halaman pratinjau interaktif (kamera bebas, sudut per bab, jam matahari, terang/gelap) |
| 10:14 | `825f6f9` | Belajar 3D Tahap 2: cerita scroll Mulai, Bab 4, Bab 5 (Lenis), kamera teredam, SF per fasad, matahari bisa diseret, overhang bisa diatur |
| 10:37 | `6ef7c16` | Belajar 3D Tahap 3a: Bab 1 (OTTV, tiga versi tower), Bab 2 (tiga jalur panas, panah 3D), Bab 3 (WWR, kaca model ikut berubah) |
| 10:45 | `3f3c73c` | Belajar 3D: panah jalur panas jadi pita meliuk bergaya ilustrasi (ekor memudar, kepala chevron), selalu masuk bingkai |
| 10:54 | `0708095` | Belajar 3D Tahap 3b: Bab 6 (dinding, lapisan dipisah), Bab 7 (OTTV total, WWR per arah), Bab 8 (RTTV, skylight bisa diatur), Lux di tiap kartu |
| 11:04 | `97992d4` | Belajar 3D Bab 6: dinding jadi potongan (section) berarsir per material, close up menempel di fasad Barat |
| 14:46 | `58f573d` | Tahap 4: Beranda + Belajar OTTV jadi satu adegan 3D di aplikasi |
| 15:00 | `8fecc30` | Belajar 3D: revisi kartu, potongan dinding asli, pohon rapi, bab penutup |
| 15:10 | `dd95ebd` | Belajar 3D Bab 2: satu panah per jalur, bergantian, membentur bidang |
| 15:41 | `17fbd61` | Belajar 3D: nama bagian santai, pita rumus, Bedah rumus, materi + analogi, lompatan halus |
| 16:12 | `d72ab24` | Belajar 3D: tombol rapi, Beranda lebih lega, rumus per jalur, bahasa awam, awan, mode gelap arang |
| 16:24 | `bb8afec` | Belajar 3D: rumus rata di tanda =/+, burung siluet, awan lebih dekat, judul atap tanpa "Bonus" |
| 16:29 | `d7f4dc8` | Belajar 3D: burung formasi acak berjarak aman, ketinggian tiap kawanan berbeda, putih di mode gelap |
| 16:46 | `0169064` | Belajar 3D: kehidupan kota (lalu lintas, lampu lalu lintas, pejalan kaki, taman, air mancur) |
| 16:53 | `c508f87` | Belajar 3D: kotak angka sejajar (keterangan kecil di bawah angka), hapus label LUXA · SNI di Beranda |
| 17:41 | `bae7da5` | Presentasi P1: panggung maket untuk model pengguna |
| 17:57 | `e95d5f4` | Presentasi P1: warna maket dari swatch material, latar menyesuaikan kontras |
| 19:34 | `6d3f5c2` | Presentasi P2: kubah matahari, kamera per slide, navigasi |
| 19:46 | `1c2c7d0` | Presentasi P3: isi tujuh kartu, heatmap per sisi, saran penutup |
| 19:52 | `d8a2022` | Presentasi P4: Mode Presentasi baru menggantikan preset lama |
| 20:03 | `8f08cc8` | Laporan PDF (mockup): dokumen A4 bergaya LUXA |
| 20:23 | `778655a` | Laporan A3 (eksplorasi): tema terang/gelap, tegak/mendatar, kartu kaca, diagram khusus OTTV |
| 20:41 | `c9d5ef1` | Laporan A3 (revisi eksplorasi): ruang lebih padat, latar terang putih, penggaris batas, skema 1 m² fasad |
| 21:38 | `3a82c74` | Bandingkan jadi Versus: dua panel berdampingan, notifikasi kaca di bawah |
| 21:47 | `4b64237` | Laporan PDF A3 baru: tujuh halaman, terang/gelap, mendatar/tegak |
| 21:55 | `bf2f970` | Merge belajar3d-tahap1: Belajar 3D, Mode Presentasi, Bandingkan Versus, laporan PDF A3 |

## Selasa, 24 Nov 2026

| Jam | Commit | Perubahan |
|---|---|---|
| 01:35 | `fca9bfc` | Kategori Konteks, kamera fokus ke gedung, viewer dan presentasi lebih ringan |
| 01:45 | `5abc310` | Bayangan digambar sekali per frame; peta bayangan interaktif 2048 |
| 01:54 | `aca80fa` | Notifikasi di pojok kanan bawah area 3D, satu per satu (tidak menumpuk) |
| 02:12 | `9a9ca03` | Excel bergaya LUXA: lembar Dasbor di depan, lembar lain diseragamkan (rumus tidak diubah) |
| 02:19 | `353f0a6` | PDF: tampak versi tegak lebih rapi; gambar Bandingkan ikut tata letak Versus |
| 02:28 | `75340c5` | Viewer benar-benar diam saat tidak ada perubahan; penjaga kualitas presentasi tidak terlalu sensitif |
| 02:55 | `dcb9043` | Mode Presentasi lebih representatif; kubah matahari lebih tegas dan bisa diseret; garis di gambar Bandingkan |
| 03:00 | `36ff8d9` | Kubah matahari: ukuran matahari kembali semula, warna dan garis dipoles supaya menonjol |
| 03:14 | `3900a8e` | Simpan gambar: kartu kaca bawah tanpa garis melintang |
| 03:31 | `825469f` | PDF: tanpa garis putih di tepi; sampul dengan burung dan tirai bertekstur awan |
| 11:09 | `027b738` | PDF lebih ringan dan halus; kubah matahari terpoles dan bisa digeser di semua tampilan |
| 11:46 | `71d81b9` | Beranda dan Belajar jauh lebih ringan: mesin hitung ditunda, bayangan awan dihapus, kualitas adaptif |
| 12:26 | `e346ee8` | PDF diunduh langsung sebagai berkas A3 (tanpa dialog cetak) |
| 12:33 | `b81db74` | Belajar: animasi sinar langsung dan panas merambat dibedakan sesuai fisikanya |
| 12:41 | `775d36f` | PDF: hilangkan garis grid sambungan petak GPU |
| 13:01 | `c473f39` | Belajar Bab 2: potongan ruang memperlihatkan panas yang masuk ke dalam |
| 20:00 | `d9238f1` | Perbaiki klasifikasi rangka/kaca, tampilan peneduh, dan pasang baseline di CI |
| 20:36 | `9bd533c` | Tes invarian engine: rotasi, satuan, mesh, nama layer, peneduh, paritas format |
| 20:44 | `71516e7` | Cek kewajaran geometri: face kembar dihitung sekali, batang bernama kaca jadi rangka |
| 20:53 | `03ab890` | Laporan audit pipeline (langkah 3): 13 temuan berperingkat |
| 21:34 | `9a5e097` | A3-01 konfirmasi material + saran dari nama layer; A3-02 peneduh lepas sesuai geometri SNI |
| 21:48 | `304b1d0` | A3-03/A3-12 klasifikasi nama nyata; A3-06 cek geometri di tahap inspeksi; A3-08 pelat menjorok = peneduh |
| 21:52 | `20466f9` | Rencana teknis A3-04: diet ukuran data hasil (22 MB -> < 3 MB) |
| 22:35 | `92094de` | A3-04 Fase 0+1: format kirim ramping (hasil 22,4 -> 7,9 MB, ganti material 16,3 -> 0,63 MB) |
| 23:01 | `2e3d362` | Percepat engine: raycast matahari grid proyeksi, indeks-Z peneduh, rematerial tanpa deepcopy |
| 23:12 | `f83e9dc` | Perbaiki: pilihan 'Kaca utama' tidak berpengaruh setelah 'Pakai saran dari nama layer' |
| 23:13 | `cacda58` | Service worker: salin respons sebelum dikembalikan (error 'Response body is already used', cache shell tidak tersimpan) |
| 23:22 | `5f9cc47` | Saran material hanya untuk nama yang menyebut jenisnya; nama generik diminta pilih sendiri |
| 23:31 | `e84d9a1` | Inspeksi ulang lebih cepat: cache deteksi sisi luar + pakai ulang hasil untuk permintaan yang sama |
