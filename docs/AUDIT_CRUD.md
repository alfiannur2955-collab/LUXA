# Audit Tambah, Ubah, Duplikat, Hapus, & Urungkan (CRUD) — LUXA

**Tanggal audit:** 22 November 2026 (`fase-4d-kontrol`, dilanjutkan penyempurnaan Katalog Material di `fase-4e-katalog`)  
**Aturan UX wajib (`docs/RENCANA.md` D4):**
1. Aksi **Hapus** memunculkan toast **"Urungkan"** selama **8 detik** (`showUndoToast`), bukan dialog pemblokir — kecuali **Hapus proyek tersimpan di browser** yang memakai dialog konfirmasi yang menyebut nama proyeknya (`showConfirmDeleteProjectDialog`).
2. Data bawaan (*Bawaan SNI*, *Referensi brand*, contoh model bawaan) tidak boleh diubah atau dihapus, hanya **"Duplikat lalu ubah"**.
3. **Ganti nama** dilakukan langsung di tempat (*inline rename*, `Enter` simpan, `Esc` batal).
4. Menghapus **material kustom yang sedang dipakai** memunculkan dialog **"Dipakai di N grup. Ganti dengan …"** + tombol **Batal** (`showReplaceMaterialDialog`).

---

## Matriks Audit Entitas Buatan Pengguna

| Entitas | Buat | Ubah / Ganti nama | Duplikat | Hapus | Urungkan (8 dtk) | Tersimpan di mana | Status & Perbaikan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1. Material kustom** | Form `+ Material baru` (validasi langsung, SC↔SHGC faktor 0,87, α & TD_EK SNI) | Ubah di panel detail / form (hanya `origin = user`); bawaan hanya **Duplikat & ubah** | Tombol **Duplikat & ubah** (bawaan, brand, maupun kustom) | Hapus langsung (toast Urungkan 8 dtk) bila tak dipakai; dialog **"Dipakai di N grup. Ganti dengan …"** bila aktif dipakai | Ya (8 dtk untuk hapus tak terpakai & ganti material) | `localStorage` (`luxa.materials.v1`) + disalin ke `config.settings.custom_materials` saat dipakai proyek | Dialog pengganti siap (`ui/dialogs.js`), katalog lengkap & migrasi dari `CUSTOM_MATERIALS` global diselesaikan di Fase 4e |
| **2. Tampilan tersimpan (`saved_views`)** | Tombol `+ Simpan` di pil bawah atau pintasan `S` | Ganti nama langsung di tempat (*inline input* di daftar view) | Tombol ikon **Duplikat** (`duplicateSavedViewInList`) | Tombol ikon **Hapus** | Ya — toast **Urungkan** 8 dtk memulihkan daftar & view aktif | `ProjectConfig.saved_views` (`.ottv.json` & autosave `luxa.project.v1`) | **Diperbaiki di 4d:** ditambah aksi Duplikat + Undo 8 dtk |
| **3. Alternatif Bandingkan (`alternatives`)** | Form `+ Tambah alternatif` (menjalankan `engine.analyze`) | Ganti nama langsung di tempat (*inline input* pada baris alternatif) | Tombol ikon **Duplikat** (membuat kode baru + salinan konfigurasi) | Tombol ikon **Hapus** | Ya — toast **Urungkan** 8 dtk memulihkan alternatif & pilihan aktif | State sesi aktif (`state.alternatives`) + riwayat saat `Pakai Alternatif` (`state.designHistory`) | **Diperbaiki di 4d:** ditambah Inline Rename, Duplikat, dan Undo 8 dtk |
| **4. Override Klasifikasi bidang (`group_category_overrides`)** | Dropdown peran di tabel **Grup terdeteksi** (Inspeksi) | Ubah langsung lewat dropdown peran | N/A (1 peran per grup) | Kembalikan ke peran semula lewat tombol Urungkan / dropdown | Ya — toast **Urungkan** 8 dtk mengembalikan peta override sebelumnya | `ProjectConfig.roles.group_category_overrides` (`.ottv.json` & autosave) | **Diperbaiki di 4d:** ditambah Undo 8 dtk otomatis setiap perubahan klasifikasi |
| **5. Penugasan material per peran / orientasi** | Pilih di panel/katalog Material (per peran & override kaca 8 arah di mode Lanjut) | Ganti pilihan kapan saja | N/A (penugasan referensi ID) | Kembalikan ke `Ikuti kaca utama` untuk override orientasi | Ya — toast **Urungkan** 8 dtk memulihkan material peran atau override orientasi | `ProjectConfig.settings` (`*_material_id`, `orientation_material_overrides`) | **Diperbaiki di 4d:** ditambah Undo 8 dtk untuk ganti material peran & hapus override orientasi |
| **6. Proyek tersimpan di browser (`luxa.projects.v1`)** | Tombol `+ Simpan` di panel **Model** (snapshot config, confirm, metadata OTTV) | Ganti nama langsung di tempat (*inline input*) | Tombol ikon **Duplikat** (`duplicateSavedProject`) | Tombol ikon **Hapus** -> dialog konfirmasi **menyebut nama proyek** | Pengecualian aturan D4: pakai dialog konfirmasi eksplisit | `localStorage` (`luxa.projects.v1`, terpisah dari autosave `luxa.project.v1`) | **Dibuat lengkap di 4d:** seluruh CRUD + dialog konfirmasi bernama |
| **7. Lokasi / EPW kustom (`custom_epw`)** | Unggah file `.epw` di panel **Lokasi** | Ganti dengan unggah `.epw` baru atau pindah kota SNI | N/A (1 file cuaca per proyek) | Tombol **Hapus EPW kustom** | Ya — toast **Urungkan** 8 dtk memulihkan data EPW sebelumnya | `ProjectConfig.settings.custom_epw` (`.ottv.json` & autosave) | **Diperbaiki di 4d:** ditambah Undo 8 dtk saat menghapus EPW kustom |

---

## Ringkasan Komponen Pendukung
- `frontend/src/ui/toast.js`: `showUndoToast(message, onUndo, 8000)`
- `frontend/src/ui/dialogs.js`: `showConfirmDeleteProjectDialog(name, onConfirm)` dan `showReplaceMaterialDialog({ materialName, usageCount, replacementOptions, onReplace })`
- `frontend/src/project.js`: `listSavedProjects`, `saveNamedProject`, `renameSavedProject`, `duplicateSavedProject`, `deleteSavedProject`
- `frontend/src/viewer/views.js`: `duplicateSavedViewInList`
