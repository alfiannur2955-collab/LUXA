// Laporan PDF A3 (mendatar/tegak, terang/gelap) bergaya bersih. Semua teks penjelas disusun dari angka engine.
import { escapeHtml as esc } from '../ui/escapeHtml.js';
import { sideVerdict, verdictInfo } from '../ui/verdict.js';
import { sidesOf, sideName, projectName } from '../present/content.js';
import { heatColor } from '../present/heat.js';
import { sunPath, floorStack } from './charts.js';

const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = (v) => nf(0).format(Number(v) || 0), f1 = (v) => nf(1).format(Number(v) || 0), f2 = (v) => nf(2).format(Number(v) || 0), f3 = (v) => nf(3).format(Number(v) || 0);
const pc = (v) => `${f0((Number(v) || 0) * 100)}%`;
const list = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')}, dan ${arr[arr.length - 1]}`);

const cssFor = (port) => `
@page { size: ${port ? '297mm 419.8mm' : '419.8mm 297mm'}; margin: 0; } /* sedikit di bawah A3 baku: Chrome tidak membulatkan ke 420,2 mm yang meninggalkan garis kertas putih */
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #9C978F; }
.pg { --ink: #1E1F24; --body: #44403A; --muted: #857E73; --line: rgba(30,31,36,0.12); --soft: rgba(30,31,36,0.07); --bg: #FFFFFF; --bg8: rgba(255,255,255,0.8); --bg0: rgba(255,255,255,0); --ok: #0F6E66; --fail: #B3261E; --sun: #E8890C; --glass: rgba(255,255,255,0.7); --gline: rgba(255,255,255,0.95);
  position: relative; width: ${port ? 297 : 419.8}mm; height: ${port ? 419.8 : 297}mm; margin: 0 auto 10mm; background: var(--bg); color: var(--ink); overflow: hidden; break-after: page; }
.pg.dark { --ink: #F2EFE9; --body: #CBC6BD; --muted: #8E8980; --line: rgba(255,255,255,0.13); --soft: rgba(255,255,255,0.09); --bg: #17181B; --bg8: rgba(23,24,27,0.8); --bg0: rgba(23,24,27,0); --ok: #5EC4BA; --fail: #F2867E; --sun: #F6B24A; --glass: rgba(30,31,35,0.62); --gline: rgba(255,255,255,0.12); }
@media print { html, body { background: var(--print-bg, #fff); } .pg { margin: 0; } }
/* gambar utama = latar satu halaman; tirai lembut di kiri dan bawah supaya teks yang melayang tetap terbaca */
.bg { position: absolute; inset: -1mm; } /* sedikit melewati tepi: tanpa garis putih karena pembulatan piksel */
.bg img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.veil { position: absolute; inset: 0; pointer-events: none;
  /* warna transparan ditulis dengan rgba warna latar: 'transparent' (hitam 0%) membuat gradasi keabuan di PDF */
  background: linear-gradient(90deg, var(--bg) 0%, var(--bg8) 30%, var(--bg0) 46%),
              linear-gradient(0deg, var(--bg) 0%, var(--bg) 14%, var(--bg8) 24%, var(--bg0) 36%); }
.top { position: absolute; left: 20mm; right: 20mm; top: 12mm; display: flex; align-items: center; justify-content: space-between; font-size: 8.5pt; color: var(--muted); }
.top img { height: 6mm; }
.top .crumb b { color: var(--ink); font-weight: 600; }
.txt { position: absolute; left: 20mm; top: 30mm; width: 130mm; bottom: 76mm; display: flex; flex-direction: column; justify-content: space-between; }
h1 { font-weight: 700; font-size: 44pt; line-height: 1; letter-spacing: -0.03em; margin: 0 0 6mm; }
.lede { font-family: 'Newsreader', Georgia, serif; font-style: italic; font-size: 16.5pt; line-height: 1.38; color: var(--body); margin: 0; letter-spacing: -0.005em; }
.lede b { font-style: italic; color: var(--ink); font-weight: 600; }
.lede b.fail, .stat .v.fail { color: var(--fail); } .lede b.ok, .stat .v.ok { color: var(--ok); }
.hs { font-weight: 600; } /* nama sisi berwarna skala panas di dalam kalimat */
h1 .acc { color: var(--acc); }
.stats { display: grid; grid-template-columns: repeat(3, auto); justify-content: start; column-gap: 10mm; padding: 5mm 0; border-top: 0.3mm solid var(--line); border-bottom: 0.3mm solid var(--line); }
.stat .k { font-size: 8.5pt; color: var(--muted); margin-bottom: 1.5mm; }
.stat .v { font-size: 28pt; font-weight: 500; letter-spacing: -0.015em; font-variant-numeric: tabular-nums; line-height: 1; }
.stat .v small { font-size: 9pt; font-weight: 400; color: var(--muted); margin-left: 1mm; letter-spacing: 0; }
.tag { display: inline-flex; align-items: center; height: 4.6mm; padding: 0 2mm; border-radius: 2.3mm; font-size: 7.5pt; font-weight: 600; vertical-align: 0.2mm; margin-left: 1.5mm; }
.tag.fail { color: var(--fail); background: color-mix(in srgb, var(--fail) 13%, transparent); }
.tag.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 13%, transparent); }
.tag.neutral { color: var(--muted); background: var(--soft); }
.tag.warn { color: var(--sun); background: color-mix(in srgb, var(--sun) 15%, transparent); }
.lede b.neutral, .stat .v.neutral, .big.neutral { color: var(--muted); }
.lede b.warn, .stat .v.warn, .big.warn { color: var(--sun); }
h2 { font-size: 12pt; font-weight: 600; margin: 0 0 2.5mm; letter-spacing: -0.005em; }
p.b { font-size: 10.5pt; line-height: 1.6; color: var(--body); margin: 0; }
p.b b { color: var(--ink); font-weight: 600; }
.split { display: flex; height: 3mm; border-radius: 1.5mm; overflow: hidden; margin: 4mm 0 3mm; }
.split i { display: block; height: 100%; }
.keys { display: flex; gap: 7mm; font-size: 8.5pt; color: var(--muted); }
.keys span::before { content: ''; display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: 0.8mm; background: var(--c); margin-right: 2mm; vertical-align: -0.3mm; }
.keys b { color: var(--ink); font-weight: 600; margin-left: 1mm; }
.call { position: absolute; }
.call i { position: absolute; left: 0; top: 0; width: 2.6mm; height: 2.6mm; margin: -1.3mm; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 1mm color-mix(in srgb, var(--ink) 18%, transparent); }
.call span { position: absolute; left: 0; bottom: 3.5mm; transform: translateX(-50%); white-space: nowrap; font-size: 9pt; color: var(--body); padding: 1.8mm 3.2mm; border-radius: 2.2mm; background: var(--glass); border: 0.3mm solid var(--gline); -webkit-backdrop-filter: blur(4mm); backdrop-filter: blur(4mm); }
.call span b { color: var(--ink); font-weight: 600; margin-left: 1.5mm; font-variant-numeric: tabular-nums; }
.call.over span b { color: var(--fail); }
/* pita bawah melayang di atas tirai: kepala baris + kolom bergaris rambut */
.strip { position: absolute; left: 20mm; right: 20mm; bottom: 15mm; border-top: 0.3mm solid var(--line); padding-top: 5mm; }
.strip-hd { display: flex; align-items: baseline; gap: 8mm; margin-bottom: 4.5mm; }
.strip-hd h2 { margin: 0; }
.strip-hd .inl { font-size: 9pt; color: var(--muted); }
.strip-hd .inl b { color: var(--ink); font-weight: 600; margin: 0 1mm; font-variant-numeric: tabular-nums; }
.cols { display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.col { padding: 0 5mm; border-left: 0.3mm solid var(--line); min-width: 0; }
.col:first-child { border-left: 0; padding-left: 0; }
.col .k { font-size: 8.5pt; color: var(--muted); white-space: nowrap; }
.col .v { font-size: 19pt; font-weight: 500; letter-spacing: -0.015em; font-variant-numeric: tabular-nums; margin: 1.5mm 0 2.5mm; white-space: nowrap; }
.col .v small { font-size: 8.5pt; font-weight: 400; color: var(--muted); margin-left: 0.8mm; }
.col .v.over { color: var(--fail); }
.col .bar { height: 1.6mm; border-radius: 0.8mm; background: var(--soft); position: relative; overflow: hidden; }
.col .bar::after { content: ''; position: absolute; inset: 0 auto 0 0; width: var(--w); background: var(--c); }
.col .s { font-size: 8pt; color: var(--muted); margin-top: 2mm; }
.lvl { position: absolute; height: 0; border-top: 0.25mm dashed var(--muted); opacity: 0.8; }
.lvl span { position: absolute; left: 0; bottom: 1mm; font-size: 7.5pt; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.lvl span b { color: var(--ink); font-weight: 600; margin-right: 1.5mm; }
.lvl.r span { left: auto; right: 0; }
.lvl.r::before { right: auto; left: -1.6mm; }
.lvl::before { content: ''; position: absolute; right: -1.6mm; top: -1.6mm; border: 1.6mm solid transparent; border-top-color: var(--muted); transform: translateY(1.6mm); }
.dimv, .dimh { position: absolute; border-color: var(--ink); border-style: solid; border-width: 0; }
.dimv { border-left-width: 0.25mm; } .dimh { border-top-width: 0.25mm; }
.dimv::before, .dimv::after, .dimh::before, .dimh::after { content: ''; position: absolute; width: 3mm; height: 0; border-top: 0.3mm solid var(--ink); transform: rotate(-45deg); }
.dimv::before { left: -1.5mm; top: 0; } .dimv::after { left: -1.5mm; bottom: 0; }
.dimh::before { left: -1.5mm; top: -0.15mm; } .dimh::after { right: -1.5mm; top: -0.15mm; }
.dimv span { position: absolute; left: 2.5mm; top: 50%; transform: translateY(-50%); font-size: 8.5pt; font-weight: 600; white-space: nowrap; }
.dimh span { position: absolute; top: 2mm; left: 50%; transform: translateX(-50%); font-size: 8.5pt; font-weight: 600; white-space: nowrap; }
.sbar { position: absolute; display: flex; align-items: flex-end; gap: 0; font-size: 7.5pt; color: var(--muted); }
.sbar i { display: block; height: 1.6mm; border: 0.25mm solid var(--ink); }
.sbar i:nth-child(odd) { background: var(--ink); }
.sbar .lab { position: absolute; top: 2.6mm; left: 0; right: 0; display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
.draw-cap { position: absolute; font-size: 9pt; color: var(--muted); white-space: nowrap; }
.draw-cap b { color: var(--ink); font-weight: 600; font-size: 11pt; margin-right: 2mm; }
.north { position: absolute; width: 16mm; height: 16mm; }
.keyimg { position: absolute; right: 18mm; top: 22mm; width: 64mm; text-align: center; }
.keyimg img { width: 100%; display: block; -webkit-mask-image: radial-gradient(closest-side, #000 72%, transparent); mask-image: radial-gradient(closest-side, #000 72%, transparent); }
.keyimg span { font-size: 8pt; color: var(--muted); }
.foot { position: absolute; left: 20mm; right: 20mm; bottom: 6mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: var(--muted); }
.formula { font-family: 'Newsreader', Georgia, serif; font-style: italic; font-size: 12pt; color: var(--ink); line-height: 1.45; margin: 0 0 3mm; }
.terms { display: grid; grid-template-columns: repeat(3, auto); justify-content: start; column-gap: 9mm; font-size: 8.5pt; color: var(--muted); }
.terms b { display: block; font-size: 15pt; font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; }
ol.why { margin: 0; padding: 0; list-style: none; counter-reset: w; }
ol.why li { counter-increment: w; display: grid; grid-template-columns: 7mm 1fr; align-items: start; font-size: 10.5pt; line-height: 1.55; color: var(--body); margin-bottom: 2.5mm; }
ol.why li::before { content: counter(w, decimal-leading-zero); font-size: 8.5pt; font-weight: 600; color: var(--sun); padding-top: 0.6mm; }
ol.why b { color: var(--ink); font-weight: 600; }
.strip2 { display: grid; grid-template-columns: 1fr 120mm; column-gap: 10mm; }
.vals { display: grid; grid-template-columns: repeat(5, 1fr); row-gap: 4mm; }
.vals div { padding: 0 4mm; border-left: 0.3mm solid var(--line); }
.vals div:nth-child(5n+1) { border-left: 0; padding-left: 0; }
.vals dt { font-size: 8pt; color: var(--muted); }
.vals dd { margin: 1mm 0 0; font-size: 14pt; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
.facbox { border-left: 0.3mm solid var(--line); padding-left: 8mm; }
.facbox img { display: block; width: 100%; height: 30mm; object-fit: contain; object-position: left center; margin: 1mm 0 2mm; }
.scale { display: flex; align-items: center; gap: 2mm; font-size: 7.5pt; color: var(--muted); }
.scale i { width: 34mm; height: 1.6mm; border-radius: 0.8mm; background: linear-gradient(90deg, #f6e7c8, #eeb066 50%, #cf5a1f 70%, #7d1d10); }
/* ---- halaman tanpa gambar latar: kolom-kolom bergaris rambut */
.body { position: absolute; left: 20mm; right: 20mm; top: 30mm; bottom: 18mm; display: flex; flex-direction: column; gap: 9mm; }
.body .hd { max-width: 190mm; }
.rows { display: grid; grid-template-columns: 30mm 30mm minmax(0, 1fr) minmax(0, 0.8fr) repeat(4, 22mm); column-gap: 6mm; align-items: center; }
.rows > div { padding: 3.4mm 0; border-top: 0.3mm solid var(--line); min-width: 0; }
.rows .th { font-size: 8pt; color: var(--muted); border-top: 0; padding: 0 0 1.5mm; }
.rows .nm { font-size: 13pt; font-weight: 600; }
.rows .ov { font-size: 17pt; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rows .ov small { font-size: 8pt; color: var(--muted); font-weight: 400; margin-left: 0.8mm; }
.rows .ov.over { color: var(--fail); }
.rows .nv { font-size: 11pt; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lbar { position: relative; height: 2.4mm; border-radius: 1.2mm; background: var(--soft); }
.lbar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 1.2mm; }
.lbar b { position: absolute; top: -1.6mm; bottom: -1.6mm; width: 0; border-left: 0.35mm dashed var(--ink); }
.tsplit { display: flex; height: 2.4mm; border-radius: 1.2mm; overflow: hidden; }
.tsplit i { display: block; height: 100%; }
.two { display: grid; grid-template-columns: 1fr 1fr; column-gap: 16mm; flex: 1; min-height: 0; }
.two > div { display: flex; flex-direction: column; gap: 4mm; min-height: 0; }
.fig { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.fig svg { max-width: 100%; max-height: 100%; width: 100%; height: 100%; }
.fig text.tiny { font-size: 10px; } .fig text.b { font-weight: 700; }
dl.spec { display: grid; grid-template-columns: repeat(var(--n, 4), 1fr); margin: 0; row-gap: 5mm; }
dl.spec div { padding: 0 5mm; border-left: 0.3mm solid var(--line); }
dl.spec div:nth-child(var(--n, 4)n+1) { border-left: 0; padding-left: 0; }
dl.spec dt { font-size: 8pt; color: var(--muted); }
dl.spec dd { margin: 1mm 0 0; font-size: 14pt; font-weight: 500; font-variant-numeric: tabular-nums; }
.mat { padding: 6mm 0; border-top: 0.3mm solid var(--line); display: grid; grid-template-columns: 52mm 1fr; column-gap: 10mm; }
.mat .k { font-size: 8.5pt; color: var(--muted); } .mat .n { font-size: 14pt; font-weight: 600; margin: 1mm 0 1mm; } .mat .br { font-size: 8.5pt; color: var(--muted); }
ul.do { margin: 0; padding: 0; list-style: none; counter-reset: d; }
ul.do li { counter-increment: d; display: grid; grid-template-columns: 9mm 1fr; padding: 4mm 0; border-top: 0.3mm solid var(--line); font-size: 11pt; line-height: 1.55; color: var(--body); }
ul.do li::before { content: counter(d, decimal-leading-zero); font-size: 9pt; font-weight: 600; color: var(--sun); padding-top: 0.8mm; }
ul.do b { color: var(--ink); font-weight: 600; }
.refs { font-size: 9pt; line-height: 1.6; color: var(--body); margin: 0; padding-left: 4.5mm; }
.sign { display: flex; gap: 14mm; font-size: 9pt; color: var(--muted); }
.sign b { display: block; font-size: 12pt; color: var(--ink); font-weight: 600; margin-top: 1mm; }
/* sampul */
.cover-k { font-size: 10pt; font-weight: 600; letter-spacing: 0.02em; color: var(--sun); margin: 0 0 4mm; }
.cover h1 { font-size: 64pt; max-width: 200mm; }
.big { font-size: 64pt; font-weight: 500; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.big small { font-size: 14pt; color: var(--muted); font-weight: 400; margin-left: 2mm; letter-spacing: 0; }
.big.ok { color: var(--ok); } .big.fail { color: var(--fail); }
/* ---- tegak: judul di atas, gambar di pita tengah, isi dua kolom di bawahnya */
.pt .veil { background: linear-gradient(180deg, var(--bg) 0%, var(--bg8) 16%, var(--bg0) 30%),
  linear-gradient(0deg, var(--bg) 0%, var(--bg) 36%, var(--bg8) 41%, var(--bg0) 50%); }
.pt .txt { right: 20mm; width: auto; top: 30mm; bottom: 74mm; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr auto auto; column-gap: 12mm; row-gap: 7mm; }
.pt .txt > .hd { grid-column: 1 / -1; grid-row: 1; max-width: 170mm; }
.pt .txt > :not(.hd) { grid-row: auto; }
.pt .txt > .stats { grid-column: 1 / -1; grid-row: 3; }
.pt .txt > .r4 { grid-row: 4; }
.pt .txt > .r3 { grid-row: 3; }
.pt .strip2 { grid-template-columns: 1fr; row-gap: 6mm; }
.pt .facbox { border-left: 0; padding-left: 0; border-top: 0.3mm solid var(--line); padding-top: 4mm; }
.pt .rows { grid-template-columns: 24mm 26mm minmax(0, 1fr) repeat(3, 17mm); column-gap: 4mm; }
.pt .rows .xp { display: none; }
.pt .two { grid-template-columns: 1fr; row-gap: 10mm; }
.pt .cover h1 { font-size: 54pt; }
.pt dl.spec { --n: 3 !important; }
.pt .mat { grid-template-columns: 1fr; row-gap: 3mm; }
.pt .keyimg { width: 54mm; }
/* sampul: gambar melebur ke halaman di semua tepi, tirai diberi tekstur awan */
/* sampul: tirai, tepi lembut, dan awan tipis sudah dilebur ke gambarnya (lebih ringan saat dicetak) */
.cover .veil { display: none; }
.pt.p3 .txt { bottom: 128mm; }
.pt .fig svg { max-height: 120mm; }
.facwide { flex: 1; min-height: 30mm; display: flex; flex-direction: column; gap: 3mm; }
.facwide img { flex: 1; min-height: 0; width: 100%; object-fit: contain; object-position: left top; }
`;

export function buildMockup(state, { assets, theme = 'light', orient = 'land', logoUrl = '', userName = '', date = new Date() }) {
  const port = orient === 'port';
  const PT = port ? ' pt' : '';
  // warna skala panas yang tetap terbaca sebagai teks: dicampur sedikit dengan warna tinta
  const tHeat = (v) => `color-mix(in srgb, ${heatColor(v)} 72%, var(--ink))`;
  const sn = (r) => `<span class="hs" style="color:${tHeat(r.ottv_orientation_wm2)}">${sideName(r.code)}</span>`;
  const a = state.analysisData, s = a.summary || {};
  const limit = Number(a.sni_limit_wm2 || 35), ottv = Number(a.ottv_total_wm2);
  const vi = verdictInfo(a, 2);
  const sides = sidesOf(a);
  const byHeat = [...sides].sort((x, y) => y.ottv_orientation_wm2 - x.ottv_orientation_wm2);
  const hot = byHeat[0], cool = byHeat[byHeat.length - 1];
  const over = sides.filter((r) => r.ottv_orientation_wm2 > limit);
  const tot = Number(s.q_wall_conduction_wm2) + Number(s.q_glass_conduction_wm2) + Number(s.q_solar_radiation_wm2);
  const share = (x) => Number(x || 0) / (tot || 1);
  const sf = a.location_info?.sf_table || {};
  const sfMax = Math.max(...sides.map((r) => Number(r.sni_sf_wm2) || 0));
  const name = projectName(a);
  const dk = (theme === 'dark' ? ' dark' : '') + PT;
  const top = (crumb, n) => `<div class="top">${logoUrl ? `<img src="${logoUrl}" alt="LUXA">` : '<b>LUXA</b>'}<span class="crumb">${esc(name)} · <b>${crumb}</b></span><span>${String(n).padStart(2, '0')} / {{N}}</span></div>`;
  const tagCls = (cls, text) => `<span class="tag ${cls}">${esc(text)}</span>`;

  // ---- 02 Ringkasan
  const lede = vi.isOk
    ? `Rata-rata panas yang masuk lewat selubung gedung ini <b>${f2(ottv)} W/m²</b>. Batas SNI 6389:2020 adalah ${f0(limit)} W/m², jadi gedung ini <b class="ok">memenuhi syarat</b> (${esc(vi.delta.short)}).`
    : vi.isFail
      ? `Rata-rata panas yang masuk lewat selubung gedung ini <b>${f2(ottv)} W/m²</b>. Batas SNI 6389:2020 adalah ${f0(limit)} W/m², jadi gedung ini <b class="fail">${esc(vi.delta.short.toLowerCase())}</b> dan belum memenuhi syarat.`
      : vi.isSim
        ? `Rata-rata panas yang masuk lewat selubung gedung ini <b>${f2(ottv)} W/m²</b> pada <b class="neutral">mode simulasi eksplorasi</b> (bukan untuk kepatuhan SNI). ${esc(vi.delta.short)}.`
        : `Rata-rata panas yang masuk lewat selubung gedung ini <b>${f2(ottv)} W/m²</b> (<b class="warn">hasil sementara</b> — perlu konfirmasi model/material sebelum evaluasi kepatuhan).`;
  const pS = share(s.q_solar_radiation_wm2), pW = share(s.q_wall_conduction_wm2), pG = share(s.q_glass_conduction_wm2);
  const pathTxt = pS >= 0.5
    ? `Sebagian besar panas, <b>${pc(pS)}</b>, masuk sebagai sinar matahari yang menembus kaca. Porsi kaca gedung ini ${pc(s.effective_wwr)}, jadi dinding padat hanya menyumbang ${pc(pW)} dan perpindahan panas lewat kaca karena beda suhu ${pc(pG)}.`
    : `Panas masuk lewat tiga jalur: sinar matahari lewat kaca ${pc(pS)}, beda suhu lewat kaca ${pc(pG)}, dan dinding ${pc(pW)}.`;
  const sideOverTxt = vi.isSniFinal
    ? (over.length ? `${over.length} dari ${sides.length} sisi melewati batas: ${list(over.map((r) => sn(r)))}.` : `Semua ${sides.length} sisi berada di bawah batas.`)
    : `Terdapat ${sides.length} sisi fasad aktif pada ${vi.isSim ? 'simulasi ini' : 'hasil sementara ini'}.`;
  const sideTxt = `Sisi ${sn(hot)} paling panas (${f2(hot.ottv_orientation_wm2)} W/m²)${Number(hot.sni_sf_wm2) >= sfMax ? `, karena menerima sinar terkuat di ${esc(a.location_info?.city || 'lokasi ini')}: faktor matahari ${f0(hot.sni_sf_wm2)} W/m², tertinggi di antara arah yang ada` : ''}. ${sideOverTxt} Sisi paling sejuk adalah ${sn(cool)} (${f2(cool.ottv_orientation_wm2)} W/m²).`;
  const maxV = Math.max(limit * 1.3, ...sides.map((r) => r.ottv_orientation_wm2));
  // label penunjuk: hanya sisi yang menghadap kamera; bila bertumpuk, yang lebih panas didahulukan
  const kept = [];
  for (const l of [...(assets.iso?.labels || [])].filter((x) => x.facing).sort((x, y) => y.v - x.v)) {
    if (kept.every((k) => Math.abs(k.x - l.x) > 13 || Math.abs(k.y - l.y) > 5)) kept.push(l);
  }
  // panah utara: arah utara model diproyeksikan ke halaman
  let northGlyph = '';
  if (assets.iso?.proj?.length >= 2) {
    const [[x0, y0], [x1, y1], sp] = assets.iso.proj;
    const ax = port ? 2.97 : 4.2, ay = port ? 4.2 : 2.97;
    const ang = (Math.atan2((x1 - x0) * ax, -(y1 - y0) * ay) * 180) / Math.PI;
    // arah datang sinar matahari (dari matahari ke gedung), di samping panah utara
    if (sp) {
      const sa = (Math.atan2((x0 - sp[0]) * ax, -(y0 - sp[1]) * ay) * 180) / Math.PI;
      northGlyph += `<svg class="north" viewBox="0 0 40 40" style="right:42mm;${port ? 'top:57%' : 'bottom:84mm'}"><circle cx="20" cy="20" r="17" fill="none" stroke="var(--sun)" stroke-width="0.8" opacity="0.6"/>
        <g transform="rotate(${sa.toFixed(1)} 20 20)"><circle cx="20" cy="7" r="3.2" fill="var(--sun)"/><path d="M20 12 V30 M15.5 25.5 L20 31 L24.5 25.5" stroke="var(--sun)" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>
        <text x="20" y="38.5" text-anchor="middle" font-size="6.2" font-weight="700" fill="var(--sun)">${esc(assets.sunText || '')}</text></svg>`;
    }
    northGlyph += `<svg class="north" viewBox="0 0 40 40" style="right:22mm;${port ? 'top:57%' : 'bottom:84mm'}"><circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
      <g transform="rotate(${ang.toFixed(1)} 20 20)"><path d="M20 5 L25 24 L20 21 L15 24 Z" fill="currentColor"/></g>
      <text x="20" y="38.5" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor">U</text></svg>`;
  }
  const calls = kept.map((l) => `<div class="call${vi.isSniFinal && l.v > limit ? ' over' : ''}" style="left:${l.x}%;top:${l.y}%"><i></i><span>${sideName(l.code)}<b>${f1(l.v)}</b></span></div>`).join('');
  const stat3Val = vi.isSniFinal
    ? `${f2(vi.isOk ? Math.max(0, limit - ottv) : Math.max(0, ottv - limit))}<small>W/m²</small>`
    : vi.isSim
      ? `${f2(Math.abs(limit - ottv))}<small>${ottv <= limit ? 'di bawah acuan' : 'di atas acuan'}</small>`
      : 'Sementara';
  const stripInl = vi.isSniFinal
    ? `Memenuhi<b>${sides.length - over.length}</b>· Melebihi<b>${over.length}</b>· Batas<b>${f0(limit)} W/m²</b>· panjang batang = OTTV, warna = skala panas`
    : `${vi.isSim ? 'Mode simulasi' : 'Hasil sementara'} · Acuan<b>${f0(limit)} W/m²</b>· panjang batang = OTTV, warna = skala panas`;
  const p2 = `<section class="pg${dk}">
    <div class="bg"><img src="${assets.iso?.img}" alt=""></div><div class="veil"></div>${calls}${northGlyph}
    <div class="draw-cap" style="right:20mm;${port ? 'top:calc(57% + 19mm)' : 'bottom:72mm'};text-align:right"><b>Isometri</b>warna = OTTV tiap sisi</div>
    ${top('02 Ringkasan', 2)}
    <div class="txt">
      <div class="hd"><h1>Ringkasan hasil</h1><p class="lede">${lede}</p></div>
      <div class="stats">
        <div class="stat"><div class="k">OTTV gedung ${tagCls(vi.pillClass, vi.badge)}</div><div class="v ${vi.pillClass}">${f2(ottv)}<small>W/m²</small></div></div>
        <div class="stat"><div class="k">${vi.isSim ? 'Acuan SNI' : 'Batas SNI'}</div><div class="v">${f0(limit)}<small>W/m²</small></div></div>
        <div class="stat"><div class="k">${esc(vi.delta.label)}</div><div class="v">${stat3Val}</div></div>
      </div>
      <div class="r4"><h2>Dari mana panas masuk</h2><p class="b">${pathTxt}</p>
        <div class="split"><i style="width:${pW * 100}%;background:#A79E90"></i><i style="width:${pG * 100}%;background:#5B95B8"></i><i style="width:${pS * 100}%;background:var(--sun)"></i></div>
        <div class="keys"><span style="--c:#A79E90">Dinding<b>${f2(s.q_wall_conduction_wm2)}</b></span><span style="--c:#5B95B8">Kaca, beda suhu<b>${f2(s.q_glass_conduction_wm2)}</b></span><span style="--c:var(--sun)">Sinar lewat kaca<b>${f2(s.q_solar_radiation_wm2)}</b></span></div></div>
      <div class="r4"><h2>Sisi mana yang paling panas</h2><p class="b">${sideTxt}</p></div>
    </div>
    <div class="strip">
      <div class="strip-hd"><h2>OTTV per sisi</h2><span class="inl">${stripInl}</span></div>
      <div class="cols" style="--n:${sides.length}">${sides.map((r) => `<div class="col"><div class="k">${sideName(r.code)}</div><div class="v${vi.isSniFinal && r.ottv_orientation_wm2 > limit ? ' over' : ''}">${f1(r.ottv_orientation_wm2)}<small>W/m²</small></div><div class="bar" style="--w:${(r.ottv_orientation_wm2 / maxV) * 100}%;--c:${heatColor(r.ottv_orientation_wm2)}"></div><div class="s">${f0(r.total_area_m2)} m² · kaca ${pc(r.wwr)}</div></div>`).join('')}</div>
    </div>
    <div class="foot"><span>LUXA by Alf Studio · Laporan OTTV SNI 6389:2020${userName ? ` · disusun oleh ${esc(userName)}` : ''}</span><span>Angka dari hasil hitung LUXA</span></div>
  </section>`;

  // ---- 03 Sisi terpanas
  const m = hot.manual_calc || {};
  const qs = [Number(hot.q_wall_conduction_wm2), Number(hot.q_glass_conduction_wm2), Number(hot.q_solar_radiation_wm2)];
  const solarHot = qs[2] / (qs[0] + qs[1] + qs[2] || 1);
  const why = [];
  if (Number(hot.sni_sf_wm2) >= sfMax) why.push(`<b>Faktor matahari ${f0(hot.sni_sf_wm2)} W/m²</b>, tertinggi di antara sisi gedung ini (Tabel 8 SNI untuk ${esc(a.location_info?.city || 'lokasi ini')}).`);
  else why.push(`<b>Faktor matahari ${f0(hot.sni_sf_wm2)} W/m²</b> untuk arah ini (Tabel 8 SNI).`);
  const w = Number(hot.wwr) || 0;
  why.push(w >= 0.7 ? `<b>Porsi kaca ${pc(w)}</b>, jadi hampir seluruh permukaan sisi ini meneruskan sinar.` : w >= 0.35 ? `<b>Porsi kaca ${pc(w)}</b>. Sinar yang masuk lewat kaca tetap jadi suku terbesar walau porsinya belum separuh.` : `<b>Porsi kaca ${pc(w)}</b>, kecil, jadi panas lebih banyak datang dari dinding.`);
  const scLow = Number(m.sc_k) <= 0.35 ? ` SC kaca ${f3(m.sc_k)} sudah rendah, tetapi tidak ada yang menghalangi sinar sebelum sampai ke kaca.` : ` SC kaca ${f3(m.sc_k)}.`;
  if (Number(m.sc_eff ?? 1) >= 0.9995) why.push(`<b>Tanpa peneduh</b> (faktor peneduh ${f3(m.sc_eff)}).${scLow}`);
  else if (Number(m.sc_eff ?? 1) > 0.97) why.push(`<b>Peneduh hampir tidak berpengaruh</b> (faktor peneduh ${f3(m.sc_eff)}).${scLow}`);
  else why.push(`<b>Peneduh menurunkan sinar</b> menjadi ${pc(m.sc_eff)} dari tanpa peneduh (faktor ${f3(m.sc_eff)}).`);
  const tryTxt = solarHot >= 0.5
    ? `Sinar lewat kaca mengisi <b>${pc(solarHot)}</b> OTTV sisi ini. Kaca dengan SC lebih kecil atau peneduh di sisi ${sideName(hot.code)} menurunkan suku inilah yang paling besar pengaruhnya. Coba di langkah Bandingkan sebelum memutuskan.`
    : `Suku terbesar sisi ini bukan sinar matahari, jadi cek dinding dan kaca (nilai U) lebih dulu di langkah Bandingkan.`;
  // tanda gambar kerja di tampak: level lantai, garis ukur tinggi dan lebar, skala grafis
  let elevMarks = '';
  const E = assets.elev;
  if (E?.proj?.length >= 4) {
    // Semua tanda dihitung dari proyeksi; yang tidak muat disembunyikan, bukan dipaksa.
    const [gl, gr, tp, gd] = E.proj, lv = E.proj.slice(4);
    const x0 = Math.min(gl[0], gr[0]), x1 = Math.max(gl[0], gr[0]), y0 = tp[1], y1 = gd[1];
    const PH = port ? 420 : 297, PW = port ? 297 : 420; // ukuran halaman dalam mm (persen -> mm)
    const minGap = (6.5 / PH) * 100; // jarak minimum antar label level: 6,5 mm
    // level: lantai terbawah dan puncak selalu, sisanya diambil dari bawah selama berjarak cukup
    const keep = [];
    const L = E.levels.map((l, i) => ({ ...l, y: lv[i]?.[1] })).filter((l) => Number.isFinite(l.y));
    const floorsOnly = L.filter((l) => !l.top), topL = L.find((l) => l.top);
    if (floorsOnly.length && topL && floorsOnly[0].y - topL.y >= minGap) {
      keep.push(floorsOnly[0]);
      for (const l of floorsOnly.slice(1)) if (keep[keep.length - 1].y - l.y >= minGap && l.y - topL.y >= minGap) keep.push(l);
      keep.push(topL);
    }
    // garis level masuk dari kiri bila ada ruang di antara kolom teks dan gedung, kalau tidak dari kanan
    const textEdge = port ? 200 : 40, room = x0 - 1 - textEdge, side = room >= 9 ? 'l' : 'r';
    const lvW = side === 'l' ? room : 11, lvX = side === 'l' ? textEdge : x1 + 1;
    elevMarks += keep.map((l) => `<div class="lvl ${side}" style="left:${lvX.toFixed(2)}%;width:${lvW.toFixed(2)}%;top:${l.y.toFixed(2)}%"><span><b>${esc(l.label)}</b>${l.z >= 0.005 ? '+' : l.z <= -0.005 ? '' : '±'}${f2(l.z)} m</span></div>`).join('');
    // ukuran tinggi di kanan (bergeser bila label level di kanan)
    const dvX = side === 'r' ? lvX + lvW + 1.5 : x1 + 2.2;
    if (y1 - y0 >= minGap && dvX < 95) elevMarks += `<div class="dimv" style="left:${dvX.toFixed(2)}%;top:${y0.toFixed(2)}%;height:${(y1 - y0).toFixed(2)}%"><span>${f2(E.height)} m</span></div>`;
    if ((x1 - x0) * PW / 100 >= 18) elevMarks += `<div class="dimh" style="left:${x0.toFixed(2)}%;top:${(y1 + 2.8).toFixed(2)}%;width:${(x1 - x0).toFixed(2)}%"><span>${f2(E.faceW)} m</span></div>`;
    // skala grafis: 4 ruas, panjang total 24 sampai 60 mm, di kanan bawah gedung; pindah ke bawah kanan garis ukur bila tidak muat
    // batas bawah area gambar (persen), di atas garis strip; tegak: keterangan dan skala pindah ke kanan gedung
    const capMax = port ? 0 : 76; let sbarEnd = 0, sbarAbove = false;
    // skala diambil dari garis ukur lebar itu sendiri (meter per mm kertas), jadi selalu cocok dengan gambar
    const wMm = ((x1 - x0) / 100) * PW;
    const mPerMm = wMm > 5 && E.faceW > 0 ? E.faceW / wMm : E.mPerPx * ((assets.pageW || 2970) / PW);
    if (mPerMm > 0) {
      const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((v) => v / mPerMm >= 24);
      if (nice && nice / mPerMm <= 60) {
        const segMm = nice / mPerMm / 4, wPct = (nice / mPerMm / PW) * 100;
        let sx = Math.max(dvX + 4, x1 + 6), sy = y1 + 1;
        if (sx + wPct > 95) { sx = Math.max(x0, x1 - wPct); sy = x1 - wPct > x0 + 22 ? y1 + 6.5 : y1 + 10.5; }
        // gedung memenuhi tinggi halaman: skala naik ke kanan bawah gedung, sejajar tanah
        if (sy + 3 > capMax) { sx = Math.min(Math.max(dvX + 4, x1 + 6), 95 - wPct); sy = y1 - 4; sbarAbove = true; }
        elevMarks += `<div class="sbar" style="left:${sx.toFixed(2)}%;top:${sy.toFixed(2)}%">${Array.from({ length: 4 }, () => `<i style="width:${segMm.toFixed(2)}mm"></i>`).join('')}<div class="lab"><span>0</span><span>${nice} m</span></div></div>`;
        sbarEnd = !sbarAbove && sy <= y1 + 2 ? sx + wPct : 0;
      }
    }
    // keterangan gambar di bawah garis ukur; bila gedung memenuhi tinggi halaman, pindah ke kanan bawah gedung
    const capY = y1 + 6.5;
    if (capY <= capMax) elevMarks += `<div class="draw-cap" style="left:${x0.toFixed(2)}%;top:${capY.toFixed(2)}%"><b>Tampak ${sideName(hot.code)}</b>proyeksi sejajar, skala grafis</div>`;
    else if (port) elevMarks += `<div class="draw-cap" style="left:${x0.toFixed(2)}%;top:${Math.max(17, y0 - 7).toFixed(2)}%">`
      + `<b>Tampak ${sideName(hot.code)}</b>proyeksi sejajar, skala grafis</div>`;
    else elevMarks += `<div class="draw-cap" style="left:${Math.min(Math.max(dvX + 4, sbarEnd + 2, x1 + 6), 74).toFixed(2)}%;top:${(y1 - (sbarAbove ? 10 : 5)).toFixed(2)}%"><b>Tampak ${sideName(hot.code)}</b>proyeksi sejajar, skala grafis</div>`;
  }
  const p3 = `<section class="pg${dk} p3">
    <div class="bg"><img src="${assets.elev?.img}" alt=""></div><div class="veil"></div>${elevMarks}
    ${assets.key ? `<div class="keyimg"><img src="${assets.key}" alt=""><span>Letak sisi ${sideName(hot.code)} pada gedung</span></div>` : ''}
    ${top(`03 Sisi ${sideName(hot.code)}`, 3)}
    <div class="txt">
      <div class="hd"><h1>Sisi <span class="acc" style="--acc:${tHeat(hot.ottv_orientation_wm2)}">${sideName(hot.code)}</span></h1>
        <p class="lede">Sisi ini menyumbang panas terbanyak: <b>${f2(hot.ottv_orientation_wm2)} W/m²</b>${vi.isSniFinal ? (hot.ottv_orientation_wm2 > limit ? `, lewat ${f2(hot.ottv_orientation_wm2 - limit)} W/m² dari batas` : `, di bawah batas ${f0(limit)} W/m²`) : ` (${vi.isSim ? 'mode simulasi' : 'hasil sementara'})`}.</p></div>
      <div class="r3"><h2>Kenapa paling panas</h2><ol class="why">${why.map((t) => `<li><span>${t}</span></li>`).join('')}</ol></div>
      <div class="r3"><h2>Hitungannya</h2><p class="formula">${esc(m.formula_substitution || '')}</p>
        <div class="terms"><span>Dinding<b>${f2(qs[0])}</b></span><span>Kaca, beda suhu<b>${f2(qs[1])}</b></span><span>Sinar lewat kaca<b>${f2(qs[2])}</b></span></div></div>
      <div class="r4" style="grid-column:1 / -1"><h2>Yang bisa dicoba</h2><p class="b">${tryTxt}</p></div>
    </div>
    <div class="strip">
      <div class="strip2">
        <div><div class="strip-hd"><h2>Nilai yang dipakai rumus</h2><span class="inl">sisi ${sideName(hot.code)} · satuan mengikuti SNI</span></div>
          <dl class="vals">
            <div><dt>Luas A₀</dt><dd>${f0(m.ao_m2 ?? hot.total_area_m2)} m²</dd></div><div><dt>WWR</dt><dd>${f3(m.wwr ?? hot.wwr)}</dd></div>
            <div><dt>α dinding</dt><dd>${f2(m.alpha)}</dd></div><div><dt>U dinding</dt><dd>${f2(m.u_wall)}</dd></div><div><dt>TDek</dt><dd>${f1(m.td_ek)} K</dd></div>
            <div><dt>U kaca</dt><dd>${f2(m.u_f)}</dd></div><div><dt>ΔT</dt><dd>${f1(m.delta_t)} K</dd></div><div><dt>SC kaca</dt><dd>${f3(m.sc_k)}</dd></div>
            <div><dt>Faktor peneduh</dt><dd>${f3(m.sc_eff)}</dd></div><div><dt>SF</dt><dd>${f0(m.sf ?? hot.sni_sf_wm2)} W/m²</dd></div>
          </dl></div>
        <div class="facbox"><h2>Fasad terbentang</h2><p class="b" style="font-size:9pt">Selubung dibuka melingkar, tiap panel diwarnai OTTV-nya. Makin gelap, makin panas.</p>
          <img src="${assets.facades?.img}" alt=""><div class="scale"><span>0</span><i></i><span>50+ W/m²</span></div></div>
      </div>
    </div>
    <div class="foot"><span>LUXA by Alf Studio · Laporan OTTV SNI 6389:2020</span><span>Semua sisi dirinci di halaman berikutnya</span></div>
  </section>`;

  return finish(state, { p2, p3, a, s, sides, byHeat, hot, cool, over, limit, ottv, vi, name, dk, top, tagCls, tHeat, sn, assets, theme, port, userName, date, pS, pW, pG });
}

const T_LIGHT = { ink: '#1E1F24', muted: '#857E73', line: 'rgba(30,31,36,0.14)', ok: '#0F6E66', fail: '#B3261E', pWall: '#A79E90', pGlass: '#5B95B8', pSun: '#E8890C', surface: '#FFFFFF', track: 'rgba(30,31,36,0.07)' };
const T_DARK = { ink: '#F2EFE9', muted: '#8E8980', line: 'rgba(255,255,255,0.16)', ok: '#5EC4BA', fail: '#F2867E', pWall: '#A79E90', pGlass: '#6FA8CB', pSun: '#F6B24A', surface: '#17181B', track: 'rgba(255,255,255,0.09)' };
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const tanggal = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** Halaman 01, 04 sampai 07, lalu satukan semua halaman. */
function finish(state, c) {
  const { p2, p3, a, s, sides, byHeat, hot, cool, over, limit, ottv, vi, name, dk, top, tagCls, tHeat, sn, assets, theme, port, userName, date, pS, pW, pG } = c;
  const T = theme === 'dark' ? T_DARK : T_LIGHT;
  const city = a.location_info?.city || 'lokasi ini';
  const foot = (right = '') => `<div class="foot"><span>LUXA by Alf Studio · Laporan OTTV SNI 6389:2020${userName ? ` · disusun oleh ${esc(userName)}` : ''}</span><span>${right}</span></div>`;
  const floors = [...(a.floor_breakdown || [])].sort((x, y) => x.floor_number - y.floor_number);
  const area = Number(s.total_envelope_area_m2) || sides.reduce((t, r) => t + Number(r.total_area_m2 || 0), 0);

  // ---- 01 Sampul
  const p1 = `<section class="pg${dk} cover">
    <div class="bg"><img src="${assets.cover || assets.iso?.img}" alt=""></div><div class="veil"></div>
    ${top('01 Sampul', 1)}
    <div class="txt">
      <div class="hd"><p class="cover-k">Laporan OTTV · ${vi.isSim ? 'Mode Simulasi' : 'SNI 6389:2020'}</p><h1>${esc(name)}</h1>
        <p class="lede">Perhitungan nilai perpindahan termal menyeluruh selubung gedung di ${esc(city)}, ${tanggal(date)}${userName ? `, disusun oleh <b>${esc(userName)}</b>` : ''}.</p></div>
      <div class="r4"><div class="stat"><div class="k">OTTV gedung ${tagCls(vi.pillClass, vi.badge)}</div></div><div class="big ${vi.pillClass}">${f2(ottv)}<small>W/m²</small></div>
        <p class="b" style="margin-top:3mm">${esc(vi.isSniFinal ? `Batas ${f0(limit)} W/m². ${vi.delta.short}.` : vi.delta.sentence)}</p></div>
    </div>
    <div class="strip"><div class="cols" style="--n:${port ? 3 : 6}">
      <div class="col"><div class="k">Lokasi</div><div class="v" style="font-size:14pt">${esc(city)}</div><div class="s">${esc(a.location_info?.station || '')}</div></div>
      <div class="col"><div class="k">Mode hitung</div><div class="v" style="font-size:14pt">${esc(a.mode_label || 'SNI 6389:2020')}</div></div>
      <div class="col"><div class="k">Faktor matahari</div><div class="v" style="font-size:14pt">${esc((a.sf_source_label || 'Tabel 8 SNI').split(' (')[0])}</div></div>
      ${port ? '</div><div class="cols" style="--n:3;margin-top:6mm">' : ''}
      <div class="col"><div class="k">Luas selubung</div><div class="v">${f0(area)}<small>m²</small></div></div>
      <div class="col"><div class="k">Porsi kaca (WWR)</div><div class="v">${pc(s.effective_wwr)}</div></div>
      <div class="col"><div class="k">Lantai · sisi</div><div class="v">${f0(s.total_floors || floors.length)}<small>lantai</small> ${sides.length}<small>sisi</small></div></div>
    </div></div>
    ${foot('Angka dari hasil hitung LUXA')}
  </section>`;

  // ---- 04 Tiap sisi
  const maxV = Math.max(limit * 1.3, ...sides.map((r) => r.ottv_orientation_wm2));
  const rowsHtml = sides.map((r) => {
    const q = [Number(r.q_wall_conduction_wm2), Number(r.q_glass_conduction_wm2), Number(r.q_solar_radiation_wm2)], qt = q[0] + q[1] + q[2] || 1;
    return `<div class="nm" style="color:${tHeat(r.ottv_orientation_wm2)}">${sideName(r.code)}</div>
      <div class="ov${vi.isSniFinal && r.ottv_orientation_wm2 > limit ? ' over' : ''}">${f2(r.ottv_orientation_wm2)}<small>W/m²</small></div>
      <div><div class="lbar"><i style="width:${(r.ottv_orientation_wm2 / maxV) * 100}%;background:${heatColor(r.ottv_orientation_wm2)}"></i><b style="left:${(limit / maxV) * 100}%"></b></div></div>
      <div class="xp"><div class="tsplit"><i style="width:${(q[0] / qt) * 100}%;background:${T.pWall}"></i><i style="width:${(q[1] / qt) * 100}%;background:${T.pGlass}"></i><i style="width:${(q[2] / qt) * 100}%;background:${T.pSun}"></i></div></div>
      <div class="nv">${f0(r.total_area_m2)} m²</div><div class="nv">${pc(r.wwr)}</div><div class="nv">${f3(r.avg_sc_effective ?? r.manual_calc?.sc_eff)}</div><div class="nv xp">${f0(r.sni_sf_wm2)}</div>`;
  }).join('');
  const p4 = `<section class="pg${dk}">
    ${top('04 Tiap sisi', 4)}
    <div class="body">
      <div class="hd"><h1>Tiap sisi</h1><p class="lede">${vi.isSniFinal ? (over.length ? `${over.length} dari ${sides.length} sisi melewati batas ${f0(limit)} W/m². Yang paling perlu ditangani: ${list([...over].sort((x, y) => y.ottv_orientation_wm2 - x.ottv_orientation_wm2).slice(0, 3).map((r) => `<b style="color:${tHeat(r.ottv_orientation_wm2)}">${sideName(r.code)}</b>`))}.` : `Semua ${sides.length} sisi berada di bawah batas ${f0(limit)} W/m². Yang paling panas ${sn(hot)}, yang paling sejuk ${sn(cool)}.`) : `Perbandingan ${sides.length} sisi fasad (${vi.isSim ? 'mode simulasi' : 'hasil sementara'}). Yang paling panas ${sn(hot)}, yang paling sejuk ${sn(cool)}.`}</p></div>
      <div class="rows">
        <div class="th">Sisi</div><div class="th">OTTV</div><div class="th">Terhadap batas (garis putus = ${f0(limit)})</div><div class="th xp">Porsi jalur panas</div><div class="th">Luas A₀</div><div class="th">WWR</div><div class="th">SC efektif</div><div class="th xp">SF (W/m²)</div>
        ${rowsHtml}
      </div>
      <div class="keys"><span style="--c:${T.pWall}">Dinding</span><span style="--c:${T.pGlass}">Kaca, beda suhu</span><span style="--c:${T.pSun}">Sinar lewat kaca</span></div>
      <p class="b">OTTV tiap sisi = α(1 − WWR)·U<sub>w</sub>·TD<sub>ek</sub> + WWR·U<sub>f</sub>·ΔT + WWR·SC·SF. OTTV gedung adalah rata-rata tertimbang luas dari semua sisi, jadi sisi yang luas dan panas paling berpengaruh.</p>
      ${assets.facades?.img ? `<div class="facwide"><h2>Fasad terbentang</h2><p class="b" style="font-size:9pt">Seluruh selubung dibuka melingkar dan tiap panel diwarnai OTTV-nya, berurutan mengikuti arah hadap. Makin gelap, makin panas.</p><img src="${assets.facades.img}" alt=""><div class="scale"><span>0</span><i></i><span>50+ W/m²</span></div></div>` : ''}
    </div>
    ${foot()}
  </section>`;

  // ---- 05 Matahari dan lantai
  const lat = Number(a.location_info?.latitude_deg) || -6.2;
  const sfTop = [...sides].sort((x, y) => y.sni_sf_wm2 - x.sni_sf_wm2).slice(0, 2);
  const sunTxt = `${esc(city)} berada di lintang ${f1(Math.abs(lat))}° ${lat < 0 ? 'selatan' : 'utara'}, jadi matahari melintas hampir tegak di atas kepala dan menyinari sisi timur pada pagi serta barat pada sore. Menurut ${esc((a.sf_source_label || 'Tabel 8 SNI').split(' (')[0])}, faktor matahari terbesar ada di sisi ${list(sfTop.map((r) => `${sn(r)} (${f0(r.sni_sf_wm2)} W/m²)`))}.`;
  const fHot = floors.length ? [...floors].sort((x, y) => y.ottv_floor_wm2 - x.ottv_floor_wm2)[0] : null;
  const fCool = floors.length ? [...floors].sort((x, y) => x.ottv_floor_wm2 - y.ottv_floor_wm2)[0] : null;
  const fOver = floors.filter((f) => f.ottv_floor_wm2 > limit);
  const floorTxt = floors.length > 1
    ? `Lantai ${esc(fHot.floor_label)} paling panas (${f2(fHot.ottv_floor_wm2)} W/m²) dan ${esc(fCool.floor_label)} paling sejuk (${f2(fCool.ottv_floor_wm2)} W/m²). ${fOver.length ? `${fOver.length} dari ${floors.length} lantai melewati batas.` : `Semua ${floors.length} lantai di bawah batas.`} Perbedaan antarlantai biasanya datang dari porsi kaca dan peneduh yang tidak sama.`
    : floors.length === 1 ? `Gedung satu lantai: OTTV lantai sama dengan OTTV gedung, ${f2(floors[0].ottv_floor_wm2)} W/m².` : 'Data per lantai tidak tersedia untuk model ini.';
  const p5 = `<section class="pg${dk}">
    ${top('05 Matahari dan lantai', 5)}
    <div class="body">
      <div class="hd"><h1>Matahari dan lantai</h1><p class="lede">Arah hadap menentukan berapa banyak sinar yang diterima tiap sisi, sedangkan rincian per lantai menunjukkan bagian gedung yang paling banyak menyumbang panas.</p></div>
      <div class="two">
        <div><h2>Lintasan matahari</h2><p class="b">${sunTxt}</p><div class="fig">${sunPath({ lat, sides, date: state.sunDate || '2026-09-23', hour: state.sunHour || 15 }, T, { size: 360 })}</div>
          <p class="b" style="font-size:8.5pt;color:var(--muted)">Garis tebal: 21 Maret / 23 September, putus-putus: 21 Juni dan 21 Desember. Cincin luar diwarnai OTTV tiap sisi.</p></div>
        <div><h2>OTTV per lantai</h2><p class="b">${floorTxt}</p><div class="fig">${floors.length ? floorStack(floors, limit, T, { w: 360, h: Math.max(200, Math.min(420, floors.length * 16 + 30)) }) : ''}</div></div>
      </div>
    </div>
    ${foot()}
  </section>`;

  // ---- 06 Material
  const am = s.active_materials || {};
  const scEffAvg = sides.reduce((t, r) => t + Number(r.manual_calc?.sc_eff ?? 1) * Number(r.glazing_area_m2 || 0), 0) / (sides.reduce((t, r) => t + Number(r.glazing_area_m2 || 0), 0) || 1);
  const glassTxt = pS >= 0.5
    ? `Sinar lewat kaca adalah suku terbesar (${pc(pS)} dari OTTV), jadi nilai SC kaca dan peneduh paling menentukan hasil. SC kaca ${f3(am.sc_glass)} berarti kaca meneruskan sekitar ${pc(am.sc_glass)} panas sinar dibanding kaca bening 3 mm.`
    : `Suku terbesar bukan sinar matahari, jadi nilai U dinding dan kaca ikut menentukan. Dinding menyumbang ${pc(pW)} dan kaca karena beda suhu ${pc(pG)}.`;
  const shadeTxt = scEffAvg < 0.97 ? `Peneduh menurunkan sinar yang sampai ke kaca menjadi rata-rata ${pc(scEffAvg)} (faktor peneduh tertimbang luas kaca).` : 'Peneduh hampir tidak berpengaruh pada hitungan: sinar sampai ke kaca tanpa terhalang.';
  const p6 = `<section class="pg${dk}">
    ${top('06 Material', 6)}
    <div class="body">
      <div class="hd"><h1>Material selubung</h1><p class="lede">${glassTxt}</p></div>
      <div>
        <div class="mat"><div><div class="k">Kaca</div><div class="n">${esc(am.glazing_name || '-')}</div><div class="br">${esc(am.glazing_brand || '')}</div></div>
          <dl class="spec" style="--n:4"><div><dt>U kaca (U<sub>f</sub>)</dt><dd>${f2(am.u_fenestration)}</dd></div><div><dt>SC</dt><dd>${f3(am.sc_glass)}</dd></div><div><dt>SHGC</dt><dd>${f2(am.shgc_glass)}</dd></div><div><dt>ΔT</dt><dd>${f1(am.delta_t)} K</dd></div></dl></div>
        <div class="mat"><div><div class="k">Dinding / spandrel</div><div class="n">${esc(am.wall_name || '-')}</div><div class="br">${esc(am.wall_brand || '')}</div></div>
          <dl class="spec" style="--n:4"><div><dt>U dinding (U<sub>w</sub>)</dt><dd>${f2(am.u_wall)}</dd></div><div><dt>α (serap)</dt><dd>${f2(am.alpha_wall)}</dd></div><div><dt>TD<sub>ek</sub></dt><dd>${f1(am.td_ek)} K</dd></div><div><dt>Porsi panas</dt><dd>${pc(pW)}</dd></div></dl></div>
        ${am.frame_name ? `<div class="mat"><div><div class="k">Rangka</div><div class="n">${esc(am.frame_name)}</div></div><dl class="spec" style="--n:4"><div><dt>U rangka</dt><dd>${f2(am.u_frame)}</dd></div></dl></div>` : ''}
        <div class="mat"><div><div class="k">Peneduh</div><div class="n">${scEffAvg < 0.97 ? 'Berpengaruh' : 'Tidak berpengaruh'}</div></div>
          <div><p class="b">${shadeTxt}</p>${Number(am.louver_depth_m) > 0 && scEffAvg < 0.97 ? `<dl class="spec" style="--n:4;margin-top:4mm"><div><dt>Kedalaman kisi</dt><dd>${f2(am.louver_depth_m)} m</dd></div><div><dt>Jarak kisi</dt><dd>${f2(am.louver_spacing_m)} m</dd></div><div><dt>Kemiringan</dt><dd>${f0(am.louver_tilt_deg)}°</dd></div><div><dt>Faktor rata-rata</dt><dd>${f3(scEffAvg)}</dd></div></dl>` : ''}</div></div>
      </div>
    </div>
    ${foot('Nilai material dari katalog LUXA; cek lembar data pabrik untuk dokumen resmi')}
  </section>`;

  // ---- 07 Kesimpulan
  const todo = [];
  if (vi.isFail) {
    const need = Math.max(0, ottv - limit);
    todo.push(`<b>Turunkan OTTV minimal ${f2(need)} W/m²</b> supaya memenuhi batas ${f0(limit)} W/m².`);
  } else if (vi.isSim) {
    todo.push(`<b>Beralih ke Mode SNI</b> untuk mengevaluasi kepatuhan resmi terhadap batas SNI 6389:2020 (${f0(limit)} W/m²).`);
  } else if (vi.isProv) {
    todo.push(`<b>Selesaikan konfirmasi model dan material</b> di aplikasi sebelum mengambil keputusan kepatuhan SNI.`);
  }
  const hotSides = (vi.isSniFinal && over.length ? over : byHeat.slice(0, 2)).slice(0, 3);
  if (pS >= 0.5) todo.push(`<b>Kurangi sinar yang masuk di sisi ${list(hotSides.map((r) => sideName(r.code)))}</b>: pilih kaca dengan SC lebih kecil atau tambah peneduh di sisi itu. Sinar lewat kaca menyumbang ${pc(pS)} OTTV gedung.`);
  if (Number(s.effective_wwr) > 0.5) todo.push(`<b>Tinjau porsi kaca ${pc(s.effective_wwr)}</b>: mengurangi kaca di sisi yang paling panas menurunkan suku sinar dan beda suhu sekaligus.`);
  if (pW >= 0.3) todo.push(`<b>Perbaiki isolasi dinding</b>: dinding menyumbang ${pc(pW)} OTTV, nilai U dinding ${f2(am.u_wall)} masih bisa diturunkan.`);
  for (const r of (a.recommendations || []).slice(0, 2)) { const t = r?.title || r?.text || (typeof r === 'string' ? r : ''); if (t) todo.push(esc(t)); }
  todo.push(`<b>Bandingkan sebelum memutuskan</b>: coba alternatif material atau model di langkah Bandingkan LUXA untuk melihat selisih OTTV tiap sisi.`);
  const p7Lede = vi.isOk
    ? `OTTV gedung <b>${f2(ottv)} W/m²</b>, <b class="ok">memenuhi</b> batas SNI 6389:2020 sebesar ${f0(limit)} W/m² (${esc(vi.delta.short)}).`
    : vi.isFail
      ? `OTTV gedung <b>${f2(ottv)} W/m²</b>, <b class="fail">melebihi</b> batas SNI 6389:2020 sebesar ${f0(limit)} W/m² (${esc(vi.delta.short)}).`
      : vi.isSim
        ? `OTTV gedung <b>${f2(ottv)} W/m²</b> pada <b class="neutral">mode simulasi eksplorasi</b> — bukan untuk kepatuhan SNI (${esc(vi.delta.short)}).`
        : `OTTV gedung <b>${f2(ottv)} W/m²</b> (<b class="warn">hasil sementara</b> — perlu konfirmasi model dan material).`;
  const p7 = `<section class="pg${dk}">
    ${top('07 Kesimpulan', 7)}
    <div class="body">
      <div class="hd"><h1>Kesimpulan</h1><p class="lede">${p7Lede}</p></div>
      <div class="two">
        <div><h2>${vi.isOk ? 'Yang bisa ditingkatkan' : 'Langkah berikutnya'}</h2><ul class="do">${todo.map((t) => `<li><span>${t}</span></li>`).join('')}</ul></div>
        <div><h2>Dasar perhitungan</h2>
          <ol class="refs">
            <li>SNI 6389:2020, Konservasi energi selubung bangunan pada bangunan gedung. Batas OTTV ${f0(limit)} W/m².</li>
            <li>Faktor matahari: ${esc(a.sf_source_label || 'Tabel 8 SNI 6389:2020')}, lokasi ${esc(city)}${a.location_info?.station ? ` (${esc(a.location_info.station)})` : ''}.</li>
            <li>Mode hitung: ${esc(a.mode_label || '-')}. Rumus OTTV = α(1 − WWR)·U<sub>w</sub>·TD<sub>ek</sub> + WWR·U<sub>f</sub>·ΔT + WWR·SC·SF, dirata-rata tertimbang luas tiap sisi.</li>
            <li>Geometri dari model ${esc(a.filename || name)}: ${f0(area)} m² selubung, ${sides.length} sisi, ${f0(s.total_floors || floors.length)} lantai.</li>
            ${s.is_provisional ? '<li><b>Hasil sementara</b>: ada catatan pemeriksaan model yang diterima tanpa perbaikan.</li>' : ''}
          </ol>
          <p class="b" style="font-size:9pt;color:var(--muted)">Laporan ini disusun otomatis oleh LUXA dari model dan material yang dipilih pengguna. Untuk dokumen perizinan, periksa kembali nilai material dengan lembar data pabrik.</p>
          <div class="sign" style="margin-top:auto"><div>Disusun oleh<b>${esc(userName || '-')}</b></div><div>Tanggal<b>${tanggal(date)}</b></div><div>Aplikasi<b>LUXA by Alf Studio</b></div></div>
        </div>
      </div>
    </div>
    ${foot()}
  </section>`;

  const pages = [p1, p2, p3, p4, p5, p6, p7];
  const html = pages.join('').replaceAll('{{N}}', String(pages.length).padStart(2, '0'));
  return `<!doctype html><html lang="id" style="--print-bg:${theme === 'dark' ? '#17181B' : '#FFFFFF'}"><head><meta charset="utf-8"><title>Laporan OTTV ${esc(name)}</title><style>${cssFor(port)}</style></head><body>${html}</body></html>`;
}
