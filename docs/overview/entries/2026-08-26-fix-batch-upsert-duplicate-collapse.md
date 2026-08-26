# 2026-08-26 — batch upserts collapse duplicates on the conflict target (Q-280)

**Branch:** `fix/batch-upsert-duplicate-collapse` · **Lane A** · v1.381.4

## What shipped

A shared `collapseOnConflict` (`lib/data/postgres/collapse-conflicts.ts`), applied to every batch
upsert in the write path that carries an `ON CONFLICT DO UPDATE` arm.

Postgres aborts an **entire** command whose VALUES list hits the same conflict row twice (SQLSTATE
21000). Not a partial failure — nothing in the batch lands. Q-214 fixed that inside
`upsertOuraHeartrate` on 2026-08-13, after `error_events` recorded **5,771 hits** on
`POST /api/hr-ingest`, each discarding up to 5,000 heart-rate points. That function's own comment
stated the intent it did not reach: *"this makes the guarantee the function's own, so every caller
gets it rather than each one remembering."*

## The entry's table was incomplete — five more sites, not two

Q-280 named `upsertOuraBucket` and `upsertSetHrStats`. A sweep for the shape
(`.values(<array>.map(…))` followed by `onConflictDoUpdate`) across `lib/data`, `app/api` and
`packages/shared` found seven in total:

| site | conflict target | collapse strategy | live? |
|---|---|---|---|
| `oura.ts` `upsertOuraHeartrate` | `(user_id, timestamp)` | last-wins (refactored onto the helper) | yes |
| `oura.ts` `upsertOuraBucket` | `(user_id, tier, bucket_start_ms)` | last-wins | **no server caller yet** |
| `oura.ts` `upsertSetHrStats` | `set_log_id` | prefer higher `readings_count` | yes |
| `oura.ts` `upsertOuraSleep` | `(user_id, sleep_start)` | per-field, later non-null wins | yes |
| `oura.ts` `replaceDaytimeStressBuckets` | `(user_id, bucket_start)` | last-wins | yes |
| `adapter.ts` `logSets` | `(exercise_log_id, set_number)` | last-wins | yes |
| `adapter.ts` `logExerciseWithSets` | `set_logs.id` | last-wins | yes |
| `adapter.ts` `upsertBodyMetrics` | `(user_id, date)` | per-field, later non-null wins | yes |

**The strategy is not cosmetic.** A bare `excluded.*` arm makes last-wins provably identical to what
Postgres would have done had it allowed the second update. An arm that *merges* does not:
`upsertSetHrStats` gates on `readings_count >=` so a partial recompute must not beat a fuller
sibling inside one batch, and the `mergeSet` rank arm keeps a stored value when the incoming one is
NULL. Plain last-wins at those three sites would have converted a visible 21000 into a silent field
loss — the fix wearing the bug's clothes.

## Premise corrections

- **`upsertOuraBucket` has no production caller.** The entry says it *"is fed by the same BLE rollup
  that produced the duplicates on `oura_heartrate`"*. It is not: the only references in the repo are
  the local-store implementation, tests, and the slice itself. It is the server-side durable backup
  defined ahead of its Track-B push path, so its exposure is **latent**, not live. Fixed anyway —
  the caller is what is missing, not the hazard.
- **`upsertOuraDailySummary` is genuinely exempt**, as the entry claimed: it loops one row per
  statement.
- **Q-280's premise that the burst has stopped is confirmed** — last occurrence 2026-08-13T00:17,
  the day Q-214 landed. This is the sibling sweep, not a regression.

## A defect the sweep introduced, caught before merge

`logSets` and `logExerciseWithSets` both zip `.returning()` against their **input** array by index
(`rows.map((r, i) => ({ ...sets[i], id: r.id }))`), and `logExerciseWithSets` also counts
`total_sets` from it. Collapsing inline made those arrays different lengths, so every set after the
first duplicate would have been handed the wrong id — a quieter bug than the 21000 it was fixing.
Both now collapse once into a `deduped` local and use it for the insert, the zip and the counter.
`logSets returns ids that belong to the sets it actually wrote` is the regression test, and it fails
when the zip is reverted.

## Verification

- `collapse-conflicts.test.ts` — 12 pure-logic cases, no DB. Includes the composite-key case:
  `('a', 11)` and `('a1', 1)` are different rows and a naive concatenated key merges them.
- `batch-upsert-duplicate-collapse.test.ts` — 7 cases against a real Postgres, and the first one
  **proves the hazard rather than assuming it**: a raw two-row insert with a repeated target raises
  `21000` and leaves the table at **zero** rows, not one.
- **Mutation-tested with applied-proof.** Each of the five production collapses, and the
  `.returning()` zip fix, was reverted in turn
  (each `sed` asserting its anchor existed, so a drifted anchor fails loudly instead of mutating
  nothing) and the matching test failed each time; restored green afterwards.
- Full suite, `pnpm check:rules` (**Ran 59 of 59**), `tsc --noEmit`, lint.

## Not exercised

Native SQLite / Capacitor, safe-area, Samsung WebView, real device — none of this is UI, and the
local-store `upsertOuraBucket` is a separate single-row implementation that was not touched. Not
verified against drifted production data: the local seed is fresh by construction, which is exactly
the condition under which a duplicate never occurs.

## Also in this PR

- **`docs/device-verification-queue.md`** — a new running list of the S25 checks that are owed, each
  with the screen, the action, and what a pass looks like, so one device run clears several items
  instead of the owner being asked piecemeal. Linked from `docs/device-smoke-checklist.md`, which is
  the generic pass; this is what a given device session should actually work through.
- **A stale line in `docs/device-smoke-checklist.md`** told the reader to *"repeat in both light and
  dark theme (Settings → theme toggle)"*. The app has been pinned to dark since 2026-08-25 and there
  is no toggle.

- **Q-518 removed as already fixed.** It asks for the `model_versions` jsonb merge that #525 shipped
  for Q-273 — verified in `main`: the shared upsert uses `||`, and the JS read-merge the entry
  warned about is gone from `readiness-payload.ts`. The cross-reference in the Body Battery tuning
  section that called it *"load-bearing for this decision"* was updated.
- **Owner decision, 2026-08-26 — readiness history policy reversed.** The 2026-08-24 policy was
  *leave stored history alone and stamp the new model*. Asked again with the cost stated plainly,
  the owner chose recomputation: *"Our history is still not accurate so I dont mind losing it till
  its something real to us."* Recorded in the Body Battery tuning section; the `MODEL_VERSION` bump
  stays, because separability and rewriting are different guarantees.
- **Owner decision, 2026-08-26 — Q-403's scope changed from copy to behaviour.** Told that a Coach
  swap writes the **program** row rather than today's session, the owner did not want the capability
  as it stands, naming injury as the one case worth keeping. Q-403 now carries that decision, a
  recommendation (gate the swap on an open injury the replacement avoids, rather than removing the
  tool), and the alternative that was considered and why it costs more.
