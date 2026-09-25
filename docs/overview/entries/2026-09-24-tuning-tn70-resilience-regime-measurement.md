# TN-70 — verifying the resilience regime split, and the trap underneath it

**Branch:** `tuning/tn70-resilience-regime-measurement` · Lane A · docs + one corrected comment. No
behaviour change ships here.

## What the entry asked for, and why that is not what I did

TN-70 records that `resilience_level` published **5 and only 5** for sixteen days in July/August and
**never 5 again** across fourteen days in September, and proposes a decisive test: re-run the rollup
over the early span and see whether those days still come back as 5.

**I did not run it, deliberately.** The rollup persists to `oura_daily_derived`, so re-running it
over that span rewrites production rows — a production write, which is the owner's call rather than
Lane A's. The non-destructive form exists (`runOuraRollup` takes an injectable `io`) and is what
remains of the entry. What I did instead was cheaper and, as it turned out, more informative: read
the stored inputs the levels were computed from.

## The entry reproduces exactly, and narrows to one number

Both regimes re-measure to the entry's figures to three decimals. Its ⚠ about
`daytime_stress_coverage_min` also holds — 0 rows early against 14 late is the column's age, not a
missing measurement.

The switch is carried by **one** stored index: `resilience_daily_sleep_recovery`, 10–56 in July and
0–17.6 (mostly exactly **0**) from September. Exactly zero is the clamp, so those days are saturated
at a floor rather than measured.

**Why one index can do that.** `runStressResilience` builds its two recovery terms differently,
replicating a documented `.pt` broadcast: restorative time is a weighted *mean*, sleep recovery is a
*sum* that reduces to ≈ `windowLength × mean`. ~14×. July's window mean of ~36 becomes ~511 where
September's ~3 becomes ~42, which swamps the other two inputs and pins the label at the top band.

That also explains the shape the entry flagged as strange without naming: **the level-5 run carries
the series' highest stress (71–82) and lowest restorative time (15–26)**. The top band went to the
worst-looking days because one term outweighed the rest.

Looking behind that index, three of its four contributors fell together (sleepScore ~90→~48,
hrvBalance ~80→~10, RHR ~70→~25) while recoveryIndex moved the *other* way. A whole-composite
decline is weaker evidence for a single upstream producer fault than the entry's PS-30 hypothesis
assumes.

## The part worth reading — a bug I nearly filed backwards

`recoveryIndex.provisional` is `true` on every one of the 23 days with stored indices, and
`rollup/run.ts:1166-1168` gates its two neighbours on `provisional` but gates recoveryIndex on
something else entirely:

```
hrvBalance:       provisional ? null : score
recoveryIndex:    recoveryIndexHours != null ? score : null
restingHeartRate: provisional ? null : score
```

One of three not checking the flag, on a field that is always set, reads as an obvious miss — and
the doc comment on `ResilienceDayInput` appeared to confirm it in so many words: *"provisional/null →
today contributes no index"*.

I had written it up as a defect before checking what `provisional` means for that contributor.
`score-audit/readiness.ts:158` settles it: recoveryIndex is *"Approximation — **always flagged
provisional**"*. For this one the flag is a permanent property of the method, not the learning-period
meaning its neighbours carry (where a provisional score is a fabricated 50). **Gating it on
`provisional` would null the contributor on every day forever.**

So `run.ts` is correct as written and the **comment** was the defect. It is corrected here, with the
reason, because the next reader will notice the same asymmetry and the comment was actively pointing
them at the wrong fix.

## Verification

`tsc` clean · Custom Rules **78 of 78**. No test changes — nothing executable changed. The
production reads were `claude_ro` (row-scoped to the owner) via the admin endpoint, so every figure
above is **the owner's days only**.

## Not done

The non-destructive local rollup re-run, which is what the entry still owes. And no explanation of
*why* the recovery-side composite declined — that is a measurement, not a diagnosis, and TN-67
already records that no external comparator for this score exists.
