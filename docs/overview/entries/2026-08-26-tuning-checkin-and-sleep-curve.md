# 2026-08-26 — the check-in moves readiness by design; and a sleep curve that disagrees with its own comment

*Tuning · docs-only · branch `tuning/battery-anchor-ceiling`*

Owner: *"we shouldn't have readiness move the number — the numbers should be fully set on first
open/load"*, and *"have a look at sleep and activity too. I went to bed at good hours and good sleep
hours. I trained yesterday so I'd imagine it's higher."*

**TN-9 — readiness is 10% self-report, frozen at 50 until logged.** `READINESS_WEIGHTS.checkin = 0.10`
and an unlogged check-in contributes `NEUTRAL = { score: 50, provisional: true }`, so the score
shifts the moment the card is answered. It also contradicts that card's own copy — *"It tunes today's
session, not your whole plan"* — while quietly moving the number above it.

Recommended: drop `checkin` and renormalise over the remaining eight, keeping the check-in for the
session prescription. **Measured over 35 days it is nearly free** — mean 69.9 → 70.4, sd 11.59 →
11.79, largest single-day move 3.84, **no day moves ≥5**. Removing a 10% contributor usually moves a
score; this one does not, because the logged check-in tracks the objective contributors closely
enough to add little independent information. Worth knowing before assuming any weight is
load-bearing.

**TN-10 — `TOTAL_SLEEP`'s comment and its anchors disagree by ~15 points.** The comment says
*"8h is excellent (~92); 7.6h normal-good (~86)"*; the curve gives **77.0** and **71.4**. On the
heaviest of the ten contributors (weight 24 of 110), that is ~3.3 blend points on every night in the
band most of the owner's nights land in. **Which is wrong is not answerable from data** — either the
comment is stale or the anchors were shifted — so the entry says to read the plan the comment cites
before changing either, and sequences it after TN-5 so two sleep changes are not evaluated at once.

The owner's night: 7.75 h → contributor **73.5**, blend **73.15**, displayed **57** (reproduced
exactly from the stored value). So "good sleep hours scoring 57" is the duration curve plus a genuine
autonomic dip — overnight HRV 53 against 60 two days earlier, resting HR 53.7 against 50.2 — passed
through TN-5's compression.

**Activity 63 was not filed, deliberately.** At 7:03 am the daily-movement lane (steps 18 +
activeEnergy 15 + zoneMinutes 10 + moveHours 12 = **55** of 100) is near-empty, while the strength
lane (**45**) already carries yesterday's session. A 63 with the whole day still ahead is the score
working, and yesterday's training is exactly what is holding it up. The mismatch with the owner's
expectation is Q-505's daily-vs-weekly split, already queued.

**Not exercised:** no code ran — SQL against production plus source reading.
