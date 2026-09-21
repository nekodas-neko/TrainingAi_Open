# RV-83 — three writes on a read path become one, and the entry's own fix was the second-best one

**Branch:** `lane-a/rv83-merge-derived-persists` · **Lane A** · 2026-09-21

`/api/readiness-score` ended every computation with three separately-`await`ed
`repo.upsertOuraDailyDerived(...)` calls — readiness, sleep, activity — on a read path. They are now
collected and drained as **one statement per distinct day**, which in the normal case is one
statement instead of three.

## Both of the entry's "not established" points are now established, and they both go the same way

The entry closed with two open questions. Production answers both:

- **"Whether the third block fires in production at all (its gate was not met on the local
  dataset)."** It fires. Every one of the last twelve days carries an `activity_score`.
- **Whether the blocks share a row.** They do. All twelve days carry readiness, sleep **and**
  activity on one row, so `latestSummary.date`, `lastSleep.date` and `todayIso` resolve to the same
  day whenever the rollup is current — which is the normal case, not the edge.

So the wasteful shape the entry described is the *usual* shape, not an occasional one.

## The entry proposed `Promise.all`. It works, and it is not the best fix

Measured on local Postgres over a socket — network latency excluded, so Railway should favour the
merge by more, not less:

| shape | ms/request |
|---|---|
| 3 sequential upserts (what shipped before) | 2.38 |
| 3 via `Promise.all` | 1.17 |
| **1 merged upsert** | **0.66** |

I expected `Promise.all` to be worthless here, on the reasoning that three concurrent
`INSERT … ON CONFLICT` statements against the *same* row would just queue on the row lock. **That was
wrong** — it is a real 2×; Postgres takes and releases the row lock fast enough that the saved
round-trips dominate. Worth recording because the reasoning was plausible and the measurement
disagreed.

It still loses, for two reasons. It is **1.79× slower than merging**, and it spends **three pool
connections** to get its 2× on a pool CLAUDE.md keeps deliberately small and calls load-bearing.
Merging gets more, on one.

## Why merging is safe by construction rather than by comment

The entry flagged this as the tempting version needing a check first, because the comments at
`:663-666`, `:685` and `:706` *claim* each block writes only its own columns — and this sweep is
built on comments that say the right thing while the code does another.

Read at source, the claim holds, and it holds structurally rather than by discipline:
`upsertOuraDailyDerived` builds its column list from `Object.keys(DERIVED_COLS).filter(k => patch[k]
!== undefined)`, so a patch can only write the keys it actually carries. The three key sets are
disjoint — `readiness_*` + `model_versions`, `sleep_*`, `activity_*` — so a merged patch writes
exactly the union with every column still sourced from exactly one pillar. `model_versions`, the one
column with `||` merge semantics rather than COALESCE, appears in **one** patch, so grouping cannot
change how it combines with what is stored.

**That disjointness is an invariant, so `mergeDerivedPersists` refuses a key two pillars both claim**
rather than letting `Object.assign` pick a winner. A future pillar that starts stamping
`model_versions` would otherwise silently drop another's stamp — precisely the clobber Q-273 removed
from this table. The refusal is caught by the caller, so it costs a logged lost write and never a
failed read.

## The one thing that genuinely got worse, stated rather than buried

Three try/catches became one per day-group. A merged statement that fails takes every pillar in its
group with it, where before a bad value in one block left the other two written. The log line
therefore names the pillars in the group (`readiness+sleep+activity`) instead of a single pillar, so
a persistent failure says what it is costing. The blast radius is bounded by the fact that these are
best-effort persists of values recomputed on every request, so a dropped write self-heals on the next
one unless the offending value is itself persistent — in which case the old code would have failed
that block persistently too.

## Verification

- **4 new tests** on `mergeDerivedPersists`: the three-pillar collapse carrying every key, a lagging
  `lastSleep.date` staying its own upsert, the collision refusal, and the empty case.
- **Mutation pass, two mutations and one control.** Dropping the collision refusal for a silent
  `Object.assign` → 1 failed. Ignoring the day key so everything merges into one group → 1 failed.
  Each caught by exactly one test. The deliberately equivalent control — a plain object keyed by day
  instead of a `Map` — → **4 passed**, as it should.
- **Behaviour preservation is the existing suites, and they assert real rows.** 11 files / 48 tests
  across `readiness-score`, `body-battery`, `activity-contributors-persist` and
  `backfill-derived-scores` pass unchanged; `activity-score-persist.test.ts` reads
  `SELECT activity_score, activity_contributors FROM oura_daily_derived` against the local database,
  so it is an end-to-end assertion that the merged write still lands, not a mock call count.
- Full suite, `check:rules` (Ran 75 of 75) and `check-test-typecheck` below.

## Not exercised

- **No device check and no route run.** Auth precedes validation on this route, so a dev-server curl
  reaches 401 rather than the handler; the coverage is the handler-importing route tests above.
- **The measurements are local, over a Unix socket.** Absolute milliseconds will differ on Railway.
  The ordering is what transfers, and network latency can only widen the gap between three
  round-trips and one.
- **Production was read, not written.** The twelve-day check is `claude_ro`, which is row-scoped to
  the owner — it says all three pillars land on one row *for the owner*, not for every account.

## One unexplained observation

`pnpm check:rules` reported `memo() call sites pass stable props` as failing **once**, while the full
suite was running concurrently. `node scripts/check-memo-prop-stability.js` passes standalone and the
full `check:rules` passes on re-run (`Ran 75 of 75`). Recorded as unexplained rather than fixed — it
changed nothing about this diff, and a gate that fails once under load is worth someone recognising
rather than re-diagnosing.
