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

`tsc` clean; Custom Rules **80 of 80**; the readiness suite **110 passed / 16 skipped**. No test
was added, because nothing changed: the deliverable is a decision and the comment that carries it.

Both of the comment's load-bearing claims were re-measured against production on 2026-09-27
rather than quoted from TN-64(b):

- The active program **Bankai** is `ai_dynamic`, has **no phase set**, and has **`started_at`
  NULL** — so both independent causes of the always-false suppression are live today, not one.
- Of the **119** logged workout sessions, **`is_early_deload` is false on every one**. Three carry
  a deload `phase_type`, and those are scheduled phase deloads off the two `automatic` programs —
  the path that already *has* suppression. TN-64(b)'s figure was 118; one session has been logged
  since, and it did not change the answer.

## Not exercised

**Nothing was run beyond typecheck and the existing tests**, which is proportionate to a
comment-only diff. The failure surfaces this change cannot reach are the same ones it does not
touch: no device, native, safe-area or offline-sync path is involved in a comment.

The one thing that *was* exercised is production, deliberately — the entry's quoted figures were
re-measured rather than inherited, which is what turned 118 into 119 and what confirmed the
second cause below.
