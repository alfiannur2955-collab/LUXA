/**
 * Lux, maskot LUXA: matahari kecil berkacamata hitam.
 * SVG asli (bukan gambar luar), animasi ringan lewat CSS (`.lux-*` di theme.css).
 * Pose: 'wave' (menyapa), 'guide' (memandu), 'happy' (senang), 'think' (bekerja), 'report' (laporan).
 * Hormati prefers-reduced-motion (animasi dimatikan di CSS) dan sakelar maskot di kartu Tampilan.
 */

const ORANGE = '#F49B1A';
const ORANGE_DEEP = '#E07F0B';
const RAY = '#F7B347';
const INK = '#1E1F24';
const TEAL = '#138E86';
const TEAL_DEEP = '#0B5F5A';
const CHEEK = '#F26B4F';

function rays(len = 1) {
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    const a = (i * 36 * Math.PI) / 180;
    const r0 = 37;
    const r1 = 37 + 9 * len;
    const x0 = 60 + Math.sin(a) * r0;
    const y0 = 62 - Math.cos(a) * r0;
    const x1 = 60 + Math.sin(a) * r1;
    const y1 = 62 - Math.cos(a) * r1;
    out.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${RAY}" stroke-width="6.5" stroke-linecap="round"/>`);
  }
  return `<g class="lux-rays">${out.join('')}</g>`;
}

function body() {
  return `
    <circle cx="60" cy="62" r="30" fill="${ORANGE}"/>
    <path d="M38 74 A30 30 0 0 0 82 74 A34 34 0 0 1 38 74 Z" fill="${ORANGE_DEEP}" opacity="0.35"/>
    <ellipse cx="50" cy="47" rx="9" ry="5" fill="#fff" opacity="0.28" transform="rotate(-25 50 47)"/>`;
}

function glasses() {
  return `
    <g class="lux-glasses">
      <path d="M33 56 h54" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <rect x="35" y="53" width="21" height="14" rx="6" fill="${TEAL}" stroke="${INK}" stroke-width="2.6"/>
      <rect x="64" y="53" width="21" height="14" rx="6" fill="${TEAL}" stroke="${INK}" stroke-width="2.6"/>
      <path d="M38.5 57 l5 -2.2" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity="0.75" class="lux-glint"/>
      <path d="M67.5 57 l5 -2.2" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity="0.75" class="lux-glint"/>
    </g>`;
}

function glassesUp() {
  // Kacamata naik ke dahi (pose memandu), mata terlihat.
  return `
    <g>
      <path d="M36 41 h48" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      <rect x="38" y="36" width="18" height="10" rx="5" fill="${TEAL}" stroke="${INK}" stroke-width="2.2"/>
      <rect x="64" y="36" width="18" height="10" rx="5" fill="${TEAL}" stroke="${INK}" stroke-width="2.2"/>
    </g>
    <g class="lux-eyes">
      <ellipse cx="48" cy="60" rx="3.6" ry="4.6" fill="${INK}"/>
      <ellipse cx="72" cy="60" rx="3.6" ry="4.6" fill="${INK}"/>
      <circle cx="49.3" cy="58.4" r="1.2" fill="#fff"/>
      <circle cx="73.3" cy="58.4" r="1.2" fill="#fff"/>
    </g>`;
}

function happyEyes() {
  return `
    <path d="M42 60 q6 -7 12 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M66 60 q6 -7 12 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
}

function cheeks() {
  return `
    <ellipse cx="41" cy="71" rx="4.5" ry="2.8" fill="${CHEEK}" opacity="0.45"/>
    <ellipse cx="79" cy="71" rx="4.5" ry="2.8" fill="${CHEEK}" opacity="0.45"/>`;
}

const MOUTH = {
  smile: `<path d="M51 73 q9 8 18 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  open: `<path d="M50 72 q10 0 20 0 q-2 11 -10 11 q-8 0 -10 -11 z" fill="${INK}"/><path d="M54 79 q6 4 12 0" fill="${CHEEK}" opacity="0.9"/>`,
  oh: `<ellipse cx="60" cy="76" rx="4" ry="4.6" fill="${INK}"/>`,
  flat: `<path d="M53 75 q7 3 14 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
};

function arm(side, kind) {
  // side: 'l' | 'r'. kind: 'down' | 'wave' | 'up' | 'point' | 'hold'
  const s = side === 'l' ? -1 : 1;
  const sx = 60 + s * 27;
  const sy = 72;
  let ex;
  let ey;
  if (kind === 'wave') {
    ex = 60 + s * 40;
    ey = 46;
  } else if (kind === 'up') {
    ex = 60 + s * 40;
    ey = 44;
  } else if (kind === 'point') {
    ex = 60 + s * 46;
    ey = 66;
  } else if (kind === 'hold') {
    ex = 60 + s * 14;
    ey = 92;
  } else {
    ex = 60 + s * 36;
    ey = 88;
  }
  const cls = kind === 'wave' ? ' class="lux-wave"' : '';
  const origin = kind === 'wave' ? ` style="transform-origin:${sx}px ${sy}px"` : '';
  return `<g${cls}${origin}>
      <path d="M${sx} ${sy} Q${(sx + ex) / 2 + s * 4} ${(sy + ey) / 2 + 4} ${ex} ${ey}" stroke="${ORANGE_DEEP}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="${ex}" cy="${ey}" r="5" fill="${ORANGE}" stroke="${ORANGE_DEEP}" stroke-width="2"/>
    </g>`;
}

function reportSheet() {
  return `
    <g class="lux-sheet">
      <rect x="44" y="84" width="32" height="26" rx="3" fill="#fff" stroke="${INK}" stroke-width="2.2"/>
      <path d="M49 91 h16 M49 96 h22 M49 101 h12" stroke="${TEAL}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M66 99 l3 3 l6 -7" stroke="${TEAL_DEEP}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </g>`;
}

const POSES = {
  wave: () => `${rays()}${arm('l', 'down')}${body()}${glasses()}${cheeks()}${MOUTH.smile}${arm('r', 'wave')}`,
  guide: () => `${rays()}${arm('l', 'down')}${body()}${glassesUp()}${cheeks()}${MOUTH.smile}${arm('r', 'point')}`,
  happy: () => `${rays(1.25)}${arm('l', 'up')}${arm('r', 'up')}${body()}${happyEyes()}${cheeks()}${MOUTH.open}`,
  think: () => `${rays()}${arm('l', 'down')}${arm('r', 'down')}${body()}${glasses()}${cheeks()}${MOUTH.flat}`,
  report: () => `${rays()}${body()}${glasses()}${cheeks()}${MOUTH.smile}${arm('l', 'hold')}${arm('r', 'hold')}${reportSheet()}`,
};

export const LUX_POSES = Object.keys(POSES);

/** SVG Lux sebagai string. */
export function luxSvg(pose = 'wave', { size = 96, title = '' } = {}) {
  const draw = POSES[pose] || POSES.wave;
  const label = title ? `<title>${title}</title>` : '';
  return `<svg class="lux lux-${pose}" width="${size}" height="${size}" viewBox="0 0 120 120" role="${title ? 'img' : 'presentation'}" ${title ? '' : 'aria-hidden="true"'} xmlns="http://www.w3.org/2000/svg">${label}<g class="lux-bob">${draw()}</g></svg>`;
}

/** Elemen Lux (opsional dengan balon kata). Mengembalikan null bila maskot dimatikan. */
export function renderLux(state, pose = 'wave', { size = 96, say = '', className = '' } = {}) {
  if (state?.mascotOn === false) return null;
  const wrap = document.createElement('div');
  wrap.className = `lux-wrap${className ? ` ${className}` : ''}`;
  wrap.innerHTML = luxSvg(pose, { size });
  if (say) {
    const b = document.createElement('div');
    b.className = 'lux-say';
    b.textContent = say;
    wrap.appendChild(b);
  }
  return wrap;
}
