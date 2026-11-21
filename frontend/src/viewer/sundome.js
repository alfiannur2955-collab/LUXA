/**
 * LUXA 3D Sun Dome (`docs/FASE4_UI_SPEC.md` §4.4):
 * - Computes exact solar vector (E, N, U) from `location_info.latitude_deg`,
 *   declination, hour angle, and `north_angle_deg` (identical to `backend/ottv_engine.py`).
 * - Draws compass horizon ring (`U / T / S / B` + 8 ticks), 3 reference arcs
 *   (`21 Jun`, `21 Mar / 23 Sep`, `21 Des`), active sun orb + halo + dashed ray to center.
 * - Default radius = 1.6 × half plan diagonal, scaled by `sunDomeScale` (50–200%).
 * - Projects crisp HTML labels for U/T/S/B, arc dates, and small altitude/azimuth readout.
 */

import * as THREE from 'three';
import { toThreeCoords } from './cameras.js';

const PRESET_ARCS = [
  { id: 'jun', date: '2026-06-21', label: '21 Jun' },
  { id: 'eqx', date: '2026-09-23', label: '21 Mar / 23 Sep' },
  { id: 'dec', date: '2026-12-21', label: '21 Des' },
];

export function dayOfYearFromIso(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || '2026-09-23'));
  if (!m) return 266;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(Date.UTC(year, 0, 1));
  return Math.max(1, Math.min(366, Math.floor((d - start) / 86400000) + 1));
}

/**
 * Computes solar vector in backend (E, N, U) & Three.js (x=E, y=U, z=-N) coords,
 * plus altitude_deg and azimuth_deg (0=U, 90=T, 180=S, 270=B).
 */
export function computeSolarPosition(latitudeDeg = -6.2088, dateStr = '2026-09-23', hour = 13, northAngleDeg = 0) {
  const doy = dayOfYearFromIso(dateStr);
  const decDeg = 23.45 * Math.sin(((360 * (284 + doy)) / 365) * (Math.PI / 180));
  const latRad = (Number(latitudeDeg) || -6.2088) * (Math.PI / 180);
  const decRad = decDeg * (Math.PI / 180);
  const northRad = (Number(northAngleDeg) || 0) * (Math.PI / 180);

  const omegaRad = ((Number(hour) - 12.0) * 15.0 * Math.PI) / 180;
  const sinAlt = Math.max(
    -1,
    Math.min(1, Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(omegaRad)),
  );
  const altDeg = (Math.asin(sinAlt) * 180) / Math.PI;

  const sx0 = -Math.cos(decRad) * Math.sin(omegaRad);
  const sy0 = Math.cos(latRad) * Math.sin(decRad) - Math.sin(latRad) * Math.cos(decRad) * Math.cos(omegaRad);
  const sz0 = sinAlt;

  const cosN = Math.cos(northRad);
  const sinN = Math.sin(northRad);
  const sx = sx0 * cosN + sy0 * sinN;
  const sy = -sx0 * sinN + sy0 * cosN;
  const sz = sz0;

  const len = Math.hypot(sx, sy, sz) || 1;
  const vx = sx / len;
  const vy = sy / len;
  const vz = sz / len;
  const azDeg = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;

  return {
    altitudeDeg: altDeg,
    azimuthDeg: azDeg,
    aboveHorizon: altDeg > 0.5,
    enu: [vx, vy, vz],
    threeDir: new THREE.Vector3(vx, vz, -vy),
  };
}

export class SunDomeController {
  constructor() {
    this.group = null;
    this.overlayHost = null;
    this.overlayLayer = null;
    this.readoutEl = null;
    this.projectedLabels = []; // [{ el, worldPos: THREE.Vector3 }]
    this.lastSig = '';
    this._projVec = new THREE.Vector3();
  }

  attachGroup(group) {
    this.group = group;
  }

  mountOverlay(overlayHost) {
    if (!overlayHost) return;
    if (this.overlayHost === overlayHost && this.overlayLayer && this.overlayLayer.isConnected) return;
    this.overlayHost = overlayHost;

    if (!this.overlayLayer) {
      this.overlayLayer = document.createElement('div');
      this.overlayLayer.className = 'sundome-labels-layer';
      this.overlayLayer.setAttribute('aria-hidden', 'true');
    }
    overlayHost.appendChild(this.overlayLayer);

    if (!this.readoutEl) {
      this.readoutEl = document.createElement('div');
      this.readoutEl.className = 'glass-thin sundome-readout num';
      this.readoutEl.setAttribute('aria-live', 'polite');
    }
    overlayHost.appendChild(this.readoutEl);
  }

  _clear() {
    if (this.group) {
      while (this.group.children.length > 0) {
        const obj = this.group.children[0];
        this.group.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      }
    }
    if (this.overlayLayer) {
      this.overlayLayer.innerHTML = '';
    }
    this.projectedLabels = [];
    if (this.readoutEl) {
      this.readoutEl.style.display = 'none';
    }
  }

  _addProjectedLabel(text, worldPos, className = 'sundome-lbl') {
    if (!this.overlayLayer) return;
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    this.overlayLayer.appendChild(el);
    this.projectedLabels.push({ el, worldPos: worldPos.clone() });
  }

  sync(state, bbox, tokens) {
    if (!this.group) return;
    const shouldShow = Boolean(
      state.step === 'results' && state.analysisData && state.sunDomeVisible !== false && bbox,
    );
    if (!shouldShow) {
      if (this.lastSig !== 'hidden') {
        this._clear();
        this.lastSig = 'hidden';
      }
      return;
    }

    const latDeg = Number(state.analysisData?.location_info?.latitude_deg ?? -6.2088);
    const northDeg = Number(state.config?.settings?.north_angle_deg ?? 0);
    const dateStr = state.sunDate || '2026-09-23';
    const hour = Number(state.sunHour ?? 13);
    const scalePct = Math.max(50, Math.min(200, Number(state.sunDomeScale ?? 100)));
    const zCut = Number(state.config?.model?.z_ground_cutoff_m ?? 0);

    const sig = JSON.stringify({
      bboxCenter: bbox.center,
      bboxSpan: bbox.span,
      latDeg,
      northDeg,
      dateStr,
      hour,
      scalePct,
      zCut,
      theme: state.theme,
    });
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    this._clear();

    const spanX = Math.max(2, Number(bbox.span?.[0] || 15));
    const spanY = Math.max(2, Number(bbox.span?.[1] || 15));
    const halfPlanDiag = 0.5 * Math.hypot(spanX, spanY);
    // Spec §4.4: default radius = 1.6 × half plan diagonal
    const defaultRadius = Math.max(10, 1.6 * halfPlanDiag);
    const radius = defaultRadius * (scalePct / 100);

    const cx = Number(bbox.center?.[0] || 0);
    const cy = Number(bbox.center?.[1] || 0);
    const baseZ = Math.max(Number(bbox.min?.[2] ?? 0), zCut);
    const center = toThreeCoords(cx, cy, baseZ);

    const colInk = new THREE.Color(tokens.ink);
    const colSun = new THREE.Color(tokens.sun);

    // 1. Horizon compass ring
    const ringPts = [];
    const segs = 72;
    for (let i = 0; i <= segs; i += 1) {
      const a = (i / segs) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(center.x + radius * Math.cos(a), center.y + 0.04, center.z + radius * Math.sin(a)));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    const ringMat = new THREE.LineBasicMaterial({ color: colInk, transparent: true, opacity: 0.34 });
    const ringLine = new THREE.Line(ringGeo, ringMat);
    ringLine.raycast = () => {};
    this.group.add(ringLine);

    // 2. 8 compass ticks + U/T/S/B cardinal labels rotated by north_angle_deg
    const tickCoords = [];
    const cardinals = [
      { az: 0, lbl: 'U', major: true },
      { az: 45, lbl: null, major: false },
      { az: 90, lbl: 'T', major: true },
      { az: 135, lbl: null, major: false },
      { az: 180, lbl: 'S', major: true },
      { az: 225, lbl: null, major: false },
      { az: 270, lbl: 'B', major: true },
      { az: 315, lbl: null, major: false },
    ];
    for (const c of cardinals) {
      const rad = ((c.az + northDeg) * Math.PI) / 180;
      const dx = Math.sin(rad);
      const dz = -Math.cos(rad);
      const rIn = radius * (c.major ? 0.94 : 0.965);
      const rOut = radius * (c.major ? 1.05 : 1.03);
      tickCoords.push(
        center.x + dx * rIn,
        center.y + 0.04,
        center.z + dz * rIn,
        center.x + dx * rOut,
        center.y + 0.04,
        center.z + dz * rOut,
      );
      if (c.lbl) {
        this._addProjectedLabel(
          c.lbl,
          new THREE.Vector3(center.x + dx * (radius * 1.12), center.y + 0.1, center.z + dz * (radius * 1.12)),
          'sundome-cardinal',
        );
      }
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickCoords, 3));
    const tickMat = new THREE.LineBasicMaterial({ color: colInk, transparent: true, opacity: 0.5 });
    const tickLines = new THREE.LineSegments(tickGeo, tickMat);
    tickLines.raycast = () => {};
    this.group.add(tickLines);

    // 3. Three reference solar path arcs (21 Jun, 21 Mar / 23 Sep, 21 Des) + custom active arc if needed
    const isPresetDate = PRESET_ARCS.some((a) => a.date === dateStr) || dateStr.endsWith('-03-21');
    const arcsToDraw = PRESET_ARCS.map((a) => ({
      ...a,
      isActive:
        a.date === dateStr ||
        (a.id === 'eqx' && (dateStr.endsWith('-03-21') || dateStr.endsWith('-09-23'))),
    }));
    if (!isPresetDate) {
      arcsToDraw.push({ id: 'custom', date: dateStr, label: dateStr, isActive: true });
    }

    for (const arc of arcsToDraw) {
      const pts = [];
      for (let h = 5.0; h <= 19.0; h += 0.2) {
        const sp = computeSolarPosition(latDeg, arc.date, h, northDeg);
        if (sp.altitudeDeg >= 0) {
          pts.push(center.clone().addScaledVector(sp.threeDir, radius));
        }
      }
      if (pts.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = arc.isActive
        ? new THREE.LineBasicMaterial({ color: colSun, transparent: true, opacity: 0.92 })
        : new THREE.LineDashedMaterial({
            color: colSun,
            dashSize: Math.max(0.4, radius * 0.03),
            gapSize: Math.max(0.3, radius * 0.025),
            transparent: true,
            opacity: 0.42,
          });
      const line = new THREE.Line(geo, mat);
      if (!arc.isActive) line.computeLineDistances();
      line.raycast = () => {};
      this.group.add(line);

      // Label at solar noon (12:00) on the arc
      const noonPos = computeSolarPosition(latDeg, arc.date, 12, northDeg);
      if (noonPos.altitudeDeg > 0) {
        const labelWorld = center.clone().addScaledVector(noonPos.threeDir, radius * 1.05);
        this._addProjectedLabel(arc.label, labelWorld, `sundome-arc-lbl${arc.isActive ? ' is-active' : ''}`);
      }
    }

    // 4. Active sun orb + halo + dashed ray to center
    const activeSun = computeSolarPosition(latDeg, dateStr, hour, northDeg);
    if (activeSun.altitudeDeg >= -1) {
      const clampedDir = activeSun.threeDir.clone();
      if (clampedDir.y < 0.01) {
        clampedDir.y = 0.01;
        clampedDir.normalize();
      }
      const sunPos = center.clone().addScaledVector(clampedDir, radius);
      const orbR = Math.max(0.55, radius * 0.036);

      const coreGeo = new THREE.SphereGeometry(orbR, 20, 16);
      const coreMat = new THREE.MeshBasicMaterial({ color: colSun });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.position.copy(sunPos);
      coreMesh.raycast = () => {};
      this.group.add(coreMesh);

      const haloGeo = new THREE.SphereGeometry(orbR * 1.85, 20, 16);
      const haloMat = new THREE.MeshBasicMaterial({ color: colSun, transparent: true, opacity: 0.24 });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.position.copy(sunPos);
      haloMesh.raycast = () => {};
      this.group.add(haloMesh);

      const rayGeo = new THREE.BufferGeometry().setFromPoints([sunPos, center]);
      const rayMat = new THREE.LineDashedMaterial({
        color: colSun,
        dashSize: Math.max(0.35, radius * 0.025),
        gapSize: Math.max(0.35, radius * 0.025),
        transparent: true,
        opacity: 0.55,
      });
      const rayLine = new THREE.Line(rayGeo, rayMat);
      rayLine.computeLineDistances();
      rayLine.raycast = () => {};
      this.group.add(rayLine);
    }

    // 5. Small altitude & azimuth readout (spec §4.4)
    if (this.readoutEl) {
      const hTxt = `${String(Math.round(hour)).padStart(2, '0')}.00`;
      const altTxt = activeSun.aboveHorizon ? `${Math.round(activeSun.altitudeDeg)}°` : 'Di bawah ufuk';
      const azTxt = `${Math.round(activeSun.azimuthDeg)}°`;
      this.readoutEl.textContent = `Matahari ${hTxt} · Tinggi ${altTxt} · Azimut ${azTxt}`;
      this.readoutEl.style.display = 'inline-flex';
    }
  }

  updateLabels(camera, width, height) {
    if (!this.overlayLayer || !camera || width <= 0 || height <= 0) return;
    for (const item of this.projectedLabels) {
      this._projVec.copy(item.worldPos).project(camera);
      const vis =
        this._projVec.z >= -1 &&
        this._projVec.z <= 1 &&
        this._projVec.x >= -1.04 &&
        this._projVec.x <= 1.04 &&
        this._projVec.y >= -1.04 &&
        this._projVec.y <= 1.04;
      if (vis) {
        const px = (this._projVec.x * 0.5 + 0.5) * width;
        const py = (-this._projVec.y * 0.5 + 0.5) * height;
        item.el.style.display = 'block';
        item.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
      } else {
        item.el.style.display = 'none';
      }
    }
  }
}
