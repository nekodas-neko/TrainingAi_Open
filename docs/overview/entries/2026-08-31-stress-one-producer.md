# 2026-08-31 — BF-81: two computations behind one metric, and a recommendation that would have frozen three columns

**Branch:** `lane-a/next` · **Lane A** · JS/server only, no APK.

`oura_daily_derived`'s three daytime-stress scalars and the `oura_daytime_stress_buckets` strip
described the same day and were produced by different code. The rollup built its series from
`latest.rhrLowBpm` + `nightHrvMs`; `/api/body-battery` built its own from `restingHr` + a 28-day HRV
mean, and persisted the scalars from it on every read.

**Re-measured in production before touching anything — and it is worse than filed.** The entry said
five of eight days flipped sign; it is **six**:

| Day | buckets | stored | high-stress min, buckets / stored |
|---|---|---|---|
| 08-31 | −0.19 | **+0.00** | 240 / **0** |
| 08-29 | −0.01 | **+0.08** | 210 / **0** |
| 08-28 | +0.04 | **−0.10** | 120 / 60 |
| 08-27 | +0.05 | **−0.03** | 270 / **0** |
| 08-26 | −0.01 | **+0.07** | 210 / **0** |
| 08-24 | −0.12 | **+0.22** | 240 / **0** |

High-stress minutes differ by 4–8×: the strip says 2–4.5 hours on days the stored number says none.

## The entry's recommendation would have made it worse

It said: *delete the write at `body-battery/route.ts:349`, not the route's computation.* Following
that literally leaves the three columns with **no writer at all** — the rollup only ever persisted
the *buckets*, never the scalars — and `weekly-digest/route.ts:185` reads `stressHighMinutes`. The
strip and the number would have stopped disagreeing by the number ceasing to exist.

So the fix is a deletion **and** an addition: the rollup summarises the same `pts` it turns into
buckets, in the same `try` block, and the route keeps computing a summary for its own response
without storing one. Divergence is now impossible by construction rather than by convention.

**No freshness regression, checked rather than assumed.** The route was write-through on every read,
so removing it could have left today stale. The rollup runs on every BLE sample ingest
(`/api/oura-ble/samples` → `runRollupOffLoop`), and the scalars are written immediately after
`replaceStressBuckets` in the same block — so they update exactly as often as the buckets, which
production shows current to today.

## What was deliberately not done

**The history recompute, because the entry's version would have deepened the artefact it warns
about.** 38 rows carry `daytime_stress_scaled`; only **8** have buckets to re-derive from.
Recomputing those 8 leaves 30 on the old producer — a column that is *more* mixed, not less. Doing
it properly needs a wide rollup pass re-deriving buckets from the packed raw tier for all 38 days,
which is owner/device-gated. Overwriting stored history is irreversible, so it is the owner's call.
This is the Q-304b shape: the authorisation was real and the specified method was wrong.

**`chronic_stress_score` is NULL on all 106 rows, and that is the gate, not a bug.** The entry asked
to check which before treating it as a data problem. `run.ts` answers it: *"the intermediate history
is built from THIS pass's stashed signals, so the first score requires a wide/full rollup pass
covering ≥21 nights of real ring data (owner/device-gated)"*. No code fix applies.

`resilience_daily_stress` sits on 15 of 106 rows — sparse rather than absent, not investigated.

## Verified

- 5 unit tests on the reduction the scalars must be; **2 mutations killed** on the new check —
  the route persisting again, and the rollup losing its write.
- `scripts/check-stress-scalars-one-writer.js` (Custom Rules, now **66**) guards both directions.
  Its first run flagged `adapter.ts`, which is the upsert's plumbing rather than a producer — the
  three repository files every writer passes through are exempt by name, with that reason.
- Full suite **696 files / 5,852 tests** · `pnpm check:rules` **Ran 66 of 66** · `tsc` clean.

## Not exercised

The rollup runs off BLE ingest, which needs the ring — so the new write was not observed executing.
What is verified is the reduction it performs (unit-tested), that it is the only persister (checked),
and that it sits in the same block as a bucket write production shows current to today. **The
corrected values will appear as the ring syncs**; days already stored keep the old producer's numbers
until the recompute question above is answered.
