# Skenario Uji Pengguna Fase 4 — LUXA by Alf Studio

Dokumen ini disiapkan untuk uji kegunaan (*usability testing*) dengan **3 mahasiswa arsitektur** setelah Fase 4 selesai. Tujuannya memverifikasi bahwa pengguna baru dapat mengunggah model 3D, memahami angka OTTV SNI 6389:2020, menjelaskan komponen kalor utama, dan membandingkan alternatif desain **dalam waktu kurang dari 10 menit tanpa bantuan teknis**.

---

## 1. Persiapan Uji

- **Model uji utama**: contoh bawaan `Fasad_Curtain_Wall_Baru.3dm` (tersedia langsung di layar *Unggah* -> kartu *"Belum punya model?"*) atau model studio pilihan Alfian (`.3dm` / `.ifc` / `.obj` / `.glb`).
- **Perangkat & ukuran layar**: laptop mahasiswa biasa (`1280×800` atau `1440×900` px) + 1 sesi singkat mengecek layar sempit (`768 px` / setengah layar).
- **Aturan fasilitator**:
  - Jangan memberi tahu tombol mana yang harus diklik kecuali peserta benar-benar macet lebih dari 90 detik (catat titik macet tersebut).
  - Minta peserta *think aloud* (menyuarakan apa yang mereka baca dan duga).
  - Mulai *stopwatch* saat peserta berada di layar **Unggah**.

---

## 2. Skenario Tugas (Untuk Setiap Peserta)

| # | Tugas | Kriteria Berhasil | Target Waktu |
| --- | --- | --- | --- |
| T1 | **Unggah & Konfirmasi**: Buka contoh `Fasad_Curtain_Wall_Baru.3dm` (atau unggah model studio). Periksa satuan, ukuran bangunan, jumlah lantai, muka tanah, dan pilih isi model hingga tombol lanjut aktif. | Peserta memahami alasan tombol terkunci sebelum baris kuning dilengkapi, dan berhasil masuk ke *Inspeksi*. | ≤ 2 menit |
| T2 | **Inspeksi & Kejanggalan**: Tinjau tabel *Grup terdeteksi* dan *Daftar kejanggalan*. Sorot salah satu grup di viewer 3D, perbaiki atau terima kejanggalan bila ada, lalu tekan **Hitung OTTV**. | Peserta mengenali beda klasifikasi kaca/dinding/rangka dan memahami arti status *Sementara* bila ada kejanggalan yang diterima apa adanya. | ≤ 2 menit |
| T3 | **Membaca Hasil & Menjelaskan 1 Komponen Kalor**: Baca angka OTTV total dan status kepatuhan (batas 35 W/m²). Klik satu panel kaca pada fasad terpanas, buka kartu **Rumus**, lalu jelaskan dengan kalimat sendiri mengapa angka arah itu tinggi (pakai tooltip istilah bila perlu). | Peserta mampu menyebutkan minimal 1 dari 3 komponen kalor (konduksi dinding, konduksi kaca, atau radiasi surya `SC × WWR × SF`) dan mengaitkannya dengan angka pada panel/arah terpilih. | ≤ 3 menit |
| T4 | **Eksplorasi Viewer (Kamera & Matahari)**: Ubah proyeksi (mis. *2 titik* atau *Tampak*), putar arah pandang (tahan `V` atau pil bawah), lalu aktifkan filter **Yang terkena matahari jam ini** dan geser jam. | Peserta melihat sisi yang terkena matahari berubah saat jam digeser dan memahami catatan bahwa angka OTTV tetap memakai SF tahunan SNI. | ≤ 1,5 menit |
| T5 | **Bandingkan Alternatif & Unduh Laporan**: Buka **Bandingkan** di rel kiri, buat Alternatif A dengan mengganti kaca (misalnya *Kaca Elektrokromik* atau *Low-E*), geser pembatas viewer terbelah, baca selisih OTTV, lalu unduh laporan `.xlsx`. | Peserta melihat selisih OTTV per arah, membaca catatan material (bila ada), dan berhasil mengunduh berkas `.xlsx`. | ≤ 1,5 menit |

**Kriteria lolos Fase 4**: seluruh 3 peserta menyelesaikan T1–T5 dengan waktu total **< 10 menit** dan mampu menjelaskan minimal 1 komponen kalor tanpa bantuan.

---

## 3. Lembar Catatan Pengujian (Isi Saat Sesi Berlangsung)

### Peserta 1

- **Nama / Semester**: `____________________`
- **Model yang dipakai**: `[ ] Fasad_Curtain_Wall_Baru.3dm` / `[ ] Model studio: ____________________`
- **Ukuran layar / browser**: `____________________`
- **Total waktu (T1–T5)**: `____ menit ____ detik`

| Tugas | Selesai Mandiri? | Waktu | Titik Bingung / Komentar Peserta |
| --- | --- | --- | --- |
| T1 Unggah & Konfirmasi | `[ ] Ya  [ ] Dibantu` | | |
| T2 Inspeksi & Kejanggalan | `[ ] Ya  [ ] Dibantu` | | |
| T3 Hasil & Jelaskan Kalor | `[ ] Ya  [ ] Dibantu` | | |
| T4 Kamera & Matahari | `[ ] Ya  [ ] Dibantu` | | |
| T5 Bandingkan & Laporan | `[ ] Ya  [ ] Dibantu` | | |

- **Penjelasan 1 komponen kalor menurut peserta**: `________________________________________________`
- **Saran utama peserta**: `________________________________________________`

---

### Peserta 2

- **Nama / Semester**: `____________________`
- **Model yang dipakai**: `[ ] Fasad_Curtain_Wall_Baru.3dm` / `[ ] Model studio: ____________________`
- **Ukuran layar / browser**: `____________________`
- **Total waktu (T1–T5)**: `____ menit ____ detik`

| Tugas | Selesai Mandiri? | Waktu | Titik Bingung / Komentar Peserta |
| --- | --- | --- | --- |
| T1 Unggah & Konfirmasi | `[ ] Ya  [ ] Dibantu` | | |
| T2 Inspeksi & Kejanggalan | `[ ] Ya  [ ] Dibantu` | | |
| T3 Hasil & Jelaskan Kalor | `[ ] Ya  [ ] Dibantu` | | |
| T4 Kamera & Matahari | `[ ] Ya  [ ] Dibantu` | | |
| T5 Bandingkan & Laporan | `[ ] Ya  [ ] Dibantu` | | |

- **Penjelasan 1 komponen kalor menurut peserta**: `________________________________________________`
- **Saran utama peserta**: `________________________________________________`

---

### Peserta 3

- **Nama / Semester**: `____________________`
- **Model yang dipakai**: `[ ] Fasad_Curtain_Wall_Baru.3dm` / `[ ] Model studio: ____________________`
- **Ukuran layar / browser**: `____________________`
- **Total waktu (T1–T5)**: `____ menit ____ detik`

| Tugas | Selesai Mandiri? | Waktu | Titik Bingung / Komentar Peserta |
| --- | --- | --- | --- |
| T1 Unggah & Konfirmasi | `[ ] Ya  [ ] Dibantu` | | |
| T2 Inspeksi & Kejanggalan | `[ ] Ya  [ ] Dibantu` | | |
| T3 Hasil & Jelaskan Kalor | `[ ] Ya  [ ] Dibantu` | | |
| T4 Kamera & Matahari | `[ ] Ya  [ ] Dibantu` | | |
| T5 Bandingkan & Laporan | `[ ] Ya  [ ] Dibantu` | | |

- **Penjelasan 1 komponen kalor menurut peserta**: `________________________________________________`
- **Saran utama peserta**: `________________________________________________`

---

## 4. Rekap Temuan & Tindak Lanjut

| Prioritas | Temuan Berulang (≥ 2 peserta atau menghambat tugas) | Layar / Komponen | Rencana Perbaikan |
| --- | --- | --- | --- |
| | | | |
| | | | |
| | | | |
