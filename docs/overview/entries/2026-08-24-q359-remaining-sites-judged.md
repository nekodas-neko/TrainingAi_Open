# Q-359's remaining sites are not work, and the queue now says so

**Branch:** `docs/q359-remaining-sites-judged` · **Lane B** · docs + one comment

## Why

`node scripts/next-item.js --lane B` offered Q-359 as the top READY item. Its own body says
**"Placement: low"** and **"latent, not broken"**, so before starting it I read why it sat first.

The placement note (near the top of the nutrition block) gives the reason outright: Q-359 reported
that *"36 other fetch-once effects carry the same latent bug"*, some of them in the permanently
mounted tab shell, where the bug can actually bite. **That premise expired.** Four slices later the
can-bite group is **zero** and 12 sites remain, all of which unmount on navigate.

Worse, `scripts/check-fetch-once-effects.js` already carries a per-site judgement, made 2026-08-20,
that **none of the 12 is worth converting**: a subscription on a key nothing writes while the
component is on screen adds a refetch with no reader waiting for it — which is exactly what Q-359's
own *"Not every one should convert"* bullet warns against.

So the top of the Lane B queue was an entry that, read to the end, says not to do it. Every future
Lane B session would re-derive that. That is what this change fixes.

## What changed

- **The entry moved down**, from ahead of the nutrition block to just after Q-499 — respecting its
  own "Placement: low". It stays queued because it is the home of its ratchet.
- **A banner at the top of the entry** says it is not work and why, so the conclusion is reachable
  without reading 156 lines.
- **The stale placement note is struck** with the reason it expired.
- **The check script's one untraced site is now traced** (below).

## The trace, which was a real open question

The script recorded a limit on its own judgement of `my-meals-picker`: *"whether `saved-meals-sheet`
can be opened on top of the wizard was not traced, so this is 'no writer found reachable', not
'proven unreachable'."* If a writer were reachable, that site would be a live bug rather than a
latent one.

`app/nutrition/nutrition-content.tsx` renders `MealPlanSetupSheet` and `SavedMealsSheet` as
siblings on **independent** `open` booleans, so both *can* be mounted at once — the cautious reading
was right to flag it. But the wizard is a modal sheet covering the screen, so the control that sets
`savedMealsOpen` cannot be tapped while step 4 is up. And `MyMealsPicker`'s own writes
(`onChangeTyped`, the `/api/nutrition/scan` call) touch component state only; it invalidates
nothing.

**No writer of `saved-meals` is reachable while it is mounted.** Same conclusion, now on evidence.

## Verification

`pnpm check:rules` — Ran 55 of 55. `node scripts/next-item.js --lane B` now heads with LB-7.

## Not exercised

Docs and one comment; no runtime behaviour is touched, so there is nothing to run or to verify on
the S25.
