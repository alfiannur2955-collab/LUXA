/**
 * LUXA by Alf Studio — Frontend Entry Point (Fase 4a + 4b-1).
 * Orchestrates shell (topbar, rail, feature cards), 4-step workflow screens,
 * 3D viewer + 4 camera projections + saved views + PNG capture, keyboard shortcuts,
 * Ctrl K command palette, ? shortcuts card, and backend communication via `engine.js`.
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
import { renderCompareScreen } from './steps/compare.js';
import { renderErrorScreen, renderLoadingScreen } from './steps/status.js';
import { renderUploadScreen } from './steps/upload.js';
import { renderCommandPalette } from './ui/commandPalette.js';
import { fmtFileSize } from './ui/escapeHtml.js';
import { installShortcuts } from './ui/shortcuts.js';
import { renderShortcutsModal } from './ui/shortcutsModal.js';
import { showToast } from './ui/toast.js';
import {
  createDefaultWorkspace,
  loadWorkspace,
  moveRailItemInWorkspace,
  renderDockCustomizerModal,
  saveWorkspace,
  toggleRailItemHidden,
} from './ui/workspace.js';
import {
  DIRECTION_NAMES,
  formatCameraDirectionLabel,
  PROJECTION_LABELS,
} from './viewer/cameras.js';
import { captureViewerPng } from './viewer/capture.js';
import { pieMenu } from './viewer/pieMenu.js';
import { viewer } from './viewer/viewer.js';
import { togglePanelSelection } from './viewer/selection.js';
import { SunDomeController } from './viewer/sundome.js';
import { exposureController } from './viewer/exposure.js';
import {
  createSavedViewRecord,
  deleteSavedViewInList,
  renameSavedViewInList,
  suggestViewName,
} from './viewer/views.js';

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

// ============================================================================
// Camera, Saved Views & Capture Handlers (Fase 4b-1)
// ============================================================================

function handleSetProjection(projection) {
  viewer.setProjection(projection, { direction: getState().cameraDirection });
  const liveDir = projection === 'elevation' ? getState().cameraDirection : viewer.getLiveDirection();
  setState({
    cameraProjection: projection,
    cameraDirection: liveDir || getState().cameraDirection,
    activeViewId: null,
    openPopover: null,
  });
}

function handleSelectDirection(code) {
  const s = getState();
  const forceElev = code === 'Atas';
  viewer.lookAtDirection(code, { forceElevation: forceElev });
  const nextProj = forceElev ? 'elevation' : s.cameraProjection;
  setState({
    cameraDirection: code,
    cameraProjection: nextProj,
    activeViewId: null,
  });
}

function handleFitCamera() {
  const s = getState();
  const bbox = s.analysisData?.summary?.bounding_box || s.inspectData?.bounding_box;
  if (bbox) {
    viewer.fitModel(bbox);
    showToast('Kamera disesuaikan ke seluruh model.', 'ok', 2000);
  }
}

function handleSaveView() {
  const s = getState();
  if (!s.inspectData && !s.analysisData) return;
  const camState = viewer.exportCameraState();
  const effDir = camState.projection === 'elevation' ? camState.direction : viewer.getLiveDirection();
  camState.direction = effDir || camState.direction;
  const name = suggestViewName(
    camState.projection,
    camState.direction,
    s.config?.saved_views || [],
  );
  const record = createSavedViewRecord({
    name,
    cameraState: camState,
    northAngleDeg: s.config?.settings?.north_angle_deg || 0,
    heatmapSmooth: Boolean(s.heatmapSmooth),
  });
  updateConfig((cfg) => {
    cfg.saved_views = [...(cfg.saved_views || []), record];
  });
  setState({ activeViewId: record.id });
  saveProjectAutosave(getState());
  showToast(`View tersimpan: ${record.name}`, 'ok', 2600);
}

function handleApplyView(view) {
  if (!view?.camera) return;
  viewer.applyCameraState(view.camera);
  setState({
    cameraProjection: view.camera.projection || view.projection || 'perspective',
    cameraDirection: view.camera.direction || view.direction || 'TG',
    heatmapSmooth: view.heatmap_smooth !== undefined ? Boolean(view.heatmap_smooth) : getState().heatmapSmooth,
    activeViewId: view.id,
  });
}

function handleRenameView(viewId, newName) {
  updateConfig((cfg) => {
    cfg.saved_views = renameSavedViewInList(cfg.saved_views, viewId, newName);
  });
  saveProjectAutosave(getState());
  showToast(`Nama view diubah menjadi "${newName}".`, 'ok', 2400);
}

function handleDeleteView(viewId) {
  const s = getState();
  updateConfig((cfg) => {
    cfg.saved_views = deleteSavedViewInList(cfg.saved_views, viewId);
  });
  if (s.activeViewId === viewId) {
    setState({ activeViewId: null });
  }
  saveProjectAutosave(getState());
  showToast('View tersimpan dihapus.', 'ok', 2200);
}

async function handleCapturePng(scale = null) {
  const s = getState();
  const effScale = scale || s.captureScale || 2;
  try {
    const res = await captureViewerPng(s, { scale: effScale });
    showToast(`Capture ${res.scale}x (${res.width} × ${res.height} px) diunduh.`, 'ok', 3000);
  } catch (err) {
    showToast(err.message || 'Gagal melakukan capture gambar.', 'fail');
  }
}

function handleChangeNorthAngle(deg) {
  const clean = ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
  updateConfig((cfg) => {
    cfg.settings.north_angle_deg = clean;
  });
  const s = getState();
  setState({ needsRecompute: Boolean(s.analysisData) });
  saveProjectAutosave(getState());
  if (s.analysisData && s.facadeFilter === 'sunlit_now') {
    exposureController.ensureExposureLoaded(s.sunDate, clean);
  }
}

function handleChangeSunDate(dateStr) {
  if (!dateStr) return;
  setState({ sunDate: dateStr, sunDomeVisible: true });
  const s = getState();
  if (s.analysisData && s.facadeFilter === 'sunlit_now') {
    exposureController.ensureExposureLoaded(dateStr);
  }
}

function handleChangeSunHour(hour) {
  exposureController.stopPlayback();
  const h = Math.max(6, Math.min(18, Math.round(Number(hour) || 13)));
  setState({ sunHour: h, sunDomeVisible: true });
  const s = getState();
  if (s.analysisData && s.facadeFilter === 'sunlit_now' && !s.exposureData) {
    exposureController.ensureExposureLoaded();
  }
}

function handleChangeFacadeFilter(filterMode) {
  setState({ facadeFilter: filterMode });
  if (filterMode === 'sunlit_now' && getState().analysisData) {
    setState({ sunDomeVisible: true });
    exposureController.ensureExposureLoaded();
  }
}

async function handleCreateAlternative({ name, glazingMaterialId, wallMaterialId, northAngleDeg }) {
  const s = getState();
  if (!s.modelId || !s.analysisData) return;

  const altConfig = mergeConfig(s.config);
  if (glazingMaterialId) altConfig.settings.glazing_material_id = glazingMaterialId;
  if (wallMaterialId) altConfig.settings.wall_material_id = wallMaterialId;
  if (Number.isFinite(Number(northAngleDeg))) {
    altConfig.settings.north_angle_deg = Number(northAngleDeg);
  }

  setState({ compareBusy: true });
  try {
    const result = await engine.analyze(s.modelId, altConfig);
    const existing = getState().alternatives || [];
    const codeChar = String.fromCharCode(65 + (existing.length % 26));
    const altRec = {
      id: `alt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      code: codeChar,
      name: String(name || `Variasi ${codeChar}`).trim(),
      config: altConfig,
      analysisData: result,
      createdAt: new Date().toISOString(),
    };
    setState({
      alternatives: [...existing, altRec],
      activeAlternativeId: altRec.id,
      compareBusy: false,
    });
    showToast(`Alternatif ${codeChar} selesai dihitung (${result.ottv_total_wm2} W/m²).`, 'ok', 2800);
  } catch (err) {
    setState({ compareBusy: false });
    showToast(err.message || 'Gagal menghitung alternatif desain.', 'fail');
  }
}

function handleApplyAlternative(altId) {
  const s = getState();
  const alt = (s.alternatives || []).find((a) => a.id === altId);
  if (!alt || !alt.analysisData) return;

  const prevGlz = (s.materials?.materials || []).find((m) => m.id === s.config?.settings?.glazing_material_id);
  const histEntry = {
    id: `hist_${Date.now().toString(36)}`,
    label: prevGlz ? prevGlz.name : 'Desain sebelumnya',
    config: mergeConfig(s.config),
    analysisData: s.analysisData,
    savedAt: new Date().toISOString(),
  };

  viewer.clearCompareMode();
  const next = setState({
    config: mergeConfig(alt.config),
    analysisData: alt.analysisData,
    designHistory: [histEntry, ...(s.designHistory || [])].slice(0, 12),
    selectedPanelIds: [],
    selectedOrientation: null,
    exposureData: null,
    needsRecompute: false,
    step: 'results',
    viewerMode: 'heatmap',
  });
  saveProjectAutosave(next);
  showToast(`Alternatif ${alt.code} diterapkan. Desain sebelumnya tersimpan di riwayat.`, 'ok', 3200);
}

function handleRestoreHistory(histId) {
  const s = getState();
  const item = (s.designHistory || []).find((h) => h.id === histId);
  if (!item) return;

  const curGlz = (s.materials?.materials || []).find((m) => m.id === s.config?.settings?.glazing_material_id);
  const swapEntry = {
    id: `hist_${Date.now().toString(36)}`,
    label: curGlz ? curGlz.name : 'Desain sebelumnya',
    config: mergeConfig(s.config),
    analysisData: s.analysisData,
    savedAt: new Date().toISOString(),
  };
  const nextHistory = [swapEntry, ...(s.designHistory || []).filter((h) => h.id !== histId)].slice(0, 12);
  const next = setState({
    config: mergeConfig(item.config),
    analysisData: item.analysisData,
    designHistory: nextHistory,
    selectedPanelIds: [],
    selectedOrientation: null,
    exposureData: null,
    needsRecompute: false,
  });
  saveProjectAutosave(next);
  showToast(`Desain "${item.label}" dipulihkan.`, 'ok', 2600);
}

const vbarHandlers = {
  onSetProjection: handleSetProjection,
  onSelectDirection: handleSelectDirection,
  onTogglePopover: (pop) => setState({ openPopover: pop }),
  onSaveView: handleSaveView,
  onApplyView: handleApplyView,
  onRenameView: handleRenameView,
  onDeleteView: handleDeleteView,
  onSetCaptureScale: (sc) => setState({ captureScale: sc }),
  onCapturePng: handleCapturePng,
  onChangeSunHour: handleChangeSunHour,
  onToggleSunPlay: () => exposureController.togglePlayback(),
  onRerender: () => setState({}),
};

// ============================================================================
// Model Lifecycle Handlers
// ============================================================================

async function runInspectAndOpenConfirm(
  modelId,
  filename,
  { fileSizeBytes = null, config = null, confirm = null, targetStep = 'confirm' } = {},
) {
  const prevStep = getState().step === 'loading' ? 'upload' : getState().step;
  const ctrl = new AbortController();
  activeAbortController = ctrl;

  const sizeText = fileSizeBytes ? `${fmtFileSize(fileSizeBytes)} · memeriksa geometri` : 'Memeriksa geometri model';
  setState({
    previousStep: prevStep,
    step: 'loading',
    activeRailCard: null,
    openPopover: null,
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
      activeViewId: null,
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
      const nViews = parsed.config?.saved_views?.length || 0;
      showToast(
        nViews > 0
          ? `Proyek .ottv.json dimuat (${nViews} view tersimpan).`
          : 'Proyek .ottv.json berhasil dimuat.',
        'ok',
      );
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
    openPopover: null,
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

    exposureController.stopPlayback();
    const result = await engine.analyze(s.modelId, configToRun, { signal: ctrl.signal });
    const next = setState({
      config: configToRun,
      analysisData: result,
      viewerMode: 'heatmap',
      selectedOrientation: null,
      selectedPanelIds: [],
      exposureData: null,
      facadeFilter: 'all',
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

function toggleTheme() {
  const next = getState().theme === 'dark' ? 'light' : 'dark';
  saveTheme(next);
  applyThemeToDom(next);
  setState({ theme: next });
}

function applyWorkspaceChange(nextWs) {
  saveWorkspace(nextWs);
  setState({
    workspace: nextWs,
    advancedMode: nextWs.preset === 'lanjut',
    activeRailCard: nextWs.preset === 'presentasi' ? null : getState().activeRailCard,
  });
}

function handleSetWorkspacePreset(preset) {
  const cur = getState().workspace || createDefaultWorkspace();
  const next = { ...cur, preset };
  applyWorkspaceChange(next);
  const labels = { belajar: 'Belajar', lanjut: 'Lanjut', presentasi: 'Presentasi' };
  showToast(`Workspace: ${labels[preset] || preset}`, 'ok', 2000);
}

const panelBuilders = createRailPanelBuilders({
  onGoToUpload: () => setState({ step: 'upload', activeRailCard: null, openPopover: null }),
  onNavigateStep: (step) => setState({ step, activeRailCard: null, openPopover: null }),
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
  onChangeNorth: handleChangeNorthAngle,
  onChangeSunDate: handleChangeSunDate,
  onChangeSunHour: handleChangeSunHour,
  onChangeSunDomeScale: (pct) => setState({ sunDomeScale: Math.max(50, Math.min(200, Number(pct) || 100)), sunDomeVisible: true }),
  onResetSunDomeScale: () => {
    setState({ sunDomeScale: 100, sunDomeVisible: true });
    handleFitCamera();
  },
  onToggleSunPlay: () => exposureController.togglePlayback(),
  onChangeFacadeFilter: handleChangeFacadeFilter,
  onChangeCalcMode: (mode) => {
    updateConfig((cfg) => {
      cfg.settings.mode = mode;
    });
    setState({ needsRecompute: Boolean(getState().analysisData) });
    saveProjectAutosave(getState());
  },
  onSetProjection: handleSetProjection,
  onSelectDirection: handleSelectDirection,
  onChangeViewerMode: (mode) => setState({ viewerMode: mode }),
  onFitCamera: handleFitCamera,
  onToggleTheme: toggleTheme,
  onSetWorkspacePreset: handleSetWorkspacePreset,
  onOpenDockCustomizer: () => setState({ dockCustomizerOpen: true, activeRailCard: null }),
  onOpenCompare: () => {
    if (!getState().analysisData) {
      showToast('Hitung OTTV terlebih dahulu sebelum membuka Bandingkan.', 'warn');
      return;
    }
    exposureController.stopPlayback();
    setState({ step: 'compare', activeRailCard: null, openPopover: null });
  },
  onRecompute: () => handleCalculateOttv(),
  onDownloadExcel: () => handleExportFormat('template_prodi'),
  onDownloadFormat: (fmt) => handleExportFormat(fmt),
  onDownloadProject: () => {
    downloadProjectFile(getState());
    showToast('File proyek (.ottv.json) diunduh.', 'ok');
  },
});

function renderApp(state) {
  if (!rootEl) return;
  applyThemeToDom(state.theme);
  rootEl.classList.toggle('is-presentation', state.workspace?.preset === 'presentasi');
  updateDocumentTitle(state.step);

  const frag = document.createDocumentFragment();

  frag.appendChild(
    renderTopbar(state, {
      onHome: () => setState({ step: 'upload', activeRailCard: null, openPopover: null }),
      onNavigateStep: (target) => setState({ step: target, activeRailCard: null, openPopover: null }),
      onOpenCommandPalette: () =>
        setState({ commandPaletteOpen: true, shortcutsModalOpen: false, openPopover: null }),
      onToggleTheme: toggleTheme,
      onToggleAdvanced: () => {
        const nextPreset = state.workspace?.preset === 'lanjut' ? 'belajar' : 'lanjut';
        handleSetWorkspacePreset(nextPreset);
      },
    }),
  );

  frag.appendChild(
    renderRail(state, {
      onToggleCard: (cardId) => {
        if (cardId === 'compare' && state.analysisData) {
          if (state.step === 'compare') {
            viewer.clearCompareMode();
            setState({ step: 'results', activeRailCard: null, openPopover: null });
          } else {
            exposureController.stopPlayback();
            setState({ step: 'compare', activeRailCard: null, openPopover: null });
          }
          return;
        }
        setState({
          activeRailCard: state.activeRailCard === cardId ? null : cardId,
          openPopover: null,
        });
      },
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
        onChangeFloorHeight: async (h) => {
          updateConfig((cfg) => {
            cfg.settings.floor_height_m = h;
            cfg.settings.floor_mode = h != null ? 'uniform' : 'auto';
          });
          saveProjectAutosave(getState());
          await refreshInspectReadOnly();
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
          setState({ step: 'inspect', viewerMode: 'classification', openPopover: null });
        },
      }),
    );
  } else if (state.step === 'inspect') {
    frag.appendChild(
      renderInspectScreen(state, {
        vbarHandlers,
        onChangeViewerMode: (mode) => setState({ viewerMode: mode }),
        onChangeNorth: handleChangeNorthAngle,
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
            handleFitCamera();
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
        onBackToConfirm: () => setState({ step: 'confirm', openPopover: null }),
        onOpenMaterialPanel: () => setState({ activeRailCard: 'material', openPopover: null }),
        onGoToResults: () => setState({ step: 'results', viewerMode: 'heatmap', openPopover: null }),
        onCalculateOttv: () => handleCalculateOttv(),
      }),
    );
  } else if (state.step === 'compare') {
    frag.appendChild(
      renderCompareScreen(state, {
        onExitCompare: () => {
          viewer.clearCompareMode();
          setState({ step: 'results', openPopover: null });
        },
        onChangeSplitRatio: (ratio) => setState({ compareSplitRatio: ratio }),
        onSelectAlternative: (altId) => setState({ activeAlternativeId: altId }),
        onDeleteAlternative: (altId) => {
          const remaining = (getState().alternatives || []).filter((a) => a.id !== altId);
          setState({
            alternatives: remaining,
            activeAlternativeId: remaining[0]?.id || null,
          });
        },
        onCreateAlternative: handleCreateAlternative,
        onApplyAlternative: handleApplyAlternative,
        onRestoreHistory: handleRestoreHistory,
        onRerender: () => setState({}),
      }),
    );
  } else if (state.step === 'results') {
    frag.appendChild(
      renderResultsScreen(state, {
        vbarHandlers,
        onChangeViewerMode: (mode) => setState({ viewerMode: mode }),
        onChangeNorth: handleChangeNorthAngle,
        onToggleFormulaPill: (open) => setState({ formulaPillExpanded: Boolean(open) }),
        onExitPresentation: () => handleSetWorkspacePreset('belajar'),
        onChangeHeatmapGranularity: (gran) => setState({ heatmapGranularity: gran }),
        onToggleHeatmapSmooth: (enabled) => setState({ heatmapSmooth: Boolean(enabled) }),
        onPickPanel: (panel, additive) => {
          if (!panel) {
            setState({ selectedPanelIds: [], selectedOrientation: null });
            return;
          }
          const nextIds = togglePanelSelection(getState().selectedPanelIds, panel.id, additive);
          setState({
            selectedPanelIds: nextIds,
            selectedOrientation: nextIds.length === 1 ? panel.orientation_code || null : getState().selectedOrientation,
          });
        },
        onClearPanelSelection: () => setState({ selectedPanelIds: [] }),
        onSelectOrientation: (code) => {
          setState({ selectedOrientation: code });
          if (code) {
            handleSelectDirection(code);
          }
        },
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

  const cmdEl = renderCommandPalette(state, {
    onClose: () => setState({ commandPaletteOpen: false }),
    onSetProjection: (p) => {
      handleSetProjection(p);
      showToast(`Proyeksi: ${PROJECTION_LABELS[p] || p}`, 'ok', 1800);
    },
    onSelectDirection: (c) => {
      handleSelectDirection(c);
      const s = getState();
      showToast(`Kamera: ${formatCameraDirectionLabel(s.cameraProjection, c)}`, 'ok', 1800);
    },
    onFitCamera: handleFitCamera,
    onSaveView: handleSaveView,
    onApplyView: handleApplyView,
    onCapturePng: handleCapturePng,
    onSelectGroup: (g) => {
      setState({ selectedGroup: g });
      showToast(`Menyorot grup "${g}"`, 'ok', 2000);
    },
    onOpenPanel: (panelId) => setState({ activeRailCard: panelId }),
    onToggleTheme: toggleTheme,
    onOpenShortcuts: () => setState({ shortcutsModalOpen: true }),
    onDownloadExcel: () => handleExportFormat('template_prodi'),
    onDownloadProject: () => downloadProjectFile(getState()),
  });
  if (cmdEl) frag.appendChild(cmdEl);

  const shortcutsEl = renderShortcutsModal(state, {
    onClose: () => setState({ shortcutsModalOpen: false }),
  });
  if (shortcutsEl) frag.appendChild(shortcutsEl);

  const dockEl = renderDockCustomizerModal(state, {
    onClose: () => setState({ dockCustomizerOpen: false }),
    onMove: (id, delta) => applyWorkspaceChange(moveRailItemInWorkspace(getState().workspace, id, delta)),
    onToggleHide: (id) => applyWorkspaceChange(toggleRailItemHidden(getState().workspace, id)),
    onSetModeBarPosition: (pos) => applyWorkspaceChange({ ...getState().workspace, modeBarPosition: pos }),
    onReset: () => {
      applyWorkspaceChange(createDefaultWorkspace());
      showToast('Urutan dan isi dock dikembalikan ke bawaan.', 'ok', 2200);
    },
  });
  if (dockEl) frag.appendChild(dockEl);

  rootEl.innerHTML = '';
  rootEl.appendChild(frag);
}

installShortcuts({
  getState,
  pieMenu,
  handlers: {
    onToggleCommandPalette: () =>
      setState((s) => ({
        ...s,
        commandPaletteOpen: !s.commandPaletteOpen,
        shortcutsModalOpen: false,
        openPopover: null,
      })),
    onCloseCommandPalette: () => setState({ commandPaletteOpen: false }),
    onToggleShortcuts: () =>
      setState((s) => ({
        ...s,
        shortcutsModalOpen: !s.shortcutsModalOpen,
        commandPaletteOpen: false,
      })),
    onCloseShortcuts: () => setState({ shortcutsModalOpen: false }),
    onClosePopover: () => setState({ openPopover: null }),
    onCloseRailCard: () => {
      const s = getState();
      if (s.dockCustomizerOpen) {
        setState({ dockCustomizerOpen: false });
      } else if (s.activeRailCard) {
        setState({ activeRailCard: null });
      } else if (s.workspace?.preset === 'presentasi') {
        handleSetWorkspacePreset('belajar');
      }
    },
    onSetProjection: (p) => {
      handleSetProjection(p);
      showToast(`Proyeksi: ${PROJECTION_LABELS[p] || p}`, 'ok', 1800);
    },
    onSelectDirection: (c) => {
      handleSelectDirection(c);
      const s = getState();
      showToast(`Kamera: ${formatCameraDirectionLabel(s.cameraProjection, c)}`, 'ok', 1800);
    },
    onFitCamera: handleFitCamera,
    onSaveView: handleSaveView,
    onCapturePng: handleCapturePng,
    onToggleSunPlayback: () => exposureController.togglePlayback(),
  },
});

async function bootstrap() {
  const savedTheme = loadSavedTheme();
  const savedWs = loadWorkspace();
  applyThemeToDom(savedTheme);
  viewer.attachSunDomeController(new SunDomeController());
  viewer.setOnCameraDirectionSettled((liveDir) => {
    const s = getState();
    if (s.cameraProjection !== 'elevation' && liveDir && liveDir !== s.cameraDirection) {
      setState({ cameraDirection: liveDir });
    }
  });
  subscribe(renderApp);
  setState({
    theme: savedTheme,
    workspace: savedWs,
    advancedMode: savedWs.preset === 'lanjut',
  });

  try {
    const [mats, locs] = await Promise.all([engine.listMaterials(), engine.listLocations()]);
    setState({ materials: mats, locations: locs });
  } catch {
    // Catalogs will retry naturally when backend is reachable
  }
}

bootstrap();
