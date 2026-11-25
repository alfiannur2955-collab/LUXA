/**
 * Project persistence: save/open `.ottv.json` files and auto-save to `localStorage`.
 * Rules (`docs/FASE4_UI_SPEC.md` §2):
 * - All `localStorage` access is wrapped in `try/catch`.
 * - Never writes silently to the server (server persistence happens only on Hitung).
 */

import { mergeConfig } from './state.js';

const STORAGE_PROJECT_KEY = 'luxa.project.v1';
const STORAGE_PROJECTS_LIST_KEY = 'luxa.projects.v1';
const STORAGE_THEME_KEY = 'luxa.theme.v1';

export function listSavedProjects() {
  try {
    const raw = window.localStorage.getItem(STORAGE_PROJECTS_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => ({
      ...p,
      config: mergeConfig(p.config),
    }));
  } catch {
    return [];
  }
}

function writeSavedProjects(list) {
  try {
    window.localStorage.setItem(STORAGE_PROJECTS_LIST_KEY, JSON.stringify(list || []));
  } catch {
    // ignore quota errors
  }
}

export function saveNamedProject(state, customName = '') {
  if (!state?.modelId) return null;
  const list = listSavedProjects();
  const baseName =
    String(customName || '').trim() ||
    (state.filename || 'Proyek LUXA').replace(/\.[^.]+$/, '');
  const now = new Date().toISOString();
  const rec = {
    id: `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: baseName,
    modelId: state.modelId,
    filename: state.filename || baseName,
    config: mergeConfig(state.config),
    confirm: state.confirm ? { ...state.confirm } : null,
    ottv_total_wm2: state.analysisData?.ottv_total_wm2 ?? null,
    saved_at: now,
  };
  writeSavedProjects([rec, ...list]);
  return rec;
}

export function renameSavedProject(projectId, newName) {
  const clean = String(newName || '').trim();
  if (!clean) return listSavedProjects();
  const next = listSavedProjects().map((p) => (p.id === projectId ? { ...p, name: clean } : p));
  writeSavedProjects(next);
  return next;
}

export function duplicateSavedProject(projectId) {
  const list = listSavedProjects();
  const src = list.find((p) => p.id === projectId);
  if (!src) return null;
  const copy = {
    ...src,
    id: `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: `${src.name} (Salinan)`,
    config: mergeConfig(src.config),
    saved_at: new Date().toISOString(),
  };
  writeSavedProjects([copy, ...list]);
  return copy;
}

export function deleteSavedProject(projectId) {
  const next = listSavedProjects().filter((p) => p.id !== projectId);
  writeSavedProjects(next);
  return next;
}

export function loadSavedTheme() {
  try {
    const val = window.localStorage.getItem(STORAGE_THEME_KEY);
    if (val === 'dark' || val === 'light') return val;
  } catch {
    // ignore storage failures
  }
  return 'light';
}

export function saveTheme(theme) {
  try {
    window.localStorage.setItem(STORAGE_THEME_KEY, theme === 'dark' ? 'dark' : 'light');
  } catch {
    // ignore storage failures
  }
}

export function saveProjectAutosave(state) {
  if (!state?.modelId) return;
  try {
    const payload = {
      version: 2,
      saved_at: new Date().toISOString(),
      model_id: state.modelId,
      filename: state.filename,
      config: state.config,
      confirm: state.confirm,
    };
    window.localStorage.setItem(STORAGE_PROJECT_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota or privacy mode errors
  }
}

export function loadProjectAutosave() {
  try {
    const raw = window.localStorage.getItem(STORAGE_PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      modelId: parsed.model_id || null,
      filename: parsed.filename || null,
      config: mergeConfig(parsed.config),
      confirm: parsed.confirm || null,
    };
  } catch {
    return null;
  }
}

export function clearProjectAutosave() {
  try {
    window.localStorage.removeItem(STORAGE_PROJECT_KEY);
  } catch {
    // ignore
  }
}

export function downloadProjectFile(state) {
  const baseName = (state.filename || 'proyek_luxa').replace(/\.[^.]+$/, '');
  const payload = {
    ...state.config,
    version: 2,
    luxa_meta: {
      model_id: state.modelId || null,
      filename: state.filename || null,
      exported_at: new Date().toISOString(),
      confirm: state.confirm || null,
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.ottv.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parses a `.ottv.json` file uploaded by the user (supports v2 and legacy v1 keys).
 */
export async function readProjectFile(file) {
  const text = await file.text();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Isi file .ottv.json bukan JSON yang valid.');
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Struktur file .ottv.json tidak dikenali.');
  }

  let config;
  if (raw.version === 2 || raw.versi === 2 || (raw.model && raw.settings)) {
    config = mergeConfig(raw);
  } else {
    // Minimal client-side v1 normalization (backend also runs migrate_v1)
    config = mergeConfig({
      model: {
        file: raw.filename || raw.file || null,
        unit_mode: raw.unit_mode || 'auto',
        up_axis: raw.up_axis || 'auto',
        z_ground_cutoff_m: Number(raw.z_ground_cutoff_m || 0),
        exterior_detection_mode: raw.exterior_detection_mode || 'auto',
        outer_skin_only: raw.outer_skin_only !== false,
        restore_filtered: Array.isArray(raw.restore_filtered) ? raw.restore_filtered : [],
      },
      roles: {
        group_category_overrides: raw.group_category_overrides || {},
        disabled_groups: Array.isArray(raw.disabled_groups) ? raw.disabled_groups : [],
        group_wwr_map: raw.group_wwr_map || {},
        group_material_map: raw.group_material_map || {},
        face_category_overrides: raw.face_category_overrides || {},
        face_z_band_overrides: Array.isArray(raw.face_z_band_overrides) ? raw.face_z_band_overrides : [],
        auto_split_merged_cw: Boolean(raw.auto_split_merged_cw),
      },
      settings: {
        city_preset: raw.city_preset || 'jakarta',
        mode: raw.mode || 'sni',
        sf_source: raw.sf_source || 'sni2020',
        north_angle_deg: Number(raw.north_angle_deg || 0),
        glazing_material_id: raw.glazing_material_id || 'glz_igu_triple_silver',
        wall_material_id: raw.wall_material_id || 'wal_spandrel_insulasi_50',
        frame_material_id: raw.frame_material_id || 'frm_aluminium_standar',
        roof_material_id: raw.roof_material_id || 'rf_dak_beton_120_insulasi',
      },
    });
  }

  return {
    config,
    modelId: raw.luxa_meta?.model_id || null,
    filename: raw.luxa_meta?.filename || config.model.file || null,
    confirm: raw.luxa_meta?.confirm || null,
  };
}
