# 2026-08-05 — Q-79: the pairing that sounds right finds nothing

**Domain:** readiness — v1.264.0, JS/server only (no `android/**`, no migration)

`GET /api/admin/battery-recovery-calibration`, rendered as **Body Battery vs how recovered you felt**
under Admin → Day Review, directly beneath the Sleep Score calibration.

## The measurement that changed the design

I wrote the module's doc comment first, asserting the obvious causal story: a day drains you, you
report it the **next** morning, so the rating must be lagged a day. Then I measured all three
pairings against the production tables before writing the route:

| pairing | n | r | p |
|---|---|---|---|
| **same date** | 33 | **−0.390** | **0.018** |
| rating the next morning | 33 | +0.115 | 0.52 |
| battery of the previous day | 32 | −0.000 | 1.00 |

Only same-date reproduces the review's r = −0.400. The lag I was about to ship finds **nothing** —
I would have built a panel that renders a flat, insignificant relationship and reads as the model
having failed. The likely reason both sit on the same date: the battery day starts from an
overnight-recovery anchor, and the morning rating describes that same night. The comment now carries
the table and says not to "fix" it into a lag without re-measuring.

Negative r is agreement here. `perceivedRecovery` stores **1 = fully recovered … 5 = wrecked**, so a
high battery pairing with a low number is the model tracking the owner. The engine flips the rating
onto a higher-is-better axis before ranking, and the sign has its own test because getting it
backwards inverts everything the panel claims.

## One engine, not a second copy

`sleep-feel-calibration.ts` already held rank correlation, per-rating buckets, spread comparison,
worst-disagreement ranking and the note rules — all of which this needed verbatim. That is
`packages/shared/src/health/model-report-calibration.ts` now, parameterised by the rating labels and
the observation noun. Both surfaces are thin adapters over it.

The sleep module's **public API is unchanged** — it still speaks `feel` / `nights` / `feelRange`, and
its 14 tests pass untouched, which is what proves the extraction was behaviour-preserving. Its route
and response contract did not move either.

The card went the same way: `components/admin/calibration-card.tsx` is the panel, and
`sleep-feel-calibration-card.tsx` dropped from ~190 lines to ~50 (a config plus a shape mapper).
Without that, this PR would have copy-pasted 190 lines of stat tiles and thresholds that then drift.

## Labels come from the check-in now

`SLEEP_FEEL_LABELS` was a hand-maintained reversal of the check-in's own `labels` array. Reversing it
by hand a second time for recovery would have been the third copy of that convention, so
`storedOrderLabels(key)` in `types/day-checkin.ts` does it: `labels` is screen order (worst → best,
"good on the right") and the column stores 6 − position. A reworded scale can no longer leave a
calibration panel describing days with the old words. The sleep test still asserts the literal
`['Great', 'Good', 'OK', 'Poor', 'Terrible']`, so the derivation is pinned to the same answer it had.

## Scope held deliberately

This is admin-only. Bucketed, the gradient the review measured is modest — 3.00 / 3.00 / 2.65 across
battery bands < 40 / 40–60 / > 60 — and the owner already knows how recovered they felt. A headline
card telling them that is not worth a slot; a regression check that survives model changes is.

## Verification

Full suite **400 files / 3,157 tests green**, including the sleep module's untouched 14.

Both admin routes exercised against `pnpm dev` with a logged-in admin session, plus the validation
gates (`?from=nope` → 400 with the two-separator message; a 2,193-day range → 400). The sleep route
still returns its original `feel` / `feelLabel` / `feelRange` shape, which is the refactor's
regression check.

The empty-pairing path is not enough on its own, so twelve paired days were seeded locally and the
full engine exercised end to end: `spearman 0.898`, buckets labelled from the real check-in copy
(`Recovered / Good / OK / Rough / Wrecked`), and all three note kinds firing — agreement,
compression (`the model uses 48 points (49–97) where you use 100`) and out-of-order. The seeded rows
were deleted afterwards so the local DB stays honest.

**Not exercised:** the S25 viewport. Day Review now carries a second calibration card; not viewed on
device or at ≤640px. No native, safe-area, gesture or notification surface, so no device gate.
