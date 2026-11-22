import fs from 'node:fs';
import { defineConfig } from 'vite';

// Satu sumber versi: backend/version.py
const LUXA_VERSION = (fs.readFileSync(new URL('../backend/version.py', import.meta.url), 'utf8').match(/__version__\s*=\s*"([^"]+)"/) || [])[1] || '0.0.0';
import { buildEngineAssets } from './scripts/build_engine_assets.mjs';

/** Copies the in-browser engine (Pyodide, wheels, backend bundle) into public/ before dev/build. */
function luxaEngineAssets() {
  return {
    name: 'luxa-engine-assets',
    buildStart() {
      if (process.env.VITE_LUXA_ENGINE !== 'server') buildEngineAssets({ quiet: false });
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === 'server') process.env.VITE_LUXA_ENGINE = 'server';
  return {
    // Relative base: the static build works from any folder (GitHub Pages project sites, Netlify).
    base: './',
    define: { __LUXA_VERSION__: JSON.stringify(LUXA_VERSION) },
    plugins: [luxaEngineAssets()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    worker: { format: 'es' },
    optimizeDeps: {
      exclude: ['rhino3dm'],
    },
    build: {
      chunkSizeWarningLimit: 1500,
    },
  };
});
