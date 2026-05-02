// GoFullFirefox - content script
// Measures the page, hides scrollbars / position:fixed elements during capture,
// scrolls to requested offsets, and restores everything afterwards.
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
        originalState.fixedElements.push({ el, position: el.style.position });
        el.style.setProperty("position", "absolute", "important");
      }
    }
  }

  function restore() {
    document.documentElement.style.overflow = originalState.htmlOverflow;
    if (document.body) document.body.style.overflow = originalState.bodyOverflow;
    for (const { el, position } of originalState.fixedElements) {
      if (position) el.style.position = position;
      else el.style.removeProperty("position");
    }
    originalState.fixedElements.length = 0;
    window.scrollTo(originalState.scrollX, originalState.scrollY);
    window.__gffInjected = false;
  }

  let prepared = false;
  function prepareOnce() {
    if (prepared) return;
    prepared = true;
    hideScrollbars();
    neutralizeFixedElements();
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === "gff:getDimensions") {
      prepareOnce();
      return Promise.resolve(getDimensions());
    }
    if (msg.type === "gff:scrollTo") {
      window.scrollTo(msg.x, msg.y);
      // Some sites animate scroll; resolve on next frame.
      return new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
      );
    }
    if (msg.type === "gff:restore") {
      restore();
      return Promise.resolve(true);
    }
  });
})();
