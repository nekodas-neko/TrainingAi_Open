## 2026-07-27 — Lifetime totals count finished workouts only (v1.217.2, audit finding Q-8)

Owner decision: *"Only workouts that are finished should count."* Plus their follow-up question —
*"Why is there such a high number of workouts that were started and never finished? Might be an
error."* — which turned out to be the important half.

### The defect

`user_stats` used **two different definitions of "a workout" in the same row**. `total_sessions`
counted sessions with at least one exercise log (61); `total_volume_kg` and `total_sets` swept in
every non-deleted session including abandoned ones. So ~26% of the displayed lifetime volume came
from workouts that were never completed, and the three numbers did not describe the same set.

### Why "just filter on completed_at" would have been wrong

Investigating the owner's question first is what saved this. The 28 unfinished sessions split
cleanly:

| group | count | shape |
|---|---|---|
| **Real workouts missing the flag** | **14** | 4–6 logged exercises, 11–18 sets, all dated **2026-05-01 → 2026-06-21** |
| Empty shells | 12 | 0 logs; several created the same day as a real session — the row is written when the screen opens, so backing out leaves one behind |
| Genuine partial abandons | 2 | a single exercise, then stopped (2026-07-03, 2026-06-21) |

Nothing after 2026-06-21 looks like the first group, so it is a **historical era** — the completion
flow simply wasn't writing `completed_at` reliably back then — not an ongoing bug. Filtering on
`completed_at` alone would therefore have silently discarded 14 genuine workouts.

### What shipped

1. **Migration 146** stamps `completed_at` on the historical finishers: `completed_at IS NULL` and
   **≥3 logged exercises**, set to that session's own **last log time**, never `now()` (re-dating a
   months-old workout into the present would fire phantom "new PR" and streak events downstream).
   Three is a clean separator here — the finishers have 4/5/6 logs and the abandons have 0 or 1, with
   nothing in between. Idempotent: it only ever touches NULLs, so a re-run is a no-op (tested).
2. **`reconcileUserStats` now filters all three subqueries on `completed_at IS NOT NULL`**, so
   sessions, volume and sets finally describe the same set of workouts.

### Production effect

| | sessions | volume | sets |
|---|---|---|---|
| stored today | 61 | 257,966 kg | 819 |
| completed-only, **without** the backfill | 44 | 191,260 kg | 565 |
| completed-only, **after** the backfill | **58** | **251,516 kg** | **806** |

The backfill recovers **14 sessions and 60,256 kg** that a naive filter would have destroyed. The
remaining drop from the stored figures (3 sessions, 6,450 kg, 13 sets) is the genuine abandoned work,
which is the intended correction.

### Verification

Full CI-equivalent suite **2,312 passing** on a freshly-migrated database, typecheck clean. Two new
DB-backed tests: one asserts an unfinished session contributes to *none* of the three counters (they
used to disagree), the other applies migration 146 against seeded rows and checks it stamps a 3-log
session, leaves a 1-log abandon alone, and is a no-op on re-run.

The existing reconcile fixture inserted a session with no `completed_at` and expected it to count —
updated, since that is exactly the behaviour being changed.

**Also fixed a stale comment** at the top of `reconcile-counters.test.ts` claiming CI's Tests job has
no `DATABASE_URL`. It does, and believing otherwise is what let a previous PR reach CI with two
failing DB-backed tests that a local run had skipped. The comment now says so.
