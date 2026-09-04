# 2026-09-03 — the hypnogram's missing section is a local-first read that skips the server's merge (BF-115)

**Branch:** `docs/bf115-root-cause` · docs-only. Root cause established; the one-line fix is Lane B's.

## What the three rows actually are

BF-115 led with *"there are three sleep rows for that date"* and asked, correctly, why — before making
the sheet pick better. In Brisbane time, 2026-09-03 holds:

| oura_id | window (local) | hours | phase chars |
|---|---|---|---|
| `ble:51136441` | **22:16 → 06:21** | 7.67 | 97 — the real night |
| `ble:51614985` | 11:33 → 13:58 | 2.00 | 29 |
| `ble:51827985` | 17:28 → 19:35 | 1.83 | 26 |

A midday sleep and an early-evening one. **Nothing is wrong with storing them**, and **19 dates carry
more than one row, spanning 2026-05-29 → 09-03** — longstanding, not a regression.

⚠ **They are not PS-17's mechanism, despite 2026-08-27 appearing in that list.** PS-17 blames
`ALWAYS_NIGHT_MIN_HOURS = 4` short-circuiting the circadian check. Both fragments here are **under**
4 h, so that escape hatch never fired. Same family, different cause — closing one on the other's
evidence would be wrong.

## The route was already right

`/api/sleep-sessions` runs `mergeByDate`, whose `primaryCluster` keeps the longest row plus anything
within `CONTIGUOUS_GAP_MS` (1 h). The midday nap sits ~8 h from the night and the evening one
~2 h 41 m before it, so **both are dropped** and the route returns the 7.67 h row with its full phase
string. There was nothing to fix in storage or in the API.

## The defect

`health-content.tsx:230` reads `store.getSleepSessions(cutoffStr)` and line 299 pushes the result
straight into state:

```ts
if (localSleep.length > 0) setSleepRows(localSleep as unknown as SleepRow[]);
```

**Raw per-cluster rows, never merged.** The sheet then receives all three, finds the entry for the
date, and lands on a fragment whose 29- or 26-character phase string and tiny stage hours fail both
the hypnogram condition and the proportion-bar fallback — no Sleep Stages section at all, which is
exactly the screenshot.

**This is why it is device-only, and why two surfaces disagreed.** `getLocalStore` returns null in
the web sandbox, so on `pnpm dev` the sheet only ever sees merged server rows and the bug is
invisible. On the APK the local seed paints first. The Body tab's card is fed through a path that
does merge — the "two surfaces, same date, different rows" the entry noticed.

**The `as unknown as SleepRow[]` double cast the entry flagged is the enabling mistake.** It does not
merely silence a shape mismatch; it silences the fact that a local row and a merged `SleepRow` are
*different things with different semantics*. A raw cluster and a night are not the same object, and
the cast makes them look like one.

## The shape of the fix

Run the local rows through the same `mergeByDate` before setting state. It is already exported from
`lib/sleep/merge-sessions.ts` and importable from client code, so **no Lane A change is needed** —
this is One Formula, One Place with the second caller simply missing. The entry is **re-laned to B**;
the only edit is in `app/health/health-content.tsx`.

⚠ Sibling sweep, not a one-liner in spirit: the other consumers of `/api/sleep-sessions` —
`session-select-content.tsx` (3 sites) and `health/sleep/sleep-content.tsx` (2 sites) — want checking
for the same local-seed shape.

## The general lesson

The offline-first rule says a domain that writes locally must read locally. What this shows is the
half that rule does not state: **when a read path moves to the local store, any transformation the
server applied on the way out has to move with it.** The merge lived in the route, so the local path
silently lost it — and gained a cast that made the loss invisible.

## Not verified

The device. Everything above is read from source and from production rows through `claude_ro` (which
is row-scoped to the owner). That the sheet renders correctly once merged is BF-115's own device
check, unchanged. No code changed in this PR.
