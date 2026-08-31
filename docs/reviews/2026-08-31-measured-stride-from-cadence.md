# The owner's real stride, measured from strap cadence — 2026-08-31

*Tuning · production data pulled 2026-08-31. Corrects the estimated figures published earlier the
same day on [`Q-524`](../implementation-backlog.md). Propose-only. Counts are the owner's account
only (`claude_ro` is row-scoped).*

Owner: *"I walk/run with the heartrate strap and we measure cadence — that + distance, can we
calculate my ACTUAL stride to determine how much distance for how many steps? so that we can have
actual better step targets for me at least."*

**Yes. The data is already stored, the answer is 0.739 m, and the height estimate used earlier today
was 10.1% short.**

---

## 1. The data exists on one row

`activity_logs` carries `distance_km`, `steps`, `cadence_spm` and `duration_min` together, and
`segments` (JSONB) carries `distanceKm` + `avgCadenceSpm` + `startSec`/`endSec` **per interval**. So
stride is directly computable two independent ways.

**Coverage is thin but sufficient**: of 49 activity rows, 40 have distance, 7 have cadence, 4 have
steps, and **3 sessions** carry distance plus one of the two step sources. The segment array yields
**16 usable segments** across 2 sessions.

## 2. Both extractions agree, and the cadence path validates against recorded steps

| method | n | mean stride |
|---|---|---|
| session `distance ÷ steps` (steps from cadence × duration where absent) | 3 sessions | **0.739 m** |
| segment `distanceKm ÷ (avgCadenceSpm × secs)` | 16 segments | **0.737 m** |

**They agree to 0.3%.** And on the one row carrying both a recorded step count and cadence,
`cadence × duration` reproduces the stored steps to **+0.13%** (3,203 derived against 3,199 recorded).
**So the cadence path can be trusted on the rows where `steps` is null**, which is most of them.

| | |
|---|---|
| measured stride | **0.739 m** (range 0.692–0.811 by session) |
| `0.415 × height` at 160 cm | 0.664 m |
| **error in the estimate** | **−10.1%** |

## 3. Every distance and calorie figure published earlier today was ~10% low

| steps | km (measured) | net kcal (measured) | net kcal (published earlier, wrong) |
|---|---|---|---|
| 4,649 — median day | 3.43 | **95** | 86 |
| 7,000 | 5.17 | **143** | 129 |
| 8,000 | 5.91 | **164** | 147 |
| 10,000 | 7.39 | **205** | 184 |
| 12,000 | 8.87 | **246** | 221 |

The **7,000-vs-10,000 gap widens from ~55 to ~62 kcal/day** — still small, so the *decision* does not
change, only the arithmetic under it.

## 4. ⛔ A single stride constant is still wrong, and the segments prove it

**Stride correlates with pace at r = −0.885 (n = 16)**, slope **−0.052 m per min/km slower**:

| pace | fitted stride |
|---|---|
| 10:00/km | **0.83 m** |
| 12:00/km | 0.72 m |
| 14:00/km | **0.62 m** |

**A 33% spread across ordinary walking speeds.** The measured sessions run 10–15 min/km — deliberate
walks. **Incidental daily steps are slower, and therefore shorter**, so applying 0.739 m to a whole
day overstates distance.

### How much of the day this actually governs

| date | day steps | tracked-walk steps | walk share |
|---|---|---|---|
| 2026-08-18 | 3,644 | 3,043 | **84%** |
| 2026-08-19 | 3,306 | 3,116 | **94%** |
| 2026-08-05 | 5,909 | ~2,830 | 48% |
| 2026-08-20 | 10,923 | 3,199 | 29% |
| 2026-08-01 | 10,705 | ~2,882 | 27% |

**27–94%, median ~48%.** On a low-step day the tracked walk *is* the day; on a high-step day it is a
quarter. So the measured stride is load-bearing for roughly half the daily total.

**The other half cannot be measured from anything stored.** `step_live_windows` (8 rows) and
`body_metrics.steps` both carry steps with no distance, so incidental stride is an assumption
whichever way it is set. **State it as an assumption rather than deriving a false precision from the
walk data.**

## 5. What to build

Derive stride **per user** from `activity_logs` — segment-level where available, session-level
otherwise — and fall back to `0.415 × height` only when a user has no cadence data at all. Then
express the step goal as *the steps needed to contribute a target net walking energy*, the same
`fraction of BMR` construction `activeEnergyGoal` already uses. At this owner's **27.7 kcal/km**:

| target net energy | steps |
|---|---|
| 100 kcal | **4,886** |
| 150 kcal | **7,329** |
| 200 kcal | **9,773** |

**Two constraints carried from the Q-524 amendment:** do not target the whole `activeEnergyGoal`
(373 kcal ⇒ ~19,000 steps at the measured stride), and settle the double-count with the Activity
Score's separate `activeEnergy` contributor first.

**And give the stride a freshness rule.** It is a function of leg length *and habitual pace*, so it
drifts with fitness — the same trap as `HR_REST_THRESHOLD` in Q-515, where a boundary pinned to a
moving quantity decayed silently. Recompute on a trailing window; never store it once.

## 6. ⚠ A corrupt row found on the way

**`activity_logs` for 2026-07-01 records 4,970 steps over 3.30 km in 0.2 minutes** — a cadence of
~25,000 spm — and **more steps than `body_metrics` holds for that entire day (1,358)**. Excluded from
every figure here. Any per-user stride derivation needs a sanity gate (plausible cadence, walk steps
≤ day steps), or this row alone will skew it. Recorded on Q-524 rather than filed separately, since
the gate belongs to the same work.

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK.
**n is small**: 3 sessions and 16 segments, from **2 sessions** for the pace relation, so the −0.885
slope is a strong pattern in a thin sample and the two segments above 0.99 m (at 7:27 and 8:44/km)
may be jogging or GPS noise rather than walking. **Distance itself is GPS-derived and unvalidated** —
if it carries a systematic error, the stride inherits it. The calorie column remains textbook walking
economy (~0.57 kcal/kg/km, net of resting), **not** a measurement of this owner: `active_calories` is
present on 8 of 51 days.
