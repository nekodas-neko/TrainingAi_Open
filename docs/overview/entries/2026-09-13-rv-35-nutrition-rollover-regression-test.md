# 2026-09-13 — the Nutrition rollover fix gets the test it was shipped on (RV-35)

**Branch:** `fix/rv-35-nutrition-rollover-test` · **Agent:** Implementation Lane B

## The entry was stale in the half that matters, and not in the way that lets it be deleted

RV-35 said the Nutrition tab never asks what day it is on resume, so a breakfast logged after
midnight files against yesterday — measured in review sweep 41 as five dated requests before the
boundary and **zero** after. It prescribed the fix: *"the hook that already exists"*,
`useDayRolloverRefresh` from `components/shell/local-day-provider.tsx`.

**That fix is already in the tree.** `app/nutrition/nutrition-content.tsx:334` calls
`useDayRolloverRefresh(catchUpToToday)`, one line below `useRefreshOnTabShow(catchUpToToday)`. The
entry's description of the guard as reachable only through `tabEpoch` describes code that has since
changed. Re-verifying before implementing is what caught it — the standing rule, earning its keep for
the second time today.

**But this is not a "already done, remove the entry" case**, and reading only the first half would
have made it one. The owner directed on 2026-09-13: *"This is a hard one to check; lets just make the
best guess and file it as a non issue till its reproduced — ideally you can be confident in your
fix."* Checking by hand needs the app left open across local midnight. The entry converts that
directive into an obligation in its own words: **a fix landing without a device check needs a test
that fails before it and passes after, because nothing else will catch a regression here.**

No such test existed. `e2e/day-rollover-checkin.spec.ts` drives the clock across midnight but covers
Home — the check-in prompt (BF-86) and Home's day-scoped reads (BF-117). Nothing covered Nutrition.
So the code shipped carrying an unmet condition, which is the thing that was actually missing.

## What this adds

`e2e/nutrition-day-rollover.spec.ts`, on the clock recipe BF-86 established: install at 23:55
Brisbane, load `/nutrition`, fast-forward ten minutes, dispatch `visibilitychange`.

- **The assertion is a dated request, not the header.** After the fix the header reads `Today` — it
  read `Today` while broken too, because `formatDateLabel` prints it whenever `selectedDate` and
  `todayStr` agree and both were frozen at the launch day. Only the date the tab asks the server for
  separates the two. Requests are recorded **by day**, not counted: a count cannot tell a re-read of
  the stale day from a read of the new one, which is the exact failure.
- **A precondition assertion before the boundary.** Without it, a spec seeing no new-day request
  cannot distinguish a stuck tab from a page that never loaded. BF-100 records four traps of that
  shape in `scroll-restoration.spec.ts`.
- **A negative case**, because `LocalDayProvider` seeds the day synchronously: an effect keyed on
  `useLocalDay()` alone fires once at mount and double-fetches every launch, invisible in use.
  `useDayRolloverRefresh` holds a ref so the first run is a no-op by construction; this pins that.

**Mutation-proven, which is the whole point of the entry.** Commenting out line 334 turns the
positive test red with its own message — *"Nutrition stayed on the launch day across midnight — a log
written now lands on the finished day"* — while the negative test correctly stays green.

## Not verified

- **No device check, deliberately, and that is the owner's decision on the record.** The symptom
  needs the app open across midnight on the S25. This test is what stands in for it, and RV-35
  returns only if the symptom is seen in the wild.
- No user-visible change ships here, so there is no version bump or changelog entry: the behaviour
  was already correct on `main`, and what lands is the guard against losing it.
