// Fase 5a spike: open the spike page in headless Chromium and record the measurements.
// Needs puppeteer-core + @sparticuz/chromium (or set CHROME_PATH). Serve the repo root first:
//   python -m http.server 8770   (from the repo root)
//   PUPPETEER_DIR=/path/with/node_modules node spike-pyodide/browser_probe.mjs [fixture-id ...]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(process.env.PUPPETEER_DIR || process.cwd(), 'noop.js'));
const puppeteer = req('puppeteer-core');
let executablePath = process.env.CHROME_PATH;
let args = [];
if (!executablePath) {
  const chromium = (await import(req.resolve('@sparticuz/chromium'))).default;
  executablePath = await chromium.executablePath();
  // --single-process (serverless default) kills pages that run large WASM in a Worker.
  args = chromium.args.filter((a) => !/single-process|no-zygote/.test(a));
}
const only = process.argv.slice(2);
const url = process.env.SPIKE_URL || 'http://127.0.0.1:8770/spike-pyodide/';
const browser = await puppeteer.launch({ executablePath, args, headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await page.goto(url, { waitUntil: 'load' });
if (only.length) await page.evaluate((o) => { window.__spikeOnly = o; }, only);
const t0 = Date.now();
await page.click('#boot');
const tick = setInterval(async () => { try { console.error('…', await page.evaluate(() => document.getElementById('log').textContent.trim().split('\n').slice(-1)[0])); } catch {} }, 15000);
await page.waitForFunction('window.__spike.boot || window.__spike.error', { timeout: 120000 });
if (await page.evaluate(() => window.__spike.error)) { console.log('BOOT ERROR', await page.evaluate(() => window.__spike.error)); process.exit(1); }
await page.click('#suite');
await page.waitForFunction('window.__spike.done', { timeout: 900000 });
clearInterval(tick);
const data = await page.evaluate(() => window.__spike);
const mem = await page.metrics();
data.page_js_heap_mb = Math.round(mem.JSHeapUsedSize / 1048576);
data.wall_s = (Date.now() - t0) / 1e3;
data.console = logs.filter((l) => !l.startsWith('log: Loading') && !l.startsWith('log: Loaded')).slice(-20);
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
const out = path.join(here, 'results', only.length ? `browser_probe_${only.join('_')}.json` : 'browser_probe.json');
fs.writeFileSync(out, JSON.stringify(data, null, 1));
console.log(JSON.stringify({ boot: { ...data.boot, resources: undefined }, runs: data.runs, error: data.error }, null, 1));
browser.close().catch(() => {});
process.exit(0);
