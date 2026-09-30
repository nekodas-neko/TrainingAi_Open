# 2026-09-30 — RV-208 ④⑤: one day-header date, and the food's own name first

**Branch:** `fix/rv208-date-and-brand-forms` · v1.486.4. The last two parts of `RV-208`; ①②③ shipped
2026-09-27/28.

Both were filed as *"copy decisions, untouched here"*. They were taken as structural ones, per
CLAUDE.md's 2026-09-22 narrowing — display-form consistency is not a product preference, and the
entry had sat waiting on an answer nobody was going to give it. **Both premises turned out to be
narrower than the defect, in opposite directions.**

## ④ — three day-header forms, and one of the entry's three examples is not convertible

Rendered rather than read, because `en-AU` does not behave the way any of these style names suggests:

| surface | style | rendered |
|---|---|---|
| Health → Day | `long` | `Saturday 26 September` |
| Nutrition tab | `weekday-date` | `Mon, 28 Sept` |
| Week-day sheet | `weekday-date-long` | `Saturday 26 Sept` |

**`'long'` app-wide**, on two measured grounds rather than taste. It is the only one of the three
that is internally consistent — `weekday-date-long` pairs a **long** weekday with the **short**
month, and `en-AU`'s short months are ragged-width (June, July and Sept are four characters, so a
column of them does not line up). And `weekday-date` is the only one carrying a comma, because
`en-AU` emits one after a short weekday and not after a long one: a quirk `formatDateDisplay`'s own
docstring records as the likeliest origin of a wrong string in a comment.

**Two of the entry's three examples are out of scope, and saying why is most of the work.**
`25 Sept` is a compact ROW label — activity history, the goals list, profile details — which is a
different job from a screen heading, and `RV-208` itself lists it under *numbers*. **`September 2026`
cannot be converted at all**: it is the calendar's month label, and `LB-126` already recorded the
reason in a test — `formatDateDisplay` takes a `YYYY-MM-DD` string and has no month-year style, so
adding one is Lane A's. Re-checked against `main`; unchanged.

**⚠ This replaced the NARROWEST form with the WIDEST on the one surface whose header shares its
row**, which is why it was rendered at 384 px and not reasoned about. Nutrition's date sits beside
two 44 px chevrons and a settings button, inside the single band `BF-24` deliberately collapsed it
to from two. Measured: **148.0 × 19.5 px inside a 300 px row** — one line, 52 px of slack.

`weekday-date` and `weekday-date-long` are now unreferenced outside tests. **Left in place** —
`packages/shared/src/date-utils.ts` is Lane A's file, and they are the vocabulary rather than debt.

## ⑤ — the entry's two sites were six, and two of them diverged in ways a screenshot cannot show

`Uncle Tobys — Rolled oats` in the food-database results, against the diary's `Rolled oats` over
`Uncle Tobys · 1 serving`. **The name leads everywhere**, through one helper
(`components/nutrition/food-name-line.ts`).

Not only for symmetry: **both brand-leading sites are SEARCH lists**, where the user typed the food
*name*, so leading with the brand pushes the term they matched on rightward into `FoodRow`'s
`line-clamp-2`. Sorting a list of one brand's products under a word nobody is scanning for is the
same defect in slow motion.

**The census — `<FoodRow` call sites, then every `${…brand…}` interpolation in `app/` and
`components/` — found two more kinds of divergence than "one form or the other".**

- **`food-list.tsx` was already name-leading**, with its own `[brand, serving].join(' · ')`. Right
  string, and still the failure this is about: a third copy agreeing by coincidence rather than by
  construction, which is what the other sites did until one of them stopped.
- **`ingredient-search.tsx` dropped the brand ENTIRELY.** So the library's `Search` tab did not
  identify a food that its own `Recent` tab did — invisible if you compare only the two lists the
  entry photographed.

`review-step.tsx` also interpolates a brand and is deliberately untouched: it builds an LLM prompt
context string, not a render, and already leads with the name. `quick-edit-log-sheet.tsx` is excluded
with its reason — a sheet header that already names the food and gives the brand its own line, so
there is nothing to separate.

## The render answered a question the source could not

The brand now rides `FoodRow`'s secondary line, which **`truncate`s** where the name line clamps. So
the change trades a possible truncation of the food's name for one of the macros, and no source read
says which the real string hits. Asserted with `scrollWidth <= clientWidth` — **a truncated element
still reports its full text, so `toHaveText` passes on an ellipsis nobody can read.**

## Verified

- `components/__tests__/rv208-one-day-header-form.test.ts` and
  `components/nutrition/__tests__/rv208-brand-follows-food-name.test.ts` — **8 tests**, pinning the
  rendered strings against literals rather than re-derivations, so a change to the shared option bag
  fails here instead of moving three screens silently.
- `e2e/rv208-date-and-brand-forms.spec.ts` — **2 passing** at 384 px dark.
- **Both control-run against the pre-fix code**, source and browser. The source guards failed on the
  right two assertions; the browser run failed naming the exact old strings, `Mon, 28 Sept` and
  `Uncle Tobys — Rolled Oats Quick Sachets`. The ④ control is worth noting: it fails on the **comma**,
  not on width, so the assertion is about the form rather than about the one surface that was tight.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 84 of 84** · `pnpm lint` **0 errors** ·
  `check-test-typecheck` clean against its 86-file baseline · `check-backlog-pointers` exit 0 · `pnpm build` exit 0.
- `pnpm test` — **11,102 passed, 0 failed** (1,210 files). ⚠ An earlier run of the same tree reported
  **4 failed**, all `Hook timed out in 10000ms` on a `lock.acquire()` in Lane A migration tests, none
  of them anywhere near this diff. They were contention: `pnpm build` was running against the same
  database and CPU. The one captured passed in **1.33 s** alone. Re-run serially, the suite is clean.

## ⚠ One thing this session got wrong, and it will happen again to whoever is next

**A stray line reached a commit, and a `finally` block is what made it invisible.**
`scripts/__tests__/check-comment-blindness.test.ts:41` appends `// style={{ color: "#ff0000" }}` to
the **real** `components/workout/set-card.tsx` and restores it afterwards. That restore is correct,
and it means a tracked source file differs from `HEAD` for the seconds that case runs — inside a
`pnpm test` that takes **nine minutes**. `git add -A` caught it, the run then put the file back, so
`git status` read clean **with the artefact already committed**.

It surfaced **twice** — committed the first time, caught before staging the second — and neither
time did `git status` say anything useful. The first tell was `git status` reporting the file as
*modified* when nothing had touched it, which is the artefact being **removed** relative to a commit
that already held it. The second was `git diff origin/main --stat` listing
`components/workout/set-card.tsx | 2 +` in a diff about dates and food names. Neither reached
`main`: the stray line lives only in this branch's `wip` commit, and a squash merge drops it. CLAUDE.md already warns about `git add -A`, from the 2026-08-08 incident
where a checkout carried files across — **this is a second, independent mechanism for the same
outcome, and that rule's advice (run `git status` before staging) cannot catch it, because the
window closes on its own.** Filed as `LB-194` (`Lane: A`) with a recommendation to write the fixture
to a gitignored copy instead. The habit that catches it meanwhile: **diff against `origin/main`, not
against the working tree** — `git status` is blind to a file that has already been restored.

## Not exercised

- **The device**, filed rather than claimed — [`known-issues.md`](../known-issues.md) carries both
  pass/fails. ④'s risk is that **Samsung WebView's font metrics are not Chromium's** and a wrap puts
  `BF-24`'s header back to two bands; ⑤'s is that **no real branded food has ever been drawn** here.
- **A real branded food, anywhere.** `food_items` is **empty in the local seed** (`count(*)`, not
  `n_live_tup`) and both search lists are network-driven, so the render used a stubbed row. The
  shapes are proven; the strings are the owner's.
- **Any non-`en-AU` device.** `formatDateDisplay` is deliberately locale-pinned, but the separator
  sites beside it use a bare `toLocaleString()` that follows the device — the open question `RV-208`
  raised and left for Lane A, and this PR does not touch it either.
