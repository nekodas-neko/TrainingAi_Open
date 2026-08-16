## 2026-07-29 — Q-5b follow-up: the cable exercises the owner confirmed are one movement

**Branch:** `fix/cable-exercise-merge` · migration 164 · closes the half of Q-5b that 163 left open

Migration 163 deliberately declined two of the five name merges its plan called for: both sides of
each pair were real `exercise_library` entries and both were actively logged, so collapsing them is
a statement about what the movements *are* — the owner's call, not data hygiene. Asked, and the
answer added a third member nobody had spotted:

```
Cable Lat Pulldown    ─┐
Straight Arm Pulldown ─┴─>  Cable Pulldown
Cable Crunch          ───>  Cable Crunch Abs
```

`Straight Arm Pulldown` is one of the five rows 163 had just corrected (34.5 → 32.5), so it moves
straight from being reconciled to being merged away.

### The surviving name is the one the active program uses

Not the tidiest spelling — `Shikai` (active) references `Cable Pulldown` in Upper and
`Cable Crunch Abs` in Lower. Renaming onto a name the active program does not use would re-split the
history on the very next session, which is the failure this whole exercise exists to stop.

Effect, measured against production before writing: `personal_records` **33 → 30**;
`Cable Pulldown` 36.00 from 14 logs (was 11), `Cable Crunch Abs` 39.75 from 16 (was 15). Neither
absorbed variant beats its survivor, so no displayed number goes down.

### A real bug the tests caught

Two variants map onto `Cable Pulldown`, and the first draft renamed orphan variants with a blind
`UPDATE … WHERE NOT EXISTS (canonical row)`. For a user with both variants and no `Cable Pulldown`
row, that renames **both** to the same name and violates the `(user_id, exercise_name)` unique key —
aborting the entire migration, not just that row.

163 is safe from this by construction (its three variants map to three distinct canonicals), which
is exactly why it didn't surface until now. Fixed by renaming exactly one row per
`(user, canonical)`, and reordering so the *rename* runs before the *raise* — otherwise the second
variant is deleted without ever being compared against the survivor the rename just created. The
same restriction was needed on `session_exercises` and `exercise_estimates`.

### A test that passed either way, and what fixed it

"keeps the higher number when a variant held it" passed with the raise step deliberately removed,
because the step-4 re-derive over merged logs reaches the same answer. The raise is only
load-bearing when the survivor has *no* logs to re-derive from. Added a case with no logs at all,
which fails without the raise — the first version was testing the wrong mechanism.

### Verification

Full suite **2,772 passing**; `tsc`, lint clean. 11 DB-backed tests; **three mutation-checked**
(skip the log rename → 2 red; drop the raise → the new no-log case red).

Run twice against a local fixture of the production shapes: 5 rows → 2, byte-identical on re-run.
Variant-only user renamed rather than deleted; cross-user isolation held.

### Left open — Q-26

The merged-away `exercise_library` rows stay in place (that table is global, not per-user), so
`Cable Lat Pulldown`, `Straight Arm Pulldown` and `Cable Crunch` remain **selectable in the exercise
picker**, and picking one re-opens the split. Filed as Q-26 with a recommended fix (an
`is_hidden`/`merged_into` column so the picker filters them and can point at the survivor). Low
urgency: the active program references only surviving names, so it takes a deliberate pick.

### Not exercised

Has not run against production — that happens on deploy. The 33 → 30 count and both survivor values
were computed by running the migration's own selection logic against prod read-only.
