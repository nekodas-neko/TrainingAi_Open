# 2026-08-27 — show what the ingest kept, not just what it stored

Branch `fix/colmi-show-accepted` · diagnostic only

## What the packet tally settled, and what it did not

v1.390.2 added a per-sub-type tally to the sync panel. The 2026-08-27 18:50 sync read:

```
s0:1p/0s s1:1p/0s … s7:1p/3s s8:1p/7s s9:1p/13s … s18:1p/9s s19:1p/0s … s255:2p/0s
```

**Every sub-type carries exactly one packet.** The packets are numbered, the placement arithmetic
that spaces them by `9 + (subType - 2) × 13` is right, and the theory that the byte repeats — the
one this tally was built to test — is **wrong**.

The decoder was then run against a reconstruction of that exact packet set. It produces **132
samples at 132 distinct timestamps, 06:10 to 18:45**. Nothing collides and nothing is dropped in
mapping.

The database holds **17** heart-rate rows, all from 16:50 onward.

## Why a third number was needed

`/api/colmi/samples` already computes `accepted` — what survives its per-sample window and range
filters — and returns it beside `stored`. The card showed `read` and `stored` only, and those two
cannot distinguish:

- **the filters rejected them** (`accepted` far below `read`) — the ring stores a value in slots it
  could not measure, and anything under `MIN_PLAUSIBLE_BPM` of 20 is discarded on the way in; or
- **the unique key deduped them** (`accepted` high, `stored` low) — the samples landed on
  timestamps that already existed.

The first is the system working. The second is a bug. One number separates them and it was already
being sent.

## The pattern this is the fourth instance of

Four diagnoses of this bug have now been made by reasoning about counts rather than reading a value,
and **three were wrong**: the request shape was blamed first, then a stale CI base, then packet
numbering. Each was plausible, each fitted the evidence available, and each cost a release cycle.

The reproduction that settled the decoder took four minutes and should have come first. Recorded
here because the lesson is not about this protocol.
