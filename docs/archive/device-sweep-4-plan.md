# Device sweep 4 — plan

**Agent:** Device Verification · **Written:** 2026-09-26 from a review of every `Lane: DV` entry (33)
and the `--sittings` list (116 checks owed elsewhere) · **Target:** web v1.465.66 (prod = `main` on 2026-09-26; updated the same day for the entries added after the first review),
APK on the phone 1.460.4 (the latest published APK is 1.465.52 — see the owner decisions).

Two sittings of about 3 h each. **4a** needs nothing from the owner beyond plugging in. **4b** needs
gesture navigation switched back on.

## Owner decisions before starting

| # | decision | recommendation |
|---|---|---|
| 1 | Switch the phone back to **gesture navigation** (Settings → Display → Navigation bar → Swipe gestures) | Yes, before 4b. 4a does not need it |
| 2 | Install the latest APK (1.465.52) over the current one — `adb install -r` keeps all app data and the ring key | Yes, unless you know a reason not to. Checks of native changes since 1.460.4 are void on the old APK. The owner downloads it (the URL is in CLAUDE.md) |
| 3 | The fill-only production backfill **Q-11** (per-set HR stats, 22 sessions) from Admin → Tools | Yes. It only fills empty rows |
| 4 | **TN-62** (backfill derived scores) and **BF-13** (re-derive baselines) | **Not yet.** TN-62 must run after BF-13, and BF-13 is waiting on Lane A's `FEVER_TEMP_Z` fix (Q-506) |
| 6 | **RV-206**'s three settings probes: P29 font size, P30 display size, and P31's battery saver. Each is restored the same sitting, with before/after values recorded | Yes, once for all three, in 4b. The rest of RV-206 is read-only |
| 5 | An overnight sitting for **RV-154** (the app left open across local midnight) | Later, when convenient. It needs the phone plugged in from 23:50 |

## Rules for both sittings

- Prod `/api/version` is watched every 30 s. **Any answer over 5 s stops the sweep.**
- **`/admin/oura-ble` stays closed.** DV-13 still owes its row cap and timeout. Its pass test *is*
  opening the console, so it runs only after Lane A says it's ready. This also rules out RV-186 row 9,
  the `admin-console-sitting` batch, BF-10, LB-5, Q-538 and LA-68's Redecode button.
- After any deploy mid-sweep: force-stop and restart the app, then confirm the new build is running.
- Never press *Leave* on the workout dialog. Re-read the local row after every food delete (DV-15).

## Sitting 4a — fixes and performance (no owner needed; ~3 h 25 min)

| # | station | entries | reads / writes | est. |
|---|---|---|---|---|
| **A** | **My sweep-2/3 findings, now fixed** | **DV-15** (log and delete a food 5 times; `deleted_at` must hold every time). **DV-17** (3 warm Nutrition visits, zero skeleton frames). **BF-61** (immediate tap on a food row *and* the meal list; slow tap; a right swipe closes the tray without changing the day). **BF-177** ("kcal left" moves within 3 s of a log). **RV-103** (energy-balance blocked: "Refreshing your budget…" within ~1 s, then the failure line and Retry at ~15 s). **RV-111** (Barcode → back returns to Log Food; a second back closes it). **DV-18** (the admin reference image, plus a still-frame exercise image) | food log/delete ×6 | 45 min |
| **B** | **Performance, after the fixes** | **DV-12 + OR-162** (`perf.js longtasks`; canvases per tab panel). **RV-153** (localStorage writes per tap). **RV-145** (who fetches `workout-data` twice, via initiator stack). **RV-146** (cold start: the preload warnings are gone; re-read FCP against 1,020 ms). **RV-113** (does the tab-switch blank disappear; frame capture as the objective proxy, the verdict is the owner's). **RV-186** rows 1–6 as *after* readings (RV-180 to RV-183 have shipped) | 1 food log/delete (RV-186 row 4) | 50 min |
| **C** | **Probes that need new harness pieces** | **RV-152** (AX-tree empty names and broken images on every route). **RV-149** (timezone census via CDP `Emulation.setTimezoneOverride`, not an OS setting). **RV-150** (fail one read GET at a time with `Fetch.enable`, never writes or `/api/sync/*`). **RV-132** (warm route census by tap; the fresh-install half stays out) | read-only | 45 min |
| **H** | **Added 2026-09-26** | **BF-92** (owner consent given 2026-09-25: throw one deliberate client error in the APK and confirm Sentry receives it — the pass test is on the entry). **DV-12** now has a fix (#1675, memoised trend sparkline), so station B is its verification, not a baseline. **OR-127**: run the original `scripts/device/probe.js` once against the phone. `pw.js` has driven it for three sweeps, so this closes OR-127's *never run* | one Sentry event | 15 min |
| **I** | **RV-205 Tier 1, in the checklist's order** (Part D, *Start here*) | **Channel test first:** publish a private Artifact with one labelled capture (Home, warm), read it back, and record the URL on RV-205. If that fails, the visual half is COULD NOT CHECK. Then **P23** warm for the five tab roots and pre-workout (labelled *three-button* until 4b), plus **P24** tap-to-feedback latency on ~20 controls (flag over 100 ms). **P25** scroll smoothness on the long lists. **P26** soft keyboard vs the submit button. **P27** design-token census. **P28** motion inventory. The admin tables in P25 are read-only | read-only | 40 min |
| **D** | **Quick reads** | **DV-8** (the pending set row). **BF-107** (re-open walk `d0231b08`: does the kcal tile fill?). **LB-140** (step-by-step setup opens on first tap — the owner has no meal plan). **Q-300** (local store or server: block the route and see if the rows still render). **BF-49** (the food-row route, if a food is logged that day) | read-only | 15 min |

## Sitting 4b — gesture navigation and the long probes (~3 h 15 min)

| # | station | entries | reads / writes | est. |
|---|---|---|---|---|
| **E** | **Gesture navigation** | **RV-37**, **RV-127** clearance half, **DV-2 / BF-165** (`back-gesture-sitting`), **PS-35b**, the edge swipe on a food row with the OS back gesture live (BF-95's gesture variant), **Q-168** (AI Coach screens' bottom-anchored controls; no apply). **DV-6**'s look goes to the owner with a screenshot | read-only | 40 min |
| **F** | **RV-155 debt, stations A–F** (`docs/reviews/2026-09-24-sweep-55-device-verification-debt.md` §1) | about 60 shipped rows, grouped by screen; the Admin → Day Review row waits on DV-13 | food log/delete; throwaway supplement create/delete | 75 min |
| **J** | **RV-205 Tiers 2–3, then RV-206** | P23 for the remaining pushed routes, plus offline, the write-free sheets, and cold/error states. Home, Workout, Nutrition and one sheet are re-captured under gesture nav. Then **RV-206** (P29–P41, Part E): P39 and P33 first, then P29, P32 and P34 (settings per decision 6), then as far as time allows, with how far it got recorded. Published to **one private Artifact** (`DV design capture — <date>`), never the repo; the URL goes in RV-205's result line | read-only, plus decision 6 | 75 min |
| **G** | **RV-125 re-run and BF-22** | RV-125 with per-visit attribution and the `window.fetch` wrapper. BF-22's listener/DOM/heap counters around writes, sheets, pushed routes, offline and sync | food log/delete; weigh-in at today's own value | 35 min |

**Optional, if time allows:** DV-16 (needs that day's workout completed, so the morning after a
session), RV-130's resume half (30 s / 5 min / 30 min per tab; can run interleaved), RV-151 (only if a
deploy lands during the sitting), and **Q-11** if decision 3 is yes.

## Not in sweep 4

| entry | why |
|---|---|
| RV-154 | across local midnight: its own overnight sitting |
| RV-131 remainder | real airplane mode: needs the owner at the phone |
| RV-167, TN-51, TN-54 | the H10 strap and an owner walk |
| PS-7/8/9/11/12/16/20/21 | the Colmi ring |
| Q-104, Q-111, Q-114 | the scale |
| TN-62, BF-13, LB-53 | see decision 4; LB-53 runs under TN-62's constraints |
| TN-1, Q-71, Q-525, RV-169, LA-68 | all need a full-history redecode, which LA-56 records as never having completed; LA-56's heartbeat is unbuilt Lane A code |
| RV-124 remainder | activity confirm fits in F; ring-sync and offline rows ride with RV-131 |
| TN-53 | re-laned to A for diagnosis; not a device check now |
| BF-167/168/169, LA-21, Q-461 | need a real completed workout; they join DV-16 on a training morning |

## Housekeeping found in the review (for the Orchestrator)

- **DV-14's pass test is met.** Prod and `main` both report 1.465.62 on 2026-09-26, and the cause
  was fixed by RV-188 (#1564). Lane A can close it.
- **BF-12** was answered in sweep 3 (271 ms, no dead-store banner) and looks closable.
- **BF-147**'s device half passed in sweep 3. Only the production S3-credentials check remains, which
  is not device work, so its `Verify: device` can go.
- **Q-525 duplicates TN-1's question.** LA-56 and RV-169 are laned DV but are Lane A code and a
  production recompute, not device checks. **Q-168** is still laned DV; only its screen look is mine.
