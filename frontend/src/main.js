/**
 * LUXA by Alf Studio — Frontend Entry Point (Fase 4a).
 * Orchestrates shell (topbar, rail, feature cards), 4-step workflow screens,
 * 3D viewer, project persistence, and backend communication via `engine.js`.
 */

import './theme.css';

import { engine } from './engine.js';
import { createRailPanelBuilders } from './panels/railPanels.js';
import {
  downloadProjectFile,
  loadProjectAutosave,
  loadSavedTheme,
  readProjectFile,
  saveProjectAutosave,
  saveTheme,
} from './project.js';
import { renderCardHost } from './shell/cardHost.js';
import { renderRail } from './shell/rail.js';
import { renderTopbar } from './shell/topbar.js';
import {
  STEP_TITLES,
  buildUserAnswers,
  collectAcceptedProvisionalFlags,
  createDefaultConfig,
  createInitialConfirm,
  evaluateConfirmGate,
  getState,
  mergeConfig,
  setState,
  subscribe,
  updateConfig,
} from './state.js';
import { renderConfirmScreen } from './steps/confirm.js';
import { renderInspectScreen } from './steps/inspect.js';
import { renderResultsScreen } from './steps/results.js';
import { renderErrorScreen, renderLoadingScreen } from './steps/status.js';
import { renderUploadScreen } from './steps/upload.js';
import { fmtFileSize } from './ui/escapeHtml.js';
import { showToast } from './ui/toast.js';
import { viewer } from './viewer/viewer.js';

const rootEl = document.getElementById('app');
let activeAbortController = null;
let cachedAutosave = loadProjectAutosave();

function applyThemeToDom(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  if (rootEl) {
    rootEl.classList.toggle('dark', isDark);
  }
}

function updateDocumentTitle(step) {
  const suffix = STEP_TITLES[step] || 'Unggah model';
  document.title = `LUXA · ${suffix}`;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function cancelActiveOperation(returnStep = 'upload') {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  setState({ step: returnStep, loading: null });
}

function buildInitialConfirmForInspect(inspectData, existingConfirm = null) {
  const base = existingConfirm ? { ...createInitialConfirm(), ...existingConfirm } : createInitialConfirm();
  const audit = inspectData?.stage1_audit || {};
  const flags = inspectData?.sanity_flags || [];

  if (!audit.unit_needs_confirmation && audit.unit_source !== 'bbox_guess') {
    base.unitConfirmed = true;
  }
  if (Number(audit.z_ground_offset_m || 0) >= -0.5) {
    base.groundConfirmed = true;
  }
  if (!flags.some((f) => f.code === 'NO_GLAZING')) {
    base.noGlazingConfirmed = true;
  }
  return base;
}

async function runInspectAndOpenConfirm(modelId, filename, { fileSizeBytes = null, config = null, confirm = null, targetStep = 'confirm' } = {}) {
  const prevStep = getState().step === 'loading' ? 'upload' : getState().step;
  const ctrl = new AbortController();
  activeAbortController = ctrl;

  const sizeText = fileSizeBytes ? `${fmtFileSize(fileSizeBytes)} · memeriksa geometri` : 'Memeriksa geometri model';
  setState({
    previousStep: prevStep,
    step: 'loading',
    activeRailCard: null,
    loading: {
      title: `Memproses ${filename}`,
      subtitle: sizeText,
      stages: [
        { label: 'Membaca file', status: 'done' },
        { label: 'Menyatukan satuan, sumbu, dan grup', status: 'running' },
        { label: 'Menjalankan pemeriksaan awal', status: 'pending' },
      ],
      onCancel: () => cancelActiveOperation(prevStep),
    },
  });

  try {
    let effConfig = config ? mergeConfig(config) : null;
    if (!effConfig) {
      try {
        const cfgResp = await engine.loadConfig(modelId, { signal: ctrl.signal });
        effConfig = mergeConfig(cfgResp?.config);
      } catch {
        effConfig = createDefaultConfig();
      }
    }
    effConfig.model.file = filename;

    const inspectData = await engine.inspect(modelId, effConfig, {
      userAnswers: buildUserAnswers({ ...getState(), config: effConfig, confirm: confirm || createInitialConfirm() }),
      signal: ctrl.signal,
    });

    const nextConfirm = buildInitialConfirmForInspect(inspectData, confirm);
    if (effConfig.model.model_scope) {
      nextConfirm.scopeConfirmed = true;
    }

    const groups = inspectData.groups || [];
    if (groups.length === 0) {
      setState({
        step: 'error',
        loading: null,
        error: {
          title: 'Tidak ada geometri yang terbaca',
          detail: `File "${filename}" tidak menghasilkan bidang yang bisa diperiksa.`,
          tips: [
            'Jika file berasal dari Rhino, buka dalam mode Shaded lalu simpan ulang (jangan SaveSmall).',
            'Pastikan layer selubung tidak dalam keadaan tersembunyi sebelum diekspor.',
          ],
          primaryAction: {
            label: 'Unggah file lain',
            onClick: () => setState({ step: 'upload', error: null }),
          },
          secondaryAction: {
            label: 'Coba contoh bawaan',
            onClick: () => handleLoadExample('contoh_kotak_m', 'Kotak 4 lantai'),
          },
        },
      });
      return;
    }

    const nextState = setState({
      modelId,
      filename: inspectData.filename || filename,
      fileSizeBytes,
      fileSignature: inspectData.file_signature || null,
      config: effConfig,
      confirm: nextConfirm,
      inspectData,
      analysisData: null,
      acknowledgedFlags: {},
      selectedGroup: null,
      selectedOrientation: null,
      viewerMode: 'classification',
      needsRecompute: false,
      step: targetStep,
      loading: null,
      error: null,
    });
    saveProjectAutosave(nextState);
    cachedAutosave = loadProjectAutosave();
  } catch (err) {
    if (err.name === 'AbortError') return;
    setState({
      step: 'error',
      loading: null,
      error: {
        title: 'Gagal membaca model 3D',
        detail: err.message || 'Terjadi kendala saat memeriksa file.',
        tips: [
          'Periksa apakah format file adalah .3dm, .ifc, .obj (+ .mtl dalam .zip), atau .glb.',
          'Jika file sangat besar, coba sembunyikan furnitur atau elemen interior sebelum ekspor.',
        ],
        primaryAction: {
          label: 'Unggah file lain',
          onClick: () => setState({ step: 'upload', error: null }),
        },
        secondaryAction: {
          label: 'Coba contoh bawaan',
          onClick: () => handleLoadExample('contoh_kotak_m', 'Kotak 4 lantai'),
        },
      },
    });
  } finally {
    if (activeAbortController === ctrl) activeAbortController = null;
  }
}

async function refreshInspectReadOnly() {
  const s = getState();
  if (!s.modelId) return;
  try {
    const inspectData = await engine.inspect(s.modelId, s.config, {
      userAnswers: buildUserAnswers(s),
    });
    const nextConfirm = buildInitialConfirmForInspect(inspectData, s.confirm);
    const next = setState({
      inspectData,
      confirm: nextConfirm,
      needsRecompute: Boolean(s.analysisData),
    });
    saveProjectAutosave(next);
  } catch (err) {
    showToast(err.message || 'Gagal memperbarui inspeksi.', 'fail');
  }
}

async function handleUploadFile(file) {
  const ctrl = new AbortController();
  activeAbortController = ctrl;

  setState({
    previousStep: 'upload',
    step: 'loading',
    activeRailCard: null,
    loading: {
      title: `Memproses ${file.name}`,
      subtitle: `${fmtFileSize(file.size)} · mengunggah ke server LUXA`,
      stages: [
        { label: 'Mengunggah file model', status: 'running' },
        { label: 'Membaca satuan, sumbu, dan grup', status: 'pending' },
        { label: 'Menjalankan pemeriksaan awal', status: 'pending' },
      ],
      onCancel: () => cancelActiveOperation('upload'),
    },
  });

  try {
    const uploaded = await engine.upload(file, { signal: ctrl.signal });
    await runInspectAndOpenConfirm(uploaded.model_id, uploaded.filename || file.name, {
      fileSizeBytes: file.size,
      config: uploaded.config,
      targetStep: 'confirm',
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    setState({
      step: 'error',
      loading: null,
      error: {
        title: 'File tidak dapat diunggah',
        detail: err.message || 'Server tidak dapat memproses file ini.',
        tips: [
          'Pastikan ekstensi file didukung (.3dm, .ifc, .obj, .glb, .zip, .hbjson).',
          'Pastikan server LUXA sedang berjalan.',
        ],
        primaryAction: {
          label: 'Pilih file lain',
          onClick: () => setState({ step: 'upload', error: null }),
        },
        secondaryAction: {
          label: 'Coba contoh bawaan',
          onClick: () => handleLoadExample('contoh_kotak_m', 'Kotak 4 lantai'),
        },
      },
    });
  } finally {
    if (activeAbortController === ctrl) activeAbortController = null;
  }
}

async function handleLoadExample(modelId, label) {
  await runInspectAndOpenConfirm(modelId, label, {
    targetStep: 'confirm',
  });
}

async function handleOpenProjectFile(file) {
  try {
    const parsed = await readProjectFile(file);
    const current = getState();
    const targetModelId = parsed.modelId || current.modelId;

    if (targetModelId) {
      await runInspectAndOpenConfirm(targetModelId, parsed.filename || file.name, {
        config: parsed.config,
        confirm: parsed.confirm,
        targetStep: 'confirm',
      });
      showToast('Proyek .ottv.json berhasil dimuat.', 'ok');
    } else {
      setState({
        config: parsed.config,
        confirm: parsed.confirm ? { ...createInitialConfirm(), ...parsed.confirm } : createInitialConfirm(),
      });
      showToast('Konfigurasi dimuat. Unggah file model 3D terkait untuk melanjutkan.', 'warn');
    }
  } catch (err) {
    showToast(err.message || 'Gagal membuka file proyek.', 'fail');
  }
}

async function handleCalculateOttv() {
  const s = getState();
  const gate = evaluateConfirmGate(s);
  if (!gate.ready) {
    showToast(gate.missingLabel || 'Selesaikan langkah Konfirmasi terlebih dahulu.', 'warn');
    setState({ step: 'confirm' });
    return;
  }
  if (!s.modelId) return;

  const ctrl = new AbortController();
  activeAbortController = ctrl;
  const prevStep = s.step === 'results' ? 'results' : 'inspect';

  const acceptedProvisional = collectAcceptedProvisionalFlags(s);
  const unresolvedProvisional = (s.inspectData?.sanity_flags || [])
    .filter((f) => f.accept_makes_provisional && !s.acknowledgedFlags[f.id])
    .map((f) => f.id);
  const allAccepted = [...new Set([...acceptedProvisional, ...unresolvedProvisional])];

  const configToRun = mergeConfig(s.config);
  configToRun.model.accepted_flags = allAccepted;

  setState({
    previousStep: prevStep,
    step: 'loading',
    activeRailCard: null,
    loading: {
      title: `Menghitung OTTV ${s.filename || ''}`,
      subtitle: 'Menyimpan konfigurasi dan menjalankan raycast peneduh SNI 6389:2020',
      stages: [
        { label: 'Menyimpan konfigurasi proyek', status: 'running' },
        { label: 'Mencari sisi luar fasad dan mengukur peneduh', status: 'pending' },
        { label: 'Menghitung OTTV per arah dan RTTV', status: 'pending' },
      ],
      onCancel: () => cancelActiveOperation(prevStep),
    },
  });

  try {
    // Spec §2: Config is written to server ONLY on Hitung, never silently on re-inspect.
    await engine.saveConfig(s.modelId, configToRun, { signal: ctrl.signal });

    setState({
      loading: {
        title: `Menghitung OTTV ${s.filename || ''}`,
        subtitle: 'Menjalankan perhitungan termal dan pembayangan 3D',
        stages: [
          { label: 'Menyimpan konfigurasi proyek', status: 'done' },
          { label: 'Mencari sisi luar fasad dan mengukur peneduh', status: 'running' },
          { label: 'Menghitung OTTV per arah dan RTTV', status: 'pending' },
        ],
        onCancel: () => cancelActiveOperation(prevStep),
      },
    });

    const result = await engine.analyze(s.modelId, configToRun, { signal: ctrl.signal });
    const next = setState({
      config: configToRun,
      analysisData: result,
      viewerMode: 'heatmap',
      selectedOrientation: null,
      needsRecompute: false,
      step: 'results',
      loading: null,
      error: null,
    });
    saveProjectAutosave(next);
    cachedAutosave = loadProjectAutosave();
  } catch (err) {
    if (err.name === 'AbortError') return;
    setState({
      step: 'error',
      loading: null,
      error: {
        title: 'Perhitungan OTTV gagal',
        detail: err.message || 'Engine tidak dapat menyelesaikan perhitungan.',
        tips: [
          'Periksa kembali klasifikasi grup di langkah Inspeksi (pastikan minimal ada satu grup dinding atau kaca).',
          'Periksa elevasi muka tanah agar tidak melebihi puncak bangunan.',
        ],
        primaryAction: {
          label: 'Kembali ke Inspeksi',
          onClick: () => setState({ step: 'inspect', error: null }),
        },
        secondaryAction: {
          label: 'Unggah file lain',
          onClick: () => setState({ step: 'upload', error: null }),
        },
      },
    });
  } finally {
    if (activeAbortController === ctrl) activeAbortController = null;
  }
}

async function handleExportFormat(fmt) {
  const s = getState();
  const aid = s.analysisData?.analysis_id;
  if (!aid) {
    showToast('Hitung OTTV terlebih dahulu sebelum mengunduh laporan.', 'warn');
    return;
  }
  try {
    const { blob, filename, warnings } = await engine.export(aid, fmt);
    const cleanName = fmt === 'template_prodi'
      ? `Laporan_OTTV_${(s.filename || 'LUXA').replace(/\.[^.]+$/, '')}.xlsx`
      : filename;
    triggerBlobDownload(blob, cleanName);
    if (warnings.length > 0) {
      showToast(`Laporan diunduh dengan catatan: ${warnings[0]}`, 'warn', 6000);
    } else {
      showToast('Laporan berhasil diunduh.', 'ok');
    }
  } catch (err) {
    showToast(err.message || 'Gagal mengunduh laporan.', 'fail');
  }
}

const panelBuilders = createRailPanelBuilders({
  onGoToUpload: () => setState({ step: 'upload', activeRailCard: null }),
  onNavigateStep: (step) => setState({ step, activeRailCard: null }),
  onChangeRoleMaterial: (fieldKey, materialId) => {
    updateConfig((cfg) => {
      cfg.settings[fieldKey] = materialId;
    });
    setState({ needsRecompute: Boolean(getState().analysisData) });
    saveProjectAutosave(getState());
  },
  onChangeSfSource: (sfSource) => {
    updateConfig((cfg) => {
      cfg.settings.sf_source = sfSource;
    });
    setState({ needsRecompute: Boolean(getState().analysisData) });
    saveProjectAutosave(getState());
  },
  onChangeCity: (cityId) => {
    updateConfig((cfg) => {
      cfg.settings.city_preset = cityId;
    });
    setState({ needsRecompute: Boolean(getState().analysisData) });
    saveProjectAutosave(getState());
  },
  onChangeNorth: (deg) => {
    updateConfig((cfg) => {
      cfg.settings.north_angle_deg = deg;
    });
    setState({ needsRecompute: Boolean(getState().analysisData) });
    saveProjectAutosave(getState());
  },
  onChangeCalcMode: (mode) => {
    updateConfig((cfg) => {
      cfg.settings.mode = mode;
    });
    setState({ needsRecompute: Boolean(getState().analysisData) });
    saveProjectAutosave(getState());
  },
  onChangeViewerMode: (mode) => setState({ viewerMode: mode }),
  onFitCamera: () => {
    const s = getState();
    const bbox = s.analysisData?.summary?.bounding_box || s.inspectData?.bounding_box;
    if (bbox) viewer.fitModel(bbox);
  },
  onToggleTheme: () => toggleTheme(),
  onRecompute: () => handleCalculateOttv(),
  onDownloadExcel: () => handleExportFormat('template_prodi'),
  onDownloadFormat: (fmt) => handleExportFormat(fmt),
  onDownloadProject: () => {
    downloadProjectFile(getState());
    showToast('File proyek (.ottv.json) diunduh.', 'ok');
  },
});

function toggleTheme() {
  const next = getState().theme === 'dark' ? 'light' : 'dark';
  saveTheme(next);
  applyThemeToDom(next);
  setState({ theme: next });
}

function openQuickCommandToast() {
  const s = getState();
  setState({ activeRailCard: s.activeRailCard ? null : 'model' });
  showToast('Palet perintah lengkap (Ctrl K) akan hadir di tahap 4b. Kartu fitur dibuka.', 'ok', 3500);
}

function renderApp(state) {
  if (!rootEl) return;
  applyThemeToDom(state.theme);
  updateDocumentTitle(state.step);

  const frag = document.createDocumentFragment();

  frag.appendChild(
    renderTopbar(state, {
      onHome: () => setState({ step: 'upload', activeRailCard: null }),
      onNavigateStep: (target) => setState({ step: target, activeRailCard: null }),
      onOpenCommandPalette: openQuickCommandToast,
      onToggleTheme: toggleTheme,
      onToggleAdvanced: () => setState({ advancedMode: !state.advancedMode }),
    }),
  );

  frag.appendChild(
    renderRail(state, {
      onToggleCard: (cardId) =>
        setState({ activeRailCard: state.activeRailCard === cardId ? null : cardId }),
    }),
  );

  if (state.step === 'loading') {
    frag.appendChild(renderLoadingScreen(state));
  } else if (state.step === 'error') {
    frag.appendChild(renderErrorScreen(state));
  } else if (state.step === 'confirm') {
    frag.appendChild(
      renderConfirmScreen(state, {
        onBackToUpload: () => setState({ step: 'upload' }),
        onRerender: () => setState({}),
        onChangeUnit: async (unitMode) => {
          updateConfig((cfg) => {
            cfg.model.unit_mode = unitMode;
          });
          setState({ confirm: { ...getState().confirm, unitConfirmed: unitMode !== 'auto' } });
          await refreshInspectReadOnly();
        },
        onConfirmUnit: async (unit) => {
          updateConfig((cfg) => {
            cfg.model.unit_mode = unit;
          });
          setState({ confirm: { ...getState().confirm, unitConfirmed: true } });
          await refreshInspectReadOnly();
        },
        onChangeUpAxis: async (upAxis) => {
          updateConfig((cfg) => {
            cfg.model.up_axis = upAxis;
          });
          await refreshInspectReadOnly();
        },
        onChangeFloorHeight: (h) => {
          updateConfig((cfg) => {
            cfg.settings.floor_height_m = h;
          });
          saveProjectAutosave(getState());
        },
        onChangeExpectedFloors: async (n) => {
          updateConfig((cfg) => {
            cfg.model.expected_floors = n;
          });
          await refreshInspectReadOnly();
        },
        onChooseGround: async (choice, cutoffM) => {
          updateConfig((cfg) => {
            cfg.model.z_ground_cutoff_m = cutoffM;
          });
          setState({
            confirm: { ...getState().confirm, groundConfirmed: true, groundChoice: choice },
          });
          await refreshInspectReadOnly();
        },
        onChooseScope: async (scopeVal) => {
          updateConfig((cfg) => {
            cfg.model.model_scope = scopeVal;
            cfg.model.exterior_detection_mode = scopeVal === 'building_site' ? 'raycast' : 'auto';
          });
          setState({ confirm: { ...getState().confirm, scopeConfirmed: true } });
          await refreshInspectReadOnly();
        },
        onChooseNoGlazing: async (choice, assumedWwr) => {
          updateConfig((cfg) => {
            cfg.settings.default_wall_wwr = choice === 'assumed_wwr' ? assumedWwr : null;
          });
          setState({
            confirm: { ...getState().confirm, noGlazingConfirmed: true, noGlazingChoice: choice },
          });
          await refreshInspectReadOnly();
        },
        onChangeCity: (cityId) => {
          updateConfig((cfg) => {
            cfg.settings.city_preset = cityId;
          });
          saveProjectAutosave(getState());
        },
        onChangeSfSource: (sfSource) => {
          updateConfig((cfg) => {
            cfg.settings.sf_source = sfSource;
          });
          saveProjectAutosave(getState());
        },
        onChangeNorth: (deg) => {
          updateConfig((cfg) => {
            cfg.settings.north_angle_deg = deg;
          });
          saveProjectAutosave(getState());
        },
        onProceedToInspect: async () => {
          await refreshInspectReadOnly();
          setState({ step: 'inspect', viewerMode: 'classification' });
        },
      }),
    );
  } else if (state.step === 'inspect') {
    frag.appendChild(
      renderInspectScreen(state, {
        onSelectGroup: (groupName) => setState({ selectedGroup: groupName }),
        onChangeGroupCategory: async (groupName, newCat) => {
          updateConfig((cfg) => {
            cfg.roles.group_category_overrides[groupName] = newCat;
          });
          await refreshInspectReadOnly();
        },
        onFocusFlagInModel: (flag) => {
          const target = flag.group_name || flag.group_names?.[0] || null;
          if (target) {
            setState({ selectedGroup: target });
            showToast(`Menyorot grup "${target}" di viewer.`, 'ok', 2600);
          } else {
            const bbox = getState().inspectData?.bounding_box;
            if (bbox) viewer.fitModel(bbox);
            showToast('Kamera disesuaikan ke seluruh model.', 'ok', 2400);
          }
        },
        onAcknowledgeFlag: (flag, action) => {
          const prev = getState().acknowledgedFlags;
          setState({
            acknowledgedFlags: {
              ...prev,
              [flag.id]: { action, provisional: Boolean(flag.accept_makes_provisional) },
            },
          });
        },
        onBackToConfirm: () => setState({ step: 'confirm' }),
        onOpenMaterialPanel: () => setState({ activeRailCard: 'material' }),
        onGoToResults: () => setState({ step: 'results', viewerMode: 'heatmap' }),
        onCalculateOttv: () => handleCalculateOttv(),
      }),
    );
  } else if (state.step === 'results') {
    frag.appendChild(
      renderResultsScreen(state, {
        onChangeViewerMode: (mode) => setState({ viewerMode: mode }),
        onSelectOrientation: (code) => setState({ selectedOrientation: code }),
        onRecompute: () => handleCalculateOttv(),
        onDownloadExcel: () => handleExportFormat('template_prodi'),
        onDownloadProject: () => {
          downloadProjectFile(getState());
          showToast('File proyek (.ottv.json) diunduh.', 'ok');
        },
      }),
    );
  } else {
    frag.appendChild(
      renderUploadScreen(state, {
        savedAutosave: cachedAutosave,
        onUploadFile: handleUploadFile,
        onLoadExample: handleLoadExample,
        onOpenProjectFile: handleOpenProjectFile,
        onResumeAutosave: (saved) => {
          runInspectAndOpenConfirm(saved.modelId, saved.filename || saved.modelId, {
            config: saved.config,
            confirm: saved.confirm,
            targetStep: 'confirm',
          });
        },
      }),
    );
  }

  frag.appendChild(
    renderCardHost(state, {
      panelBuilders,
      onClose: () => setState({ activeRailCard: null }),
    }),
  );

  rootEl.innerHTML = '';
  rootEl.appendChild(frag);
}

// Keyboard shortcuts: Escape closes active rail card, Ctrl+K opens command trigger
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && getState().activeRailCard) {
    e.preventDefault();
    setState({ activeRailCard: null });
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openQuickCommandToast();
  }
});

async function bootstrap() {
  const savedTheme = loadSavedTheme();
  applyThemeToDom(savedTheme);
  subscribe(renderApp);
  setState({ theme: savedTheme });

  try {
    const [mats, locs] = await Promise.all([engine.listMaterials(), engine.listLocations()]);
    setState({ materials: mats, locations: locs });
  } catch {
    // Catalogs will retry naturally when backend is reachable
  }
}

bootstrap();
