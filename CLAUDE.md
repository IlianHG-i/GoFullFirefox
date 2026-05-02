# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

GoFullFirefox is an **unofficial Firefox port** of the Chrome extension
[GoFullPage / Full Page Screen Capture](https://github.com/mrcoles/full-page-screen-capture-chrome-extension)
by Peter Coles (mrcoles), distributed under the original MIT License with the
original copyright preserved. Any change must keep the attribution intact in
`LICENSE`, `README.md`, `manifest.json` (`description` / `author`), and the
header comments of `background.js` / `content.js`. Do not strip Peter Coles's
copyright from `LICENSE`.

This is a single-purpose WebExtension. Keep it small — no build step, no
bundler, no framework. Pure HTML/CSS/JS targeting Firefox MV3.

## Architecture

Three coordinated scripts, no shared module system:

- `background.js` — event-page background. Owns the capture orchestration:
  injects `content.js`, asks for page dimensions, computes the tile grid,
  scrolls + `tabs.captureVisibleTab()` per tile, writes the result bundle into
  `browser.storage.local` under the key `"gff:result"`, then opens
  `result.html` in a new tab.
- `content.js` — runs in the page. Reports dimensions and DPR, hides
  scrollbars, rewrites `position: fixed` / `sticky` to `absolute` so sticky
  headers don't repeat across tiles, and restores the original DOM state on
  the `gff:restore` message. Guarded by `window.__gffInjected` so re-injection
  is idempotent.
- `result.html` + `result.js` — reads the bundle from storage, draws each tile
  onto a canvas at `devicePixelRatio`. Trailing-edge tiles are cropped on the
  source side (`sx`/`sy` offsets) so overlap from the last column/row doesn't
  double-paint.

Message protocol (background ↔ content): `gff:getDimensions`, `gff:scrollTo`,
`gff:restore`. Storage key for tab→result handoff: `gff:result`.

Why storage instead of passing data through the URL or a port: the stitched
PNG can be tens of MB; `browser.storage.local` is the only handoff channel
that survives navigation and is large enough.

## Commands

No build system. Workflow is manual:

```bash
# Load in Firefox during development
# 1. open about:debugging#/runtime/this-firefox
# 2. Load Temporary Add-on -> select manifest.json

# Optional, if web-ext is installed globally
web-ext run                         # launch a fresh Firefox with the extension loaded
web-ext lint                        # validate manifest + scripts against AMO rules
web-ext build                       # produces web-ext-artifacts/*.zip for AMO upload

# Manual package for AMO upload (no web-ext required)
zip -r gofullfirefox.zip manifest.json background.js content.js \
  result.html result.js icons/icon.svg LICENSE README.md
```

There is no test suite. Verification is manual: load the extension, capture a
long page (e.g. a Wikipedia article), confirm the result tab shows a stitched
PNG with no repeating headers and that Download/Copy work.

## Distribution policy (important)

This extension is **never** published on the public AMO catalog. It is
distributed only as a **signed `.xpi` on GitHub Releases**, signed via the
**unlisted** channel using `web-ext sign --channel=unlisted` with the repo
secrets `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`.

- `.github/workflows/release.yml` runs on `v*.*.*` tags: lint → sign
  unlisted → upload `gofullfirefox-<tag>.xpi` as a Release asset.
- Never change `--channel=unlisted` to `listed`.
- Never add AMO install links to README or docs.
- Never run `web-ext sign` interactively without `--channel=unlisted`.

## Editing rules specific to this repo

- Target Firefox MV3 with `background.scripts` (event page). Do **not**
  migrate to `service_worker` — that path is Chrome-only and Firefox MV3
  uses event pages.
- Use the `browser.*` Promise APIs (Firefox-native). Do not switch to
  `chrome.*` callbacks.
- The capture algorithm is load-bearing: the trailing-tile crop math in
  `result.js` (`sx`/`sy` based on `img.width - tileWidth`) is what prevents
  the last column/row from duplicating content. Change it carefully.
- DPR handling: tiles come out of `captureVisibleTab` at physical pixels
  (`window.innerWidth * dpr`). The canvas is sized in physical pixels; tile
  positions are multiplied by `dpr` before drawing.
- `CAPTURE_DELAY_MS` in `background.js` exists to let lazy-loaded images and
  scroll-triggered animations settle. Do not remove it; tune it if needed.

## Git conventions (from user global rules)

- Branches: `feat/<n>`, `fix/<n>`, `refactor/<n>`, `chore/<n>`, `docs/<n>`.
  One branch per feature, always branch from `main`.
- Conventional Commits, terse messages, French or English.
- **No reference to Claude / Anthropic / AI in commits, PRs, code, or
  comments.** No `Co-Authored-By` trailer.
- Never `--force` push without explicit user approval. Never commit directly
  to `main`.
