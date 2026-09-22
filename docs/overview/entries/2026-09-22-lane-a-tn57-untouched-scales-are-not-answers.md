# 2026-09-22 — Lane A · TN-57: an untouched scale is not an answer

Tuning filed this answering the owner's *"what is your suggestion to get better tuning and have it be
more accurate"*. It is the answer: every calibration to date was fitted partly to a number nobody
gave.

## The defect

The morning check-in sheet seeds `perceivedRecovery` and `sleepQualityFeel` from a neutral constant,
tracks whether the lifter actually moved each one, and posts both the value and the flag. The route
stores both. **The row has always been honest. Every reader was not.**

The schema said what to do about it when the columns were added (Q-113): *"a calibration query must
filter on these before trusting perceivedRecovery/sleepQualityFeel as real self-report."* Nothing
ever did.

Re-measured on production 2026-09-22, the owner's rows (`claude_ro` is row-scoped), 97 morning
check-ins since 2026-07-02:

| | |
|---|---|
| rows carrying a `perceived_recovery` | **78** |
| of those, ever touched | **0** |
| distinct values | **2** · standard deviation **0.286** |
| `sleep_quality_feel` touched | **3 of 97** |

The entry measured 96/77 the day before; it is 97/78 now, so the untouched population is still
growing — which is the pass test it set.

## Five corrections to the entry, one of which would have broken production

**1. The write-path instruction, as written, drops the check-in.** The entry says *"a body carrying
only untouched defaults now counts as carrying no answers."* Traced: the morning sheet posts these
two scales, `illnessContext`, an empty `soreMuscles` and a null journal — nothing else that
`dayCheckinHasAnswers` counts. So nulling before the guard makes an untouched save carry no answers
at all. On the web route that is a 400. In `pushMutations` the same guard rejects the mutation
**per-item with no retry** — the poison-pill path — so the row never reaches the server. And
`session-select-content.tsx` re-opens the sheet until a row exists for the day. The owner has never
touched the control, so **every one of his daily check-ins would have stopped syncing.** The guard
now reads the submitted body and the nulling applies to what is stored. Submitting the sheet is an
act worth recording; what it is not is a self-report.

**2. "Three readers" is two readers and a comment.** `body-battery/stress-day/route.ts:17` does not
read `perceivedRecovery` — the only occurrence in the file is a docblock sentence observing that it
reads 3 on all 17 days. Nothing to change there.

**3. A sibling sweep found three more consumers the entry did not name.** `admin/sleep-feel-
calibration` (the exact twin for the other scale), `score-audit/build-day-audit.ts` (displays the
value and a derived label), and `ai-periodization/signals.ts` → `prompt.ts`, which tells the model
*"Morning check-in (1=best, 5=worst): recovery 3"* as the lifter's own report. All five now resolve
through one helper.

**4. `recap`-style line numbers had drifted**, so each reader was located by grep rather than by the
cited line.

**5. My own claim that the sleep-feel route had no test was wrong.** It has one —
`lib/__tests__/admin-report-calibration-routes.test.ts`. I had run a file selection that excluded it
and read the pass as coverage; the full suite found both its fixture and the battery route's,
neither of which set a touched flag. Both moved, each with a new case pinning the untouched
semantics beside the date-keying they were written for. A targeted run still cannot tell you what
you broke.

## What shipped

`packages/shared/src/health/self-report.ts` — `answeredMorningScales(row)`, one place that decides
whether a scale was answered. Five readers and both write paths go through it.

**No migration, no data write, and the 78 rows are deliberately not backfilled** — the flag already
tells them apart, so a write buys nothing and destroys the record of how long this ran.

**On the periodization prompt:** no weight, threshold or formula moved. The only change is that a
value the lifter never supplied is no longer stated to the model, which is the same rule
`PROSE_GUARDS` applies to output.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. It caught two real defects in my own test code: a
  `toISOString().slice(0, 10)` in a fixture, and a zero-arg mock declaration on `saveDayCheckin`
  whose `.mock.calls[0][1]` reads as `undefined` — a test that looks like it inspects the write and
  cannot.
- Full suite green; `check-test-typecheck` none above baseline.
- **Mutation pass: 6 mutations caught, 2 equivalent controls passed.** The load-bearing one is
  correction 1: nulling before the guard fails four cases, including the pre-existing Q-465 test
  *"accepts what the morning sheet sends"*. The repo's own suite already guarded the trap the entry
  walked into.
- **`pnpm dev` against the local database.** An untouched morning POST returned **201** with
  `perceivedRecovery: null` — the row still writes. A touched one stored **5**. The battery
  calibration then showed `rating: 5` on the touched day and `rating: null` on the untouched one;
  sleep-feel showed `feel: null` throughout (nothing has ever been touched); health-trends answered
  *"Not enough paired data yet"* with no buckets; and `/api/admin/day-review` returned
  `perceivedRecovery: 5` for the touched day and `null` for the untouched one, with the sleep-feel
  label nulled alongside its value.

**Expect the correlations to EMPTY rather than shift.** That is the correct outcome and must not be
rescued by relaxing the filter: three answers that are real beat 78 that are not.

## Not exercised

Sandbox only; nothing native, offline-first at the UI layer, safe-area or gesture. The outbox half
is covered by the web/push parity integration test against the local Postgres, not on the device.

`ai-periodization/signals.ts` is the one reader **not executed** — `aggregateSignals` needs a full
program fixture, and stubbing it was judged out of proportion. It is covered by the shared helper's
unit tests, by typecheck, and by a new prompt test pinning the consequence (an unanswered scale
renders as an em dash, never as a number or the word "null"). Reviewing the diff is how the wiring
itself was checked.
