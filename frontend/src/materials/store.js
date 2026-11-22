/**
 * Client-Side Material & Local Price Store (`docs/RENCANA.md` Fase 4e):
 * - User custom materials stored in `localStorage` (`luxa.materials.v1`), wrapped in `try/catch`.
 * - User optional prices (`Rp/m²`) stored strictly locally in `localStorage` (`luxa.prices.v1`)
 *   and NEVER transmitted to the server or embedded in built-in data.
 * - Export/Import user materials as JSON file.
 * - `syncUsedCustomMaterialsToConfig` copies referenced user materials into `config.settings.custom_materials`.
 */

const STORAGE_USER_MATERIALS_KEY = 'luxa.materials.v1';
const STORAGE_USER_PRICES_KEY = 'luxa.prices.v1';

export const SC_TO_SHGC_RATIO = 0.87;

export function loadUserMaterials() {
  try {
    const raw = window.localStorage.getItem(STORAGE_USER_MATERIALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && typeof m === 'object' && m.id && m.name)
      .map((m) => ({
        ...m,
        origin: 'user',
        origin_label: 'Buatan saya',
        is_custom: true,
      }));
  } catch {
    return [];
  }
}

export function saveAllUserMaterials(list) {
  try {
    const clean = (list || []).map((m) => ({
      ...m,
      origin: 'user',
      origin_label: 'Buatan saya',
      is_custom: true,
    }));
    window.localStorage.setItem(STORAGE_USER_MATERIALS_KEY, JSON.stringify(clean));
  } catch {
    // ignore quota / privacy errors
  }
}

export function upsertUserMaterial(mat) {
  const list = loadUserMaterials();
  const rec = {
    ...mat,
    id: mat.id || `usr_${mat.category || 'glazing'}_${Date.now().toString(36)}`,
    origin: 'user',
    origin_label: 'Buatan saya',
    is_custom: true,
  };
  const idx = list.findIndex((m) => m.id === rec.id);
  if (idx >= 0) {
    list[idx] = rec;
  } else {
    list.unshift(rec);
  }
  saveAllUserMaterials(list);
  return rec;
}

export function deleteUserMaterialById(matId) {
  const prev = loadUserMaterials();
  const next = prev.filter((m) => m.id !== matId);
  saveAllUserMaterials(next);
  return { prev, next };
}

export function loadUserPrices() {
  try {
    const raw = window.localStorage.getItem(STORAGE_USER_PRICES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function setUserPrice(matId, priceRpM2) {
  const map = loadUserPrices();
  const n = Number(priceRpM2);
  if (!Number.isFinite(n) || n <= 0) {
    delete map[matId];
  } else {
    map[matId] = Math.round(n);
  }
  try {
    window.localStorage.setItem(STORAGE_USER_PRICES_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
  return map;
}

export function getMergedCatalog(serverCatalog) {
  const baseMats = serverCatalog?.materials || [];
  const userMats = loadUserMaterials();
  const byId = new Map();
  for (const m of baseMats) {
    if (m?.id) byId.set(m.id, m);
  }
  for (const um of userMats) {
    if (um?.id) byId.set(um.id, um);
  }
  const all = [...byId.values()];
  const brands = [...new Set(all.map((m) => String(m.brand || '').trim()).filter(Boolean))].sort();
  return {
    ...(serverCatalog || {}),
    materials: all,
    glazing_materials: all.filter((m) => m.category === 'glazing'),
    wall_materials: all.filter((m) => m.category === 'wall'),
    frame_materials: all.filter((m) => m.category === 'frame'),
    roof_materials: all.filter((m) => m.category === 'roof'),
    brands,
  };
}

/**
 * Copies every user material referenced anywhere in `config` into `config.settings.custom_materials`
 * so `.ottv.json` and backend `/analyze` or `/rematerial` are completely self-contained.
 */
export function syncUsedCustomMaterialsToConfig(config, mergedCatalog = null) {
  const userList = loadUserMaterials();
  const userById = new Map(userList.map((m) => [m.id, m]));
  // Also preserve any custom materials already carried inside config (e.g. from opened .ottv.json)
  for (const cm of config?.settings?.custom_materials || []) {
    if (cm?.id && !userById.has(cm.id)) {
      userById.set(cm.id, cm);
    }
  }
  if (mergedCatalog?.materials) {
    for (const m of mergedCatalog.materials) {
      if (m?.id && m.origin === 'user' && !userById.has(m.id)) {
        userById.set(m.id, m);
      }
    }
  }

  const referencedIds = new Set();
  const s = config?.settings || {};
  for (const key of ['glazing_material_id', 'wall_material_id', 'frame_material_id', 'roof_material_id']) {
    if (s[key]) referencedIds.add(s[key]);
  }
  for (const mid of Object.values(s.orientation_material_overrides || {})) {
    if (mid) referencedIds.add(mid);
  }
  for (const mid of Object.values(config?.roles?.group_material_map || {})) {
    if (mid) referencedIds.add(mid);
  }

  const usedCustom = [];
  for (const id of referencedIds) {
    const found = userById.get(id);
    if (found) usedCustom.push(found);
  }
  if (config?.settings) {
    config.settings.custom_materials = usedCustom;
  }
  return usedCustom;
}

export function countMaterialUsage(config, matId) {
  let count = 0;
  const s = config?.settings || {};
  for (const key of ['glazing_material_id', 'wall_material_id', 'frame_material_id', 'roof_material_id']) {
    if (s[key] === matId) count += 1;
  }
  for (const mid of Object.values(s.orientation_material_overrides || {})) {
    if (mid === matId) count += 1;
  }
  for (const mid of Object.values(config?.roles?.group_material_map || {})) {
    if (mid === matId) count += 1;
  }
  return count;
}

export function replaceMaterialInConfig(config, oldId, newId) {
  const s = config?.settings;
  if (s) {
    for (const key of ['glazing_material_id', 'wall_material_id', 'frame_material_id', 'roof_material_id']) {
      if (s[key] === oldId) s[key] = newId;
    }
    const ori = s.orientation_material_overrides || {};
    for (const [k, v] of Object.entries(ori)) {
      if (v === oldId) ori[k] = newId;
    }
    s.custom_materials = (s.custom_materials || []).filter((m) => m.id !== oldId);
  }
  const gmap = config?.roles?.group_material_map || {};
  for (const [k, v] of Object.entries(gmap)) {
    if (v === oldId) gmap[k] = newId;
  }
}

export function exportUserMaterialsJson() {
  const list = loadUserMaterials();
  const payload = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    materials: list,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'luxa-material-kustom.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return list.length;
}

export async function importUserMaterialsJson(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File bukan JSON yang valid.');
  }
  const items = Array.isArray(parsed) ? parsed : parsed?.materials;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Tidak ditemukan daftar material di file JSON.');
  }
  let added = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || !item.name) continue;
    upsertUserMaterial({
      ...item,
      id: item.id && String(item.id).startsWith('usr_') ? item.id : `usr_${item.category || 'glazing'}_${Date.now().toString(36)}_${added}`,
    });
    added += 1;
  }
  return added;
}

/**
 * Computes local SNI Table 7/9 TD_EK preview from mass (kg/m²) for wall or roof in the Material Form.
 */
export function lookupTdekLocal(category, massaKgM2) {
  const m = Number(massaKgM2);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (category === 'wall') {
    if (m < 125) return 15;
    if (m <= 195) return 12;
    return 10;
  }
  if (category === 'roof') {
    if (m < 50) return 24;
    if (m <= 230) return 20;
    return 16;
  }
  return null;
}

/**
 * Pure client-side cost efficiency enrichment (prices NEVER leave the browser).
 */
export function enrichCandidatesWithLocalPrices(candidates, targetAreaM2, pricesMap) {
  const area = Number(targetAreaM2 || 0);
  return (candidates || []).map((c) => {
    const p = pricesMap?.[c.material_id];
    if (!p || p <= 0 || area <= 0.01) {
      return { ...c, price_rp_m2: null, estimated_cost_rp: null, delta_ottv_per_million_rp: null };
    }
    const cost = Math.round(p * area);
    const eff = cost > 0 ? Math.round(((-Number(c.delta_ottv_wm2 || 0)) / (cost / 1_000_000)) * 1000) / 1000 : null;
    return {
      ...c,
      price_rp_m2: p,
      estimated_cost_rp: cost,
      delta_ottv_per_million_rp: eff,
    };
  });
}

/**
 * Client-side "Biaya terendah" option computed strictly locally from user prices in `luxa.prices.v1`.
 */
export function computeLocalLowestCostOption(candidates, currentOttv, targetOttv, totalGlazingArea, pricesMap, curGlzId) {
  if (!pricesMap || Object.keys(pricesMap).length === 0 || totalGlazingArea <= 0.01) return null;
  const feasible = (candidates || [])
    .filter((c) => pricesMap[c.material_id] > 0 && Number(c.new_ottv_wm2) <= Number(targetOttv) + 1e-6)
    .map((c) => ({
      ...c,
      costRp: Math.round(pricesMap[c.material_id] * totalGlazingArea),
    }))
    .sort((a, b) => a.costRp - b.costRp || a.new_ottv_wm2 - b.new_ottv_wm2);
  if (feasible.length === 0) return null;
  const best = feasible[0];
  return {
    option_id: 'lowest_cost',
    title: 'Biaya terendah',
    subtitle: 'Dihitung lokal di browser dari harga Rp/m² yang kamu isi.',
    new_ottv_wm2: best.new_ottv_wm2,
    delta_ottv_wm2: Math.round((best.new_ottv_wm2 - currentOttv) * 100) / 100,
    meets_target: true,
    changed_count: best.material_id === curGlzId ? 0 : 1,
    changes: [
      {
        scope: 'Semua orientasi',
        orientation_code: null,
        material_id: best.material_id,
        material_name: best.name,
        brand: best.brand,
        vlt: best.vlt,
        sc: best.sc,
      },
    ],
    apply_patch: {
      glazing_material_id: best.material_id,
      orientation_material_overrides: {},
    },
    estimated_cost_rp: best.costRp,
  };
}
