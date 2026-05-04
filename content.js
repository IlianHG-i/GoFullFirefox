// GoFullFox - content script
// Injected into the target frame (main page or the largest iframe).
// Measures the frame's document, hides scrollbars, freezes fixed/sticky
// elements, scrolls on demand, and restores everything afterwards.
//
// Uses window.__gffHandler so each injection cleanly replaces any previous
// listener — avoids stale listeners surviving extension updates or re-clicks.
//
// Adapted from GoFullPage (mrcoles/full-page-screen-capture-chrome-extension, MIT).

(() => {
  // Remove stale listener from any previous injection of this script.
  if (window.__gffHandler) {
    try { browser.runtime.onMessage.removeListener(window.__gffHandler); } catch (_) {}
  }

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

  let prepared = false;
  function prepare() {
    if (prepared) return;
    prepared = true;
    document.documentElement.style.overflow = "hidden";
    if (document.body) document.body.style.overflow = "hidden";
    for (const el of document.querySelectorAll("*")) {
      const cs = window.getComputedStyle(el);
      if (cs.position === "fixed" || cs.position === "sticky") {
        originalState.fixedElements.push({
          el,
          position: el.style.position,
          priority: el.style.getPropertyPriority("position"),
        });
        el.style.setProperty("position", "absolute", "important");
      }
    }
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
    prepared = false;
  }

  function handler(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === "gff:getDimensions") {
      // Must run BEFORE prepare() — overflow:hidden collapses scrollHeight on some pages.
      return Promise.resolve(getDimensions());
    }
    if (msg.type === "gff:prepare") {
      prepare();
      return Promise.resolve(true);
    }
    if (msg.type === "gff:scrollTo") {
      window.scrollTo(msg.x, msg.y);
      // Two rAFs let the browser settle and report the clamped actual position.
      return new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve({ x: window.scrollX, y: window.scrollY }))
        )
      );
    }
    if (msg.type === "gff:restore") {
      restore();
      return Promise.resolve(true);
    }
  }

  window.__gffHandler = handler;
  browser.runtime.onMessage.addListener(handler);
})();
