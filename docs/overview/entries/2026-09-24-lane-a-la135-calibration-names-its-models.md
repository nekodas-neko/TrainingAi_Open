# LA-135 — the calibration panel now names the models behind its number

**Branch:** `lane-a/la135-calibration-model-mixing` · **Lane A** · 2026-09-24

`/api/admin/battery-recovery-calibration` correlates each day's end-of-day Body Battery against the
recovery rating the owner gave that morning. It reads `body_battery_daily` over a window of up to
180 days and never looked at which model produced those values.

`model_version` has been written on every row since the table existed and read by **nothing** —
grepped for a version literal, a `startsWith`, an equality: none. The column exists to stop tuning
analysis mixing data from different constant sets, and it was not stopping it.

Measured in production 2026-09-24:

| model | days | mean end | days at 0 | last |
|---|---:|---:|---:|---|
| v1 | 16 | 66.3 | 0 | 2026-07-15 |
| v2 | 1 | 21.0 | 0 | 2026-07-16 |
| v4 | 18 | 62.9 | 0 | 2026-08-03 |
| v5 | 52 | 15.2 | **27** | 2026-09-24 |

The **v4 → v5** boundary moves the mean end-of-day value from 62.9 to 15.2, and a 180-day window has
spanned it since early August. CLAUDE.md names a correlation across a model change as not evidence.

## What shipped, and what was deliberately not done

**The window is not narrowed.** Filtering to the newest generation would answer a narrower question
than the caller asked and give no sign of it — a 90-day request returning a figure computed over a
handful of rows. That is the failure one level quieter, and the entry forbade it in advance.

Instead the payload gains three fields, all additive (the consumer is a generic card taking an
`endpoint` prop, so nothing breaks):

- `models` — the per-generation day census, most days first.
- `spansModelChange` — whether the window crosses a boundary at all.
- `byModel` — when it does, a full calibration per generation, each over only its own days.

So there is always a figure that means something, sitting next to the evidence for whether the
headline one does.

`modelGeneration` compares **only the prefix**, not the whole version string. The interpolated
constants change on every tuning pass — TN-55 changed three of them inside v6's string — so
comparing whole versions would split one generation into a bucket per tuning and report a model
change where the model's shape never moved.

A row with no stored version buckets as `unknown` rather than being dropped. An unexplained day is
what a census is for.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | compare the whole version, not the prefix | killed (10) |
| 2 | headline narrowed to the newest generation — the quiet truncation | killed |
| 3 | a missing version folds into another bucket | killed (2) |
| C | the census built with `reduce` instead of a loop | survived (correct) |

Mutation 2 is the one this entry exists for: it implements the plausible-looking fix the entry ruled
out, and the suite rejects it.

## An entry of mine that was wrong, corrected before it was built

LA-135's first version said the mixing began with v6 shipping that morning — *"rows before today are
`v5:`, rows from today are `v6:`"*. The census above shows four generations already stored. That was
corrected in `#1539` before this implementation, which is the only reason this PR measures the real
boundary rather than the imagined one.

## Failure surfaces not exercised

No device, no production write. The calibration builder is a stand-in in the route test — what is
asserted is which rows reach it and what the route says about them, not the statistics themselves.
The panel was not driven in a browser; it is admin-only and the change is additive to its payload.
