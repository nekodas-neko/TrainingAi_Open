# 2026-08-11 — a confirmed deload week now reaches the AI-dynamic prescription (Q-175)

**Branch:** `fix/early-deload-week-ignored-by-ai-dynamic-prescription` · **v1.279.1**

## What was wrong

The app has two ways to confirm a deload and only one of them reduced any weight.

Q-109 wired the pre-workout Full/Deload/Rest toggle (`?aiDeload=1`) into the AI-dynamic
prescription. Home's "Take deload week now" card takes the other route: `POST
/api/confirm-early-deload` writes `programs.earlyDeloadWeekStart` and passes no query param at all.
`isDeloadActive()` reads that field correctly — but it needs a `ProgramPhase` to consult, and an
`ai_dynamic` program has no phase rows. So `/api/workout-data` built its synthetic phase status with
`isDeloadActive: false` for the whole confirmed week, and `buildWorkoutExercises`'s deload branch
only ever checked `aiDeload`.

Result: for up to seven days, a confirmed deload week produced byte-identical numbers to a normal
week. The banner said deload, PRs were suppressed, and the bar was unchanged.

## The change

- `isEarlyDeloadWeek(program, today)` splits the window check out of `isDeloadActive` so it is
  answerable with no phase. `isDeloadActive` now calls it — one formula, one place.
- `/api/workout-data` reads it on **both** paths: the single-tab request (where it joins `aiDeload`
  as `aiDeloadNow`) and the `?tab=all` batch, which takes no query param and therefore had the
  early-deload week as its only possible deload signal.
- `buildWorkoutExercises` reads `aiDeload || isDeloadActive`, so both entry points converge on the
  one `deloadOverrideForGoal` mechanism. `p.deloaded` (the automatic per-exercise engine) still
  takes precedence, so the two reductions cannot compound.
- The base-style accessory-intensity bump gained the same guard. Its comment already said "skipped
  on baseline/deload" — it just could not see this deload.

## Verified

Measured against the running dev server, not inferred, with the local program switched to
`ai_dynamic` and an accepted prescription seeded:

| state | first exercise |
|---|---|
| no deload week | 82.5% × 4 sets, `deloaded` unset |
| after `POST /api/confirm-early-deload` | **50% × 2 sets, `deloaded: true`, `preDeloadSets: 4`** |
| `?tab=all` | same reduction, `isDeloadActive: true` on all three sessions |
| start 6 days ago | still reduced |
| start 7 days ago | back to 82.5% × 4 — window closes on schedule |
| `?aiDeload=1`, no week | 50% × 2 — the Q-109 path is unregressed |

Both unit-test additions were **verified by mutation**: dropping `|| isDeloadActive` fails two of
the new tests, dropping the accessory guard fails the third, and nothing else moves.

Full suite 436 files / 3478 tests green, lint and every custom-rules script pass.

**Not exercised: device.** Server read-path only — no offline-first domain, native plugin,
safe-area or gesture surface is touched, so the on-device gate does not apply. The visible change
reaches the APK through the Railway deploy with no rebuild.

## What this exposed, and did not fix

Filed as **Q-185**: the reduction lives inside `if (aiDrivesLoad)`, so an exercise the prescription
does not name is never reduced. Measured on the same run — the session's third exercise, an
accessory with no prescription entry, stayed at 75% × 3 while its two prescribed siblings dropped to
50% × 2, and whole sessions with no current prescription came back at full base-style load. This
predates Q-175 and both deload entry points share it; the honest fix is deciding what a deload means
for an exercise the AI is not driving, which is a load-changing decision worth making deliberately
rather than as a rider on a bug fix.
