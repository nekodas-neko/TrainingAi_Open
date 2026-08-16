## 2026-07-21 — QA round 2: health visual refinements (v1.195.2)

**Branch:** `fix/qa-round-2` — the polish items the owner flagged in the same on-device QA pass that
produced the round-1 P0 fixes (#724). All four are UI-only changes to already-shipped features.

- **Trends pill-swipe vs tab-swipe gesture conflict.** Swiping the Trends filter pills horizontally
  also dragged the Body/Training/Progress carousel. `SwipeCarousel` (`components/ui/swipe-carousel.tsx`)
  now inspects the drag's start target on the first event: if it began inside a descendant that
  scrolls horizontally on its own (computed `overflow-x: auto/scroll` with `scrollWidth > clientWidth`),
  it `cancel()`s the drag so the inner strip scrolls without flipping the tab — the general
  "exclude scrollable ancestors" rule from CLAUDE.md, not a tagged-carousel special case. The pill
  strip also gets `touch-pan-x` so its native scroll survives the carousel root's `touch-action: pan-y`.
- **Body Battery "how it moves" → diagram.** Replaced the four-line prose list in
  `components/body-battery-card.tsx` with an icon-driven layout: a Sunrise anchor line ("opens at your
  Readiness") over two columns — green **Recharges** (deep sleep, calm rest) and red **Drains**
  (training, high HR, daytime stress).
- **Training Load monotony meter.** `components/health/training-load-card.tsx` now renders monotony as
  a zoned meter (green <1.5 / amber 1.5–2 / red >2, marker at value on a 0–2.5 track, "varied →
  monotonous") with the weekly-strain figure beneath, instead of a bare `Monotony 1.37 · Strain …`
  line. Explainer trimmed to one sentence.
- **Heart & Recovery cohesion.** Wrapped the RHR/HRV/SpO₂ tiles and the "vs your recent days" range
  box into a single bordered/tinted panel (`components/health/body-cards/rhr-hrv-spo2-card.tsx`) so
  they read as one section; the range box lost its separate border in favour of a top divider.

### Verification
- `pnpm exec tsc --noEmit`, `eslint` on the 5 changed files (0 errors), `pnpm build` — green.
  Rebased onto `main` after #724 landed (which also carried the migrations-test v16→v17 fix below).
- `pnpm dev` starts clean (no render errors in the log); `/health` returns its auth redirect as
  expected for an unauthenticated request. These are S25-WebView touch/gesture changes — **not
  verified on device** (the sandbox renders touch-action/insets as no-ops). The Trends gesture fix
  in particular needs the on-device smoke run (`docs/device-smoke-checklist.md`).

### Also fixed here (unblocking): red `main`
`main` was failing the Tests check: #723 bumped the local SQLite schema to v17 (the Oura
raw-on-device `oura_bucket` + daily summary/derived + heartrate tables) but left
`lib/sqlite/__tests__/migrations.test.ts` asserting v16. Updated the assertion to 17 and added a v17
table check. Shipped in #724 (round-1) since that was the branch on the critical path; noted here for
the record.

### Still open (owner QA notes)
- **Activity detail** (stress/recovery + score ranking): the deployed screen already shows "What drives
  your activity score" (Movement/Training split) and Stress/Recovery tiles — they read 0 min only
  because there's no Oura daytime-stress data, not a UI gap. Left as-is pending owner confirmation.
- Awaiting owner detail: muscle-card "Body still at the bottom" (which tab), and "More paints instantly".
