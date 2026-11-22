// Fase 5a spike: run the backend in Pyodide under Node and compare with native results.
// Usage (repo root): node spike-pyodide/node_probe.mjs [fixture-id ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const V = path.join(here, 'vendor');
const only = process.argv.slice(2);
const T = () => performance.now();
const log = (...a) => console.log(...a);

const t0 = T();
const { loadPyodide } = await import(pathToFileURL(path.join(V, 'pyodide', 'pyodide.mjs')).href);
const py = await loadPyodide({ indexURL: path.join(V, 'pyodide') + '/' });
const tCore = T();
await py.loadPackage(['numpy', 'pydantic', 'micropip', 'packaging']);
const tPkg = T();
py.FS.mkdirTree('/wheels');
for (const w of fs.readdirSync(path.join(V, 'wheels'))) py.FS.writeFile('/wheels/' + w, fs.readFileSync(path.join(V, 'wheels', w)));
const wheelList = fs.readdirSync(path.join(V, 'wheels')).map((w) => 'emfs:/wheels/' + w);
await py.runPythonAsync(`import micropip\nawait micropip.install(${JSON.stringify(wheelList)}, deps=False)`);
const tWheels = T();
for (const f of JSON.parse(fs.readFileSync(path.join(V, 'backend_bundle.json'), 'utf8'))) {
  py.FS.mkdirTree('/backend/' + path.posix.dirname(f.path));
  py.FS.writeFile('/backend/' + f.path, f.content);
}
py.runPython(fs.readFileSync(path.join(here, 'luxa_engine.py'), 'utf8'));
const tBoot = T();
const rhinoMod = await import(pathToFileURL(path.join(V, 'rhino3dm', 'rhino3dm.module.js')).href);
const rhino = await rhinoMod.default();
const { extract3dm } = await import(pathToFileURL(path.join(here, 'rhino_extract.mjs')).href);
const tRhino = T();
log(JSON.stringify({ phase: 'load', core_s: (tCore - t0) / 1e3, packages_s: (tPkg - tCore) / 1e3, wheels_s: (tWheels - tPkg) / 1e3, backend_import_s: (tBoot - tWheels) / 1e3, rhino3dm_s: (tRhino - tBoot) / 1e3, total_s: (tRhino - t0) / 1e3 }));

const ref = JSON.parse(fs.readFileSync(path.join(here, 'results', 'reference_native.json'), 'utf8'));
const results = {};
for (const fx of JSON.parse(fs.readFileSync(path.join(here, 'fixtures.json'), 'utf8'))) {
  if (only.length && !only.includes(fx.id)) continue;
  const src = path.join(root, fx.path);
  if (!fs.existsSync(src)) { results[fx.id] = { skipped: 'file not present' }; continue; }
  const name = path.basename(src);
  const bytes = fs.readFileSync(src);
  const a = T();
  let fsPath = '/work/' + name;
  py.FS.mkdirTree('/work');
  let extractS = 0;
  if (name.toLowerCase().endsWith('.3dm')) {
    const payload = extract3dm(rhino, new Uint8Array(bytes));
    fsPath += '.json';
    py.FS.writeFile(fsPath, JSON.stringify(payload));
    extractS = (T() - a) / 1e3;
  } else {
    py.FS.writeFile(fsPath, bytes);
    const mtl = src.replace(/\.obj$/i, '.mtl');
    if (mtl !== src && fs.existsSync(mtl)) py.FS.writeFile('/work/' + path.basename(mtl), fs.readFileSync(mtl));
  }
  try {
    const out = JSON.parse(py.globals.get('run_analysis')(fsPath, name));
    const r = ref[fx.id] || {};
    results[fx.id] = {
      ...out,
      extract_s: Number(extractS.toFixed(3)),
      total_s: Number(((T() - a) / 1e3).toFixed(2)),
      native_ottv: r.ottv_total_wm2,
      native_s: r.seconds,
      diff_ottv: r.ottv_total_wm2 != null ? Number((out.ottv_total_wm2 - r.ottv_total_wm2).toFixed(4)) : null,
      wasm_heap_mb: Number((py._module.HEAP8.length / 1048576).toFixed(0)),
    };
  } catch (e) {
    results[fx.id] = { error: String(e).slice(-600) };
  }
  log(fx.id, JSON.stringify(results[fx.id]));
}
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', only.length ? `node_probe_${only.join('_')}.json` : 'node_probe.json'), JSON.stringify(results, null, 1));
