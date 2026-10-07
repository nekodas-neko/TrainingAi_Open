# Ownership scoping: the mutation sweep, re-run (2026-10-07, #2425)

Re-runs the method of [`2026-08-09-ownership-mutation-coverage.md`](2026-08-09-ownership-mutation-coverage.md)
two months on, closes most of what it finds, and leaves the tool behind so the next re-run is one
command instead of a session.

> **No cross-user hole was found.** Every survivor was read in context. The 31 left at the end are
> either redundant by construction (19) or need state this pass did not build (12, filed as
> #2570, §4). No production code changed.
>
> **Addendum (#2570):** 20 of 353 survive now, all redundant by construction. See §8.

**Headline: 308 of 353 predicates survived before (87%); 31 of 353 survive now (9%).**

---

## 1. Method

**Tool:** `scripts/ownership-mutation-sweep/` (new; a developer tool, not a CI step).

- **What is mutated.** Every scoping predicate in `lib/data/postgres/adapter.ts` and the 13 files in
  `lib/data/postgres/slices/`, each rewritten to an always-true expression of the same shape:

  | shape | count | neutralised to |
  |---|---:|---|
  | `eq(s.x.userId, userId)` (and `opts.userId`) | 331 | `eq(s.x.userId, s.x.userId)` |
  | raw `x.user_id = ${userId}` | 21 | `x.user_id = x.user_id` |
  | `${s.x.userId} = ${userId}` inside `sql` | 1 | `${s.x.userId} = ${s.x.userId}` |
  | **total** | **353** | |

  The 2026-08-09 count was 246. The data layer has grown (`meal-plans`, `oura-raw-frames`,
  `oura-raw-pack`, `colmi`, `account-deletion` and `health-connect-intervals` are not in the August
  table), and the third shape is new to the count.

- **How.** One predicate at a time, applied by a vitest **transform plugin**
  (`scripts/ownership-mutation-sweep/vitest.config.mjs`). The source file on disk is never written,
  so there is nothing to restore and no mutant can be committed; `git status` was clean after every
  pass. A green run counts as a survivor only if the plugin confirms it applied the mutation;
  anything else is reported as an error, never as a survivor. Errors across all runs: **0**.
- **What runs.** Only the burn-down tests (`repository-ownership-scoping*.test.ts`), not the whole
  DB suite. The question is what the burn-down holds. A whole-suite kill is often one test file
  interfering with another rather than an ownership assertion (§1 of the August review), so the
  August per-file numbers, which counted those kills, are not directly comparable to these.
- **Where.** A local scratch database on the Docker Postgres (`localhost:5434`,
  `DATABASE_SSL=false`), migrated once and used as a **template**: every run gets a fresh clone, so a
  mutant that writes into the other user's rows cannot leave state that makes the next run fail for
  the wrong reason. That would under-count survivors, the dangerous direction. The driver refuses any
  non-local host. The scratch databases were dropped afterwards. Production was never touched.
- **Cost.** About 5 s of test time per predicate. The full 353 took **14.2 min** against the
  original file alone and **15.6 min** against both files at the end, with 4 parallel jobs.

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/<scratch> DATABASE_SSL=false \
  node scripts/ownership-mutation-sweep/index.mjs --jobs 4 --json out.json
```

## 2. Counts

| pass | burn-down tests | survivors |
|---|---|---:|
| **before**: the Q-155 file as on `main` | 57 | **308 of 353** (87%) |
| pass 1: schema-seeded file, first cut (full run) | 57 + 188 | 144 |
| pass 2: fixture fills the columns readers filter on (survivors only) | 57 + 242 | 55 |
| pass 3: layered checks with rows of A's own (survivors only) | 57 + 246 | 40 |
| pass 4 (survivors only) | 57 + 252 | 31 |
| full re-run | 57 + 252 | 33 (**two regressions**, see below) |
| **final full run** (also the code in this PR) | **57 + 251** | **31 of 353** (9%) |

**The survivors-only loop hid two regressions.** Pass 2 filled `workout_sessions.completed_at` and
`scale_raw_samples.status` so readers had something to find. That made B's session already
complete, so `completeWorkoutSession` (which only touches open sessions) no longer had anything to
complete. It also left B with no `confirmed` sample for `listConfirmedScaleSamplesForDate`. Both had
been killed in pass 1, so `--survivors-of` never re-ran them. The full re-run caught it. The fix was
an extra open B session, a confirmed B sample, and a stronger B snapshot (a hash of every B row
rather than a row count). The tool's help text now says to finish with a full run before quoting a
number. One more case went blind and came back the same way: the cycle-anchor test's block length
was sized off a B session count that the extra session changed. It is now sized from B's live
count.

Per file, before → after (one predicate at a time):

| file | predicates | survived before | survive now |
|---|---:|---:|---:|
| `adapter.ts` | 168 | 142 | 13 |
| `slices/account-deletion.ts` | 2 | 2 | 0 |
| `slices/body-battery.ts` | 1 | 0 | 0 |
| `slices/colmi.ts` | 3 | 3 | 0 |
| `slices/health-connect-intervals.ts` | 1 | 1 | 0 |
| `slices/meal-plans.ts` | 20 | 20 | 4 |
| `slices/nutrition.ts` | 34 | 23 | 2 |
| `slices/oura-raw-frames.ts` | 3 | 3 | 0 |
| `slices/oura-raw-pack.ts` | 6 | 6 | 5 |
| `slices/oura.ts` | 54 | 54 | 1 |
| `slices/periodization.ts` | 26 | 24 | 3 |
| `slices/programs.ts` | 31 | 27 | 3 |
| `slices/social.ts` | 1 | 0 | 0 |
| `slices/user-stats.ts` | 3 | 3 | 0 |

All at once (every predicate in a file removed together, the August headline measurement):
**before, 8 of the 15 runs stayed green**. Each of `account-deletion`, `colmi`,
`health-connect-intervals`, `meal-plans`, `oura-raw-frames`, `oura-raw-pack`, `oura` (all 54) and
`user-stats` could lose every ownership predicate at once with the burn-down green. **Now 0 of 15
stay green.**

**Why 87% survived.** Mostly it was missing *data*, not a missing test of the method: the other user
(B) had no row in the table, so a leak had nothing to leak. The second cause was data that existed
but sat outside the method's filter (`steps > 0`, `completed_at IS NOT NULL`, `status = 'pending'`,
a `day` stored as text), which a generic fixture does not fill.

## 3. What was added

**`lib/data/postgres/__tests__/repository-ownership-scoping-sweep.test.ts`** (new, 251 tests) is part
2 of the burn-down. It is separate from the hand-built Q-155 file because it seeds differently, and
the two would collide on fixed user ids running in parallel.

- **B gets a row in every user-owned table**, derived from the live schema by the existing
  `every-user-table-fixture.ts` (#2120). `B_OVERRIDES` fills the nullable columns readers filter on,
  and a few second rows cover what one row per table cannot (a dismissed and a confirmed scale
  sample, an open session, a library-named exercise). The fixture gained one option, `at`, so its
  timestamps line up with its fixed date and one query window sees both.
- **Two guards on the harness itself.** The August lesson was that the tests written to fix this are
  as likely to be unfalsifiable as the code. One guard asserts the fixture reached every user-owned
  table. The other proves the B snapshot notices a one-column write and a delete.
- **READERS: 147 rows.** A owns nothing, so each reader must come back empty and must not carry any
  id or text of B's. Eight of them call slice functions or adapter methods directly because no
  repository-interface method exposes them (`getRunningRedecodeJob`, `listDaytimeStressBuckets`,
  `getLatestOuraDailySummaryBefore`, `getOuraRollupWatermark`, `readRawFrames`,
  `readRecentRawFrames`, `getOuraClockEpochHead`, `getNewestOuraClockAnchorByUtc`).
- **WRITERS: 74 rows.** A calls the method at B's ids, or at the date B has data on. Every B row is
  compared before and after in one statement: each fixture row by primary key, plus an md5 of every
  B row in every table with a `user_id`.
- **Layered cases: 28 tests.** Here A must own the first row before the second predicate decides
  anything: a scoped lookup followed by a scoped write, or a check over several client-supplied ids
  where only one is foreign.

Rows added, by method. Each fails when its predicate is neutralised; the final sweep is the
evidence.

- **Readers.** Workout and logs: `getCalendarData`, `getRecentTrainedDays`, `listTrainedDayKeys`,
  `getDayLog`, `getDayExerciseNames`, `getDaySessionSummaries`, `getWorkoutSessionsFrom`,
  `getWorkoutSessionDetail`, `getSessionLoadsFrom`, `getYearReviewTotals`,
  `getYearReviewTopExercises`, `getLastRealOneRmBatch`, `getLastExerciseLogsBatch`,
  `getExerciseSummary`, `getExerciseHistoryRows`, `listRecent1rm`, `countWorkoutSessions`,
  `getFirstWorkoutDateForProgram`, `getTimingAuditData`, `getWorkoutSessionById`,
  `getWorkoutSessionProgramSessionId`, `wasProgramSessionTrainedSince`, `getRecentSessionsOfType`,
  `getSetTimingRows`, `getExercise1rmHistory`, `getSessionExercise1rms`, `getWorkoutSensorProbe`,
  `getWeeklySetsByMuscleGroup`, `getSetsByMuscleInWindow`, `getMuscleTonnageByWeek`. Body and day
  keys: `listStepDayKeys`, `listSleepDayKeys`, `listStepTotals`, `listFoodLogDayKeys`,
  `listWeightDayKeys`, `listCardioSessionCounts`, `listBodyMetrics`, `getBodyMetricsBaseline`,
  `getMostRecentConfirmedWeightKg`, `getConfirmedScaleTrendForDate`,
  `listConfirmedScaleSamplesForDate`, `listRecentDismissedScaleSamples`, `listPendingScaleSamples`.
  Activities, verdicts, panels, PRs, insights, body composition: `listActivityLogs`,
  `getActivityLogById`, `getActiveRunningPlan`, `getPrescribedRuns`, `getSleepVerdict`,
  `getReadinessVerdict`, `listBloodPanels`, `isRestDayChosen`, `listRestDays`,
  `getExerciseEstimates`, `listRecentPersonalRecords`, `listPersonalRecordsDated`, `listMaxReps`,
  `listLoggedExerciseNames`, `getGoalRecommendation`, `getAiHealthInsightWithHash`,
  `listAiHealthInsightsForDate`, `getLatestDexaScan`, `listDexaScans`, `getLatestMeasuredRmr`,
  `listMeasuredRmr`, `getAppLoadReport`, `getSyncDelta` (26 predicates, full and windowed). Ring:
  `getOuraClockAnchor(s)`, `getOuraClockOffsets`, `getOuraHeartrateBySource`,
  `getOuraDaytimeStressBuckets`, `getLatestStrapStatus`, `listStrapStatus`, `getOuraBatteryPolls`,
  `getOuraDaily`, `getLatestOuraCloudVitals`, `getRedecodeJob`, `getLatestRedecodeJob`,
  `getPendingRekeyDeclaration`, `hasOuraBleSamples`, `listOuraTags`, `getHrForWindow`, `getRrForWindow`,
  `getZoneMinutesRange`, `getDaytimeHrvModel`, `getAvgBpmBySession`, `getWorkoutHrStats`,
  `getSetDetailsForSession`, `getSetHrStatsFor{Session,Exercise}`, `getSetHrStatsSince`,
  `listSetHrStatsForHrr1Backfill`, `getOuraWorkouts`, `getSetTimestampsForSession`,
  `getUnsyncedHrSessions{,ForDay}`, `getOuraDailySummary`, `getOuraDailyDerived`,
  `getDerivedScoresForDay`, `getOuraRollupState`, `countPackableBuckets`. Supplements, Colmi,
  Health Connect: `listSupplementVials`, `currentSupplementVial`, `listDoseEvents`,
  `listDoseHistory`, `getColmiReadings`, `getColmiSleepSegments`, `getColmiLatestReadingAt`,
  `getHealthConnectIntervals`. Nutrition and meal plans: `listMealPlans`, `getActiveMealPlan`,
  `listUserDietaryRestrictions`, `listPlanMealAnswers`, `mealPlanNeedsReview`,
  `countLiveFoodLogsForMealType`, `foodLogRefsValid`, `listLatestMealTimes`,
  `getRequiredMealTypeLogDays`, `listRecentFoodItems{,ForMealType}`. Programs and periodization:
  `getSessionPeriodization`, `listSessionPeriodizationForProgram`, `countSessionsSinceStart`,
  `countAllSessionsSinceStart`, `listPrograms`, `listProgramPhases`, `listPhaseSets`,
  `listProgressionStyles`, `progressionStyleIdsOwned`.
- **Writers at B's ids.** `completeWorkoutSession`, `setSessionRpe`, `setWorkoutSessionWarmupEnd`,
  `confirmScaleSample`, `dismissScaleSample`, `set{Sleep,Readiness}VerdictResponse`,
  `setManualSleepStart`, `deleteBloodPanel`, `setRestDay`, `deleteAiHealthInsight`,
  `updateSupplementVial`, `deleteSupplementVial`, `cancelPendingRekeyDeclaration`,
  `reapStaleRedecodeJobs`, `markOuraWorkoutReviewed`, `markHrSynced`, `writeSetHrr1`,
  `nullHistoricalDecoded`, `packOuraRawBuckets`, `persistBodyCompFromMetrics`,
  `replaceOuraDailySummary`, `deleteMealPlan`, `updateMealPlan`, `setMealPlanActive`,
  `markMealPlanReviewed`, `replaceMealPlanStructure`, `replaceUserDietaryRestrictions`,
  `savePlanMealAnswer`, `deletePlanMealAnswer`, `reassignAndDeleteMealType`, `reorderMealTypes`,
  `seedDefaultMealTypes`, `setBaselineComplete`, `recordBaselineAnchors`, `advancePhase`,
  `clearProgramPrescriptions`, `updatePrescriptionStatus`, `storePendingTransition`,
  `incrementSessionsInPhase`, `reconcileSessionsInPhase`, `setLastSessionRanPrescription`,
  `revertAutoAdoptedBaseline`, `deleteProgram`, `deletePhaseSet`, `linkPhaseSetOwnership`,
  `updateProgramPhaseSettings`, `autoRecalibrateCycleAnchor`, `confirmEarlyDeload`,
  `deleteProgressionStyle`, `reconcileUserStats`, `storePrescription`,
  `updatePrescriptionExercisesCache`, `dropZoneMinutesFrom`, `replaceDaytimeStressBuckets`,
  and the 7-day prune inside `insertOuraAccelChunk`.
- **Client-minted ids on upserts** (B's id sent as A's new row): `saveActivityLog` (both branches),
  `saveFitnessTest`, `createInjury`, `createSupplement`, `createFoodItem`, `createFoodLog`.
  **De-duplication reads**: `createFoodItem` (reuseExisting), `insertScaleRawSample`. **"Deactivate
  the others" sweeps**: `saveRunningPlan`, `createMealPlan` (activate), `setMealPlanActive`,
  `saveProgram` (active). **Parent pre-checks on client-supplied parent ids**: `logSupplement`,
  `createSupplementVial`, `createMealPlan` (meal type and saved meal refs), `createSavedMeal` (food
  item and meal-type tag refs), `foodLogRefsValid` (each of the three refs alone),
  `reassignAndDeleteMealType` (both directions), `reorderMealTypes`. **Derived values**:
  `upsertPersonalRecordIfBetter`, `applyLbsToKgFix`, `saveActivityLog` (energy from weight),
  `createFoodLog` (eaten-at window), `listSavedMeals` (last used), `listSupplements` (taken today),
  `getObservedHrProfile` (source merging), `getLatestOuraBleMeasuredAt` (clock conversion),
  `listSessionsMissing{,Set}HrStats`, `countSessionsSinceStart`, `autoRecalibrateCycleAnchor`,
  `saveProgram` (name clash, owned phase-set rename), `deletePhaseSet` (in-use probe),
  `deleteAccount` (audit counts).

**One fix to the Q-155 file:** `deleteMealType cannot delete another user's meal type` asserted on
the `name` of a row the method soft-deletes, so it could never fail. It now asserts `deleted_at`.
That is the **seventh** unfalsifiable assertion found in that file, and the first one found by
re-running rather than while writing.

## 4. Survivors left, and why

**Redundant by construction: 19, now 20.** No single-predicate mutation can change behaviour, so no
test can kill these. They are kept as cheap insurance, as the code comments on several of them
already say. The twentieth, `oura-raw-pack.ts` L210, was found while building #2570 (last row).

| predicate | why it cannot be the deciding check |
|---|---|
| `upsertPrescribedRun` L2793, `setRestDay` L3725, `upsertStepLiveWindow` L6771, `replaceDaytimeStressBuckets` L2288, `savePlanMealAnswer` L650 | `setWhere` on a conflict target that already includes `user_id`: one user's insert cannot conflict with another's row |
| `saveBloodPanel` L3641, `logSupplement` L7310 and L7375, `setMealPlanActive` L338, `replaceMealPlanStructure` L469, `savePlanMealAnswer` L632, `reassignAndDeleteMealType` L204, `reorderMealTypes` L253, `recordBaselineAnchors` L152, `revertAutoAdoptedBaseline` L762 | behind a covered predicate that already restricts the id to the caller's own (`ownedPlan`, `ownedVariantPlanId`, the supplement ownership check, the scoped row list, the live-ids check, the scoped `current` read) |
| `saveBloodPanel` L3631, `revertAutoAdoptedBaseline` L741, `updateProgramPhaseSettings` L673, `autoRecalibrateCycleAnchor` L762 | an unscoped read here only feeds a write that is itself user-scoped, which hits 0 rows (`saveBloodPanel` then throws on `row.id` and rolls back). The read cannot reach the caller. |
| `packOuraRawBuckets` L210 (`oura-raw-pack.ts`) | the delete is `user_id = … AND id IN (…)`, and the ids are the primary keys the scoped select at L139 just read. Without `user_id` it deletes exactly the same rows. L139 is covered. |

**Needs state this pass did not build: 12, now covered (#2570, §8).** These were real coverage gaps, not proven safe. Each
needs A to own something specific (ring history with anchors and packable buckets, a body-fat
reading on the same source as a scan, an active program with a schedule) before the predicate
decides anything:

| predicate | what A would need |
|---|---|
| `getNextSession` L1789 | an active program with sessions, whose names B's history shares |
| `getBodyFatCalibration` L4289, L4302 | a DEXA scan and a same-source body-fat reading inside the pairing window |
| `previewStepsBackfill` L6723, L6744 | clock anchors and step frames that produce a step day |
| `getOuraRawSampleSummary` L6949 | hot-tier frames, so the summary reaches its packed-tier span |
| `oura-raw-pack.ts` L91, L118, L139, L189, L210 | a packable hot bucket older than the seal line |
| `countAllSessionsSinceStart` L721 | sessions named like B's program sessions (see §5) |

Filed as #2570. Eleven are now killed by a case in the "with rows of A's own" block; L210 turned out
to be redundant (first table). See §8.

## 5. Id-taking repository methods that do not take a `userId`

Enumerated with the TypeScript parser over `WorkoutRepository` (`lib/data/repository.ts`): **375
methods, 38 without a `userId` parameter**, of which **8 take an id**:

| method | id from | reachable from | verdict |
|---|---|---|---|
| `updateActivityType(id, patch)` | client | `PATCH /api/admin/activity-types` behind `requireAdmin` | global catalogue, admin only |
| `deleteActivityType(id)` | client | `DELETE /api/admin/activity-types` behind `requireAdmin` | global catalogue, admin only |
| `upsertExercise(entry)` | client | `POST /api/admin/exercises` behind `requireAdmin` | global catalogue, admin only |
| `adminUpdateExercise(entry)` | client | `PATCH /api/admin/exercises` behind `requireAdmin` | global catalogue, admin only |
| `deleteFeedback(id)` | client | `DELETE /api/admin/feedback/[id]` behind `requireAdmin` | admin only |
| `getSetLogsForSessions(ids)` | server | `ai-periodization/signals.ts`, ids from the caller's own scoped session query | not client-reachable |
| `consumeRekeyDeclaration(id, epoch)` | server | only from inside the adapter's ingest path, id from a scoped read | not client-reachable |
| `finishRedecodeJob(id, …)` | server | `/api/oura-ble/samples/redecode`, id from `startRedecodeJob(userId)` | not client-reachable |

**None is an ownership risk today.** The other 30 take no id: user lookup by email at sign-in,
catalogue listings, telemetry inserts, storage stats.

One related shape, noted while checking callers: `countAllSessionsSinceStart(userId, programId)`
reads `program_sessions` by `programId` with no user join, so given someone else's program id it
would key its result by their session ids. Every caller (`daily-digest`, `workout-data`) passes the
caller's own active program id from the database. It is not reachable with a foreign id, and it is
recorded as a shape to watch rather than as a finding.

## 6. What the sweep cannot see

- **Ownership that is not a `user_id` predicate.** These are not mutated: `eq(s.users.id, userId)`
  on the caller's own `users` row (23 sites), the `friendships` party columns (10), `ne()` and
  `inArray()` forms, and ownership by join or pre-check on the tables with no `user_id` (§9 of the
  August review). The friendships and pre-check cases are covered by hand in the Q-155 file.
- **Raw SQL outside the data layer.** 22 files outside `lib/data/postgres/` reach the pool or drizzle
  directly (`getDb()` / `getPool()`). They include `lib/workout/delete-session.ts`,
  `lib/workout/exercise-log-edits.ts`, `lib/coach/{threads,apply}.ts`, `app/api/friends/*`,
  `app/api/profile/[userId]` and the admin routes. Their client-supplied-id paths were read for this
  review and none is under mutation. `delete-session` and `exercise-log-edits` pre-check ownership
  and fail closed. `coach/threads` scopes its update and treats a 0-row result as "not yours".
  `coach/apply/[id]/undo` scopes by user.
- **Reads through views.** The `claude_ro.*` views are row-scoped in SQL generated by
  `scripts/generate-claude-ro-views.js`, not by these predicates.
- **Joins.** A predicate on the owning table of a join (`ws.user_id` for `exercise_logs`) is
  mutated. A missing join condition is an absence, and there is nothing to neutralise.
- **Two mutations at once.** The redundant survivors in §4 are invisible to one-at-a-time mutation
  by definition. Their safety rests on the predicate in front of them, which is covered.
- **Local Postgres only.** No device, no APK, no production data.

## 7. Re-running

After a data-layer change, run `node scripts/ownership-mutation-sweep/index.mjs --file <slice>` for
the slice you touched. Add a row to the sweep test for anything new that survives, and check it by
running the sweep again. Reading the test and believing it is not a check. Finish with a full run
before quoting a number (§2).

## 8. Addendum: the twelve that needed A's own data (#2570)

Six cases were added to the "with rows of A's own" block of the sweep test, placed before
`deleteAccount` because that case deletes A. Each one seeds what A must own for the predicate to
matter, then adds B rows built to change A's answer if the predicate is gone. Every row it adds
creates its own data and removes it in a `finally`, so no shared catalogue row is involved (#2571).

| case | A owns | B's look-alike | predicates it kills |
|---|---|---|---|
| `getNextSession` | an active program with two sessions | a session today, with a logged exercise, named after A's second session. Unscoped, A is told "Already trained". | L1789 |
| `getBodyFatCalibration` | a scan on 08-10, `scale_ble` readings on 08-11 (offset +2) and 08-20 | a scan on 08-20, which pairs with A's spare reading, and a same-day `scale_ble` reading on 08-10, which displaces A's | L4289, L4302 |
| `previewStepsBackfill` | a clock anchor and one 600-step live window on 08-25, no stored day | a live window one ring-day earlier (adds a row) and a `manual` 08-25 day (removes A's row) | L6723, L6744 |
| `getOuraRawSampleSummary` | one hot frame, so `measuredAt` has an anchor | a packed bucket far older. Unscoped, it becomes the start of A's history. | L6949 |
| `packOuraRawBuckets` | a newest frame, one sealed bucket and one frame still inside the hot window | a newer newest frame (seals A's warm bucket), a frame in A's sealed bucket (packed with A's), a B-only sealed bucket (left in `remaining`), and a junk blob at A's bucket key (refuses A's bucket on read-back) | L91, L118, L139, L189 |
| `countAllSessionsSinceStart` | two sessions before B's program started, named after B's program session | B's program `started_at` after both. Unscoped, it filters A's count to 0. | L721 |

**L210 is redundant.** The packer's delete is `user_id = … AND id IN (…)`, with ids from the scoped
select at L139. It is in the first table of §4.

**L189 depends on row order.** Unscoped, the read-back matches A's blob and B's at the same
`(epoch, tag, ds_bucket)` and takes the first. On a small, unanalysed table Postgres 16 runs that as a
sequential scan, so it returns B's row, which was inserted first, and the case fails as intended. If
a future planner picks the primary key index (`user_id` leads, and A's id sorts first), this mutant
could survive again. The full re-run is what would show it.

**Counts, full run** (`--jobs 4`, not `--survivors-of`):

| run | burn-down tests | survivors |
|---|---|---:|
| final full run in §2 | 57 + 251 | 31 of 353 |
| **#2570 full run** | **57 + 257** | **20 of 353** |

All 20 are in §4's first table; 333 killed. None of the 322 earlier kills turned back into a survivor, and each
of the eleven new kills failed on its own #2570 case, not on another test. Errors: 0. Wall time 33.4 min
with 4 jobs, about twice §1's figure, on a machine shared with another session's test runs.
No production code changed, and no cross-user hole was found.
