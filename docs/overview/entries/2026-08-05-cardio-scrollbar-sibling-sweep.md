# 2026-08-05 — Hidden scrollbar chrome on cardio and its siblings, plus a duplicate utility cleanup

**Domain:** cardio · app-shell — v1.266.3, JS/CSS-only (no APK rebuild)

## The report

Owner: a visible scrollbar shows on the right edge of the cardio page.

## Root cause (Q-100)

`components/cardio/cardio-content.tsx`'s main scroll container was a bare `overflow-y-auto` div
with no scrollbar-hiding utility. The app already had one — in fact **two**, `.scrollbar-hide`
(`app/globals.css`, `@layer utilities`) and `.no-scrollbar` (plain global rule), functionally
identical, applied at only two call sites app-wide (`admin-content.tsx`, `components/ui/weight-dial.tsx`).

## Sibling-surface sweep

Per the plan's own flag that this was likely broader than cardio, grepped every top-level scroll
root for the same bare pattern:

- **Raw `overflow-y-auto` divs with no hide utility:** `cardio-content.tsx`,
  `year-review-content.tsx` (a full-bleed `snap-y` scroll-snap screen — visible scrollbar chrome
  would be especially out of place here), `stats-content.tsx` (both its main scroll root and its
  day-detail bottom sheet), `nutrition-content.tsx` (both its main scroll root and its settings
  sheet). All six now carry `scrollbar-hide`.
- **A shared component the plan's grep missed:** `more-content.tsx`, `session-select-content.tsx`
  and `health-content.tsx` don't render their own scroll container — they pass a `scrollClassName`
  prop into `components/pull-to-sync.tsx`, which renders the actual scrollable div. Fixed once,
  centrally, in `pull-to-sync.tsx` itself rather than patching three callers' class strings —
  closes all three sites in one place and any future `PullToSync` consumer inherits the fix for
  free.

## Cleanup

Consolidated the two near-identical utilities onto `.scrollbar-hide` (the one properly scoped in
`@layer utilities`) and deleted `.no-scrollbar`, updating its one call site
(`admin-content.tsx`). Low-risk — same effect, same rule contents.

## Verification

Typecheck and lint clean on every touched file (two pre-existing, unrelated `exhaustive-deps`
warnings in `stats-content.tsx`/`nutrition-content.tsx` reproduce on `main`, confirmed by diff
line count). Full suite: 400 files / 3,171 tests, all green.

Confirmed the actual mechanism end-to-end against `pnpm dev`, authenticated: `cardio-content.tsx`
SSRs directly and its rendered HTML carries `scrollbar-hide` in the class list. The home tab
(`session-select-content.tsx`, via `PullToSync`) also SSRs and confirms the shared-component fix:
`class="flex-1 overflow-y-auto overflow-x-hidden pb-nav-safe scrollbar-hide"`. `year-review`,
`stats`, `nutrition`, `more` and `health` are client-only dynamically-loaded tab screens (per the
app's own documented pattern) and don't appear in raw SSR output at all — their edits are the
identical, syntactically-verified mechanical change, extended with confidence from the two
independently-proven patterns (a raw div, and the shared `PullToSync` wrapper) rather than
separately screenshotted.

**Not exercised:** no on-device/native confirmation that the *reported* bug (a visible native
scrollbar, whose chrome can render differently in a WebView than the sandbox) is actually gone —
CLAUDE.md flags this as one of the surfaces that needs on-device confirmation. The fix itself is
inert and side-effect-free wherever a screen never showed a scrollbar in the first place, so there
is no downside if a sibling turns out not to have been affected.
