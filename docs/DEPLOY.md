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
npm run build                         # hasil di frontend/dist, termasuk template laporan
```

Isi `frontend/dist` bisa dilayani dari folder mana pun karena semua path relatif. Untuk mencobanya: `python -m http.server 8000` di dalam `frontend/dist`.

Laporan Excel dibuat oleh `backend/luxa_report.py` di dalam engine, jadi tidak ada file template yang perlu disertakan. openpyxl dimuat saat laporan pertama diunduh.

## Terbit ke GitHub Pages

1. Push repo ke GitHub.
2. Settings → Pages → Source: **GitHub Actions**.
3. Tab Actions → **Deploy LUXA (GitHub Pages)** → Run workflow.

Workflow ini hanya jalan kalau dipicu manual, jadi push biasa tidak otomatis menerbitkan apa pun.

## Contoh bawaan

- Kotak 4 lantai (`fixtures/synthetic/01_kotak_m/model.3dm`).
- Fasad tower twisted (`backend/samples/Fasad_Tower_Twisted.3dm`), disetujui Alfian sebagai contoh publik.

## Batasan versi browser

- Laporan PDF hanya tersedia di mode server (reportlab tidak ada di Pyodide).
- Sudah diuji di Chromium. Safari dan Firefox belum.
- Model yang sangat besar bisa memakai 300–550 MB memori browser.
