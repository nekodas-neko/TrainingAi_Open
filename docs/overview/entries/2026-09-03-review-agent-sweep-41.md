# Review sweep 41 — the persistent shell's two coverage gaps

**Date:** 2026-09-03 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-41` · Docs only.

The owner asked for a sweep across recent changes and domains, naming three lenses: mobile UI (safe
area, and returning to the scroll position on back), and cache staleness — *"loading saved caches
which should be changing"*.

Two lenses produced findings and both landed on `app/nutrition/nutrition-content.tsx`. The third,
safe area, is already held by four CI rules and its residue needs the device, so nothing originated
there; the write-up says so rather than filling the gap.

**One shape underneath both.** A hook was built once, wired into one place, and recorded as global.
`useLocalDay()` (BF-86) has three consumers. `useScrollRestoration` (BF-100) is called from
`pull-to-sync.tsx`, which three screens use. Neither reaches the Nutrition tab.

| ID | What |
|---|---|
| **RV-35** | Nutrition does not follow local midnight on resume — shows yesterday as `Today`, and files a new log against it |
| **RV-36** | Scroll restoration reaches 3 of 5 tabs; BF-100's entry says it reaches all. Its claim is corrected in the backlog |
| **RV-37** | `/health/day`'s scroller has no bottom padding — **structural, not observed**; needs the device |

**RV-35 is the one that moves data.** Five tabs were loaded at 23:50 Brisbane under a fixed clock,
the clock advanced 30 minutes, and a `visibilitychange` dispatched. Dated requests before → after:
Home 4 → **2**, Health 3 → **3**, **Nutrition 5 → 0**; Workout and More issue none either side, so
they are not day-scoped. Nutrition's own midnight branch is written correctly and is unreachable — its
deps are `[tabEpoch, fetchData, tz]`, and the shell increments `tabEpoch` only when a tab is
**re-shown**, never on a resume-in-place. Switching tabs away and back fixes it, which is why this
reads as intermittent.

**Counting the requests by the date they carried is what made it a finding.** Health reissued 11
requests on resume and only 3 carried the new date; a raw count would have called Health fine and
Workout and More broken, and all three conclusions would have been wrong.

**RV-36 got smaller by being checked.** The first draft claimed many screens. Restoration only matters
where a user pushes deeper and returns, and every other routable screen that scrolls at the mobile
viewport — `/health/sleep` (1200 px), `/health/heart-rate` (661), `/cardio` (374), `/config` (148),
`/program` (148) — contains no `router.push` or `<Link>` to a deeper route. They are leaves. The live
gap is Nutrition's single deeper push, `/coach?scope=nutrition`: measured, it saves no `ta_scroll:`
key and returns 0, against `/more`'s 840.

**Two lenses came back clean, recorded as results.** All seven `freshWithinTtl` sites have every
writer covered by a cache group (the baton had them as unaudited); and
`check-fetch-once-effects.js`'s CAN-BITE group is empty, closing a lens this role inherited as open.

**Not exercised:** the device — this is the web build, where `getLocalStore()` returns null and
safe-area insets resolve to `0px`, so RV-37 in particular is structural and unconfirmed. Production
was not queried; every measurement is against the local seeded database.

Write-up:
[`docs/reviews/2026-09-03-nutrition-day-rollover-and-scroll-coverage.md`](../../reviews/2026-09-03-nutrition-day-rollover-and-scroll-coverage.md).
