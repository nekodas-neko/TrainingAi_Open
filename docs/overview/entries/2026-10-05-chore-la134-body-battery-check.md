# 2026-10-05 — LA-134: the Body Battery constants pass their own test, and there is not yet enough data to fit

**Branch:** `chore/la134-bb-replay-windows` · **Lane A** · harness + docs. **No constant, walk or model
version changed.**

LA-134 became startable on 2026-10-04 (three weeks after the 0.5 to 1 mg dose step). I ran it against
production rather than assuming a fit was owed.

## What the stored rows say

12 v6 days: **none end at zero** (v5: 27 of 52), end values 30–49, **median daily net −2.5**. Both of the
entry's numeric criteria pass. **Only 5 of the 12 days are informative**; seven have 0–241 heart-rate samples
because the ring was not worn, so the battery holds. Five days cannot carry a fit, so the answer is *do not
fit yet*, with the date stated on the entry as a Keep rather than left as prose.

## Harness changes (`scripts/tuning/body-battery-replay.cjs`)

- **`--check [prefix]`**: the pass test on the stored rows, filtered by model version, with the count of
  informative days beside the verdict, labelled INSUFFICIENT under 20. `summarise()` is exported and tested.
- **Windows:** `bundleShared` spawned a bare `npx`, which does not exist on Windows (it is `npx.cmd`, and
  Node only spawns that through a shell). Fixed, so `--validate` runs here.
- **Found, not fixed:** the header advertises `--sweep`, which was never in the file. And `--validate`
  fails on the v5 row of 2026-09-22 because it replays under the v6 walk. Both are stated on the entry.

## Verified

`la134-body-battery-check.test.ts` (5): version filtering, the owner's twelve days as PASS-but-INSUFFICIENT,
fail cases, sufficiency, and an empty version is not a pass. Run live against the pulled rows it prints the
numbers above.

## Not exercised

A fit, because the data does not support one.
