// Pratinjau Mode Presentasi tanpa aplikasi: ?data=<json hasil hitung> &theme=light|dark &slide=n
// &date=YYYY-MM-DD &hour=15 &glass=hex &wall=hex (uji warna swatch)
import { createPresenter } from './presenter.js';

const q = new URLSearchParams(location.search);
const { analysisData, roles, settings } = await (await fetch(q.get('data') || './kotak.json')).json();
const cat = await (await fetch('./materials.json')).json();
const list = cat.materials.materials.map((m) => ({ ...m }));
for (const [k, c] of [['glass', 'glazing'], ['wall', 'wall']]) if (q.get(k)) list.filter((m) => m.category === c).forEach((m) => { m.color_hex = '#' + q.get(k); });
const state = { analysisData, config: { roles, settings }, materials: { materials: list }, sunDate: q.get('date') || '2026-09-23', sunHour: Number(q.get('hour') || 15) };
const p = createPresenter({ host: document.body, state, appTheme: q.get('theme') === 'dark' ? 'dark' : 'light', userName: q.has('name') ? q.get('name') : 'Alfian', startAt: Number(q.get('slide') || 0), onExit: () => { window.__exited = (window.__exited || 0) + 1; } });
window.__p = p;
if (q.get('nofloor')) p._debug.maket.group.children.filter((c) => c.material?.isShadowMaterial).forEach((c) => { c.visible = false; });
requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
window.__info = { pick: p._debug.pick, tris: p._debug.maket.tris, dome: p._debug.dome.radius, sun: { az: p._debug.dome.sun.az, alt: p._debug.dome.sun.alt }, slides: p.slides.map((s) => s.id) };
