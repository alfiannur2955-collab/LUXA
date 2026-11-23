// Gambar model untuk laporan: maket bergaya Presentasi (warna material + kubah matahari) dan heatmap per sisi.
// Dirender sekali di kanvas tersembunyi, selalu tema terang (laporan dicetak di kertas putih).
import * as THREE from 'three';
import { createStage, dirFrom } from '../learn3d/stage.js';
import { PALETTES } from '../learn3d/palette.js';
import { buildMaket } from '../present/maket.js';
import { colorResolver } from '../present/colors.js';
import { createDome, domeRadius } from '../present/sundome.js';
import { posesFor } from '../present/slides.js';
import { sidesOf } from '../present/content.js';
import { heatColor } from '../present/heat.js';

/** state: { analysisData, config, materials, sunDate, sunHour, sunDomeRadiusM } -> { hero, heat } (data URL JPEG) */
export async function renderSnapshots(state, { width = 1800, height = 1100 } = {}) {
  const analysis = state.analysisData;
  const settings = state.config?.settings || {};
  const north = Number(settings.north_angle_deg || 0);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(host);
  const pal = PALETTES.light;
  const maket = buildMaket(analysis, state.config?.roles, pal, colorResolver(state.materials, settings));
  const stage = createStage(host, { theme: 'light', context: false, shadowSize: maket.quality.shadowSize });
  stage.renderer.setPixelRatio(1);
  stage.resize();
  stage.setAO(maket.quality.ao);
  stage.scene.add(maket.group);
  const b = maket.bounds;
  const R = domeRadius(state, b);
  const dome = createDome(stage, {
    radius: R,
    lat: Number(analysis?.location_info?.latitude_deg ?? -6.2088),
    date: state.sunDate || '2026-09-23',
    hour: Number(state.sunHour ?? 15),
    north,
    center: new THREE.Vector3(b.center.x, b.center.y, b.center.z),
  });
  dome.labels.forEach((l) => l.el.remove());
  stage.applyShadowArea(Math.max(b.footprint * 2.2, b.size.y * 1.2, R * 1.15), new THREE.Vector3(b.center.x, 0, b.center.z));
  const poses = posesFor({ bounds: b, dome: R, breakdown: analysis?.orientation_breakdown, north, aspect: width / height });

  const shoot = (p, { fitScale = 1 } = {}) => {
    const t = new THREE.Vector3(...p.target);
    stage.applyCamera(t.clone().addScaledVector(dirFrom(p.az, p.el), p.dist * fitScale), t);
    stage.render();
    return stage.renderer.domElement.toDataURL('image/jpeg', 0.9);
  };
  // Gambar laporan tanpa kartu di sisi kiri: model di tengah bingkai, sedikit lebih dekat.
  const hero = shoot(poses.sampul, { fitScale: 0.7 });
  const byCode = Object.fromEntries(sidesOf(analysis).map((r) => [r.code === 'TG' ? 'TGR' : r.code, r.ottv_orientation_wm2]));
  maket.setHeat((code) => heatColor(byCode[code] ?? 0));
  dome.setOpacity(0.45);
  const heat = shoot({ ...poses.sisi, el: 50 }, { fitScale: 0.72 });

  dome.dispose();
  maket.dispose();
  stage.dispose();
  host.remove();
  return { hero, heat };
}
