# 2026-09-14 — BF-158 and BF-159, found by a pre-flight check (BugFix intake)

Docs-only. The owner asked for the Cooper 12-minute run to be checked before running it for the
first time. Most of it is right; one thing would have ruined the result, and the check itself exposed
a second problem.

## What is correct, recorded so it is not re-checked

720 s duration with an auto-finish on expiry; `(distanceM − 504.9) / 44.73`, the real Cooper 1968
equation; 0.85 HR-reserve effort target; and a genuinely good guard — `test-result.tsx` skips the
VO₂max when a fixed-duration protocol ends under 90% of its window, saving HR and distance anyway,
because *"the Ross/Cooper equations are calibrated to the FULL protocol"*. The previous-test lookup
filters on `testType`, so his July 6MWT will not be compared against a Cooper.

## BF-158 — the one equation in the file with no clamp

```ts
const clampVo2 = (v: number) => round1(Math.max(10, Math.min(100, v)))
// sixMwtVo2max: both branches clamp
export function cooperVo2max(distanceM: number) {
  return round1((distanceM - 504.9) / 44.73)     // no clamp
}
```

At zero distance that is **−11.3**, saved into the fitness snapshot. **Zero is the realistic input**:
`test-active.tsx` reads distance from `startGpsWatcher` and nothing else — no treadmill toggle, no
manual entry, unlike the guided walk which has an explicit *"Treadmill — skips GPS"* switch. The
conversation immediately before this one was about treadmill walks, so he was one tap from doing
exactly that.

**The entry argues against the obvious fix.** Clamping turns −11.3 into a plausible **10.0** that
nothing flags. The right shape is already in the file: treat an implausible *distance* the way the
early-stop guard treats an implausible *duration* — no score, and say why.

## BF-159 — the card is in the wrong list, and it is the only door

`TRAINING_ORDER` puts **Cardio Baselines** between *Muscle Volume This Week* and *Workout Density*.
Everything around it is lifting; this card holds VO₂max and HR recovery. And `/baselines` has exactly
one entrance — `grep -rn "/baselines"` returns only `latest-baseline-card.tsx` — so a card filed
under the wrong heading is the entire discoverability story for all three protocols.

The owner's words after being told where to click: *"That section should be moved to cardio hub."*
The destination already holds `HeartProfileCard`, `ZoneQuotaCard`, `StepsQuotaCard` and
`ModalityPicker`; the entry recommends directly under the heart profile, above the zone quotas —
what the heart is doing lately, then what it was measured at.

## Not exercised

Docs only. Both mechanisms were read in the shipped source; the −11.3 is arithmetic on the published
intercept, not an observed row. His `fitness_tests` table holds two rows, both from 2026-07-19.
