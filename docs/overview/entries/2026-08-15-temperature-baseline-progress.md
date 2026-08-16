# 2026-08-15 — saying "still learning" instead of saying nothing (Q-105-followup)

**Branch:** `claude/trainingai-backlog-v0abea` · **Version:** v1.308.0

Q-105 threaded the real temperature-deviation numbers into the "Why this recommendation?" explainer,
but only for the mature case. Below 30 nights of history the elevated-temperature deload cannot fire,
and the explainer said **nothing about temperature at all** — which, from the user's side, is
indistinguishable from the signal not existing.

The entry left the call open for a specific reason: *"The plan explicitly said to check with the
owner rather than guess, and this session had no channel to do that mid-PR."*

## Measured before asking

The owner's baseline is at **40 nights** as of today and crossed 30 around 2026-08-05. So this state
no longer affects them at all — only a new account or a baseline reset. That reframed the question
from "you are staring at silence" to "someone new would be", which is worth an owner's answer rather
than a guess, and cheap for them to give once the measurement is attached.

**Owner chose: show the progress.**

## What it says, and where it is not

> Body temperature isn't being used yet — still learning your baseline (18 of 30 nights). It needs a
> full month before a reading counts as unusual for you.

**It is deliberately not one of the explainer's signals.** That list answers "why is recovery being
suggested", and an immature baseline is not a reason to back off — rendering it there would misinform
the exact decision the card exists to inform. `temperatureBaselineProgress` returns `number | null`
rather than a `Signal`, so the compiler enforces that rather than a comment asking future edits not
to.

**It requires at least one night.** Zero means no sleep data has arrived at all, where the honest
output is silence: a progress indicator that has not started implies a working pipeline when there
isn't one.

## The build caught a bundle regression that tsc and the whole suite did not

Importing `TEMP_BASELINE_MIN_DAYS` from `ai-periodization/ai-dynamic` into a client component
**failed `pnpm build`** — that module transitively pulls the ONNX runtime, so a client import of a
bare number dragged `onnxruntime-node` into the browser bundle.

This is the **third** appearance of the Q-221 boundary in two days, each in a different costume:
`node:path` via the MET table (Q-230), the vendored decoder table (Q-221 itself), and now a native
`.node` binary via a constant. `tsc --noEmit` passed, lint passed, and all 3,899 tests passed with
the broken import in place.

Fixed properly rather than by hardcoding 30: both temperature thresholds moved to
`deload-constants.ts`, which is import-free, and are re-exported from `ai-dynamic` so every existing
importer is untouched. A constant with no dependencies belongs in a leaf.

## Verified

Six cases, **mutation-verified twice** — dropping the one-night floor fails 2, and making the
threshold `>` instead of `>=` fails the boundary case written for it.

`pnpm build` passes (it did not, before the constant moved). `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33, full suite **471 files / 3,899 tests** under the TCP `DATABASE_URL`.

**Not exercised: the S25, and the state itself.** The owner is at 40 nights, so this copy cannot be
seen on their account without a baseline reset — it is for new accounts. What is proven is the
threshold logic and that the panel renders; what is not is how the line looks on a real sub-30
account, which nothing in the sandbox can produce.
