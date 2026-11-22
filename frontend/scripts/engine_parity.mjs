/**
 * Runs the in-browser engine (same assets as the app: public/luxa-engine) under Node and prints
 * {fixture: {ottv_total_wm2, rttv_wm2, panels}} as JSON. Used by tests/test_browser_engine_parity.py.
 * Usage: node frontend/scripts/engine_parity.mjs <model> [<model> ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extract3dm } from '../src/engine/rhinoExtract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const E = path.resolve(here, '..', 'public', 'luxa-engine');
const manifest = JSON.parse(fs.readFileSync(path.join(E, 'manifest.json'), 'utf8'));
const { loadPyodide } = await import(pathToFileURL(path.join(E, 'pyodide', 'pyodide.mjs')).href);
const py = await loadPyodide({ indexURL: path.join(E, 'pyodide') + '/' });
await py.loadPackage(['numpy', 'pydantic', 'micropip', 'packaging'], { messageCallback: () => {} });
async function install(names) {
  if (!names.length) return;
  py.FS.mkdirTree('/wheels');
  for (const w of names) py.FS.writeFile('/wheels/' + w, fs.readFileSync(path.join(E, 'wheels', w)));
  py.globals.set('_w', py.toPy(names.map((w) => 'emfs:/wheels/' + w)));
  await py.runPythonAsync('import micropip\nawait micropip.install(list(_w), deps=False)');
}
await install(manifest.boot);
for (const f of JSON.parse(fs.readFileSync(path.join(E, 'backend_bundle.json'), 'utf8')).files) {
  const t = '/' + f.path;
  py.FS.mkdirTree(path.posix.dirname(t));
  py.FS.writeFile(t, f.b64 ? Buffer.from(f.b64, 'base64') : f.content);
}
py.runPython(`
import sys, types
class _Any:
    def __init__(self, *a, **k): pass
_rh = types.ModuleType("rhino3dm"); _rh.__getattr__ = lambda n: type(n, (_Any,), {}); sys.modules["rhino3dm"] = _rh
sys.path.insert(0, "/backend")
import browser_api, json
`);
const dispatch = py.globals.get('browser_api').dispatch;
const call = (op, args) => {
  const out = JSON.parse(dispatch(op, JSON.stringify(args)));
  if (!out.ok) throw new Error(out.detail);
  return out.result;
};
let rhino = null;
let ifc = false;
const results = {};
for (const [i, src] of process.argv.slice(2).entries()) {
  const name = path.basename(src);
  const dir = `/work/m${i}`;
  py.FS.mkdirTree(dir);
  py.FS.writeFile(`${dir}/${name}`, fs.readFileSync(src));
  const mtl = src.replace(/\.obj$/i, '.mtl');
  if (mtl !== src && fs.existsSync(mtl)) py.FS.writeFile(`${dir}/${path.basename(mtl)}`, fs.readFileSync(mtl));
  try {
    const up = call('unpack_upload', { fs_path: `${dir}/${name}` });
    let enginePath = up.resolved_path;
    if (up.needs_3dm_extract) {
      if (!rhino) rhino = await (await import(pathToFileURL(path.join(E, 'rhino3dm', 'rhino3dm.module.js')).href)).default();
      enginePath += '.json';
      py.FS.writeFile(enginePath, JSON.stringify(extract3dm(rhino, py.FS.readFile(up.resolved_path))));
    }
    if (up.needs_ifc && !ifc) {
      for (const g of manifest.ifc) await install(g);
      call('enable_ifc', {});
      ifc = true;
    }
    call('register_upload', { model_id: `m${i}`, engine_path: enginePath, display_name: up.filename, sig_path: up.resolved_path });
    const cfg = call('default_config', { display_name: up.filename });
    cfg.model.model_scope = 'full_building';
    const a = call('analyze', { model_id: `m${i}`, config: cfg });
    results[src] = { ottv_total_wm2: a.ottv_total_wm2, rttv_wm2: (a.rttv || {}).rttv_wm2, panels: (a.panels || []).length };
  } catch (err) {
    results[src] = { error: String(err.message || err) };
  }
}
process.stdout.write('\nPARITY_JSON ' + JSON.stringify(results) + '\n');
