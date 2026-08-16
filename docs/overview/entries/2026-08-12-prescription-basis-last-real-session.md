# 2026-08-12 — the prescription follows your last real session (Q-202, v1.300.0)

**Branch:** `fix/prescription-basis-last-real-session`

## What was wrong

The owner lowered their weights deliberately to work on form, and the app kept prescribing from a
lift months old — reported against a Dumbbell Lateral Raise showing **1RM: 16.25 kg** driving a
12.5 kg target, when the last session was `7.5×10` (~10 kg even generously).

`resolveWorkingBasis` returned `Math.max(lastLog1rm, seedEstimate, allTimePr1rm)`. The all-time PR
is permanent, so it always won the max and **no number of consecutive lighter sessions could ever
lower the prescribed weight.** That max was real protection — it stopped one easy day dropping
targets — but nothing distinguished "one easy day" from "a deliberate, sustained reset".

## The owner's decision, which changed the shape of the fix

Offered a per-exercise override, a global switch, or a time-boxed one, the owner rejected all three:
*"ideally it should give you recommendations based on your last non deload lift."* So **there is no
override** — the resolver's definition changed instead.

The trade-off was put explicitly and accepted: **one tired or interrupted session now lowers the
next prescription.** A smoothed variant (best of the last ~3 non-deload sessions) was offered as the
recommendation and declined. `resolve-working-basis.test.ts` carries a test named for that decision
so the smoothed version is not quietly reintroduced later as a "fix".

## Two halves, because the first alone would not have worked

**1. `resolveWorkingBasis` — the last real session wins outright.** `seedEstimate` and
`allTimePr1rm` are now reached only when there is no real logged session at all, which is the case
they were always genuinely for. The input was renamed `lastLog1rm` → `lastNonDeload1rm`, which made
the compiler point at all three call sites rather than leaving one silently on the old meaning.

**2. A query that finds the last *non-deload* log.** This is the half that is easy to miss.
`estimateOneRm` returns `{ estimated1rm: 0 }` for a deliberately submaximal effort, and that 0 is
stored. So after a deload the most recent log carries **no usable number at all** — `lastLog1rm`
filters out as non-positive, and the basis falls straight back to the all-time PR. Changing only
the resolver would have left the reported bug intact for anyone who had deloaded recently.

`getLastRealOneRmBatch` is deliberately separate from `getLastExerciseLogsBatch`, which must keep
returning the genuinely most recent log — the screen still shows what you actually lifted last
time. Only the *prescribed* weight skips deloads.

**`estimated_1rm > 0` IS the deload test, not a proxy for one.** The same call that suppresses the
estimate covers all three markers — a static deload phase, an early-deload week, and the AI's
per-exercise flag — so one predicate cannot fall out of sync with them, and it also excludes a
garbage log that produced no usable estimate. A baseline test during a deload window stores a real
value and correctly still counts.

## A sibling bug found while verifying, fixed here

`target80` was read off the last log, and a deload row stores **0** there too. It is both the
displayed target and the value the weight dial pre-fills to (`workout-screen.tsx:72`), so **after
any deload the next session showed "0 kg" and started every set at zero.** Observed live on the dev
server (`target80: 0` with a deload log present), not inferred.

This is pre-existing — the diff does not touch that line's source, so it read the same on `main` —
but it is the same class on a sibling surface, which CLAUDE.md's sibling-sweep rule says to fix in
the same PR. `getLastRealOneRmBatch` now carries `target80` from the same real session.

## Verified end-to-end, on identical data

Seeded a lighter real bench session (est **72**) after a history topping out at **98**, which is
also the stored PR. Same fixture, same fresh dev server, `/api/workout-data?tab=all`:

| | `estimated1rm` | `allTimePr1rm` |
|---|---|---|
| `origin/main` | **98** — the PR won | 98 |
| this branch | **72** — the real session won | 98 (untouched) |

Then added a deload log (`estimated_1rm = 0`) *after* the light session: the basis **stayed at 72**
rather than falling back to 98, and `target80` went from **0** to **57.5**.

The login rate limit (20 per 15 min, in-memory) trips after a handful of scripted sign-ins and
surfaces as `CredentialsSignin` — restart the dev server, don't go hunting for a broken password.

## Mutation-verified

Every new test was checked by breaking the thing it guards:

| mutation | failing tests |
|---|---|
| `resolveWorkingBasis` reverts to `max(...)` | 3, incl. the one using the reported 10-vs-16.25 numbers |
| the query stops skipping deloads | 1 — *"skips a more recent DELOAD session"* |
| the query drops `user_id` scoping | 2 |
| the query ignores soft-deletes | 3 |

Full gate: `tsc` clean, eslint clean (pre-existing warnings only), **all 31** Custom Rules steps
(see Q-206 — the four `scripts/check-*.js` files are not the whole check), suite **451 files /
3,724 tests green**.

## Not exercised

- **Not verified on device.** No safe-area or native surface changed, but the weight dial's
  pre-filled value is a real on-device behaviour and the `target80` half of this touches it.
- **The offline/local path was not exercised.** `buildWorkoutExercises`' new ctx field is optional,
  so a caller that has not been migrated degrades to the seed/PR fallback rather than prescribing
  from a deload. There is only one caller today (`/api/workout-data`, both paths) plus the
  prescription route, all migrated.
- **Only the seeded local fixture was used**, not drifted production data. The owner's real
  `exercise_logs` history may contain rows with `estimated_1rm` NULL rather than 0 from before the
  deload suppression existed; those are excluded by `> 0` the same way, which is correct, but it
  means an exercise whose entire history predates that column would fall back to seed/PR.
