# 2026-09-30 — BF-203a paused after Task 5: the plan's last tasks target a read path the phone does not use

**Branch:** `docs/bf203a-device-first-replan` · **Lane A** · docs only.

Tasks 1–5 merged (#2001 migration, #2004 local v45, #2002 decision module, #2003 storage). No estimate
is written yet, so nothing the owner sees has changed.

Before building Tasks 6 and 8, the read paths were traced, and there are three blockers:
- The device reads answers from the local store and never calls the GET route Task 8 materialises in.
- The Nutrition ring's centre sums LOCAL food logs, while its zone bar, "Eaten" and "kcal left" use the
  server's `intakeKcal`. A server-only estimate would split one card, and that split already exists
  whenever local and server logs differ.
- The outbox push routes every `plan_meal_answers` mutation to the decline path, so a device estimate
  would land as a decline.

The corrected shape is on the BF-203a entry: materialise on the device, give the push branch an
estimate route, carry `est_*` through the pull, and count intake in both places the ring reads. Task 7's
guard must target `packages/shared/src/nutrition/adaptive-tdee.ts`; the plan's two paths do not exist.
How the ring marks assumed calories is filed as **LA-185** (Lane O, mockup owed).
