/**
 * LUXA 3D Viewer (Fase 4a + 4b-1):
 * - Integrates CameraRig (4 projections: Persp, 2 titik, Akso, Tampak + 8 directions + Atas)
 * - Integrates live AxisGizmo (X/Y/Z bottom-right)
 * - Supports Klasifikasi mode and Heatmap per arah mode reading live CSS tokens
 * - Exposes offscreen high-res render hook for Capture PNG (1x / 2x / 4x)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AxisGizmo } from './axes.js';
import { CameraRig, toThreeCoords } from './cameras.js';
import {
  makeClassificationMaterial,
  makeHeatmapMaterial,
  readThemeTokens,
} from './modes.js';

function _coordsArr(x, y, z) {
  const v = toThreeCoords(x, y, z);
  return [v.x, v.y, v.z];
}

class LuxaViewer {
  constructor() {
    this.container = null;
    this.overlayHost = null;
    this.renderer = null;
    this.scene = null;
    this.rig = new CameraRig();
    this.gizmo = new AxisGizmo();
    this.controls = null;
    this.modelRoot = null;
    this.groundGroup = null;
    this.resizeObserver = null;
    this.rafId = null;
    this.lastModelKey = null;
    this.lastRenderKey = null;
    this.onPickGroup = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerDownPos = null;
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

    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.88);
    hemi.position.set(0, 100, 0);
    this.scene.add(hemi);

    const dir1 = new THREE.DirectionalLight(0xffffff, 0.82);
    dir1.position.set(45, 70, 50);
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xffffff, 0.34);
    dir2.position.set(-40, 30, -45);
    this.scene.add(dir2);

    this.modelRoot = new THREE.Group();
    this.groundGroup = new THREE.Group();
    this.scene.add(this.groundGroup);
    this.scene.add(this.modelRoot);

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!this.pointerDownPos || !this.onPickGroup) return;
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
        this.renderer.render(this.scene, cam);
        this.gizmo.update(cam);
      }
    };
    tick(performance.now());
  }

  _handleClick(event) {
    if (!this.container || !this.modelRoot) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.rig.getActiveCamera());
    const hits = this.raycaster.intersectObjects(this.modelRoot.children, true);
    if (hits.length > 0) {
      const hitMeta = hits[0].object?.userData || {};
      this.onPickGroup(hitMeta, event);
    } else {
      this.onPickGroup(null, event);
    }
  }

  mount(containerEl, { onPickGroup, overlayHost = null, showGizmo = true } = {}) {
    this._initThree();
    this.onPickGroup = onPickGroup || null;
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

    if (showGizmo && this.overlayHost) {
      this.gizmo.mount(this.overlayHost);
    }
  }

  _resize() {
    if (!this.container || !this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.rig.resize(w, h);
    this.renderer.setSize(w, h, false);
  }

  // Camera APIs used by shortcuts, bottom pills, pie menu, and Tampilan panel
  setProjection(projection, opts = {}) {
    this._initThree();
    this.rig.setProjection(projection, this.controls, opts);
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

  /**
   * Renders the current scene into a crisp offscreen data URL at `scale` (1, 2, or 4).
   * Restores the live viewport size immediately afterward.
   */
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

    // Copy WebGL canvas before restoring size
    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = targetW;
    snapshotCanvas.height = targetH;
    const ctx = snapshotCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(this.renderer.domElement, 0, 0, targetW, targetH);
    }

    // Restore live viewport
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
   * Synchronizes 3D scene with current state (inspect preview or analyzed panels).
   */
  syncState(state) {
    this._initThree();
    const tokens = readThemeTokens();
    const useHeatmap = state.viewerMode === 'heatmap' && Boolean(state.analysisData);
    const bbox = state.analysisData?.summary?.bounding_box || state.inspectData?.bounding_box || null;
    const zCut = Number(state.config?.model?.z_ground_cutoff_m || 0);
    const northDeg = Number(state.config?.settings?.north_angle_deg || 0);

    this.rig.setBBox(bbox);
    this.rig.setNorthAngle(northDeg);

    const modelKey = `${state.modelId || 'none'}|${bbox?.max_span || 0}`;
    const renderKey = JSON.stringify({
      modelKey,
      theme: state.theme,
      mode: useHeatmap ? 'heatmap' : 'classification',
      hasAnalysis: Boolean(state.analysisData),
      selectedGroup: state.selectedGroup || null,
      selectedOrientation: state.selectedOrientation || null,
      zCut,
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

    if (useHeatmap && state.analysisData?.panels?.length) {
      this._renderAnalysisHeatmap(state.analysisData, state.selectedOrientation, tokens);
    } else if (state.inspectData?.preview_meshes?.length) {
      this._renderPreviewMeshes(state, tokens);
    } else if (state.analysisData?.panels?.length) {
      this._renderAnalysisClassification(state.analysisData, state.selectedGroup, tokens);
    }

    if (bbox && modelKey !== this.lastModelKey) {
      this.rig.setProjection(state.cameraProjection || 'perspective', this.controls, { animate: false });
      this.lastModelKey = modelKey;
    }
  }

  _renderPreviewMeshes(state, tokens) {
    const meshes = state.inspectData?.preview_meshes || [];
    const overrides = state.config?.roles?.group_category_overrides || {};
    const disabled = new Set(state.config?.roles?.disabled_groups || []);
    const selectedGroup = state.selectedGroup;

    for (const pm of meshes) {
      if (!pm.vertices?.length || !pm.tris?.length) continue;
      const gName = pm.group_name;
      const cat = overrides[gName] || pm.category || 'wall';
      if (disabled.has(gName)) continue;

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

      const highlighted = Boolean(selectedGroup && selectedGroup === gName);
      const dimmed = Boolean(selectedGroup && selectedGroup !== gName);
      const mat = makeClassificationMaterial(cat, tokens, { highlighted, dimmed });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { groupName: gName, category: cat };
      this.modelRoot.add(mesh);
    }
  }

  _renderAnalysisHeatmap(analysis, selectedOrientation, tokens) {
    const orientOttv = {};
    for (const row of analysis.orientation_breakdown || []) {
      orientOttv[row.code] = Number(row.ottv_orientation_wm2 || 0);
    }

    const buckets = new Map();
    for (const p of analysis.panels || []) {
      if (!p.active || !Array.isArray(p.vertices) || p.vertices.length < 3) continue;
      const code = p.orientation_code || 'U';
      if (!buckets.has(code)) buckets.set(code, []);
      buckets.get(code).push(p);
    }

    for (const [code, panels] of buckets.entries()) {
      const coords = [];
      for (const p of panels) {
        const vs = p.vertices;
        const p0 = _coordsArr(vs[0][0], vs[0][1], vs[0][2]);
        const p1 = _coordsArr(vs[1][0], vs[1][1], vs[1][2]);
        const p2 = _coordsArr(vs[2][0], vs[2][1], vs[2][2]);
        coords.push(...p0, ...p1, ...p2);
        if (vs.length >= 4) {
          const p3 = _coordsArr(vs[3][0], vs[3][1], vs[3][2]);
          coords.push(...p0, ...p2, ...p3);
        }
      }
      if (!coords.length) continue;

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      geom.computeVertexNormals();

      const highlighted = Boolean(selectedOrientation && selectedOrientation === code);
      const dimmed = Boolean(selectedOrientation && selectedOrientation !== code);
      const mat = makeHeatmapMaterial(orientOttv[code] ?? 0, tokens, { highlighted, dimmed });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { orientationCode: code };
      this.modelRoot.add(mesh);
    }

    this._renderContextElements(analysis.shading_elements, 'shading', tokens, Boolean(selectedOrientation));
    this._renderContextElements(analysis.roof_elements, 'roof', tokens, true);
  }

  _renderAnalysisClassification(analysis, selectedGroup, tokens) {
    const buckets = new Map();
    for (const p of analysis.panels || []) {
      if (!p.active || !Array.isArray(p.vertices) || p.vertices.length < 3) continue;
      const key = `${p.group_name}|${p.element_type || 'wall'}`;
      if (!buckets.has(key)) {
        buckets.set(key, { groupName: p.group_name, category: p.element_type || 'wall', coords: [] });
      }
      const b = buckets.get(key);
      const vs = p.vertices;
      const p0 = _coordsArr(vs[0][0], vs[0][1], vs[0][2]);
      const p1 = _coordsArr(vs[1][0], vs[1][1], vs[1][2]);
      const p2 = _coordsArr(vs[2][0], vs[2][1], vs[2][2]);
      b.coords.push(...p0, ...p1, ...p2);
      if (vs.length >= 4) {
        const p3 = _coordsArr(vs[3][0], vs[3][1], vs[3][2]);
        b.coords.push(...p0, ...p2, ...p3);
      }
    }

    for (const b of buckets.values()) {
      if (!b.coords.length) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(b.coords, 3));
      geom.computeVertexNormals();
      const highlighted = Boolean(selectedGroup && selectedGroup === b.groupName);
      const dimmed = Boolean(selectedGroup && selectedGroup !== b.groupName);
      const mat = makeClassificationMaterial(b.category, tokens, { highlighted, dimmed });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { groupName: b.groupName, category: b.category };
      this.modelRoot.add(mesh);
    }

    this._renderContextElements(analysis.shading_elements, 'shading', tokens, false);
    this._renderContextElements(analysis.frame_elements, 'frame', tokens, false);
    this._renderContextElements(analysis.roof_elements, 'roof', tokens, false);
  }

  _renderContextElements(elements, category, tokens, dimmed) {
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
      const mat = makeClassificationMaterial(category, tokens, { dimmed });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { groupName: el.group_name, category };
      this.modelRoot.add(mesh);
    }
  }
}

export const viewer = new LuxaViewer();
