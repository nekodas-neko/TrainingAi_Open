# 2026-07-26 — Cardiovascular Hub — Phase 1 (IA split + quota dashboard)

Branch: `feat/cardio-hub-phase-1` · v1.212.0

## Why

Owner-directed redesign of the running/cardio system, worked through a design brief, a grilling
session (14 decisions, D-1–D-14) and an iterated interactive mockup — see
`docs/superpowers/specs/2026-07-26-running-system-redesign-brief.md` and
`docs/superpowers/specs/2026-07-26-cardio-system-spec.md`. Phase 1 is the first of six planned
stages, queued in `docs/implementation-backlog.md`:
`docs/superpowers/plans/2026-07-26-cardio-hub-phase-1.md`.

The core idea (spec D-9): the week is a **per-zone HR-minute quota + step quota**, filled
opportunistically by whatever activity the user chooses — not a calendar. Running keeps its own
separate goal/progression (untouched this phase); walk and other-activity are metric
contributors only (spec D-1, revised).

## What shipped

- **`lib/health/zone-quota.ts`** — pure `computeZoneQuota(targets, days)` subtracts accumulated
  zone-seconds from the framework's weekly targets, and `weekWindow(todayIso, weekStartIso)` for
  the inclusive local-week boundary. Zone 1 is excluded from the `training*` totals (spec D-10)
  since it fills from ordinary daily movement rather than deliberate training — 7 unit tests.
- **`GET /api/cardio-week`** — assembles the observed HR profile (`resolveHrProfile` +
  `computeObservedHr`), the per-zone quota (`weeklyZoneTargets` shaped by the active running
  plan's framework, sized by a resolved `FitnessSnapshot`'s `weeklyBaseMinutes`), and step
  progress (`getDailyGoals`). Weight for the goals calc is resolved from a 28-day body-metrics
  window (mirrors the existing pattern in `readiness-score/route.ts`) rather than the narrower
  week window used for step totals, since weight isn't logged daily.
- **`/cardio` page** — `HeartProfileCard`, `ZoneQuotaCard` (done/target/remaining bars, Z1 shown
  complete-but-excluded with the reasoning stated inline), `StepsQuotaCard`, `ModalityPicker`
  (Run/Guided walk/Other activity — only Run carries a "Program" badge). Cache-seeded via
  `cachedFetchToday`/`readTodayCacheSync` for instant repeat-visit paint.
- **Cache invalidation** — `cardio-week` registered in `invalidateActivityWrites`,
  `invalidateWorkoutSummaries`, `invalidateBiometrics`, `invalidateOuraSync` (every write that
  moves the quota).
- **Workout screen restructured**: the flat "Run" + "Log Activity" button row
  (`workout-select-content.tsx`) is now a single "Other Activity" door to `/cardio`. Removed
  `logActivityOpen` state and the `LogActivitySheet` mount (it now lives inside the hub).

No migration, no native code, no new sync domain — the quota is a server-derived read, matching
the plan's scoping (both halves — targets and actuals — already existed).

## Bug caught before it shipped

The design mockup's zone progress bars rendered at zero height: the fill was an inline `<span>`
inside a track that lost its `display:flex` between mockup iterations, and an inline element
ignores `width`/`height`. Caught by the owner reviewing a live screenshot, not by review of the
code. The real component (`ZoneQuotaCard`) sets `flex` on the track explicitly, with an inline
comment naming the failure mode so it can't regress silently. Verified in a real Chromium render
(Playwright, `/opt/pw-browsers`) — measured a 328×14px track and confirmed an injected 68% fill
renders at 223px (223/328 = 0.68, exact), not just "some bar showing."

## Backlog reconciliation (found while reviewing for duplication)

Checking for overlap with the still-open guided-walk-uplift batch (2026-07-23) surfaced one real
contradiction and two overlaps, corrected in both `docs/implementation-backlog.md` and the
`2026-07-23-guided-walk-uplift.md` plan itself (struck, not deleted, with the reasoning inline):

- **Phase F's "records to beat"** (walk-specific PRs) is superseded by spec D-1 — walks don't
  progress or carry records; only running does.
- **`feat/guided-walk-gps` and Phase C** (walk-specific GPS/HR-chart work) overlap with this
  batch's items 3/5 (a shared visual system + execution screen across run/walk/activity) — a
  note flags "check the cardio batch first" rather than risking a rebuild.
- Phase D (native Android chip) and Phase E (reactive nudges) are unaffected.

Separately, **the cardio batch's own item 6 (Polar PMD cadence) turned out to already be
shipped** — PR #790 landed the full native cadence build (`lib/health/cadence.ts`, Polar
GATT/DSP work, migration 140, the cadence readout UI, an admin calibration console) while this
plan was being written and implemented. Both the spec (D-4) and the backlog row are corrected
with a struck historical record rather than silently deleted, per the same discipline.

## Verification

- `tsc` clean · lint 0 errors (112 pre-existing warnings, none in touched files) ·
  **2051 tests pass** (7 new) · `check-push-mutations: OK` · `next build` clean (run in
  isolation after a `.next`-directory collision with a concurrently-running dev server produced
  a false-positive 500 the first time — not a code issue, a shared-output-folder artifact).
- **Dev-server exercised end-to-end** on the local seeded DB: `/api/cardio-week` 200 with all 5
  zones present, Z5 correctly `not-required` (the seed's `zone2-base` framework weights it at
  zero), Z2 correctly `targetMin=108, remainingMin=108` with no HR data yet. `/cardio`, `/running`,
  `/activity/guided-walk`, `/workout-select` all 200.
- **Playwright at 390×844**: real login, screenshot of the rendered hub, and a DOM measurement
  proving the zone-bar fill scales with percentage (see the bug note above). Confirmed the
  restructured "Other Activity" button on `/workout-select` real-navigates to `/cardio` via an
  actual click, not just a route-exists check.

## Not verified

- **On-device (S25 APK).** Safe-area clearance on the new `/cardio` screen (uses `pt-safe` /
  `pb-safe-action`, both pre-existing floored utilities, but unconfirmed on-device) and the
  Samsung WebView paint of the zone bars are unconfirmed — the sandbox render is a real Chromium
  browser, not the canonical APK WebView.
- **Real zone data.** The local seed has no `oura_heartrate` rows, so every zone shows
  `doneMin: 0`. The quota math is unit-tested and the scaling behaviour was proven by directly
  injecting a percentage into the live DOM (see above), but a genuinely non-zero quota from real
  ring/strap wear has not been observed.
- **A real running plan's `weeklyBaseMinutes`.** The seed user has no active running plan, so the
  quota's size always falls back to the framework default (`zone2-base`, 150 min floor) rather
  than a plan-derived personalised volume. The fallback path is exercised; the plan-driven path
  is not.
