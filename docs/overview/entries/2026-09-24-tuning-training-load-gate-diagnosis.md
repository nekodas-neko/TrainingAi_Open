# 2026-09-24 — Q-270's route is not silent, it is failing with a reason

Tuning session, fourth entry of the day. Docs-only: one backlog entry, no product code.

## Why I was looking

The day's three findings (TN-76, TN-77, TN-78) all turned out to be symptoms of Q-204 — direction B,
chosen by the owner on 2026-08-11, which replaces `zoneMinutes` and the dead `activeEnergy` with one
physiologically-grounded contributor. So the useful question stopped being "what else is wrong with
the Activity Score" and became "is Q-204 startable". It is not: it carries `Needs: Q-270`, and Q-270
has been 🔴 and unexplained for five weeks.

## What the measurement found

Q-270's title says the route is *"neither failing nor succeeding"*. That is no longer true.
`training_load_ots` is still NULL on all 110 days, but **`training_load_gate` is populated on 21** —
every day from 2026-09-05 to 2026-09-25, all reading **`insufficient_met`**. The route runs, reaches
its gate, and persists. The 2026-08-15 warm-once-per-launch fix took, and Q-204's "the persist is
unverified" caveat is answered.

**And the gate fires on days whose data satisfies it.** Measured from the stored tag-`0x50` frames,
seven of the nine days in the hot window clear both floors with room — span 1,342–1,417 minutes
against a floor of 720, and roughly 880–1,190 MET values against a floor of 360. The two that fail
are the partial days at the window's edges, which is expected.

So the loss sits between `oura_raw_samples` and `computeTrainingStress`, not in data availability.
That is the narrowing: Q-270 can stop asking whether the producer runs.

## Two candidates ruled out, one new question opened

The `0x50` decoder exists and looks correct. The clock-anchor window does overlap the real frames on
all nine days, so it is not obviously the cause.

But checking the anchor turned up something else: **the anchor set is not self-consistent.** Five
anchors written within 8 seconds of wall-clock time carry `anchor_ds` values spanning about 25 minutes
of ring time, so at most one is a true `(ds ↔ utc)` pairing and the rest pair a ring timestamp with
its ingest instant. `getOuraClockAnchor` takes newest-by-`created_at`, and with that one the computed
day window sits 48–97 minutes later than the day's actual frame range. It still overlaps, so it is
not the gate's cause — but a day window off by up to 1.6 hours is wrong on its own terms. Left inside
TN-79 rather than filed separately, because the right anchor-selection rule is a judgement about the
ingest contract, not a measurement.

## Honest limit

**I did not run the route, so I have not found the cause.** The entry says so plainly and names the
one log line that would separate "the frames never arrive" from "they arrive and the grid collapses" —
and says explicitly not to lower the 720/360 thresholds to make the gate pass, which would fabricate
a load score from a series nobody has shown is complete.

## Not exercised

Docs-only; nothing ran. MET value counts are estimated from `body_hex` length rather than by running
the decoder — close, not exact, and the margin over the floor is wide enough that it does not matter.
Only the 9 days the hot window holds were measured; older days live in `oura_raw_packed` and were not,
so the 21-day gate run is only partly explained here. One user, one ring.
