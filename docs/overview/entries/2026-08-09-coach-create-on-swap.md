# 2026-08-09 — Swapping in an exercise the catalogue has never heard of

**Branch:** `feat/coach-create-exercise` · **v1.276.0**

The owner, after watching the repaired swap flow work on device: *"can we add the ability to add new
exercises from here too? i.e I want to add in Jefferson curls to swap with bent over row"*.

A Jefferson curl is not in `exercise_library`, and the swap path refuses a name it cannot find —
correctly, since that is also what catches a typo.

## One confirmation, not two

The alternative was an `exercise_library` domain that creates the entry, followed by a separate swap.
That means confirming a catalogue row in isolation, which is not a thing anyone wants to think about.

Instead the create rides in the same `session_exercise` patch as two extra change rows —
`newExerciseMuscles` and `newExerciseEquipment` — so the confirmation shows both halves:

| | |
|---|---|
| Exercise | Barbell Romanian Deadlift → Jefferson Curl |
| New exercise trains | — → Hamstrings, Lower back |
| New exercise equipment | — → Barbell |

with the measured consequence above it:

> Adds "Jefferson Curl" to the exercise library, recorded as training Hamstrings and Lower back
> Stops training glutes in this session

**The muscles are the point of showing it.** They drive deload weighting, muscle recovery and volume
ACWR. A model authoring them is exactly why they are a visible, rejectable row rather than something
inferred at apply time — and why the coverage delta is now computed from the *proposed* muscles
instead of going silent because the catalogue has no entry yet.

## Admin-gated, matching the existing policy exactly

`exercise_library` is one shared catalogue with a unique name — a row one person adds is a row
everybody sees — which is why `POST /api/exercises` already gates creation behind `isAdminUser`.
Coach uses the same gate and refuses with *"Adding X to the shared exercise library needs an admin
account"*. **Widening that to all users is an owner decision, not a side effect of adding a widget.**

A plain swap to an unknown name still refuses with the original message: the create path is only
reachable when the patch carries `newExerciseMuscles`, so a typo cannot create anything.

## A bug this found in what shipped this morning

Undo restored `exercise_name` and `muscle_groups` but **not `exercise_id`**. So an undone swap left
the row displaying *"Barbell Romanian Deadlift"* while its foreign key still pointed at
*"Jefferson Curl"* — invisible to anything reading the name, wrong for anything reading the link.
Observed live, fixed, and covered by a test that asserts the join, not the string. Pre-existing from
phase 3; nothing to do with the new capability.

The catalogue row itself is deliberately **kept** on undo: other sessions and logged history may
already name it, and undo is about reversing the change that was made, not erasing an exercise.

## Verification

Live against the dev server, signed in as an admin:

| Check | Result |
|---|---|
| Live model, *"add in Jefferson curls to swap with my Barbell Romanian Deadlift"* | one turn: read program → `findSwapCandidates` (no match) → proposed the swap **with** `Hamstrings, Lower back` and `Barbell` |
| Preview | announced the creation and the coverage delta |
| Apply | catalogue row created with `created_by`, session row swapped and **linked** |
| Undo | name, muscle groups and the catalogue link all restored; library row kept |
| Non-admin | refused, and **nothing written** — no library row, session row untouched |
| Typo (`Bent-Ovr Barbel Rw`) | still refused, nothing created |
| Suite | 425 files / **3397 tests** green · build · lint · all custom-rules scripts |

**Not exercised: device.** The whole flow was driven through the API and the model against the local
DB. Nothing here is native, but the confirmation card now renders two extra rows and that width has
not been seen on the S25.

**Also untested: a non-admin on production.** The gate is asserted in a test against a seeded
non-admin user; whether the owner's own account is admin in production was not checked from here.
