# 2026-09-08 — `nutrition-goals/recommend` gets a real test (PS-39)

**Branch:** `test/nutrition-goals-recommend` · **Lane:** A · docs + tests only, no product code changed.

## What shipped

`lib/__tests__/nutrition-goals-recommend-route.test.ts` — 22 cases against
`app/api/nutrition-goals/recommend/route.ts`, the second-largest of the routes #956 found were
*believed* tested and were not (a test borrowed a type from the module and called nothing).

The property the file exists to hold is the AI rule made concrete: **no number the model reports
reaches the user as fact.** Everything `generateObject` returns passes through
`clampRecommendation` first, carbohydrate is not read from the model at all, and every clamp is
written into `dataQualityNote` rather than silently rewriting the answer. A route that stopped
clamping looks identical from the outside — same status, same response shape — which is exactly why
the case had to exist before the behaviour could be relied on.

Pinned, in three groups:

- **Refusals** — 401 without a session and 401 when the session names a deleted user; 400
  `profile_incomplete` listing *every* absent field rather than the first; the same 400 for a
  `dateOfBirth` that is present but unparseable (it clears the truthiness gate and only fails later
  in `ageFromDob`); 400 `no_weight_data` **without spending a model call**; 413 on an oversized
  body; 429 on the sixth call in the minute.
- **Clamping** — a 400 kcal answer rises to `max(1200, bmr)` and a 9,000 kcal one falls to
  `round(baseline.calories × 1.2)`, both noted and both stored clamped; protein bounded to
  1.0–2.5 g/kg; water and steps to their fixed floors and ceilings; carbs recomputed as the Atwater
  remainder of the *clamped* calories; the model's own `dataQualityNote` kept with the clamp note
  appended. Also that a suggested activity level moves no number here — since Q-401 the baseline is
  BMR × sedentary everywhere and activity is only ever added elsewhere, so the level is passed
  through as a suggestion and nothing more.
- **Failure and context** — `recommendation_failed` (not a raw 500) when the model throws *and* when
  the write throws, with nothing persisted in the first case; a body-fat calibration lookup that
  rejects does not fail the request; `source` is `scheduled` only for that exact marker; the
  most recent logged weight wins even when newer rows carry none; the 14-day window is keyed to the
  user's timezone.

`scripts/check-route-test-coverage.js` baseline 131 → **130**.

## Notes

- The timezone case uses `Etc/GMT-14` and `Etc/GMT+12` — 26 hours apart, so their local dates differ
  whatever the clock says. A pair that only *usually* differs makes a test that only usually tests
  anything, which is the trap two earlier files in this queue fell into from the other direction.
- Nine mutations were run against the route and the clamp (pass-through clamp, flipped `source`
  default, default-timezone window, truncated `missing`, 200-instead-of-500, model call before the
  weight check, a 50/min limit, oversize allowed, the raw AI calories persisted). Each was caught,
  each by the case that names it.
- Three of the twelve remain: `workout-data` (600 lines, the biggest),
  `workout-review/session/[sessionId]`, `ai-periodization/session/[sessionId]/prescribe`.
