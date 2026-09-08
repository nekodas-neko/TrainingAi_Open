# 2026-09-08 — the DB tests stop failing on contention they cannot control (LA-83)

**Branch:** `fix/db-test-contention-tolerance` · **Lane A** · closes LA-83. Test infrastructure
only; no product code.

## The defect

Adding one mock-only test file turned the full local suite red in two DB-touching files it does not
touch. Three full runs settled what it was: clean tree **826 passed**, with the new file **2
failed**, with the same file again **827 passed**. Scheduling, not logic.

- `dexa-scans` died on `Test timed out in 5000ms` — the `unit` project's default — against a solo
  maximum of **2.16 s** across the entire DB directory. Nothing was slow; one round-trip queued.
- `error-events-prune` read 2 rows where it wanted 0, having waited a fixed `setTimeout(250)` for a
  `DELETE` the write path deliberately does not await.

**The repo had already diagnosed this class and fixed it in one project only.** `vitest.config.ts`
gives the `rollup` project `testTimeout: 60_000` with the reason beside it — *"Contention is what
tips these over, and the full suite runs them alongside ~380 other files against one shared
Postgres."* The `unit` project, which holds all **189** DB-gated files, kept the 5-second default.

## The fix, and why these numbers

**20 s for the `unit` project.** Not 4x the slowest solo run, which is how `rollup`'s 60 s was
derived: that method gives ~9 s here, and 5 s is already known to be exceeded, so it leaves no
margin for the tail — and the tail is what tips these over. 20 s is ~9x the slowest DB test measured
under full-suite contention (2.29 s), and deliberately far short of `rollup`'s 60 s so a genuinely
hung test still fails inside a third of a minute. The reporter keeps printing durations, so a test
that gets slower stays visible rather than merely staying green.

**A condition, not a duration, for the prune test.** It now polls the row count to a 5-second
deadline and still asserts afterwards, so a timeout produces the real assertion failure rather than
a bare "timed out". Slow under load instead of wrong under load.

A project-wide raise rather than 189 per-test timeouts: the repo's convention for a slow test is to
ask for headroom itself (16 sites do), but the risk here belongs to the DB-gated class rather than
to any test in it, and a new DB test would silently forget. That is the same argument `rollup`'s
project-level timeout already makes.

## Verified by reproducing both failures

Neither fix is asserted. Both were demonstrated:

- The prune's `DELETE` was made deliberately late with a `pg_sleep(1)`. The old fixed sleep produced
  the original signature — `expected 2 to be +0` — and the polling version passed against the same
  slow prune. The adapter was restored and its diff confirmed empty afterwards.
- A synthetic 7-second test passes under the new project timeout and fails with
  `Test timed out in 5000ms` when the config change is stashed.

## Not exercised

Test infrastructure only — no product code, no route, no schema. Nothing device-, native- or
UI-facing is touched, and CI behaviour is unchanged (the DB files skip there without
`DATABASE_URL`). What changes is the local full-suite gate every agent runs before merging.
