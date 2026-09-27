# 2026-09-27 — LA-157: the uneven gaps WERE the label fall-through, and they are already fixed

**Branch:** `docs/la157-contributor-gaps-measured` · **Lane:** Implementation B · **Code changed:** none.

## What it claimed, and what the render says

`LA-157` was the last item of `RV-217`: the Sleep contributors list shows *"larger vertical gaps
before Timing and Efficiency, which look like empty rows"*, seen in a device screenshot
(`t2-sleep-01`). The entry said to reproduce at 384 px first, and explicitly ruled out one cause:

> *"it is not the label fall-through, because those two rows always had labels."*

**Measured at 384 px dark with all ten contributors present: every row is 48 px and every gap is
exactly 10 px.** No uneven spacing, nothing that reads as an empty row.

## The diagnosis, from an accident

The first stub used invented keys (`rem`, `total`, `deep` instead of `rem_sleep`, `total_sleep`,
`deep_sleep`). Those three rows rendered **17 px tall with lowercase raw labels**, while every
correctly-keyed row rendered at 48.

That is the reported symptom exactly. **A contributor with no label does not go missing — it renders
as a short, unlabelled row**, and a 17 px row between 48 px neighbours reads as a gap.

So the entry ruled out the right cause by looking at the wrong rows. It reasoned from Timing and
Efficiency, which always had labels; the short rows were `hrv`, `hr` and `schedule`, which **did
not** have labels when that screenshot was taken. Sorted by score, they sat next to Timing and
Efficiency, so the gap appeared *beside* the labelled rows rather than on the unlabelled ones.

**`RV-217` fixed it on 2026-09-27** by giving those three labels and contributor-guide entries. The
same PR added `rv217-every-contributor-has-a-label.test.ts`, which derives the key set from the model
and asserts *"a human label for every one — never the raw key"* — so the root cause is guarded, and
the symptom cannot return through that door.

`LA-157` is removed: its remaining item was fixed by the entry it was split from, before anyone
looked.

## Worth knowing when reading the next screenshot

**An unlabelled contributor is a 17 px row, not an absent one.** Somebody looking at a screenshot
sees whitespace and reasons about margins and `gap` utilities — which is what happened here, and
what sent the entry's own diagnosis past the cause. The list's container is a flat `space-y-2.5`
with no per-row overrides, so **uneven spacing there is always a row-height story, never a
container one.**

## Not exercised

The device. This is headless Chromium at 384 px, so the absolute numbers are the harness's — but the
claim is comparative (48 against 48, 10 against 10) and a renderer does not make nine equal gaps
unequal. The ten-contributor case is stubbed, since the seeded account has five; the stub uses the
real keys from `lib/oura/contributors.ts`, which is the mistake that produced the diagnosis in the
first place and is now the thing the fixture gets right.
