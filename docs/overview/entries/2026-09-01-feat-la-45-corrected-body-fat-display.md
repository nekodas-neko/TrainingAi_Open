# 2026-09-01 — LA-45: the screens now show the DEXA-corrected body fat

**Branch:** `feat/la-45-corrected-body-fat-display` · **Domain:** `body` / `app-shell` · **Lane:** B · **Version:** v1.420.0

## What was wrong

BF-2 step 4 shipped the engine: `/api/body-metadata` and `/api/day-log` carry `bodyFatCorrected` and
`bodyFatIsCorrected` per reading, and `body-metadata` returns `bodyFatCalibration` once per response.
**Nothing read any of it.** Every screen rendered `bodyFat`, the raw scale value — while the calorie
goal, the protein dose and `personalRmr` were already computed from the corrected one. Two numbers
for one measurement, with nothing on screen to say which was which, which is worse than neither being
corrected.

## What shipped

`components/health/body-fat-display.ts` holds the display rule in one place: `displayBodyFat`,
`isCorrectedReading` and `correctedSpan`. Seven surfaces now use it — the Health body-fat card, its
metric sheet, the lean-mass/BMR derivations, the BMI classification, the day-detail body row, the
week-day sheet's chip, More → Profile details, and the Goals card.

**Two invariants the module exists to hold, both easy to get backwards:**

- **`bodyFat` stays the value the log sheet seeds from.** `openLog` POSTs it back at source `manual`,
  which outranks `scale_ble` — so a corrected number round-tripped through the edit sheet would
  overwrite the measurement permanently and collapse the next calibration toward zero. Seed raw,
  display corrected.
- **"Corrected" is never inferred from the two values differing.** An offset can round to zero, and
  "corrected by 0.0" and "not corrected" are different claims. `bodyFatIsCorrected` is the only
  source for it.

**The card says why its number differs from the scale.** `DEXA-corrected +3.2% · 1 scan compared` —
the offset, because the owner asked to see it, and the pair count beside it, because at one pair this
is one comparison and not a settled calibration. On a window mixing instruments it adds
`3 of 4 corrected — earlier readings are on another instrument`, so the real step at the changeover
is explained rather than drawn.

**The local seed no longer clobbers the correction.** `health-content.tsx` runs the local-store read
and the network fetch concurrently and both write `setMetaRecent`; a local row carries the raw
reading and no calibration, so whichever landed second won. The seed now carries the correction
forward per date. Without it the number would have flickered back to the scale's value on the APK —
invisible here, since `getLocalStore` returns null on web.

**`app/health/health-sections.tsx` crossed 800 lines**, so the body-fat card moved to
`components/health/body-fat-card.tsx` — the rule for that hotspot is extract, not append. It is
**deliberately not `memo`'d**: `openLog` is re-created on every render of the orchestrator, so a memo
could never hit, and a wrapper that cannot fire reads as optimised to everyone after you. The
extraction also took `health-sections.tsx` from 50 hex literals to 43 and the new file to 2 — net −5,
because five repeats of the card's rose folded into one constant. Both baselines moved in the diff.

**`check-body-fat-correction.js`**: `health-sections.tsx`'s exemption is gone, as LA-45 asked. The
check now counts an import of `body-fat-display` as handling the correction, alongside
`body-fat-calibration` — a screen consumes a value some route already corrected, which is the only
way it can work, since correcting client-side would need the calibration on the device.

## The guard, and what killed it

`components/health/__tests__/body-fat-display-sites.test.ts` pins all six display files to the
helper, pins `openLog` to the raw field, and unit-tests the rule.

**Every assertion was mutation-verified — eight mutations, eight failures.** Reverting each display
site to the raw field turns its case red, and making `openLog` seed the corrected value turns the
inverse case red. One mutation nearly slipped: `body-fat-card.tsx` calls `.map(displayBodyFat)`
point-free, so the first sweep did not rewrite it and the guard "passed" on an unmutated file. It was
re-mutated properly (`.map(r => r.bodyFat)`) and does fail. **A mutation that does not change the
file is not a mutation** — that is a new shape of the same trap this session hit four times.

The file assertions read stripped source: comments in these files name the raw field constantly,
explaining why it must stay raw, and a guard matching prose is the failure mode already on record.

## Verified on `pnpm dev` against a fixture that exercises the real path

The seed has no DEXA scan and no `source_map`, so out of the box every reading returns
`corrected: false` and the whole feature is unreachable. Seeded locally: one DEXA at 21.2% on
2026-08-25, `scale_ble` provenance on the four newest readings and none on the older ones, giving
`offsetPct 3.2 · pairCount 1` and a genuinely mixed window.

- Payload: `2026-08-31 raw 18.1 → 21.3 corrected true`, `2026-08-29 raw 17.6 → 17.6 corrected false`.
- Health card: **21.6%**, `DEXA-corrected +3.2% · 1 scan compared`, `3 of 4 corrected`.
- **The log sheet seeded `18.4` while the card showed `21.6`** — the invariant that would otherwise
  destroy the measurement silently, checked on the running app rather than by reading.
- Metric sheet: 21.2 / 17.6 / 21.3, matching the card it opens from.
- Day detail 2026-08-31: `Body fat 21.3%`. More → Profile details and the Goals card: `21.6% · Today`.
- Lean mass 63.6 kg from 80.8 kg at 21.3% — the corrected figure, so the panel agrees with the goal.

## Not exercised

- **The S25.** Nothing here is device-verified. The local-seed fix in particular is only reachable
  on the APK, since `getLocalStore` returns null on web — the exact class where "works locally" has
  been wrong before.
- **The week-day sheet's `% BF` chip** did not render in the browser: reaching it needs a tap on the
  Home week strip that the harness could not drive. The change is a one-line swap covered by the
  source guard and the typecheck, but it was not seen.
- **The local dev database now holds a fabricated DEXA scan** (2026-08-25, 21.2%) and `source_map`
  stamps added by hand, so LA-45's path stays testable. It is fake, like the rest of that seed.
