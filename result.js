// GoFullFox - result page
// Reads stitch input from browser.storage.local, paints all chunks onto a
// canvas at devicePixelRatio using painter's algorithm (later tiles overlap
// earlier ones — clamped scrolls at the bottom/right edge resolve naturally),
// then exposes Download PNG, Download PDF, and Copy actions.

const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");
const metaEl = document.getElementById("meta");
const pngBtn = document.getElementById("downloadPng");
const pdfBtn = document.getElementById("downloadPdf");
const copyBtn = document.getElementById("copy");

(async function main() {
  const { "gff:result": data } = await browser.storage.local.get("gff:result");
  if (!data) {
    statusEl.textContent = "No capture data found. Trigger the extension from a tab.";
    return;
  }
  metaEl.textContent = `${data.sourceTitle} - ${data.totalWidth}x${data.totalHeight}`;

  const dpr = data.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(data.totalWidth * dpr);
  canvas.height = Math.round(data.totalHeight * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    statusEl.textContent = "Failed to allocate canvas.";
    return;
  }

  for (const shot of data.screenshots) {
    const img = await loadImage(shot.dataUrl);
    // Painter's algorithm: draw each tile at its actual scroll position, full
    // size. When the browser clamped scrollTo (last row/column), the tile
    // simply overpaints the trailing portion of the previous tile with
    // identical content, which is fine.
    ctx.drawImage(img, Math.round(shot.x * dpr), Math.round(shot.y * dpr));
  }

  const pngBlob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
  );
  const pngUrl = URL.createObjectURL(pngBlob);
  previewEl.src = pngUrl;
  statusEl.textContent = `Done - ${canvas.width}x${canvas.height}px - ${(pngBlob.size / 1024).toFixed(1)} KB`;
  pngBtn.disabled = false;
  pdfBtn.disabled = false;
  copyBtn.disabled = false;

  const baseName = sanitizeFilename(data.sourceTitle);

  pngBtn.addEventListener("click", () => triggerDownload(pngUrl, baseName + ".png"));

  pdfBtn.addEventListener("click", async () => {
    pdfBtn.disabled = true;
    pdfBtn.textContent = "Encoding PDF...";
    try {
      const pdfBlob = await canvasToPdf(canvas);
      const pdfUrl = URL.createObjectURL(pdfBlob);
      triggerDownload(pdfUrl, baseName + ".pdf");
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    } catch (err) {
      console.error(err);
      alert("PDF encoding failed: " + err.message);
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.textContent = "Download PDF";
    }
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    } catch (err) {
      copyBtn.textContent = "Copy failed";
      console.error(err);
    }
  });
})();

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sanitizeFilename(name) {
  return (name || "capture").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 120) || "capture";
}

// Build a single-page PDF that wraps the canvas as one embedded JPEG.
// No external dependency: writes the PDF object stream by hand.
async function canvasToPdf(canvas) {
  const jpegBlob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG encode failed"))), "image/jpeg", 0.92)
  );
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const W = canvas.width;
  const H = canvas.height;

  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;

  const push = (chunk) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };

  const writeObj = (n, dict, streamBytes) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${dict}\n`);
    if (streamBytes !== undefined) {
      push("stream\n");
      push(streamBytes);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  // Header (the binary marker after %PDF-1.4 is recommended for tools that
  // sniff "is this binary?"). \xE2\xE3\xCF\xD3 are arbitrary high bytes.
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeObj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  writeObj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
  );
  writeObj(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`,
    jpegBytes
  );
  const contentStream = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  writeObj(5, `<< /Length ${contentStream.length} >>`, contentStream);

  const xrefOffset = length;
  push("xref\n0 6\n");
  push("0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++) {
    push(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(parts, { type: "application/pdf" });
}
