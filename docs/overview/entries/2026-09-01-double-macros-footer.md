# 2026-09-01 — the footer that repeated a group's own macros

**Branch:** `fix/bf-98-double-macros` · **Entry:** BF-98 · **Lane:** B · **Version:** v1.418.2

## The report

Owner, with a screenshot: *"the combined item UI doesnt look great with the double macros at the
bottom."* `P 30g C 7g F 5g` twice, stacked, under PRE WORKOUT (BREAKFAST) — once as the Protein
Shake group's own row, then again as the section's totals footer, with the calories doubled too.

**The condition counted the wrong thing.** `meal-card.tsx` gated the footer on `logs.length > 1` —
the **flat** list — so a group of three ingredients passed it. What the footer needs is how many
**rendered** rows there are, which the file already computes as `entries` from `groupDiaryEntries`.
One group is one row.

The rule was already written twelve lines above and applied to the *collapsed* branch: *"a single
row already states its own macros, so a footer would repeat it."* A group is also a single row; the
expanded branch was never told.

`entries.length > 1`, checked against every case: one loose row → no footer (unchanged); two loose
rows → footer (unchanged); one group plus a loose row → footer, correctly, because the numbers then
differ; **one group alone → suppressed**, which is the only behaviour that changes and is the report.

## What is NOT verified, and it is the interesting part

**The duplication could not be reproduced in e2e.** `diary-nested-meal.spec.ts` already seeds this
exact case — one saved meal, three ingredients, alone in its section — and in that fixture the
totals footer **does not render on either condition**. A page-scoped test written against it
asserted the macros appear once and **passed with the fix reverted**, which makes it a guard that
cannot fail. It was deleted rather than kept green.

Measured while diagnosing, with the revert verified in place: `P 24g` renders **once**, `450 kcal`
**not at all**. So `MealTotals` is not rendering in that fixture at all — not in the expanded branch
and not in the collapsed one. What differs between the owner's diary and the fixture is unresolved:
a `savedMeals` map that resolves differently, a meal type carrying other content, or the collapsed
branch being what was photographed. **That question is recorded on the entry rather than closed.**

That first test's own comment had described the duplication as a known fact — *"the meal card's own
totals footer prints the same figures whenever the meal is the only thing in that meal type"* — and
scoped around it. The measurement says that comment is wrong for this fixture. It was left
untouched rather than rewritten on a premise this session could not confirm either way.

## Verification

- **17 unit tests** (10 pre-existing, 7 new): five pinning what `groupDiaryEntries` returns for each
  of the entry's enumerated cases, and two source guards that the card reads `entries.length` and
  that the collapsed branch still reads `logs.length` — a different question with a different right
  answer. **Mutation-checked:** reverting to `logs.length > 1` fails the guard.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers, doc-size and
  doc-links all exit 0, each read by exit code.

**Not exercised: the rendering, and the device.** Both vitest projects run `environment: 'node'`, and
the e2e that would have covered it does not reproduce the case. The owner's screenshot is the only
place the duplication has been seen, so the entry carries `Verify: device`.

## Also: BF-97's lane, measured rather than guessed

BF-97 (a scanned meal still lands as N loose rows) was filed *"Lane: B for the diary rule; A if the
scan write path has to mint the group id."* It does: `app/api/nutrition/scan/route.ts` only
*analyses*, and the write is `logFoodEntries` in **`packages/shared/src/nutrition/log-food.ts`**,
called from `food-logger-sheet.tsx`. That is `packages/shared/**`, and the recommended fix also
needs the diary rule in `components/` — both lanes, so **Lane A, engine half first**. The entry now
says so, so the next implementer does not re-derive it.
