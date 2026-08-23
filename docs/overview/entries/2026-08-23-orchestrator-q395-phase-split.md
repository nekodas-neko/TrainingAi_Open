## Orchestrator — Q-395 split into a phased chain (2026-08-23)

Q-395 was a **269-line queue entry** describing a nutrition rework across sixteen screens, listed as
one thing an implementer could pick up. Its own §14 sequenced the work into phases; nothing in the
queue expressed that, so `next-item.js` offered the whole rework as a single startable item and the
phasing had to be inferred by reading to the bottom.

### The chain

```
Q-406  → Q-395a → Q-395b → Q-395c → Q-395
row      quantity  day       Log Food  checkpoint
         sheet     screen    + rename
```

| entry | phase | the thing that would go wrong without it |
|---|---|---|
| **Q-406** (exists) | one shared `food-row.tsx` | a food reads four different ways today; the sixth copy is the one the reuse rule forbids |
| **Q-395a** | quantity sheet + Edit Meal | the srv/g toggle is a hand-rolled segmented control at 40 px — the app's smallest target |
| **Q-395b** | the day screen | **the 11-section coverage list.** The first draw showed 3 of the 11 sections this tab renders |
| **Q-395c** | Log Food + `My Foods` | **the rename sweep.** Two names for one list is the defect; a surface left behind reads as a second list missing rows |
| **Q-395** | the spec, `Needs: Q-395c` | it is the completion checkpoint, not work — and should never be picked up as a work item |

**Q-406 turned out to be the entry point rather than a prerequisite, and its own text says why.** It
was filed as "extract the row first so Q-395 has somewhere to land", then corrected on 2026-08-19:
extracting a food row frees **zero** lines from either landing file, and the four call sites are four
*different* shapes, so a faithful component is a wrapper rather than a unification. Its conclusion —
*"the row cannot be extracted without first deciding what it should look like, and that decision is
Q-395's"* — reads as a blocker and is now satisfied: the design is settled, so Q-406 is startable and
is phase one. Its **headroom half already shipped** (v1.325.3): `nutrition-content.tsx` 800 → 732 and
`saved-meals-sheet.tsx` 793 → 753, which was the hard CI blocker, since both sat exactly at the
800-line ceiling where one added line fails Custom Rules.

### What the phases carry, and what they deliberately do not

Each phase points back at Q-395's findings instead of restating them, so the decisions keep living in
one place — that is also what kept the split affordable. What is **not** delegated back is the three
warnings that describe how this rework fails quietly, because they have to be where the work is:

- the 11-section coverage checklist (Q-395b), reproduced in that PR body and ticked off;
- the `Saved meals` / `My Meals` / `My Foods` rename swept in **one** pass (Q-395c) — the owner
  caught the half-done version instantly: *"So im picking up a discrepancy between My Meals and My
  foods? Whats the difference"*;
- diffing `FoodLibrarySheet` against `SavedMealsSheet` before merging them (Q-395c), so bulk delete,
  meal-plan linkage and the label path survive the merge or are named as dropped.

### Cost, recorded rather than absorbed

`docs/implementation-backlog.md` baseline **11334 → 11359**. The split was 81 lines before trimming
and is 25 after. The reasoning is in
[`docs/doc-size-baseline-history.md`](../../doc-size-baseline-history.md) — the ratchet exists so growth
is deliberate, and raising it with a written reason is the deliberate path, not a way around it.

Linked from [`docs/domains/nutrition/README.md`](../../domains/nutrition/README.md) in the same PR,
per the rule that a pillar's index is supposed to be a complete answer.

### Verification

`pnpm check:rules` — **52 of 52**. `check-backlog-pointers` — 198 entries, 13 `Needs:` with no
cycles and every target known. `next-item.js --lane B` places Q-406 at **#6 READY** with Q-395a/b/c
parked behind it in order and Q-395 parked as the checkpoint.

**Nothing reordered.** The phases were inserted adjacent to Q-395, at its own priority.

**Not exercised:** nothing here touched the app. No runtime, no device, no version bump.
