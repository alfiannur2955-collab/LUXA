# Audit Paritas Mode SNI vs Mode Simulasi (A3-18)

Dokumen ini mencatat perbandingan per suku antara **Mode SNI 6389:2020** dan **Mode Simulasi Eksplorasi** pada model korpus [`Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm`](file:///e:/PROJECT/ottv-3d-sni6389/corpus/_studi_peneduh/Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm) (Jakarta, pengaturan bawaan, material terkonfirmasi), beserta perbaikan yang diterapkan agar suku yang seharusnya sama benar-benar identik.

## 1. Ringkasan Temuan & Perbaikan

Sebelum perbaikan (`A3-18`), terdapat **dua ketidakkonsistenan yang tidak disengaja** di Mode Simulasi:

1. **Material kusen bawaan masih `frm_aluminium_thermal_break` (`U_frame = 2,10 W/m²K`) alih-alih `frm_aluminium_standar` (`U_frame = 8,00 W/m²K`).**
   - Di Mode SNI, `resolve_u_frame` mengunci kusen aluminium ke `8,0 W/m²K` sesuai Tabel 3 SNI 6389:2020 (`U_f = 2,854 W/m²K`, $Q_{\text{kaca}} = 11,51\text{ W/m}^2$).
   - Di Mode Simulasi, pengaturan bawaan yang sama memakai `2,10 W/m²K` (`U_f = 1,354 W/m²K`, $Q_{\text{kaca}} = 5,46\text{ W/m}^2$) — memangkas konduksi kaca diam-diam sebesar **−6,05 W/m²** padahal pengguna tidak mengganti kusen.
   - **Perbaikan:** Bawaan `frame_material_id` disamakan ke `frm_aluminium_standar` (`8,0 W/m²K`) di `backend/config_schema.py`, `backend/ottv_engine.py`, `backend/recommender.py`, `backend/loaders/classify.py`, `frontend/src/state.js`, dan `frontend/src/project.js`. Opsi `frm_aluminium_thermal_break` tetap tersedia di katalog bila pengguna sengaja mengujinya di Mode Simulasi.
2. **Jangkar SF Mode Simulasi masih memakai angka lama SNI 03-6389-2011 (`SNI_SF_ANCHORS`).**
   - Sebelum perbaikan, Mode Simulasi menginterpolasi dari `U=130, TL=113, T=112, TGR=97, S=97, BD=176, B=243, BL=211` (rata-rata `147,36 W/m²`; sisi Timur hanya `110,5 W/m²` dibanding `171,0 W/m²` pada SNI 2020 — melenceng **−60,5 W/m²**).
   - **Perbaikan:** `interpolate_sni_solar_factor` kini menerima `sf_table` dari **Tabel 8 SNI 6389:2020** untuk kota aktif (Jakarta: `U=148, TL=161, T=171, TGR=138, S=112, BD=152, B=197, BL=181`). Pengali iklim `sf_multiplier` hanya diterapkan saat pengguna mengunggah file `.epw` kustom agar tidak menggandakan koreksi kota.

Dampak ke angka baseline Mode SNI: **0,00 W/m²** (`compare_baseline.py` tetap 0 selisih).

---

## 2. Tabel Perbandingan Per Suku — `Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm` (Jakarta)

| Parameter / Suku | Mode SNI 6389:2020 | Simulasi (sebelum A3-18) | Simulasi (sesudah A3-18) | Status Paritas |
|---|---:|---:|---:|---|
| Verdict | `melebihi` | `simulasi` | `simulasi` | Sesuai desain (A3-16) |
| Luas selubung $A_o$ (m²) | 10.859,02 | 10.859,02 | 10.859,02 | **Identik** |
| Luas fenestrasi $A_f$ (m²) | 8.760,66 | 8.760,66 | 8.760,66 | **Identik** |
| Luas dinding masif $A_{\text{op}}$ (m²) | 2.098,36 | 2.098,36 | 2.098,36 | **Identik** |
| WWR efektif (%) | 80,70% | 80,70% | 80,70% | **Identik** |
| Muka kusen terukur $A_{\text{frame}}$ (m²) | 1.181,19 (`r = 13,5%`) | 1.181,19 (`r = 13,5%`) | 1.181,19 (`r = 13,5%`) | **Identik** |
| Pita tepi kaca $A_{\text{edge}}$ (m²) | 2.092,11 | 2.092,11 | 2.092,11 | **Identik** |
| Pusat kaca $A_{\text{cog}}$ (m²) | 5.487,36 | 5.487,36 | 5.487,36 | **Identik** |
| Lebar kusen & sumber | 87,6 mm (`terukur`) | 87,6 mm (`terukur`) | 87,6 mm (`terukur`) | **Identik** |
| Dinding: $\alpha$ / $U_w$ / $\text{TD}_{\text{ek}}$ | 0,40 / 0,62 / 15,0 K | 0,40 / 0,62 / 15,0 K | 0,40 / 0,62 / 15,0 K | **Identik** |
| Kaca & kusen: $U_{\text{cog}}$ / $U_{\text{frame}}$ | 1,10 / 8,00 W/m²K | 1,10 / **2,10** W/m²K | 1,10 / 8,00 W/m²K | **Identik** (diperbaiki) |
| $U_f$ tiga zona rata-rata (W/m²K) | 2,854 | **1,354** | 2,854 | **Identik** (diperbaiki) |
| Beda suhu $\Delta T$ Jakarta (K) | 5,0 | 5,0 | 5,0 | **Identik** (di kota lain Simulasi pakai $\Delta T$ iklim/EPW) |
| Faktor matahari SF rata-rata (W/m²) | 156,55 | **147,36** (tabel 2011) | 157,62 (Tabel 8 + interpolasi) | Selaras (+1,07 dari interpolasi sudut & kemiringan) |
| $\text{SC}_{\text{kaca}}$ | 0,230 | 0,230 | 0,230 | **Identik** |
| Faktor peneduh $\text{SC}_{\text{sh}}$ / $\text{SC}_{\text{eff}}$ | 0,887 / 0,2040 (Lampiran A) | 0,978 / 0,2250 (raycast Sept) | 0,978 / 0,2250 (raycast Sept) | Beda metode (disengaja) |
| **Suku 1 — Konduksi dinding (W/m²)** | **0,72** | **0,72** | **0,72** | **Identik** |
| **Suku 2 — Konduksi kaca (W/m²)** | **11,51** | **5,46** | **11,51** | **Identik** (diperbaiki) |
| **Suku 3 — Radiasi surya (W/m²)** | **25,29** | **26,86** | **28,72** | Beda metode peneduh + interpolasi SF |
| **OTTV total (W/m²)** | **37,52** | **33,04** | **40,95** | — |

### Perbandingan Per Orientasi (Sesudah Perbaikan A3-18)

| Sisi | Luas (m²) | WWR | $U_f$ SNI | $U_f$ Sim | SF SNI | SF Sim | $\text{SC}_{\text{sh}}$ SNI | $\text{SC}_{\text{sh}}$ Sim | $Q_{\text{dind}}$ | $Q_{\text{kaca}}$ | $Q_{\text{rad}}$ SNI | $Q_{\text{rad}}$ Sim | OTTV SNI | OTTV Sim |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| U | 1.353,5 | 79,4% | 2,902 | 2,902 | 148,0 | 155,2 | 0,959 | 0,977 | 0,77 | 11,52 | 25,92 | 27,68 | 38,21 | 39,96 |
| TL | 1.075,3 | 82,8% | 2,863 | 2,863 | 161,0 | 162,7 | 0,914 | 0,999 | 0,64 | 11,85 | 28,02 | 30,98 | 40,51 | 43,47 |
| T | 1.875,6 | 79,9% | 2,773 | 2,773 | 171,0 | 165,7 | 0,870 | 1,000 | 0,75 | 11,08 | 27,32 | 30,45 | 39,15 | 42,28 |
| TGR | 897,0 | 79,8% | 3,046 | 3,046 | 138,0 | 141,8 | 0,994 | 0,999 | 0,75 | 12,15 | 25,17 | 25,99 | 38,07 | 38,89 |
| S | 1.532,0 | 81,5% | 2,787 | 2,787 | 112,0 | 120,8 | 1,000 | 0,872 | 0,69 | 11,36 | 21,00 | 19,89 | 33,05 | 31,93 |
| BD | 1.631,1 | 79,9% | 2,819 | 2,819 | 152,0 | 152,0 | 0,929 | 0,994 | 0,75 | 11,26 | 25,94 | 27,77 | 37,95 | 39,77 |
| B | 685,0 | 80,7% | 3,246 | 3,246 | 197,0 | 189,6 | 0,680 | 0,995 | 0,72 | 13,09 | 24,87 | 35,02 | 38,69 | 48,84 |
| BL | 1.809,5 | 81,6% | 2,744 | 2,744 | 181,0 | 180,0 | 0,717 | 0,997 | 0,68 | 11,20 | 24,36 | 33,68 | 36,24 | 45,57 |

---

## 3. Penjelasan Sumber Selisih `23,98` vs `37,52`

Angka **37,52 W/m²** adalah hasil resmi Mode SNI 6389:2020 pasca-T5 untuk `Fasad_Tower_Twisted_OpsiA_SiripTerakota.3dm` di Jakarta (`0,72 + 11,51 + 25,29`). Selisih besar hingga sekitar **23,98 W/m²** pada skenario simulasi berasal dari gabungan empat faktor berikut:

1. **Bug bawaan kusen *thermal break* (sudah diperbaiki di A3-18):** sebelum perbaikan, Mode Simulasi otomatis memakai `U_frame = 2,10` alih-alih `8,00 W/m²K`, menurunkan $U_f$ dari `2,854` ke `1,354 W/m²K` dan memangkas konduksi kaca sebesar **−6,05 W/m²** (`11,51 → 5,46 W/m²`).
2. **Bug jangkar SF lama SNI 2011 (sudah diperbaiki di A3-18):** sebelum perbaikan, rata-rata SF di Mode Simulasi turun **−9,19 W/m²** (`156,55 → 147,36 W/m²`) dengan sisi Timur jatuh hingga **−60,5 W/m²**.
3. **Perbedaan metodologis Mode Simulasi (disengaja — bukan untuk kepatuhan):**
   - **$\Delta T$ iklim kota/EPW:** Mode SNI mengunci `5,0 K` (Pasal 4.2.2.1), sedangkan Mode Simulasi memakai $\Delta T$ iklim kota/EPW (contoh Bandung `3,2 K` atau EPW `2,5 K` menurunkan konduksi kaca sebesar 36–50%).
   - **Peneduh raycasting & kisi parametrik:** Mode SNI membaca Tabel Lampiran A (rata-rata tahunan dari geometri $R_1, R_2, \phi_1$), sedangkan Mode Simulasi menembakkan sinar 3D per jam 08.00–16.00 pada satu bulan desain (default September) dari titik tengah panel ($\text{SC}_{\text{sh}} = 0,28 + 0,72 \cdot f_{\text{terang}}$) dan dapat ditambah bonus kisi parametrik (`enable_parametric_louvers`, menurunkan $Q_{\text{radiasi}}$ sekitar `−5,3 W/m²`).
   - **Pilihan material eksploratif:** kaca ber-SC rendah yang dipilih manual di Mode Simulasi menurunkan nilai jauh (engine sebelum A3-18: kaca elektrokromik → `24,15 W/m²`).

> [!NOTE]
> Angka persis `23,98` tidak dapat direproduksi dengan engine saat ini dan pengaturan yang terdokumentasi (bulan desain 3/6/9/12, kota Jakarta/Bandung/Surabaya/Denpasar, EPW contoh, louver parametrik, semua kaca katalog). Kombinasi terdekat yang terukur: kaca elektrokromik `24,15`, louver parametrik `27,70`, Bandung `28,90`. Kemungkinan besar angka itu berasal dari sesi aplikasi dengan pengaturan lain (mis. material/override grup tertentu atau versi engine pra-T5). Penyebab struktural yang bisa dibuktikan adalah butir 1–3 di atas.
4. **Konteks historis pra-T5:** sebelum $U_f$ tiga zona diterapkan (`f013ec7`/`97a1618`), konduksi kaca belum memasukkan jembatan termal kusen `8,0 W/m²K` (OTTV SNI model ini dulu `30,45 W/m²`, bukan `37,52 W/m²`). Kini kedua mode memakai rumus $U_f$ tiga zona dan muka kusen terukur yang 100% identik, dan antarmuka menandai Mode Simulasi secara eksplisit (`A3-16`, `A3-17`).

## 4. Uji Regresi

Ditutup oleh [`tests/test_mode_parity.py`](file:///e:/PROJECT/ottv-3d-sni6389/tests/test_mode_parity.py):
- `test_default_frame_material_is_aluminium_standar`
- `test_simulasi_interpolates_sni2020_table8_city_sf`
- `test_twisted_opsia_sni_vs_simulasi_parity`
