// GoFullFox - background event page
// Orchestrates full-page capture. Algorithm ported from GoFullPage
// (mrcoles/full-page-screen-capture-chrome-extension, MIT).
//
// Frame selection: measures all frames, picks the one with the most
// scrollable content so full-screen iframes work automatically.

const CAPTURE_DELAY_MS = 150; // GoFullPage uses 150 ms

browser.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  // ── 1. Find the frame with the most content ───────────────────────────────
  let frameResults;
  try {
    frameResults = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: function measureFrame() {
        function max(nums) { return Math.max(...nums.filter(x => x)); }
        const body = document.body;
        const origOY = body ? body.style.overflowY : '';
        if (body) body.style.overflowY = 'visible';
        const w = max([document.documentElement.clientWidth, body ? body.scrollWidth : 0, document.documentElement.scrollWidth]);
        const h = max([document.documentElement.clientHeight, body ? body.scrollHeight : 0, document.documentElement.scrollHeight]);
        if (body) body.style.overflowY = origOY;
        return { w, h };
      },
    });
  } catch (err) {
    notifyError(tab.id, `Cannot run on this page: ${err.message}`);
    return;
  }

  const best = frameResults
    .filter(r => r.result)
    .reduce((a, b) => b.result.w * b.result.h > a.result.w * a.result.h ? b : a);

  const frameId = best.frameId;

  // ── 2. Inject content script into the chosen frame ────────────────────────
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      files: ['content.js'],
    });
  } catch (err) {
    notifyError(tab.id, `Injection failed: ${err.message}`);
    return;
  }

  // ── 3. Get scroll positions (measures page, builds arrangement list) ──────
  let info;
  try {
    info = await browser.tabs.sendMessage(
      tab.id, { type: 'gff:getPositions' }, { frameId }
    );
  } catch (err) {
    notifyError(tab.id, `Failed to read page: ${err.message}`);
    return;
  }

  const { arrangements, totalWidth, totalHeight, windowWidth, devicePixelRatio } = info;

  // ── 4. Prepare DOM (hide scrollbars, freeze fixed elements) ───────────────
  await browser.tabs
    .sendMessage(tab.id, { type: 'gff:prepare' }, { frameId })
    .catch(() => {});

  // ── 5. Tile loop ──────────────────────────────────────────────────────────
  const screenshots = [];

  for (const [reqX, reqY] of arrangements) {
    let actual;
    try {
      actual = await browser.tabs.sendMessage(
        tab.id, { type: 'gff:scrollTo', x: reqX, y: reqY }, { frameId }
      );
    } catch (err) {
      notifyError(tab.id, `Scroll failed: ${err.message}`);
      await browser.tabs.sendMessage(tab.id, { type: 'gff:restore' }, { frameId }).catch(() => {});
      return;
    }

    await sleep(CAPTURE_DELAY_MS);

    let dataUrl;
    try {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (err) {
      notifyError(tab.id, `Capture failed: ${err.message}`);
      await browser.tabs.sendMessage(tab.id, { type: 'gff:restore' }, { frameId }).catch(() => {});
      return;
    }

    screenshots.push({ x: actual.x, y: actual.y, dataUrl });
  }

  await browser.tabs.sendMessage(tab.id, { type: 'gff:restore' }, { frameId }).catch(() => {});

  // ── 6. Hand off to result page ────────────────────────────────────────────
  await browser.storage.local.set({
    'gff:result': {
      screenshots,
      totalWidth,
      totalHeight,
      windowWidth,
      devicePixelRatio,
      sourceUrl: tab.url || '',
      sourceTitle: tab.title || 'Capture',
      createdAt: Date.now(),
    },
  });

  await browser.tabs.create({ url: browser.runtime.getURL('result.html') });
});

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function notifyError(tabId, message) {
  console.error('[GoFullFox]', message);
  browser.scripting.executeScript({
    target: { tabId },
    func: msg => alert('GoFullFox: ' + msg),
    args: [message],
  }).catch(() => {});
}
