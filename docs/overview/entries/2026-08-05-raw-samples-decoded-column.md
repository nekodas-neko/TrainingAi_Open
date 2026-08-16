# 2026-08-05 — Q-81: a query filtered on a column nothing has ever written

**Domain:** readiness · devices · platform — v1.259.1, JS/server-only (no APK rebuild)

The gap sweep filed Q-81 as *"the daytime-HRV model has never fitted, and its inputs are present"*,
and guessed the failure was downstream — in `extractNightlyTrainingSamples` or the fit itself. **That
guess was wrong.** Execution never reached either.

## The find

`getOuraRawSamplesForTags` filtered on `decoded IS NOT NULL` and returned that stored column.

```
SELECT count(*), count(decoded) FROM oura_raw_samples
→ 812,816 rows · 0 decoded · 30 distinct tags · 0 tags with any decoded value
```

**The column has never been written, for any row, for any tag, ever.** `body_hex` is the archival
source of truth — CLAUDE.md says so — and every other consumer decodes it on the fly
(`step-counter-pipeline.ts:94` is the pattern; `adapter.ts` itself does
`r.decoded ?? decodeEventBody(r.tag, hexToBytes(r.bodyHex))` in three other places). This one
function was the odd one out, and its filter matched nothing.

So it returned an empty array to every caller, always. `maybeRefitDaytimeHrvModel` hit
`if (rows.length === 0) return` and bailed before touching the extractor.

## Two victims, one of them already on the record

| caller | symptom |
|---|---|
| `maybeRefitDaytimeHrvModel` | `oura_daytime_hrv_model` empty since the feature shipped; Body Battery's D5 daytime-HRV input permanently absent |
| `/api/oura-ble/device-metrics` | returns `{"days": []}` |

The second one was **already recorded as unexplained** in the 2026-08-05 navigation journal entry:
*"`/api/oura-ble/device-metrics` returns `{"days": []}` — empty on a device that has been ingesting
all day. Worth a look; not investigated here."* Same root cause. That is the value of writing an
unexplained observation down rather than dropping it.

## The fix

Decode from `body_hex`, preferring the stored column if it is ever populated — matching the three
existing sites in the same file. The decoder already handles all three tags the model reads and
emits exactly the keys it looks for, confirmed against real production frames:

```
0x5d → {"hr_bpm":[62,61,60,58,60],"rmssd_ms":[34,49,60,63,73],"interval_min":5}
0x46 → {"temps_c":[24.35,25,26.95]}
```

**Two things found while fixing it, both worth more than the one-line change:**

**1. The caller was asking for 60 days and silently getting 31.** `getOuraRawSamplesForTags` clamps
its window; `REFIT_LOOKBACK_DAYS` was 60. So the sleep-window lookup spanned twice the range the
samples could ever cover. The cap is now an exported constant and the caller uses it, so the lie is
gone rather than hidden.

**2. The throttle only applied once a model existed** — `if (existing && !shouldPrune(…)) return`.
With an empty table it did nothing, so the refit ran on **every rollup**. That was free while the
query returned zero rows. After this fix it is a ~43k-row read and decode (**503 KB, measured
against production**) — which a user with no model yet, or one whose fit keeps failing, would have
paid on every single ingest drain, forever. Now throttled on *attempt*, not just success.

That second one is a regression this fix would have introduced. It was caught by asking what the
change costs on the path it runs on, not by any test.

**3. Both silent bails now report.** They were bare `return`s, which is why the model sat empty for
months while the pipeline reported success daily. Zero samples from a non-empty row set, or a null
fit above `MIN_TRAINING_SAMPLES`, now throw into the rollup's `stepErrors`. A genuine cold start —
some samples, just not enough yet — still stays quiet, because an alert that fires during normal
ramp-up is an alert nobody reads.

## Verification

A DB-backed regression test seeds 30 hrv + 30 temp frames of **real production hex** with `decoded`
left NULL — the exact production shape — and drives the whole chain through the real repository
function:

- 60 rows returned, each with a decoded payload built from `body_hex`
- 150 training samples extracted
- **a model that actually fits**, with finite coefficients and residual

Three distinct temp frames are cycled rather than repeating one: a single repeated frame gives temp
zero variance, which makes the 3×3 system singular and a null fit *correct* — that version of the
test would have passed without proving anything.

**Reverting the one-line filter makes it fail with exactly the production numbers** — 0 rows instead
of 60, 0 samples instead of 150.

Full suite: 396 files, 3,132 tests. One failure, `oura-ble-aggregate`, which is on the documented
pool-oversubscription flake list, passes alone, and **does not call the changed function** — checked
rather than assumed.

## Not verified

Whether the model now fits **on the owner's real data**. The test proves the chain works on seeded
frames; it cannot prove that 31 days of the owner's nights clear `MIN_TRAINING_SAMPLES = 50` with
enough HR and temp variance for a non-singular system. The refit runs inside the ingest rollup, so
this resolves itself on the next drain after deploy — and if it still refuses, the new `stepErrors`
message now says which of the two reasons it was, which it never did before.

Worth re-checking after a day: `oura_daytime_hrv_model` should have a row, and
`/api/oura-ble/device-metrics` should stop answering `{"days": []}`.
