# 2026-09-30 — BF-221: an accessory's reps are held to its goal band

**Branch:** `fix/bf221-accessory-rep-band` · **Lane A** · removes `BF-221` from the queue.

## What was wrong

The owner was prescribed **Pull-Up and another accessory at 77.5 % × 7** in a `powerbuilding`
program whose accessory band is **8–12 reps at 66–75 %**. The accessory branch of
`generatePrescriptionForSession` took the model's reps unchecked and derived the load from the
target effort at those reps, so a rep count below the floor pushed the load above the ceiling. The
primary and secondary branches clamp, but this one did not. The band's only other enforcement
(`autoregulation.ts`) runs only when an adjustment fires.

## What changed

- `settleAccessory(goal, reps)` in `goal-ranges.ts` clamps the reps to the goal's accessory band and
  derives the pct at the clamped reps. The band's pct edges are computed from the same
  `pctForExpectedRpe` at the rep edges, so the load lands in band without a second clamp.
- The accessory branch uses it and writes the settled reps back onto the exercise.

## Verified

- `bf221-accessory-band.test.ts`: the reported 7-rep case becomes 8 reps in band; every goal (and
  the default spec) stays inside its band on both axes for model reps from 1 to 40; in-band reps pass
  through; a source pin keeps the generation branch on the helper. Periodization and generation
  suites: 167 + 154 passed.
- `pnpm dev` on the owner's snapshot, live Gemini generation. Push: Dips 10 @ 70.5, Tricep Combo
  12 @ 66, Fly 8 @ 75. Upper: Lateral Raise 10 @ 70.5, Skull Crusher 10 @ 70.5. All in band. Pull
  came back as a deload, which does not take this branch.

## Not diagnosed

Why the model picked 7 for two accessories and 12 for Face Pull, which the entry flagged as possibly
a style effect (BF-217). With the clamp, the model's choice can no longer leave the band either way.
