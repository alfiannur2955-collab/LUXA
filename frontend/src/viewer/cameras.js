/**
 * LUXA Camera Rig (Fase 4b-1 — `docs/FASE4_UI_SPEC.md` §4.1):
 * - 4 projections:
 *   1. `perspective`  : PerspectiveCamera, free orbit
 *   2. `two_point`    : PerspectiveCamera with pitch locked to 0 (horizontal viewing ray)
 *                       and vertical framing shifted via `setViewOffset` so verticals stay plumb
 *   3. `axonometric`  : OrthographicCamera from isometric elevation (~35.264°)
 *   4. `elevation`    : OrthographicCamera perpendicular to one of 8 compass directions or `Atas`
 * - Smooth 200 ms transitions (instant under `prefers-reduced-motion`).
 * - Honors `north_angle_deg` (azimuth clockwise from +Y in backend convention).
 */

import * as THREE from 'three';
import { prefersReducedMotion } from '../ui/glass.js';

export const DIRECTION_AZIMUTHS = {
  U: 0,
  TL: 45,
  T: 90,
  TG: 135,
  S: 180,
  BD: 225,
  B: 270,
  BL: 315,
};

export const DIRECTION_NAMES = {
  U: 'Utara',
  TL: 'Timur Laut',
  T: 'Timur',
  TG: 'Tenggara',
  S: 'Selatan',
  BD: 'Barat Daya',
  B: 'Barat',
  BL: 'Barat Laut',
  Atas: 'Atas',
};

export const PROJECTION_LABELS = {
  perspective: 'Perspektif',
  two_point: '2 titik',
  axonometric: 'Aksonometri',
  elevation: 'Tampak',
};

export const PROJECTION_SHORT = {
  perspective: 'Persp',
  two_point: '2 titik',
  axonometric: 'Akso',
  elevation: 'Tampak',
};

/**
 * S3: Clear direction label distinguishing orthographic elevation ("Tampak Barat")
 * from 3D camera vantage point ("dari Tenggara").
 */
export function formatCameraDirectionLabel(projection, direction) {
  const dirName = DIRECTION_NAMES[direction] || direction || 'Tenggara';
  if (projection === 'elevation') {
    return direction === 'Atas' ? 'Tampak Atas' : `Tampak ${dirName}`;
  }
  return direction === 'Atas' ? 'dari Atas' : `dari ${dirName}`;
}

/**
 * Converts backend Z-up (x=East, y=North, z=Up) to Three.js Y-up (x=East, y=Up, z=-North).
 */
export function toThreeCoords(x, y, z) {
  return new THREE.Vector3(Number(x) || 0, Number(z) || 0, -(Number(y) || 0));
}

/**
 * Outward horizontal unit vector in Three.js XZ plane for an azimuth clockwise from North.
 * Azimuth 0° (U) -> (0, 0, -1), 90° (T) -> (1, 0, 0), 180° (S) -> (0, 0, 1), 270° (B) -> (-1, 0, 0).
 */
export function azimuthToThreeHorizontal(azDeg, northAngleDeg = 0) {
  const rad = (((Number(azDeg) || 0) + (Number(northAngleDeg) || 0)) * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad));
}

export class CameraRig {
  constructor() {
    this.width = 800;
    this.height = 600;
    this.projection = 'perspective'; // 'perspective' | 'two_point' | 'axonometric' | 'elevation'
    this.direction = 'B'; // 'U'..'BL' | 'Atas'
    this.northAngleDeg = 0;
    this.twoPointShiftY = 0; // normalized vertical lens shift (-0.35 .. 0.35)
    this.rightInsetPx = 0; // occluded right-side overlay width (e.g. Konfirmasi floating card)
    this.bbox = null;

    this.perspCamera = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 4000);
    this.perspCamera.position.set(28, 22, 28);

    this.orthoCamera = new THREE.OrthographicCamera(-20, 20, 15, -15, -2000, 4000);
    this.orthoCamera.position.set(28, 22, 28);

    this.activeCamera = this.perspCamera;
    this.orthoHalfHeight = 20;

    this.anim = null;
  }

  getActiveCamera() {
    return this.activeCamera;
  }

  /**
   * Computes the actual 8-compass camera vantage code (or 'Atas') from current camera pose.
   */
  getLiveDirection(controls) {
    const cam = this.activeCamera;
    const tgt = controls ? controls.target : this._getModelMetrics().center;
    const rel = cam.position.clone().sub(tgt);
    const hLen = Math.hypot(rel.x, rel.z);
    if (rel.y > 0 && hLen < Math.max(0.5, rel.y * 0.2)) {
      return 'Atas';
    }
    const az = ((Math.atan2(rel.x, -rel.z) * 180) / Math.PI - (Number(this.northAngleDeg) || 0) + 720) % 360;
    const codes = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'];
    return codes[Math.floor(((az + 22.5) % 360) / 45)] || 'TG';
  }

  setNorthAngle(deg) {
    this.northAngleDeg = Number(deg) || 0;
  }

  setBBox(bbox) {
    this.bbox = bbox || null;
  }

  setRightInsetPx(px) {
    const next = Math.max(0, Math.round(Number(px) || 0));
    if (next === this.rightInsetPx) return;
    this.rightInsetPx = next;
    this._applyPerspViewOffset();
    this.perspCamera.updateProjectionMatrix();
    this._updateOrthoFrustum();
  }

  _getModelMetrics() {
    const b = this.bbox;
    if (!b || !b.span || !b.center) {
      return {
        center: new THREE.Vector3(0, 6, 0),
        spanX: 20,
        spanY: 20,
        spanZ: 15,
        maxDim: 22,
        radius: 16,
      };
    }
    const center = toThreeCoords(b.center[0], b.center[1], b.center[2]);
    const spanX = Math.max(1, Number(b.span[0]) || 10);
    const spanY = Math.max(1, Number(b.span[1]) || 10);
    const spanZ = Math.max(1, Number(b.span[2]) || 10);
    const maxDim = Math.max(spanX, spanY, spanZ, 4);
    const radius = 0.5 * Math.hypot(spanX, spanY, spanZ);
    return { center, spanX, spanY, spanZ, maxDim, radius };
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const aspect = this.width / this.height;

    this.perspCamera.aspect = aspect;
    this._applyPerspViewOffset();
    this.perspCamera.updateProjectionMatrix();

    this._updateOrthoFrustum();
  }

  _applyPerspViewOffset() {
    const offsetX = this.rightInsetPx > 0 ? Math.round(Math.min(this.rightInsetPx, this.width * 0.6) * 0.5) : 0;
    const offsetY = this.projection === 'two_point' ? Math.round(this.twoPointShiftY * this.height) : 0;
    if (offsetX !== 0 || offsetY !== 0) {
      this.perspCamera.setViewOffset(this.width, this.height, offsetX, offsetY, this.width, this.height);
    } else {
      this.perspCamera.clearViewOffset();
    }
  }

  _updateOrthoFrustum() {
    const aspect = this.width / Math.max(1, this.height);
    const hh = Math.max(1, this.orthoHalfHeight);
    const clampedInset = this.rightInsetPx > 0 ? Math.min(this.rightInsetPx, this.width * 0.6) : 0;
    const shiftWorld = (clampedInset / Math.max(1, this.width)) * (hh * aspect);
    this.orthoCamera.left = -hh * aspect + shiftWorld;
    this.orthoCamera.right = hh * aspect + shiftWorld;
    this.orthoCamera.top = hh;
    this.orthoCamera.bottom = -hh;
    this.orthoCamera.updateProjectionMatrix();
  }

  _computeFitDistance(m) {
    const clampedInset = this.rightInsetPx > 0 ? Math.min(this.rightInsetPx, this.width * 0.6) : 0;
    const effW = Math.max(160, this.width - clampedInset);
    const effH = Math.max(160, this.height);
    const vFov = (this.perspCamera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (effW / effH));
    const distV = m.radius / Math.sin(vFov / 2);
    const distH = m.radius / Math.sin(Math.min(Math.PI * 0.48, hFov / 2));
    // 1.15 factor guarantees >= 10% breathing margin inside the unoccluded area
    return Math.max(distV, distH, m.maxDim * 1.65) * 1.15;
  }

  _computeFitOrthoHalf(m) {
    const clampedInset = this.rightInsetPx > 0 ? Math.min(this.rightInsetPx, this.width * 0.6) : 0;
    const effW = Math.max(160, this.width - clampedInset);
    const effH = Math.max(160, this.height);
    const effAspect = effW / effH;
    const baseHalf = Math.max(m.radius * 1.18, m.maxDim * 0.68);
    return effAspect < 1 ? baseHalf / effAspect : baseHalf;
  }

  /**
   * Configures OrbitControls constraints for the active projection.
   */
  applyControlsConstraints(controls) {
    if (!controls) return;
    controls.object = this.activeCamera;
    if (this.projection === 'two_point') {
      // Lock pitch strictly horizontal so vertical architectural edges stay parallel/plumb
      controls.minPolarAngle = Math.PI / 2;
      controls.maxPolarAngle = Math.PI / 2;
      controls.enableRotate = true;
    } else if (this.projection === 'elevation' && this.direction === 'Atas') {
      controls.minPolarAngle = 0.001;
      controls.maxPolarAngle = Math.PI - 0.001;
      controls.enableRotate = true;
    } else {
      controls.minPolarAngle = 0.02;
      controls.maxPolarAngle = Math.PI - 0.02;
      controls.enableRotate = true;
    }
    controls.update();
  }

  /**
   * Computes ideal pose for a given projection & direction.
   */
  _computeTargetPose(projection, direction, controls) {
    const m = this._getModelMetrics();
    const dist = this._computeFitDistance(m);
    const curPos = this.activeCamera.position.clone();
    const curTarget = controls ? controls.target.clone() : m.center.clone();
    const rel = curPos.clone().sub(curTarget);
    const curDist = Math.max(4, rel.length());

    let pos = new THREE.Vector3();
    let target = m.center.clone();
    let up = new THREE.Vector3(0, 1, 0);
    let orthoHalf = this._computeFitOrthoHalf(m);
    let shiftY = 0;

    if (projection === 'perspective') {
      if (rel.lengthSq() > 1e-3 && this.projection !== 'elevation') {
        const horiz = new THREE.Vector3(rel.x, 0, rel.z);
        if (horiz.lengthSq() < 1e-3) {
          pos.set(m.center.x + dist * 0.68, m.center.y + dist * 0.45, m.center.z + dist * 0.72);
        } else {
          horiz.normalize();
          const elev = dist * 0.36;
          pos.copy(m.center).addScaledVector(horiz, Math.sqrt(Math.max(1, dist * dist - elev * elev)));
          pos.y = m.center.y + elev;
        }
      } else {
        const dirVec = azimuthToThreeHorizontal(DIRECTION_AZIMUTHS[direction] ?? 225, this.northAngleDeg);
        pos.copy(m.center).addScaledVector(dirVec, dist * 0.88);
        pos.y = m.center.y + dist * 0.42;
      }
    } else if (projection === 'two_point') {
      // Strictly horizontal camera at eye height (~35% up the building) with lens shift to frame roof
      let horiz = new THREE.Vector3(rel.x, 0, rel.z);
      if (horiz.lengthSq() < 1e-3) {
        const az = DIRECTION_AZIMUTHS[direction] ?? 225;
        horiz = azimuthToThreeHorizontal(az, this.northAngleDeg);
      } else {
        horiz.normalize();
      }
      const eyeY = m.center.y - m.spanZ * 0.12;
      target.set(m.center.x, eyeY, m.center.z);
      pos.copy(target).addScaledVector(horiz, dist);
      pos.y = eyeY; // pitch strictly 0!
      // Vertical view offset shifts the horizon slightly down so tall towers sit gracefully in frame
      shiftY = -0.10;
    } else if (projection === 'axonometric') {
      // Isometric angle (~35.264° elevation) from nearest quadrant to current camera
      let azRad = Math.atan2(rel.x, -rel.z);
      if (!Number.isFinite(azRad) || (Math.abs(rel.x) < 1e-3 && Math.abs(rel.z) < 1e-3)) {
        azRad = (225 * Math.PI) / 180;
      }
      // Snap to nearest isometric diagonal (45, 135, 225, 315)
      const deg = ((azRad * 180) / Math.PI + 360) % 360;
      const snappedDeg = Math.floor(deg / 90) * 90 + 45;
      const rad = (snappedDeg * Math.PI) / 180;
      const elevRad = Math.atan(1 / Math.SQRT2); // 35.264°
      const cosE = Math.cos(elevRad);
      pos.set(
        m.center.x + dist * cosE * Math.sin(rad),
        m.center.y + dist * Math.sin(elevRad),
        m.center.z - dist * cosE * Math.cos(rad),
      );
      orthoHalf = this._computeFitOrthoHalf(m);
    } else {
      // elevation ('Tampak')
      if (direction === 'Atas') {
        pos.set(m.center.x, m.center.y + dist, m.center.z);
        const northVec = azimuthToThreeHorizontal(0, this.northAngleDeg);
        up.copy(northVec);
        orthoHalf = Math.max(m.spanX, m.spanY) * 0.72;
      } else {
        const az = DIRECTION_AZIMUTHS[direction] ?? 270;
        const dirVec = azimuthToThreeHorizontal(az, this.northAngleDeg);
        pos.copy(m.center).addScaledVector(dirVec, dist);
        pos.y = m.center.y;
        const horizSpan = Math.max(m.spanX, m.spanY);
        orthoHalf = Math.max(m.spanZ, horizSpan) * 0.68;
      }
    }

    return { pos, target, up, orthoHalf, shiftY };
  }

  /**
   * Switches projection (`perspective` | `two_point` | `axonometric` | `elevation`)
   * with a 200 ms transition (instant if `prefers-reduced-motion`).
   */
  setProjection(projection, controls, { direction = null, animate = true } = {}) {
    if (direction) this.direction = direction;
    const prevCam = this.activeCamera;
    const startPos = prevCam.position.clone();
    const startTarget = controls ? controls.target.clone() : this._getModelMetrics().center;
    const startHalf = this.orthoHalfHeight;

    this.projection = projection;
    const isOrtho = projection === 'axonometric' || projection === 'elevation';
    this.activeCamera = isOrtho ? this.orthoCamera : this.perspCamera;

    const pose = this._computeTargetPose(projection, this.direction, controls);
    this.twoPointShiftY = pose.shiftY;

    const m = this._getModelMetrics();
    this.perspCamera.near = Math.max(0.05, m.maxDim * 0.004);
    this.perspCamera.far = Math.max(2500, m.maxDim * 35);
    this.orthoCamera.near = -Math.max(1500, m.maxDim * 20);
    this.orthoCamera.far = Math.max(2500, m.maxDim * 35);

    this.activeCamera.up.copy(pose.up);
    this._applyPerspViewOffset();
    this.perspCamera.updateProjectionMatrix();

    this._startTransition({
      startPos,
      endPos: pose.pos,
      startTarget,
      endTarget: pose.target,
      startHalf,
      endHalf: pose.orthoHalf,
      controls,
      animate: animate && !prefersReducedMotion(),
    });
  }

  /**
   * Looks directly at one of the 8 facade directions (`U`..`BL`) or `Atas`.
   * Keeps `two_point` if active (unless `Atas`, which switches to `elevation`),
   * or switches to `elevation` / frames that facade cleanly.
   */
  lookAtDirection(direction, controls, { forceElevation = false, animate = true } = {}) {
    this.direction = direction;
    const m = this._getModelMetrics();
    const dist = this._computeFitDistance(m);
    const startPos = this.activeCamera.position.clone();
    const startTarget = controls ? controls.target.clone() : m.center.clone();
    const startHalf = this.orthoHalfHeight;

    let targetProj = this.projection;
    if (direction === 'Atas' || forceElevation) {
      targetProj = 'elevation';
    }
    this.projection = targetProj;
    const isOrtho = targetProj === 'axonometric' || targetProj === 'elevation';
    this.activeCamera = isOrtho ? this.orthoCamera : this.perspCamera;

    let endPos = new THREE.Vector3();
    let endTarget = m.center.clone();
    let up = new THREE.Vector3(0, 1, 0);
    let endHalf = this._computeFitOrthoHalf(m);
    let shiftY = 0;

    if (direction === 'Atas') {
      endPos.set(m.center.x, m.center.y + dist, m.center.z);
      up.copy(azimuthToThreeHorizontal(0, this.northAngleDeg));
      endHalf = Math.max(m.spanX, m.spanY) * 0.72;
    } else {
      const az = DIRECTION_AZIMUTHS[direction] ?? 270;
      const dirVec = azimuthToThreeHorizontal(az, this.northAngleDeg);
      if (targetProj === 'two_point') {
        const eyeY = m.center.y - m.spanZ * 0.12;
        endTarget.set(m.center.x, eyeY, m.center.z);
        endPos.copy(endTarget).addScaledVector(dirVec, dist);
        endPos.y = eyeY;
        shiftY = -0.10;
      } else if (targetProj === 'elevation') {
        endPos.copy(m.center).addScaledVector(dirVec, dist);
        endPos.y = m.center.y;
        endHalf = Math.max(m.spanZ, Math.max(m.spanX, m.spanY)) * 0.68;
      } else if (targetProj === 'axonometric') {
        const elevRad = Math.atan(1 / Math.SQRT2);
        endPos.copy(m.center).addScaledVector(dirVec, dist * Math.cos(elevRad));
        endPos.y = m.center.y + dist * Math.sin(elevRad);
      } else {
        endPos.copy(m.center).addScaledVector(dirVec, dist * 0.92);
        endPos.y = m.center.y + dist * 0.34;
      }
    }

    this.twoPointShiftY = shiftY;
    this.activeCamera.up.copy(up);
    this._applyPerspViewOffset();
    this.perspCamera.updateProjectionMatrix();

    this._startTransition({
      startPos,
      endPos,
      startTarget,
      endTarget,
      startHalf,
      endHalf,
      controls,
      animate: animate && !prefersReducedMotion(),
    });
  }

  /**
   * Fits the active camera smoothly back to the model bounding box (`F`).
   */
  fitToModel(controls, { animate = true } = {}) {
    this.setProjection(this.projection, controls, { animate });
  }

  _startTransition({ startPos, endPos, startTarget, endTarget, startHalf, endHalf, controls, animate }) {
    if (!animate) {
      this.anim = null;
      this.activeCamera.position.copy(endPos);
      this.orthoHalfHeight = endHalf;
      this.orthoCamera.zoom = 1;
      this._updateOrthoFrustum();
      if (controls) {
        controls.target.copy(endTarget);
        this.applyControlsConstraints(controls);
      } else {
        this.activeCamera.lookAt(endTarget);
      }
      return;
    }

    this.orthoCamera.zoom = 1;
    this.anim = {
      startTime: performance.now(),
      duration: 200,
      startPos,
      endPos,
      startTarget,
      endTarget,
      startHalf,
      endHalf,
      controls,
    };
    this.applyControlsConstraints(controls);
  }

  /**
   * Putar kamera mengelilingi target (sumbu vertikal) sampai pandangan menghadap utara,
   * jarak dan ketinggian tetap. Pandangan atas: diputar supaya utara di atas layar.
   */
  faceNorth(controls) {
    const tgt = controls ? controls.target.clone() : this._getModelMetrics().center.clone();
    const rel = this.activeCamera.position.clone().sub(tgt);
    const hLen = Math.hypot(rel.x, rel.z);
    if (hLen < 1e-3) {
      this.lookAtDirection('Atas', controls);
      return 0;
    }
    // Kamera berada di sisi selatan → melihat ke utara.
    const want = azimuthToThreeHorizontal(180, this.northAngleDeg);
    const from = Math.atan2(rel.x, rel.z);
    let to = Math.atan2(want.x, want.z);
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) < 1e-3) return 0;
    this.anim = null;
    this.spin = {
      startTime: performance.now(),
      duration: prefersReducedMotion() ? 0 : Math.min(700, 260 + Math.abs(delta) * 140),
      from,
      delta,
      hLen,
      y: rel.y,
      target: tgt,
      controls,
    };
    if (this.spin.duration === 0) this.tick(performance.now());
    return delta;
  }

  tick(now) {
    if (this.spin) {
      const sp = this.spin;
      const rawT = sp.duration > 0 ? Math.min(1, Math.max(0, (now - sp.startTime) / sp.duration)) : 1;
      const t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
      const a = sp.from + sp.delta * t;
      this.activeCamera.position.set(sp.target.x + Math.sin(a) * sp.hLen, sp.target.y + sp.y, sp.target.z + Math.cos(a) * sp.hLen);
      if (sp.controls) sp.controls.target.copy(sp.target);
      else this.activeCamera.lookAt(sp.target);
      if (rawT >= 1) {
        this.spin = null;
        if (typeof this.onSpinDone === 'function') this.onSpinDone();
      }
      return;
    }
    if (!this.anim) return;
    const { startTime, duration, startPos, endPos, startTarget, endTarget, startHalf, endHalf, controls } =
      this.anim;
    const rawT = Math.min(1, Math.max(0, (now - startTime) / duration));
    // Smooth ease-out cubic
    const t = 1 - Math.pow(1 - rawT, 3);

    this.activeCamera.position.lerpVectors(startPos, endPos, t);
    if (controls) {
      controls.target.lerpVectors(startTarget, endTarget, t);
    }
    this.orthoHalfHeight = startHalf + (endHalf - startHalf) * t;
    this._updateOrthoFrustum();

    if (rawT >= 1) {
      this.anim = null;
      if (controls) {
        this.applyControlsConstraints(controls);
      }
    }
  }

  exportState(controls) {
    const pos = this.activeCamera.position;
    const tgt = controls ? controls.target : new THREE.Vector3();
    return {
      projection: this.projection,
      direction: this.direction,
      position: [Number(pos.x.toFixed(3)), Number(pos.y.toFixed(3)), Number(pos.z.toFixed(3))],
      target: [Number(tgt.x.toFixed(3)), Number(tgt.y.toFixed(3)), Number(tgt.z.toFixed(3))],
      up: [
        Number(this.activeCamera.up.x.toFixed(3)),
        Number(this.activeCamera.up.y.toFixed(3)),
        Number(this.activeCamera.up.z.toFixed(3)),
      ],
      orthoHalfHeight: Number(this.orthoHalfHeight.toFixed(3)),
      orthoZoom: Number((this.orthoCamera.zoom || 1).toFixed(3)),
      twoPointShiftY: Number(this.twoPointShiftY.toFixed(4)),
    };
  }

  applySavedState(camState, controls, { animate = true } = {}) {
    if (!camState) return;
    const prevCam = this.activeCamera;
    const startPos = prevCam.position.clone();
    const startTarget = controls ? controls.target.clone() : new THREE.Vector3();
    const startHalf = this.orthoHalfHeight;

    this.projection = camState.projection || 'perspective';
    this.direction = camState.direction || this.direction;
    this.twoPointShiftY = Number(camState.twoPointShiftY || 0);

    const isOrtho = this.projection === 'axonometric' || this.projection === 'elevation';
    this.activeCamera = isOrtho ? this.orthoCamera : this.perspCamera;

    const endPos = new THREE.Vector3(...(camState.position || [25, 20, 25]));
    const endTarget = new THREE.Vector3(...(camState.target || [0, 5, 0]));
    const upArr = camState.up || [0, 1, 0];
    this.activeCamera.up.set(upArr[0], upArr[1], upArr[2]);

    this._applyPerspViewOffset();
    this.perspCamera.updateProjectionMatrix();

    const endHalf = Number(camState.orthoHalfHeight || this.orthoHalfHeight || 20);
    this._startTransition({
      startPos,
      endPos,
      startTarget,
      endTarget,
      startHalf,
      endHalf,
      controls,
      animate: animate && !prefersReducedMotion(),
    });
    if (isOrtho && camState.orthoZoom) {
      this.orthoCamera.zoom = Number(camState.orthoZoom) || 1;
      this.orthoCamera.updateProjectionMatrix();
    }
  }
}
