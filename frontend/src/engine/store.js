/**
 * Browser-mode storage (Fase 5b): uploaded model files and project configs live in
 * IndexedDB on the user's own device. Nothing is sent to a server.
 */
const DB_NAME = 'luxa-engine';
const DB_VERSION = 1;
const MAX_MODELS = 6; // oldest uploads are evicted to keep browser storage small

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Browser ini tidak menyediakan IndexedDB.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'model_id' });
      if (!db.objectStoreNames.contains('configs')) db.createObjectStore('configs', { keyPath: 'model_id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const os = t.objectStore(store);
        let out;
        Promise.resolve(fn(os)).then((v) => {
          out = v;
        });
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Transaksi IndexedDB dibatalkan.'));
      }),
  );
}

const req2p = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export async function putModel(rec) {
  await tx('models', 'readwrite', (os) => os.put({ ...rec, created: Date.now() }));
  try {
    const all = await listModelMeta();
    const extra = all.sort((a, b) => b.created - a.created).slice(MAX_MODELS);
    for (const m of extra) await deleteModel(m.model_id);
  } catch {
    // eviction is best-effort
  }
}

export function getModel(modelId) {
  return tx('models', 'readonly', (os) => req2p(os.get(modelId)));
}

export function listModelMeta() {
  return tx('models', 'readonly', (os) =>
    req2p(os.getAll()).then((rows) =>
      rows.map(({ model_id, name, size, created }) => ({ model_id, name, size, created })),
    ),
  );
}

export async function deleteModel(modelId) {
  await tx('models', 'readwrite', (os) => os.delete(modelId));
  await tx('configs', 'readwrite', (os) => os.delete(modelId));
}

export async function getConfig(modelId) {
  const row = await tx('configs', 'readonly', (os) => req2p(os.get(modelId)));
  return row ? row.config : null;
}

export function putConfig(modelId, config) {
  return tx('configs', 'readwrite', (os) => os.put({ model_id: modelId, config, saved_at: Date.now() }));
}
