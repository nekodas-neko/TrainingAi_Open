# Soft-delete filtering: does anything stop deleted rows coming back? (2026-08-09)

**Method:** the same mutation harness used for ownership scoping
([that review](2026-08-09-ownership-mutation-coverage.md)), pointed at a different invariant. Every
`isNull(x.deletedAt)` was rewritten to an always-true predicate of the same shape, and every raw-SQL
`deleted_at IS NULL` to `1 = 1` — so soft-deleted rows reappear everywhere.

**Surface:** `adapter.ts` + slices, **113 filters** (86 Drizzle `isNull`, 27 raw SQL).

> The filtering is **correct today**. The finding is that almost nothing holds it in place — and the
> failure it guards is directly user-visible. "My deleted workout is back" reads exactly like the
> "my data disappeared" class CLAUDE.md already tracks, from the other direction.

---

## 1. The headline

Neutralise all 113 and **371 of 372 tests still pass**. Exactly **one** notices —
`count-sessions-by-id.test.ts`, and only as a side clause in a test about something else
(*"…and excludes deleted / early-deload rows"*).

Per file, before any burn-down:

| file | filters | tests failed |
|---|---:|---:|
| `adapter.ts` | 69 | **0** |
| `slices/periodization.ts` | 17 | **0** |
| `slices/oura.ts` | 11 | **0** |
| `slices/user-stats.ts` | 7 | **0** |
| `slices/nutrition.ts` | 5 | **0** |
| `slices/programs.ts` | 4 | 1 |

**109 of 113 filters (96%) provably unguarded** — worse than ownership's 38%, and this is the class
with the more visible symptom.

## 2. A counting mistake worth copying the fix from

The first mutator matched only Drizzle's `isNull(s.x.deletedAt)` and reported **86** filters. It
silently missed **27 raw-SQL** `deleted_at IS NULL` predicates — including
`countWorkoutSessions`, which is written as a raw `sql` template. The true surface is **113**.

Two lessons, both already paid for elsewhere in this session: a scanner that reports a *smaller*
number is as suspect as one reporting zero, and the same invariant expressed two ways needs both
forms matched before any coverage claim is made.

## 3. What shipped

`lib/data/postgres/__tests__/repository-soft-delete-filtering.test.ts` — **7 tests** over injuries,
supplements, activity logs, fitness tests, food logs and workout sessions (×2). Each asserts the row
is present *before* the delete and absent after, so a seed that silently failed cannot pass. All
verified **7/7 failing** under the mutation.

Where a repository delete method exists, the test deletes through it, exercising the write path and
the read filter together. Workout sessions have no repository delete (their soft delete arrives via
sync's `pushMutations`), so those stamp `deleted_at` directly and test the read filter — which is
exactly what the mutation neutralises.

### After the burn-down

| file | filters | before | after |
|---|---:|---:|---:|
| `adapter.ts` | 69 | 0 | **6** |
| `slices/nutrition.ts` | 5 | 0 | **1** |
| `slices/programs.ts` | 4 | 1 | 1 |
| **`slices/periodization.ts`** | 17 | 0 | **still 0** |
| **`slices/oura.ts`** | 11 | 0 | **still 0** |
| **`slices/user-stats.ts`** | 7 | 0 | **still 0** |

**This is a partial burn-down and should not be read as more.** Three slices holding **35 filters**
remain completely unguarded. They are the aggregate/rollup domains — seeding a realistic Oura rollup
or a weekly stats window is a bigger job than the six single-row domains covered here, and it was not
attempted.

## 4. A real gap found by writing the test

The mood-log test **failed on clean code**, which is how the finding surfaced.

`mood_logs` has a `deleted_at` column on the server *and* on the device. The local store filters it
(`lib/local-store/sqlite-backend.ts:73`). **All three server reads — `listMoodLogs`, `getMoodLog`,
and the third at `adapter.ts:3277` — carry no `deleted_at` filter at all.** So the device would hide
a deleted mood log while the server returned it.

**Latent, not live:** nothing server-side ever writes `mood_logs.deleted_at`, and `getSyncDelta`
emits no mood tombstone, so the column is currently vestigial on the server. Filed as **Q-178**
rather than fixed, because the right fix depends on whether mood-log deletion is wanted at all —
adding the filter, or dropping the column, are both defensible and it is not this review's call.

The test was removed rather than left failing or weakened: a file whose contract is *"every test here
fails when the filters are removed"* is worth keeping literally true.

## 5. Limits

- **DB suite only** (372 tests), not the full ~3,270. Route and component tests were not measured.
- Per-file attribution only; no per-filter bisect, so "35 still unguarded" is a count of filters in
  zero-detecting files, not a proof that each individually is untested.
- The mutation cannot see a **missing** filter — that is what found Q-178, and only by accident of
  writing a test for it. A systematic sweep for reads of soft-deletable tables that lack the
  predicate would be a separate static audit, and has **not** been done.
- Local Postgres only. No device, no APK, no production data.

---

## 6. The static sweep the mutation could not do — and a live bug

Mutation cannot see a *missing* filter, so §5 flagged a static sweep as the next step. Done here.

**129 reads** of the 13 soft-deletable tables across `adapter.ts` and its slices (count cross-checked
against a raw `grep`, after two scanners this session reported wrong numbers). **44 carry no
`deleted_at` filter.** Most are correct:

- **13 are inside `getSyncDelta`**, which *must* return deleted rows — that is how tombstones reach
  devices. Omitting the filter there is the rule, not a violation.
- **Most of the rest are on tables nothing soft-deletes server-side.** Only **6 of 13** tables have a
  soft-delete write at all: `activity_logs`, `fitness_tests`, `food_logs`, `injuries`,
  `supplement_logs`, `supplements`. Production confirms it — `body_metrics`, `mood_logs` and
  `workout_sessions` hold **zero** deleted rows between them. So the 9 unfiltered `body_metrics`
  reads and the 3 `mood_logs` reads (Q-178) are latent, not live.

**Two reads are on live-soft-deleted tables and are not in `getSyncDelta`** — both in-use probes,
both the same shape, and one of them reproduces as a real user-facing bug. See **Q-179**.

### The fix that was wrong

The obvious fix — add the missing `deleted_at` filter to the probe — is wrong, and only a test
written in **both** directions showed it.

With the filter added, the probe correctly ignores the deleted log and proceeds to
`DELETE FROM meal_types`… which fails on `food_logs.meal_type_id -> meal_types`, **ON DELETE
RESTRICT**. The soft-deleted row still physically references the parent. The "fix" trades a clean
`MEAL_TYPE_HAS_LOGS` for a **500**. `activity_logs.activity_type -> activity_types` is NO ACTION —
identical.

Both probes are **correct given the schema**. The lifecycle is the problem, and choosing between the
four options in Q-179 is a design decision with a sync-tombstone consequence, not a patch.

Recorded plainly because the one-directional test **passed**: had the second assertion not been
written, a 500 would have shipped as a bug fix.
