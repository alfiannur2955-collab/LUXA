# Changelog Fase 6 — bersih-bersih dan tes (22 Nov 2026, dikerjakan Claude)

**Kode mati**
- `ottv_engine.py`: dihapus `load_raw_groups_from_file`, duplikat `RawGroupMesh` dan `tessellate_nurbs_surface_with_ladybug` (sudah diimpor dari pipeline), `compute_tilt_from_normal`, generator `create_sample_*`, dan impor tak terpakai, termasuk `rhino3dm` dan `trimesh`.
- `universal_pipeline.create_sample_ifc_preset`, `sni_tables.lookup_sceff`, dan `template_method.compute_template_radiation_term` dihapus.
- `main.ensure_sample_files` hanya membaca model contoh statis di `backend/samples`.
- Sisa temuan `vulture`: endpoint FastAPI (dipanggil lewat dekorator) dan `browser_api.dispatch` (dipanggil dari JS).

**Pemecahan `universal_pipeline.py`** (2.886 → sekitar 800 baris)
- `backend/loaders/`:
  - `types.py`: RawGroupMesh, Stage1GeometryAudit, skala satuan;
  - `classify.py`: kamus peran ID + EN dan saran material;
  - `rhino.py`;
  - `mesh.py`: OBJ/MTL;
  - `ifc.py`: IfcOpenShell;
  - `normalize.py`: pembersih geometri dan pemecah curtain wall;
  - `floors.py`: deteksi lantai.
- Nama lama tetap bisa diimpor dari `universal_pipeline`. `browser_api.enable_ifc` juga memperbarui `loaders.ifc`.
- Perilaku tidak berubah: snapshot 78 model (fixtures, kasus sintetis, sampel) identik byte demi byte, dan paritas engine browser (termasuk IFC) tetap lolos.

**Tes dan versi**
- `backend/test_ottv_engine.py` dihapus. Pemeriksaan yang masih berguna pindah ke `tests/test_core_units.py`.
- `pytest.ini` (`testpaths = tests`).
- Tes warna heatmap dilewati bila `frontend/node_modules` belum ada.
- `backend/version.py` (1.0.0) jadi satu-satunya sumber versi. Dipakai oleh FastAPI, `/api/health`, footer laporan Excel, dan panel Bantuan (lewat `__LUXA_VERSION__` di Vite).

**Dokumen dan CI**
- `README.md` untuk mahasiswa: cara pakai, menyiapkan model per software, membaca hasil dan laporan.
- `.github/workflows/tests.yml`: Python 3.12 + Node 20, menjalankan pytest di setiap push dan pull request.
- File sisa di root dihapus: dua duplikat model dari `fixtures/` dan satu EPW nyasar bernama `surabaya`.
