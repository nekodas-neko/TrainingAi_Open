# 2026-09-24 — TN-74: the zero 1RM is mostly the design, and the rest was fixed months ago

**Lane A** · branch `lane-a/tn74-zero-1rm` · **docs-only — no code change is owed**

TN-74's first task was explicitly *"identifying that supplier"*, not changing the formula. It has an
answer, and the answer retires most of the entry.

## 76% of the defect is the contract

Grouped in production over 494 non-deleted exercise logs:

| `exercise_deloaded` | logs | `estimated_1rm = 0` |
|---|---:|---:|
| true | 32 | **32 — all of them** |
| false | 462 | **10** |

`estimateOneRm` returns zero when `deloaded` (`1rm.ts:166`), and `adapter.ts:1482` states the
contract outright: **"`estimated_1rm > 0` IS the deload test, not a proxy for one."** Zero *is* how a
deload is encoded. So 32 of the 42 are the design working, and the entry's headline rate of 8.5% is
really **2%**.

That also kills the entry's acceptance criterion. It asked for NULL instead of 0 so downstream could
distinguish "no estimate" from "an estimate of zero" — but adapter queries use `> 0` **as** the
deload test, so switching to NULL changes what those queries mean rather than tidying storage.

## The 10 real ones are two sessions, and the bug is already fixed

Both "Pull": 2026-08-09 and 2026-08-16, five logs each. Every exercise in both zeroed — including the
bodyweight Pull-Up, which takes a different code path — so the zeroing is **session-wide**, which is
what the `deloaded` early return does and what a per-set formula fault cannot do.

`log-exercise.ts:308-317` carries its own account of it (Q-298): the estimate uses
`deloadedForEstimate = exerciseDeloaded === true || (isAnyDeload && !isBaseline)`, which includes a
**phase-level** deload, while the row *used to* store `exerciseDeloaded ?? false`. A phase deload
therefore zeroed the 1RM and stamped the row `false`. Line 317 now stores `deloadedForEstimate`.

The rows are residue from before that fix, and they were written that way at log time —
`updated_at - logged_at` is **2–7 minutes, same day**. Nothing edited them afterwards.

## The central open question dissolves

The entry asked what supplies a positive 1RM to the 138 logs with no loaded flagged set. Nothing
does. `amrapAverage1Rm` and `calculate1RM` filter with `!flagged || style![i]?.useFor1rm`, so when
**no** set is flagged, `!flagged` is true and every set is used. "No `use_for_1rm` set" means "use
them all", not "compute from nothing".

## Two hypotheses I tested and refuted — recorded so nobody re-runs them

**That the rows lost a deload flag to RV-172's sync bug.** Plausible, and wrong: RV-172 nulled
`exercise_deloaded` in the *device's* SQLite, and these rows were last touched minutes after logging.
A later sync push would have moved `updated_at`.

**That the style's flagged set positions outran the sets performed.** Measured: 08-16 and 08-23
Barbell Shrug both have a 4-set style with all four flagged and both logged 2 sets — 08-16 stored
**0**, 08-23 stored **108.75**. Identical inputs, opposite outputs. The style is not the variable.

## What is still owed, and it is small

**The four zero-1RM/positive-`target_80` rows** are all the same 2026-08-06 deload session, correctly
flagged, and their `updated_at` is 6–7 hours later on 08-07. Some later write path set `target_80`
without touching `estimated_1rm`. **Which path is not established** — that is the one thing here
still worth chasing.

**`target80` is an accepted input that does nothing.** `log-exercise.ts:48` takes
`target80: z.number().optional()`; line 224 destructures `target80` from `estimateOneRm` and shadows
it. A caller can send the field and it is silently discarded.

## Not done, deliberately

**No repair of the historical rows.** Rewriting stored estimates is a data rewrite and the owner's
call; the code that produced them is already fixed, and nothing here establishes that a wrong
prescribed weight ever reached a screen — the entry itself flagged that as needing the device rather
than the table.

**Nothing was measured on the device or the surface.** Every figure above is a production `SELECT`
through `claude_ro`, which is row-scoped to the owner, so these are the owner's logs and no claim is
made about anyone else's.
