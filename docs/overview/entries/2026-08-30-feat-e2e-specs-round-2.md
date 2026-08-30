# 2026-08-30 — Q-297: four of its five asks had already shipped; the fifth is Nutrition's day

**Branch:** `feat/e2e-specs-round-2` · **Lane:** A · **Domain:** platform

## What the entry asked for, checked one by one

Q-297 was filed 2026-08-15 as the follow-up to Q-249's E2E harness. Before writing anything, each of
its five asks was checked against `e2e/`. **Four are already there, under other entries' numbers:**

| Q-297 asked for | shipped as |
|---|---|
| *"log a set … appears without a reload"* | `workout-set-loop.spec.ts` (Q-461) |
| *"a food entry"* | `food-logging-complete.spec.ts` (Q-387) |
| *"a water entry"* | `water-log-write-path.spec.ts` — its header names Q-297 outright |
| *"change a goal … the Q-240 regression"* | `goal-round-trip.spec.ts`, plus `goal-invalidation.spec.ts` |

The goal one is worth reading rather than counting: `goal-invalidation.spec.ts` establishes **by
mutation that no guard can exist** for the Q-240 path. `cachedFetchCore` always revalidates unless
`freshWithinTtl` is set, and the stale flash comes from Health's retained React state rather than
the cache — so deleting Q-240's fix leaves the spec green. That is a settled negative result, and
it corroborates CLAUDE.md's own `freshWithinTtl` rule from the other direction.

**The fifth ask contains a wrong premise.** *"Nutrition's date swipe and any other tabbed surface"* —
there is no other tabbed surface. `SwipeCarousel` is used by exactly one screen
(`health-content.tsx`) plus two pickers, so `health-tabs-instant-paint.spec.ts` already covers the
whole population. Nutrition has a **day**, not tabs.

## What shipped

`e2e/nutrition-day-navigation.spec.ts` — three tests:

1. **The chevrons and the `?date=` deep link land on the same day.** Two entry points that had never
   been pinned to each other: `setSelectedDate` + `shiftDateStr` on one side, and an effect reading
   `searchParams.get('date')` on the other — the link the Home timeline's meal cards use.
2. **Next day is refused at today.** The guard is `if (selectedDate >= todayStr) return` in the
   handler, not `disabled` on the element.
3. **A day already viewed paints without a skeleton on return.** The instant-paint rule applied
   across a date change, which is also the guard for a cache key that forgets its date.

**Driven by the chevrons, not the swipe, deliberately:** `useDrag` on this screen swallows mouse
input (**Q-354**, still open) and mouse is what Playwright sends, so a swipe-driven spec would be
asserting against a known-broken path. Noted in the entry for when Q-354 lands.

## The harness gotcha this cost, and where it now lives

The today-guard test did not fail on the first run — **it hung to the 45 s test timeout.** Playwright
counts `aria-disabled="true"` as *not enabled*, so `click()` waits for the element to become enabled
and reports `element is not enabled` in a call log rather than failing on anything about the app.

`{ force: true }` is the fix and it is the faithful reading rather than a workaround: `aria-disabled`
blocks no pointer event, so a real tap on the S25 reaches the handler too, and the handler's guard is
the only thing stopping tomorrow. Asserting the *attribute* instead would have passed with that guard
deleted — which is exactly the shape of test this repo has been bitten by before.

Written into `e2e/README.md`'s *Rules for adding a spec*, next to the sibling gesture rule.

## Files

- `e2e/nutrition-day-navigation.spec.ts` — new, 3 tests.
- `e2e/README.md` — the `aria-disabled` rule.
- `docs/implementation-backlog.md` — Q-297 rewritten around what is actually left.

## What is left under Q-297, and it is small

- The **20 s skeleton budget cannot tell "seeds instantly" from "seeds in 8 s off the network"**,
  because the harness runs `pnpm dev` and handlers compile on first call. Its own piece of work.
- **Whether the E2E job should become required.** The entry said keep it optional until it has a
  track record; LA-22 has since made it always-run and always-report specifically so it is safe to
  require. **Its current branch-protection state was not checked here** — check before changing it.

## Verification

`pnpm check:rules` — **Ran 62 of 62**, all passed. `tsc --noEmit` clean. The three new specs run
green against the local harness (5 passed including both setup projects, 1.2 m).

**What was mutation-checked, and what was not** — the repo's own rule is to prove a spec
discriminates before trusting it, so the distinction matters:

- **Test 2 (the today guard)** — deleting `if (selectedDate >= todayStr) return` from the handler
  fails it. Checked.
- **Test 1 (chevron vs deep link)** — flipping the Previous chevron's day offset fails it. Checked.
- **Test 3 (instant paint on return)** — its day-selection half is asserted directly, and the
  no-skeleton half rests on `expectNoSkeleton`, whose discrimination is established in
  `e2e/README.md`. **This spec's own use of it was not separately mutated**: forcing a skeleton on
  Nutrition's date change means editing the screen, which is Lane B's, and the honest version of
  that check is a Lane B change rather than a temporary one made to satisfy this note.

**Not exercised:** everything `e2e/README.md` already says a green run does not prove — the device
branch of every offline-first domain, safe-area insets, Samsung's WebView, and a real thumb on the
swipe. No runtime code changed, so no device check is owed and there is no version bump.
