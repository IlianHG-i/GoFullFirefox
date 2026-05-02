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

## Install

This extension is **not published on addons.mozilla.org** and will never be.
It is distributed exclusively as a **signed `.xpi` from this repo's GitHub
Releases**.

### Permanent install (signed `.xpi`)

1. Open the latest [GitHub Release](https://github.com/IlianHG-i/GoFullFirefox/releases/latest).
2. Download `gofullfirefox-<version>.xpi`.
3. Open Firefox → drag-and-drop the `.xpi` onto a Firefox window
   (or `about:addons` → gear icon → *Install Add-on From File…*).
4. Confirm the install prompt.

The build is signed by Mozilla on the **unlisted (self-hosted) channel**, so
it installs without `xpinstall.signatures.required` tweaks but does not
appear in the public AMO catalog.

### Temporary install (for development)

1. Clone this repo.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `manifest.json`.

Temporary add-ons are removed when Firefox restarts.

## Build & sign locally

CI handles this automatically on tag push (`v*.*.*` → signed `.xpi` attached
to a GitHub Release). To do it by hand:

```bash
npm install -g web-ext
web-ext lint --self-hosted
web-ext sign --channel=unlisted \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET"
# signed .xpi lands in web-ext-artifacts/
```

**Always use `--channel=unlisted`.** Never `listed` — that would publish
this extension on the public AMO catalog, which is explicitly out of scope
for this project.

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
