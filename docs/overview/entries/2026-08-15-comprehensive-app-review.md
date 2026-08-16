# 2026-08-15 — the five scoring pillars, measured together for the first time

**Branch:** `claude/gym-app-comprehensive-review-j38fo9` · **Type:** review, docs-only ·
**Backlog:** Q-271 … Q-284 (14 entries)

Owner asked for a thorough overview — bugs, UI, performance, architecture — plus a comparison
against Garmin/Samsung Health/Strava, and specifically to pull real production data and judge how
the scoring pillars are working. Plan written first
([`docs/reviews/2026-08-15-comprehensive-app-review-prompt.md`](../../reviews/2026-08-15-comprehensive-app-review-prompt.md)),
then executed. Findings in
[`docs/reviews/2026-08-15-comprehensive-app-review.md`](../../reviews/2026-08-15-comprehensive-app-review.md).

## What made this one different

Eleven review sweeps have run since 2026-07-04 and each measured **one** pillar in isolation, months
apart — Sleep Score (Q-72), Activity Score (Q-137), Body Battery (Q-57). Nobody had measured all
five **on the same days, against the same production rows**, or asked whether they agree with each
other. That cross-pillar view is where almost everything below came from, and none of it was
reachable from reading code.

## The findings that matter

- **Readiness cannot see that you trained hard yesterday (Q-275).** `readiness-payload.ts:329` reads
  the Activity Score's `preTaperScore` *specifically* to avoid double-counting ACWR — and load
  enters the composite nowhere else. Both activity contributors (15% combined) are goal-completion
  scores, so a heavy squat session and a 12,000-step rest day contribute the same. Garmin's Training
  Readiness takes two load inputs of six. For a gym app, this is the biggest gap in the model.
- **The Recovery Index contributor only ever subtracts (Q-271).** Anchor is 6 h; production mean is
  2.58 h; 1 of 39 days reaches it. Realised sub-scores across all 31 scored days never exceed 50.
  Nine percent of readiness weight costing ~2.2 points a day, `provisional` on 31 of 31 days.
- **Fragment nights are reaching the sleep score (Q-274).** 10 of 46 post-re-key rows under 1.5 h,
  three at exactly 0.00 h, and on two dates the fragment is the *only* record. This is the sweep
  Q-225 asked for, and it found at least one more night with 08-13's signature.
- **Body Battery v5 drains 5× faster than it charges (Q-272)** — ends at its daily minimum on 10 of
  12 days, hits 0 on 3. Q-57 halved `CHARGE_RATE` to fix ceiling-pinning and overshot.
- **Q-214's duplicate-collapse fix reached one of three same-shaped batch upserts (Q-280).** The
  5,771-hit `[pg 21000]` fault is confirmed stopped; `upsertOuraBucket` (2,000-row chunks, fed by the
  same rollup) and `upsertSetHrStats` still carry the shape.

## A number in this repo's own docs was wrong, and the mechanism is now filed

`projectOverview.md` and the readiness domain index both recorded end-of-day Body Battery vs
next-day readiness at **r = −0.06**, used as evidence the model had no outcome signal. That figure
pooled **four model versions** — v1, v2, v4 and v5 all ran inside the same 40 days, with no
backfill. Split by version, **v5 alone gives r = +0.67 (n = 11)**. The deferred re-check the
Known-Issues row asked for is now done and answers **in v5's favour**.

Both documents are amended in this PR rather than left to be re-derived. The underlying cause —
**Body Battery is the only pillar that stamps a `model_version` at all**, so this error class is
undetectable for the other four — is **Q-273**, and it should land *before* the calibration items or
each of them creates another incomparable segment.

## Two findings did not survive verification

Recorded because the near-misses are the useful part:

- `sleep_sessions.sleep_score` is 0-of-46 non-null, which read as a dead column until
  `score-audit/sleep.ts` turned out to label it *"Frozen since the BLE re-key — shown for comparison
  only, never served as the live score."* Working as documented. **Dropped.**
- `blendActivityScore` looked unreachable post-Cloud-removal until `oura_daily.activity_score` proved
  non-null on 1 of 40 post-re-key days. Nearly inert, not dead — filed as **Q-284** on those terms
  instead of as a deletion.

## What held up

`pnpm check:rules` — **35 of 35**, all passing. Every bug class with a CI check behind it reads
zero: no hand-rolled `invalidateCache([…])`, no live `toISOString().slice(0,10)`, no `useState`
cache initializers. The AI layer is compliant (12 files on `generateObject`, zero `JSON.parse` of
model output). The one-formula-one-place rule is why §1 was measurable at all — the score models
export serialisable `READINESS_MODEL` / `ACTIVITY_MODEL` objects, so the audit layer reads the model
without copying it.

The hex-literal count is the counter-example the rulebook already predicted: it grew 41 in five days
while governed by prose, and stopped the day `check-hex-literals.js` shipped.

## Not exercised

No device, no emulator, no browser, no `pnpm dev` run — docs-only. Every number is **one user's**
data through the row-scoped `claude_ro` views; `error_events` prunes at 30 days. Correlations at
n = 11 to n = 31 are directional. The architecture lens is shallower than the rest and **"what
breaks first at 10 users, at 100" is not answered** — it stays open.
