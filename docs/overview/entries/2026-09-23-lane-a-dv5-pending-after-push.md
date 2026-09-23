# 2026-09-23 — DV-5: four confirm arms that could never mark a pushed row synced

**Branch:** `lane-a/dv5-pending-after-push` · **Lane A** · engine only, no UI, no migration.

## What DV-5 reported, and what survived checking

Device Verification measured 33 tombstoned `food_logs` rows on the S25, all
`sync_status='pending'`, against an **empty** outbox — three of them from pushes that had
returned 200. That part reproduced exactly at source.

`pushMutations` confirms a drained mutation by re-reading the row through the **UI-facing
getter** and upserting it back with `syncStatus: 'synced'`. `getFoodLogs` is
`… WHERE date = ? AND deleted_at IS NULL`, so a delete's row is never found, the `if (rec)`
guard silently does nothing, and the outbox entry is dropped regardless. The tombstone is then
`pending` forever — and `applyDelta` only ever overwrites `synced` rows, so no later pull can
correct it and the local prune (`DELETE … AND sync_status='synced'`) can never reclaim it.

## The sibling sweep found three more, one of them worse than the reported one

Every delete-capable domain was checked against its getter:

| domain | getter filters `deleted_at IS NULL` | was broken |
|---|---|---|
| `food_logs` | yes | delete only — **the reported one** |
| `injuries` | yes | delete only |
| `supplement_logs` | yes | delete only |
| `plan_meal_answers` | yes | **every write** — the domain had no confirm arm at all |
| `supplements`, `saved_meals`, `activity_logs` | yes | already fixed (Q-124, Q-328) |

`plan_meal_answers` is the one worth naming: it was absent from the confirm chain entirely, so
every answer stayed `pending` after a successful push, not only the deletes — and `applyDelta`
gates **each of that table's columns** on `sync_status='synced'`, so those rows were unreachable
by the server from the first write.

## What shipped

Three new keyed marks beside the existing `markFoodLogSynced`/`markActivityLogSynced`:
`markInjurySynced(id)`, `markSupplementLogSynced(supplementId, logDate)` and
`markPlanMealAnswerSynced(planMealId, logDate)` — narrow `UPDATE`s that read nothing back, which
is the whole point. `markSupplementLogSynced` carries `source='manual'` in its `WHERE`, because
the branch that uses it cannot apply the read path's `(r.source ?? 'manual') === 'manual'`
narrowing, and without it confirming one delete would also mark that supplement's **meal**
contribution synced.

## One existing test had to be rescoped, and it came out stronger

`supplement-contribution-chain.test.ts` asserted the manual narrowing by slicing **400
characters** after the arm's opening line. The new delete branch pushed the narrowing past that
window and the test went red on a change it should not have cared about. It now slices to the
arm's **real extent** (up to the next `} else if (m.domain === …)`) and additionally asserts that
`markSupplementLogSynced`'s body contains `source='manual'` — so the delete branch is covered
where it never was. Both halves were mutation-checked; each kills its own mutant.

## Mutation pass

Six mutants, all killed; two deliberately equivalent controls, both survived.

| # | mutation | result |
|---|---|---|
| 1 | food delete branch removed | killed |
| 2 | food delete reads `payload.foodLogId` | killed |
| 3 | non-delete path short-circuits to the mark | killed |
| 4 | injury delete branch removed | killed |
| 5 | supplement log keyed on a wrong date | killed |
| 6 | `plan_meal_answers` arm deleted entirely | killed (3 tests) |
| C1 | `const id = …; if (id)` → `if (typeof … === 'string')` | **survived** (correct) |
| C2 | plan-meal arm rewritten with an equivalent nullish guard | **survived** (correct) |

## Not done, and not claimed

DV-5 also reported **one `set_logs` row pending since 2026-09-19 whose
`exercise_logs.workout_session_id` is not in the local `workout_sessions` table**. That is **not**
this defect: the `workout_log` arm calls `markWorkoutSynced(wsId, exerciseLogId)`, a keyed
`UPDATE` that reads nothing back, so a filtered getter cannot explain it. Read at source and left
unexplained rather than assumed — carved out as **DV-8**, `Gate: device`, because nothing in the
sandbox can open a local SQLite file.

**Failure surfaces not exercised:** native SQLite (`getLocalStore` returns null under node, so
every local-store test in this repo is either a fake-store or a source scan), the real on-device
store, and any Samsung WebView behaviour. The proof here is source-level and unit-level; the
**pass test in DV-5 — an empty outbox with zero pending rows — can only be run on the device.**

## Queue

- **DV-5** removed; **DV-8** filed for the unexplained half.
- **LA-129 repositioned.** It had landed at the top of READY because it was filed beside the entry
  it argued with, and queue position *is* priority here — which silently promoted a change the
  owner had deliberately deferred. Moved below the defects, with the reason recorded in the entry.
