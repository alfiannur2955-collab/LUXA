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
      sf_source: 'sni2020',
      sceff_table_mode: 'terkoreksi',
      design_month: 9,
      north_angle_deg: 0.0,
      // A3-01: false sampai pengguna memilih/mengonfirmasi material; hasil berstatus sementara
      materials_confirmed: false,
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
      sun_dome_radius_m: null,
      exposure_scale: { mode: 'sni', min: 80, max: 250 }, // tampilan Matahari sepanjang tahun saja
      compute_rttv: false, // RTTV opsional (Mode lanjut)
      rttv_skylight_groups: [], // grup kaca yang ditandai skylight oleh pengguna
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
      // Legacy v2 configs before R4 persisted default 3.6 even in auto mode; treat as unset unless uniform
      floor_height_m:
        (partial.settings?.floor_mode || 'auto') === 'auto' && partial.settings?.floor_height_m === 3.6
          ? null
          : partial.settings?.floor_height_m ?? base.settings.floor_height_m,
      custom_materials: [...(partial.settings?.custom_materials || [])],
      orientation_material_overrides: { ...(partial.settings?.orientation_material_overrides || {}) },
      custom_floor_zones: [...(partial.settings?.custom_floor_zones || [])],
      // RTTV opsional: hanya aktif bila pengguna menyalakannya; skylight hanya dari grup yang ditandai.
      compute_rttv: partial.settings?.compute_rttv === true,
      rttv_skylight_groups: Array.isArray(partial.settings?.rttv_skylight_groups) ? [...partial.settings.rttv_skylight_groups] : [],
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
  step: 'home', // 'home' | 'learn' | 'upload' | 'confirm' | 'inspect' | 'results' | 'compare' | 'loading' | 'error'
  learnChapter: 0, // bab aktif di adegan 3D: 0 = Beranda, 1..8 = Bab Belajar OTTV
  mascotOn: (() => {
    try {
      return window.localStorage.getItem('luxa.mascot.v1') !== 'off';
    } catch {
      return true;
    }
  })(), // maskot Lux tampil (bisa dimatikan di kartu Tampilan)
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
  viewerMode: 'classification', // 'classification' | 'orientation' | 'heatmap' | 'sun'
  sunView: 'year', // mode Matahari: 'year' (sepanjang tahun) | 'now' (tanggal & jam aktif)
  overlayCheck: false, // alat periksa: Perlu dicek
  overlayXray: false, // alat periksa: Transparan
  heatmapGranularity: 'orientation', // 'orientation' | 'panel'
  heatmapSmooth: false, // lama (Halus); digantikan mode 'exposure'
  exposureShading: true, // mode Paparan: kalikan faktor peneduh 3D
  cameraProjection: 'perspective', // 'perspective' | 'two_point' | 'axonometric' | 'elevation'
  cameraDirection: 'TG', // 'U' | 'TL' | 'T' | 'TG' | 'S' | 'BD' | 'B' | 'BL' | 'Atas'
  activeViewId: null,
  captureScale: 2, // 1 | 2 | 4
  openPopover: null, // null | 'direction' | 'views' | 'capture'
  commandPaletteOpen: false,
  presentation: false, // Mode Presentasi terbuka (tidak disimpan)
  shortcutsModalOpen: false,
  materialCatalog: null, // null | { open: true, mode: 'browse'|'pick', tab: 'catalog'|'recommend', lockedCategory, targetField, targetOrientCode, targetLabel }
  selectedGroup: null,
  selectedOrientation: null,
  isolatedOrientation: null, // arah yang diisolasi dari kartu "Per arah" (arah lain diredupkan)
  selectedPanelIds: [],
  needsRecompute: false,

  // Fase 5b: in-browser engine loading status {phase: idle|boot|lazy|ready|error, label, progress}
  engineMode: 'browser',
  engineStatus: { phase: 'idle', label: '', progress: 0 },

  // Fase 4b-2 + 4d: Sun dome (D1 manual radius in meters), north rotation mode (D2), exposure filter & formula pill
  sunDate: '2026-09-23', // '2026-06-21' | '2026-09-23' | '2026-12-21' | YYYY-MM-DD
  sunHour: 13, // 6..18
  sunPlaying: false,
  sunDomeVisible: true,
  sunDomeRadiusM: null, // D1: meters, initialized once on model load and saved in .ottv.json
  sunDomeInitialRadiusM: null, // D1: reference initial radius (1.6 * halfPlanDiag rounded to 1 m) for log slider 0.2x..10x
  northRotateMode: false, // D2: floor ring + D5 drag handle active (toggle with R)
  facadeFilter: 'all', // 'all' | 'selected_orientation' | 'sunlit_now'
  exposureData: null,
  exposureLoading: false,
  formulaPillExpanded: false,

  // Fase 4c: Compare mode, design history & Workspace v1
  alternatives: [], // [{ id, code, name, kind: 'settings'|'model', config, analysisData, modelId?, filename?, createdAt }]
  compareModelDraft: null, // Bandingkan: model kedua yang sedang disiapkan
  proceedBusy: false, // Konfirmasi -> Inspeksi sedang memproses
  inspectBusy: false, // inspeksi sedang dibaca ulang
  captureLayout: 'panel', // 'panel' (dengan panel info) | 'overlay' (seperti layar)
  captureInclude: { legend: true, ottv: true, labels: true, info: true },
  activeAlternativeId: null,
  compareSplitRatio: 0.5, // 0.10 .. 0.90
  compareBusy: false,
  designHistory: [], // [{ id, label, config, analysisData, savedAt }]
  workspace: {
    preset: 'belajar', // 'belajar' | 'lanjut'
    railOrder: ['model', 'material', 'location', 'display', 'compare', 'report'],
    hiddenRailItems: [],
    modeBarPosition: 'top', // 'top' | 'bottom'
  },
  dockCustomizerOpen: false,

  // Catalog caches
  serverMaterialsCatalog: null,
  materials: {
    materials: [],
    glazing_materials: [],
    wall_materials: [],
    frame_materials: [],
    roof_materials: [],
    brands: [],
    alpha_table_1: [],
    alpha_table_2: [],
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

export function computeInitialSunDomeRadiusM(bbox) {
  if (!bbox) return 24;
  const spanX = Math.max(2, Number(bbox.span?.[0] || 15));
  const spanY = Math.max(2, Number(bbox.span?.[1] || 15));
  const halfPlanDiag = 0.5 * Math.hypot(spanX, spanY);
  return Math.max(4, Math.round(1.6 * halfPlanDiag));
}

export function parseDecimalInput(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export const STEP_TITLES = {
  home: 'Beranda',
  learn: 'Belajar OTTV',
  upload: 'Unggah model',
  confirm: 'Konfirmasi model',
  inspect: 'Inspeksi model',
  results: 'Hasil',
  compare: 'Bandingkan',
  loading: 'Memproses model',
  error: 'Terjadi kendala',
};
