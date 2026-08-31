# 2026-08-31 — BF-2 step 3: the correction reaches the numbers, and cannot reach the archive

**Branch:** `feat/dexa-correction-consumers` · **Lane A** · JS/server only, no APK.

Step 3 of [the plan](../../superpowers/plans/2026-08-31-dexa-filter.md). The DEXA correction now
feeds every derived number. Step 4 (the per-reading `corrected` flag in the payload) is not built.

## The design question, and the measurement that answered it the other way

The plan left step 3 open with a number attached: `listBodyMetrics` has **22 call sites**, so
correcting *inside* that read would make a missed consumer impossible — the thing the sibling-surface
rule actually wants — but a read-then-write path would then persist a corrected value into the raw
column.

**On the server there is no such path.** Of the 22 callers, zero write body metrics back;
`body-metadata/route.ts` is the only file containing both, and they are different handlers — the GET
reads, the POST writes from the request body. Every writer (`sync-health`, `health-connect/ingest`,
`scale-ble/apply-reading`, the Oura rollup) writes from its own input.

**The client has one, and it is worse.** `health-content.tsx:493` and
`session-select/components/log-value-sheet.tsx:32` both seed their log field from
`metaToday[field]` — for body fat, `m.bodyFatPct` straight out of `/api/body-metadata`. So:

1. Health → Body Fat → Log pre-fills with the **corrected** 28.4.
2. Save without editing.
3. POST at source `manual`, which **outranks `scale_ble`** in `HEALTH_SOURCES`.
4. The corrected number overwrites the raw reading permanently, and the next calibration pairs the
   DEXA against an already-corrected value, collapsing the offset toward zero.

A self-corrupting loop that destroys the archive the whole design rests on. **So the correction is
applied per consumer**, and the answer to "how do we not forget one" is a CI check rather than a
convenient place to put it.

## What corrects, what stays raw, and why each

| Corrected | Reaches |
|---|---|
| `lib/health/energy-balance-service.ts` | BMR → resting burn → TDEE |
| `app/api/nutrition-goals/recommend/route.ts` | calorie goal, protein dose, and **`personalRmr`'s current fat-free mass** |
| `persistBodyCompFromMetrics` (`slices/oura.ts`) | the `oura_daily_derived.body_comp` snapshot, per row |

| Stays raw | Because |
|---|---|
| `app/api/body-metadata/route.ts` | it seeds the edit sheet — the laundering path above. This one *must* stay raw |
| `app/api/day-log/route.ts`, `app/health/health-sections.tsx` | display; a corrected number without the `corrected` flag beside it is unexplained, and that flag is step 4 |
| `build-day-audit.ts` | an **audit** reports what was stored; correcting it would make it disagree with the row it audits |
| `app/api/progress-summary/route.ts` | `getBodyMetricsBaseline` is the first reading ever, which predates `source_map` and carries no provenance |

`persistBodyCompFromMetrics` takes the calibration as a **required** parameter, not a defaulted one.
A default would be a silent no-op: the backfill would run, report a write count, and quietly persist
uncorrected snapshots. Both callers — the adapter and the rollup — now fetch it.

## The check is the answer to "one site will be missed"

`scripts/check-body-fat-correction.js` (Custom Rules, now **64 of 64**) has two rules, because there
are two ways to consume a stored reading: *derive* from it (`bodyComposition`/`bodyCompSnapshot`/
`cunninghamBmr`), or *pass it on* (read `bodyFatPct` off a `listBodyMetrics` result). **Rule 1 alone
would have missed the calorie goal**, which never calls a deriver — it feeds `calculateBaseline`.

Rule 2 also found a consumer this session had not enumerated: `build-day-audit.ts`. Every exemption
states why in prose, and a **stale** exemption fails too — a file listed as considered that no longer
consumes anything reads as a decision and gets trusted.

## Verified

- **4 DB-backed consumer tests**, each proving a consumer *moves*: the `body_comp` snapshot, the
  energy-balance resting burn, an uncalibrated instrument staying untouched all the way through, and
  the stored column staying raw with its provenance beside it.
- **Four mutations on the check**, all killed: rule 1 dropped, rule 2 dropped, the goal route reverted
  to raw, and a stale exemption.
- Full suite **680 files / 5,728 tests** · `pnpm check:rules` **Ran 64 of 64** · `tsc` clean.
- **Exercised live on `pnpm dev`**, seeding the owner's real pair (71.7 kg, 25.3 % scale, 28.5 % DEXA):

  | Route | Without the scan | With it |
  |---|---|---|
  | `/api/nutrition/energy-balance` → `restingBaseKcal` | 1832 | **1773** (−59 kcal/day) |
  | `/api/nutrition-goals/recommend` → calories | 1961 | **1889** |
  | `/api/body-metadata` → `today.bodyFat` | 25.3 | **25.3** (raw, as required) |
  | `body_metrics.body_fat_pct` | 25.3 | **25.3** (archive intact) |

  −59 kcal/day is exactly the predicted `3.2 points × 71.7 kg × 0.216 × 1.2`.

- **Protein: be precise about which number moves.** The deterministic baseline shifts as predicted —
  BMR 1528 → 1478, calories 1634 → 1574, protein **118 → 113 g**, lean mass 53.6 → 51.3 kg. The
  *recommended* protein came back 160 both ways, because the model picks that on top of the baseline.
  The plan's "≈5 g/day on the protein goal" is a claim about the baseline, and this is what it looks
  like measured.

## Not exercised

Device, safe-area, native SQLite and WebView paths — server-side only, so no APK. The Lane B display
surfaces are unchanged by design and were not run; `health-sections.tsx` still derives from the raw
payload and is exempt in the check with that reason, pending step 4.
