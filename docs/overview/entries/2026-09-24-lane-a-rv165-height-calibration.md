# 2026-09-24 — RV-165: the DEXA offset was fitted to a height the owner had already corrected

**Lane A** · branch `lane-a/rv165-height-calibration`

Body composition is computed **once, at ingest**, from the profile of that moment. The owner
corrected their height from 160 to 158 cm to match a DEXA printout, so every earlier reading is still
a 160 cm number. That would be a history question and nothing more — except the DEXA calibration
offset is derived **live** from those stored values, so one stale pair biases every corrected
body-fat reading the app shows today. Measured: **+3.2 where it should be +2.3**, about a point.

## The entry's first fix shape is unnecessary

It proposed *"store what composition needs from the raw sample"* — a migration, and one that could
not recover history anyway. Nothing extra needs storing. Two properties of the formula make the
original inputs recoverable from columns already written:

1. **`bmr_kcal` is Mifflin-St Jeor** — `10w + 6.25h − 5a + sexTerm` — with **no impedance term**, and
   linear in height. The height used at ingest falls straight out of it.
2. **Impedance enters the model through `bodyFatPct` alone.** Every other output is a function of
   body fat, weight, height, age and sex. Once the height is known, the impedance follows.

## Verified against production, not derived on paper

08-27 and 09-01 carry the **same weight (71.7 kg)** and BMRs of **1557** and **1545**. The 12 kcal gap
is 12 / 6.25 = **1.92 cm**, and solving each gives exactly **160** and **158** at age 33 — the
documented correction, recovered from the table alone. The 08-27 impedance comes back at **~494 Ω**,
inside the file's own 300–1200 Ω band, and re-deriving at 158 cm gives **26.2** against the stored
25.3.

The test fixture is those real rows, and there is a separate round-trip case that pins the algebra
with no production data in it at all.

## Where it lives

`heightUsedForStoredBmr` and `recomputeStoredBodyFatPctAtHeight` sit in
`lib/scale-ble/composition.ts`, beside the formula they invert. Only the **inverse** lives there —
the forward half calls `computeBodyComposition`, so the two cannot drift. `getBodyFatCalibration`
restates each reading at the current profile before pairing, using the age **at the reading** rather
than today's: a birthday in between would otherwise shift the recovered height by 0.8 cm and quietly
poison the inversion.

## The mistake worth recording

**My first version dropped any reading it could not re-derive.** That sounds cautious and is not.
Readings without a stored BMR are common; dropping them left **zero pairs**, so the calibration
returned null and *no correction was applied at all* — strictly worse than the bug being fixed.
`body-fat-correction-consumers.test.ts` caught it with "expected 25.3 to be 28.5".

The reasoning error was treating *"I cannot verify this reading"* as *"this reading is wrong"*.
Absent a BMR there is no evidence of staleness, only an inability to check. A reading that cannot be
re-derived is now **kept as stored** — exactly today's behaviour — so the change can substitute a
better value but can never produce a worse calibration than the one it replaces.

## The guards overlap, which makes them easy to test wrongly

An absurd body-fat value usually implies a **negative** impedance index, which is caught before the
plausibility band is ever reached. So a carelessly chosen fixture passes even with the guard it is
meant to pin deleted — and the mutation pass showed exactly that: two guards survived deletion. The
three refusal cases are now each computed to clear the earlier guards and stop at their own (bf = 3
at BMR 1424 lands on a perfectly plausible 562 Ω; bf = 21.0 at BMR 1557 clears the sign check and
resolves to 186 Ω, under the floor).

## Verification

`tsc` clean · `typecheck:tests` clean · Custom Rules **78 of 78** · `lib/scale-ble` + shared health
**1,022 passed** · the two calibration suites **14/14**.

Mutation pass: **7 mutants, 5 killed**, 2 equivalent controls survived correctly. Two of the kills
exist only because the first pass found them surviving.

## Not done, deliberately

**The stored rows are untouched.** Every `body_metrics` row before the correction still holds 160 cm
composition. Restating them is a history edit — **RV-170** — and the owner's call. This fixes only
what is derived at read time.

**Whether +2.3 is right in any absolute sense is unmeasured.** It is one DEXA pair, and
`deriveBodyFatCalibration`'s own comment is explicit that n = 1 supports an offset and not a ratio.
What changed is that the pair is now compared like for like.
