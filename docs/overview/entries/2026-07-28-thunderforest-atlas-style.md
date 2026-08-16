## 2026-07-28 — Switch activity map to Thunderforest's Atlas style

Follow-up to the `connect-src` CSP fix (#860), which finally got the map tiles rendering. Owner
found the "Outdoors" style too muted/terrain-focused for a suburban run route and asked for
alternatives. "Landscape" is similar in spirit to "Outdoors" (both terrain/vegetation-oriented), so
switched to "Atlas" instead — Thunderforest's general-purpose street-map style, clearer roads and
labels, better suited to routes through built-up areas.

### Change
`lib/map-tiles.ts`'s `getTileProvider()` now builds the tile URL against Thunderforest's `atlas`
endpoint instead of `outdoors`. Same API key works across all Thunderforest styles — no new
account, no env var change. Updated `lib/map-tiles.test.ts` assertions and the
`.env.example`/`README.md` comments referencing "Outdoors" to match.

### Tests
All 6 `map-tiles.test.ts` cases updated and passing. `pnpm lint` clean.
