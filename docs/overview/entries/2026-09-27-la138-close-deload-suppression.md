# LA-138 — the answer is "no", and the signal the entry named would have made it worse

**Branch:** `lane-a/la138-close-deload-suppression` · **Lane A** · one comment, no behaviour change

## The question

LA-138 establishes that `ai_dynamic` programs get no in-deload suppression on the early-deload
gate, because `listProgramPhases` resolves through `programs.phase_set_id` and that mode has none.
It then leaves one thing open: *"`ai_dynamic` has its own deload notion … and the early-deload
gate does not consult it. Whether it should is the question."*

## No — and specifically not that signal

`ai-dynamic.ts` gives `deloadOrRestRecommended`. That is a **recommendation** to deload.
`inDeloadPhase` means **already deloading**. They are not the same thing, and suppressing on the
first would silence the early-deload warning precisely when two independent systems agree a
deload is due. Backwards.

The honest "already deloading" signal for this mode does exist — a stored prescription with
`phaseAction === 'deload'` under `prescriptionDrivesLoad`, which is what RV-202/RV-204 use to
decide whether a prescription is driving the bar. But it is **session-scoped** and this gate is
**program-scoped**: it holds no session and would have to guess which one it meant.

## What settles it is the asymmetry, and then the count

A false suppression hides a health warning. A false prompt costs one confirmation tap — the entry
itself notes every early deload needs the owner's yes. Those are not comparable risks, so the
tie-break is evidence rather than symmetry.

And there is nothing to suppress. The gate's own docblock records TN-64(b)'s measurement: across
the **118 sessions** logged since the owner moved to `ai_dynamic`, **none was an early deload**.
The redundant-prompt scenario this suppression would prevent has never happened.

So: no behaviour change, and the reasoning goes in the code rather than only here — a future
reader finding an unsuppressed gate will reach for `deloadOrRestRecommended`, which is the one
wiring that must not happen.

## One correction to the entry

It attributes the always-false suppression solely to the missing phase set. There are **two**
independent causes: the active program also has `started_at` NULL, and the ternary
short-circuits on that *before* `listProgramPhases` is called. Either alone is sufficient, so
populating a phase set would not, on its own, switch the suppression on.

## Split out

`program_phases.program_id` is populated on **0 of 46 rows** and is what made LA-138's first
filing read as a clean zero — a join on it matched nothing, with no error. Filed as **LA-159**:
dropping it is a migration, ships alone, and is confirm-before-merge like LA-142.

## Verification

`tsc` clean; Custom Rules **RULES_LINE**; the readiness suite **READINESS_LINE**. No test was
added, because nothing changed: the deliverable is a decision and the comment that carries it.

## Not exercised

**Nothing was run beyond typecheck and the existing tests**, which is proportionate to a
comment-only diff. The 118-session figure is TN-64(b)'s measurement quoted from the code, not
re-measured here — and the entry it came from is the one that already re-measured it after
getting it wrong the first time.
