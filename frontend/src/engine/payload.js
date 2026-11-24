/**
 * Pembongkar format kirim ramping dari engine (A3-04 Fase 1, docs/RENCANA_A3-04_UKURAN_DATA.md).
 * Dipakai bersama oleh engine browser (./local.js) dan engine server (./server.js), sehingga kode
 * tampilan tetap menerima `analysis.panels` dan `*_elements` dalam bentuk lama.
 *
 * Engine menyimpan hasil lengkap untuk laporan & ganti material; yang dikirim ke sini versi ramping:
 *  - `group_name`/`material_id` panel aktif berupa indeks ke `panel_tables`
 *  - panel nonaktif hanya {id, active, vertices}; `centroid` dihitung dari rata-rata vertex
 *  - mesh rangka/peneduh/atap/konteks dalam base64 Float32/Uint32
 *  - ganti material hanya mengirim `panel_updates` (kolom angka panel aktif)
 */

const FORMAT = 'slim-1';
const MESH_KEYS = ['shading_elements', 'frame_elements', 'roof_elements', 'context_elements'];
const MAX_REMEMBERED = 4;
const remembered = new Map(); // analysis_id -> hasil yang sudah dibongkar (dasar untuk ganti material)

function b64ToBuffer(b64) {
  const bin = atob(b64 || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function decodeMesh(el) {
  if (!el || el.encoding !== 'f32u32-b64') return el;
  const v = new Float32Array(b64ToBuffer(el.vertices_b64));
  const f = new Uint32Array(b64ToBuffer(el.faces_b64));
  const vertices = new Array(v.length / 3);
  for (let i = 0, j = 0; j < v.length; i += 1, j += 3) vertices[i] = [v[j], v[j + 1], v[j + 2]];
  const faces = new Array(f.length / 3);
  for (let i = 0, j = 0; j < f.length; i += 1, j += 3) faces[i] = [f[j], f[j + 1], f[j + 2]];
  return { group_name: el.group_name, vertices, faces };
}

function centroidOf(vs) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of vs) {
    x += v[0];
    y += v[1];
    z += v[2];
  }
  const n = vs.length || 1;
  const r = (a) => Math.round((a / n) * 1000) / 1000;
  return [r(x), r(y), r(z)];
}

function remember(analysis) {
  if (!analysis?.analysis_id) return;
  remembered.set(analysis.analysis_id, analysis);
  while (remembered.size > MAX_REMEMBERED) remembered.delete(remembered.keys().next().value);
}

/** Hasil hitung penuh dari engine -> bentuk yang dipakai tampilan. */
export function expandAnalysis(result) {
  if (!result || result.payload_format !== FORMAT || !Array.isArray(result.panels)) {
    remember(result);
    return result;
  }
  const t = result.panel_tables || {};
  for (const p of result.panels) {
    if (p.active === false) continue;
    if (typeof p.group_name === 'number') p.group_name = t.group_name?.[p.group_name];
    if (typeof p.material_id === 'number') p.material_id = t.material_id?.[p.material_id];
    if (!p.centroid && Array.isArray(p.vertices) && p.vertices.length) p.centroid = centroidOf(p.vertices);
  }
  for (const k of MESH_KEYS) if (Array.isArray(result[k])) result[k] = result[k].map(decodeMesh);
  delete result.panel_tables;
  delete result.payload_format;
  remember(result);
  return result;
}

/**
 * Hasil ganti material -> hasil lengkap, memakai geometri hasil `baseId`.
 * Melempar galat bila hasil dasar sudah tidak ada (pemanggil lalu meminta hitung ulang).
 */
export function applyRematerial(result, baseId) {
  if (!result || result.payload_format !== FORMAT || !result.panel_updates) {
    remember(result);
    return result;
  }
  const prev = remembered.get(baseId);
  if (!prev?.panels) throw new Error('Data hasil sebelumnya sudah tidak ada di browser. Klik Hitung ulang.');
  const u = result.panel_updates;
  const matTable = u.tables?.material_id || [];
  const fields = Object.entries(u.fields || {});
  const index = new Map(u.ids.map((id, i) => [id, i]));
  const panels = prev.panels.map((p) => {
    const i = index.get(p.id);
    if (i === undefined) return p;
    const q = { ...p };
    for (const [f, col] of fields) q[f] = f === 'material_id' ? matTable[col[i]] : col[i];
    return q;
  });
  const out = { ...result, panels };
  for (const k of MESH_KEYS) if (!(k in result) && k in prev) out[k] = prev[k];
  delete out.panel_updates;
  delete out.geometry_from;
  delete out.payload_format;
  remember(out);
  return out;
}

// ---------------------------------------------------------------------------
// ?perf=1 : catat ukuran dan waktu di konsol (Fase 0)
// ---------------------------------------------------------------------------
export const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

export function perfLog(op, info) {
  if (!PERF) return;
  const parts = Object.entries(info).map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v * 10) / 10 : v}`);
  console.info(`[LUXA perf] ${op}: ${parts.join(' ')}`);
}

// ---------------------------------------------------------------------------
// Inspeksi: permintaan yang sama persis memakai hasil terakhir (layar Konfirmasi memanggil ulang
// inspeksi di setiap pilihan, termasuk "Lanjut ke Inspeksi" tanpa perubahan apa pun).
// ---------------------------------------------------------------------------
const inspectMemo = new Map(); // `${modelId}|${JSON req}` -> hasil
const MAX_INSPECT_MEMO = 6;

export async function memoInspect(modelId, req, run) {
  const key = `${modelId}|${JSON.stringify(req)}`;
  if (inspectMemo.has(key)) {
    const hit = inspectMemo.get(key);
    inspectMemo.delete(key);
    inspectMemo.set(key, hit);
    if (PERF) perfLog('inspect', { cache: 'hit' });
    return hit;
  }
  const res = await run();
  inspectMemo.set(key, res);
  while (inspectMemo.size > MAX_INSPECT_MEMO) inspectMemo.delete(inspectMemo.keys().next().value);
  return res;
}

/** Dipanggil saat file model diunggah/diganti: hasil inspeksi lama untuk model itu tidak berlaku lagi. */
export function forgetInspect(modelId) {
  for (const k of [...inspectMemo.keys()]) if (k.startsWith(`${modelId}|`)) inspectMemo.delete(k);
}
