# 2026-08-30 — Q-527: the corrupt body-comp row, traced — and the guard it asked for was half-built

**Branch:** `fix/body-comp-plausibility-guard` · **Lane:** A · **Domain:** body

## What the entry said

One `body_comp` snapshot of 71 records **3.0% body fat, 70.4 kg fat-free mass on a 72.6 kg
bodyweight, and BMR 1,890** — against ~24% and ~1,520 on the surrounding days. Inert today, because
nothing keys a user-visible number off stored BMR; **load-bearing the moment Q-521's drain model
ships**, since it makes baseline drain proportional to `bmrToday / bmrReference`. First action: a
plausibility guard at the write site.

## What was actually true

Re-measured against production (81 snapshots now, not 71 — the outlier is still the only one, and
the next-lowest reading in the entire series is **22.2%**, a 19-point gap).

**The cause is not unknown, and it is named in the code already.** `lib/scale-ble/composition.ts`
carries this comment on `MIN_VALID_IMPEDANCE_OHMS`:

> *Socks, stockings, or dry/calloused feet break that path and the scale reports impedance as 0 …
> Feeding 0 into the impedance-index formula divides by zero and floors bodyFatPct at its 3% clamp —
> **a real incident (2026-07-28)**.*

`body_metrics` confirms the row is that incident: the 2026-07-29 entry was **created
`2026-07-28T14:27:43`**, `source = scale_ble`, body fat 3. Impedance 0 drives the impedance term to
−∞ and the estimator's own `clamp(…, 3, 60)` lands it on 3.

**And the input guard shipped in response.** `hasValidImpedance` is called at *both* scale write
sites, and it has held: `scale_ble` has since written **30** body-fat readings, of which **exactly
one is under 10% — the incident itself, the first of the thirty.** Every reading after it is
22.2–25.5%.

So the entry's "first action" was already done at the input. What was genuinely missing is the layer
it also names: a band at the **derived-snapshot boundary**, which is the last thing before a stored
BMR and covers the sources `hasValidImpedance` cannot see.

## What shipped

`PLAUSIBLE_BODY_FAT_PCT = { min: 4, max: 60 }` and `isPlausibleBodyFatPct` in
`packages/shared/src/health/body-composition.ts`, applied by `bodyComposition()` and therefore by
`bodyCompSnapshot()`.

**The floor sits deliberately above the estimator's clamp floor of 3.** That is the whole design: a
floored value is indistinguishable from a measured one by the time it reaches storage, so a band
whose floor equalled the clamp would accept exactly the reading it exists for. There is a test
asserting that relationship, not just the number.

The band is published physiology, not fitted to this row — ACSM puts essential fat at 2–5% for men
and 10–13% for women, and no consumer bioimpedance reading should be trusted at that boundary. A
genuine sub-4% athlete is rejected too; the cost is small and worth stating: **the reading itself
still stands in `body_metrics`**, and only the derived snapshot is withheld, so the panel says
"needs a body-fat reading" instead of showing a fabricated one.

**A second surface improves for free.** `bodyComposition()` is also read by Health's lean-mass card
(`health-sections.tsx`), which was plotting a **17 kg** lean-mass spike on that day. It handles a
null at every call site already, so the day now drops out of the series rather than distorting it —
no Lane B edit needed.

## The sibling sweep, which is where the real exposure was

A band in one helper only guards the callers that go *through* it. Grepping for the arithmetic
rather than the helper found **two live surfaces re-deriving lean mass inline** — `weight ×
(1 − bf/100)`, the same formula, without the band — and neither is inert:

- **`lib/health/energy-balance-service.ts`** fed that inline value to `cunninghamBmr` for the
  formula baseline: the number behind "what you may eat today". Measured by mutation on the real
  fixture: an implausible 3% reading gives **2,268 kcal against 1,991** — a **277 kcal/day**
  inflation of the maintenance estimate.
- **`packages/shared/src/nutrition/goal-recommendation.ts`** (`calculateBaseline`) did the same for
  the user's calorie *and* protein targets, since protein is dosed per kg of lean mass.

Both now call `bodyComposition()` and fall through to Mifflin-St Jeor when it returns null. That is
also the "One Formula, One Place" fix — three implementations of lean-mass-from-body-fat existed,
and CLAUDE.md's rule is that two is a bug by definition.

**This is the part of Q-527 that mattered most, and the entry did not name it.** The stored
`body_comp` row it was filed about is genuinely inert until Q-521 ships; these two were live.

## Files

- `packages/shared/src/health/body-composition.ts` — the band.
- `lib/health/energy-balance-service.ts` — the formula baseline routed through it.
- `packages/shared/src/nutrition/goal-recommendation.ts` — `calculateBaseline` likewise.
- Tests: `body-composition.test.ts` (11, from 7), `goal-recommendation.test.ts` (36, from 33),
  `lib/data/postgres/__tests__/energy-balance-service.test.ts` (10, from 9).
- `docs/implementation-backlog.md`, `docs/domains/body/README.md` — what was measured.

## Verification

Full suite green, `pnpm check:rules` **Ran 62 of 62**, `tsc --noEmit` clean.

**Mutation-verified, all three:**

- Reverting the band to the old `bodyFatPct < 0 || > 100` fails the Q-527 case with exactly the
  fabricated composition (`fatMassKg: 2.1765` — 3% of 72.55 kg).
- Restoring `calculateBaseline`'s inline lean mass fails 2 of its 3 new cases.
- Restoring the energy service's inline Cunningham fails its new case at **2268 ≠ 1991**.

The replaced test is worth noting: `'0% body fat → all mass is lean'` asserted arithmetic on a value
this guard now rejects, so it was rewritten against the band's own floor rather than deleted.

Production figures read through `/api/admin/db-query`, which is **row-scoped to one user** — "81
snapshots" and "30 scale readings" are the owner's, which is the right scope here since the scale
and the incident are the owner's, but not a claim about anyone else's data.

**Not exercised:** the changed code is three pure functions and one server-side service; the device
branch of the offline-first stores is untouched, so no device check is owed. **The energy-balance
and goal-recommendation surfaces were exercised through their tests rather than through the UI** —
both changes are on the server side of those routes. No version bump: the user-visible effect is
one historical day dropping out of one chart, and a baseline that would only ever have differed on
a day carrying a misread.

## What this does NOT close

1. **The one stored row is untouched, and that is the owner's call.** The guard is forward-only:
   `persistBodyCompFromMetrics` upserts, so a re-run now *skips* 2026-07-29 rather than correcting
   it. Nulling the snapshot is a production data edit and is **not** reversible by re-running the
   backfill — the guard would refuse to re-derive it. The measurement stays in `body_metrics` either
   way.
2. **Q-521 must not trust a stored snapshot blindly.** A write-site guard cannot reach a row already
   written, so its drain model needs `isPlausibleBodyFatPct` on read, or item 1 resolved first. This
   is the entry's "do it BEFORE Q-521" restated as something Q-521's implementer can act on — the
   guard alone does not discharge it.
