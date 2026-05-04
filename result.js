// GoFullFox - result page

const metaEl    = document.getElementById('meta');
const pngBtn    = document.getElementById('downloadPng');
const pdfBtn    = document.getElementById('downloadPdf');
const copyBtn   = document.getElementById('copy');
const progWrap  = document.getElementById('progress-wrap');
const progLabel = document.getElementById('progress-label');
const progFill  = document.getElementById('progress-fill');
const previewEl = document.getElementById('preview');

function setProgress(pct, label) {
  progFill.style.width = pct + '%';
  progLabel.textContent = label;
}
function hideProgress() {
  progWrap.style.display = 'none';
}

(async function main() {
  const { 'gff:result': data } = await browser.storage.local.get('gff:result');
  if (!data) {
    setProgress(0, 'No capture data — click the extension icon on a tab first.');
    return;
  }

  const { screenshots, sourceTitle } = data;
  let { totalWidth, totalHeight, windowWidth } = data;
  const total = screenshots.length;

  metaEl.textContent = `${sourceTitle}`;

  // ── Build canvas ──────────────────────────────────────────────────────────
  setProgress(5, 'Loading tiles…');

  const firstImg = await loadImage(screenshots[0].dataUrl);

  // Scale compensation: if captured image width ≠ windowWidth (zoom / DPR),
  // adjust all coordinates — same as GoFullPage's api.js.
  if (firstImg.width !== windowWidth) {
    const scale = firstImg.width / windowWidth;
    totalWidth  *= scale;
    totalHeight *= scale;
    for (const s of screenshots) { s.x *= scale; s.y *= scale; }
  }

  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(totalWidth);
  canvas.height = Math.round(totalHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) { setProgress(0, 'Canvas allocation failed.'); return; }

  // ── Stitch tiles ──────────────────────────────────────────────────────────
  ctx.drawImage(firstImg, Math.round(screenshots[0].x), Math.round(screenshots[0].y));
  setProgress(10, `Stitching tile 1 / ${total}…`);

  for (let i = 1; i < total; i++) {
    const shot = screenshots[i];
    const img  = await loadImage(shot.dataUrl);
    ctx.drawImage(img, Math.round(shot.x), Math.round(shot.y));
    const pct = 10 + Math.round((i / (total - 1 || 1)) * 70);
    setProgress(pct, `Stitching tile ${i + 1} / ${total}…`);
  }

  // ── Encode PNG ────────────────────────────────────────────────────────────
  setProgress(82, 'Encoding PNG…');
  let pngBlob;
  try {
    pngBlob = await new Promise((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png')
    );
  } catch (err) {
    setProgress(0, 'PNG encode failed: ' + err.message);
    return;
  }

  const pngUrl = URL.createObjectURL(pngBlob);
  previewEl.src = pngUrl;

  const kbSize = (pngBlob.size / 1024).toFixed(1);
  metaEl.textContent = `${sourceTitle} — ${canvas.width}×${canvas.height}px — ${kbSize} KB`;

  setProgress(100, 'Done');
  setTimeout(hideProgress, 800);

  pngBtn.disabled = false;
  pdfBtn.disabled = false;
  copyBtn.disabled = false;

  const base = sanitizeFilename(sourceTitle);

  pngBtn.addEventListener('click', () => triggerDownload(pngUrl, base + '.png'));

  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    progWrap.style.display = 'block';
    setProgress(0, 'Starting PDF export…');
    try {
      const pdfBlob = await canvasToPdf(canvas, (done, total) => {
        const pct = Math.round((done / total) * 92);
        setProgress(pct, `Encoding page ${done} / ${total}…`);
      });
      setProgress(100, 'PDF ready');
      setTimeout(hideProgress, 700);
      triggerDownload(URL.createObjectURL(pdfBlob), base + '.pdf');
    } catch (err) {
      alert('PDF encoding failed: ' + err.message);
      hideProgress();
    } finally {
      pdfBtn.disabled = false;
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    } catch (err) {
      copyBtn.textContent = 'Failed';
      console.error(err);
    }
  });
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

function sanitizeFilename(name) {
  return (name || 'capture').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 120) || 'capture';
}

// Multi-page A4 PDF builder.
// The canvas is scaled to fit A4 width (595.28 pt) and split into as many
// A4 pages as needed. Each page embeds its slice as a JPEG stream.
async function canvasToPdf(canvas, onPageProgress) {
  const A4_W = 595.28;  // points (72 pt = 1 inch)
  const A4_H = 841.89;

  const scale   = A4_W / canvas.width;
  const totalPtH = canvas.height * scale;
  const numPages = Math.ceil(totalPtH / A4_H);

  // ── Slice the canvas into page-sized JPEG chunks ─────────────────────────
  const pages = [];
  for (let i = 0; i < numPages; i++) {
    // Source rectangle in canvas pixels
    const srcY = Math.round(i * A4_H / scale);
    const srcH = Math.min(canvas.height - srcY, Math.round(A4_H / scale));
    const ptH  = srcH * scale;                // actual point height of this page

    const tmp  = document.createElement('canvas');
    tmp.width  = canvas.width;
    tmp.height = srcH;
    tmp.getContext('2d').drawImage(
      canvas, 0, srcY, canvas.width, srcH,
              0,    0, canvas.width, srcH
    );

    const blob  = await new Promise((res, rej) =>
      tmp.toBlob(b => b ? res(b) : rej(new Error('slice toBlob failed')), 'image/jpeg', 0.92)
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    pages.push({ bytes, ptH, imgW: canvas.width, imgH: srcH });

    if (onPageProgress) onPageProgress(i + 1, numPages);
  }

  // ── Assemble PDF ──────────────────────────────────────────────────────────
  // Object layout (N = numPages):
  //   1        → Catalog
  //   2        → Pages
  //   3+3i     → Page i
  //   4+3i     → Content stream for page i
  //   5+3i     → Image XObject for page i
  const enc     = new TextEncoder();
  const parts   = [];
  const offsets = {};
  let   pos     = 0;

  const write = chunk => {
    const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(b);
    pos += b.length;
  };

  write('%PDF-1.4\n');
  write(new Uint8Array([0x25,0xe2,0xe3,0xcf,0xd3,0x0a]));

  // Catalog
  offsets[1] = pos;
  write('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Pages
  const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ');
  offsets[2] = pos;
  write(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${numPages} >>\nendobj\n`);

  for (let i = 0; i < numPages; i++) {
    const { bytes, ptH, imgW, imgH } = pages[i];
    const pageObj = 3 + 3 * i;
    const contObj = 4 + 3 * i;
    const imgObj  = 5 + 3 * i;
    const imName  = `Im${i}`;

    // Page
    offsets[pageObj] = pos;
    write(
      `${pageObj} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${A4_W.toFixed(2)} ${ptH.toFixed(2)}] ` +
      `/Resources << /XObject << /${imName} ${imgObj} 0 R >> >> ` +
      `/Contents ${contObj} 0 R >>\n` +
      `endobj\n`
    );

    // Content stream: scale image to fill the page (origin bottom-left in PDF)
    const cs = `q ${A4_W.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /${imName} Do Q`;
    offsets[contObj] = pos;
    write(`${contObj} 0 obj\n<< /Length ${cs.length} >>\nstream\n${cs}\nendstream\nendobj\n`);

    // Image XObject
    offsets[imgObj] = pos;
    write(
      `${imgObj} 0 obj\n` +
      `<< /Type /XObject /Subtype /Image ` +
      `/Width ${imgW} /Height ${imgH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /DCTDecode /Length ${bytes.length} >>\n` +
      `stream\n`
    );
    write(bytes);
    write('\nendstream\nendobj\n');
  }

  // xref + trailer
  const totalObjs = 3 + 3 * numPages;   // objects 0 .. 2+3N
  const xrefPos   = pos;
  write(`xref\n0 ${totalObjs}\n`);
  write('0000000000 65535 f \n');
  for (let n = 1; n < totalObjs; n++) {
    write(String(offsets[n] ?? 0).padStart(10, '0') + ' 00000 n \n');
  }
  write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  return new Blob(parts, { type: 'application/pdf' });
}
