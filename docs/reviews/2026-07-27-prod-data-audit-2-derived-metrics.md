# Production data audit #2 — derived metrics, baselines and stored counters (2026-07-27)

Second whole-history sweep using the read-only endpoint (`POST /api/admin/db-query`), per
[`docs/data-quality-review-charter.md`](../data-quality-review-charter.md). Read-only, row-scoped to
the owner (`fe481797…`). Every number below is from production.

**Scope:** 57 sleep sessions, 21 `oura_daily_summary` nights, 70 `oura_daily_derived` days, 75
workout sessions / 288 exercise logs / 819 set logs, 88 body-metric rows, 588 k raw BLE samples, and
the full periodization surface (4 programs, 10 `session_periodization` rows, 5 live AI prescriptions,
24 progression styles).

Findings F-1…F-4 from [`2026-07-27-prod-data-audit.md`](2026-07-27-prod-data-audit.md) are **not**
re-reported. F-1 is still open, so `sleep_score`/`readiness_score` were treated as untrustworthy
throughout and never used as ground truth.

---

## ⚠️ Two method notes, stated up front

**1. Admin → Day Review was unreachable.** `GET /api/admin/day-review?date=…` returns **401** with the
`CLAUDE_DB_QUERY_SECRET` — that route's bearer path needs `ADMIN_EXPORT_SECRET`, which this session
was not given. Rather than reimplement any formula in SQL (explicitly forbidden by the charter), the
scoring evidence below was produced by **running the real modules** against production rows in a
throwaway vitest file: `computeSleepScore` (`lib/health/sleep-score.ts`) and `decodeEventBody`
(`lib/oura-ble/decode.ts`). No second implementation of anything was written. Supplying
`ADMIN_EXPORT_SECRET` to a future session would let the contributor/weight breakdown be confirmed
directly.

**2. This covers Postgres only.** Native SQLite (the on-device source of truth), the mutation
outbox and dead-lettered syncs, BLE drain/connection behaviour, safe-area insets, gesture handling
and Samsung WebView rendering leave **no trace** in this database. **A clean data audit is not "the
app is healthy."** [`docs/device-smoke-checklist.md`](../device-smoke-checklist.md) remains the
authority for that half, and several findings below (Q-7, Q-11) are only *observable* here — their
root cause may well be on the device.

---

## 🔴 Q-1 (HIGH) — the nightly rollup keys on wake-day with **last-window-wins**, so an evening nap overwrites the whole night in `oura_daily_summary` — poisoning the persisted EMA baselines and producing the three worst readiness scores in history

This is F-1's *shape* (`code assumes one row per key, data has two`) in a **different module**, with
worse consequences: F-1 corrupts a displayed score, Q-1 corrupts the **checkpointed baselines that
every later z-score is measured against**.

`lib/data/postgres/adapter.ts:4815`:

```ts
// A night can produce two windows sharing a wake-day (main night + an
// evening fragment) — last-window-wins per field […]; only the longer main
// window should usually survive here since nightWindows already merges close clusters.
nightInputsByDate.set(wakeDate, { … })
```

Windows are processed in chronological order, so an **evening nap wakes later than the morning** and
its `.set()` lands last. The comment's "should usually survive" assumption does not hold in
production. 4 of 21 `oura_daily_summary` rows (19%) hold a nap's numbers instead of the night's:

| Day | Row persisted in `oura_daily_summary` | The real night that was discarded |
|---|---|---|
| 2026-07-10 | dur **1.42 h**, eff 74, rhr_low **67.5**, hrv 54.0 (18:19→20:10 nap) | 8.83 h, eff 92, rhr_low 58, hrv 40.0 |
| 2026-07-16 | dur **0.25 h**, eff **17**, rhr_low **69.8** (10:17→11:42 nap) | 7.33 h, eff 96, rhr_low 57, hrv 43.5 |
| 2026-07-21 | dur **1.33 h**, eff 84, rhr_low **75.2**, hrv **NULL** (18:18→19:52 nap) | 7.75 h, eff 90, rhr_low **52**, hrv 61.0 |
| 2026-07-26 | dur **0.00 h**, eff **0**, rhr_low **73.4**, hrv 25.0, breath **6.7** (17:25→18:10) | 7.00 h, eff 94, rhr_low 60, hrv 34.0, breath 10.0 |

**The correlation with the persisted scores is total.** Full readiness history is 12 values —
87, 84, 80, 70, 69, 63, 62, 60, 48, 48, 37, 29 — and the bottom three belong to nap-contaminated days:

| Day | Summary row is… | `readiness_score` | `illness_score` | `illness_flag` |
|---|---|---|---|---|
| 2026-07-16 | the 0.25 h nap | **48** | 0 | learning |
| 2026-07-21 | the 1.33 h nap | **37** | **39** | normal |
| 2026-07-26 | the 0.00 h artefact | **29** | **43** | **watch** |

On **2026-07-26 the app raised an illness "watch" and suppressed readiness to 29** on the strength of
a 45-minute row containing zero sleep — while a 7.00 h / 94%-efficiency night with hrv 34 and a
60 bpm resting HR sat unused in the same table.

**Why this is worse than F-1:** these rows feed `computeDailySummaries`, whose six EMA baselines
(HRV, RHR, temperature, sleep duration, MET, breathing) are **checkpointed and resumed** from the
persisted row (`getLatestOuraDailySummaryBefore`, `adapter.ts:5166`). A nap folded into the baseline
is baked in permanently — later reads resume from the poisoned checkpoint rather than replaying. A
fix therefore needs a **full-history replay**, not just a forward-looking correction.

**Query:**
```sql
SELECT date, round(sleep_duration_hours::numeric,2) dur, sleep_efficiency, round(rhr_low_bpm::numeric,1) rhr,
       round(hrv_avg_ms::numeric,1) hrv, round(breath_avg_rpm::numeric,2) breath, n_history
FROM oura_daily_summary ORDER BY date;
-- cross-check each against every session that day:
SELECT date, to_char(sleep_start AT TIME ZONE 'Australia/Brisbane','MM-DD HH24:MI') st,
       round(duration_hours::numeric,2) dur, efficiency, lowest_heart_rate, average_hrv_ms
FROM sleep_sessions ORDER BY sleep_start;
```

**Remedies (pick one — they differ in meaning):**
- **(a) Longest window wins** per wake-day — simple, matches F-1's likely fix, but "longest" is not
  always "the night" (a 3 h afternoon sleep beats a 2.5 h broken night).
- **(b) Circadian window** — only a window whose midpoint falls in a night band (e.g. 20:00–10:00
  local) may claim the wake-day; others are recorded as naps and excluded from baselines.
- **(c) Merge, don't pick** — sum the day's sleep windows into one summary row. Changes the meaning
  of "a night" and of every existing baseline.

Whichever is chosen, it must be applied at **all three** selection sites together (this one,
`readiness-score/route.ts`, `lib/health/score-audit/sleep.ts`), and F-2's backfill must run *after*
it, on a full-history replay — otherwise nap-derived baselines are re-persisted permanently.

---

## 🔴 Q-2 (HIGH) — `temp_event` frames carry **three interleaved temperature channels**; the rollup flattens them into one time-series, so nightly temperature is effectively a 0.5 °C-quantised middle channel

> **⚠️ Superseded twice — read the two correction blocks at the end of this section before acting on
> anything here.** The *outcome* stands (nightly temperature is a quantised whole degree). The
> mechanism below is wrong, and so is the first correction's: `open_oura` decodes these bodies as a
> flat probe **vector**, not as named channels, and the decoder in this repo is already correct
> against it. The real defect is the rollup treating one frame's simultaneous probes as consecutive
> points in time.

The decoder emits every i16 in an event body as a temperature, unlabelled
(`lib/oura-ble/decode.ts:68` `decodeTemperatures`). Decoding real production `body_hex` for tag
`0x46` (70, `temp_event`) with the app's own `decodeEventBody`:

```
hex=1b0dac0df70d -> {"temps_c":[33.55, 35.00, 35.75]}
hex=f90c7a0de30d -> {"temps_c":[33.21, 34.50, 35.55]}
hex=ec0c480ddd0d -> {"temps_c":[33.08, 34.00, 35.49]}
hex=c40d100eb40e -> {"temps_c":[35.24, 36.00, 37.64]}
```

Across 40 frames (2026-07-22) the **middle field takes only 5 distinct values — 34.0, 34.5, 35.0,
35.5, 36.0, i.e. exact 0.5 °C steps** — while fields 0 and 2 take ~37 distinct values each and
consistently bracket it (`f0 < f1 < f2`). These are three **channels** (a coarse/reference value
between two fine ones), not three consecutive time samples.

The rollup treats them as time samples, stamping all three with the same `ds`
(`adapter.ts:4793-4799`):

```ts
for (const c of numArr(r.decoded, 'temps_c')) tempSamples.push({ ds: Number(r.ds), centi: Math.round(c * 100) })
…
const nightlyCenti = nightlyTemperatureCentiC(tempSamples.map(t => t.centi))
```

`nightlyTemperatureCentiC` (`lib/health/temperature-baseline.ts:25`) is a faithful open_oura port
that runs a **median-7 rolling filter** over what it assumes is one ordered series. A median-7 over
an interleaved `[lo, mid, hi, lo, mid, hi, lo]` stream lands on the **mid** channel — which is
exactly what production shows:

`oura_daily_summary.temp_mean_c` over 20 nights: **36.00, 35.00, 35.00, 36.00, 35.99, 35.63, 37.00,
35.00, 35.00, 37.00, 36.00, 36.00, 36.00, 36.00, 36.00, 36.00, 34.00, 37.00, 37.00, 35.00** — 17 of
20 are whole degrees, and nightly skin temperature apparently swings **34 → 37 °C** for the same
sleeping person.

**Consequence:** the temperature EMA's own spread converges to `temp_baseline_dev_x8 = 2102` →
**2.63 °C**. A z-score built on a 2.6 °C standard deviation has essentially no discriminative power,
so the `bodyTemperature` readiness contributor and the illness radar's `tempZ` are effectively noise.
The resilience step compounds it — it *averages* the flattened channels
(`adapter.ts:5219 tempBaseline = mean(dayTemp)`), i.e. the mean of three different sensors.

**Query / repro:**
```sql
SELECT tag, body_hex FROM oura_raw_samples
WHERE tag IN (70,117) AND measured_at >= '2026-07-22' AND measured_at < '2026-07-23'
ORDER BY ring_timestamp_ds LIMIT 40;
```
then feed each `body_hex` through `decodeEventBody(70, hexToBytes(hex))`.

**Remedies:**
- **(a)** Establish what the three fields are against the `open_oura` source / the `oura-native-ble`
  skill (the charter's "verify against the pinned source" rule), name them in the decoder
  (`temps_c` → e.g. `{skin_c, ref_c, inner_c}`), and feed `nightlyTemperatureCentiC` **one** channel.
  Correct, but needs protocol work.
- **(b)** Interim: pass only field index 0 (or 2) as the series — restores a real-resolution signal
  immediately without settling the semantics.
- **(c)** Leave the decode and de-interleave in the rollup only. Cheapest, but leaves the same trap
  for the next consumer of `temps_c` (the resilience step already fell into it).

Any of these changes the meaning of stored `temp_mean_c` / `temp_dev_c` and requires a redecode pass
over `body_hex` (which is archival, so this is possible — see the Oura-BLE rules in `CLAUDE.md`).

### ⚠️ Correction — re-verified 2026-07-27 against full production history

The finding above was raised from a **40-frame sample of one tag**. Re-checking it against all
30,135 `0x46` rows and re-running the real shipped code confirms the *outcome* but corrects the
*mechanism*, and changes which interim remedy is right. The backlog entry carries the corrected
version; this block records what changed and why.

**Wrong: "the median-7 lands on the coarse middle channel."** Not demonstrated. Running the shipped
path over `0x46` alone for one night returns 36.50 °C, and over its field 1 alone 36.00 °C — neither
is what production stored by that route. The actual series is a mix of **three** tags with **three
different body shapes**, all decoded by the same `decodeTemperatures` (`decode.ts:488-491`):

| tag | name | rows | i16 per body |
|---|---|---|---|
| `0x46` (70) | `temp_event` | 30,135 | always 3 |
| `0x69` (105) | `temp_period` | 607 | always 1 |
| `0x75` (117) | `sleep_temp_event` | 3,305 | 7 in 96.4% |

`adapter.ts:4861-4869` concatenates all three into one `tempSamples` array — stamping every value in
a frame with that frame's single `ds` — sorts by `ds`, and feeds it to `nightlyTemperatureCentiC`.
So the "one ordered series" assumption is violated three ways at once, not one, and the
within-timestamp order is an artefact of tag ordering.

**Right, and now reproduced end-to-end.** The shipped path over the real 631 frames of
2026-07-21 13:00–21:00 UTC returns **36.00 °C** — exactly the `temp_mean_c` production holds for
2026-07-22. Same frames, one channel at a time:

| series | nightly value |
|---|---|
| all three tags flattened (**ships today**) | **36.00 °C** ← matches production |
| `0x46` field 0 (+ `0x69`, `0x75`) | 35.33 °C |
| `0x46` field 1 (+ `0x69`, `0x75`) | 36.00 °C |
| `0x46` field 2 (+ `0x69`, `0x75`) | 37.15 °C |
| **`0x75` alone** | **35.76 °C** |
| `0x69` alone | `null` (16 frames — under the 4-window minimum) |

**Understated: the field structure is much stronger than a 40-frame sample showed.** Across all
30,135 `0x46` rows, **f0 ≤ f1 ≤ f2 in 30,092 (99.86%)**; f0 and f2 take ~1,540 distinct values each,
f1 takes 280 of which **98.3% are exact multiples of 0.5 °C**. The "5 distinct values" figure was an
artefact of the small sample; the 0.5 °C grid is real.

**Restated at full scale:** of the 21 nights with a value, **19 are exact whole degrees**, range
34.00–37.00 °C, σ = 0.743 °C.

**The interim remedy changes.** Remedy (b) above — "pass only field index 0 (or 2)" — is wrong: it
leaves `0x69` and `0x75` mixed into the same series and yields 35.33/37.15 °C.

**Protocol boundary reached — five questions raised for the owner.** They were answered against the
`open_oura` source the same day, and the answers change the diagnosis again. See the next block.

### ⚠️ Second correction — answered against `open_oura` (2026-07-27)

The owner supplied the authoritative answers from `open_oura`
(`crates/oura-protocol/src/events.rs`, the `0x46 | 0x69 | 0x75` arm of `decode_body` plus
`decode_temperatures`). They invalidate the "three channels" framing that **both** the original
finding and the first correction were built on. Recorded in full because a wrong protocol model is
exactly what this section is for.

**1. There are no fields.** `open_oura` decodes all three tags with **one shared decoder** that reads
the body as a **flat, variable-length little-endian i16 array of centi-°C**, divides by 100, and
gates the result to −40…85 °C (out of range ⇒ the whole event decodes to `None`). That is the entire
scaling contract. There is no `field0`/`field1`/`field2`, no skin/ambient/reference split. My
"three int16 fields" framing — and the original "three interleaved channels" — are **not supported by
the source**, and neither is a per-field quantisation rule.

**2. The decoder in this repo is already correct.** `lib/oura-ble/decode.ts`'s `decodeTemperatures`
matches `open_oura` exactly: same shared arm for `0x46 | 0x69 | 0x75`, same flat i16 → `temps_c`,
same ÷100. **No decoder change is warranted.** Every remedy that proposed naming or splitting fields
is off the table.

**3. The "7 probes" comment belongs to `0x46`, not `0x75`.** `open_oura`'s source comment reads
`temp_event (7 probes)` — i.e. it models `0x46` as a probe *vector*. `0x75 sleep_temp_event` has no
hardcoded count and is decoded as arbitrary-length. This directly contradicts the first correction,
which argued for `0x75` partly because its 7-value body "is the shape the median-7 stage expects."
That reasoning was wrong. Note also that production `0x46` bodies are **always 3** values, never 7 —
so the probe count is firmware/hardware-specific and must never be hardcoded either way.

**4. Question 2 is unanswerable here.** `nightly_temperature_calculate @ 0x203520` is an address in
the *Oura app binary*, not in the BLE protocol. `open_oura` covers only tag → bytes → JSON and says
nothing about which decoded stream the app's nightly routine reads. Answering it needs the app
binary, which we do not have. **This is the one question that remains genuinely open.**

**What survives, and it is the whole bug.** If a body is a vector of probes read at one instant, then
the values inside a frame are **simultaneous**, not sequential. The rollup pushes them into
`nightlyTemperatureCentiC` — a **temporal** median-7 → 30-sample-window → `min(window maxima)`
pipeline — as consecutive samples, and does it across three tags at once. 631 frames become 2,398
"samples" on 631 real timestamps. The defect was never in the decode; it is entirely the rollup's
assumption that one frame is one point in time.

**The obvious fix does not work, which is worth knowing before someone tries it.** Collapsing each
frame to a single value before the temporal filter is the structurally correct move, and it still
produces a whole degree:

| series | nightly value |
|---|---|
| flatten every probe (**ships today**) | 36.00 °C |
| per-frame **median**, all tags | 37.00 °C |
| per-frame mean, all tags | 36.90 °C |
| per-frame max, all tags | 38.02 °C |
| per-frame median, `0x46` only | 37.00 °C |
| per-frame median, `0x75` only | **35.91 °C** |

The reason is now clear: `0x46` frames hold three values with the middle one on a 0.5 °C grid in
98.3% of 30,135 rows, and `f0 ≤ f1 ≤ f2` in 99.86% — so the **median of a 3-probe frame is exactly
the quantised probe**. Any collapse that takes a median inherits the quantisation from `0x46`.

**Revised remedy, stated honestly as empirical.** Use `0x75 sleep_temp_event` alone, one value per
frame. It is the only variant tested that yields a non-quantised result (35.76 °C flattened,
35.91 °C per-frame median), and it fires only while asleep, which is the algorithm's domain. It is
**not** justified by the "7 probes" comment (that belongs to `0x46`) — it is justified by the
measurement. Whether it is what the ring's own firmware uses is exactly the question the app binary
would settle.

---

## 🟠 Q-3 (HIGH) — `restless_periods` silently changed meaning at the BLE cutover (Oura restlessness 138–330 → our awakenings count 0–5) while keeping the same column **and the same scoring curve**

BLE nights write `restlessPeriods = model.awakenings` (`adapter.ts:4756`) — a count of wake bouts.
Oura Cloud's `restless_periods` is its own restlessness measure on a completely different scale.
Same column, same Sleep-Score curve.

`RESTLESS_PENALTY = [[0,0],[10,5],[20,12],[35,22],[50,32]]` (`lib/health/sleep-score.ts:67`) and
`interp` **clamps at both ends** — so every Cloud-era night (138–330) took the maximum 32-point
penalty regardless of how restless it actually was, and every BLE night (0–5) takes ~0.

Production, main sleeps ≥ 4 h only:

| era | nights | `restless_periods` min / avg / max |
|---|---|---|
| Cloud (to 2026-07-07) | 15 | 138 / **230.6** / 330 |
| BLE (from 2026-07-08) | 20 | 0 / **2.5** / 5 |

**Real-model evidence** — `computeSleepScore` run against the production rows, with a counterfactual
column re-scoring each night on the *other* era's scale:

```
2026-07-03  era=cloud restless=218  score= 89  restfulness=57  | other-era scale: score= 92  restfulness=88
2026-07-05  era=cloud restless=157  score= 81  restfulness=44  | other-era scale: score= 84  restfulness=75
2026-07-07  era=cloud restless=233  score= 86  restfulness=47  | other-era scale: score= 90  restfulness=78
2026-07-18  era=ble   restless=  0  score= 94  restfulness=98  | other-era scale: score= 91  restfulness=66
2026-07-23  era=ble   restless=  1  score= 96  restfulness=93  | other-era scale: score= 93  restfulness=61
2026-07-27  era=ble   restless=  3  score= 95  restfulness=87  | other-era scale: score= 91  restfulness=57
```

The **restfulness contributor the user sees on the Sleep detail screen moves by ~31 points purely
from the units change** (44–57 Cloud vs 87–98 BLE). Total score effect is +3…+4 (weight 10/100), so
this is a contributor-level and trend-level defect rather than a headline-score one — but any
cross-era "restfulness" trend is meaningless, and `chronic-stress-assembly.ts:65` reads the same
column as `gotUps` over a trailing 31-night window that straddles the cutover.

**Query:**
```sql
WITH n AS (SELECT *, CASE WHEN source_map ? 'oura_id' THEN 'ble' ELSE 'cloud' END era
           FROM sleep_sessions WHERE oura_id IS NOT NULL AND duration_hours >= 4)
SELECT era, count(*), min(restless_periods), round(avg(restless_periods),1), max(restless_periods)
FROM n GROUP BY era;
```

**Remedies:** (a) recalibrate `RESTLESS_PENALTY` for the awakenings scale and migrate/normalise the
Cloud-era values; (b) split into two columns (`restless_periods` vs `awakenings`) and let the model
pick by availability; (c) drop `restlessPeriods` from restfulness entirely and lean on
`efficiency` + `awakHours`, which are already there and did not change units.

---

## 🟠 Q-4 (MEDIUM) — `respiratory_rate` is populated from an estimator whose own documentation says it is not calibrated, and it sits in the column that used to hold Oura's calibrated value

`lib/health/breathing-rate.ts` is explicit:

> *"We deliberately do NOT try to reproduce Oura's exact breaths-per-minute: their ecore port needs a
> resample kernel the reverse-engineering never recovered … `rateBrpm`: Breaths per minute (rough —
> **for display/debug only, not calibrated to Oura**)."*

`adapter.ts:4653-4656` takes the median of those per-epoch `rateBrpm` values and writes it to
`sleep_sessions.respiratory_rate` **and** `oura_daily_summary.breath_avg_rpm` — the same columns that
previously carried Oura Cloud's value, with no source distinction beyond `source_map`.

| era | nights | respiratory_rate min / avg / max |
|---|---|---|
| Cloud | 15 | 12.6 / **13.11** / 13.5 |
| BLE | 20 | 8.3 / **9.32** / 10.3 |

**The ranges do not overlap.** 13.1 rpm is a normal adult sleeping respiratory rate; 9.3 rpm sits
below the normal range. The BLE value is ~29% low and is the input to the breathing EMA baseline, to
illness radar's `breathZ`, and to whatever renders it.

Same query shape as Q-3 (`avg(respiratory_rate)` by era).

**Remedies:** (a) calibrate against the 15 overlapping Cloud nights and apply a correction factor;
(b) stop persisting it and mark the breathing contributor unavailable until a calibrated estimator
exists (honest, loses a signal); (c) keep it but store it in a distinct column so the calibrated
Cloud history and the uncalibrated BLE estimate are never averaged or trended together.

**Two more columns shifted regime at the same cutover.** Both have plausible methodological
explanations (`average_hrv_ms` becomes `medianGated(rmssdSamples)` at `adapter.ts:4757`;
`lowest_heart_rate` becomes the binned resting HR rather than a true minimum) — flagged for a
calibration check, **not** asserted as bugs:

| column | Cloud avg (range) | BLE avg (range) |
|---|---|---|
| `average_hrv_ms` | 27.5 (20–39) | **49.0** (34–67.5) — +78%, no overlap |
| `lowest_heart_rate` | 65.1 (57–70) | **56.7** (52–61) — −8.4 bpm, barely overlaps |
| `onset_latency_sec` | 875 | 510 |

A real 2-week fitness change cannot produce non-overlapping HRV ranges. Whether the *new* numbers or
the *old* ones are right, no baseline, trend or z-score may span 2026-07-07 without a documented
conversion.

---

## 🟠 Q-5 (MEDIUM) — `personal_records` is not the all-time best; an unguarded seed route overwrites it with values that exist in no workout

`POST /api/personal-records/seed` calls `repo.upsertPersonalRecord(...)` — the **unconditional**
upsert — with no `IfBetter` gate, no Zod validation, and `achievedAt` defaulting to `new Date()`.
(`upsertPersonalRecordIfBetter` and `reconcilePersonalRecord` both exist and are correct; the seed
route bypasses them.) Its only caller is `components/workout-builder/builder-review.tsx:395`, so
building/reviewing a program rewrites PRs.

5 of 36 PR rows disagree with the best surviving log:

| Exercise | `personal_records` | best real log | delta | note |
|---|---|---|---|---|
| Barbell Bench Press | **90.8** @ 2026-06-21 11:40 | **96.0** @ 2026-05-22 | **−5.2 kg** | 90.8 appears in **no** exercise log |
| Barbell Front Squat | **67.5** @ 2026-06-13 | **73.8** @ 2026-05-24 | **−6.3 kg** | PR is the *latest* value, not the max |
| Tricep Cable Combo | **33.3** @ 2026-06-20 20:04 | 29.3 | +4.0 kg | 33.3 appears in **no** log |
| Dumbbell Hammer Curl | **19.3** @ 2026-06-29 18:46 | 15.8 | +3.5 kg | ditto |
| Straight Arm Pulldown | **34.5** @ 2026-06-29 18:46 | 32.5 | +2.0 kg | ditto |

The deload gate is **not** the explanation — every higher log is `exercise_deloaded = false`,
`phase_type` NULL or `'normal'`, `is_early_deload = false`, so `reconcilePersonalRecord` would pick
96.0 and 73.8. And two PR timestamps carry **two exercises at the same minute** (2026-06-20 20:04;
2026-06-29 18:46), evening times matching no workout — the signature of a bulk seed write.

**Query:**
```sql
WITH elmax AS (
  SELECT el.exercise_name, max(el.estimated_1rm) m
  FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
  WHERE el.deleted_at IS NULL AND ws.deleted_at IS NULL GROUP BY 1)
SELECT pr.exercise_name, pr.estimated_1rm, elmax.m
FROM personal_records pr LEFT JOIN elmax USING (exercise_name)
WHERE elmax.m IS NULL OR abs(pr.estimated_1rm - elmax.m) > 0.6;
```

**Related, same table:** PR identity is the **exercise name text**, not `exercise_id` (the column
exists but the unique key is `(user_id, exercise_name)`). Production carries five near-duplicate
pairs — `Dumbell Preacher Curl` / `Dumbbell Preacher Curl`, `Dumbell Shoulder Press` /
`Dumbbell Shoulder Press`, `DB lateral Raises` / `Dumbbell Lateral Raise`, `Cable Pulldown` /
`Cable Lat Pulldown`, `Cable Crunch` / `Cable Crunch Abs` — each splitting one exercise's all-time
best into two rows. 3 PR rows have a NULL `exercise_id`. This is the CLAUDE.md "identity = DB id, not
name" rule.

**Remedies:** (a) make the seed route use `upsertPersonalRecordIfBetter` and reject values with no
supporting log; (b) delete the seed route and let PRs derive from logs only (`reconcilePersonalRecord`
already does this correctly) — cleanest, but loses pre-app PRs the owner may have seeded
deliberately; (c) keep the seed but mark seeded rows with a `source` column so a reconcile can tell
"claimed" from "earned". Either way a one-off reconcile pass over all exercises would correct the
five rows above. Separately: re-key PRs on `exercise_id`.

---

### ⚠️ Addendum — traced 2026-07-28: the seeded value never reaches the bar

Tracing every consumer of a seeded PR, to decide whether deleting the route was safe, turned up a
larger and more user-visible defect than the drifted rows above.

**1. The "Starting weights" feature does not do what it says.** `builder-review.tsx:691` offers
*"Enter your 1RM for each main lift to pre-seed working weights"*. The value is POSTed to the seed
route and lands in `personal_records` — but `lib/workout/session-data.ts:226` sets
`estimated1rm: lastLog?.estimated1rm ?? null` and **never consults `prMap`**, even though it reads
`prMap` two lines earlier for the PR badge and the bodyweight rep basis. With no prior log,
`computeInitialWeights` (`components/workout-screen.tsx:58-74`) falls through every branch:

```ts
if (ex?.progressionStyle && ex?.estimated1rm) …   // estimated1rm is null
if (ex?.target80 != null) …                        // null
if (ex?.estimated1rm) …                            // null
if (ex?.latestWeight != null) …                    // null
return 60;                                         // ← the bar, for every weighted lift
```

A brand-new weighted exercise loads **60 kg** whether or not the user typed a 1RM.

**2. Two weight paths disagree.** `/api/next-session/prescription/route.ts:111` computes
`basis = Math.max(lastLog?.estimated1rm ?? 0, prMap.get(name) ?? 0)` and renders real kg on the
done-screen "next workout" card (`:122`). The workout screen uses the last log alone. Whenever a PR
exceeds the last log's estimate — or there is no last log — **the preview and the session it previews
show different weights**. Same metric, two implementations, in the most user-visible place in the app.

**3. Deleting the seed route would regress a working flow.**
`app/api/ai-periodization/baseline/complete/route.ts:53-58` hard-fails with `code: 'no_prior_data'`
when no PR exists. For a new user on an `ai_dynamic` program the seed is the only way to populate
`personal_records` before the first log, so "skip the AMRAP baseline, use my existing numbers" would
become permanently unreachable.

**Consequence for the remedy.** The owner's decision — PRs derived from logs only — is right and
unchanged. But it must be delivered by giving the user-entered starting 1RM its **own** store, not by
deleting it: one table has been serving two meanings (an earned record and a seed estimate), and that
conflation is the whole bug. The fix that makes the feature's own copy true for the first time is a
single shared basis resolver — `max(lastLog.estimated1rm, seedEstimate)` — called by both weight
paths, which also kills the hardcoded 60. Queued in the backlog with a plan-first note.

---

## 🟠 Q-6 (MEDIUM) — the six EMA baselines seed at **zero**, so every derived deviation is physically absurd for ~3 weeks after a cold start — and `temp_dev_c` is surfaced without a maturity gate

`updateBaseline` (`lib/health/personal-baseline.ts:29`) starts from `baseline?.meanX8 ?? 0`. This is a
faithful port of ecore, where the ring carries months of history — but our fold **cold-started on
2026-07-07**, so it climbs from 0 toward the true value over ~3 weeks:

| night | `n_history` | HRV baseline (actual hrv) | temp baseline (actual temp) | `temp_dev_c` |
|---|---|---|---|---|
| 2026-07-08 | 2 | 23.5 ms (46.5) | 18.0 °C (36.0) | — |
| 2026-07-09 | 3 | 36.8 ms (50.0) | 26.5 °C (35.0) | **+17.000 °C** |
| 2026-07-10 | 4 | 45.4 ms (54.0) | 30.8 °C (35.0) | **+8.500 °C** |
| 2026-07-11 | 5 | 44.9 ms (41.0) | 31.4 °C (36.0) | **+5.250 °C** |
| 2026-07-27 | 21 | 48.3 ms (62.0) | 34.96 °C (35.0) | +0.038 °C |

`temp_dev_c` is exactly `tempMean − the prior night's baseline mean`, so the whole warm-up ramp is a
cold-start artefact, not physiology.

The illness radar **is** gated (`illness-radar.ts:109` `nHistory < BASELINE_MIN_NIGHTS` → flag
`learning`; production confirms `illness_flag = 'learning'` through 2026-07-19). But `temp_dev_c`
itself is **not** gated on its way out:

- `app/api/ai/health-insight/route.ts:95` — *"Body temp deviation (vs personal ring baseline):
  +17.0°C"* goes straight into the LLM prompt;
- `lib/data/postgres/adapter.ts:1632` — `temperatureDeviation: todaySummary?.tempDevC ?? …` feeds the
  day-log surface.

Q-2 makes this worse: even after convergence the temperature deviation is measured against a 2.6 °C
spread.

**Remedies:** (a) seed each baseline from its first sample rather than 0 (a one-line change, but it
diverges from the ecore port the module is pinned to — needs a note); (b) keep the port and suppress
every *derived deviation* until `nHistory ≥ BASELINE_MIN_NIGHTS`, matching the illness radar's
existing gate; (c) both — (b) for correctness now, (a) revisited when the port is next validated.

---

## 🟡 Q-7 (MEDIUM) — whole columns of `oura_daily_derived` have **never been written**, including the Activity Score; `/api/health/trends` has returned a null activity score every day since 2026-07-08

Beyond F-2's sparsity (12 of 57 nights scored), these columns have **zero** non-null rows across all
70 days:

| column | non-null rows | who would write it |
|---|---|---|
| `activity_score`, `activity_contributors` | **0** | only `pushMutations` (`adapter.ts:3742`) — the device |
| `active_calories_est` | 0 | device push |
| `worn_hours_ble` | 0 | device push |
| `night_hrv_baseline_ms` | 0 | device push |
| `recovery_index_hours` | 0 | device push |
| `training_load_ots` | 0 | `/api/training-stress` (readiness-gated) |
| `vascular_age`, `pwv` | 0 | Cloud sync (frozen since re-key) |
| `chronic_stress_score` | 0 | gated at ≥21 nights — **expected**, `n_history` only reached 21 on 2026-07-27 |

The Activity Score is the one that bites: it is computed live in `/api/readiness-score`
(`activityBlend.final`, line 488) but never persisted, and `app/api/health/trends/route.ts:99` reads
`derived?.activityScore ?? oura?.activityScore ?? null`. `oura_daily.activity_score` is NULL for
**every day from 2026-07-08 onward** (the Cloud stopped scoring at the re-key). So the shipped
"Activity Score v2" (v1.207.0) has **no history at all** — 0 of 20 days.

```sql
SELECT count(activity_score), count(active_calories_est), count(worn_hours_ble),
       count(night_hrv_baseline_ms), count(training_load_ots), count(chronic_stress_score)
FROM oura_daily_derived;                                   -- → 0,0,0,0,0,0 of 70 rows
SELECT date, activity_score FROM oura_daily WHERE date >= '2026-07-08';  -- all NULL
```

Note also that `/api/oura/sync` still runs daily and creates an `oura_daily` row per day carrying
nothing but `non_wear_time_sec` and a fresh `synced_at` — so "Oura sync succeeded" is a false-positive
health signal, exactly as `CLAUDE.md` warns.

**Remedies:** (a) persist the activity score server-side in `/api/readiness-score` alongside the
sleep and readiness persists that already live there (smallest change, and F-2's backfill could then
cover it); (b) treat these as genuinely device-owned and instead surface "not yet pushed" in the sync
health card rather than rendering null; (c) drop the unused columns. Sequence after Q-1 + F-1 for the
same reason F-2 is sequenced there.

---

## 🟡 Q-8 (LOW–MEDIUM) — `user_stats` counts workouts that were never finished

| | sessions | volume | sets |
|---|---|---|---|
| `user_stats` (stored) | **61** | **257,966 kg** | **819** |
| all non-deleted sessions | 75 | 257,966 kg | 819 |
| **completed** sessions only (`completed_at IS NOT NULL`) | **47** | **191,260 kg** | **565** |

Volume and sets match the *all sessions* definition exactly (and `sum(weight_kg × reps)` over
`set_logs` reconciles to 257,966 kg to the kilogram — the arithmetic is fine). `total_sessions = 61`
is "sessions that have at least one exercise log" (75 − 14 empty).

So the lifetime totals include **28 sessions with no `completed_at`** (37% of all sessions), of which
14 carry logged sets. **~26% of the displayed lifetime volume (66,706 kg) comes from workouts that
were never completed**, and the session count is 61 against 47 finished.

Whether that is wrong is a product decision, which is why this is reported rather than fixed — but
the three numbers currently use **two different definitions of "a workout"** in one row, and
`season_results.volume_kg` presumably inherits it.

```sql
SELECT total_sessions, total_volume_kg, total_sets FROM user_stats;
SELECT count(*) FROM workout_sessions WHERE deleted_at IS NULL AND completed_at IS NOT NULL;
```

**Remedies:** (a) count completed sessions only, everywhere, and reconcile the stored row; (b) keep
counting all logged work but make `total_sessions` consistent with it (61 → 75); (c) derive on read
per the CLAUDE.md stored-counter rule and delete the table.

---

## 🟡 Q-9 (LOW) — three different max-HR resolutions coexist; they agree today only by accident

| resolver | rule | used by |
|---|---|---|
| `hrMaxFromAge` | 220 − age (190 fallback) | `resolveHrProfile` → **`/api/zone-minutes`, the cardio hub**, `body-battery`, `readiness-score`, score-audit |
| `resolveMaxHr` | observed **only if ≥** age-predicted | `/api/hr-profile`, `/api/cardio-week` |
| `estimateHrMax` | observed **always** when present | guided interval-walk targets |

Production: observed max HR = **168** (`max(bpm)` over 31,767 `oura_heartrate` rows);
age-predicted = **187** (`body_battery_daily.hr_max`). Because 168 < 187, `resolveMaxHr` currently
falls back to 187 and agrees with `resolveHrProfile` — the divergence is **masked**. `estimateHrMax`
does not: with resting HR 63, Zone 2 starts at **137 bpm** under the age-predicted profile and
**126 bpm** under the observed one, an 11 bpm gap between the guided walk's targets and the cardio
hub's bands.

`hr-profile.ts` states its intent — *"Both `/api/hr-profile` and `/api/zone-minutes` resolve zones
from this so the range view and the per-workout view agree"* — but the two routes use different
resolvers. The moment a single reading exceeds 187 bpm, they diverge silently.

**Remedies:** (a) one resolver for zone *bands* everywhere and document that walk *targets*
deliberately differ; (b) collapse to `resolveMaxHr` everywhere; (c) leave as-is and add a test
pinning the intended difference. Also worth noting: `resolveHrProfile` falls back to `restingHr = 60`
when no `body_metrics.resting_heart_rate` row exists in the last 28 days, and that column is 58% NULL
(F-3) — the fallback silently shifts every zone boundary.

---

## 🟡 Q-10 (LOW) — degenerate sleep rows are stored and scored; `sleep_sessions` has no `type` column, so nothing downstream can tell a nap from a night

Nine sessions are shorter than 20 minutes, including **2026-07-26 17:25→18:10: `duration_hours = 0.00`,
`efficiency = 0`, all stages 0, `awake_hours = 0.75`, `respiratory_rate = 6.7`**. `computeSleepScore`
returns `null` for it (`duration <= 0`), so on 2026-07-26 the `previousNight` contributor **silently
renormalised out of readiness** while a good 7.00 h night sat unscored in the same table — and the
sleep-score persist was skipped for that day.

Five sessions have a `date` that disagrees with their Brisbane wake-day (all of them the sub-20-minute
evening rows, e.g. `date = 2026-06-25` for a session ending 2026-06-24 19:42). That is a Cloud-era
`day`-vs-wake-time artefact, not a timezone bug — the general TZ checks were clean (see below).

`sleep_sessions` stores no `type`, so the Oura `long_sleep` / `sleep` / `short_sleep` / `late_nap` /
`rest` distinction is discarded at ingest. **That is why Q-1's and F-1's fixes are forced to guess
from duration.** Persisting `type` (Cloud) / the ring's own bedtime-period tag (BLE) would make the
selection unambiguous.

```sql
SELECT date, sleep_start, sleep_end, duration_hours, efficiency
FROM sleep_sessions WHERE duration_hours < 0.5 OR efficiency = 0 ORDER BY sleep_start;
```

**Remedies:** (a) add a `type`/`is_nap` column and populate it at both ingest paths; (b) drop
sub-threshold windows at ingest (loses real short naps); (c) keep storing them but exclude them from
every selection and baseline by rule.

---

## 🟡 Q-11 (LOW) — `set_hr_stats` has usable HR on ~20% of sets

Of 550 rows (v1.197.0's per-set HR feature): **436 (79%) have `coverage_ok = false`** and **370 (67%)
have a NULL `peak_bpm`**. The "Heart & Recovery" card therefore trends over roughly one set in five.
`workout_hr_stats` — the documented sibling table — holds **0 rows** despite 550 set-level rows
existing, which is worth a direct check (it may be device-push-only, like Q-7's columns).

```sql
SELECT count(*) total, count(*) FILTER (WHERE coverage_ok = false) no_cov,
       count(*) FILTER (WHERE peak_bpm IS NULL) no_peak FROM set_hr_stats;
SELECT count(*) FROM workout_hr_stats;   -- 0
```

Cause is most likely off-Postgres (strap not connected / ring power-gated during lifting — see the
BLE notes in `CLAUDE.md`), so this is reported as a **coverage measurement**, not a diagnosis.

---

## 🔴 Q-12 (HIGH) — bodyweight 1RM history holds two incommensurable eras, so Pull-Up "strength" jumped **+40% in one session** with no change in performance

`estimateOneRm` prices a bodyweight set at `BW_REF + addedKg` where `BW_REF = 100` is a **fixed
constant** (`lib/1rm.ts:105-108`), introduced precisely so the estimate stops tracking the lifter's
weigh-ins. Production shows the changeover, and every stored value on each side of it reproduces
exactly when the real module is re-run with the corresponding reference:

| Logged | Sets (added kg × reps) | stored `estimated_1rm` | re-run at `bwRef=100` | re-run at `bwRef=70` |
|---|---|---|---|---|
| 2026-06-12 | 0 × 5 | 78.8 | 114.50 | 80.25 |
| 2026-06-22 | 0 × 7 | 82.8 | 118.00 | **82.75** ✅ |
| 2026-06-28 | 0 × 5,4,4,5 | 82.0 | 113.00 | 79.00 |
| **2026-07-05** | 0 × 5,5,5 | **114.5** | **114.50** ✅ | 80.25 |
| 2026-07-13 | 0 × 6,6,6 | 114.5 | **114.50** ✅ | 80.25 |
| 2026-07-27 | 0 × 6,4 | 113.0 | **113.00** ✅ | 79.00 |
| 2026-07-08 (HLR) | 0 × 11,9,8 | 123.3 | **123.25** ✅ | 86.25 |
| 2026-07-22 (HLR) | 0 × 6,8,8 | 119.3 | **119.25** ✅ | 83.50 |

Every July row is an exact match at `bwRef = 100`. No June row is — they land in the 78–94 band and
match a reference that *drifts between rows*, consistent with the lifter's real weigh-ins
(`body_metrics.weight_kg` spans 67.6–72.8 kg over the same window).

**So the Pull-Up "1RM" reads 82.0 on 2026-06-28 and 114.5 on 2026-07-05 — a +32.5 kg (+39.6%) jump
produced on *equal or fewer* reps per set.** It is entirely a change of constant.

**It was recorded as a real PR:** `personal_records` has `Pull-Up` at **2026-07-05 12:25**, the
changeover session — so the PR celebration, the friends feed and the weekly recap all fired on a
phantom.

**And it feeds the prescription engine.** `signals` includes a 1RM-trend term; the 2026-07-26 Pull
prescription's stored reasoning reads *"Performance signals in the accumulation phase are strong with
a positive RPE delta and consistent progress, supporting a r[aise]…"*. A step change of this size in
the trend input is indistinguishable from real progress, so a constant change plausibly drove a real
intensity increase.

**Repro** (this is the evidence — no formula was reimplemented):
```ts
import { estimateOneRm } from '@/lib/1rm'
estimateOneRm([{weightKg:0,reps:5},{weightKg:0,reps:5},{weightKg:0,reps:5}],
              { exerciseType:'bodyweight', bwRef:100 }).estimated1rm   // 114.5  = stored 07-05
estimateOneRm([{weightKg:0,reps:5},{weightKg:0,reps:4},{weightKg:0,reps:4},{weightKg:0,reps:5}],
              { exerciseType:'bodyweight', bwRef:70  }).estimated1rm   //  79.0  ≈ stored 06-28 (82.0)
```
```sql
SELECT exercise_name, logged_at::date, round(estimated_1rm::numeric,1), volume
FROM exercise_logs WHERE exercise_name IN ('Pull-Up','Hanging Leg Raise')
  AND deleted_at IS NULL ORDER BY exercise_name, logged_at;
```
The repo's git history is squashed (53 commits, shallow), so the deploy date of the constant is not
recoverable from the tree — the data boundary is between 2026-06-28 and 2026-07-05.

**Remedies:** (a) leave stored history alone and mark it — add a `one_rm_ref_kg` (or model-version)
column so charts can render a break instead of a rally, and exclude the discontinuity from the
prescription engine's trend window; (b) rewrite pre-changeover bodyweight `estimated_1rm` (and the
affected PRs) onto `BW_REF = 100` from the stored reps — deterministic and possible from
`set_logs`, but it edits training history; (c) accept it and reset the affected bodyweight PRs only,
so the phantom stops being the reference. Whatever is chosen, **the two Pull-Up/Hanging Leg Raise PR
rows should be re-derived** — they currently anchor every future prescription for those movements.

---

## 🟠 Q-13 (MEDIUM) — a bodyweight set is worth 100 kg to the 1RM estimator and **0 kg to every volume calculation**, three lines apart in the same function

`lib/workout/log-exercise.ts` computes `effectiveWeights = weights.map(w => BW_REF + w)` for
bodyweight exercises, then uses it for the 1RM (line ~183) **and** for `intensityPct` (line 197) — but
volume is computed from the **raw** weights:

```ts
effectiveWeights = weights.map(w => Math.max(1, BW_REF + w));   // bodyweight → 100 + added
…
const { estimated1rm, target80 } = estimateOneRm(…)              // uses effectiveWeights
const { volume, avgReps } = computeSetAggregates(weights, reps); // ← raw weights → 0 × reps = 0
…
intensityPct: computeIntensityPct(effectiveWeights[i], estimated1rm)
```

Production: **32 sets across 13 sessions carry `weight_kg = 0`** — 19 Pull-Up sets (93 reps) and 13
Hanging Leg Raise sets (115 reps) — and all 13 of their `exercise_logs` have `volume = 0`. So the
same rows simultaneously read as **82–88% intensity** and **zero work done**.

Those 208 reps are silently absent from every volume-based number: `user_stats.total_volume_kg`,
`computeVolumeAcwr` (the acute:chronic ratio that gates the early-deload recommendation), weekly
volume, the activity score's `volume7dKg`, and — self-referentially — `typicalSessionVolumeKg`, which
the prescription engine uses to budget the next session's volume.

```sql
SELECT el.exercise_name, count(*) sets, sum(sl.reps) reps, sum(sl.weight_kg*sl.reps) volume
FROM set_logs sl JOIN exercise_logs el ON el.id = sl.exercise_log_id
WHERE sl.deleted_at IS NULL AND sl.weight_kg = 0 GROUP BY 1;
-- Hanging Leg Raise | 13 | 115 | 0
-- Pull-Up           | 19 |  93 | 0
```

**Remedies:** (a) use `effectiveWeights` for volume too — consistent with the 1RM path, but inflates
historical volume by ~100 kg/rep and makes bodyweight work dominate the totals; (b) price bodyweight
volume at the lifter's real weigh-in (or a fraction of it, per the usual pull-up ≈ 0.95 BW / leg-raise
≈ 0.5 BW convention) — most physiologically honest, needs a per-exercise factor; (c) keep volume at 0
and instead make the volume consumers count *sets* or *reps* for bodyweight movements. This is a
"One Formula, One Place" decision as much as a bug fix: bodyweight currently has two prices and
neither is written down.

---

## 🟡 Q-14 (LOW–MEDIUM) — `planned_pct` and `intensity_pct` are on different bases for bodyweight exercises, so every such set records a phantom 14–18 pp overshoot

`intensity_pct` is `BW_REF`-relative (Q-13), but `planned_pct` stores the prescription's nominal
percentage. For bodyweight movements the load cannot be scaled at all — `resolveBodyweightStyle`
converts the pct into a *rep* target instead (`lib/workout/session-data.ts:190`, "bodyweight carries
no %1RM") — so the two numbers can never agree. All eight of the ≥2 pp deviations in production are
exactly this:

| Exercise | Date | `planned_pct` | `intensity_pct` | weight |
|---|---|---|---|---|
| Pull-Up | 2026-07-27 | 75.0 | **88.5** | 0 kg |
| Pull-Up | 2026-07-20 | 68.0 | **87.3** | 0 kg |
| Hanging Leg Raise | 2026-07-22 (×3 sets) | 68.0 | **83.9** | 0 kg |
| Barbell Hip Thrust | 2026-07-22 | 72.5 | 70.5 | 107.5 kg |
| Dumbbell Forearm Curl | 2026-07-25 | 66.0 | 68.3 | 23.75 kg |

The weighted exercises deviate by ≤2.3 pp (real, small autoregulation); the bodyweight ones by
13.5–19.3 pp, every time, structurally. `set_hr_stats` carries **both** columns and buckets the
"Heart & Recovery by working weight (%1RM)" card by intensity — so bodyweight sets land in the
84–88% bucket alongside genuine near-maximal barbell work.

`planned_pct` covers only **106 of 819 sets** and only since 2026-07-18, so this is early — worth
settling before the column accumulates a year of non-comparable pairs.

```sql
SELECT el.exercise_name, sl.planned_pct, sl.intensity_pct, sl.weight_kg
FROM set_logs sl JOIN exercise_logs el ON el.id = sl.exercise_log_id
WHERE sl.deleted_at IS NULL AND abs(sl.intensity_pct - sl.planned_pct) >= 2;
```

**Remedies:** (a) write `planned_pct = NULL` for bodyweight exercises and store the prescribed rep
target instead; (b) store the `BW_REF`-relative equivalent so both columns share a basis; (c) add an
`is_bodyweight` marker so every consumer can branch. (a) is the smallest and matches what the
prescription actually delivers.

---

## ✅ Checked and clean

- **FK integrity** — 0 orphaned `set_logs`, `exercise_logs`, `food_logs`; 0 soft-deleted rows anywhere
  in the workout tree.
- **Volume arithmetic** — `exercise_logs.volume` matches `Σ(set.weight_kg × set.reps)` on **all 288**
  logs (0 mismatches > 1 kg).
- **Timezone / date boundaries** — `mood_logs`, `day_checkins` 0 mismatches vs Brisbane; `food_logs`
  2 of 170 (both ~08:07 next-morning edits of the prior day, i.e. intentional); no `YYYY/MM/DD` rows
  in `food_logs.date`. Comparing sleep dates against **UTC** instead of Brisbane would show 50 of 57
  "mismatched" — the Brisbane convention is being applied correctly.
- **Duplicate-per-key sweep** — 0 duplicates on `body_metrics`/`oura_daily`/`oura_daily_summary`/
  `oura_daily_derived`/`mood_logs`/`body_battery_daily`/`session_periodization`/`exercise_library`.
  `day_checkins` duplicates resolve by `phase` (morning/evening) as designed. The only real
  one-key-many-rows case is `sleep_sessions` — Q-1 / F-1.
- **`session_periodization.sessions_in_phase`** — 10 rows, values 0–4, no drift.
- **`food_items`** — 0 orphaned logs, 0 zero-calorie items, 2 of 130 with macro sums >15% off their
  calorie count (rounding/label noise). 6 near-duplicate name+brand pairs, cosmetic.
- **`oura_raw_samples.decoded` is 100% NULL by design** — flagged and then cleared: ingest
  deliberately stopped persisting the JSONB (`adapter.ts:4264-4275`, "Lever 1"); the rollup decodes
  from the archival `body_hex` live. Recording it here so the next audit does not re-raise it.
- **`daily_zone_minutes` (0 rows) and `oura_bucket` (0 rows)** — reconcile-on-read caches / device
  domains, cold rather than broken.
- **Cloud staleness does not leak** — `oura_daily` rows from 2026-07-08 onward have NULL for every
  score column, so the `derived ?? cloud` fallbacks return null rather than a frozen pre-re-key
  number. (Which is what makes Q-7 visible.)
- **`exercise_logs.muscle_groups` empty on 80 of 288 rows** — initially alarming, but all 80 are
  dated **2026-04-30 → 2026-05-21** and none since. Historical and bounded; per-muscle volume for
  those three weeks is simply absent. Not queued.

### Periodization / prescriptions — audited in full, clean apart from Q-12…Q-14

- **`sessions_in_phase` reconciles exactly on all 10 rows** (stored = derived, using
  `reconcileSessionsInPhase`'s own canonical definition: completed, non-deleted, since
  `phase_started_at`, with ≥1 exercise log). Note for future audits: derive it by joining
  **`ws.session_id`**, not `ws.program_session_id` — the latter is a dead column (below) and joining
  on it makes every row look like it has drifted to 0.
- **`intensity_pct` reconciles against the reference 1RM** on all 23 exercises with ≥6 July sets:
  the implied reference (`weight / (intensity_pct/100)`) tops out at exactly the personal record —
  e.g. Barbell Hip Thrust 152.6 vs PR 152.5, Barbell Calf Raise 127.7 vs 127.8, Barbell Shrug 105.5
  vs 105.5. The two exceptions independently corroborate **Q-5**: `Tricep Cable Combo`'s engine
  reference is 27.7–28.3 while `personal_records` claims 33.3, and `Dumbbell Lateral Raise`'s is
  13.8–15.0 against a claimed 16.8 — both seeded values the engine never used.
- **`baseline_1rm` snapshots are sound.** Every entry is `{"kg": …, "source": "personal_record"}` and
  matches the PR *as of the generation date* (e.g. Push, generated 2026-07-22: Bench 90.75 vs PR
  90.8, Tricep Cable Combo 33.25 vs 33.3). Values that look low — Sumo Deadlift 87.5 vs PR 99.5 —
  are explained by PRs set *after* generation (Sumo's PR is dated 2026-07-27, the prescription
  2026-07-26). Snapshot semantics, not drift.
- **Prescription confidence is deterministic.** `prescription.confidence >= 0.6` gates auto-apply,
  and `confidence` is overwritten with `signals.confidence` from `lib/ai-periodization/confidence.ts`
  before the gate — the LLM's self-reported value is input only, with an explicit comment saying so.
  The CLAUDE.md "no LLM self-reported number may gate an automatic action" rule is honoured.
- **The three `pending` prescriptions are not a bug.** With `auto_apply_prescriptions = true`, Push
  and Legs are `auto_applied` while Upper/Lower/Pull sit at `pending` — but
  `prescriptionDrivesLoad()` returns true for `pending` + `phaseAction === 'stay'`, so all five
  drive load. `pending` here means "shown for confirmation", not "not applied".
- **Prescription targeting is intact:** 0 of the active program's `session_exercises` have a NULL
  `style_id`, 0 July `exercise_logs` have a NULL `style_id`, every `sessionExerciseId` in the five
  stored prescriptions resolves, and no prescription is past its 7-day `expires_at`.
- **`style_sets` are internally consistent** — 24 styles, per-set pct/reps present on all, and the
  shaped ones behave (`Reverse Pyramid Training` 85/75/65 with 6/8/10; `Top Set + Backoff` 85/75/75
  with 5/8/8). Naming is user-authored and inconsistent (four different "Hypertrophy" styles at
  65/70/75/80%), which is config, not data quality.

## ⚪ Periodization — noted, below the reporting bar

- **`workout_sessions.program_session_id` is NULL on all 75 rows.** The column is declared with an FK
  (`schema.ts:158`) but **nothing writes it and nothing reads it** — every consumer, including
  `reconcileSessionsInPhase`, joins on `session_id`. A dead column; harmless until someone trusts it.
- **`workout_sessions.session_id` is NULL on 46 of 75 sessions (19 of them completed)** — but *all*
  of them are dated 2026-05 and 2026-06, and every session since 2026-07-01 carries it. Bounded and
  historical, same shape as the `muscle_groups` gap. Consequence: those 19 completed May/June
  workouts can't be attributed to a program session, so per-session history for them falls back to
  `session_name` text — and the four programs each define their own "Push"/"Pull"/"Legs", so those
  names are ambiguous.
- `workout_sessions.phase_type` is NULL on 64 of 75 rows and `'normal'` on 11. Handled deliberately —
  `reconcilePersonalRecord`'s deload gate documents NULL as "not deload" for manual-mode programs.
- The active program (`Shikai`, `ai_dynamic`) has **no `program_phases` rows** and NULL `started_at`
  / `cycle_anchor_at`; phase state lives entirely in `session_periodization.phase` (all
  `accumulation`). Consistent with ai_dynamic mode, but worth confirming nothing computes a
  cycle/week from the NULL anchors.
- Timer artefacts in `set_logs`: 30 sets with `rest_time_sec ≤ 5` (including 1 s), 24 between 6–30 s,
  6 above 400 s (max 704), 10 with `set_time_sec > 300` (max 901) and 2 at exactly 0. Small counts,
  but they feed rest-adequacy and workout-density; a plausibility clamp at write time would cost
  nothing.
- The AI cut several compounds to a **single set** to fit the 60-minute session budget (Legs
  prescribes 1 set of Barbell Hip Thrust and 1 of Barbell Romanian Deadlift; Pull 1 of Dumbbell
  Preacher Curl). Coherent with the stored reasoning, but a 1-set compound prescription is a model-
  quality question worth the owner's eye.

## ⚪ Noted, unexplained, below the reporting bar

- `sleep_sessions.sleep_score` is **NULL on all 57 rows** — a dead column (scores live in
  `oura_daily_derived`). Harmless unless something starts reading it.
- `oura_daily_derived.resilience_level` = **exactly 5.00 on all 4 rows** that have it, with
  `resilience_confidence` 0.36–0.50. A constant is suspicious but 4 rows is too small to call.
- `daytime_stress_scaled` spans only **−0.13 … +0.12** across 11 days — a "scaled" index sitting
  flat at zero. Worth a look once more days accumulate.
- `body_battery_daily`: 5 of 28 days have `hr_sample_count < 60`, including 2026-07-26 with **0**
  samples, yet still carry an `end_value` (29) — a score produced with no HR input. 9 of 28 days use
  `anchor_source = 'default'` rather than readiness.
- `error_events`: 269 of 366 are React hydration errors (#418), plus 17 `Failed query` on
  `oura_raw_samples` between 2026-07-20 and 07-27 — a rollup that fails leaves derived data stale, so
  worth watching, but it is an infrastructure signal rather than a wrong number.

---

## Suggested fix sequencing

Q-1 and F-1 are the same defect in two modules and must land **together**, with a decision on what
"the night" means (the three remedies differ in semantics). Nothing that backfills or replays
history — **F-2, Q-6, Q-7** — may run before them, or nap-derived values get baked into the
baselines permanently. **Q-2** needs its own redecode pass over `body_hex` and should be sequenced
after Q-1 so history is replayed once, not twice.

In the training domain, **Q-12 → Q-5 → Q-13** is the natural order: Q-12 decides what a bodyweight
1RM *is*, Q-5's PR reconcile then rebuilds `personal_records` on that answer (re-deriving the phantom
Pull-Up PR in the same pass), and Q-13 settles what a bodyweight set is worth in volume. **Q-14** is
independent but cheap and should land while `planned_pct` still covers only 106 sets.

**Q-3, Q-4, Q-8, Q-9, Q-10, Q-11** are independent of both chains and can be taken in any order.
