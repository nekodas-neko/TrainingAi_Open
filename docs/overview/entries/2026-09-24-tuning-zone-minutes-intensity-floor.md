# 2026-09-24 — the zone-minutes floor is a vigorous threshold wearing a moderate label

Tuning session, second entry of the day. Docs-only: one backlog entry, no product code.

## What was asked

TN-76 measured the Activity Score's `zoneMinutes` contributor as present on 11 of 30 days and **zero
on 9 of them**. This session asked why.

## Two wrong answers first, both checked and both recorded as wrong

**The suppression rule is leaking onto rest days** — no. Crossed against the stored `trained` flag,
`zoneMinutes` is absent on 19 of 19 training days and present on 9 of 9 rest days, plus the 2
training days where it was non-zero and therefore not suppressed. The Q-190 rule does exactly what
its comment says.

**The zeros are the ring's PPG power-gating rather than real inactivity** — also no, and this was the
plausible one: the ring's radio sleeps when worn-idle, which is what a rest day is. But the zeroed
days carry 203–2,395 samples across 21–24 distinct hours, and the day's **maximum** HR was 93–124
bpm. The readings are real.

## The actual answer

The goal and the threshold come from different intensity taxonomies. `DEFAULT_ZONE_MINUTES_GOAL = 22`
cites WHO's 150 min/week of **moderate** activity. `ZONE_DEFS` puts the Light band's floor at **60% of
heart-rate reserve**, which is where ACSM's **vigorous** range begins — and
`activeMinutesFromZoneSeconds` then calls that band `moderateMin`. Genuine moderate activity (40–59%
HRR) falls into zone 1, "Recovery", which the accumulator discards.

Measured for the owner (resting HR 54 over 36 readings, maxHr 187, reserve 133):

| threshold | bpm | reached on |
|---|---:|---:|
| app's zone-2 floor (60% HRR) | 134 | **3 of 31 days** |
| ~50% HRR | 120 | 11 of 31 |
| ACSM moderate floor (40% HRR) | 107 | **24 of 31 days** |

Daily max HR median is **118** — between the two floors. The contributor is unreachable by walking at
any duration, and because a zero is excluded on training days but included on rest days, its
practical effect is a flat rest-day penalty of **8.1 points** (range +7 to +9), larger than the whole
score's standard deviation of 7.4.

## Filed as TN-78, `Lane: O`, ungated

Recommendation attached: move the moderate floor to 40% HRR and keep the vigorous double at 60%, two
fractions in `ZONE_DEFS`. The cost is named — those bands are also a rendered legend and feed the
interval-walk targets — and the alternative (a separate pair of fractions owned by `zone-minutes.ts`)
is written up with why it loses.

**A field mistake worth recording:** this was first filed `Lane: A` + `Gate: owner`, which is the
trap CLAUDE.md names outright — `Gate:` parks an entry, so a question gated on the owner disappears
from the Orchestrator's READY list and nobody is tasked with asking it. Corrected to `Lane: O`,
ungated, plus an `Ask:` field, which is what puts it in the WAITING ON THE OWNER section (8 entries
now). `Lane: A` gets re-applied after the threshold is settled, not before.

## Not exercised

Docs-only; nothing ran. One user, one resting-HR baseline, 31 days. `hrMaxFromAge` is `220 − age`,
carrying roughly ±10 bpm of individual spread — the finding survives it (a 10 bpm lower maxHr still
puts the floor at 128 against a median peak of 118), but the 134 figure is an estimate. HR sampling
is sparse on rest days (~10/hour against ~82/hour overall), so the table counts days with any
qualifying sample rather than minutes; sparsity can only bias that downward. The entry is incomplete
until someone re-runs the zone accumulator to state how many stored days a threshold change moves.
