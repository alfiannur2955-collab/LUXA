/**
 * LUXA D5-Style Floor North Rotation Ring (`docs/RENCANA.md` Fase 4d D2):
 * - Activated via bottom pill / Tampilan panel icon or shortcut `R`.
 * - Draws horizontal floor ring around the building (`radius = 1.15 × half plan diagonal`)
 *   with degree ticks, north pointer line, and one draggable D5 handle.
 * - Drag handle changes `north_angle_deg` in 1° steps (Shift = 15° steps).
 * - Floating angle label follows handle; clicking label opens inline numeric input (0–359.9):
 *   Enter applies, Esc cancels.
 * - Model geometry never rotates; north compass, sun dome, and orientation labels rotate.
 * - Triggers `onCommitNorth` on handle release (shows `"Hitung ulang"` chip, never auto-recomputes).
 * - Exits on `Esc`, clicking outside ring, or pressing `R` again.
 */

import * as THREE from 'three';
import { parseDecimalInput } from '../state.js';
import { fmtId } from '../ui/escapeHtml.js';
import { toThreeCoords } from './cameras.js';

function normalizeAngle(deg) {
  const n = Number(deg) || 0;
  const mod = ((n % 360) + 360) % 360;
  return Math.round(mod * 10) / 10;
}

export class NorthRingController {
  constructor() {
    this.group = null;
    this.overlayHost = null;
    this.layerEl = null;
    this.handleBtn = null;
    this.labelWrap = null;
    this.labelBtn = null;
    this.inputEl = null;

    this.active = false;
    this.editing = false;
    this.dragging = false;
    this.centerThree = new THREE.Vector3();
    this.ringRadius = 15;
    this.currentDeg = 0;
    this.lastSig = '';

    this.lastCamera = null;
    this.lastWidth = 800;
    this.lastHeight = 600;
    this._projVec = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hitPt = new THREE.Vector3();

    this.onDragStateChange = null;
    this.onPreviewNorth = null;
    this.onCommitNorth = null;
    this.onExitMode = null;
  }

  attachGroup(group) {
    this.group = group;
  }

  setCallbacks({ onDragStateChange = null, onPreviewNorth = null, onCommitNorth = null, onExitMode = null } = {}) {
    this.onDragStateChange = onDragStateChange;
    this.onPreviewNorth = onPreviewNorth;
    this.onCommitNorth = onCommitNorth;
    this.onExitMode = onExitMode;
  }

  mountOverlay(overlayHost) {
    if (!overlayHost) return;
    if (this.overlayHost === overlayHost && this.layerEl && this.layerEl.isConnected) return;
    this.overlayHost = overlayHost;

    if (!this.layerEl) {
      this.layerEl = document.createElement('div');
      this.layerEl.className = 'd5-handles-layer d5-north-layer';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'd5-handle d5-north-handle';
      btn.setAttribute('aria-label', 'Tarik pegangan untuk memutar arah utara (tahan Shift untuk langkah 15 derajat)');
      btn.title = 'Tarik untuk memutar utara (1° · tahan Shift = 15°)';
      btn.textContent = 'U';
      btn.style.display = 'none';

      const lblWrap = document.createElement('div');
      lblWrap.className = 'd5-north-label-wrap';
      lblWrap.style.display = 'none';

      const lblBtn = document.createElement('button');
      lblBtn.type = 'button';
      lblBtn.className = 'glass d5-angle-label num';
      lblBtn.title = 'Klik untuk mengetik sudut utara (0–359,9°)';
      lblBtn.textContent = 'Utara 0°';

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.className = 'glass d5-angle-input num';
      inp.setAttribute('aria-label', 'Ketik sudut arah utara 0 sampai 359,9 derajat');
      inp.style.display = 'none';

      lblBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openInlineInput();
      });

      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = parseDecimalInput(inp.value);
          if (Number.isFinite(v) && v >= 0 && v < 360) {
            const norm = normalizeAngle(v);
            this.currentDeg = norm;
            this._closeInlineInput();
            this.onCommitNorth?.(norm);
          } else {
            this._closeInlineInput();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this._closeInlineInput();
        }
      });

      inp.addEventListener('blur', () => {
        if (this.editing) this._closeInlineInput();
      });

      this._bindHandleEvents(btn);
      lblWrap.append(lblBtn, inp);
      this.handleBtn = btn;
      this.labelWrap = lblWrap;
      this.labelBtn = lblBtn;
      this.inputEl = inp;
      this.layerEl.append(btn, lblWrap);
    }
    overlayHost.appendChild(this.layerEl);
  }

  _openInlineInput() {
    if (!this.inputEl || !this.labelBtn) return;
    this.editing = true;
    this.labelBtn.style.display = 'none';
    this.inputEl.style.display = 'block';
    this.inputEl.value = fmtId(this.currentDeg, this.currentDeg % 1 ? 1 : 0);
    window.requestAnimationFrame(() => {
      this.inputEl?.focus();
      this.inputEl?.select();
    });
  }

  _closeInlineInput() {
    this.editing = false;
    if (this.inputEl) this.inputEl.style.display = 'none';
    if (this.labelBtn) this.labelBtn.style.display = 'inline-flex';
  }

  _angleFromPointer(clientX, clientY, shiftKey) {
    if (!this.lastCamera || !this.overlayHost) return null;
    const rect = this.overlayHost.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(ndc, this.lastCamera);
    this._plane.constant = -(this.centerThree.y + 0.08);
    const hit = this._raycaster.ray.intersectPlane(this._plane, this._hitPt);
    if (!hit) return null;
    const dx = hit.x - this.centerThree.x;
    const dz = hit.z - this.centerThree.z;
    if (Math.hypot(dx, dz) < 0.05) return null;
    // 0° = -Z (North), 90° = +X (East), clockwise from above
    let deg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    const step = shiftKey ? 15 : 1;
    deg = Math.round(deg / step) * step;
    return normalizeAngle(deg);
  }

  /**
   * Returns true if a canvas pointer click landed outside the floor rotation ring
   * (so clicking outside the ring exits rotation mode cleanly per D2).
   */
  isPointOutsideRing(clientX, clientY) {
    if (!this.active || !this.lastCamera || !this.overlayHost) return false;
    const rect = this.overlayHost.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(ndc, this.lastCamera);
    this._plane.constant = -(this.centerThree.y + 0.08);
    const hit = this._raycaster.ray.intersectPlane(this._plane, this._hitPt);
    if (!hit) return true;
    const dist = Math.hypot(hit.x - this.centerThree.x, hit.z - this.centerThree.z);
    return dist > this.ringRadius * 1.18;
  }

  _bindHandleEvents(btn) {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.active) return;
      e.preventDefault();
      e.stopPropagation();
      this.dragging = true;
      btn.classList.add('is-dragging');
      document.body.classList.add('is-d5-rotating');
      this.onDragStateChange?.(true);
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    });

    btn.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const nextDeg = this._angleFromPointer(e.clientX, e.clientY, e.shiftKey);
      if (nextDeg !== null && Math.abs(nextDeg - this.currentDeg) >= 0.1) {
        this.currentDeg = nextDeg;
        this._updateLabelText();
        this.onPreviewNorth?.(nextDeg);
      }
    });

    const finishDrag = (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const committed = this.currentDeg;
      this.dragging = false;
      btn.classList.remove('is-dragging');
      document.body.classList.remove('is-d5-rotating');
      this.onDragStateChange?.(false);
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      this.onCommitNorth?.(committed);
    };

    btn.addEventListener('pointerup', finishDrag);
    btn.addEventListener('pointercancel', finishDrag);
  }

  _updateLabelText() {
    if (!this.labelBtn) return;
    const txt = Math.abs(this.currentDeg - Math.round(this.currentDeg)) < 0.05
      ? `Utara ${Math.round(this.currentDeg)}°`
      : `Utara ${fmtId(this.currentDeg, 1)}°`;
    this.labelBtn.textContent = txt;
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
    if (this.handleBtn) this.handleBtn.style.display = 'none';
    if (this.labelWrap) this.labelWrap.style.display = 'none';
    if (this.editing) this._closeInlineInput();
  }

  sync(state, bbox, tokens) {
    if (!this.group) return;
    const isActive = Boolean(state.northRotateMode && bbox && state.step !== 'compare');
    this.active = isActive;
    if (!isActive) {
      if (this.lastSig !== 'hidden') {
        this._clear();
        this.lastSig = 'hidden';
      }
      return;
    }

    const spanX = Math.max(2, Number(bbox.span?.[0] || 15));
    const spanY = Math.max(2, Number(bbox.span?.[1] || 15));
    const halfPlanDiag = 0.5 * Math.hypot(spanX, spanY);
    const radius = Math.max(4, 1.15 * halfPlanDiag);
    this.ringRadius = radius;

    const zCut = Number(state.config?.model?.z_ground_cutoff_m ?? 0);
    const cx = Number(bbox.center?.[0] || 0);
    const cy = Number(bbox.center?.[1] || 0);
    const baseZ = Math.max(Number(bbox.min?.[2] ?? 0), zCut);
    const center = toThreeCoords(cx, cy, baseZ);
    this.centerThree.copy(center);

    const northDeg = normalizeAngle(state.config?.settings?.north_angle_deg ?? 0);
    this.currentDeg = northDeg;
    this._updateLabelText();

    const sig = JSON.stringify({
      cx,
      cy,
      baseZ,
      radius: Math.round(radius * 100) / 100,
      northDeg,
      theme: state.theme,
    });
    if (sig === this.lastSig) return;
    this.lastSig = sig;

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

    const colSun = new THREE.Color(tokens.sun);
    const colInk = new THREE.Color(tokens.ink);
    const yRing = center.y + 0.08;

    // 1. Main rotation ring
    const pts = [];
    const segs = 96;
    for (let i = 0; i <= segs; i += 1) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(center.x + radius * Math.cos(a), yRing, center.z + radius * Math.sin(a)));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const ringMat = new THREE.LineBasicMaterial({ color: colSun, transparent: true, opacity: 0.9 });
    const ringLine = new THREE.Line(ringGeo, ringMat);
    ringLine.raycast = () => {};
    this.group.add(ringLine);

    // 2. Degree ticks every 15° (major at 90°)
    const tickCoords = [];
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = ((deg + northDeg) * Math.PI) / 180;
      const dx = Math.sin(rad);
      const dz = -Math.cos(rad);
      const isMajor = deg % 90 === 0;
      const rIn = radius * (isMajor ? 0.92 : 0.96);
      const rOut = radius * (isMajor ? 1.06 : 1.02);
      tickCoords.push(
        center.x + dx * rIn,
        yRing,
        center.z + dz * rIn,
        center.x + dx * rOut,
        yRing,
        center.z + dz * rOut,
      );
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickCoords, 3));
    const tickMat = new THREE.LineBasicMaterial({ color: colInk, transparent: true, opacity: 0.52 });
    const tickLines = new THREE.LineSegments(tickGeo, tickMat);
    tickLines.raycast = () => {};
    this.group.add(tickLines);

    // 3. North pointer dashed line from center to handle
    const nRad = (northDeg * Math.PI) / 180;
    const nPos = new THREE.Vector3(
      center.x + Math.sin(nRad) * radius,
      yRing,
      center.z - Math.cos(nRad) * radius,
    );
    const ptrGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(center.x, yRing, center.z),
      nPos,
    ]);
    const ptrMat = new THREE.LineDashedMaterial({
      color: colSun,
      dashSize: Math.max(0.35, radius * 0.04),
      gapSize: Math.max(0.25, radius * 0.03),
      transparent: true,
      opacity: 0.85,
    });
    const ptrLine = new THREE.Line(ptrGeo, ptrMat);
    ptrLine.computeLineDistances();
    ptrLine.raycast = () => {};
    this.group.add(ptrLine);
  }

  updateOverlay(camera, width, height) {
    this.lastCamera = camera;
    this.lastWidth = width;
    this.lastHeight = height;
    if (!this.handleBtn || !this.labelWrap || !camera || width <= 0 || height <= 0) return;
    if (!this.active) {
      this.handleBtn.style.display = 'none';
      this.labelWrap.style.display = 'none';
      return;
    }

    const nRad = (this.currentDeg * Math.PI) / 180;
    const hx = this.centerThree.x + Math.sin(nRad) * this.ringRadius;
    const hz = this.centerThree.z - Math.cos(nRad) * this.ringRadius;
    this._projVec.set(hx, this.centerThree.y + 0.08, hz).project(camera);

    const vis = this._projVec.z >= -1 && this._projVec.z <= 1;
    if (vis) {
      const px = Math.max(24, Math.min(width - 24, (this._projVec.x * 0.5 + 0.5) * width));
      const py = Math.max(24, Math.min(height - 24, (-this._projVec.y * 0.5 + 0.5) * height));
      this.handleBtn.style.display = 'grid';
      this.handleBtn.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
      this.labelWrap.style.display = 'block';
      this.labelWrap.style.transform = `translate3d(${px.toFixed(1)}px, ${(py - 26).toFixed(1)}px, 0) translate(-50%, -100%)`;
    } else {
      this.handleBtn.style.display = 'none';
      this.labelWrap.style.display = 'none';
    }
  }
}
