/**
 * Dialog kecil "Unduh laporan PDF": pilih tema (terang/gelap) dan orientasi A3 (mendatar/tegak).
 * Hasil: Promise<{ theme, orient } | null>.
 */
const KEY = 'luxa.reportPdf.v1';

export function askReportOptions(appTheme = 'light') {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { saved = {}; }
  const pick = { theme: saved.theme || appTheme || 'light', orient: saved.orient || 'land' };
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'rpt-backdrop';
    wrap.innerHTML = `<div class="rpt-dialog glass" role="dialog" aria-modal="true" aria-labelledby="rpt-t">
      <h2 id="rpt-t">Unduh laporan PDF</h2>
      <p class="muted">Laporan A3 tujuh halaman: sampul, ringkasan, sisi terpanas, tiap sisi, matahari dan lantai, material, kesimpulan.</p>
      <div class="rpt-row"><span class="lbl">Tema</span><div class="rpt-seg" data-k="theme"><button type="button" data-v="light">Terang</button><button type="button" data-v="dark">Gelap</button></div></div>
      <div class="rpt-row"><span class="lbl">Orientasi</span><div class="rpt-seg" data-k="orient"><button type="button" data-v="land">Mendatar</button><button type="button" data-v="port">Tegak</button></div></div>
      <p class="lbl rpt-note">Setelah siap, dialog cetak terbuka. Pilih "Simpan sebagai PDF"; ukuran kertas A3 sudah diatur.</p>
      <div class="rpt-act"><button type="button" class="ghost" data-a="no">Batal</button><button type="button" class="cta" data-a="go">Buat PDF</button></div>
    </div>`;
    const sync = () => wrap.querySelectorAll('.rpt-seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => {
      const on = pick[seg.dataset.k] === b.dataset.v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }));
    const close = (val) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      if (val) try { localStorage.setItem(KEY, JSON.stringify(val)); } catch { /* abaikan */ }
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (e.target === wrap) return close(null);
      if (!b) return;
      const seg = b.closest('.rpt-seg');
      if (seg) { pick[seg.dataset.k] = b.dataset.v; sync(); return; }
      if (b.dataset.a === 'go') close({ ...pick });
      if (b.dataset.a === 'no') close(null);
    });
    document.addEventListener('keydown', onKey, true);
    sync();
    document.body.appendChild(wrap);
    wrap.querySelector('[data-a="go"]').focus();
  });
}

/** Cetak HTML lewat iframe tersembunyi; menunggu font dan gambar siap lebih dulu. */
export function printHtml(html) {
  return new Promise((resolve) => {
    const fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(fr);
    const doc = fr.contentDocument;
    doc.open(); doc.write(html); doc.close();
    const w = fr.contentWindow;
    const go = async () => {
      try { await w.document.fonts.ready; } catch { /* abaikan */ }
      await Promise.all([...w.document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
      w.focus();
      w.print();
      setTimeout(() => { fr.remove(); resolve(); }, 1500);
    };
    if (doc.readyState === 'complete') go(); else w.addEventListener('load', go, { once: true });
  });
}
