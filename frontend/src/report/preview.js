// Pratinjau laporan tanpa aplikasi: ?data=<json hasil hitung> &name=Alfian &fonts=<css lokal untuk uji>
import { renderSnapshots } from './snapshot.js';
import { buildReportHtml } from './reportHtml.js';

const q = new URLSearchParams(location.search);
const { analysisData, roles, settings } = await (await fetch(q.get('data') || './kotak.json')).json();
const cat = await (await fetch('./materials.json')).json();
const state = { analysisData, config: { roles, settings }, materials: cat.materials, sunDate: '2026-09-23', sunHour: Number(q.get('hour') || 15) };
const images = await renderSnapshots(state);
let { html } = buildReportHtml(state, { userName: q.has('name') ? q.get('name') : 'Alfian', images, logoUrl: './brand/luxa-logo.svg', version: '1.0.0', date: new Date('2026-11-23') });
if (q.get('fonts')) html = html.replace('</head>', `<link rel="stylesheet" href="${q.get('fonts')}"></head>`);
document.open();
document.write(html);
document.close();
await document.fonts.ready;
await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
window.__ready = true;
