# 2026-08-15 — workout model round 3, and the conflict markers I put on main

**Branch:** `claude/gym-app-comprehensive-review-j38fo9` · **Type:** review + one CI fix ·
**Backlog:** Q-304, Q-305 filed · **Q-298 amended in place**

Fourth review of the day, taking items the third listed as *not started*. Two done, four still not.

## I broke main, and the check that would have caught it did not exist

A merge resolution staged with `git add -A` committed **four files with their conflict markers
intact** — 21 marker lines — and #1380 merged them. They passed Lint, Tests, Build, Migration Check,
Custom Rules **and** E2E. Six green checks, because nothing looks at markdown for this and
`<<<<<<< HEAD` is ordinary prose to every other tool.

Resolved here, and `scripts/check-conflict-markers.js` is now a Custom Rules step (36 of 36),
verified in both directions — clean on the tree, exit 1 on a planted marker. It anchors on the exact
forms git emits so a doc quoting a diff does not trip it.

The lesson is the narrower one already in `CLAUDE.md` about `git add -A` after a checkout: it applies
to merge resolution too, and more sharply, because a half-resolved file looks finished.

## Q-298 was half wrong, and is amended rather than re-filed

I filed all ten zero-`estimated_1rm` rows as one defect. Reading the write path settles it:
`log-exercise.ts:194` calls `estimateOneRm`, and `1rm.ts:158` is
`if (deloaded) return { estimated1rm: 0, … }`. **The five 2026-08-06 rows carry
`exercise_deloaded = true` and are zero on purpose.**

What survives is narrower and better: **`0` is the wrong sentinel** — a null propagates as "no
estimate", a zero propagates as an estimate *of* zero, which is what read as −100% on my own trend
query — and **the five 2026-08-09 rows are still unexplained**. Their set logs narrow those to a
bodyweight-resolution path (Pull-Up at `weight_kg = 0`), a `useFor1rm`-subset with no qualifying set
(Preacher Curl), and **three rows with real weights, real reps and `use_for_1rm = true` that should
compute and do not**. That is where an implementer starts.

The useful structural note: `runningEstimate1RM` already has a fallback for the empty-result case
and `calculate1RM` does not — while the write path uses `calculate1RM`. So the live widget shows a
sensible number and the saved row gets 0.

## Two new findings, one carrying a qualifier that may close it

**Q-304** — 29 sets at 13+ reps feed the 1RM estimate on `calculate1RM`, which skips the
`amrapScaleFactor` correction (0.88 at 13–20, 0.82 at 21+) that `calcAmrap1RM` applies. **The entry
says to measure before changing anything**: `prescriptionFactor` may already absorb the inflation
where a style is present, and I did not establish how often that holds. Closing it as
measured-and-rejected is a fine outcome.

**Q-305** — `MUSCLE_LANDMARKS` computes MEV/MAV/MRV per muscle and nothing shows it. Last 7 days:
calves at **2 sets against an MEV of 8**, lats 9 vs 10, upper back 7 vs 8, triceps at 17 (above MAV).
One week is a small sample and the entry says so — the durable finding is the absent surface, the
third instance after Q-278 and Q-302.

## A fourth finding died on verification

`core` is tagged on exercises and missing from `MUSCLE_LANDMARKS`, which looked like a silent
fall-through to the generic default. It is not: `muscles.ts:17` maps `core: 'abs'` and
`volume-targets.ts:58` normalises before the lookup. Four such near-misses across four reviews now —
worth stating as a rate, because it is the verification step working rather than failing.

## Still not started

Deload *policy*, the phase engine, muscle balance / exercise selection, and the cardio pace/HR model
across 47 activity logs. The AI-output audit is 8 of 117. The degradation matrix is desk-only.
**"What breaks at 10 users, at 100" is unanswered for the fourth time** — it needs load testing
against a seeded multi-user database, and will not close by inspection.
