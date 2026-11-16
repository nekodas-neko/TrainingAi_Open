# Device sweep 1 — the plan

**Owner:** 📱 Device Verification · **Written:** 2026-09-23, phone unplugged · **Runs:** only on the
owner's go-ahead, with 🔴 shown before the first input and 🟢 when the phone may be unplugged.

One sitting that settles as much of the device debt as a single session can: **116 owed checks**
(`node scripts/next-item.js --sittings`) plus Review's performance half (P11–P16, RV-137…RV-142). The
table below was built by reading every one of those 116 entries; the plan above it is how to run them.

## Safety rules for this sitting — non-negotiable

- **No raw `adb shell input`** except through `rawTap`/`rawSwipe` (`scripts/device/pw.js`), which
  check foreground + path immediately before sending. `dev.back()` refuses when the app is not in front.
  Background: on 2026-09-23 blind taps closed the app and opened another on the owner's phone.
- **Never uninstall, never clear app data** — it destroys the Oura ring's BLE key.
- **`am force-stop` is used for cold starts** (P11, P16). It also stops the ring's foreground service
  until the app relaunches — the script relaunches it within ~10 s.
- **Every write is undone straight after**, and the server is read afterwards to prove it.
- **Wake key (`keyevent 224`) every 4 min during idle stretches** — the screen sleeps after 5 min and
  "Stay awake" is the owner's setting.

## Decisions the owner makes before it starts

1. **Weigh-in (RV-124, RV-126/RV-108).** A manual weigh-in **overwrites today's real weight** (it is
   per-day and outranks the scale), and restoring the number still leaves the day marked manual.
   Options: skip it; run it on a day with no scale reading; or accept the overwrite.
2. **Mood check-in (LB-116, P1).** One per day. If today's is already logged, a test overwrites the
   owner's real answers — so it runs only on a day he has not checked in yet.
3. **Nine writes outside the approved five** (WRITE-ASK rows): completing a real workout (BF-169,
   BF-168), the Auto-detect timezone write (Q-477), a non-Brisbane timezone for a Health Connect sync
   (LB-113), coach changes + undo (Q-467), admin redecode/rollup runs (Q-318, TN-1), a throwaway
   supplement + injury (RV-45), deactivating an account (PS-24). Default: skip all nine.
4. **An owner-present block (~20 min)** for what only he can change: reduce-motion (Q-461, RV-128),
   three-button nav briefly (BF-62), TalkBack (Q-491), airplane mode (Q-499, RV-131, BF-47). Optional.

### The owner's answers (2026-09-23)

1. **Weigh-in: accepted**, with a similar number. Read today's weight first and log **that same value**,
   so the only change is the day's source becoming manual. Covers RV-108 and RV-126's weigh-in half.
2. **Mood: accepted, overwrite allowed.** Still, read today's check-in first and **restore it** after.
3. **"Only what you need."** Of the nine, only **RV-45** (a throwaway supplement + injury, created and
   deleted) is needed — it is the only way to exercise the device's delete path. The other eight are
   **skipped and recorded COULD NOT CHECK — owner declined as unneeded**: completing a real workout
   (BF-169, BF-168 — streak, PRs and phase counters), the Auto-detect timezone write (Q-477 — its own
   entry says it breaks dates), a non-Brisbane Health Connect sync (LB-113), coach changes (Q-467),
   admin rebuild runs (Q-318, TN-1 — expected to fail), account deactivation (PS-24).
4. **Owner-present OS block:** not yet answered — skipped unless he opts in.

### Added since the plan was written (queue as of 2026-09-23 afternoon)

| ID | block | what |
|---|---|---|
| **DV-4** | 4 | the fix shipped (#1449): every Sleep card legend value ≥ 4.5:1 — computed colour vs the card, dark theme |
| **RV-108** | 5 | weigh-in on the device: which cache keys are evicted, and does the Body card update — unblocked by answer 1 |
| **DV-5** (shipped #1445, removed without a device look) | 5 | after the food delete, `localQuery`: the tombstone is `synced`, not `pending` |
| **RV-110 / RV-112** (shipped #1431, same) | 2 | P15 wasted navigations: cross-tab pushes keep the tab shell; Home and More keep separate scroll offsets |
| **Q-545**, **BF-24** | — | gated, but the work is unbuilt (Q-545) or a design look (BF-24): not this sweep |

`--sittings` now lists gated entries too (#1443); the Colmi, scale and spec rows it adds are the ones
already listed above as not movable.

## Order and time

| # | block | what | tools | est. |
|---|---|---|---|---|
| 0 | setup | `probe.js`, `selftest.js`, two-tab-bar check after a cold reload | probe, pw | 5 min |
| 1 | cold start | P11 RV-137, P14 RV-140 first pass | `perf.js coldstart`, `perf.js longtasks` | 5 min |
| 2 | perf distribution | P12 RV-138 (10 cycles × 9 routes), P13 RV-139, P15 RV-141 | `perf.js cycles`, `perf.js backstack` | 15 min |
| 3 | frames + paint | P5/P6 RV-128, RV-129; route census RV-132 | `record.js`, `tour.js` | 10 min |
| 4 | Home → Nutrition → Health → Workout → More | the AUTO rows, screen by screen (table order) | pw | 75 min |
| 5 | writes | the approved five, P1/P2/P3/P8 rows (RV-124/125/126/131), BF-61 | `watchAfter`, `localQuery`, `offline` | 25 min |
| 6 | admin | `admin-console-sitting` + `owner-admin-sitting` read-only rows | pw | 15 min |
| 7 | resume | RV-130's resume half, BF-80 | pw | 10 min |
| 8 | owner block | only if he opts in (decision 4) | — | 20 min |
| 9 | long session | P16 RV-142 + P10 RV-133: TTI at open / after the walk / after 30 min idle | `perf.js tti`, `census.js --idle-min 30` | 35 min |

**Total: about 3 hours** (3 h 15 min with the owner block). The phone must be left alone throughout,
except during block 8. Hardware- and time-bound rows (a morning, a night in the strap, the scale, a
walk, the camera, midnight) are **outside this sweep** and listed at the end of the table.

## Before trusting a row — findings from building this plan

- **BF-139 / BF-96** failed on the S25 on 2026-09-13 and nothing has landed since: checking again only
  repeats the failure (NOT-DEVICE).
- **BF-107** and **LA-57** still print as owed but are not — a closed and a refuted entry whose
  `Verify: device` was never removed. For the Orchestrator's next sweep.
- **BF-95's** failure note ("still requires a little pause") reads as BF-61's symptom, so its own
  edge-swipe check may never have run.
- **BF-99's** line is in `components/nutrition/calorie-zone-bar.tsx` — Nutrition's energy card and
  Home's compact bar, not behind the gear.
- **TN-54 / TN-51** need the strap Kotlin from ~2026-09-21; check the installed APK's build date first.

## Also in the sweep: entries gated on the device (RV-143)

`--sittings` selects only shipped work owing a look, so **`Gate: device` entries never reached this
plan's table** — work *blocked on* the device agent and invisible to it (RV-143, Lane O owns the
`next-item.js` fix). Read here by hand against their entries; the ones this sweep can move:

| ID | block | what the sitting does |
|---|---|---|
| **DV-8** (Lane DV) | 5 | `localQuery` the stuck `set_logs` row and its parent: why its `workout_session_id` is not in local `workout_sessions` while the server holds the set under another session |
| **BF-22** | 9 | *"slow loads clear on a force restart"* — this is P16/RV-142 plus P10/RV-133; the long-session block answers it |
| **Q-51** | 2 | the perf thread — P11/P12 (RV-137, RV-138) produce the numbers it is gated on; **do not start its refactor before they exist** |
| **BF-49** | 4 | back from a Home timeline row: record where it lands (Health vs the start), path read in the page |
| **RV-111** | 4 | back while the barcode scanner is open in Log Food — does the whole flow discard? Scanner open is read-only |
| **BF-92** | 7 | Sentry receiving nothing from the client: a deliberate client-side throw via CDP `Runtime.evaluate`, then check it arrived — ask the owner first if it pages anyone |
| **LA-36** | 5 | `localQuery`: is `food_items.image_data_uri` populated on the device, and does any screen read it |
| **LA-115** | 5 | Health Connect's three unparseable record types: read the device console/logcat during a sync for the silent failures |
| **Q-7b** | 5 | `localQuery` the ten device-owned `oura_daily_derived` columns: null on every row, or produced |
| **Q-418** | owner | the free walk's Android pill — needs a walk started; ask |
| **PS-7** | owner | pose landmarker in the WebView — needs the camera; ask |
| **TN-44** | 5 | Health Connect record types available on the phone — read-only enumeration |

**Not movable in this sweep:** the Colmi R09 items (PS-8, PS-9, PS-12, PS-16, PS-21 — the ring is with a
second wearer), Q-388 (multi-day wear + an owner decision), Q-529 and Q-533 (a morning mid-upload; a
real re-sync), Q-104 and Q-114 (the scale), and the large specs BF-11, Q-395, Q-168, Q-34, which RV-143
reads as mis-gated rather than device-blocked.

## The table

Bucket = what this sweep can settle. AUTO rows are block 4; WRITE-OK are block 5; the rest are
recorded as COULD NOT CHECK with their reason unless the owner opts in.

| ID | bucket | screen/route | what to do and observe (pass condition) | write needed | notes |
|---|---|---|---|---|---|
| RV-137 | AUTO | Cold start → each of the 5 tabs | P11: after a normal cold start, read `performance.getEntriesByType('navigation')`/`('paint')`, then time each tab to first real content, warm. Pass: FCP ≤ 1.5 s and every tab ≤ 300 ms warm. Report the numbers either way. | none | Nothing has a baseline yet, so a pass is also a result. Run first, same session as RV-140. |
| RV-140 | AUTO | Cold start; tab switch both directions; scroll Home and Health | P14 long-task observer. Pass: no single main-thread task > 50 ms and no interaction blocks > 200 ms in total. Report whether `animationiteration` is still ~21% of main-thread time, and what dominates if not. | none | This is the evidence RV-113 needs. |
| RV-138 | AUTO | `/workout` (and each other tab), 10 warm visit/leave/return cycles | P12: list every mount duration per route, never a mean. Pass: first mount ≤ 2× the median of the rest. Pair each outlier with P13 in-flight requests and P14 long tasks. | none | Decides Q-51: a pass means Q-51 should be re-placed, not built. |
| RV-139 | AUTO | Every tab + main sub-screens | P13 via `pw.js` Network domain: per screen, request count, `/api/*` count, total bytes, largest response, chain depth. Pass: no endpoint requested twice for one screen; no chain deeper than 2. | none | Cross-check RV-78 (`/api/next-session`) and RV-82. The 09-23 baseline already shows `body-metadata` 6× and `workout-data` 5× per visit. |
| RV-141 | AUTO | All deep screens, hardware back | P15: count taps in against back presses out; flag any navigation that lands and immediately moves again; time one cross-tab `router.push` shell teardown. Pass: no screen has two tap paths of different length, no bounce navigation, back count = tap count, never lands on an unvisited screen. | none | The teardown time is the budget RV-110 is missing. |
| RV-128 | AUTO | Tab switch (`record.js --tap`); the six untransitioned pushed routes; More Profile ↔ Friends | P5: count and time any frame showing neither panel; read `bg-page` mid-switch (transparent means the wallpaper blinks through). Also RV-114 (gap in ms per pushed route) and RV-115 (does Friends inherit Profile's scroll?). | none | The reduce-motion check needs the OS setting changed, so it moves to the Q-461 HARDWARE step. |
| RV-129 | AUTO | Every tab warm and cold; `/more/devices` | P6: sample skeleton presence at 250/600/1200/2500 ms after navigating on a warm visit; report ms to first real content per tab. Pass: no skeleton on any warm visit. | none | Settles RV-39 in the same pass. |
| RV-132 | AUTO | Every route in the build, reached by tapping only | P9 `tour.js`, warm install: confirm each route is reachable by taps; check every picker/menu label names the metric its target screen shows. Confirm RV-121's two claims (`/collection` unreachable; one widget mislabelled) and find any others. | none | The fresh-install half is COULD NOT CHECK: a fresh install means clearing app data, which destroys the ring key. |
| RV-130 | AUTO | Home, Nutrition, Health, More, Workout; background with the Home key | Background the app on each screen for 30 s, 5 min and 30 min (adb `KEYCODE_HOME`, then relaunch). Report the DOM state on return and any console errors. Also attribute the ~50-per-visit "Rendering was performed in a subtree hidden by content-visibility" warnings to a component. | none | Walk half done 09-23 (0 non-2xx, console counted). The `error_events` rows say Home is where resume bites most (22). Pair with BF-80. |
| BF-80 | AUTO | Any screen, backgrounded under memory pressure | Background about 10 times with the camera and several apps opened via adb, then return. Pass: the last screen paints, not a blank. After any blank, check whether navigating (not reloading) restores it (cause 2) or not (renderer death, cause 3); look for an `error_events` row `renderer reclaimed by the system` and a logcat `Render process died`. | none | Best effort: the owner's repro was at 10% battery, which the agent can't set up. A clean run does not prove the handler works. The APK must postdate 2026-08-31. |
| PS-35b | AUTO | Home header weather chip | The chip resolves to a temperature/UV reading or shows its `—` failure state; it never pulses forever. Repeat with open-meteo blocked via CDP to see the failure state. | none | Item ① (PWA `start_url`) was dropped by the owner's APK-only scope. ③ was a stale comment, so there is nothing to see. |
| OR-116 | AUTO | Home HR chip; `/health/heart-rate` | The Home chip reads "Resting HR"/"Rest HR" (or "Heart Rate" only when it fell back to the live `hrCurrent`) and fits its cell. The detail screen's four stats are captioned "Today so far". | none | Keep ① (how much context each of the three surfaces shows) is an owner design question, not a device check. |
| RV-38 | AUTO | Body Battery card (Home/Health) | Look at the card on real data. Then force the no-data state with a CDP response override on `/api/body-battery` (`hasData:false, sufficient:false, sampleCount:0`) and confirm the low-data badge renders beside the 50. | none | The owner's account has data, so the no-data state is reachable only by the override. The number belongs to Tuning; the owner hasn't been asked whether no-data should show `—`. |
| TN-50 | AUTO | Home → morning check-in sheet (open, then dismiss without saving) | No energy level is pre-lit, and Save stays disabled until one is tapped. | none (dismiss) | Whether the extra morning tap is acceptable is the owner's judgement, so ask him. If today's check-in exists the sheet may prefill; record which state you saw. Pairs with LB-116. |
| BF-5 | AUTO | Home weekly-recap banner → `/health/week`; Health → Training → Week in review | Tapping the banner navigates to `/health/week` (it doesn't expand). The Health entry still opens the page after the banner is dismissed. The charts read at 412 dp, and the digest paragraph has no trailing `*`. | none (banner dismiss is local UI state) | The notification half (the weekly local notification lands on `/health/week`) depends on timing: record it only if it fires during the sweep, otherwise COULD NOT CHECK. Pairs with Q-112e. |
| RV-103 | AUTO | Nutrition energy card ("kcal left") | Fail the energy-balance refetch with CDP request interception. Pass: the failure line and Retry render inside the card at S25 width, and Retry recovers once the interception is lifted. | none | Wired, but seen firing only once in five sandbox runs (LB-128). |
| BF-99 | AUTO | Nutrition energy card calorie bar; Home compact nutrition bar | Read the `N base − M for your goal + K earned from movement` line in `CalorieZoneBar`. Pass: it doesn't wrap at 412 dp, especially Home's compact copy. | none | Route correction: the line is in `components/nutrition/calorie-zone-bar.tsx` (rendered by Nutrition's EnergyCard and Home's `home-nutrition-zone-bar`), not behind the Nutrition gear, which is where the 2026-09-13 check wrongly sent the owner. |
| BF-186 | AUTO | Nutrition → Supplements header "Manage"; vial sheet | Measure the `.tap-target-44` hit box (elementFromPoint sweep over 44×44) and adb-tap near its edge: Manage opens. Open a mg-dosed supplement's vial sheet and tap "Change it": the manage sheet opens and the vial sheet closes. | none | Batch `supplement-dose-surface`, same section as BF-185. |
| BF-175 | AUTO | Nutrition → Log food → pick a food → assign step (cancel before logging); end-of-day review | The assign step's denominator equals the energy card's day budget, not the stored goal, and the bar colour (green/orange) is right at S25 width. The end-of-day review ratio uses the same effective target. | none (cancel) | The arithmetic is already pinned by e2e. This check is the look. |
| BF-170 | AUTO | Nutrition diary, a day with a saved meal logged (e.g. PRE WORKOUT) | A collapsed meal group row shows P/C/F under its name. Expanded, P/C/F appears once. A section with a meal plus a loose food still shows its combined footer with calories. | none | Browse past days to find a logged saved meal. Pairs with BF-98. |
| BF-98 | AUTO | Nutrition diary, same meal sections | Settle the two readings of the 09-13 failure. (a) Collapse the SECTION holding only a grouped meal: does the section MealTotals show? (b) Collapse the grouped-meal ROW: does it show its own macros? Also: an expanded section holding only a group shows exactly one macro row and one kcal total. | none | FAILED 2026-09-13 on an ambiguous report. BF-170 (shipped 09-16) probably fixed reading (b). Screenshot both states for the owner. |
| BF-95 | AUTO | Nutrition diary meal row, swipe starting inside the left 24 px | adb swipe starting at x < 24 px on a meal row. Pass: the swipe tray opens and the tab does not change. | none | Marked FAILED 09-13 ("still requires a little pause"). That wording describes BF-61's delete-tap delay, not this edge swipe, so the edge check may never have been run. No code change since 09-13. Record the two separately. |
| BF-61 | AUTO | Nutrition diary: food rows and the meal list | From a verified-closed tray (`translateX(0)`), in ONE `adb shell` call: swipe, then `input tap` at Delete's own rect 100–300 ms later. Pass: "Delete food log?" appears on the first press on both lists, and the slow tap still works. Cancel the confirm. | none (cancel the confirm) | Partly done 09-23: the slow tap passed 4/4. The immediate tap was COULD NOT CHECK twice (tray already open; the tap hit the row, not Delete). Batch `nutrition-ui-uplift`. |
| BF-62 | AUTO | Nutrition: meal detail sheet, saved meals sheet, the three meal-plan sheets | On gesture nav, measure the action row's gap above the gesture bar. Pass: it clears by inset + 2 rem, minimum 4 rem (`pb-safe-action-lg`). | none | The 3-button-nav half needs the owner to switch nav mode (HARDWARE); run it in the same OS-settings step as Q-461. |
| BF-161 | AUTO | Nutrition → Build a meal → add two saved meals (do not save) | The ingredient rows, their quantities and the macro total equal the sum of the two source meals. | none (discard) | Discard the built meal; never save it. |
| Q-281 | AUTO | `/health/readiness` readiness breakdown | The "Final readiness" row shows its band word beside the band colour and doesn't wrap at 412 dp. | none | The survey half (contributors/trend/action) is held work, not a device check. |
| Q-305 | AUTO | Health → Training → weekly muscle sets card | Each row shows its band word (below MEV / in range / above MAV / above MRV) beside the set count, unclipped at 412 dp. | none | The shared-treatment question (Q-278/Q-302/Q-305) is design work, not a device check. |
| OR-118 | AUTO | Health → Training → Movement Balance card | Four rows (push/pull/legs/other), including zero rows; the word, count and bar fit the narrow row. | none | — |
| Q-300 | AUTO | Health → Rest discipline → rest-vs-plan card | The card renders from the device's own set logs (local path): its rows are present with no fallback `/api/health-trends?view=rest-adherence` request, or a read-only local query shows `planned_rest_sec` populated. Rows and deltas read at 412 dp. | none | Only the local path is owed; the web fallback is already e2e-covered. |
| Q-112e | AUTO | `/health/week`, foot of page | The four trend rows read under the week charts; a week with no reading says so rather than drawing zero; the sparklines line up week-for-week. | none | Pairs with BF-5, same visit. |
| Q-274 | AUTO | `/health/sleep` list: 2026-08-22 and 2026-06-01 | 2026-08-22 must not render as a 0.00 h night. Record how 2026-06-01 (a 1.45 h daytime fragment, the only row for that date) renders. | none | Converging the two "which rows are the night" implementations is unbuilt. |
| Q-519 | AUTO | `/health/sleep` manual bedtime card; local store | Read-only `PRAGMA table_info(sleep_sessions)` via `pw.js localQuery`: `manual_sleep_start` exists (arrived through `reconcileSchema`). The card renders with the measured start shown beside it. | none | Actually setting or clearing a bedtime writes sleep data, which is not pre-approved (WRITE-ASK). |
| TN-3b | AUTO | `/health/heart-rate` chart; `hr-day-card` | The amber stress line sits over the HR line with sleep/workout bands behind, at 412 dp. Coverage gaps show as breaks, not joined lines. | none | Readability is partly the owner's judgement. Ask before building the cross-day aggregate. |
| TN-53 | AUTO | `/health/heart-rate` trend sparklines (RHR, HRV, HR recovery) | Gaps render as breaks, a lone reading as a dot, and the "N days missing" note fits beside the delta chip at 412 dp. The HRR trend shows a gap across the strap's dark 09-15 → 09-20 span. | none | This check is also the entry's pass test. |
| TN-35 | AUTO | `/health/day?date=<a past day>` | The events list under the stress chart reads at 412 px, the header states "N of M with a reading", and events with no reading say "no reading", never 0. | none | Keep ③ is JUDGEMENT: the owner says whether a stressed window matches what he was doing. The marker half is unbuilt (Lane A, migration). |
| RV-37 | AUTO | `/health/day?date=<a day with plenty logged>` | Pick a day long enough to scroll. Pass: the last card clears the gesture bar. | none | Clearance was verified 09-13, but on a day that didn't scroll. The fifth-CI-rule question is not a device check. |
| BF-179 | AUTO | Workout tab → each session's pre-workout screen | Look for 52% loads plus a Deload chip. Gone: pass, and the entry is a post-mortem. Still there: clear the `workout-card:<id>` cache key and reopen; record whether that clears it, which would confirm the stale-cache cause. | none (local cache key only) | Production had no `deload_recommended` row on 09-20, so a stale client cache is the only cause left. |
| BF-167 | AUTO | Workout → pre-workout deload toggle | For a session with any `deloaded:true` exercise: the toggle reads "Deload — As prescribed" with Full offered as "Override". A normal session's labels are unchanged. | none | Production may hold no deloaded prescription right now; if so, the first half is COULD NOT CHECK. Batch `workout-completion-surface`. |
| BF-162 | AUTO | Workout → a session containing a bodyweight exercise (Pull-Up, Hanging Leg Raise) | Bodyweight rows on the prescription card show `@ N%` with no kg; weighted rows are unchanged. | none | — |
| BF-163 | AUTO | Workout → prescription card intensity chips | Read each chip's `title`. Pass: it reads "<label> · <range> of 1RM — named from load alone", and none states a rep range that contradicts the reps on the same line. | none | The load+reps blend rule is Lane A work, not a device check. |
| TN-25 | AUTO | Guided walk config → Today slide | The Today slide carries a pattern and its reason, the steppers match it, and the walker's saved Custom is untouched. | none (don't start a walk) | Running a continuous 30-min prescription (GPS/cadence/strap) is HARDWARE. The month-long compliance pass test needs lived data. |
| RV-127 | AUTO | `/more/details` | Remaining item only: do the three 318×21 inputs (display name, birth year, height) get a ≥ 44 px target from their row or label? Run an elementFromPoint scan around each. | none | Everything else was measured 2026-09-23, including clearance, on gesture nav. |
| BF-133 | AUTO | `/more/details`: measured section + "Tests and scans" | Fitness tests, DEXA and measured RMR render from the local store (the `getFitnessTests` branch). Every value carries its date. Note sticky headers, number alignment, and where the fold lands. | none | Whether it reads as "good UI" is partly the owner's call. Same visit as RV-127. |
| RV-39 | AUTO | `/more/devices` ring card | Warm repeat visit: sample skeleton presence at 250/600/1200/2500 ms. It was `[1,1,0,0]`; pass is `[0,0,0,0]`. | none | The owner deprioritised it; measure only. Settled together with RV-129. |
| Q-317 | AUTO | `/admin/oura-ble` re-key declaration card | Layout look in the APK: the card sits outside `OuraBleDebug` and its pending/idle state is readable. Do NOT press Declare. | none | Batch `admin-console-sitting` (one visit for Q-317/318/316/544/531, BF-10, LB-5). Produce OR-115's inventory from the same visit. |
| Q-544 | AUTO | `/admin/oura-ble` | `DbFootprintCard` and `DeviceMetricsPanel` render above the native console in the APK. | none | `admin-console-sitting`. |
| Q-316 | AUTO | `/admin/oura-ble` → DB footprint card, ① Data | Record the Pack button's state: disabled with "no sealed buckets to pack", or showing "N bucket(s) packable", or enabled but doing nothing. Screenshot it. | none (pressing Pack is WRITE-ASK) | The owner couldn't press it on 08-30. Likely reading: the count is server-side sealed buckets, while the 652k rows are the phone's local `oura_raw.db`, so disabled may be correct. `admin-console-sitting`. |
| BF-10 | AUTO | `/admin/oura-ble` → Device Metrics panel | Night-only SpO₂/temperature and daytime HRV sparklines occupy only their share of the 24 h axis, with dead space either side, not the full width. | none | `admin-console-sitting`. |
| Q-538 | AUTO | `/admin/oura-ble` raw store console → Read stats | Press Read stats (read-only). Pass: findings render from a real `rawStats()` call (unbounded / unbacked past 25 MB / lowDisk / partial rollup), each with a symbol beside its colour. | none (read-only) | The prune bound itself is blocked on OR-123. Record the rows/MB reading. |
| LB-5 | AUTO | Devices card (`OuraConnectionSection`) | Check the normal branch. For the keyless branch, stub `hasKey()` to return false in page JS (never touch the real key) and confirm the amber "No ring key stored" card links to `/admin/oura-ble`. | none | Never produce a real keyless state: a lost key is unrecoverable. `admin-console-sitting`. |
| BF-147 | AUTO | `/admin` → Exercises tab | Rows are two lines with full names and the delete button is still 48×48. Open the GIF review sweep sheet and look; do not tap either verdict (each is a PATCH). | none | The production S3 credential check is not a device task. |
| RV-142 | AUTO | Every tab: at open, after the P2 5-min walk, after 30 min idle | P16: per-tab time-to-interactive at the three points. Pass: all within 20% of each other; a monotonic rise is the finding. | none | Run with RV-133 over the same window. Place it at the end of the sweep. |
| RV-133 | AUTO | Same window, idle phase | P10, remaining half: heap, listeners by type and live timers after 30 min idle, compared with the 09-23 walk figures (flat by round 3). Pass: they stabilise rather than only rise. | none | Walk half done 09-23; the idle half was lost to a disconnect. Keep the cable attached for 30+ min. |
| RV-71 | JUDGEMENT | Any shared `<Button>` (Nutrition, More, sheets) | Owner: does a tap feel like a press (0.97 scale), and does any button stay highlighted after a tap (sticky `hover:`)? The agent first checks computed `transition-property`/duration 100 ms and the `:active` transform. | none | Batch `motion-polish` (RV-71/72/75): one felt pass. The sibling `transition-all` sites are not converted. |
| RV-72 | JUDGEMENT | Progress bars: contributor chart, meal macro bars, time summary, meal plan, walk pacer | The agent confirms each fill animates via `transform: scaleX` (computed style) and records frame timing during a change. The owner judges smoothness. | none | `motion-polish`. `calorie-progress-bar` deliberately stays on `width`. The 26 untransitioned bars are not converted. |
| RV-75 | JUDGEMENT | Any bottom sheet | The agent confirms computed durations of 300 ms open / 250 ms close on the M3 curve. The owner judges the feel. | none | `motion-polish`. |
| LB-61 | JUDGEMENT | `/more/settings` (five switches in a column) | The agent confirms the on-state is `--brand` with a `--brand-foreground` thumb. The owner judges whether five brand-coloured switches read as loud or get confused with "good". | none | The fallback (neutral switches in the settings column) is recorded in the entry. |
| BF-74 | JUDGEMENT | Nutrition → meal builder photo tile (an unsaved meal, gallery photo) | Tapping the top-right doesn't discard the photo; the bin reads as removal; the confirm appears before anything is lost; the undo toast can be reached by thumb before it dismisses. | none if done on a discarded, unsaved meal | Needs a photo in the tile (gallery pick through the native picker). The toast timeout against a thumb is the owner's call. Batch `nutrition-ui-uplift`. |
| Q-531 | JUDGEMENT | `/admin` → Devices / `/admin/oura-ble` | The owner walks drain → re-sync → verify and says whether the section order matches what he does, and which label is poor ("could be labeled better"). | none | Same sitting as `admin-console-sitting` + `owner-admin-sitting`. Feeds OR-115. |
| RV-124 | WRITE-OK | The surfaces showing each write (Home cards, Health/Body, Workout) | P1, remaining rows: after each write, every surface showing it requests its endpoint within 3 s, before any navigation. Record hidden-panel behaviour as on 09-23. | weigh-in (manual entry); confirm a detected activity; start a workout, then delete it | Food rows done 09-23 (BF-177 FAILED). The macro-targets row is WRITE-ASK and the ring-sync row is HARDWARE. Offline rows via CDP. |
| RV-125 | WRITE-OK | 5-min walk Home → Nutrition → Health → Workout → More, twice round | P2 with a `window.fetch` wrapper installed at app start: every `/api/*` endpoint on a revisited tab is requested more than once. Name the component behind any endpoint fetched exactly once. | mood check-in (Home); food log+delete (Nutrition); weigh-in (Health); workout start+delete (Workout); supplement tick+untick | Needs the fetch wrapper in `scripts/device/**` first. There is no pre-approved write for More, so its row is COULD NOT CHECK. Baseline done 09-23. |
| RV-126 | WRITE-OK | Health/Body after a weigh-in; local store | P3(a): a weigh-in evicts the body-metric cache keys, and `invalidateBiometrics` fires from the push → pull round trip on this device. | weigh-in (manual entry) | (b) and (c) done 09-23. Found DV-5 (tombstoned rows stuck at `pending` with an empty outbox). RV-108 turns on this answer. |
| RV-131 | WRITE-OK | All tabs with CDP offline | P8, remaining: offline writes in the other five domains render immediately; on reconnect no row flickers away and back; check whether any offline banner appears. | supplement tick+untick; mood check-in; weigh-in; activity confirm; workout start+delete | Food done 09-23. "Survives a force-stop while offline" needs real airplane mode (HARDWARE, same step as Q-499). |
| BF-45 | WRITE-OK | Nutrition diary food row | Log a food, swipe → Delete → confirm. Pass: the row stays gone across a tab swap and an `am force-stop` + relaunch. Also look at the gutters and rings (items ①②④). | log + delete a food | Batch `nutrition-ui-uplift`. Same pass as BF-47 and BF-61. |
| BF-47 | WRITE-OK | Nutrition diary | Delete a logged food online, then again under CDP offline. Pass: no reappearance, and still gone after a tab swap and after a force-close. | log + delete a food (×2) | Offline plus force-close together needs airplane mode (a restart drops the CDP emulation). |
| BF-12 | WRITE-OK | Nutrition → saved meals → "Log this meal" | Time the tap until the rows are on screen (the local-first path should be sub-second). No LocalStoreDeadBanner. The rows survive navigating away and back. Then delete them. | log + delete a saved meal's foods | RV-126 found the local store alive on 09-23, so the K4 state isn't present now. |
| BF-185 | WRITE-OK | Nutrition → Supplements toggle; local store | Tick a supplement not taken today and read `taken_at` (read-only local query). Untick, re-tick, re-read. Pass: the stamp is unchanged. Finish unticked. | supplement tick / untick / re-tick / untick | The editable-time control is unbuilt (needs Lane A's schema change first). Batch `supplement-dose-surface` with BF-186. |
| LB-116 | WRITE-OK | Home → morning check-in | Tick a sore muscle the sheet did NOT pre-select and save. Read the mood log: `suggested_sore_muscles` excludes it and `sore_muscles` includes it. Offline half: repeat under CDP offline and read the queued outbox payload. | mood check-in | If today's check-in already exists, saving overwrites it; confirm that's the approved write. Pairs with TN-50. |
| BF-169 | WRITE-ASK | Workout: complete a session → select tab | The COMPLETED stamp appears. Then, with the exercise-library cache cleared (or offline), the stamp is still there while the diagram is not. | Completing a real session: set logs, completion, possibly PRs/phase counters and a calendar event | The owner pre-approved only start+delete. One completed session covers BF-169 and BF-168 (batch `workout-completion-surface`). |
| BF-168 | WRITE-ASK | Workout after completion; mid-workout | After completing, return to the tab without tapping Start Again and press hardware back: no "Leave workout?" dialog. Mid-workout, hardware back: the dialog appears. | Same completion as BF-169 (the mid-workout half alone is WRITE-OK: start, then delete) | Only the device can fire Android's hardware back. |
| Q-477 | WRITE-ASK | More → Profile → Auto-detect timezone; background across local midnight | Press Auto-detect (writes `users.timezone`; still Brisbane). Background across midnight and resume. Pass: rollover happens once, the day's ticks clear once, and there's no double rollover. | profile timezone write | Needs local midnight to pass during the session. |
| LB-113 | WRITE-ASK | Profile timezone → a non-Brisbane zone; Health Connect sync | Set a non-Brisbane profile zone, let Health Connect sync, and confirm a day's metrics land on the day the phone shows. Revert the zone afterwards. | profile timezone change ×2 | Every date bucket shifts while the zone is set, so keep the window short. |
| Q-467 | WRITE-ASK | Coach → change history → Undo | Apply and undo one coach change in each of `nutrition_targets`, `session_exercise`, `early_deload` and `program_phase`. Drive the stale-409 row. Check row tap targets and wrapping at 412 dp (that part alone is AUTO). | coach changes to the programme/targets, then undo | So far only `user_goals` has been driven through the UI. |
| Q-318 | WRITE-ASK | `/admin/oura-ble` → Redecode | Press Redecode in the APK. Pass: the console polls to done/failed and shows the phases, or states alreadyRunning, instead of stopping at "started". | full-history redecode job (heavy server load) | LA-56: no full-history redecode has completed since 08-17, so expect `failed`, and run it ONCE only. `owner-admin-sitting` = same visit as the admin batch. |
| TN-1 | WRITE-ASK | `/admin/oura-ble` fullHistory rollup | The owner triggers a fullHistory pass; afterwards read `oura_daily_derived.chronic_stress_granular_nights`. ≥ 21 with the score still null → the fault is inside the model; < 21 → the granular stash is the constraint. | owner-run full-history rollup | Same run as Q-318/LA-56, which currently dies; it may produce no number at all. |
| RV-45 | WRITE-ASK | Nutrition → Manage supplements; the injury sheet | Create a throwaway supplement and a throwaway injury, then delete each online and again under CDP offline. Pass: no error toast for a delete that worked locally. | create + delete a supplement and an injury | Deleting real rows isn't approved; throwaway rows keep it reversible. |
| PS-24 | WRITE-ASK | APK sign-in (Custom Tab) | Deactivate a test account and try to sign in on the APK. Pass: it lands on `/pending` without looping. | `users.is_active` flip on an account (auth/security) | Auth change, so confirm first per CLAUDE.md. The middleware-runtime option is an owner decision, not a device check. |
| Q-499 | HARDWARE | Self-fetching cards: HR recovery profile, strength progress, Oura section, periodization status, exercise HR trend | The owner turns on airplane mode; force-stop and reopen. Pass: each card shows its "Couldn't load…" state, not nothing. | none | Same airplane-mode step as the force-stop halves of RV-131 and BF-47. |
| Q-461 | HARDWARE | Workout active set (rest phase); tab switch | The owner turns on Android's remove-animations setting. The agent checks that the Start Set bounce stops, that `MotionConfig reducedMotion` takes effect on tab switches (RV-128), and that some set-next cue remains. | start + delete a workout (WRITE-OK) | Same OS-settings step as the 3-button-nav half of BF-62. The follow-on e2e spec is not device work. |
| Q-491 | HARDWARE | weights-summary; added-weight-toggle; program-export-card; injury-card; trophy-case; session-select reorder | The owner turns on TalkBack. Pass: each toggle announces expanded/collapsed (pressed for the reorder button). | none | OS accessibility setting. |
| BF-83 | HARDWARE | A morning with the ring mid-upload: `/health/sleep`, Home chip | Open before and after the drain completes. Pass: the earlier view says provisional and the later doesn't, and the 30-night comparison excludes the provisional night. | none | Needs a real morning. The same morning covers Q-529. |
| Q-529 | HARDWARE | Same morning, first open of the day | Measure which part of the wait dominates: the ring drain (~62-min upload cadence), rollup lag (`computed_at`), or the screen's own fetch. | none | The fix links (on-open drain, immediate re-score) are unbuilt and need an APK. |
| LB-38 | HARDWARE | Nutrition → scan a meal label | Scan a printed meal label with the camera. Record whether it reads, and at which rotation. | none | Needs a printed label. The rest of the entry is decisions. |
| BF-109 | HARDWARE | Nutrition → Log food → barcode scan | Scan product `9350167000490`. Pass: the macro/calorie warning appears from real `/api/nutrition/barcode` data. Cancel before logging. | none if cancelled | Needs the physical product. The banner look is already verified (09-13). |
| BF-63 | HARDWARE | Nutrition → meal builder → barcode | Scan a packet in the builder. Pass: it's added as an ingredient with its name and macros, the item lands in the food library, nothing is logged to today, and a down database says so. | adds a food item to the library | Needs a packet and the camera. |
| BF-58 | HARDWARE | Scale; the partner's phone | The partner pairs the scale; each person steps on. Pass: the owner's reading lands with no prompt, and the partner's raises no "is this you" on his phone. Record whether one, both or neither phone gets a frame, and whether the stored-measurement command gets a reply. | weigh-ins | Two people, two phones. |
| LA-108 | HARDWARE | Scale pairing → Declined weigh-ins | Decline a real weigh-in ("Not me"). It appears with its time; claim it back. Pass: the weight files and the band re-anchors. | weigh-in + claim | Needs the owner on the scale. If a declined row already exists, just looking at the list is AUTO. |
| Q-104 | HARDWARE | Home after a real weigh-in | Revisit Home after weighing in. Pass: no "Weighing you…" bar. Read the logcat `onUnstableReading` line to compare the replayed weight with the last captured one. | weigh-in | Closed "for now" 09-14. The log line is what's still owed. |
| TN-54 | HARDWARE | Overnight chest-strap wear; `/api/strap-status` | Wear the H10 overnight. Next morning, the stored status rows (not sample presence) say whether the night counted. | none | The surface (`last_sample_at` on the Devices card) and the service restart are unbuilt. Confirm the installed APK 1.460.4 was built after #1354/#1356 (merged 2026-09-21 ~08:28 AEST); otherwise it lacks the Kotlin. |
| TN-51 | HARDWARE | The same overnight wear | Pass: a contiguous beat-to-beat RR series over 01:00–05:00, with `rmssdFromRr` comparable to the ring's figure for the same night. | none | Same night as TN-54; the APK must include #1356. |
| PS-11 | HARDWARE | A workout wearing the Colmi and the H10 together | Compare Colmi heart rate against the H10 during movement. | a workout | Only the H10 gives ground truth. |
| PS-20 | HARDWARE | A Colmi ring walk | Walk a counted number of steps, sync, then decode the `0x73` sub-type 18 counter/u16 against the step count (the 27/36 cm-per-step hypothesis). | none | The owner and the ring are both needed. |
| Q-533 | HARDWARE | A full ring re-sync from zero | Start a full re-sync and leave the screen. Pass: "Ring re-sync complete · N batches" arrives, with N matching the `drain complete` log line. | a full re-sync | The owner declined staging one just for this. Confirm it incidentally the next time a re-sync happens (`owner-admin-sitting`). |
| BF-107 | HARDWARE | Guided walk summary | (a) Finish a walk offline: the kcal tile reads `—`. (b) On a normal walk: `—`, then a number. Four tiles fit one row at 412 dp. | a walk (activity log) | The owner closed it conditionally on 09-14, but the entry's `Verify: device` line was never removed, which is why it still prints. |
| BF-105 | HARDWARE | Guided interval walk | Foreground: a fast → slow boundary gives a haptic and a vignette flash without raising the phone. Cues still fire on time after minutes in the background, and they cancel on leaving the walk. | a walk | The spoken cues (native, APK) are unbuilt. Check the phone isn't in silent mode. |
| BF-139 | NOT-DEVICE | Home header row | Nothing to check yet: it FAILED on the S25 on 2026-09-13 and no fix has landed since (no commits to `header-meta-row`/`header-chips`/`weather-chip`). The rework has to decide the row budget at "Wednesday 30 September" with `· UV n` present. | — | Batch `header-row-width` with BF-96. Re-check only after a new fix. |
| BF-96 | NOT-DEVICE | Home header row | Same as BF-139: FAILED 09-13, rework owed. | — | Batch `header-row-width`. |
| BF-145 | NOT-DEVICE | — | The device check was done 09-13. What's left is an owner decision: widen `surface="page"` to all sheets, or leave it opt-in. | — | Optional AUTO fact to hand the owner: is the dynamic wallpaper enabled on his device (read the store)? |
| BF-86 | NOT-DEVICE | — | The owner said he can't test the overnight resume and that it should ship on code and a test. | — | Record it opportunistically if a sweep happens to span local midnight. |
| DV-1 | NOT-DEVICE | Host Windows PC | Run `pnpm ci:local` unpiped on the PC the S25 is plugged into. Pass: exit 0. | — | Needs no phone. The hex-literal timeout still wants measuring. |
| Q-476 | NOT-DEVICE | — | The write-time `queueMutation` date validation is unbuilt. | — | Device-verify it once built. |
| LA-56 | NOT-DEVICE | — | The worker heartbeat (`last_beat_at`) is unbuilt, so there's nothing to verify. | — | `owner-admin-sitting`: the owner's redecode run is logged under Q-318/TN-1. |
| Q-214a | NOT-DEVICE | — | Investigated but not implemented (the `_inTransaction` refactor). | — | Needs an on-device smoke run in the same session once built. |
| BF-97 | NOT-DEVICE | — | The rendering half is unbuilt (`groupDiaryEntries` doesn't read `mealGroupName`). | — | The device check (scan a multi-item meal) comes after the build. |
| Q-407 | NOT-DEVICE | — | The coach conversation's opening shape (Lane A prompt/tool ordering) is unbuilt. | — | Once built: composer safe-area and the widget scrolling on the device. The stepper must stay. |
| Q-187 | NOT-DEVICE | — | The device check was done 09-13. Only a design question remains (spread vs next-meal option). | — | — |
| Q-319 | NOT-DEVICE | — | The branch can't be reached from the UI: the Water tile routes to `water-log-sheet`, never to `LogValueSheet`. | — | Nothing on the device can exercise it. |
| PS-21 | NOT-DEVICE | — | Stages B and C (the Kotlin service and its cadence) are unbuilt. | — | — |
| Q-111 | NOT-DEVICE | — | The ring/strap device pass is discharged. The scale chip is new native work, and the refresh-button question is the owner's call. | — | — |
| BF-59 | NOT-DEVICE | — | Both halves are unbuilt (the `signals.ts` phase-scaled budget; the Training card printing the phase). | — | Owner feel check after the build. |
| LA-21 | NOT-DEVICE | — | An owner policy ask (`history-row-policy`, with Q-298/Q-527): edit the history behind forward-only fixes, or leave it? | — | Reproducing the abandonment trigger means leaving a session open for 4 h+ and logging (WRITE-ASK) — only if asked. |
| Q-486 | NOT-DEVICE | — | Can't be staged without breaking the on-device SQLite. | — | Leave it until a real dead-store occurrence. |
| BF-7 | NOT-DEVICE | — | The Lane B 30/45/60/90 control is unbuilt. | — | — |
| BF-81 | NOT-DEVICE | — | Owner decisions taken; the remainder is data (a wide pass, sparse resilience). | — | The wide rollup pass is `owner-admin-sitting` (TN-1). |
| TN-4 | NOT-DEVICE | — | The root cause is server-side and unexplained. The `error_events` record pruned 2026-09-22. | — | — |
| LA-57 | NOT-DEVICE | — | Refuted, and the entry says not to implement anything. Its `Verify: device` has nothing to check on a phone. | — | Consider dropping the field so it stops printing. |

## Counts

| bucket | count |
|---|---:|
| AUTO | 53 |
| JUDGEMENT | 6 |
| WRITE-OK | 9 |
| WRITE-ASK | 9 |
| HARDWARE | 18 |
| NOT-DEVICE | 21 |
| **total** | **116** |

AUTO entries with a residue in another bucket (noted in their rows): RV-128 (reduce-motion → HARDWARE),
RV-132 (fresh install → COULD NOT CHECK), BF-62 (3-button nav → HARDWARE), TN-50 and TN-35 (owner judgement),
TN-25 (walk run → HARDWARE), BF-5 (notification → timing-dependent), Q-316 (pressing Pack → WRITE-ASK),
Q-519 (setting a bedtime → WRITE-ASK), Q-467's tap-target part is AUTO inside a WRITE-ASK row.

## Visiting order

1. **Cold start** (nothing touched first): RV-137, RV-140, then RV-138 / RV-139 / RV-141 / RV-129 / RV-128 /
   RV-132 walking all tabs.
2. **Home**: PS-35b, OR-116 (chip), RV-38, BF-99 (compact bar), BF-5 banner, TN-50 (open and dismiss), then
   LB-116 (check-in write).
3. **Nutrition**: RV-103, BF-99, BF-186, BF-175, BF-170 + BF-98, BF-95, BF-61, BF-62, BF-161, BF-74 → writes
   BF-185, BF-45 + BF-47, BF-12, then RV-124 / RV-125 / RV-126 / RV-131 (write probes, CDP offline).
4. **Health**: tab + Training list (Q-305, OR-118, Q-300, Week in review entry) → `/health/readiness`
   (Q-281) → `/health/sleep` (Q-274, Q-519) → `/health/heart-rate` (OR-116, TN-3b, TN-53) → `/health/day`
   (RV-37, TN-35) → `/health/week` (BF-5, Q-112e).
5. **Workout**: BF-179, BF-167, BF-162, BF-163 (pre-workout screens), then guided walk config (TN-25).
6. **More**: `/more/details` (RV-127, BF-133), `/more/devices` (RV-39, LB-5), `/more/settings` (LB-61).
7. **Admin**, one sitting with the owner (`admin-console-sitting` + `owner-admin-sitting`): `/admin` → Exercises
   (BF-147) → `/admin/oura-ble` (Q-317, Q-544, Q-316, BF-10, Q-538), then Q-531 walk and the asked runs Q-318 /
   TN-1.
8. **Background / resume**: RV-130 on each tab, BF-80.
9. **Owner-present block**: the motion-polish feel (RV-71/72/75), then OS settings in one go (reduce-motion for
   Q-461 + RV-128, 3-button nav for BF-62, TalkBack for Q-491), then airplane mode (Q-499 + the force-stop
   halves of RV-131 / BF-47). Ask for the WRITE-ASK items here.
10. **End of session**: RV-142 + RV-133 (30 min idle, cable attached).

Timing- or hardware-bound, outside the sweep: BF-83 + Q-529 (a morning), TN-54 + TN-51 (a night in the strap),
scale items (BF-58, LA-108, Q-104), walks (BF-107, BF-105, TN-25 run), Colmi (PS-11, PS-20), camera (LB-38,
BF-109, BF-63), Q-533 (the next real re-sync), Q-477 (local midnight).
