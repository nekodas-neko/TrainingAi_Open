# 2026-09-03 — measuring the ACWR switch before writing it (Q-279)

**Branch:** `claude/la-q279-ewma-measurement` · docs-only.

Q-279's piece 2 calls the uncoupled-EWMA switch *"a contained change to one shared function with an
existing test suite"*. That is true of the code and not of the consequence — ACWR drives the
early-deload card and the over-exertion taper — so the standing rule applies: **a proposal is
incomplete until it states how many other days it moves.** This measures that first.

## The result that keeps it small

| 95 comparable days | mean | median | max |
|---|---|---|---|
| coupled (current) | 0.919 | 0.955 | 1.594 |
| uncoupled EWMA | 0.955 | 0.967 | **1.512** |

**The scales agree, and that was not obvious in advance.** A formulation change that shifted the mean
would have forced `lowMax`, `EARLY_DELOAD_ACWR_MIN` and `ACWR_TAPER_START` to be recalibrated
together — a far larger proposal than the entry describes. They don't move.

## What does change

| threshold | coupled | uncoupled | days that change |
|---|---|---|---|
| early-deload 1.2 | 12/95 | 15/95 | **19** |
| taper 1.5 | 4/95 | **1/95** | 5 |
| band floor 0.8 | 67/95 | 74/95 | 13 |

~20% of days flip at the deload boundary, in both directions — a net of +3 firings hides 19
individual changes. **The sharpest question is the taper: 4 firings become 1.** The EWMA's maximum is
1.512 against 1.594, because its weighting damps exactly the single-heavy-session spike the taper
reacts to. Whether that is the fix or the loss is not decidable from the data, so the entry is now
`Gate: owner` with the numbers attached.

⚠ Recorded on the entry so it cannot be over-read: the uncoupled form removes the **mathematical
coupling**, the one criticism not in dispute. It does nothing for ACWR's predictive validity and is
**not** evidence the card should fire more or less often.

## Premise refinement

The entry says *"naive 7:28"*. Chronic divides by the **observed data span in weeks**, not a flat 4 —
the flat ÷4 was retired for inflating ACWR ~2× on new programs — and the 28-day bound comes from the
caller (`readiness-payload.ts:339`). The coupling criticism is unaffected, but there is no `/ 4` to
find.

## A process note

`check-backlog-pointers.js` caught an inline `**Gate:** owner` written inside a blockquote, where the
parser ignores it and the entry would have stayed READY. **Second time this session.** The field has
to start its own bullet. Worth the reminder that the check is what caught it both times, not review.

## Limits

One user (`claude_ro` is row-scoped). The simulation is day-granular where `computeVolumeAcwr` works
in timestamps, and its `minSessions >= 6` gate was applied to days-with-sessions rather than
sessions — both make the gate marginally stricter than production, and neither moves the comparison
since both formulations get identical input. The EWMA is seeded from the first observed day, hence
the 28-day offset before comparison begins. No code changed; nothing ran on a device.
