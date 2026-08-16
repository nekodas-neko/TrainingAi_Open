# 2026-08-10 — the flaky cable test was another migration rewriting its fixture (Q-171)

**Branch:** `fix/cable-merge-migration-flake` · **Domain:** `platform` · no version bump

## What was actually happening

`cable-exercise-merge-migration.test.ts` failed ~1 run in 3 under the full suite and passed alone.
Q-171 suspected an unscoped `DELETE` in a sibling test and said to go looking for one.

It is not a `DELETE`, and it is not a defect in any test. **A data migration is table-wide by
nature**, vitest runs test files in parallel workers, and they all share one `trainingai_dev`. Two
files that each execute a whole migration will rewrite each other's fixture rows.

Measured rather than inferred — seed the Cable test's exact fixture, then run migration 163 the way
a concurrent worker would:

| step | `personal_records` for the Cable test's user |
|---|---|
| after its own seed | `Cable Crunch` = **99** |
| after migration 163 runs | `Cable Crunch` = **20** |

Migration 163 step 3 is an unrestricted `UPDATE personal_records … FROM best`, and its step 1
`INSERT INTO exercise_estimates` carries **no name filter at all** — `WHERE b.estimated_1rm IS NULL
OR pr.estimated_1rm > b.estimated_1rm + 0.005`, every user, every exercise. Neither is scoped to
163's own test users, and neither should be: scoping a data migration to a test's fixtures would
defeat the thing it exists to verify.

That is why the failing assertion moved around between runs, and why the file passes alone.

## The fix

`migration-test-lock.ts` — a Postgres advisory lock the six migration-executing test files hold for
the duration of each test (or of the file, where the test only has `beforeAll`). Two global
migrations can no longer run against this database at once.

Held across the **whole test**, not just the `run()` call: a sibling migration landing between the
seed and the assertion corrupts it just as effectively as one landing mid-`run()`.

Checked out on a dedicated client from the pool, because advisory locks are per-connection —
`pool.query()` would hand back a different connection each time and silently drop the lock.

**Polling `pg_try_advisory_lock`, not the blocking `pg_advisory_lock`** — and the connection goes
back to the pool between attempts. This is the part I got wrong first, and it is worth stating in
full because the symptom pointed nowhere near the cause.

Files covered: `cable-exercise-merge`, `personal-records-reconcile`, `planned-pct-bodyweight`,
`bodyweight-volume`, `bodyweight-1rm`, `cold-temp-deviation`.

**Not `retry: 2`** — Q-171 rules it out explicitly, and it is right to: a flaky red on an unrelated
PR is how a real regression gets waved through as "that test again".

## Verified

- The lock is shown *holding*, not assumed: a second acquirer stays blocked for 250 ms while the
  first holds it, then completes the instant it releases. A helper that silently no-ops would leave
  the flake in place while looking fixed, so this is its own test — plus one that churns five pooled
  queries and confirms the advisory lock survives, and one that calls `release()` with no matching
  `acquire()` (the path an `afterEach` takes when `beforeEach` threw early).
- The six migration files run together: 6 files / 40 tests green.
- **Four consecutive full-suite runs, 432 files / 3437 tests, no failures.** The reported rate was
  ~1 in 3, so four clean runs is meaningful but not proof — see below.
- All 16 custom-rule scripts pass · `tsc --noEmit` clean · eslint clean on the new files.

## The fix's first version destabilized the suite

With the blocking `pg_advisory_lock`, `push-mutations-complete-workout-hr.test.ts` began timing out
— a file this change never touches. Measured either side rather than argued:

| tree | full-suite runs | failures |
|---|---|---|
| `main`, no lock | 8 | **0** |
| this branch, blocking lock | ~5 | **2** |
| this branch, polling lock | 8 | **0** |

Why: that test takes **3.32 s alone against vitest's 5 s default**, so it has almost no headroom —
the same marginal-by-construction shape CLAUDE.md documents for the Oura rollup tests. A blocking
`pg_advisory_lock` parks the waiter's **pooled connection** for as long as it waits, every worker has
its own pool, and they all come out of one `max_connections`. Serialization itself was never the
cost: all six migration files together run in 1.96 s, and the file-scope holder is 849 ms.

The lesson is general enough to write down: **a blocking lock inside a pooled test harness consumes
a connection per waiter.** Poll and release instead.

I nearly shipped the first version. Eight clean runs before merging `main` looked like proof; they
were not, because the failure rate is low and the suite is already flaky in other ways. What
actually settled it was measuring the *baseline* — running unmodified `main` eight times — rather
than only my own branch.

## A second signature, same fix

While this was being written, another session recorded a different failure on the same class:
`planned-pct-bodyweight-migration.test.ts` > *"is idempotent — a second run matches nothing"* failed
with a Postgres **`deadlock detected`** on a docs-only diff. Two suites taking locks in opposite
order, rather than one deleting another's rows — a different shape, the same root condition.

That file is one of the six serialized here, so it can no longer overlap another migration. It has
not recurred, but it was rare to begin with: **addressed by construction, not proven gone.**

## Honest limits

- **Four clean runs at a ~1-in-3 failure rate leaves roughly a 1-in-80 chance of having got lucky.**
  That is decent evidence, not certainty, and the cause was identified by direct reproduction rather
  than by the runs — the reproduction is the stronger half of the argument.
- I reproduced the *mechanism* (163 rewriting the Cable test's PR from 99 to 20), **not the exact
  reported assertion**. In my single-threaded repro the end state was still correct, because 163's
  step 1 had already preserved the value into `exercise_estimates` before step 3 lowered the PR.
  Which permutation produces the empty result depends on interleaving — that is what a flake is.
  The fix removes interleaving altogether, so it does not depend on which permutation was biting.
- **`reconcile-counters.test.ts` was closed the same day** (see the addendum below).
  `claude-ro-readonly-role.test.ts` remains uncovered: it re-points `DATABASE_URL` at another
  Postgres role and has its own documented harness caveat, so a pooled advisory lock needs that
  interaction thought through first.
- **The lock only covers the case where the interference is a whole migration.** Every DB test
  shares one `trainingai_dev`; two ordinary suites colliding on the same rows are untouched by this.
  The durable answer is probably a schema or database per vitest worker. Both gaps are **Q-177**.

## Addendum, same day — `reconcile-counters.test.ts`

Left out of the first pass because it has three `describe` blocks with their own `beforeAll`, which
the one-line hook patch did not fit. Reading it rather than pattern-matching on that shape: **only
one of its seven tests executes a migration.** So the lock is taken *inside that `it`*, in a
`try`/`finally` — no hook, and the shortest hold window of any of the seven files, which matters
after what the blocking version of this lock did to an unrelated timeout.

The interference it prevents is real: migration 146 is an unrestricted
`UPDATE workout_sessions … WHERE completed_at IS NULL` over any session with **≥3 exercise logs**,
for every user. Running it while another file has an in-progress workout silently completes that
session out from under it.

Seven files now hold the lock; one remains (`claude-ro-readonly-role.test.ts`, Q-177).
