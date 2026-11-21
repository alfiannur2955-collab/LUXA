/**
 * Hold-V 8-Direction Radial Pie Menu (`docs/FASE4_UI_SPEC.md` §6 + mockup 7-pintasan.html).
 * - Hold `V`: opens radial pie centered on viewer/screen.
 * - Move mouse toward a sector (U, TL, T, TG, S, BD, B, BL) or center (Atas); release `V` to select.
 * - Press `Escape` while open to cancel without changing direction.
 * - Also supports clicking any sector button or ArrowLeft/ArrowRight + Enter.
 */

import { DIRECTION_NAMES } from './cameras.js';

const SECTORS = [
  { code: 'U', dx: 0, dy: -120, angleDeg: 0 },
  { code: 'TL', dx: 85, dy: -85, angleDeg: 45 },
  { code: 'T', dx: 120, dy: 0, angleDeg: 90 },
  { code: 'TG', dx: 85, dy: 85, angleDeg: 135 },
  { code: 'S', dx: 0, dy: 120, angleDeg: 180 },
  { code: 'BD', dx: -85, dy: 85, angleDeg: 225 },
  { code: 'B', dx: -120, dy: 0, angleDeg: 270 },
  { code: 'BL', dx: -85, dy: -85, angleDeg: 315 },
];

class RadialPieMenu {
  constructor() {
    this.isOpen = false;
    this.highlighted = 'B';
    this.centerX = 0;
    this.centerY = 0;
    this.onSelect = null;
    this.root = null;
    this.lineEl = null;
    this.buttons = new Map();
    this._onPointerMove = this._handlePointerMove.bind(this);
  }

  open({ currentDirection = 'B', onSelect, anchorEl = null } = {}) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.highlighted = currentDirection || 'B';
    this.onSelect = onSelect;

    const rect = anchorEl?.getBoundingClientRect?.();
    if (rect && rect.width > 100 && rect.height > 100) {
      this.centerX = rect.left + rect.width / 2;
      this.centerY = rect.top + rect.height / 2;
    } else {
      this.centerX = window.innerWidth / 2;
      this.centerY = window.innerHeight / 2;
    }

    this._mountDom();
    this._updateVisuals();
    window.addEventListener('pointermove', this._onPointerMove);
  }

  close({ commit = false } = {}) {
    if (!this.isOpen) return;
    const chosen = this.highlighted;
    const cb = this.onSelect;
    this.isOpen = false;
    this.onSelect = null;
    window.removeEventListener('pointermove', this._onPointerMove);
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.buttons.clear();
    if (commit && chosen && typeof cb === 'function') {
      cb(chosen);
    }
  }

  stepKeyboard(delta) {
    if (!this.isOpen) return;
    const order = [...SECTORS.map((s) => s.code), 'Atas'];
    const idx = order.indexOf(this.highlighted);
    const nextIdx = ((idx === -1 ? 0 : idx) + delta + order.length) % order.length;
    this.highlighted = order[nextIdx];
    this._updateVisuals();
  }

  _handlePointerMove(e) {
    if (!this.isOpen) return;
    const vx = e.clientX - this.centerX;
    const vy = e.clientY - this.centerY;
    const dist = Math.hypot(vx, vy);
    if (dist < 28) {
      this.highlighted = 'Atas';
    } else {
      // Angle clockwise from UP (0 = North/Up, 90 = East/Right)
      const deg = ((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360;
      const idx = Math.floor((deg + 22.5) / 45) % 8;
      this.highlighted = SECTORS[idx].code;
    }
    this._updateVisuals();
  }

  _mountDom() {
    const wrap = document.createElement('div');
    wrap.className = 'pie-menu-overlay';
    wrap.setAttribute('role', 'menu');
    wrap.setAttribute('aria-label', 'Pie menu arah pandang');
    wrap.style.left = `${this.centerX}px`;
    wrap.style.top = `${this.centerY}px`;

    const ring = document.createElement('div');
    ring.className = 'pie-ring';

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '300');
    svg.setAttribute('height', '300');
    svg.setAttribute('viewBox', '-150 -150 300 300');
    svg.classList.add('pie-svg');
    svg.setAttribute('aria-hidden', 'true');

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '0');
    line.setAttribute('stroke', 'var(--sun)');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    this.lineEl = line;

    // Center button: Atas
    const centerBtn = document.createElement('button');
    centerBtn.type = 'button';
    centerBtn.className = 'pie-center-btn';
    centerBtn.setAttribute('role', 'menuitem');
    centerBtn.setAttribute('aria-label', 'Tampak Atas');
    centerBtn.textContent = 'Atas';
    centerBtn.addEventListener('click', () => {
      this.highlighted = 'Atas';
      this.close({ commit: true });
    });
    this.buttons.set('Atas', centerBtn);

    wrap.append(ring, svg, centerBtn);

    for (const s of SECTORS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pie-sector-btn';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('aria-label', `Tampak ${DIRECTION_NAMES[s.code] || s.code}`);
      btn.style.left = `${s.dx - 34}px`;
      btn.style.top = `${s.dy - 22}px`;
      btn.textContent = s.code;
      btn.addEventListener('pointerenter', () => {
        this.highlighted = s.code;
        this._updateVisuals();
      });
      btn.addEventListener('click', () => {
        this.highlighted = s.code;
        this.close({ commit: true });
      });
      this.buttons.set(s.code, btn);
      wrap.appendChild(btn);
    }

    const hint = document.createElement('p');
    hint.className = 'lbl pie-hint';
    hint.innerHTML = 'Tahan <kbd>V</kbd>, arahkan mouse, lepas · <kbd>Esc</kbd> batal';
    wrap.appendChild(hint);

    document.body.appendChild(wrap);
    this.root = wrap;
  }

  _updateVisuals() {
    for (const [code, btn] of this.buttons.entries()) {
      btn.classList.toggle('is-active', code === this.highlighted);
    }
    const sec = SECTORS.find((s) => s.code === this.highlighted);
    if (this.lineEl) {
      if (sec) {
        this.lineEl.setAttribute('x2', String(Math.round(sec.dx * 0.78)));
        this.lineEl.setAttribute('y2', String(Math.round(sec.dy * 0.78)));
        this.lineEl.style.opacity = '1';
      } else {
        this.lineEl.setAttribute('x2', '0');
        this.lineEl.setAttribute('y2', '0');
        this.lineEl.style.opacity = '0';
      }
    }
  }
}

export const pieMenu = new RadialPieMenu();
