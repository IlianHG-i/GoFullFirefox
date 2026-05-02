// GoFullFirefox - result page
// Reads stitch input from browser.storage.local, paints all chunks onto a
// canvas at devicePixelRatio, and exposes download / copy actions.

const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");
const metaEl = document.getElementById("meta");
const downloadBtn = document.getElementById("download");
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
    // Crop the source image so overlapping tiles at the bottom/right edges
    // don't double-paint already-rendered content.
    const tileWidth = Math.min(img.width, Math.round((data.totalWidth - shot.x) * dpr));
    const tileHeight = Math.min(img.height, Math.round((data.totalHeight - shot.y) * dpr));
    const sx = img.width - tileWidth;
    const sy = img.height - tileHeight;
    ctx.drawImage(
      img,
      sx, sy, tileWidth, tileHeight,
      Math.round(shot.x * dpr) + (tileWidth < img.width ? (img.width - tileWidth) : 0),
      Math.round(shot.y * dpr) + (tileHeight < img.height ? (img.height - tileHeight) : 0),
      tileWidth, tileHeight
    );
  }

  let blob;
  try {
    blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
    );
  } catch (err) {
    statusEl.textContent = "Failed to encode PNG: " + err.message;
    return;
  }

  const url = URL.createObjectURL(blob);
  previewEl.src = url;
  statusEl.textContent = `Done - ${canvas.width}x${canvas.height}px - ${(blob.size / 1024).toFixed(1)} KB`;
  downloadBtn.disabled = false;
  copyBtn.disabled = false;

  downloadBtn.addEventListener("click", () => {
    const filename = sanitizeFilename(data.sourceTitle) + ".png";
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    } catch (err) {
      copyBtn.textContent = "Copy failed";
      console.error(err);
    }
  });
})();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sanitizeFilename(name) {
  return (name || "capture").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}
