/**
 * Safe HTML escaping and Indonesian locale number formatting.
 * Rule (`docs/FASE4_UI_SPEC.md` §2): ALL text from model files (layer names,
 * material names, filenames) MUST go through `textContent` or `escapeHtml()`.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a number in Indonesian notation (comma decimal, dot thousands).
 */
export function fmtId(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('id-ID');
}

export function fmtFileSize(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b >= 1024 * 1024) {
    return `${fmtId(b / (1024 * 1024), 1)} MB`;
  }
  if (b >= 1024) {
    return `${Math.round(b / 1024)} KB`;
  }
  return `${Math.round(b)} B`;
}
