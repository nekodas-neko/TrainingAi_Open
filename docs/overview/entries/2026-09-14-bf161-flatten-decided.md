# 2026-09-14 — BF-161's gate lifted: flatten (BugFix intake)

Docs-only, a one-bullet change. The owner answered the question BF-161 was filed with:
*"Okay lets go with flatten for now"*.

`Gate: owner` is removed. `next-item.js --lane B` now prints BF-161 at the **top of READY**, where it
was invisible while parked.

## What the decision fixes in the entry

The entry carried both options and a recommendation. It now carries an instruction: build the flatten
path, add no nesting column. That matters because *"for now"* invites a middle road — a nullable
`food_item_id` left in place against a future that may never arrive — and the whole reason flatten
wins on these numbers (15 saved meals, 1.9 items each) is that it needs no migration at all. If
propagation is wanted later it is a new entry with its own migration, not a half-measure designed in
now.

## The consequence, restated in the entry rather than left implicit

A meal built from saved meals is a **snapshot**. Editing the source afterwards does not change it.
The entry now says nothing on screen should imply otherwise — in particular, no "from <meal name>"
provenance chip, which would read as a live link to the thing that is deliberately not linked.

## Not exercised

Docs only.
