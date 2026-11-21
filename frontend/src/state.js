/**
 * LUXA Single Source of Truth State Store (`ProjectConfig` v2 + UI state).
 * Tiny pub/sub emitter; no external framework required.
 */

export function createDefaultConfig() {
  return {
    version: 2,
    model: {
      file: null,
      unit_mode: 'auto',
      up_axis: 'auto',
      z_ground_cutoff_m: 0.0,
      exterior_detection_mode: 'auto',
      outer_skin_only: true,
      restore_filtered: [],
      model_scope: null,
      expected_floors: null,
      accepted_flags: [],
    },
    roles: {
      group_category_overrides: {},
      disabled_groups: [],
      group_wwr_map: {},
      group_material_map: {},
      face_category_overrides: {},
      face_z_band_overrides: [],
      auto_split_merged_cw: false,
      groups_to_auto_split: [],
    },
    settings: {
      city_preset: 'jakarta',
      custom_epw: null,
      mode: 'sni',
      sf_source: 'template_prodi',
      sceff_table_mode: 'terkoreksi',
      design_month: 9,
      north_angle_deg: 0.0,
      glazing_material_id: 'glz_igu_triple_silver',
      wall_material_id: 'wal_spandrel_insulasi_50',
      frame_material_id: 'frm_aluminium_thermal_break',
      roof_material_id: 'rf_dak_beton_120_insulasi',
      custom_materials: [],
      orientation_material_overrides: {},
      include_frame_conduction: true,
      frame_area_ratio: 0.08,
      wwr_override: null,
      default_wall_wwr: null,
      floor_mode: 'auto',
      floor_height_m: null,
      custom_floor_zones: [],
      section_floor_min: null,
      section_floor_max: null,
    },
    advanced: {
      nurbs_u_div: 4,
      nurbs_v_div: 2,
      enable_parametric_louvers: false,
      louver_depth_m: 0.65,
      louver_spacing_m: 1.1,
      louver_tilt_deg: 22.0,
      frame_width_threshold_m: 0.28,
      spandrel_height_threshold_m: 1.15,
    },
    saved_views: [],
  };
}

export function mergeConfig(partial) {
  const base = createDefaultConfig();
  if (!partial || typeof partial !== 'object') return base;
  return {
    version: 2,
    model: { ...base.model, ...(partial.model || {}) },
    roles: {
      ...base.roles,
      ...(partial.roles || {}),
      group_category_overrides: { ...(partial.roles?.group_category_overrides || {}) },
      disabled_groups: [...(partial.roles?.disabled_groups || [])],
      group_wwr_map: { ...(partial.roles?.group_wwr_map || {}) },
      group_material_map: { ...(partial.roles?.group_material_map || {}) },
      face_category_overrides: { ...(partial.roles?.face_category_overrides || {}) },
      face_z_band_overrides: [...(partial.roles?.face_z_band_overrides || [])],
      groups_to_auto_split: [...(partial.roles?.groups_to_auto_split || [])],
    },
    settings: {
      ...base.settings,
      ...(partial.settings || {}),
      custom_materials: [...(partial.settings?.custom_materials || [])],
      orientation_material_overrides: { ...(partial.settings?.orientation_material_overrides || {}) },
      custom_floor_zones: [...(partial.settings?.custom_floor_zones || [])],
    },
    advanced: { ...base.advanced, ...(partial.advanced || {}) },
    saved_views: Array.isArray(partial.saved_views)
      ? partial.saved_views.map((v) => ({ ...v, camera: v?.camera ? { ...v.camera } : null }))
      : [],
  };
}

export function createInitialConfirm() {
  return {
    unitConfirmed: false,
    groundConfirmed: false,
    groundChoice: null, // 'file_zero' | 'model_base'
    scopeConfirmed: false,
    noGlazingConfirmed: false,
    noGlazingChoice: null, // 'zero_wwr' | 'assumed_wwr'
  };
}

const initialState = {
  step: 'upload', // 'upload' | 'confirm' | 'inspect' | 'results' | 'loading' | 'error'
  previousStep: 'upload',
  theme: 'light', // 'light' | 'dark'
  advancedMode: false,
  activeRailCard: null, // null | 'model' | 'material' | 'location' | 'display' | 'compare' | 'report' | 'help'

  modelId: null,
  filename: null,
  fileSizeBytes: null,
  fileSignature: null,
  config: createDefaultConfig(),
  confirm: createInitialConfirm(),

  inspectData: null,
  analysisData: null,

  // UI flags & selections
  acknowledgedFlags: {}, // { [flagId]: { action, provisional } }
  viewerMode: 'classification', // 'classification' | 'orientation' | 'heatmap' | 'anomalies' | 'xray'
  heatmapGranularity: 'orientation', // 'orientation' | 'panel'
  cameraProjection: 'perspective', // 'perspective' | 'two_point' | 'axonometric' | 'elevation'
  cameraDirection: 'B', // 'U' | 'TL' | 'T' | 'TG' | 'S' | 'BD' | 'B' | 'BL' | 'Atas'
  activeViewId: null,
  captureScale: 2, // 1 | 2 | 4
  openPopover: null, // null | 'direction' | 'views' | 'capture'
  commandPaletteOpen: false,
  shortcutsModalOpen: false,
  selectedGroup: null,
  selectedOrientation: null,
  selectedPanelIds: [],
  needsRecompute: false,

  // Fase 4b-2: Sun dome, exposure filter & formula pill
  sunDate: '2026-09-23', // '2026-06-21' | '2026-09-23' | '2026-12-21' | YYYY-MM-DD
  sunHour: 13, // 6..18
  sunPlaying: false,
  sunDomeVisible: true,
  sunDomeScale: 100, // 50..200 (%)
  facadeFilter: 'all', // 'all' | 'selected_orientation' | 'sunlit_now'
  exposureData: null,
  exposureLoading: false,
  formulaPillExpanded: false,

  // Catalog caches
  materials: {
    materials: [],
    glazing_materials: [],
    wall_materials: [],
    frame_materials: [],
    roof_materials: [],
  },
  locations: {
    cities: [],
    sni_cities: [],
    template_prodi_cities: [],
  },
  availableModels: [],

  // Loading & Error states
  loading: null,
  error: null,
};

let state = initialState;
const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error('[LUXA state listener error]', err);
    }
  }
}

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
  state = next;
  notify();
  return state;
}

export function updateConfig(updater) {
  const cloned = mergeConfig(state.config);
  updater(cloned);
  state = { ...state, config: cloned };
  notify();
  return state;
}

/**
 * Computes Konfirmasi readiness gate shared by Konfirmasi and Inspeksi screens.
 * Spec §3.2 & §10: Hitung button stays locked until every Konfirmasi row is green.
 */
export function evaluateConfirmGate(s = state) {
  const ins = s.inspectData;
  if (!ins) {
    return {
      ready: false,
      missingLabel: 'Unggah model terlebih dahulu',
      needsUnit: false,
      needsGround: false,
      needsScope: true,
      needsNoGlazing: false,
    };
  }

  const audit = ins.stage1_audit || {};
  const flags = ins.sanity_flags || [];
  const hasNoGlazingFlag = flags.some((f) => f.code === 'NO_GLAZING');

  const needsUnit = Boolean(audit.unit_needs_confirmation || audit.unit_source === 'bbox_guess');
  const unitOk = !needsUnit || Boolean(s.confirm.unitConfirmed) || s.config.model.unit_mode !== 'auto';

  const zOffset = Number(audit.z_ground_offset_m || 0);
  const needsGround = zOffset < -0.5;
  const groundOk = !needsGround || Boolean(s.confirm.groundConfirmed);

  const scopeOk = Boolean(s.config.model.model_scope) && Boolean(s.confirm.scopeConfirmed);

  const needsNoGlazing = hasNoGlazingFlag;
  const noGlazingOk =
    !needsNoGlazing ||
    Boolean(s.confirm.noGlazingConfirmed) ||
    s.config.settings.default_wall_wwr !== null;

  let missingLabel = '';
  if (!unitOk) {
    missingLabel = 'Konfirmasi satuan file dulu';
  } else if (!groundOk) {
    missingLabel = 'Pilih muka tanah dulu';
  } else if (!scopeOk) {
    missingLabel = 'Pilih isi model dulu';
  } else if (!noGlazingOk) {
    missingLabel = 'Konfirmasi kondisi tanpa kaca dulu';
  }

  return {
    ready: unitOk && groundOk && scopeOk && noGlazingOk,
    missingLabel,
    needsUnit,
    unitOk,
    needsGround,
    groundOk,
    scopeOk,
    needsNoGlazing,
    noGlazingOk,
  };
}

/**
 * Returns accepted provisional flag IDs to send in `config.model.accepted_flags`.
 */
export function collectAcceptedProvisionalFlags(s = state) {
  const flags = s.inspectData?.sanity_flags || [];
  const out = [];
  for (const flag of flags) {
    if (!flag.accept_makes_provisional) continue;
    const ack = s.acknowledgedFlags[flag.id];
    if (ack && ack.provisional) {
      out.push(flag.id);
    }
  }
  return out;
}

/**
 * Returns user_answers dict sent to `/inspect` so backend clears answered flags.
 */
export function buildUserAnswers(s = state) {
  return {
    unit_confirmed: Boolean(s.confirm.unitConfirmed || s.config.model.unit_mode !== 'auto'),
    ground_confirmed: Boolean(s.confirm.groundConfirmed),
    model_scope: s.config.model.model_scope || null,
    expected_floors: s.config.model.expected_floors || null,
    no_glazing_choice: s.confirm.noGlazingChoice || null,
    default_wall_wwr: s.config.settings.default_wall_wwr,
  };
}

export const STEP_TITLES = {
  upload: 'Unggah model',
  confirm: 'Konfirmasi model',
  inspect: 'Inspeksi model',
  results: 'Hasil',
  loading: 'Memproses model',
  error: 'Terjadi kendala',
};
