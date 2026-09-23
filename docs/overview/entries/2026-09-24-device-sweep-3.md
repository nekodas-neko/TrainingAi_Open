# 2026-09-24 — Device sweep 3: the tab-switch blank measured, three new Lane B defects, DV-15 twice more

**Branch:** `device/sweep-3` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

S25 Ultra, web v1.465.17, APK 1.460.4, **three-button navigation**, owner's account. Plan:
`docs/device-sweep-3-plan.md`. Production was watched every 30 s throughout, with no slow answer.
The admin BLE console stayed closed (DV-13). The phone showed 🔴 throughout and 🟢 at the end.

## Answers

| entry | result |
|---|---|
| **RV-128** | Every tab switch (10 of 10) shows **~60–110 ms with neither panel painted**. The outgoing panel hides in the same frame the incoming one activates at opacity 0. What shows through is the `html` colour/wallpaper. The answer now sits on RV-113; RV-128 is closed |
| **RV-129** | Warm visits paint no skeleton on Home, Health or More (9 of 9). **Nutrition paints one every visit** (3 of 3), for 300–460 ms, from `MealPlanSection` when there is no plan. RV-129 is closed and **DV-17** filed |
| **DV-12** | Lead: every tap re-runs a chart.js `update` that re-measures axis labels (the `font` setter, 7–48 ms per tap) |
| **BF-22** | Narrowed: 40 plain tab visits leak nothing (listeners 1,804 → 1,804) |
| **RV-125** | Every reader of a food write refetched. After the weigh-in, `weights-summary` and `health-trends` were fetched only once. Attribution to name a component is still owed |
| **DV-8** | Unchanged: the set row is still pending against an empty outbox; its session resolves locally |

## Checks

- **Passed and removed:** BF-95 (edge-strip swipe opens the tray; tab and day unchanged), BF-161 (the
  builder's rows and 651 kcal total match the sources; its Known-Issues row is archived), OR-118
  (one-line rows).
- **Passed, entry kept:**
  - BF-12: a saved meal's row appears in 271 ms and stays.
  - BF-49: the workout row goes back to Home in one press; the food row is untested.
  - BF-147: the admin rows and the sweep sheet look right; the S3 half is still owed.
  - Q-300: the card renders, but its data source wasn't isolated.
- **Failed:** **BF-61**. An immediate tap after the swipe raises no confirmation (2 of 2). After that
  swallowed tap, the next rightward swipe moves Nutrition to **Yesterday** (2 of 2).
- **Q-305 look:** the rows are red with no word beside them (colour-only state), while the body map
  above is all green.

## New entries

- **DV-16:** "Leave workout? Your workout is in progress" after the day's workout is done (2 of 2,
  after a restart). The persisted state says `mode: done`, so the cause is not established. Pressed
  *Stay* both times.
- **DV-17:** the meal-plan skeleton on every Nutrition visit.
- **DV-18:** the admin "AI style reference" image is broken.
- **DV-15:** reproduced twice more, now 3 in about 9 deletes. A traced delete shows a
  `GET food-logs` racing the push, which is a likely mechanism; still to be proven.

## Writes (all undone)

Lite Cheese logged 3×, Protein Granola 1× (saved meal), all deleted: the server list for the day is
empty and every local row is tombstoned. Weigh-in at today's own 69.8 kg (manual-sourced now). The
meal builder was cancelled with nothing saved (still 19 saved meals).

## Harness

- `rawSwipeThenTap` added: a guarded swipe and tap in one shell call.
- Runbook: token rAF samplers, recorder `t` is relative, scope reads to the active panel, and never
  press *Leave* on the workout dialog.

## Not exercised

Gesture navigation and insets, reduce-motion, TalkBack, the light theme, the admin BLE console, and
RV-114/RV-115.
