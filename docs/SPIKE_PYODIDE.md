# Spike Fase 5a: engine LUXA di browser (Pyodide)

Tanggal: 22 Nov 2026. Branch: `fase-5a-spike`. Dikerjakan Claude.

## Ringkasan

Engine Python LUXA bisa berjalan utuh di browser, tanpa server, dengan hasil **identik** dengan backend. Pada keenam fixture uji, selisih OTTV-nya 0,00 W/m², jauh di bawah batas 0,01 untuk Fase 5b. Kode engine-nya sama: `backend/` dipakai apa adanya, ditambah satu cabang loader kecil untuk .3dm.

- **Waktu muat engine:** sekitar 4,5 detik setelah aset ada di cache browser.
- **Unduhan pertama:** 33 MB (24 MB gzip). Kalau IfcOpenShell dimuat hanya saat ada file IFC, unduhan awal turun ke sekitar 21 MB (12 MB gzip).
- **Waktu analisis:** model kecil di bawah 0,2 detik, Facade 4.500 panel sekitar 3,5 detik, model 24 lantai 7.992 panel sekitar 8,6 detik.

**Rekomendasi: lanjut ke Fase 5b**, dengan catatan di bagian akhir.

## Susunan

| Bagian | Isi |
|---|---|
| Runtime | Pyodide **0.29.5** (Python 3.13, ABI `pyodide_2025_0`) di Web Worker (`spike-pyodide/worker.mjs`) |
| Paket bawaan Pyodide | numpy 2.2.5, pydantic 2.12.5 (+ pydantic_core), micropip, packaging |
| Paket dari PyPI (murni Python) | trimesh 5.2.1, ladybug-geometry 1.35.10, openpyxl 3.1.5, et-xmlfile 2.0.0 |
| IFC | IfcOpenShell WASM **0.9.1 modular** (inti, skema IFC2X3/IFC4/IFC4X3, mapping, kernel OpenCASCADE) dari `IfcOpenShell/wasm-wheels` |
| .3dm | **rhino3dm.js 8.35.0** di JavaScript (`spike-pyodide/rhino_extract.mjs`), karena rhino3dm Python tidak punya build Pyodide |
| Kode engine | `backend/*.py` + `backend/data/*.json`, dikemas ke `vendor/backend_bundle.json` (743 KB, 12 file) |
| Antarmuka | `spike-pyodide/engine_browser.mjs`: nama fungsi sama dengan `frontend/src/engine.js` (upload, inspect, analyze, exposure, exportReport, rematerial, recommend) |

Kenapa bukan Pyodide 314 (rilis terbaru, Python 3.14): wheel IfcOpenShell WASM baru tersedia untuk Python 3.13. Wheel monolitik 0.9.0.post1 crash di `ifcopenshell.open()` ("memory access out of bounds") pada Pyodide 0.29.5. Build modular 0.9.1, yang dibuat dengan Pyodide 0.29.3, berjalan normal.

### Jalur .3dm

`rhino_extract.mjs` meniru `_process_rhino_obj` di `backend/universal_pipeline.py`: path layer lengkap dan visibilitasnya, sumber material (layer, objek, induk), blok bersarang dengan transformasi 4×4, mesh dari Mesh/Extrusion/Brep, SubD ke Brep, dan laporan M3 "Brep tanpa render mesh". Hasilnya ditulis sebagai `<nama>.3dm.json`.

Loader Python mendapat satu cabang baru, `.3dm.json`. Klasifikasi grup dan `_add_chunk` tetap berjalan di Python, jadi aturan penamaan dan klasifikasinya satu sumber dengan jalur .3dm native. Format lain tidak tersentuh. Tes `tests/test_pre_extracted_3dm.py` memastikan hasilnya sama dengan jalur native untuk kotak, blok bersarang, dan Brep tanpa mesh.

## Hasil

Lingkungan uji: Chromium headless di VM Linux (Intel Core Ultra 7 255HX, 2 vCPU, 4 GB RAM), aset dilayani `python -m http.server` lokal. Acuan native: CPython 3.10 di VM yang sama. Data mentah ada di `spike-pyodide/results/`.

### Waktu muat engine (browser)

| Tahap | Detik |
|---|---|
| Inti Pyodide (WASM + stdlib) | 1,0 |
| Paket bawaan (numpy, pydantic, …) | 0,4 |
| Wheel tambahan (trimesh, ladybug, openpyxl, IfcOpenShell) | 1,6 (sekali 7,4 karena server lokal satu-thread) |
| Impor backend LUXA | 1,2–1,7 |
| rhino3dm.js | 0,1 |
| **Total** | **4,4–4,7** (satu kali 10,8) |

Angka ini tidak termasuk waktu unduh, karena asetnya dilayani dari disk lokal.

### Ukuran unduhan pertama

| Kelompok | File | Mentah | gzip |
|---|---|---|---|
| IfcOpenShell (9 wheel) | 9 | 12,1 MB | 12,0 MB |
| Inti Pyodide | 4 | 11,7 MB | 5,2 MB |
| Paket Python lain | 12 | 6,0 MB | 5,9 MB |
| rhino3dm.js + wasm | 2 | 2,7 MB | 1,0 MB |
| Backend LUXA | 3 | 0,7 MB | 0,2 MB |
| **Total** | **30** | **33,2 MB** | **24,3 MB** |

Wheel sudah berupa zip, jadi gzip hampir tidak mengecilkannya. Perkiraan unduhan pertama di koneksi 10 Mbps sekitar 20 detik. Dengan IfcOpenShell dimuat belakangan, sekitar 10 detik. Kunjungan berikutnya dilayani dari cache (service worker), jadi tinggal waktu muat sekitar 4,5 detik.

### Analisis per fixture (konfigurasi bawaan, browser)

| Fixture | Format | Panel | OTTV native | OTTV browser | Selisih | Native (s) | Browser analisis (s) | Exposure 3 jam (s) | Rematerial (s) |
|---|---|---|---|---|---|---|---|---|---|
| kotak | .3dm | 48 | 20,43 | 20,43 | 0,00 | 0,02 | 0,07 | 0,01 | 0,01 |
| silinder | .3dm | 432 | 19,89 | 19,89 | 0,00 | 0,06 | 0,12 | 0,02 | 0,07 |
| archicad_bim_curtainwall | .ifc | 180 | 3,72 | 3,72 | 0,00 | 0,18 | 1,53 | 0,01 | 0,02 |
| fasad_unitized_24lantai | .3dm | 7.992 | 27,47 | 27,47 | 0,00 | 5,61 | 8,64 (+0,27 baca .3dm) | 1,00 | 1,46 |
| Facade only to Alfian | .obj | 4.500 | 38,79 | 38,79 | 0,00 | 1,65 | 3,56 | 0,84 | 0,80 |
| Facade only to Alfian | .3dm | 4.500 | 38,79 | 38,79 | 0,00 | 4,59 | 3,42 (+0,45 baca .3dm) | 0,79 | 1,78 |

- Untuk .3dm besar, versi browser malah lebih cepat (Facade: 3,4 detik dibanding 4,6 detik), karena membaca mesh lewat rhino3dm.js jauh lebih cepat daripada loop per-vertex di rhino3dm Python.
- Untuk geometri dan IFC, Pyodide kira-kira 1,5–8 kali lebih lambat daripada native.
- **Ekspor Excel:** 0,54 detik (kotak, 53 KB) dan 1,66 detik (Facade, 373 KB).
- **Hasil analisis sebagai JSON:** 14,6 MB untuk model 24 lantai. Serialisasi 0,18 detik dan parse 0,11 detik, jadi bukan hambatan.

### Memori

- **Heap WASM:** 104 MB untuk model kecil, sekitar 310–370 MB untuk satu model besar, dan **535 MB** setelah tiga model besar dalam satu sesi. Sebagian besar dipakai cache analisis (LRU 4 hasil) dan cache raycast engine.
- **Heap JS halaman:** 3–41 MB.

Laptop mahasiswa dengan RAM 8 GB masih aman, tapi batas cache perlu diatur di 5b.

## Yang belum dicakup spike

- **Ekspor `template_prodi` dan PDF.** Template prodi belum dibundel (izin prodi masih ditunggu), dan reportlab tidak tersedia di Pyodide. Excel dan CSV sudah jalan.
- **Waktu unduh di jaringan nyata dan perangkat lemah.** Pengukuran ini memakai disk lokal dan CPU desktop. Perlu diuji di laptop mahasiswa sungguhan dan di GitHub Pages.
- **Safari dan Firefox.** Yang diuji baru Chromium.
- **File .glb/.gltf dan .hbjson.** Tidak diuji di spike, tapi loader-nya murni Python, jadi seharusnya jalan.

## Rekomendasi untuk Fase 5b

1. **Lanjut ke Fase 5b.** Ketepatan angka sudah terbukti, dan waktunya masih wajar untuk aplikasi belajar.
2. **Muat bertahap.**
   - Wajib di awal: inti Pyodide, numpy, pydantic, dan backend.
   - Setelah engine siap, di latar belakang: trimesh dan ladybug-geometry.
   - Saat dibutuhkan saja: IfcOpenShell (saat user mengunggah .ifc), rhino3dm.js (saat .3dm), openpyxl (saat ekspor).
   Unduhan awal turun dari 24 MB ke sekitar 10 MB gzip (inti Pyodide 5,2 MB + numpy dan pydantic sekitar 4,9 MB + backend 0,2 MB).
3. **Instal wheel IfcOpenShell berurutan:** skema, lalu mapping dan kernel, lalu modul inti. Di browser, micropip memasang secara paralel, dan library bersama IfcOpenShell gagal dimuat kalau urutannya terbalik. Urutan ini sudah ada di `vendor/manifest.json` (`stages`).
4. **Kunci versi:** Pyodide 0.29.5 dan IfcOpenShell 0.9.1 modular. Pindah ke Pyodide 314 hanya setelah IfcOpenShell merilis wheel untuk Python 3.14.
5. **Rematerial untuk model besar** butuh 0,8–1,8 detik, melewati target 300 ms. Sebagian besar waktunya habis untuk menyalin dan menyerialisasi hasil lengkap. Di 5b, kirim balik hanya ringkasan dan nilai per panel yang berubah, bukan seluruh geometri.
6. **Batasi cache:** LRU analisis 2 hasil, dan cache raycast dibersihkan saat model diganti, supaya heap tetap di bawah sekitar 400 MB.
7. **Tampilkan progres per tahap** saat engine dimuat, dan tunjukkan bahwa file model tidak pernah dikirim ke mana pun.
8. **Tes paritas di CI:** `node spike-pyodide/node_probe.mjs` menjalankan engine Pyodide di Node dan membandingkan hasilnya dengan `results/reference_native.json`. Ini bisa jadi tes otomatis di 5b.

## Cara menjalankan ulang

```bash
# dari akar repo
bash spike-pyodide/fetch_assets.sh          # isi spike-pyodide/vendor/ (sekali, ~40 MB unduhan)
node spike-pyodide/build_bundle.mjs         # kemas backend + manifest wheel
python spike-pyodide/reference_native.py    # angka acuan backend native
node spike-pyodide/node_probe.mjs           # engine Pyodide di Node, bandingkan dengan acuan
python -m http.server 8000                  # lalu buka http://localhost:8000/spike-pyodide/
```
