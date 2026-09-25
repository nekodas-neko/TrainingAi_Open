# 2026-09-25 — the header row is out of width, and that is arithmetic rather than a judgement

Lane B, docs-only. `LB-157` filed `Lane: O`; `BF-139` and `BF-96` parked on it.

## What was asked and what the numbers say

The `header-row-width` batch was next in the lane. Both entries had shipped a fix, both had **FAILED
on the S25 in the same sitting**, and both diagnosed the same thing: the header row is a fixed width
budget and nothing in it defends the date. The prescribed direction was *"something must own the
date"*, with Review sweep 59 adding that a shrink-only fix is gate-free and moving the date is not.

So the first question is whether a shrink-only fix exists. Measured in the running app at 412 dp,
with each candidate date format measured in the row's own computed font:

| | px |
|---|---|
| the row | **224.0** |
| `gap-2` | 8.0 |
| chips, night | 156.1 |
| chips, `UV 5` | 200.2 |
| chips, `UV 11` | 208.6 |
| `Wednesday 30 September` | **158.7** |
| `Wed 30 Sep` | 71.7 |
| `Wed 30` | 45.3 |
| `30 Sep` | 41.7 |

The date's remaining space is **59.9 px at night, 15.8 px at `UV 5`, 7.4 px at `UV 11`**. In daylight
**nothing fits — not `30`, not two characters.** *"Make it smaller"* is exhausted, which is why a
third chip-shrinking fix would fail the same way the first two did: the slack each of them spent was
the date's, and there is none left.

That makes every remaining option one that changes what Home *shows*, and CLAUDE.md is unambiguous
about whose call that is. Filed as `LB-157`, `Lane: O`, **ungated** — the gate would park it and the
point is that someone puts it to him.

## The brief, in one line each

**Recommended: the date on its own line above the chips.** The only option that keeps every reading,
about 18 px of vertical space once, and the shape that survives the next chip — BF-139 already notes a
fourth is expected, since anything with a battery is a candidate.

Against: **moving the batteries off Home's header** (the date then gets 98.4 px, enough for
`Wed 30 Sep`, but ring and scale battery are exactly what is worth a glance rather than a visit —
which is why Q-111 put them there); **dropping the date** (free and riskless, but Android's status bar
shows the *time*, not the date, so BF-96's *"partly recoverable from the phone's own UI"* does not
hold for the day of the week); and **a responsive date** (needs no decision, but on the numbers above
it shows `Wed 30` at night and nothing in daylight, so the date appears and disappears by weather —
which reads as a bug rather than a fix).

Reversal cost is low for all three: a handful of lines in `header-meta-row.tsx`, no data, no
migration. Worth deciding quickly rather than carefully. The expensive part has been shipping twice.

## What the sandbox cannot settle, recorded so nobody tries again

The seeded DB has no weather snapshot, so `WeatherChip` renders a **56 px skeleton** and the real
three-chip row cannot be reproduced here — both entries already said so and it is confirmed. The chip
figures are the 2026-09-12 device measurements. What *was* re-measured here is the row width, the gap
and every date format, and those agree with the entry to 0.1 px, which is what makes the chip figures
worth relying on.

## Nothing shipped, deliberately

No code. An unbuildable entry heading a lane is a queue defect, and the honest fix for it is the
measurement plus the question — not a third fix that the arithmetic already refutes.
