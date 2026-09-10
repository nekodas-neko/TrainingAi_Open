# Q-52 re-measured, 2026-09-10 — the precondition cleared, and clearing it broke the measurement

**Scope:** the outstanding *"re-run this once at least two sessions have cycled"* note on
[Q-52 — per-exercise phase hold](../implementation-backlog.md). Third measurement of this entry
(2026-08-03 ×2, then this one). All figures are production reads through `/api/admin/db-query`,
which is **row-scoped to the owner** — nothing here is a claim about any other account.

**Conclusion up front: do not re-run this query before mid-October.** It cannot answer the question
until the current program has cycled within itself, and re-deriving the table below teaches nothing.

---

## 1. The precondition is met

Eight `session_periodization` rows carry a `phase_started_at` after 2026-08-03 — **2026-08-16,
08-27, 09-01, 09-03, 09-06 (×2), 09-07, 09-09** — each marking at least one transition into its
current phase. (This is a lower bound on transitions: the table holds current state per
`program_session_id`, not history.) The 2026-08-03 finding that *"no session has transitioned since
the auto-apply fix shipped"* is no longer true.

## 2. But the program was rebuilt four days ago

| program | active | created | sessions |
|---|---|---|---|
| **Bankai** | **yes** | **2026-09-06** | 5 |
| Shikai | no | 2026-07-01 | 5 |
| AI-Phase1 | no | 2026-06-21 | 5 |
| Strength + Hypertrophy | no | 2026-05-23 | 3 |
| Main | no | 2026-06-05 | 5 |

Every one of the eight transitions above belongs to **Shikai**, whose `program_sessions` are now
inactive. Phase state is keyed by `program_session_id`, so the rebuild reset it:

| Bankai session | phase | since | note |
|---|---|---|---|
| Push | `baseline` | 2026-09-07 | `baseline_complete: false`, `baseline_1rm: {}` |
| Pull | `baseline` | 2026-09-06 | `baseline_complete: false`, `baseline_1rm: {}` |
| Legs | `accumulation` | 2026-09-09 | off a realisation block |
| Upper | — | — | **no `session_periodization` row** |
| Lower | — | — | **no `session_periodization` row** |

**Upper and Lower having no row is not a defect.** `ensureSessionPeriodization`
(`lib/data/postgres/slices/periodization.ts`) inserts lazily with `onConflictDoNothing`, and neither
session has been prescribed since the program was created. Checked, not filed.

## 3. The entry's recipe now straddles the rebuild

Last non-zero `estimated_1rm` vs the one before, over Bankai's exercises, with the owning session's
current phase. `prev` days fall in **2026-08-17…08-30 on Shikai**; `cur` days in
**2026-09-06…09-09 on Bankai**. Twenty-four rows (Barbell Hip Thrust and Hanging Leg Raise appear in
two sessions each), of which 16 have both values: **6 up · 10 down**.

The five declining compounds:

| Exercise | Session | Role | Phase | prev → cur | % |
|---|---|---|---|---|---|
| Barbell Hip Thrust | Legs | secondary | accumulation (09-09) | 160.75 → 114.25 | −28.9 |
| Barbell Overhead Press | Push | secondary | **baseline** (09-07) | 58.0 → 44.75 | −22.8 |
| Barbell Bench Press | Push | primary | **baseline** (09-07) | 103.75 → 82.75 | −20.2 |
| Barbell Squat | Legs | primary | accumulation (09-09) | 97.0 → 79.25 | −18.3 |
| Cable Pulldown | Pull | accessory | **baseline** (09-06) | 32.25 → 30.5 | −5.4 |

Three of the five sit in a `baseline` phase that has **not completed** — the app is re-anchoring
them from scratch — and the other two just entered `accumulation` off a realisation block. None of
these is a stall.

**This is the finding.** While nothing ever transitioned, last-vs-previous 1RM was a clean
progression signal, which is exactly why the 2026-08-03 measurement could be read at face value.
Once blocks actually cycle, a programmed drawdown and a stall look identical in it. **The
precondition and the recipe were mutually exclusive all along** — meeting one invalidates the other.
A future measurement needs to compare within a phase, or exclude `baseline` and the session after a
`deload`, rather than comparing the last two logs.

## 4. What this settles and what it does not

- The 2026-08-03 load-bearing claim — *"the feature would apply to a single exercise today"* — was
  computed against a program that no longer exists, so it is **unsupported rather than refuted**.
- The design is untouched: nothing here bears on `session_exercises.phase_offset`,
  `exerciseEarnedTransition` or `shiftPhase`.
- Earliest answerable date is **mid-October**, after Bankai's sessions complete baseline and cycle
  twice within Bankai, at the observed ~1 transition per session per 1–2 weeks.
- The entry stays queued and is **deliberately not gated**. `Gate:` resolves to a person
  (`owner`) or the S25 (`device`); what is owed here is elapsed training time, which no field
  expresses. Inventing a gate to park it would be the anti-pattern the gate-value check exists to
  stop.

## 5. Side finding: ten `estimated_1rm = 0` logs that are pre-Q-298 residue, not a defect

41 `exercise_logs` carry `estimated_1rm = 0`. **31 are `exercise_deloaded = true`** and correct per
the documented invariant (`projectOverview.md`: a deloaded set always stores `estimated_1rm = 0`).

The other **10** are two whole `Pull` sessions — **2026-08-09 and 2026-08-16** — storing
`estimated_1rm = 0` with `exercise_deloaded = false` on real working sets (Sumo Deadlift 82.5 kg × 6,
`use_for_1rm: true`, `planned_pct: 80`; Barbell Shrug 87.5 kg × 6; Bent-Over Barbell Row 30 kg × 6).

That is precisely the shape **Q-298 already fixed**. `packages/shared/src/workout/log-exercise.ts`
passes `deloaded: exerciseDeloaded === true || (isAnyDeload && !isBaseline)` to `estimateOneRm`
(which returns 0 for a deload) while the row *used* to store `exerciseDeloaded ?? false` — so a
phase-level deload zeroed the estimate and the row denied it. It now stores `deloadedForEstimate`.
All ten rows predate that change; no row after it has the shape.

**Nothing is owed for those ten rows.** Every 1RM reader excludes them via `estimated_1rm > 0`.

**But checking that turned up the thing that is worth an entry — and it is not what the code says
it is.** `getLastRealOneRmBatch` guards on `estimated_1rm > 0` **AND** `exercise_deloaded = false`,
justified by a comment citing a production violation: *"the whole-session deload of 2026-08-06 left
one log at estimated_1rm = 85.75 with exercise_deloaded = true"*. **That row no longer exists.**
Counted 2026-09-10 over all 444 `exercise_logs`, deleted rows included:

| shape | rows |
|---|---|
| `estimated_1rm > 0` and `exercise_deloaded = true` (the cited violation) | **0** |
| `estimated_1rm = 0` and `exercise_deloaded = false` (pre-Q-298 residue) | **10** |

2026-08-06 itself now reads consistently — a Lower session of five non-deloaded logs with real
values, and an Upper session of five deloaded logs at 0. The row was corrected or removed at some
point after the comment was written.

**The comment's evidence is stale; its argument is not.** A read-time backstop exists for the *next*
write-time regression, and "the row it was written for has since been fixed" is not "the shape
cannot recur" — so the filter stays, and the adapter comment now records both the correction and
the surviving opposite-direction residue.

What the check did expose is a **sibling-surface gap**: of six 1RM read sites, only two apply both
markers.

| site | `> 0` | `deloaded = false` |
|---|---|---|
| `getLastRealOneRmBatch` (`adapter.ts:1483`) | ✓ | ✓ |
| `reconcilePersonalRecord` (`adapter.ts:3402`) | ✓ | ✓ |
| `getYearReviewTopExercises` (`adapter.ts:1426`) | ✓ | ✗ |
| `listRecent1rm` (`adapter.ts:1683`) | ✓ | ✗ |
| `getStrengthTrend` (`slices/periodization.ts:469`) | ✓ | ✗ |
| `/api/strength-trend` (`route.ts:69`) | ✓ | ✗ |

Filed as **LA-96**, deliberately low in the queue: with zero rows of the offending shape the current
exposure is **nil**, so this is robustness, not a visible defect. The entry also notes that the last
two rows are the same 90-day query duplicated across a slice and a route — a **One Formula, One
Place** violation that, if resolved first, makes this a three-site change instead of four.

**Recorded rather than waved through** because a production read of `estimated_1rm = 0` looks like a
data-integrity bug, and it nearly became a filed one twice in a single session — once for the 31
rows the documented deload invariant already explains, once for these 10.
