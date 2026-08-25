# The baseline EMA seeded at zero (BF-13, Q-506, TN-8)

**Branch:** `fix/baseline-zero-seed` · **Lane A** · batch `temperature-baseline` · no migration

## One line, four consumers

`updateBaseline` starts from `meanX8 = 0` and anneals toward the sample — 1/2 under 4 nights, 1/8 to
14, **1/32 after that**. So the first sample lands the mean at half the reading, and the step size
collapses long before it catches up. On the owner's temperature history night 2 read **17.905 °C**
against a 35.81 °C sample, and at night **50** the baseline was still **0.363 °C low** — 2.8 nightly
sd.

One corrupted intermediate was failing four consumers: the readiness penalty ladder, the illness
radar's `tempZ`, the "body temp elevated" deload card, and TN-8's chronic-stress fever mask (which
leaves no trace at all — a masked night simply does not contribute).

## The trap the entry predicted, and I walked into it anyway

BF-13 says: *"Check the vendor port before changing the shared maths… if the port is faithful, the
fix belongs at the seed / call site, not in the ported update."*

I put the seed inside `updateBaseline` first. It broke `warm_up_then_settle` — which is **ported
verbatim from open_oura's own `baseline.rs` test** and asserts `updateBaseline(null, 100, 0) === 400`.
The zero start is ecore's ground truth, pinned against the decompile. Changing it would have made
the port a lie about what the ring does, and the vendor's test is what caught it.

The fix is `seedOrUpdateBaseline`, a wrapper: first-ever sample seeds `{ meanX8: sample << 3,
devX8: 0 }`, everything after that is the untouched port. Both folds in the app
(`daily-summary.ts`, `score-availability.ts`) now call the wrapper. **All six baselines** are
protected — the entry's own point that this is a baseline-engine defect, not a temperature one.

`devX8: 0` is deliberate: one sample has no spread, and `baselineZ` already returns null on a zero
dev, so a one-sample baseline reports nothing rather than something confident.

## Four tests were pinning the bug

Not adjusted to fit — checked one at a time, and each was asserting the defect:

- **`breathBaseline` expected `{ meanX8: 580 }`.** 580 is exactly half of 1160. A 14.5 rpm reading
  was being recorded as 7.25 rpm and the test called it "pins the ×10 units".
- **`trailingBaselineZ([50, 50], 1)` expected `> 5`.** That assertion *demonstrated* the hazard — two
  steady 50s folding to mean 25, dev 3.1, z of 8, which the composite would read as a flawless day.
  Seeding removes the hazard at source, so it now asserts `null`. **The maturity floor stays**, and
  the case is kept so a reverted seed makes the overconfident z visible again instead of hiding
  behind the floor.
- **`carries baselines forward independently`** reused identical values across both nights and passed
  only because the cold mean moved on *any* second sample. It could not tell "carried forward" from
  "still converging". The fixture now varies.
- The other vendor-ground-truth cases pass **unchanged**, which is the point.

## Verification

Mutation-verified: deleting the seed line fails three cases, including the new BF-13 one.

- Full suite: **4765 passed, 51 skipped, 0 failures.**
- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.

## The data half is NOT done — one button, and it is the owner's

The seed fixes every baseline built from here. The owner's **stored** baselines are still the ones
folded from zero, and re-deriving them is what the three entries' pass tests actually measure.

**No new code is needed.** `run.ts:917` null-seeds the fold when `fullHistory` is set, and the
**Redecode** admin endpoint already passes `fullHistory: true`. So one Redecode run against
production, after this deploys, re-derives all six from the raw nightly values — which are untouched,
making it re-runnable and reversible, exactly as the owner was told when approving it.

**I could not run it.** The rollup needs the vendored Oura constants Q-49 removed from the repo, so
it cannot execute in an agent sandbox at all.

**Pass tests to check after that run**, straight from the entries: temperature deviation mean within
±0.05 °C of zero and roughly half the nights negative (BF-13/TN-6); `temp_dev_c > 1.0` on **0**
nights (TN-8); and the whole biomarker table re-measured, because every z moves by ~19× and the
radar may then fire *too* often (Q-506). **Only temperature needs re-deriving** — Tuning measured
the other five and only temperature's nightly sd is tight enough for the gap to matter.

## Not exercised

No device, and nothing observed in production. The claim here is that the fold now seeds correctly,
proven against the vendor's own test vectors and by mutation — not that any stored baseline has
changed, because none has yet.
