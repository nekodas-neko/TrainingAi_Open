# BF-216 — read the view, not its buffer

**Branch:** `fix/ble-view-offset` · **Lane B** · `components/settings/**`.

`BleClient.read` resolves a `DataView`. `.buffer` is the whole backing `ArrayBuffer`, so it discards
`byteOffset` and `byteLength`: a view into a pooled or offset buffer hands back a byte belonging to
something else. The pairing screen stored that as a battery percentage, in the same store the Home
chip reads — so a wrong value there would have presented as BF-215's symptom with a different cause.

**Latent, not live.** `@capacitor-community/bluetooth-le` builds each `DataView` on a fresh buffer
today, so the offset is 0 and the old read happened to be right. That is a property of the plugin's
implementation rather than of the API contract, and one version bump from changing quietly.

## The entry named two sites; the same shape is on three more

| site | lane |
|---|---|
| `chest-strap-pairing.tsx` battery + firmware | **fixed here** |
| `lib/colmi-ble/ble.ts:180` — the V1 notification frame | Lane A |
| `lib/colmi-ble/ble.ts:190` — the V2 big-data chunk | Lane A |
| `lib/live-hr/chest-strap-source.ts:233` — **the live HR measurement** | Lane A |

All three take a `DataView` from the BLE plugin and read `.buffer`, so all three carry this defect.
They are **device pipelines**, which §3 of the agents contract puts in Lane A, so BF-216 is re-laned
to `A` with only those left. `ble.ts:215`'s write path is not in scope: it builds its own array
rather than receiving one, so it owns the buffer it reads.

The guard names those two files and **fails if one stops matching**, so fixing a site means striking
it from the list in the same commit — the reminder rather than a chore. An exemption that keeps debt
visible beats one that makes it look clean.

## The guard demonstrates the defect

Rather than asserting a style, it builds `new DataView(backing, 2, 1)` and shows the two reads
disagree: `.buffer` returns the filler byte, `getUint8(0)` returns the real one. Same for
`TextDecoder`, which honours a view and over-reads its buffer. A third case pins the behaviour the
fix had to preserve — `getUint8(0)` throws `RangeError` on a zero-length view where `[0] ?? null`
yielded null, which is why the read is guarded on `byteLength`.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors · full unit suite green · build clean.
**Control-run:** the scan half fails against `origin/main`; the three behavioural cases pass either
way, which is correct — they are about JavaScript's semantics, not this repo's source.

**Not exercised:** the device, and nothing visible changed. The value rendered today is identical by
construction, which is exactly why the sandbox cannot tell the two reads apart, and the path only
runs while pairing a real H10 over BLE. A Known-Issues row states the pass test.
