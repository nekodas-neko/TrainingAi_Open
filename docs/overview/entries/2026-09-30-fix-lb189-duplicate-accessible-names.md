# 2026-09-30 — LB-189: two controls, one name, both in the accessibility tree

**Branch:** `fix/lb189-duplicate-accessible-names` · v1.486.6.

Both energy-balance ⓘ toggles carried `aria-label="How energy balance is calculated"` —
`energy-card.tsx:218` on Nutrition and `calorie-balance-bar.tsx:75` on Health. **The tab shell keeps
every tab's tree mounted on purpose** (it is what makes a tab switch paint instantly), so a name that
is unique per screen is not unique per document.

Filed while proving BF-138's copy renders, after a document-wide
`getByRole('button', { name: … }).first()` clicked the **off-screen** one for a full 60 seconds while
`aria-expanded` stayed `false`. A dead-looking button that is really a mis-aimed one is expensive to
diagnose, and it is the same thing a screen reader hits: it cannot use the viewport to tell two
identically-named buttons apart the way a sighted user does.

## The census found a second collision of the same class

Named apart by the figure each explains, not by the screen it sits on:

| surface | component | was | now |
|---|---|---|---|
| Nutrition | `EnergyCard` | `How energy balance is calculated` | **`How today's calorie budget is calculated`** |
| Health | `CalorieBalanceBar` | `How energy balance is calculated` | **`How your energy balance is calculated`** |

Mount points confirmed by **export name**, not by path — `EnergyCard` from
`app/nutrition/nutrition-content.tsx:571`, `CalorieBalanceBar` from `app/health/health-sections.tsx:667`
keyed `"energyBudget"`. That is OR-187's lesson, and the OR-115 pass had already called a live
component dead by trusting a path grep.

Then a census of every static `aria-label` in `app/` and `components/` turned up **17 repeated
names**, of which **15 are legitimately repeated** and one more was the same defect as the ⓘ pair:

**`aria-label="Loading energy balance"` on two loading placeholders** —
`components/home/home-energy-balance-card.tsx:20` on **Home** and
`components/nutrition/calorie-balance-bar.tsx:33` on **Health**, both in the shell at once. Home's is
the compact card (its own docstring calls it *"a denser presentation of one number"*), so it reads
**"Loading energy balance summary"** now.

**⚠ Stated plainly: that second one is a weaker defect than the first.** Both are roleless `<div>`s
carrying `aria-label` and `aria-busy`, and a `div` with no role may have its accessible name ignored
altogether — so the duplicate may never have been announced at all. It is fixed because it is the
same class in the same domain and costs one word; **the roleless-skeleton question is a separate
finding and is not addressed here.**

The other 15 repeats are correct and are exempted with reasons: `Back`/`Go back`/`Close`/`Cancel`/
`Clear search`/`Refresh` are one-per-surface dismiss and navigation controls whose meaning *is* the
surface you are on; `Previous day`/`Next day` and the two look-back fields are the admin console,
which CLAUDE.md exempts; `Loading collection` pairs a **pushed route** against Home's card, and a
pushed route is not co-mounted with the tab it came from.

## The rename paid for itself in the test it was found by

`e2e/bf138-energy-model-explainer.spec.ts` carried an `evaluateAll`-across-two-matches workaround.
The locator resolves to one element now, so `openInfoPanel` is a plain
`getAttribute`/`toHaveAttribute` loop and **`toHaveCount(1)` is the standing guard against the
duplicate returning**. `e2e/nutrition-budget-honesty.spec.ts` gained the same count assertion.

**The two mechanisms that stay were never about the duplicate**, and the docstring now says so:
`tapInView` because the control can sit below the fold, and the `toPass` loop because `showInfo` is
local state on a card that revalidates in the background, so one click plus an assertion is a race.

## A guard, because prose did not hold this and nothing else would

`scripts/check-duplicate-aria-labels.js`, in the Custom Rules job — **`Ran 85 of 85`**. It fails on
any repeated *static* `aria-label` outside the exempt list, and the exempt list is where the
judgement lives: each entry carries its reason, and the bar is *"could a screen-reader user tell
which one they are on"* rather than *"does this string appear twice"*.

**Its blind spot is printed rather than hidden:** interpolated labels
(``aria-label={`Delete ${name}`}``) cannot be compared without resolving the expression, so the run
reports the count it skipped — **128 static labels compared, 97 interpolated ones not** — and a clean
result is never mistaken for full coverage. Same shape as `check-cache-ttl-divergence`'s
helper-built keys.

Also folded in: `calorie-balance-bar.tsx`'s info button had no `type="button"` while its sibling did,
so it would submit any enclosing form. One word, and the two controls are otherwise identical.

## ⚠ My own control run was wrong before it was right

The first control reverted **one** of the two ⓘ labels and the guard passed — which I nearly recorded
as the guard failing. It was the control that was wrong: with Health's button already renamed,
reverting Nutrition's alone does not recreate a duplicate. Reverting **both** trips it, naming both
`file:line`s. The repo's own lesson, met head-on: *a green run proves nothing about whether it can
fail* — and a control that cannot reproduce the defect is not a control.

## Verified

- `scripts/check-duplicate-aria-labels.js` — exit 0, and **control-run twice**: both ⓘ labels
  reverted → fails naming both sites; Home's loading label reverted → fails naming both sites.
- `e2e/bf138-energy-model-explainer.spec.ts` and `e2e/nutrition-budget-honesty.spec.ts` —
  **4 passing** between them (2 each), on the renamed locators and the simplified `openInfoPanel`.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 85 of 85** · `pnpm lint` 0 errors · `pnpm test` ·
  `pnpm build` · `check-backlog-pointers` exit 0.

## Corrected two earlier journal entries while here

BF-138's and BF-220's entries each claimed **"4 passing"** for a spec file holding **two** `test()`
blocks. 4 was Playwright's run total, which counts the `auth.setup.ts` and `zero-data.setup.ts`
projects alongside the specs — **so every spec run in this repo reports two more than it has**. Both
corrected in place with the cause; `grep -c '^test('` is the figure to quote.

## Not exercised

- **A screen reader.** The whole point of this change is what VoiceOver or TalkBack announces, and no
  container runs either. What is proven is that the names are distinct and that each control still
  resolves, opens and reports `aria-expanded` — necessary, and not the thing itself.
- **The roleless loading skeletons.** `aria-label` + `aria-busy` on a `<div>` with no role is weak
  regardless of whether the name is unique; a `role="status"` or a live region is the real answer and
  is out of scope here.
- **Nothing is device-owed.** No pixel moved: both changes are accessible names, and the
  `type="button"` addition is inert outside a form.
