# 2026-09-04 — the BMI band says what it was computed from (BF-113)

**Branch:** `fix/bf-113-bmi-dexa-label` · Lane B · labelling only, no arithmetic changed, no APK.

The owner: *"bmi doesnt say its scaled to match dexa."* He is right, and the card was one word short
of true. The band it draws (*High fat* at 27.9) is chosen from `displayBodyFat`, which returns the
**DEXA-corrected** figure — and the only thing the card said about it was *"via body fat %"*. The
info popover was no better: *"Category is based on your body fat % — more accurate for muscular
builds."* Nothing named the calibration.

## The part that was not a string change

`latestBf` was derived as `metaRecentReversed.map(displayBodyFat).find(v => v != null)`. That gets
the number right and **throws away which row produced it**, so nothing downstream could say whether
the band rested on a corrected reading. It genuinely varies row to row: two thirds of the owner's
history is on instruments the calibration does not cover.

So the value and the flag now come out together, in `latestDisplayedBodyFat(rows)` beside
`correctedSpan` in `body-fat-display.ts`. The entry's warning is the reason it is a helper rather
than two expressions at the call site — **never `bodyFatCorrected !== bodyFat`**, because an offset
can round to zero and *"corrected by 0.0" and "not corrected" are different claims*. The authority is
`bodyFatIsCorrected` on the row actually shown.

The caption reads `via body fat % (DEXA-calibrated)` when that row was corrected, and is unchanged
when it was not. The popover gains one sentence on the same condition.

## Verification

**Six unit cases on the helper, two mutations killing them:** taking the flag from the newest row
instead of the row the value came from (1 failure), and inferring the correction by comparing the
two numbers (3 failures). The cases that carry the weight are the ones where those differ — a newest
row with no body fat above a corrected one, an uncorrected newer reading above a corrected older one,
and a correction whose offset rounds to zero.

**Three call-site cases** added to `body-fat-display-sites.test.ts`, already this domain's guard,
with two mutations killing them: dropping the calibration clause from the caption, and reverting to
the row-losing `map(displayBodyFat).find(...)`.

`tsc`, lint (0 errors), `pnpm check:rules` **Ran 68 of 68**, full unit suite **6,452 passed / 0
failed**, `check-test-typecheck` at baseline.

## Not exercised — and this is the whole of the visual claim

**The caption and popover were never seen on a screen.** The attempt is worth recording rather than
skipping: Health was loaded authenticated against `pnpm dev` using the e2e storage state, and the BMI
card rendered its **"No data"** branch — `metaRecent` does not reach the client for the seeded user,
so `bmi` is null and neither the caption nor the popover is on the page at all. Seeding a body-fat
row did not change it. The corrected case needs more still: `bodyFatIsCorrected` is computed
server-side from a DEXA calibration, so it cannot be produced by inserting a reading.

What that leaves: the flag proven by unit test, the wiring by source guard, and the rendering by
neither. **The device check is the real one** — on the S25, a corrected reading must show
`via body fat % (DEXA-calibrated)` under a band that is unchanged, and an uncorrected one must not
claim calibration.
