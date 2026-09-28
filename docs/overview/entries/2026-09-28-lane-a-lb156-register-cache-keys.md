# 2026-09-28 — LB-156: five cache keys registered with the groups their writers call

LB-155's remaining bare-`fetch` conversions were blocked on five keys no group cleared. Re-verified
first: `phase-sets` and `workout-templates` were already in `invalidateProgramStructure`. The other
three:

- `day-checkin:` joined `invalidateCheckinAffectsPrescription`, the group the check-in POSTs call.
  Only `invalidateNutritionWrite` cleared it before, so a converted reader would have been evicted
  by a food log and left stale by the check-in that changed it.
- `bedtime-estimate` joined `invalidateBiometrics` and `invalidateOuraSync`, both sleep writers.
- `plan-meal-answers:` joined `invalidateNutritionWrite`. **Its writer calls no group at all**, so
  LB-155 must make that POST call it. This is recorded on LB-155.

Tests assert each group clears its key. Removing the check-in registration fails its test.

**Also re-sequenced Q-231** (retire the "Exercise detected" card): the surface half goes first,
because removing the route first would leave the card's GET and three review-sheet PATCHes hitting a
404. It is now Lane B. `repo.getOuraWorkouts` stays, because HR-recovery episode detection reads the
frozen rows.
