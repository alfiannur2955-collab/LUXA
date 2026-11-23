// Halaman prototipe Belajar 3D (di luar aplikasi).
// Bawaan: Beranda + cerita scroll. ?mode=bebas atau ?shot=... membuka pratinjau bebas (Tahap 1).
import './lux.css';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') || (q.has('shot') ? 'bebas' : 'cerita');
if (mode === 'bebas') {
  import('./preview.js');
} else {
  const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  import('./story.js').then(({ createStory }) => {
    const s = createStory({
      host: document.body,
      theme,
      embedded: false,
      handlers: {
        onToggleTheme: () => { const u = new URL(location.href); u.searchParams.set('theme', theme === 'dark' ? 'light' : 'dark'); location.href = u.toString(); },
        onStartNew: () => window.open('https://alfiannur2955-collab.github.io/LUXA/', '_blank', 'noopener'),
        onTryExample: () => window.open('https://alfiannur2955-collab.github.io/LUXA/', '_blank', 'noopener'),
      },
    });
    s.show({ chapter: 0 }); // tautan #id bagian ditangani story.js
    window.__story = s._debug;
    window.__stage = s._debug?.stage;
  });
}
