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
    const prev = pdfBtn.textContent;
    progWrap.style.display = 'block';
    setProgress(0, 'Encoding PDF…');
    try {
      const steps = [
        [20,  'Compressing image…'],
        [60,  'Building PDF structure…'],
        [90,  'Finalising…'],
      ];
      let stepIdx = 0;
      const interval = setInterval(() => {
        if (stepIdx >= steps.length) { clearInterval(interval); return; }
        const [p, l] = steps[stepIdx++];
        setProgress(p, l);
      }, 300);
      const pdfBlob = await canvasToPdf(canvas);
      clearInterval(interval);
      setProgress(100, 'PDF ready');
      setTimeout(hideProgress, 600);
      triggerDownload(URL.createObjectURL(pdfBlob), base + '.pdf');
    } catch (err) {
      alert('PDF encoding failed: ' + err.message);
      hideProgress();
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.textContent = prev;
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

async function canvasToPdf(canvas) {
  const jpegBlob = await new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('JPEG encode failed')), 'image/jpeg', 0.92)
  );
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const W = canvas.width, H = canvas.height;
  const enc = new TextEncoder();
  const parts = []; const offsets = []; let len = 0;

  const push = c => { const b = typeof c === 'string' ? enc.encode(c) : c; parts.push(b); len += b.length; };
  const obj  = (n, d, s) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${d}\n`);
    if (s !== undefined) { push('stream\n'); push(s); push('\nendstream\n'); }
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
  for (let i = 1; i <= 5; i++) push(String(offsets[i]).padStart(10,'0') + ' 00000 n \n');
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  return new Blob(parts, { type: 'application/pdf' });
}
