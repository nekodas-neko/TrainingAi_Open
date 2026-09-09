# 2026-09-09 — the three backfill levers, and a jobId that polled the wrong job (PS-39, 13 → 10)

**Branch:** `test/oura-ble-backfill-routes` · **One product change**, in the redecode poll.

35 cases over `oura-ble/samples/redecode`, `oura-ble/samples/step-backfill-preview` and
`oura-ble/backfill-hr-stats`. All three re-derive stored data rather than draining the ring again,
which is only possible because `oura_raw_samples.body_hex` is the archival source of truth on the
server — the ring's history buffer is finite and its cursor only moves forward, so a decoder fixed
later back-fills by re-reading stored hex and no other way. None of these routes may mutate that hex,
and none does.

## `parseInt` was polling a job nobody asked about

`GET ?jobId=…` parsed the id with `Number.parseInt`, which **truncates and stops at the first
non-digit**. So `?jobId=1.5` polled job 1 and `?jobId=77abc` polled job 77, each answering 200 with a
job's real status — the same shape as a correct answer, which is the worst way to be wrong. The route
already had a branch whose stated intent was to refuse a malformed id; `parseInt` just did not
implement it.

Now `Number`, with the empty string excluded separately because `Number('')` is 0 and would poll job
0 rather than being refused. The only caller (`components/oura-ble/redecode-job.ts`) sends
`start.jobId` — a `number` straight from this route's own response — so nothing legitimate is
tightened out. A mutant restoring `parseInt` is caught.

## The property worth the most here

**A second `?async=1` request while one is running must not start another full-history pass.** That
pass re-decodes every stored sample and re-aggregates all history; its own comment names it as the
event-loop starvation that took production down on 2026-08-13, and the 502 the synchronous path
returns is exactly what invites a retry. The test asserts the response still carries the running
job's id — so the caller polls rather than re-fires — and that the worker is not invoked at all.

Around it, the job lifecycle: stale jobs are reaped on both the start and the poll (there is no cron
layer, so the reader asking whether it may start another is the only one who can do it); a run that
throws finishes the job row with an error rather than leaving it "running" and blocking the next
start; and `status` is derived from `finishedAt`, `error` and the two per-phase errors inside
`result` — **all three failure records**, because a phase error is precisely the failure that never
threw. A fixture exercising one proves nothing about the others, so each gets a case.

`?dump=1` is asserted to skip `fullHistory` entirely, which is the whole reason the mode exists: the
full path exceeds the gateway timeout on real data, and that is what killed the per-night diagnostic.

## Fixtures that had to disagree with themselves

- **The step preview** sums old and new counts separately. Both columns differ within each row *and*
  the two totals differ, because with equal values nothing distinguishes "sum the old" from "sum the
  new" — in a preview whose entire job is to show that the numbers change.
- **The HR backfill** reports `processed` and `withData`, and they must differ or neither is under
  test: one session computes to a zero-reading snapshot (persisted deliberately, so `computed_at`
  records the attempt) and another to 240 readings. A third case adds sessions that compute to
  `null`, so `processed` also differs from the batch length.
- **`remaining` comes from the batch being full, not from what was processed.** Reading it off
  `processed` would report "drained" whenever a batch contained skipped sessions — exactly when it
  is not. Both mutants are caught.
- The `since` window is derived from a pinned clock rather than hardcoded: a fixed date on one side
  of a rolling window is a time bomb with a known detonation date, which this repo has already paid
  for twice.

## Mutation pass

**30 of 30 caught**, no anchor misses; the thirty-first is an equivalent mutant planted as a control
and survived as designed.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · `tsc -p tsconfig.tests.json` clean for the new
file · **Custom Rules 70 of 70** · `pnpm build` clean · full suite green · route ratchet **13 → 10**.

**Not exercised:** the worker, the decoders and the aggregate all run behind stand-ins, so nothing
here says a decoded value is correct — only which options each phase is asked for. No SQL, no ring,
no device.
