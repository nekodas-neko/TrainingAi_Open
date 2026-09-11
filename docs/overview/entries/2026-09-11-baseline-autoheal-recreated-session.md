# 2026-09-11 — the recreated Lower session that skipped its baseline (BF-143)

The owner rebuilt the Lower session that BF-124's unconfirmed delete removed, and reported it never
asked for an AMRAP. It didn't, and the state is worse than a missing prompt.

## What is stored

`session_periodization` for the active program's Lower, read 2026-09-11: `phase = accumulation`,
`baseline_complete = true`, `sessions_in_phase = 0` — against **zero** `workout_sessions` rows for
that session. The Health card's "Never trained" is correct; the phase beside it is not.

## One crash-recovery path, three defects

`app/api/ai-periodization/session/[sessionId]/route.ts:30-51` exists to repair a baseline whose
completion endpoint was never reached — "app crash / navigation away", in its own words. A session
recreated yesterday is neither, and it qualifies only because its exercise *names* match rows logged
earlier in the same program. The block is scoped to `program.id` precisely so a name logged under a
*different* program cannot skip a fresh AMRAP week — the right harm, guarded across programs and
unguarded within one.

Three things go wrong in those twenty lines, and fixing the trigger alone leaves two live:

- `:41` uses `.some`, so one matching exercise name completes the baseline for all of them.
- `:44-49` writes an entry only when a personal record exists, then marks the session complete
  regardless. Lower has four exercises and three baselines; `Dumbbell Calf Raise` has no PR, got no
  baseline, and now nothing will ever ask for one.
- `:46` writes `{ kg: pr }` with no bodyweight branch. Lower's stored baseline holds
  `Hanging Leg Raise: {"kg": 128}` — an exercise that is `equipment: ["bodyweight"]` and whose
  maximum `weight_kg` across 26 logged sets is **0**. The 128 is the `BW_REF = 100` index BF-127
  identified.

## Why this enlarges BF-127

BF-127 reads as a display bug — a suggested weight printed on a banner. This is the same index
entering `session_periodization` as a stored baseline, where prescription percentages multiply it.
A wrong banner number is read once; a wrong baseline is the denominator for a cycle. BF-127 should
not be closed as display-only.

## Two smaller things worth keeping

The adoption happened silently on a **GET**, so opening the card committed the state — which is why
it is already durable in production rather than something not starting the workout would have
avoided. And the "Use prior data" affordance the owner has used elsewhere never appeared here: the
same adoption happened without asking.

## Not exercised

No code changed. Every figure is from the read-only production query endpoint or direct source read;
nothing was reproduced against a running app. BF-143 carries a prose `Verification:` line — the
repro needs no device.
