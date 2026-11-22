/**
 * Minimal 1.5px stroke SVG icons matching docs/fase4/mockup/*.html.
 * Static icons only — never embeds untrusted text.
 */

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export function icon(name, size = 18) {
  const wh = `width="${size}" height="${size}"`;
  const paths = {
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    layers: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    compare: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h6M10 16h6"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.5a2.3 2.3 0 114 1.6c-.9.6-1.8 1.1-1.8 2.2M12 16.6v.1"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z"/>',
    sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    sliders: '<path d="M5 7h9M18 7h1M5 17h3M12 17h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v4h16v-4"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19h16"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.1"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    pause: '<path d="M8 5.5v13M16 5.5v13"/>',
    grip: '<circle cx="9" cy="7" r="1"/><circle cx="15" cy="7" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="17" r="1"/><circle cx="15" cy="17" r="1"/>',
    formula: '<path d="M9 19c2 0 2.5-1.5 3-4l1.5-8c.4-2 1-3 3-3"/><path d="M8 10h7"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M13 16.5h7M16.5 13v7"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-2 4-4 2 2-4z"/>',
    thermometer: '<path d="M10 14.5V5a2 2 0 014 0v9.5a4 4 0 11-4 0z"/><path d="M12 9v7"/>',
    xray: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/><path d="M9 15l6-6"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevronDown: '<path d="M7 10l5 5 5-5"/>',
    edit: '<path d="M15.5 5.5l3 3L9 18H6v-3z"/>',
    trash: '<path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12"/>',
    keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
    rotateCw: '<path d="M20 12a8 8 0 11-2.3-5.6"/><path d="M20 4v5h-5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
    sparkles: '<path d="M12 3l1.8 4.8L18.5 9.5l-4.7 1.7L12 16l-1.8-4.8L5.5 9.5l4.7-1.7z"/><path d="M19 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  };
  const body = paths[name] || '';
  return `<svg ${SVG_ATTRS} ${wh}>${body}</svg>`;
}

/**
 * Returns the 8-line compass SVG rotated to match `northAngleDeg`.
 */
export function compassDialSvg(northAngleDeg = 0) {
  const rot = Number(northAngleDeg) || 0;
  return `
    <svg width="44" height="44" viewBox="0 0 72 72" aria-hidden="true" style="transform: rotate(${rot}deg)">
      <g stroke="var(--ink)" stroke-linecap="round">
        <line x1="36" y1="6" x2="36" y2="14" stroke-width="2.5"/>
        <line x1="57" y1="15" x2="52" y2="20" stroke-width="1.5"/>
        <line x1="66" y1="36" x2="58" y2="36" stroke-width="2.5"/>
        <line x1="57" y1="57" x2="52" y2="52" stroke-width="1.5"/>
        <line x1="36" y1="66" x2="36" y2="58" stroke-width="2.5"/>
        <line x1="15" y1="57" x2="20" y2="52" stroke-width="1.5"/>
        <line x1="6" y1="36" x2="14" y2="36" stroke-width="2.5"/>
        <line x1="15" y1="15" x2="20" y2="20" stroke-width="1.5"/>
      </g>
      <path d="M36 20l6 18h-12z" fill="var(--sun)"/>
      <text x="36" y="50" font-size="11" font-weight="700" text-anchor="middle" fill="var(--ink)">U</text>
    </svg>
  `;
}

/**
 * Returns the 8-line animated compass loader SVG (stops under prefers-reduced-motion).
 */
export function compassLoaderSvg() {
  return `
    <svg class="compass-loader" width="112" height="112" viewBox="0 0 120 120" role="img" aria-label="Sedang memproses">
      <line x1="60" y1="30" x2="60" y2="14" stroke-width="4" opacity="1"/>
      <line x1="81.2" y1="38.8" x2="92.5" y2="27.5" stroke-width="3" opacity="0.85"/>
      <line x1="90" y1="60" x2="106" y2="60" stroke-width="4" opacity="0.7"/>
      <line x1="81.2" y1="81.2" x2="92.5" y2="92.5" stroke-width="3" opacity="0.55"/>
      <line x1="60" y1="90" x2="60" y2="106" stroke-width="4" opacity="0.4"/>
      <line x1="38.8" y1="81.2" x2="27.5" y2="92.5" stroke-width="3" opacity="0.3"/>
      <line x1="30" y1="60" x2="14" y2="60" stroke-width="4" opacity="0.22"/>
      <line x1="38.8" y1="38.8" x2="27.5" y2="27.5" stroke-width="3" opacity="0.15"/>
    </svg>
  `;
}
