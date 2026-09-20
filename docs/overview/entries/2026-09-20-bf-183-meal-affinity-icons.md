# 2026-09-20 — "which meal is this good for?" — the icon vocabulary already exists

**BugFix intake.** Docs-only. Owner: *"Can we have some sort of icon system to indicate which meal
its good for? Maybe we could use the lucid icon pack for this."* Filed as **BF-183**.

## The recommendation is emoji, not lucide, and the reason is data not taste

`meal_types` already carries a user-set `emoji`, and the Assign-to-Meal sheet already renders it.
His four active types: 🍳 Pre Workout (Breakfast), 🍎 Post Workout, 🥗 Lunch, 🌙 Dinner.

**Meal types are user-created.** A fixed lucide map cannot name a type the app did not anticipate,
and this account has previously carried an *"Afternoon Meal"* 🍽️. The emoji always can, because he
picks it. The mapping is also already trained — he sees those four glyphs every time he logs — and
one vocabulary cannot drift from itself.

## The signal is strong enough to ship

Dominant meal type by log count, across all 19 saved meals:

| tier | count | examples |
|---|---|---|
| Confident (≥3 logs, 100%) | **10** | Protein Shake 45× 🍳 · Cruskit + PB 26× 🍳 · Ninja Creami 10× 🥗 · Wrap Pizza 6× 🌙 |
| Split | 2 | Beef Mince Cube 60% 🌙 · Corn Chips 50% 🥗 |
| Single log | 3 | Protein Granola, Corn Block, Protein Pasta Brick |
| **Never logged** | **4** | Chicken Block, Shredded Chicken Block, Beef Ragu, Pulled Pork Block |

53% of the list gets a confident tag today, and the top of it is unambiguous.

## The part the entry insists on

**Show nothing below the threshold.** Four items have never been logged and three have a single
log; an icon derived from one log is a guess rendered as knowledge, which is exactly what BF-172 and
BF-154 were filed for. Proposed gate ≥3 logs and ≥60%, blank otherwise, self-healing as he logs.

## His "too many meals" worry, answered

The row shows one glyph — the dominant type — never N, so ten meal types render the same as four.
What degrades is the *confidence*: the same logs spread over more buckets clear 60% less often and
more rows fall blank. That is the right failure direction.

## What was not exercised

Nothing on the S25, and nothing built — this is a planning entry. The tiers above are a live query
against his account, so they double as test fixtures. Two calls are gated on him: emoji versus
lucide, and whether a below-threshold row is blank or offers a manual override.
