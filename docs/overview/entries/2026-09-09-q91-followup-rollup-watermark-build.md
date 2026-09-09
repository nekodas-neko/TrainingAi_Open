# 2026-09-09 — the drain signal was firing before the rollup ran (Q-91-followup, built)

**PR:** `lane-a/q91-followup-rollup-watermark-signal` · **Lane A** · PR 2 of the two-PR split
(#1050 was the design). **Not device-verified** — Known-Issues row filed.

## I got the premise wrong in #1050, and the truth is worse

The design PR I merged an hour earlier said the ordinary (non-manual) drain flow emits no client
invalidation at all. **It does.** `components/sync-provider.tsx` has watched the native
`ouraStatus` event's `ingestStored` counter for a while, debounced 1500 ms, and fired
`invalidateOuraSync()` + `ta:oura-ble-synced`.

I had the evidence and misread it: that file showed up in my own grep for `ta:oura-ble-synced` as a
dispatch site, and I attributed it to the manual path without opening it. The backlog entry claimed
the same thing and had gone stale. **Agreeing with a stale entry is not verification** — the entry
and I were one source, not two.

**What it changes is that this was never a missing feature. It was a live bug, and a worse one.**
`ingestStored` advances the instant the server has *stored* rows — the same instant it schedules its
rollup on a **3-second** trailing-edge debounce. The listener waited **1500 ms**. Every autonomous
drain therefore invalidated *before the rollup had started*, and the refetch it triggered read
pre-rollup data and cached it for the TTL. The exact trap the design described as a thing to avoid
was already shipping on every background drain.

A stale cache is old data the next mount corrects. A cache refilled from a pre-rollup read looks
fresh, so nothing corrects it. The "fix" was producing the worse of the two failures.

## What shipped

- **`GET /api/oura-ble/rollup-state`** — exposes `oura_rollup_state`'s `last_rolled_ds`/`epoch`,
  which migration 184 has persisted all along and nothing could read over HTTP. Auth-gated,
  `private, no-store`, rate-limited like its polled siblings because it *is* polled. Not
  admin-gated: a rollup cursor is not user data.
- **`lib/oura-ble/rollup-wait.ts`** — `waitForRollup`, bounded backoff (~46 s ceiling), everything
  external injected so it runs in the sandbox where `getOuraBle()` returns null.
- **Both callers converge on it** — the background listener and manual `afterDrainSettles`, which
  had the same race and was masked by its longer poll. One mechanism, not two.

Two details that are easy to get backwards, both mutation-pinned: the baseline is captured when the
burst **starts**, not when the debounce settles (by then the rollup may already have run, and a
baseline read then would make the wait time out waiting for progress that had happened); and an
**epoch change short-circuits** to `re-keyed`, because the ring's deciseconds counter restarts from
zero on a re-key, so a numerically *smaller* watermark under a new epoch is progress.

A `timeout` is the ordinary end, not a failure: a drain carrying nothing the rollup changes never
moves the watermark.

## Verification

Eight mutants, all caught; the control (reordering two independent consts) survived as genuinely
equivalent and, unlike LB-64's, was a reorder rather than dead code, so there was nothing to delete.

**Not exercised — and this is the substantive gap.** The listener path is unreachable off-device, so
nothing here observes the behaviour being fixed. The route and the helper are unit-tested; the fix
is not. The Known-Issues row names the three device checks owed.
