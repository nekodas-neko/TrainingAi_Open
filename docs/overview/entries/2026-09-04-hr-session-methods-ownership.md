# 2026-09-04 — three HR-session repository methods had no owner at all (Q-155)

**Branch:** `fix/hr-session-methods-ownership` · **Lane:** A · **Domain:** platform

## What this closes

A third blind spot in the ownership-coverage work, and the one the previous two were structurally
unable to see.

Q-155 has two detection mechanisms on it already. The 278-predicate mutation sweep neutralises
`user_id` predicates that **exist** and measures what stays green. `check-repository-user-scoping.js`
fails any data-layer method that **takes** `userId: string` and never uses it — the
`getBodyMetricsBaseline` mutation made permanent. Both assume the owner is a parameter. Neither can
see a method whose signature omits the owner entirely: there is no predicate to neutralise, and no
unused parameter to flag.

Enumerating every data-layer method that takes an id but no `userId` found **12**. Nine constrain
ownership through a join or a pre-check directly above the call, which is legitimate and is the
`ensureWorkoutSession` pattern CLAUDE.md names. **Three constrained it nowhere** — no predicate, no
join condition, no pre-check:

| Method | Shape | Production caller |
|---|---|---|
| `getSetDetailsForSession` | read, joined `workout_sessions` but did not constrain on it | one, via `computeWorkoutHr` |
| `getSetTimestampsForSession` | read, `workout_sessions` not joined at all | none |
| `markHrSynced` | **bare unscoped `UPDATE`** | none |

## Why it survived

Two of the three have no production caller, so nothing exercised them and nothing was wrong yet —
which is precisely the condition under which a bad shape sits indefinitely. The third was safe, and
still is, only because its one caller passed a session id sourced from a user-scoped query. That is a
property of the caller, not of the function; the next caller inherits nothing.

`getSetTimestampsForSession` is the instructive one. Fixing it needed the `workout_sessions` join
**added**, not just a predicate — the owner is not reachable from `set_logs`/`exercise_logs`, because
neither table has a `user_id` column. Scoping it was work rather than a one-word edit, which is a
plausible reason it was skipped originally.

Their siblings on the same slice — `getSetHrStatsForSession`, `upsertSetHrStats`,
`listSessionsMissingHrStats` — all take `userId`. These three were the odd ones out, not a considered
exemption.

## What shipped

All three now take `userId` and constrain on `workout_sessions.user_id`; `userId` is threaded through
`adapter.ts`, `repository.ts`, `compute-workout-hr.ts` and `app/api/health/trends/route.ts`.
`computeWorkoutHr` already had `userId` in scope and was simply not passing it, which is the clearest
evidence available that the omission was accidental rather than deliberate.

`lib/data/postgres/__tests__/hr-session-ownership.test.ts` — 5 tests. Three cross-user cases, plus
**two controls that assert the fixture produces data at all**, because Q-155's own entry records two
earlier tests that could not fail as written. Mutation-verified: dropping the predicates fails
exactly the three cross-user tests while both controls still pass.

## Deliberately not done

**Not mechanised.** A check that flagged every id-taking method without `userId` fires on all nine
legitimately join-scoped ones, so it would need a per-method allowlist — and an allowlist that size
is its own maintenance hazard, since the way it fails is silently, by someone appending to it. The
backlog entry records the enumeration as the thing to repeat when the data layer next grows, rather
than a script to trust.

**Q-155 stays open.** Its two original residuals are untouched: exact per-predicate attribution
across the 278, and a full-suite measurement, which the sandbox's safety classifier refuses — the
mechanical action is "delete every user-scoping check in the data layer".

## Not exercised

No device surface is involved — this is data-layer scoping behind an existing API route, so a Railway
deploy delivers it. Prod data was not exercised; the cross-user cases run against local Postgres
fixtures.

## Gates

lint 0 errors / 119 warnings · `pnpm check:rules` 67 of 67 · full suite 758 passed | 3 skipped
(761 files), 6461 tests passed | 59 skipped.
