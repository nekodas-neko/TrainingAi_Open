# 2026-09-15 — BF-164: BF-149 fixed one surface of eight (BugFix intake)

Docs-only, and a correction to my own earlier work. The owner, on the Hanging Leg Raise ready screen
showing **"Last: 11 reps · 12 Sept"** four lines above **"REP MAX 8 RM"**: *"How is this right?"*

It is not. It is the exact defect BF-149 was filed for, still live on the surfaces BF-149 never
touched.

## What actually shipped

BF-149 swapped `exercise-summary-screen.tsx` to the AMRAP-scaled inverse; BF-151 replaced that with
`bodyweightRepMax`. **Both changed that one file.** `repMaxFromOneRm` — the inverse of the *unscaled*
`calc1RM`, which BF-149 itself proved wrong for a bodyweight estimate — is still what four helpers in
`1rm.ts` call:

| site | what it feeds |
|---|---|
| `displayOneRm` (:323) | ready screen, pre-workout list, stats sheet, strength-trend card, baseline hints, year review |
| `displayOneRmSeries` (:396) | every rep-max trend chart, including the one under his 8 RM |
| `displayOneRmDelta` (:344) | the rep-change arrow |
| `rescaleBodyweightReps` (:408) | **prescribed reps**, not display |

Same arithmetic as BF-149 published: stored **128** → `repMaxFromOneRm` gives **8**,
`repMaxFromAmrapOneRm` gives **11**, and `avg_reps` is **11**. The screen prints the true number and
the wrong one four lines apart.

## The half that is not cosmetic

`rescaleBodyweightReps` sets `reps = floor(pct/100 × repMax)` for the static progression style. An
understated rep max understates every prescribed rep count in proportion — at his numbers ~8/11, a
**27% shortfall** on any bodyweight exercise the AI did not prescribe directly. That is training
volume.

## Why it was missed, since the rule it broke is in CLAUDE.md

BF-149's journal checked the **direct** callers of `repMaxFromOneRm`, found the exercise stats sheet,
and concluded the other caller was sound. That was true and insufficient: it did not look for
**wrappers**. `displayOneRm` sits one call deeper and is what seven surfaces import. The
sibling-surface sweep has to follow the helper *up* as well as across — grepping the function name
finds callers, not the surfaces a wrapper serves.

The entry keeps `repMaxFromOneRm` exported rather than deleting it: BF-149 established it is right for
the stats sheet, whose comparison table is built from `calc1RM`, and that file imports it directly for
exactly that reason.

## Not exercised

Docs only. Every figure was reproduced from `1rm.ts` as shipped and his stored `estimated_1rm` and
`avg_reps`.
