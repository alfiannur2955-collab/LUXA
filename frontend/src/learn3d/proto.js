// Halaman prototipe Tahap 1: adegan diam. ?shot=beranda|bab1|bab4|bab5|bab7&theme=light|dark&labels=1
import { createStage } from './stage.js';
import { PODIUM_H, TOWER_TOP } from './tower.js';
import './learn3d.css';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
const shot = q.get('shot') || 'beranda';
document.documentElement.dataset.theme = theme;

const host = document.getElementById('stage');
const stage = createStage(host, { theme });
stage.setShot(shot);

if (q.get('labels') !== '0') {
  if (shot === 'bab4' || shot === 'bab1' || shot === 'bab7') {
    stage.addLabel([-14, 74, -10], 'Fasad Barat', { lift: 70 });
    stage.addLabel([-2, PODIUM_H + 22, 2], 'Takik', { lift: 30 });
    stage.addLabel([-20, PODIUM_H, 20], 'Podium', { lift: 44 });
    stage.addLabel([4, TOWER_TOP + 3, -4], 'Tower 20 lantai', { tag: true, lift: 30 });
  }
  if (shot === 'bab5') {
    stage.addLabel([-14.7, 56.3, -10], 'Overhang 0,7 m', { tag: true, lift: 40 });
    stage.addLabel([-14.05, 54.5, -1], 'Kaca 1,7 m', { lift: 30 });
  }
}

window.addEventListener('resize', () => { stage.resize(); stage.render(); });
let n = 0;
(function tick() {
  stage.render();
  if (++n < 6) requestAnimationFrame(tick);
  else window.__ready = true;
})();
window.__stage = stage;
