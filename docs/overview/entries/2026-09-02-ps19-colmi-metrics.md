## 2026-09-02 — the three Colmi metrics nobody had compared, measured (PS-19)

**Branch:** `claude/la-ps19` · **Lane:** A · **Analysis only** — no product code, no constant changed.

Full measurement:
[`docs/reviews/2026-09-02-colmi-spo2-temp-stages.md`](../../reviews/2026-09-02-colmi-spo2-temp-stages.md).

### The blocker was a wrong table

PS-19 could not start the SpO₂ comparison: *"`oura_bucket` returns no rows for any date, which is
itself unexplained."* Oura's SpO₂ lives in **`body_metrics.spo2_pct`**, populated **7 of 7 days**
across the whole Colmi window — the BLE rollup writes it as the daily mean of the ring's 0x6f samples.

And `oura_bucket` is not broken: it holds **zero rows in total**, and `slices/oura.ts:538` says why —
it is *"the durable server backup of the on-device `oura_bucket`"*, a device-computed table whose
producer (**Q-545**) is unbuilt. Empty is correct. Nothing filed, because there is nothing wrong.

### The finding both continuous metrics share is not the offset

| | offset (Colmi − Oura) | r | Colmi spread vs Oura |
|---|---|---|---|
| SpO₂, n = 7 | **+2.70** | **−0.33** | 0.80× |
| Nocturnal temperature, n = 6 | **+0.88 °C** | **−0.44** | 0.51× |

An offset between two skin sensors is expected and trivially corrigible. **Neither metric tracks
Oura's night-to-night variation** — both correlations are negative and Colmi carries half the spread
on temperature.

**n = 7 and n = 6 cannot establish a correlation, and these do not.** What they rule out is the
optimistic case: there is no sign of the positive tracking that would make Colmi a substitute source.
Worth re-running with more data rather than being treated as settled.

Colmi's SpO₂ daily *minimum* is **96 on five of seven days** — a flat floor for a sensor whose
readings should dip overnight.

### The stage mapping looks swapped, on four nights

The schema documents `2 light, 3 deep, 4 REM, 5 awake` and PS-19 calls it a guess.

| mapping | deep MAE | REM MAE | combined |
|---|---|---|---|
| documented | 38 | 48 | 86 |
| swapped | 46 | 24 | **70** |

The means are more telling: documented gives Colmi **94 min deep against Oura's 58** and **65 REM
against 109** — wrong both ways. Swapped gives **65 vs 58** and **94 vs 109**. Light agrees either
way (321 vs 298), which is what makes the question worth resolving rather than dismissing.

**The schema comment is not being rewritten on n = 4.** Four nights cannot redefine a device protocol
constant; the honest reading is that the evidence points at the swap and the sample is too small.

### PS-17 contaminated this comparison, which is a concrete cost of that bug

Two of the seven nights are unusable: on **08-29 and 08-30 Oura's only stored session is the daytime
phantom** (65 and 15 minutes), so there is no real night to compare against. A third night has only
105 minutes of Colmi data. Seven nights became four. The comparison gets cleaner once PS-17's
back-fill runs — which is still owed and needs the owner.

### Recorded, not diagnosed

An **undocumented stage 0 carrying 765 minutes** appears on 2026-09-02 — 12.75 h, longer than any
night, in no part of the four-code mapping. Written down so nobody treats the known codes as complete.
