# 2026-08-05 — Q-65: PiP kept the rest countdown, and two backlog items closed without code

**Domain:** workouts · app-shell · platform — v1.257.1, JS-only (no APK rebuild)

## Q-65 — the PiP window went blank at exactly the wrong moment

The last set of an exercise still earns a rest period. Since 2026-07-28 the separate "all sets
logged, tap Complete" hold screen is gone and the **summary screen doubles as the rest screen** —
`ExerciseSummaryScreen` renders `LastSetRestTimer`, a live countdown anchored on
`lastSetRestStartMs`.

The picture-in-picture branch for that same mode never got the memo. `workout-screen.tsx` rendered
a static card:

```
Done
<exercise name>
Tap Next to continue
```

It read neither `lastSetRestStartMs` nor `lastSetRestSec`. So backgrounding the app during that
rest — the single moment the floating window is most useful — lost the countdown entirely, while
the `mode === "active"` branch immediately below it had been solving this correctly all along via
`PipView`.

Fixed by routing the summary branch through the same `PipView`, with `workoutPhase="rest"` and the
identical two inputs the on-screen timer uses: `currentRestSec` (already
`effectiveRestSec(store.lastSetRestSec)` in the orchestrator) and `store.lastSetRestStartMs`.
`currentSet >= sets` is the entry condition for summary mode, and `PipView` already renders that as
`done` rather than `rest · n/m`, so the label stays honest. The static placeholder is kept for the
one case where there is genuinely nothing to count — after `advance()` clears the anchor.

### What was not exercised, and why it could not be

**The PiP branch is unreachable outside the APK, by construction.** `usePipMode()` flips on a
`pipModeChanged` window event, and `grep -rn pipModeChanged` finds exactly one dispatcher:
`android/app/src/main/java/com/trainingai/app/MainActivity.java:578`. There is no web path that
sets it. So this is not a case of not driving the browser far enough — no amount of `pnpm dev`
reaches it.

The change was verified by reading rather than running: both inputs are the same fields
`LastSetRestTimer` subscribes to, and `PipView` is the component the sibling branch already ships.
Typecheck and lint are clean; the full suite passes (one DB-pool flake,
`oura-ble-sleep-staging-rollup`, which passes alone — the documented pattern).

**On-device check:** start an exercise, log its last set to land on the summary screen while the
rest ring is counting, then background the app into PiP. The floating window should show the same
countdown ring — filling to the target, then red and counting `+overtime` — instead of "Done / tap
Next".

### Sandbox observation, unexplained: a set cannot be logged in `pnpm dev`

Driving the workout flow in headless Chromium got as far as the active screen (Start Workout →
confirm → Begin Exercises → Start Set 1) and then stalled: the **Log Set** button is enabled,
visible, and clicks without error, but the label never advances and **no `/api/log-exercise`
request is made**. Twelve attempts, no page errors. Recorded as an observation, not a diagnosis —
it was not chased to root cause, and the owner logs sets on device every day, so this is most
likely a sandbox limitation rather than a product fault. It does mean the workout-logging path is
not currently drivable end-to-end in the browser harness, which is worth knowing before planning to
verify anything downstream of a logged set that way.

## Q-70 — closed as refuted, not deferred

Removed from the backlog on the strength of the owner's second device capture:
`/workout?session` measured four times, **median 115.4 ms, warm 4 / cold 0**. There is no cold RSC
payload fetch on that navigation, so prefetching the session list cannot remove one. The item's
premise is measured false. Evidence:
[`2026-08-05-navigation-measured-on-device.md`](2026-08-05-navigation-measured-on-device.md).

## Q-74 — done: `error_events` joins the session-start read

`CLAUDE.md`'s session-start orientation now includes an `error_events` read, with the admin-endpoint
query inline. The reason it matters is the shape of the failure: the table prunes at 30 days, and
the first read of it (2026-08-04) found three faults of which **two had already stopped before
anyone looked**. A fault that heals itself leaves no trace, which is the same trap as Q-56's
self-healing future-dated rows. The instruction carries the rule that goes with it — *something
that stopped is not something that was fixed*; record it as unexplained rather than closed.

The item's optional second half — keeping a rolled-up per-(url, message) count past the prune
window — was **deliberately not built**. Nothing has yet needed a fault older than 30 days, and a
new aggregate table is not free on a database whose growth is the binding constraint on this
project. Noted in the backlog sweep so it can be re-raised if a pruned fault is ever actually
missed.
