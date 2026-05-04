// GoFullFox - background event page
// Captures the entire page (or the largest iframe if the page is an iframe
// wrapper) as a stitched PNG/PDF by scrolling the target frame and calling
// tabs.captureVisibleTab() for each viewport tile.
//
// Adapted from GoFullPage (mrcoles/full-page-screen-capture-chrome-extension, MIT).

const CAPTURE_DELAY_MS = 250;

browser.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  // ── Step 1: measure all frames to find the one with the most content ──────
  let frameResults;
  try {
    frameResults = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: measureFrame,
    });
  } catch (err) {
    notifyError(tab.id, `Cannot run on this page: ${err.message}`);
    return;
  }

  // Pick the frame with the largest scrollable area.
  const best = frameResults
    .filter((r) => r.result)
    .reduce((a, b) =>
      b.result.totalWidth * b.result.totalHeight >
      a.result.totalWidth * a.result.totalHeight
        ? b
        : a
    );

  const targetFrameId = best.frameId;

  // ── Step 2: inject content.js into the chosen frame ──────────────────────
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [targetFrameId] },
      files: ["content.js"],
    });
  } catch (err) {
    notifyError(tab.id, `Cannot inject into frame: ${err.message}`);
    return;
  }

  // ── Step 3: measure (before touching DOM) then prepare ───────────────────
  let dims;
  try {
    dims = await browser.tabs.sendMessage(
      tab.id,
      { type: "gff:getDimensions" },
      { frameId: targetFrameId }
    );
  } catch (err) {
    notifyError(tab.id, `Failed to read dimensions: ${err.message}`);
    return;
  }

  await browser.tabs
    .sendMessage(tab.id, { type: "gff:prepare" }, { frameId: targetFrameId })
    .catch(() => {});

  // ── Step 4: tile loop ─────────────────────────────────────────────────────
  const positions = computePositions(dims);
  const screenshots = [];

  for (const pos of positions) {
    let actual;
    try {
      actual = await browser.tabs.sendMessage(
        tab.id,
        { type: "gff:scrollTo", x: pos.x, y: pos.y },
        { frameId: targetFrameId }
      );
    } catch (err) {
      notifyError(tab.id, `Scroll failed: ${err.message}`);
      await browser.tabs
        .sendMessage(tab.id, { type: "gff:restore" }, { frameId: targetFrameId })
        .catch(() => {});
      return;
    }

    await sleep(CAPTURE_DELAY_MS);

    let dataUrl;
    try {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (err) {
      notifyError(tab.id, `Capture failed: ${err.message}`);
      await browser.tabs
        .sendMessage(tab.id, { type: "gff:restore" }, { frameId: targetFrameId })
        .catch(() => {});
      return;
    }

    screenshots.push({ x: actual.x, y: actual.y, dataUrl });
  }

  await browser.tabs
    .sendMessage(tab.id, { type: "gff:restore" }, { frameId: targetFrameId })
    .catch(() => {});

  // ── Step 5: hand off to result page ──────────────────────────────────────
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

// Runs inside every frame via scripting.executeScript to measure its content.
// Must be a named function (not arrow) so Firefox can serialise it.
function measureFrame() {
  const body = document.body;
  const html = document.documentElement;
  const totalWidth = Math.max(
    body ? body.scrollWidth : 0,
    body ? body.offsetWidth : 0,
    html.clientWidth,
    html.scrollWidth,
    html.offsetWidth
  );
  const totalHeight = Math.max(
    body ? body.scrollHeight : 0,
    body ? body.offsetHeight : 0,
    html.clientHeight,
    html.scrollHeight,
    html.offsetHeight
  );
  return {
    totalWidth,
    totalHeight,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function computePositions({ totalWidth, totalHeight, windowWidth, windowHeight }) {
  const positions = [];
  for (let y = 0; y < totalHeight; y += windowHeight) {
    for (let x = 0; x < totalWidth; x += windowWidth) {
      positions.push({ x, y });
    }
  }
  if (positions.length === 0) positions.push({ x: 0, y: 0 });
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
