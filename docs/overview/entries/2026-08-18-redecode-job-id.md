# 2026-08-18 — the redecode returns a job id (Q-535, Lane A half)

**Lane A** · branch `fix/redecode-job-id` · migrations **196** + **197** · no Kotlin, no APK.

`POST /api/oura-ble/samples/redecode` awaited the heaviest pair of calls in the app, exceeded the
gateway timeout, and Railway returned **502** — so the tester printed `redecode failed` for work that
had in fact completed. Measured 2026-08-17: `scanned=1098158`, `updated=0`, and every
`sleep_sessions` row stamped `07:58:44`, *after* the request had already 502'd. The aggregate the UI
reported as failed produced the night the owner was trying to see.

Not cosmetic. A false failure invites a retry, and a retry is another full-history pass of the
operation whose own comment names it as *"the event-loop starvation that took production down on
2026-08-13"*. The UI was actively encouraging the thing most likely to hurt.

## Premise re-verified, and half of it had expired

The route still `await`ed the work — confirmed in source before building. But **the row-walking phase
is now a no-op**: Q-541 Task 7 (this morning) made `measured_at` and `event_name` derived, so the
redecode had nothing left to correct. The `scanned=1098158` full-table walk is gone; what remains is
the full-history **re-aggregate**, which still rebuilds every daily summary and still outlasts the
gateway. The entry's numbers are historical and it now says so.

## What shipped

`?async=1` returns `{ jobId, status: 'running', startedAt, alreadyRunning }` immediately;
`GET ?jobId=…` (or no id for the most recent) polls it.

- **`status` is derived, never stored.** A row is running until it has a `finished_at`, and what kind
  of finish it was depends on whether the run threw (`error`) or a phase reported one inside
  `result`. Nothing can disagree with the timestamps because there is no second field to disagree.
- **One in-flight job per user**, on a partial unique index. The 4/min rate limit does not stop two
  overlapping runs, and two concurrent full-history re-aggregates are precisely the load this exists
  to prevent. A second press returns the running job and says `alreadyRunning: true`.
- **A staleness reaper**, because a process that died mid-run would otherwise hold that slot forever
  and refuse every future redecode — a worse and quieter failure than the 502. Reaped on read rather
  than by a sweeper: there is no cron layer in this app, and the only reader that matters is the one
  asking whether it may start another.
- **State in a table, not process memory**, so a restart cannot silently lose a job — that would be
  the same false negative in a different disguise.
- The completion handler's `.catch` is exhaustive: a throw that never reached the job row would leave
  it running until the reaper, which is a worse report than an error.

## The lane seam, and why the default did not flip

⚠️ **`?async=1` is opt-in. The 502 is not gone yet.**

Both current callers read the synchronous shape and report completion from it. Flipped blind,
`oura-ble-debug.tsx` falls back to *"redecode ran (response was slow to return) — data refreshed"*,
and `step-backfill-console.tsx` says *"Done. Backfill applied — re-run preview to confirm 0 days
remain."* — for a backfill that has only begun. **That is a quieter and more misleading failure than
the 502 it replaces**, so the default was left alone rather than crossing into `components/**`, which
is the other lane's.

**Q-318** carries the other half: the poller, and the default flip. Its entry states the full
response contract so Lane B does not have to read the route to build against it.

## Verification

- **9 DB-backed tests**: start → read → finish with the phases verbatim; never two in flight; the
  next run allowed once the first finishes; a throw recorded as `error` not `result`; finishing twice
  not overwriting the first result; the reaper closing an abandoned job *and freeing the slot*; a
  merely-slow job not reaped; per-user scoping of both the job and the slot; latest-by-start.
- **Mutation-checked**: removing the already-running short-circuit turns the concurrency test red.
- **Live on `pnpm dev`**: `GET` with no jobs → `{job:null}`; a non-numeric `jobId` → 400;
  `POST ?async=1` → immediate job id; a second press with one genuinely in flight →
  `alreadyRunning: true` with the same id; `GET` → `status: done` with the full phases payload; a job
  aged past the window → `status: failed` with the "abandoned" reason; and **the synchronous default
  byte-for-byte unchanged**.
- Full suite **492 files / 4,010 tests passed** · `tsc --noEmit` clean · `pnpm check:rules` 38 of 38.

## Failure surfaces NOT exercised

- **The 502 itself.** The local dev database has no raw samples for the seed user, so the run
  finishes in milliseconds — the timeout this exists to escape cannot be reproduced here. What is
  proven is the response shape and the lifecycle, not that a minutes-long run survives.
- **A real process death mid-run.** The reaper is tested by ageing `started_at`, not by killing a
  worker.
- **No UI** — filed as Q-318, and until it lands the 502 remains for anyone pressing the buttons.
- No device, no Kotlin, no APK.
