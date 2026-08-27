# 2026-08-27 — say how the ring numbers its heart-rate packets

Branch `diag/colmi-hr-subtypes` · diagnostic only, no data path changed

## Why

v1.390.1 made heart rate arrive. It arrives at exactly the right 5-minute boundaries with plausible
values, so the request and the placement are both right — and the sync card reads **"Read 204
samples, stored 8 new"** against 82 the sync before. Roughly 122 heart-rate samples were produced
and **7** reached the database.

Readings are keyed `(kind, measured_at)`, so a sample landing on a timestamp that already exists is
discarded. 122 collapsing to 7 means the packets are being placed on top of each other, and there is
one assumption that would do it: `framesToPayload` reads the sub-type byte as a packet **number**
and spaces the series by `9 + (subType - 2) × 13`. If this firmware repeats that byte rather than
counting up, every packet lands in the same 13 slots. Seven readings inside a single 50-minute band,
from a ring holding a full day, is what that looks like from the database.

## What this adds

`diagnostics.hrSubTypes` — packets and non-zero samples per sub-type byte — rendered in Sync detail
as `s0:1p/0s  s1:1p/2s  s2:9p/117s` or similar. Numbered packets give one packet per sub-type; a
repeated byte gives one sub-type carrying nine.

Nothing in the write path changed.

## The reason this is a screen and not a query

The panel still does not persist. Three diagnoses of this bug have now been made by reasoning about
row counts rather than bytes, and **two of the three were wrong** — first that the request shape was
malformed, then that a stale base explained a CI failure on the same day. The tally is the smallest
thing that replaces inference with a reading, and it costs one screenshot.

Storing frames server-side is the real answer and is not this change.
