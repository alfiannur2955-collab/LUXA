/**
 * Prepares the in-browser engine assets (Fase 5b) in frontend/public/ (gitignored):
 *   public/luxa-engine/  Pyodide subset, wheels, rhino3dm.js, LUXA backend bundle, manifest
 *   public/samples/      sample models used by "Coba contoh"
 *   public/sw.js         service worker with a content-hashed cache name
 * Source binaries come from frontend/.engine-cache/ (fill it with scripts/fetch_engine_assets.sh).
 * Runs automatically from vite.config.js (dev and build). Safe to run repeatedly.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(here, '..');
const ROOT = path.resolve(FRONT, '..');
const CACHE_CANDIDATES = [path.join(FRONT, '.engine-cache'), path.join(ROOT, 'spike-pyodide', 'vendor')];
const OUT = path.join(FRONT, 'public', 'luxa-engine');
const SAMPLES_OUT = path.join(FRONT, 'public', 'samples');

const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'package.json'];
const PYODIDE_PACKAGES = ['numpy', 'pydantic', 'pydantic-core', 'typing-extensions', 'annotated-types', 'typing-inspection', 'micropip', 'packaging'];
const BACKEND_SKIP_DIRS = new Set(['.venv', 'uploads', 'samples', 'epw_samples', '__pycache__']);
const BACKEND_SKIP_FILES = new Set(['main.py', 'run_studio_servers.py', 'test_ottv_engine.py', 'requirements.txt']);

function findCache() {
  for (const c of CACHE_CANDIDATES) if (fs.existsSync(path.join(c, 'pyodide', 'pyodide.asm.wasm'))) return c;
  return null;
}

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const s = fs.statSync(src);
  if (fs.existsSync(dst)) {
    const d = fs.statSync(dst);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs) return;
  }
  fs.copyFileSync(src, dst);
}

function backendBundle() {
  const files = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!BACKEND_SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), rel + e.name + '/');
      } else if (!BACKEND_SKIP_FILES.has(e.name) && /\.(py|json)$/.test(e.name)) {
        files.push({ path: 'backend/' + rel + e.name, content: fs.readFileSync(path.join(dir, e.name), 'utf8') });
      }
    }
  })(path.join(ROOT, 'backend'), '');
  // Template laporan prodi (dipakai report_template_map.DEFAULT_TEMPLATE_PATH = /docs/templates/...).
  const tpl = path.join(ROOT, 'docs', 'templates', 'template_prodi.xlsx');
  if (fs.existsSync(tpl) && process.env.LUXA_INCLUDE_TEMPLATE !== '0') {
    files.push({ path: 'docs/templates/template_prodi.xlsx', b64: fs.readFileSync(tpl).toString('base64') });
  }
  return files;
}

export function buildEngineAssets({ quiet = false } = {}) {
  const log = (...a) => !quiet && console.log('[luxa-engine]', ...a);
  const cache = findCache();
  if (!cache) {
    console.warn(
      '[luxa-engine] Aset engine belum ada. Jalankan sekali: bash frontend/scripts/fetch_engine_assets.sh\n' +
        '              (mode browser tidak akan jalan sampai aset tersedia; mode server tetap bisa).',
    );
    return null;
  }
  const lock = JSON.parse(fs.readFileSync(path.join(cache, 'pyodide', 'pyodide-lock.json'), 'utf8'));
  for (const f of PYODIDE_FILES) copy(path.join(cache, 'pyodide', f), path.join(OUT, 'pyodide', f));
  for (const name of PYODIDE_PACKAGES) {
    const fn = lock.packages[name]?.file_name;
    if (!fn) throw new Error(`Paket Pyodide '${name}' tidak ada di pyodide-lock.json`);
    copy(path.join(cache, 'pyodide', fn), path.join(OUT, 'pyodide', fn));
  }

  const wheels = fs.readdirSync(path.join(cache, 'wheels')).filter((w) => w.endsWith('.whl')).sort();
  for (const w of wheels) copy(path.join(cache, 'wheels', w), path.join(OUT, 'wheels', w));
  const pick = (re) => wheels.filter((w) => re.test(w));
  const manifest = {
    boot: pick(/^(trimesh|ladybug_geometry)-/),
    xlsx: pick(/^(et_xmlfile|openpyxl)-/),
    // IfcOpenShell must install in dependency order: schemas, geometry libs, then the core module.
    ifc: [pick(/^ifcopenshell_parse_schema_/), pick(/^ifcopenshell_geometry_/), pick(/^ifcopenshell(_pure_python)?-/)],
  };
  for (const f of ['rhino3dm.module.js', 'rhino3dm.wasm']) copy(path.join(cache, 'rhino3dm', f), path.join(OUT, 'rhino3dm', f));

  const bundle = { files: backendBundle() };
  manifest.template = bundle.files.some((f) => f.path.endsWith('template_prodi.xlsx'));
  const bundleJson = JSON.stringify(bundle);
  fs.writeFileSync(path.join(OUT, 'backend_bundle.json'), bundleJson);

  const h = crypto.createHash('sha256');
  h.update(bundleJson);
  h.update(JSON.stringify(manifest));
  h.update(lock.info ? JSON.stringify(lock.info) : '');
  for (const w of wheels) h.update(w);
  manifest.version = h.digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

  fs.mkdirSync(SAMPLES_OUT, { recursive: true });
  copy(path.join(ROOT, 'fixtures', 'synthetic', '01_kotak_m', 'model.3dm'), path.join(SAMPLES_OUT, '01_kotak_m.3dm'));
  const cw = path.join(ROOT, 'backend', 'samples', 'Fasad_Tower_Twisted.3dm');
  if (fs.existsSync(cw)) copy(cw, path.join(SAMPLES_OUT, 'Fasad_Tower_Twisted.3dm'));
  const old = path.join(SAMPLES_OUT, 'Fasad_Curtain_Wall_Baru.3dm');
  if (fs.existsSync(old)) fs.rmSync(old);

  const sw = fs.readFileSync(path.join(here, 'sw.template.js'), 'utf8').replace('__ENGINE_VERSION__', manifest.version);
  fs.writeFileSync(path.join(FRONT, 'public', 'sw.js'), sw);
  log(`aset siap (versi ${manifest.version}, ${bundle.files.length} file backend, cache: ${path.relative(ROOT, cache)})`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildEngineAssets();
