# 2026-09-27 — three Home/Nutrition mockups, shown in one sitting (docs only)

**Branch:** `mockups/home-nutrition-sitting` · **Lane:** Implementation B · **Code changed:** none.

## What this was

`LA-136`, `LB-163` and `RV-213` each proposed a visible rearrangement of a screen the owner opens
daily, and each was blocked on the same thing: CLAUDE.md's large-UI-change rule wants a mockup at
the real 384 px dark viewport and a yes before any code. All three were deliberately left **ungated**
because producing the picture is itself work, and `Gate: owner` would have parked them — the
inversion `LB-163`'s own body documents.

`LA-136` also said to show all three **together**: three Home/Nutrition mockups owed to one person,
and split across three sittings the same Home screen gets judged three times.

## What was done

**The mockups are the running app, not drawings.** Each proposed change was implemented temporarily,
captured at 384 px dark in the Playwright harness, and reverted — so what he is looking at is the
real thing rather than an artist's impression of it. `git diff origin/main` for the component files
is empty; no mockup code survives.

Published as one page with all six before/after frames, a recommendation per decision and the honest
trade beneath each: <https://claude.ai/artifact/SQxd9yfvjcbnZVseiPVwHh>

Each entry now records the link, carries `Gate: owner` (his answer is the only outstanding thing) and
carries an `Ask:` so it surfaces under **WAITING ON THE OWNER** rather than sinking into `PARKED`
beside 35 device gates — `Gate: owner` alone would have made the question invisible again, one step
later than before.

## Three things the render corrected, which reading could not

1. **`LB-163`: the tiles fill ~62% of the row, not 58%.** The earlier figure was measured at 412 px.
2. **`LB-163`'s trade was stated backwards.** The entry said three columns makes each tile
   *narrower*; they come out **wider**. The real cost is height — moving `Log` out of the icon
   overlay and into the flow as a genuine 44 px target roughly **doubles the row**, pushing
   everything below it down. That is what the page asks him to weigh, and it is not what the entry
   described.
3. **`RV-213` says four empty meal slots; there are six.** Collapsing them is ~1,400 px → ~800 px,
   and two cards previously under the fold — the goal-versus-budget explainer and "Finished logging
   for today?" — reach the same screen.

This is the fourth sitting in a row where an entry was right about what it saw and wrong about why
or how much. Render before fixing, and render before dismissing.

## One defect split out rather than left inside a preference

**`LB-169` (new, Lane B, ungated).** The empty meal's header `+` is `h-9 w-9` — **36 px**, under the
48 px floor every other icon button on the screen holds to (`components/nutrition/meal-card.tsx:72`,
verified in source, not inferred from the render).

It was found inside `RV-213` and does not belong there. `RV-213` is a layout preference gated on the
owner; a tap target under the floor is a defect with one right answer, and left inside that entry it
would have sat blocked behind a question about whether to collapse cards. It is also already live —
today the undersized `+` has a large "Add food" sibling, which is what makes it easy to miss — and it
becomes the *only* way into an empty meal if `RV-213` is taken. So the page presents the enlargement
as part of that change rather than inviting him to approve a regression, and fixing it under `LB-169`
means `RV-213` needs no such caveat whichever way he answers.

## Not exercised

Nothing on-device and nothing in the APK: these are screenshots from `next dev` in the Playwright
harness at 384 px, with Chromium's rendering rather than Samsung's WebView. Safe-area insets, real
gesture-nav clearance and native SQLite are all absent from every frame — so the *heights* quoted
above are the harness's, and the 48 px tap floor in `LB-169` is read from the source, not measured on
glass. No code shipped, so there is nothing for a device pass to verify yet; the on-device check
belongs to whichever of the three he takes.
