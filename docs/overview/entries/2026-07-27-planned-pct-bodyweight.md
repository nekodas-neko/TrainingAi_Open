# Q-14 — bodyweight sets recorded a prescription they were never given

`set_logs.planned_pct` stored the progression style's nominal percentage, while `intensity_pct` is
BW_REF-relative. For a bodyweight movement that percentage is never a load target: `resolveBodyweightStyle`
converts it into a **rep** target, because bodyweight carries no %1RM. So the two columns could never
agree, and every bodyweight set recorded a phantom 14–18 pp overshoot — Pull-Up planned 75.0 / actual
88.5, Hanging Leg Raise planned 68.0 / actual 83.9 (×3). All eight ≥2 pp deviations in production
were this. The weighted exercises deviate by ≤2.3 pp, which is real autoregulation.

## Owner decision

Of the three options offered, the owner chose: **NULL `planned_pct` where no %1RM was prescribed, and
record the prescribed rep target instead.** `planned_reps` is written for **every** exercise type, not
just bodyweight — the style carries a rep target for weighted work too, and having it makes "was the
prescription delivered" answerable everywhere rather than only where it broke.

## What shipped

- `planned_reps` on `set_logs` and `set_hr_stats` (migration 153), written by
  `logExerciseFromPayload` — the single shared write function, so the web route and `pushMutations`
  get it identically.
- `plannedPct` is `undefined` for `exerciseType === 'bodyweight'` at that one site. The decision
  lives only there on purpose: the local store has no exercise-type table and cannot make it.
- Migration 153 clears the 6 historical bodyweight rows. Predicate-driven and idempotent.
- Local SQLite v19 + the `RECONCILE_COLUMNS` row (the `ALTER` is not idempotent, so reconcile is the
  real authority after a partial upgrade), the pull-delta upsert, the sync-engine mapping, and
  `LocalSetLog`.
- `sync-helpers` now replays the **prescribed** reps rather than the performed ones. It previously
  reconstructed `progressionStyle` with `reps: s.reps` — harmless while nothing read that field, but
  the server now derives `planned_reps` from it, so a replay would have recorded what was performed
  as what was planned. Rows written before `planned_reps` existed fall back to the old behaviour.

`planned_reps` is deliberately left NULL on the historical rows. It is reconstructible as
`floor(pct/100 × repMaxFromOneRm(1RM-at-the-time))`, but that 1RM has since moved, so the result
would be a plausible invention rather than the target the lifter was actually shown.

## Also closed a pre-existing gap

Regenerating the `claude_ro` audit views (migration 154) picked up `activity_logs.elevation_profile`
as well — migration 151 added that column without re-running the generator, so it had been invisible
to the read-only audit surface. The schema is default-deny, so an unregenerated view is a silent
blind spot rather than an error.

## Verification

Full suite **2,431 passing** (11 new), typecheck, lint and both custom-rule checks clean. New tests
cover the write path (bodyweight writes no pct, weighted keeps it), the migration against a real
Postgres (clears bodyweight, leaves weighted, idempotent, both columns added), and the two replay
paths in `sync-helpers`.

**Not exercised — on-device.** The local-store migration and the outbox replay were tested in the
sandbox only; native SQLite does not run here. The v19 `ALTER` is the exact shape that has twice
killed the local DB on Android, which is why the reconcile row ships in the same commit.
