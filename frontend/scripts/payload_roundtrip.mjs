// Dipakai tests/test_payload.py: bongkar hasil ramping (dan ganti material) memakai adapter asli
// frontend/src/engine/payload.js, lalu tulis hasilnya sebagai JSON untuk dibandingkan dengan versi lengkap.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyRematerial, expandAnalysis } from '../src/engine/payload.js';

const [, , slimPath, rematPath, outPath, outRematPath] = process.argv;
globalThis.atob = globalThis.atob || ((b) => Buffer.from(b, 'base64').toString('binary'));
const expanded = expandAnalysis(JSON.parse(readFileSync(slimPath, 'utf8')));
writeFileSync(outPath, JSON.stringify(expanded));
if (rematPath) {
  const re = applyRematerial(JSON.parse(readFileSync(rematPath, 'utf8')), expanded.analysis_id);
  writeFileSync(outRematPath, JSON.stringify(re));
}
console.log('ok');
