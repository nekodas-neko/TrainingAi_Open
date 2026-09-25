# LA-139 — four reads trusted one clock anchor where six trusted the series

**Branch:** `lane-a/la139-anchor-consumers` · Lane A · `lib/data/postgres/adapter.ts` only.
**No user-visible change** — the timestamps move by minutes on a noisy series, not in a way any
screen names, so no version bump.

## What was wrong

A clock anchor is one `(ring_ds ↔ utc)` observation. Measured on production 2026-09-25, the table
holds **12,545** of them and **39 of the 40 most recent consecutive pairs disagree by more than 60 s**
about the ring's clock rate — worst **3,359 s**. Three anchors written within **4 real seconds**
carried ring times **~19 minutes apart**. They look stamped per drained batch, so a backfill writes
a pair describing history rather than now.

One pair is therefore a sample of a noisy series. `getOuraClockAnchor` returns exactly one — the
newest by `created_at`.

**The repo already knew this.** `getOuraClockAnchors`' comment states the contract: reads that
convert a ds "resolve it against the observation nearest *that frame*, not the newest", and
`resolveDsToMs` takes a **robust offset** across the epoch rather than trusting any single pair.
Six readers in the adapter use it. Four did not:

| call site | surface |
|---|---|
| `getOuraDaytimeSignals` | **production** — training stress + the temperature series |
| `getOuraBatteryEvents` | battery display |
| `getWorkoutSensorProbe` | diagnostic |
| `getDaytimeTagCoverage` | diagnostic (`/api/oura-ble/daytime-coverage`) |

All four now resolve through the shared helpers, which were **already imported** in this file — so
this is a drop-in, not new arithmetic. The ingest path is deliberately untouched: it uses
`getNewestOuraClockAnchorByUtc`, and its own comment says taking the newest is the intent there.

## A correction to what I said when I filed this

Filing LA-139 during TN-79, I wrote that the anchor inconsistency "is NOT TN-79's cause" and left it
there. The first half holds — the replay in TN-79 used the single newest anchor and still bucketed
1,000+ clean MET samples per day, so it does not *empty* the window. The implication that it was
therefore inert was wrong. A displaced window changes **which Brisbane day** a frame is attributed
to, and training stress is a per-day score. The two findings are adjacent, not unrelated.

## Verification

`tsc` clean · `typecheck:tests` clean (318 / 89, none above baseline) · lint clean · Custom Rules
**78 of 78** · full suite **1,047 files / 9,759 tests, 0 failures**.

The test builds the failure shape directly: five honest anchors agreeing that a ds maps to an
instant, then a sixth written **last** that is an hour out — the backfill shape. The frame must
still land within two minutes of truth; reading the newest alone puts it an hour away.

Mutation pass — **2 mutants, 1 killed, 1 SURVIVED**, plus 1 equivalent control that survived
correctly:

| mutant | outcome |
|---|---|
| revert to the single newest anchor | killed |
| drop the no-anchor early return | **survived — see below** |
| *control:* hoist the timestamps into locals | survived, correctly |

**The survivor is real and I am not dressing it up as equivalent.** Removing the early return does
not change the *output*: with no resolvable epoch the per-frame guard returns null for every row, so
the result is still empty. It changes the **cost** — the read would span the whole frame table
instead of returning immediately, which is DV-13's shape (a heavy admin read that hung production
for eight minutes). A test that sees cost means spying on `readRawFrames`, which is a bigger
apparatus than the guard deserves. Recorded rather than chased.

## Not verified

**No device check, and none is owed** — a server-side read path with no native or offline surface.

**Whether any stored value was actually wrong.** This fixes the reader; it does not restate history,
and nothing here measures how far past days were displaced. That is a separate question and nobody
has asked it yet.
