# 2026-08-11 — a lifting day's zero zone-minutes is no longer scored as a missed target (Q-183)

**Branch:** `fix/zone-minutes-structural-zero` · **v1.279.2**

## What was wrong

The Activity Score's `zoneMinutes` lane (weight 10) scored *absent* data correctly — excluded, weights
renormalised — but scored a **structural zero** as a genuine failure at full weight. Zone 1 starts
around 60% HRR and strength training with rest between sets rarely sustains it, so a lifter scored ~0
on a cardio metric permanently, for a reason that is about the shape of their training rather than
their behaviour.

## Measured before deciding the trigger

The entry proposed "a logged strength session that day" as the trigger and flagged it as needing a
decision. Queried the owner's last 45 days through `claude_ro` (`daily_zone_minutes` joined to
`workout_sessions` on Brisbane-local day) rather than assuming:

| | n | exactly 0 | ≤ 2 | median | max |
|---|---:|---:|---:|---:|---:|
| all days | 45 | **40** | 43 | 0 | 26 |
| lifting days | 35 | **32** | 34 | 0 | 20 |
| non-lifting days | 10 | 8 | 9 | 0 | 26 |

Two things fell out of that:

- **Exact zero is the case** — 40 of 45 days. No threshold needed, so none was invented.
- **The proposed trigger is the right one, and deliberately narrow.** Rest days are *also* mostly
  zero, but a zero on a rest day genuinely does mean no moderate activity happened, so those stay
  scored. Only the lifting-day zero is excluded.

## The change

`computeActivityScore` takes `strengthSessionToday` (distinct from the rolling `sessions7d`) and
skips the zone-minutes lane when it is set and `zoneMinutes === 0` — the same exclude-and-renormalise
path absent data already takes. The flag is optional, so any caller that does not pass it behaves
exactly as before. `readiness-payload.ts` and the score-audit builder both supply it, and the audit's
`excludedReason` says which of the two exclusions applied.

## Verified

- **End-to-end on the running dev server, same data both ways:** flat 70 bpm intraday series (zone
  minutes 0) plus a completed session today. With the guard reverted the route returned **33**; with
  it in place, **38**. That proves the wiring through `readiness-payload.ts`, not just the pure
  function.
- **Unit tests verified by mutation:** dropping the guard fails exactly the two tests that name it.
  Also covered: real cardio on a lifting day still scores 100, a rest-day zero still scores 0, and
  omitting the flag changes nothing.
- Full suite green, lint and every custom-rules script pass.

**Not exercised: device.** Pure scoring change on a server read path — no offline-first domain,
native plugin, safe-area or gesture surface.

## Note for Q-137

The same measurement is worth carrying into the Activity Score's goal-calibration work: with 40 of 45
days at exactly zero, `zoneMinutes` carries almost no information for this user either way. Recorded
on Q-137's entry.
