# Review sweep 55 — the device checks nobody can see

**2026-09-24 · Review · docs only.** Read against `main` at `1351f6de`. `projectOverview.md` line
numbers below are as of that commit and will drift. Search for the heading instead.

The owner asked whether there is more the device agent (DV) could check. DV works from two lists:
`node scripts/next-item.js --lane DV` and `--sittings`. Both read **only the backlog**. This sweep
looked at the three places a device check can hide from them:

| where the owed check lives | found | how DV sees it now |
|---|---:|---|
| backlog entries parked behind the device gate | 21 | `--sittings` lists them since RV-143. Seven were misfiled, and this PR fixes them |
| `projectOverview.md` Known-Issues rows saying "NOT device-verified" | **155** | **not at all** — `next-item.js` never reads `projectOverview.md` |
| `docs/device-verification-queue.md` (owner's hand-run list, last edited 2026-09-01) | 41 | **not at all** — nothing in DV's baton or the agents README names it |

Six read-only agents triaged the 155 rows and the old queue file, one chunk each. Every verdict
below came from reading the row and the current code, and each cites its evidence. The
production reads in §3 were run by this session. The totals are about **60 checks DV can run with
the phone alone**, about **55 that need the owner present**, and **about 30 rows that are already
answered and should leave `projectOverview.md`**.

## 1. What DV can run now: stations

Constraints carried in from sweeps 1–3:
- The phone is on **three-button navigation**, so every bottom-clearance half is deferred to §2.
- Never press *Leave* on the workout dialog.
- Never open `/admin/oura-ble` until DV-13 closes.
- The only writes are the standing ones: log and delete a food, tick and untick a supplement,
  create and delete a throwaway supplement or injury, confirm an activity, overwrite and restore a
  mood check-in, and a weigh-in at today's own value.
- **After any food delete, re-read the local row** (DV-15's fix, #1485, has not been checked on the
  device).

### A — no screen: SQLite, console and `adb` reads (read-only, about 20 min)

| PO line | check | pass |
|---|---|---|
| 2843 | DV-5's other arms: `sync_status='pending'` count in `injuries`, `supplement_logs`, `plan_meal_answers` with the outbox empty | 0 in each (DV-8's one `set_logs` row excepted) |
| 9778 | Q-37: `PRAGMA journal_mode`, `PRAGMA user_version`; cold restart | `wal`; **40** (the row says 21, which is stale); no "Connection trainingai already exists" in the console |
| 11191 | D1: `PRAGMA table_info(oura_daily)`; older `sleep_sessions` rows | `sync_status` column present; HRV/RHR/stage columns non-null |
| 8200 | Q-124: `SELECT sync_status, deleted_at FROM supplements` | no stranded `pending`; tombstones intact |
| 7380 | `SELECT name, servings FROM saved_meals` | column exists, values present (19 meals) |
| 10213 + old queue S7 | local `exercise_library`: count and type; the 5 exercises migration 216 corrected | types present; muscles match migration 216 |
| 11598 | local `prescribed_runs` vs `/api/running-plan` | table exists; today's row matches |
| 12399 | outbox status counts; More → Sync health card | no dead letters, or the card shows them with Retry/Discard |
| 12409, 12423 | `LocalNotifications.getPending()` | supplement ids 8500–8699 match local supplements with reminders on; on a training day before its time, id 8000 is pending |
| 11584 | `adb shell dumpsys notification` | a `health-alerts` channel exists |
| 11614 | launcher `screencap`; the Oura service notification's `smallIcon` | green dumbbell; `ic_stat_dumbbell` |
| 12147 | `caches.keys()`; CDP offline, then an uncached route | current and previous generations; the `/offline` page, not a Chromium error |
| 4042 (read half) | `supplement_vials` locally vs the server | rows agree |

### B — Workout tab (read-only; don't start a workout)

The owner's program is `ai_dynamic` (production read, 2026-09-24), so the rows that apply only to
that mode are live.

| PO line | check | pass |
|---|---|---|
| 8267 | Cardio Hub card: computed `background`, then tap | the cyan gradient paints; lands on `/cardio` |
| 7327 | pre-workout weights vs `/api/workout-data` and the last non-deload `estimated_1rm` | they agree |
| 11570 | open an accessory exercise | slider reads about RPE 8 |
| 11343 | viewport meta; `adb` HOME, relaunch, read `visualViewport.scale` | `maximum-scale=1, user-scalable=no`; scale 1 |
| 11532 | CDP offline, reopen and reselect sessions | exercises render from local by id; no endless skeleton |
| 11657 | `/workout?session=<random uuid>` | the reselect screen, not a crash or a blank |
| 11809 | `/api/next-session/prescription` vs `/api/workout-data?tab=<that id>` | per-set kg, reps and rest match |
| 10213 | CDP offline; open a session holding a bodyweight exercise | a rep target, not kg |
| 3260, 3436 | a bodyweight exercise (e.g. Hanging Leg Raise): pre-workout row, stats sheet, trend chart, strength card, previous-session value | each prints the last logged reps; prescribed reps ≈ floor(pct × rep max) |
| 3747 | program editor muscle chips, pickers, config editor: `getBoundingClientRect` on `tap-dense` controls | about 47×28 visual with the touch area kept; nothing clipped |

### C — Nutrition (food log/delete; throwaway supplement create/delete)

| PO line | check | pass |
|---|---|---|
| 3484 + 4964 | BF-154: CalorieZoneBar terms; macro targets | base + moved = budget, with one "resting" figure; P×4 + C×4 + F×9 ≈ budget ±3; protein 150 g |
| 5116 | Home nutrition card vs Nutrition ring and bar | same budget and same "left"; no compositor artefacts on the conic ring |
| 7496 | Energy Balance card on Nutrition, Health and Home | the five-band card renders with its calibration state |
| 12036 | log two foods; quick-edit A, then B | B shows its own quantity, not A's |
| 12060 | out-of-range quantity (don't save); past-day log; touch targets | clamps; no "today" projection on a past day; every control ≥ 44 px |
| 11325 | CDP offline: My Foods search, ingredient search, recent quick-pick | all return past foods |
| 5151 | CDP offline: log yesterday's dinner, sync, delete | the time is the meal-window midpoint before and after sync (watch for DV-15) |
| 7399 | meal builder (cancel out): close button, grams input, ingredient search | no overlap; `inputmode="decimal"`; hits returned |
| 5085 | My Meals → Edit Meal → photo tile, then cancel | the native camera/gallery prompt, not `<input type=file>` |
| 5182 | meal label → Save to gallery | a toast; the PNG exists in MediaStore, with pHYs at 600 dpi |
| 3388 | reta vial sheet (**never press the footer button**; it opens a second vial) | current vial named above "Open a new vial"; "Try a dose" says it is not saved; footer warning visible |
| 4042 (write half) | tick the vial supplement (and once offline), then untick | the `supplement_logs` row has `taken_at` and vial fields matching the current vial |
| 2757 | DV-10: throwaway supplement with amount, unit and start date, then delete | local `deleted_at` set; other columns kept (#1463) |
| 12051 | throwaway supplement with a reminder, then delete | an id 8500–8699 appears in `getPending()` and is gone after |
| 7588 | throwaway supplement create, then delete; CDP offline + reload | gone from the list and from `GET /api/supplements`; the app paints from its seed |
| 2794 | **same check as RV-103's Keep ①.** Run it there. Sweep 2's FAIL ran on v1.465.10, before LB-128's fix (#1456) deployed | — |

### D — Health (read-only unless noted)

| PO line | check | pass |
|---|---|---|
| 6929 | `/health/day` on a day with a workout and a walk; Health → Training | eaten/burned/net shown; the activity row shows distance/kcal/HR; a deload week's bar is striped. The empty-today half is in §2 (morning) |
| 8223 | day-detail: horizontal `adb` swipe, then vertical | the date moves ±1 day; vertical scrolls without changing day |
| 5121 | LB-1: open edit/delete on an exercise row, a session card, an activity, then **cancel** | the dialogs open |
| 11110 | tap a trained exercise → ExerciseHistorySheet → Heart & Recovery | card and sparkline paint with values (pick an exercise with `set_hr_stats` rows) |
| 10715 | `/health/sleep` → Sleep Contributors | HR and Schedule bars present; labels fit at 384 px |
| 11272 | detail screens; Home battery chip; Nutrition energy card | back returns one level; the chip shows a real %; the budget renders |
| 9129 | Body Battery card; record `/api/body-battery` | the "Limited data" chip shows exactly when `confidence.sufficient` is false; fits at 384 px |
| 9849 | a past GPS guided walk → activity sheet; local `segments` | zone-coloured runs; non-null `segments` (only if such a walk exists) |
| 3765 | leave a Sleep screen mounted; record network across the next background drain | `rollup-state` polls until the watermark moves, then sleep endpoints refetch with no remount. **Watch its latency: DV-13 saw it hang** |
| 11801 | production has **two `watch` illness days**: open Readiness detail for one | the advisory renders (`health-score-detail.tsx:248`) |

### E — Home, More and the shell

| PO line | check | pass |
|---|---|---|
| 11031, 8280 | Score Card Style: cycle all styles incl. `frosted` and `duorail`; **restore the original** | each renders at its size with no overlap; sibling gradients intact |
| 7345 | More → Ring card vs `/api/oura-ble/battery-latest` | same %; muted when stale |
| 6293 | open `/activity` cold with no type | the type picker, not a blank recordable screen |
| 9654 | start an activity, hardware back (`keyevent 4`), tap a tab; **press Stay** | the Leave dialog; Stay keeps it |
| 9834 | trace tap → first motion frame on score circles → detail | motion tracks the route commit (~120 ms), not a fixed cap; no double cross-fade |
| 10998 | More → Settings → Developer → Day Review (**not** under Admin any more) | contributors non-null; pillars expand; no console errors |
| 10745 | Admin → Day Review → calibration card | Spearman and the per-rating means render. **Watch production health; DV-13** |

### F — Cardio (read-only)

| PO line | check | pass |
|---|---|---|
| 10661 | `/cardio` vs `/api/cardio-week` and `/api/running-plan` | non-zero zone minutes; quota total = `weeklyBaseMinutes` |
| 11358 | `/running` AI line; CDP offline | the sentence renders; offline falls back to the plain rationale |
| 10340 | walk config and `/baselines` targets vs `/api/hr-profile` `targetAnchorMax` (**don't start**) | targets derive from it |

### Folded into existing probes rather than new stations

- **Old queue S1** (outbox flush on More pull-to-refresh) → **RV-131**.
- **RV-35** (Nutrition's day on resume across midnight) → **RV-154**, as its resume leg.
- **Q-163** (Home header date under a foreign timezone) → **RV-149**.
- **RV-106/107/109** (shell cards subscribe to invalidation) are already inside **RV-124**.

## 2. What needs the owner: six sittings, not fifty-five asks

1. **Gesture navigation on for one sitting.** Q-118's navless screens, the Home/Nutrition/More
   bottoms (12083), BF-31's meal-builder footer, RV-37, RV-127's clearance half and Q-168. Every
   bottom-clearance half in §1 also rides here. DV runs all of it once the setting is switched.
2. **A morning before the check-in and the first food log.** Q-248's card flip (6453), a check-in
   tapped during local-store init (7290), Exercise Readiness's body map (9896) with LB-116, and
   Q-245's empty-today swipe (6929). Sweep 1 showed the check-in sheet cannot be reached once today
   is logged, so the standing mood permission does not unlock these.
3. **DV attached during the owner's own workout, passive.**
   - Render-perf profile (11366).
   - Now Bar chip colours and the warm-up countdown (11818, 11407), via `dumpsys notification`.
   - Rest ring on "All sets done" (11859), live-HR rest trace (12323), PiP (8716).
   - Hardware back → Stay (12365).
   - Done-screen HR recovery and the next-workout card (10274, 11809).
   - On a deload day, BF-8 (5071). Q-310's deload (6278) depends on timing only: a production read
     of `aiPeriodizationState` says which day.
4. **Chest strap on.**
   - Reconnect (8738), live HR (11760), de-escalation (10315), Q-40 labels (9534), BF-140's chip
     (7111), 11421/11438.
   - The notification cap (10365). **8738 and 10365 now contradict each other**: a 60 s retry tick
     would re-raise a notification that 10365 says clears after about 4 min. Look for a
     notification that keeps coming back.
5. **A real walk or run.** AD-2 gait (11020), the activity ping (11094), guided-walk pill and run
   chip (9691, 10326, with Q-418), GPS (10158, 12372), the guided-walk back guard (11013; a staged
   walk auto-saves an activity), Q-221 (7146), fitness tests (11627, 11640, 4996, 5027).
6. **Writes to approve once, as a list.** Offline saved-meal create/edit/delete (11313), BF-11d's
   duplicate-import prompt (old queue N5), `/running` skip + swipe as one pass (8428 + 9586), a
   throwaway supplement rename (8200), a meal-type reorder (12060), a goal edit (6421), sign-out
   (7604, Q-172), meal-plan create (7418, 5090 — the owner has no plan), and an AI builder run to
   reach its review step (3727).

**Not reachable at all yet:** anything on `/admin/oura-ble` until DV-13 closes (6236, 10963, 10394,
11959, 12007). TalkBack also needs the owner's hands (6421, 6441, DV-11).

## 3. Answered today from production, no phone needed

| PO line | read (2026-09-24) | verdict |
|---|---|---|
| 10786 | bodyweight `set_logs` since 08-01: `planned_pct` **0 of 38**, `planned_reps` 34 of 38 | fixed as described → archive |
| 10771 | bodyweight `exercise_logs` since 08-01: `volume > 0` on **19 of 19** | fixed → archive |
| 10860 | `oura_daily_derived.activity_score` non-null **31 of 31** days | fixed → archive |
| 11692 | `bdi_derived` non-null **31 of 31** days, average 4.3, range 0–11.5 | populated; no UI to check → archive |
| 11129 | `exercise_logs.prep_time_sec` non-null **104 of 104** in 30 days | capture half done; the look is a later RUN |
| 11720 | `training_load_ots` **0 of 129** days ever. `training_load_gate` = **`insufficient_met` on 20 of 20** days since 09-05 | **not a device question.** Recorded on **Q-270**, whose owed read this is. It contradicts that entry's 08-30 finding that the MET gate clears by midday |
| 11381 | `chronic_stress_score` **0 of 129** days; `chronic_stress_granular_nights` never set | already filed as Q-525 / TN-1 / TN-8; not a device question |
| 11705 | `resilience_level` on 17 of 31 days | partially populated; the tile render is a DV check once present |
| 11801 | `illness_flag` persisted (65 normal, 12 learning, **2 watch**) | the row's "not yet persisted" is stale; render in §1 D |

## 4. Rows to move to `known-issues-resolved.md`, or amend

**Already answered elsewhere, so move them.** Evidence for each came from the triage:
- LB-107 (3372), verified in sweep 1.
- Q-546 (5126).
- Q-556 (5237), #392.
- Q-485 (5618), #170.
- Q-481 (5776), #129.
- Q-473/474 (5896).
- Q-464–466 (6043).
- Q-463 (6086), #109.
- Q-460–462 (6126).
- Q-213 (7194).
- Q-203 (7362), reversed by Q-111.
- The 2026-08-09 CI rules row (7733).
- The v18 upgrade (11153), with the schema now at v40.
- The rollup 499 fix (11300), whose mechanism is gone.
- The tab shell (11890) and latency (12130), both measured in sweep 1.
- The injury warning (12416), rebuilt by BF-135 and owner-accepted.
- BF-65 (4751) and LB-36 (5063), both verified 2026-09-14.
- The five §3 rows marked archive.

**Stale claims to amend:**
- 11453's heading says "ALL QUEUED (fixes not yet shipped)", but R-1 shipped 2026-07-20.
- 12372 says "until it ships", but `gps-watchdog.ts` shipped.
- 10274 names a sheet that no longer renders the list.
- 10213 says it needs an APK, which it does not.
- 5116 and 5121 say LB-4 is open, but it shipped; 5121 also carries a pasted copy of 5116's
  paragraph.
- 12399 says pulls never revert local edits. DV-15 showed they did, and #1485 fixed it.
- 10998's route moved out of Admin.

**Conditional:**
- 8117 waits on Q-144's status.
- 11614 and 11657 can go after one quick §1 check each.
- 8300, 10702, 10731 and 10759 are server-only changes that one production read, or none, closes.

## 5. Why this happened, and the guard it needs

A Known-Issues row saying "NOT device-verified" was the **pre-agent** mechanism for owing a check:
the owner read `projectOverview.md` and ran what he could. The device agent replaced him as the
runner and reads only the backlog, so every such row written before 2026-09-22, and several
written after, fell into a list nobody runs. `docs/device-verification-queue.md` is the same
mechanism a second time: 5 of its 41 rows are still owed and invisible (§1 A, §2.6).

**The rule this sweep recommends:** an owed device check lives on a backlog line (`Verify: device`,
a `Keep:` naming the device, or `Lane: DV`). A Known-Issues row may *point at* that entry, but may
not be the only place the check is written. Mechanise it the way RV-143 was: have
`check-backlog-pointers.js` fail on a new Known-Issues heading that says not device-verified and
names no queued id. Baseline the existing rows shrink-only, the way the done-headings were. Retire
`docs/device-verification-queue.md` to a pointer at `--sittings` once §1 A and §2.6 have taken its
five live rows.
