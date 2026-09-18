# 2026-09-18 — RV-58/59/60: three shared modules whose contract and behaviour had drifted

**Branch:** `lane-a/rv58-60-shared-module-drift` · **Lane A** · batch `shared-module-drift-sweep50` · one PR · no migration · unversioned

Batched because they share exactly one property: each is a pure shared function whose defect is only
visible by calling it. One test file, no fixtures, no database.

## RV-58 — case folded on one side only

`equipmentEligible` lowercases the exercise's labels; `buildEquipmentSet` lowercased neither the
owner's selections nor the `full_gym` shorthand. So `equipmentEligible(['Barbell'],
buildEquipmentSet(['barbell']))` was **true** and its mirror was **false**, and
`buildEquipmentSet(['FULL_GYM'])` returned the shorthand unexpanded.

Not reachable today — the one producer emits lowercase ids and 0 of 156 catalogue rows carry a
non-lowercase value — but both API schemas take a bare `z.array(z.string())`, so nothing constrains
the next producer. Both sides fold case now.

**The entry's sharpest point is about the test, not the code:** the shipped
`catalogue-equipment-guard.test.ts` exercises only the exercise side, which is exactly what makes
half-coverage read as case-insensitivity. The new cases assert the **mirror**, and the mutation pass
shows why that matters — against the original, "exercise upper, owned lower" **passes** while its two
mirrors ("exercise lower, owned upper" and "both upper") **fail**. The asymmetry is demonstrated
rather than asserted, and a suite that held only the passing direction would have reported the module
as case-insensitive.

## RV-59 — summing mixed units and labelling by row order

`summariseSupplementDay` added every amount and took the first non-null unit as the label, so
`1 mg + 2 g` reported **`3 mg` or `3 g` depending only on which row the loop saw first**.

The entry said to decide the semantics before coding: convert to a canonical unit, or refuse. The
data settles it — **`unit` is free text** (`string | null`) and the vocabulary in use includes `ml`
and "1 scoop" beside `mg`/`mcg`, which have no conversion to a mass. There is no canonical unit to
convert to, so refusing is the only option that cannot be wrong.

A mixed day now reports `amount: null`, `unit: null`, and a new optional `mixedUnits: true`. The
field is **optional on purpose**: `applyManualToggle` in `components/nutrition/` also constructs this
type and is **Lane B's file**, so a required field would have broken another lane from mine.

`amount: null` now has two causes, and `mixedUnits` is what tells them apart — the other being "no
contribution carried a number", which is a tick meaning *taken*, not *took none of it*.

**A flaw in my own first version, found by reasoning rather than by a failing test:** a tick with no
amount still increments `contributions`, so counting those as "a previous contribution" made the next
real number compare against a unit nobody had set, and an ordinary day came out mixed. The guard is
"first NUMBERED contribution", and there is a test for exactly that case — it passes against the
original code too, because the original never set the flag, which makes it a regression guard for the
fix rather than a proof of the defect.

**A second flaw, found by a test I had not written — and the narrowing it forced.** My first version
treated a **null** unit as disagreeing with a named one, which turned `5` + `3 g` into a mixed day.
That broke `components/nutrition/__tests__/supplement-day-totals.test.ts`'s *"takes the unit from the
first contribution that HAS one"* — a case whose comment shows it was decided deliberately: a missing
unit **inherits** from a sibling. RV-59's evidence is `mg` versus `g` and says nothing about null, so
overriding that decision would have been a change on no evidence. The fix now refuses only on
**named** units that disagree, and I corrected my own test, which had asserted the opposite.

**One pre-existing test legitimately had to change.** In that same file, *"keeps the FIRST unit any
contribution supplies, not the last"* pinned `5 mg + 3 g → 'mg'` — the exact tiebreak RV-59 calls the
one option that cannot be right (that day is 3.005 g, so either label is wrong by three orders of
magnitude). It is now *"refuses to total a day whose contributions name DIFFERENT units"*, asserting
the refusal, with the original comment's point kept: a day whose contributions disagree is what
separates the options, and the single-unit case above it cannot.

## RV-60 — a branch that could not fire, telling the user the wrong thing

The module ships two strings that exist to tell two cases apart: *"Zone 2 is done for the week"* and
*"No Zone 2 target set this week"*. It chose between them on `zone2 == null` — but
`computeZoneQuota` represents "no target" as a **row** with `status: 'not-required'`, never as a
missing row, and `zone-quota.test.ts` pins that distinction deliberately.

So the null branch was unreachable from real data and a user with no target was told their target was
**done**. It now tests `zone2 == null || zone2.status === 'not-required'`; the old shape still works,
though nothing produces it.

Impact today is zero — `recommendWalkPattern` has no production caller yet (that is TN-25's residue,
re-laned to B this morning). Fixed before the first consumer lands rather than after.

## Verification

`packages/shared/src/__tests__/rv58-60-shared-module-drift.test.ts`, **18 passing**. Against the
three original modules restored from `main`, **6 fail and 12 pass**; the rewritten case in
`components/nutrition/__tests__/supplement-day-totals.test.ts` fails against the original too, so the
mutation pass across both files is **7 fail / 27 pass**.

| passes against the original | why it is there |
|---|---|
| `exercise upper, owned lower` | the direction that already worked — its two failing mirrors are what show the asymmetry |
| still refuses equipment the lifter does not have | folding case must not make unrelated kit match |
| still totals a single-unit day | a fix that simply stopped summing would pass every mixed case |
| an earlier tick with no number does not make a day mixed | regression guard for the first-numbered flaw above |
| no amount and no mix when nothing carried a number | "taken, quantity unknown" is not zero |
| still says the target is done when it was set and met | the other half of RV-60's distinction |
| no target when the zone is absent entirely | the shape the old branch was written for |
| three pattern-threshold cases (15 / 44 / 45) | the boundaries must not move |

Both row orders are asserted for RV-59, because "depends on row order" is the defect and one order
alone cannot show it.

Gates: `tsc --noEmit` real exit 0, Custom Rules 75 of 75, `check-test-typecheck`, full suite before
committing.

## Not exercised

- **The S25 device.** Pure shared functions, no UI change, Railway deploy, no APK.
- **A mixed-unit day in production.** There is none: `claude_ro.supplement_logs` holds 5 rows, all
  `manual`, units `mg`/null, and no day has more than one contribution — *the owner's rows only*.
  So RV-59 is a latent defect fixed before it could be observed, not a reported one.
- **Any caller of `recommendWalkPattern`.** There still is none.
- **`supplementSubtitle`'s rendering of a mixed day.** It reads `loggedAmount` and lives in
  `components/`, which is Lane B's; it branches on `amount == null`, so it renders a mixed day
  exactly like an amountless tick — the one thing it is not. `mixedUnits` exists to separate them and
  nothing reads it yet. Filed as **LA-119** rather than fixed across the lane boundary.
