# GoFullFirefox

Capture an entire web page as a single PNG, in Firefox.

> **Unofficial Firefox port** of the excellent
> **[GoFullPage / Full Page Screen Capture](https://github.com/mrcoles/full-page-screen-capture-chrome-extension)**
> Chrome extension by **[Peter Coles (mrcoles)](https://mrcoles.com)**.
> All credit for the original idea, algorithm, and Chrome implementation goes to
> Peter Coles. This repository exists only because the original extension is not
> distributed for Firefox. Released under the original MIT License with the
> original copyright preserved — see [LICENSE](./LICENSE).

This is **not** an official release from the original author and is **not**
affiliated with mrcoles.com. If an official Firefox build is ever published,
prefer it.

## Features

- One-click full-page capture from the toolbar.
- Hides scrollbars and freezes `position: fixed` / `sticky` elements during
  capture so headers don't repeat across tiles.
- Stitches every viewport tile on a canvas at the page's `devicePixelRatio`.
- Downloads as PNG or copies the image to the clipboard.

## Install (temporary, for development)

1. Clone this repo.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…** and select `manifest.json`.
4. A toolbar icon appears. Click it on any page to capture.

Temporary add-ons are removed when Firefox restarts. For persistent install,
package and submit to [addons.mozilla.org](https://addons.mozilla.org/) (see
below).

## Package for AMO

```
zip -r gofullfirefox.zip manifest.json background.js content.js \
    result.html result.js icons/icon.svg LICENSE README.md
```

Upload the resulting `gofullfirefox.zip` via the Firefox Add-on Developer Hub.

## How it works

1. Click the toolbar action → `background.js` injects `content.js` into the
   active tab.
2. The content script reports total document width/height, viewport size, and
   `devicePixelRatio`, then hides scrollbars and neutralises fixed/sticky
   elements.
3. The background loops through tile positions, scrolling the page and calling
   `tabs.captureVisibleTab()` for each viewport.
4. Tiles are stored in `browser.storage.local` and a result tab opens
   (`result.html`), which paints the tiles onto a single canvas, crops
   overlap on the trailing edges, and exposes Download / Copy actions.

## Attribution

- **Original work**: [GoFullPage / Full Page Screen Capture](https://github.com/mrcoles/full-page-screen-capture-chrome-extension) © Peter Coles, MIT License.
- **Firefox port**: IlianHG-i, 2026.

The capture algorithm (multi-pass scroll + `captureVisibleTab` + canvas stitch)
is the technique pioneered by Peter Coles in the original Chrome extension.

## License

MIT — see [LICENSE](./LICENSE). Both the original copyright (Peter Coles) and
the port copyright (IlianHG-i) are preserved.
