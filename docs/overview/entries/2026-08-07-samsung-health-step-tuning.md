# 2026-08-07 — Samsung Health step-count question; found a ring-clock compression bug

**Domain:** activity (also devices, platform) — docs-only, no version bump (nothing user-visible changed)

## The report

The owner sent two screenshots taken a minute apart at ~21:49: the app reading **4,176** steps, the
Samsung Health phone reading **3,376**. They said they were happy to accept the difference and asked
whether any tuning could make it match, and to read today's steps and see.

## The answer to the question asked: no tuning is warranted

2026-08-07's steps are **100 % `step_counter` over ring frames** —
`body_metrics.source_map->>'steps'` is `oura_ble`, and `step_live_windows` has held no row since
2026-07-28, so no phone or Health Connect value is in the mix. A finger-worn sensor counting more
than a pocketed phone is the expected direction, and correcting the clock (below) moves the two
*further* apart, not closer. A scale factor would be fitting a fudge to one day of paired data.

## What the investigation found instead

Replaying the rollup's own `computeStepsByDay` over production's anchors and frames reproduces the
stored number exactly — **4,178 computed against 4,176 stored** — so the pipeline could be examined
directly rather than guessed at. Three of the day's 60-second step windows were physically
impossible: **1,555**, 664 and 268 steps. The top one is 26 steps per second.

The cause is in `resolveDsToMs` (`lib/oura-ble/clock.ts:70`). A clock anchor is `(batch max ds,
server receive time)`, so its lag is however long that batch took to arrive; measured over the day's
ds range that lag spans **56.2 minutes**, with a sharp lower edge and a long tail. The function
interpolates linearly between bracketing anchors, applying a local time-scale of `Δutc / Δds` — and
while the ring drains buffered history, ds outruns the wall clock and that ratio collapses. Worst
case measured: **28.5 minutes of ring time squeezed into 95 seconds** (~18×). `resampleSteps` then
folds every window landing in the same 60-second block into that block.

It is not a one-off: crowding appears at 10:41, 11:42, 14:01 and 17:11 on the same day, where a
60-second block should hold two paired windows and instead holds 70, 79, 66 and 60.

Re-running with a physically correct clock (ds ticks at exactly 100 ms; offset = the minimum
observed lag) gives **zero** implausible windows and moves 2026-08-07 from 4,178 → 4,652 and
2026-08-06 from 1,232 → 1,245. The distortion is to *placement*, not really to totals.

## Blast radius — corrected mid-session

The first draft of the write-up claimed a fix would move sleep boundaries and HR bins. It will not,
and the correction matters because it makes the fix far smaller than first stated. `resolveDsToMs`
is used only by `step-day-buckets.ts` (the steps rollup write and `previewStepsBackfill`) and the
admin step-counter console. Sleep, HR and temperature go through `measuredAtMs`, whose fixed
100 ms/ds slope carries Q-71's offset error but structurally cannot compress.

## What landed

Documentation only — three markdown files, no code, no behaviour change:

- `projectOverview.md` — a Known-Issues row for **Q-139**.
- `docs/implementation-backlog.md` — **Q-139** as a decision-ready entry (what it fixes, what it
  explicitly does not, the cost of leaving it, three options with trade-offs, implementation
  direction), plus a re-scope of **Q-71**, which as written would trade its own offset error for this
  compression error on the paths it is trying to protect. Next-free-Q bumped to 140.
- `docs/domains/activity/README.md` — Q-139 summary and a link to the handoff.
- `docs/handoff-2026-08-07-activity-ring-clock-compression.md` — the full investigation, including
  the measurement traps.

Q-139 was renumbered from Q-117 mid-session: the parallel full-app review (#1127) claimed 117–138 on
`main` while this was in flight. That review was checked and does not cover this finding.

## Also recorded

The rollup recomputes a **35-day** window but its write guard is monotonic
(`mergedSteps > existingSteps`), so a clock fix is **not** "future days only" — recent days would
drift upward wherever the corrected number is higher, while days that should come down stay inflated
without an owner-gated `allowStepsDecrease` pass. Both measured days moved up.

A sibling gap worth folding into the same fix: `mergeStepCounterWithLive` applies
`isPlausibleStepWindow` to **live** windows only, so model windows are unfiltered — which is what let
the three impossible windows reach the daily total.

## Verification / what was NOT exercised

- **No code changed**, so no build, no tests, no `pnpm dev` run. The temporary vitest file used to
  replay the pipeline was deleted before committing.
- **Server-side analysis only.** Production frames replayed through the real pipeline in the sandbox.
  **Nothing was checked on the S25** — no device, native-SQLite, safe-area or WebView path was
  exercised, and none is affected by a docs-only change.
- **Only two days were measured** (2026-08-06 and 2026-08-07). The drift across the full 35-day
  window is unknown. An early reading that suggested 2026-08-05 was inflated was an artefact of a
  partial-day ds window and is **not** a finding.
- **Nothing is fixed.** Q-139 is open and blocked on an owner decision.
