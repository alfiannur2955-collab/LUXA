# AGENTS.md — panduan untuk agen coding (Antigravity, Claude, dll.)

LUXA adalah aplikasi hitung OTTV (SNI 6389:2020) dengan engine Python yang juga berjalan di browser (Pyodide).

**Sebelum mengubah kode, baca `docs/SERAH_TERIMA_ANTIGRAVITY.md`.** Isinya: status terkini, aturan kerja,
jebakan yang sudah ditemukan, cara build/uji, dan daftar tugas berikutnya beserta prompt siap pakai.

Aturan singkat:
1. `python -m pytest -q` dan `python tools/compare_baseline.py` (0 selisih) wajib lulus sebelum menyatakan selesai.
2. Angka OTTV tidak boleh berubah tanpa uji dan penjelasan di pesan commit.
3. Setiap file di `backend/` berubah → `cd frontend && npm run engine:assets && npm run build`.
4. Bahasa antarmuka: Indonesia awam, koma desimal.
5. Jangan mengunggah atau menyebarkan PDF SNI asli.

Riwayat pengerjaan: `docs/LOG_PENGERJAAN.md` (naratif) dan `docs/LOG_GIT_OTOMATIS.md`
(dibuat ulang dengan `python tools/log_pengerjaan.py`).
