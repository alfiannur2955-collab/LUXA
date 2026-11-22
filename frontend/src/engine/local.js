/**
 * LUXA engine, browser mode (Fase 5b): same functions as ./server.js, but everything runs in a
 * Web Worker (./worker.js) with Pyodide. Model files and configs stay on the user's device
 * (IndexedDB, ./store.js); no request ever carries a model file.
 */
import * as store from './store.js';

const SAMPLES = {
  contoh_kotak_m: { url: 'samples/01_kotak_m.3dm', name: '01_kotak_m.3dm', title: 'Kotak 4 lantai' },
  fasad_tower_twisted: {
    url: 'samples/Fasad_Tower_Twisted.3dm',
    name: 'Fasad_Tower_Twisted.3dm',
    title: 'Fasad tower twisted',
  },
};

let worker = null;
let seq = 0;
const pending = new Map();
const listeners = new Set();
let lastStatus = { phase: 'idle', label: 'Engine belum dimuat', progress: 0 };
let bootPromise = null;
const inWorker = new Set(); // model ids registered in the current worker
const geometry = new Map(); // analysis_id -> Map(panel id -> vertices), for rematerial results
const MAX_GEOMETRY = 4;

function emitStatus(s) {
  lastStatus = { ...lastStatus, ...s };
  for (const fn of listeners) {
    try {
      fn(lastStatus);
    } catch {
      // listener errors must not break the engine
    }
  }
}

export function onEngineStatus(fn) {
  listeners.add(fn);
  fn(lastStatus);
  return () => listeners.delete(fn);
}

export function isEngineReady() {
  return lastStatus.phase === 'ready';
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'status') {
      emitStatus({ phase: m.phase, label: m.label, progress: m.progress ?? lastStatus.progress });
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (!m.ok) {
      const err = new Error(m.error || 'Engine gagal.');
      err.status = m.status;
      p.reject(err);
      return;
    }
    if (m.json === undefined) {
      p.resolve(m.result);
      return;
    }
    const out = JSON.parse(m.json);
    if (out.ok) p.resolve(out.result);
    else {
      const err = new Error(out.detail || 'Engine gagal.');
      err.status = out.status;
      if (out.trace) console.warn('[LUXA engine]', out.trace);
      p.reject(err);
    }
  };
  worker.onerror = (e) => {
    emitStatus({ phase: 'error', label: 'Engine gagal dimuat. Muat ulang halaman.', progress: 0 });
    for (const [, p] of pending) p.reject(new Error(e.message || 'Engine berhenti.'));
    pending.clear();
  };
  return worker;
}

function post(op, args, transfer = [], signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Dibatalkan', 'AbortError'));
  const id = ++seq;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // The worker cannot stop Python mid-run; an aborted call just ignores the late answer.
    signal?.addEventListener('abort', () => {
      if (pending.delete(id)) reject(new DOMException('Dibatalkan', 'AbortError'));
    });
    w.postMessage({ id, op, args }, transfer);
  });
}

export function warmUpEngine() {
  if (!bootPromise) {
    const assetBase = new URL('luxa-engine/', document.baseURI).href;
    emitStatus({ phase: 'boot', label: 'Menyiapkan engine', progress: 0.02 });
    bootPromise = post('boot', { assetBase }).catch((err) => {
      bootPromise = null;
      emitStatus({ phase: 'error', label: 'Engine gagal dimuat. Periksa koneksi lalu muat ulang.', progress: 0 });
      throw err;
    });
  }
  return bootPromise;
}

async function api(op, args, { signal } = {}) {
  await warmUpEngine();
  return post('call', { op, args }, [], signal);
}

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Same id as backend/main.py `_slugify_filename`, so .ottv.json files stay portable. */
async function modelIdFor(filename) {
  const clean = filename.trim();
  const slug = clean.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  return `upload_${slug}_${(await sha1Hex(clean)).slice(0, 6)}`;
}

async function sendModel(modelId, name, bytes, sidecars, { detect, signal }) {
  await warmUpEngine();
  const copy = bytes.slice(0); // keep the stored copy intact (the transfer detaches it)
  const sc = sidecars.map((s) => ({ name: s.name, bytes: s.bytes.slice(0) }));
  const res = await post('upload', { modelId, name, bytes: copy, sidecars: sc, detect }, [copy, ...sc.map((s) => s.bytes)], signal);
  inWorker.add(modelId);
  return res;
}

async function ensureModel(modelId, { signal } = {}) {
  if (inWorker.has(modelId)) return;
  if (SAMPLES[modelId]) {
    const s = SAMPLES[modelId];
    const res = await fetch(new URL(s.url, document.baseURI));
    if (!res.ok) throw new Error(`Contoh bawaan '${s.title}' tidak ditemukan.`);
    await sendModel(modelId, s.name, await res.arrayBuffer(), [], { detect: false, signal });
    return;
  }
  const rec = await store.getModel(modelId);
  if (!rec) {
    const err = new Error('File model tidak ditemukan di browser ini. Unggah ulang file modelnya.');
    err.status = 404;
    throw err;
  }
  await sendModel(modelId, rec.name, rec.bytes, rec.sidecars || [], { detect: false, signal });
}

function displayName(modelId) {
  return SAMPLES[modelId]?.name;
}

function rememberGeometry(analysis) {
  if (!analysis?.analysis_id || !Array.isArray(analysis.panels)) return;
  const m = new Map();
  for (const p of analysis.panels) if (p.vertices) m.set(p.id, p.vertices);
  geometry.set(analysis.analysis_id, m);
  while (geometry.size > MAX_GEOMETRY) geometry.delete(geometry.keys().next().value);
}

function attachGeometry(result, baseId) {
  if (result?.geometry_from !== 'previous') return result;
  const m = geometry.get(baseId);
  if (m) for (const p of result.panels || []) if (!p.vertices && m.has(p.id)) p.vertices = m.get(p.id);
  delete result.geometry_from;
  rememberGeometry(result);
  return result;
}

// ---------------------------------------------------------------------------
// Public API (mirrors ./server.js)
// ---------------------------------------------------------------------------

export async function upload(file, { signal, sidecars = [] } = {}) {
  const modelId = await modelIdFor(file.name);
  const bytes = await file.arrayBuffer();
  const sc = await Promise.all(sidecars.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })));
  const result = await sendModel(modelId, file.name, bytes, sc, { detect: true, signal });
  try {
    await store.putModel({ model_id: modelId, name: file.name, size: file.size, bytes, sidecars: sc });
  } catch (err) {
    console.warn('[LUXA] Model tidak tersimpan di browser (IndexedDB):', err);
  }
  const saved = await store.getConfig(modelId).catch(() => null);
  if (saved) result.config = saved;
  return result;
}

export async function listModels() {
  const uploaded = await store.listModelMeta().catch(() => []);
  return {
    models: [
      ...Object.entries(SAMPLES).map(([id, s]) => ({ id, title: s.title, filename: s.name, is_uploaded: false })),
      ...uploaded.map((m) => ({ id: m.model_id, title: m.name, filename: m.name, is_uploaded: true, size: m.size })),
    ],
  };
}

export async function loadConfig(modelId, { signal } = {}) {
  const saved = await store.getConfig(modelId).catch(() => null);
  if (saved) return { model_id: modelId, saved: true, config: saved };
  const rec = SAMPLES[modelId] ? null : await store.getModel(modelId).catch(() => null);
  const name = displayName(modelId) || rec?.name || '';
  const config = await api('default_config', { display_name: name }, { signal });
  return { model_id: modelId, saved: false, config };
}

export async function saveConfig(modelId, config, { signal } = {}) {
  const rec = SAMPLES[modelId] ? null : await store.getModel(modelId).catch(() => null);
  const name = displayName(modelId) || rec?.name || '';
  const normalized = await api('normalize_config', { config, display_name: name }, { signal });
  await store.putConfig(modelId, normalized).catch(() => {});
  return { status: 'saved', model_id: modelId, config: normalized };
}

export async function inspect(modelId, config, { userAnswers = {}, signal } = {}) {
  await ensureModel(modelId, { signal });
  const req = {
    model: config?.model || {},
    roles: config?.roles || {},
    settings: config?.settings || null,
    advanced: config?.advanced || {},
    user_answers: userAnswers || {},
  };
  return api('inspect', { model_id: modelId, req }, { signal });
}

export async function analyze(modelId, config, { signal } = {}) {
  await ensureModel(modelId, { signal });
  const out = await api('analyze', { model_id: modelId, config }, { signal });
  rememberGeometry(out);
  return out;
}

export function exposure(analysisId, date, hours = null, { northAngleDeg = null, signal } = {}) {
  const nad = northAngleDeg !== null && northAngleDeg !== undefined && Number.isFinite(Number(northAngleDeg))
    ? Number(northAngleDeg)
    : null;
  return api('exposure', { analysis_id: analysisId, date, hours: Array.isArray(hours) && hours.length ? hours : null, north_angle_deg: nad }, { signal });
}

export async function exportReport(analysisId, fmt = 'xlsx', { signal } = {}) {
  const out = await api('export_report', { analysis_id: analysisId, fmt }, { signal });
  const bin = Uint8Array.from(atob(out.bytes_b64), (c) => c.charCodeAt(0));
  return { blob: new Blob([bin], { type: out.media_type }), filename: out.filename, warnings: out.warnings || [] };
}

export function listMaterials({ signal } = {}) {
  return api('list_materials', {}, { signal });
}

export function validateMaterial(payload, { signal } = {}) {
  return api('validate_material', { payload }, { signal });
}

export async function rematerial(analysisId, patch, { signal } = {}) {
  const out = await api('rematerial', { analysis_id: analysisId, req: patch }, { signal });
  return attachGeometry(out, analysisId);
}

export function recommend(analysisId, req, { signal } = {}) {
  const safeReq = { ...req };
  delete safeReq.prices_map; // prices never leave the UI (Fase 4e)
  return api('recommend', { analysis_id: analysisId, req: safeReq }, { signal });
}

export function listLocations({ signal } = {}) {
  return api('list_locations', {}, { signal });
}

export function getExportTips({ signal } = {}) {
  return api('export_tips', {}, { signal });
}

export async function parseEpw(file, { signal } = {}) {
  return api('parse_epw', { text: await file.text(), filename: file.name }, { signal });
}
