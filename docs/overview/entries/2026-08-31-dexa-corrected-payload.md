# 2026-08-31 — BF-2 step 4: the corrected body fat reaches the payload, raw and all

**Branch:** `feat/dexa-correction-consumers` (folded into the step-3 PR) · **Lane A** · server only.

Step 4 finishes BF-2's engine. `/api/body-metadata` and `/api/day-log` now carry the DEXA-corrected
reading **beside** the raw one, per reading, plus the calibration itself once per response. No screen
reads any of it yet — that is **LA-45**, Lane B.

## Three fields, not one, and each earns its place

```
bodyFat:             25.3      // RAW. What the scale said. Seeds the log sheet's input.
bodyFatCorrected:    28.5      // What to DISPLAY.
bodyFatIsCorrected:  true      // Whether a calibration applied.
```

**`bodyFat` stays raw because a screen writes it back.** `openLog` (`health-content.tsx:493`) and
`log-value-sheet.tsx:32` pre-fill the body-fat input from this field and POST it at source `manual`,
a rank that outranks `scale_ble`. Return a corrected value here and saving an untouched field
overwrites the measurement, and the next calibration pairs the DEXA against an already-corrected
number.

**`bodyFatIsCorrected` is a third field rather than `bodyFatCorrected !== bodyFat`** because an
offset can legitimately round to zero. "Corrected by 0.0" and "not corrected" are different claims,
and a chart that infers the second from the first marks the wrong boundary.

`body-metadata` also returns `bodyFatCalibration: { offsetPct, pairCount, source } | null` — the
owner asked to be shown the offset, and `pairCount` is what says how far to trust it. At one pair an
offset and a ratio are the same number, so a screen must not present it as settled.

## The check caught its own exemption going stale

Once `body-metadata` and `day-log` started handling the calibration, their entries in
`scripts/check-body-fat-correction.js` became claims that were no longer true — and the script could
not see it, because it tested the exemption list *before* the import. It now tests the import first
and **fails on a file that imports the calibration while still listed as exempt**. Both were flagged
immediately and removed.

What the exemptions were carrying — *`bodyFat` specifically must stay raw* — is not something a
file-level check can express, so it moved to a test rather than being dropped.

## Verified

- **6 DB-backed tests** (2 new): the display payload carrying a corrected value with the raw one
  untouched, and an uncalibrated instrument reporting `corrected: false`.
- Full suite **682 files / 5,734 tests** · `pnpm check:rules` **Ran 64 of 64** · `tsc` clean.
- **Exercised live on `pnpm dev`** across two instrument eras:

  | Route / row | `bodyFat` | `bodyFatCorrected` | `bodyFatIsCorrected` |
  |---|---|---|---|
  | `body-metadata` today (`scale_ble`) | 25.3 | **28.5** | true |
  | `body-metadata` 2026-08-25 (`health_connect`) | 22.8 | 22.8 | **false** |
  | `day-log` today | 25.3 | **28.5** | true |
  | `day-log` 2026-08-25 | 22.8 | 22.8 | **false** |

  `bodyFatCalibration` came back `{ offsetPct: 3.2, pairCount: 1, source: 'scale_ble' }`, and
  `body_metrics.body_fat_pct` still reads 25.3 after every one of those calls.

- **Before the scan existed**, `bodyFatCorrected` equalled `bodyFat` with the flag false and the
  calibration null — so a user with no DEXA sees exactly what they see today.

## The gap this leaves, deliberately

The engine corrects and no screen shows it: the Health card renders 25.3 while the calorie goal is
already computed from 28.5. **Two numbers disagreeing on screen is worse than neither being
corrected**, so LA-45 is filed rather than left implicit, and it carries the seeding rule
(display `bodyFatCorrected`, seed the input from `bodyFat`) because getting that backwards is the
one way to lose the archive.

## Not exercised

Server-side only — no APK, and the device, safe-area, native-SQLite and WebView paths do not apply.
The route wiring is verified against the running dev server rather than in vitest: importing an API
route there pulls in next-auth, which does not load under the test runner.
