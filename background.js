// GoFullFirefox - background event page
// Orchestrates full-page screenshot capture by repeatedly scrolling the
// active tab and stitching captureVisibleTab() snapshots in a result page.
//
// Algorithm adapted from GoFullPage (mrcoles/full-page-screen-capture-chrome-extension, MIT).

const CAPTURE_DELAY_MS = 200; // let the page settle (lazy images, sticky headers) between scrolls
const MAX_PRIMARY_DIMENSION = 15000 * 2;
const MAX_SECONDARY_DIMENSION = 4000 * 2;
const MAX_AREA = MAX_PRIMARY_DIMENSION * MAX_SECONDARY_DIMENSION;

browser.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (err) {
    notifyError(tab.id, `Cannot run on this page: ${err.message}`);
    return;
  }

  let dims;
  try {
    dims = await browser.tabs.sendMessage(tab.id, { type: "gff:getDimensions" });
  } catch (err) {
    notifyError(tab.id, `Failed to read page dimensions: ${err.message}`);
    return;
  }

  const arrangements = computeArrangements(dims);
  const screenshots = [];
  for (const pos of arrangements) {
    try {
      await browser.tabs.sendMessage(tab.id, { type: "gff:scrollTo", x: pos.x, y: pos.y });
    } catch (err) {
      notifyError(tab.id, `Scroll failed: ${err.message}`);
      return;
    }
    await sleep(CAPTURE_DELAY_MS);
    let dataUrl;
    try {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (err) {
      notifyError(tab.id, `Capture failed: ${err.message}`);
      await browser.tabs.sendMessage(tab.id, { type: "gff:restore" }).catch(() => {});
      return;
    }
    screenshots.push({ x: pos.x, y: pos.y, dataUrl });
  }

  await browser.tabs.sendMessage(tab.id, { type: "gff:restore" }).catch(() => {});

  await browser.storage.local.set({
    "gff:result": {
      screenshots,
      totalWidth: dims.totalWidth,
      totalHeight: dims.totalHeight,
      windowWidth: dims.windowWidth,
      windowHeight: dims.windowHeight,
      devicePixelRatio: dims.devicePixelRatio,
      sourceUrl: tab.url || "",
      sourceTitle: tab.title || "Capture",
      createdAt: Date.now(),
    },
  });

  await browser.tabs.create({ url: browser.runtime.getURL("result.html") });
});

function computeArrangements(dims) {
  const { totalWidth, totalHeight, windowWidth, windowHeight } = dims;
  const positions = [];
  let y = 0;
  while (y < totalHeight) {
    let x = 0;
    while (x < totalWidth) {
      positions.push({ x, y });
      x += windowWidth;
      if (x >= totalWidth) break;
    }
    y += windowHeight;
    if (y >= totalHeight) break;
  }
  // Cap absurd captures so we don't exhaust memory.
  const dpr = dims.devicePixelRatio || 1;
  const pxW = totalWidth * dpr;
  const pxH = totalHeight * dpr;
  if (pxW * pxH > MAX_AREA) {
    console.warn("GoFullFirefox: capture area exceeds safe limit; result may be cropped by the browser.");
  }
  return positions;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function notifyError(tabId, message) {
  console.error("[GoFullFirefox]", message);
  browser.scripting
    .executeScript({
      target: { tabId },
      func: (msg) => alert("GoFullFirefox: " + msg),
      args: [message],
    })
    .catch(() => {});
}
