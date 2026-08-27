# 2026-08-27 — the heart-rate log was ten hours late, and the archive found it in minutes

Branch `fix/colmi-hr-anchor-timezone` · migration 237 (corrective delete)

## What it was

`cmdSyncHeartRate` sends the day's local midnight **expressed as though it were UTC** — the ring
wants wall-clock seconds, not an epoch, and the command's own comment says so. The ring **echoes
that number back** in packet 1, and `framesToPayload` read the echo as a genuine epoch.

So every heart-rate sample was stored late by the size of the timezone offset. Ten hours in
Brisbane: a log the ring recorded **06:50–20:50** was filed as **16:50 through 06:50 the next
morning**.

Two consequences, and the second is the one that misled a whole afternoon:

- **119 of 157 samples per sync landed in the future** and were rejected by the ingest's 60-second
  future tolerance. What survived was not a sample of the day but a biased fifth of it.
- **The survivors were morning readings wearing evening timestamps.** Compared against the Oura at
  the same wall-clock minute they read **+15.6 bpm with r = 0.37**, and that was written up as a
  sensor difference — the ring being noisy and reading high. It was this bug. Morning activity was
  being compared against evening rest.

## How it was found

`colmi_raw_frames` shipped in v1.392.0 at 20:45. The owner synced at 20:52. The frames were queried
at 20:55 and the anchor read `1787788800` — `2026-08-27T00:00:00Z`, which is 10:00 Brisbane, exactly
ten hours off local midnight.

Four earlier diagnoses were made by reasoning about row counts and three were wrong: the request
shape, a stale CI base, then packet numbering. This one took three minutes and needed no theory at
all, because the bytes were there to read.

## The fix

`wallClockSecondsToEpochMs(wallSeconds, tz)` reads the echoed number as the wall clock it is and
places it in the user's zone. Every sample derives from that instant.

`hr-anchor-real-capture.test.ts` replays the **actual 20:52 packet set** and asserts the log spans
06:50–20:50 — ending two minutes before the sync that fetched it, which is the property the ten-hour
shift broke.

## The destructive half

Migration 237 deletes `colmi_readings WHERE kind = 'heart_rate'`. Those rows are wrong in a way that
is worse than missing: biased in coverage and mislabelled in time, and they already produced one
false finding. They are re-derivable — the ring holds the day, re-syncs are free, and from today the
frames are archived. Only `heart_rate` is touched; every other kind is placed by a different path.

## Verified, and not

Verified: 68 Colmi tests including the real-capture replay, `pnpm check:rules` 61 of 61, migration
applies locally.

**Not verified: a sync after the fix.** The correction is proven against captured bytes, not against
the ring. The check is one sync showing heart rate across the waking day rather than a 50-minute
band, and `kept` close to `read` rather than half of it.
