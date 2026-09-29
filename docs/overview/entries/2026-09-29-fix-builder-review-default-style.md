# 2026-09-29 — LA-183: the AI builder's review screen no longer saves a style-less exercise

**Lane B.** Branch `fix/builder-review-default-style`. UI only — no migration, no API change, no APK.

## Half of this entry had already shipped, hours earlier

`LA-183` named two writers: the program editor and the builder's review screen. **The editor half is
`LB-186`, merged as #1950 this morning** — so the re-verify against `main` turned up a live overlap
rather than a stale plan, and what was left was the builder.

The remaining gap, confirmed link by link on `main`:

- `app/api/generate-program` picks a style **name** per exercise (enforced from the goal for primary
  and secondary, the model's choice accepted for accessories when it is valid) and then resolves it
  with `styleByName.get(styleName)`. **That lookup can miss** — a goal with no rule table, or a name
  the user has no style for — and it yields `undefined` with nothing downstream objecting.
- `builder-review.tsx` saved `styleId: ex.progressionStyleId` straight through.
- And the row said **nothing**: the sets/reps line rendered only when the style name was a key of the
  screen's hardcoded `STYLE_DISPLAY` table, so both *no style* and *a style this screen has no
  description for* printed as a blank line.

## The fix reuses LB-186's rule rather than restating it

`mostUsedStyleId` is now the exported core of `components/config/default-exercise-style.ts` — the
role's most-used style, else the program's — and both writers reach it:

- the **editor** through `defaultStyleIdForSlot`, which adds the user's style list as both the
  validity check and the last resort;
- the **builder** through `fillGeneratedStyles`, which calls it directly, because every id already in
  a generated program was resolved server-side against that same list and needs no re-checking.

The builder's version has to carry the **name** as well as the id, since the row's sets/reps line is
keyed on the name — it takes it from whichever exercise in the program already pairs the two.

**It is derived, not written back.** `const shown = useMemo(() => fillGeneratedStyles(program), [program])`
feeds the rendered rows, the projected-volume card and the save payload. Filling through
`onProgramChange` from an effect would have been the shape that crashed Home in `RV-119` — an effect
writing the state it depends on — and there is no reason to take that risk for a value this screen can
compute. `fillGeneratedStyles` returns the **same object** when nothing is missing, so the memo stays
referentially stable and the screen re-renders exactly as much as it did before.

The display line now falls back to the style's own name when the table has no row for it. A name is a
worse answer than `4 × 10 @ 65% · 60s rest`; it is a much better answer than silence.

## What that means for the projected-volume card

`setsFromStyleName` defaults to **3** for an unknown or absent style, so a style-less exercise was
already being counted — at a number nobody chose. Feeding the card the filled program makes it count
the sets the exercise will actually be prescribed.

## Verified

- `npx vitest run components/workout-builder/__tests__ components/config/__tests__/default-exercise-style.test.ts`
  — **19 passed.** The fill: role-preferred, program-wide fallback, same-object identity when nothing
  is missing, a program with nothing to copy, and never overwriting an existing style. The core: that
  it accepts an id when given no list to check against, and drops one the caller calls unknown.
- A source guard on the wiring — the memo exists, no `useEffect` touches `fillGeneratedStyles`, and
  the rows, the projection and the save payload all read `shown`.
- Full gate on the final tree: `npx tsc --noEmit`, `pnpm check:rules`, `pnpm lint`, `pnpm test`,
  `pnpm build`.

## Not exercised — and this is the honest part

**The review screen was not driven in a browser, because nothing in this repo can reach it.**
`grep -l 'generate-program' e2e/` is empty: there is no spec for this screen at all, and getting one
means driving a **nine-step** wizard and stubbing a live Gemini call. That is a real piece of work,
not an oversight to wave at, so it is filed as **`LB-187`** with what it would take and the one reason
to weigh it first — the suite hit its 45-minute ceiling four days ago.

So the logic here is proven where it lives (pure functions, unit-tested) and the wiring is frozen by a
source guard, and **the screen itself is unseen**. The two things that would slip past both: a layout
consequence of the newly non-empty sets/reps line at 412 px, and anything about how the fill interacts
with a swap or role change made on the review screen before saving.

**Not fixed, deliberately:** the generator still emits `progressionStyleId: undefined` when its name
lookup misses. `builder-review` is the builder's only save point — `builder-chat`'s edits flow through
the same screen — so the fill covers every path to the database, and the upstream `undefined` is now
harmless rather than absent. Making the generator itself always resolve a style is `app/api/**`, which
is Lane A's, and there is no live consequence left to justify handing them the work.
