# The owner's fix was better than mine, and smaller

**Date:** 2026-08-19 · **Branch:** `tuning/manual-bedtime-entry` · **Agent:** Tuning 🎶
**Type:** docs-only — design proposal from an owner report · **Filed as:** Q-519, Q-520

The owner forgot to put the ring on before bed and fitted it at ~4 am. The session reads
**4:23–8:03 am, 3h 5m, 84% efficiency, 30m latency** against trailing averages of 8h and 92%. Their
concern was specific: *"I don't want it to change estimated bed time values."*

## The night has two kinds of data, with opposite validity

**Wrong** — time asleep, efficiency, latency, bedtime, restless periods. They measure when the *ring*
was on, not when the owner slept. **Right** — HRV 61 ms, lowest HR 53, avg HR 57, breathing 9.1. Real
measurements of real sleep in the window observed, and they look it: HRV 61 against a 59 ms trailing
average, lowest HR 53 which is *exactly* the trailing average.

So deleting the night is the wrong instinct — it throws away good physiology the EMA baselines need,
and Q-506 showed how fragile those already are. Keeping it as-is is worse.

## The concern, quantified

The bedtime estimate averages sleep starts over 14 days. `minutesFromNoon(04:23)` = **983** against
~**660** for an 11 pm bedtime, so one such night moves the mean to 683 — **the estimate reads ~23
minutes later for two weeks**. `nightSessions()` can't help: it reassembles a night split by a wake-up
and needs an earlier fragment, which doesn't exist when the ring was off.

## The owner proposed the better fix

I had proposed a partial-night flag. They asked whether manual bedtime entry could work instead, and
it is the smaller and better-targeted answer.

`health-source.ts` merges **per field, not per row** — its own comment says a manual weight *"must not
stop the ring's HRV… from"* being kept. `manual` is rank 5, `oura_ble` rank 3. So writing **only
`sleep_start`** sets the real bedtime at rank 5 while duration, efficiency, HRV, HR and breathing all
stay at `oura_ble`, untouched. No new schema, no new merge logic.

**The invariant it rests on:** `duration_hours`, `time_in_bed_hours` and `efficiency` are **stored
columns, not derived from the start/end span**. That is the only reason it is safe — recompute either
from the span later and this silently produces a 9-hour night at 34% efficiency. Written into the
entry as a comment-beside-the-write requirement.

It deliberately does **not** stop the 3h 5m reaching the sleep score, readiness, resilience or the
Body Battery anchor. That is Q-520, sequenced second so it can be judged after the timing noise is
gone — and specified as **manual, not auto-detected**, because an automatic "looks partial" rule would
eventually suppress a genuinely bad short night, which is what the recalibrated score exists to show.

## Not exercised

**Nothing was written to production** — `claude_ro` is read-only, enforced by the Postgres role, so
this night could not be and was not edited by me. **The per-field merge was read from the source and
its comments, not demonstrated** — no test was run proving that writing `sleep_start` at `manual`
leaves `average_hrv_ms` at `oura_ble`, and that is Q-519's load-bearing assumption. **Whether any
consumer recomputes duration or efficiency from the span was not audited** — the entry states the
invariant the design needs, not that it currently holds everywhere. The ~23-minute figure assumes 13
otherwise-normal nights; the owner's actual window was not pulled. And **no sleep-session delete or
edit path exists**, which is why the answer is a proposal rather than an action.
