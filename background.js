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
        <span class="__gff_icon">🦊</span>
        <span class="__gff_label">GoFullFox</span>
        <div class="__gff_track"><div class="__gff_fill" id="__gff_fill"></div></div>
        <span class="__gff_count" id="__gff_count">0 / ${total}</span>
      `;
      const s = el.style;
      s.cssText = [
        'all:initial',
        'position:fixed',
        'bottom:22px',
        'right:22px',
        'z-index:2147483647',
        'display:flex',
        'align-items:center',
        'gap:9px',
        'padding:10px 18px',
        'background:rgba(255,255,255,0.55)',
        'backdrop-filter:blur(28px) saturate(180%)',
        '-webkit-backdrop-filter:blur(28px) saturate(180%)',
        'border:1px solid rgba(255,255,255,0.75)',
        'border-radius:999px',
        'box-shadow:0 1px 0 rgba(255,255,255,0.90) inset,0 0 0 0.5px rgba(255,255,255,0.35) inset,0 4px 6px rgba(0,0,0,0.06),0 12px 32px rgba(0,0,0,0.12)',
        'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif',
        'font-size:13px',
        'color:#1c1c1e',
        'line-height:1',
        'pointer-events:none',
        'user-select:none',
      ].join(';');

      const style = document.createElement('style');
      style.id = '__gff_style';
      style.textContent = `
        #__gff_overlay .__gff_icon {
          font-size: 15px;
          line-height: 1;
        }
        #__gff_overlay .__gff_label {
          font-weight: 600;
          font-size: 13px;
          letter-spacing: -0.01em;
          color: #1c1c1e;
        }
        #__gff_overlay .__gff_track {
          width: 90px;
          height: 3px;
          background: rgba(0,0,0,0.10);
          border-radius: 99px;
          overflow: hidden;
          box-shadow: 0 1px 0 rgba(255,255,255,0.6) inset;
        }
        #__gff_overlay .__gff_fill {
          height: 100%;
          width: 0%;
          background: linear-gradient(90deg, #6366f1, #a78bfa, #c084fc);
          background-size: 200% 100%;
          border-radius: 99px;
          transition: width 0.25s ease;
          animation: __gff_shimmer 2s linear infinite;
        }
        @keyframes __gff_shimmer {
          0%   { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        #__gff_overlay .__gff_count {
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          color: rgba(60,60,67,0.55);
          min-width: 38px;
          text-align: right;
          letter-spacing: -0.01em;
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
