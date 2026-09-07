# 2026-09-07 — the plan-rescale failure was another spec's food, and it reproduces locally (LA-67)

**Branch:** `fix/la-67-plan-rescale-residue` · **Lane B** · e2e only, no app code changed.

## What was failing

```
e2e/plan-rescale.spec.ts › the floor leaves the meals as planned and says why
Locator: getByText(/under a meal — the remaining meals are left as planned/)
Expected: visible ... Error: element(s) not found
```

Four failures across two CI runs, first attempt and retry each time. Its sibling in the same file
passed, so the fixture, the plan and the page all loaded.

## The entry's two premises, both wrong

**"It reproduces only in CI."** It reproduces here in **5.6 minutes** — run the file after its
alphabetical neighbours instead of alone. `npx playwright test calorie-progress-bar
diary-nested-meal food-log-swipe-delete meal-portion-scale meal-thumb-placeholder
meal-type-reassign plan-day-fill plan-meal-to-saved-meal plan-rescale recipe-image-to-meal`
→ 25 passed, 1 failed, that one. Running a spec alone and calling it CI-only is the mistake; the
suite is `workers: 1` and serial, so every earlier spec's leftovers are part of this one's input.

**The timezone hypothesis.** It could not have been right, and the entry contained its own
refutation: if the fixture's food log landed on a different local day, `eaten` would read 0 and the
**first** test — which asserts three adjusted rows summing to target minus eaten — would fail too.
It passes. So the log is read correctly.

## What it actually was, measured

`plan-day-fill.spec.ts` exercises the *"Log the 1 meal so far"* button. That button writes **real**
`food_logs` through the app, and the spec removed nothing — no `afterAll`, no `DELETE`. Its own
comment explains the per-run unique names and concludes *"CI gets a fresh database and would never
show it"*, which is true of that file and false of every file after it.

Measured in the local database straight after the reproduction: one leftover row, **`E2E Morning
Oats mtrtocv7`, 100 kcal**, dated today.

The arithmetic closes exactly:

| | plan-rescale alone | with the 100 kcal residue |
|---|---|---|
| test 1 — `eaten` | 900 → factor 0.55 | 1,000 → factor 0.50, all three ≥ 250 kcal — **still passes** |
| test 2 — `eaten` | 1,900, budget **100** → floor branch | 2,000, budget **exactly 0** → `budgetRemaining <= 0` branch |

The over-target branch renders *"You're 0 kcal past today's target…"*, which does not contain
*"under a meal —"*. The copy the spec waits for genuinely never rendered. **No defect in
`plan-rescale.ts` or the card** — the note it produced was correct for the day it was given.

100 kcal is also the smallest residue that could do this: below 100 the floor branch still wins, and
above ~267 the first test breaks too and the failure would have looked nothing like a one-test bug.

## The fix, both halves

**The leak, at source.** `plan-day-fill.spec.ts` gets an `afterAll` that deletes its logs and items
by name — the ids belong to the app, not the spec.

**The dependence, at the reader.** `plan-rescale.spec.ts`'s `setEaten(kcal)` now means *make the
DAY total this*, netting off whatever else is logged, and fails with a legible message if the day
already exceeds the fixture. It reads the residue rather than deleting it: another spec's rows are
not this one's to remove, and the next spec that logs food through the UI will be back.

## Verified

- Reproduced first: 1 failed of 26, the named test.
- Both fixes, same command: **26 passed**.
- The reader half proven independently — planted a foreign 400 kcal log (four times what broke it)
  and ran `plan-rescale` alone: **both tests pass**.
- `pnpm lint` 0 errors · `npx tsc --noEmit` clean.

## Not verified

Not run on device, and it does not apply — this changes two Playwright specs and no shipped code.
