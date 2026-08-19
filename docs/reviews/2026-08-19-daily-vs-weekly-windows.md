# Daily goal or weekly target? The Activity Score is already answering both, badly

**Date:** 2026-08-19 · **Agent:** Tuning 🎶 · **Pillars:** `[activity]` `[heart-rate]`
**Owner question:** *"The goal being x amount of heart minutes per day to depict healthy heart usage
through the day right? But you also gotta count for weekly targets. How handle this?"*

**The question is correct and it exposes something larger than the zone-minutes window.**
`DEFAULT_ZONE_MINUTES_GOAL = 22` is **WHO's 150 min/week divided by seven**, and dividing a weekly
guideline by seven does not preserve its meaning: someone who does 150 minutes in three sessions
satisfies WHO completely and fails the daily goal on four days out of seven.

---

## 1. There are two health questions here, not one

The owner's phrasing separates them precisely, and they are separate in the literature too:

| question | what it measures | the guideline's own unit |
|---|---|---|
| *"healthy heart usage **through the day**"* | distribution — did movement happen across waking hours, or was I still? | hourly / **daily** |
| *"weekly targets"* | dose — did enough total intensity accumulate? | WHO 2020: **150 min / week** |

**The app already has a contributor for each.** `moveHours` counts waking hours containing movement —
that *is* the distribution question. `zoneMinutes` counts time above an intensity threshold — that *is*
the dose question. They have been conflated because the dose contributor was given a daily window it
was never designed for.

**And the distribution question currently has no working answer**, because `moveHours` is saturated —
856 of 857 waking hours qualify (Q-522). So dividing WHO by seven has been standing in for a
contributor that exists and does not work.

---

## 2. The rule: match the window to the guideline's own unit

Applied across all six contributors, **exactly one is wrong**:

| contributor | source | source's unit | current window | |
|---|---|---|---|---|
| `steps` | Paluch 2022 — plateau ~7–8k **/day** | daily | daily | ✅ |
| `moveHours` | sedentary-breaking, hours **/day** | daily | daily | ✅ |
| **`zoneMinutes`** | **WHO 2020 — 150 min /week** | **weekly** | **daily (÷ 7)** | ❌ |
| `strengthFreq` | WHO — ≥ 2 days **/week** | weekly | rolling 7-day | ✅ |
| `strengthVolume` | weekly tonnage | weekly | rolling 7-day | ✅ |
| `activeEnergy` | BMR fraction **/day** | daily | daily | ✅ |

The precedent is in the same file. `activity-score.ts` marks its strength block
*"rolling 7-day, so a rest day still scores off recent training"* — the exact treatment the owner is
asking for, already applied to the two contributors whose guidelines are weekly.

### What the weekly window measures out to

Rolling 7-day active minutes under the corrected WHO threshold (Q-523), 59 days:

| | daily ÷ 22 | **rolling 7-day ÷ 150** |
|---|---|---|
| contributor mean | 63.8 | **79.2** |
| contributor sd | **38.7** | 26.7 |
| days at ceiling | 23 / 59 | 26 / 59 |
| **days reading zero** | **6 / 59** | **0** |

Weekly total: mean **164.4 min**, sd 94.5, range **12–378**, meeting WHO on **26 of 59 days**.
Smoother, as a rolling sum must be — and **no day reads zero**, which is the honest outcome: a rest
day inside an active week is not a day of zero cardiovascular activity.

---

## 3. The larger problem the question surfaces

Windowing one contributor correctly does not fix the thing underneath it. **60% of the Activity
Score's effective weight is already on a rolling 7-day window** — `strengthFreq` 33% and
`strengthVolume` 27%, from the [contributor audit](2026-08-19-activity-contributor-audit.md). Moving
`zoneMinutes` to weekly raises that further.

So a number labelled and read as *today's* activity is mostly a **7-day** number. Measured against the
23 stored scores:

| | r |
|---|---|
| score ↔ same-day steps | **+0.324** |
| score ↔ rolling 7-day sessions | +0.186 |
| score ↔ rolling 7-day volume | +0.026 |

**Read this carefully — it is not the obvious conclusion.** The rolling terms carry most of the
weight but almost none of the *variance*, because they are saturated. So the rolling window **sets the
level** while same-day steps **move it slightly around that level**. That is the mechanism behind
Q-505's headline anomaly: **2026-08-12 scored 76 on 828 steps while 2026-08-16 scored 64 on 8,935** —
the first day sat inside a strong week, the second did not, and the daily inputs were too lightly
weighted to overturn it.

*(n = 23 stored scores; these correlations are directional, not settled.)*

---

## 4. Recommendation: two numbers, not one

**Split the Activity Score into a daily number and a weekly one, with each contributor placed in the
scorecard whose unit matches its guideline.** Q-505 is specified but unbuilt, which makes this the
moment to decide rather than a rework later.

| **Today** — *did I move today?* | **This week** — *am I meeting the guidelines?* |
|---|---|
| `steps` vs the daily goal | `activeMinutes` rolling 7-day vs **WHO 150** |
| `moveHours` — movement distributed across waking hours | `strengthFreq` vs ≥ 2 sessions/week |
| whether today's session happened | `strengthVolume` — weekly tonnage |

**Why this wins.** Every number answers one question, so neither has to be explained. It matches how
the guidelines are actually written. And it removes the structural reason the daily score cannot
discriminate — a day of genuine rest inside a strong week reads as *rest today, on track this week*,
which is both true and useful, instead of one blended number that is neither.

**What it costs.** Two numbers to place on screen instead of one, and a decision about which is the
headline. The daily one probably is — it is the one that can change based on what the owner does next.

### The reframe this produces

**A weekly compliance number is allowed to saturate.** `strengthFreq` sitting at 100 on 78% of days
reads as a defect while it lives in a daily score; in a weekly scorecard it reads as *"you have met
the strength guideline in 78% of trailing weeks"* — which is true, useful, and exactly what compliance
looks like when someone complies. **Its ceiling was never the problem; its scorecard was.** That also
retires the awkward position in the contributor audit, which had to file the ceiling as a constraint
nobody could remove.

### The knock-on: `moveHours` gets more important, not less

Under this split, the daily number leans on `steps` and `moveHours` — and `moveHours` is currently
pinned at 100 (Q-522). **Q-522 rises in priority under this design**, because it stops being one
inert contributor among six and becomes half of the daily score.

---

## 5. What is deliberately not proposed

- **No new goal numbers.** WHO 150/week and the existing daily step goal are unchanged; only the
  *window* each is measured over moves.
- **No change to `ZONE_DEFS`.** Same as Q-523 — training zones are not the defect.
- **No decision on which number is the headline.** That is a UI judgement and belongs to Lane B once
  the split exists.

**Caveats.** One athlete, 59–90 days, `claude_ro` row-scoped. The score correlations are n = 23 and
directional. The rolling-window figures assume Q-523's corrected WHO threshold, which is not yet
built — under today's shipped threshold the weekly total would be near zero, so these numbers depend
on that landing first.
