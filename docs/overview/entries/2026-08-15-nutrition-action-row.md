# 2026-08-15 — Nutrition's actions stop depending on scroll depth (Q-237)

**Branch:** `claude/ia-cluster-app-shell` · **Version:** v1.314.0
**Plan:** [`2026-08-14-more-tab-information-architecture.md`](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md) §7 — the last implementation item in the 2026-08-14 review cluster.

Nutrition read, top to bottom: gear in the header · calorie balance · macro ring · meal-plan cards ·
a **Water** button mid-scroll · TDEE card · every meal card · then **Saved Meals** and **End of Day**
in a grid *below all of them* · weekly chart · supplements.

Saved Meals is a library, not an action, and how far you scrolled to reach it depended on **how many
meals your day had**. Water was mid-scroll for the same reason. Both now sit in one row directly
under the macro ring, above every meal card — a fixed position that the day's contents cannot move.

Verified by position, not by eye: in the rendered text the macro ring is at index 126, Water at 208,
Saved Meals at 220, and End of Day at 490 — after all six meal cards.

## Two things deliberately not done

**"End of Day" stayed exactly where it is.** It is a daily-review feature living in Nutrition behind
a moon icon, and merging it with Home's "Your Day in Review" banner is **Q-112**, which is
spec-sized and has its own entry. The plan says to add the placement argument to Q-112 and otherwise
leave the button alone — moving it halfway is worse than either end state. It is now a full-width
button rather than half a grid, since its grid partner left.

**"Log Food" was not added, and the plan's row names it.** There is no global log-food action today:
`openLogger(mealTypeId)` requires a meal type and every meal card supplies its own. A row-level
button would have to *pick* one — by clock time against the user's meal schedule, the next unlogged
meal, the first meal type, or a picker. Each is defensible, and they behave differently on a day
logged out of order. That is a product decision, not a placement fix, so it is **Q-257** rather than
something this change invented.

## Water's three mounts are still three mounts

Home, Health and Nutrition each mount their own `WaterLogSheet`. That is convenient and correct;
what diverges is their **invalidation**, which is **Q-243** and still open. Not touched here — it is
a behaviour fix, not a layout one.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings) · `pnpm build` · **`pnpm check:rules` — Ran 35 of
35** · `check-component-size` + `check-hex-literals` clean · full suite **471 files / 3,903 tests
green**.

`pnpm dev` at 412×915 as `test@local.dev` — both actions **opened**, not just positioned:

- **Water** → *Log Water Intake · +150 ml · +250 ml · +330 ml · +500 ml · +750 ml · +1000 ml · Log*
- **Saved Meals** → *Saved Meals · New Meal · No saved meals yet · Build your first meal*
- Order confirmed as above; zero console errors.

**⚠️ Not device-verified.** Two-column tap targets at 412 px are the case the S25 decides — the row
is `min-h-[48px]` with `gap-3`, meeting the 48 dp / 8 dp rule on paper, and the page's own scroll
padding is unchanged by this move.
