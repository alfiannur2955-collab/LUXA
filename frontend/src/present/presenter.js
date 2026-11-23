// Mode Presentasi: panggung maket model pengguna, kamera per slide, navigasi scroll / keyboard / clicker,
// penanda slide, layar penuh, keluar. Hanya tampilan: membaca state apa adanya, tidak menghitung ulang.
import * as THREE from 'three';
import { createStage, dirFrom } from '../learn3d/stage.js';
import { createClouds } from '../learn3d/clouds.js';
import { createBirds } from '../learn3d/birds.js';
import { PALETTES } from '../learn3d/palette.js';
import { buildMaket, swatchesOf } from './maket.js';
import { colorResolver, pickStageTheme } from './colors.js';
import { createDome, domeRadius } from './sundome.js';
import { slidesFor, posesFor } from './slides.js';
import { renderCard as defaultCard, sidesOf, sideName, f1 } from './content.js';
import { contrast } from './colors.js';
import { heatColor } from './heat.js';
import './present.css';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const shortest = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;
const FLY_MS = 1500;

const ICON = {
  full: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  exitFull: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

/**
 * state: { analysisData, config, materials, sunDate, sunHour, sunDomeRadiusM }
 * appTheme: 'light' | 'dark'; onExit(): dipanggil saat pengguna keluar (Esc / tombol Keluar).
 * renderCard(slide, ctx) -> HTML isi kartu (diisi di P3).
 */
// capture: true = tanpa antarmuka dan tanpa navigasi, hanya untuk mengambil gambar slide (laporan).
export function createPresenter({ host, state, appTheme = 'light', userName = '', onExit = () => {}, renderCard = defaultCard, startAt = 0, capture = false, pixelRatio = null }) {
  const analysis = state.analysisData;
  const roles = state.config?.roles;
  const settings = state.config?.settings || {};
  const north = Number(settings.north_angle_deg || 0);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Warna material -> tema panggung (ikut aplikasi, pindah bila kontras kurang).
  const colors = colorResolver(state.materials, settings);
  const pick = pickStageTheme(appTheme, swatchesOf(analysis, roles, colors), { light: PALETTES.light.bg, dark: PALETTES.dark.bg });
  const theme = pick.theme;
  const pal = PALETTES[theme];

  const root = document.createElement('div');
  root.className = capture ? 'lxp is-capture' : 'lxp';
  root.dataset.theme = theme;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'presentasi');
  root.setAttribute('aria-label', 'Presentasi hasil OTTV');
  root.innerHTML = `
    <div class="lxp-stage"></div>
    <div class="lxp-marks" aria-hidden="true"><span class="lxp-sunmark"><i></i><b></b></span></div>
    <article class="lxp-card" aria-live="polite"></article>
    <div class="lxp-tools">
      <button type="button" class="lxp-btn" data-act="full" aria-label="Layar penuh (F)">${ICON.full}<span>Layar penuh</span></button>
      <button type="button" class="lxp-btn" data-act="exit" aria-label="Keluar presentasi (Esc)">${ICON.close}<span>Keluar</span></button>
    </div>
    <nav class="lxp-nav" aria-label="Slide">
      <span class="lxp-count"></span>
      <div class="lxp-dots"></div>
    </nav>`;
  host.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const stageEl = $('.lxp-stage');

  const maket = buildMaket(analysis, roles, pal, colors);
  const stage = createStage(stageEl, { theme, context: false, shadowSize: capture ? 4096 : maket.quality.shadowSize });
  if (pixelRatio) { stage.renderer.setPixelRatio(pixelRatio); stage.resize(); }
  stage.setAO(maket.quality.ao);
  stage.scene.add(maket.group);
  const b = maket.bounds;

  const lat = Number(analysis?.location_info?.latitude_deg ?? -6.2088);
  const R = domeRadius(state, b);
  const dome = createDome(stage, { radius: R, lat, date: state.sunDate || '2026-09-23', hour: Number(state.sunHour ?? 15), north, center: new THREE.Vector3(b.center.x, b.center.y, b.center.z), dark: theme === 'dark' });
  const marks = $('.lxp-marks');
  dome.labels.forEach((l) => marks.appendChild(l.el));
  // Bayangan mencakup model dan kubah.
  stage.applyShadowArea(Math.max(b.footprint * 2.2, b.size.y * 1.2, R * 1.15), new THREE.Vector3(b.center.x, 0, b.center.z));

  // Awan di atas puncak kubah, burung di ketinggian yang sama.
  const skyScale = Math.max(maket.scale, (R * 1.2) / 105);
  const clouds = createClouds(stage, { dark: theme === 'dark', scale: skyScale, target: [b.center.x, b.center.y, b.center.z], count: 14, opacity: 0.55, shadow: 0.35, hole: [Math.max(b.radius, R * 0.6) * 1.2, Math.max(b.radius, R * 0.6) * 3] });
  const birds = createBirds(stage, { dark: theme === 'dark', scale: skyScale });

  // Heatmap per sisi: skala panas SNI (0 / 25 / 35 / 50+ W/m², warna skala terang aplikasi) di semua tema
  // supaya legenda konsisten. Bila ada warna sisi yang kontrasnya < 3:1 terhadap latar, slide heatmap
  // memakai latar abu netral yang kontras dengan ujung terang maupun gelap skala.
  const sideRows = sidesOf(analysis);
  const ottvByCode = Object.fromEntries(sideRows.map((r) => [r.code === 'TG' ? 'TGR' : r.code, r.ottv_orientation_wm2]));
  const HEAT_BG = '#7C7D82';
  const heatNeedsBg = sideRows.some((r) => contrast(heatColor(r.ottv_orientation_wm2), pal.bg) < 3);
  const bgBase = new THREE.Color(pal.bg), bgHeat = new THREE.Color(HEAT_BG);
  const bgFade = { from: 0, to: 0, t0: 0 };
  // Label nilai di tiap sisi model.
  const sideLabels = [];
  for (const r of sideRows) {
    const h = maket.sides.get(r.code === 'TG' ? 'TGR' : r.code);
    if (!h) continue;
    const a = ((Number(r.azimuth_center_deg) || 0) + north) * Math.PI / 180;
    const p = h.center.clone().add(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)).multiplyScalar(Math.max(1.5, b.footprint * 0.12)));
    const el = document.createElement('span');
    el.className = 'lxp-sidelabel';
    el.innerHTML = `<i style="background:${heatColor(r.ottv_orientation_wm2)}"></i>${sideName(r.code)} <b>${f1(r.ottv_orientation_wm2)}</b>`;
    sideLabels.push({ p, el, v: r.ottv_orientation_wm2 });
    marks.appendChild(el);
  }
  sideLabels.sort((x, y) => y.v - x.v); // yang terpanas ditaruh lebih dulu bila label berdesakan

  const slides = slidesFor(analysis);
  let poses = {};
  let index = Math.min(Math.max(0, startAt), slides.length - 1);
  const cam = { az: 0, el: 0, dist: 1, target: new THREE.Vector3() };
  let fly = null;
  const domeFade = { from: 1, to: 1, t0: 0 };
  domeFade.from = domeFade.to = slides[index].wide ? 1 : 0;
  const bgK = (t) => bgFade.from + (bgFade.to - bgFade.from) * ease(Math.min(1, (t - bgFade.t0) / 700));
  bgFade.from = bgFade.to = slides[index].heat && heatNeedsBg ? 1 : 0;
  const domeK = (t) => domeFade.from + (domeFade.to - domeFade.from) * ease(Math.min(1, (t - domeFade.t0) / 700));

  function computePoses() {
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    poses = posesFor({ bounds: b, dome: R, breakdown: analysis?.orientation_breakdown, north, aspect: w / Math.max(1, h) });
    // Slide lebar: geser azimut sedikit bila bola matahari menutupi model di layar.
    for (const s of slides) if (s.wide) poses[s.id] = clearOfSun(poses[s.id]);
  }
  const corners = [];
  for (const x of [b.box.min.x, b.box.max.x]) for (const y of [b.box.min.y, b.box.max.y]) for (const z of [b.box.min.z, b.box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  function sunOverModel(p) {
    const tgt = new THREE.Vector3(...p.target);
    stage.applyCamera(tgt.clone().addScaledVector(dirFrom(p.az, p.el), p.dist), tgt);
    stage.camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const q = new THREE.Vector3();
    for (const c of corners) { q.copy(c).project(stage.camera); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    q.copy(dome.sun.pos).project(stage.camera);
    const m = 0.06; // ruang bebas di sekitar bola matahari (layar ternormalisasi)
    return q.z < 1 && q.x > x0 - m && q.x < x1 + m && q.y > y0 - m && q.y < y1 + m;
  }
  // Coba geser azimut dulu; bila matahari tinggi (dekat puncak kubah), turunkan kamera supaya bola
  // matahari tampak di atas model.
  function clearOfSun(p) {
    for (const de of [0, -12, -22, -32]) {
      const el = Math.max(8, p.el + de);
      for (const d of [0, 10, -10, 20, -20, 30, -30, 40, -40, 50, -50, 60, -60, 75, -75, 90, -90]) {
        const c = { ...p, el, az: (p.az + d + 360) % 360 };
        if (!sunOverModel(c)) return c;
      }
    }
    return p;
  }
  function applyCam() {
    const pos = cam.target.clone().addScaledVector(dirFrom(cam.az, cam.el), cam.dist);
    stage.applyCamera(pos, cam.target);
  }
  function snapTo(p) {
    Object.assign(cam, { az: p.az, el: p.el, dist: p.dist });
    cam.target.set(...p.target);
    fly = null;
    applyCam();
  }

  // Kartu dan penanda.
  const dotsEl = $('.lxp-dots');
  dotsEl.innerHTML = slides.map((s, i) => `<button type="button" class="lxp-dot" data-i="${i}" aria-label="${i + 1}. ${s.name}"></button>`).join('');
  const card = $('.lxp-card');
  function renderUI() {
    const s = slides[index];
    $('.lxp-count').textContent = `${index + 1} / ${slides.length}`;
    dotsEl.querySelectorAll('.lxp-dot').forEach((d, i) => { d.classList.toggle('is-on', i === index); d.setAttribute('aria-current', i === index ? 'step' : 'false'); });
    const ctx = { index, total: slides.length, analysis, state, theme, pick, sun: dome.sun, userName, heatColor };
    card.innerHTML = renderCard(s, ctx);
    const heatOn = Boolean(s.heat);
    maket.setHeat(heatOn ? (code) => heatColor(ottvByCode[code] ?? 0) : null);
    root.dataset.theme = heatOn && heatNeedsBg ? 'dark' : theme;
    sideLabels.forEach((l) => l.el.classList.toggle('is-on', heatOn));
    card.dataset.slide = s.id;
    layoutInset();
  }
  function layoutInset() {
    if (capture) { stage.setFrameInset(0); return; }
    const r = card.getBoundingClientRect();
    stage.setFrameInset(window.innerWidth > 720 ? r.right + 24 : 0);
  }

  function go(i, { instant = false } = {}) {
    const n = Math.min(Math.max(0, i), slides.length - 1);
    const changed = n !== index;
    index = n;
    renderUI();
    const p = poses[slides[index].id];
    const want = slides[index].wide ? 1 : 0;
    const wantBg = slides[index].heat && heatNeedsBg ? 1 : 0;
    if (wantBg !== bgFade.to) Object.assign(bgFade, { from: instant || reduceMotion ? wantBg : bgK(now()), to: wantBg, t0: now() });
    if (want !== domeFade.to) Object.assign(domeFade, { from: instant || reduceMotion ? want : domeK(now()), to: want, t0: now() });
    if (instant || reduceMotion) { snapTo(p); return changed; }
    fly = { t0: now(), from: { az: cam.az, el: cam.el, dist: cam.dist, target: cam.target.clone() }, to: { ...p, az: shortest(cam.az, p.az), target: new THREE.Vector3(...p.target) } };
    return changed;
  }
  const next = () => go(index + 1);
  const prev = () => go(index - 1);

  // Navigasi: keyboard dan clicker (clicker mengirim PageDown / PageUp).
  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    let used = true;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === 'Enter' || (k === ' ' && !e.shiftKey)) next();
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) prev();
    else if (k === 'Home') go(0);
    else if (k === 'End') go(slides.length - 1);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'Escape') exit();
    else used = false;
    if (used) e.preventDefault();
  }
  // Scroll: satu gerakan = satu slide (akumulasi, lalu dikunci sampai kamera tiba).
  let wheelAcc = 0, wheelLock = 0;
  function onWheel(e) {
    e.preventDefault();
    const t = performance.now();
    if (t < wheelLock) return;
    wheelAcc += e.deltaY || e.deltaX;
    if (Math.abs(wheelAcc) < 40) return;
    const moved = wheelAcc > 0 ? next() : prev();
    wheelAcc = 0;
    wheelLock = t + (moved ? (reduceMotion ? 450 : 900) : 250);
  }
  let touch0 = null;
  const onTouchStart = (e) => { touch0 = e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; };
  const onTouchEnd = (e) => {
    if (!touch0 || !e.changedTouches[0]) return;
    const dx = e.changedTouches[0].clientX - touch0.x, dy = e.changedTouches[0].clientY - touch0.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 50) ((Math.abs(dy) > Math.abs(dx) ? dy : dx) < 0 ? next : prev)();
    touch0 = null;
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act], .lxp-dot');
    if (!t) return;
    if (t.classList.contains('lxp-dot')) go(Number(t.dataset.i));
    else if (t.dataset.act === 'full') toggleFull();
    else if (t.dataset.act === 'exit') exit();
    else if (t.dataset.act === 'first') go(0);
  });

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.requestFullscreen?.().catch(() => {});
  }
  function onFullChange() {
    const on = document.fullscreenElement === root;
    const btn = $('[data-act="full"]');
    btn.innerHTML = `${on ? ICON.exitFull : ICON.full}<span>${on ? 'Keluar layar penuh' : 'Layar penuh'}</span>`;
    btn.setAttribute('aria-label', on ? 'Keluar layar penuh (F)' : 'Layar penuh (F)');
  }

  function onResize() {
    stage.resize();
    layoutInset();
    computePoses();
    snapTo(poses[slides[index].id]);
  }

  // Penanda matahari di tepi layar saat bola matahari di luar bingkai (mis. kamera membelakangi matahari).
  const sunMark = $('.lxp-sunmark');
  const hourText = `${String(Math.floor(Number(state.sunHour ?? 15))).padStart(2, '0')}.${String(Math.round((Number(state.sunHour ?? 15) % 1) * 60)).padStart(2, '0')}`;
  const v = new THREE.Vector3();
  function placeMarks() {
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    for (const l of dome.labels) {
      v.copy(l.p).project(stage.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      l.el.style.display = vis ? '' : 'none';
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
    // Label sisi: yang bertumpuk dengan label lebih panas disembunyikan.
    const placed = [];
    for (const l of sideLabels) {
      if (!l.el.classList.contains('is-on')) continue;
      v.copy(l.p).project(stage.camera);
      const px = ((v.x + 1) / 2) * w, py = ((1 - v.y) / 2) * h;
      const lw = l.el.offsetWidth || 90, lh = l.el.offsetHeight || 28;
      const box = [px - lw / 2 - 4, py - lh / 2 - 4, px + lw / 2 + 4, py + lh / 2 + 4];
      const clash = placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]);
      l.el.style.visibility = clash ? 'hidden' : '';
      if (!clash) placed.push(box);
      l.el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    }
    // Kubah tampil: penanda hanya bila bola matahari di luar bingkai. Kubah tersembunyi: penanda selalu tampil,
    // ditaruh searah sinar matahari (titik jauh di arah matahari), di tepi layar bila di luar bingkai.
    const domeOn = domeFade.to > 0.5;
    if (domeOn) v.copy(dome.sun.pos); else v.copy(cam.target).addScaledVector(dome.dir, cam.dist * 50);
    v.project(stage.camera);
    const behind = v.z > 1;
    let x = behind ? -v.x : v.x, y = behind ? -v.y : v.y;
    const inside = !behind && Math.abs(x) < 0.94 && Math.abs(y) < 0.9;
    const show = domeOn ? !inside : true;
    sunMark.style.display = show ? '' : 'none';
    sunMark.classList.toggle('is-edge', !inside);
    if (show) {
      const left = (window.innerWidth > 720 ? card.getBoundingClientRect().right + 24 : 0) / w * 2 - 1; // jangan di belakang kartu
      if (!inside) {
        const k = 1 / Math.max(Math.abs(x) / 0.94, Math.abs(y) / 0.86, 1e-6);
        x *= k; y *= k;
      }
      y = Math.min(y, 1 - 2 * 88 / h); // di bawah baris tombol kanan atas
      x = Math.max(left + 0.06, x);
      // titik matahari tepat di posisinya; teks di sisi yang masih ada ruang
      const flip = x > 0.3;
      sunMark.classList.toggle('is-flip', flip);
      sunMark.style.transform = `translate(${((x + 1) / 2) * w}px, ${((1 - y) / 2) * h}px) translate(${flip ? 'calc(-100% + 10px)' : '-10px'}, -50%)`;
      sunMark.querySelector('b').textContent = behind ? `Matahari ${hourText} · di belakang kamera` : `Matahari ${hourText}`;
    }
  }

  const now = () => (window.__lxpT ?? performance.now());
  let raf = 0, alive = true;
  function frame() {
    if (!alive) return;
    const t = now();
    if (fly) {
      const k = Math.min(1, (t - fly.t0) / FLY_MS), e = ease(k);
      // jarak diinterpolasi secara logaritmik supaya zoom terasa rata
      cam.az = fly.from.az + (fly.to.az - fly.from.az) * e;
      cam.el = fly.from.el + (fly.to.el - fly.from.el) * e;
      cam.dist = Math.exp(Math.log(fly.from.dist) + (Math.log(fly.to.dist) - Math.log(fly.from.dist)) * e);
      cam.target.lerpVectors(fly.from.target, fly.to.target, e);
      applyCam();
      if (k >= 1) fly = null;
    }
    dome.setOpacity(domeK(t));
    stage.scene.background.lerpColors(bgBase, bgHeat, bgK(t));
    clouds.tick(stage.camera, t / 1000, cam.dist, reduceMotion);
    birds.tick(t / 1000, cam.dist, reduceMotion);
    stage.render();
    placeMarks();
    raf = requestAnimationFrame(frame);
  }

  function exit() { onExit(); }
  function destroy() {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    root.removeEventListener('wheel', onWheel);
    document.removeEventListener('fullscreenchange', onFullChange);
    if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => {});
    clouds.dispose();
    dome.dispose();
    maket.dispose();
    stage.dispose();
    root.remove();
  }

  if (!capture) {
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('fullscreenchange', onFullChange);
  }

  renderUI();
  computePoses();
  snapTo(poses[slides[index].id]);
  if (!capture) frame();

  /** Gambar satu slide (mode capture): JPEG data URL dengan awan dan burung pada waktu tetap. */
  function shot(id, { time = 20000, quality = 0.92, zoom = 1 } = {}) {
    const i = slides.findIndex((x) => x.id === id);
    if (i < 0) return null;
    go(i, { instant: true });
    if (zoom !== 1) { cam.dist *= zoom; applyCam(); }
    dome.setOpacity(domeK(time));
    stage.scene.background.lerpColors(bgBase, bgHeat, bgK(time));
    clouds.tick(stage.camera, time / 1000, cam.dist, false);
    birds.tick(time / 1000, cam.dist, false);
    stage.render();
    return stage.renderer.domElement.toDataURL('image/jpeg', quality);
  }

  return {
    get index() { return index; },
    slides, go, next, prev, destroy, toggleFull, shot, theme, heatNeedsBg,
    _debug: { stage, maket, dome, pick, poses: () => poses, cam, skyScale },
  };
}
