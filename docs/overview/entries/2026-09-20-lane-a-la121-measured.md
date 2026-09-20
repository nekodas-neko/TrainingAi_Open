# 2026-09-20 — LA-121 measured: four dead readiness branches, and an unreachable temperature ladder

**Branch:** `lane-a/la121-measure-dead-cloud-branches` · **Lane A** · docs-only.

LA-121 was filed an hour earlier, during BF-178, as a deliberately **unmeasured** observation: the
readiness availability branch still keys off `oura_daily.readiness_score`, which the re-key froze.
The entry said its first step was a query, not a patch. This is that query.

## What the measurement changed

| filed as | measured |
|---|---|
| one branch | **four** — `readiness-payload.ts:580, 610, 614, 751`, all on the same condition |
| "presumably false for post-re-key days" | **NULL on 35 of 35 days**, confirmed |
| "pre-re-key-only" | **permanently unreachable** — `buildReadinessPayload` takes no date, so `ouraToday` is always today |

The "pre-re-key-only" framing was the guess, and it was wrong in the direction that matters: there
is no historical path through this function at all, so the dead arms have not run since
2026-07-07 and cannot.

## What did not change

**Every fallback is correct.** Each live arm reasons from our own inputs, which is right when the
score is our own composite. Nothing user-visible is wrong today, and an implementer who "fixes"
this expecting a behaviour change will find none.

## The one thing worth someone's attention

`computeBlendedScore` has exactly one production call site — the dead arm — and it carries a
**temperature penalty ladder** that no longer runs. Its test measures it: from a base of 80,
deviation 0.4 → 70, 0.7 → 60, 1.2 → 40.

**The claim that would have made this urgent was checked and is false:** temperature has not
dropped out of readiness. `computeReadinessComposite` takes `tempZ`, and the composite is the live
path. The ladder and the `tempZ` contributor are two different mechanisms; the second survives.

Whether losing the first is a loss is a **calibration** question (TN-6, BF-13), so the entry now
asks the owner rather than answering it, and explicitly blocks removal of the four dead arms until
it is answered — a scoring-path diff whose mistakes silently re-score every stored day buys nothing
while the question is open.

## Method note

This is the second time today that a measurement inverted an entry rather than confirming it, and
the first time the entry was one I wrote myself. Filing it unmeasured, with "nothing here is
measured" stated twice in the body, is what made the inversion cheap — there was nothing to
un-believe. The alternative, asserting "pre-re-key-only" as fact because it sounded right, would
have had the next reader build against a premise that a single query disproves.

## Not exercised

Nothing to exercise — docs-only, no code touched.
