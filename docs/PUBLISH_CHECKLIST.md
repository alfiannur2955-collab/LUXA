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

## 2. Template laporan (selesai di Fase 5c)

- Form "Building Envelope Compliance Form V2.0" sudah beredar luas (PUPR, dipakai juga di UGM), jadi tidak ada masalah izin.
- Sejak Fase 5c LUXA tidak lagi menyertakan file template itu. Laporan Excel dibuat sendiri oleh `backend/luxa_report.py`, dengan struktur yang meniru form lama dan kesalahannya diperbaiki.
- Tabel SF lama dari form itu tetap ada di `sni_tables.TEMPLATE_PRODI_SF_TABLE` sebagai pilihan "Tabel SF lama (template PUPR)".

## 3. Pemeriksaan Data Material & Sumber

- Pastikan katalog material bawaan (`backend/materials_and_epw.py`) hanya memuat material generik berstatus `nilai_tipikal`, dan setiap contoh produk bermerek memiliki URL datasheet resmi pada field `sumber` dengan label `Contoh produk`.
- Pastikan tidak ada path lokal mesin pengembang, kredensial, atau file model uji milik klien tanpa izin di folder `fixtures/` atau `backend/uploads/`.
