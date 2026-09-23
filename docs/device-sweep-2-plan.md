# Device sweep 2 — the combined pass

**Owner:** 📱 Device Verification · **Written:** 2026-09-23, phone unplugged · **Runs:** only on the
owner's go-ahead, 🔴 before the first input and 🟢 when the phone may be unplugged.

Sweep 1 (`docs/device-sweep-1-plan.md`, journal `2026-09-23-device-sweep-1.md`) ran the performance
probes and the approved writes. This plan takes **what is left** and groups it by **what one visit
settles**: a station is one screen (and at most one write cycle), and every entry that screen can
answer is run while there. The per-entry detail — what to do and what passes — is in sweep 1's
table, which is still correct for every row listed here; only the grouping is new.

**Queue at planning time:** `--sittings` 128 printed (106 owed checks plus the gated entries), `--lane
DV` 3 genuinely open probes (RV-125, RV-128, RV-129) plus DV-8.

## The stations

| # | station | entries it settles | writes | est. |
|---|---|---|---|---|
| **A** | **Nutrition diary + energy card** — one visit, one food log/delete, one saved-meal log/delete | BF-170, BF-98 (saved-meal day), BF-99 (bar line), RV-103 (CDP-failed refetch), BF-175 (assign step, cancelled), BF-161 (build a meal, cancelled), BF-186 (vial sheet hit box), BF-95 (edge swipe < 24 px), BF-61 (immediate tap, raw input via `rawSwipe`/`rawTap`), BF-62 (sheet action-row clearance), **BF-45**, **BF-47** (online + CDP offline), **BF-12** (saved-meal log timing), **RV-124** nutrition rows, **RV-125** (census with one write per tab), DV-10/DV-11 re-check if their fixes landed | food ×1, saved meal ×1, each undone | 45 min |
| **B** | **Health → Body + Training** | **RV-126** / RV-124 body rows (a weigh-in of today's own value), Q-300, OR-118, Q-305, BF-5 (Health entry) | weigh-in ×1 | 20 min |
| **C** | **Health sub-routes** in one walk | `/health/readiness` Q-281 · `/health/sleep` Q-274, Q-519 (read-only local query) · `/health/heart-rate` TN-3b, TN-53, OR-116 · `/health/day` RV-37, TN-35 · `/health/week` Q-112e, BF-5 | — | 25 min |
| **D** | **Home** | PS-35b (weather chip), OR-116 (HR chip), RV-38 (Body Battery, no-data via CDP response override — owner data untouched), BF-5 (banner), BF-99 (compact bar) | — | 15 min |
| **E** | **Workout pre-workout screens**, one session after another | BF-179, BF-167, BF-162, BF-163 — all read on the pre-workout screen, no Start pressed · TN-25 (guided-walk config, not started) | — | 15 min |
| **F** | **More** | `/more/details` RV-127 (the 21 px inputs' real hit area), BF-133 · `/more/devices` RV-39 (warm skeleton sampling), LB-5 (keyless branch via a page-JS stub, never the real key) | — | 15 min |
| **G** | **Admin** (read-only rows) | `/admin/oura-ble` Q-544, Q-316, BF-10, Q-538 (Read stats), Q-317 · `/admin` Exercises BF-147 | — | 15 min |
| **H** | **App-level** | RV-128 + RV-129 (`record.js` through each tab switch: blank frames, warm skeletons) · RV-132 (route census by tapping, `tour.js`) · RV-130 resume: each tab at 30 s and 5 min backgrounded, Home also at 30 min (the full 3×5 grid is ~3 h and adds little) · RV-111 (barcode scanner open, then back — read-only) · **DV-12** re-measure if its fix landed | — | 55 min |

**Total ≈ 3 h 45 min.** A and B first (they carry the writes, and B's weigh-in feeds RV-124's
surfaces); H last, because its 30-minute resume wait can overlap the write-up.

## Not in this pass — each needs something a sitting cannot supply alone

| group | entries | what it needs |
|---|---|---|
| **A morning before the owner checks in** | LB-116, TN-50 | the check-in sheet only opens until today's check-in is logged |
| **The owner present, changing phone settings** | Q-461 + RV-128's reduce-motion half, Q-491 (TalkBack), BF-62's three-button half, Q-499 + RV-131's restart-offline half + BF-47's force-stop half (airplane mode) | declined for sweep 1; ask again only if wanted |
| **Hardware / time** | BF-83, Q-529 (a morning mid-upload), TN-51, TN-54 (a night in the strap), BF-58, LA-108, Q-104, Q-114 (the scale), BF-105, BF-107, Q-418 (a real walk), LB-38, BF-109, BF-63, PS-7 (camera use), PS-8, PS-9, PS-11, PS-12, PS-16, PS-20 (the Colmi ring, with a second wearer), Q-388 (multi-day wear), Q-533 (a real re-sync) | the owner, a time of day, or hardware |
| **Writes the owner declined as unneeded** | BF-168, BF-169, LB-113, PS-24, Q-318, Q-467, Q-477, TN-1 | — |
| **Owner judgement** | BF-74, LB-61, Q-531, RV-71, RV-72, RV-75, DV-6 | look-and-feel, not a measurement |
| **BF-80** (background under memory pressure) | BF-80 | opening the camera and several apps via adb on the owner's phone — ask first |
| **BF-92** (a deliberate client throw to test Sentry) | BF-92 | ask first — it may page someone |
| **Not really device checks** | BF-139, BF-96 (fail until fixed), BF-145, BF-59, BF-7, BF-81, BF-86, BF-97, LA-21, LA-56, LA-57, PS-21, Q-111, Q-187, Q-214a, Q-319, Q-407, Q-476, Q-486, TN-4, and the spec-sized BF-11, BF-24, Q-395, Q-168, Q-34, Q-545 | see sweep 1's table for each reason |

## Closed with this plan

Sweep 1 fully measured **RV-137, RV-138, RV-140, RV-141, RV-142 and RV-133** — their deliverable was the
measurement, now in the journal and on the entries they inform (Q-51, BF-22) — and **RV-139** except
its byte half, which CDP cannot see through the service worker. All seven leave the queue. The one
result that had no other home, **every tab tap costing a 68–118 ms long task**, is filed as **DV-12**.
