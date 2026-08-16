# 2026-08-09 — 90% of the DB suite is blind to a total loss of user scoping

**Branch:** `test/ownership-mutation-coverage` · **Domains:** `platform`, `nutrition`

## The measurement

Q-155 had established that *one* cross-user leak passes all 3,270 tests. This turns that anecdote
into a number by mutation: rewrite every `eq(x.userId, userId)` to `eq(x.userId, x.userId)` — always
true, same shape — and every raw `user_id = ${userId}` to `user_id = user_id`, then count survivors.

**246 predicates neutralised at once. 286 of 317 DB tests still passed.**

The 31 failures are weaker evidence than they look: re-running gave a *different* failing set each
time (14–17 files), because with scoping gone the tests contaminate each other's rows depending on
execution order. That is incidental interference, not assertion. Only two files are named for the
property — `phase-set-ownership` and `oura-clock-anchor-scoping` — and just 7 of 71 DB test files set
up two users at all.

Per-file, **`nutrition.ts` (22 predicates), `body-battery.ts` (1) and `social.ts` (1) fail zero
tests** with every ownership check deleted. A quartile bisect of `adapter.ts` found two ranges — 69
predicates — behaving identically. **Lower bound: 93 of 246 unguarded (38%)**, and it is only a lower
bound, since 35 predicates producing 5 failures is not 35 covered predicates.

The uncovered set includes ten destructive writes and the bulk mutations `applyLbsToKgFix` and
`reconcilePersonalRecord`, where a scoping slip is silent and irreversible. **`updateInjury` is in
it** — the method CLAUDE.md names as *"the reference"* for the write-path ownership rule.

**The scoping is correct today.** Nothing here is a live leak. The finding is that almost none of it
is held in place by anything.

## What shipped

`repository-ownership-scoping.test.ts` — 9 tests over injuries, supplements, activity logs, mood
logs and body battery, reads and destructive writes. **9/9 pass clean, 9/9 fail under mutation.**

## The part worth carrying

**Two of those nine could not fail when first written.** `getBodyBatteryHistory` maps rows to a shape
with no `userId` field, so `expect(...).not.toContain(USER_B)` was unfalsifiable — it sat there
looking like coverage while providing none, and survived the mutation run that killed the other
eight. The body-battery case also had no seeded B row to leak.

Both were caught only because the tests were run *both ways*. Writing a test to fix a coverage gap
does not exempt it from the same standard: **a test never observed failing is not evidence of
anything.** The file says so, and says to check new cases by mutation before counting them.

The fix was to assert *emptiness* against a freshly-created user rather than absence of an id string
— a fresh user owns nothing, so any row at all is a leak, whatever the row shape.

## Not covered

DB suite only (317 tests), not the full ~3,270 — route and component tests may catch some of this and
were not measured. The quartile bisect bounds rather than attributes; exact per-predicate attribution
is ~5.5 h of runs. The mutation only touches `user_id` predicates, so ownership enforced by a join or
a pre-check like `ensureWorkoutSession` is unmeasured. Local Postgres only — no device, no APK, no
production data.

---

## Second pass, same day: the burn-down

The three zero-coverage slices were covered and re-measured with the same harness. The test file went
from 9 tests to **30**, every one verified to fail under mutation.

| target | before | after |
|---|---:|---:|
| all 246 predicates mutated at once | 31 of 317 detect | **70 of 357** |
| detecting test files | 14 of 71 | **20 of 72** |
| `adapter.ts` alone | 23 | **42** |
| `nutrition.ts` / `body-battery.ts` / `social.ts` | 0 / 0 / 0 | **12 / 1 / 2** |

**No slice is at zero any more.** Of the +39, 30 are the new tests directly; the rest is within the
run-to-run variance of the interference failures, so it is not claimed as newly-covered behaviour.

Two methods needed a specific test shape to be falsifiable at all. `deleteMealType` throws
`MEAL_TYPE_HAS_LOGS` *before* the ownership check, so it needs a second, log-free meal type — testing
it against a meal type with logs passes either way. `listSeasonsWithResults` reads a **global**
`seasons` table and scopes only the nested `season_results`, so a leak attaches B's rank to a season A
can legitimately see; the assertion has to be on the nested `result`, not the row count.

And a fourth unfalsifiable assertion turned up: `deleteFitnessTest` is a **soft** delete, so checking
that `test_type` still reads `'cooper'` could never fail. Four in one file, every one caught by the
same discipline of running each new test both ways.

## A process mistake worth recording

Mid-way through, `git checkout -- lib/data/postgres/` — used to revert a mutation — also reverted the
**uncommitted test additions**, because the test file lives under that path. Earlier runs had scoped
the revert to `adapter.ts` and `slices/` and were fine. About twenty minutes of work was lost and one
set of measurements was silently taken against the reverted file, reading as "no coverage added"
when the additions simply were not there.

The fix is the obvious one and it is now the habit: **commit before running a mutation experiment**,
and scope the revert to exactly the files the experiment mutates. A revert path that overlaps the
work is indistinguishable from a failed experiment in the output.

---

## Third pass: the bulk mutations, and no range left undetected

Covered the last named remainder — `previewLbsToKgFix`, `applyLbsToKgFix`,
`reconcilePersonalRecord`, `updateActivityLogMetrics`, `updatePrescribedRun`,
`updateGoalRecommendationStatus`. **36 tests**, all failing under mutation.

| target | original | now |
|---|---:|---:|
| all 246 predicates at once | 31 of 317 | **75 of 363** |
| detecting files | 14 of 71 | **21 of 72** |
| `adapter.ts` alone | 23 | **44** |
| quartiles [0,35) / [35,70) / [70,105) / [105,139) | 5 / **0** / 14 / **0** | 8 / **13** / 17 / **7** |

**Every quartile and every slice detects a mutation now.** The "93 of 246 provably unguarded" figure
was measured by exactly this method, and by that measure the provably-unguarded set is empty. That is
*not* "all 246 are covered" — the bisect bounds rather than attributes, and a range producing 7
failures is not 34 covered predicates. It means the method that found the gap can no longer find a
hole in it, which is the weaker and honest claim.

## Six unfalsifiable assertions, in one file

The running count is the finding. Every one was caught by running the new test under mutation as well
as clean, and none would have been caught by reading it:

1. `getBodyBatteryHistory` — maps to a row shape with no `userId`, so `not.toContain(USER_B)` had
   nothing to match.
2. The same test had **no seeded B row** to leak.
3. `deleteFitnessTest` — soft delete, so asserting an untouched column could never fail.
4. `deleteMealType` — throws `MEAL_TYPE_HAS_LOGS` *before* the ownership check.
5. `updatePrescribedRun` — only writes `status`/`updated_at`; the `run_type` assertion was inert.
6. `previewLbsToKgFix` — returns one `exercises` summary per **requested** name, derived from the
   argument, so asserting it empty **fails on clean code**. The real leak channels are `logs` and the
   `oldPersonalRecord` lookup.

Six in thirty-six. Writing an ownership test that cannot fail is the *expected* outcome, not an
unlucky one — which is the argument for mutation-checking every addition rather than spot-checking.

Number six also briefly looked like a **live cross-user leak**, which was worth two minutes of care
rather than a filing: `logs` was correctly empty and the `exercises` echo came from the input
argument. No leak. Had I trusted the red test and filed it, the report would have been wrong in the
most alarming possible direction.

---

## Fourth pass: the blind spot the mutation cannot see

Mutation neutralises `user_id` predicates, so it is structurally blind to ownership enforced by a
**join or a pre-check** — CLAUDE.md rule (c), covering the 21 tables with no `user_id` column. A
missing check is an *absence*; there is nothing to neutralise, so this needed a static audit instead.

All **50** writes to `user_id`-less tables were enumerated and classified: 12 carry `user_id` in the
statement, 14 are keyed on a parent/own id only, 1 uses a pre-scoped `inArray`, and 23 are INSERTs.

**13 of the 14 parent-id writes are correct**, and pleasingly so: `saveProgram`,
`saveProgressionStyle` and `updatePhaseSet` each run a user-scoped statement and **guard on the
affected-row count** before touching children, with comments naming the hazard and citing Q-129. The
`activity_types` methods only look unscoped — that table is a deliberately global catalogue behind
`requireAdmin`. The rule is being followed.

**One family is the exception — filed as Q-174.** `listVolumeTargets`, `upsertVolumeTarget`,
`deleteVolumeTarget` and `replaceVolumeTargets` take a `programId` and **no `userId`**, over a table
with no `user_id` column. `replaceVolumeTargets` is an unscoped `DELETE … WHERE program_id = $1` plus
re-insert — the same shape as the `saveProgressionStyle` incident. Safe today (its one caller passes
an id from the user's own `saveProgram`), and **two of the four have zero callers**: dead code with an
unscoped signature, which is precisely what the next feature reaches for.

## A scanner that found nothing, and was wrong

The first audit script reported **zero** hits. A raw `grep -c` contradicted it immediately — the
regex had been built by string concatenation inside `node -e` and the escaping was broken.

Worth stating because of the asymmetry: a scanner that reports a *finding* gets checked, because the
finding has to be written up. A scanner that reports **nothing** gets believed and closes the
question. Cross-check every clean result against a cruder tool before recording it. That is the same
failure as the six unfalsifiable assertions, one level up — the tool, rather than the test.
