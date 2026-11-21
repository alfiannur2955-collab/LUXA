# Audit Total OTTV 3D Studio — UX, Pembacaan Model & Kesiapan Publish

Nov 21, 2026 · @Alfian

## Ringkasan

Sebagian masalah pembacaan model memang wajar karena batas format file, tapi sebagian besar disebabkan bug konkret di pipeline program, dan sudah saya buktikan dengan file kamu sendiri. Program juga belum siap dipublikasikan: arsitekturnya masih untuk satu pengguna, dan UX-nya menumpuk tiga lapis pengaturan yang saling bertabrakan.

Lima temuan terbesar:

1. **Geometri blok Rhino diproses dua kali.** Objek definisi blok ikut dibaca sebagai objek biasa di titik asal blok, sehingga muncul elemen "hantu" dan letaknya berpindah. Terjadi pada 52 objek di `fasad_unitized_24lantai.3dm` dan 135 objek di `tes objek archicad.3dm`.
2. **Elemen dihapus diam-diam.** Ada tiga filter otomatis yang membuang face: filter sliver (7.816 face dibuang di `fasad_unitized`), stride decimation untuk grup >80.000 face, dan penghapusan semua face non-vertikal pada kaca. User tidak pernah diberi tahu elemen mana yang dibuang.
3. **Dimensi berubah pada Brep Rhino.** rhino3dm tidak bisa membuat mesh dari Brep. Kalau file tidak menyimpan render mesh, program menggambar ulang dari surface dasar dan mengabaikan trim. Semua face Brep di kedua file kamu (6/6 dan 60/60) tidak punya render mesh.
4. **Klasifikasi berbasis tebakan nama.** Semua yang tidak dikenali otomatis jadi "dinding". Contohnya, pohon lanskap di `fasad_unitized` masuk 9 grup dinding dan ikut dihitung OTTV.
5. **Satu perhitungan, tiga jalur.** Ada tiga endpoint analisis dengan parameter berbeda. Jalur "Lolos Inspeksi → Hitung" mengabaikan slider U, α, SC, dan louver, jadi hasilnya bisa beda dengan yang terlihat di Studio.

Status: **tidak ada kode yang saya ubah.** Ada satu efek samping kecil saat uji coba, dijelaskan di bagian terakhir.

## Pembacaan model: kenapa elemen hilang, pindah, dan berubah dimensi

Keluhan "elemen hilang, letaknya pindah, dimensinya berubah" punya tiga sumber. Sumber pertama memang batas format file, misalnya mesh tanpa nama layer atau Brep tanpa render mesh. Sumber kedua adalah bug di pipeline, dan ini yang terbesar. Sumber ketiga adalah alur deteksi otomatis yang lalu ditambal audit manual, sehingga keduanya saling menimpa. Saya menguji pipeline aslimu (salinan, tanpa diubah) pada dua file .3dm di folder proyek.

| # | Gejala yang kamu lihat | Penyebab di kode | Bukti | Lokasi |
| --- | --- | --- | --- | --- |
| M1 | Elemen ganda / letak berpindah | Loader membaca semua `model.Objects`, termasuk objek definisi blok (mode InstanceDefinitionObject), lalu membacanya lagi lewat setiap instance. Hasilnya ada salinan geometri di titik asal blok. | 52 objek definisi di fasad\_unitized, 135 di tes objek archicad | universal\_pipeline.py, loop `_process_rhino_obj` |
| M2 | Seluruh bangunan bergeser | Titik nol Z diambil dari titik terendah semua geometri (termasuk salinan hantu, pohon, tanah, basement). XY dipusatkan ulang kalau >500 m. Acuan lantai 1 ikut bergeser. | z\_offset −0,6 m (fasad\_unitized), −1,05 m (tes objek) | normalisasi Stage 1 |
| M3 | Dimensi berubah / bukaan tertutup | rhino3dm tidak bisa membuat mesh dari Brep. Kalau render mesh tidak ada, kode men-tessellate `UnderlyingSurface()`, sehingga trim dan lubang diabaikan. | 6/6 dan 60/60 face Brep tanpa render mesh | cabang Brep di loader .3dm |
| M4 | Elemen hilang | Filter sliver membuang face sempit (≤8,5 cm) pada kaca/spandrel. Pada fasad lengkung yang di-mesh rapat, face fasad asli bisa ikut terbuang. | 7.816 face dibuang (fasad\_unitized), 2.510 (tes objek) | `_filter_thin_edge_slivers_on_group` |
| M5 | Rangka/peneduh bolong | Grup frame/shading/roof di atas 80.000 face diambil tiap ke-n face saja (stride). Peneduh bolong membuat SC salah. | grup aluminium di tes objek: stride 3× | merge grup di loader |
| M6 | Skylight / kaca miring hilang | Untuk kaca dan spandrel, hanya face yang hampir vertikal yang disimpan; face atas, bawah, dan miring dibuang. | logika keep = is\_vert | \_clean\_solid\_bim\_element\_faces |
| M7 | Peran elemen salah | Klasifikasi pakai substring nama. Kata yang tidak dikenali otomatis jadi `wall`. "lantai" dan "floor" jadi `roof`, sehingga "Dinding\_Lantai2" terbuang. "core" cocok dengan "score", "ground" cocok dengan "background", "insulation" menjadikan dinding bata berinsulasi sebagai spandrel. | pohon lanskap = 9 grup wall di fasad\_unitized | `classify_layer_or_material_role` |
| M8 | Peran campur dalam satu grup | Objek dengan nama sama digabung jadi satu grup. Kategori seluruh grup ikut chunk pertama. | logika merge `chunks[0][2]` | merge grup di loader |
| M9 | Layer/material blok hilang | Anak blok mewarisi layer induk (`override_layer`), sehingga nama layer dan material aslinya tidak dipakai untuk klasifikasi. | kode | `_process_rhino_obj` |
| M10 | Skala salah 10×/100× | Untuk OBJ/STL/GLB, satuan ditebak dari ukuran bounding box: >3.500 dianggap mm, >650 dianggap cm. Model tapak 700 m dalam meter akan menyusut 100×. | kode | normalisasi Stage 1 |
| M11 | Luas tidak konsisten | Layar Inspeksi menampilkan luas dua sisi panel, Studio menampilkan sisi luar saja. Kaca 15.880 m² di Inspeksi menjadi 7.900 m² di Studio untuk model yang sama. | screenshot kedua layar | adapters vs ottv\_engine |
| M12 | Normal terbalik tidak diperbaiki | Profil SketchUp mengklaim "membalik normal muka biru", tapi adapter tidak melakukan apa pun selain menambah catatan teks. Pembalikan hanya terjadi per grup utuh di raycast. | `post_process_groups` hanya `notes` | adapters/**init**.py |

**Koreksi untuk jawaban saya sebelumnya.** Fungsi `_classify_layer_or_name` di ottv\_engine.py yang saya kutip soal kata "fin" ternyata kode mati. Pipeline yang aktif memakai `classify_layer_or_material_role` di universal\_pipeline.py, dan fungsi itu sudah mencocokkan "fin" per kata. Masalah "lantai → roof" dan fallback ke dinding tetap ada di fungsi yang aktif.

**Yang sudah cukup baik:** jalur IFC lewat IfcOpenShell (koordinat dunia, lubang jendela dipotong, IsExternal dibaca) dan jalur HBJSON. Jalur IFC cadangan (parser STEP Python murni, sekitar 340 baris) tidak bisa diandalkan dan sebaiknya diganti dengan pesan error yang jelas.

## Metode perhitungan vs SNI 6389:2020

Rumus dasarnya sudah benar: α·Uw·(1−WWR)·TDek + Uf·WWR·ΔT + SC·WWR·SF. Tapi beberapa input menyimpang dari standar, jadi angka "memenuhi SNI" di layar belum bisa dipertanggungjawabkan sebagai hasil kepatuhan.

| Komponen | Di SNI 6389:2020 | Di program | Akibat |
| --- | --- | --- | --- |
| SF per kota | Tabel 8: SF untuk beberapa kota di Indonesia | Tabel Jakarta (U 130 … B 243) dikali `sf_multiplier` per kota | Nilai kota selain Jakarta bukan nilai tabel SNI |
| SF per arah | 8 orientasi diskrit | Diinterpolasi linear antar-arah, ditambah "zenith boost" untuk bidang miring | Angka per bidang tidak bisa dicocokkan ke tabel |
| ΔT | Ditetapkan 5 K | Diambil dari preset lokasi (`design_delta_t`) | Hasil bergeser dari standar |
| TDek | 15 / 12 / 10 sesuai berat dinding (<125, 125–195, >195 kg/m²) | Default 15. Material punya `td_ek`, tapi tidak dihitung dari berat dinding | Dinding bata/beton terhitung terlalu panas |
| SC | SC = SCk × SCeff, SCeff dari tabel sudut peneduh | SCeff dari raycast matahari jam 08–16 | Pendekatan simulasi, bukan prosedur SNI |
| Atap | RTTV dihitung terpisah (§4.4) | Atap diklasifikasikan `roof` lalu dibuang dari perhitungan | Laporan tidak lengkap untuk bangunan beratap/skylight |
| Heatmap | Tidak diatur | Mode default "Komposit" memakai WWR rata-rata lantai lalu dinormalisasi | Warna dinding masif mirip kaca; nilai per elemen tersembunyi |
| Data material | Spesifikasi pabrikan | Label "Terverifikasi" pada nilai U, SC, dan α bermerek, tanpa sumber datasheet | Berisiko kalau dipublikasikan dengan nama merek |

**Saran:** pisahkan dua mode dengan jelas. **Mode Kepatuhan SNI** memakai tabel resmi (SF per kota, ΔT 5 K, TDek dari berat, SC dari tabel) dan hanya mode ini yang boleh mencetak laporan "Memenuhi SNI". **Mode Simulasi** memakai EPW, raycast, dan heatmap untuk eksplorasi desain, dengan label "bukan untuk kepatuhan".

Tes otomatis (`test_ottv_engine.py`) sudah usang dan gagal (asersi 24 lantai). Tes itu juga hanya mengecek OTTV ≤ 35, bukan kebenaran angka terhadap hitungan manual.

## Audit fitur: dobel, bertabrakan, atau tidak perlu

Halaman utama saat ini memuat 28 dropdown, 41 input, dan 53 tombol sekaligus. Model 3D baru terlihat setelah melewati bar 5 tahap dan panel samping. Banyak dari kontrol ini mengatur hal yang sama di dua atau tiga tempat.

| Fitur / bagian | Masalah | Rekomendasi |
| --- | --- | --- |
| 3 endpoint analisis (`/analyze/preset`, `/analyze/upload`, `/analyze/commit`) | Parameter berbeda. `commit` mengabaikan slider U/α/SC, louver, dan subdivisi NURBS. | **Gabung** jadi satu endpoint dengan satu skema konfigurasi |
| Pengaturan Unit, Up-Axis, Deteksi Luar | Ada di layar Inspeksi dan di sidebar Studio. Nilainya bisa beda. | **Gabung**: hanya di langkah Periksa Model |
| Form "Software asal" (5 adapter) + 7 field wajib sebelum boleh upload | Adapter hampir kosong: hanya menambah catatan teks dan default up-axis. Klaim "perbaikan normal SketchUp" tidak diimplementasikan. | **Hapus**. Deteksi format, software, dan satuan dari file. Tampilkan tebakan dan biarkan user mengoreksi. |
| Material di 4 tempat (default sidebar, per grup di tabel, override per orientasi, slider global) | Urutan prioritas tidak terlihat. Slider global diam-diam menimpa semuanya. | **Gabung**: satu panel Material per peran, override per grup sebagai opsi lanjutan |
| Tahap 1–5 tampil 3 kali (bar status, judul sidebar, judul tabel "Tahap 2") | Label tahap tidak sesuai urutan kerja nyata | **Hapus** bar status. Ganti dengan langkah alur (lihat Rancangan UX). |
| 7 mode heatmap + 2 submode | Terlalu banyak; mode default (Komposit) menyamarkan nilai asli | **Sisakan 3**: OTTV per elemen, Peran elemen, Orientasi. Sisanya pindah ke Lanjutan. |
| rhino3dm.js + .wasm 2,6 MB di browser | Hanya dipakai untuk menghitung jumlah objek | **Hapus** |
| Kode mati di ottv\_engine.py (`load_raw_groups_from_file`, `_classify_layer_or_name`, `RawGroupMesh` dan tessellator duplikat) | Membingungkan perawatan, terbukti menyesatkan analisis saya sendiri | **Hapus** |
| Parser IFC STEP Python murni | Cadangan yang tidak akurat | **Hapus**. Wajibkan IfcOpenShell. |
| Generator louver parametrik | Mengubah geometri asli dalam mode kepatuhan | **Pindah** ke Mode Simulasi/eksplorasi |
| Kubah matahari, jam surya, radius kubah, vektor normal, HUD kompas | Berguna untuk ahli, mengganggu untuk pemula | **Pindah** ke panel Lanjutan |
| Auto-split CW, ambang lebar rangka/tinggi spandrel, override per bidang dan pita Z | Alat koreksi manual yang kuat tapi tersebar | **Satukan** di langkah Periksa Model sebagai "Perbaiki peran" |
| Tombol Excel di header dan di tabel bidang | Dobel | **Gabung** di langkah Hasil & Laporan |
| Auto-save konfigurasi saat hanya membuka Inspeksi | Membuka layar saja sudah menimpa file `.ottv.json` | **Ubah**: simpan hanya saat user menekan Simpan/Hitung |
| Konfigurasi staging untuk model yang sudah dihapus | 3 file `.ottv.json` yatim di `uploads/.staging_configs` | **Hapus** otomatis bersama modelnya |
| Label versi v2.0, v3.0, v5.0 bercampur | Membingungkan user | **Satukan** satu nomor versi |
| Katalog 20 preset/benchmark di dropdown model | Bercampur dengan model user | **Pisah**: "Contoh" vs "Model saya" |

## Kesiapan publish: penghambat sebelum bisa diakses publik

Program ini dibangun untuk satu orang di satu komputer. Kalau dipublikasikan apa adanya, hasil satu pengguna bisa bocor ke pengguna lain.

| # | Penghambat | Dampak | Lokasi |
| --- | --- | --- | --- |
| P1 | Hasil analisis terakhir dan EPW custom disimpan di variabel global (`LAST_ANALYSIS_CACHE`, `ACTIVE_CUSTOM_EPW`) | User B bisa mengunduh laporan Excel/PDF milik User A | main.py |
| P2 | Satu folder `uploads/` untuk semua orang. Katalog menampilkan semua unggahan, dan endpoint DELETE bisa menghapus model siapa pun. File dengan nama sama saling menimpa. | Kebocoran desain klien, data bisa dihapus orang lain | main.py |
| P3 | Tidak ada batas ukuran unggahan. Cache geometri `_UNIVERSAL_FILE_CACHE` tidak pernah dikosongkan. | Server kehabisan RAM/disk | main.py, universal\_pipeline.py |
| P4 | Raycast dan parsing berjalan sinkron di dalam request | Satu model besar memblokir semua user | ottv\_engine.py |
| P5 | Nama grup dan nama file dari model dimasukkan ke `innerHTML` tanpa escape (45 tempat) | Celah XSS lewat file yang sengaja dibuat | main.js, stagingWorkspace.js |
| P6 | Path Windows di-hardcode: Node dari folder `E:\APPS\ARCHICAD 30`, DLL dari `E:\APPS\QGIS\bin`, path `e:\PROJECT` di .bat. `reportlab` tidak ada di requirements. | Tidak bisa jalan di server | run\_studio\_servers.py, report\_exporter.py, start\_studio.bat |
| P7 | CORS `*` dengan credentials, tanpa autentikasi, tanpa rate limit | Mudah disalahgunakan | main.py |
| P8 | Laporan disebut "Official PUPR Compliance Form" | Bisa dikira dokumen resmi kementerian | report\_exporter.py |

Kebutuhan minimum untuk publish: sesi atau akun per pengguna, penyimpanan per pengguna, antrean job untuk analisis berat, batas ukuran file, escape HTML, dan konfigurasi lewat environment variable.

## Riset & rancangan alur UX baru

Usulan saya: ganti "5 tahap gatekeeper + Studio" menjadi empat langkah linear. Langkah Periksa Model jadi pusatnya, dan semua kontrol ahli disimpan di satu panel Lanjutan.

Temuan riset yang mendasari:

- **Progressive disclosure** (Nielsen Norman Group): tampilkan dulu yang penting, tunda fitur lanjutan ke layar kedua. Apa pun yang muncul di layar awal dianggap penting oleh user. Sekarang 120+ kontrol tampil sekaligus.
- **Validasi sebelum simulasi** (Honeybee "Validate Model"): tool energi yang matang memberi laporan semua masalah model sebelum dihitung. Program ini sudah punya "gerbang validasi", tapi tidak mencantumkan apa yang dibuang atau diubah.
- **Persiapan model di sumber** (cove.tool, ClimateStudio): tool komersial pun meminta user mengisolasi dinding luar dan kaca di software asal, dan memuji ekspor yang memisahkan kaca satu lapis dengan normal benar. Tool universal tetap butuh panduan ekspor per software, bukan menebak semua hal.
- **Batas rhino3dm** (McNeel): openNURBS tidak bisa me-mesh Brep. Render mesh hilang kalau file disimpan dengan SaveSmall atau belum pernah ditampilkan shaded. Jadi untuk .3dm, program harus memeriksa render mesh dan memberi instruksi, bukan menebak.

&#91;embedded content: alur UX baru · 4 langkah + panel lanjutan\]

Langkah 2 adalah perubahan terbesar: satu layar berisi 3D dan daftar grup beserta perannya. Ada juga laporan kesehatan (satuan, ukuran, jumlah elemen per peran, luas sisi luar), dan daftar elemen yang disaring beserta alasannya, yang bisa dikembalikan dengan satu klik.

Prinsip yang berlaku di semua langkah:

1. **Tidak ada penghapusan diam-diam.** Setiap filter menampilkan jumlah dan alasan, dan bisa dibatalkan.
2. **Satu pengaturan, satu tempat.** Tidak ada slider yang diam-diam menimpa pengaturan di tempat lain.
3. **Satu definisi luas** (sisi luar) di semua layar.
4. **Tebak, tampilkan, biarkan dikoreksi.** Deteksi otomatis tetap ada, tapi hasilnya selalu terlihat dan bisa diubah, bukan dipaksa lewat form di awal.
5. **Bahasa awam di layar utama.** Istilah teknis (Tier 2, raycast, Z-band) hanya di panel Lanjutan.

## Urutan perbaikan yang saya usulkan

Perbaiki dulu ketepatan pembacaan model. UX sebagus apa pun tidak berguna kalau geometrinya salah.

1. **Ketepatan geometri.** Lewati objek definisi blok (M1). Ganti semua penghapusan diam-diam dengan daftar "elemen disaring" yang bisa dikembalikan (M4–M6). Tolak Brep tanpa render mesh dengan instruksi ekspor yang jelas, atau sediakan jalur meshing server (M3). Ambil acuan tanah dari geometri bangunan, bukan titik terendah (M2).
2. **Satu sumber kebenaran.** Satu endpoint analisis, satu skema konfigurasi, satu definisi luas (sisi luar), dipakai sama di layar Periksa dan Hasil.
3. **Mode Kepatuhan SNI.** SF tabel per kota, ΔT 5 K, TDek dari berat dinding, RTTV untuk atap.
4. **Rombak alur UX** menjadi 4 langkah (lihat Rancangan UX), dengan panel Lanjutan untuk pengguna ahli.
5. **Persiapan publish** (P1–P8): sesi per pengguna, antrean job, keamanan.
6. **Bersih-bersih**: hapus kode mati, tes otomatis baru yang membandingkan hasil dengan hitungan manual untuk 3 model contoh.

## Yang perlu kamu putuskan sebelum saya mulai

- [ ] Siapa pengguna utamanya: mahasiswa/arsitek awam, konsultan energi, atau keduanya? Jawabannya menentukan apa yang tampil di layar utama.
- [x] Setuju memisahkan Mode Kepatuhan SNI (tabel resmi) dan Mode Simulasi (EPW/raycast)?
- [x] Fitur di tabel audit yang ditandai **Hapus**: boleh semua dihapus, atau ada yang mau dipertahankan?
- [ ] Untuk publik: perlu login/akun, atau cukup sesi anonim yang hilang setelah beberapa jam?
- [x] Format prioritas: IFC dan .3dm saja dulu, atau tetap semua format (OBJ, GLB, STL, HBJSON)?
- [ ] Kamu punya dokumen PDF SNI 6389:2020 lengkap? Saya perlu Tabel 8 (SF per kota) dan tabel SC dari dokumen asli, bukan dari kutipan sekunder.

**Keputusan (Nov 21, 2026):** pengguna mahasiswa dan konsultan, dengan prioritas mahasiswa. Mode Kepatuhan SNI dan Mode Simulasi dipisah. Semua fitur bertanda Hapus boleh dihapus. Soal login belum diputuskan, jadi rencana memakai sesi anonim untuk versi pertama. Eksekusi dikerjakan di Antigravity, mengikuti Rencana Eksekusi (Antigravity).

## Catatan metode audit

- Kode dibaca langsung di folder proyekmu. Uji pipeline dijalankan pada **salinan** kode di folder terpisah di luar proyek, memakai dua file .3dm milikmu.
- **Satu efek samping:** saat mencoba tombol "Inspeksi Ulang" di aplikasi yang sedang berjalan, program otomatis menyimpan ulang `uploads/.staging_configs/fasad_curtain_wall_baru.ottv.json`. Isinya pengaturan default tanpa override apa pun, jadi tidak ada pengaturanmu yang hilang. Perilaku auto-save inilah yang saya catat di tabel audit.
- Saya tidak menekan "Hitung", tidak mengunggah, dan tidak menghapus apa pun.

## Sumber

- [SNI 6389:2020 (daftar isi: Tabel 7 TDek, Tabel 8 SF beberapa kota, §4.4 RTTV)](https://greenbuilding.ft.ugm.ac.id/wp-content/uploads/sites/978/2025/03/SNI-6389_2020-OTTV.pdf)
- [Tabel TDek 15/12/10 dan SF Jakarta (kutipan skripsi UMN)](https://kc.umn.ac.id/id/eprint/16124/5/BAB_III.pdf)
- [McNeel: rhino3dm/openNURBS tidak bisa me-mesh Brep](https://discourse.mcneel.com/t/meshing-out-rhino-files-for-rhino3dm-js/208113)
- [McNeel: render mesh hilang karena SaveSmall](https://discourse.mcneel.com/t/on-rendermesh-generation-method-and-diff-vs-default-mesh/23088)
- [Honeybee Validate Model](https://docs.ladybug.tools/honeybee-primer/components/3_serialize/validate_model)
- [cove.tool: persiapan impor Revit/Rhino](https://cove.tools/blog/import-revit-rhino-skp-to-cove-tool)
  - [Nielsen Norman Group: Progressive Disclosure](https://nngroup.com/articles/progressive-disclosure/)
