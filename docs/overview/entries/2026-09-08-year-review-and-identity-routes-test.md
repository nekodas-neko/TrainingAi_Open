# 2026-09-08 — the year you had and the name you wear for it (PS-39, 57 → 54)

**Branch:** `test/year-review-and-identity-routes` · **One product fix**, below.

17 cases over `year-review`, `seasons` and `user/equipped-title` — the three reads and writes behind
a retrospective and the identity attached to it.

## The bug the tests found

**`TITLES` is a plain object literal, so `TITLES['constructor']` walks the prototype chain and is
truthy** — as are `toString`, `valueOf`, `hasOwnProperty`, `__proto__`, `isPrototypeOf`,
`propertyIsEnumerable` and `toLocaleString`. All eight passed the route's `!TITLES[titleId]` guard,
were stored, and then broke rendering: `components/more/profile-tab.tsx` mounts `<title.Icon />` from
the same map, and `(Object).Icon` is `undefined`, which React answers with a hard *"element type is
invalid"* crash.

**The row survives a reload, and the UI for changing a title is on the tab that no longer renders**,
so it is self-inflicted but not self-recoverable. The guard now asks `hasOwnProperty`. Version
bumped to 1.438.5 with a changelog entry.

Sibling-surface sweep: five other call sites read `TITLES[...]` (`friend-leaderboard`, `friend-feed`,
`profile-tab`, `profile/[userId]`, `title-picker-sheet`). Only `profile-tab` mounts the icon
component; the rest read `.display` and render nothing for a bad id. The fix is at the **write**
boundary, which is the one place that stops a bad value existing at all.

## What the other cases decide

- **`year-review`'s window is 365 days back from the USER's local midnight**, threaded into
  `aestMidnight`'s fourth argument — the parameter whose Brisbane default is LA-19's whole bug class.
  The fixture runs in `Etc/GMT+5`, where the answer differs by nine hours and a calendar day.
- **A bodyweight PR is not comparable to a barbell one** — its `estimated1rm` is a BW_REF-relative
  index, not kilograms — so `pickHeadlinePersonalRecord` prefers the best loaded lift and falls back
  only when there is nothing else. The bodyweight number in the fixture is deliberately the
  **largest**: if it were smaller, the filter and a plain maximum would agree and the rule would go
  untested.
- Only the volume is rounded; sets, sessions and minutes are counts and pass through.
- `equipped-title` accepts `null`, because that is how a title comes **off**.

## The fixture trap, a third form

The monthly-bucket mutation survived the first pass. `NOW` put the two timezones a calendar **day**
apart, and `monthlySessionCounts` reads only year and month — so swapping the anchor between the
user's zone and the default changed nothing. A second case now pins the clock to 20:00 UTC on the
**31st**, still March for the user and already April in Brisbane, which is the only kind of instant
where the two anchors disagree. Its session is at midday UTC so the day string is identical in both
zones, isolating the anchor from the bucketing.

## Mutation pass

**15 of 16 caught.** The survivor is an equivalent mutant planted deliberately as a control — a
no-op TypeScript cast — so the loop is shown to distinguish a real change from a cosmetic one rather
than merely reporting a perfect score.

## Not exercised

The repository is mocked; no database. The crash this fixes was reasoned from the render call site
(`<title.Icon />` with an undefined component) and from the guard's behaviour, **not** reproduced on
a device — the fix is at the API boundary and is covered by tests there, but the profile tab itself
was not re-rendered with a poisoned row. Web/Node only: no native, safe-area, gesture or
notification surface.
