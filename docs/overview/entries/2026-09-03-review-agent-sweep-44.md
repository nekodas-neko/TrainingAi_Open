# Review sweep 44 — the Coach's four undriven handlers, and the bounds on what a model can write

**Date:** 2026-09-03 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-44` · Docs only.

The owner asked for the nutrition, workouts and coach domains. Their intersection is the Coach's write
path, and the 2026-08-18 review of it named its own gap: it drove **one** of the five domain handlers
end to end and recorded the rest as *"read, not driven"*. This drives the other four.

**The apply path is clean and stays clean.**

| Domain | Patch | Result |
|---|---|---|
| `nutrition_targets` | `calories: null → 26000` | 200, stored |
| `user_goals` | `waterGoalMl: null → 50000` | 200, stored |
| `injury` (create) | `muscleName → Chest`, `severity → moderate` | 200, row created |
| `program_phase` | `phaseMode: manual → automatic` | 200, stored |
| `early_deload` | `deloadNow: false → true` | 200, deload started |

Undo works on all of them — `phase_mode` back to `manual`, targets back to absent, and the created
injury **soft-deleted** so the sync delta carries a tombstone. That strengthens **Q-467**, which asks
for an Undo button: the machinery behind it demonstrably works for every domain. Both guards fire too
— another account's target is `404`, and a stale proposal is `409 {"error":"This suggestion is out of
date","drift":[{"field":"phaseMode","expected":"manual","actual":"automatic"}]}`.

**RV-41 is the finding, and it came from testing a comment.** The patch schema bounds every goal number
at `max(100_000)`, directly under:

> *"'set my calories to 26000' should be refused by the schema rather than survive to a confirmation
> card that looks legitimate."*

26,000 applies. So does 100,000. Only 100,001 is refused, and the card renders *"Calories 0 kcal →
26,000 kcal"* — the confirmation card the comment warns about.

The same columns have a second validator on the user's own screens, and it is the tighter one:
`calories` 20,000 vs 100,000, `proteinG`/`carbsG`/`fatG` 2,000 vs 100,000 (**50×**), `waterGoalMl`
20,000 vs 100,000, `calorieGoal` 30,000 vs 100,000. `stepsGoal` is the single field where the Coach is
tighter — and it loses its `.int()`, so `8000.5` is a clean 400 on the user route and
`500 "Apply failed"` on the Coach's, the RV-40 class through a different door. The fix is to import the
user routes' bounds rather than restate them; restating is what let them drift.

**Two near-misses the sweep corrected itself on.** An injury row still present after its undo read as
"undo does nothing" — the query was missing `deleted_at IS NULL`, and the soft delete is deliberate.
And the `stepsGoal` 500 writes **no** `error_events` row (measured: zero in a 10-minute window),
because the catch calls `errorLog` rather than `reportServerError` — so it neither pollutes the fault
channel nor appears in it, which is a different claim from RV-40's and had to be checked rather than
carried over.

**Not exercised:** the device; production; `/api/coach/preview`, still unprobed. **The model was never
in the loop** — every patch was hand-written, which is the right way to test this path but means
nothing here says whether the model proposes sane numbers. Given RV-41, that gap now matters more.
A's rows were restored afterwards (0 targets, 0 injuries, 0 `coach_changes`, `phase_mode` back to
`manual`).

Write-up:
[`docs/reviews/2026-09-03-coach-write-bounds-vs-user-routes.md`](../../reviews/2026-09-03-coach-write-bounds-vs-user-routes.md).
