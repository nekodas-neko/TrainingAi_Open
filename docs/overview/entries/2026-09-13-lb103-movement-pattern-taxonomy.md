# 2026-09-13 — the push/pull/legs grouping Q-305 was blocked on (LB-103)

**Branch:** `lane-a/lb103-movement-pattern` · one shared module addition, two new test files, docs.
No product code renders it yet, no user-visible change, no version bump.

## Why it existed as a sentence and not an entry

Q-305's `Keep:` said the push:pull half *"belongs in `packages/shared` … which is Lane A's"* — and
there was **no Lane A entry for it**. It lived only inside a Lane B entry, so
`next-item.js --lane A` had never listed it and never would. Lane B filed LB-103 after finding it
while scanning PARKED; this is that entry built.

Q-305 had already rejected computing the grouping inside `weekly-muscle-sets-card.tsx`, and for the
right reason — a private second copy in `components/` is exactly the divergence One Formula One Place
exists to stop. So this is not a re-litigation of that call; it is the module that call implies.

## What shipped

`movementPattern(muscle)` and `CLASSIFIED_MUSCLES` in `packages/shared/src/muscles.ts` — beside
`normalizeMuscle`, because the grouping is a property of a muscle's **name** rather than of anyone's
volume table. Synonyms fold first, so the catalogue's own `core` resolves to `abs`.

**Two genuine judgement calls, written into the module rather than buried in a lookup table:**

- **`shoulders` is push.** The vocabulary has one shoulder name and the muscle does not split that
  way — anterior and lateral heads press, the rear head rows. Splitting it properly needs `rear delts`
  as its own catalogue name, which is a data change, not this one.
- **`lower back` is neither.** It loads on deadlifts, rows, squats and carries alike, so counting it
  as pull would inflate pull on leg days and counting it as legs would inflate legs on pull days.

## The part worth copying

**`other` is a real bucket, which makes an unmapped muscle invisible.** Abs, obliques and the lower
back belong there deliberately — so a muscle nobody classified lands in exactly the same place and
looks identical from the output. A unit test asserting a hardcoded vocabulary is a **snapshot**: add a
muscle to `exercise_library` tomorrow and it keeps passing while the new name silently joins them.

So the coverage assertion reads the **database** — every distinct muscle name the real catalogue
stores must have a pattern, and the failure message names the file to edit. Measured 2026-09-13: 146
exercises, 18 distinct names, all classified. It is the same shape as LA-103 earlier today: a rule
fitted to the data it was written against is only safe while something checks the data.

## Verified

- **Mutation pass: four mutants, all killed** — `shoulders` flipped to pull, `lower back` folded into
  pull (the two judgement calls), the synonym fold dropped (the catalogue's `core` stops resolving),
  and `hip flexors` deleted from the table, which is the one that proves the database-backed coverage
  test actually bites. One deliberately equivalent control — reordering the push block, same map,
  different source order — survived.
- 57 unit tests plus 3 database-backed ones. `pnpm check:rules` and the full suite green.

**Not exercised:** nothing device or runtime, and **nothing renders this yet** — Q-305's card section
is Lane B's and is now unblocked.

## Deliberately not done

**The shared-treatment question stays open.** Whether Q-278 / Q-302 / Q-305 want one common "computed
and discarded" surface has been untouched since 2026-08-25 and belongs to the owner or the
Orchestrator. Answering it inside this taxonomy would have prejudged it exactly as answering it inside
one card would have — which is the objection that produced this entry in the first place.
