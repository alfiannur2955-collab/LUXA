/**
 * LUXA engine entry point. UI code imports only this file.
 *
 * Two interchangeable implementations with identical functions:
 *   - browser (default): Python engine in a Web Worker via Pyodide, no server (./engine/local.js)
 *   - server: FastAPI backend, for development (`npm run dev:server`, ./engine/server.js)
 * Pick with VITE_LUXA_ENGINE=browser|server.
 */
import * as local from './engine/local.js';
import * as server from './engine/server.js';

export const engineMode = import.meta.env.VITE_LUXA_ENGINE === 'server' ? 'server' : 'browser';
const impl = engineMode === 'server' ? server : local;

export const {
  upload,
  listModels,
  loadConfig,
  saveConfig,
  inspect,
  analyze,
  exposure,
  exportReport,
  listMaterials,
  validateMaterial,
  rematerial,
  recommend,
  listLocations,
  getExportTips,
  parseEpw,
} = impl;

/** Starts loading the in-browser engine in the background (no-op in server mode). */
export function warmUpEngine() {
  return engineMode === 'browser' ? local.warmUpEngine() : Promise.resolve(null);
}

/** Subscribe to engine loading status {phase, label, progress}. Returns an unsubscribe function. */
export function onEngineStatus(fn) {
  if (engineMode === 'browser') return local.onEngineStatus(fn);
  fn({ phase: 'ready', label: 'Server LUXA', progress: 1 });
  return () => {};
}

export function isEngineReady() {
  return engineMode === 'server' || local.isEngineReady();
}

export const engine = {
  upload,
  listModels,
  loadConfig,
  saveConfig,
  inspect,
  analyze,
  exposure,
  export: exportReport,
  listMaterials,
  validateMaterial,
  rematerial,
  recommend,
  listLocations,
  getExportTips,
  parseEpw,
};
