# 2026-10-05 — OR-210: one ACWR band, one baselining rule

**Branch:** `fix/or210-acwr-band-and-baselining` · **Lane A** · no schema. `PS-28` (a), the acute window, is
untouched: it is a scoring calibration owed a Tuning proposal, and this ships no re-score.

## (b) the chat tool re-banded ACWR itself

`getTrainingLoadRisk` returned a raw ratio over **56 days** and left the banding to the model, while the
Health card bands **28**. 32 of the owner's last 76 days disagreed. It now calls the same builder as the
route over the same window, `trainingLoadBand` in `acwr.ts`: insufficient data, then baselining, then the
band, returning `interpretation`, the rounded ratio, the loads and a label. No second bander was added.

## (c) three baselining rules for one concept

| Site | Rule before |
|---|---|
| Health route | `startedAt ?? createdAt`, under 28 days = baselining |
| readiness, score audit | `startedAt` only; a missing one was **infinitely old**, so they never baselined |
| signals, chat, running | none |

One helper now, `acwrBaselineDaysRemaining(program, asOf)`, with the route's rule: a program with no start
date is still as old as its row. All six `computeVolumeAcwr` consumers use it, and a guard test scans for
new ones. The owner's active program has `started_at = NULL`.

## What this changes, stated plainly

Only programs under 28 days old, and now they are treated consistently. For a young program, readiness's
early-deload gate, the audit, the prescription's emergency-deload input (`signals`) and the running
recovery gate stop acting on a ratio the Health card already called unreliable. **The owner's Bankai was
created 2026-09-06, so it crosses the 28-day line tomorrow: the route says "baselining, 1 day left" today and
every consumer agrees from tomorrow. The one visible effect is that today readiness reads no ACWR (so the Activity score's over-exertion taper is off for one day), then nothing.**

## Verified

`or210-training-load-one-band.test.ts` (15): the helper's rules and boundaries, the band order and
thresholds, the route and the chat tool run against the same data and agree (on a fixture where the 56-
and 28-day windows give different ratios; baselining and insufficient-data too), and every consumer
applies the helper. **It fails 4 of 15 against the old chat tool.** 552 files / 6,083 tests pass across
shared, health, ai-chat, lib, API and health components. tsc, test typecheck and `check:rules` (86 of 86)
are clean. Live `/api/training-load` on the owner's snapshot: baselining, 1 day remaining.

## Not exercised

The chat tool through a real chat turn (it is exercised directly with a fake repository), and the
readiness, signals and running paths on live data: they are covered by the consumer guard and by the
existing suites, not by a run.
