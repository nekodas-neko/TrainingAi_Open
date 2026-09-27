# RV-204 — the Workout Review without a model, and the recap that has not run since July

**Branch:** `feat/rv204-rules-workout-review` · **Lane A** · no migration

## The measurement was right and understated; the framing was wrong on the second half

RV-204 says workout-review and the recap "have code that already does their job; neither ran in
30 days", and prices the work as low priority on that basis. Checked against production first:

| section | calls, 60 days |
|---|---|
| prescription | 36 |
| health-insight | 28 |
| nutrition-scan | 28 |
| … | |
| **workout-review** | **0** |
| **workout-recap** | **0** |

Neither appears at all, over 60 days rather than 30. But those two zeroes do not mean the same
thing, and that is the finding.

**workout-review is opened by hand** from a sheet in Config. Zero is disuse.

**The recap fires automatically** from `done-screen.tsx` every time a workout is completed. In the
same window the owner completed **43** workouts (2026-07-30 → 2026-09-25) and
`ai_health_insights` holds **4** `session-recap` rows, the newest dated **2026-07-23**. No
`error_events` row implicates the route — the whole 30-day window is BF-110's own instrumentation.
So the route is not failing; it is never being called. **That is a fault, not disuse**, and
RV-204 ②'s fix — make the stat block the default on that screen — fixes nothing if the screen is
not reached.

## What shipped: ① only

The review's `generateObject` call is gone. `buildRulesReview`
(`packages/shared/src/workout/review/rules-review.ts`) runs `applyRoleSetPlausibility` →
`dropToBudget` and hands the result to `reconcileReview` exactly as the model's answer used to be
handed to it, so every guard, the duration estimate and the weekly-volume maths are untouched.

**The argument for replacing rather than falling back** (RV-202 ① added a rules *fallback* and kept
its model): what survived the model here was only the *choice* — `reconcileReview` already clamped
every number, refused unsafe drops, back-filled omissions and recomputed the totals. And that
choice is already made deterministically on every prescription by the same trim ordering. Running
it here is what makes a review and a prescription **agree**; before, the review could propose a
shape the prescription would never generate, with no way to tell which was right. The proposal is
also user-confirmed through a separate apply endpoint, so nothing auto-applies.

To avoid a second construction of the same inputs, `buildBudgetMuscleVolume` and
`buildTimedExercises` are now exported from `budget-stage.ts` and used by both. The extraction is
behaviour-preserving — the 147 existing `ai-periodization` tests pass unchanged.

`review/prompt.ts` and `review/schema.ts` were deleted with the call, along with
`prompt-bodyweight-units.test.ts`. `untrusted-text.test.ts` loses its third injection site with a
note saying why: the file it fenced no longer exists, and left in place the case would fail on the
read and read as a broken test rather than a retired surface.

## The mutation pass deleted a branch I had written

Six mutants, one control. Two survived the first run and both were worth having:

| mutation | killed |
|---|---|
| never drop, trim only | 4 |
| emit an explicit `keep` instead of omitting | 2 |
| write a drop reason here as well as in `reconcileReview` | 1 |
| skip `applyRoleSetPlausibility` | **0 → 1** (see below) |
| always run `dropToBudget`, never check whether trimming sufficed | **0 — equivalent** |
| **control:** name the budget in a local const first | **0 — survived, as intended** |

The last-but-one is the useful one. I had written a guard — trim first, only drop if still over —
and the mutant that removed it changed no answer. It could not: `dropToBudget` *is* "trim then
drop", running `fitToBudget` itself and entering its drop loop only while still over budget. The
guard was dead code dressed as a policy. It is gone, and the comment in its place says so.

`applyRoleSetPlausibility` survived because every fixture sat at 3 sets, plausible for all three
roles — a no-op on the whole file. A 9-set accessory fixture kills it now.

## Verification

Lint 0 errors, warnings level with `main`; `check-test-typecheck` at baseline (**87** files after
`prompt-bodyweight-units.test.ts` came out of it — the deleted file leaves the baseline in the
same PR, or the check fails on a row it can no longer find); Custom Rules **80 of 80**; full suite
**1,105 files, 10,330 passed / 87 skipped, EXIT=0**.

**Two enumerations had to let this route go, and both say on their face when that is allowed.**
`prose-guards.test.ts` lists every route whose prompt must carry the shared guards and states the
rule: *"A route leaves this list when its model call goes, never because the guards became
inconvenient."* RV-201 set the precedent when it took the model out of health-insight. Same here.
`untrusted-text.test.ts` loses its third injection site for the harder reason — the file it fenced
no longer exists, and left in place the case fails on the read and reads as a broken test rather
than a retired surface.

**The first "green" suite I read was not my run.** A `grep -c 'Error:'` that finds nothing exits 1,
which short-circuited the `&&` before `vitest`, so the log I tailed was a stale file and I nearly
shipped on it. Two failures were real once the suite actually ran. Capture the exit code from the
run itself (`… > log 2>&1; echo "EXIT=$?" >> log`) and never behind a pipe.

On the dev server, against the local database:

- `POST /api/workout-review/session/<id>` → **200 in 2.3 s** (cold), *"This session already fits
  its 51-min working budget, so nothing is changed."*, with real `before` numbers off the
  progression styles.
- Session budget dropped to 12 to force the other path: **one of two primaries dropped, the other
  kept** — the last-primary guard doing its job — the accessory dropped, both carrying
  `reconcileReview`'s fallback reason, and the summary naming them.

The wording says **"working budget"** deliberately: `signals.effectiveTimeBudgetMin` was 51 against
a session configured at 60, and the sheet shows the 60 beside this sentence. Without the adjective
the two numbers read as a contradiction.

## Not exercised

**The sheet itself was not rendered.** `confidence` is now a constant 1; it is never displayed —
it round-trips to the apply route, which stamps its own 1.0 over whatever it receives — but that
was read from the code, not seen.

**No device.** The review sheet opens from Config on the S25 and none of this was opened there.

**RV-204 ② is deliberately not built.** It is parked behind **LA-155**, filed from the measurement
above, which asks the device agent whether the done screen is reached at all after the last set,
or reached with a null `workoutSessionId` — every loader on that screen is guarded by the same
`if (!workoutSessionId) return`, so one null would disable recap, energy and HR together.
