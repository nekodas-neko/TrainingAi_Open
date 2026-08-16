# 2026-08-10 — DB test isolation: measured first, and the measurement changed the work (Q-177)

**Branch:** `test/db-isolation-per-worker` · **Domain:** `platform` · no version bump (tests only)

Q-177's open half was *"the durable answer is probably a schema or database per vitest worker"*. The
brief was to measure the baseline before and after. Measuring first is why that is not what shipped.

## What the baseline said

`npx vitest run lib/data/postgres/__tests__`, 6 runs: **387 tests, 0 failures, 72–107 s wall.** The
shared database was not producing failures on its own. So rather than build isolation against an
unobserved problem, the question became: where *does* shared state actually leak?

## Finding 1 — four files were sharing a user id, and two of them delete users

`TEST_USER_ID` is hand-assigned as a hex-suffixed UUID, one per file. **Four ids were used by two
files each**, across nine DB-touching files:

| id | files |
|---|---|
| `…c0de` | `push-mutations-complete-workout-hr`, `reconcile-counters` |
| `…d013` | `oura-heartrate-by-source`, `oura-timeseries-upsert`, `implausible-cadence` |
| `…d014` | `oura-daily-summary-sync`, `oura-timeseries-pull` |
| `…d012` | `oura-accel-chunks`, `sync-delta-window` |

Every one of these deletes its own fixture in `beforeAll` — `DELETE FROM <table> WHERE user_id = $1`
— so in parallel workers they delete each other's.

The `…c0de` pair is the bad one: **both run `DELETE FROM users WHERE id = $1`**. Proven against the
live schema rather than read off `schema.ts` — insert a user and a `body_metrics` row, delete the
user, the child row is gone; **55 of the 58 foreign keys onto `users.id` are `ON DELETE CASCADE`**.
So either file's setup can wipe the other's entire fixture across ~55 tables mid-run.

Fixed by giving four files unused ids, and `scripts/check-test-user-ids.js` keeps them distinct.
Mocked tests are exempt — a file that mocks `@/lib/data` never opens a pool, which is why `user-1`
appearing in three route tests is a false positive and not a collision. That exemption is what keeps
the check from becoming noise.

**Honest limit:** the mechanism is proven, the race is not. Running the `…c0de` pair together 8×
produced no failure. This is a hazard removed, not an observed bug fixed.

## Finding 2 — the one file that *was* failing, and it had nothing to do with ids

`implausible-cadence.test.ts` failed **5 runs in 10** alongside two files that shared its id. That
looked like the collision. The control says otherwise: **it fails 2 in 10 running alone.** Two
independent defects, in one 63-line file:

1. **A 4.2 s import billed to a 5 s test.** `await import('../route')` lived inside the `post()`
   helper, so resolving the whole route module graph was charged to whichever test called it first.
   Measured: first test **4162 ms**, other four **1–31 ms**. Moved into `beforeAll`, which has its
   own budget → first test **90 ms**.
2. **A rate-limit bucket that survives the process.** The route allows 20 calls/min keyed on the
   user id, and the limiter's L2 is the **`rate_limits` table** — so the counter outlives the run.
   Five requests per run means four runs inside a minute start returning 429.

Defect 2 was *hidden by* defect 1: while each run took 4.5 s, runs were spaced far enough apart to
mostly stay under the limit. Fixing the import made the file fast, which made it trip the limiter,
which made solo failures go **2/10 → 5/10**. That looked like a regression and was actually the
second bug surfacing. Both fixed (the `_awaitRateLimitFlushes` → `_resetRateLimitL1` → `DELETE` order
is copied from `backfill.test.ts`, which had already worked out why all three are needed).

The file also claimed in its header comment that it *"needs no database"*. Four of its five tests
don't; the fifth deliberately gets past validation and therefore reaches `getOuraClockAnchor`. With
no `skipIf` gate it **threw `DATABASE_URL is not set`** instead of skipping, which is how a full-suite
run without the env var failed. Gated, and the comment corrected.

## Measured after

| | before | after |
|---|---|---|
| `implausible-cadence` alone | **2 / 10 fail** | **0 / 12** |
| with its two former id-twins | **5 / 10 fail** | **0 / 12** |
| full suite | 3453 tests | 3453 tests, green |

## What was deliberately not built

The schema-per-worker isolation. All three instabilities found so far — the Q-171 migration case,
the id collisions, and this file — have specific, locatable causes, and **none of them is "two
ordinary suites colliding on rows"**, which was the hypothesis motivating per-worker isolation.
Isolation would have made all three *invisible* rather than fixed. This same session already saw
speculative harness hardening (a blocking `pg_advisory_lock`) cost more than it bought.

Filed as **Q-181** with the trigger that should start it: an instability these three do not explain
— two files failing on each other's rows, distinct user ids, no migration involved. The baseline
numbers and the `CREATE DATABASE … TEMPLATE` gotcha (it needs no session connected to the template,
so per-worker databases have to be made in `globalSetup`) are recorded there so the next attempt
does not re-derive them.

## Verified

- `tsc --noEmit` clean · **434 files / 3453 tests** green · all 19 custom-rule scripts pass.
- `check-test-user-ids.js` mutation-tested by restoring one collision: it fails, naming both files.
- The cascade claim measured against the live database inside a rolled-back transaction, not
  inferred from the ORM definitions (the two agree: 55/58).

## Not exercised

- **CI's database.** Every measurement here is against the local `trainingai_dev` on a 4-core
  sandbox. CI runs a fresh `trainingai_ci` on different hardware, so the *rates* (2/10, 5/10) will
  not transfer — the causes will. Notably the `rate_limits` bucket starts empty in CI, so defect 2
  would not have shown there at all.
- **Whether the id collisions were ever actually failing anything.** Removed as a hazard on the
  strength of the mechanism; no failure was reproduced from them.
