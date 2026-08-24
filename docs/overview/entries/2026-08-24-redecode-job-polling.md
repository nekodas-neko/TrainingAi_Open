# The two BLE consoles poll the redecode job instead of guessing at its outcome (Q-318)

**Branch:** `fix/redecode-job-polling` · **Lane B** · v1.363.1

## What shipped

`components/oura-ble/redecode-job.ts` — a small client helper that POSTs
`/api/oura-ble/samples/redecode?async=1`, then polls `GET …?jobId=…` on a 3-second timer until the
server reports `done` or `failed`, and hands back the same phases payload the synchronous route used
to return. Both callers now use it:

- **`oura-ble-debug.tsx`** — the Redecode button. Its old defensive parse ("body may come back
  empty/truncated") is gone; there is nothing to parse defensively any more.
- **`step-backfill-console.tsx`** — "Run backfill now".

## What was actually wrong

Neither console could tell a finished run from a started one. The synchronous route outlives the
gateway timeout on real data, so Railway returns **502 for work that completed** — the debug console
printed `redecode failed: 502`, and a false failure invites a retry, which is another full-history
re-aggregate (the operation Q-535 names as the event-loop starvation that took production down on
2026-08-13). The backfill console had the mirror-image bug: it printed **"Done. Backfill applied"**
the moment the request returned, which is the timeout, not the write.

`alreadyRunning: true` now says so in words — *"a redecode (job N) was already running — this
started nothing; following that run"* — rather than showing progress for a press that started
nothing. There is no client-side poll timeout: the server's staleness reaper turns an abandoned run
into `failed`, so the loop always ends on a status the server stands behind.

The backfill console also surfaces `redecodeError`, which it previously ignored — it only read
`aggregateError`, so a decode-phase failure read as "Done".

## Verification

Drove all three branches end to end against `pnpm dev` + the local Postgres, through the real route,
as an admin user:

- **done** — `redecode job 1 started — this can take minutes` → `DONE job=1 scanned=0 sleep=0`, the
  phases payload arriving from the poll rather than the POST.
- **alreadyRunning** — with a `running` row already in `oura_redecode_jobs`, the press reported
  `job 2 was already running … following that run` and started no second job.
- **failed** — finishing that job with an error mid-poll produced `FAILED: boom from the worker`.

`tsc --noEmit` clean · `eslint` zero new warnings · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**`step-backfill-console.tsx`'s run path was not driven at runtime.** The page renders and Preview
works (`0 day(s) would change` against the local seed), but with no affected days the "Run backfill
now" button never appears — reaching it needs seeded `oura_raw_samples` plus inflated historical
step days. Its call is a direct substitution onto the helper proven above, and it typechecks; that
is the evidence, and it is weaker than the debug console's.

**`oura-ble-debug.tsx`'s Redecode button is not reachable in the web sandbox at all** —
`OuraBleDebug` returns the native-unavailable banner and nothing after it whenever the plugin is
absent (the same gate BF-10 documented). The helper it calls was verified through an equivalent
mount; the button itself is owed an on-device check in the APK.

Nothing checked on the S25.

## What is left

**The route's default is still synchronous, and that is Lane A's half.** Q-318's last bullet — drop
`?async=1` and delete the synchronous branch — edits `app/api/oura-ble/samples/redecode/route.ts`.
Both callers now poll, so the seam that kept the default alive is gone; the entry records it as the
remaining step.
