# 2026-07-31 — Running carousel desync, active-run safe areas, 30-day heart stats, interval-walk carousel

Branch: `claude/guided-walk-running-bugfix-4sntw5` · v1.248.0

Owner-reported, from four screenshots of the Running/Cardio/Guided-walk surfaces: the run-type
carousel on `/running` didn't match the prescribed-run card below it (screenshot showed "Tempo" in
the carousel next to an "Easy run" card), the active-run screen looked flush against the status bar
and gesture bar, the avg-HR tile on the Cardio home heart card looked high, and Interval walk's
config screen should get the same swipe-carousel UX as the Running screen's run-type picker.

## Fixes

1. **Running carousel/card desync** (`components/running/running-plan-content.tsx`) — the
   carousel-seed `useEffect` guarded on `carouselIndex !== null` so it only ever ran once. The
   screen seeds `data` synchronously from a stale local cache before `refresh()`'s network fetch
   resolves; if the cache held one run type and the fresh fetch resolved a different one (e.g. an
   eased-off "easy" from a gate decision), the carousel had already locked onto the stale value and
   never re-synced, while `PrescribedRunCard` below it always rendered the live value. Removed the
   once-only guard so the effect re-syncs on every `data.prescription` change — `requestSeqRef`
   already protects `data` itself from stale/racy responses, and a user-driven swipe's own
   `applyOverride` response carries the matching type back, so this can't clobber an in-flight
   selection.
2. **Active run screen safe areas** (`components/activity/run-active-screen.tsx`) — top content
   wrapper used a plain `pt-4` instead of `pt-safe` (no status-bar clearance at all), and the
   Pause/Finish button row used `pb-safe-action` instead of the floored `pb-safe-action-lg` this
   navless full-screen takeover flow needs per CLAUDE.md — now matches the sibling
   `DoneActivityScreen`/`PreActivityScreen` pattern.
3. **Cardio home heart stats** (`app/api/cardio-week/route.ts`, `components/cardio/heart-profile-card.tsx`,
   `components/cardio/cardio-content.tsx`) — the AVG figure wasn't wrong (it's the mean of the full
   continuous HR trace over the window — all-day activity, workouts, runs — not a resting-only
   number), but per owner request the card now covers the last 30 days (was 7) and each of
   RESTING/AVG/MAX shows a `+/-N vs last mo.` delta against the rolling prior-30-day window. Resting
   is now averaged from `body_metrics.restingHeartRate` over the current/prior 30-day windows
   directly in the route (falling back to the existing `resolveHrProfile` value when no windowed
   data exists) rather than reusing that resolver's own fixed 28-day window, since that window is
   deliberately caller-independent for zone-boundary stability elsewhere and wasn't touched.
4. **Interval walk carousel** (`components/guided-walk/walk-config.tsx`) — replaced the two stacked
   Standard/Quick buttons with a `SwipeCarousel` + pagination dots matching `RunTypeCarousel`'s
   card styling; the fine-tune Sets/Fast/Slow/Warm-up/Cool-down steppers stay below it. The selected
   slide index is derived from the live `config` on every render (no separate seeded-once carousel
   state), which structurally avoids the same desync class fixed in #1.

## Verified

- `tsc --noEmit` and `pnpm lint` clean on all six touched files.
- Ran the app via `pnpm dev` against the local Postgres (Playwright + the pre-installed Chromium,
  logged in as `test@local.dev`):
  - `/cardio` heart card renders "last 30 days" with RESTING/AVG/MAX tiles; delta line correctly
    omitted when no prior-window data exists in the seed data.
  - Created a running plan, then reproduced the exact bug shape by swiping the carousel to "Tempo"
    — carousel and the "Tempo run" card below it stayed in sync both immediately and across a page
    reload (the original bug only showed up on the stale-cache-then-fresh-fetch race, which this
    exercises).
  - Navigated through to the active run screen (`/activity` → Start) and confirmed computed styles:
    `pt-safe` resolves to 16px, `pb-safe-action-lg` resolves to 64px (both correct given the web
    sandbox's `env(safe-area-inset-*)` reports 0 — see the on-device caveat below).
  - `/activity/guided-walk` shows the new Standard/Quick swipe carousel with pagination dots, steppers
    intact below it.
  - No console errors traceable to these changes across all of the above; the only errors seen were
    pre-existing `/api/oura/sync` 400s (no Oura PAT configured for the seed user), unrelated.

## Not verified

- **The S25 APK / on-device safe-area rendering.** The web sandbox reports `env(safe-area-inset-*)`
  as 0, so the actual notch/gesture-bar clearance on item 2 has not been seen on a real device —
  only that the CSS classes resolve to the expected floored values.
- **A real multi-day HR history** for the 30-day/prior-30-day delta on item 3 — the local seed data
  doesn't span 60 days, so the delta path renders (`null` → hidden) but a populated `+/-N` delta has
  not been visually checked against real Oura data.
