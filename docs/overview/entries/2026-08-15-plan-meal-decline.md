# 2026-08-15 — answering a planned meal both ways (Q-187 phase 2, slice 2)

**Branch:** `claude/trainingai-backlog-v0abea` · **Version:** v1.315.0

Phase 1 gave the plan card a one-tap "I ate this". Slice 1 (2026-08-14) built `plan_meal_answers`
and its full sync path with nothing reading it. This wires the other answer.

## Why "no" needs storing and "yes" does not

"Ate it" stays **derived** — the food is in the day, which is how phase 1 already matches it, and a
row asserting the same fact beside the food log would be two sources of truth for one thing.

"Did not eat it" is not derivable at all: an absent food log is indistinguishable from an unanswered
prompt, and a prefill that keeps re-asking after being declined is worse than no prefill.

## The number the whole design protects

The plan's bar: a day with prefills showing and none answered must report **identical** totals to the
same day with the plan switched off. That holds structurally rather than by filtering — unconfirmed
and declined meals never enter `food_logs`, so there is nothing for its **23 readers** to miscount,
and none of them changed.

There is a test on the day's food rather than on row counts in the new table, because a row-count
test would pass just as happily if declining had quietly written a zero-calorie food log.

## Details that are decisions

- **The dismiss button hides once a meal is logged.** "Ate it" is derived from the food itself, so
  offering "no" beside a logged meal would be offering to contradict it.
- **Undo is one tap, and prominent.** "No" is one mis-tap from losing the meal for the day, which is
  why the stored answer is a soft delete with a tombstone rather than a row removal.
- **The tap flips the UI first**, then the write reconciles behind it — the repo's save-feels-instant
  rule. Local store plus outbox, with the API only as the fallback when the store is unavailable.
- **Read local-first.** A decline made offline has to survive an app restart or the prompt reappears,
  which is exactly the failure the offline-first rule exists to stop.

## Verified

Four DB-backed cases on the totals property. **Mutation-verified — and the first attempt was a false
pass worth recording:** making `savePlanMealAnswer` also insert a `food_logs` row left all four tests
green, which looked like the tests failing to discriminate. They were not: `food_items` is empty in
the dev database, so the mutation's `INSERT … SELECT FROM food_items LIMIT 1` inserted nothing. A
mutation that creates its own food item first fails **3 of 4**, which is the real signal. A no-op
mutation reads exactly like a test that cannot fail.

`pnpm build` passes · `tsc --noEmit` clean · lint 0 errors · `pnpm check:rules` **35 of 35** · full
suite **3,911 tests** under the TCP `DATABASE_URL`.

## Not exercised

**The S25, and the offline path.** Local SQLite and the outbox do not run in the sandbox, so the
local-first read and the queued mutation are proven by construction and by the shared write function,
not by execution. **Local v26 has still never run on a phone** — if the plan card comes up blank
after this ships, revert rather than debug forward.

**Automatic prefill is deliberately not built.** The plan's step 4 recommends an explicit action
first, on the grounds that an automatic prefill guessing wrong trains the owner to ignore it. What
ships here answers meals the plan already shows; nothing fills the day on open.

---

## Also in this branch: Q-243 — water logging invalidated five caches for nothing

Taken after the IA lane closed and released file ownership.

`water-log-sheet` already calls `invalidateBodyMetricWrite()` on **both** of its write paths, so
nothing was stale. The three call sites each added their own invalidation on top, differently — and
Home added `invalidateReadinessInputs()`, which drops `readiness-score`, `weekly-stats`,
`progress-summary`, `muscle-recovery` and `body-battery`.

**Water feeds none of them.** Verified rather than taken from the entry: grepping
`waterMl`/`water_ml`/`waterIntake` across `app/api/readiness-score`, `app/api/body-battery`,
`packages/shared/src/health` and `lib/oura-models` returns nothing. So logging a glass of water made
five instant-paint cards refetch for no reason — a cost, not a staleness bug, and against the
no-skeleton-on-a-repeat-visit rule.

Both redundant calls are gone. Each screen keeps its own `fetchMeta()`, which is a local refresh
rather than cache invalidation, and the sheet keeps sole ownership of the invalidation — the
mutation-callback contract the rulebook already states.

**The size gate caught something worth keeping.** A three-line explanatory comment pushed
`health-content.tsx` from 929 to 931 lines against its shrink-only baseline, and `check:rules`
failed. That is the ratchet working exactly as intended on a known hotspot: the comment went to
`session-select-content.tsx`, where the expensive call actually was, and the journal carries the
rest.
