// Gambar slide Presentasi untuk laporan (mode capture): sama persis dengan yang dilihat di Presentasi.
import { createPresenter } from '../present/presenter.js';

function capture(state, theme, w, h, ids) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${w + 300}px;top:0;width:${w}px;height:${h}px;overflow:hidden;`;
  document.body.appendChild(host);
  const p = createPresenter({ host, state, appTheme: theme, capture: true, pixelRatio: 1 });
  const out = {};
  for (const id of ids) out[id] = p.shot(id);
  const meta = { theme: p.theme, heatNeedsBg: p.heatNeedsBg };
  p.destroy();
  host.remove();
  return { out, meta };
}

/** orient: 'landscape' | 'portrait'. Hasil: { hero, sisi, terpanas, kaca, atap?, penutup, stageTheme } */
export function captureSlides(state, theme, orient) {
  const [hw, hh] = orient === 'portrait' ? [1700, 1500] : [2600, 1840];
  const big = capture(state, theme, hw, hh, ['sampul', 'penutup']);
  const small = capture(state, theme, 1600, 1100, ['sisi', 'terpanas', 'kaca', 'atap']);
  return { hero: big.out.sampul, penutup: big.out.penutup, ...small.out, stageTheme: big.meta.theme };
}
