## 2026-08-23 — a workout's calorie estimate now says what produced it (Q-421)

**Branch:** `feat/label-session-kcal-basis` · **v1.333.3** · user-visible.

Q-421's last open clause was *"store which basis was used and label it"*. The storing half shipped
with route (a): `estSessionKcal` returns `source: 'hr' | 'met'`, the per-session energy route returns
it, and `computeActiveEnergy`'s `workoutKcalBySession` carries it per addend. **The label half is
this.** The ONNX half of Q-421 is owner-rejected and stays rejected; the entry is removed.

**Why a label rather than a better number.** About half the owner's sessions have no strap reading,
so a day routinely holds one figure from Keytel-on-heart-rate and another from a MET tier over the
clock — two formulas whose outputs *overlap* rather than agree. That is permanent: the strap is not
always worn. Unlabelled, two adjacent numbers read as the same measurement, and the reader cannot
tell which one responds to effort.

**Seen, not assumed.** Two sessions seeded on one day, identical in duration, sets and volume,
differing only in whether `workout_hr_stats.avg_bpm` existed:

```
Strapped  8:00am → 8:42am · 42 min   1,920 VOLUME KG   1 EXERCISES   3 SETS   ~378  EST. HR KCAL
Bare      4:00pm → 4:42pm · 42 min   1,920 VOLUME KG   1 EXERCISES   3 SETS
```

**What changed**

- `workoutKcalBySession` returns `Map<string, SessionKcal>` — `{ kcal, source }` — instead of
  dropping the basis on the floor.
- The day screen's Training card labels the stat `Est. HR kcal` or `Est. MET kcal`. Both are 12–13
  characters, so adjacent cards keep the four-stat row aligned; `Est.` and the tilde stay, since the
  figure is still an estimate either way.
- The done screen read `~639 kcal · moderate effort`. The effort tier is the **MET** path's input, so
  naming it beside a heart-rate figure credits the wrong thing — the same trap the route already
  guards by returning a null `met` on the HR path. It now reads `· from heart rate` when the heart
  rate produced the number.

**A gap between a comment and its code, surfaced by the fixture.** The card's own comment promised
*"absent rather than zero when the estimate cannot be made"*, but the guard was `kcal != null`. A `0`
addend does reach it: the sandbox's `met_moderate: 0.6` sits below `estWorkoutKcal`'s `met - 1.5`
floor (Q-331), so the strapless card rendered **`~0 EST. MET KCAL` next to a real 378** in the probe
above. The guard is `> 0` now, which is what the comment always said. A zero-calorie workout is not a
measurement worth printing.

**Tests.** `energy-summary.test.ts` gains two cases — that each session's basis survives the helper,
and that the helper does not *invent* one (both addends `hr`, so hardcoding either literal fails).
Mutation-checked: hardcoding `source: 'met'` reds exactly those two and nothing else. The existing
eleven were updated for the new map shape, with `source` defaulted in the fixture builder so they
stay about kcal arithmetic.

**Verification.** 14/14 in that file. `pnpm check:rules` — **Ran 51 of 51**, all passed. `pnpm lint`
0 errors. `tsc --noEmit` clean. Rendered against `pnpm dev` as shown above.

**Not exercised.** Nothing on the S25 — the label is a text change inside an existing stat row, but
the row's width at 412px was checked in the browser harness only. **The MET branch's real number was
never seen**: the sandbox constant makes it 0, which is why it is now suppressed rather than
displayed, so what a production MET card reads is inferred from the label alone. No E2E guard —
driving it needs a seeded `workout_hr_stats` row and the strapless twin renders nothing to assert on
in this environment.
