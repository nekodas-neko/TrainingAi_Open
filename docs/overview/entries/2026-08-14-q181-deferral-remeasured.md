# 2026-08-14 — re-confirming a deferral by measuring it again (Q-181)

**Branch:** `claude/trainingai-backlog-v0abea` · **No code changed.**

Q-181 records a decision *not* to build per-worker database isolation for the test suite. Q-177 set
out to build it, measured first, and found that every instability actually observed had a specific
locatable cause that isolation would have **hidden rather than fixed** — a table-wide data migration
in a parallel worker, four `TEST_USER_ID` collisions, and one file with a slow module import plus a
rate-limit bucket persisting in the database between runs.

The entry named the trigger that would justify revisiting it: *an instability the three known causes
do not explain — two files failing on each other's rows, with distinct user ids and no migration
involved.*

## The check

A deferral is only worth what its evidence is worth, and that evidence was four days old against a
suite that grows daily. So it was re-measured rather than assumed.

| | 2026-08-10 | 2026-08-14 |
|---|---|---|
| DB test files | — | **89** |
| Tests | 387 | **545** |
| Wall time | 72–107 s | **86–88 s** |
| Failures | 0 | **0 across 3 consecutive runs** |

The suite has grown **+41% in tests** against the same shared `trainingai_dev` — *more* parallel
pressure on exactly the thing per-worker isolation would relieve — and the spread got **tighter**,
not wider. `scripts/check-test-user-ids.js` reports 72 DB-touching files with all ids distinct. No
journal entry since 2026-08-10 reports an instability outside the three known causes.

**The trigger has not fired.** The deferral holds, and it holds for a better reason than it did four
days ago.

## Marked watch-only rather than removed

The queue rule is that a finished item must not linger, but this one is not finishable — it is a
standing decision with a live trigger. Removing the entry would delete the trigger's definition, and
the next person to notice a flaky DB test would re-derive the whole investigation. It follows Q-151's
precedent (`⏳ WATCH ONLY, nothing to implement`).

## Worth keeping from this

Two instabilities *were* hit during this session, and both are already-known causes rather than the
trigger: `migration-test-lock.test.ts` failing when two suites run concurrently, and `rate_limits`
rows persisting between runs. Neither is two ordinary suites colliding on rows. That is the
distinction the entry asks for, and it held.
