// Gaya laporan A3 (tegak/mendatar, terang/gelap). Kartu kaca: isian tembus pandang + blur latar + garis terang,
// di atas latar dengan gumpalan warna lembut supaya efek kacanya terbaca.
export const A3_CSS = `
@page { margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rp { --ink: #1E1F24; --muted: #6F675B; --faint: #9A9184; --line: rgba(30,31,36,0.1); --track: rgba(30,31,36,0.08);
  --bg: #FFFFFF; --panel: #F7F6F3; --panel-line: #ECE9E3; --panel-shadow: none; --panel-blur: none; --glass: rgba(255,255,255,0.62); --glass-2: rgba(255,255,255,0.78); --glass-line: rgba(255,255,255,0.95);
  --shadow: 0 6mm 14mm rgba(60,45,30,0.10), inset 0 0.4mm 0 rgba(255,255,255,0.9);
  --amber: #E8890C; --teal: #138E86; --ok: #0F6E66; --ok-bg: rgba(19,142,134,0.14); --fail: #B3261E; --fail-bg: rgba(179,38,30,0.12);
  --blob1: rgba(244,155,26,0.28); --blob2: rgba(19,142,134,0.22); --blob3: rgba(120,140,200,0.16);
  color: var(--ink); background: #CFCAC2; }
.rp.dark { --ink: #F1EEE8; --muted: #AAA59C; --faint: #7E7A73; --line: rgba(255,255,255,0.12); --track: rgba(255,255,255,0.1);
  --bg: #1B1C20; --panel: rgba(42,43,49,0.55); --panel-line: rgba(255,255,255,0.12); --panel-shadow: 0 6mm 16mm rgba(0,0,0,0.4); --panel-blur: blur(9mm) saturate(1.4); --glass: rgba(42,43,49,0.55); --glass-2: rgba(48,49,56,0.72); --glass-line: rgba(255,255,255,0.13);
  --shadow: 0 6mm 16mm rgba(0,0,0,0.45), inset 0 0.4mm 0 rgba(255,255,255,0.07);
  --amber: #F6B24A; --teal: #5EC4BA; --ok: #5EC4BA; --ok-bg: rgba(94,196,186,0.16); --fail: #F2867E; --fail-bg: rgba(242,134,126,0.16);
  --blob1: rgba(244,155,26,0.22); --blob2: rgba(19,142,134,0.26); --blob3: rgba(90,110,180,0.2);
  background: #0E0F11; }
.page { position: relative; overflow: hidden; background: var(--bg); margin: 0 auto 10mm; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.landscape .page { width: 420mm; height: 297mm; }
.portrait .page { width: 297mm; height: 420mm; }
@media print { .rp { background: none; } .page { margin: 0; } }
/* gumpalan warna di belakang kaca */
.blob { position: absolute; border-radius: 50%; filter: blur(30mm); }
.b1 { width: 170mm; height: 170mm; background: var(--blob1); left: -40mm; top: -50mm; }
.b2 { width: 200mm; height: 200mm; background: var(--blob2); right: -60mm; bottom: -70mm; }
.b3 { width: 140mm; height: 140mm; background: var(--blob3); left: 45%; top: 30%; }
.rp.light .blob { display: none; }

.glass { position: relative; background: var(--glass); border: 0.35mm solid var(--glass-line); border-radius: 7mm; box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(9mm) saturate(1.4); backdrop-filter: blur(9mm) saturate(1.4); }
.inner { position: absolute; inset: 16mm 18mm 17mm; display: grid; grid-template-rows: auto 1fr; gap: 6mm; }
.portrait .inner { inset: 16mm 16mm 17mm; }

/* kepala & kaki */
.hd { display: flex; justify-content: space-between; align-items: flex-end; }
.hd .sec { display: flex; align-items: flex-end; gap: 5mm; }
.hd .no { font-size: 40pt; line-height: 0.8; font-weight: 800; color: transparent; -webkit-text-stroke: 0.5mm var(--amber); letter-spacing: -0.02em; }
.hd h2 { margin: 0; font-size: 24pt; line-height: 1; font-weight: 700; }
.hd .en { font-size: 9pt; color: var(--muted); margin-top: 1.5mm; }
.hd .brand { text-align: right; font-size: 8pt; color: var(--muted); line-height: 1.4; }
.hd .brand img { height: 8mm; display: block; margin-left: auto; margin-bottom: 1.5mm; }
.ft { position: absolute; left: 18mm; right: 18mm; bottom: 7mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: var(--faint); }

.kick { font-size: 9pt; font-weight: 600; color: var(--muted); margin: 0 0 3mm; }
.note { font-size: 8.5pt; color: var(--muted); margin: 2mm 0 0; line-height: 1.4; }
.mid { font-size: 26pt; line-height: 1.05; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.ttl { font-size: 13pt; font-weight: 700; margin: 0 0 1mm; }
.sub { font-size: 8.5pt; color: var(--muted); margin: 0 0 4mm; line-height: 1.45; }
.card { padding: 7mm; }
.pill { display: inline-flex; align-items: center; gap: 1.5mm; height: 7mm; padding: 0 3.5mm; border-radius: 3.5mm; font-size: 9pt; font-weight: 700; }
.pill.ok { color: var(--ok); background: var(--ok-bg); }
.pill.fail { color: var(--fail); background: var(--fail-bg); }
.big { font-size: 58pt; line-height: 0.95; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.unit { font-size: 12pt; font-weight: 500; color: var(--muted); margin-left: 2mm; letter-spacing: 0; }

/* sampul */
.cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.landscape .cover-panel { position: absolute; left: 18mm; top: 18mm; bottom: 18mm; width: 150mm; padding: 12mm; display: flex; flex-direction: column; }
.portrait .cover-img { height: 62%; }
.portrait .cover-panel { position: absolute; left: 18mm; right: 18mm; bottom: 18mm; height: 190mm; padding: 13mm; display: grid; grid-template-columns: 1.1fr 1fr; grid-template-rows: auto 1fr; column-gap: 10mm; }
.cover-panel .logo { height: 10mm; margin-bottom: 14mm; }
.portrait .cover-panel .logo { grid-column: 1 / -1; margin-bottom: 8mm; }
.cover-panel h1 { font-size: 40pt; line-height: 1.02; font-weight: 800; letter-spacing: -0.025em; margin: 0 0 4mm; }
.cover-panel .by { font-size: 12pt; color: var(--muted); margin: 0 0 10mm; }
.cover-panel .by b { color: var(--ink); }
.cover-res { margin-top: auto; }
.cover-res .lbl { font-size: 9pt; color: var(--muted); margin-bottom: 2mm; }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 8mm; }
.meta div { border-radius: 4mm; background: var(--glass-2); border: 0.3mm solid var(--glass-line); padding: 3.5mm 4mm; }
.meta dt { font-size: 7.5pt; color: var(--muted); margin: 0 0 1mm; }
.meta dd { margin: 0; font-size: 11.5pt; font-weight: 700; }
.sunchip { position: absolute; right: 18mm; bottom: 18mm; padding: 4mm 5mm; display: flex; align-items: center; gap: 3mm; font-size: 8.5pt; }
.sunchip i { width: 5mm; height: 5mm; border-radius: 50%; background: var(--amber); box-shadow: 0 0 0 1.5mm rgba(244,155,26,0.25); }

/* panel isi: datar di tema terang, kaca di tema gelap */
.panel { position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0; padding: 6mm; border-radius: 5mm;
  background: var(--panel); border: 0.3mm solid var(--panel-line); box-shadow: var(--panel-shadow); -webkit-backdrop-filter: var(--panel-blur); backdrop-filter: var(--panel-blur); }

/* 02 Ringkasan */
.sum { display: grid; gap: 5mm; min-height: 0; grid-template-columns: repeat(12, 1fr); grid-template-rows: auto 1fr; }
.sum > * { min-height: 0; }
.kpi-main { grid-column: span 6; }
.kpi { grid-column: span 2; }
.paths { grid-column: span 3; }
.comp { grid-column: span 6; }
.side-list { grid-column: span 3; }
.portrait .sum { grid-template-columns: repeat(6, 1fr); grid-template-rows: auto auto auto 1fr; }
.portrait .comp { order: 9; }
.portrait .kpi-main, .portrait .comp { grid-column: span 6; }
.portrait .paths, .portrait .side-list { grid-column: span 3; }
.kpi-row { display: flex; align-items: center; justify-content: space-between; gap: 4mm; margin-bottom: 2mm; }
.ruler { display: block; width: 100%; height: auto; }
.kpi { justify-content: space-between; }
.ringwrap { display: grid; grid-template-columns: 1fr; gap: 6mm; align-content: center; justify-items: center; flex: 1; }
.ringwrap svg { width: 46mm; height: auto; }
.portrait .ringwrap { grid-template-columns: 44mm 1fr; justify-items: stretch; }
.legend { display: grid; gap: 2.5mm; width: 100%; }
.legend div { display: grid; grid-template-columns: 4mm 1fr auto 11mm; gap: 3mm; align-items: center; font-size: 9pt; }
.legend i { width: 4mm; height: 4mm; border-radius: 1.2mm; }
.legend b { font-variant-numeric: tabular-nums; }
.legend em { font-style: normal; color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
.ring .ring-n { font-size: 34px; font-weight: 800; }
.ring .ring-u { font-size: 12px; }
svg text { font-family: 'Plus Jakarta Sans', sans-serif; }
svg .tiny { font-size: 10px; } svg .sm { font-size: 12px; } svg .b { font-weight: 700; }

/* 03 Sisi terpanas */
.deep { display: grid; gap: 5mm; min-height: 0; grid-template-columns: repeat(12, 1fr); grid-template-rows: 1fr auto; }
.deep > * { min-height: 0; }
.photo { grid-column: span 5; position: relative; overflow: hidden; border-radius: 5mm; background: var(--panel); }
.tilep { grid-column: span 3; } .calc { grid-column: span 4; }
.calc .inputs { grid-template-columns: repeat(2, 1fr); } .portrait .calc .inputs { grid-template-columns: repeat(2, 1fr); }
.facp { grid-column: span 12; }
.portrait .deep { grid-template-columns: repeat(6, 1fr); grid-template-rows: 1fr auto auto; }
.portrait .photo { grid-column: span 6; grid-row: auto; }
.portrait .tilep, .portrait .calc { grid-column: span 3; }
.portrait .facp { grid-column: span 6; }
.photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.photo .over { position: absolute; left: 6mm; bottom: 6mm; padding: 5mm 6mm; border-radius: 5mm; }
.photo .over .big { font-size: 46pt; }
.over-meta { display: flex; align-items: center; gap: 3mm; margin-top: 3mm; font-size: 9pt; color: var(--muted); }
.tile { display: block; width: 100%; height: auto; flex: 1; min-height: 0; }
.facp-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; }
.compass { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.cw { position: relative; max-width: 100%; max-height: 100%; }
.compass img { display: block; width: 100%; height: 100%; }
.keys { display: flex; gap: 5mm; font-size: 7.5pt; color: var(--muted); justify-content: center; margin-top: 1mm; }
.keys i { display: inline-block; width: 6mm; height: 0; border-top: 0.5mm solid var(--amber); vertical-align: middle; margin-right: 1.5mm; }
.keys i.dash { border-top-style: dashed; }
.keys i.dot { width: 2.5mm; height: 2.5mm; border: 0; border-radius: 50%; background: var(--amber); }
.clabel { position: absolute; transform: translate(-50%, -100%); padding: 1.2mm 2.5mm; border-radius: 2.5mm; font-size: 8pt; font-weight: 700; white-space: nowrap; background: var(--glass-2); border: 0.3mm solid var(--glass-line); }
.clabel span { color: var(--muted); font-weight: 600; margin-right: 1mm; }

.sides { display: grid; gap: 2mm; }
.srow { display: grid; grid-template-columns: 22mm 1fr 12mm; gap: 3mm; align-items: center; font-size: 9pt; padding: 2mm 3mm; border-radius: 3mm; }
.sides { flex: 1; align-content: space-evenly; }
.ok { color: var(--ok); } .fail { color: var(--fail); }
.srow.hot { background: var(--glass-2); font-weight: 700; }
.srow i { height: 2.4mm; border-radius: 1.2mm; background: var(--track); position: relative; overflow: hidden; }
.srow i::after { content: ''; position: absolute; inset: 0 auto 0 0; width: var(--w); background: var(--c); border-radius: 1.2mm; }
.srow b { text-align: right; font-variant-numeric: tabular-nums; }
.srow .st { text-align: right; font-size: 8pt; font-weight: 700; }
.st.ok { color: var(--ok); } .st.fail { color: var(--fail); }

.inputs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2.5mm; }
.inputs div { border-radius: 3.5mm; background: var(--glass-2); border: 0.3mm solid var(--glass-line); padding: 2.5mm 3mm; }
.inputs dt { font-size: 7pt; color: var(--muted); margin: 0; }
.inputs dd { margin: 0.5mm 0 0; font-size: 11pt; font-weight: 700; font-variant-numeric: tabular-nums; }
.formula { font-family: 'Newsreader', Georgia, serif; font-style: italic; font-size: 11pt; margin: 4mm 0 0; padding: 3mm 4mm; border-radius: 3.5mm; background: var(--glass-2); }
.facades { position: relative; }
.facades { display: flex; justify-content: center; padding-bottom: 9mm; }
.fw { position: relative; aspect-ratio: var(--ar); width: min(100%, calc(var(--fh, 62mm) * var(--ar))); }
.portrait .fw { --fh: 78mm; }
.rp.light .meta div { background: #F4F2EE; border-color: #ECE9E3; }
.facades img { display: block; width: 100%; height: 100%; border-radius: 2mm; }
.flabels { position: absolute; left: 0; right: 0; top: 100%; height: 9mm; }
.flabels span { position: absolute; transform: translateX(-50%); top: 1.5mm; font-size: 8pt; white-space: nowrap; color: var(--muted); }
.flabels span b { color: var(--ink); margin-left: 1mm; }
.flabels span.hot b { color: var(--fail); }
.scale { display: grid; grid-template-columns: auto 60mm auto; gap: 2mm; align-items: center; font-size: 7.5pt; color: var(--muted); }
.scale i { height: 2.2mm; border-radius: 1.1mm; background: linear-gradient(90deg, #f6e7c8 0%, #eeb066 50%, #cf5a1f 70%, #7d1d10 100%); }
`;
