# Body — domain index

**Owns:** body weight, body composition (fat/muscle/water and their derivations), and weigh-in
handling — which day a reading is filed under, and reconciling manual entries against scale
readings.

**Does not own:** the Renpho scale radio and its BLE session ([`devices`](../devices/README.md)).
This is the smallest pillar; it exists separately because weight and composition feed several
others (energy balance, bodyweight 1RM, readiness) and shouldn't be buried inside any one of them.

## Code

| Area | Where |
|---|---|
| Composition maths | `packages/shared/src/health/body-composition.ts` |
| Scale capture (border with `devices`) | `lib/scale-ble/` |
| Ingest clock | `packages/shared/src/validation/ingest-clock.ts` — `resolveMeasuredAt` decides the day a weigh-in belongs to |
| Tables | `body_metrics` (weight, body fat, and the rest of the daily metric row) |
| Clinical results from a provider | `dexa_scans` + `dexa_scan_regions` (migration 240) ← `saveDexaScan`/`getLatestDexaScan`/`listDexaScans` ← `GET`/`POST /api/dexa-scans`; `measured_rmr` (225/226) ← `POST /api/measured-rmr`. Typed columns, no stored source document. **No UI on either, and measured 2026-08-31 both tables are EMPTY in production** — nothing calls either route from `app/`, `components/` or `lib/`, so the owner's real 2026-08-27 results have nowhere to go. Filed as **LA-44**; it is what gates BF-2 being *observable* |

## Reference docs

- [`docs/superpowers/plans/2026-08-31-dexa-filter.md`](../../superpowers/plans/2026-08-31-dexa-filter.md) — **BF-2's implementation plan.** Read-time correction, derived pairs, offset at n=1, and the sweep of every `bodyFatPct` read site — including `personalRmr`, where feeding the uncorrected scale number re-scales a measured RMR onto +45 kcal/day of fat-free mass the owner does not have.
- [`docs/superpowers/plans/2026-09-01-blood-panel-import.md`](../../superpowers/plans/2026-09-01-blood-panel-import.md) — **BF-1's implementation plan (engine half).** The schema is written from the real 41-analyte panel, so the shapes it has to survive are facts rather than guesses: `<0.2` is a result that is **not a number** (`value_num` + `value_operator`), reference ranges arrive two-sided, one-sided in **both** directions and absent (both bounds nullable), the collection date is a **month** (a precision column, or every panel lands on the 1st and lies), and flags are commentary — *"Normal (athletic)"* sits on a creatinine **inside** its range, which is why **out-of-range is derived from the bounds and never read off the flag**. Names the three markers that would change a recommendation (urea 9.2 vs the protein target; LDL/non-HDL high with triglycerides optimal — a fat-*quality* signal; fasting insulin 4 and glucose 4.8, whose value is *negative*, removing a hedge), because a table of 40 analytes nothing reads is this feature's failure mode.
- [`docs/clinical-baseline-2026-08-27.md`](../../clinical-baseline-2026-08-27.md) — **the owner's DEXA and RMR (2026-08-27) and a 58-analyte blood panel (2026-04), de-identified.** The measurements four queued entries were waiting on. **The first scale-calibration pair: DEXA 28.5 % body fat vs the same-day Renpho 25.3 % — the scale under-reads by 3.2 points** (BF-2 — planned 2026-08-31: the pairs are **derived** from `dexa_scans` × `body_metrics` rather than stored, and the form is an **offset** at n=1, since one pair supports neither claim). **Measured RMR 1325 kcal vs 1549 predicted, −14 %**, and Cunningham on the owner's own DEXA lean+BMC gives 1481 — **156 kcal over the measured value, so the over-estimate is not a body-composition error** (BF-33). The app's learned maintenance (1,827) lands within 5 kcal of the provider's Mild projected TDEE, implying a real activity factor of ≈1.38.
- [`docs/reviews/2026-08-31-battery-explainer-promises-inert-mechanisms.md`](../../reviews/2026-08-31-battery-explainer-promises-inert-mechanisms.md) — **the HOW IT MOVES card explains a model the app does not implement, 2026-08-31 (TN-19).** Owner's second report in six days: *"still not very usable."* The card lists 5 mechanisms; **4 are inert or backwards** — `Deep sleep` is structurally impossible (`walkBodyBattery` starts at wake), `Calm rest` produced **6 points across 8 days**, `Training` moves the end value **0.6 points** (Q-521), and `Daytime stress` rises on good days (Q-507). Only `High heart rate` works, and it tracks **wear time**. **2026-08-26 is the cleanest Q-521 demonstration available**: zero HR samples → zero drain, zero charge, ending exactly at its anchor. **⛔ Do not reword the card** — it is TN-15's spec rendered; ship TN-15 and it becomes true. Also records that **nothing in the chain has shipped** and TN-15/18/6a/6/2 sit at queue positions **75–83 of 235**.
- [`docs/reviews/2026-08-26-pillar-review.md`](../../reviews/2026-08-26-pillar-review.md) — **the five Home pillars answered, 2026-08-26.** Body Battery is missing **both** halves of the model the owner describes: `walkBodyBattery` filters to `tsMs >= wakeTime`, so **there is no overnight recharge at all** (the morning value is just the readiness score via `resolveAnchor`; mean anchor 64.8, "Charged" on 7 of 35 mornings), and drain is Q-521's wear-time proxy. Filed **TN-15** — **owner-signed-off, and it supersedes the standing "do not propose overnight charging or an anchor redesign" guidance**, which was written against chasing a symptom rather than against a stated requirement. **Sequence matters: TN-6, then TN-2, then this** — a recharge model cannot be evaluated on a boundary that calls 98% of waking time "draining".
- [`docs/reviews/2026-08-18-implausible-value-silent-drop.md`](../../reviews/2026-08-18-implausible-value-silent-drop.md) — **the same out-of-range value sent down both write paths, 2026-08-18** (Q-485 — web refuses it with a message, sync-push writes the row, drops the field and reports `errors: []`, with no log and no `error_events` row; 12 of 14 value checks in `pushMutations` coerce silently while 2 throw). **The bounds themselves mirror correctly** — both paths share one validation module.
- [`docs/reviews/2026-08-18-unvalidated-create-bodies.md`](../../reviews/2026-08-18-unvalidated-create-bodies.md) — **oversized and unvalidated request bodies, 2026-08-18** (Q-484 — `POST /api/injuries` accepts and stores a 10 MB `notes` and an unvalidated `startedDate`, while `PATCH /api/injuries/[id]` — the schema `CLAUDE.md` cites as the reference — caps the same fields at 100/1,000 chars with a date regex).
- [`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](../../reviews/2026-08-15-pillar-model-soundness-review.md)
  — §5: reviewed and **came back clean**. The 17-vs-68 composition-column gap is benign (those
  columns first appear 2026-07-29); the six tape-measure columns at 0 of 108 are *correctly empty*.
  No entries filed.
- [`docs/handoff-2026-07-29-ingest-and-records.md`](../../handoff-2026-07-29-ingest-and-records.md)
  — §Q-25 covers the weigh-in-filed-on-the-wrong-day fault and the clock-resolution fix.
- [`docs/reviews/2026-08-03-cross-domain-bug-review.md`](../../reviews/2026-08-03-cross-domain-bug-review.md)
  — Q-56 (open, investigation-first, shared with `devices`/`sleep`): real `body_metrics` rows landed
  dated up to 5 days in the future in production; one is still live and wrong as of 2026-08-03.
- [`docs/overview/entries/2026-08-31-bf-71-clinical-entry.md`](../../overview/entries/2026-08-31-bf-71-clinical-entry.md)
  — 🆕 **BF-71**: `More → Health → DEXA & RMR results` is where a scan or a metabolic test gets typed
  in. Both routes had shipped complete and **nothing called either**, so `measured_rmr` and
  `dexa_scans` were empty in production while every resting rate stayed predicted — a defect no test
  could fail for, because an empty table is a valid state. Read it before adding a field: only
  `scannedOn` and `pctFat` are read by anything today (`getBodyFatCalibration` selects exactly those
  two), the per-region bone rows are deliberately absent, and mass fields echo themselves in kg
  because the schema's grams bound cannot catch a value entered in the wrong unit.
- Plans: `ls docs/superpowers/plans/*body*` / `*scale*`.

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](../../reviews/2026-08-18-ingest-and-input-validation.md) — **the ingest surface and input validation, 2026-08-18** (Q-464 — `POST /api/body-metadata` writes to today when handed a key outside its contract, because the schema is not `.strict()`). Findings Q-464/Q-465; **no ingest route accepts a `userId` from the body, and value validation rejects physiologically impossible input on every route reachable in the harness.**

- [`docs/reviews/2026-08-18-battery-anchor-discontinuity.md`](../../reviews/2026-08-18-battery-anchor-discontinuity.md) — **the Body Battery anchor flip measured, and a constraint to protect, 2026-08-18** (Q-511 — the anchor takes the sleep score **raw**, and its sleep→readiness upgrade was worth **−17.7 points** on average, sd 10.2, worst −51: the owner's 2026-08-02 "the number visibly jumped" report, quantified. The sleep recalibration cut ~82% of that systematic offset as a side effect, so **the sleep and readiness scales being comparable is now load-bearing here** — lifting sleep back toward its old mean re-opens the bug. The per-day sd of 10.2 remains, so the freeze-once rule stays load-bearing too. Flip *frequency* is unobservable: `body_battery_daily` has never persisted `anchor_source = 'sleep'`).

- [`docs/reviews/2026-08-18-hr-rest-threshold-calibration.md`](../../reviews/2026-08-18-hr-rest-threshold-calibration.md) — **first calibration review of this pillar, 2026-08-18** (Q-515 — `HR_REST_THRESHOLD` is the rest/active boundary shared by Body Battery and the Activity Score, and its charge window collapsed **26.5% → 8.2%** of waking samples in one month. **Every input was correct**: a genuine fitness gain plus `resolveHrProfile` maturing `hr_max` from the age formula to an observed ceiling. The trap is a rate difference — resting HR fell 8.5 bpm while waking HR fell 4.2 — so a boundary pinned to resting moves twice as fast as the distribution it classifies. Sweeping the constant narrows the gap 3.2× → 1.4× but never closes it: **the anchoring is the defect, not the number**).

- [`docs/reviews/2026-08-19-body-derived-scores-closeout.md`](../../reviews/2026-08-19-body-derived-scores-closeout.md) — **the pillar's two unexamined derived scores, closed out 2026-08-19.** `bdi_derived` (46 rows, median 4.15, nothing ≥ 15) has **no threshold to calibrate** — its only consumer is a debug console labelling it *"observational, not a diagnosis"*. `body_comp` (71 rows) is a deterministic derivation whose one formula is deliberately matched to Oura's `atlas`. **Nothing to tune in either.** Useful byproduct: `body_comp.bmr_kcal` already persists the day's BMR, so **Q-517's proposed floor should read it rather than recompute** — with a fallback to the most recent snapshot on the 25 rows that lack one, never to the universal 1,000.

- [`docs/reviews/2026-08-19-body-battery-drain-and-roadmap.md`](../../reviews/2026-08-19-body-battery-drain-and-roadmap.md) — **why Body Battery doesn't feel right, from an owner brief, 2026-08-19** (Q-521 — drain tracks **ring wear time, not exertion**: `corr(hr_sample_count, total_drained)` **+0.518** against `corr(steps, total_drained)` **−0.153**, and a workout moves `end_value` by **0.6 points**. The four days ending at 0 had 828–4,152 steps. Includes the exertion-integrated design brief, the roadmap showing sleep is already delivered and Activity already specified, and the constraint that `active_calories` covers only 8 of 51 days).

- [`docs/reviews/2026-08-19-body-battery-drain-model.md`](../../reviews/2026-08-19-body-battery-drain-model.md) — **the Body Battery drain model, fitted 2026-08-19 — read before implementing
  Q-521.** Owner confirmed **goal-normalised** drain plus a **BMR-proportional baseline**
  (*"the fitter we get, the more workout stimulus we should need for draining, outside of BMR
  draining which should naturally go up too"*). Parameters: `baseline 25 × (bmrToday/bmrReference)`,
  activity `c^2.0` over a 50/50 workout-and-steps completion. **A linear split cannot satisfy the
  brief** — every allocation tried lands mean 26–34 / sd 16–22, because a typical day is ~58% of a
  full one. Expect **less** spread than today (sd ~22.6 vs 30.1) and that is correct: today's spread
  is largely ring wear time. Also found **one corrupt `body_comp` row** (2026-07-29: 3% body fat,
  BMR 1,890) which is inert today and becomes load-bearing the moment BMR drives drain — **Q-527**.
  **Traced 2026-08-30:** it is the 2026-07-28 no-contact weigh-in (impedance 0 → the estimator's own
  3% clamp floor), the scale-side guard for it already shipped and has held for 30 readings since,
  and `PLAUSIBLE_BODY_FAT_PCT` in `packages/shared/src/health/body-composition.ts` is now the
  last line before storage. **The one stored row is still there** — nulling it is the owner's call,
  and Q-521 must apply the same check on read rather than assume the write-site guard reached it.

## Open issues

```bash
grep -n '^### .*\[body\]' projectOverview.md   # 2 entries today
grep -n '\[body\]' docs/implementation-backlog.md   # Q-56 today
```

- 🔴 **Q-56 — future-dated `body_metrics` rows** (2026-08-03, open). See the review link above.
- ~~"Burned"/"Balance" cards read a broken, HC-only calorie source~~ **fixed 2026-08-05 (Q-96,
  v1.266.4)** — both now read `activeEnergyKcalToday` (`computeActiveEnergy()`), the same source
  already correctly feeding `EnergyBudgetCard`. See
  [`docs/overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).

Live at the time of writing (2026-07-30):

- **Scale passive-scan background sync** — the retry-storm fix was **confirmed on-device**
  2026-07-30 (v1.242.0); `ScaleBleService` moved from a continuous 45 s poll to a
  `BluetoothLeScanner` PendingIntent scan. Shared with `devices`.
- The direct-BLE Renpho scale integration itself is device-verified (2026-07-28) — shared with
  `devices`.

The scale-sync and Renpho entries above are shipped and device-confirmed; Q-56 (above) is the one
open item. Re-run the greps rather than trusting this list.

## History

- Handoffs: `ls docs/handoff-*-body-*.md` — plus
  [`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](../../handoff-2026-08-03-cross-owner-bug-batch-triage.md)
  (Q-69 — scale weight trend should use the day's lowest confirmed reading, not the first), filed
  under `cross` because it spans five pillars.
- Journal: `grep -rl 'weigh\|body.composition\|scale' docs/overview/entries/`

## Gotchas specific to this domain

- **A weigh-in's timestamp is not necessarily its day.** Route it through `resolveMeasuredAt`; a
  raw client timestamp filed a reading on the wrong day.
- **Bodyweight changes propagate.** Weight feeds bodyweight-1RM history, energy balance and
  readiness — a correction here can shift derived values elsewhere, which is exactly how the
  phantom Pull-Up PR happened.
- **Oura data must never overwrite manual or Health Connect values** — all upserts into
  `body_metrics` use `COALESCE(EXCLUDED.col, table.col)`.
