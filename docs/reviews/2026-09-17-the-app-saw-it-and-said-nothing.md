# A real autonomic event, detected and never surfaced

**2026-09-17 · Tuning · measurement only, no code changed.**

Routine production reads after TN-34/BF-13/TN-39 shipped turned up a live physiological signal in
the owner's own data. **The app detected it correctly and told him nothing.** This is that check,
plus a correction to something this agent reported wrongly on 2026-09-16.

---

## 1. The signal

Weekly means, `body_metrics`, all `source_map.hrv_ms = oura_ble` throughout — **no instrument or
cadence change**, seven readings a week every week:

| week | HRV ms | resting HR | night HR | respiratory rate |
|---|---:|---:|---:|---:|
| W33 | 62 | 52 | 64 | 10.1 |
| W36 | 58 | 52 | 62 | 9.2 |
| W37 | 48 | 53 | 67 | 8.4 |
| **W38** | **32** | **61** | **77** | 8.2 |

HRV roughly halved and resting HR rose ~9 bpm over two weeks.

**⚠ The obvious confound was tested and ruled out.** Short recorded nights could depress overnight
HRV mechanically, so the two were joined per night over 25 days:

| | mean HRV | n |
|---|---:|---:|
| fragment "nights" (< 3 h recorded) | **50 ms** | 10 |
| real nights (≥ 6 h recorded) | **45 ms** | 11 |

HRV is *not* lower on the fragment days — if anything higher. And the two most recent days, **16 and
17 September, both carry genuine ~7-hour nights** (23:30 and 22:33 Brisbane starts, efficiency 83–88)
**and read HRV 28 and 19 ms with RHR 65.** So the signal is not a sleep-capture artefact; it is
sharpest exactly where the sleep record is good.

## 2. ⚠ Correction to the 2026-09-16 report

This agent told the owner that his **sleep duration had collapsed to 3.1 h/week average**. That
figure is wrong, and the error is instructive: `sleep_sessions` holds *sessions*, not nights, and on
five of the last thirteen days the only row is a **midday Brisbane fragment** — 11:54, 12:10, 13:06,
14:25, 12:25 local, 0.0–1.7 h, efficiency 0–48. Averaging a nap with a night produces a number that
describes neither. **That is PS-17, live** — see §4.

The physiological finding in that report stands and is strengthened; the sleep-deprivation
explanation offered alongside it does not.

## 3. The tuning finding: `watch` is a state the app can enter and never expresses

The illness radar moved for only the second time in 72 days:

| flag | days | mean illness score | mean readiness | last |
|---|---:|---:|---:|---|
| `normal` | 58 | 10 | **64** | 2026-09-17 |
| `watch` | **2** | 49 | **32** | **2026-09-16** |
| `elevated` | **0** | — | — | never |
| `fever` | **0** | — | — | never |

**On `watch` days readiness averages 32 against 64 on normal days — half.** Twice in 72 days, and
both times it marked a real event.

**And it is inert by construction, in two places at once:**

- `ILLNESS_READINESS_PENALTY.watch = 0` — no effect on the score, deliberately ("advisory-only").
- `components/home/illness-advisory-banner.tsx:15` — `if (flag !== "elevated" && flag !== "fever")
  return null`. **A `watch` renders nothing.**

So the band is named *advisory-only* and there is no advisory. **The only illness band that has ever
fired is the silent one**, and the two that would produce UI (`ILLNESS_ELEVATED_SCORE = 65`, fever)
have never fired in 72 days — the banner has, as far as this data shows, never rendered.

Yesterday's score was **41**, one point over the threshold of 40.

## 4. PS-17 is live and it corrupts any sleep aggregate

Not a new entry — **PS-17 already carries the 🔴 LIVE marker** from 2026-08-30. This adds current
evidence: **5 of the last 13 days** recorded a midday fragment as the day's only sleep session, and
on 16–17 September two sessions were captured (a real night *and* a ~10:30 nap), so the shape has
changed rather than stopped.

The consequence worth adding to that entry: **any weekly or multi-day sleep average is unusable
while this is live**, because it mixes naps with nights. This agent just made that mistake in §2.

---

## 5. What is proposed, and what is not

**Proposed (TN-45):** give `watch` an expression. It is rare (2 in 72 days), it is discriminating
(readiness 32 vs 64), and it currently costs nothing to ignore because nothing is shown.

**⚠ Not proposed: raising the readiness penalty.** `watch = 0` may well be right — readiness already
fell to 31 on its own, so penalising it again would double-count the same physiology. The gap is
*visibility*, not weight, and those are different fixes.

**⚠ Not diagnosed.** An HRV halving with a resting-HR rise has many ordinary causes — an illness
coming on, a hard block, alcohol, heat, travel, poor sleep. Respiratory rate *fell* (9.2 → 8.2),
which argues mildly against a respiratory infection; workouts fell 5 → 3 and steps were flat, which
argues against acute overreaching. **That is as far as this data goes**, and the owner has been told
the measurement rather than a cause.

**All figures are the owner's own rows** through `claude_ro`, which is row-scoped to one user. W38 is
four days.
