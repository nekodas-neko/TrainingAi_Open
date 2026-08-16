# Q-2 correction — the nightly-temperature finding named the wrong mechanism

Docs-only. Corrects an audit finding that would have sent the implementer session into the wrong
decoder, in `docs/implementation-backlog.md`, `docs/reviews/2026-07-27-prod-data-audit-2-derived-metrics.md`
and the `projectOverview.md` Known-Issues row.

## What was wrong

Q-2 was raised from a **40-frame sample of one tag** and described as "`temp_event` carries three
interleaved channels; the median-7 lands on the coarse middle one". Re-checked against all 30,135
`0x46` rows and by re-running the real shipped code:

- The series is a mix of **three** tags with **three different body shapes** — `0x46 temp_event`
  (30,135 rows, always 3 int16), `0x69 temp_period` (607, always 1), `0x75 sleep_temp_event`
  (3,305, 7 in 96.4%) — all decoded by the same `decodeTemperatures` and all concatenated into one
  array by `adapter.ts:4861-4869`. The "one ordered series" assumption is violated three ways, not one.
- "Lands on the middle channel" was **not demonstrated**. `0x46` alone returns 36.50 °C for the night
  tested and its field 1 alone 36.00 °C — neither is what production stored by that route.
- The interim remedy the entry proposed — "feed only field 0 (or 2)" — is **wrong**: it leaves `0x69`
  and `0x75` mixed into the same series.

## What replaces it

The outcome stands and is now reproduced end-to-end: running the shipped path over the real 631
frames of 2026-07-21 13:00–21:00 UTC returns **36.00 °C**, exactly the `temp_mean_c` production holds
for 2026-07-22. Per-channel over the same frames: `0x46` f0 35.33, f1 36.00, f2 37.15, **`0x75` alone
35.76**, `0x69` alone `null` (16 frames, under the 4-window minimum).

The field structure is also stronger than the sample showed: across all 30,135 `0x46` rows
**f0 ≤ f1 ≤ f2 in 99.86%**, and field 1's 280 distinct values are **98.3% exact multiples of 0.5 °C**
(the "5 distinct values" figure was a small-sample artefact; the grid is real).

Restated at full scale: of the 21 nights with a value, **19 are exact whole degrees**, range
34.00–37.00 °C, σ = 0.743 °C.

New preferred interim remedy: **feed `0x75` alone**. It needs no protocol decision — one value stream,
7 samples per frame (the shape the median-7 stage expects), fires only while asleep, and yields a
plausible non-quantised 35.76 °C.

## Protocol boundary — five questions left open rather than guessed

There is no `open_oura` checkout in this repo and the `oura-native-ble` skill carries no body layout
for `0x46`, so per the "verify against the pinned source" rule the field semantics are not named.
The five open questions (what `0x46`'s three fields are, which one `nightly_temperature_calculate`
consumes, why field 1 is on a 0.5 °C grid, what `0x69`'s single value is, and whether `0x75`'s
7-value body is already median-filtered) are recorded in the review doc's Q-2 addendum.

## Why this is filed as a correction rather than an edit

The review doc is a record, so its original narrative is left in place with a pointer at the top of
the section and the correction appended. The **backlog entry** is an instruction, so it is rewritten
in place — leaving a wrong tag and a wrong remedy in the queue is what would have caused the damage.
