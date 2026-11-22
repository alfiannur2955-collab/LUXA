/**
 * LUXA in-browser engine (Fase 5b). Runs the Python backend in Pyodide, off the UI thread.
 *
 * Loading is staged (docs/SPIKE_PYODIDE.md):
 *   boot  : Pyodide core, numpy, pydantic, trimesh, ladybug-geometry, LUXA backend
 *   lazy  : rhino3dm.js (first .3dm), IfcOpenShell (first .ifc), openpyxl (first Excel export)
 * Messages in : {id, op, args}            ops: boot | upload | call
 * Messages out: {id, ok, json|result|error} and {type:'status', phase, label, progress}
 */
import { extract3dm } from './rhinoExtract.js';

let BASE = '';
let py = null;
let dispatch = null;
let manifest = null;
let rhino = null;
let ifcReady = false;
let xlsxReady = false;
let bootPromise = null;

const status = (phase, label, progress = null) => self.postMessage({ type: 'status', phase, label, progress });

async function installWheels(names) {
  if (!names.length) return;
  const urls = names.map((w) => BASE + 'wheels/' + encodeURIComponent(w));
  py.globals.set('_luxa_wheels', py.toPy(urls));
  await py.runPythonAsync('import micropip\nawait micropip.install(list(_luxa_wheels), deps=False)');
}

async function boot(assetBase) {
  BASE = assetBase;
  status('boot', 'Memuat Python di browser', 0.05);
  const { loadPyodide } = await import(/* @vite-ignore */ BASE + 'pyodide/pyodide.mjs');
  py = await loadPyodide({ indexURL: BASE + 'pyodide/' });
  status('boot', 'Memuat numpy dan pydantic', 0.35);
  await py.loadPackage(['numpy', 'pydantic', 'micropip', 'packaging'], { messageCallback: () => {} });
  manifest = await (await fetch(BASE + 'manifest.json')).json();
  status('boot', 'Memuat pustaka geometri', 0.6);
  await installWheels(manifest.boot);
  status('boot', 'Memuat engine LUXA', 0.8);
  const bundle = await (await fetch(BASE + 'backend_bundle.json')).json();
  for (const f of bundle.files) {
    const target = '/' + f.path;
    py.FS.mkdirTree(target.split('/').slice(0, -1).join('/') || '/');
    if (f.b64) {
      const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      py.FS.writeFile(target, bin);
    } else {
      py.FS.writeFile(target, f.content);
    }
  }
  py.FS.mkdirTree('/work');
  py.runPython(`
import sys, types
class _Any:
    def __init__(self, *a, **k): pass
_rh = types.ModuleType("rhino3dm")
_rh.__getattr__ = lambda name: type(name, (_Any,), {})  # rhino3dm.js reads .3dm files in JS
sys.modules["rhino3dm"] = _rh
if "/backend" not in sys.path:
    sys.path.insert(0, "/backend")
import browser_api
`);
  dispatch = py.globals.get('browser_api').dispatch;
  status('ready', 'Engine siap', 1);
  return { version: manifest.version, heap_mb: Math.round(py._module.HEAP8.length / 1048576) };
}

async function ensureRhino() {
  if (rhino) return;
  status('lazy', 'Memuat pembaca file Rhino (.3dm)', null);
  const mod = await import(/* @vite-ignore */ BASE + 'rhino3dm/rhino3dm.module.js');
  rhino = await mod.default({ locateFile: (f) => BASE + 'rhino3dm/' + f });
  status('ready', 'Engine siap', 1);
}

async function ensureIfc() {
  if (ifcReady) return;
  status('lazy', 'Memuat pembaca file IFC (sekali saja, ±12 MB)', null);
  for (const group of manifest.ifc) await installWheels(group);
  call('enable_ifc', {});
  ifcReady = true;
  status('ready', 'Engine siap', 1);
}

async function ensureXlsx() {
  if (xlsxReady) return;
  status('lazy', 'Memuat penulis Excel', null);
  await installWheels(manifest.xlsx);
  xlsxReady = true;
  status('ready', 'Engine siap', 1);
}

function call(op, args) {
  return dispatch(op, JSON.stringify(args || {}));
}

function callOrThrow(op, args) {
  const out = JSON.parse(call(op, args));
  if (!out.ok) {
    const err = new Error(out.detail);
    err.status = out.status;
    throw err;
  }
  return out.result;
}

async function upload({ modelId, name, bytes, sidecars = [], detect = true }) {
  const dir = `/work/${modelId}`;
  py.FS.mkdirTree(dir);
  const fsPath = `${dir}/${name}`;
  py.FS.writeFile(fsPath, new Uint8Array(bytes));
  for (const sc of sidecars) py.FS.writeFile(`${dir}/${sc.name}`, new Uint8Array(sc.bytes));
  const up = callOrThrow('unpack_upload', { fs_path: fsPath });
  let enginePath = up.resolved_path;
  if (up.needs_3dm_extract) {
    await ensureRhino();
    const payload = extract3dm(rhino, py.FS.readFile(up.resolved_path));
    enginePath = up.resolved_path + '.json';
    py.FS.writeFile(enginePath, JSON.stringify(payload));
  }
  if (up.needs_ifc) await ensureIfc();
  if (!detect) {
    callOrThrow('register_model', { model_id: modelId, engine_path: enginePath, display_name: up.filename });
    return JSON.stringify({ ok: true, result: { model_id: modelId, filename: up.filename } });
  }
  return call('register_upload', {
    model_id: modelId,
    engine_path: enginePath,
    display_name: up.filename,
    sig_path: up.resolved_path,
    unpack_notes: up.unpack_notes,
  });
}

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    if (op === 'boot') {
      bootPromise = bootPromise || boot(args.assetBase);
      const info = await bootPromise;
      self.postMessage({ id, ok: true, result: info });
      return;
    }
    if (!bootPromise) throw new Error('Engine belum dimuat.');
    await bootPromise;
    let json;
    if (op === 'upload') {
      json = await upload(args);
    } else {
      const fmt = args.op === 'export_report' ? args.args?.fmt : null;
      if (fmt === 'xlsx' || fmt === 'template_prodi') await ensureXlsx();
      json = call(args.op, args.args);
    }
    // Send the JSON string as-is: parsing on the main thread avoids a second structured clone.
    self.postMessage({ id, ok: true, json });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err), status: err && err.status });
  }
};
