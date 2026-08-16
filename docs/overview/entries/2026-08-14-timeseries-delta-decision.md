# 2026-08-14 — deciding Q-180 instead of deleting it (keep, and say why in the code)

**Branch:** `claude/trainingai-backlog-v0abea` · **No version bump:** no behaviour changes.

Q-136 deleted `/api/sync/oura-timeseries` with owner approval, which removed the only caller of
`repo.getOuraTimeseriesDelta`. That left a keyset-cursor implementation, an adapter delegate, an
interface entry and **142 lines of passing DB-backed tests** with nothing reaching them. The entry
was filed as a decision deliberately left un-taken, with two defensible answers.

## The question, answered from measurement

The entry named the deciding question exactly: *is the device ever going to restore intraday HR from
the cloud?*

Three facts settle it, none of them a preference:

1. **`ouraHeartrate` appears nowhere in `SyncDelta`.** Grepped: zero occurrences. So intraday HR
   reaches a fresh device by no other path — and `restoreFromCloud` says so in its own doc comment,
   that the Track-B timeseries "are NOT restored here and have no driver".
2. **The server is the archive.** The owner's 2026-08-02 retention decision makes the device-local
   raw store a **14-day rolling window** — raw frames are input to the on-device rollup, not an
   archive. So a re-install or a new phone loses intraday history that still exists server-side.
3. It costs nothing at runtime, and the stated direction is multi-device.

**Keep.** Deleting ~350 lines of correct, tested work to close an audit line would throw away the DB
half of a restore the architecture still implies.

## What actually got fixed

The entry was honest about the real cost: *"It costs nothing at runtime; it costs a paragraph in
every dead-code audit."* That is the thing to fix, and it is not the code.

`getOuraTimeseriesDelta` and its test file now carry the decision and the evidence for it, so the
next sweep reads the answer rather than re-deriving the question — which is what a third sweep would
otherwise do, since the first two both stopped at "no callers" and filed it.

No behaviour changed. The five tests still pass.

## Note on how this was decided

Both answers in the entry were defensible, and a coin-flip dressed as judgement would have been
worse than leaving it open. What made it decidable was checking `SyncDelta` for `ouraHeartrate`
rather than reasoning about intent: an absent field is a fact about what the app can do today, and it
turned a product question into an observation.
