// Gaya laporan A3 (tegak/mendatar, terang/gelap). Kartu kaca: isian tembus pandang + blur latar + garis terang,
// di atas latar dengan gumpalan warna lembut supaya efek kacanya terbaca.
export const A3_CSS = `
@page { margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rp { --ink: #1E1F24; --muted: #6F675B; --faint: #9A9184; --line: rgba(30,31,36,0.1); --track: rgba(30,31,36,0.08);
  --bg: #EDEAE4; --glass: rgba(255,255,255,0.58); --glass-2: rgba(255,255,255,0.78); --glass-line: rgba(255,255,255,0.95);
  --shadow: 0 6mm 14mm rgba(60,45,30,0.10), inset 0 0.4mm 0 rgba(255,255,255,0.9);
  --amber: #E8890C; --teal: #138E86; --ok: #0F6E66; --ok-bg: rgba(19,142,134,0.14); --fail: #B3261E; --fail-bg: rgba(179,38,30,0.12);
  --blob1: rgba(244,155,26,0.28); --blob2: rgba(19,142,134,0.22); --blob3: rgba(120,140,200,0.16);
  color: var(--ink); background: #CFCAC2; }
.rp.dark { --ink: #F1EEE8; --muted: #AAA59C; --faint: #7E7A73; --line: rgba(255,255,255,0.12); --track: rgba(255,255,255,0.1);
  --bg: #1B1C20; --glass: rgba(42,43,49,0.55); --glass-2: rgba(48,49,56,0.72); --glass-line: rgba(255,255,255,0.13);
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

.glass { position: relative; background: var(--glass); border: 0.35mm solid var(--glass-line); border-radius: 7mm; box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(9mm) saturate(1.4); backdrop-filter: blur(9mm) saturate(1.4); }
.inner { position: absolute; inset: 18mm 20mm 20mm; display: grid; gap: 7mm; }
.portrait .inner { inset: 18mm 18mm 20mm; }

/* kepala & kaki */
.hd { display: flex; justify-content: space-between; align-items: flex-end; }
.hd .sec { display: flex; align-items: flex-end; gap: 5mm; }
.hd .no { font-size: 40pt; line-height: 0.8; font-weight: 800; color: transparent; -webkit-text-stroke: 0.5mm var(--amber); letter-spacing: -0.02em; }
.hd h2 { margin: 0; font-size: 24pt; line-height: 1; font-weight: 700; }
.hd .en { font-size: 9pt; color: var(--muted); margin-top: 1.5mm; }
.hd .brand { text-align: right; font-size: 8pt; color: var(--muted); line-height: 1.4; }
.hd .brand img { height: 8mm; display: block; margin-left: auto; margin-bottom: 1.5mm; }
.ft { position: absolute; left: 20mm; right: 20mm; bottom: 8mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: var(--faint); }

.kick { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--amber); margin: 0 0 2.5mm; }
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

/* grid dasbor */
.dash { display: grid; gap: 6mm; min-height: 0; }
.landscape .dash { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1.25fr; }
.portrait .dash { grid-template-columns: 1fr 1fr; grid-template-rows: auto auto 1fr; }
.order-last { order: 9; }
.card { display: flex; flex-direction: column; min-height: 0; }
.compass { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.compass .cw { position: relative; max-height: 100%; max-width: 100%; }
.span2 { grid-column: span 2; }
.fig { display: block; width: 100%; height: auto; }
.legend { display: grid; gap: 2.5mm; }
.legend div { display: grid; grid-template-columns: 4mm 1fr auto auto; gap: 3mm; align-items: center; font-size: 9pt; }
.legend i { width: 4mm; height: 4mm; border-radius: 1.2mm; }
.legend b { font-variant-numeric: tabular-nums; }
.legend em { font-style: normal; color: var(--muted); font-variant-numeric: tabular-nums; width: 11mm; text-align: right; }
.ringwrap { display: grid; grid-template-columns: 52mm 1fr; gap: 7mm; align-items: center; }
.portrait .ringwrap { grid-template-columns: 46mm 1fr; }
.ring .ring-n { font-size: 34px; font-weight: 800; }
.ring .ring-u { font-size: 12px; }
svg text { font-family: 'Plus Jakarta Sans', sans-serif; }
svg .tiny { font-size: 10px; } svg .sm { font-size: 12px; } svg .b { font-weight: 700; }

.compass { position: relative; }
.compass img { display: block; max-width: 100%; max-height: 100%; }
.keys { display: flex; gap: 5mm; font-size: 7.5pt; color: var(--muted); justify-content: center; margin-top: 1mm; }
.keys i { display: inline-block; width: 6mm; height: 0; border-top: 0.5mm solid var(--amber); vertical-align: middle; margin-right: 1.5mm; }
.keys i.dash { border-top-style: dashed; }
.keys i.dot { width: 2.5mm; height: 2.5mm; border: 0; border-radius: 50%; background: var(--amber); }
.clabel { position: absolute; transform: translate(-50%, -100%); padding: 1.2mm 2.5mm; border-radius: 2.5mm; font-size: 8pt; font-weight: 700; white-space: nowrap; background: var(--glass-2); border: 0.3mm solid var(--glass-line); }
.clabel span { color: var(--muted); font-weight: 600; margin-right: 1mm; }

.sides { display: grid; gap: 2mm; }
.srow { display: grid; grid-template-columns: 24mm 1fr 16mm 22mm; gap: 3mm; align-items: center; font-size: 9pt; padding: 2mm 3mm; border-radius: 3mm; }
.srow.hot { background: var(--glass-2); font-weight: 700; }
.srow i { height: 2.4mm; border-radius: 1.2mm; background: var(--track); position: relative; overflow: hidden; }
.srow i::after { content: ''; position: absolute; inset: 0 auto 0 0; width: var(--w); background: var(--c); border-radius: 1.2mm; }
.srow b { text-align: right; font-variant-numeric: tabular-nums; }
.srow .st { text-align: right; font-size: 8pt; font-weight: 700; }
.st.ok { color: var(--ok); } .st.fail { color: var(--fail); }

/* sisi terpanas */
.deep { display: grid; gap: 6mm; min-height: 0; }
.landscape .deep { grid-template-columns: 1.25fr 1fr; grid-template-rows: 1.35fr 1fr; min-height: 0; }
.deep > *, .dash > * { min-height: 0; }
.portrait .deep { grid-template-columns: 1fr 1fr; grid-template-rows: 1.3fr 1fr 0.8fr; }
.photo { position: relative; overflow: hidden; padding: 0; }
.photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.photo .over { position: absolute; left: 6mm; bottom: 6mm; padding: 5mm 6mm; }
.photo .over .big { font-size: 46pt; }
.inputs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2.5mm; }
.inputs div { border-radius: 3.5mm; background: var(--glass-2); border: 0.3mm solid var(--glass-line); padding: 2.5mm 3mm; }
.inputs dt { font-size: 7pt; color: var(--muted); margin: 0; }
.inputs dd { margin: 0.5mm 0 0; font-size: 11pt; font-weight: 700; font-variant-numeric: tabular-nums; }
.formula { font-family: 'Newsreader', Georgia, serif; font-style: italic; font-size: 11pt; margin: 4mm 0 0; padding: 3mm 4mm; border-radius: 3.5mm; background: var(--glass-2); }
.facades { position: relative; }
.facades { flex: 1; min-height: 0; display: flex; justify-content: center; align-items: flex-start; padding-bottom: 10mm; }
.fw { position: relative; max-width: 100%; max-height: 100%; }
.facades img { display: block; width: 100%; height: 100%; border-radius: 2mm; }
.flabels { position: absolute; left: 0; right: 0; top: 100%; height: 9mm; }
.flabels span { position: absolute; transform: translateX(-50%); top: 1.5mm; font-size: 8pt; white-space: nowrap; color: var(--muted); }
.flabels span b { color: var(--ink); margin-left: 1mm; }
.flabels span.hot b { color: var(--fail); }
.scale { display: grid; grid-template-columns: auto 60mm auto; gap: 2mm; align-items: center; font-size: 7.5pt; color: var(--muted); }
.scale i { height: 2.2mm; border-radius: 1.1mm; background: linear-gradient(90deg, #f6e7c8 0%, #eeb066 50%, #cf5a1f 70%, #7d1d10 100%); }
`;
