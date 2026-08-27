# 2026-08-27 — the serving-size payoff already exists; only the entry point is missing

**Branch:** `feat/recipe-image-upload` · docs-only · BugFix Intake

## The request

*"can you make it so I can uploaded an image of ingredients and it can make a meal out of it. that
way when I increase serving size I can see calories drop till its a good serving size from a batch"*

## The second half is already built

That is `components/nutrition/meal-batch-size.tsx` and the builder footer, both shipped:

- **"This recipe makes N portions"** — `−`/`+` and a number input, quarter-portion steps, capped at 50.
- **Live per-portion arithmetic under it:** *"Logging this meal takes one portion — 278 kcal of the
  555 below."*
- **The footer keeps the batch total, the macro split and `N / portion` on screen *while ingredients
  are edited*.**

So raising the servings count already makes per-portion calories fall, in two places at once.
**BF-40 is only the missing entry point** — once an image can reach the builder, the behaviour the
owner described is what happens next with no further work. The entry now says so, so nobody rebuilds
it.

Also recorded: *"an image of ingredients"* covers a screenshot of a written list **and** a photo of
physical ingredients laid out. Both post an image to the same route; the fix is the same prompt
change either way.

## BF-40 raised to Lane B's #1

The owner asked for the capability, not for intake to write it — and two things make handing it to
Lane B the right call rather than a process reflex:

- **Lane B is in these exact files right now.** #570 is open on `food-list.tsx` and #568 shipped
  changes to it hours ago. Editing the builder from here would collide with an active branch, which
  is the specific failure the lane split exists to prevent.
- **BugFix never writes code** (`docs/agents/README.md` §1). The role ends at a traced entry.

BF-40 is now the top of Lane B's READY list, ahead of BF-28.

## DEXA and RMR are done

The owner completed both and will send the results. Two things stand from the earlier intake:

- **BF-33 shipped the storage** — `measured_rmr` with `POST /api/measured-rmr` and the
  `ffm_kg_at_test` column that lets the reading be re-scaled to a future body. **There is no UI**, so
  the numbers cannot be entered from the app yet.
- **BF-2 has not shipped**, so the DEXA half still has nowhere to go. The same-day Renpho reading was
  the irreversible part and it is done; everything else can be entered whenever, because both records
  are dated by measurement rather than entry.
