/**
 * LUXA Engine Client — ONLY module in the frontend permitted to call `fetch('/api/...')`.
 * Every network interaction with the Python backend (Fase 4) goes through here so Fase 5
 * can swap this file for a Pyodide/in-browser worker without changing any UI component.
 */

async function _jsonOrThrow(res, fallbackMsg) {
  if (res.ok) {
    return res.json();
  }
  let detail = fallbackMsg;
  try {
    const body = await res.json();
    if (body && typeof body.detail === 'string' && body.detail.trim()) {
      detail = body.detail.trim();
    }
  } catch {
    // keep fallback message
  }
  const err = new Error(detail);
  err.status = res.status;
  throw err;
}

export async function upload(file, { signal } = {}) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/models', {
    method: 'POST',
    body: form,
    signal,
  });
  return _jsonOrThrow(res, 'Gagal mengunggah file model.');
}

export async function listModels({ signal } = {}) {
  const res = await fetch('/api/models', { signal });
  return _jsonOrThrow(res, 'Gagal memuat daftar model.');
}

export async function loadConfig(modelId, { signal } = {}) {
  const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/config`, { signal });
  return _jsonOrThrow(res, 'Gagal membaca konfigurasi proyek.');
}

export async function saveConfig(modelId, config, { signal } = {}) {
  const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });
  return _jsonOrThrow(res, 'Gagal menyimpan konfigurasi proyek.');
}

export async function inspect(modelId, config, { userAnswers = {}, signal } = {}) {
  const payload = {
    model: config?.model || {},
    roles: config?.roles || {},
    settings: config?.settings || null,
    advanced: config?.advanced || {},
    user_answers: userAnswers || {},
  };
  const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return _jsonOrThrow(res, 'Gagal memeriksa geometri model.');
}

export async function analyze(modelId, config, { signal } = {}) {
  const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });
  return _jsonOrThrow(res, 'Gagal menghitung OTTV model.');
}

export async function exposure(analysisId, date, hours = null, { northAngleDeg = null, signal } = {}) {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (Array.isArray(hours) && hours.length) params.set('hours', hours.join(','));
  if (northAngleDeg !== null && northAngleDeg !== undefined && Number.isFinite(Number(northAngleDeg))) {
    params.set('north_angle_deg', String(Number(northAngleDeg)));
  }
  const res = await fetch(
    `/api/analyses/${encodeURIComponent(analysisId)}/exposure?${params.toString()}`,
    { signal },
  );
  return _jsonOrThrow(res, 'Gagal menghitung paparan matahari.');
}

export async function exportReport(analysisId, fmt = 'template_prodi', { signal } = {}) {
  const res = await fetch(
    `/api/analyses/${encodeURIComponent(analysisId)}/export/${encodeURIComponent(fmt)}`,
    { signal },
  );
  if (!res.ok) {
    return _jsonOrThrow(res, 'Gagal menyiapkan file laporan.');
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const match = disp.match(/filename="?([^"]+)"?/i);
  const warnings = res.headers.get('X-Template-Warnings') || '';
  return {
    blob,
    filename: match ? match[1] : `Laporan_OTTV_LUXA.${fmt === 'pdf' ? 'pdf' : fmt === 'csv' ? 'csv' : 'xlsx'}`,
    warnings: warnings ? warnings.split(' | ').filter(Boolean) : [],
  };
}

export async function listMaterials({ signal } = {}) {
  const res = await fetch('/api/materials', { signal });
  return _jsonOrThrow(res, 'Gagal memuat katalog material.');
}

export async function validateMaterial(payload, { signal } = {}) {
  const res = await fetch('/api/materials/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return _jsonOrThrow(res, 'Validasi material gagal.');
}

export async function rematerial(analysisId, patch, { signal } = {}) {
  const res = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/rematerial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal,
  });
  return _jsonOrThrow(res, 'Gagal menghitung ulang material.');
}

export async function recommend(analysisId, req, { signal } = {}) {
  // Privacy rule (Fase 4e): never transmit user-entered prices to the server
  const safeReq = { ...req };
  delete safeReq.prices_map;
  const res = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(safeReq),
    signal,
  });
  return _jsonOrThrow(res, 'Gagal menghitung rekomendasi material.');
}

export async function listLocations({ signal } = {}) {
  const res = await fetch('/api/locations', { signal });
  return _jsonOrThrow(res, 'Gagal memuat daftar lokasi.');
}

export async function getExportTips({ signal } = {}) {
  const res = await fetch('/api/export-tips', { signal });
  return _jsonOrThrow(res, 'Gagal memuat panduan ekspor.');
}

export async function parseEpw(file, { signal } = {}) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/locations/parse-epw', {
    method: 'POST',
    body: form,
    signal,
  });
  return _jsonOrThrow(res, 'Gagal membaca file EPW.');
}

export const engine = {
  upload,
  listModels,
  loadConfig,
  saveConfig,
  inspect,
  analyze,
  exposure,
  export: exportReport,
  listMaterials,
  validateMaterial,
  rematerial,
  recommend,
  listLocations,
  getExportTips,
  parseEpw,
};
