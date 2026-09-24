# 2026-09-24 — the activity double-count question, answered from existing entries

Tuning session, third entry of the day. Docs-only, and deliberately small: no new backlog entry,
because the finding already had two.

## The question

Q-524 proposes deriving the step goal from a target net walking energy, and left a named blocker:
*"the Activity Score already scores `steps` (weight 18) and `activeEnergy` (weight 15) separately —
deriving the step goal from an energy target makes those two contributors measure the same walking
twice. Decide the double-count before shipping."*

## The answer: not live, and probably never

**Nothing to double-count with.** `activeEnergy` reads `body_metrics.active_calories`, which holds a
value on 16 of 147 days and none since 2026-07 (Q-521). Its intended replacement,
`oura_daily_derived.active_calories_est`, is NULL on all 110 days — plumbed through Zod schema,
column, adapter write, sync mapper and local store, with no code anywhere that computes a value
(Q-184, already filed; re-confirmed here rather than re-discovered).

**And the owner's chosen direction removes the other half.** Q-184's own 2026-08-14 check says do not
build the estimate: direction C was chosen on 2026-08-11, and direction B — now Q-204 — replaces
`zoneMinutes` and the dead `activeEnergy` with one physiologically-grounded contributor. If Q-204
lands there is no `activeEnergy` term to collide with. The double-count appears only if Q-184 is
built instead, which that entry advises against.

So the blocker is cleared: sequence the formula `Needs: Q-204` if it is built first, otherwise the
collision cannot occur.

## The more useful half: a cross-reference that prevents a wrong fix

TN-76 (merged earlier today) measured the 15-weight `activeEnergy` absence as distorting the lane
balance — strength holding 60% of the score against a documented 45%. The obvious repair is to revive
its input, and that is the wrong move for exactly the reason above. TN-76 now carries a warning
pointing at Q-204, with the note that Q-204 would also subsume TN-78's threshold question, since
`zoneMinutes` is the other contributor direction B removes.

That connection is the actual output of this session: three entries filed today (TN-76, TN-77, TN-78)
all describe symptoms of restructuring work that was already queued and chosen a month ago.

## Not exercised

Docs-only; nothing ran. No new measurement of the app's behaviour — the production reads here
(147 days of `body_metrics.active_calories`, 110 of `active_calories_est`) confirm counts that Q-521
and Q-184 already recorded, and are reported as confirmation rather than as new findings. Whether
Q-204's single contributor is the right model is not assessed and is not Tuning's to assert without
the proposal in hand.
