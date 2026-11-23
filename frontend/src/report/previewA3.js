// Pratinjau laporan A3: ?data=kotak|tower &theme=dark|light &orient=landscape|portrait &fonts=css lokal
import { captureSlides } from './shots.js';
import { renderCompass3d } from './compass3d.js';
import { renderFacades } from './facade.js';
import { buildReportA3 } from './reportA3.js';
import { sidesOf } from '../present/content.js';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'light' ? 'light' : 'dark';
const orient = q.get('orient') === 'portrait' ? 'portrait' : 'landscape';
const { analysisData, roles, settings } = await (await fetch(q.get('data') || './kotak.json')).json();
const cat = await (await fetch('./materials.json')).json();
const state = { analysisData, config: { roles, settings }, materials: cat.materials, sunDate: '2026-09-23', sunHour: Number(q.get('hour') || 15) };
const shots = captureSlides(state, theme, orient);
const sides = sidesOf(analysisData);
const hotCode = [...sides].sort((x, y) => y.ottv_orientation_wm2 - x.ottv_orientation_wm2)[0]?.code;
const assets = {
  ...shots,
  compass: renderCompass3d(sides, Number(analysisData.sni_limit_wm2 || 35), { theme, width: orient === 'landscape' ? 1600 : 1800, height: orient === 'landscape' ? 1300 : 1100 }),
  facades: renderFacades(analysisData, roles, { theme, width: 3000, height: 420 }),
  hotCode,
};
let { html } = buildReportA3(state, { theme, orient, userName: 'Alfian', assets, logoUrl: theme === 'dark' ? './brand/luxa-logo-dark.svg' : './brand/luxa-logo.svg', version: '1.0.0', date: new Date('2026-11-23') });
if (q.get('fonts')) html = html.replace('</head>', `<link rel="stylesheet" href="${q.get('fonts')}"></head>`);
document.open(); document.write(html); document.close();
await document.fonts.ready;
await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
window.__ready = true;
