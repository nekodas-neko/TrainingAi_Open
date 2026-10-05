# 2026-09-29 — LA-177: the nine styleless slots in the active program get their role's style

**Lane A · migration `202609290751_backfill_styleless_active_slots.sql` · production backfill
(authorised policy: ADD/backfill, with a verified snapshot and a count guard).**

- **Rule:** each `style_id IS NULL` slot in an ACTIVE program takes the style its ROLE uses most in
  that same program. A tie is broken by style name; a role with no styled slot is left alone, not
  guessed; inactive programs are out of scope. It is safe to re-run (the second run touches 0) and
  raises if the rows touched differ from the rows predicted.
- **On the owner's data** (fresh production snapshot of users, programs, program_sessions,
  session_exercises and progression_styles, restored locally with every count matching the
  manifest), applied through `scripts/local-db/migrate.js`: **9 rows, as predicted.**
  - The primary, Barbell Hip Thrust, gets Powerbuilding.
  - The secondary, Dumbbell Bulgarian Split Squat, gets Hypertrophy Plus.
  - The seven accessories get Hypertrophy 3-set: Cable Lying Leg Curl, Dumbbell Calf Raise, Cable
    Seated Leg Curl, Hanging Leg Raise, Face Pull, Cable Chest Dips and Barbell Skull Crusher.
  - Active styleless slots go 9 → 0; the inactive `Main`'s 5 are untouched.
- **Why now:** LB-186 made the editor and builder default a style, so the gap cannot re-open. This
  un-deads Lower's Full toggle (BF-198's rules revert skips a styleless slot) and gives Skull Crusher
  a per-set plan (TN-75 ①).
- **Supersedes LA-182**, which had asked the owner to assign the nine by hand.
- **Tests:** `la177-backfill-styleless-slots.test.ts`, covering majority by role, tie by name, the
  unlearnable role left null, inactive untouched, an already-styled slot untouched, and a second run
  as a no-op.
- **✅ Verified in production 2026-09-29:** migration applied at 11:43:24 UTC; the active program holds **0** styleless slots, and Lower reads primary → Powerbuilding, secondary → Hypertrophy Plus, accessories → Hypertrophy 3-set, as predicted.
