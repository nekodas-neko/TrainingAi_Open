## 2026-07-27 — Defensive fix: trim the Thunderforest API key before use

Follow-up to the CSP fix (PR #800). Owner confirmed the CSP fix deployed and took effect (a full
force-close/reopen ruled out stale-document CSP caching), yet the map was still blank. Owner then
tested the raw Thunderforest tile URL directly with their real key and got a valid tile image back
— so the key is genuinely valid and CSP is genuinely fixed, but the app still fails to render tiles.

### Diagnosis
Since the exact same URL template with a directly-tested-valid key works outside the app, the only
remaining variable is the literal string value baked into the deployed bundle. The most common real-
world cause of "works when I paste it myself, fails from the stored value" is incidental whitespace
(a trailing newline or space) picked up when the key was copied into Railway's environment-variable
editor — invisible in the dashboard UI, but concatenated byte-for-byte into the tile URL
(`...apikey=${apiKey}`), which Thunderforest's API then rejects as an invalid key (401).

### Fix
`lib/map-tiles.ts`'s `getTileProvider()` now trims the key before using it or checking presence
(`apiKey?.trim()`), so a whitespace-corrupted env var value can no longer silently fall through as
"present but wrong." A whitespace-only value now correctly falls back to OSM, same as an empty one.

### Tests
Two new cases in `lib/map-tiles.test.ts`: a key with leading/trailing whitespace resolves to the
trimmed value in the URL; a whitespace-only key falls back to OSM. All 5 tests pass. `pnpm lint`
clean, no new tsc errors.

### Not yet confirmed
This closes off the most likely failure mode, but I could not directly inspect the actual Railway
env var value to confirm whitespace was really present — the owner was also asked to open the live
Railway URL in a normal mobile browser (outside the APK) to check whether the map renders there,
which would isolate an APK/WebView-specific cause from a build/config one. Awaiting that result;
revisit if this fix alone doesn't resolve it.
