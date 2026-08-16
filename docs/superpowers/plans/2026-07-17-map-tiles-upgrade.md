# Map Tiles Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain OpenStreetMap tiles on the Leaflet activity-route map with running-friendly Thunderforest "Outdoors" tiles, keyed by a public env var, with graceful OSM fallback when no key is set.

**Architecture:** Add one pure helper (`lib/map-tiles.ts`) that returns a `{ url, attribution }` tile-provider config — Thunderforest "Outdoors" when `NEXT_PUBLIC_THUNDERFOREST_API_KEY` is present, else the current OSM tiles. `components/activity/activity-route-map.tsx` calls the helper and passes the result straight into its existing `<TileLayer>`; no other Leaflet, safe-area, or offline-fallback code changes. The API key is a client-inlined `NEXT_PUBLIC_*` value, so it must be domain/referrer-restricted in the provider dashboard.

**Tech Stack:** Next.js 15, React 19, TypeScript, `react-leaflet` ^5.0.0 + `leaflet` ^1.9.4, vitest ^4.1.8.

---

## Background — current state (verified)

- `components/activity/activity-route-map.tsx:78-81` renders a single OSM `<TileLayer>`:
  ```tsx
  <TileLayer
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  />
  ```
  The offline fallback message lives at `activity-route-map.tsx:67-73` (the `!online` branch) and the route `<Polyline>` uses `pathOptions={{ color: 'var(--color-brand)', weight: 4 }}` at line 82. **None of this changes.**
- The component is loaded via `next/dynamic({ ssr: false })` from four call sites: `components/activity/activity-detail-sheet.tsx:11`, `done-activity-screen.tsx:19`, `exercise-review-sheet.tsx:12`, `active-activity-screen.tsx:11`. **No call site changes** — the provider swap is internal to `activity-route-map.tsx`.
- `package.json` already has `leaflet` ^1.9.4 (L97), `react-leaflet` ^5.0.0 (L110), `@mapbox/polyline` ^1.2.1 (L64). **No new dependency, no `pnpm install`.**
- **No DB migration is needed** — this is a purely client-side rendering change; no schema, repository, or `pushMutations` code is touched.

### Service-worker / offline interaction — scoped OUT (with reason)

The service worker (`public/sw-template.js`) has **no cached-origins allowlist**. Its `fetch` handler (`public/sw-template.js:66-176`) routes by `url.pathname`; Leaflet tiles are cross-origin `<img>` requests to a third-party host, so they fall through to the final "everything else" branch (`public/sw-template.js:158-175`), which caches **only** responses where `res.ok` is true (the guard at `public/sw-template.js:164`). Cross-origin `<img>` tile responses are **opaque** (`res.ok === false`), so tiles are **not** SW-cached today under OSM and will **not** be under Thunderforest either. Offline behaviour is handled entirely by the `useIsOnline()` fallback message at `activity-route-map.tsx:67-73`, which is untouched. **Therefore no `public/sw-template.js` or `app/sw.js/route.ts` change is required, and none is made.**

### Alternative provider — documented, not implemented

If Thunderforest is ever swapped for **Stadia Maps "Outdoors"**, it is the same drop-in `<TileLayer>` change — only the URL template and attribution differ:
```
url:         https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}{r}.png?api_key=KEY
attribution: &copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
```
No task implements this; it is recorded here so the swap is a one-function edit later.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/map-tiles.ts` | Create | Pure `getTileProvider(apiKey?)` → `{ url, attribution }`; Thunderforest when key present, OSM fallback otherwise |
| `lib/map-tiles.test.ts` | Create | Unit tests for both provider branches + empty-key fallback |
| `components/activity/activity-route-map.tsx` | Modify (`78-81`) | Call `getTileProvider()` and feed its `url`/`attribution` into the existing `<TileLayer>` |
| `.env.example` | Modify (append a Maps section after L24) | Document `NEXT_PUBLIC_THUNDERFOREST_API_KEY` + referrer-restriction note |
| `README.md` | Modify (`70-79`) | Add the new var to the env block |

---

## Task 1: Tile-provider helper (`lib/map-tiles.ts`)

**Files:**
- Create: `lib/map-tiles.ts`
- Test: `lib/map-tiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/map-tiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getTileProvider } from './map-tiles'

describe('getTileProvider', () => {
  it('returns Thunderforest Outdoors tiles when an API key is provided', () => {
    const provider = getTileProvider('abc123')
    expect(provider.url).toBe(
      'https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=abc123',
    )
    expect(provider.attribution).toContain('Thunderforest')
    expect(provider.attribution).toContain('OpenStreetMap')
  })

  it('falls back to OpenStreetMap tiles when no key is provided', () => {
    const provider = getTileProvider(undefined)
    expect(provider.url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(provider.attribution).toBe(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    )
  })

  it('treats an empty-string key as absent and falls back to OSM', () => {
    const provider = getTileProvider('')
    expect(provider.url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/map-tiles.test.ts`
Expected: FAIL — `Failed to resolve import "./map-tiles"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/map-tiles.ts`:

```ts
export interface TileProvider {
  url: string
  attribution: string
}

const OSM_TILES: TileProvider = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

// The key is inlined into the client bundle by Next.js (NEXT_PUBLIC_*), so it is
// public — it MUST be domain/referrer-restricted in the Thunderforest dashboard.
// Reading it as a default param (not at module top level) keeps the function pure
// and unit-testable for both branches.
export function getTileProvider(
  apiKey: string | undefined = process.env.NEXT_PUBLIC_THUNDERFOREST_API_KEY,
): TileProvider {
  if (!apiKey) return OSM_TILES
  return {
    url: `https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${apiKey}`,
    attribution:
      'Maps &copy; <a href="https://www.thunderforest.com">Thunderforest</a>, Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/map-tiles.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/map-tiles.ts lib/map-tiles.test.ts
git commit -m "Add configurable Leaflet tile provider with OSM fallback"
```

---

## Task 2: Wire the helper into the route map

**Files:**
- Modify: `components/activity/activity-route-map.tsx:78-81`

- [ ] **Step 1: Add the import**

At the top of `components/activity/activity-route-map.tsx`, below the existing `import { cn } from '@/lib/utils'` line (currently line 6), add:

```tsx
import { getTileProvider } from '@/lib/map-tiles'
```

- [ ] **Step 2: Resolve the provider inside the component**

In `components/activity/activity-route-map.tsx`, immediately after the existing `bounds` `useMemo` block (ends at line 63) and before the `if (displayPoints.length === 0) return null` guard (line 65), add:

```tsx
  const tiles = getTileProvider()
```

(`getTileProvider()` is a cheap pure call reading a build-inlined constant, so it does not need memoisation.)

- [ ] **Step 3: Feed the provider into the existing `<TileLayer>`**

Replace the `<TileLayer>` block at `components/activity/activity-route-map.tsx:78-81`:

```tsx
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
```

with:

```tsx
        <TileLayer attribution={tiles.attribution} url={tiles.url} />
```

Leave the surrounding `<MapContainer>`, `<Polyline>` (`var(--color-brand)`), and both `<CircleMarker>` lines exactly as they are.

- [ ] **Step 4: Verify the existing suite and lint still pass**

Run: `pnpm test lib/map-tiles.test.ts && pnpm lint`
Expected: tests PASS; lint reports no errors for `components/activity/activity-route-map.tsx` or `lib/map-tiles.ts`.

- [ ] **Step 5: Verify the fallback renders in dev (no key set)**

Run: `pnpm dev`, sign in as `test@local.dev` (`testpass123`), open an activity with a recorded GPS route (e.g. via the History day overlay / activity detail sheet). With no `NEXT_PUBLIC_THUNDERFOREST_API_KEY` in `.env.local`, the map must still render OSM tiles (identical to before this change) — confirming the graceful fallback path.
Expected: map paints with OSM tiles; no console error; the offline fallback message still appears when `navigator.onLine` is false.

- [ ] **Step 6: Commit**

```bash
git add components/activity/activity-route-map.tsx
git commit -m "Render activity route map through configurable tile provider"
```

---

## Task 3: Document the new env var

**Files:**
- Modify: `.env.example` (append after line 24, the `GEMINI_API_KEY=` line)
- Modify: `README.md:70-79` (the env `​```env` block)

- [ ] **Step 1: Add a Maps section to `.env.example`**

After the AI block in `.env.example` (the `GEMINI_API_KEY=` line at line 24), insert:

```env

# ── Maps (activity route tiles) ───────────────────────────────────────────────
# Thunderforest "Outdoors" tile key for the activity route map. PUBLIC — it is
# inlined into the client bundle, so restrict it by allowed HTTP referrer /
# domain in the Thunderforest dashboard (https://www.thunderforest.com/docs/apikeys/).
# If unset, the map gracefully falls back to plain OpenStreetMap tiles.
NEXT_PUBLIC_THUNDERFOREST_API_KEY=
```

- [ ] **Step 2: Add the var to the README env block**

In `README.md`, inside the `​```env` block (lines 70-79), add this line after `WEBHOOK_USER_ID=` (line 78):

```env
NEXT_PUBLIC_THUNDERFOREST_API_KEY=  # PUBLIC map tile key (referrer-restrict it); optional — falls back to OSM
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "Document NEXT_PUBLIC_THUNDERFOREST_API_KEY env var"
```

---

## Verification summary

**Sandbox-verifiable (do these):**
- `pnpm test lib/map-tiles.test.ts` — both provider branches + empty-key fallback (Task 1).
- `pnpm lint` — no lint errors on the two touched source files (Task 2, Step 4).
- `pnpm dev` fallback render with **no** key set — OSM tiles still paint, offline message still works (Task 2, Step 5).

**NOT sandbox-verifiable (must be checked on the owner's setup / device):**
- **Real Thunderforest tiles.** `pnpm dev` in the sandbox has no `NEXT_PUBLIC_THUNDERFOREST_API_KEY`, so only the OSM fallback branch is exercised here. The keyed Thunderforest "Outdoors" rendering (contours/trail styling, correct attribution string) can only be confirmed once the owner sets the referrer-restricted key in Railway and loads a real GPS route. Because `NEXT_PUBLIC_*` is inlined at **build** time, the key must be present at Railway build, not just runtime.
- **Samsung S25 APK.** The map is loaded via `dynamic({ ssr: false })` and runs inside the Capacitor WebView; tile rendering, safe-area, and the offline fallback message are only authoritatively verified on-device (`docs/device-smoke-checklist.md`). No native/Kotlin code is touched, so no APK rebuild is required — this ships JS-only via Railway into the WebView — but on-device visual confirmation of the new tiles is still the real acceptance check.
- **Referrer restriction.** That the public key is domain/referrer-locked is a provider-dashboard setting, not something any code path can assert.

---

## Self-review (performed)

**1. Spec coverage.**
- Configurable provider defaulting to a running-friendly style → Task 1 (`getTileProvider`, Thunderforest "Outdoors" default) + Task 2 (wired in). ✅
- Thunderforest "Outdoors" as default → Task 1 URL. ✅
- Stadia Maps documented as the alternative → Background § "Alternative provider". ✅
- `NEXT_PUBLIC_*` key handling + public/referrer-restriction note → Task 1 code comment, Task 3 docs. ✅
- Graceful OSM fallback when key absent → Task 1 `if (!apiKey) return OSM_TILES` + test; Task 2 Step 5 dev check. ✅
- Provider-required attribution → Task 1 Thunderforest attribution string (Maps © Thunderforest, Data © OSM). ✅
- Theme tokens not hex / no emoji / keep offline message / keep safe-area → Task 2 changes only the `<TileLayer>`; `Polyline` keeps `var(--color-brand)`; offline branch and safe-area untouched; no color/emoji added. ✅ (Pre-existing `#22c55e`/`#ef4444` `CircleMarker` hex at lines 83-84 is out of scope and left as-is — not gold-plating.)
- SW tile-caching interaction → Background § "Service-worker / offline interaction", explicitly scoped out with the `res.ok` opaque-response reasoning and file:line citations. ✅
- No DB migration → stated in Background. ✅
- Document env var in `.env` example + README → Task 3. ✅

**2. Placeholder scan.** No "TODO", "add validation", "handle edge cases", or "similar to Task N" — every code and command block is concrete. ✅

**3. Type consistency.** `TileProvider { url, attribution }` and `getTileProvider(apiKey?)` are defined in Task 1 and used verbatim in Task 2 (`tiles.attribution`, `tiles.url`). The test in Task 1 asserts the exact same URL strings the implementation returns. ✅
