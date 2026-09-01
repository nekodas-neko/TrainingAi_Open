# 2026-09-01 · Lane A — the queue tool stops pointing at another lane's finished work (LA-53)

Branch `lane-a/lane-drift-check`. Three files, no migration, no product behaviour.

## An entry that contradicts itself keeps heading the wrong lane's list

`next-item.js` reads an entry's `Lane:` field, and nothing re-reads it when the remaining work moves
lanes. **Q-535 sat at the top of Lane A's READY list for two weeks** after its Lane A half landed on
2026-08-18 — everything still owed there is Q-318's and Lane B's. The cost lands on whoever starts
next: they read the entry to discover it is not theirs.

Three of these turned up in one session, and only one is mechanical:

| entry | drift | detectable? |
|---|---|---|
| **Q-535** | says its Lane A half shipped, `Lane:` still A | **yes** — the entry contradicts itself |
| **BF-64** | filed A; its own recommended fix is entirely client-side | no — that took reading the code |
| **LA-47** | says its proposed split *"does not compile"* | no — judgement |

So the check tests one thing: a body line saying the Lane X half has shipped while `Lane:` still
says X. Both halves were already parsed, so this is a comparison rather than a new heuristic.

## The rule reported its own documentation, twice

Running it against the tree flagged **LA-53 itself** — the entry that defines the rule — for two
different reasons, one after the other:

1. **Undated prose describing the shape**: *"an entry whose Lane A half has shipped keeps heading
   that lane's list"*. Fixed by requiring a date on the line, which every real claim carries by
   convention (`✅ THE LANE A HALF SHIPPED 2026-08-18`).
2. **A dated citation of another entry**: *"Q-535 — Lane A half shipped 2026-08-18"*. Fixed by
   skipping a line that names an entry id other than the current one.

**A guard that cannot survive its own documentation is not ready to be enforced**, which is the
concrete reason this prints as a note rather than failing CI — not a general preference for caution.
Both exclusions are pinned by tests, because "catch more" is the obvious edit and it turns the note
into noise nobody reads.

The accepted cost is stated in a test of its own: an **undated** claim is missed. In an advisory
check a miss is cheaper than reporting every entry that discusses the pattern.

## Verified against the real case, not a synthetic one

Flipping Q-535's `Lane:` back to `A` — its actual state until this morning — makes the note fire and
name it. On the current tree it reports **0**. Three mutations, three caught: dropping the date
requirement (2 tests), dropping the citation exclusion (1), and ignoring the lane comparison so any
shipped-half line matches (1).

## What is left, and it is the larger half

BF-64 and LA-47 are the same drift and no phrase-matcher will ever see them. The entry keeps them,
plus the question of whether to enforce: if the note's count stays at zero for a few weeks the
phrasing is stable enough to fail on. Not before.
