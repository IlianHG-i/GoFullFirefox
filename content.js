// GoFullFox - content script
// Faithful port of GoFullPage's page.js (mrcoles/full-page-screen-capture-chrome-extension, MIT).
// Key differences from a naive implementation:
//   - body.overflowY = 'visible' before measuring unlocks scrollHeight on pages
//     whose body has overflow:hidden/scroll.
//   - yDelta = windowHeight - SCROLL_PAD creates a 200-px overlap between tiles
//     so sticky headers don't repeat in the output.
//   - Scroll order is bottom-to-top so the top of the page is painted last
//     (winning painter's-algorithm disputes in the overlap region).
//   - window.__gffHandler ensures each injection cleanly replaces any previous
//     listener left by an older version of this script.

(() => {
  if (window.__gffHandler) {
    try { browser.runtime.onMessage.removeListener(window.__gffHandler); } catch (_) {}
  }

  const SCROLL_PAD = 200;

  function measurePage() {
    const body = document.body;

    // GoFullPage's key trick: set overflowY = visible so body.scrollHeight
    // reflects real content height even on pages with overflow:hidden/scroll.
    const originalBodyOverflowY = body ? body.style.overflowY : '';
    if (body) body.style.overflowY = 'visible';

    function max(nums) {
      return Math.max(...nums.filter(x => x));
    }

    const fullWidth = max([
      document.documentElement.clientWidth,
      body ? body.scrollWidth : 0,
      document.documentElement.scrollWidth,
      body ? body.offsetWidth : 0,
      document.documentElement.offsetWidth,
    ]);

    const fullHeight = max([
      document.documentElement.clientHeight,
      body ? body.scrollHeight : 0,
      document.documentElement.scrollHeight,
      body ? body.offsetHeight : 0,
      document.documentElement.offsetHeight,
    ]);

    // Restore immediately after measuring.
    if (body) body.style.overflowY = originalBodyOverflowY;

    return { fullWidth, fullHeight };
  }

  function getPositions() {
    const body = document.body;
    const { fullWidth, fullHeight } = measurePage();
    const windowWidth  = window.innerWidth;
    const windowHeight = window.innerHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;

    // Clamp: if page is only slightly wider than viewport, treat as same width.
    const totalWidth  = fullWidth  <= windowWidth  + 1 ? windowWidth  : fullWidth;
    const totalHeight = fullHeight <= windowHeight + 1 ? windowHeight : fullHeight;

    const yDelta = windowHeight - (windowHeight > SCROLL_PAD ? SCROLL_PAD : 0);
    const xDelta = windowWidth;

    // Build scroll positions bottom-to-top (GoFullPage's ordering).
    const arrangements = [];
    let yPos = totalHeight - windowHeight;
    while (yPos > -yDelta) {
      let xPos = 0;
      while (xPos < totalWidth) {
        arrangements.push([xPos, yPos]);
        xPos += xDelta;
      }
      yPos -= yDelta;
    }

    return {
      arrangements,
      totalWidth,
      totalHeight,
      windowWidth,
      windowHeight,
      devicePixelRatio,
    };
  }

  let cleanUpFn = null;

  function prepare() {
    const body = document.body;
    const originalBodyOverflowY = body ? body.style.overflowY : '';
    const originalX = window.scrollX;
    const originalY = window.scrollY;
    const originalOverflow = document.documentElement.style.overflow;
    const fixedEls = [];

    // Freeze scrollbars for clean captures.
    document.documentElement.style.overflow = 'hidden';

    // Rewrite fixed/sticky → absolute so they don't repeat across tiles.
    for (const el of document.querySelectorAll('*')) {
      const cs = window.getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        fixedEls.push({ el, pos: el.style.position, pri: el.style.getPropertyPriority('position') });
        el.style.setProperty('position', 'absolute', 'important');
      }
    }

    cleanUpFn = function() {
      document.documentElement.style.overflow = originalOverflow;
      if (body) body.style.overflowY = originalBodyOverflowY;
      for (const { el, pos, pri } of fixedEls) {
        if (pos) el.style.setProperty('position', pos, pri || '');
        else el.style.removeProperty('position');
      }
      window.scrollTo(originalX, originalY);
      cleanUpFn = null;
    };
  }

  function restore() {
    if (cleanUpFn) cleanUpFn();
  }

  function handler(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'gff:getPositions') {
      return Promise.resolve(getPositions());
    }
    if (msg.type === 'gff:prepare') {
      prepare();
      return Promise.resolve(true);
    }
    if (msg.type === 'gff:scrollTo') {
      window.scrollTo(msg.x, msg.y);
      return new Promise(resolve =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve({ x: window.scrollX, y: window.scrollY })
          )
        )
      );
    }
    if (msg.type === 'gff:restore') {
      restore();
      return Promise.resolve(true);
    }
  }

  window.__gffHandler = handler;
  browser.runtime.onMessage.addListener(handler);
})();
