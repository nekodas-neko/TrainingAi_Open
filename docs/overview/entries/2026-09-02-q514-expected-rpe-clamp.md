# 2026-09-02 — Q-514: a clamped expectation is not an expectation

**Branch:** `claude/la-q514-expected-rpe-clamp` · **Agent:** Implementation Lane A

`expectedRpe` clamps the model's expectation to the 5–10 slider the owner reports on. The ceiling
never binds — `rir` is floored at 0, so the raw value tops out at exactly 10 — but the floor binds on
**37 of 570 rated sets**, hiding raw expectations as low as −10. Those are not warm-ups: 49.6–66.7%
of 1RM at 7–13 reps, ordinary accessory work, where a 10-rep set at 54% has ~9 reps in reserve and a
true expected RPE near 0.6. The model can only say 5, the owner reports 6.9, and the autoregulation
delta reads **+1.89** where every other set averages **−0.34**. A 2.2-point offset, in the direction
the back-off arm reads as "RPE ran high", and it produced **64% of all back-off triggers** while
leaving the push arm untouched — which is what makes it a bias, not a sensitivity setting.

**The fix is the entry's first action and nothing more.** `rawExpectedRpe` exposes the unclamped
`10 − RIR`, `isExpectedRpeRepresentable` says whether the clamp bound, and the per-exercise delta
drops those sets rather than neutralising them — the same choice `computeResilienceForDay` makes
with a missing contributor, and for the same reason: a fabricated neutral is a measurement that
isn't one. `RPE_DEAD_BAND` does not move (it sits on a flat part of its sensitivity curve and the
entry measured that too), and the clamp itself does not widen — an expectation of 0.6 against an
owner who never reports below 6 gives a delta of +6.3, which is worse.

**One thing beyond the letter of the entry, and why.** The delta loop moved out of `signals.ts` into
`perExerciseRpeDelta` in the same module. `aggregateSignals` takes a whole `WorkoutRepository` and
runs ~25 queries, so an inline loop is only reachable through a fixture nothing in this repo has
ever built — the rule would have shipped with the predicate tested and the call site not. As a pure
function it takes four tests, three of which fail when the filter is removed (verified by mutation).

**Deliberately not changed: `rpeTrendFromSets`.** It shares the biased input and feeds the
emergency-deload safety net. The bias makes that net fire slightly *early*, which is the safe
direction, and narrowing a safety net is a behaviour change this entry did not measure. Recorded in
the code beside the filter rather than left for someone to rediscover as an oversight.

**What this does not claim.** The 64% is a share of back-off *triggers*, not of load cuts issued:
the back-off arm needs a second signal (`rm1Trend === 'down'` or `repCompletionRate < 0.95`) that
the replay does not model, and the owner misses prescribed reps on only 7.1% of sets — so most
back-offs must come through a falling 1RM, and the number of cuts this prevents is well below 25.
The ratio is the finding; the absolute impact is not sized. The re-measure the entry asks for is
Tuning's and stays on its `Keep:`.

**Not exercised:** no device path, no migration, no schema. The change is pure computation inside
the prescription engine; `pnpm dev` was not needed to reach it and no API route or screen changed.
