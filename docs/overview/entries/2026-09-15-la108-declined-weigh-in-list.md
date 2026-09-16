# 2026-09-15 — LA-108: the residue *was* the work

**Branch:** `feat/la108-declined-weigh-in-list` · **Lane B**

LA-108 printed under **KEEP** — *"shipped; only the stated residue is owed. Not new work."* Its
residue read *"the list, and only the list"*, which is a buildable UI task with a lane, a file and
three implementation notes. It had been sitting there since 2026-09-14 while READY held two
device-blocked entries and the lane looked empty.

Found by reading the Keeps whole rather than trusting the section header — which is the thing my own
baton says to do and which I had not been doing.

## Why it mattered

The weight band anchors on the last **confirmed** weight, and only a confirmed reading moves it.

So an accidental *Not me* tap was **irreversible**. A genuine change beyond
`SCALE_WEIGHT_ANOMALY_PCT` — a long gap plus an illness or an injury — put the owner outside his own
band with nothing able to move it, and **every** reading after that was outside too. Silent, and
self-sustaining.

This predates BF-58 rather than being caused by it. BF-58 made the state reachable without a tap,
which is what made it worth finding.

## What shipped

A **Declined weigh-ins** list under the pending section in `scale-pairing.tsx`, each row claimable
through **the same `POST /api/scale-ble/pending/<id>/confirm`** the pending rows use.

That sameness is the design, not a shortcut: the engine half widened `confirmScaleSample` to match
`pending` **or** `dismissed` — never `confirmed`, so claiming twice cannot double-apply — and the
route already files the weight against the reading's own `measuredAt` and re-anchors the band. There
is deliberately no second write path to keep in step. Claiming fires the Q-126 invalidation pair
before the refetch, for the same reason confirming does.

**All three of the entry's notes were followed, and each is pinned by a test:**

- **Server order preserved, no sort.** Newest-first is deliberate: in the lockout this exists for, the
  readings at the top *are* the wrongly-declined ones, because the scale is mostly his.
- **A `weightKg: null` row still lists.** A frame that would not decode is archived too.
- **No dismiss action.** These are already dismissed; the only move is to claim one back.

## One addition beyond the spec

Each row shows its time, via `formatTimeOfDay(r.measuredAt, userTz)`.

A pending reading is "just now"; a declined one can be days old, so without the time you cannot tell
which row you are claiming. The user's timezone, never the device's — `formatTimeOfDay` is the one
place that decides how a clock time renders here.

## The test that passed for the wrong reason

Four of the five assertions failed against `main` immediately. The fifth — *"offers no dismiss
action"* — passed.

It was a `.not.toMatch` over `src.slice(src.indexOf('dismissed.length > 0'))`, and `indexOf` returns
−1 when the section does not exist, so `slice(-1)` handed it the last character of the file. A
negative assertion over almost-nothing passes every time.

It now asserts the section is present first, and that it actually offers the claim. **5 of 5 fail
against `main`.**

## Not exercised

**No device pass**, and the BLE scale is not reachable from the sandbox — the list was driven from the
route's shape rather than from a real declined reading. On the S25: decline a weigh-in, confirm it
appears under **Declined weigh-ins** with its time, claim it back, and confirm the weight files and
the band re-anchors. Kept as LA-108's `Keep:`.
