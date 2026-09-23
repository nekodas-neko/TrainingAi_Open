# 2026-09-23 — DV-13: the outage was probably us deploying, and the route was still wrong

**Branch:** `lane-a/dv13-device-metrics-blocking` · **Lane A** · one admin route and its new test.
No migration, no schema change, no client change. **DV-13 stays queued** — see Keep.

## The entry said to measure before fixing, and measuring changed the answer

DV-13 was filed with the Oura BLE admin console as the suspect for an eight-minute production
outage, explicitly flagging that the cause was **not proven** and naming the first two reads:
`error_events`, and Railway's logs for 20:00–20:15 AEST.

**`error_events` for the window holds exactly two server rows, and they are at 20:12:36–37** — the
moment of *recovery*, not the stall:

```
GET /api/day-timeline   [cause: timeout exceeded when trying to connect] Failed query: select …
/api/body-battery       [cause: timeout exceeded when trying to connect] Failed query: select …
```

That is a **pool-acquisition** failure — the app could not obtain a database connection — which is
what a container looks like while it warms, and is neither a slow query nor a blocked event loop.

## The merge timeline, which nobody had put beside it

```
19:47:07  #1463      19:51:20  #1466      20:03:30  #1468      20:18:18  #1467   (AEST)
                                    outage: 20:04:40 → 20:12:41
```

**Four merges in sixteen minutes, each auto-deploying to Railway production — and #1468 landed 70
seconds before `/api/version` first went slow.** A replaced container explains a database-free route
timing out for minutes and then answering in 0.5 s, without needing a blocked loop at all. Those
merges were mine, earlier in this same session, which is the part worth saying plainly: the
measurement that looked like a device-agent finding is substantially an artefact of how fast this
lane was merging.

## The route was still doing something indefensible

`device-metrics` called `toAestDay` — `formatInTimeZone` — **once per raw row**:

| measurement | value |
|---|---|
| rows in the owner's default `?days=3` window | **58,856** |
| cost of one `formatInTimeZone` call | **11.2 µs** |
| synchronous time before any decoding | **656 ms** |
| extrapolated at `?days=14` | **~3.1 s** |

On sandbox CPU, so worse on Railway. Nothing else runs on the process while that happens — and the
siblings named in the entry (`samples/summary`, `rollup-state`, `samples/pack`) have **no such
loop**, which is checked, not assumed. So a documented "single-row read" appearing to hang is the
signature of *the process being occupied*, not of that route being slow. That part of the entry's
reasoning was right.

The fix memoises the day lookup **by minute**. No UTC offset is finer than a minute, so every
timestamp in a minute is in the same local day in every zone — the result is identical and the
formatter is called at most 1,440 times per day of window instead of once per row.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | route memo keyed by hour | killed |
| 2 | bucketing loop bypasses the memo | killed |
| 3 | the TEST's own helper keyed by hour | killed — by Kathmandu and Chatham |
| C | key written `60000` rather than `60_000` | **survived**, after a fix |

**Mutation 3 is why the zone list is what it is.** An hour-keyed memo passes every whole-hour zone;
only the 45- and 45/60-minute offsets catch it. **The control failed first time** — the source scan
pinned the literal `60_000`, so the identical `60000` broke it. That is the third time today an
assertion pinned syntax instead of contract (TN-60, RV-82, here); it now matches the value in either
form.

## Keep — DV-13 is NOT closed

1. **That `device-metrics` caused the outage is still not established.** 656 ms, or even 3 s, does
   not account for a 90-second abort, and the deploy correlation is the better explanation for that
   window. Do not close this entry by pointing at the fix that shipped.
2. **The loop is cheaper but still unbounded** — the row cap and the explicit per-request timeout
   from the entry's fix direction are not done.
3. **Railway's logs for 20:00–20:15 AEST are unread** — no access from the sandbox.
4. **The device pass test needs the phone.**

## Failure surfaces not exercised

The device, and production. The route was not executed end-to-end — it needs an admin session — so
what is pinned is the bucketing's equivalence and the route's use of it, measured against the real
row count read from production rather than a guess.
