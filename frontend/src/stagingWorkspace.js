import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ============================================================================
// OTTV 3D PARAMETRIC STUDIO v5.0 — VIEW 1: INTAKE & 3D STAGING INSPECTION
// ============================================================================

const ROLE_STYLES = {
  glazing:      { label: 'Kaca Vision',          color: 0x0ea5e9, hex: '#0ea5e9', opacity: 0.72, badge: 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-200' },
  spandrel:     { label: 'Spandrel',             color: 0xf59e0b, hex: '#f59e0b', opacity: 0.94, badge: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200' },
  wall:         { label: 'Dinding Masif',        color: 0x94a3b8, hex: '#94a3b8', opacity: 0.94, badge: 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-200' },
  composite_cw: { label: 'CW Komposit (WWR%)',   color: 0x8b5cf6, hex: '#8b5cf6', opacity: 0.85, badge: 'bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-200' },
  frame:        { label: 'Rangka / Mullion',     color: 0x334155, hex: '#334155', opacity: 0.96, badge: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-200' },
  shading:      { label: 'Peneduh / Tetangga',   color: 0x6366f1, hex: '#6366f1', opacity: 0.88, badge: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-200' },
  roof:         { label: 'Atap / Plat (Non-OTTV)', color: 0x78716c, hex: '#78716c', opacity: 0.78, badge: 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-300' },
  ignore:       { label: 'Abaikan / Tapak',      color: 0xcbd5e1, hex: '#cbd5e1', opacity: 0.22, badge: 'bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-300' },
};

const QUICK_ROLES = [
  { id: 'glazing', label: 'Kaca Vision' },
  { id: 'spandrel', label: 'Spandrel' },
  { id: 'wall', label: 'Dinding Masif' },
  { id: 'composite_cw', label: 'CW Komposit' },
  { id: 'frame', label: 'Rangka' },
  { id: 'shading', label: 'Gedung Tetangga / Peneduh' },
  { id: 'roof', label: 'Atap / Plat' },
  { id: 'ignore', label: 'Abaikan / Tapak' },
];

// Built-in client fallback mirroring backend SOFTWARE_PROFILES so Step 1 can NEVER appear blank
const FALLBACK_SOFTWARE_PROFILES = [
  {
    id: 'archicad',
    name: 'Graphisoft Archicad',
    subtitle: 'Archicad 24 – 30 (BIM Curtain Wall & Building)',
    badge: 'BIM Native · OpenCASCADE',
    supported_formats: ['.ifc', '.3dm', '.obj', '.zip', '.glb'],
    recommended_format: '.ifc',
    default_up_axis: 'Z',
    adapter_class: 'ArchicadAdapter',
    export_tips: [
      'Format terbaik: IFC2x3 / IFC4 — otomatis memisahkan Kaca, Spandrel, Rangka Mullion lewat SurfaceStyle & memotong lubang jendela.',
      'Jika ekspor .3dm atau .obj dari Archicad, Adapter otomatis mencegah penghitungan ganda sisi belakang kaca dan mendeteksi sumbu Y-Up.',
    ],
  },
  {
    id: 'revit',
    name: 'Autodesk Revit',
    subtitle: 'Revit 2021 – 2026 (BIM Architectural Envelope)',
    badge: 'BIM Native · Boolean Openings',
    supported_formats: ['.ifc', '.obj', '.zip', '.glb'],
    recommended_format: '.ifc',
    default_up_axis: 'Z',
    adapter_class: 'RevitAdapter',
    export_tips: [
      "Format terbaik: IFC2x3 / IFC4 Reference View — aktifkan 'Export IFC common property sets' agar metadata IsExternal terbaca.",
      'Lubang jendela pada IfcWall otomatis dipotong oleh kernel OpenCASCADE.',
    ],
  },
  {
    id: 'rhino',
    name: 'Rhinoceros 3D / Grasshopper',
    subtitle: 'Rhino 7 / 8 (NURBS, Brep, Blocks, Parametric)',
    badge: 'NURBS + Ladybug Tessellation',
    supported_formats: ['.3dm', '.obj', '.zip', '.hbjson'],
    recommended_format: '.3dm',
    default_up_axis: 'Z',
    adapter_class: 'RhinoAdapter',
    export_tips: [
      'Format terbaik: .3dm langsung — mendukung NURBS lengkung, SubD, Extrusion, dan nested Block Instances.',
      'Objek/Layer yang dimatikan (Hidden/Off) di Rhino otomatis diabaikan saat impor.',
    ],
  },
  {
    id: 'sketchup_mesh',
    name: 'SketchUp / Blender / 3ds Max',
    subtitle: 'Polygon Mesh & 3D Warehouse / Sketchfab',
    badge: 'Y-Up + PBR/MTL Glass + Normal Fix',
    supported_formats: ['.glb', '.gltf', '.obj', '.zip', '.ifc', '.stl'],
    recommended_format: '.glb',
    default_up_axis: 'Y',
    adapter_class: 'SketchUpMeshAdapter',
    export_tips: [
      'Format terbaik: .glb (semua transformasi komponen & transparansi kaca PBR ikut terbawa) atau .zip berisi (.obj + .mtl).',
      'Adapter otomatis memperbaiki sumbu Y-Up -> Z-Up dan membalik normal muka biru SketchUp.',
    ],
  },
  {
    id: 'honeybee_generic',
    name: 'Ladybug / Honeybee / Lainnya',
    subtitle: 'HBJSON Thermal Model, Allplan, Vectorworks, Tekla',
    badge: 'Universal Open-Format',
    supported_formats: ['.hbjson', '.json', '.ifc', '.3dm', '.obj', '.zip', '.glb', '.stl', '.ply'],
    recommended_format: '.hbjson',
    default_up_axis: 'auto',
    adapter_class: 'HoneybeeGenericAdapter',
    export_tips: [
      'Mendukung file .hbjson (Ladybug/Pollination) dengan Aperture & Outdoor Shade terpisah secara eksak.',
      'Juga cocok untuk ekspor IFC4/IFC4.3 dari Allplan, Vectorworks, Tekla, atau BricsCAD.',
    ],
  },
];

export class StagingWorkspaceController {
  constructor(callbacks) {
    this.callbacks = callbacks || {};
    this.profiles = [...FALLBACK_SOFTWARE_PROFILES];
    this.profilesById = Object.fromEntries(this.profiles.map((p) => [p.id, p]));
    this.profilesLoadedFromServer = false;

    // Current View 1 State (Strict Step-by-Step Gated Rules)
    this.activeStep = 'intake'; // 'intake' | 'inspect'
    this.softwareSelected = false; // MUST explicitly choose Software in Tahap 1 before Tahap 2 & 3 unlock!
    this.selectionMode = 'group'; // 'group' | 'autosplit' | 'face'
    this.faceBrushRole = 'glazing';
    this.selectedGroupName = null;
    this.stagedData = null;

    this.state = {
      model_id: null,
      source_software: '',
      expected_format: '',
      geometry_scope: 'facade_only',
      element_structure: 'separated',
      unit_mode: 'auto',
      massing_type: 'complex_nonconvex',
      up_axis: 'auto',
      z_ground_cutoff_m: 0.0,
      auto_split_merged_cw: false,
      groups_to_auto_split: [],
      frame_width_threshold_m: 0.28,
      spandrel_height_threshold_m: 1.15,
      group_category_overrides: {},
      disabled_groups: [],
      group_wwr_map: {},
      face_category_overrides: {},
      face_z_band_overrides: [],
    };

    // Dedicated Three.js Staging Scene
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.rootGroup = null;
    this.z0PlaneMesh = null;
    this.meshByGroupName = new Map();
    this.triFaceMeta = new Map(); // mesh.uuid -> Array<faceId>
    this.animFrameId = null;
    this.pointerDownPos = { x: 0, y: 0 };
    this.initialized3D = false;
  }

  async init() {
    await this.loadSoftwareProfiles();
    this.bindEvents();
    this.renderSoftwareCards();
    this.syncFormatDropdown();
    this.renderExportTips();
    this.updateIntakeGateState();
  }

  async loadSoftwareProfiles() {
    try {
      const res = await fetch('/api/intake/profiles');
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.profiles) && json.profiles.length > 0) {
          this.profiles = json.profiles;
          this.profilesById = json.profiles_by_id || Object.fromEntries(json.profiles.map((p) => [p.id, p]));
          this.profilesLoadedFromServer = true;
        }
      }
    } catch (e) {
      console.warn('Using fallback intake profiles:', e);
    }
  }

  // --------------------------------------------------------------------------
  // VIEW 1 <-> VIEW 2 SWITCHING
  // --------------------------------------------------------------------------
  async openNewImportView() {
    this.showView1();
    this.setStep('intake');
    if (!this.profilesLoadedFromServer) {
      await this.loadSoftwareProfiles();
    }
    // Enforce strict Step-by-Step Rules: reset Step 1 confirmation on fresh import
    this.softwareSelected = false;
    this.state.source_software = '';
    this.state.expected_format = '';
    document.getElementById('intake-upload-error')?.classList.add('hidden');
    this.renderSoftwareCards();
    this.syncFormatDropdown();
    this.renderExportTips();
    this.updateIntakeGateState();
  }

  async openReinspectActiveModel(modelId, fallbackOverrides = {}) {
    this.showView1();
    this.setStep('inspect');
    this.setInspectLoading(true, 'Memuat Preview 3D Inspeksi (Phase A)...');

    try {
      // Load saved .ottv.json config if available
      const cfgRes = await fetch(`/api/stage/config/${encodeURIComponent(modelId)}`);
      if (cfgRes.ok) {
        const cfgJson = await cfgRes.json();
        if (cfgJson.found && cfgJson.config) {
          this.hydrateStateFromConfig(modelId, cfgJson.config);
        } else {
          this.resetStateForModel(modelId, fallbackOverrides);
        }
      } else {
        this.resetStateForModel(modelId, fallbackOverrides);
      }
      this.syncInspectFormInputs();
      await this.runReinspect(true);
    } catch (err) {
      this.showStagingAlert(`Gagal memuat inspeksi ulang: ${err.message}`, true);
    } finally {
      this.setInspectLoading(false);
    }
  }

  resetStateForModel(modelId, overrides = {}) {
    this.state = {
      model_id: modelId,
      source_software: overrides.source_software || 'archicad',
      expected_format: '.ifc',
      geometry_scope: 'facade_only',
      element_structure: overrides.auto_split_merged_cw ? 'merged_single_layer' : 'separated',
      unit_mode: overrides.unit_mode || 'auto',
      massing_type: 'complex_nonconvex',
      up_axis: overrides.up_axis || 'auto',
      z_ground_cutoff_m: Number(overrides.z_ground_cutoff_m || 0),
      auto_split_merged_cw: Boolean(overrides.auto_split_merged_cw),
      groups_to_auto_split: overrides.groups_to_auto_split || [],
      frame_width_threshold_m: Number(overrides.frame_width_threshold_m || 0.28),
      spandrel_height_threshold_m: Number(overrides.spandrel_height_threshold_m || 1.15),
      group_category_overrides: { ...(overrides.group_category_overrides || {}) },
      disabled_groups: [...(overrides.disabled_groups || [])],
      group_wwr_map: { ...(overrides.group_wwr_map || {}) },
      face_category_overrides: { ...(overrides.face_category_overrides || {}) },
      face_z_band_overrides: [...(overrides.face_z_band_overrides || [])],
    };
  }

  hydrateStateFromConfig(modelId, cfg) {
    const prof = cfg.profile || {};
    this.state = {
      model_id: modelId,
      source_software: prof.source_software || 'archicad',
      expected_format: prof.expected_format || '.ifc',
      geometry_scope: prof.geometry_scope || 'facade_only',
      element_structure: prof.element_structure || 'separated',
      unit_mode: prof.unit_mode || 'auto',
      massing_type: prof.massing_type || 'complex_nonconvex',
      up_axis: prof.up_axis || 'auto',
      z_ground_cutoff_m: Number(prof.z_ground_cutoff_m || 0),
      auto_split_merged_cw: Boolean(cfg.auto_split_merged_cw),
      groups_to_auto_split: [...(cfg.groups_to_auto_split || [])],
      frame_width_threshold_m: Number(cfg.frame_width_threshold_m || 0.28),
      spandrel_height_threshold_m: Number(cfg.spandrel_height_threshold_m || 1.15),
      group_category_overrides: { ...(cfg.group_category_overrides || {}) },
      disabled_groups: [...(cfg.disabled_groups || [])],
      group_wwr_map: { ...(cfg.group_wwr_map || {}) },
      face_category_overrides: { ...(cfg.face_category_overrides || {}) },
      face_z_band_overrides: [...(cfg.face_z_band_overrides || [])],
    };
  }

  showView1() {
    document.getElementById('view-staging-workspace')?.classList.remove('hidden');
    document.getElementById('view-studio-workspace')?.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  closeToView2() {
    document.getElementById('view-staging-workspace')?.classList.add('hidden');
    document.getElementById('view-studio-workspace')?.classList.remove('hidden');
    if (this.callbacks.onReturnToStudio) {
      this.callbacks.onReturnToStudio();
    }
  }

  setStep(step) {
    this.activeStep = step;
    const elIntake = document.getElementById('staging-step-intake');
    const elInspect = document.getElementById('staging-step-inspect');
    const pillA = document.getElementById('staging-pill-step-a');
    const pillB = document.getElementById('staging-pill-step-b');

    if (step === 'intake') {
      elIntake?.classList.remove('hidden');
      elInspect?.classList.add('hidden');
      if (pillA) pillA.className = 'px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-800 text-white';
      if (pillB) pillB.className = 'px-3 py-1 rounded-full text-xs font-mono font-medium studio-subtle opacity-70';
    } else {
      elIntake?.classList.add('hidden');
      elInspect?.classList.remove('hidden');
      if (pillA) pillA.className = 'px-3 py-1 rounded-full text-xs font-mono font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200 cursor-pointer';
      if (pillB) pillB.className = 'px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-800 text-white';
      requestAnimationFrame(() => {
        this.ensureStaging3DInitialized();
        this.resizeStaging3D();
      });
    }
  }

  // --------------------------------------------------------------------------
  // STEP A: STRICT STEP-BY-STEP GATED INTAKE FORM (TAHAP 1 -> 2 -> 3)
  // --------------------------------------------------------------------------
  renderSoftwareCards() {
    const grid = document.getElementById('intake-software-cards');
    if (!grid) return;
    if (!this.profiles.length) {
      this.profiles = [...FALLBACK_SOFTWARE_PROFILES];
      this.profilesById = Object.fromEntries(this.profiles.map((p) => [p.id, p]));
    }

    grid.innerHTML = this.profiles
      .map((p) => {
        const active = this.softwareSelected && p.id === this.state.source_software;
        return `
        <button type="button" data-sw-card="${p.id}" class="text-left rounded-xl p-3 border-2 transition flex flex-col justify-between gap-1.5 ${
          active
            ? 'border-emerald-600 bg-emerald-50/85 dark:bg-emerald-950/55 shadow-sm ring-2 ring-emerald-500/30'
            : 'studio-subtle hover:border-emerald-500/70'
        }" style="${active ? '' : 'border-color: var(--border-color);'}">
          <div class="flex items-start justify-between gap-2">
            <span class="text-xs font-bold leading-tight">${p.name}</span>
            <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold ${
              active ? 'bg-emerald-800 text-white' : 'studio-input opacity-80'
            }">${active ? '✓ DIPILIH' : p.recommended_format.toUpperCase()}</span>
          </div>
          <div class="text-[11px] opacity-75 leading-snug">${p.subtitle}</div>
          <div class="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold">${p.badge}</div>
        </button>`;
      })
      .join('');

    grid.querySelectorAll('[data-sw-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.softwareSelected = true;
        this.state.source_software = btn.getAttribute('data-sw-card');
        const prof = this.profilesById[this.state.source_software];
        if (prof) {
          this.state.expected_format = prof.recommended_format;
          this.state.up_axis = prof.default_up_axis === 'Y' ? 'Y' : 'auto';
        }
        document.getElementById('intake-upload-error')?.classList.add('hidden');
        this.renderSoftwareCards();
        this.syncFormatDropdown();
        this.renderExportTips();
        this.updateIntakeGateState();
      });
    });
  }

  syncFormatDropdown() {
    const sel = document.getElementById('intake-format-select');
    if (!sel) return;
    const prof = this.softwareSelected ? this.profilesById[this.state.source_software] : null;
    if (!prof) {
      sel.innerHTML = `<option value="">-- Pilih Software di Tahap 1 terlebih dahulu --</option>`;
      sel.value = '';
      return;
    }
    const labels = {
      '.ifc': '.IFC (BIM Coordination / Reference View — Rekomendasi)',
      '.3dm': '.3DM (Rhino 7/8 NURBS, Brep, Blocks)',
      '.obj': '.OBJ (Wavefront Mesh)',
      '.zip': '.ZIP (Bundel .OBJ + .MTL / .GLTF + .BIN)',
      '.glb': '.GLB (Binary glTF — PBR Glass + Hierarki)',
      '.gltf': '.GLTF (glTF JSON)',
      '.hbjson': '.HBJSON (Ladybug / Honeybee Thermal Model)',
      '.json': '.JSON (Honeybee JSON)',
      '.stl': '.STL (Polygon Mesh)',
      '.ply': '.PLY (Polygon Mesh)',
    };
    sel.innerHTML = (prof.supported_formats || ['.ifc', '.3dm', '.obj', '.zip', '.glb'])
      .map((ext) => `<option value="${ext}">${labels[ext] || ext.toUpperCase()}</option>`)
      .join('');
    sel.value = this.state.expected_format || prof.recommended_format;
  }

  renderExportTips() {
    const box = document.getElementById('intake-export-tips');
    if (!box) return;
    const prof = this.softwareSelected ? this.profilesById[this.state.source_software] : null;
    if (!prof) {
      box.innerHTML = `
        <div class="font-semibold opacity-80">
          👆 Klik salah satu kartu software BIM / CAD di atas untuk mengaktifkan Adapter spesialis, melihat tips ekspor terbaik, dan membuka Tahap 2 &amp; Upload.
        </div>`;
      return;
    }
    box.innerHTML = `
      <div class="font-bold text-xs text-emerald-800 dark:text-emerald-300 mb-1">
        Panduan Ekspor Spesialis &mdash; ${prof.name} (${prof.adapter_class})
      </div>
      <ul class="list-disc list-inside space-y-1 text-[11px] opacity-85">
        ${(prof.export_tips || []).map((t) => `<li>${t}</li>`).join('')}
      </ul>
    `;
  }

  updateIntakeGateState() {
    const prof = this.softwareSelected ? this.profilesById[this.state.source_software] : null;
    const fmtVal = document.getElementById('intake-format-select')?.value || '';
    const step1Ready = Boolean(prof);
    const step2Ready = step1Ready && Boolean(fmtVal);

    // Top rule progress strip
    const p1 = document.getElementById('intake-rule-pill-1');
    const p2 = document.getElementById('intake-rule-pill-2');
    const p3 = document.getElementById('intake-rule-pill-3');
    const hint = document.getElementById('intake-rule-hint');

    if (p1) {
      p1.textContent = step1Ready ? `✓ 1. ${prof.name}` : '1. Pilih Software Asal';
      p1.className = step1Ready
        ? 'px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200'
        : 'px-2.5 py-1 rounded-full font-bold bg-emerald-800 text-white';
    }
    if (p2) {
      p2.innerHTML = step2Ready ? `✓ 2. Format ${fmtVal.toUpperCase()} &amp; Geometri` : (step1Ready ? '2. Konfigurasi Format &amp; Geometri' : '&#128274; 2. Konfigurasi Format &amp; Geometri');
      p2.className = step2Ready
        ? 'px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200'
        : step1Ready
        ? 'px-2.5 py-1 rounded-full font-bold bg-sky-700 text-white'
        : 'px-2.5 py-1 rounded-full studio-subtle opacity-65';
    }
    if (p3) {
      p3.innerHTML = step2Ready ? '3. Siap Unggah Model 3D' : '&#128274; 3. Unggah File Model 3D';
      p3.className = step2Ready
        ? 'px-2.5 py-1 rounded-full font-bold bg-emerald-800 text-white'
        : 'px-2.5 py-1 rounded-full studio-subtle opacity-65';
    }
    if (hint) {
      hint.textContent = step2Ready
        ? `Aturan Terpenuhi: Adapter ${prof.adapter_class} siap menerima file (${(prof.supported_formats || []).join(', ')})`
        : 'Aturan: Selesaikan Tahap 1 dahulu untuk membuka Tahap 2 & Upload';
      hint.className = step2Ready
        ? 'text-[11px] text-emerald-700 dark:text-emerald-400 font-bold'
        : 'text-[11px] text-amber-700 dark:text-amber-300 font-semibold';
    }

    // Step 1 card status badge
    const st1 = document.getElementById('intake-step1-status');
    if (st1) {
      st1.textContent = step1Ready ? `✓ ${prof.adapter_class}` : 'Wajib Dipilih';
      st1.className = step1Ready
        ? 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200 shrink-0'
        : 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 shrink-0';
    }

    // Step 2 lock / unlock
    const st2 = document.getElementById('intake-step2-status');
    const lockNotice = document.getElementById('intake-step2-lock-notice');
    const fieldsWrap = document.getElementById('intake-step2-fields');
    const step2Card = document.getElementById('intake-step2-card');
    if (st2) {
      st2.innerHTML = step1Ready ? '✓ Terbuka' : '&#128274; Terkunci';
      st2.className = step1Ready
        ? 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200 shrink-0'
        : 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold studio-subtle opacity-80 shrink-0';
    }
    lockNotice?.classList.toggle('hidden', step1Ready);
    if (fieldsWrap) {
      fieldsWrap.classList.toggle('opacity-45', !step1Ready);
      fieldsWrap.classList.toggle('pointer-events-none', !step1Ready);
      fieldsWrap.classList.toggle('select-none', !step1Ready);
      fieldsWrap.querySelectorAll('select, input').forEach((el) => {
        el.disabled = !step1Ready;
      });
    }
    if (step2Card) {
      step2Card.classList.toggle('border-emerald-600/70', step2Ready);
    }

    // Step 3 Upload Dropzone strict lock / unlock
    const st3 = document.getElementById('intake-step3-status');
    const drop = document.getElementById('intake-dropzone');
    const fInp = document.getElementById('intake-file-input');
    const dTitle = document.getElementById('intake-dropzone-title');
    const dSub = document.getElementById('intake-dropzone-subtitle');
    const dBadge = document.getElementById('intake-dropzone-badge');

    if (st3) {
      st3.innerHTML = step2Ready ? '✓ Siap Unggah' : '&#128274; Terkunci sampai Tahap 1 &amp; 2 lengkap';
      st3.className = step2Ready
        ? 'text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400'
        : 'text-[10px] font-mono font-bold opacity-75';
    }
    if (fInp) {
      fInp.disabled = !step2Ready;
      if (prof?.supported_formats?.length) {
        fInp.accept = prof.supported_formats.join(',');
      }
    }
    if (drop) {
      if (step2Ready) {
        drop.className = 'block cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition border-emerald-600 hover:bg-emerald-50/60 bg-emerald-50/30 dark:bg-emerald-950/25';
      } else {
        drop.className = 'block cursor-not-allowed opacity-45 rounded-2xl border-2 border-dashed p-5 text-center transition bg-slate-100/50 dark:bg-slate-900/40';
      }
    }
    if (dTitle) {
      dTitle.innerHTML = step2Ready
        ? `Klik atau Tarik File ${fmtVal.toUpperCase()} (${prof.name}) ke Sini`
        : '&#128274; Upload Terkunci &mdash; Pilih Software Asal (Tahap 1) Terlebih Dahulu';
      dTitle.className = step2Ready ? 'text-sm font-bold text-emerald-800 dark:text-emerald-300' : 'text-sm font-bold opacity-75';
    }
    if (dSub) {
      dSub.textContent = step2Ready
        ? `Format didukung ${prof.name}: ${(prof.supported_formats || []).map((e) => e.toUpperCase()).join(' · ')}`
        : 'Format yang diterima akan menyesuaikan Adapter pilihan Anda secara otomatis.';
    }
    if (dBadge) {
      dBadge.textContent = step2Ready
        ? `Adapter Aktif: ${prof.adapter_class} · Phase A Preview 3D (< 3 detik)`
        : 'Menunggu Validasi Tahap 1 & 2';
      dBadge.className = step2Ready
        ? 'mt-2 inline-block px-3 py-1 rounded-full text-[10px] font-mono font-semibold bg-emerald-800 text-white'
        : 'mt-2 inline-block px-3 py-1 rounded-full text-[10px] font-mono font-semibold bg-slate-500 text-white';
    }
  }

  readIntakeFormToState() {
    this.state.expected_format = document.getElementById('intake-format-select')?.value || '';
    this.state.geometry_scope = document.getElementById('intake-scope-select')?.value || 'facade_only';
    this.state.element_structure = document.getElementById('intake-structure-select')?.value || 'separated';
    this.state.unit_mode = document.getElementById('intake-unit-select')?.value || 'auto';
    this.state.massing_type = document.getElementById('intake-massing-select')?.value || 'complex_nonconvex';
    this.state.z_ground_cutoff_m = parseFloat(document.getElementById('intake-z0-input')?.value || '0') || 0;
    this.state.auto_split_merged_cw = this.state.element_structure === 'merged_single_layer';
    this.state.group_category_overrides = {};
    this.state.disabled_groups = [];
    this.state.group_wwr_map = {};
    this.state.face_category_overrides = {};
    this.state.face_z_band_overrides = [];
    this.state.groups_to_auto_split = [];
  }

  uploadFileForStaging(file) {
    if (!file) return;
    // STRICT GATE CHECK: Block upload if Step 1 or Step 2 not satisfied!
    const prof = this.softwareSelected ? this.profilesById[this.state.source_software] : null;
    const fmtVal = document.getElementById('intake-format-select')?.value || '';
    if (!prof || !fmtVal) {
      this.showIntakeError('Aturan Tahap 1 & 2 belum lengkap: pilih Software Asal dan Format File terlebih dahulu sebelum mengunggah model!');
      return;
    }
    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : '';
    if (prof.supported_formats && !prof.supported_formats.includes(ext)) {
      this.showIntakeError(
        `Format file "${ext || '(tanpa ekstensi)'}" tidak cocok dengan Adapter ${prof.name} (mendukung: ${prof.supported_formats.join(', ')}). Ganti Software di Tahap 1 atau pilih file yang sesuai.`
      );
      return;
    }

    this.readIntakeFormToState();

    const progWrap = document.getElementById('intake-upload-progress-wrap');
    const progBar = document.getElementById('intake-upload-progress-bar');
    const progLabel = document.getElementById('intake-upload-progress-label');
    const errBox = document.getElementById('intake-upload-error');
    if (errBox) errBox.classList.add('hidden');
    if (progWrap) progWrap.classList.remove('hidden');
    if (progBar) progBar.style.width = '5%';
    if (progLabel) progLabel.textContent = `Mengunggah "${file.name}" (0%)...`;

    const fd = new FormData();
    fd.append('file', file);
    fd.append('source_software', this.state.source_software);
    fd.append('expected_format', this.state.expected_format);
    fd.append('geometry_scope', this.state.geometry_scope);
    fd.append('element_structure', this.state.element_structure);
    fd.append('unit_mode', this.state.unit_mode);
    fd.append('massing_type', this.state.massing_type);
    fd.append('up_axis', this.state.up_axis);
    fd.append('z_ground_cutoff_m', String(this.state.z_ground_cutoff_m));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/stage/upload', true);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.min(72, Math.round((evt.loaded / evt.total) * 72));
        if (progBar) progBar.style.width = `${pct}%`;
        if (progLabel) progLabel.textContent = `Mengunggah "${file.name}" (${Math.round((evt.loaded / evt.total) * 100)}%)...`;
      }
    };

    xhr.upload.onload = () => {
      if (progBar) progBar.style.width = '82%';
      if (progLabel) progLabel.textContent = `Menjalankan Adapter ${this.profilesById[this.state.source_software]?.adapter_class || ''} & Audit Geometri (Phase A)...`;
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (progBar) progBar.style.width = '100%';
          if (progLabel) progLabel.textContent = 'Preview 3D Inspeksi siap!';
          setTimeout(() => progWrap?.classList.add('hidden'), 350);

          this.state.model_id = data.model_id;
          this.stagedData = data;
          this.selectedGroupName = data.groups?.[0]?.group_name || null;
          this.setStep('inspect');
          this.syncInspectFormInputs();
          this.renderStagingInspectionUI(data, true);
        } catch (parseErr) {
          this.showIntakeError(`Gagal membaca respons server: ${parseErr.message}`);
          progWrap?.classList.add('hidden');
        }
      } else {
        let detail = `HTTP ${xhr.status}`;
        try {
          detail = JSON.parse(xhr.responseText).detail || detail;
        } catch (_) {}
        this.showIntakeError(detail);
        progWrap?.classList.add('hidden');
      }
    };

    xhr.onerror = () => {
      this.showIntakeError('Koneksi ke server backend gagal. Pastikan server berjalan.');
      progWrap?.classList.add('hidden');
    };

    xhr.send(fd);
  }

  showIntakeError(msg) {
    const errBox = document.getElementById('intake-upload-error');
    if (errBox) {
      errBox.textContent = `⚠️ ${msg}`;
      errBox.classList.remove('hidden');
    }
  }

  // --------------------------------------------------------------------------
  // STEP B: FAST PHASE-A RE-INSPECT & DEDICATED 3D STAGING VIEWPORT
  // --------------------------------------------------------------------------
  syncInspectFormInputs() {
    const swSel = document.getElementById('inspect-adapter-select');
    if (swSel) swSel.value = this.state.source_software;
    const uSel = document.getElementById('inspect-unit-select');
    if (uSel) uSel.value = this.state.unit_mode;
    const axSel = document.getElementById('inspect-axis-select');
    if (axSel) axSel.value = this.state.up_axis;
    const zSlider = document.getElementById('inspect-z0-slider');
    const zVal = document.getElementById('inspect-z0-value');
    if (zSlider) zSlider.value = String(this.state.z_ground_cutoff_m);
    if (zVal) zVal.textContent = `${Number(this.state.z_ground_cutoff_m).toFixed(1)} m`;

    const chkSplit = document.getElementById('inspect-chk-autosplit');
    if (chkSplit) chkSplit.checked = Boolean(this.state.auto_split_merged_cw);
    const inpFw = document.getElementById('inspect-frame-width');
    if (inpFw) inpFw.value = String(this.state.frame_width_threshold_m);
    const inpSh = document.getElementById('inspect-spandrel-height');
    if (inpSh) inpSh.value = String(this.state.spandrel_height_threshold_m);
  }

  async runReinspect(resetCamera = false) {
    if (!this.state.model_id) return;
    this.setInspectLoading(true, 'Memperbarui Staging Preview 3D...');
    try {
      const res = await fetch('/api/stage/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.state),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          msg = (await res.json()).detail || msg;
        } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      this.stagedData = data;
      if (!this.selectedGroupName || !data.groups.some((g) => g.group_name === this.selectedGroupName)) {
        this.selectedGroupName = data.groups?.[0]?.group_name || null;
      }
      this.renderStagingInspectionUI(data, resetCamera);
    } catch (err) {
      this.showStagingAlert(`Gagal inspeksi: ${err.message}`, true);
    } finally {
      this.setInspectLoading(false);
    }
  }

  setInspectLoading(show, text = '') {
    const el = document.getElementById('staging-viewport-loading');
    const lbl = document.getElementById('staging-viewport-loading-text');
    if (lbl && text) lbl.textContent = text;
    if (el) el.classList.toggle('hidden', !show);
  }

  showStagingAlert(msg, isError = false) {
    const el = document.getElementById('staging-status-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `rounded-xl px-3 py-2 text-xs font-mono border ${
      isError
        ? 'bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-950/60 dark:border-rose-700 dark:text-rose-200'
        : 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-700 dark:text-emerald-200'
    }`;
    el.classList.remove('hidden');
  }

  renderStagingInspectionUI(data, resetCamera = false) {
    // 1. Header file & audit badges
    const fnEl = document.getElementById('inspect-model-filename');
    if (fnEl) fnEl.textContent = data.filename || data.model_id;
    const aud = data.stage1_audit || {};
    const bb = data.bounding_box || { span: [0, 0, 0], max: [0, 0, 10] };

    const metaEl = document.getElementById('inspect-audit-strip');
    if (metaEl) {
      metaEl.innerHTML = `
        <span>Kernel: <strong>${aud.geometry_kernel || '-'}</strong></span>
        <span>&bull; Dimensi: <strong>${bb.span[0]} &times; ${bb.span[1]} &times; ${bb.span[2]} m</strong></span>
        <span>&bull; Unit: <strong>${(aud.applied_unit || 'm').toUpperCase()} (&times;${aud.scale_factor_to_m})</strong></span>
        <span>&bull; Sumbu: <strong>${aud.applied_up_axis || 'Z'}-Up</strong></span>
        <span>&bull; Estimasi: <strong>${data.estimated_floors || 1} Lantai</strong></span>
      `;
    }

    // Update Z0 slider max range dynamically based on model height
    const zSlider = document.getElementById('inspect-z0-slider');
    const zMaxSafe = Math.max(0, Math.floor((bb.max?.[2] || 10) * 0.75 * 2) / 2);
    if (zSlider) {
      zSlider.max = String(zMaxSafe);
      zSlider.value = String(Math.min(zMaxSafe, this.state.z_ground_cutoff_m));
    }

    // 2. Mismatch Warning Banner with 1-click Fix
    const mmBanner = document.getElementById('staging-mismatch-banner');
    if (mmBanner) {
      if (data.mismatch_warning) {
        const mw = data.mismatch_warning;
        mmBanner.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span class="font-bold">⚠️ Ketidakcocokan Adapter Terdeteksi:</span>
              <span>${mw.message}</span>
            </div>
            <button id="btn-fix-mismatch-adapter" type="button" class="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition">
              &check; Ganti ke ${mw.recommended_name}
            </button>
          </div>
        `;
        mmBanner.classList.remove('hidden');
        document.getElementById('btn-fix-mismatch-adapter')?.addEventListener('click', () => {
          this.state.source_software = mw.recommended_software;
          const prof = this.profilesById[mw.recommended_software];
          if (prof) {
            this.state.up_axis = prof.default_up_axis === 'Y' ? 'Y' : 'auto';
          }
          this.syncInspectFormInputs();
          this.runReinspect(false);
        });
      } else {
        mmBanner.classList.add('hidden');
      }
    }

    // 3. Adapter Notes
    const notesEl = document.getElementById('staging-adapter-notes');
    if (notesEl) {
      const notes = [...(data.adapter_notes || []), ...(aud.notes || [])];
      notesEl.innerHTML = notes.map((n) => `<div>&bull; ${n}</div>`).join('');
    }

    // 4. Quick Role Action Bar for Selected Group in 3D
    this.renderSelectedGroupQuickBar();

    // 5. Groups Table with Confidence Badges
    this.renderStagingGroupsTable(data.groups || []);

    // 6. Face & Z-Band Override List
    this.renderFaceAndZBandSummary();

    // 7. Pre-Calculation Gate Checklist & Commit CTA Lock
    const clEl = document.getElementById('staging-gate-checklist');
    if (clEl) {
      clEl.innerHTML = (data.gate_checklist || [])
        .map((c) => {
          const icon = c.severity === 'ok' ? '✓' : c.severity === 'warn' ? '!' : '✕';
          const cls =
            c.severity === 'ok'
              ? 'text-emerald-700 dark:text-emerald-400'
              : c.severity === 'warn'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-rose-600 dark:text-rose-400';
          return `
            <div class="flex items-start gap-2 text-[11px] leading-snug">
              <span class="font-mono font-bold ${cls}">${icon}</span>
              <div>
                <div class="font-medium">${c.label}</div>
                ${c.hint ? `<div class="text-[10px] opacity-70">${c.hint}</div>` : ''}
              </div>
            </div>`;
        })
        .join('');
    }

    const btnCommit = document.getElementById('btn-staging-commit-ottv');
    if (btnCommit) {
      btnCommit.disabled = !data.can_commit;
      btnCommit.classList.toggle('opacity-50', !data.can_commit);
      btnCommit.classList.toggle('cursor-not-allowed', !data.can_commit);
    }

    // 8. Build Dedicated Staging 3D Scene
    this.ensureStaging3DInitialized();
    this.rebuildStaging3DScene(data, resetCamera);
  }

  renderSelectedGroupQuickBar() {
    const bar = document.getElementById('staging-selected-group-bar');
    if (!bar || !this.stagedData) return;
    const grp = (this.stagedData.groups || []).find((g) => g.group_name === this.selectedGroupName);
    if (!grp) {
      bar.innerHTML = `<div class="text-[11px] opacity-70">Klik objek langsung di Preview 3D untuk memilih grup dan mengubah perannya.</div>`;
      return;
    }

    const rStyle = ROLE_STYLES[grp.category] || ROLE_STYLES.wall;
    bar.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div class="text-xs font-mono font-bold truncate max-w-[340px]" title="${grp.group_name}">
          Terpilih di 3D: <span class="text-emerald-700 dark:text-emerald-400">${grp.group_name}</span>
        </div>
        <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold ${rStyle.badge}">
          ${rStyle.label} &bull; ${grp.raw_area_m2} m²
        </span>
      </div>
      <div class="flex flex-wrap gap-1">
        ${QUICK_ROLES.map((r) => {
          const active = grp.category === r.id;
          return `
            <button type="button" data-quick-role="${r.id}" class="px-2 py-1 rounded-lg text-[10px] font-mono font-semibold border transition ${
              active
                ? 'bg-emerald-800 text-white border-emerald-800 shadow-sm'
                : 'studio-input hover:border-emerald-600'
            }">${r.label}</button>`;
        }).join('')}
      </div>
    `;

    bar.querySelectorAll('[data-quick-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const newRole = btn.getAttribute('data-quick-role');
        this.applyGroupRoleChange(grp.group_name, newRole);
      });
    });
  }

  applyGroupRoleChange(groupName, newRole) {
    this.state.group_category_overrides[groupName] = newRole;
    if (newRole === 'composite_cw' && !this.state.group_wwr_map[groupName]) {
      this.state.group_wwr_map[groupName] = 0.65;
    }
    // Instant client-side visual color update + async server re-stage for gate checklist & .ottv.json save
    if (this.stagedData) {
      const g = this.stagedData.groups.find((x) => x.group_name === groupName);
      if (g) {
        g.category = newRole;
        g.confidence = 'verified';
        g.confidence_reason = 'Dikonfirmasi manual oleh pengguna';
      }
      const pm = this.stagedData.preview_meshes.find((x) => x.group_name === groupName);
      if (pm) pm.category = newRole;
      this.renderSelectedGroupQuickBar();
      this.renderStagingGroupsTable(this.stagedData.groups);
      this.updateGroupMeshAppearance(groupName);
    }
    this.runReinspect(false);
  }

  renderStagingGroupsTable(groups) {
    const tbody = document.getElementById('staging-groups-tbody');
    if (!tbody) return;
    tbody.innerHTML = groups
      .map((g) => {
        const isSel = g.group_name === this.selectedGroupName;
        const confBadge =
          g.confidence === 'verified'
            ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200">TERVERIFIKASI</span>`
            : g.confidence === 'high'
            ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">TINGGI</span>`
            : `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">TINJAU!</span>`;

        const wwrInput =
          g.category === 'composite_cw'
            ? `<div class="mt-1 flex items-center gap-1 text-[10px] font-mono">
                <span>WWR:</span>
                <input type="number" min="5" max="95" step="5" value="${Math.round((this.state.group_wwr_map[g.group_name] || 0.65) * 100)}" data-stg-wwr="${g.group_name}" class="studio-input w-14 rounded px-1 py-0.5 text-[10px]" />%
              </div>`
            : '';

        return `
        <tr data-stg-row="${g.group_name}" class="cursor-pointer border-b transition ${
          isSel ? 'bg-emerald-50/90 dark:bg-emerald-950/40' : 'hover:opacity-90'
        }" style="border-color: var(--border-color);">
          <td class="py-1.5 px-2 align-top">
            <div class="font-mono text-[11px] font-bold truncate max-w-[165px]" title="${g.group_name}">${g.group_name}</div>
            <div class="flex items-center gap-1 mt-0.5">
              ${confBadge}
              <span class="text-[9px] font-mono opacity-65">Z: ${g.z_range_m?.[0]}–${g.z_range_m?.[1]}m</span>
            </div>
          </td>
          <td class="py-1.5 px-1.5 align-top">
            <select data-stg-cat="${g.group_name}" class="studio-input rounded px-1.5 py-1 text-[10px] font-mono w-full">
              ${QUICK_ROLES.map((r) => `<option value="${r.id}" ${g.category === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}
            </select>
            ${wwrInput}
          </td>
          <td class="py-1.5 px-1.5 text-right font-mono text-[10px] align-top">
            <div class="font-semibold">${g.raw_area_m2} m²</div>
            <div class="opacity-60">${g.face_count} f</div>
          </td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('[data-stg-row]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
        this.selectedGroupName = tr.getAttribute('data-stg-row');
        this.renderSelectedGroupQuickBar();
        this.renderStagingGroupsTable(this.stagedData?.groups || []);
        this.highlightSelectedGroupIn3D();
      });
    });

    tbody.querySelectorAll('[data-stg-cat]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const gName = sel.getAttribute('data-stg-cat');
        this.selectedGroupName = gName;
        this.applyGroupRoleChange(gName, sel.value);
      });
    });

    tbody.querySelectorAll('[data-stg-wwr]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const gName = inp.getAttribute('data-stg-wwr');
        const val = Math.max(0.05, Math.min(0.95, (parseFloat(inp.value) || 65) / 100));
        this.state.group_wwr_map[gName] = val;
        this.runReinspect(false);
      });
    });
  }

  renderFaceAndZBandSummary() {
    const fCountEl = document.getElementById('inspect-face-override-count');
    const faceCount = Object.keys(this.state.face_category_overrides || {}).length;
    if (fCountEl) fCountEl.textContent = `${faceCount} bidang di-override`;

    const zbList = document.getElementById('inspect-zband-list');
    if (!zbList) return;
    const bands = this.state.face_z_band_overrides || [];
    if (!bands.length) {
      zbList.innerHTML = `<div class="text-[10px] opacity-65 font-mono">Belum ada rentang elevasi Z kustom.</div>`;
      return;
    }
    zbList.innerHTML = bands
      .map((b, idx) => {
        const rs = ROLE_STYLES[b.category] || ROLE_STYLES.wall;
        return `
        <div class="flex items-center justify-between gap-2 studio-subtle rounded-lg px-2 py-1 text-[10px] font-mono">
          <span>Z ${b.z_min}–${b.z_max}m (${b.group_name === '*' ? 'Semua Grup' : b.group_name}) &rarr; <strong>${rs.label}</strong></span>
          <button type="button" data-del-zband="${idx}" class="text-rose-600 hover:underline font-bold">Hapus</button>
        </div>`;
      })
      .join('');

    zbList.querySelectorAll('[data-del-zband]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-del-zband'), 10);
        this.state.face_z_band_overrides.splice(idx, 1);
        this.renderFaceAndZBandSummary();
        this.rebuildStaging3DScene(this.stagedData, false);
      });
    });
  }

  // --------------------------------------------------------------------------
  // DEDICATED THREE.JS 3D STAGING ENGINE
  // --------------------------------------------------------------------------
  ensureStaging3DInitialized() {
    if (this.initialized3D) return;
    const container = document.getElementById('staging-three-viewport');
    if (!container) return;

    const w = container.clientWidth || 720;
    const h = container.clientHeight || 500;
    this.scene = new THREE.Scene();
    const isDark = document.documentElement.classList.contains('dark');
    this.scene.background = new THREE.Color(isDark ? 0x0b1120 : 0xf4f5ef);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.2, 4000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(45, -55, 36);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir1 = new THREE.DirectionalLight(0xfffbeb, 0.72);
    dir1.position.set(-80, -70, 130);
    this.scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xdbeafe, 0.40);
    dir2.position.set(90, 80, 60);
    this.scene.add(dir2);

    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    // Click picking in 3D Staging Viewport
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (dist > 6) return; // User was orbiting, not clicking
      this.handleStaging3DClick(e);
    });

    window.addEventListener('resize', () => this.resizeStaging3D());

    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);
      if (!document.getElementById('view-staging-workspace')?.classList.contains('hidden')) {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      }
    };
    animate();
    this.initialized3D = true;
  }

  resizeStaging3D() {
    if (!this.initialized3D || !this.renderer || !this.camera) return;
    const container = document.getElementById('staging-three-viewport');
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 20 && h > 20) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }
  }

  syncThemeBackground() {
    if (!this.scene) return;
    const isDark = document.documentElement.classList.contains('dark');
    this.scene.background = new THREE.Color(isDark ? 0x0b1120 : 0xf4f5ef);
  }

  rebuildStaging3DScene(data, resetCamera = false) {
    if (!this.scene || !this.rootGroup || !data) return;

    // Clear old meshes
    while (this.rootGroup.children.length > 0) {
      const obj = this.rootGroup.children.pop();
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material?.dispose?.();
    }
    this.meshByGroupName.clear();
    this.triFaceMeta.clear();

    const bb = data.bounding_box || { center: [0, 0, 5], span: [20, 20, 10], max_span: 25 };
    const cx = bb.center[0];
    const cy = bb.center[1];
    const cz = bb.center[2];
    const maxSpan = Math.max(10, bb.max_span || 25);

    // Architectural ground grid at Z=0
    const grid = new THREE.GridHelper(Math.ceil(maxSpan * 2.2), 24, 0x059669, 0x64748b);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(cx, cy, 0);
    grid.material.opacity = 0.24;
    grid.material.transparent = true;
    this.rootGroup.add(grid);

    // Live translucent emerald Z0 Ground-Plane Cutoff mesh
    const z0Geom = new THREE.PlaneGeometry(maxSpan * 1.85, maxSpan * 1.85);
    const z0Mat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: this.state.z_ground_cutoff_m > 0.05 ? 0.24 : 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.z0PlaneMesh = new THREE.Mesh(z0Geom, z0Mat);
    this.z0PlaneMesh.position.set(cx, cy, this.state.z_ground_cutoff_m);
    this.rootGroup.add(this.z0PlaneMesh);

    const faceOv = this.state.face_category_overrides || {};
    const zBands = this.state.face_z_band_overrides || [];
    const zCut = Number(this.state.z_ground_cutoff_m || 0);

    for (const pm of data.preview_meshes || []) {
      const verts = pm.vertices || [];
      const tris = pm.tris || [];
      const fIds = pm.face_ids || [];
      if (!verts.length || !tris.length) continue;

      const positions = new Float32Array(tris.length * 9);
      const colors = new Float32Array(tris.length * 9);
      const baseStyle = ROLE_STYLES[pm.category] || ROLE_STYLES.wall;
      const baseCol = new THREE.Color(baseStyle.color);
      const tmpCol = new THREE.Color();

      for (let t = 0; t < tris.length; t++) {
        const [i0, i1, i2] = tris[t];
        const v0 = verts[i0];
        const v1 = verts[i1];
        const v2 = verts[i2];
        const off = t * 9;
        positions[off]     = v0[0]; positions[off + 1] = v0[1]; positions[off + 2] = v0[2];
        positions[off + 3] = v1[0]; positions[off + 4] = v1[1]; positions[off + 5] = v1[2];
        positions[off + 6] = v2[0]; positions[off + 7] = v2[1]; positions[off + 8] = v2[2];

        const fz = (v0[2] + v1[2] + v2[2]) / 3.0;
        const fid = fIds[t];
        let effRole = pm.category;

        if (fid && faceOv[fid]) {
          effRole = faceOv[fid];
        } else if (zBands.length) {
          for (const zb of zBands) {
            if ((zb.group_name === '*' || zb.group_name === pm.group_name) && fz >= zb.z_min - 0.05 && fz <= zb.z_max + 0.05) {
              effRole = zb.category;
            }
          }
        }

        if (zCut > 0.05 && fz < zCut - 0.05) {
          // Basement below Z0 highlighted in dark muted rose-gray
          tmpCol.setHex(0x475569);
        } else if (effRole !== pm.category) {
          tmpCol.setHex((ROLE_STYLES[effRole] || ROLE_STYLES.wall).color);
        } else {
          tmpCol.copy(baseCol);
        }

        colors[off]     = tmpCol.r; colors[off + 1] = tmpCol.g; colors[off + 2] = tmpCol.b;
        colors[off + 3] = tmpCol.r; colors[off + 4] = tmpCol.g; colors[off + 5] = tmpCol.b;
        colors[off + 6] = tmpCol.r; colors[off + 7] = tmpCol.g; colors[off + 8] = tmpCol.b;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.computeVertexNormals();

      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: baseStyle.opacity < 0.92,
        opacity: baseStyle.opacity,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { group_name: pm.group_name, group_id: pm.group_id, category: pm.category };
      this.rootGroup.add(mesh);
      this.meshByGroupName.set(pm.group_name, mesh);
      this.triFaceMeta.set(mesh.uuid, fIds);
    }

    this.highlightSelectedGroupIn3D();

    if (resetCamera) {
      const dist = maxSpan * 1.45;
      this.camera.position.set(cx + dist * 0.72, cy - dist * 0.85, cz + dist * 0.48);
      this.controls.target.set(cx, cy, cz);
      this.controls.update();
    }
  }

  updateGroupMeshAppearance(groupName) {
    // Re-color scene cleanly so vertexColors reflect updated category
    if (this.stagedData) {
      this.rebuildStaging3DScene(this.stagedData, false);
    }
  }

  highlightSelectedGroupIn3D() {
    for (const [gName, mesh] of this.meshByGroupName.entries()) {
      const isSel = gName === this.selectedGroupName;
      if (mesh.material?.emissive) {
        mesh.material.emissive.setHex(isSel ? 0x065f46 : 0x000000);
        mesh.material.emissiveIntensity = isSel ? 0.38 : 0.0;
      }
    }
  }

  handleStaging3DClick(event) {
    if (!this.renderer || !this.camera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const pickables = Array.from(this.meshByGroupName.values());
    const hits = this.raycaster.intersectObjects(pickables, false);
    if (!hits.length) return;

    const hit = hits[0];
    const gName = hit.object.userData?.group_name;
    if (!gName) return;

    this.selectedGroupName = gName;

    if (this.selectionMode === 'face') {
      const fIds = this.triFaceMeta.get(hit.object.uuid) || [];
      const fid = fIds[hit.faceIndex];
      if (fid) {
        this.state.face_category_overrides[fid] = this.faceBrushRole;
        this.renderFaceAndZBandSummary();
        this.rebuildStaging3DScene(this.stagedData, false);
        this.showStagingAlert(
          `Bidang ${fid} (${gName}) ditetapkan sebagai "${(ROLE_STYLES[this.faceBrushRole] || ROLE_STYLES.wall).label}".`
        );
      }
    } else {
      this.renderSelectedGroupQuickBar();
      this.renderStagingGroupsTable(this.stagedData?.groups || []);
      this.highlightSelectedGroupIn3D();
    }
  }

  // --------------------------------------------------------------------------
  // PHASE B: COMMIT VERIFIED STAGING MODEL -> MAIN OTTV STUDIO (VIEW 2)
  // --------------------------------------------------------------------------
  async commitToOttvStudio() {
    if (!this.state.model_id) return;
    const btn = document.getElementById('btn-staging-commit-ottv');
    const origText = btn?.textContent || '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Menghitung OTTV & Raycasting Surya SNI 6389:2020...';
    }
    this.setInspectLoading(true, 'Tahap B: Menjalankan Simulasi OTTV 3D + Raycasting Surya...');

    try {
      const studioPrefs = this.callbacks.getStudioThermalPrefs ? this.callbacks.getStudioThermalPrefs() : {};
      const payload = {
        ...this.state,
        ...studioPrefs,
      };
      const res = await fetch('/api/analyze/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          detail = (await res.json()).detail || detail;
        } catch (_) {}
        throw new Error(detail);
      }
      const ottvData = await res.json();
      this.closeToView2();
      if (this.callbacks.onCommitResult) {
        this.callbacks.onCommitResult(ottvData, { ...this.state });
      }
    } catch (err) {
      this.showStagingAlert(`Gagal menjalankan perhitungan OTTV: ${err.message}`, true);
    } finally {
      this.setInspectLoading(false);
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  }

  // --------------------------------------------------------------------------
  // EXPORT / IMPORT .ottv.json CONFIG
  // --------------------------------------------------------------------------
  exportConfigJson() {
    const blob = new Blob([JSON.stringify(this.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.state.model_id || 'model'}.ottv.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importConfigJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        this.hydrateStateFromConfig(this.state.model_id || parsed.model_id, parsed);
        this.syncInspectFormInputs();
        this.showStagingAlert(`Konfigurasi "${file.name}" berhasil dimuat.`);
        await this.runReinspect(false);
      } catch (e) {
        this.showStagingAlert(`File .ottv.json tidak valid: ${e.message}`, true);
      }
    };
    reader.readAsText(file);
  }

  // --------------------------------------------------------------------------
  // EVENT BINDINGS
  // --------------------------------------------------------------------------
  bindEvents() {
    document.getElementById('btn-staging-back-studio')?.addEventListener('click', () => this.closeToView2());
    document.getElementById('staging-pill-step-a')?.addEventListener('click', () => this.setStep('intake'));

    // Format select change updates Step 3 Dropzone badge dynamically
    document.getElementById('intake-format-select')?.addEventListener('change', (e) => {
      this.state.expected_format = e.target.value;
      this.updateIntakeGateState();
    });

    // File upload via click or drag-and-drop in View 1 Step A (Strictly Gated!)
    const fileInp = document.getElementById('intake-file-input');
    const dropZone = document.getElementById('intake-dropzone');
    fileInp?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) this.uploadFileForStaging(f);
      e.target.value = '';
    });
    if (dropZone) {
      dropZone.addEventListener('click', (e) => {
        if (!this.softwareSelected || !(document.getElementById('intake-format-select')?.value)) {
          e.preventDefault();
          this.showIntakeError('Aturan Tahap 1 & 2: pilih Software Asal di sebelah kiri terlebih dahulu untuk membuka area unggah file.');
        }
      });
      ['dragenter', 'dragover'].forEach((ev) =>
        dropZone.addEventListener(ev, (e) => {
          e.preventDefault();
          if (this.softwareSelected) {
            dropZone.classList.add('ring-2', 'ring-emerald-500');
          }
        })
      );
      ['dragleave', 'drop'].forEach((ev) =>
        dropZone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropZone.classList.remove('ring-2', 'ring-emerald-500');
        })
      );
      dropZone.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) this.uploadFileForStaging(f);
      });
    }

    // Step B Adapter / Unit / Axis live change
    document.getElementById('inspect-adapter-select')?.addEventListener('change', (e) => {
      this.state.source_software = e.target.value;
      this.runReinspect(false);
    });
    document.getElementById('inspect-unit-select')?.addEventListener('change', (e) => {
      this.state.unit_mode = e.target.value;
      this.runReinspect(true);
    });
    document.getElementById('inspect-axis-select')?.addEventListener('change', (e) => {
      this.state.up_axis = e.target.value;
      this.runReinspect(true);
    });

    // Live 3D Z0 Ground-Plane Cutoff slider
    const zSlider = document.getElementById('inspect-z0-slider');
    zSlider?.addEventListener('input', () => {
      const val = parseFloat(zSlider.value || '0') || 0;
      this.state.z_ground_cutoff_m = val;
      const lbl = document.getElementById('inspect-z0-value');
      if (lbl) lbl.textContent = `${val.toFixed(1)} m`;
      if (this.z0PlaneMesh) {
        this.z0PlaneMesh.position.z = val;
        this.z0PlaneMesh.material.opacity = val > 0.05 ? 0.24 : 0.0;
      }
      if (this.stagedData) {
        this.rebuildStaging3DScene(this.stagedData, false);
      }
    });
    zSlider?.addEventListener('change', () => this.runReinspect(false));

    // 3 Selection Mode Tabs
    document.querySelectorAll('[data-stg-mode-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectionMode = btn.getAttribute('data-stg-mode-tab');
        document.querySelectorAll('[data-stg-mode-tab]').forEach((b) => {
          const on = b.getAttribute('data-stg-mode-tab') === this.selectionMode;
          b.className = on
            ? 'flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold bg-emerald-800 text-white transition'
            : 'flex-1 py-1.5 px-2 rounded-lg text-[11px] font-medium studio-subtle hover:opacity-80 transition';
        });
        document.getElementById('staging-panel-mode-group')?.classList.toggle('hidden', this.selectionMode !== 'group');
        document.getElementById('staging-panel-mode-autosplit')?.classList.toggle('hidden', this.selectionMode !== 'autosplit');
        document.getElementById('staging-panel-mode-face')?.classList.toggle('hidden', this.selectionMode !== 'face');
      });
    });

    // Mode 2: Auto-Split Tier 2 Apply
    document.getElementById('btn-inspect-apply-autosplit')?.addEventListener('click', () => {
      this.state.auto_split_merged_cw = Boolean(document.getElementById('inspect-chk-autosplit')?.checked);
      this.state.frame_width_threshold_m = parseFloat(document.getElementById('inspect-frame-width')?.value || '0.28');
      this.state.spandrel_height_threshold_m = parseFloat(document.getElementById('inspect-spandrel-height')?.value || '1.15');
      this.runReinspect(false);
    });

    // Mode 3: Per-Face Brush & Z-Band Override
    document.getElementById('inspect-face-brush-select')?.addEventListener('change', (e) => {
      this.faceBrushRole = e.target.value;
    });
    document.getElementById('btn-inspect-clear-face-ov')?.addEventListener('click', () => {
      this.state.face_category_overrides = {};
      this.renderFaceAndZBandSummary();
      this.rebuildStaging3DScene(this.stagedData, false);
    });
    document.getElementById('btn-inspect-add-zband')?.addEventListener('click', () => {
      const zMin = parseFloat(document.getElementById('inspect-zband-min')?.value || '0');
      const zMax = parseFloat(document.getElementById('inspect-zband-max')?.value || '3.6');
      const cat = document.getElementById('inspect-zband-role')?.value || 'glazing';
      if (zMax <= zMin) return;
      this.state.face_z_band_overrides.push({
        group_name: '*',
        z_min: zMin,
        z_max: zMax,
        category: cat,
      });
      this.renderFaceAndZBandSummary();
      this.rebuildStaging3DScene(this.stagedData, false);
    });

    // Export / Import .ottv.json
    document.getElementById('btn-staging-export-json')?.addEventListener('click', () => this.exportConfigJson());
    document.getElementById('input-staging-import-json')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) this.importConfigJson(f);
      e.target.value = '';
    });

    // Primary Commit CTA (View 1 -> View 2)
    document.getElementById('btn-staging-commit-ottv')?.addEventListener('click', () => this.commitToOttvStudio());
  }
}
