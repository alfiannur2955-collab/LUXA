// Halaman prototipe Belajar 3D.
// Bawaan: cerita scroll (Tahap 2). ?mode=bebas atau ?shot=... membuka pratinjau bebas (Tahap 1).
const q = new URLSearchParams(location.search);
const mode = q.get('mode') || (q.has('shot') ? 'bebas' : 'cerita');
if (mode === 'bebas') import('./preview.js');
else import('./story.js');
