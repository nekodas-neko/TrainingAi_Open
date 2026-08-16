## 2026-07-27 — Fix: Thunderforest map tiles blocked by Content-Security-Policy

Owner report (with screenshot): after provisioning `NEXT_PUBLIC_THUNDERFOREST_API_KEY` and
redeploying, the activity route map's attribution correctly read "Maps © Thunderforest, Data ©
OpenStreetMap contributors" — proving the key was being read — but the map itself showed a blank
grey background with only the route line and start/end markers, no actual map imagery.

### Root cause
`next.config.ts`'s Content-Security-Policy `img-src` directive allowlisted only
`https://*.tile.openstreetmap.org`. When the 2026-07-17 map-tiles-upgrade plan added the
Thunderforest tile provider (`lib/map-tiles.ts`), the CSP was never updated to also allow
`https://*.tile.thunderforest.com` — so every tile image request was silently blocked by the
browser/WebView. The attribution text is static HTML computed purely client-side by
`getTileProvider()`, unaffected by CSP, which is exactly why it displayed correctly while the tile
images themselves never loaded.

### Fix
Added `https://*.tile.thunderforest.com` to the `img-src` directive alongside the existing OSM
entry. One-line, additive allowlist change — no other CSP directive touched.

### Tests
- `pnpm lint` clean; no new tsc errors. No existing test asserts on the CSP string content (nothing
  to update). No device-only path — CSP headers apply identically to the web build and the APK
  WebView, so this is fully covered by the header being present in the response; the actual tile
  render is confirmed by the owner's screenshot evidence (attribution correct, imagery missing
  before the fix) rather than a new automated test.

### Companion PR
`docs/thunderforest-hobby-tier-note` (docs-only: softened the referrer-restriction wording since
Thunderforest's Hobby/free tier doesn't offer it, and struck the owner-action item) — separate PR,
this fix is the actual functional half.
