// Unduh laporan sebagai berkas PDF A3 langsung, tanpa dialog cetak peramban.
// Tiap halaman (.pg) digambar oleh mesin peramban sendiri lewat SVG foreignObject (font dan gambar disematkan),
// lalu dirakit menjadi PDF berisi satu gambar JPEG per halaman. Ukuran kertas selalu A3 persis, tanpa tepi putih,
// tanpa tanggal/alamat dari peramban, apa pun printer atau pengaturan pengguna.

const MM = 96 / 25.4; // px CSS per mm

const toDataUrl = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });

async function fetchDataUrl(url) {
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return toDataUrl(await r.blob());
}

/** CSS font (Google Fonts atau berkas lokal) dengan semua url() diganti data URL; hanya subset Latin. */
async function inlineFontCss(cssUrl) {
  if (!cssUrl) return '';
  try {
    const css = await (await fetch(cssUrl, { mode: 'cors' })).text();
    const blocks = css.match(/@font-face\s*{[^}]*}/g) || [];
    const keep = blocks.filter((b) => {
      const ur = b.match(/unicode-range:\s*([^;]+);/);
      return !ur || /U\+0000-00FF|U\+0-FF\b/i.test(ur[1]); // subset latin dasar sudah memuat semua huruf laporan
    });
    const out = await Promise.all(keep.map(async (b) => {
      const urls = [...b.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)].map((m) => m[2]);
      let res = b;
      for (const u of urls) {
        if (u.startsWith('data:')) continue;
        try { res = res.replace(u, await fetchDataUrl(new URL(u, cssUrl).href)); } catch { return ''; }
      }
      return res;
    }));
    return out.join('\n');
  } catch {
    return ''; // luring: pakai font sistem, PDF tetap jadi
  }
}

async function inlineCssUrls(css, base) {
  const urls = [...new Set([...css.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)].map((m) => m[2]).filter((u) => !u.startsWith('data:') && !u.startsWith('#')))];
  for (const u of urls) {
    try { css = css.split(u).join(await fetchDataUrl(new URL(u, base).href)); } catch { /* biarkan */ }
  }
  return css;
}

function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Halaman gagal digambar')); im.src = src; });
}

/** Satu halaman → JPEG (Uint8Array) lewat SVG foreignObject. */
async function rasterPage(xhtml, css, rootAttrs, w, h, scale, quality) {
  // SVG langsung berukuran akhir (viewBox menskalakan isi secara vektor), lalu digambar 1:1 ke kanvas CPU.
  // Menskalakan di drawImage pada kanvas GPU membuat Chrome merender per petak dan meninggalkan garis sambungan.
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">`
    + `<html xmlns="http://www.w3.org/1999/xhtml"${rootAttrs}><head><style>${css}</style></head><body style="margin:0;background:transparent">${xhtml}</body></html>`
    + '</foreignObject></svg>';
  // data URL (bukan blob URL): Chrome menandai kanvas tercemar bila SVG foreignObject dimuat dari blob
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  {
    const im = await loadImage(url);
    try { await im.decode(); } catch { /* sudah termuat */ }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); // kanvas CPU: tanpa garis sambungan petak GPU
    g.drawImage(im, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    c.width = c.height = 0;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), pw: W, ph: H };
  }
}

/** PDF minimal: satu gambar JPEG (DCTDecode) memenuhi tiap halaman. */
function buildPdf(pages, wPt, hPt) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const N = pages.length;
  // 1 katalog, 2 daftar halaman, lalu per halaman: halaman, isi, gambar
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${N} >>`));
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
    const W = wPt.toFixed(2), H = hPt.toFixed(2);
    obj(pg, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
    const stream = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(ct, () => push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    obj(im, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.pw} /Height ${p.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
      push(p.bytes);
      push('\nendstream');
    });
  });
  const xref = len;
  const total = 3 + N * 3;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

/**
 * HTML laporan (dari buildReportHtml) → Blob PDF A3.
 * fontCssUrl: lembar CSS font yang disematkan. scale: piksel per px CSS (2 ≈ 190 dpi di A3).
 */
export async function reportHtmlToPdf(html, { port = false, fontCssUrl = '', scale = 2, quality = 0.9, onProgress = null } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = document.baseURI;
  // gambar non-data (logo) → data URL supaya ikut tergambar
  await Promise.all([...doc.images].map(async (im) => {
    const src = im.getAttribute('src') || '';
    if (src && !src.startsWith('data:')) { try { im.setAttribute('src', await fetchDataUrl(new URL(src, base).href)); } catch { im.removeAttribute('src'); } }
  }));
  let css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  css = await inlineCssUrls(css, base);
  css = `${await inlineFontCss(fontCssUrl)}\n${css}\n.pg{margin:0!important}`;
  const rootStyle = doc.documentElement.getAttribute('style');
  const rootAttrs = rootStyle ? ` style="${rootStyle.replace(/"/g, '&quot;')}"` : '';
  const w = (port ? 297 : 419.8) * MM, h = (port ? 419.8 : 297) * MM;
  const ser = new XMLSerializer();
  const pgs = [...doc.querySelectorAll('.pg')];
  const out = [];
  for (let i = 0; i < pgs.length; i++) {
    onProgress?.(i, pgs.length);
    await new Promise((r) => setTimeout(r, 20)); // beri jeda supaya antarmuka tetap responsif
    out.push(await rasterPage(ser.serializeToString(pgs[i]), css, rootAttrs, Math.round(w), Math.round(h), scale, quality));
  }
  const A3 = [841.89, 1190.55];
  return buildPdf(out, port ? A3[0] : A3[1], port ? A3[1] : A3[0]);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
