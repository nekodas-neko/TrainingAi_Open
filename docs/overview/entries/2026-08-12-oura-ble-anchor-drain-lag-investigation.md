# 2026-08-12 — Sleep bed/wake times traced to a batch-receive-time bug in the clock anchor, and the fix already exists

**Domain:** sleep · devices · platform — docs-only (no code shipped this session), unblocks Q-71

Owner reported a night's displayed bedtime looked ~30 minutes late. What started as a single-night
check turned into tracing a real defect to its exact source line, disproving the fix that seemed
obvious, and finding the correct fix already shipped elsewhere in the codebase for a sibling bug —
just never applied to sleep.

## Night 1 (2026-08-06/07): a red herring, then a real find in a different place

First report: displayed bedtime 22:28, owner's actual bedtime ~22:30 — a 2-minute gap, not a bug.
Tried the documented clock-anchor extrapolation-distance theory (interpolating between bracketing
anchors instead of extrapolating from the newest one) — it moved the number the *wrong* direction
(19 min later, not closer). Ruled that out.

The real bug that night was unrelated to clock math: the Home screen's "Today's Timeline" widget
showed stale bed/wake data until a full app restart. Traced to a cache-invalidation gap Q-91 (fixed
2026-08-06) didn't cover — `home-day-timeline.tsx` reads a different cache key than the three
screens Q-91 patched. Fixed in #1185, shipped as v1.270.32. See
[`entries/2026-08-09-home-timeline-sleep-refetch.md`](2026-08-09-home-timeline-sleep-refetch.md).

## Night 2 (2026-08-11/12): a real clock bug, and a fix that made it worse

New report, different night: displayed bedtime 11:46pm against a remembered ~10:30–11pm. This time
the gap was too large (45–75 min) to be normal rounding.

**First hypothesis, tested and killed with real data:** maybe `denseSensingSpan` — the algorithm
that trims a sleep window to where the ring's HR sensor shows continuous dense signal, not just
spot-checks — was over-trimming a real early sleep onset. Pulled the actual raw BLE frames for that
night from `oura_raw_samples`, decoded them with the real decoder (`decodeEventBody`), and computed
per-5-minute HR beat density by hand: 62–108 beats/5min from 21:06–23:41 (sparse), then a 6× jump to
600+ beats/5min at 23:46 (dense). Cross-checked with an independent motion signal (tag 0x47
`motion_event`, decoded separately) — it showed a *cluster of orientation changes and the first
"high-intensity" motion events of the night* right in the 23:01–23:41 window, i.e. active
repositioning, not stillness. That's the opposite of what "the ring just lagged behind real sleep"
would predict. Checked ring battery too (owner suspected low-battery throttling) — it was ~30–40%
healthy through the exact transition window, only dropping to 10–18% by morning, well after. Neither
lead supported "the trim is wrong." Conclusion: `denseSensingSpan` is very likely doing its
documented job correctly on this specific night.

**Then the night's stored value itself started moving.** Re-queried the same row three times over
about 2.5 hours as the pipeline kept syncing:

| Rollup run | Anchor used | Anchor distance from bedtime | Resolved bedtime |
|---|---|---|---|
| 21:32 | ds=32425915 | 7.74h | 23:46:54 |
| 22:32 | ds=32472281 | 9.03h | 23:30:05 |
| 23:57 | ds=32547398 | 11.11h | 22:50:07 |

Monotonically drifting earlier, accelerating (−13 min/hour of extra distance, then −19 min/hour) —
far too fast to be real ring clock drift. This reproduces and sharpens the already-known,
already-documented Q-71 finding ("error grows with distance from the newest anchor") with three
concrete, verified data points from one night instead of an aggregate statistic.

**Proposed the "obvious" fix — bracket interpolation instead of extrapolation — and was asked to
test it before shipping. Good call: it's wrong.** Backtested `resolveDsToMs`'s pre-Q-139 interpolating
shape against the 9 most recent real nights (2026-08-04→12): every single night shifted *later* by
10–48 minutes, one outlier by 79 minutes — worse than what's currently shown, not better. Traced why:
the "bracketing" anchors are frequently from the same rapid-fire batch-drain burst (see root cause
below) and don't actually bracket anything meaningful in real time.

## Root cause, found at the exact line

`lib/data/postgres/adapter.ts:4655`, inside `insertOuraRawSamples`:

```ts
if (shouldObserve) {
  const anchorUtc = new Date()
  await this.db.insert(s.ouraBleClockAnchors)
    .values({ userId, anchorDs: batchMaxDs, anchorUtc, epoch, observedSource: 'drain' })
```

Every clock anchor is stamped with **when the server finished processing that ingest batch**, not
when the ring actually recorded the data. Checked the ingest payload
(`app/api/oura-ble/samples/route.ts`): the phone sends only raw hex frames, `{ frames: [{ hex }] }`
— no timestamp of its own, ever. And per `docs/oura-ble-operations.md` §2, the plugin drains
buffered ring history in ~255-event batches, POSTed back-to-back. During any drain, several batches
covering meaningfully different ds ranges land on the server within seconds of each other, each
minted as its own anchor — the "burst" pattern both this investigation and the original 2026-08-04
Q-71 measurement independently noticed, now traced to its actual source. Confirmed `observed_source`
is `'drain'` for all 3,851 anchors in production — there's no live-polled alternative anchor source
to fall back on either.

**This is not fixable retroactively.** The information needed — a timestamp close to true ring
capture time — was never recorded for any past batch. No math on top of `new Date()`-at-server-
receipt recovers it.

## The fix already exists — just not wired to sleep

`lib/oura-ble/clock.ts`'s `resolveDsToMs` was rebuilt for **Q-139** (shipped 2026-08-08, for the
*steps* path only): instead of interpolating between anchors or extrapolating from the newest one,
it takes the 10th-percentile lag (`server_receive − ring_ds×100ms`) across the whole epoch's
anchors as one robust, stable offset, then applies the ring's fixed 100ms/ds slope from there. Q-71
(this same investigation's home entry) already noted in 2026-08-04 that this was the right target
fix for sleep/HR/temperature too, and was blocked exactly on "re-scope after Q-139 is decided."
Q-139 has been decided and shipped since 2026-08-08 — Q-71 was sitting unblocked and undiscovered.

**Tested the real shipped function against the real data before writing any of this up.** Pulled
all 2,844 real epoch-2 clock anchors and ran the actual `resolveDsToMs` (not a reimplementation)
against the same 9 nights:

| Night | Currently stored | With `resolveDsToMs` | Shift |
|---|---|---|---|
| 08-04 | 10:36 PM – 7:41 AM | 10:33 PM – 7:38 AM | −3m / −3m |
| 08-05 | 9:57 PM – 7:07 AM | 9:55 PM – 7:05 AM | −3m / −3m |
| 08-06 | 10:16 PM – 7:56 AM | 10:13 PM – 7:53 AM | −3m / −3m |
| 08-07 | 10:16 PM – 6:26 AM | 10:14 PM – 6:24 AM | −3m / −3m |
| 08-08 | 10:10 PM – 6:10 AM | 10:07 PM – 6:07 AM | −3m / −3m |
| 08-09 | 10:21 PM – 7:25 AM | 10:18 PM – 7:22 AM | −3m / −3m |
| 08-10 | 9:51 PM – 5:34 AM | 9:48 PM – 5:31 AM | −3m / −3m |
| 08-11 | 10:26 PM – 7:21 AM | 10:23 PM – 7:18 AM | −3m / −3m |
| 08-12 | 10:50 PM – 7:35 AM | 10:47 PM – 7:32 AM | −3m / −3m |

Every night, both edges, exactly −3 minutes — a uniform, stable correction, not noise, and (unlike
today's `measuredAtMs` single-newest-anchor path) not sensitive to when the rollup happens to run.
Full detail and the still-open owner decisions (rewrite stored history or fix-forward-only;
confirming the fix closes the actually-observed 16–79 minute swings, not just this aggregate
3-minute shift) are in the re-scoped **Q-71** entry in `docs/implementation-backlog.md`.

## What shipped this session vs. what's queued

- **Shipped:** the Home-timeline stale-cache fix (unrelated bug, found while investigating night 1).
- **Not shipped, queued as Q-71 (now unblocked):** wiring sleep/HR/temperature's clock conversion
  onto `resolveDsToMs`. The fix is proven safe against real data; what's missing is an explicit
  owner decision on the stored-history-rewrite question, matching the precedent Q-139 already set.
- **Not queued, flagged as a real gap:** the actual root cause (server-receive-time stamping) needs
  a native change — the phone reporting its own receive time, or a live ring-clock poll — to close
  properly. That's bigger, cross-cutting work or a separate future item, not attempted here.

## Not exercised

Everything in this session was investigation and measurement against real production data via the
read-only admin SQL endpoint and the real shipped TypeScript functions (imported directly, not
reimplemented) — no code was written or deployed. Nothing here has been verified on-device.
