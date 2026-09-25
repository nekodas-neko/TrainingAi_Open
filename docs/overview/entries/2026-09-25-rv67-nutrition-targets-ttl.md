# 2026-09-25 — RV-67's second key, and the audit it invalidated

**Branch:** `lane-b/rv67-nutrition-targets-ttl` · **Lane:** Implementation B

`nutrition-targets` now skips the network inside its 6-hour TTL. One line of code; the proof is the
work, and this one had two halves the first key did not.

## Is the payload a derivation?

That question had to be settled before anything else. If targets were computed from body weight or
from goals, then **every body-metric write would be a writer of this key**, and the writer set would
be far larger than the group that clears it. They are not: `GET /api/nutrition/targets` is
`repo.getNutritionTargets(userId)`, a stored row.

The guard test pins that, because it is the assumption most likely to quietly stop being true — if
the route ever starts deriving, the proof has to be redone from scratch rather than patched.

## The second writer is not where you would look

`upsertNutritionTargets` has **two** callers, and only one is the obvious route:

- `PUT /api/nutrition/targets`
- **`PUT /api/user/goals`** (`app/api/user/goals/route.ts:77`), which upserts targets as a side
  effect of a goal change.

So every *goals* writer is silently a *targets* writer. Four client files write through those two
routes — `tdee-adaptation-card`, `goal-recommendation-sheet`, `macro-targets-pane`, `goals-section` —
and all four call `invalidateGoalRecommendations()`, which holds the key. Nothing in
`lib/local-store/**` or `app/api/sync/**` carries `nutrition_targets` or `user_goals`, so there is no
sync writer; and `health-content.tsx` reads `/api/user/goals` but does not write it.

The test asserts that writer set rather than the fix: a goals writer that forgot the invalidation
would leave a stale target for six hours with **no crash**, which is the only failure mode here.

## What made this key safe is its subscription

`useNutritionTargetsRefresh` already wired `useInvalidationRefetch('nutrition-targets', …)`. That is
what makes the flag safe rather than merely legal: a write clears the entry **and** re-runs the read,
so the flag only ever suppresses a request nothing has invalidated. Without that subscription a
cleared entry would sit unread until something else happened to fetch it.

Same site policy as the first key: the flag goes on the read path only. `macro-targets-pane` is the
screen that *edits* targets and stays unflagged, and the sync-provider warm entry stays unflagged
too — flag component read paths, never warming ones.

## It invalidated a recorded audit, and CLAUDE.md cites it

`docs/reviews/2026-08-16-goal-invalidation-audit.md` concluded that all six keys of
`invalidateGoalRecommendations()` are **inert** — that none of them can render a stale value the
invalidation prevents. True when written. It is now **five of six**, because this key meets the
audit's own first condition.

That is the Q-262 caveat arriving in practice rather than a flaw in the audit: *a key that is inert
today becomes load-bearing the moment someone adds `freshWithinTtl` to it.* The correction is written
at the head of the audit itself, not only in the backlog entry — CLAUDE.md quotes the headline, and a
reader who opens the audit should not have to find the backlog to learn it has moved.

**Not exercised:** no device, no browser. What is verified is that the flag reaches `cachedFetchCore`,
that the writer set is complete, and that the payload is still a stored row. The behavioural claim —
fewer requests on a warm Nutrition tab — the sandbox cannot show end to end.
