# Daftar Periksa Sebelum Publikasi Repositori (`PUBLISH_CHECKLIST.md`)

Dokumen ini mencatat langkah wajib sebelum repositori `ottv-3d-sni6389` dipublikasikan ke remote publik (GitHub/GitLab/lainnya).

## 1. Bersihkan Riwayat Git dari File PDF SNI Berhak Cipta

File `docs/SNI-6389-2020.pdf` sudah dihapus dari indeks aktif (`git rm --cached`) dan ditambahkan ke `.gitignore` (`docs/*.pdf`). Namun, blob PDF masih tersimpan di riwayat commit lama (sebelum Fase 3b).

Sebelum melakukan `git push` ke repositori publik, jalankan **`git filter-repo`** pada salinan bersih (backup terlebih dahulu):

```bash
# 1. Pasang git-filter-repo (bila belum terpasang)
pip install git-filter-repo

# 2. Hapus seluruh riwayat PDF SNI (baik di lokasi baru docs/ maupun lokasi lama NEW/)
git filter-repo --invert-paths \
  --path docs/SNI-6389-2020.pdf \
  --path "NEW/SNI-6389-2020.pdf" \
  --path-glob "*.pdf"

# 3. Verifikasi tidak ada lagi file PDF di seluruh riwayat git
git log --all --stat -- "*.pdf"
```

> **Catatan:** Jangan jalankan `git filter-repo` di tengah pengembangan aktif sebelum seluruh branch kerja digabungkan (`merge`), karena perintah ini menulis ulang seluruh hash commit.

## 2. Izin Publikasi `docs/templates/template_prodi.xlsx`

- File `docs/templates/template_prodi.xlsx` merupakan template kerja milik program studi / penyusun asli.
- **Wajib meminta izin tertulis** dari pemilik/prodi sebelum menyertakan file tersebut di repositori publik.
- Bila belum memperoleh izin publikasi:
  - Hapus `docs/templates/template_prodi.xlsx` dari indeks dan riwayat git (menggunakan `git filter-repo --invert-paths --path docs/templates/template_prodi.xlsx`), lalu tambahkan ke `.gitignore`.
  - Biarkan pengguna mengunggah template `.xlsx` lokal mereka sendiri saat mengekspor (`backend/template_filler.py` dan `backend/report_template_map.py` sudah mendukung path/bytes template dinamis).

## 3. Pemeriksaan Data Material & Sumber

- Pastikan katalog material bawaan (`backend/materials_and_epw.py`) hanya memuat material generik berstatus `nilai_tipikal`, dan setiap contoh produk bermerek memiliki URL datasheet resmi pada field `sumber` dengan label `Contoh produk`.
- Pastikan tidak ada path lokal mesin pengembang, kredensial, atau file model uji milik klien tanpa izin di folder `fixtures/` atau `backend/uploads/`.
