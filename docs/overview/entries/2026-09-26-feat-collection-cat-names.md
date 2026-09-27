# Every cat gets a name, merges rename, breakdowns give the same cats back

**Branch:** `feat/collection-cat-names` · **2026-09-26** · **v1.468.0**
**Follows:** [`2026-09-26-feat-collection-pen-widget.md`](2026-09-26-feat-collection-pen-widget.md) (#1706)
**Filed:** PS-52 (attachment ideas, Lane O) · **Amended:** PS-49 (keep the lineage fold)

## What the owner asked for

Unique cute names with a tag under each cat; a merged cat renamed from its merge; a decayed T2
breaking back into T1s; small cats in front and bigger ones further back and higher, maybe flying;
cats that stand out more; and ideas that make people attached enough to stay consistent.

## What shipped

- **The fold holds real cats, not counts** (`packages/shared/src/collection/ladder.ts`). The rules
  and their order are unchanged, `stock` is derived from the lists, and every existing ladder test
  still passes. Merges take the oldest cats; decay takes the newest loose cat and breaks the
  smallest big cat back into **the exact cats it was made from**, names intact. It already broke
  down before; now the same cats come back. New on the state: `cats` (top level, with `from`),
  `restless` and `lastLost`. The route did not change; it returns the whole state.
- **Names** (`names.ts`): deterministic from identity, from 80 cute names. A merged name blends the
  oldest part's opening with the newest part's ending ("Pudding" + "Waffle" → "Puffle").
- **Pen:** a name tag under every cat; depth by tier (T1 small at the front, each tier further back
  and higher); T5–T6 fly with a bob above a faint shadow; every cat has a ground shadow.
- **Card:** "Onyx is getting restless — train today to keep everyone" when skipping today would cost
  a cat, and "Pip wandered off on 12 Sep" in place of the old anonymous count.
- **`/collection`:** a roster per ladder listing each cat's name, tier, arrival day and the cats it
  was made from.

## Lane note

`ladder.ts` is Lane A's path. It was changed here because the owner asked for this in-session. The
change keeps every existing test green, and PS-49 now records that the lineage fold must be kept.

## Not exercised

The signed-in card on `pnpm dev` (no local Postgres); the S25; real production history through the
lineage fold (the counts are proven equal by tests, and names on the owner's data have not been
seen). The real engine and pen were rendered on the dev server through a temporary public page over
synthetic history; a fresh headless profile showed zero hydration errors.

## Gates

`pnpm check:rules`: see the PR. Unit tests: 9 files / 83 tests across the collection. eslint and
`tsc --noEmit` are clean.
