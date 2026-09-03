# 2026-09-03 — the Colmi decoder moves to the server (PS-21 Stage A)

**Branch:** `feat/colmi-server-side-decode` · **Version:** 1.436.4 · **Migrations:** 263, 264

## What shipped

The ring's frames are now decoded on the server. `syncColmiRing` posts hex and nothing else;
`/api/colmi/samples` runs the decoders over the same bytes it archives.

`framesToPayload` moved out of `ble.ts` into `lib/colmi-ble/frames-to-payload.ts`, which imports no
Bluetooth and touches no DOM. That is the whole enabling change — the function is identical either
side, only its caller moved. `ble.ts` no longer calls it at all: the counts the pairing card shows
come back from the response, so they are what was written rather than what the phone hoped.

This is Stage A of the plan merged earlier today (#833). It buys the thing the plan was written to
argue for: a decoder fix reaches data already collected. Three of this week's defects needed exactly
that, and each needed a current app first.

## Two things the plan had not anticipated

**Arrival order was not being recorded, and the heart-rate log needs it.** Every frame of a sync is
written in one insert, so `received_at` and `created_at` are the transaction clock and identical
across all of them — measured on the 2026-09-02 21:12 sync: 31 frames, one distinct timestamp. Read
back, the log comes out shuffled. It matters because the log is one series whose start time is named
once, in packet 1, and `framesToPayload` carries that anchor forward. A reversed replay of that real
sync keeps **9 of 175** heart-rate samples: the nine the anchor packet carries itself, and nothing
else.

Migration 263 adds `seq`, the frame's index in the request that carried it, so frames stored from
now on have a total order. Frames stored before it have seq 0 and cannot be given one — no backfill
can invent an order that was never recorded. For those, `sortFramesForReplay()` reorders the
heart-rate packets by the packet number they carry in their own bytes, which restores the sequence
without inventing anything. It declines when a sync holds more than one day's log, because a
continuation packet does not say which run it belongs to and interleaving two days would be worse
than not trying.

**The sleep bounds only ever guarded one path.** `stage` 0–255 and `minutes` 1–1440 were Zod rules
on the posted body, which a server-decoded segment never meets. They are restated at the write,
where both paths converge. This is the same class as migration 260's junk tail, one decoder away.

## How equivalence was proved

Not by reasoning about it. The 31 frames of a real sync were posted twice against the local dev
database — once as bytes (server decode) and once as decoded readings (the old client shape) — under
two different users:

| | received | accepted | stored |
|---|---|---|---|
| server decode | 209 | 167 | 167 |
| client decode | 209 | 167 | 167 |

The stored rows were then compared field by field: **166 rows, identical** (excluding the battery
reading, which is stamped with the wall clock rather than read from the frame, so it differs by
milliseconds between two runs by construction).

## What this turned up: PS-22

Of the 209 readings that sync decodes, **41 are discarded as future-dated** and one calories bucket
is out of range. The sync ran at 07:12 Brisbane; the log arrived as packets 1–7 and then 20–23, and
packets 20–23 map to 20:15 onwards — a time that had not happened. Their contents are plausible BPM
(71, 97, 85, 85, 79, 75, 72, 110, 100, 117), not padding.

**This is not a Stage A regression** — the client path produced the identical 209/167 split. What
changed is that the response now reports `received` beside `accepted`, which is what made it
visible. Why it happens is **not** established, and the obvious reading (a fixed 288-slot day array
still holding yesterday's tail) is a hypothesis from timestamps. This integration has had four
diagnoses made from counts, of which three were wrong, so PS-22 says to answer it from the archived
bytes instead.

## Not verified

Server decode ran against the local dev database only. **The route has not been exercised on the
device**, and the pairing card's counts now come from a response field that did not exist before —
if the deploy and the WebView disagree for a moment, `decodedBy` reports which side read the bytes,
which is why it is on the response. The first real sync is the check.

Stages B and C (the Kotlin transport service and its cadence) are untouched and still need an APK.
