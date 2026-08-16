# 2026-08-05 — Sleep list/detail/card bedtime no longer folds in onset latency

**Domain:** sleep — v1.266.2, JS-only (no APK rebuild)

## The report

Owner: sleep times on the Sleep detail sheet look pushed back — typical bedtime is 10-10:30pm, but
the list showed later times.

## Root cause (Q-101)

Not a data bug — `sleep_start` is correctly populated on both Cloud and BLE nights. Three surfaces
(`health-metric-sheet.tsx`'s list rows and detail header, `sleep-card.tsx`) called
`actualSleepWindow(r).start` instead of the raw `sleepStart`. That function re-derives "the first
non-awake 5-min hypnogram epoch" as an onset-trimmed start time, by design — it isn't reading
`onset_latency_sec` directly, it's independently recomputing the same quantity the BLE ingest
pipeline already stores, which is why the displayed time matched `sleep_start + onset_latency_sec`
to the minute across the last 8 production nights.

Two other surfaces already had this right: the Hypnogram ribbon and the day-timeline "Fell asleep"
card both show raw `sleepStart` with latency called out as a separate `"N min latency"` subtitle —
the pattern that matches how the owner reads "bedtime." This was a sibling-surface inconsistency,
not an isolated bug: 3 surfaces disagreed with 2 others about what "bedtime" means.

## The fix

Standardized the three disagreeing sites on the already-correct pattern:

- Range **start** is now the raw `sleepStart` at all three sites.
- Range **end** still comes from `actualSleepWindow()` — its end-time correction is unrelated to the
  bedtime bug (the ring's phase string is padded up to a whole 5-min epoch at build time, so the raw
  end can overshoot the real wake time by up to ~5 min) and is still wanted.
- Onset latency is now surfaced separately, matching the "Fell asleep · N min latency" pattern:
  `sleep-card.tsx` already had an "↓ Nm onset" badge, so nothing changed there; the list row and
  detail header in `health-metric-sheet.tsx` had no separate latency text at all, so both now append
  `· Nm latency` next to the time range when `onsetLatencySec` is present.

`actualSleepWindow()` itself is unchanged — kept for its end-time correction, per the plan's own
note to decide during implementation rather than delete it outright.

## Verification

Typecheck and lint clean on the touched files. `lib/sleep/actual-window.ts`'s own unit tests are
untouched and still pass (the helper's behaviour didn't change, only which of its fields the three
call sites read). Seeded a local session with a 20-minute onset latency and a hypnogram with four
leading awake epochs, then ran the exact fixed display logic (`actualSleepWindow` + the real
`formatTimeOfDay`) against it via a scratch test: the old logic would have shown a bedtime 20
minutes later than `sleepStart`; the fixed logic matches `sleepStart` exactly. The scratch test was
not committed — it existed only to exercise the real formatting function end-to-end before removing
it.

**Not exercised:** no on-device/native surface — this is a display-only change to React components
already covered by the standard web dev-server render path.
