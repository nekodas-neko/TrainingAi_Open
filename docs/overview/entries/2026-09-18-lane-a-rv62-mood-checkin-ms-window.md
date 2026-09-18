# 2026-09-18 — RV-62: the banned ms-offset window was mine, and it is not hygiene

**Branch:** `lane-a/rv62-mood-checkin-ms-window` · **Lane A** · no migration · unversioned

## What it was

`deriveSuggestedSoreMuscles` built its recovery window as
`new Date(Date.now() - 7 * 86_400_000)` — the exact form CLAUDE.md's Date Arithmetic rule names:
*"Range/window starts anchor at the user's local midnight, never `now − N×86400000`."*

I wrote that line this morning, in BF-173. Review sweep 50 caught it the same day, and correctly
noted it is new rather than inherited debt.

## The question the entry left open, and the answer

RV-62 flagged as **not established** whether the day-boundary skew can actually flip a provenance
verdict, and said it was *"worth constructing rather than assuming — it changes whether this is
hygiene or a live scoring defect."* Constructed:

**It cannot flip one directly.** `suggestedSoreMuscles` only considers muscles whose latest bout is
within `SORENESS_EXPECTED_WITHIN_HOURS` (48). A session at the seven-day edge is ~168 hours old, so
it is never eligible on its own. The obvious worry — a workout drops out of the window and its
muscle stops being suggested — is not reachable.

**It can flip one through the median.** `computeMuscleRecovery` takes the MEDIAN bout volume per
muscle as `typical`, and `tau = min(48, max(16, 24 × latest.volumeKg / typical))`. An old, heavy
bout entering the window raises the median, lowers the ratio, lowers `tau`, and therefore *raises*
the recovery percentage of a recent bout — across the 85 line if it was near it.

Pinned deterministically: a chest bout 40 hours old at 1,000 kg reads **81 → suggested**; add a
167-hour bout at 3,000 kg and the same recent bout reads **92 → not suggested**.

So: a live scoring defect, not hygiene — but narrow, and only for a muscle already sitting near the
threshold. Worth stating precisely so it is not re-derived later as either.

## What shipped

- The window anchors at `dateStrMidnightInTz(shiftDateStr(logDate, -7), timezone)`. **Keyed on the
  check-in's own date**, which is stricter than the entry asked: a check-in saved for a particular
  day reads the seven days ending on that day, not the seven ending now. Normally the same day, and
  it costs nothing.
- `saveMoodLog` takes `timezone` (defaulted to `DEFAULT_TZ`, the repo's own pattern for day-window
  helpers). One caller — `app/api/mood/route.ts` — passes the session tz.
- The entry's second half: `listExerciseLibrary()` selected every column of the whole catalogue on
  every check-in save. `computeMuscleRecovery` takes `Pick<ExerciseLibraryEntry, 'name'|'muscles'>[]`,
  which is exactly what `listExerciseMuscleMap()` already returns — a narrower query, same result.

## The tests, and what they do not prove

**Three DB tests** (`rv62-provenance-window-anchoring.test.ts`) run in a zone computed from the
current UTC hour so local time is ~01:00 on every run, per `local-day-fixture-anchoring.test.ts` —
a test that waits for the real clock to enter the hazardous band fires two hours a day and passes
the rest of the time, which is how this class survives. Verified: at UTC 13:00 the helper yields
`Etc/GMT-12`, local hour 01.

**They all pass against the old code too, and that is stated rather than glossed.** They assert the
anchoring's shape — the call succeeds at 01:00, two days are keyed independently, an empty check-in
short-circuits — not the numeric flip. Building a DB fixture that lands a bout between the
UTC-anchored and local-midnight-anchored window starts would depend on the hour the suite runs, which
is the fragility this class already has.

The flip is proved instead by **three deterministic unit tests**
(`rv62-window-edge-can-flip-a-verdict.test.ts`), which need no database and no clock: 81 → 92 when
the old bout joins, and a third case asserting the half that is *not* reachable, so the narrow claim
is not mistaken for a broad one.

**A fixture bug worth recording.** The first draft built sessions with a `sets` array.
`computeMuscleRecovery` reads `ex.volume` and never sums sets, so every bout carried zero volume,
the ratio fell back to 1, tau was flat at 24, and the test reported 81 in both cases — hiding the
exact mechanism it was written to show. The assertion was right and the fixture was wrong; I fixed
the fixture.

## A gate my local routine was missing

CI's **Build** job failed on this PR while `tsc --noEmit -p tsconfig.json` was clean locally. The
failing step is `scripts/check-test-typecheck.js`, which typechecks **test files** against
`tsconfig.tests.json` and a per-file baseline — a different project from the one the app typecheck
uses, so test-only type errors are invisible to it.

The error was a wrong import path in the new unit test: `WorkoutSession` comes from
`@trainingai/shared/types/log`, not `.../types/workout`. Vitest ran the file happily because the
import is `import type`, erased at runtime — so a green test run proves nothing about it.

Fixed by correcting the import, **not** by raising the baseline: the baseline exists for files that
legitimately grew, and this file is new and had no entry. The gate now reports 320 errors across 90
files, none above baseline.

**The routine changes:** `npx tsc --noEmit -p tsconfig.tests.json` (or `node
scripts/check-test-typecheck.js`) belongs in the local gate alongside `pnpm check:rules` whenever a
PR adds or edits a test file. `pnpm check:rules` does not cover it — the step lives in the Build job,
not Custom Rules.

## Verification

`tsc --noEmit` clean · Custom Rules **75 of 75** · the pre-existing BF-173 suite
(`mood-sore-provenance.test.ts`) passes **6 of 6 unchanged**.

## Not exercised

- **The S25 device** — server-side only, reaches the phone through a Railway deploy with no APK.
- **A real check-in at a real day boundary.** The DB tests place the *user* near 01:00; they do not
  wait for the server's own clock to cross a boundary mid-write.
- **The median flip against production data.** Demonstrated on constructed volumes; no production
  check-in was re-derived to see whether any real day changes.
