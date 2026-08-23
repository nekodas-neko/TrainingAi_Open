# 2026-08-23 — heart rate, steps and elevation on the free walk (Q-418, screen half)

**Branch:** `feat/free-activity-metrics` · **Lane B** · v1.339.0

The free-activity screen rendered distance, pace and cadence and **no heart rate at all** — while
the owner's mid-walk screenshot read `120 spm · strap`, meaning the strap was connected and
streaming beats at that moment. The data was already being persisted afterwards
(`done-activity-screen` stores `avgHr`/`maxHr` from `hr-window`), so HR was recorded for these walks
and invisible only *while walking* — the one time it is actionable.

## What shipped

| file | change |
|---|---|
| `components/activity/hr-readout.tsx` | **new** — live bpm with the guided walk's `STALE_MS` guard |
| `components/activity/activity-secondary-metrics.tsx` | **new** — running step total, elevation gained |
| `components/activity/active-activity-screen.tsx` | primary row distance · pace · **HR**; secondary line below |
| `components/guided-walk/walk-active.tsx` | the same step readout |
| `lib/activity/cadence-tracker.ts` | `stepsEstimate` on the snapshot |

**Both readouts are leaves with their own subscriptions**, like `CadenceReadout` beside them. A
strap reports about once a second and this screen renders a route map; putting beats in the screen's
state would re-render the map on every one. That is the repo's own render-discipline rule, and the
existing cadence component's comment says exactly why.

**`stepsEstimate` is derived inside the tracker**, from `summarizeCadence` — the function that
already fills the saved `steps` field (Q-230). A second integration on a screen would be a second
answer to "how far did I walk".

**Steps and elevation are hidden, never zero.** The step total is integrated cadence and is
**strap-only**: with no strap it does not exist, and `0 steps` after forty minutes reads as a broken
counter rather than an absent sensor. Elevation is the same on a flat route.

## Decisions

**Average pace was not added.** It is one of the entry's two *proposed* metrics rather than the two
the owner asked for, and the recommended layout — distance · pace · HR primary, cadence · steps ·
elevation secondary — has no sixth slot. Four `text-2xl` figures fit on 412 px; six do not.

**The guided walk got the step readout in the same PR**, which is Q-410's half of it. The entry is
explicit about why: a metric on one walk screen and not the other is how the free walk became the
forgotten surface to begin with. Q-410 is annotated so its next taker does not redo it.

## One thing worth checking, and checked

`HrReadout` calls `mgr.stop()` on unmount, and the **same strap** feeds the cadence reading on that
screen — so the obvious worry is that leaving the screen kills cadence. It does not:
`ChestStrapSource.stop()` detaches the live relay and **leaves the foreground service running** (its
own comment says so — that service is all-day, torn down only by unmounting the app or unpairing),
and cadence reads the accelerometer through `getPolarBle()` independently of this manager. Recorded
in the component, because the next reader will have the same worry.

## Not verified

**None of this ran on a device, and for this entry that is most of the verification.** Every number
here comes from a Polar H10 over BLE: the sandbox has no strap, so `HrReadout` renders its `--`
placeholder and `stepsEstimate` is null on every path exercised here. What was checked is that the
layout holds and nothing throws; what was *not* checked is the thing the entry is about — that a
connected strap puts a live bpm on that screen. **The staleness guard is likewise untested against a
real dropout.** The APK is the only place to see either.

**The Android pill is untouched and stays open as Lane A.** The background-geolocation plugin's
whole surface is `addWatcher`/`removeWatcher`/`openSettings`; `backgroundMessage` is fixed at
watcher creation, and re-adding the watcher to change the text would restart location tracking
mid-walk. That needs a native addition, which needs an APK.
