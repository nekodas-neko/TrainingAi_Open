# 2026-09-07 — the cat collection has a surface, and glyphs instead of art (BF-122b)

**Branch:** `feat/bf-122b-collection-surface` · **Lane B** · v1.437.0

## What shipped

BF-122a built the fold and deliberately no route; LB-60 (#933) gave it one. This is the surface:
all four of the entry's deliverables, with the fourth — the art — shipped as glyphs on purpose.

- **`components/home/collection-summary.ts`** — the decisions, as pure functions, because this
  project's vitest is `environment: 'node'` and a `.tsx` cannot be imported. 18 tests.
- **`components/home/collection-card.tsx`** — the home widget, a tenth `CardWidgetKey`, off by
  default (`DEFAULT_CARD_WIDGETS` is empty) and toggled in More → Home Widgets.
- **`app/collection/`** — the full collection and the rules, in plain words.
- **`components/home/collection-sprites.ts`** — tier → glyph, isolated so replacing it is one file.
- **`e2e/collection-screen.spec.ts`** — read-only, and checked against a broken heading to confirm
  it discriminates.

## The one decision worth recording: nearest merge is measured in DAYS

The card shows the ladder nearest its next merge. The obvious ranking is how full a rung looks, and
it is wrong. A ladder holding 3 of the 4 scouts a Tank costs is 75% of the way there — but each
remaining scout is another 5 workouts, while 3 of the 5 slimes a scout costs is **2 workouts**.
Ranking on fraction picks the Tank and then has to tell the user *"1 more cat scout"*, a unit nobody
can spend a day earning.

Ranking on faucet days — `(need − have)` multiplied up through every rung below — gives one number,
always a count of the thing the user actually does, comparable across tiers and across ladders.

A consequence found while testing rather than while designing: **on these three ladders a higher
rung can only ever TIE the bottom one, never beat it**, because one more of tier N costs a full merge
of tier N−1. So the tie-break — same effort, higher prize — is the entire mechanism by which a Tank
is ever offered rather than a courtesy. There is a test pinning that, which is where it will show if
a new ladder breaks the property.

I got this wrong twice before getting it right: the first implementation took the lowest short rung
and justified it in a comment, and the first test asserted the opposite. Both are gone.

## The art, deferred rather than dropped

The entry's brief is one cat silhouette with props by tier, ~12 drawn assets, and it calls that art
*"the only unrecoverable spend"*. Nothing here spends it: `collection-sprites.ts` maps each tier to
an emoji, and swapping to images changes that file and the two components reading it.

That is the order the entry's own reasoning implies — the owner sees the mechanic working, then
decides whether the assets are worth drawing. Filed as **BF-126**, `Gate: owner`. The binding
constraint is unchanged and cuts against drawing: they must read at ~32 px, which is what an emoji
is designed for and a detailed sprite is not.

## Found and fixed in passing: `CardWidgetKey` lived in three places

`lib/home/home-prefs.ts`, `components/home/home-card-widget.tsx` and
`components/more/home-widgets-section.tsx` each declared the same union, so adding a slot meant
editing three lists and a missed one fails silently as a card that can never be switched on. The
other two now import the canonical one (type-only, so the cycle with `home-prefs` is erased). The
compiler then found both `Record<CardWidgetKey, …>` maps that needed the new key, which is the point.

## Verified

- 412 dp harness: the card renders **380×135** under the week strip — `Cat ranger · 4 more days with
  steps · ●●●○○○○` — and the collection screen lists all three ladders with the rules below.
- `pnpm test` **6,845 passed** · `pnpm build` clean · `pnpm lint` 0 errors ·
  `check-test-typecheck` at baseline · `pnpm check:rules` **Ran 69 of 69**.
- Two copy defects the screenshot caught and the tests would not have: the card's line repeated the
  title above it, and the decay note summed all three ladders into a lifetime total. Both fixed.

## Not verified, and one honest limit

**Not run on device.** No APK needed. The device check the entry names is owed and specific: glyph
legibility at ~32 px, and whether the card pushes the fold with several widgets enabled.

**The decay note is a LIFETIME count.** `replayCollection` reports how many decays fired across all
history and carries no recency, so the card says "11 have wandered off over long gaps" and that
number only ever grows. Wording it as anything more recent would be a claim the engine cannot
support. If it becomes noise, the fix is in the engine, not the copy.

## Deliberately not built

The weekly encounter. The entry parks it as phase two and says outright: do not build a battle
system.
