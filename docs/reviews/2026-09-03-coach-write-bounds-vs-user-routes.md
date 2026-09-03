# The Coach's four undriven handlers work — and its number bounds are looser than the user's own form

**Date:** 2026-09-03 · **Agent:** Review 📖 (sweep 44) · **Pillars:** `[nutrition]` `[workouts]` `[platform]`
**Lens:** the gap the previous Coach review named in its own method section. The 2026-08-18 sweep drove
**one** of the five Coach domain handlers end to end and recorded the rest as *"read, not driven"*.
This drives the other four — `nutrition_targets`, `user_goals`, `injury`, `program_phase`,
`early_deload` — which is also the nutrition / workouts / coach intersection.

**The apply path is clean and stays clean.** All four handlers write correctly, undo correctly, refuse
another account's target with a 404, and refuse a stale proposal with a 409 carrying a drift array.

**One finding.** The bounds on the numbers a model can write are not the bounds the user's own screens
enforce on the same columns, and the Coach's are **looser on six of seven fields** — protein, carbs and
fat by 50×.

---

## 1. Method, and what it does not establish

Live against `pnpm dev` on the seeded local Postgres, as two authenticated accounts (**A** = seeded,
**B** = the harness's zero-data account). Every patch was hand-written and POSTed to
`/api/coach/apply`, and **every result read back out of Postgres**. A's rows were restored afterwards
(verified: 0 targets, 0 injuries, 0 `coach_changes`, `phase_mode` back to `manual`).

What this does not establish:

- **The model was never in the loop.** Hand-written patches are the correct way to test this path —
  the design deliberately keeps the model out of the write — but nothing here says whether the model
  *proposes* sane numbers. That matters more than usual given §3.
- **The web build, and the local database.** No device path, no production.
- `/api/coach/preview` was not probed. Still unprobed, as after the last sweep.

---

## 2. The four handlers, driven for the first time — all clean

| Domain | Patch | Result | Row after |
|---|---|---|---|
| `nutrition_targets` | `calories: null → 26000` | 200 | `calories = 26000` |
| `user_goals` | `waterGoalMl: null → 50000` | 200 | `water_goal_ml = 50000` |
| `injury` (create) | `muscleName → Chest`, `severity → moderate` | 200 | row created |
| `program_phase` | `phaseMode: manual → automatic` | 200 | `phase_mode = automatic` |
| `early_deload` | `deloadNow: false → true` | 200 | deload started |

**Undo works on all of them**, driven through `POST /api/coach/apply/[id]/undo`: `phase_mode` returned
to `manual`, the targets row went back to absent, and the created injury was **soft-deleted**
(`deleted_at` set) rather than removed — deliberately, so `getSyncDelta` has a tombstone to carry the
delete to other devices. That matters for **Q-467**, which asks for an Undo button to be wired to this
subsystem: the machinery behind that button demonstrably works for every domain, so wiring it is worth
doing rather than a leap.

**Both guards fire.** B applying against A's program id: `404 {"error":"Not found"}`, A's `phase_mode`
unchanged. A applying a proposal whose `from` no longer matches the world:

```
409 {"error":"This suggestion is out of date",
     "drift":[{"changeId":"s1","field":"phaseMode","expected":"manual","actual":"automatic"}]}
```

409 rather than 400, with the field named and both values given. This is good design and is recorded
as such.

**A near-miss worth more than the result.** The injury row was still present after its undo, which
read as "undo marks itself done and does not reverse the create". It does reverse it — the query
missed `deleted_at IS NULL`, and the handler's own comment explains the soft delete. Checking the
column before writing it up is the only thing that separated a finding from a fabrication.

## 3. RV-41 — the Coach can write numbers the user's own screens refuse

The patch schema bounds every goal number at `z.number().min(0).max(100_000)`, with this comment
directly above it:

> *"The upper bounds are not decoration: this is the one place a model's number reaches a stored goal,
> and **'set my calories to 26000' should be refused by the schema** rather than survive to a
> confirmation card that looks legitimate."*

**26,000 is accepted.** Driven as A:

```
POST /api/coach/apply  {"field":"calories","from":null,"to":26000}
  → 200 {"summary":"Calories 0 kcal → 26,000 kcal"}     stored: 26000
POST /api/coach/apply  {"field":"calories","from":26000,"to":100000}
  → 200 {"summary":"Calories 26,000 kcal → 100,000 kcal"} stored: 100000
```

The rendered summary — *"Calories 0 kcal → 26,000 kcal"* — is precisely the "confirmation card that
looks legitimate" the comment warns about. Only `100001` is refused.

### The same columns, through the user's own routes

| Field | User-facing route | Its bound | Coach bound | |
|---|---|---|---|---|
| `calories` | `PUT /api/nutrition/targets` | **20,000** | 100,000 | 5× looser |
| `proteinG` | `PUT /api/nutrition/targets` | **2,000** | 100,000 | **50× looser** |
| `carbsG` | `PUT /api/nutrition/targets` | **2,000** | 100,000 | **50× looser** |
| `fatG` | `PUT /api/nutrition/targets` | **2,000** | 100,000 | **50× looser** |
| `calorieGoal` | `PATCH /api/user/goals` | **30,000** | 100,000 | 3.3× looser |
| `waterGoalMl` | `PATCH /api/user/goals` | **20,000** | 100,000 | 5× looser |
| `stepsGoal` | `PATCH /api/user/goals` | 200,000 | 100,000 | *tighter* |

Measured, not read — the same values the Coach accepted were sent to the user routes in the same
session:

```
PUT   /api/nutrition/targets {"calories":26000}   → 400 "Too big: expected number to be <=20000"
PUT   /api/nutrition/targets {"proteinG":5000}    → 400 "Too big: expected number to be <=2000"
PATCH /api/user/goals {"waterGoalMl":50000}       → 400 "Too big: expected number to be <=20000"
```

Each of those three values was then written successfully through `/api/coach/apply`, and read back
out of Postgres.

**This is the "one formula, one place" shape applied to validation.** One stored column, two
validators, and the permissive one is the path an LLM writes through. The correct fix is for the patch
schema to import the same bounds the user routes use rather than restate them, so they cannot diverge
again — the divergence is the defect, not the specific numbers.

### The type diverges too, and it costs a 500

`stepsGoal` is `z.number().int()` on the user route and a plain `z.number()` in the patch schema:

```
PATCH /api/user/goals    {"stepsGoal":8000.5}  → 400 "Invalid input: expected int, received number"
POST  /api/coach/apply   stepsGoal → 8000.5    → 500 {"error":"Apply failed"}
```

The Coach schema accepts the fraction, the integer column rejects it, and a client input error
surfaces as a server fault — the same class as RV-40 (sweep 43), reached through a different door.
Unlike RV-40's routes this one writes **no** `error_events` row (measured: zero in a 10-minute window),
because the catch calls `errorLog` rather than `reportServerError`. So it does not pollute the fault
channel; it is also invisible in it.

## 4. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-41** | `[nutrition]` `[workouts]` `[platform]` | The Coach patch schema's goal bounds diverge from the user routes' bounds on the same columns and are looser on six of seven fields; its own comment names a value (26,000 kcal) it does not refuse; and a missing `.int()` on `stepsGoal` turns a client input error into a 500 |

**The apply path itself is not filed.** §2 is the evidence the previous sweep's "read, not driven" note
was owed.

## 5. Method notes

- **Test the comment, not just the code.** RV-41 was found by taking a doc comment's own worked example
  (*"set my calories to 26000"*) and sending it. A comment that states a guarantee is a test case.
- **When two surfaces write the same column, send the same value to both in the same session.** The
  divergence table is worthless read from source and decisive driven — and reading it from source is
  how you get the direction wrong.
- **Filter `deleted_at IS NULL` before concluding an undo did nothing.** Soft delete is the repo's
  convention for anything that must reach other devices, so a row still being present proves nothing.
