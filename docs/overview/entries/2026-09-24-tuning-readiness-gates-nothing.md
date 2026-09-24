# 2026-09-24 — the readiness score changes no prescription, and the signal that could judge it was already being collected

**Branch:** `tuning/readiness-gates-nothing` · **Agent:** Tuning · **Docs-only.**

Asked to keep looking at tuning angles. This pass stopped asking whether the scores are *accurate* and
asked whether they are *connected to anything* — and turned up one structural finding and one method.

## TN-64 — readiness gates nothing

`earlyDeloadRecommended` (`lib/health/readiness-payload.ts:665`) is the only place a readiness score
automatically changes what the app prescribes. It is wrapped in `if (program?.phaseMode ===
'automatic')`. **The active program, Bankai, is `ai_dynamic`** — so no readiness score, however low, can
propose a deload on the program actually in use.

It has also never fired under either mode, which makes this measurement rather than inference:

| check | result |
|---|---|
| `early_deload_week_start` | **NULL on all 5 programs**, including the two `automatic` ones running since 2026-06-14 |
| `is_early_deload` | **false on all 117 sessions**, 2026-04-30 → 2026-09-23 |
| days below the score threshold (45) | **12 of 71** — the score half was reachable |
| ACWR, the other half of the condition | **not stored in any table**, so unreachable retrospectively |

**The consumption side is not the bug and was already fixed.** `isEarlyDeloadWeek`
(`packages/shared/src/phase-engine.ts:125`) exists so an `ai_dynamic` program honours a confirmed deload
week — its own comment records that until Q-175 a confirmed deload never reached the AI prescription. So
the half that *honours* a deload works and the half that *offers* one is switched off for the mode in
use. Fixing the wrong half would change nothing.

This reorders the tuning queue's own priorities. Every other tuning entry sharpens a number; re-weighting
contributors or fixing the tail improves a figure no training responds to. Filed `Lane: O` with the
decision brief in the entry, per the standing rule that an owner question is a task rather than a chat
message.

## TN-65 — the validation signal was already there, and the first test is a null

`set_logs.rpe` is populated on **864 of 1,286 sets (67.2%)**, mean 7.40, sd 0.94. Every tuning
discussion so far has treated lived feedback as unavailable, and that was true of the *daily*
self-reports — `perceived_recovery_touched` 0 of 96, `session_rpe` 20 of 103 — while the per-set one was
being collected the whole time.

Controlling for exercise and planned-intensity band, **509 sets**: readiness against RPE deviation
**r = −0.060**, with poor days (<50) at **−0.009** and ready days (70+) at **−0.046** — 0.04 points on
an sd of 0.94.

**That null does not convict the score, because the load moves too.** Across 591 sets, relative load is
**0.940** on poor days against **1.036** on ready days, about 9% lighter. Equal effort at a lighter load
is the shape you want. What nothing stored can say is whether the app or the owner produced that 9% —
and since TN-64 establishes that no automatic path can reduce a prescription, self-regulation is the
more plausible reading. If so, the owner is already doing what a working score would advise.

## Two mistakes worth recording

**I filed TN-63 and TN-64 with `Reference:` used as "background reading".** That field marks an entry as
read-only, so both printed in the REFERENCE section — *"never next"* — instead of the work list. TN-63
shipped that way in #1510 and was invisible as work for about an hour. Both now read *"Where the
mechanism is:"*. This is the third time I have misused a backlog field as prose, after TN-56 and TN-59.

**The pass also produced a tidy story I am not allowed to use.** Within one session name (n=10 each),
readiness against volume: Legs +0.54, Upper +0.57, Lower +0.47, Push +0.005, Pull +0.048 — systemic
fatigue mattering on compound days and not on split days. It is the exact shape of Q-272's retracted
`r = +0.67 (n = 11)`. At n=10, r = 0.54 is not significant. Recorded on TN-65 as not-to-be-cited so the
next session does not rediscover and believe it.

## Not exercised

Nothing runs; queue and documentation only. The measurements are read-only queries through
`/api/admin/db-query`, **row-scoped to the owner**, plus source reading. **Not established:** whether
ACWR ever exceeded 1.2 on a sub-45 day during the `automatic` era (the column does not exist), whether
the 9% load reduction was prescribed or self-chosen, and whether the RPE residual is sensitive enough for
a null from it to mean anything — all three are stated as open on the entries rather than resolved here.
Two query mistakes of mine were corrected mid-pass: `readiness_contributors` stores `{score,
provisional}` objects rather than bare numbers, and the battery columns are `total_charged`/
`total_drained`. `pnpm check:rules` result below.
