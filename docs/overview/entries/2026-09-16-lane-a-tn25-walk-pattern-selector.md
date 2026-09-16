# 2026-09-16 — Lane A · TN-25: the walk pattern gets assigned, and the pacer still says push

**Branch:** `lane-a/tn25-walk-pattern-selector` · engine half only · **no version bump** — nothing is
wired to a surface, so nothing user-visible changed.

The owner asked for the guided walk's fast/slow structure to be **varied and assigned** rather than
chosen by them: *"If we need more zone 2 maybe it's more fast? If we have zone 2 done maybe it's just
light interval for steps."* That is a description of `recommendRunType`, which already does exactly
this for runs — so this extends an existing deterministic selector rather than inventing a
prescription engine.

## What shipped

`packages/shared/src/walking/recommend-walk-pattern.ts` — `WALK_PATTERNS` (the owner-approved
four-row table: steady brisk, long intervals, short intervals, easy steps) and
`recommendWalkPattern(quota, opts)`. Deterministic, pure, no LLM — `recommendRunType`'s comment says
why that matters and the same rule holds here.

**Zone 2 alone drives it, and that is the point rather than a simplification.** A walk is the mode
this owner cannot push past Zone 2 in — 0 of 44 fast blocks reached the old Zone-3 target — so
grading it against the higher zones would recommend work the mode cannot deliver. Zones 3+ are what
`recommendRunType` is for.

**It picks a pattern and never an HR band.** That separation is copied from `recommendRunType`, whose
own comment calls its zone map *"not a target"*, kept apart from the one that drives the real band.
Mixing them is how an anchor change would silently move the walk.

## What this does NOT fix, and it is the half the owner would notice

**The pacer still says "push" on every fast interval.** `walk-active.tsx:67-68` still sets fast ≥ 0.70
of reserve — 133 bpm for this owner, against a measured fast-block mean of 98.5 — and `classifyZone`
still returns `'push'` for anything under it. A cue that can only ever say *push* is the reported
defect, and nothing here touches it. The selector is the prescription engine; the band is the fix.

## The band is an open design question and I did not quietly settle it

TN-25 says *"the band, not the fraction: target **105–118 bpm** directly."* Taken literally that is a
hardcoded constant true of a 33-year-old with a 168 max and wrong for anyone else.

**Recommendation, recorded in the entry: derive it from % of HRmax (0.60–0.70), not % of reserve.**
It yields exactly 105–118 for this owner, it is the model the session's own copy is written in
(*"conversational aerobic"*), it stays per-user, and it breaks the coupling the entry actually
names — which is to **reserve**: `0.70 × reserve` is what re-anchoring at 178 would move from 133 to
140. What the literal reading is better at: it cannot move under any anchor change at all. Reversal
cost is one expression either way.

I left it open rather than picking it inside an engine PR, because the choice seeds how every HR
target in the app is expressed, and it belongs with the code that sets the pacer.

## Verification

- `pnpm test` **925 files / 8790 tests** green. `pnpm check:rules` **75 of 75**. Typecheck and lint
  clean.
- **Mutation pass, 5 mutants, all killed** — and one survived the first round, which is the useful
  part. Changing `find(zoneId === 2)` to `find(zoneId >= 2 && open)` passed all ten tests, because
  every fixture had Zone 2 *open*, so both expressions found the same row. **Only a case where Zone 2
  is met or absent while a higher zone is open separates "reads Zone 2" from "reads the first open
  training zone."** The test that claimed to protect exactly this property did not. Rewritten around
  those two cases; the mutant dies now. **Equivalent control** (reordering two `&&` guards) stayed
  green.

**Not exercised:** no device, no APK, no authenticated request. The selector is a pure function with
no caller yet, so nothing ran it in anger — what the tests cover is the arithmetic, not a prescription
anyone has seen. Every production figure quoted (0 of 44, 98.5 bpm) comes from TN-25's own review and
was not re-measured here.
