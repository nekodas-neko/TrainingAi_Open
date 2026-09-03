# What switching ACWR to the uncoupled EWMA would actually change

**2026-09-03 · Lane A · Q-279 · read-only production (`claude_ro`, row-scoped to the owner)**

Q-279 proposes switching `computeVolumeAcwr` from the coupled ratio to the uncoupled EWMA
formulation, and calls it *"a contained change to one shared function with an existing test suite"*.
That is true of the code. It is not the whole question: ACWR drives two user-facing behaviours, so
the standing rule applies — **a proposal is incomplete until it states how many other days the change
moves.** This measures that, over the owner's real training history, before any code is written.

## Premise check, and one refinement to the entry

The entry describes *"the naive 7:28 acute:chronic ratio"*. What the code does is close but not that:
chronic load divides by the **observed data span in weeks**, not a flat 4 — the flat ÷4 was
deliberately retired because it inflated ACWR ~2× on new programs and fired spurious deloads. The
28-day bound comes from the caller: `readiness-payload.ts:339` passes
`getWorkoutSessionsFrom(userId, from28dDate)`. So the window is 28 days, and within it the divisor
adapts. **The coupling criticism is unaffected** — the acute 7 days are still contained in the
chronic 28 — but anyone reading "7:28" and going looking for a `/ 4` will not find one.

Three test files already cover it: `acwr-threshold-consolidation`, `acwr-window-gate`, and
`lib/__tests__/acwr.test.ts`.

## The measurement

Daily training volume (`sum(exercise_logs.volume)` per session date — the same quantity
`readiness-payload.ts:339` sums), 74 training days over the last 200. Both formulations evaluated for
every day with 28 days of prior history: **95 comparable days, 2026-05-28 → 2026-09-01.**

| | mean | median | max |
|---|---|---|---|
| coupled (current) | 0.919 | 0.955 | 1.594 |
| uncoupled EWMA | 0.955 | 0.967 | **1.512** |

**The scales agree.** That is the result that matters most and it was not obvious in advance: the
switch is **not** a re-levelling, so the canonical band boundaries do not need moving with it. A
formulation change that shifted the mean would have forced a recalibration of `lowMax`,
`EARLY_DELOAD_ACWR_MIN` and `ACWR_TAPER_START` together, and that would be a much larger proposal.

**But a fifth of days change at the deload boundary.**

| threshold | coupled fires | uncoupled fires | days that **change** |
|---|---|---|---|
| early-deload, 1.2 | 12 / 95 | 15 / 95 | **19** |
| over-exertion taper, 1.5 | 4 / 95 | 1 / 95 | **5** |
| band floor, 0.8 | 67 / 95 | 74 / 95 | 13 |

Note the taper: the coupled ratio fires it **4 times**, the uncoupled **once**. The EWMA's maximum is
1.512 against the coupled 1.594 — its weighting damps exactly the single-heavy-session spike the
taper is reacting to. Whether that is the fix or the loss is the owner's call, and it is the sharpest
question in this document.

## What this means for the decision

The change is **cheap to reverse** (one function, three test files, no stored data) and **does not
require moving any threshold**. What it costs is that ~20% of days near the deload boundary will
answer differently, in both directions — 12 → 15 firing is a net of +3, but 19 individual days flip.

The literature argument for the switch is narrow and worth restating precisely: the uncoupled
formulation removes the **mathematical coupling**, which is the criticism not in dispute. It does
**not** rescue ACWR's predictive validity, and it is not evidence the card should fire more or less
often. Anyone reading this as "the new number is more correct" has over-read it.

## Limits

- **One user.** `claude_ro` is row-scoped; this is the owner's history and nobody else's.
- **The simulation is day-granular**, while `computeVolumeAcwr` works in timestamps, and its
  `minSessions >= 6` gate was applied here to days-with-sessions rather than sessions. Both make the
  gate very slightly stricter than production. Neither moves the comparison, since both formulations
  are fed identical input.
- **The EWMA is seeded from the first observed day**, so its early values carry burn-in. The 28-day
  offset before comparison begins is there for that reason.
- Nothing was run on a device, and **no code changed** — this exists so the change can be decided
  before it is written.
