# Menjalankan dan menerbitkan LUXA

LUXA punya dua mode engine. Fungsinya sama, hasil hitungnya juga sama (dijaga oleh `tests/test_browser_api.py` dan `tests/test_browser_engine_parity.py`).

| Mode | Cara kerja | Dipakai untuk |
|---|---|---|
| **Browser** (bawaan) | Engine Python berjalan di browser pengguna lewat Pyodide (Web Worker). Tidak ada server. File model tidak pernah keluar dari laptop pengguna. | Versi publik, hosting statis gratis |
| **Server** | Frontend memanggil FastAPI di `backend/main.py`. | Pengembangan dan debugging backend |

## Persiapan sekali saja

Butuh Node.js 20+ dan bash (Git Bash di Windows).

```bash
cd frontend
npm install
npm run engine:fetch      # unduh Pyodide, wheel, IfcOpenShell, rhino3dm ke frontend/.engine-cache (±40 MB)
```

Aset engine disalin otomatis ke `frontend/public/luxa-engine/` setiap kali `npm run dev` atau `npm run build` dijalankan. Kedua folder itu tidak masuk git.

## Menjalankan di laptop

- **Mode browser:** `npm run dev`, lalu buka `http://127.0.0.1:5173`. Pemuatan pertama mengunduh engine sekitar 10 MB; berikutnya dari cache browser.
- **Mode server:** jalankan backend (`start_studio.bat` atau `uvicorn main:app` di `backend/`), lalu `npm run dev:server`.

## Build statis

```bash
cd frontend
npm run build                         # hasil di frontend/dist, termasuk template laporan prodi
LUXA_INCLUDE_TEMPLATE=0 npm run build # tanpa template prodi (untuk publik sebelum ada izin)
```

Isi `frontend/dist` bisa dilayani dari folder mana pun karena semua path relatif. Untuk mencobanya: `python -m http.server 8000` di dalam `frontend/dist`.

Kalau template tidak disertakan, tombol "Unduh laporan (.xlsx)" otomatis mengunduh laporan Excel umum dan menampilkan catatan.

## Terbit ke GitHub Pages

1. Push repo ke GitHub.
2. Settings → Pages → Source: **GitHub Actions**.
3. Tab Actions → **Deploy LUXA (GitHub Pages)** → Run workflow. Centang "Sertakan template laporan prodi" hanya kalau izin prodi sudah ada.

Workflow ini hanya jalan kalau dipicu manual, jadi push biasa tidak otomatis menerbitkan apa pun.

## Hal yang perlu diputuskan sebelum publik

- Izin prodi untuk `docs/templates/template_prodi.xlsx`.
- Apakah `backend/samples/Fasad_Curtain_Wall_Baru.3dm` boleh ikut sebagai contoh publik (sekarang ikut di `samples/`).
- Cek merek dagang dan domain LUXA.

## Batasan versi browser

- Laporan PDF hanya tersedia di mode server (reportlab tidak ada di Pyodide).
- Sudah diuji di Chromium. Safari dan Firefox belum.
- Model yang sangat besar bisa memakai 300–550 MB memori browser.
