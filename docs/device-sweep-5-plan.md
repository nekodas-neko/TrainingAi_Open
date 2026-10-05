# Device sweep 5 — plan

**Agent:** Device Verification · **Written:** 2026-10-05 from a full read of every `Lane: DV` entry (31)
and `next-item.js --sittings` (131 checks owed elsewhere, 10 blocked) · **Target:** web v1.486.11 (prod =
`main`). **Supersedes** the Orchestrator's `docs/device-sitting-plan-2026-09-28.md`, which predates a
week of fixes (DV-21, DV-22, RV-208, RV-210, the DV-8 heal, the OR-162 per-switch fix).

Six sittings of 45–60 minutes, per `CLAUDE.md`. **Each is ordered failure-first**, so a FAIL at minute 5
goes to a lane while the rest runs. Take them in the order below.

## Before the first sitting

| # | what | who | recommendation |
|---|---|---|---|
| 1 | **Install APK 1.481.3** over 1.465.52 (the `apk-latest` link in `CLAUDE.md`; `adb install -r` keeps data and the ring key) | owner downloads; DV installs | **Yes.** Five owed checks need ≥ 1.478 (BF-110, Q-529, OR-159, RV-196, BF-187), and a native check on an old APK is void |
| 2 | Phone on **gesture navigation** | owner | already on as of 2026-09-26 — confirm |
| 3 | RV-206 settings probes | — | **already approved** (owner, 2026-09-26, standing). Restore each before the sitting ends |
| 4 | LA-126 targets write | — | **already authorised** (owner, 2026-09-28) |

## Rules for every sitting

- `/api/version` polled every 30 s; **any answer over 5 s stops the sitting**, and for a recompute every
  5 s with the same stop rule.
- **`/admin/oura-ble` stays closed.** DV-13's row cap and per-request timeout have **not** shipped
  (`app/api/oura-ble/device-metrics/route.ts` has neither). Admin runs go through `fetch` to their
  routes, one at a time, never through that console.
- Every production recompute: **dry-run first, compare the count to the dry run, stop on a mismatch.**
- Writes are undone straight after; re-read the local row after any food delete (DV-8, DV-15).
- Raw swipes start at x ≥ 100 (gesture back edge). Never press *Leave* on a finished day's dialog.

## Sitting 1 — fixes that already failed once, and the cheap data clean-ups (~55 min)

| entry | check | reads / writes |
|---|---|---|
| **BF-61** | instrumented probe from a verified-closed tray: swipe, tap Delete at ~150 ms; record whether `elementFromPoint`, `pointerdown/touchstart` and `click` each reach the button — name the one that fails. Then the **meal-list half** | read-only + one food log/delete |
| **DV-12 + OR-162** | `perf.js longtasks` ×2 against the 50 ms bar; per-canvas font writes on **arrival** vs while hidden, Wear Time as control (after #1716) | read-only |
| **DV-8** | `food_logs` rows `pending` with an empty outbox (after #1704 + #1734 heal) — expect 0; re-check the `set_logs` row | read-only |
| **DV-19 / LA-171 ③ / BF-191 ①** | soft-delete walk `b8083d04` in the app, then the other two phantom rows (`ea77ce16`, `a85568a4`) as BF-191 ① authorises; the list shows one walk, local `4b5c23e0` gone | owner-authorised one-off |
| **DV-21** | notification channels list `health-alerts` and `workout-reminders` | read-only |
| **BF-22** | listener/DOM/heap around a started-and-left workout, CDP offline toggling and 10 min idle with sync | start-and-leave |

## Sitting 2 — production recomputes (~50 min, `fetch` only, one route at a time)

| entry | run | pass |
|---|---|---|
| **LA-126** | re-run the nutrition recommendation and apply it from the sheet | `nutrition_targets` = `calculateBaseline` (~1,359 kcal / 111 P / 134 C / 42 F); before/after recorded |
| **BF-13** | `/api/admin/rederive-baselines` dry-run, then `dryRun=false` | committed count = dry-run count |
| **TN-62** (+ **LB-53**, the same run) | `backfill-derived-scores` in 31-day pages to today, dry-run then commit, after BF-13 | Tuning's stale `hrvBalance`/`sleepBalance` counts go to 0/0 |
| **LA-171 ①** | snapshot `body_battery_daily`; dry-run `/api/admin/rederive-body-battery` in 31-day pages; numbers onto TN-72; commit | every stored row is v6; `written` equals the dry run |

## Sitting 3 — app-shell (~60 min)

**RV-220's two harness fixes first** (refuse a capture when the app is not foreground; scroll the inner
scroller and assert consecutive captures differ), then in this order: BF-204, BF-206, RV-210 (P26 on food
review and the weigh-in sheet, weight dial with the keyboard up), RV-208 (Nutrition date on one line, a
branded food), LB-61, Q-281, PS-35b (block open-meteo), BF-111, LB-162 and RV-209 (start-and-leave),
RV-146 (needs the harness to attach **before** load — add it here), RV-132 (tap-by-tap button census with a
write-safe allowlist). **DV-6/DV-22** gets captures at rest and scrolled on Home and `/health/sleep` for
the owner's eye — not a verdict.

## Sitting 4 — design stress (~50 min)

RV-206: **P29 font size, P30 display size** (ask once whether he ever changes either; retire them if
not), **P31 battery saver**, then **P35–P38** (launch and system bars, chart legibility, pull and
overscroll, longest real values). RV-205's remainder (cold start, one error state per card family, P32 with
the route cache cleared) and RV-220's re-captures and P41 before/after on RV-207, into the same private
gallery (Artifact `6chic4wxSBEC6maezNXdGS`).

## Sitting 5 — nutrition, body, workouts (~60 min)

RV-203 (CDP offline), RV-68, LB-129, BF-175, BF-170, BF-49 (the food row and Health's own timeline),
DV-15 re-check, RV-108 (weigh-in at today's value), BF-185 (supplement tick), RV-202 (CDP offline), RV-101,
BF-163, Q-305, RV-155 station C (throwaway supplement create/tick/delete) and its remaining B/D/E rows,
RV-124's activity-confirm row, DV-18's still-frame half (start-and-leave to reach the pre-workout list).

## Sitting 6 — devices, readiness, sleep (~45 min)

TN-85, DV-9 (CDP timezone override), Q-519, Q-104 (logcat on Home), TN-78, TN-35 and TN-3b (looks),
OR-116 ③, LA-160 (one day's ring-on and drain snapshot; the full answer spans days). If APK 1.481.3 is
installed: BF-110, Q-529, OR-159, RV-196, BF-187.

## The full-history redecode — its own sitting, only when Lane A says it can finish

One `fetch` to `POST /api/oura-ble/samples/redecode` (fullHistory) would answer **seven** entries at once:
LA-171 ②, LA-68, Q-525, TN-1, Q-71, LA-56, RV-169. It is approved, but **nothing shows a full pass
completing since 2026-08-17**, and LA-56 records that the attempts starve the process. It stays out of the
six sittings until Lane A confirms it can finish; when it runs, it runs alone with the 5 s stop rule.

## Not in sweep 5

| entries | why |
|---|---|
| RV-154, BF-86, Q-477, BF-5, BF-83, Q-274 | across midnight or a morning: an overnight sitting |
| LA-155, BF-167/168/169, LA-171 ④, LA-21, RV-186 row 7 | need a real workout completed (or open > 4 h) |
| RV-186 ②③⑤, RV-153, RV-103 follow-on | Lane A has not shipped the fixes |
| DV-13 and `admin-console-sitting` (Q-318, Q-316, Q-544, Q-531, BF-10, LB-5), Q-538, Q-533 | the console |
| PS-*, RV-167, TN-51, TN-54, TN-25, Q-111, BF-58, LA-108 | Colmi, H10 strap or scale |
| RV-131 | real airplane mode, owner at the phone |
| RV-151 | needs a deploy landing during the sitting |
| Q-168, Q-467 | need a pending AI Coach proposal (an unapproved write) |
| Q-491, DV-11, Q-461 | TalkBack or reduce-motion (OS settings not approved) |
| RV-113, BF-208, RV-114, RV-115 | the owner's eye, not a measurement |

## Queue corrections found in the review (for the Orchestrator)

- **LA-56** lists as VERIFY, but the heartbeat it would verify is not built.
- **LB-53** is parked by the literal "`Gate: owner`" inside its own prose; it is the same run as TN-62.
- **Q-300** still asks for a local-path check that sweep 4a showed does not apply.
- **RV-113**'s objective half passed in 4a; what is left is the owner's look.
- **RV-150** was removed by #1819 without a device run; its no-cache case cannot be staged without
  clearing app data.
