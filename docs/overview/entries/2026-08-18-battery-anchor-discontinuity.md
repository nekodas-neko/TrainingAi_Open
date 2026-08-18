# Auditing my own recalibration found nothing missed, and one pillar quietly fixed

**Date:** 2026-08-18 · **Branch:** `tuning/battery-anchor-discontinuity` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-511

The standing rule is that when a display scale moves, **every** threshold and consumer on it gets
re-anchored in the same PR. The sleep recalibration moved that scale ~15 points and re-anchored
`LOW_SLEEP_SCORE`. This is the audit of whether that was the whole list.

**It was.** There is exactly one comparison threshold on the sleep scale in the entire codebase, and
it was the one that moved. Every other consumer — Body Battery's anchor, readiness's `previousNight`
contributor, resilience's `sr` — takes the score as a *value* and inherits the shift directly rather
than needing a constant changed.

## The thing the audit turned up instead

`body-battery/anchor.ts` uses the sleep score **raw** as the day's anchor, and a provisional sleep
anchor can upgrade to readiness part-way through the morning. Its own docstring records what that
cost: *"shifted the ENTIRE day's curve … the number visibly jumped and the two Home cards stopped
agreeing"* — an owner report from 2026-08-02.

The size of that jump is `readiness − sleepScore`, and nobody had measured it. Over the 33 days
carrying both: **mean −17.7**, sd 10.2, range **−51 to +6**.

Then the useful part. The recalibration moved sleep 84.1 → 69.5 over its replay window, so the gap
goes from −17.7 to roughly **−3**: the two anchor sources were about 18 points apart and are now
about 3. Nothing targeted Body Battery — it fell out of putting sleep on a realistic range, because
readiness already was on one.

**Which makes it something to protect rather than celebrate.** The obvious future move — reading the
new sleep distribution as "too harsh" and lifting it back — re-opens an owner-reported bug in a
different pillar. That constraint now exists and was previously written down nowhere, which is the
actual deliverable here.

## What did not get fixed

The *systematic* offset is mostly gone. The per-day disagreement (sd 10.2) is not, and no
recalibration removes it — two different scores disagreeing about the same morning is Q-276's open
question. So ±10-point flips remain routine and **the freeze-once rule stays load-bearing**. It must
not be relaxed on the grounds that the scores now agree; they agree on average, which is a different
claim.

## The bound worth stating

`body_battery_daily` has **never** persisted `anchor_source = 'sleep'` — 41 days `readiness`, 9
`default`, zero `sleep` — because a sleep anchor is provisional and gets overwritten. So the
end-of-day table cannot separate "the flip happens every day" from "readiness is always available
first and the sleep arm never runs". **The magnitude is solid; the frequency is unknown**, and the
owner's report is the only evidence it fires at all.

Also recorded rather than filed: nine days right after the re-key anchored at a flat **50** because
neither score existed. Last occurrence was over a month ago, so it reads as a coverage gap that closed
on its own — noted as unexplained rather than fixed.

## Not exercised

No code changed; nothing on-device. The −3.1 post-recalibration gap **mixes two windows** — the gap is
measured over 33 production days, the sleep shift comes from the review's 65-night replay, and their
old-sleep means differ (87.2 vs 84.1). So it is an estimate, not a measurement; the robust claim is
"most of the systematic offset is removed". It cannot be measured directly until enough new-model rows
accumulate, and there is currently **one**. Every figure is the owner's (`claude_ro` is row-scoped).
