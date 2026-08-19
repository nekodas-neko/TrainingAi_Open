# 2026-08-19 — Q-323 (Lane A half): the macros follow the earned calories now

**Branch:** `feat/macros-follow-earned-calories` · Implementation Lane A · JS/server only, no APK.

## What was wrong

One TDEE model: `nutrition_targets.calories` is the **rest-day floor**, and the budget on screen is
`floor + earned from movement`. So the calorie figure moves through the day — and the macro grams
under it did not, because they come from the same stored row and are fixed. The card told the user to
eat 300 more kcal without saying of what.

## The rule, and the owner's decision behind it

Owner, 2026-08-19: *"%'s to calculate the protein/fat/carbs so that when it increase due to
excercise; the macros increase as well"* — then, after the arithmetic was put in front of them,
agreed to the amended version: **carbs and fat scale, protein holds.**

`scaleMacrosForEarnedKcal(base, earnedKcal)` in
`packages/shared/src/nutrition/calorie-balance.ts`:

- **Protein holds, for arithmetic reasons rather than taste.** It is dosed per kg of bodyweight, so
  150 g is ~2 g/kg. Re-express that as a share of calories and apply it to a bigger day and it
  becomes ~2.6 g/kg — a protein requirement that rises because the user went for a walk. Movement
  burns carbohydrate and fat; it does not create protein demand.
- **Carbs and fat absorb the earned kcal in the proportion they already hold to each other.**

**What that preserves precisely is the carbs:fat *energy ratio* — not each macro's share of the
day's total**, which cannot stay fixed while protein is held constant and the total grows. The
backlog entry's phrase "keeps both percentages stable" reads as the second, so both properties are
pinned by name in the tests: the ratio holds, and protein's share of the day necessarily falls. A
future reader checking the shares would otherwise report this as broken.

Splitting into carbs alone — Q-401's first answer — would instead drift fat's share downward as the
day's movement grows, which is why the ratio split was taken over it.

## Where it is called, and why not on the client

`computeEnergyBalance` already holds both halves — the stored targets and today's measured movement —
so the response gained a `macroTargets: { base, scaled, earnedKcal }` block. The client could have
done this itself from data it already has, and that is exactly the second implementation the
one-formula rule exists to prevent; `earnedKcal` is the same `activeEnergy.total` that
`balance.activeKcal` already carries, so the two cannot diverge.

It is populated on the **incomplete-profile early return too**. A missing date of birth blocks the
BMR formula and therefore the whole balance, but it does not make the stored macros unreal, and the
measured movement is independent of it.

## Verification

`npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of 49** · full suite green.

**9 unit tests** on the arithmetic, including an exact-split case (100 g carbs / 100 g fat / 1,300
earned kcal → both double, no rounding anywhere) that pins the split independently of gram rounding.
That case exists because the realistic-figures test needed a looser tolerance and the reason is worth
recording rather than hiding: **a gram of fat is 9 kcal, so whole-gram rounding moves the carbs:fat
ratio by up to ~1% on its own.**

**Live against `pnpm dev`:** the endpoint returns the block, and with no movement today `scaled`
equals `base` with `earnedKcal: 0` — the correct no-op — via the incomplete-profile branch, which is
the one that needed checking because it is a separate return path.

## Not exercised, and it is a sandbox limit rather than a gap in the work

**The `earnedKcal > 0` path could not be driven live here.** Reaching it needs a complete profile,
and any such request calls `computeActiveEnergy`, which reads
`lib/oura-models/constants/energy-expenditure-features.json` — a vendored file this sandbox cannot
fetch (`MODEL CONSTANTS UNAVAILABLE — SignatureDoesNotMatch (403)` at boot). The request **500s on
unmodified `main` with the same shape**, checked by stashing this work and re-running, so it is
pre-existing and unrelated. The scaling itself is covered by the unit tests; what is unverified live
is only the wiring, and `earnedKcal` is by construction the same figure `balance.activeKcal` reports.

**Lane B's half is not here.** The two display changes the owner asked for in the same review — the
macro ring showing its remainder in grey, and the zone bar becoming a progress bar with a short
overshoot tail — are `components/**`, and the entry's own warning applies to them: **do the bar in the
same PR as the Q-415 budget fix, or it fills toward the wrong number.** The backlog entry stays,
annotated, rather than being removed.
