| Parameter              | Detail Pemeriksaan                                                                                                                                                                                                               |
|------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Dokumen Diperiksa**  | sni_tables_check.md (transkripsi untuk backend/sni_tables.py)                                                                                                                                                                    |
| **Sumber Acuan**       | SNI-6389-2020.pdf (*Konservasi energi selubung bangunan pada bangunan gedung*)                                                                                                                                                   |
| **Metode Pemeriksaan** | Pencocokan sel demi sel terhadap PDF asli serta validasi matematis terhadap seluruh 3.060 sel Tabel A.5–A.16 menggunakan persamaan koefisien peneduh efektif (\$SC\_{eff}\$) SNI 6389:2020 berbasis data matahari Tabel A.1–A.4. |

# BAGIAN 1 — Ringkasan Hasil Pemeriksaan

- **Tabel 1, 2, 7, 8, dan 9:** 100% cocok dengan SNI-6389-2020.pdf tanpa
  > anomali nilai cetak.

- **Tabel A.5–A.16 (3.060 sel):**

  - **5 perbedaan format digit** antara sni_tables_check.md dan PDF asli
    > (akibat salah cetak jumlah digit desimal pada PDF).

  - **20 sel akar anomali** yang berkaitan dengan catatan \[!NOTE\] di
    > sni_tables_check.md (sebagian butir di \[!NOTE\] menandai baris di
    > bawah nilai yang salah cetak karena lonjakan monotonik).

  - **14 anomali cetak tambahan** pada PDF yang belum tercantum di
    > \[!NOTE\], ditambah 1 catatan minor pada Tabel A.16.

- **Perbaikan label/header PDF:** Kesalahan judul pada Tabel A.9 PDF
  > ("proyeksi horizontal" padahal R2 proyeksi vertikal) dan header
  > kolom pertama Tabel A.12 PDF ("R1" padahal R2) sudah diperbaiki
  > dengan benar di sni_tables_check.md.

# BAGIAN 2 — Perbedaan Transkripsi sni_tables_check.md vs SNI-6389-2020.pdf (5 Sel)

| Tabel (Halaman PDF)  | Koordinat           | Cetak di PDF | Tertulis di .md | Saran Koreksi                | Keterangan                                                       |
|----------------------|---------------------|--------------|-----------------|------------------------------|------------------------------------------------------------------|
| Tabel A.9 (hlm. 41)  | R=1.1, 30°          | 0.71173      | 0.7117          | **0.7173**                   | Kelebihan angka 1 di PDF, terpotong di .md                       |
| Tabel A.14 (hlm. 48) | R1=0.2, R2=0.6, 40° | 0.75258      | 0.7525          | **0.7525** (atau **0.7526**) | Kelebihan digit 8 di PDF; nilai .md sudah tepat secara matematis |
| Tabel A.15 (hlm. 52) | R1=0.8, R2=1.4, 20° | 0.44960      | 0.4496          | **0.4960**                   | Kelebihan angka 4 di depan pada PDF                              |
| Tabel A.15 (hlm. 53) | R1=1.6, R2=0.2, 30° | 0.477        | 0.4770          | **0.4777**                   | Kurang digit 7 terakhir di PDF                                   |
| Tabel A.15 (hlm. 53) | R1=1.8, R2=1.6, 20° | 0.472        | 0.4720          | **0.4772**                   | Hilang angka 7 di PDF                                            |

# BAGIAN 3 — Koreksi Akar Anomali dari Daftar \[!NOTE\] (20 Sel)

Beberapa butir di \[!NOTE\] mencatat baris di bawah sel yang salah cetak
karena uji monotonik mendeteksi nilai yang kembali naik, sehingga tabel
berikut menunjuk langsung ke sel akar masalahnya.

| Tabel (Halaman PDF)  | Koordinat           | Nilai Cetak | Saran Koreksi | Pola Salah Cetak di PDF                                  |
|----------------------|---------------------|-------------|---------------|----------------------------------------------------------|
| Tabel A.8 (hlm. 40)  | R=0.6, 30°          | 0.6553      | **0.5663**    | Digit 56 tertukar jadi 65 (hasil rumus sekitar 0.5662)   |
| Tabel A.8 (hlm. 40)  | R=1.0, 20°          | 0.4542      | **0.4942**    | Digit 9 tercetak 5 (akar anomali R=1.1 di NOTE)          |
| Tabel A.9 (hlm. 41)  | R=0.3, 20°          | 0.6872      | **0.8672**    | Digit 86 tertukar jadi 68 (akar anomali R=0.4 di NOTE)   |
| Tabel A.9 (hlm. 41)  | R=0.4, 30°          | 0.9325      | **0.8325**    | Digit 8 tercetak 9                                       |
| Tabel A.10 (hlm. 42) | R=0.4, 40°          | 0.9338      | **0.8338**    | Digit 8 tercetak 9                                       |
| Tabel A.11 (hlm. 43) | R=1.7, 0°           | 0.6942      | **0.5942**    | Digit 5 tercetak 6                                       |
| Tabel A.11 (hlm. 43) | R=1.8, 50°          | 0.4540      | **0.4840**    | Digit 8 tercetak 5 (akar anomali R=1.9 di NOTE)          |
| Tabel A.12 (hlm. 44) | R=2.1, 10°          | 0.5990      | **0.4990**    | Digit 4 tercetak 5                                       |
| Tabel A.13 (hlm. 45) | R1=0.2, R2=1.0, 30° | 0.5832      | **0.6832**    | Digit 6 tercetak 5                                       |
| Tabel A.14 (hlm. 48) | R1=0.4, R2=1.4, 30° | 0.6827      | **0.5827**    | Digit 5 tercetak 6                                       |
| Tabel A.14 (hlm. 48) | R1=0.6, R2=0.2, 20° | 0.5717      | **0.5917**    | Digit 9 tercetak 7 (akar anomali R2=0.4 di NOTE)         |
| Tabel A.14 (hlm. 48) | R1=0.6, R2=1.4, 0°  | 0.5615      | **0.5915**    | Digit 9 tercetak 6 (akar anomali R2=1.6 di NOTE)         |
| Tabel A.14 (hlm. 50) | R1=1.8, R2=0.6, 20° | 0.7065      | **0.4065**    | Digit 4 tercetak 7                                       |
| Tabel A.14 (hlm. 50) | R1=1.8, R2=1.4, 20° | 0.5047      | **0.4047**    | Digit 4 tercetak 5                                       |
| Tabel A.15 (hlm. 51) | R1=0.2, R2=0.6, 30° | 0.6146      | **0.6746**    | Digit 7 tercetak 1 (akar anomali R2=0.8 di NOTE)         |
| Tabel A.15 (hlm. 51) | R1=0.4, R2=0.4, 30° | 0.5258      | **0.6258**    | Digit 6 tercetak 5                                       |
| Tabel A.15 (hlm. 52) | R1=0.8, R2=1.4, 20° | 0.44960     | **0.4960**    | Kelebihan angka 4 di depan (akar anomali R2=1.6 di NOTE) |
| Tabel A.16 (hlm. 54) | R1=0.4, R2=0.2, 30° | 0.5356      | **0.6356**    | Digit 6 tercetak 5                                       |
| Tabel A.16 (hlm. 54) | R1=0.4, R2=0.4, 30° | 0.5044      | **0.6044**    | Digit 6 tercetak 5                                       |
| Tabel A.16 (hlm. 55) | R1=0.8, R2=0.2, 30° | 0.4354      | **0.4954**    | Digit 9 tercetak 3 (akar anomali R2=0.4 di NOTE)         |

# BAGIAN 4 — Anomali Cetak Tambahan di Luar \[!NOTE\] (14 Sel)

Anomali berikut terdeteksi melalui perhitungan ulang rumus SNI dan
pemeriksaan kelengkungan deret.

| Tabel (Halaman PDF)  | Koordinat           | Nilai Cetak | Saran Koreksi | Pola Salah Cetak di PDF                                                |
|----------------------|---------------------|-------------|---------------|------------------------------------------------------------------------|
| Tabel A.5 (hlm. 37)  | R=1.2, 20°          | 0.6685      | **0.6625**    | Digit 2 tercetak 8 (lebih besar dari R=1.1 yaitu 0.6640)               |
| Tabel A.6 (hlm. 38)  | R=0.5, 20°          | 0.6550      | **0.6500**    | Digit 0 tercetak 5 (hasil rumus sekitar 0.6498)                        |
| Tabel A.6 (hlm. 38)  | R=0.7, 50°          | 0.4581      | **0.4851**    | Digit 85 tertukar jadi 58 (hasil rumus sekitar 0.4850)                 |
| Tabel A.7 (hlm. 39)  | R=2.4, 20°          | 0.4770      | **0.4759**    | Sudah mencapai nilai datar 0.4759 sejak R=2.3                          |
| Tabel A.9 (hlm. 41)  | R=1.1, 30°          | 0.71173     | **0.7173**    | Kelebihan angka 1 di tengah                                            |
| Tabel A.9 (hlm. 41)  | R=2.1, 50°          | 0.7056      | **0.7026**    | Digit 2 tercetak 5 (lebih besar dari R=2.0 yaitu 0.7052)               |
| Tabel A.10 (hlm. 42) | R=0.4, 50°          | 0.8578      | **0.8078**    | Digit 0 tercetak 5 (lebih besar dari R=0.3 yaitu 0.8555)               |
| Tabel A.10 (hlm. 42) | R=2.4, 10°          | 0.5987      | **0.5897**    | Digit 89 tertukar / duplikat baris atas 0.5987                         |
| Tabel A.13 (hlm. 45) | R1=0.4, R2=0.2, 0°  | 0.7284      | **0.7184**    | Digit 1 tercetak 2 (selisih +0.0100 dari hasil rumus)                  |
| Tabel A.15 (hlm. 53) | R1=1.4, R2=0.2, 30° | 0.4851      | **0.4815**    | Digit 15 tertukar jadi 51 (hasil rumus 0.4815)                         |
| Tabel A.15 (hlm. 53) | R1=1.6, R2=0.2, 30° | 0.477       | **0.4777**    | Kurang digit 7 terakhir (di .md tertulis 0.4770)                       |
| Tabel A.15 (hlm. 53) | R1=1.8, R2=1.6, 20° | 0.472       | **0.4772**    | Hilang angka 7 (di .md tertulis 0.4720)                                |
| Tabel A.16 (hlm. 54) | R1=0.2, R2=1.6, 30° | 0.5475      | **0.5375**    | Digit 3 tercetak 4 (lebih besar dari R2=1.4 yaitu 0.5465)              |
| Tabel A.16 (hlm. 55) | R1=1.2, R2=1.4, 0°  | 0.4648      | **0.4678**    | Digit 7 tercetak 4 (deret tetap -0.0035: 0.4713 -\> 0.4678 -\> 0.4643) |

# BAGIAN 5 — Catatan Tambahan

- **Anomali Minor:** Pada Tabel A.16 (hlm. 56), R1=1.8, R2=1.8, 20°:
  > tertulis 0.4442 (sama dengan baris atasnya), sedangkan tren deret
  > turun konsisten -0.0003 menunjukkan **0.4439**.

- **Salah Cetak Data Matahari Dasar (Tabel A.1–A.4):** Ditemukan 4
  > ketidakcocokan ID + Id != IT pada PDF asli:

  - Tabel A.1 jam 12.00 Mar/Sep: Id=129 vs IT=133.

  - Tabel A.1 jam 18.00 Jun: 81+33=114 vs IT=144.

  - Tabel A.2 jam 17.00 Des: Id=60 vs IT=50.

  - Tabel A.4 jam 12.00 Des: ID=144 vs seharusnya **244** agar
    > 244+144=388.

  - *Catatan:* Hal ini hanya relevan jika melakukan perhitungan ulang
    > dari data matahari mentah.

- **Rekomendasi Penerapan Backend (backend/sni_tables.py):** Terapkan
  > seluruh **34 koreksi nilai** di atas (atau tambahkan opsi mode
  > "ketat PDF" vs "terkoreksi matematis") agar hasil interpolasi
  > \$SC\_{eff}\$ selalu monotonik dan akurat.
