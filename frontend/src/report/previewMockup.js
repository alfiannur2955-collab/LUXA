// Pratinjau laporan A3: ?data=kotak|tower &theme=light|dark &orient=land|port &fonts=css lokal
import { buildReportHtml } from './assetsA3.js';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
const orient = q.get('orient') === 'port' ? 'port' : 'land';
const { analysisData, roles, settings } = await (await fetch(q.get('data') || './kotak.json')).json();
const cat = await (await fetch('./materials.json')).json();
const state = { analysisData, config: { roles, settings }, materials: cat.materials, sunDate: '2026-09-23', sunHour: 15 };
let html = await buildReportHtml(state, { theme, orient, logoUrl: theme === 'dark' ? './brand/luxa-logo-dark.svg' : './brand/luxa-logo.svg', userName: 'Alfian' });
if (q.get('direct')) {
  // uji unduh langsung: PDF dibuat di browser lalu dititipkan sebagai base64 untuk skrip uji
  const { reportHtmlToPdf } = await import('./pdfDirect.js');
  const t0 = performance.now();
  window.__step = 'assets ' + Math.round(performance.now()); const blob = await reportHtmlToPdf(html, { onProgress: (i, n) => { window.__step = 'hal ' + i + '/' + n + ' ' + Math.round(performance.now()); }, port: orient === 'port', fontCssUrl: new URL(q.get('fonts') || '', location.href).href });
  const fr = new FileReader();
  window.__pdf = await new Promise((r) => { fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  window.__pdfMs = Math.round(performance.now() - t0);
}
if (q.get('fonts')) html = html.replace('</head>', `<link rel="stylesheet" href="${q.get('fonts')}"></head>`);
document.open(); document.write(html); document.close();
await document.fonts.ready;
await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
window.__ready = true;
