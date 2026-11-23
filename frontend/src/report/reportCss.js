// Gaya laporan PDF (A4 tegak). Identitas LUXA: Plus Jakarta Sans, tinta #1E1F24, amber #F49B1A, teal #138E86.
// Kaca (glassmorphism) tidak tercetak dengan baik, jadi kartu memakai isian lembut + garis tipis bersudut 12 px.
export const REPORT_CSS = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #E9E6E0; }
body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #1E1F24; font-size: 9.5pt; line-height: 1.5;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: 210mm; height: 297mm; padding: 16mm 16mm 20mm; margin: 0 auto 8mm; background: #FFFFFF; overflow: hidden; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
@media print { html, body { background: #FFFFFF; } .page { margin: 0; } }

/* kepala dan kaki halaman */
.head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 4mm; margin-bottom: 7mm; border-bottom: 0.3mm solid #E6E1D8; }
.head img { height: 6.5mm; }
.head span { font-size: 8pt; color: #6F675B; }
.foot { position: absolute; left: 16mm; right: 16mm; bottom: 9mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: #8A8276; border-top: 0.3mm solid #EEEAE3; padding-top: 2.5mm; }

h1, h2, h3 { margin: 0; font-weight: 700; letter-spacing: -0.005em; }
h2 { font-size: 17pt; line-height: 1.2; margin-bottom: 2mm; }
h3 { font-size: 11pt; margin-bottom: 3mm; }
.kicker { font-size: 8pt; font-weight: 600; letter-spacing: 0.02em; color: #B86E0A; margin: 0 0 1.5mm; }
.lead { font-size: 9.5pt; color: #5E574C; margin: 0 0 6mm; max-width: 150mm; }
.muted { color: #6F675B; }
.num { font-variant-numeric: tabular-nums; }

/* sampul */
.cover .hero { width: 100%; height: 138mm; object-fit: cover; border-radius: 4mm; display: block; background: #F1EFEB; }
.cover h1 { font-size: 28pt; line-height: 1.1; margin: 8mm 0 2mm; }
.cover .by { font-size: 11pt; color: #5E574C; margin: 0 0 7mm; }
.cover .by b { color: #1E1F24; }
.band { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; align-items: stretch; }
.stats.grid2 { grid-template-columns: 1fr 1fr; }
.stats.grid2 dd { white-space: normal; font-size: 10pt; line-height: 1.3; }
.result { border-radius: 4mm; padding: 5mm 6mm; background: #F7F5F1; border: 0.3mm solid #E6E1D8; }
.result .lbl { font-size: 8pt; color: #6F675B; margin-bottom: 1mm; }
.result .big { display: flex; align-items: baseline; gap: 2mm; }
.result .big strong { font-size: 30pt; line-height: 1; font-variant-numeric: tabular-nums; }
.result .big span { font-size: 10pt; color: #6F675B; }
.pill { display: inline-flex; align-items: center; height: 6mm; padding: 0 3mm; border-radius: 3mm; font-size: 8pt; font-weight: 700; }
.pill.ok { color: #0F6E66; background: #E3F2EF; }
.pill.fail { color: #A3271F; background: #FBE7E4; }
.result .pill { margin-top: 3mm; }

/* grid angka: kolom sama lebar, sel setinggi seragam */
.stats { display: grid; grid-template-columns: repeat(var(--cols, 2), 1fr); gap: 3mm; }
.stats div { border-radius: 3mm; padding: 3mm 3.5mm; background: #F7F5F1; border: 0.3mm solid #EEEAE3; min-width: 0; }
.stats dt { font-size: 7.5pt; color: #6F675B; margin: 0 0 0.8mm; }
.stats dd { margin: 0; font-size: 11pt; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats.lg dd { font-size: 15pt; }
.stats dd small { font-size: 8pt; font-weight: 500; color: #6F675B; margin-left: 1mm; }

/* tiga jalur panas */
.parts { display: grid; gap: 2.5mm; }
.part { display: grid; grid-template-columns: 52mm 1fr 16mm 12mm; align-items: center; gap: 3mm; }
.part i { display: block; height: 2.2mm; border-radius: 1.1mm; background: #EEEAE3; position: relative; overflow: hidden; }
.part i::after { content: ''; position: absolute; inset: 0 auto 0 0; width: var(--w); border-radius: 1.1mm; background: var(--c); }
.part b { text-align: right; font-variant-numeric: tabular-nums; }
.part em { font-style: normal; text-align: right; color: #6F675B; font-variant-numeric: tabular-nums; }

.card { border-radius: 4mm; border: 0.3mm solid #E6E1D8; padding: 5mm; background: #FFFFFF; }
.card + .card { margin-top: 4mm; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.section { margin-bottom: 6mm; }

/* gambar heatmap + tabel sisi */
.heatimg { width: 100%; height: 74mm; object-fit: cover; border-radius: 4mm; display: block; background: #F1EFEB; }
.scale { display: grid; grid-template-columns: auto 1fr auto; gap: 2mm; align-items: center; font-size: 7.5pt; color: #6F675B; margin-top: 2.5mm; }
.scale i { height: 2.2mm; border-radius: 1.1mm; background: linear-gradient(90deg, #f6e7c8 0%, #eeb066 50%, #cf5a1f 70%, #7d1d10 100%); position: relative; }
.scale i::after { content: ''; position: absolute; left: 70%; top: -1mm; bottom: -1mm; border-left: 0.3mm dashed #1E1F24; }

table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
th { text-align: left; font-weight: 600; font-size: 7.5pt; color: #6F675B; padding: 0 2mm 1.8mm; border-bottom: 0.3mm solid #E6E1D8; }
td { padding: 1.8mm 2mm; border-bottom: 0.2mm solid #F0ECE5; font-variant-numeric: tabular-nums; }
th.r, td.r { text-align: right; }
tr.hot td { font-weight: 700; }
tr.total td { font-weight: 700; border-top: 0.3mm solid #1E1F24; border-bottom: 0; }
td .sw { display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: 0.7mm; margin-right: 2mm; vertical-align: -0.3mm; }
.st-ok { color: #0F6E66; font-weight: 600; }
.st-fail { color: #A3271F; font-weight: 600; }

/* rincian per sisi */
.side { border-radius: 4mm; border: 0.3mm solid #E6E1D8; padding: 4.5mm 5mm; break-inside: avoid; }
.side + .side { margin-top: 4mm; }
.side-head { display: grid; grid-template-columns: 1fr auto auto; gap: 3mm; align-items: center; margin-bottom: 3.5mm; }
.side-head h3 { margin: 0; }
.side-head .val { font-size: 13pt; font-weight: 700; font-variant-numeric: tabular-nums; }
.side-head .val small { font-size: 8pt; font-weight: 500; color: #6F675B; margin-left: 1mm; }
.inputs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2mm; margin-bottom: 3.5mm; }
.inputs div { border-radius: 2.5mm; background: #F7F5F1; padding: 2mm 2.5mm; }
.inputs dt { font-size: 7pt; color: #6F675B; margin: 0; }
.inputs dd { margin: 0; font-size: 9.5pt; font-weight: 700; font-variant-numeric: tabular-nums; }
.formula { font-family: 'Newsreader', Georgia, serif; font-style: italic; font-size: 10pt; background: #FBF7F0; border-radius: 2.5mm; padding: 2.5mm 3.5mm; margin: 0 0 3mm; color: #3A352E; }
.terms { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; font-size: 8pt; }
.terms div { display: flex; justify-content: space-between; border-top: 0.6mm solid var(--c); padding-top: 1.5mm; }
.terms b { font-variant-numeric: tabular-nums; }
.combo { font-size: 7.5pt; color: #6F675B; margin: -1.5mm 0 3mm; }

/* material */
.mat { border-radius: 4mm; border: 0.3mm solid #E6E1D8; padding: 4.5mm 5mm; display: grid; grid-template-columns: 12mm 1fr; gap: 4mm; break-inside: avoid; }
.mat + .mat { margin-top: 3.5mm; }
.mat .chip { width: 12mm; height: 12mm; border-radius: 3mm; border: 0.3mm solid rgba(0,0,0,0.08); }
.mat h3 { margin: 0 0 0.5mm; font-size: 10pt; }
.mat p { margin: 0 0 2.5mm; font-size: 8pt; color: #6F675B; }
.mat .stats { --cols: 4; }
.mat .stats div { padding: 2mm 2.5mm; }
.mat .stats dd { font-size: 9.5pt; }

.notes { font-size: 8pt; color: #5E574C; padding-left: 4mm; margin: 0; }
.notes li + li { margin-top: 1.5mm; }
.ribbon { display: inline-block; font-size: 8pt; font-weight: 700; color: #A3271F; background: #FBE7E4; border-radius: 2mm; padding: 1mm 2.5mm; margin-bottom: 3mm; }
`;
