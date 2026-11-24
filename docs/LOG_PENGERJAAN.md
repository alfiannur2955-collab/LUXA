# Log Pengerjaan LUXA

Catatan naratif per sesi, dengan angka hasil yang terukur. Untuk daftar lengkap setiap commit beserta jamnya,
jalankan `python tools/log_pengerjaan.py` (menulis `docs/LOG_GIT_OTOMATIS.md`).

Waktu dalam WIB. Angka OTTV dari mode SNI 6389:2020, Jakarta.

## Ringkasan proyek

| Tanggal | Commit | Fokus utama |
|---|---|---|
| Sab, 21 Nov 2026 | 32 | Baseline, Fase 1 (ketepatan geometri M1–M12), Fase 3 (mode Kepatuhan SNI), Fase 1c–1d (21 kasus sintetis + uji analitis) |
| Min, 22 Nov 2026 | 115 | Fase 4 (UX 4 langkah: Unggah, Inspeksi, Material, Lokasi, Laporan, Undo, katalog), Fase 5 (engine di browser/Pyodide), Fase 6 (bersih kode mati), kompas, heatmap, capture |
| Sen, 23 Nov 2026 | 41 | Dok & kartu, Beranda + Belajar OTTV 7 bab + maskot Lux, Belajar 3D (scroll, kota hidup), Mode Presentasi, laporan PDF A3 |
| Sel, 24 Nov 2026 | 29+ | Dini hari–siang: viewer lebih ringan, Excel bergaya LUXA, PDF, kubah matahari. Malam: **audit total + perbaikan engine (sesi di bawah)** |

## Sesi 24 Nov 2026, 18:40–23:45 WIB — Audit total, ketepatan, dan kecepatan

Dikerjakan bersama Claude langsung di repo. Dipicu oleh studi peneduh fasad twisted 24 lantai: sirip terakota
tampil rusak setelah dihitung, lalu berkembang menjadi audit seluruh pipeline.

### Linimasa

| Jam | Commit | Pekerjaan | Dampak terukur |
|---|---|---|---|
| 18:40–19:40 | — | Studi peneduh fasad twisted (Opsi A: sirip terakota + rusuk horizontal, rental office) | OTTV 36,45 → 31,45 (sebelum koreksi) |
| 20:00 | `d9238f1` | Klasifikasi: nama jamak (`Mullions`), `crown` bukan token kaca, nama elemen IFC dibaca; peneduh dikirim utuh ke viewer; baseline diperbarui + dipasang di CI | Twisted 36,45 → **34,17** (mullion dulu terhitung kaca, 33% selubung); IFC Archicad WWR 0% → 62% |
| 20:36 | `9bd533c` | 42 uji invarian (rotasi, satuan, mesh, nama, peneduh, format) | Menemukan AUDIT-02 & AUDIT-03 |
| 20:44 | `71516e7` | Face kembar dihitung sekali; batang bernama kaca = rangka | Dobel sebagian: OTTV +20% → 0; mullion "CW" tidak lagi memakan kaca |
| 20:53 | `03ab890` | Laporan audit 13 temuan berperingkat (`docs/AUDIT_PIPELINE_2026-11.md`) | — |
| 21:34 | `9a5e097` | A3-01 material wajib dikonfirmasi; A3-02 peneduh lepas sesuai geometri SNI Lampiran A; A3-14 catatan "[object Object]"; A3-15 status rematerial | Kotak "Kaca Bening": 19,37 (palsu lolos) → hasil sementara sampai material dipilih (kaca polos asli 79,84) |
| 21:48 | `304b1d0` | A3-03/12 94 nama layer nyata; A3-06 cek geometri di inspeksi; A3-08 pelat menjorok = peneduh | Nama benar 60 → 89/94; Klassiqua +158 m² selubung; unitized 26,79 → 25,03 |
| 21:52 | `20466f9` | Rencana teknis A3-04 diet ukuran data | — |
| 22:35 | `92094de` | A3-04 Fase 0+1: format kirim ramping + adapter frontend + `?perf=1` | Hasil 22,4 → **7,9 MB**; ganti material 16,3 → **0,63 MB** |
| 23:01 | `2e3d362` | Engine: raycast grid proyeksi, indeks-Z peneduh, rematerial tanpa deepcopy | Browser: hitung **42 → 9,5 s**; ganti material **3,5–4,9 → 0,8–1 s** |
| 23:12 | `f83e9dc` | Pilihan "Kaca utama" tidak berlaku setelah "Pakai saran" | Bug 139,39 tetap walau ganti kaca |
| 23:13 | `cacda58` | Service worker: clone sebelum respons dibaca | Error merah `sw.js` hilang, cache aplikasi kini tersimpan |
| 23:22 | `5f9cc47` | Nama generik tidak diberi saran material | — |
| 23:31 | `e84d9a1` | Cache deteksi sisi luar + pakai ulang inspeksi identik | Inspeksi ulang 1,6 → 0–0,8 s (Pyodide) |
| 23:45 | (dok) | Serah-terima ke Antigravity + log pengerjaan | `docs/SERAH_TERIMA_ANTIGRAVITY.md` |

### Angka akhir sesi (model `Fasad_Tower_Twisted.3dm`)

| Ukuran | Awal sesi | Akhir sesi |
|---|---|---|
| OTTV (triple-silver, dikonfirmasi) | 36,45 (mullion terhitung kaca) | **34,18** memenuhi SNI |
| OTTV Opsi A sirip terakota | 31,45 | **30,45** |
| Waktu hitung di browser pengguna | 42,0 s | 9,5 s |
| Waktu ganti material di browser | 3,5–4,9 s | 0,8–1,1 s |
| Data hasil ke tampilan | 22,4 MB | 7,9 MB |
| Jumlah tes otomatis (terkumpul) | 184 | 378 |

### Keputusan yang diambil

- Hasil berstatus **sementara** sampai material dipilih atau dikonfirmasi (tidak ada "memenuhi SNI" dari material default).
- Nama layer generik tidak diberi saran material; pengguna memilih sendiri.
- Peneduh yang tidak menempel di tepi jendela dihitung dengan **selisih bayangan dari tabel SNI** (SNI hanya mendefinisikan peneduh menempel). Diberi peringatan `SHADING_DETACHED_APPROX`.
- Mode engine server (`npm run dev:server`) tetap didukung.
- Template layer LUXA opsional: ditunda (dibahas, belum diputuskan).
