# PS-19: the three Colmi metrics nobody had compared

**2026-09-02 · Lane A · analysis only, no product code and no constant changed.**

Four days of Colmi data existed when PS-19 was filed and the validation had covered heart rate,
sleep timing and stress. SpO₂, temperature and sleep stages had not been looked at. There are now
**seven days** (2026-08-27 → 09-02), and the counts have grown with them: **110 SpO₂ readings, not
47**, and **218 temperature, not 95**.

## 1. SpO₂ — the blocker was a wrong table, and it is answered

PS-19 could not start this comparison: *"the Oura's per-bucket table (`oura_bucket`) returns no rows
for any date, which is itself unexplained… Find out where the Oura's SpO₂ actually lives."*

**It lives in `body_metrics.spo2_pct`, populated on 7 of 7 days** across the whole Colmi window — the
BLE rollup writes it as the daily mean of the ring's 0x6f samples.

**And `oura_bucket` is not broken.** It holds **zero rows in total**, not merely none for those dates,
and `lib/data/postgres/slices/oura.ts:538` says why: it is *"the durable server backup of the
on-device `oura_bucket`"* — a device-computed table. The on-device rollup that would fill it is
**Q-545**, still unbuilt. Empty is the correct state, and nothing needs filing.

| date | Colmi mean | Colmi min | n | Oura | Colmi − Oura |
|---|---|---|---|---|---|
| 08-27 | 97.2 | 96 | 13 | 94.2 | **+3.0** |
| 08-28 | 98.4 | 98 | 7 | 94.2 | **+4.2** |
| 08-29 | 96.9 | 96 | 17 | 94.8 | +2.1 |
| 08-30 | 97.5 | 96 | 20 | 94.1 | +3.4 |
| 08-31 | 97.6 | 96 | 18 | 95.0 | +2.6 |
| 09-01 | 97.5 | 96 | 18 | 95.6 | +1.9 |
| 09-02 | 97.1 | 96 | 17 | 95.4 | +1.7 |

**Offset +2.70. Correlation r = −0.33. Colmi's spread is 0.80× Oura's.**

Colmi's daily *minimum* is **96 on five of seven days**, which is a suspiciously flat floor for a
sensor whose readings should dip overnight.

## 2. Temperature — same shape, more pronounced

Colmi's nocturnal mean (22:00–08:00 local) against `oura_daily_summary.temp_mean_c`. Six comparable
nights; 08-27 has no Oura temperature.

| date | Colmi night | Oura | diff |
|---|---|---|---|
| 08-28 | 36.79 | 35.91 | +0.88 |
| 08-29 | 36.73 | 35.73 | +1.00 |
| 08-30 | 36.77 | 35.87 | +0.90 |
| 08-31 | 36.64 | 36.03 | +0.61 |
| 09-01 | 36.76 | 35.70 | +1.06 |
| 09-02 | 36.66 | 35.85 | +0.81 |

**Offset +0.88 °C. Correlation r = −0.44. Colmi's spread is 0.51× Oura's.**

## The conclusion both metrics share, and it is not the offset

An offset between two skin sensors is expected and trivially corrigible. **What matters is that
neither metric tracks Oura's night-to-night variation** — both correlations are *negative*, and
Colmi carries roughly half the spread on temperature.

**Say the strength honestly: n = 7 and n = 6 cannot establish a correlation, and these do not.** What
they do rule out is the optimistic case — there is no sign of the strong positive tracking that would
make Colmi a substitute source for either metric. On this evidence it should not become one, and the
question is worth re-running when a few more weeks exist rather than treated as settled now.

## 3. Sleep stages — the swap is favoured, and the sample is four nights

The schema comment documents `2 light, 3 deep, 4 REM, 5 awake` and PS-19 flags it as *"a guess,
verified against nothing"*.

**Two of the seven nights are unusable, and the reason is PS-17.** On 08-29 and 08-30 the only
`sleep_sessions` rows Oura has are the daytime phantoms (65 and 15 minutes total), so there is no
real night to compare against. 08-27 has only 105 minutes of Colmi data. That leaves **four nights**.

| mapping | deep MAE | REM MAE | combined |
|---|---|---|---|
| documented (3 = deep, 4 = REM) | 38 | 48 | **86** |
| swapped (3 = REM, 4 = deep) | 46 | 24 | **70** |

The means are more telling than the MAEs:

| | Colmi st3 | Colmi st4 | Oura deep | Oura REM |
|---|---|---|---|---|
| mean minutes | 94 | 65 | **58** | **109** |

Under the documented mapping Colmi reports 94 min deep against Oura's 58 and 65 REM against 109 —
wrong in both directions. **Under the swap it is 65 vs 58 and 94 vs 109**, close on both.

**Light agrees either way** — 321 vs 298, MAE 46 min — which is what makes the deep/REM question
worth resolving rather than dismissing as two devices disagreeing about everything.

**Do not rewrite the schema comment on this.** Four nights is not enough to redefine a device
protocol constant, and the honest reading is "the evidence points at the swap and the sample is too
small to act on". Re-run it at a few weeks of overlap.

**An undocumented stage 0 appeared on 2026-09-02 carrying 765 minutes** — 12.75 h, larger than any
night. It is in no part of the documented mapping. Not diagnosed here; recorded so the next person
does not treat the four known codes as complete.

## Reproducing

Production read-only through `/api/admin/db-query` (`claude_ro`, row-scoped to the owner).
`colmi_readings` for SpO₂/temperature, `colmi_sleep_segments` for stages, `body_metrics`,
`oura_daily_summary` and `sleep_sessions` for the Oura side. Exclude any night whose Oura session
totals under 4 h until PS-17's back-fill has run, or the phantoms re-enter the comparison.
