# Audit Lanjutan T5 — Fenestrasi & Skylight (C1, C3, C4, C5, C8, C10)

Dokumen ini merangkum tindak lanjut temuan audit pasca-T5 serta analisis khusus **C5 (Skylight pada RTTV)** untuk keputusan pengguna. Tidak ada teks standar SNI yang disalin ke repositori ini; seluruh rujukan ditulis sebagai parafrase teknis dan nomor pasal/tabel.

---

## 1. Status Tindak Lanjut Temuan Pasca-T5

| Kode | Topik | Status | Ringkasan |
|---|---|---|---|
| CI Excel | Presisi `u_fen_eff` & rumus Selisih | **Selesai** (`28b9f0c`) | `u_fen_eff` 6 desimal di engine/rematerial/Excel, rumus Selisih `=ROUND(ROUND(E{n},2)-G{n},2)`, `.luxa_tmp/` dihapus |
| C1 | Modul kaca virtual tanpa rangka | **Selesai** (`3d6102d`) | Bukaan kaca lebar/tinggi tanpa rangka dipecah ke `settings.glass_module_width_mm` (bawaan `1500 mm`, tinggi = tinggi lantai) |
| C3 | Lebar kusen terukur > 200 mm | **Selesai** (`8e29b86`) | Lebar terukur > 200 mm tidak dipakai untuk pita tepi $A_{\text{edge}}$; memakai `frame_width_mm` + peringatan `FRAME_REVIEW_NEEDED` |
| C4 | Cadangan $U_{\text{frame}}$ & rangka kustom | **Selesai** (`c26db2d`) | Mode SNI kosong/tak dikenal → `8,0`; rangka kustom dengan $U < \text{Tabel 3}$ wajib `certified: true` + `sumber` |
| C8 | Label WWR | **Selesai** (`3278b1c`) | Layar dan semua ekspor memakai `"Porsi fenestrasi (kaca + kusen)"` |
| C10 | Paritas rematerial `frame_width_mm` | **Selesai** (`f53214a`) | `tests/test_rematerial_frame_parity.py` + penyelarasan key kanonik `orientation_breakdown` |
| **C5** | **Skylight pada RTTV ($U_s$ vs $U_f$)** | **Menunggu keputusan** | Kode belum diubah; analisis di §2 di bawah |

---

## 2. Analisis C5 — Apakah $U$ Skylight ($U_s$) pada RTTV Harus Memakai $U_f$ Tiga Zona?

### 2.1 Kondisi Pembacaan Referensi SNI 6389:2020 Lokal
- Berkas penuh `docs/SNI-6389-2020.pdf` (khususnya hlm. 20, **Pasal 4.4 RTTV**) tidak tersedia di direktori lokal saat audit ini dijalankan (`docs/*.pdf` kosong).
- Yang tersedia di mesin lokal hanyalah dua berkas ekstrak di `Downloads` (`SNI63892020EkstrakFenestrasiUfLampiranC.pdf` dan `SNI63892020DefinisiR1R2LampiranAdan4353.pdf`), yang mencakup Pasal 3 (definisi), Pasal 4.3.2.2 + Tabel 3 + Tabel 4, Lampiran A, dan Lampiran C.
- Karena redaksi persis **Pasal 4.4.2.1** (definisi simbol $U_s$ dan apakah ada rujukan eksplisit ke Pasal 4.3.2.2 / Tabel 3) belum dapat dibaca langsung dari hlm. 20, konfirmasi akhir perlu dicek pengguna pada PDF SNI 6389:2020 penuh.

### 2.2 Dasar Teknis dari Pasal yang Terbaca
1. **Secara definisi istilah (Pasal 3):**
   - **Butir 3.11** mendefinisikan *selubung bangunan* meliputi **dinding dan atap**, baik transparan maupun tidak transparan.
   - **Butir 3.7** mendefinisikan *fenestrasi* sebagai bukaan pada selubung bangunan (tidak dibatasi hanya pada dinding vertikal).
   - **Butir 3.8** menyatakan kusen pada sistem fenestrasi berperan sebagai *jembatan termal*, dan **butir 3.15** mendefinisikan $U_f$ sebagai kombinasi nilai $U$ kaca dan kusen/rangka.
2. **Secara cakupan Pasal 4.3.2.2, Tabel 3, dan Lampiran C:**
   - Judul **4.3.2.2** adalah *Dinding Transparan* dan **Tabel 3** bertajuk nilai $U$ untuk *kusen jendela*; contoh **Lampiran C** memakai skenario jendela untuk perhitungan OTTV. Tidak ada penyebutan skylight atau RTTV di halaman-halaman ekstrak tersebut.
3. **Secara fisika perpindahan panas:**
   - Skylight tetap dipasang di atas rangka/mullion (umumnya aluminium atau baja), sehingga efek jembatan termal rangka pada tepi kaca skylight **secara fisik nyata** (bahkan dalam standar NFRC/ASHRAE, nilai $U$ skylight umumnya lebih tinggi dibanding jendela vertikal sejenis karena arah aliran konveksi panas ke atas pada kemiringan atap).

### 2.3 Kondisi Kode Saat Ini & Besaran Dampak Numerik
- Saat ini di [`backend/ottv_engine.py`](file:///e:/PROJECT/ottv-3d-sni6389/backend/ottv_engine.py) (`compute_rttv`, baris 1900 & 3158) dan [`backend/recommender.py`](file:///e:/PROJECT/ottv-3d-sni6389/backend/recommender.py), $U_s$ memakai nilai $U_{\text{cog}}$ kaca dari katalog (`pm_sky["u_value"]`), **belum** memakai $U_f$ tiga zona.
- Rumus RTTV (Pasal 4.4.2.1):
  $$\text{RTTV} = \frac{\alpha \cdot A_r \cdot U_r \cdot \text{TD}_{\text{ek}} + A_s \cdot U_s \cdot \Delta T + A_s \cdot \text{SC} \cdot \text{SF}_{\text{atap}}}{A_r + A_s}$$
- Dengan $\Delta T = 5,0\text{ K}$ dan rasio skylight ($\text{SRR} = A_s / A_o$) lazim 5%–15%, kenaikan $U_s$ dari $U_{\text{cog}}$ ke $U_f$ (mis. $+1,3\text{ hingga }+2,0\text{ W/m}^2\text{K}$) memberi tambahan konduksi skylight sekitar:
  - SRR 5%: $+0,33\text{ hingga }+0,50\text{ W/m}^2$
  - SRR 10%: $+0,65\text{ hingga }+1,00\text{ W/m}^2$
  - SRR 15%: $+0,98\text{ hingga }+1,50\text{ W/m}^2$
- Sebagai pembanding, suku radiasi surya skylight ($\text{SF}_{\text{atap}}$ Jakarta `427 W/m²`) jauh lebih dominan (pada SRR 10% dan SC `0,35`, radiasi saja sudah `14,95 W/m²`). Namun pada desain yang sangat dekat dengan batas RTTV `35 W/m²`, selisih `0,5–1,5 W/m²` tetap bisa menentukan status lolos/tidak.

### 2.4 Pilihan Keputusan untuk Pengguna

| Opsi | Perilaku di LUXA | Kelebihan | Catatan / Risiko |
|---|---|---|---|
| **Opsi A — Pakai $U_f$ tiga zona untuk skylight ($U_s = U_f$)** *(Rekomendasi teknis bila Pasal 4.4 merujuk ke sistem fenestrasi / 4.3.2.2)* | Panel skylight (menghadap atas, ditandai skylight) dihitung $U_f$ tiga zona memakai `u_frame_eff`, `frame_width_mm`, dan modul virtual bila tanpa rangka skylight terukur. | Konsisten dengan definisi selubung + fenestrasi + jembatan termal (butir 3.7, 3.8, 3.11, 3.15) dan konservatif terhadap batas 35 W/m². | Mengubah angka RTTV untuk model berskylight (perlu pembaruan uji `16_skylight` / RTTV); bila rangka skylight tidak dimodelkan, memakai asumsi `frame_width_mm` & modul kaca dinding. |
| **Opsi B — Pertahankan $U_s = U_{\text{cog}}$** *(Bila Pasal 4.4.2.1 hanya menyebut nilai $U$ bahan/kaca skylight tanpa rujukan ke 4.3.2.2)* | Kode RTTV tidak diubah; tambahkan catatan singkat di laporan RTTV bahwa $U_s$ memakai $U$ kaca katalog (belum memasukkan jembatan termal rangka skylight). | Tidak mengubah angka RTTV dan tidak memaksakan asumsi rangka dinding ke struktur skylight. | Kurang konservatif sekitar `0,3–1,5 W/m²` bila skylight memakai rangka aluminium tanpa thermal break. |

**Pertanyaan untuk pengguna:** Mohon cek Pasal 4.4.2.1 (hlm. 20) pada PDF SNI 6389:2020 milikmu — apakah simbol $U_s$ merujuk ke sistem fenestrasi / Pasal 4.3.2.2 ($U_f$), dan apakah kamu ingin memilih **Opsi A ($U_s = U_f$ tiga zona)** atau **Opsi B (tetap $U_s = U_{\text{cog}}$ dengan catatan)**?
