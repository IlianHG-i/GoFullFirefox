// GoFullFox - background event page
// Orchestrates full-page capture. Algorithm ported from GoFullPage
// (mrcoles/full-page-screen-capture-chrome-extension, MIT).

const CAPTURE_DELAY_MS = 150;

browser.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  // ── 1. Find the frame with the most scrollable content ───────────────────
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

  // ── 3. Measure page and build tile arrangement ────────────────────────────
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
  const total = arrangements.length;

  // ── 4. Prepare DOM (hide scrollbars, freeze fixed elements) ───────────────
  await browser.tabs.sendMessage(tab.id, { type: 'gff:prepare' }, { frameId }).catch(() => {});

  // ── 5. Inject progress overlay into the TOP frame (always visible to user) ─
  await overlayCreate(tab.id, total).catch(() => {});

  // ── 6. Tile loop ──────────────────────────────────────────────────────────
  const screenshots = [];

  for (let i = 0; i < arrangements.length; i++) {
    const [reqX, reqY] = arrangements[i];

    let actual;
    try {
      actual = await browser.tabs.sendMessage(
        tab.id, { type: 'gff:scrollTo', x: reqX, y: reqY }, { frameId }
      );
    } catch (err) {
      notifyError(tab.id, `Scroll failed: ${err.message}`);
      await cleanup(tab.id, frameId);
      return;
    }

    await sleep(CAPTURE_DELAY_MS);

    // Hide overlay and wait for repaint before capturing.
    await overlayHideAndFlush(tab.id).catch(() => {});

    let dataUrl;
    try {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (err) {
      notifyError(tab.id, `Capture failed: ${err.message}`);
      await cleanup(tab.id, frameId);
      return;
    }

    screenshots.push({ x: actual.x, y: actual.y, dataUrl });

    // Show overlay again with updated progress.
    await overlayUpdate(tab.id, i + 1, total).catch(() => {});
  }

  await cleanup(tab.id, frameId);

  // ── 7. Hand off to result page ────────────────────────────────────────────
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

// ── Overlay helpers (run in the top frame, frameId 0) ─────────────────────────

function overlayCreate(tabId, total) {
  return browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: function(total) {
      if (document.getElementById('__gff_overlay')) return;
      const el = document.createElement('div');
      el.id = '__gff_overlay';
      el.innerHTML = `
        <span class="__gff_label">GoFullFox</span>
        <div class="__gff_track"><div class="__gff_fill" id="__gff_fill"></div></div>
        <span class="__gff_count" id="__gff_count">0 / ${total}</span>
      `;
      const s = el.style;
      s.cssText = [
        'all:initial',
        'position:fixed',
        'bottom:20px',
        'right:20px',
        'z-index:2147483647',
        'display:flex',
        'align-items:center',
        'gap:10px',
        'padding:10px 16px',
        'background:rgba(15,15,20,0.82)',
        'backdrop-filter:blur(12px)',
        '-webkit-backdrop-filter:blur(12px)',
        'border:1px solid rgba(255,255,255,0.10)',
        'border-radius:999px',
        'box-shadow:0 4px 24px rgba(0,0,0,0.4)',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'font-size:13px',
        'color:#e4e4e7',
        'line-height:1',
        'pointer-events:none',
        'user-select:none',
        'transition:opacity 0.15s ease',
      ].join(';');

      const style = document.createElement('style');
      style.id = '__gff_style';
      style.textContent = `
        #__gff_overlay .__gff_label {
          font-weight: 600;
          color: #a78bfa;
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        #__gff_overlay .__gff_track {
          width: 100px;
          height: 4px;
          background: rgba(255,255,255,0.12);
          border-radius: 99px;
          overflow: hidden;
        }
        #__gff_overlay .__gff_fill {
          height: 100%;
          width: 0%;
          background: linear-gradient(90deg, #6d28d9, #a78bfa);
          border-radius: 99px;
          transition: width 0.25s ease;
        }
        #__gff_overlay .__gff_count {
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          color: #a1a1aa;
          min-width: 42px;
          text-align: right;
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(el);
    },
    args: [total],
  });
}

// Hide the overlay AND wait two rAFs so the browser repaints before we capture.
function overlayHideAndFlush(tabId) {
  return browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: function() {
      const el = document.getElementById('__gff_overlay');
      if (el) el.style.visibility = 'hidden';
      return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
  });
}

function overlayUpdate(tabId, current, total) {
  return browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: function(current, total) {
      const el = document.getElementById('__gff_overlay');
      if (!el) return;
      el.style.visibility = 'visible';
      const fill  = document.getElementById('__gff_fill');
      const count = document.getElementById('__gff_count');
      if (fill)  fill.style.width  = (current / total * 100) + '%';
      if (count) count.textContent = current + ' / ' + total;
    },
    args: [current, total],
  });
}

function overlayRemove(tabId) {
  return browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: function() {
      document.getElementById('__gff_overlay')?.remove();
      document.getElementById('__gff_style')?.remove();
    },
  }).catch(() => {});
}

async function cleanup(tabId, frameId) {
  await Promise.all([
    browser.tabs.sendMessage(tabId, { type: 'gff:restore' }, { frameId }).catch(() => {}),
    overlayRemove(tabId),
  ]);
}

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
