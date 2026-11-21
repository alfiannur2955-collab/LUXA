# CHANGELOG — Fase 1c (Ragam Model, Uji Sintetis & Korpus)

Branch: `fase-1c-ragam-model`

## Perbaikan Engine yang Ditemukan di Fase 1c

### B1 — Klasifikasi `IfcPlate` / `IfcCurtainWall` Opak & Konsistensi Filter Tepi Tipis
- **Masalah:** Di `backend/universal_pipeline.py` (`_parse_ifc_with_ifcopenshell`), elemen `IfcPlate` di dalam `IfcCurtainWall` yang memiliki material opak (`transparency <= 0.12`) tanpa kata kunci kaca (misalnya `Paint - Cadmium Orange` pada `Facade only to Alfian.ifc`) jatuh ke cabang `cat == "unknown" -> "glazing"`, sehingga seluruh panel spandrel/dinding opak dihitung sebagai kaca (`WWR = 100%`, OTTV `43.94 W/m²`, selisih `+5.34 W/m²` terhadap `.3dm`/`.obj`). Selain itu, `_filter_thin_edge_slivers_on_group` pada format non-IFC hanya menyaring `glazing`/`spandrel` dan melewatkan sisi ketebalan tipis `<= 8.5 cm` pada kategori `wall`.
- **Perbaikan:**
  1. Pada `_parse_ifc_with_ifcopenshell`, untuk `IfcPlate` / `IfcCurtainWall`: bila `transparency <= 0.12` dan nama gaya/material tidak mengandung kata kunci kaca (`glass`, `glaz`, `kaca`, `vision`), elemen diklasifikasikan sebagai `'spandrel'` (bila rentang Z elemen `<= 1.35 m`) atau `'wall'`, bukan `'glazing'`. Token `ifcplate` saja tidak pernah menentukan kaca.
  2. Pada `_filter_thin_edge_slivers_on_group`, menyamakan penyaringan tepi tipis panel (`<= 8.5 cm`, tercatat di `filtered_items`) untuk kategori `wall` agar konsisten dengan `_clean_solid_bim_element_faces` pada `.ifc`.
- **Hasil Verifikasi (`corpus/real/Facade only to Alfian`):**
  - `.3dm`: `OTTV = 38.79 W/m²`, `WWR = 87.2%`, `glz = 2206.57 m²`, `opq = 324.14 m²`
  - `.obj`: `OTTV = 38.79 W/m²`, `WWR = 87.2%`, `glz = 2206.58 m²`, `opq = 324.13 m²`
  - `.ifc`: `OTTV = 38.79 W/m²`, `WWR = 87.2%`, `glz = 2206.57 m²`, `opq = 324.10 m²`
  - Selisih antar ketiga format: **`0.00 W/m²`** (memenuhi kriteria `<= 0.1 W/m²`).

### Sampel IFC4 (`backend/samples/archicad_bim_curtainwall.ifc`)
- Mengganti generator `create_sample_ifc_preset` di `backend/universal_pipeline.py` dan file `backend/samples/archicad_bim_curtainwall.ifc` ke skema **IFC4** resmi via `ifcopenshell.api` sehingga seluruh 6 entitas `IfcShadingDevice` terparsir oleh `IfcOpenShell` dan menghasilkan $SC_{eff} \approx 0.82\text{–}0.85$ (tidak lagi `1.0`).
