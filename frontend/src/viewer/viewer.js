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
import { CameraRig, toThreeCoords } from './cameras.js';
import { ViewerLabelsOverlay } from './labels.js';
import {
  makeAnomalyMaterial,
  makeClassificationMaterial,
  makeColorAccurateMaterial,
  makeVertexColorMaterial,
  makeXrayMaterial,
  normalToOrientationCode,
  orientationToThreeColor,
  ottvToThreeColor,
  readThemeTokens,
} from './modes.js';
import { populateSelectionHighlightGroup, summarizeSelectedPanels } from './selection.js';

function _coordsArr(x, y, z) {
  const v = toThreeCoords(x, y, z);
  return [v.x, v.y, v.z];
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
    this.compareSplitRatio = null; // null = normal; 0.1..0.9 = scissor split compare
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
      if (this.container && this.container.isConnected) {
        this.rig.tick(now);
        this.controls.update();
        const cam = this.rig.getActiveCamera();
        if (this.compareSplitRatio !== null && this.compareAltRoot) {
          const w = Math.max(1, this.lastWidth);
          const h = Math.max(1, this.lastHeight);
          const splitX = Math.max(1, Math.min(w - 1, Math.round(w * this.compareSplitRatio)));
          this.renderer.setScissorTest(true);
          this.renderer.autoClear = true;
          this.renderer.setViewport(0, 0, w, h);
          this.renderer.setScissor(0, 0, splitX, h);
          this.modelRoot.visible = true;
          this.compareAltRoot.visible = false;
          this.renderer.render(this.scene, cam);

          this.renderer.setScissor(splitX, 0, w - splitX, h);
          this.modelRoot.visible = false;
          this.compareAltRoot.visible = true;
          this.renderer.render(this.scene, cam);

          this.renderer.setScissorTest(false);
          this.modelRoot.visible = true;
          this.compareAltRoot.visible = false;
        } else {
          this.renderer.setScissorTest(false);
          if (this.modelRoot) this.modelRoot.visible = true;
          if (this.compareAltRoot) this.compareAltRoot.visible = false;
          this.renderer.render(this.scene, cam);
        }
        this.gizmo.update(cam);
        this.labelsOverlay.update(cam, this.lastWidth, this.lastHeight);
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
    this.rig.resize(w, h);
    this.renderer.setSize(w, h, false);
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
    this.rig.resize(targetW, targetH);
    this.renderer.render(this.scene, cam);

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = targetW;
    snapshotCanvas.height = targetH;
    const ctx = snapshotCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(this.renderer.domElement, 0, 0, targetW, targetH);
    }

    this.renderer.setPixelRatio(prevPixelRatio);
    this.rig.resize(baseW, baseH);
    this.renderer.setSize(baseW, baseH, false);
    this.renderer.render(this.scene, cam);

    return { canvas: snapshotCanvas, width: targetW, height: targetH };
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
  _getSunlitPanelIdSet(state) {
    if (state.facadeFilter !== 'sunlit_now' || !state.analysisData?.panels?.length) {
      return null;
    }
    const hour = Math.round(Number(state.sunHour ?? 13));
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

  clearCompareMode() {
    this.compareSplitRatio = null;
    this.lastCompareAltKey = null;
    if (this.compareAltRoot) {
      this._clearGroup(this.compareAltRoot);
      this.compareAltRoot.visible = false;
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
    this.syncState(baseState);
    if (!altAnalysis?.panels?.length) {
      this.clearCompareMode();
      return;
    }
    this.setCompareSplitRatio(splitRatio);
    const altKey = `${altAnalysis.analysis_id || 'alt'}|${state.theme}|${state.heatmapGranularity || 'orientation'}|${Boolean(state.heatmapSmooth)}`;
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
    if (state.step !== 'compare') {
      this.compareSplitRatio = null;
    }
    const tokens = readThemeTokens();
    const hasAnalysis = Boolean(state.analysisData?.panels?.length);
    const mode = state.viewerMode || (hasAnalysis ? 'heatmap' : 'classification');
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
    if (mode === 'anomalies' || state.step === 'inspect') {
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
      heatmapGranularity: state.heatmapGranularity || 'orientation',
      heatmapSmooth: Boolean(state.heatmapSmooth),
      facadeFilter: state.facadeFilter || 'all',
      expKey,
      hasAnalysis,
      selectedGroup: state.selectedGroup || null,
      selectedOrientation: state.selectedOrientation || null,
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

    if (hasAnalysis && state.step === 'results') {
      this._renderAnalysisPanels(state, mode, tokens);
    } else if (state.inspectData?.preview_meshes?.length) {
      this._renderPreviewMeshes(state, mode, tokens);
    } else if (hasAnalysis) {
      this._renderAnalysisPanels(state, mode, tokens);
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

    for (const pm of meshes) {
      if (!pm.vertices?.length || !pm.tris?.length) continue;
      const gName = pm.group_name;
      const cat = overrides[gName] || pm.category || 'wall';
      const isDisabled = disabled.has(gName);
      if (isDisabled && mode !== 'xray') continue;

      if (mode === 'orientation') {
        // Color every triangle by its horizontal normal orientation!
        const coords = [];
        const colors = [];
        for (const t of pm.tris) {
          const v0 = pm.vertices[t[0]];
          const v1 = pm.vertices[t[1]];
          const v2 = pm.vertices[t[2]];
          if (!v0 || !v1 || !v2) continue;
          const ax = v1[0] - v0[0];
          const ay = v1[1] - v0[1];
          const az = v1[2] - v0[2];
          const bx = v2[0] - v0[0];
          const by = v2[1] - v0[1];
          const bz = v2[2] - v0[2];
          const nx = ay * bz - az * by;
          const ny = az * bx - ax * bz;
          const code = Math.hypot(nx, ny) > 1e-5 ? normalToOrientationCode(nx, ny, northDeg) : 'U';
          const c = orientationToThreeColor(code, tokens);
          coords.push(..._coordsArr(v0[0], v0[1], v0[2]), ..._coordsArr(v1[0], v1[1], v1[2]), ..._coordsArr(v2[0], v2[1], v2[2]));
          colors.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
        }
        if (!coords.length) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geom.computeVertexNormals();
        const mesh = new THREE.Mesh(geom, makeColorAccurateMaterial());
        mesh.userData = { groupName: gName, category: cat };
        this.modelRoot.add(mesh);
        this._addEdgeLines(geom, tokens, { opacity: 0.42 });
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

      if (mode === 'xray') {
        if (isDisabled || cat === 'ignore') {
          const edgeGeo = new THREE.EdgesGeometry(geom, 18);
          this._addDashedExcludedWireframe(Array.from(edgeGeo.attributes.position.array), tokens);
          edgeGeo.dispose();
          geom.dispose();
          continue;
        }
        const mesh = new THREE.Mesh(geom, makeXrayMaterial(cat, tokens));
        mesh.userData = { groupName: gName, category: cat };
        this.modelRoot.add(mesh);
        this._addEdgeLines(geom, tokens, { opacity: 0.30 });
        continue;
      }

      if (mode === 'anomalies') {
        const isFlagged = flaggedGroups.has(gName) || cat === 'unknown';
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
    const useSmooth = Boolean(state.heatmapSmooth) && mode === 'heatmap' && (state.facadeFilter || 'all') !== 'sunlit_now';
    const facadeFilter = state.facadeFilter || 'all';
    const selOrient = state.selectedOrientation || null;
    const northDeg = Number(state.config?.settings?.north_angle_deg || 0);
    const analysisNorthDeg = Number(analysis?.summary?.north_angle_deg || 0);
    const northDelta = northDeg - analysisNorthDeg;
    const sunlitSet = this._getSunlitPanelIdSet(state);
    const flaggedGroups = _computeFlaggedGroupSet(state.inspectData);

    // S4: Precompute area-weighted vertex OTTV averages when Halus is enabled
    const vKey = (pt) => `${Math.round(Number(pt[0]) * 200)},${Math.round(Number(pt[1]) * 200)},${Math.round(Number(pt[2]) * 200)}`;
    const smoothVertexVal = useSmooth ? new Map() : null;
    if (useSmooth) {
      const accum = new Map(); // key -> { sumValArea, sumArea }
      for (const p of panels) {
        if (!p.active || !Array.isArray(p.vertices) || p.vertices.length < 3) continue;
        let pCode = p.orientation_code || 'U';
        if (Math.abs(northDelta) > 0.05 && Array.isArray(p.normal)) {
          pCode = normalToOrientationCode(p.normal[0], p.normal[1], northDeg);
        }
        const val = granularity === 'panel' ? Number(p.ottv_panel_wm2 || 0) : (orientOttv[pCode] ?? 0);
        const area = Math.max(0.01, Number(p.area_m2 || 1));
        for (const pt of p.vertices) {
          const k = vKey(pt);
          const cur = accum.get(k);
          if (cur) {
            cur.sumValArea += val * area;
            cur.sumArea += area;
          } else {
            accum.set(k, { sumValArea: val * area, sumArea: area });
          }
        }
      }
      for (const [k, acc] of accum.entries()) {
        smoothVertexVal.set(k, acc.sumValArea / Math.max(1e-6, acc.sumArea));
      }
    }

    const cHeat1 = new THREE.Color(tokens.heat1);
    const cWall = new THREE.Color(tokens.wall);
    const cGlz = new THREE.Color(tokens.glazing);
    const cWarn = new THREE.Color(tokens.warn);

    // Split active panels into opaque/focused vs dimmed so transparent dimmed panels render cleanly
    const mainCoords = [];
    const mainColors = [];
    const mainTriToPanel = [];

    const dimCoords = [];
    const dimColors = [];
    const dimTriToPanel = [];

    const excludedLineCoords = [];

    for (const p of panels) {
      if (!Array.isArray(p.vertices) || p.vertices.length < 3) continue;

      if (!p.active) {
        if (mode === 'xray') {
          const pts = p.vertices.map((v) => _coordsArr(v[0], v[1], v[2]));
          for (let i = 0; i < pts.length; i += 1) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            excludedLineCoords.push(...a, ...b);
          }
        }
        continue;
      }

      // Compute effective orientation code (live-rotated if user dragged compass!)
      let code = p.orientation_code || 'U';
      if (Math.abs(northDelta) > 0.05 && Array.isArray(p.normal)) {
        code = normalToOrientationCode(p.normal[0], p.normal[1], northDeg);
      }

      let color = cWall;
      let isDimmed = false;

      if (facadeFilter === 'sunlit_now' && sunlitSet) {
        const isSunlit = sunlitSet.has(p.id);
        color = isSunlit ? cHeat1 : cWall;
      } else if (mode === 'heatmap') {
        const val = granularity === 'panel' ? Number(p.ottv_panel_wm2 || 0) : (orientOttv[code] ?? 0);
        color = ottvToThreeColor(val, tokens);
      } else if (mode === 'orientation') {
        color = orientationToThreeColor(code, tokens);
      } else if (mode === 'anomalies') {
        const isFlagged = flaggedGroups.has(p.group_name) || p.element_type === 'unknown';
        color = isFlagged ? cWarn : cWall;
        isDimmed = !isFlagged;
      } else if (mode === 'xray') {
        color = p.element_type === 'glazing' || p.element_type === 'composite_cw' ? cGlz : cWall;
        isDimmed = true;
      } else {
        // classification
        color = p.element_type === 'glazing' || p.element_type === 'composite_cw' ? cGlz : cWall;
      }

      if (facadeFilter === 'selected_orientation' && selOrient && code !== selOrient) {
        isDimmed = true;
      } else if (facadeFilter === 'all' && mode === 'heatmap' && selOrient && code !== selOrient) {
        isDimmed = true;
      }

      const vs = p.vertices;
      const p0 = _coordsArr(vs[0][0], vs[0][1], vs[0][2]);
      const p1 = _coordsArr(vs[1][0], vs[1][1], vs[1][2]);
      const p2 = _coordsArr(vs[2][0], vs[2][1], vs[2][2]);

      const cForVert = (pt) => {
        if (!useSmooth) return color;
        const avgV = smoothVertexVal.get(vKey(pt));
        return avgV !== undefined ? ottvToThreeColor(avgV, tokens) : color;
      };
      const c0 = cForVert(vs[0]);
      const c1 = cForVert(vs[1]);
      const c2 = cForVert(vs[2]);

      const dstCoords = isDimmed ? dimCoords : mainCoords;
      const dstColors = isDimmed ? dimColors : mainColors;
      const dstMap = isDimmed ? dimTriToPanel : mainTriToPanel;

      dstCoords.push(...p0, ...p1, ...p2);
      dstColors.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
      dstMap.push(p);

      if (vs.length >= 4) {
        const p3 = _coordsArr(vs[3][0], vs[3][1], vs[3][2]);
        const c3 = cForVert(vs[3]);
        dstCoords.push(...p0, ...p2, ...p3);
        dstColors.push(c0.r, c0.g, c0.b, c2.r, c2.g, c2.b, c3.r, c3.g, c3.b);
        dstMap.push(p);
      }
    }

    const useColorAccurate =
      mode === 'heatmap' || mode === 'orientation' || facadeFilter === 'sunlit_now';
    const makePanelMat = useColorAccurate ? makeColorAccurateMaterial : makeVertexColorMaterial;

    if (mainCoords.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(mainCoords, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(mainColors, 3));
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, makePanelMat({ transparent: false, opacity: 1.0 }));
      mesh.userData = { triToPanel: mainTriToPanel };
      this.modelRoot.add(mesh);
      this._addEdgeLines(geom, tokens, { opacity: 0.48 });
    }

    if (dimCoords.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(dimCoords, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(dimColors, 3));
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geom,
        makePanelMat({
          transparent: true,
          opacity: mode === 'xray' ? 0.22 : 0.20,
          depthWrite: mode !== 'xray',
        }),
      );
      mesh.userData = { triToPanel: dimTriToPanel };
      this.modelRoot.add(mesh);
      this._addEdgeLines(geom, tokens, { opacity: mode === 'xray' ? 0.30 : 0.16 });
    }

    if (mode === 'xray' && excludedLineCoords.length > 0) {
      this._addDashedExcludedWireframe(excludedLineCoords, tokens);
    }

    const ctxDim = mode === 'xray' || mode === 'anomalies' || Boolean(selOrient) || facadeFilter === 'sunlit_now';
    this._renderContextElements(analysis.shading_elements, 'shading', tokens, ctxDim, mode === 'xray');
    this._renderContextElements(analysis.frame_elements, 'frame', tokens, ctxDim || mode === 'heatmap', mode === 'xray');
    this._renderContextElements(analysis.roof_elements, 'roof', tokens, true, mode === 'xray');
  }

  _renderContextElements(elements, category, tokens, dimmed, xray = false) {
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
      const mat = xray ? makeXrayMaterial(category, tokens) : makeClassificationMaterial(category, tokens, { dimmed });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { groupName: el.group_name, category };
      this.modelRoot.add(mesh);
      this._addEdgeLines(geom, tokens, { opacity: dimmed ? 0.14 : 0.34 });
    }
  }
}

export const viewer = new LuxaViewer();
