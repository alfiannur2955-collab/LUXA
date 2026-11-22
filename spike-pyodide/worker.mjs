// Fase 5a spike: the whole engine runs here, off the UI thread.
// Protocol: postMessage({id, op, args}) -> {id, ok, result, timing} | {id, ok:false, error}
import { loadPyodide } from './vendor/pyodide/pyodide.mjs';
import { extract3dm } from './rhino_extract.mjs';

const BASE = new URL('./', import.meta.url).href;
let py = null;
let rhino = null;
let api = null;
const now = () => performance.now();

function heapMb() {
  return py ? Math.round(py._module.HEAP8.length / 1048576) : 0;
}

function resources() {
  return performance.getEntriesByType('resource').map((e) => ({
    name: e.name.replace(BASE, ''),
    transfer: e.transferSize,
    body: e.encodedBodySize,
    decoded: e.decodedBodySize,
    ms: Math.round(e.duration),
  }));
}

async function boot() {
  const t = { start: now() };
  py = await loadPyodide({ indexURL: BASE + 'vendor/pyodide/' });
  t.core = now();
  await py.loadPackage(['numpy', 'pydantic', 'micropip', 'packaging']);
  t.packages = now();
  const manifest = await (await fetch(BASE + 'vendor/manifest.json')).json();
  for (const group of manifest.stages || [manifest.wheels]) {
    const urls = group.map((w) => BASE + 'vendor/wheels/' + encodeURIComponent(w));
    py.globals.set('_wheel_urls', py.toPy(urls));
    await py.runPythonAsync('import micropip\nawait micropip.install(list(_wheel_urls), deps=False)');
  }
  t.wheels = now();
  const bundle = await (await fetch(BASE + 'vendor/backend_bundle.json')).json();
  for (const f of bundle) {
    const dir = '/backend/' + f.path.split('/').slice(0, -1).join('/');
    py.FS.mkdirTree(dir);
    py.FS.writeFile('/backend/' + f.path, f.content);
  }
  py.runPython(await (await fetch(BASE + 'luxa_engine.py')).text());
  api = py.globals;
  t.backend = now();
  const rhinoMod = await import('./vendor/rhino3dm/rhino3dm.module.js');
  rhino = await rhinoMod.default({ locateFile: (f) => BASE + 'vendor/rhino3dm/' + f });
  t.rhino = now();
  py.FS.mkdirTree('/work');
  return {
    core_s: (t.core - t.start) / 1e3,
    packages_s: (t.packages - t.core) / 1e3,
    wheels_s: (t.wheels - t.packages) / 1e3,
    backend_import_s: (t.backend - t.wheels) / 1e3,
    rhino3dm_s: (t.rhino - t.backend) / 1e3,
    total_s: (t.rhino - t.start) / 1e3,
    heap_mb: heapMb(),
    resources: resources(),
  };
}

function upload({ name, bytes, sidecars = [] }) {
  const id = 'm-' + Math.random().toString(36).slice(2, 10);
  const t = now();
  let fsPath = `/work/${id}-${name}`;
  let extract = 0;
  if (name.toLowerCase().endsWith('.3dm')) {
    const payload = extract3dm(rhino, new Uint8Array(bytes));
    fsPath += '.json';
    py.FS.writeFile(fsPath, JSON.stringify(payload));
    extract = (now() - t) / 1e3;
  } else {
    py.FS.writeFile(fsPath, new Uint8Array(bytes));
    for (const sc of sidecars) py.FS.writeFile(`/work/${sc.name}`, new Uint8Array(sc.bytes));
  }
  api.get('register_model')(id, fsPath, name);
  return { model_id: id, extract_s: extract };
}

function callJson(fn, ...args) {
  const t = now();
  const s = api.get(fn)(...args);
  const t1 = now();
  const result = JSON.parse(s);
  const parse = (now() - t1) / 1e3;
  const timing = JSON.parse(api.get('last_timing')());
  return { result, timing: { ...timing, call_s: (t1 - t) / 1e3, json_parse_s: parse, heap_mb: heapMb() } };
}

const OPS = {
  boot: async () => ({ result: await boot() }),
  upload: async (a) => ({ result: upload(a) }),
  inspect: async ({ modelId, req }) => callJson('inspect', modelId, req ? JSON.stringify(req) : ''),
  analyze: async ({ modelId, config }) => callJson('analyze', modelId, config ? JSON.stringify(config) : ''),
  exposure: async ({ analysisId, date, hours, northAngleDeg }) =>
    // JS null arrives in Python as JsNull, not None: pass undefined instead.
    callJson('exposure', analysisId, date, hours ? JSON.stringify(hours) : '', northAngleDeg == null ? undefined : northAngleDeg),
  rematerial: async ({ analysisId, patch }) => callJson('rematerial', analysisId, JSON.stringify(patch)),
  recommend: async ({ analysisId, req }) => callJson('recommend', analysisId, JSON.stringify(req)),
  exportReport: async ({ analysisId, fmt }) => {
    const t = now();
    const proxy = api.get('export_report')(analysisId, fmt);
    const bytes = proxy.toJs();
    proxy.destroy();
    return { result: bytes, timing: { call_s: (now() - t) / 1e3, bytes: bytes.length, heap_mb: heapMb() }, transfer: [bytes.buffer] };
  },
};

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    if (op !== 'boot' && !api) throw new Error('Engine belum dimuat.');
    const out = await OPS[op](args || {});
    self.postMessage({ id, ok: true, result: out.result, timing: out.timing }, out.transfer || []);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err).slice(-1500) });
  }
};
