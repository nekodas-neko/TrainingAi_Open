# 2026-09-10 — closing Q-10, whose remaining suggestion would reintroduce the bug it exists to fix

**PR:** `lane-a/q10-close-dead-residue` · **Lane A** · docs only, nothing implemented.

Q-10's live symptom shipped on 2026-08-02: `groupSleepPeriods` drops zero-duration windows before
classifying, so a degenerate row can no longer become the most recent night and null out
`previousNight`. What remained was described as a nice-to-have — *"persisting Oura's session `type` /
the ring's bedtime-period tag."*

Both halves are dead, and the second is the interesting one.

## Half one has no source

The Oura Cloud integration was removed on 2026-08-13 and must never be re-added. Nothing supplies a
session `type` any more, so that half cannot be built at all.

## Half two would persist the defect

`bedtime_period` (0x76) is not the nightly window the entry assumed. Measured on-device on
**2026-07-09** and recorded in `lib/oura-ble/rollup/run.ts`: on this Ring 5 the captured events are
**~0.5 h sub-period fragments** (e.g. 01:23–01:53), not the full night. The comment there says
treating them as sleep windows *"produced tiny or duplicate sleep rows and blew displayed end times
into the afternoon"* — which is *degenerate sleep rows*, the title of this entry. The rollup ignores
any bedtime window under three hours for exactly that reason.

**So the residue is not low-value work; it is a proposal to persist the defect.** Q-10 is closed and
moved to the resolved archive rather than left in the queue as a nice-to-have someone eventually
picks up on a quiet evening.

## What made it findable

The measurement that kills it (2026-07-09) **predates** the note that left the residue (2026-08-02).
The information was in the repository, in a comment, a month before the entry was written — nobody
connected the tag named in the backlog to the tag measured in the decoder. Reading the entry gives no
hint; only opening the decoder does.

That is the sixth entry today whose factual claims did not survive contact with the code, and it fits
the pattern exactly: **every one was found by working the entry, not by reading it.** A documentation
sweep would have read this residue as a reasonable small feature.

**Not exercised:** no code changed. The `bedtime_period` finding is quoted from the rollup's own
source comment and its `MIN_BEDTIME_DS` guard, not re-measured — re-measuring needs the ring.
