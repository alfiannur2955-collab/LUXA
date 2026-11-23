/**
 * LUXA 3D Viewer (Fase 4a + 4b-1 + 4b-2):
 * - CameraRig (4 projections: Persp, 2 titik, Akso, Tampak + 8 directions + Atas + inset framing)
 * - Live AxisGizmo (X/Y/Z bottom-right)
 * - 5 viewer modes: Klasifikasi, Orientasi, Heatmap (per arah / per panel), Kejanggalan, X-ray
 * - Solar exposure coloring (`facadeFilter === 'sunlit_now'`: sunlit=heat-1, shaded=data-wall)
 * - Per-panel O(1) raycast picking + highlight + projected HTML glass label (`labels.js`)
 * - Sun dome slot (`sunDome`) updated by `sundome.js`
 * - Offscreen high-res render hook for Capture PNG (1x / 2x / 4x)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AxisGizmo } from './axes.js';
import { CameraRig, toThreeCoords, azimuthToThreeHorizontal } from './cameras.js';
import { computeSolarPosition } from './sundome.js';
import { ViewerLabelsOverlay } from './labels.js';
import {
  azimuthToPastelThreeColor,
  exposureToThreeColor,
  horizontalNeutralColor,
  makeAnomalyMaterial,
  makeClassificationMaterial,
  makeColorAccurateMaterial,
  makeVertexColorMaterial,
  makeXrayMaterial,
  normalToAzimuthDeg,
  normalToOrientationCode,
  orientationToThreeColor,
  ottvToPastelThreeColor,
  ottvToThreeColor,
  readThemeTokens,
  resolveViewerMode,
  EXPOSURE_SCALE,
  resolveExposureScale,
} from './modes.js';
import { populateSelectionHighlightGroup, summarizeSelectedPanels } from './selection.js';

const CREASE_COS_30_DEG = Math.cos((30 * Math.PI) / 180);

function _vKey1mm(pt) {
  return `${Math.round(Number(pt[0]) * 1000)},${Math.round(Number(pt[1]) * 1000)},${Math.round(Number(pt[2]) * 1000)}`;
}

function _smoothClass(p) {
  return p.element_type === 'glazing' || p.element_type === 'composite_cw' ? 'g' : 'o';
}

/**
 * Review 4d: area-weighted average of the panels sharing a welded vertex, limited to
 * the same element class and to faces within 30° of `faceNormal`. Returns null when
 * nothing qualifies so the caller falls back to the panel's own colour.
 */
function _smoothValueFor(list, faceNormal, cls) {
  if (!Array.isArray(list) || !list.length) return null;
  let sv = 0;
  let sa = 0;
  for (const e of list) {
    if (e.cls !== cls) continue;
    const dot = e.n[0] * faceNormal[0] + e.n[1] * faceNormal[1] + e.n[2] * faceNormal[2];
    if (dot < CREASE_COS_30_DEG) continue;
    sv += e.v * e.a;
    sa += e.a;
  }
  return sa > 1e-9 ? sv / sa : null;
}

function _fmtWm2(v) {
  return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
}

/** Mengisi legenda Halus (dibuat di steps/results.js) dengan rentang nilai model. */
function _updateSmoothLegend(range) {
  if (typeof document === 'undefined' || !range) return;
  for (const el of document.querySelectorAll('[data-luxa-smooth-legend]')) {
    el.innerHTML = smoothLegendTicksHtml(range);
  }
}

export function smoothLegendTicksHtml(range) {
  const lo = range ? Math.round(range.min) : EXPOSURE_SCALE.min;
  const hi = range ? Math.round(range.max) : EXPOSURE_SCALE.max;
  const mode = range?.mode || 'sni';
  // Jenis skala ditampilkan di tombol "Skala: ..." di sebelahnya.
  return `<span>${lo}</span><span class="is-limit">W/m²</span><span>${hi}${mode === 'sni' ? '+' : ''}</span>`;
}

function _computeFaceNormalBackend(v0, v1, v2) {
  const ax = Number(v1[0]) - Number(v0[0]);
  const ay = Number(v1[1]) - Number(v0[1]);
  const az = Number(v1[2]) - Number(v0[2]);
  const bx = Number(v2[0]) - Number(v0[0]);
  const by = Number(v2[1]) - Number(v0[1]);
  const bz = Number(v2[2]) - Number(v0[2]);
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/**
 * Computes smooth vertex normal at a 1mm-welded position by averaging adjacent faces
 * whose dihedral angle against `faceNormal` is < 30° (keeps sharp corners sharp).
 */
function _resolveSmoothNormalBackend(key, faceNormal, normalsByKey) {
  const list = normalsByKey?.get(key);
  if (!list || list.length <= 1) return faceNormal;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const entry of list) {
    const dot =
      entry.n[0] * faceNormal[0] +
      entry.n[1] * faceNormal[1] +
      entry.n[2] * faceNormal[2];
    if (dot >= CREASE_COS_30_DEG) {
      sx += entry.n[0] * entry.w;
      sy += entry.n[1] * entry.w;
      sz += entry.n[2] * entry.w;
    }
  }
  const len = Math.hypot(sx, sy, sz);
  if (len < 1e-6) return faceNormal;
  return [sx / len, sy / len, sz / len];
}

function _coordsArr(x, y, z) {
  const v = toThreeCoords(x, y, z);
  return [v.x, v.y, v.z];
}

function _normalToThreeArr(n) {
  // Backend (E, N, U) -> Three.js (x=E, y=U, z=-N)
  return [n[0], n[2], -n[1]];
}

function _computeFlaggedGroupSet(inspectData) {
  const flagged = new Set();
  const flags = inspectData?.sanity_flags || [];
  for (const f of flags) {
    if (f.severity !== 'warn' && f.severity !== 'error') continue;
    if (f.group_name) flagged.add(f.group_name);
    if (Array.isArray(f.meta?.groups)) {
      for (const g of f.meta.groups) flagged.add(g);
    }
  }
  return flagged;
}

function _collectAnomalyMarkers(state) {
  const flags = state.inspectData?.sanity_flags || [];
  const meshes = state.inspectData?.preview_meshes || [];
  const bbox = state.analysisData?.summary?.bounding_box || state.inspectData?.bounding_box || null;
  const centerByGroup = new Map();

  for (const pm of meshes) {
    if (!pm.vertices?.length) continue;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const v of pm.vertices) {
      sx += Number(v[0] || 0);
      sy += Number(v[1] || 0);
      sz += Number(v[2] || 0);
    }
    const n = pm.vertices.length;
    centerByGroup.set(pm.group_name, [sx / n, sy / n, sz / n]);
  }

  const markers = [];
  let warnIndex = 0;
  for (const flag of flags) {
    if (flag.severity !== 'warn' && flag.severity !== 'error') continue;
    warnIndex += 1;
    let centroid = null;
    if (flag.group_name && centerByGroup.has(flag.group_name)) {
      centroid = centerByGroup.get(flag.group_name);
    } else if (bbox?.center) {
      const spanZ = Number(bbox.span?.[2] || 10);
      centroid = [
        Number(bbox.center[0] || 0),
        Number(bbox.center[1] || 0),
        Number(bbox.center[2] || 0) + spanZ * 0.25 + (warnIndex - 1) * 1.4,
      ];
    }
    if (centroid) {
      markers.push({
        index: warnIndex,
        title: flag.title,
        severity: flag.severity,
        centroid,
      });
    }
  }
  return markers;
}

class LuxaViewer {
  constructor() {
    this.container = null;
    this.overlayHost = null;
    this.renderer = null;
    this.scene = null;
    this.rig = new CameraRig();
    this.gizmo = new AxisGizmo();
    this.labelsOverlay = new ViewerLabelsOverlay();
    this.sunDomeController = null;
    this.northRingController = null;
    this.interactionLocked = false;
    this.controls = null;
    this.modelRoot = null;
    this.compareAltRoot = null;
    this.compareSplitRatio = null; // sisa API lama (tirai geser); tidak dipakai lagi oleh layar Bandingkan
    this.compareVersus = false; // Bandingkan: dua panel berdampingan, kamera yang sama, gedung utuh di tiap panel
    this._syncingCompare = false;
    this.lastCompareAltKey = null;
    this.selectionGroup = null;
    this.groundGroup = null;
    this.sunDomeGroup = null;
    this.northRingGroup = null;
    this.resizeObserver = null;
    this.rafId = null;
    this.lastModelKey = null;
    this.lastRenderKey = null;
    this.onPickGroup = null;
    this.onPickPanel = null;
    this.onCameraDirectionSettled = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerDownPos = null;
    this.lastWidth = 800;
    this.lastHeight = 600;
  }

  _initThree() {
    if (this.renderer) return;

    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.rig.getActiveCamera(), this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 1600;
    this.controls.minDistance = 2;
    // Pengguna mulai memutar sendiri → hentikan putaran otomatis dari kompas.
    this.controls.addEventListener('start', () => {
      if (this.rig) this.rig.spin = null;
    });
    this.controls.addEventListener('end', () => {
      if (typeof this.onCameraDirectionSettled === 'function') {
        const liveDir = this.rig.getLiveDirection(this.controls);
        if (liveDir) this.onCameraDirectionSettled(liveDir);
      }
    });

    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.88);
    hemi.position.set(0, 100, 0);
    this.scene.add(hemi);

    const dir1 = new THREE.DirectionalLight(0xffffff, 0.82);
    dir1.position.set(45, 70, 50);
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xffffff, 0.34);
    dir2.position.set(-40, 30, -45);
    this.scene.add(dir2);

    this.groundGroup = new THREE.Group();
    this.modelRoot = new THREE.Group();
    this.compareAltRoot = new THREE.Group();
    this.compareAltRoot.visible = false;
    this.selectionGroup = new THREE.Group();
    this.sunDomeGroup = new THREE.Group();
    this.northRingGroup = new THREE.Group();
    this.scene.add(this.groundGroup);
    this.scene.add(this.modelRoot);
    this.scene.add(this.compareAltRoot);
    this.scene.add(this.selectionGroup);
    this.scene.add(this.sunDomeGroup);
    this.scene.add(this.northRingGroup);

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!this.pointerDownPos) return;
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > 5) return;
      this._handleClick(e);
    });

    const tick = (now) => {
      this.rafId = window.requestAnimationFrame(tick);
      if (this.paused) return; // dijeda selama Mode Presentasi (lapisan lain yang menggambar)
      if (this.container && this.container.isConnected) {
        this.rig.tick(now);
        this.controls.update();
        const cam = this.rig.getActiveCamera();
        if (this.compareVersus && this.compareAltRoot) {
          this._renderVersus(cam, Math.max(1, this.lastWidth), Math.max(1, this.lastHeight));
        } else {
          this.renderer.setScissorTest(false);
          if (this.modelRoot) this.modelRoot.visible = true;
          if (this.compareAltRoot) this.compareAltRoot.visible = false;
          this.renderer.render(this.scene, cam);
        }
        this.gizmo.update(cam);
        this._updateCompassDials(cam);
        // label milik model utama: pada mode versus ikut panel kiri
        this.labelsOverlay.update(cam, this.compareVersus ? Math.floor(this.lastWidth / 2) : this.lastWidth, this.lastHeight);
        if (this.sunDomeController && typeof this.sunDomeController.updateLabels === 'function') {
          this.sunDomeController.updateLabels(cam, this.lastWidth, this.lastHeight);
        }
        if (this.northRingController && typeof this.northRingController.updateOverlay === 'function') {
          this.northRingController.updateOverlay(cam, this.lastWidth, this.lastHeight);
        }
      }
    };
    tick(performance.now());
  }

  attachSunDomeController(ctrl) {
    this._initThree();
    this.sunDomeController = ctrl;
    if (ctrl && typeof ctrl.attachGroup === 'function') {
      ctrl.attachGroup(this.sunDomeGroup);
    }
  }

  attachNorthRingController(ctrl) {
    this._initThree();
    this.northRingController = ctrl;
    if (ctrl && typeof ctrl.attachGroup === 'function') {
      ctrl.attachGroup(this.northRingGroup);
    }
  }

  setInteractionLocked(locked) {
    this.interactionLocked = Boolean(locked);
    if (this.controls) {
      this.controls.enabled = !this.interactionLocked;
    }
  }

  _handleClick(event) {
    if (this.interactionLocked) return;
    if (this.northRingController?.active) {
      if (this.northRingController.isPointOutsideRing(event.clientX, event.clientY)) {
        this.northRingController.onExitMode?.();
      }
      return;
    }
    if (!this.container || !this.modelRoot) return;
    if (!this.onPickPanel && !this.onPickGroup) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.rig.getActiveCamera());
    const hits = this.raycaster.intersectObjects(this.modelRoot.children, true);
    if (hits.length > 0) {
      const hit = hits[0];
      const meta = hit.object?.userData || {};
      if (this.onPickPanel && Array.isArray(meta.triToPanel) && typeof hit.faceIndex === 'number') {
        const panelObj = meta.triToPanel[hit.faceIndex] || null;
        if (panelObj) {
          this.onPickPanel(panelObj, event);
          return;
        }
      }
      if (this.onPickPanel && !this.onPickGroup) {
        this.onPickPanel(null, event);
        return;
      }
      if (this.onPickGroup) {
        this.onPickGroup(meta, event);
      }
    } else {
      if (this.onPickPanel) this.onPickPanel(null, event);
      if (this.onPickGroup) this.onPickGroup(null, event);
    }
  }

  mount(containerEl, { onPickGroup = null, onPickPanel = null, overlayHost = null, showGizmo = true } = {}) {
    this._initThree();
    this.onPickGroup = onPickGroup;
    this.onPickPanel = onPickPanel;
    this.overlayHost = overlayHost || containerEl.parentElement;

    if (this.container !== containerEl) {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
      this.container = containerEl;
      containerEl.innerHTML = '';
      containerEl.appendChild(this.renderer.domElement);
      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(containerEl);
      this._resize();
    }

    if (this.overlayHost) {
      this.labelsOverlay.mount(this.overlayHost);
      if (this.sunDomeController && typeof this.sunDomeController.mountOverlay === 'function') {
        this.sunDomeController.mountOverlay(this.overlayHost);
      }
      if (this.northRingController && typeof this.northRingController.mountOverlay === 'function') {
        this.northRingController.mountOverlay(this.overlayHost);
      }
      if (showGizmo) {
        this.gizmo.mount(this.overlayHost);
      }
    }
  }

  _resize() {
    if (!this.container || !this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.lastWidth = w;
    this.lastHeight = h;
    this.rig.resize(this.compareVersus ? Math.max(1, Math.floor(w / 2)) : w, h);
    this.renderer.setSize(w, h, false);
  }

  /** Dua panel sama lebar: kiri desain sekarang, kanan alternatif, dengan kamera dan skala yang sama. */
  _renderVersus(cam, w, h) {
    const hw = Math.max(1, Math.floor(w / 2));
    this.renderer.setScissorTest(true);
    this.renderer.autoClear = true;
    this.renderer.setViewport(0, 0, hw, h);
    this.renderer.setScissor(0, 0, hw, h);
    this.modelRoot.visible = true;
    this.compareAltRoot.visible = false;
    this.renderer.render(this.scene, cam);
    this.renderer.setViewport(hw, 0, w - hw, h);
    this.renderer.setScissor(hw, 0, w - hw, h);
    this.modelRoot.visible = false;
    this.compareAltRoot.visible = true;
    this.renderer.render(this.scene, cam);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    this.modelRoot.visible = true;
    this.compareAltRoot.visible = false;
  }

  // Camera APIs used by shortcuts, bottom pills, pie menu, and Tampilan panel
  setProjection(projection, opts = {}) {
    this._initThree();
    this.rig.setProjection(projection, this.controls, opts);
  }

  getLiveDirection() {
    this._initThree();
    return this.rig.getLiveDirection(this.controls);
  }

  setOnCameraDirectionSettled(cb) {
    this.onCameraDirectionSettled = cb || null;
  }

  setRightInsetPx(px) {
    this._initThree();
    this.rig.setRightInsetPx(px);
  }

  /**
   * Sudut utara di layar (derajat, searah jarum jam dari atas) untuk kamera aktif.
   * Dihitung dari arah hadap kamera, bukan dari proyeksi titik, supaya tidak miring
   * karena perspektif atau pergeseran pusat pandang.
   */
  screenNorthDeg(cam = null) {
    if (!this.rig) return 0;
    const camera = cam || this.rig.getActiveCamera();
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const right = new THREE.Vector3(e[0], 0, e[2]);
    // "Atas layar" di bidang tanah = komponen datar dari (atas kamera + arah hadap).
    const upGround = new THREE.Vector3(e[4] - e[8], 0, e[6] - e[10]);
    if (upGround.lengthSq() < 1e-10 || right.lengthSq() < 1e-10) return this._compassDeg || 0;
    const n = azimuthToThreeHorizontal(0, this.rig.northAngleDeg);
    return (Math.atan2(n.dot(right.normalize()), n.dot(upGround.normalize())) * 180) / Math.PI;
  }

  /** Kompas di sudut viewer ikut berputar mengikuti kamera (tanpa render ulang halaman). */
  _updateCompassDials(cam) {
    const host = this.overlayHost || this.container?.parentElement;
    if (!host) return;
    const deg = this.screenNorthDeg(cam);
    const els = this._compassEls && this._compassEls.length && this._compassEls[0].isConnected
      ? this._compassEls
      : (this._compassEls = [...host.querySelectorAll('.compass-live svg')]);
    if (!els.length) return;
    const fresh = els.some((el) => el.dataset.live !== '1');
    if (!fresh && Math.abs(deg - (this._compassDeg ?? 1e9)) < 0.25) return;
    this._compassDeg = deg;
    const r = Math.round(deg * 10) / 10;
    for (const el of els) {
      el.dataset.live = '1';
      el.style.transform = `rotate(${r}deg)`;
    }
  }

  /** Klik kompas: putar pandangan supaya menghadap utara (utara di atas layar). */
  faceNorth() {
    this._initThree();
    this.rig.onSpinDone = () => {
      if (typeof this.onCameraDirectionSettled === 'function') {
        const liveDir = this.rig.getLiveDirection(this.controls);
        if (liveDir) this.onCameraDirectionSettled(liveDir);
      }
    };
    // Habiskan sisa inersia putaran (damping) dulu, supaya tidak menggeser hasil setelah berputar.
    if (this.controls) {
      const damp = this.controls.enableDamping;
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.enableDamping = damp;
    }
    this.rig.faceNorth(this.controls);
  }

  lookAtDirection(direction, opts = {}) {
    this._initThree();
    this.rig.lookAtDirection(direction, this.controls, opts);
  }

  fitModel(bbox = null) {
    this._initThree();
    if (bbox) this.rig.setBBox(bbox);
    this.rig.fitToModel(this.controls);
  }

  exportCameraState() {
    this._initThree();
    return this.rig.exportState(this.controls);
  }

  applyCameraState(camState, opts = {}) {
    this._initThree();
    this.rig.applySavedState(camState, this.controls, opts);
  }

  renderOffscreenSnapshot(scale = 2) {
    this._initThree();
    if (!this.container || !this.renderer) return null;
    const baseW = Math.max(320, this.container.clientWidth || 1280);
    const baseH = Math.max(240, this.container.clientHeight || 720);
    const maxTex = this.renderer.capabilities?.maxTextureSize || 4096;
    const safeMax = Math.min(maxTex, 8192);
    const desiredW = Math.round(baseW * scale);
    const desiredH = Math.round(baseH * scale);
    const clampRatio = Math.min(1, safeMax / Math.max(desiredW, desiredH));
    const targetW = Math.max(1, Math.round(desiredW * clampRatio));
    const targetH = Math.max(1, Math.round(desiredH * clampRatio));

    const prevPixelRatio = this.renderer.getPixelRatio();
    const cam = this.rig.getActiveCamera();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(targetW, targetH, false);
    this.rig.resize(this.compareVersus ? Math.max(1, Math.floor(targetW / 2)) : targetW, targetH);
    if (this.compareVersus && this.compareAltRoot) {
      this._renderVersus(cam, targetW, targetH);
    } else if (this.compareSplitRatio !== null && this.compareAltRoot) {
      // Bandingkan: kiri = desain sekarang, kanan = alternatif (sama seperti layar).
      const splitX = Math.max(1, Math.min(targetW - 1, Math.round(targetW * this.compareSplitRatio)));
      this.renderer.setScissorTest(true);
      this.renderer.setViewport(0, 0, targetW, targetH);
      this.renderer.setScissor(0, 0, splitX, targetH);
      this.modelRoot.visible = true;
      this.compareAltRoot.visible = false;
      this.renderer.render(this.scene, cam);
      this.renderer.setScissor(splitX, 0, targetW - splitX, targetH);
      this.modelRoot.visible = false;
      this.compareAltRoot.visible = true;
      this.renderer.render(this.scene, cam);
      this.renderer.setScissorTest(false);
      this.modelRoot.visible = true;
      this.compareAltRoot.visible = false;
    } else {
      this.renderer.render(this.scene, cam);
    }

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = targetW;
    snapshotCanvas.height = targetH;
    const ctx = snapshotCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(this.renderer.domElement, 0, 0, targetW, targetH);
    }

    this.renderer.setPixelRatio(prevPixelRatio);
    this.renderer.setSize(baseW, baseH, false);
    this._resize();

    return { canvas: snapshotCanvas, width: targetW, height: targetH, baseWidth: baseW, baseHeight: baseH };
  }

  _clearGroup(group) {
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
  }

  _buildGroundPlane(bbox, zCutoffM, tokens) {
    this._clearGroup(this.groundGroup);
    if (!bbox) return;
    const span = bbox.span || [20, 20, 10];
    const center = bbox.center || [0, 0, 0];
    const size = Math.max(span[0] || 10, span[1] || 10, 12) * 1.9;
    const grid = new THREE.GridHelper(
      size,
      16,
      new THREE.Color(tokens.muted),
      new THREE.Color(tokens.line),
    );
    grid.position.set(center[0] || 0, Number(zCutoffM) || 0, -(center[1] || 0));
    if (Array.isArray(grid.material)) {
      grid.material.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.45;
      });
    } else if (grid.material) {
      grid.material.transparent = true;
      grid.material.opacity = 0.45;
    }
    this.groundGroup.add(grid);
  }

  /**
   * Resolves the set of sunlit panel IDs for the active `sunHour` & `sunDate`.
   */
  _getSunlitPanelIdSet(state, hourOverride = null) {
    if (state.facadeFilter !== 'sunlit_now' || !state.analysisData?.panels?.length) {
      return null;
    }
    const hour = hourOverride !== null ? hourOverride : Math.round(Number(state.sunHour ?? 13));
    const exp = state.exposureData;
    if (exp && exp.analysis_id === state.analysisData.analysis_id && exp.sunlit_by_hour) {
      const list = exp.sunlit_by_hour[String(hour)];
      if (Array.isArray(list)) {
        return new Set(list);
      }
    }
    // Fallback to built-in design-month `panels[].sunlit_mask` (bits 0..8 -> hours 8..16)
    const bitIdx = hour - 8;
    const set = new Set();
    if (bitIdx >= 0 && bitIdx <= 8) {
      for (const p of state.analysisData.panels) {
        if (p.active && ((Number(p.sunlit_mask || 0) >> bitIdx) & 1) === 1) {
          set.add(p.id);
        }
      }
    }
    return set;
  }

  setCompareSplitRatio(ratio) {
    if (ratio === null || ratio === undefined) {
      this.compareSplitRatio = null;
      return;
    }
    this.compareSplitRatio = Math.max(0.08, Math.min(0.92, Number(ratio) || 0.5));
  }

  /** Hidupkan/matikan panel berdampingan. Ukuran kamera mengikuti lebar satu panel. */
  setCompareVersus(on) {
    const next = Boolean(on);
    if (next === this.compareVersus) return false;
    this.compareVersus = next;
    this._resize();
    return true;
  }

  clearCompareMode() {
    this.compareSplitRatio = null;
    this.setCompareVersus(false);
    this.lastCompareAltKey = null;
    if (this.compareAltRoot) {
      this._clearGroup(this.compareAltRoot);
      this.compareAltRoot.visible = false;
      this.compareAltRoot.position.set(0, 0, 0);
    }
  }

  /**
   * Synchronizes the split-viewer Compare screen: left = active analysis, right = alternative analysis.
   */
  syncCompareState(state, altAnalysis, splitRatio = 0.5) {
    this._initThree();
    const tokens = readThemeTokens();
    const baseState = {
      ...state,
      step: 'results',
      viewerMode: 'heatmap',
      facadeFilter: 'all',
      sunDomeVisible: false,
      selectedPanelIds: [],
      selectedOrientation: null,
    };
    this._syncingCompare = true;
    try {
      this.syncState(baseState);
    } finally {
      this._syncingCompare = false;
    }
    void splitRatio;
    if (!altAnalysis?.panels?.length) {
      this.clearCompareMode();
      return;
    }
    const turnedOn = this.setCompareVersus(true);

    // Model lain bisa punya koordinat berbeda: geser alternatif supaya titik tengah denah dan
    // muka tanahnya berimpit dengan model utama, lalu bingkai kamera memakai gabungan keduanya.
    const bMain = state.analysisData?.summary?.bounding_box;
    const bAlt = altAnalysis.summary?.bounding_box;
    let off = [0, 0, 0];
    if (bMain?.center && bAlt?.center && bMain?.min && bAlt?.min) {
      off = [bMain.center[0] - bAlt.center[0], bMain.center[1] - bAlt.center[1], bMain.min[2] - bAlt.min[2]];
      const o3 = toThreeCoords(off[0], off[1], off[2]);
      this.compareAltRoot.position.set(o3.x, o3.y, o3.z);
      const min = [0, 1, 2].map((i) => Math.min(bMain.min[i], bAlt.min[i] + off[i]));
      const max = [0, 1, 2].map((i) => Math.max(bMain.max[i], bAlt.max[i] + off[i]));
      const span = [0, 1, 2].map((i) => max[i] - min[i]);
      this.rig.setBBox({
        ...bMain,
        min,
        max,
        span,
        center: [0, 1, 2].map((i) => (min[i] + max[i]) / 2),
        max_span: Math.max(...span),
      });
    } else {
      this.compareAltRoot.position.set(0, 0, 0);
    }

    const altKey = `${altAnalysis.analysis_id || 'alt'}|${state.theme}|${state.heatmapGranularity || 'orientation'}|${off.join(',')}`;
    // bingkai ulang saat panel baru dibuka atau alternatif lain dipilih: kedua gedung utuh dalam panelnya
    if (turnedOn || altKey !== this.lastCompareAltKey) this.rig.fitToModel(this.controls);
    if (altKey === this.lastCompareAltKey) return;
    this.lastCompareAltKey = altKey;

    this._clearGroup(this.compareAltRoot);
    const prevRoot = this.modelRoot;
    this.modelRoot = this.compareAltRoot;
    try {
      this._renderAnalysisPanels(
        {
          ...baseState,
          analysisData: altAnalysis,
        },
        'heatmap',
        tokens,
      );
    } finally {
      this.modelRoot = prevRoot;
    }
  }

  /**
   * Synchronizes 3D scene, selection highlight, projected HTML labels, and sun dome.
   */
  syncState(state) {
    this._initThree();
    if (state.step !== 'compare' && !this._syncingCompare) {
      this.compareSplitRatio = null;
      this.setCompareVersus(false);
    }
    const tokens = readThemeTokens();
    const hasAnalysis = Boolean(state.analysisData?.panels?.length);
    const view = resolveViewerMode(state);
    const mode = view.renderMode;
    const bbox = state.analysisData?.summary?.bounding_box || state.inspectData?.bounding_box || null;
    const zCut = Number(state.config?.model?.z_ground_cutoff_m || 0);
    const northDeg = Number(state.config?.settings?.north_angle_deg || 0);

    this.rig.setBBox(bbox);
    this.rig.setNorthAngle(northDeg);

    // Update Sun Dome & North Rotation Ring independently (fast, no mesh rebuild needed!)
    if (this.sunDomeController && typeof this.sunDomeController.sync === 'function') {
      this.sunDomeController.sync(state, bbox, tokens);
    }
    if (this.northRingController && typeof this.northRingController.sync === 'function') {
      this.northRingController.sync(state, bbox, tokens);
    }

    // Update panel selection highlight & HTML glass label
    const selSummary = hasAnalysis
      ? summarizeSelectedPanels(state.analysisData, state.selectedPanelIds)
      : null;
    populateSelectionHighlightGroup(
      this.selectionGroup,
      selSummary ? selSummary.panels : [],
      tokens,
    );
    this.labelsOverlay.setPanelLabel(state.step === 'results' ? selSummary : null);

    // Update numbered anomaly markers on Inspeksi or Kejanggalan mode
    if (view.check || state.step === 'inspect') {
      this.labelsOverlay.setFlagMarkers(_collectAnomalyMarkers(state));
    } else {
      this.labelsOverlay.setFlagMarkers([]);
    }

    const expKey =
      state.facadeFilter === 'sunlit_now'
        ? `${state.sunDate}|${state.sunHour}|${state.exposureData?.date || ''}|${state.exposureData?.north_angle_deg ?? ''}`
        : 'none';

    const modelKey = `${state.modelId || 'none'}|${bbox?.max_span || 0}`;
    const renderKey = JSON.stringify({
      modelKey,
      step: state.step,
      theme: state.theme,
      mode,
      xray: view.xray,
      check: view.check,
      heatmapGranularity: state.heatmapGranularity || 'orientation',
      exposureShading: state.exposureShading !== false,
      exposureScale: mode === 'exposure' ? JSON.stringify(state.config?.settings?.exposure_scale || null) : null,
      facadeFilter: state.facadeFilter || 'all',
      expKey,
      hasAnalysis,
      selectedGroup: state.selectedGroup || null,
      selectedOrientation: state.selectedOrientation || null,
      isolatedOrientation: state.isolatedOrientation || null,
      zCut,
      northDeg: mode === 'orientation' ? northDeg : 0,
      overrides: state.config?.roles?.group_category_overrides || {},
      disabled: state.config?.roles?.disabled_groups || [],
      inspectGroupsLen: state.inspectData?.preview_meshes?.length || 0,
      analysisId: state.analysisData?.analysis_id || null,
    });

    if (renderKey === this.lastRenderKey) {
      return;
    }
    this.lastRenderKey = renderKey;

    this._clearGroup(this.modelRoot);
    this._buildGroundPlane(bbox, zCut, tokens);

    const rs = { ...state, overlayXray: view.xray, overlayCheck: view.check };
    if (hasAnalysis && state.step === 'results') {
      this._renderAnalysisPanels(rs, mode, tokens);
    } else if (state.inspectData?.preview_meshes?.length) {
      this._renderPreviewMeshes(rs, mode, tokens);
    } else if (hasAnalysis) {
      this._renderAnalysisPanels(rs, mode, tokens);
    }

    if (bbox && modelKey !== this.lastModelKey) {
      this.rig.setProjection(state.cameraProjection || 'perspective', this.controls, { animate: false });
      this.lastModelKey = modelKey;
    }
  }

  _addEdgeLines(geom, tokens, { opacity = 0.42 } = {}) {
    try {
      const edges = new THREE.EdgesGeometry(geom, 18);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(tokens.lineStrong || tokens.muted),
        transparent: true,
        opacity,
      });
      const lines = new THREE.LineSegments(edges, lineMat);
      lines.raycast = () => {};
      this.modelRoot.add(lines);
    } catch {
      // Ignore degenerate geometries
    }
  }

  _addDashedExcludedWireframe(coords, tokens) {
    if (!coords.length) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    const mat = new THREE.LineDashedMaterial({
      color: new THREE.Color(tokens.warn),
      dashSize: 0.45,
      gapSize: 0.25,
      transparent: true,
      opacity: 0.85,
    });
    const lines = new THREE.LineSegments(geom, mat);
    lines.computeLineDistances();
    lines.raycast = () => {};
    this.modelRoot.add(lines);
  }

  _renderPreviewMeshes(state, mode, tokens) {
    const meshes = state.inspectData?.preview_meshes || [];
    const overrides = state.config?.roles?.group_category_overrides || {};
    const disabled = new Set(state.config?.roles?.disabled_groups || []);
    const selectedGroup = state.selectedGroup;
    const flaggedGroups = _computeFlaggedGroupSet(state.inspectData);
    const northDeg = Number(state.config?.settings?.north_angle_deg || 0);
    const xray = Boolean(state.overlayXray);
    const check = Boolean(state.overlayCheck);
    const anyFlagged = check && meshes.some((m) => flaggedGroups.has(m.group_name) || (overrides[m.group_name] || m.category) === 'unknown');
    // Transparan di atas mode apa pun: buat material tembus pandang.
    const seeThrough = (mesh) => {
      if (!xray || !mesh.material) return;
      mesh.material.transparent = true;
      mesh.material.opacity = Math.min(mesh.material.opacity ?? 1, 0.28);
      mesh.material.depthWrite = false;
    };

    for (const pm of meshes) {
      if (!pm.vertices?.length || !pm.tris?.length) continue;
      const gName = pm.group_name;
      const cat = overrides[gName] || pm.category || 'wall';
      const isDisabled = disabled.has(gName);
      if (isDisabled && !xray) continue;
      const isFlagged = check && (flaggedGroups.has(gName) || cat === 'unknown');

      if (mode === 'orientation') {
        // D3: Smooth per-vertex cyclic pastel azimuth with 1mm welding & <30° crease threshold
        const normalsByKey = new Map();
        const triNormals = [];
        for (const t of pm.tris) {
          const v0 = pm.vertices[t[0]];
          const v1 = pm.vertices[t[1]];
          const v2 = pm.vertices[t[2]];
          if (!v0 || !v1 || !v2) {
            triNormals.push(null);
            continue;
          }
          const fn = _computeFaceNormalBackend(v0, v1, v2);
          triNormals.push(fn);
          for (const pt of [v0, v1, v2]) {
            const k = _vKey1mm(pt);
            const arr = normalsByKey.get(k);
            if (arr) arr.push({ n: fn, w: 1 });
            else normalsByKey.set(k, [{ n: fn, w: 1 }]);
          }
        }
        const coords = [];
        const norms = [];
        const colors = [];
        const cHoriz = horizontalNeutralColor(tokens);
        for (let ti = 0; ti < pm.tris.length; ti += 1) {
          const fn = triNormals[ti];
          if (!fn) continue;
          const t = pm.tris[ti];
          const pts = [pm.vertices[t[0]], pm.vertices[t[1]], pm.vertices[t[2]]];
          for (const pt of pts) {
            const sn = _resolveSmoothNormalBackend(_vKey1mm(pt), fn, normalsByKey);
            const isHoriz = cat === 'roof' || Math.abs(sn[2]) > 0.7 || Math.hypot(sn[0], sn[1]) < 1e-4;
            const c = isHoriz
              ? cHoriz
              : azimuthToPastelThreeColor(normalToAzimuthDeg(sn[0], sn[1], northDeg), tokens);
            coords.push(..._coordsArr(pt[0], pt[1], pt[2]));
            norms.push(..._normalToThreeArr(sn));
            colors.push(c.r, c.g, c.b);
          }
        }
        if (!coords.length) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        if (isDisabled) {
          const edgeGeo = new THREE.EdgesGeometry(geom, 18);
          this._addDashedExcludedWireframe(Array.from(edgeGeo.attributes.position.array), tokens);
          edgeGeo.dispose();
          geom.dispose();
          continue;
        }
        const mesh = new THREE.Mesh(geom, isFlagged ? makeAnomalyMaterial(true, tokens) : makeColorAccurateMaterial());
        mesh.userData = { groupName: gName, category: cat };
        if (anyFlagged && !isFlagged) { mesh.material.transparent = true; mesh.material.opacity = 0.35; }
        seeThrough(mesh);
        this.modelRoot.add(mesh);
        this._addEdgeLines(geom, tokens, { opacity: isFlagged ? 0.55 : 0.30 });
        continue;
      }

      const positions = new Float32Array(pm.vertices.length * 3);
      for (let i = 0; i < pm.vertices.length; i += 1) {
        const v = pm.vertices[i];
        const [tx, ty, tz] = _coordsArr(v[0], v[1], v[2]);
        positions[i * 3] = tx;
        positions[i * 3 + 1] = ty;
        positions[i * 3 + 2] = tz;
      }
      const indices = new Uint32Array(pm.tris.length * 3);
      for (let i = 0; i < pm.tris.length; i += 1) {
        const t = pm.tris[i];
        indices[i * 3] = t[0];
        indices[i * 3 + 1] = t[1];
        indices[i * 3 + 2] = t[2];
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setIndex(new THREE.BufferAttribute(indices, 1));
      geom.computeVertexNormals();

      if (xray) {
        if (isDisabled || cat === 'ignore') {
          const edgeGeo = new THREE.EdgesGeometry(geom, 18);
          this._addDashedExcludedWireframe(Array.from(edgeGeo.attributes.position.array), tokens);
          edgeGeo.dispose();
          geom.dispose();
          continue;
        }
        const mesh = new THREE.Mesh(geom, isFlagged ? makeAnomalyMaterial(true, tokens) : makeXrayMaterial(cat, tokens));
        if (isFlagged) seeThrough(mesh);
        mesh.userData = { groupName: gName, category: cat };
        this.modelRoot.add(mesh);
        this._addEdgeLines(geom, tokens, { opacity: 0.30 });
        continue;
      }

      if (check && anyFlagged) {
        const mesh = new THREE.Mesh(geom, makeAnomalyMaterial(isFlagged, tokens));
        mesh.userData = { groupName: gName, category: cat };
        this.modelRoot.add(mesh);
        this._addEdgeLines(geom, tokens, { opacity: isFlagged ? 0.55 : 0.14 });
        continue;
      }

      const highlighted = Boolean(selectedGroup && selectedGroup === gName);
      const dimmed = Boolean(selectedGroup && selectedGroup !== gName);
      const mat = makeClassificationMaterial(cat, tokens, { highlighted, dimmed });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { groupName: gName, category: cat };
      this.modelRoot.add(mesh);
      this._addEdgeLines(geom, tokens, { opacity: dimmed ? 0.14 : 0.45 });
    }
  }

  /**
   * Unified high-performance renderer for analyzed panels supporting all 5 modes,
   * heatmap per-arah / per-panel, exposure filter (`sunlit_now`), and O(1) panel picking.
   */
  _renderAnalysisPanels(state, mode, tokens) {
    const analysis = state.analysisData;
    const panels = analysis?.panels || [];
    const orientOttv = {};
    for (const row of analysis.orientation_breakdown || []) {
      orientOttv[row.code] = Number(row.ottv_orientation_wm2 || 0);
    }

    const granularity = state.heatmapGranularity || 'orientation';
    // Halus: nilai OTTV dihitung per titik dari azimut normal halus. SF diinterpolasi linear di antara
    // 8 arah (Tabel 8), mode Arah menginterpolasi OTTV arah, mode Panel memakai suku panel sendiri.
    const ORDER = ['U', 'TL', 'T', 'TGR', 'S', 'BD', 'B', 'BL'];
    const breakdownByCode = {};
    for (const row of analysis.orientation_breakdown || []) breakdownByCode[row.code === 'TG' ? 'TGR' : row.code] = row;
    const sfRing = ORDER.map((c) => {
      const v = Number(breakdownByCode[c]?.sni_sf_wm2);
      return Number.isFinite(v) ? v : null;
    });
    const ottvRing = ORDER.map((c) => {
      const r = breakdownByCode[c];
      return r && Number(r.total_area_m2) > 1e-6 ? Number(r.ottv_orientation_wm2 || 0) : null;
    });
    const ringAt = (ring, az) => {
      const f = ((((az % 360) + 360) % 360) / 45);
      const i0 = Math.floor(f) % 8;
      const i1 = (i0 + 1) % 8;
      const t = f - Math.floor(f);
      const a = ring[i0];
      const b = ring[i1];
      if (a === null && b === null) return null;
      if (a === null) return b;
      if (b === null) return a;
      return a + (b - a) * t;
    };
    const orientKey = (c) => (c === 'TG' ? 'TGR' : c);
    // Halus = paparan matahari di satu titik (W/m², tampilan saja; hasil hitung tidak berubah):
    // SF Tabel 8 diinterpolasi menurut azimut normal halus. Mode Panel juga mengalikan faktor
    // peneduh 3D panel itu (SCef/SC). Bidang datar menghadap atas memakai SF atap.
    const sfRoof = Number(analysis.rttv?.sf_roof_wm2 ?? analysis.sf_source_info?.sf_table?.ROOF ?? NaN);
    const smoothValueAt = (p, sn) => {
      const shade = exposureShading ? Math.max(0, Number(p.sc_shading_multiplier ?? 1)) : 1;
      if (Math.abs(sn[2]) > 0.7 || Math.hypot(sn[0], sn[1]) < 1e-4) {
        if (sn[2] > 0.7 && Number.isFinite(sfRoof)) return sfRoof * shade;
        return sn[2] < -0.7 ? 0 : null;
      }
      const sf = ringAt(sfRing, normalToAzimuthDeg(sn[0], sn[1], northDeg));
      return sf === null ? null : sf * shade;
    };
    const useSmooth = mode === 'exposure' && (state.facadeFilter || 'all') !== 'sunlit_now';
    const exposureShading = state.exposureShading !== false;
    const useOrientSmooth = mode === 'orientation' && (state.facadeFilter || 'all') !== 'sunlit_now';
    const needSmoothNormals = useSmooth || useOrientSmooth;
    const facadeFilter = state.facadeFilter || 'all';
    const selOrient = state.isolatedOrientation || null;
    const xray = Boolean(state.overlayXray);
    const check = Boolean(state.overlayCheck);
    const northDeg = Number(state.config?.settings?.north_angle_deg || 0);
    const analysisNorthDeg = Number(analysis?.summary?.north_angle_deg || 0);
    const northDelta = northDeg - analysisNorthDeg;
    const sunlitSet = this._getSunlitPanelIdSet(state);
    // Arah matahari jam aktif (koordinat model: E, N, atas) untuk gradasi sudut datang.
    let sunVec = null;
    // Jam pecahan (animasi mulus): warna fasad dibaurkan antara jam bawah dan jam atas.
    let sunBlend = null;
    if (sunlitSet) {
      const lat = Number(analysis?.location_info?.latitude_deg ?? -6.2088);
      const hRaw = Number(state.sunHour ?? 13);
      const sunAt = (h) => {
        const sp = computeSolarPosition(lat, state.sunDate || '2026-09-23', h, northDeg);
        return sp?.threeDir ? [sp.threeDir.x, -sp.threeDir.z, sp.threeDir.y] : null;
      };
      sunVec = sunAt(hRaw);
      const h0 = Math.floor(hRaw);
      const f = hRaw - h0;
      if (f > 0.001 && f < 0.999) {
        const set0 = this._getSunlitPanelIdSet(state, h0);
        const set1 = this._getSunlitPanelIdSet(state, h0 + 1);
        const v0 = sunAt(h0);
        const v1 = sunAt(h0 + 1);
        if (set0 && set1 && v0 && v1) sunBlend = { set0, set1, v0, v1, f };
      }
    }
    const flaggedGroups = _computeFlaggedGroupSet(state.inspectData);
    const checkFlagged = check && panels.some((p) => p.active && (flaggedGroups.has(p.group_name) || p.element_type === 'unknown'));

    // D3: Precompute 1mm-welded area-weighted OTTV averages & <30° smooth vertex normals
    const smoothVertexVal = useSmooth ? new Map() : null;
    const normalsByKey = needSmoothNormals ? new Map() : null;

    if (useSmooth || needSmoothNormals) {
      const accum = useSmooth ? new Map() : null;
      for (const p of panels) {
        if (!p.active || !Array.isArray(p.vertices) || p.vertices.length < 3) continue;
        let pCode = p.orientation_code || 'U';
        if (Math.abs(northDelta) > 0.05 && Array.isArray(p.normal)) {
          pCode = normalToOrientationCode(p.normal[0], p.normal[1], northDeg);
        }
        const val = granularity === 'panel' ? Number(p.ottv_panel_wm2 || 0) : (orientOttv[orientKey(pCode)] ?? 0);
        const area = Math.max(0.01, Number(p.area_m2 || 1));
        const fn =
          Array.isArray(p.normal) && p.normal.length >= 3
            ? (() => {
                const l = Math.hypot(p.normal[0], p.normal[1], p.normal[2]) || 1;
                return [p.normal[0] / l, p.normal[1] / l, p.normal[2] / l];
              })()
            : _computeFaceNormalBackend(p.vertices[0], p.vertices[1], p.vertices[2]);

        for (const pt of p.vertices) {
          const k = _vKey1mm(pt);
          if (accum) {
            // Review 4d: keep per-panel entries so smoothing only blends panels of the
            // same element class (glazing vs opaque) on nearly coplanar faces (< 30°).
            const entry = { v: val, a: area, n: fn, cls: _smoothClass(p) };
            const list = accum.get(k);
            if (list) list.push(entry);
            else accum.set(k, [entry]);
          }
          if (normalsByKey) {
            const list = normalsByKey.get(k);
            if (list) list.push({ n: fn, w: area });
            else normalsByKey.set(k, [{ n: fn, w: area }]);
          }
        }
      }
      if (accum && smoothVertexVal) {
        for (const [k, list] of accum.entries()) smoothVertexVal.set(k, list);
      }
    }

    // Halus memakai skala relatif model (Rendah -> Tinggi): cari rentang nilai titik dulu.
    let smoothMin = Infinity;
    let smoothMax = -Infinity;
    if (useSmooth) {
      for (const p of panels) {
        if (!p.active || !Array.isArray(p.vertices) || p.vertices.length < 3) continue;
        const fnp = Array.isArray(p.normal) && p.normal.length >= 3
          ? (() => {
              const l = Math.hypot(p.normal[0], p.normal[1], p.normal[2]) || 1;
              return [p.normal[0] / l, p.normal[1] / l, p.normal[2] / l];
            })()
          : _computeFaceNormalBackend(p.vertices[0], p.vertices[1], p.vertices[2]);
        for (const pt of p.vertices) {
          const v = smoothValueAt(p, _resolveSmoothNormalBackend(_vKey1mm(pt), fnp, normalsByKey));
          if (v === null || !Number.isFinite(v)) continue;
          if (v < smoothMin) smoothMin = v;
          if (v > smoothMax) smoothMax = v;
        }
      }
      if (!Number.isFinite(smoothMin)) {
        smoothMin = 0;
        smoothMax = 60;
      }
      if (smoothMax - smoothMin < 0.5) {
        const mid = (smoothMax + smoothMin) / 2;
        smoothMin = mid - 0.25;
        smoothMax = mid + 0.25;
      }
      // Skala warna: Tetap SNI (80–250 W/m², bawaan), Otomatis (rentang model), atau Kustom.
      const sc = resolveExposureScale(state.config?.settings?.exposure_scale, { min: smoothMin, max: smoothMax });
      this.lastSmoothRange = { min: sc.min, max: sc.max, mode: sc.mode, dataMin: smoothMin, dataMax: smoothMax };
      _updateSmoothLegend(this.lastSmoothRange);
    } else {
      this.lastSmoothRange = null;
    }
    const scaleLo = this.lastSmoothRange ? this.lastSmoothRange.min : EXPOSURE_SCALE.min;
    const scaleHi = this.lastSmoothRange ? this.lastSmoothRange.max : EXPOSURE_SCALE.max;
    const relColor = (v) => exposureToThreeColor((v - scaleLo) / (scaleHi - scaleLo), tokens);

    const cHeat1 = new THREE.Color(tokens.heat1);
    const cWall = new THREE.Color(tokens.wall);
    const cGlz = new THREE.Color(tokens.glazing);
    const cWarn = new THREE.Color(tokens.warn);
    const cHoriz = horizontalNeutralColor(tokens);

    // Split active panels into opaque/focused vs dimmed so transparent dimmed panels render cleanly
    const mainCoords = [];
    const mainNormals = [];
    const mainColors = [];
    const mainTriToPanel = [];

    const dimCoords = [];
    const dimNormals = [];
    const dimColors = [];
    const dimTriToPanel = [];

    const panelGridCoords = [];
    const excludedLineCoords = [];

    for (const p of panels) {
      if (!Array.isArray(p.vertices) || p.vertices.length < 3) continue;

      if (!p.active) {
        if (xray) {
          const pts = p.vertices.map((v) => _coordsArr(v[0], v[1], v[2]));
          for (let i = 0; i < pts.length; i += 1) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            excludedLineCoords.push(...a, ...b);
          }
        }
        continue;
      }

      // Compute effective orientation code (live-rotated when north angle changes)
      let code = p.orientation_code || 'U';
      if (Math.abs(northDelta) > 0.05 && Array.isArray(p.normal)) {
        code = normalToOrientationCode(p.normal[0], p.normal[1], northDeg);
      }

      const fn =
        Array.isArray(p.normal) && p.normal.length >= 3
          ? (() => {
              const l = Math.hypot(p.normal[0], p.normal[1], p.normal[2]) || 1;
              return [p.normal[0] / l, p.normal[1] / l, p.normal[2] / l];
            })()
          : _computeFaceNormalBackend(p.vertices[0], p.vertices[1], p.vertices[2]);

      let color = cWall;
      let isDimmed = false;

      if (facadeFilter === 'sunlit_now' && sunlitSet && sunBlend) {
        const litColor = (set, v) => {
          if (!set.has(p.id)) return cWall;
          const cosI = Math.max(0, fn[0] * v[0] + fn[1] * v[1] + fn[2] * v[2]);
          return ottvToThreeColor(10 + 45 * cosI, tokens);
        };
        color = litColor(sunBlend.set0, sunBlend.v0).clone().lerp(litColor(sunBlend.set1, sunBlend.v1), sunBlend.f);
      } else if (facadeFilter === 'sunlit_now' && sunlitSet) {
        const isSunlit = sunlitSet.has(p.id);
        if (isSunlit && sunVec) {
          // Makin tegak lurus ke matahari makin pekat (cos sudut datang 0..1 -> skala panas pucat..pekat).
          const cosI = Math.max(0, fn[0] * sunVec[0] + fn[1] * sunVec[1] + fn[2] * sunVec[2]);
          color = ottvToThreeColor(10 + 45 * cosI, tokens);
        } else {
          color = isSunlit ? cHeat1 : cWall;
        }
      } else if (mode === 'exposure') {
        color = exposureToThreeColor(0.5, tokens);
      } else if (mode === 'heatmap') {
        const val = granularity === 'panel' ? Number(p.ottv_panel_wm2 || 0) : (orientOttv[orientKey(code)] ?? 0);
        color = ottvToThreeColor(val, tokens);
      } else if (mode === 'orientation') {
        color = Math.abs(fn[2]) > 0.7 ? cHoriz : orientationToThreeColor(code, tokens);
      } else {
        color = p.element_type === 'glazing' || p.element_type === 'composite_cw' ? cGlz : cWall;
      }

      // Isolasi arah (klik baris "Per arah"): arah lain diredupkan di mode apa pun.
      if (selOrient && code !== selOrient && facadeFilter !== 'sunlit_now') {
        isDimmed = true;
      }
      if (check && checkFlagged) {
        const isFlagged = flaggedGroups.has(p.group_name) || p.element_type === 'unknown';
        if (isFlagged) color = cWarn;
        else isDimmed = true;
      }
      if (xray) isDimmed = true;

      const vs = p.vertices;
      const p0 = _coordsArr(vs[0][0], vs[0][1], vs[0][2]);
      const p1 = _coordsArr(vs[1][0], vs[1][1], vs[1][2]);
      const p2 = _coordsArr(vs[2][0], vs[2][1], vs[2][2]);

      const nForVert = (pt) =>
        needSmoothNormals ? _resolveSmoothNormalBackend(_vKey1mm(pt), fn, normalsByKey) : fn;

      const cForVert = (pt, sn) => {
        if (useSmooth) {
          const v = smoothValueAt(p, sn);
          return v !== null && Number.isFinite(v) ? relColor(v) : color;
        }
        if (useOrientSmooth) {
          if (Math.abs(sn[2]) > 0.7 || Math.hypot(sn[0], sn[1]) < 1e-4) return cHoriz;
          return azimuthToPastelThreeColor(normalToAzimuthDeg(sn[0], sn[1], northDeg), tokens);
        }
        return color;
      };

      const n0 = nForVert(vs[0]);
      const n1 = nForVert(vs[1]);
      const n2 = nForVert(vs[2]);
      const c0 = cForVert(vs[0], n0);
      const c1 = cForVert(vs[1], n1);
      const c2 = cForVert(vs[2], n2);

      const dstCoords = isDimmed ? dimCoords : mainCoords;
      const dstNormals = isDimmed ? dimNormals : mainNormals;
      const dstColors = isDimmed ? dimColors : mainColors;
      const dstMap = isDimmed ? dimTriToPanel : mainTriToPanel;

      dstCoords.push(...p0, ...p1, ...p2);
      dstNormals.push(..._normalToThreeArr(n0), ..._normalToThreeArr(n1), ..._normalToThreeArr(n2));
      dstColors.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
      dstMap.push(p);

      if (vs.length >= 4) {
        const p3 = _coordsArr(vs[3][0], vs[3][1], vs[3][2]);
        const n3 = nForVert(vs[3]);
        const c3 = cForVert(vs[3], n3);
        dstCoords.push(...p0, ...p2, ...p3);
        dstNormals.push(..._normalToThreeArr(n0), ..._normalToThreeArr(n2), ..._normalToThreeArr(n3));
        dstColors.push(c0.r, c0.g, c0.b, c2.r, c2.g, c2.b, c3.r, c3.g, c3.b);
        dstMap.push(p);
      }

      // D3: Thin panel grid lines (opacity 0.28–0.32) overlaid on Halus & Orientasi like ref-heatmap-halus.png
      if (!isDimmed && (useSmooth || useOrientSmooth)) {
        const pts3 = vs.map((v) => _coordsArr(v[0], v[1], v[2]));
        for (let i = 0; i < pts3.length; i += 1) {
          const a = pts3[i];
          const b = pts3[(i + 1) % pts3.length];
          panelGridCoords.push(...a, ...b);
        }
      }
    }

    const useColorAccurate =
      mode === 'heatmap' || mode === 'exposure' || mode === 'orientation' || facadeFilter === 'sunlit_now';
    const makePanelMat = useColorAccurate ? makeColorAccurateMaterial : makeVertexColorMaterial;

    if (mainCoords.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(mainCoords, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(mainColors, 3));
      if (needSmoothNormals) {
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(mainNormals, 3));
      } else {
        geom.computeVertexNormals();
      }
      const mesh = new THREE.Mesh(geom, makePanelMat({ transparent: false, opacity: 1.0 }));
      mesh.userData = { triToPanel: mainTriToPanel };
      this.modelRoot.add(mesh);
      if (panelGridCoords.length > 0) {
        const gridGeo = new THREE.BufferGeometry();
        gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(panelGridCoords, 3));
        const gridMat = new THREE.LineBasicMaterial({
          color: new THREE.Color(tokens.ink),
          transparent: true,
          opacity: 0.30,
        });
        const gridLines = new THREE.LineSegments(gridGeo, gridMat);
        gridLines.raycast = () => {};
        this.modelRoot.add(gridLines);
      } else {
        this._addEdgeLines(geom, tokens, { opacity: 0.48 });
      }
    }

    if (dimCoords.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(dimCoords, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(dimColors, 3));
      if (needSmoothNormals) {
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(dimNormals, 3));
      } else {
        geom.computeVertexNormals();
      }
      const mesh = new THREE.Mesh(
        geom,
        makePanelMat({
          transparent: true,
          opacity: xray ? 0.22 : 0.20,
          depthWrite: !xray,
        }),
      );
      mesh.userData = { triToPanel: dimTriToPanel };
      this.modelRoot.add(mesh);
      this._addEdgeLines(geom, tokens, { opacity: xray ? 0.30 : 0.16 });
    }

    if (xray && excludedLineCoords.length > 0) {
      this._addDashedExcludedWireframe(excludedLineCoords, tokens);
    }

    const ctxDim = xray || (check && checkFlagged) || Boolean(selOrient) || facadeFilter === 'sunlit_now';
    this._renderContextElements(analysis.shading_elements, 'shading', tokens, ctxDim, xray);
    this._renderContextElements(analysis.frame_elements, 'frame', tokens, ctxDim || mode === 'heatmap' || mode === 'exposure', xray);
    this._renderContextElements(
      analysis.roof_elements,
      'roof',
      tokens,
      mode !== 'orientation',
      xray,
      mode === 'orientation',
    );
  }

  _renderContextElements(elements, category, tokens, dimmed, xray = false, orientNeutral = false) {
    for (const el of elements || []) {
      if (!el?.vertices?.length || !el?.faces?.length) continue;
      const coords = [];
      for (const f of el.faces) {
        const v0 = el.vertices[f[0]];
        const v1 = el.vertices[f[1]];
        const v2 = el.vertices[f[2]];
        if (!v0 || !v1 || !v2) continue;
        coords.push(
          ..._coordsArr(v0[0], v0[1], v0[2]),
          ..._coordsArr(v1[0], v1[1], v1[2]),
          ..._coordsArr(v2[0], v2[1], v2[2]),
        );
        if (f.length >= 4 && f[3] !== f[2] && el.vertices[f[3]]) {
          const v3 = el.vertices[f[3]];
          coords.push(
            ..._coordsArr(v0[0], v0[1], v0[2]),
            ..._coordsArr(v2[0], v2[1], v2[2]),
            ..._coordsArr(v3[0], v3[1], v3[2]),
          );
        }
      }
      if (!coords.length) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      geom.computeVertexNormals();
      let mat;
      if (orientNeutral && category === 'roof') {
        const cNeu = horizontalNeutralColor(tokens);
        const colArr = new Float32Array(coords.length);
        for (let i = 0; i < coords.length; i += 3) {
          colArr[i] = cNeu.r;
          colArr[i + 1] = cNeu.g;
          colArr[i + 2] = cNeu.b;
        }
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
        mat = makeColorAccurateMaterial({ transparent: false, opacity: 1.0 });
      } else {
        mat = xray ? makeXrayMaterial(category, tokens) : makeClassificationMaterial(category, tokens, { dimmed });
      }
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { groupName: el.group_name, category };
      this.modelRoot.add(mesh);
      this._addEdgeLines(geom, tokens, { opacity: dimmed ? 0.14 : 0.34 });
    }
  }
}

export const viewer = new LuxaViewer();
