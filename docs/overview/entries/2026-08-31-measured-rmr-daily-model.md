# 2026-08-31 — BF-42: the daily energy model predicted a resting rate it had been given

**Branch:** `lane-a/next` · **Lane A** · `lib/health/energy-balance-service.ts`. No APK.

BF-33 wired the measured RMR into `calculateBaseline` — the goal wizard. The live daily model is a
third path and was missed: it computed its own Cunningham BMR and never read
`getLatestMeasuredRmr`. Two screens, two resting rates for one person.

**The owner entered the results on the S25 today**, so this stopped being hypothetical while the
entry sat in the queue: `measured_rmr` = **1325 kcal at 51.5 kg FFM**, `dexa_scans` = **28.5 %**,
both dated 2026-08-27 and both confirmed in production.

## It was also the floor, which is the half that silences the calibration

`restingBaseKcal` is `Math.max(round(bmr), round(maintenanceKcal − avgActiveKcal))`. The floor's
comment — *"resting burn can never fall below BMR"* — is sound. The bug is that `bmr` was a
prediction while a measurement existed. For this owner the prediction is **1481** and the
measurement **1325**, so the floor sat **156 kcal above** the measured rate and clamped the
calibrated maintenance up to it. The calibration could not report the truth even when the data said
so.

`bmr` is now the measurement when there is one, so the base and the floor move together.

## The interaction with BF-2, which is the part a direction-only test misses

`personalRmr` re-scales the measurement's Cunningham residual onto **today's** fat-free mass, and
`ffm_kg_at_test` came from the DEXA. So today's has to be the DEXA-**corrected** scale reading, not
the raw one — the two sides must be on one instrument. Passing the raw 25.3 % credits fat-free mass
the owner does not have and reports ~50 kcal/day more than the measurement supports.

**My first test for this did not catch it.** It asserted a *direction* (`personalRmr(raw) >
personalRmr(corrected)`) on the pure function, which is true regardless of what the service does —
the mutation that swaps the service onto the raw value survived it. The test now asserts the exact
expected number through `computeEnergyBalance`:

```ts
expect(res.balance.restingBaseKcal).toBe(Math.round(onCorrected * SEDENTARY_MULTIPLIER))
expect(res.balance.restingBaseKcal).not.toBe(Math.round(onRaw * SEDENTARY_MULTIPLIER))
```

and the mutation dies. Worth recording because the first version *looked* like coverage: it named
the right concept, exercised the right numbers, and could not fail.

## Verified

- 8 DB-backed tests in the consumers file (2 new); **2 mutations killed** — ignoring the measurement
  (the original bug) and re-scaling onto the raw body fat.
- `pnpm check:rules` **Ran 66 of 66** · `tsc` clean · `check-body-fat-correction` OK.

## Not exercised

No runtime pass on `pnpm dev` for this one — the behaviour is covered by the service-level test
above, which calls `computeEnergyBalance` directly with the owner's real numbers. Device,
safe-area and WebView paths do not apply.

---

# BF-67 step 2 — a new program can reference an old one (engine half)

Same branch. `/api/generate-program` takes `referenceProgramId` and puts the referenced program's
structure into the prompt. **Steps 3 (the picker, Lane B) and 4 (the history summary) are not built,
so nothing reaches the owner yet — the parameter has no caller.**

**An id, never a program object.** The structure is read server-side via `listPrograms(userId)` and
the id matched against what that returns, so a program the caller does not own is simply absent with
no separate not-found branch to distinguish the two from outside. Accepting the structure from the
client would be an ownership hole and a prompt-injection surface for nothing the id does not give.

**Bounded at the schema, not by hoping** — 10 sessions × 20 exercises. The note above
`MAX_BODY_BYTES` already records that `equipment` and `musclesToFocus` are unbounded arrays held only
by the byte cap; a program is a larger structure than either. A real five-session program is ~30
names, so the caps do not bite.

## The drift caveat is real, and measured rather than assumed

The plan and the entry both warned that the reference payload must send the library's own names,
because LA-43's resolver deliberately refuses subset matches. Measured against the seeded program:
`Tricep Pushdown` and `Lat Pulldown` resolve, `Front Barbell Squat` → `Barbell Front Squat`, and
**`Bench Press`, `Overhead Press`, `Deadlift`, `Bicep Curl`, `Romanian Deadlift` and `Calf Raises` do
not resolve at all** — the library holds `Barbell Bench Press`, and "Bench Press" is a subset of it.

Those enter the prompt as stored free text. That is the right fallback: the model reads them as
intent, and rule 2 still binds its output to the available list. It is not silently wrong, but it is
weaker than a resolved name, and the entry now says so.

**End-to-end against real Gemini, same inputs with and without the reference:**

| | without | with |
|---|---|---|
| Push #2 | Incline Bench Press | **Barbell Overhead Press** ← referenced |
| Legs #2 | Leg Press | **Barbell Front Squat** ← referenced |

So the steer works through the drift. **My first check said otherwise and was wrong** — it compared
the output against the program's *stored* names, which the route never sends, so the intersection was
empty by construction. Comparing against the resolved names is what shows the effect.
