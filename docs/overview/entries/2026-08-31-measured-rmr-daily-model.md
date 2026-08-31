# 2026-08-31 — BF-42: the daily energy model predicted a resting rate it had been given

**Branch:** `lane-a/next` · **Lane A** · `lib/health/energy-balance-service.ts`. No APK.

BF-33 wired the measured RMR into `calculateBaseline` — the goal wizard. The live daily model is a
third path and was missed: it computed its own Cunningham BMR and never read
`getLatestMeasuredRmr`. Two screens, two resting rates for one person.

**The owner entered the results on the S25 today**, so this stopped being hypothetical while the
entry sat in the queue: `measured_rmr` = **1325 kcal at 51.5 kg FFM**, `dexa_scans` = **28.5 %**,
both dated 2026-08-27 and both confirmed in production.

## It was also the floor, which is the half that silences the calibration

`restingBaseKcal` is `Math.max(round(bmr), round(maintenanceKcal − avgActiveKcal))`. The floor's
comment — *"resting burn can never fall below BMR"* — is sound. The bug is that `bmr` was a
prediction while a measurement existed. For this owner the prediction is **1481** and the
measurement **1325**, so the floor sat **156 kcal above** the measured rate and clamped the
calibrated maintenance up to it. The calibration could not report the truth even when the data said
so.

`bmr` is now the measurement when there is one, so the base and the floor move together.

## The interaction with BF-2, which is the part a direction-only test misses

`personalRmr` re-scales the measurement's Cunningham residual onto **today's** fat-free mass, and
`ffm_kg_at_test` came from the DEXA. So today's has to be the DEXA-**corrected** scale reading, not
the raw one — the two sides must be on one instrument. Passing the raw 25.3 % credits fat-free mass
the owner does not have and reports ~50 kcal/day more than the measurement supports.

**My first test for this did not catch it.** It asserted a *direction* (`personalRmr(raw) >
personalRmr(corrected)`) on the pure function, which is true regardless of what the service does —
the mutation that swaps the service onto the raw value survived it. The test now asserts the exact
expected number through `computeEnergyBalance`:

```ts
expect(res.balance.restingBaseKcal).toBe(Math.round(onCorrected * SEDENTARY_MULTIPLIER))
expect(res.balance.restingBaseKcal).not.toBe(Math.round(onRaw * SEDENTARY_MULTIPLIER))
```

and the mutation dies. Worth recording because the first version *looked* like coverage: it named
the right concept, exercised the right numbers, and could not fail.

## Verified

- 8 DB-backed tests in the consumers file (2 new); **2 mutations killed** — ignoring the measurement
  (the original bug) and re-scaling onto the raw body fat.
- `pnpm check:rules` **Ran 66 of 66** · `tsc` clean · `check-body-fat-correction` OK.

## Not exercised

No runtime pass on `pnpm dev` for this one — the behaviour is covered by the service-level test
above, which calls `computeEnergyBalance` directly with the owner's real numbers. Device,
safe-area and WebView paths do not apply.
