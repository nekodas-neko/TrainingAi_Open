# 2026-08-27 — the Colmi heart-rate log was arriving all along

Branch `fix/colmi-heart-rate-continuations` · closes **PS-13**

## What the diagnostics panel found, and what it corrected

Yesterday's fix gave the `0x15` heart-rate request the day it was asking for, on the theory that a
malformed command was being answered with silence. The next sync still produced **zero** heart-rate
rows, which read as the fix having failed.

The frame tally says otherwise: **`0x15×26`**. The request worked. Twenty-six packets of heart rate
came back and none of them reached the database.

`framesToPayload` kept only sub-type 1 — the one packet carrying a unix anchor — and dropped
sub-types 2+ for lack of a clock to place them against. That was the deliberate choice PS-13
recorded, and on its own it would have cost 24 of 26 packets. What made it total is the second half:
**the 9 samples sub-type 1 does carry are the first 45 minutes after local midnight.** The ring
records nothing there, so they came back as zeros, the `bpm > 0` guard filtered every one, and a
sync pulling a full day of heart rate reported nothing at all.

Two independent reasons for the same symptom, which is why reading the request shape alone never
found it.

## The mapping

Sub-type 0 is a header naming `packetTotal` and `intervalMinutes`. Sub-type 1 carries the start time
and 9 samples. Every packet after it carries 13 that continue the same series, so sample index is
`9 + (subType - 2) × 13`, spaced by the header's interval — **not** the hardcoded 300 seconds the
old code used, which was right only because auto-HR happens to be set to 5 minutes.

A continuation arriving with no anchor is still dropped rather than placed by guess.

## Two smaller things in the same diff

**Forget now asks first.** It sat beside Sync now, the button pressed on every visit, and undoing a
mis-tap means having the ring in hand and Bluetooth in range. The owner hit it by accident, which is
the report that earned this.

**The sync panel stopped calling understood frames unreadable.** Two of the six "not understood"
frames were `43 ff` — the ring's "no more activity history" sentinel, which decodes to `unknown`
because it carries no sample. Counting an answer as a failure is the opposite of what the panel is
for.

## Verified, and not

Verified: 4 new unit tests over the packet mapping (anchor placement, header-declared interval,
anchorless continuation, all-zero anchor), 64 Colmi tests green, `pnpm check:rules` 61 of 61.

**Not verified: any of it against the ring.** The mapping is derived from a real 26-packet capture
described by its frame tally, not from decoded bytes — the panel displays unmapped hex but does not
store it, so the packets themselves were never available here. The next sync is the test, and the
number to look at is whether heart-rate rows span the waking day rather than clustering.
