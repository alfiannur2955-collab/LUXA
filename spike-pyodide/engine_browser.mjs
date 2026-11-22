// Fase 5a spike: same function names as frontend/src/engine.js, backed by the Web Worker.
// Fase 5b swaps engine.js' fetch() bodies for these calls.
let worker = null;
let seq = 0;
const pending = new Map();

function call(op, args, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve({ result: e.data.result, timing: e.data.timing });
      else p.reject(new Error(e.data.error));
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, args }, transfer);
  });
}

export const boot = () => call('boot');
export async function upload(file, sidecars = []) {
  const bytes = await file.arrayBuffer();
  const sc = await Promise.all(sidecars.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })));
  return call('upload', { name: file.name, bytes, sidecars: sc }, [bytes, ...sc.map((s) => s.bytes)]);
}
export const inspect = (modelId, req) => call('inspect', { modelId, req });
export const analyze = (modelId, config) => call('analyze', { modelId, config });
export const exposure = (analysisId, date, hours = null, { northAngleDeg = null } = {}) =>
  call('exposure', { analysisId, date, hours, northAngleDeg });
export const exportReport = (analysisId, fmt = 'xlsx') => call('exportReport', { analysisId, fmt });
export const rematerial = (analysisId, patch) => call('rematerial', { analysisId, patch });
export const recommend = (analysisId, req) => call('recommend', { analysisId, req });
