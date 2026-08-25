# 2026-08-25 — the scan route stops merging several meals into one (BF-11b)

**Branch:** `feat/scan-multi-candidate` · **Lane A** · `app/api/nutrition/scan/route.ts`, v1.372.0.

`ScanSchema` returned exactly one `name` + one `ingredients[]` for every input, so a week of
meal-prep containers, a page with four recipes, or *"lunch was X, dinner was Y"* was forced into one
merged estimate. The route now returns a candidate per meal.

## The shape, and why the top level did not move

The model returns `candidates` **only**; the route builds the response's top level from
`candidates[0]`. Asking the model for both would mean the first dish is described twice and could
disagree with itself — and `toMeal()` builds the top level and every array entry, so the two cannot
drift. A test asserts `candidates[0]` deep-equals the top level.

**The top level had to stay a single meal.** BF-11b says four call sites read it and names
`saved-meals-sheet.tsx`. **Both halves are wrong**: that file does not call this route — its `fetch`
goes to `/api/nutrition/saved-meals` — and there are **five**, the two missed being the ones that
matter most: `my-meals-picker.tsx` reads `body.ingredients` and `ingredient-picker.tsx` gates on
`scan.calories > 0`. Either would fail *silently* if the top level became an array. The plan
(`plans/2026-08-24-meal-creator.md` §4.1) is corrected in this PR, because BF-11c reads it next.

## The measurement that changed the work

The splitting decision is a model behaviour, and the plan is explicit that it is the whole risk in
this item. The first version of rule 5 ended *"When in doubt, return one"* — which fought its own
repeated-portion clause. Five **identical** tubs, six runs:

```
5, 5, 1, 1, 5, 1
```

**A coin flip on the feature's headline case.** One passing run would have shipped it; six runs found
it. Splitting the rule in two — *unsure whether components share a plate → one* and *separate
portions are separate **even when identical*** — and re-measuring:

| case | want | 5 runs |
|---|---|---|
| five meal-prep containers | 5 | 5, 5, 5, 5, 5 |
| three identical tubs of chilli | 3 | 3, 3, 3, 3, 3 |
| lunch wrap + dinner bolognese | 2 | 2, 2, 2, 2, 2 |
| curry + rice + naan on one plate | 1 | 1, 1, 1, 1, 1 |
| six-component mixed grill | 1 | 1, 1, 1, 1, 1 |
| a banana | 1 | 1, 1, 1, 1, 1 |

**30 of 30.** The bottom three exist because sharpening the split rule is exactly the change that
could start cutting one crowded plate into six; the seesaw was measured, not assumed.

## Bounds

Candidates cap at **8**; a candidate with no ingredients is dropped rather than shipped as a named
zero (totals are summed from that list); `identified: false` still returns none, and so does a list
whose every entry is empty. A stated `recipeYield` divides **each** candidate — a per-response divide
would leave dishes 2..n at whole-batch calories, a 4× overstatement that looks entirely plausible on
a card. Where one page states one yield across several dishes the division is ambiguous, so the note
says it was applied to each rather than dividing silently. The JSON-LD page name is used only when
there is exactly one candidate; with several it describes the page, not any dish.

## Verified

- `multi-candidate.test.ts` — **10 passed**, model mocked. **Mutation-proven three ways:** removing
  the cap, dividing only the first candidate, and keeping empty candidates each fail their own tests
  and no others.
- `splitting-decision.live.test.ts` — **6 passed** against the real model. **It does not run in CI**
  and is gated on `RUN_LIVE_AI_TESTS=1`, not merely on a key being present, so a key in the CI
  environment cannot silently turn every PR into a paid non-deterministic run.
- Full suite **588 files / 4,821 tests passed**, 0 failures. `pnpm check:rules` **Ran 56 of 56**.
  `tsc --noEmit` clean, `pnpm lint` 0 errors.
- **Through `pnpm dev` against the local DB**, logged in as the seeded user: multi-dish text → 2
  candidates with the top level deep-equal to `candidates[0]`; `200g grilled chicken breast` → 1
  candidate, 330 kcal / 62 g protein; a car park → `Could not identify food`; an empty body → 400
  `Provide image+mimeType, text or url`.

## Worth knowing for the next AI item

**The model is reachable from an agent sandbox.** `GOOGLE_GENERATIVE_AI_API_KEY` is set and
`generateObject` works through the proxy, so an AI behaviour change can be *measured* here rather
than reasoned about. No baton had recorded this. The measurement above is the argument for using it:
the defect it found was invisible to a single run, to the type checker, and to every mocked test.

## Not exercised

- **No image and no URL was scanned end-to-end.** Both branches are covered by mocked tests and share
  the same `toMeal` path, but every live call was the text branch.
- **Nothing on the device.** No UI consumes `candidates` yet — that is BF-11c (Lane B) — so what
  reaches the S25 today is only the changed top level for a multi-dish input.
- **The live test's 30/30 is one afternoon's model.** It pins the split against drift only when
  someone runs it; CI cannot.
