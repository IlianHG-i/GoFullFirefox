// GoFullFox - content script
// Measures the page first, then on a separate message hides scrollbars and
// freezes position:fixed/sticky elements so they do not repeat across tiles.
// scrollTo returns the *actual* scroll position (browser may clamp it past
// the maximum), which the background uses for accurate stitching.
//
// Adapted from GoFullPage (mrcoles/full-page-screen-capture-chrome-extension, MIT).

(() => {
  if (window.__gffInjected) return;
  window.__gffInjected = true;

  const originalState = {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body ? document.body.style.overflow : "",
    fixedElements: [],
  };

  function getDimensions() {
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

  function hideScrollbars() {
    document.documentElement.style.overflow = "hidden";
    if (document.body) document.body.style.overflow = "hidden";
  }

  function neutralizeFixedElements() {
    const all = document.querySelectorAll("*");
    for (const el of all) {
      const cs = window.getComputedStyle(el);
      if (cs.position === "fixed" || cs.position === "sticky") {
        originalState.fixedElements.push({ el, position: el.style.position, priority: el.style.getPropertyPriority("position") });
        el.style.setProperty("position", "absolute", "important");
      }
    }
  }

  let prepared = false;
  function prepare() {
    if (prepared) return;
    prepared = true;
    hideScrollbars();
    neutralizeFixedElements();
  }

  function restore() {
    document.documentElement.style.overflow = originalState.htmlOverflow;
    if (document.body) document.body.style.overflow = originalState.bodyOverflow;
    for (const { el, position, priority } of originalState.fixedElements) {
      if (position) el.style.setProperty("position", position, priority || "");
      else el.style.removeProperty("position");
    }
    originalState.fixedElements.length = 0;
    window.scrollTo(originalState.scrollX, originalState.scrollY);
    window.__gffInjected = false;
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === "gff:getDimensions") {
      // Must run BEFORE prepare() so overflow:hidden does not collapse scrollHeight.
      return Promise.resolve(getDimensions());
    }
    if (msg.type === "gff:prepare") {
      prepare();
      return Promise.resolve(true);
    }
    if (msg.type === "gff:scrollTo") {
      window.scrollTo(msg.x, msg.y);
      // Two RAFs let the browser clamp / settle, then report the actual offset.
      return new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve({ x: window.scrollX, y: window.scrollY })
          )
        )
      );
    }
    if (msg.type === "gff:restore") {
      restore();
      return Promise.resolve(true);
    }
  });
})();
