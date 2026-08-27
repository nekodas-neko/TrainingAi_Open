# 2026-08-27 — keep the ring's bytes, because the readings have been wrong

Branch `feat/colmi-raw-frames` · migrations 235, 236

## The number that forced this

v1.390.3 surfaced what the ingest route keeps, and the 19:27 sync read:

```
Read 240 samples, kept 121, stored 17 new
```

240 produced, **121 survived the filters**. Of the 140 heart-rate samples in that payload, **21
passed and 119 were rejected** as outside 20–250 bpm — 85% of a day's heart rate, discarded at the
door, with nothing recording what the values were.

That makes the open question unanswerable rather than merely unanswered. Whether those are sensor
noise, a wrong byte offset, or an encoding that isn't beats-per-minute cannot be decided without the
bytes, and every day spent deciding is a day of history that no later fix can recover.

## What it adds

`colmi_raw_frames` — user, receive time, channel, tag, hex — written **unfiltered and
unconditionally** beside the decoded readings, in the same request so a frame and the samples read
out of it cannot diverge. Deduped on `(user_id, channel, hex)`, since a re-sync re-sends history
verbatim.

This is the Oura pipeline's own rule, applied where it was missing. `oura_raw_samples.body_hex` is
the archival source of truth precisely because a decoder added later can only back-fill by
re-decoding stored bytes. The Colmi pipeline shipped without an equivalent.

Size is not a concern: ~66 frames per sync at ~40 bytes of hex is under 3 KB, so ten syncs a day is
~30 KB. `oura_raw_samples` reached 563 MB holding 20 Hz sample streams; this holds sync-time frames.

## Why it is worth its own release rather than riding a fix

Four diagnoses of the heart-rate loss were made in one day and three were wrong — the request shape,
a stale CI base, then packet numbering. Each was inference from counts, because counts were all
there was. The reproduction that finally exonerated the decoder took four minutes and needed only
the packet structure; the remaining question needs the values themselves.

The archive is what stops a fifth round. It is also what lets a week of recording start now instead
of after the answer, which was the actual constraint the owner was working against.

## Verified, and not

Verified: migrations apply locally, 830 DB-backed tests pass, 5,165 unit tests pass,
`pnpm check:rules` 61 of 61, `claude_ro` regenerated to 90 views with the new table scoped by
`user_id`.

**Not verified: a real sync.** No frame has been written by the ring — the write path is exercised
by tests and by nothing else. The first sync after deploy is the check, and the signal is
`stored.frames` coming back non-zero.
