# 2026-09-09 — the AMRAP baseline session is consumed, and the phase exits on its own (BF-131)

**Branch:** `fix/bf131-amrap-baseline` · engine half; the card is LA-92 (Lane B).

The owner ran both baseline sessions exactly as the banner instructs — Push 2026-09-07, Pull
2026-09-06, one AMRAP set per exercise, both completed — and Health → Training still read *"baseline
needed"*.

`sessions_in_phase = 1` on both was the tell: **completion was wired and wrote the wrong field.**
The counter moved, `baseline_complete` never did, and the only exit from `baseline` was the "Use
prior data →" button — the one path that discards the baseline session. The alternative exit
deadlocked: prescription generation returns 400 while `phase === 'baseline' && !baselineComplete`,
so no prescription → no recommendation → no transition.

## One hop, not a new calculation

The entry was amended before I picked it up to say the derivation already runs, and that held up:
`estimateOneRm` takes an `isBaseline` flag, the workout screen passes it, and the result is already
persisted to `exercise_logs.estimated_1rm`. The number was in the owner's data the whole time. What
never happened was the copy into `session_periodization.baseline1rm` and the flip of the flag.

So completion now reads that back and writes it, keyed by **session-exercise id** — how the
periodization signals look a baseline up, and the same keying the prior-data path already uses.
Tagged `source: 'amrap'`, a value that already existed in `Baseline1rmEntry` with no producer, so a
measured anchor stays distinguishable from a carried-over PR or a number typed in the builder.

Same posture as the counter beside it: **advisory, fire-and-forget.** A completion must never fail on
a periodization write, which means the flag can lag a completion.

## The decision the entry left open

It asked for a choice on a partial baseline — complete with a PR fallback for the gaps, or stay in
`baseline` and name what is outstanding. **Staying**, and the codebase already argues it: the
skip-baseline route refuses to write an "empty, unusable anchor", and the exercises without one are
exactly those a rebuilt program added, where re-measuring is the point. Auto-filling them would make
the baseline session decorative — the same inversion the entry gives for not firing "Use prior data"
automatically.

So a partial **accumulates**: three of five keeps those three, stays in `baseline`, and a second
session finishes what the first started. That also hands LA-92 its number for free — the card can
count the stored map against the session's exercise list.

## Two survivors, and only one was a real gap

- **The ownership scope was untested.** `exercise_logs` carries no `user_id`, so the read is scoped
  through `workout_sessions` — and my first fixture asked for *my own* session id, where the
  workout-session filter already isolates everything and dropping the scope changes nothing. It has
  to ask for **another user's** id. That is the whole of what the scope defends.
- **The already-complete guard is genuinely redundant, and I proved it rather than assuming.** The
  caller checks `!baselineComplete` and the slice checks it again; each mutant alone is masked by
  the other, and removing **both** is caught. Kept as defence in depth with a comment saying so, so
  neither gets "simplified" away as dead.

And the fixture that produced the second point is the trap I documented in
[`docs/route-test-fixtures.md`](../../route-test-fixtures.md) earlier the same day: my case for the
already-complete guard called `setBaselineComplete`, which **also** moves the row to
`accumulation` — so the *phase* check rejected it before the *completed* check was reached. A case
meant to fail on guard X, rejected first by guard Y. Rebuilt by setting the state directly.

**10 of 12 caught**, the two survivors being that measured redundant pair; the thirteenth is a
planted equivalent control.

## Gate

`npx tsc --noEmit` clean · full suite green · `check-backlog-pointers` OK (334 entries).

**Not exercised: no device, and no screen.** The card still reads "Baseline needed" until LA-92
lands — what changed is that the phase now exits by itself, so the banner's promise ("the AI will
calculate your 1RM and start prescribing from the next session") is true for the first time. **Not
seen on the S25**, and the owner's existing rows are untouched: this fixes new completions, not the
two sessions already sitting at `baseline_complete = false`. His workaround — tap "Use prior data →"
— remains valid, and is now a deliberate choice rather than the only way through.
