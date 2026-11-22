# LUXA by Alf Studio

LUXA menghitung **OTTV** (selubung dinding) dan **RTTV** (atap) menurut **SNI 6389:2020** langsung dari model 3D, lalu menampilkan hasilnya di viewer 3D dan laporan Excel.

Perhitungan berjalan **di browser kamu sendiri**. File model tidak dikirim ke server mana pun.

> LUXA adalah alat bantu belajar dan simulasi. Laporannya bukan dokumen kepatuhan resmi. Untuk pengajuan resmi, periksa ulang dengan dokumen SNI dan konsultan.

---

## 1. Cara memakai

### Versi web (tanpa instalasi)
Buka alamat LUXA di Chrome atau Edge versi terbaru. Saat pertama dibuka, engine perhitungan (sekitar 10 MB) diunduh sekali, lalu disimpan di browser. Setelah itu LUXA tetap bisa dipakai tanpa internet.

### Menjalankan di laptop sendiri
Butuh **Node.js 20 LTS** atau lebih baru.

```bash
cd frontend
npm install
npm run dev        # buka http://127.0.0.1:5173
npm run build      # hasil statis di frontend/dist, bisa diunggah ke hosting mana saja
```

Kalau tidak ada Node.js tapi folder `frontend/dist` sudah ada, buka `start_studio.bat` (Windows). Alamatnya http://127.0.0.1:8000.

### Mode server (untuk pengembangan backend)
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000      # API di http://127.0.0.1:8000
# terminal kedua:
cd frontend && npm run dev:server  # buka http://127.0.0.1:5173
```

---

## 2. Langkah di aplikasi

1. **Unggah**: pilih file model atau salah satu contoh ("Kotak 4 lantai", "Fasad tower twisted").
2. **Konfirmasi**: cek satuan, sumbu atas, muka tanah, isi model (fasad saja / gedung lengkap), lokasi, dan arah utara. Semua dibaca dari file; ubah kalau salah.
3. **Inspeksi**: cek kelompok bidang (kaca, dinding, spandrel, rangka, peneduh, atap) dan daftar kejanggalan. Pilih material per kelompok dari katalog.
4. **Hasil**: OTTV total, per arah, per lantai, heatmap 3D, lintasan matahari, rekomendasi material, lalu **Unduh laporan (.xlsx)**.

---

## 3. Menyiapkan model

Format yang dibaca: `.3dm`, `.ifc`, `.glb`/`.gltf`, `.obj` (+ `.mtl`, boleh dalam `.zip`), `.hbjson`, `.stl`, `.ply`.

Aturan umum yang paling berpengaruh:
- **Pisahkan kaca, dinding/spandrel, rangka, dan peneduh** di layer, material, atau kategori yang berbeda, dan beri nama yang jelas, misalnya `Kaca_Vision`, `Dinding_Luar`, `Spandrel`, `Sirip`. Nama berbahasa Indonesia maupun Inggris sama-sama dikenali.
- Cukup **selubung luar**. Furnitur dan partisi dalam memperlambat proses dan bisa terbaca sebagai fasad.
- Model berada di **muka tanah** (z = 0) dan memakai satuan yang benar. Kalau ragu, ubah di langkah Konfirmasi.

| Software | Format terbaik | Catatan |
|---|---|---|
| Rhino / Grasshopper | `.3dm` | Simpan dalam tampilan Shaded dengan **Save**, bukan SaveSmall, supaya Brep membawa render mesh (atau jalankan `Mesh` dulu). Layer yang dimatikan diabaikan. Block bersarang didukung. |
| ArchiCAD | `.ifc` (IFC2x3/IFC4) | Aktifkan *IsExternal* pada dinding dan bukaan. Curtain wall, plate, wall, dan storey terbaca otomatis. |
| Revit | `.ifc` (IFC4 Reference View) | Centang Levels, sertakan hanya elemen selubung. Lubang jendela dipotong otomatis. |
| SketchUp / Blender / 3ds Max | `.glb` atau `.zip` (`.obj` + `.mtl`) | Pastikan sisi depan (putih) menghadap keluar. Sumbu Y-up dikonversi otomatis ke Z-up. |
| Ladybug / Honeybee | `.hbjson` | Aperture dan Outdoor Shade terbaca persis. |

---

## 4. Membaca hasil

- **OTTV total** (W/m²) dibandingkan dengan batas **35 W/m²**. Rumus per bidang:
  `OTTV = α·U·(1−WWR)·TD_ek + U_f·WWR·ΔT + SC·WWR·SF`, lalu dirata-rata menurut luas.
- **Per arah**: delapan arah mata angin. Arah dengan SF besar (barat, barat laut) biasanya paling berat.
- **SC efektif** sudah memasukkan peneduh luar (sirip, overhang, bagian bangunan sendiri) yang dihitung dari geometri 3D.
- **RTTV** atap: batas 10 W/m² untuk atap tanpa skylight dan 35 W/m² bila ada skylight.
- **Tabel SF** bawaan: SNI 6389:2020 Tabel 8 (54 kota). Tabel lama dari form PUPR tetap bisa dipilih di panel Lokasi.
- **SC kaca = SHGC / 0,87.**
- Status **SEMENTARA** muncul kalau ada kejanggalan model yang diterima tanpa diperbaiki.

### Laporan Excel
Lembarnya: Ringkasan, Material, delapan lembar arah, Atap RTTV, Per lantai, dan Referensi. Semua suku panas berupa rumus Excel. Sel krem berisi nilai dari model, sel putih berisi rumus. Kolom **Selisih** harus 0,00. Contohnya ada di `docs/contoh/`.

---

## 5. Untuk pengembang

```
backend/            engine Python (dipakai di browser lewat Pyodide dan di mode server)
  ottv_engine.py    perhitungan OTTV/RTTV, peneduh, panel
  universal_pipeline.py + loaders/   pembacaan dan normalisasi model per format
  luxa_report.py    laporan Excel
  browser_api.py    pintu masuk engine di browser
frontend/           Vite + Three.js; engine/worker.js menjalankan Pyodide
tests/              pytest (python -m pytest)
fixtures/           model uji sintetis + nilai yang diharapkan
tools/              pembuat fixture dan pembanding baseline
docs/               rencana, changelog, panduan deploy
```

Menjalankan tes:
```bash
pip install -r backend/requirements.txt -r requirements-dev.txt
python -m pytest
```

Versi aplikasi ada di satu tempat: `backend/version.py`.
