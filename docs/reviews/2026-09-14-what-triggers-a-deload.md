# Every deload trigger, measured — and why it started firing on 2026-09-01

**Filed:** 2026-09-14 · **Agent:** Tuning · **Entries:** TN-36, sibling of TN-34 ·
**Owner:** *"workouts are constantly being recommended for deload… I'm sure it's just bad tuning."*

**It is not tuning. There are two defects, and one of them has a date.**

---

## 1. The nine conditions

`computeDeloadStrength` (`packages/shared/src/ai-periodization/ai-dynamic.ts:182`) plus the
escalators in `computeAiDynamicNextSession`:

| # | condition | result |
|---|---|---|
| 1 | `illnessFlag === 'fever'` | **strong** |
| 2 | `tempAlert` — temp deviation > 0.5 °C, baseline mature **and** trusted | **recommended** |
| 3 | `stressOverride` — `stressHighMinutes >= 120` | **recommended** |
| 4 | `illnessFlag === 'elevated'` | **recommended** |
| 5 | **`consecutiveTrainingDays < 3`** | **not recommended** |
| 6 | readiness ≥ 70 | **recommended**, soft |
| 7 | readiness ≥ 50 | **recommended** |
| 8 | readiness < 50 | **strong** |
| 9 | `selfReportedSick` / `energyLevel` drained or low | escalates only |

**Count the exits: nine conditions, and exactly ONE of them can return "train normally".**

---

## 2. The structural defect — readiness cannot clear a day, only grade it

```ts
if (consecutiveTrainingDays < 3) {
  return { recommended: false, strength: 'soft' }   // the only false in the function
}
const r = readinessScore ?? 70
if (r >= 70) return { recommended: true, strength: 'soft' }
if (r >= 50) return { recommended: true, strength: 'recommended' }
return       { recommended: true, strength: 'strong' }
```

**Past three consecutive training days, every branch returns `recommended: true`.** Readiness selects
the *strength*, never the *verdict*. **A readiness of 100 returns `recommended: true`.** The `?? 70`
fallback means a day with no readiness at all also recommends a deload.

**Measured over 45 days: 28 days were not recommended, and all 28 were cleared by
`consecutiveTrainingDays < 3`. Not one was cleared on merit.** The engine has never said *"you are
recovered, train hard"* — it has only ever said *"you have not trained enough days in a row yet"*.

**⚠ The streak is also the only brake, which makes the rule perverse:** taking a rest day resets the
counter and buys three more clear days regardless of how recovered the owner is, while training four
good days in a row guarantees a deload recommendation on the fourth.

---

## 3. The dated defect — the stress override switched itself on when a bug was fixed

| | August (31 days) | September (14 days) |
|---|---|---|
| **deload recommended** | **6 — 19%** | **11 — 79%** |
| fired by the stress override | **0** | **9** |
| fired by the readiness ladder | 6 | 2 |
| stored `stress_high_minutes`, max | **90** | **330** |
| days at or over the 120 threshold | **0 of 27** | **9 of 14** |

**The threshold did not move and the owner's life did not change. The input did.** Commit `7c428a7f`
(2026-08-31) fixed the storage defect TN-22 found — before it, the stored scalar was written by a
second producer off a different HR baseline and came out near zero, **so it never reached 120 and the
override never fired.** Fixing the bug switched on a trigger nobody had ever seen fire.

**That is the date the owner is describing.** The complaint is not vague dissatisfaction; it is a
step change on 2026-09-01, and it is visible in the data to the day.

**⚠ And the input it switched on is the one measured to carry no signal.** TN-33: the daily stress
scalar is **57% night buckets**, night systematically positive, correlating **+0.072** with readiness
over 18 days with the two halves pointing opposite ways. **The deload engine's most active trigger is
the app's least trustworthy number.**

---

## 4. The readiness ladder is mistuned too, but it is the smaller half

The eight days it fired on, with the readiness that fired them:

`08-08 = 65 · 08-15 = 73 · 08-16 = 69 · 08-20 = 66 · 08-26 = 52 · 08-27 = 33 · 09-08 = 50 · 09-09 = 38`

**A readiness of 73 produced a deload recommendation.** Three of the eight were 65 or better. The
band boundaries are defensible in isolation; what makes them wrong is §2 — they are choosing a
strength when they should first be choosing whether.

---

## 5. What I did not check, stated rather than implied

- **`consecutiveTrainingDays` counts `hasExercises`, not `completedAt`;** this reconstruction used
  `completed_at IS NOT NULL`. That makes the real streaks **the same or longer**, so the real deload
  rate is **at or above** what is measured here — the direction is safe.
- **The temperature alert and the illness flag never fired in this window** (`illness_flag` is
  `normal` on 44 of 45 days, `watch` on one, which is not `elevated`). They are not part of the
  current complaint; TN-18 covers the temperature path.
- **`energyLevel` and `selfReportedSick` were not reconstructed.** Both can only *escalate*, so
  including them would raise the measured rate, not lower it.
- **This is what the engine computes, not what the owner saw rendered.** No screenshot was matched
  against a stored recommendation.

---

## 6. Recommendation

**Fix §2 first — it is the cause, and §3 is what made it visible.**

1. **Give readiness a way to clear a day.** A good readiness on day four should return
   `recommended: false`, not "soft deload". The one-line shape: make the ladder's top band clear
   rather than recommend, so `r >= 70` returns `{ recommended: false }`.
2. **Unwire the stress override (TN-34).** It fires on 64–83% of days off the number with no
   measurable relationship to anything. It is one line and reversible, and it is what changed on
   2026-09-01.
3. **Then re-measure before touching the readiness bands.** With 1 and 2 done the rate falls to the
   ladder's own contribution — **6 days in 31 in August, 19%** — which is a plausible deload rate and
   may need no tuning at all.

**⛔ Do not raise the 120-minute threshold, and do not raise the streak count from 3.** Both are the
"threshold is right, the input is wrong" mistake this pillar has now made five times; the file's own
comment names four of them eleven lines above the stress condition. **The streak is not a recovery
signal at all** — it is a proxy standing in for one, and §2 is the argument for replacing it rather
than retuning it.
