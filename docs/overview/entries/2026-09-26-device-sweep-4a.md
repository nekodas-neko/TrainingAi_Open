# 2026-09-26 — Device sweep 4a: the sweep-3 fixes hold, tab switching is better but not fixed, and the design pass has begun

**Branch:** `device/sweep-4a` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

S25 Ultra, **APK 1.465.52** (updated by the owner that morning), web v1.465.66, **gesture navigation**,
owner's account. Plan: `docs/device-sweep-4-plan.md`, sitting 4a. Production was watched throughout
(72 checks, all 200, none over 5 s). The phone showed 🔴 throughout and 🟢 at the end.

## Verified and closed

DV-16, DV-17, BF-177 (5/5, and its Known-Issues row is archived), RV-111, LB-140 (did not reproduce),
RV-145 (Home now fetches `workout-data` once), OR-127 (`probe.js` connected first time), RV-149, RV-152,
and **BF-92**: one labelled client error, and Sentry's ingest answered with event id
`ac94c00fa3e3469f87c8509eae6b7907` (the owner can find it in Sentry by that id).

## Passed, entry kept

- **DV-15:** 5 of 5 deletes held. The one owed item left on the entry is noted there.
- **RV-103:** "Refreshing…" at 263 ms; failure line and Retry at 15.3 s. A follow-on is noted: after
  Retry, a delete did not refresh the card.
- **RV-113:** zero blank frames on 10 switches; the "feel" verdict is the owner's.
- **DV-18:** the admin half passed.
- **BF-107:** the re-open half passed.

## Still failing, or measured

- **BF-61:** a tap under 300 ms after the swipe is swallowed (8 of 8); at 500 ms it works. The close-swipe
  clause now passes.
- **DV-12:** 16 of 20 taps still carry a 51–104 ms task. **OR-162** names the cause: the two
  "Heart rate · today" charts re-measure on every switch while hidden, and Health's wear-time chart
  re-measures on arrival.
- **RV-186 rows 1–6:**
  - Every resume fetches 4 requests.
  - A Health switch fetches 24.
  - `hr-profile` and `zone-minutes` answer in 430–610 ms.
  - The exercise library is no longer refetched.
- **RV-153:** a Home tap rewrites ~120k characters of localStorage, and the friends feed is 459k.
- **RV-150:** a failed refetch is invisible on all 24 endpoints tried.
- **Q-300:** the rest card renders from the server, not the local store.
- **RV-146:** the label faces are no longer preloaded, and first paint is unchanged.
- **Q-11:** ran on the owner's go-ahead: 33 sessions processed, none had HR data, so nothing was filled.

## New

- **DV-19:** one treadmill walk is three local rows, and the list shows it twice.
- **DV-8:** a second instance — a food delete left `pending` with both outboxes empty.

## RV-205, the design pass

Private gallery: https://claude.ai/artifact/6chic4wxSBEC6maezNXdGS.
- 22 full-length captures of the five tab roots.
- P24: only Add food's sheet is over 100 ms, at 118 ms; the animated background makes other readings
  noisy.
- P26 passes.
- P27: 46 text colours and 95 backgrounds; lots of text under 12 px.
- P28: no layout-property animations; 11 always-on background animations; Workout still animating
  1.5 s after opening.

## Harness

- `findSocket` now matches the app's live pid (a stale socket broke every attach after a cold start).
- Runbook: gesture-edge swipes, screencast noise, card text matching its own description.

## Not exercised

Sitting 4b: the gesture-nav checks, RV-155's stations, RV-125/BF-22 re-runs, RV-205 tiers 2–3 and
RV-206 (which needs the owner's OK for three settings). Also not run: P25, the pre-workout list, the
meal-list half of BF-61, and cold-start failure for RV-150.
