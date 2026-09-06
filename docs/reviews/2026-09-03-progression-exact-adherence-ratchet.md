# Hitting the prescription exactly is scored as progress, and the record is permanent

**Date:** 2026-09-03 · **Agent:** Review 📖 (sweep 46) · **Pillars:** `[workouts]` `[nutrition]` `[app-shell]`
**Lens:** the owner's — workout building and progression **logic**, plus nutrition and home. A
computation sweep rather than an access-control one: does the app produce the number it says it does?

`packages/shared/src/1rm.ts` states its own invariant in a comment, and the 2026-07-10 workout system
review repeated it as a strength of the module:

> *"prescriptionFactor making exact adherence 1RM-neutral"*

**It is not neutral.** The neutrality holds for the exact prescribed weight and is broken by the
plate rounding that sits between the formula and the barbell. A lifter who follows the app perfectly
gains a **median 2.6%** on their stored 1RM (p90 7.1%, max 13.6%) having lifted nothing heavier, and
because the estimate goes through `upsertPersonalRecordIfBetter`, the inflation is permanent.

Home's score bands came back clean. Nutrition produced one low-severity consistency finding.

---

## 1. Method, and what it does not establish

The invariant was simulated against **the shipped module** — `estimateOneRm` imported directly, not
re-implemented — with the rounding function copied verbatim from `components/workout/utils.ts`. The
simulation was run as a throwaway vitest file inside `packages/shared/src` (deleted before
committing) because that is the only way to import the real TypeScript without transcribing the
formulas, and transcription is exactly how this kind of audit goes wrong.

**What this does not establish.** It is the idealised case: the lifter hits every prescribed rep at
every prescribed weight. Real logs vary, `resolveWorkingBasis` takes the last non-deload session, and
autoregulation moves things. That does not weaken the finding — *"the user does exactly what the app
says"* is the intended path, and it is the one case where the app's own stated invariant should hold
exactly. No production data was read; the numbers below are arithmetic, not measurements of the
owner's training.

## 2. RV-43 — the mechanism, in four steps

1. The prescription is `mroundStepUp(basis × pct/100, step)`
   (`app/api/next-session/prescription/route.ts:138`) — a **ceiling** round to the plate increment,
   2.5 kg on a barbell. Its comment states the intent: *"so that following the recommendation never
   drives the estimated 1RM downward — slight overload is better than underload."*
2. The lifter hits that weight for the prescribed reps.
3. `calculate1RM` applies `prescriptionFactor = 1/((pct/100) × repFactor(targetReps))`. With the reps
   matching, the `repFactor` terms cancel and the estimate is `weight × 100/pct` — so the rounding-up
   is **amplified by 1/pct**: 1.43× at 70%, 1.67× at 60%.
4. The result exceeds the previous 1RM, is stored, and becomes the basis for the next prescription.

Step 1 is deliberate and documented. Step 3 is what turns "slight" into something else, and nothing
in either file mentions the other.

### Measured

1,201 starting 1RMs from 60.0 to 180.0 kg in 0.1 kg increments, style 3×8 @ 70%, lifter hits the
prescription exactly every session:

| Plate step | min | **p50** | p90 | p99 | max | unchanged | sessions to settle |
|---|---|---|---|---|---|---|---|
| barbell 2.5 kg | −0.07% | **+2.60%** | +7.12% | +11.84% | **+13.55%** | 10 / 1201 (1%) | 3 |
| dumbbell 1.25 kg | −0.07% | **+1.30%** | +5.04% | +8.70% | +10.46% | 20 / 1201 (2%) | 4 |

A worked case, barbell:

```
100.00 kg  ->  ... unchanged          (70 kg is already a plate multiple)
103.70 kg  ->  107.25 -> 110.75 -> 114.25 -> settles        +10.55 kg, +10.2%
143.20 kg  ->  146.50 -> 150.00 -> settles                   +6.80 kg,  +4.7%
```

**It converges rather than running away**, which is the part that keeps this out of the top severity
band. The fixed point is the smallest 1RM at or above the start whose working weight lands exactly on
a plate multiple, so the ratchet stops within three or four sessions. Only 1–2% of starting values are
already at a fixed point and see no ratchet at all.

**My first simulation showed zero drift and was wrong.** It started at exactly 100 kg, where 70%,
60%, 65%, 75% and 85% are all whole plate multiples, so the ceiling never rounded anything. A fixture
chosen for tidiness had hidden the entire effect — the reason the table above sweeps 1,201 starts
rather than quoting one.

### Why it is not cosmetic

`logExerciseFromPayload:327` passes the estimate to `upsertPersonalRecordIfBetter` whenever
`shouldCountTowardPr` allows it — and that gate excludes deloads, baselines and implausible values,
none of which apply here. `IfBetter` is monotone, so a ratcheted estimate becomes an all-time
personal record and stays one. It then feeds the strength-progress card, the digests, and
`pickHeadlinePersonalRecord`.

The honest framing of the cost: the app cannot distinguish a lifter who got stronger from one who
followed instructions, and it records the second as the first.

**Not a recommendation to switch to nearest-rounding.** The ceiling exists for a stated reason and
`mroundStep` (nearest) shows the same ratchet at a lower median. The question this raises for the
owner is whether the *estimate* should be computed from the prescribed weight rather than the
rounded one — which would make the invariant true as written — and that is a scoring decision, so it
is filed as `Verify: owner` rather than answered here.

## 3. RV-44 — `atwater.ts` was created to end nine longhand copies, and did not reach them

`packages/shared/src/nutrition/atwater.ts` exists because of LB-9, and its header says why:

> *"Six lines with no dependencies can be imported from anywhere, which is the property that stops a
> fifth copy appearing the next time something needs them."*

Two files still write the factors out by hand and import nothing:

| File | Longhand sites |
|---|---|
| `packages/shared/src/nutrition/scan-totals.ts` | 41, 113, 145, 155, 156 |
| `packages/shared/src/nutrition/meal-split.ts` | 173, 249, 250, 251 |

**No number is wrong today** — all nine agree at 4 / 4 / 9, and the Atwater factors are physiological
constants that will not change. This is a consistency finding, not a correctness one, and is filed at
that level. What makes it worth an entry rather than nothing is the shape it shares with the rest of
this session: a module built once to be the single home, adopted by some call sites, and described in
its own header as though it had reached all of them.

## 4. Clean, recorded as results

- **Home's score bands are a single source.** `scoreBand()` in
  `packages/shared/src/health/score-band.ts` holds the 70/50 thresholds, and a search for re-derived
  thresholds with local label strings — the divergence `CLAUDE.md` records finding twice before —
  returns only the function itself.
- **`mround125Up` is dead code and its bug is fixed.** Zero call sites; the equipment-aware
  `mroundStepUp` superseded it. That closes **AI-10** from the 2026-07-10 review, which reported the
  AI prescription card rounding at a fixed 1.25 step while the workout screen used the
  equipment-aware one — `ai-prescription-card.tsx:246` now uses `mroundStepUp` with
  `weightStepFor(...)`. The dead function is worth deleting when someone is next in that file; it is
  not worth an entry.

## 5. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-43** | `[workouts]` | Exact adherence is not 1RM-neutral: plate ceiling-rounding, amplified by `1/pct`, ratchets the stored 1RM +2.6% median / +13.6% worst before settling, and `upsertPersonalRecordIfBetter` makes it permanent |
| **RV-44** | `[nutrition]` | Nine longhand Atwater sites in two files that `atwater.ts` was created to eliminate; all agree at 4/4/9, so no number is wrong today |

## 6. Method notes

- **Import the shipped module; never re-implement the formula you are auditing.** A throwaway vitest
  file inside the package is the cheapest way to reach TypeScript that has no build output —
  `npx tsx` is not installed here, and `console.log` inside vitest is swallowed, so write results to
  a file and `cat` it.
- **Choose fixture values that are hostile to the arithmetic.** A starting 1RM of 100 kg makes every
  common percentage land on a plate boundary and reports a clean bill of health for a mechanism that
  moves 13% at other values. Sweep the input range instead of picking a number.
- **A prior review's praise is a claim, and claims are testable.** RV-43 corrects one sentence in the
  2026-07-10 workout system review — the same move that found RV-41 in a code comment and RV-36 in a
  shipped backlog entry. Three findings this session came out of testing something the repository
  said about itself.
