# Q-2 second correction — `open_oura` says there are no temperature "channels" at all

Docs-only, and the second rewrite of the same finding. The owner supplied the authoritative answers
from `open_oura` (`crates/oura-protocol/src/events.rs` — the `0x46 | 0x69 | 0x75` arm of
`decode_body`, plus `decode_temperatures`) to the five protocol questions raised earlier today. They
invalidate the model that **both** the original finding and this morning's correction were built on.

## What the source actually says

1. **There are no fields.** All three tags share **one** decoder that reads the body as a **flat,
   variable-length little-endian i16 array of centi-°C**, divides by 100, and gates to −40…85 °C
   (out of range ⇒ the whole event decodes to `None`). That is the entire scaling contract — no
   `field0`/`field1`/`field2`, no skin/ambient/reference split, no per-field quantisation rule.
2. **The decoder in this repo is already correct** against it. `lib/oura-ble/decode.ts`'s
   `decodeTemperatures` matches exactly. No decoder change is warranted, and every remedy that
   proposed naming or splitting fields is off the table.
3. **The "7 probes" comment belongs to `0x46`, not `0x75`.** The first correction argued for `0x75`
   partly because its 7-value body "is the shape the median-7 stage expects" — that reasoning was
   wrong. `0x75` has no fixed length in the source. Production `0x46` bodies are always **3**, never
   7, so the probe count is firmware-specific and must not be hardcoded either way.
4. **One question is genuinely unanswerable here.** `nightly_temperature_calculate @ 0x203520` is an
   address in the *Oura app binary*, not in the BLE protocol; `open_oura` covers only
   tag → bytes → JSON. Which decoded stream the app's nightly routine reads needs the binary.

## What survives — and it is the whole bug

If a body is a vector of probes read at one instant, the values inside a frame are **simultaneous**.
The rollup pushes them into `nightlyTemperatureCentiC` — a **temporal** median-7 → 30-sample-window →
`min(window maxima)` pipeline — as consecutive samples, across three tags at once. For one real
night, 631 frames become 2,398 "samples" on 631 real timestamps. The defect was never in the decode;
it is entirely the rollup's assumption that one frame is one point in time.

## The obvious fix doesn't work, and that is worth recording

Collapsing each frame to a single value before the temporal filter is the structurally correct move,
and still produces a whole degree:

| series | nightly value |
|---|---|
| flatten every probe (**ships today**) | 36.00 °C |
| per-frame **median**, all tags | 37.00 °C |
| per-frame mean / max, all tags | 36.90 / 38.02 °C |
| per-frame median, `0x46` only | 37.00 °C |
| per-frame median, `0x75` only | **35.91 °C** |

`0x46` frames hold three values with `f0 ≤ f1 ≤ f2` in 99.86% of 30,135 rows and the middle one on an
exact 0.5 °C grid in 98.3% — so the median of a 3-probe frame **is** the quantised probe. Any
median-based collapse inherits the quantisation from `0x46`.

The remedy therefore stays "use `0x75` alone", but restated as an **empirical** choice — it is the
only variant tested that yields a non-quantised result — rather than one the protocol justifies.

## Why this is filed rather than quietly edited

Two wrong mechanisms shipped into the queue in one day, both plausible, both built from measurement
without the source. The backlog entry is rewritten in place because it is an instruction; the review
doc keeps both narratives with correction blocks appended, because it is a record of how the wrong
model survived two rounds of data. The lesson is the one already in `CLAUDE.md` — verify against the
pinned source *before* modelling, not after the data suggests a shape.
