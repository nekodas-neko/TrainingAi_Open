## 2026-07-28 — Candidate fix: Leaflet tile pane wiped by Samsung WebView compositor

Third follow-up in the Thunderforest map-tile thread (after #800 CSP, #840 whitespace-trim, #844
full-URL-paste extraction). Owner confirmed, after all three landed and with the exact bare key
verified byte-for-byte against a live, working Thunderforest response:

- The map is still a blank grey background — in both the installed APK **and** a plain Chrome tab
  on the same phone, same WiFi.
- Route polyline and start/end markers (SVG) render correctly, in the right geographic position.
- Pasting the tile URL directly into the address bar, on the same device/network, returns a real
  tile image every time.
- Disabling any VPN/ad-blocker/Private DNS made no difference.

### Server-side verification performed (all passed)
- Live production `Content-Security-Policy` header (fetched directly, not just read from source)
  includes `https://*.tile.thunderforest.com` in `img-src`, on every route checked.
- The exact configured key, tested directly against Thunderforest: single request, 12 concurrent
  requests (burst), with and without a `Referer` header matching the app's origin, and against all
  three `{s}` subdomains (`a`/`b`/`c`) — every case returned `200 OK` with a valid PNG.
- No `<meta>` CSP override in the HTML, no CSP set in `middleware.ts`.

With CSP, key, network path, and CORS all independently confirmed correct, and the failure
reproducing identically in both the native WebView and a standard mobile browser tab (ruling out a
Capacitor-specific cause), the remaining explanation is rendering, not networking.

### Diagnosis
`CLAUDE.md` already documents this exact bug class for this exact device: *"SVGs inside card grids
can wipe sibling cards' gradient backgrounds on Samsung's WebView compositor... Promote siblings
with `willChange: 'transform'`."* Leaflet's map stacks a raster tile pane (`.leaflet-tile-pane`)
directly beneath an SVG overlay pane (`.leaflet-overlay-pane`, holding the route polyline and
markers) in the same stacking context — structurally identical to the already-documented failure
shape, just inside a map instead of a card grid.

### Fix
Added `.leaflet-tile-pane { will-change: transform; }` to `app/globals.css`, promoting the tile
pane to its own GPU compositing layer using the same established pattern as the prior card-grid
fix.

### Status — NOT verified on device
This is a plausible, evidence-consistent candidate fix, not a confirmed root cause. The web sandbox
cannot reproduce Samsung-WebView-specific compositor bugs at all, so this could not be tested here.
Awaiting the owner's on-device confirmation. See `projectOverview.md` Known Issues.
