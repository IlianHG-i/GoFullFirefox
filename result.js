// GoFullFox - result page
// Stitches tile screenshots onto a canvas using GoFullPage's painter's-algorithm:
//   ctx.drawImage(img, x - canvasLeft, y - canvasTop)
// where x/y are the actual scroll positions at capture time.
// DPR scale is applied once the first image loads (matching GoFullPage's approach).

const statusEl  = document.getElementById('status');
const previewEl = document.getElementById('preview');
const metaEl    = document.getElementById('meta');
const pngBtn    = document.getElementById('downloadPng');
const pdfBtn    = document.getElementById('downloadPdf');
const copyBtn   = document.getElementById('copy');

(async function main() {
  const { 'gff:result': data } = await browser.storage.local.get('gff:result');
  if (!data) {
    statusEl.textContent = 'No capture data. Click the extension icon on a tab first.';
    return;
  }

  const { screenshots, sourceTitle } = data;
  let { totalWidth, totalHeight, windowWidth, devicePixelRatio: dpr } = data;

  metaEl.textContent = `${sourceTitle} — ${totalWidth}×${totalHeight}`;

  // ── Build canvas ──────────────────────────────────────────────────────────
  // GoFullPage adjusts for actual image size vs windowWidth (zoom/DPR).
  // We do the same: load the first image, compute scale, then set canvas size.
  const firstImg = await loadImage(screenshots[0].dataUrl);
  if (firstImg.width !== windowWidth) {
    const scale = firstImg.width / windowWidth;
    totalWidth  *= scale;
    totalHeight *= scale;
    for (const s of screenshots) {
      s.x *= scale;
      s.y *= scale;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(totalWidth);
  canvas.height = Math.round(totalHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) { statusEl.textContent = 'Canvas allocation failed.'; return; }

  // ── Stitch ────────────────────────────────────────────────────────────────
  // Painter's algorithm — tiles drawn in the order they were captured
  // (bottom-to-top). Later (higher) tiles win overlapping regions.
  ctx.drawImage(firstImg, Math.round(screenshots[0].x), Math.round(screenshots[0].y));

  for (let i = 1; i < screenshots.length; i++) {
    const shot = screenshots[i];
    const img  = await loadImage(shot.dataUrl);
    ctx.drawImage(img, Math.round(shot.x), Math.round(shot.y));
  }

  // ── PNG blob → preview ────────────────────────────────────────────────────
  let pngBlob;
  try {
    pngBlob = await new Promise((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png')
    );
  } catch (err) {
    statusEl.textContent = 'PNG encode failed: ' + err.message;
    return;
  }

  const pngUrl = URL.createObjectURL(pngBlob);
  previewEl.src = pngUrl;
  statusEl.textContent =
    `Done — ${canvas.width}×${canvas.height}px — ${(pngBlob.size / 1024).toFixed(1)} KB`;

  pngBtn.disabled = false;
  pdfBtn.disabled = false;
  copyBtn.disabled = false;

  const base = sanitizeFilename(sourceTitle);

  pngBtn.addEventListener('click', () => triggerDownload(pngUrl, base + '.png'));

  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    pdfBtn.textContent = 'Encoding PDF…';
    try {
      const pdfBlob = await canvasToPdf(canvas);
      const pdfUrl  = URL.createObjectURL(pdfBlob);
      triggerDownload(pdfUrl, base + '.pdf');
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    } catch (err) {
      alert('PDF encoding failed: ' + err.message);
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.textContent = 'Download PDF';
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
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function sanitizeFilename(name) {
  return (name || 'capture').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 120) || 'capture';
}

// Minimal single-page PDF writer — embeds the canvas as a JPEG (no dependencies).
async function canvasToPdf(canvas) {
  const jpegBlob = await new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('JPEG encode failed')), 'image/jpeg', 0.92)
  );
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const W = canvas.width, H = canvas.height;
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let len = 0;

  const push = chunk => {
    const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(b); len += b.length;
  };
  const obj = (n, dict, stream) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${dict}\n`);
    if (stream !== undefined) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25,0xe2,0xe3,0xcf,0xd3,0x0a]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`, jpegBytes);
  const cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${cs.length} >>`, cs);

  const xref = len;
  push('xref\n0 6\n');
  push('0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  return new Blob(parts, { type: 'application/pdf' });
}
