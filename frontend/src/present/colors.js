// Warna maket dari swatch material (color_hex) dan pemilihan latar yang kontras.
// Hanya tampilan: warna swatch tidak dipakai dalam perhitungan (engine memakai α, U, SC).

// Sama dengan _DEFAULT_CATEGORY_HEX di backend (materials_and_epw.py).
export const CATEGORY_HEX = { glazing: '#6898ba', wall: '#c4bdb2', frame: '#5c5a54', roof: '#8e877c' };
const HEX = /^#?[0-9a-f]{6}$/i;
const norm = (h) => (HEX.test(String(h || '').trim()) ? '#' + String(h).trim().replace('#', '').toLowerCase() : null);

/** catalog = state.materials (objek dengan .materials, atau daftar), settings = state.config.settings. */
export function colorResolver(catalog, settings) {
  const list = Array.isArray(catalog) ? catalog : catalog?.materials || [];
  const byId = new Map();
  for (const m of [...list, ...(settings?.custom_materials || [])]) if (m?.id) byId.set(m.id, m);
  const hexOf = (id, category) => norm(byId.get(id)?.color_hex) || CATEGORY_HEX[category] || CATEGORY_HEX.wall;
  return {
    panel(p) {
      const glass = p.element_type === 'glazing' || p.element_type === 'composite_cw';
      return { hex: hexOf(p.material_id, glass ? 'glazing' : 'wall'), glass };
    },
    shading: () => hexOf(settings?.frame_material_id, 'frame'),
    frame: () => hexOf(settings?.frame_material_id, 'frame'),
    roof: () => hexOf(settings?.roof_material_id, 'roof'),
  };
}

// Luminans relatif WCAG 2.x.
export function luminance(hex) {
  const n = parseInt(norm(hex)?.slice(1) || 'ffffff', 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Tema panggung: ikut tema aplikasi, kecuali latarnya gelap dan ada material besar (≥ 15% luas) dengan
 * kontras < 3:1 terhadap latar (WCAG objek non-teks): material gelap tenggelam di latar gelap karena
 * bayangan tidak terlihat. Material terang di latar terang tidak dianggap masalah: bayangan, AO, dan
 * garis maket tetap memisahkannya (gaya maket putih).
 * swatches = [{ hex, area }], bg = { light: '#..', dark: '#..' }.
 */
export function pickStageTheme(appTheme, swatches, bg) {
  const total = swatches.reduce((s, x) => s + x.area, 0) || 1;
  const big = swatches.filter((x) => x.area / total >= 0.15);
  const clashes = (theme) => (luminance(bg[theme]) >= 0.2 ? [] : big.filter((x) => contrast(x.hex, bg[theme]) < 3));
  const worst = clashes(appTheme);
  if (!worst.length) return { theme: appTheme, switched: false };
  const other = appTheme === 'dark' ? 'light' : 'dark';
  return { theme: other, switched: true, reason: worst.map((x) => x.hex) };
}
