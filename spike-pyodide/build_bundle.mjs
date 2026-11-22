// Fase 5a spike: pack the backend Python sources the engine needs into one JSON file
// that the Web Worker (and the Node probe) writes into the Pyodide filesystem.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..', 'backend');
const SKIP_DIRS = new Set(['.venv', 'uploads', 'samples', 'epw_samples', '__pycache__']);
const SKIP_FILES = new Set(['main.py', 'run_studio_servers.py', 'test_ottv_engine.py', 'requirements.txt']);
const files = [];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), path.join(rel, e.name));
    } else if (!SKIP_FILES.has(e.name) && /\.(py|json)$/.test(e.name)) {
      files.push({ path: path.join(rel, e.name).split(path.sep).join('/'), content: fs.readFileSync(path.join(dir, e.name), 'utf8') });
    }
  }
})(backend, '');
fs.mkdirSync(path.join(here, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(here, 'vendor', 'backend_bundle.json'), JSON.stringify(files));
// Install stages: micropip installs a list in parallel, so IfcOpenShell's shared libraries
// must come in dependency order (schemas, then mappings/kernels, then the core module).
const all = fs.readdirSync(path.join(here, 'vendor', 'wheels')).filter((w) => w.endsWith('.whl')).sort();
const stage = (w) =>
  !w.startsWith('ifcopenshell') ? 0 : w.includes('parse_schema') ? 1 : w.includes('geometry_') ? 2 : 3;
const stages = [0, 1, 2, 3].map((i) => all.filter((w) => stage(w) === i)).filter((s) => s.length);
const wheels = stages.flat();
fs.writeFileSync(path.join(here, 'vendor', 'manifest.json'), JSON.stringify({ wheels, stages }, null, 1));
console.log(`manifest.json: ${wheels.length} wheels`);
console.log(`backend_bundle.json: ${files.length} files, ${(JSON.stringify(files).length / 1024).toFixed(0)} KB`);
