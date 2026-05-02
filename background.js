// GoFullFox - background event page
// Orchestrates full-page screenshot capture by repeatedly scrolling the
// active tab and stitching captureVisibleTab() snapshots in a result page.
//
// Algorithm adapted from GoFullPage (mrcoles/full-page-screen-capture-chrome-extension, MIT).

const CAPTURE_DELAY_MS = 250; // let the page settle (lazy images, sticky headers) between scrolls; also avoids Firefox capture rate limit
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

  // 1. Measure FIRST, before touching DOM (overflow:hidden would collapse scrollHeight on some sites).
  let dims;
  try {
    dims = await browser.tabs.sendMessage(tab.id, { type: "gff:getDimensions" });
  } catch (err) {
    notifyError(tab.id, `Failed to read page dimensions: ${err.message}`);
    return;
  }

  // 2. Now hide scrollbars and freeze fixed/sticky elements.
  await browser.tabs.sendMessage(tab.id, { type: "gff:prepare" }).catch(() => {});

  const arrangements = computeArrangements(dims);
  const screenshots = [];
  for (const pos of arrangements) {
    let actual;
    try {
      actual = await browser.tabs.sendMessage(tab.id, { type: "gff:scrollTo", x: pos.x, y: pos.y });
    } catch (err) {
      notifyError(tab.id, `Scroll failed: ${err.message}`);
      await browser.tabs.sendMessage(tab.id, { type: "gff:restore" }).catch(() => {});
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
    // Use the *actual* scroll position so painter's-algorithm stitching aligns
    // even when the browser clamps scrollTo at the page bottom/right.
    screenshots.push({ x: actual.x, y: actual.y, dataUrl });
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
  for (let y = 0; y < totalHeight; y += windowHeight) {
    for (let x = 0; x < totalWidth; x += windowWidth) {
      positions.push({ x, y });
    }
  }
  if (positions.length === 0) positions.push({ x: 0, y: 0 });
  const dpr = dims.devicePixelRatio || 1;
  if (totalWidth * dpr * totalHeight * dpr > MAX_AREA) {
    console.warn("GoFullFox: capture area exceeds safe limit; output may be cropped by the browser.");
  }
  return positions;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function notifyError(tabId, message) {
  console.error("[GoFullFox]", message);
  browser.scripting
    .executeScript({
      target: { tabId },
      func: (msg) => alert("GoFullFox: " + msg),
      args: [message],
    })
    .catch(() => {});
}
