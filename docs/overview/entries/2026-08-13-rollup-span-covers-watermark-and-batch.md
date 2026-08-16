# 2026-08-13 — a restart could strand a batch unrolled (v1.303.3)

**Branch:** `fix/rollup-span-covers-watermark-and-batch`

## Found by watching production, not by reading code

The watermark fix (v1.303.2) deployed at 15:44 Brisbane. The ring synced at 15:47 and seeded the
watermark. The pass cost **2 minutes at 0.815 CPU / 0.553 GB** — but the watermark table was *empty*
at that moment, so it should have been a full-window pass, and the equivalent pass three hours
earlier cost **6 minutes at 1.8 CPU / 2.19 GB**.

That discrepancy is what surfaced the bug. The run was not full-window: it narrowed, because
`pendingSinceDs` already held the incoming batch's span and the resolver read

```ts
const effectiveSinceDs = opts?.sinceDs ?? persistedSinceDs
```

— the caller's span **instead of**, not as well as, the watermark.

## Why that is wrong

Removing `fullWindowDone` in v1.303.2 meant every run now passes a `sinceDs` whenever a batch is in
flight. So the watermark, which exists precisely to cover what an earlier process left unrolled, was
being ignored in exactly the case it was built for.

The failure is concrete: a batch lands, the container restarts before its rollup runs, and the next
batch carries only recent data. Everything between the watermark and that batch is outside both
spans, and no later run ever reaches back for it — the watermark advances past it on the next
success. The raw rows stay safe in `oura_raw_samples`, but the derived sleep/HR/steps for that gap
never appear until a manual redecode.

`Math.min` of the two spans is the fix. Normally the watermark is older and wins; the caller's span
wins only when a batch back-fills data older than the watermark. Either way the minimum is the safe
floor.

## Verified

Eight DB-backed tests in the `rollup` project; the new one reproduces the restart directly — set the
watermark back at the older night, wipe that night's HR rows, then run with a span covering only the
recent night. The older night must be rebuilt, because the watermark reaches past it.

**Mutation-tested:** restoring `opts?.sinceDs ?? persistedSinceDs` — the code that is live in
production right now — fails that test and only that test.

Full suite green — 460 files, 3,791 tests. `tsc --noEmit` clean, all 20 custom-rule checks pass.

## What the same telemetry confirmed about Q-213

Worth recording, because it is the first real production evidence for the whole line of work:

| | duration | CPU | memory |
|---|---|---|---|
| before Stage 1 | 15–30 min | 1.0–1.8 | 0.9–2.2 GB |
| cold-start pass, Stage 1 only (14:45) | 6 min | 1.8 | 2.19 GB |
| seeding pass, with watermark (15:47) | **2 min** | **0.815** | **0.553 GB** |

And the watermark row is populated: `last_rolled_ds = 33595063, epoch = 2`.

## The gap this does NOT close

At 15:47:33 a concurrent ingest returned **500** after 27.6 s —
`getNewestOuraClockAnchorByUtc` failing with `Connection terminated due to connection timeout` while
the seeding rollup held the thread. A non-2xx on `/api/oura-ble/samples` holds the ring's history
cursor and triggers a re-drain, which is the storm mechanism the route's own comment warns about.

**No amount of narrowing removes that.** A rollup that runs on the request thread can always starve a
request that lands beside it; narrowing only shortens the window in which it can happen. That is
exactly what **Q-213 Stage 2** (moving the run into a `worker_thread`) is for, and this is the first
hard evidence that Stage 2 is necessary rather than merely tidy.

## Not exercised

- **The S25 and the real ring** — the BLE plugin does not run in the sandbox.
- **Production data** — tests run against a seeded table ~40× smaller than production's 986,959 rows.
- Server-side only; reaches the device through Railway with no APK rebuild.
