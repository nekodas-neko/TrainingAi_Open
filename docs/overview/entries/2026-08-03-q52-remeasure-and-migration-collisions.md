# 2026-08-03 — two backlog claims measured instead of assumed

_Branch `docs/measure-q52-and-migration-collisions` · docs-only · domains `workouts` / `platform`_

Both entries carried a claim nobody had checked. Neither needed a decision, a device or new data —
only somebody actually looking.

## 1. Q-52's priority rests on an audit that used a framing since corrected

Q-52 (per-exercise phase hold) was deprioritised on the strength of a same-day production audit:
*"of 26 tracked exercises, 22 are progressing and exactly one primary/secondary compound is genuinely
stalling."* Two of the four exercises it dismissed as artifacts were the bodyweight ones — and
v1.252.4 established that reading was wrong.

Re-measured over the **active program's 25 exercises**, last logged 1RM vs the one before, with roles
read from the active program:

**18 up · 3 flat · 4 down.**

| Exercise | Session | Role | Type | prev → cur | % |
|---|---|---|---|---|---|
| Dumbbell Lateral Raise | Push | accessory | weighted | 14.3 → 12.5 | −12.3 |
| Hanging Leg Raise | Legs | accessory | bodyweight | 119.3 → 113.5 | −4.8 |
| Dumbbell Preacher Curl | Pull | accessory | weighted | 24.5 → 24.3 | −1.0 |
| Cable Pulldown | Upper | **secondary** | weighted | 30.3 → 30.0 | −0.8 |

**The conclusion survives:** exactly one primary/secondary compound is declining, so the feature
would still apply to a single exercise. That is the claim the deprioritisation rests on, and it holds.

**Three of the four supporting claims did not:**

1. **Cable Pulldown is a `secondary`, not a primary.** The original joined `session_exercises` across
   every program including inactive ones, so it picked an arbitrary role row. This matters — the hold
   predicate keys off role.
2. **The bodyweight movements are not artifacts.** A bodyweight `estimated_1rm` is a BW_REF-relative
   index that is monotone in reps, so its trend reads exactly like a weighted lift's. **Pull-Up is
   +4.6% and belongs in the "progressing" column.** Hanging Leg Raise's −4.8% is a real decline in
   reps. Both are accessories, so neither changes the hold verdict — but the arithmetic was wrong,
   and the reasoning ("meaningless, therefore excluded") would have kept being repeated.
3. **26 tracked / 22 progressing** doesn't match the active program, which holds 25.

Right on one count: Barbell Front Squat really has left the program.

**The "re-measure once blocks cycle" note is still outstanding, and now has a date.** Four of five
sessions (Legs, Pull, Push, Upper) sit in `accumulation`; only Lower has moved, on 2026-08-01 —
*before* v1.252.0 landed. **No session has transitioned since the auto-apply fix shipped**, so the
picture that fix might change has not yet had the chance. Re-run once at least two sessions cycle.

## 2. The four migration-number collisions are harmless — verified, not assumed

`migrate.js` applies in plain filename sort order, so a duplicate number makes apply order ambiguous
**only when the two files touch the same object**. The J1 residual flagged four pairs and recorded
the 146 one as *"unverified for that pair specifically."* All four checked:

| # | file A writes | file B writes |
|---|---|---|
| 081 | `exercise_library` (ALTER) | `exercise_media` (CREATE TABLE) |
| 087 | indexes on `body_metrics`/`exercise_logs`/`sleep_sessions`/`workout_sessions` | `oura_tokens` columns |
| 146 | `UPDATE workout_sessions` | `CREATE TABLE running_baselines` |
| 161 | `activity_logs` (ALTER) | `oura_ble_clock_anchors` + `oura_raw_samples` (ALTER) |

Every pair is disjoint, so either order yields the same schema. Closed with no action.

**The rule stands unchanged** — claim a migration number against the directory *and* open PRs and
plan docs. This closes the four that exist; it does not make the next one safe.

## Method

`POST /api/admin/db-query` against production (read-only, owner-scoped) for the exercise measurement
and the phase state; `grep` over `lib/data/postgres/migrations/` for the collisions. No code changed,
no version bump.
