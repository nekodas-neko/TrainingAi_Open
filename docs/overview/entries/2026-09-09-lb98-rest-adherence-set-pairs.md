# 2026-09-09 — a read path for data that only existed on the device (LB-98)

**PR:** `lane-a/lb98-rest-adherence-set-pairs` · **Lane A** · no migration, no client change.

## What the gap actually was

Not a product bug. `set_logs.planned_rest_sec` is the snapshot of what the plan asked when a set was
logged, it lives in the device's local store, and **no route published it**. The canonical runtime is
the APK, where the store is present and the Rest-vs-plan card works. What was lost is *verification*:
in a browser — and therefore in CI — the card could only ever render its empty state, so its
rendering path shipped unexercised and arrived owing a device check. LB-98 was filed after that
happened twice in one session on unrelated features.

`/api/health-trends?view=rest-adherence` now returns `restSets`: per-set
`{ plannedRestSec, restTimeSec }`, shaped as the card's own `RestSet` so its fallback is a swap into
the same `restByPrescription` rather than a second aggregate that could disagree.

## The distinction that took the most care

**The pairs are the LOGGED columns; the buckets in the same response are not.** The correlation
derives `prescribedRestSec` from `listProgressionStyles(userId)` — the style as it is *now*. The card
deliberately reads the snapshot, because *"a later style edit would silently rewrite what
'prescribed' meant for a past set"* (its own comment).

Emitting the live-style value would have looked consistent with the bars beside it and answered the
wrong question. Mutation-pinned: swapping the logged read for the live style is caught.

That the two halves of one response now come from two sources is a real finding, so it is filed as
**LA-95** rather than fixed here — changing the bars moves numbers the owner already reads, which
makes it a decision rather than a tidy-up.

## Small rules, each with a reason

- A prescription of **0** is dropped: "no rest planned" is not a target, and dividing by it is how a
  ratio becomes Infinity.
- A rest **taken** of 0 is kept: that is a real measurement (the set that ran straight into the
  next), and discarding it biases the mean upward — the opposite of what the card reports.
- Only sets carrying both halves are emitted. `restByPrescription` discards the others anyway, so
  sending them is payload for nothing, and a half-pair reaching that helper looks like a measurement.

## Measured rather than assumed

Production, while building: of 1,189 set logs, **462** carry `planned_rest_sec`, **838** carry
`rest_time_sec`, **442** carry both — all inside the route's 90-day window (841 sets). So the column
started being written recently and covers ~53% of the window. Worth publishing; nowhere near safe to
assume present.

Worth noting that the local seed has **27 set logs and zero of either column**, so the realistic case
could not have been checked locally at all — which is the very gap this entry is about, met while
closing it.

## Verification, and a correction to my own mutation run

Five real mutants, all caught (half-pairs, zero prescription kept, zero rest-taken dropped, live
style substituted for the logged snapshot, field never emitted).

The control — renaming a local accumulator — first reported CAUGHT, which would have meant the tests
were failing on something with no behavioural difference. Reproducing it by hand shows it **survives**
cleanly: the harness had mis-applied the rename. A control that fails to build proves nothing, so it
was worth the minute to tell those two apart rather than recording a number that looked stricter.

## A local-environment trap this session created for itself

The first full run on this branch reported **7 failures across 4 files** — none of them LB-98's. The
local database still carried Q-44's table rename (migrations 273/274, applied to verify that branch),
so it matched no branch's code: `main`'s export map and catalogue reads name tables the database had
renamed underneath them.

**The tell was the shape rather than the count.** This branch's own tests passed 46/46 while
unrelated export and catalogue tests failed — a failure set that carefully avoids the thing you
changed is evidence about the environment. Read the other way, it costs a rework of code that was
fine. Reverting also needed an order (`DROP SCHEMA claude_ro CASCADE` first, because the `claude_ro`
views depend on the compatibility views). Both are now in
[`docs/local-dev-database.md`](../../local-dev-database.md), which already catalogues two other ways
a local result can lie.

**Not exercised:** the card itself. Wiring its fallback is `components/**` and therefore Lane B's;
the read exists, nothing consumes it yet, and the verification gap is not closed until that lands.
That is recorded as a `Keep:` on the entry rather than implied.
