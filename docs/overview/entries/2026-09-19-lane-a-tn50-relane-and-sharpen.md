# 2026-09-19 — TN-50 re-laned to B, its central number re-verified, and the defect sharpened

**Branch:** `lane-a/tn50-relane-and-sharpen` · **Lane A** · docs-only · no code, no migration ·
unversioned

TN-50 was filed by Tuning tonight and arrived at the top of Lane A's READY list. Re-verifying it
before starting — the protocol step, and this entry's own first draft had already been wrong once —
produced three things and no code.

## Its central number reproduces exactly

The entry claims the saved `energy_level` is what `readinessToEnergy(readiness)` would have
auto-selected on **45 of 62** days (73%). Re-run independently against production:

| days | matching the auto-fill | `ok` | `good` | `pumped` |
|---:|---:|---:|---:|---:|
| 62 | **45** (72.6%) | 36 | 4 | **0** |

Every figure holds, including `pumped` never having been logged. *(The owner's rows only —
`claude_ro` is row-scoped.)* Worth recording the confirmation rather than assuming it, given the
entry's history.

## The sharpening: the auto-fill biases the term UPWARD, not just circularly

`CHECKIN_ENERGY_SCORE.ok = 72` (`readiness-composite.ts:122`) while the documented `NEUTRAL` is
**50** (`:106`), and `readinessToEnergy(null)` returns `"ok"`. So a saved-but-unanswered check-in
contributes **72, not 50** — **+22 above neutral** — on the **36 of 62 days** that stored `ok`.

That matters for what happens when the fix lands: *"default to neutral"* will **lower** this
contributor on most days rather than leave it where it is, so the readiness line steps down visibly.
The owner's decision is unaffected — he asked for the term to tune on his response rather than infer
one — but the expected effect is now a number instead of a surprise.

## It has no Lane A engine half

Filed `Lane: A, then B` on the reasoning that *"the circularity and the `CHECKIN_ENERGY_SCORE`
mapping are `packages/shared`"*. Checked against the code, the circularity is **not** in shared: both
seed sites are `components/mood-checkin-sheet.tsx:86` (initial state) and `:177` (reset) — one Lane B
file — and the entry's own instruction is *"do NOT re-map `CHECKIN_ENERGY_SCORE`"*. Items 1 and 2 are
therefore a single-file Lane B change. Re-laned to **B**.

## Item 3 is better as a cutoff than a column — recorded as a recommendation, not a decision

Item 3 asks for storage that distinguishes "auto-filled" from "answered". A flag solves that
*going forward*, which is precisely the window item 1 eliminates: once the sheet stops seeding from
readiness, every stored value is an answer. What stays ambiguous is the **history**, and a flag added
now cannot label it — whether a past row was auto-filled is a statistical inference (the 73%), never
a per-row fact.

A dated line — *rows before the fix may be auto-filled, rows after are answers* — carries everything
the column would, applies to the rows that actually need it, costs no migration, and does not delay
items 1 and 2 behind one (a migration ships alone).

**Left as a recommendation because TN-50 is Tuning's entry and the implementer is Lane B**, who will
read it either way. Not removed, not decided unilaterally.

## Not exercised

- **The S25 device.** Docs only.
- **The fix itself.** Lane B's, and not started here.
- **What the readiness series looks like after the change.** The +22 figure is per-day on the
  contributor; the composite effect across history was not computed, and TN-50's own warning against
  re-tuning weights against this column applies to anyone who tries.
