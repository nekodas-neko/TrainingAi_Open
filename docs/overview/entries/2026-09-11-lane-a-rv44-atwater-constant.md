# RV-44 — the nine longhand Atwater sites

**Branch:** `lane-a/rv44-atwater-constant` · **Lane A** · no migration, no native change.

`atwater.ts` exists because LB-9 found these factors written out in four places, and its header says
so: *"Six lines with no dependencies can be imported from anywhere, which is the property that stops
a fifth copy appearing."* Two files never imported it. `scan-totals.ts` had five longhand sites and
`meal-split.ts` four; `atwater.ts` was named only in comments.

All nine now import `KCAL_PER_G`. **No number moves** — every site already agreed at 4/4/9, which is
why the entry called it a consistency finding and warned against filing it as a wrong value.

## Why it was worth a control rather than just a green gate

A substitution that changes no output is indistinguishable from a substitution that changed nothing
at all — the tests pass either way, so passing tests prove only that the constant happens to match.
Setting `KCAL_PER_G.fat` to 10 and `protein` to 5 each failed **31 tests**, which is what actually
establishes the nine sites read the constant rather than sitting beside it.

## A note on the entry's own advice

RV-44 said it was *"worth doing when someone is next in those files rather than as a standalone
PR."* It shipped standalone anyway, after sitting at the top of the queue for a week with nothing
ahead of it — "when someone is next in there" had not happened and had no reason to. The advice is
sound about cost and wrong about likelihood: an item that only ships as a passenger needs a driver
to eventually turn up.

## Also worth recording

The mutation pass's baseline run exited **1 while reporting 2,621 passed and 0 failed** — the
LA-101 signature documented in `local-dev-database.md` hours earlier. It re-ran clean, which is the
response that file prescribes. The specific error line was overwritten by the next mutant before it
could be read, so this is a signature match rather than a confirmed third sighting.

## Not exercised

No device path, no APK, no API route changed — two pure functions in `packages/shared`.
