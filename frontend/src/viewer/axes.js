/**
 * Live 3D-synced Axis Gizmo (`docs/FASE4_UI_SPEC.md` §4.8):
 * X (red, var(--fail)), Y (green, var(--ok)), Z (blue, var(--data-glazing))
 * rendered cleanly in the bottom-right corner of the viewer (above the right pill).
 * Backend axes map to Three.js world vectors:
 *   X (East)  = (1, 0, 0)
 *   Y (North) = (0, 0, -1)
 *   Z (Up)    = (0, 1, 0)
 */

import * as THREE from 'three';

const AXES = [
  { key: 'X', vec: new THREE.Vector3(1, 0, 0), color: 'var(--fail)' },
  { key: 'Y', vec: new THREE.Vector3(0, 0, -1), color: 'var(--ok)' },
  { key: 'Z', vec: new THREE.Vector3(0, 1, 0), color: 'var(--data-glazing)' },
];

export class AxisGizmo {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'axis-gizmo';
    this.el.setAttribute('aria-hidden', 'true');

    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.setAttribute('width', '76');
    this.svg.setAttribute('height', '76');
    this.svg.setAttribute('viewBox', '0 0 76 76');
    this.el.appendChild(this.svg);

    this.items = AXES.map((a) => {
      const g = document.createElementNS(ns, 'g');
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '38');
      line.setAttribute('y1', '38');
      line.setAttribute('stroke', a.color);
      line.setAttribute('stroke-width', '2.4');
      line.setAttribute('stroke-linecap', 'round');

      const text = document.createElementNS(ns, 'text');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '700');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('fill', a.color);
      text.textContent = a.key;

      g.append(line, text);
      this.svg.appendChild(g);
      return { ...a, g, line, text };
    });

    this._invQuat = new THREE.Quaternion();
    this._tmp = new THREE.Vector3();
  }

  mount(parentEl) {
    if (this.el.parentElement !== parentEl) {
      parentEl.appendChild(this.el);
    }
  }

  update(camera) {
    if (!camera || !this.el.isConnected) return;
    this._invQuat.copy(camera.quaternion).invert();
    const cx = 38;
    const cy = 38;
    const len = 24;
    const labelLen = 33;

    const projected = this.items.map((item) => {
      this._tmp.copy(item.vec).applyQuaternion(this._invQuat);
      return {
        item,
        x: this._tmp.x,
        y: this._tmp.y,
        z: this._tmp.z,
      };
    });

    // Draw back-to-front by camera-space Z
    projected.sort((a, b) => a.z - b.z);

    for (const p of projected) {
      const x2 = cx + p.x * len;
      const y2 = cy - p.y * len;
      const lx = cx + p.x * labelLen;
      const ly = cy - p.y * labelLen;
      p.item.line.setAttribute('x2', x2.toFixed(1));
      p.item.line.setAttribute('y2', y2.toFixed(1));
      p.item.text.setAttribute('x', lx.toFixed(1));
      p.item.text.setAttribute('y', ly.toFixed(1));
      p.item.g.style.opacity = p.z < -0.2 ? '0.62' : '1';
      this.svg.appendChild(p.item.g);
    }
  }
}
