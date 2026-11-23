// Pratinjau panggung Presentasi (Tahap P1): ?data=<json hasil hitung> &theme=light|dark &shot=hero|side &inset=px
import * as THREE from 'three';
import { createStage, dirFrom } from '../learn3d/stage.js';
import { createClouds } from '../learn3d/clouds.js';
import { createBirds } from '../learn3d/birds.js';
import { PALETTES } from '../learn3d/palette.js';
import { buildMaket } from './maket.js';
import { heroPose, sidePose } from './framing.js';
import '../learn3d/learn3d.css';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
document.body.classList.add('l3d-on');
const host = Object.assign(document.createElement('div'), { className: 'l3d-stage' });
document.body.appendChild(host);

const res = await fetch(q.get('data') || './kotak.json');
const { analysisData, roles } = await res.json();
const pal = PALETTES[theme];
const maket = buildMaket(analysisData, roles, pal);
const stage = createStage(host, { theme, context: false, shadowSize: maket.quality.shadowSize });
stage.setAO(maket.quality.ao);
stage.scene.add(maket.group);
const inset = Number(q.get('inset') || 460);
stage.setFrameInset(inset);

const b = maket.bounds;
const aspect = (host.clientWidth) / host.clientHeight;
const pose = (q.get('shot') === 'side' ? sidePose : heroPose)(b, analysisData.orientation_breakdown, { aspect });
const target = new THREE.Vector3(...pose.target);
const pos = target.clone().addScaledVector(dirFrom(pose.az, pose.el), pose.dist);
stage.applyShadowArea(Math.max(b.footprint * 2.2, b.size.y * 1.1, 20), new THREE.Vector3(b.center.x, 0, b.center.z));
stage.applyCamera(pos, target);

const clouds = createClouds(stage, { dark: theme === 'dark', scale: maket.scale, target: [b.center.x, b.center.y, b.center.z], count: 14, opacity: 0.55, shadow: 0.35, hole: [b.radius * 1.3, b.radius * 3.2] });
const birds = createBirds(stage, { dark: theme === 'dark', scale: maket.scale });
const t = Number(q.get('t') || 20);
clouds.tick(stage.camera, t, pose.dist, false);
birds.tick(t, pose.dist, false);
window.addEventListener('resize', () => { stage.resize(); stage.render(); });
let n = 0;
(function loop() { stage.render(); if (++n < 4) requestAnimationFrame(loop); else { window.__info.drawn = stage.renderer.info.render.triangles; window.__ready = true; } })();
window.__stage = stage;
window.__info = { cam: stage.camera.position.toArray().map(Math.round), gl: stage.renderer.getContext().isContextLost(), tris: maket.tris, quality: maket.quality, scale: maket.scale, pose, size: b.size.toArray() };
