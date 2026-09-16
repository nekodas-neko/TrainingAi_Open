# LA-110's declines are a week of unprescribed logs, not a rep-range artefact

**Lane A · branch `lane-a/la110-root-cause` · docs only. No code, deliberately.**

## Why this entry was picked up at all

I had been classifying LA-110 as blocked on an owner decision. **It is not.** It carries no `Gate:`
and no `Needs:`, it is not on any standing exclusion list, and Q-52 is parked waiting on it. What the
entry says is that the *shape of the fix* is undecided — and CLAUDE.md is explicit that a choice like
that is the implementer's to make and state, not the owner's. Treating an undecided implementation
shape as an owner gate is how a startable item sat still for a day.

## What the entry says, and why it is wrong

LA-110 reads the measured declines as a rep-range signature: a 1RM estimated from a 15-rep set is
systematically lower than one from a 3.5-rep set, so the comparison needs keying like-for-like.

The mechanism is real and the conclusion does not follow, because `calculate1RM` **already** corrects
for it on any prescribed set. `prescriptionFactor(pct, targetReps) = 1 / ((pct/100) × repFactor(targetReps))`,
so when the lifter hits the prescription the estimate reduces to `weight ÷ pct` — phase-independent by
construction. Moving into accumulation should not move the estimate, and where the prescription was
recorded, it did not:

| session | set | `planned_pct` | stored estimate |
|---|---|---|---|
| 2026-08-24 Realisation | 90 kg × 3 | **88** | 103.75 ✓ |
| 2026-09-15 Accumulation | 65 kg × 7, 65 × 11 | **76** | 91.25 ✓ |
| 2026-09-07 | 60 kg × 15 | **NULL** | 82.75 ✓ |

Each figure reproduces from the formula. The third has no prescription, so `prescriptionFactor`
returns null and `amrapScaleFactor(15) = 0.88` treats a submaximal working set as a maximal AMRAP.
**That row is the entry's own "−20.2%" point.**

## It is a dated window, which is what settles it

Counting production logs with `estimated_1rm > 0` across 60 days:

- **2026-09-06 → 2026-09-12 — wholly affected.** 5 of 5 logs with `style_name` NULL, 5 of 5 sets with
  `planned_pct` NULL, and one set per exercise where every healthy day has two.
- **2026-09-13 — partial.** 2 of 10 sets lack a pct; no log lacks a style.
- **2026-09-15 — clean.** 0 of 10.
- Either side of it, 0–3 no-pct sets a day, consistent with legitimate extra sets.

Six compounds "declined at once" because six compounds were logged inside one bad week. A formula
property does not start on a Sunday and stop the following Saturday.

## Two further corrections to the entry

**`workout_sessions.phase_type` is NULL on every production row.** The entry's first proposed fix —
restrict the pair to the same phase — is not implementable as written. Phase survives only in
`exercise_logs.style_name`, which is itself NULL across the affected window.

**The table is already stale.** A session landed on 2026-09-15, so Barbell Bench Press's last two real
estimates are now 91.25 (9 reps) against 82.75 (15 reps) — **+10.3%**, not −20.2%.

## What is owed, and what I deliberately did not do

Two things, and the second is not mine:

1. **Why were seven sessions written with no prescription?** The logging path shows no relevant commit
   in the window, so this needs tracing rather than guessing. Not attempted here.
2. **Whether those stored `estimated_1rm` values get recomputed is an owner call.** It rewrites stored
   history, and PRs and `target_80` read the same column — it is not confined to a trend line.

I did not build any of the entry's proposed fixes. Each of them keys or suppresses the *comparison*,
which would hide a week of wrong stored estimates behind a rule that looks principled. The entry's own
warning against widening the trend thresholds — *"that hides a real decline as readily as a false
one"* — applies just as well to hiding one behind a rep band.

## Failure surfaces NOT exercised

Docs only; nothing runs. Every figure was read from production through the admin query endpoint and
re-derived from `calculate1RM` by hand, not taken from the entry. **The production reads are
row-scoped to the owner** (`claude_ro`), so this is the owner's data, not a system-wide statement.
