/**
 * LUXA Projected HTML Glass Labels Overlay (`docs/FASE4_UI_SPEC.md` §4.3 & §3.3):
 * - Projects clicked panel 3D `centroid` every animation frame to 2D viewer pixels
 *   and positions a tier-1 `.glass` HTML card + dot pin (NEVER a Three.js Sprite!).
 * - Also renders numbered Kejanggalan pins matching `Daftar kejanggalan` when in
 *   Inspeksi or Kejanggalan mode.
 */

import * as THREE from 'three';
import { fmtId } from '../ui/escapeHtml.js';
import { toThreeCoords } from './cameras.js';

export class ViewerLabelsOverlay {
  constructor() {
    this.host = null;
    this.layer = null;
    this.panelPinEl = null;
    this.flagPins = []; // [{ el, worldPos: THREE.Vector3 }]
    this.panelAnchorWorld = null; // THREE.Vector3 | null
    this._projVec = new THREE.Vector3();
  }

  mount(overlayHost) {
    if (!overlayHost) return;
    if (this.host === overlayHost && this.layer && this.layer.isConnected) return;
    this.host = overlayHost;

    if (!this.layer) {
      this.layer = document.createElement('div');
      this.layer.className = 'viewer-labels-layer';
      this.layer.setAttribute('aria-hidden', 'false');
    }
    overlayHost.appendChild(this.layer);
  }

  setPanelLabel(summary) {
    if (!this.layer) return;
    if (!summary || !summary.anchorCentroid) {
      this.panelAnchorWorld = null;
      if (this.panelPinEl) {
        this.panelPinEl.remove();
        this.panelPinEl = null;
      }
      return;
    }

    const c = summary.anchorCentroid;
    this.panelAnchorWorld = toThreeCoords(c[0], c[1], c[2]);

    if (!this.panelPinEl) {
      this.panelPinEl = document.createElement('div');
      this.panelPinEl.className = 'panel-pin-wrap';
      this.layer.appendChild(this.panelPinEl);
    }

    const subtitle = summary.isMulti
      ? `${summary.count} bidang terpilih · ${fmtId(summary.totalAreaM2, 1)} m²`
      : `${summary.primaryTypeLabel} · ${summary.primaryDirName}`;
    const valueNum = summary.isMulti
      ? fmtId(summary.weightedOttvWm2, 2)
      : fmtId(summary.primary.ottv_panel_wm2, 2);
    const valueTag = summary.isMulti ? 'rata-rata' : 'kontribusi';

    this.panelPinEl.innerHTML = '';

    const dot = document.createElement('span');
    dot.className = 'panel-pin-dot';
    dot.setAttribute('aria-hidden', 'true');

    const card = document.createElement('div');
    card.className = 'glass panel-value-label';
    card.setAttribute('role', 'status');

    const subEl = document.createElement('div');
    subEl.className = 'panel-value-sub';
    subEl.textContent = subtitle;

    const valEl = document.createElement('div');
    valEl.className = 'panel-value-main num';
    const bEl = document.createElement('b');
    bEl.textContent = `${valueNum} W/m²`;
    const tagEl = document.createElement('span');
    tagEl.className = 'panel-value-tag';
    tagEl.textContent = ` ${valueTag}`;
    valEl.append(bEl, tagEl);

    card.append(subEl, valEl);
    this.panelPinEl.append(dot, card);
  }

  /**
   * Renders numbered markers (1, 2, ...) matching Daftar kejanggalan in 3D space.
   * items: [{ index: number, title: string, centroid: [x, y, z], severity: 'warn'|'error' }]
   */
  setFlagMarkers(items = []) {
    if (!this.layer) return;
    for (const prev of this.flagPins) {
      prev.el.remove();
    }
    this.flagPins = [];

    for (const it of items) {
      if (!it || !Array.isArray(it.centroid)) continue;
      const el = document.createElement('div');
      el.className = `viewer-flag-pin${it.severity === 'error' ? ' is-error' : ''}`;
      el.textContent = String(it.index);
      el.title = it.title || `Kejanggalan ${it.index}`;
      el.setAttribute('aria-label', `Penanda kejanggalan ${it.index}: ${it.title || ''}`);
      this.layer.appendChild(el);
      this.flagPins.push({
        el,
        worldPos: toThreeCoords(it.centroid[0], it.centroid[1], it.centroid[2]),
      });
    }
  }

  update(camera, width, height) {
    if (!this.layer || !camera || width <= 0 || height <= 0) return;

    // 1. Update selected panel glass card pin
    if (this.panelPinEl && this.panelAnchorWorld) {
      this._projVec.copy(this.panelAnchorWorld).project(camera);
      const visible =
        this._projVec.z >= -1 &&
        this._projVec.z <= 1 &&
        this._projVec.x >= -1.15 &&
        this._projVec.x <= 1.15 &&
        this._projVec.y >= -1.15 &&
        this._projVec.y <= 1.15;

      if (visible) {
        const px = (this._projVec.x * 0.5 + 0.5) * width;
        const py = (-this._projVec.y * 0.5 + 0.5) * height;
        // Flip card to left if near right edge of viewer
        const flipLeft = px > width - 235;
        this.panelPinEl.classList.toggle('is-left', flipLeft);
        this.panelPinEl.style.display = 'block';
        this.panelPinEl.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      } else {
        this.panelPinEl.style.display = 'none';
      }
    }

    // 2. Update numbered anomaly pins
    for (const pin of this.flagPins) {
      this._projVec.copy(pin.worldPos).project(camera);
      const visible =
        this._projVec.z >= -1 &&
        this._projVec.z <= 1 &&
        this._projVec.x >= -1.05 &&
        this._projVec.x <= 1.05 &&
        this._projVec.y >= -1.05 &&
        this._projVec.y <= 1.05;
      if (visible) {
        const px = (this._projVec.x * 0.5 + 0.5) * width;
        const py = (-this._projVec.y * 0.5 + 0.5) * height;
        pin.el.style.display = 'grid';
        pin.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
      } else {
        pin.el.style.display = 'none';
      }
    }
  }
}
