# Plan — preset-aware rest compression (Q-85)

**Date:** 2026-08-15 · **Domain:** `workouts` · **Backlog:** Q-85 · **Branch:** `feat/preset-aware-rest-compression`
**Status:** plan only. Nothing implemented. **Needs one owner decision before code** — §4.

Q-83 fixed the warm-up double-charge and recovered ~3 working minutes at Quick, enough to give back
one exercise on the owner's real Push session. Q-85 is the finding that this does not generalise: the
drop thresholds sit ~6 minutes apart, so 3 minutes only crosses one by luck of where the session
already sat.

---

## 1. What the code actually does

Measured against `packages/shared/src/ai-periodization/time-budget.ts`, not inferred:

- `durationPreset === 'short'` → **`dropToBudget`**, which removes whole exercises in trim-priority
  order. Every other preset → **`fitToBudget`**, which only removes sets.
- Neither touches rest. `estimateSessionDurationSec` charges
  `work + (measuredRestSec ?? restSec)` per set, so removing a set removes its rest with it. That
  coupling is why the thresholds are ~6 min apart: one set of a compound at 180 s rest is ~3.5 min.
- `SET_FLOOR` is 2 for every role, so trimming alone bottoms out at 2 sets each and a five-exercise
  session still overruns 30 minutes there — which is exactly why `short` drops instead.

**Choosing "Quick" shortens the budget and leaves every prescribed rest untouched.**

## 2. The number that should decide this

On a representative five-exercise Push (4×5 @180 s, 3×8 @120 s, 3×10 @90 s, 3×12 @60 s, 3×15 @60 s),
untrimmed:

| | minutes |
|---|---|
| working time | **8** |
| rest | **29** |
| total (with transitions) | **62** |

**Rest is 79% of the session.** At short budgets it is not a component of the cost — it is the cost.

## 3. What compression actually buys, per policy

Exercises kept / total sets, through the real `dropToBudget`:

| budget | today | accessory −25% | acc+sec −25% | acc+sec −33% | all roles −25% |
|---|---|---|---|---|---|
| 21 | 2 / 4 | 2 / 4 | 2 / 4 | 2 / 4 | **2 / 5** |
| 24 | 2 / 5 | 2 / 5 | 2 / 5 | 2 / 5 | **2 / 6** |
| 27 | 2 / 6 | 2 / 6 | 2 / 6 | **3 / 6** | **3 / 6** |
| 29 | 2 / 7 | 2 / 7 | **3 / 6** | **3 / 6** | **3 / 7** |
| 32 | 3 / 6 | 3 / 6 | 3 / 7 | 3 / 7 | **3 / 8** |
| 35 | 3 / 7 | 3 / 7 | 3 / 8 | **4 / 8** | **4 / 8** |
| 41 | 4 / 9 | 4 / 9 | 4 / 9 | 4 / 9 | **4 / 10** |
| 45 | 4 / 10 | **5 / 10** | **5 / 10** | **5 / 10** | **5 / 11** |

**The safe-sounding option is the useless one.** Compressing accessories alone changes nothing below
45 minutes, because accessory rests are already 60 s — taking 25% off buys 15 seconds a set. Every
meaningful gain comes from compressing the **compound's 180 s**, which is precisely the rest that is
load-bearing at heavy loads.

That is the real trade, and it is sharper than the entry framed it: there is no version of this that
is both worthwhile and safe for the main lift.

## 4. The owner decision this needs

**At a Quick budget, should the main compound keep full rest?**

- **(a) Yes — protect the compound.** Compress accessory and secondary rest only (−25% or −33%).
  Gains one exercise around 27–35 min and nothing below. Honest framing: Quick stays "fewer
  exercises, properly rested".
- **(b) No — compress everything ~25%, including the compound.** The only option that improves short
  budgets across the whole range, and adds a set almost everywhere. Cost: 135 s rest on a 4×5 top set
  is a real reduction in what that set trains.
- **(c) Neither — leave it.** Quick means fewer exercises. Close Q-85 as measured-and-declined.

**Recommendation: (a).** Not because it is the bigger gain — it is not — but because (b) trades the
quality of the one lift the session is built around for one extra accessory, and the app's own
prescription logic protects the primary everywhere else (`SET_FLOOR`, `ROLE_TRIM_BIAS`, `TRIM_ORDER`
all order accessories first). Compressing the compound would be the single place that discipline is
reversed. If (a)'s gains look too thin to be worth building, **(c) is a better answer than (b)**.

## 5. If (a) or (b) is chosen — the shape

1. A `restScaleForPreset(preset, role)` helper in `time-budget.ts`, returning 1.0 for every
   preset/role pair except the chosen ones. One place, so the policy is greppable.
2. Applied where `timedExercises` is built in `generate-prescription.ts`, **before** the budget pass —
   the same position `applyRoleSetPlausibility` already occupies, so trimming sees the real shape
   rather than repairing one it was handed.
3. The prescription must carry the scaled `restSec` through to what the workout screen counts down,
   or the session will overrun its own budget in practice while the plan says it fits. **Verify this
   end-to-end** — the rest timer reads the prescription, not the program default.
4. Not applied to deload (`fittedDeload` already uses `DELOAD_REST`), and not to measured rest
   (`measuredRestSec`) without deciding whether a measured rest is an observation to preserve or a
   habit to compress. **Recommend leaving measured rest alone**: it is what the lifter actually did.

## 6. Verification bar

- A table test over the matrix in §3 — the policy's effect on exercise count is the whole feature, so
  it is what to assert, not the helper's return value.
- A case pinning that `restScaleForPreset` returns 1.0 for every non-Quick preset, so this cannot
  silently change a Standard session.
- The end-to-end check in §5.3: prescribe a Quick session, start it, and confirm the on-screen rest
  timer matches the compressed value.
- **Device-gated in one respect only:** the rest timer is a workout-screen behaviour, so `pnpm dev`
  can prove the number but not how it feels between sets.

## 7. Explicitly out of scope

- Changing `SET_FLOOR`, `TRIM_ORDER` or the drop/trim split. Q-85 is about rest.
- The `short`-only `dropToBudget` branch. Whether other presets should also drop rather than floor at
  2 sets is a separate question this measurement does not answer.
