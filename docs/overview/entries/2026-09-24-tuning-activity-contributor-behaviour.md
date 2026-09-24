# 2026-09-24 — the Activity Score's contributors, measured off its own stored breakdown

Tuning session. Docs-only: two new entries and an amendment, no product code.

## What was measured

`oura_daily_derived.activity_contributors` persists the Activity Score's per-contributor breakdown.
**30 days carry a populated one** (2026-07-28 → 2026-09-24), which makes the model checkable against
stored values rather than a reconstruction. A reconstruction from raw steps and tonnage was built
first, validated against the stored score (median error 0, mean +0.3, **sd 8.8**), and then used only
where nothing is stored — the per-day error is too large for single-day claims.

## TN-76 — four of six contributors do not behave as documented

- `strengthFreq`, the **largest weight at 25**, reads **100 on 29 of 30 days** (sd 2.2, min 88). Q-137
  raised `strengthFreqGoal` from 3 to 5 *specifically* to de-saturate it and predicted "3 sessions →
  ~73". It did not work: the owner trains at or above the goal, so the curve's cap at ratio 1.0 is
  where they sit. The model's largest weight is a constant.
- The renormalised weight base is **75 (19 days) or 85 (11 days), never 100**, so the strength lane
  holds **60%** of the score on most days against the documented 45%. `activeEnergy` (weight 15) is
  absent on all 59 rows; `zoneMinutes` (10) appears on 11 and is 0 on 9 of those.
- The **over-exertion taper has never fired** — ACWR max 1.32 against a 1.5 start.
- **29 of 59 stored rows carry the contributors object with no contributors in it**, so half the
  persisted audit trail is empty. Which writer produces that shape is not established.
- Only `steps` (sd 16.2) and `strengthVolume` (sd 12.4) move the number. Final score: mean 67.9,
  sd 7.4, range 53–82.

Proposal: shift `strengthFreq`'s weight toward `strengthVolume` rather than raise the goal a second
time. Incomplete until someone states how many stored days it moves — computable, and required,
because it re-scores history.

## TN-77 — "previous day's activity" reads today's training window

`readiness-payload.ts:471` and `build-day-audit.ts:182` both compute yesterday's activity score with
**today's** rolling 7-day strength window, and pass none of `zoneMinutes`/`moveHours`/`acwr`. Two
effects: the window is off by a day (differs on 83 of 115 reconstructed days, ≥5 points on 34, worst
−15, mean signed −0.15 so noise not bias), and the prev-day value sits on a weight base of 63 where
the same-day score sits on 75 or 85 — **71% strength against 60%**. Two scales feeding one composite.

## Q-524 amended

The entry measures against `users.steps_goal = 7,000`. **It reads 5,000 now** — applied 7,000
(06-30) → 6,000 (08-11) → 5,000 (08-31, 09-14) — so the gap against the scored 10,000 widened from
1.43× to **2.0×** while the entry sat unbuilt. Checked and **ruled out** an automated overwrite:
`source: 'scheduled'` describes creation, and `status: 'applied'` is only written by a button. The
new finding is that the derived path is **unanchored** — the LLM emits the number, clamped only to
[3,000, 20,000], with the 14-day mean and the current goal as its only anchors, and the live 5,000
sits 37.5% below the `DEFAULT_STEP_GOAL = 8000` the file cites Paluch 2022 for. A fitted correlation
across the four applied recommendations is n=4 and is explicitly not offered as evidence.

**Q-524 also carried no `Lane:` field** despite being decided twice and stating "Lane A has
everything it needs", so `next-item.js` read it as UNCLASSIFIED and no implementer was ever offered
it. Assigned `Lane: A` — the path rule resolves it unambiguously.

## Not exercised

Docs-only, so no runtime surface was touched. Every figure is one user, one activity level, one
training pattern; `strengthFreq`'s saturation is a fact about someone training 5×/wk, not about the
curve. Nothing here tests the score against TN-73's validated RPE residual, which is the one
instrument that has passed a positive control.
