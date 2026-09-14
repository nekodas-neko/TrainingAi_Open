# 2026-09-14 — the workout pass: a premise that expired when the owner changed programs

**Branch:** `chore/or-112-workout-pass` · backlog only. No product code.

## BF-59 — the owner handed the call over, and the data retired half the entry

Owner: *"You should have all the data to see my prescribed sets; you can make the decision here."*

BF-59 is written around a **flat 14/10 binary** in `program_volume_targets`. Measured in production:

| program | active | distinct values | range |
|---|---|---|---|
| **Bankai** | ✅ | **6** | 5–13 |
| Shikai | no | **2** | 10–14 |
| AI-Phase1 | no | 2 | 8–12 |

**The `14/10` pair is Shikai's, and Shikai stopped being the active program on 2026-09-06** — when the
owner rebuilt their training around less lower-back work. Bankai's stored targets are already a
sixteen-muscle gradient: abs/chest/lats/shoulders 13 · biceps/calves/quads/upper-back 11 ·
hamstrings/triceps 10 · glutes/traps 8 · forearms/lower-back 6 · adductors/hip-flexors 5.

**So item 1 is still worth doing and its stated symptom is not reproducible.** `signals.ts:399` does
still read `vt.targetSetsPerWeek` rather than the phase-scaled `weeklyVolumeTarget`, and that
engine/screen inconsistency is real. What is gone is the consequence the entry sells it on. Re-scoped
as the architectural fix it is, with a warning not to "fix" it by regrading Bankai — those numbers are
the owner's deliberate choice, and phase scaling multiplies them rather than replacing them.

## Two decisions, both settled

- **BF-94 — yes, build the swipe.** *"Yes I would rather be able to swipe the start button to reveal
  the rest."* Its `Gate: device` is discharged **by the answer, not by a look**: it was waiting on a
  preference. BF-61's fast-tap concern survives as an implementation constraint, not a blocker.
- **PS-10 — do not build.** *"Dont build"*, against the owner's own original idea. The entry leaves
  the queue, **recorded rather than silently deleted**, because a later session finding the idea in an
  old journal would otherwise re-file it.

## A third kind of answer: the conditional close

**BF-64 and LB-47** both came back *"Will let you know when it comes up. Happy to treat as fixed if I
dont raise it again."* Each needs a specific program state to arrive on its own.

Their `Verify: device` is removed so they stop printing as debt — but the note says plainly that
**nothing has confirmed the fix works.** If either symptom is reported again it is a **regression
report against an unverified fix**, not a fresh bug, and the next session starts from the original
diff. That distinction is the whole reason the note is longer than "owner says treat as fixed".

## Verified (3)

BF-135, BF-141, BF-65.

## Result

Device debt **37 → 32**. Workout is clear.

**Surfaces not exercised:** none apply — backlog only. `pnpm check:rules` **Ran 74 of 74**.
