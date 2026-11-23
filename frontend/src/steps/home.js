/**
 * Beranda: sapaan, tentang LUXA singkat, akses cepat, video demo, dan pintu ke Belajar OTTV.
 */

import { icon } from '../ui/icons.js';
import { renderLux } from '../ui/mascot.js';
import { LEARN_CHAPTER_TITLES } from '../learn/learn.js';

const NAME_KEY = 'luxa.userName.v1';

export function loadUserName() {
  try {
    return window.localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

export function saveUserName(name) {
  try {
    if (name === null) window.localStorage.removeItem(NAME_KEY);
    else window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // penyimpanan browser tidak tersedia: sapaan tanpa nama
  }
}

function greetingWord(d = new Date()) {
  const h = d.getHours();
  if (h >= 4 && h < 11) return 'Selamat pagi';
  if (h >= 11 && h < 15) return 'Selamat siang';
  if (h >= 15 && h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function renderHomeScreen(state, handlers) {
  const main = document.createElement('main');
  main.className = 'main main-home';

  // ---------------- Kartu sapaan + tentang + akses cepat ----------------
  const hero = document.createElement('section');
  hero.className = 'box home-hero';
  hero.setAttribute('aria-labelledby', 'home-title');

  const top = document.createElement('div');
  top.className = 'home-greet';
  const lux = renderLux(state, 'wave', { size: 104, className: 'home-lux' });
  if (lux) top.appendChild(lux);

  const greetText = document.createElement('div');
  const name = loadUserName();
  const h1 = document.createElement('h1');
  h1.id = 'home-title';
  h1.textContent = name ? `${greetingWord()}, ${name}` : `${greetingWord()}!`;
  const sub = document.createElement('p');
  sub.className = 'muted home-sub';
  sub.textContent = 'Aku Lux. Ayo cek seberapa panas fasad desainmu hari ini.';
  greetText.append(h1, sub);

  if (name === null) {
    // Tanya nama sekali saja (opsional).
    const form = document.createElement('form');
    form.className = 'home-name-form';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'field-input';
    inp.maxLength = 30;
    inp.placeholder = 'Alfian';
    inp.setAttribute('aria-label', 'Nama panggilan');
    const lbl = document.createElement('label');
    lbl.className = 'lbl';
    lbl.textContent = 'Mau dipanggil siapa?';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'ghost ghost-sm on';
    ok.textContent = 'Simpan';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'ghost ghost-sm';
    skip.textContent = 'Lewati';
    skip.addEventListener('click', () => {
      saveUserName('');
      handlers.onRerender?.();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = inp.value.trim().slice(0, 30);
      saveUserName(v);
      handlers.onRerender?.();
    });
    const row = document.createElement('div');
    row.className = 'home-name-row';
    row.append(inp, ok, skip);
    form.append(lbl, row);
    greetText.appendChild(form);
  }
  top.appendChild(greetText);
  hero.appendChild(top);

  const about = document.createElement('div');
  about.className = 'home-about';
  about.innerHTML = `
    <p><b>LUXA</b> menghitung OTTV (nilai perpindahan termal menyeluruh) langsung dari model 3D-mu, mengikuti <b>SNI 6389:2020</b>. Kamu bisa melihat sisi mana yang paling panas, mencoba kaca atau peneduh lain, lalu mengunduh laporannya.</p>
    <ul class="home-points">
      <li>${icon('cube', 16)}<span>Baca model .3dm, .ifc, .obj, .glb</span></li>
      <li>${icon('doc', 16)}<span>Rumus dan tabel SNI 6389:2020</span></li>
      <li>${icon('check', 16)}<span>Berjalan di browser, model tidak dikirim ke server</span></li>
    </ul>`;
  hero.appendChild(about);

  const actions = document.createElement('div');
  actions.className = 'home-actions';
  const mk = (cls, iconName, text, fn, title = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.innerHTML = `${icon(iconName, 17)}<span>${text}</span>`;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  actions.appendChild(mk('cta', 'upload', 'Mulai proyek baru', () => handlers.onStartNew?.()));
  if (handlers.savedAutosave) {
    const fn = handlers.savedAutosave.filename || 'proyek terakhir';
    actions.appendChild(mk('ghost', 'undo', `Lanjutkan ${fn}`, () => handlers.onResume?.(handlers.savedAutosave), `Lanjutkan ${fn}`));
  }
  actions.appendChild(mk('ghost', 'play', 'Coba model contoh', () => handlers.onTryExample?.()));
  hero.appendChild(actions);

  // ---------------- Video demo ----------------
  const demo = document.createElement('section');
  demo.className = 'box home-demo';
  demo.setAttribute('aria-label', 'Cuplikan LUXA');
  const theme = state.theme === 'dark' ? 'dark' : 'light';
  const base = `${import.meta.env.BASE_URL}demo/luxa-demo-${theme}`;
  const video = document.createElement('video');
  video.className = 'home-video';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-label', 'Cuplikan: model berputar dengan mode Klasifikasi, Heatmap, lalu matahari bergerak dari pagi ke sore');
  video.poster = `${base}.jpg`;
  video.preload = 'metadata';
  if (!prefersReducedMotion()) video.autoplay = true;
  for (const [ext, type] of [
    ['webm', 'video/webm'],
    ['mp4', 'video/mp4'],
  ]) {
    const s = document.createElement('source');
    s.src = `${base}.${ext}`;
    s.type = type;
    video.appendChild(s);
  }
  const cap = document.createElement('div');
  cap.className = 'home-demo-cap';
  cap.innerHTML = '<span class="chip">Klasifikasi</span><span class="chip">Heatmap OTTV</span><span class="chip">Matahari 06.00–18.00</span>';
  demo.append(video, cap);

  // ---------------- Belajar OTTV ----------------
  const learn = document.createElement('section');
  learn.className = 'box home-learn';
  learn.setAttribute('aria-labelledby', 'home-learn-title');
  const lh = document.createElement('div');
  lh.className = 'home-learn-head';
  const lt = document.createElement('div');
  lt.innerHTML = '<h2 id="home-learn-title">Belajar OTTV</h2><p class="muted">Tujuh bab singkat dengan simulasi yang bisa kamu geser sendiri, plus bonus RTTV. Sekitar 15 menit.</p>';
  const go = mk('cta', 'play', 'Mulai belajar', () => handlers.onOpenLearn?.(0));
  lh.append(lt, go);
  const chips = document.createElement('ol');
  chips.className = 'home-learn-list';
  LEARN_CHAPTER_TITLES.forEach((t, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="num">${i === LEARN_CHAPTER_TITLES.length - 1 ? '★' : i + 1}</span><span></span>`;
    b.lastChild.textContent = t;
    b.addEventListener('click', () => handlers.onOpenLearn?.(i));
    li.appendChild(b);
    chips.appendChild(li);
  });
  learn.append(lh, chips);

  main.append(hero, demo, learn);
  return main;
}
