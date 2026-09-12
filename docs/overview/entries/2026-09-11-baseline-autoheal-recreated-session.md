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

## Fixed the same session, at the owner's request

He was training and asked for it directly, so this stopped being intake. Three changes:

The auto-heal now requires a log **newer than `phaseStartedAt`** rather than a name that has ever
been logged. That is the only honest test of the interruption it exists to repair, and a recreated
session's logs predate its own phase clock.

**A correction to that, found while closing the session out.** The lookup is name-keyed, and the
reason written into the code for that was wrong: it claimed `program_session_id` is NULL on every
row. That measured the dead column of the pair `schema.ts` warns about. The live link is the column
named `session_id`, it is populated on 62 of 108 rows, and on 2026-09-11 each of the four trained
sessions had one while the recreated Lower had none — the exact question, available directly. The
date comparison is what actually carries the guard and the behaviour is correct, but the reasoning
is not, and a reason left in a comment is what the next reader builds on. Corrected in the code and
filed as BF-144, which moves the test onto the id link.

It also completes only on full coverage, which is the invariant `recordBaselineAnchors` already
holds for the measured path and states in its own docstring.

And `revertAutoAdoptedBaseline` undoes a baseline already stored from borrowed PRs, so Lower repairs
itself when its card is next opened. That matters because there was no other route: the production
query endpoint is read-only and no reset control exists in the app.

The narrowing is the safety property, not the revert. Four other sessions on the owner's account
carry `amrap` (Legs, Upper) or `existing` (Push, Pull) anchors, and a wider revert would throw away
real cycles. `source: 'personal_record'` is written in exactly one place, which is what makes the
discriminator sound — five DB-backed cases pin it, and removing the guard fails three of them.

## What is NOT fixed

The bodyweight index. The adoption path still writes `{ kg: pr }` with no bodyweight branch, so a
genuinely interrupted session containing a bodyweight movement would still store an index under a
key named `kg`. The revert removes the bad anchors and the new gates stop fresh ones, but the
resolver work stays open under BF-127 — which this should not be read as closing.

## Not exercised

The authenticated body of the route was never run by a browser. `pnpm dev` confirmed the module
loads and returns 401 without a session cookie, and no device or real session was available in the
sandbox. The logic is covered by 31 unit cases and 5 DB cases, both mutation-checked, but the owner
opening Lower is its first real execution.
