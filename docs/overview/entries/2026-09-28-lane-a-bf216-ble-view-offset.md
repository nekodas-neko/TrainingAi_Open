# 2026-09-28 — BF-216: the device pipelines read BLE notifications through the view

The Colmi V1 frame, the Colmi V2 big-data chunk and the chest strap's live heart-rate measurement
each built a `Uint8Array` from `view.buffer`. That ignores the `DataView`'s offset and length, so it
reads correctly only while the BLE plugin hands over a view that starts at zero, which it does
today. All three now read `new Uint8Array(v.buffer, v.byteOffset, v.byteLength)`. Lane B's pairing
screen was fixed earlier the same day.

`bf216-ble-view-offset.test.ts` was holding the three sites as named Lane A debt. It now asserts the
view-scoped form in both files. Reverting one site fails it; this was checked by reverting the
strap read.

Not exercised: a real notification on the device. The bytes are identical while the plugin's
offset stays 0, which is the current behaviour, so nothing on the device changes.
