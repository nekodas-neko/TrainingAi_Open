# Does `invalidateGoalRecommendations()` do anything? — Q-262

**Answer: no, for all six of its keys, in the sense that matters.** None of them can render a stale
value that the invalidation prevents. The audit below is per-key and reproducible.

This started from a measurement in Q-259: deleting the invalidation changed neither the settled
value nor the transient paint of the water goal on Health. The reason looked general rather than
specific to that key, which is what this checks.

## The two conditions

`cachedFetchCore` (`lib/sqlite/cache.ts`) paints the cached value through `onData(cached)` and then
**always proceeds to the network fetch** — unless the call site passes `freshWithinTtl`, which
short-circuits on a still-fresh entry. So a stale cache entry can only reach the user's eyes as a
settled value if either:

- **(a)** some call site fetches the key with `freshWithinTtl: true`, or
- **(b)** some read path is **seed-only** — a screen that `readCacheSync`s the key and never fetches
  it (the Q-260 shape).

Absent both, the cache is a first-paint accelerator, not a source of truth, and invalidating it
cannot change where the screen ends up.

## Per-key result

| Key | Fetched with | `freshWithinTtl`? | Seed-only read anywhere? | Can invalidation change the settled value? |
|---|---|---|---|---|
| `energy-balance:<date>` | `cachedFetch` (`day-detail-content.tsx`) | **no** | no — seeded and fetched in the same `load()` | **No** |
| `nutrition-targets` | `cachedFetch` ×3 (`nutrition-content`, `macro-targets-pane`, `assign-step`) | **no** | no — every seeding screen also fetches | **No** |
| `body-metadata` | `cachedFetch` ×5 (`session-select`, `health-content`, `nutrition-content`, `end-of-day-review`, `goals-section`) | **no** | no — every seeding screen also fetches | **No** |
| `progress-summary` | `cachedFetchToday` (`health-content`) | **no** | no | **No** |
| `user-goals` | `cachedFetch` ×2 (`health-content`, `goals-section`) | **no** | no (since Q-260 moved it to the shared group) | **No** — also measured directly, see Q-259 |
| `more-user-profile` | `cachedFetch` ×3 (`more-content`, `session-select`, `done-activity-screen`) | **no** | no | **No** |

**Every `freshWithinTtl` call site in the app was enumerated** and none of them is one of these six:
`workout-select-content` ×2, `session-select-content` ×1, `health-content` ×1 (that one is
`activity-types`, not a goal key), `add-exercise-sheet`, `config-screen` ×2,
`activity-history-card`, `log-activity-sheet`.

Five of the six are *additionally* in the sync-provider warm list (`body-metadata`,
`progress-summary`, `user-goals`, `nutrition-targets`, `more-user-profile`) — a second revalidation
path on top of their own screens'.

**Method note:** `energy-balance:<date>` is built by a helper (`energyKeyFor(date)`), so it is
invisible to a literal grep — the same static blind spot `check-cache-ttl-divergence.js` reports and
counts. It was resolved by reading `day-detail-content.tsx` directly rather than trusting the sweep.

## What the invalidation actually does

It clears a first-paint seed. On the next visit the screen paints **nothing** where it would have
painted a slightly-stale value that corrects a moment later.

By the repo's own instant-paint rule — *"First paint shows last-known data, not a spinner"* — that
is the worse of the two outcomes, not the better one. Two situations sharpen it:

- **A mounted tab.** All five tabs stay mounted for the app's life, so the first paint after a tab
  re-entry comes from retained React state, not the cache. Measured in Q-259: the transient sequence
  was byte-identical with and without the invalidation.
- **Offline.** `cachedFetch` cannot revalidate, so the seed is the only data there is. A cleared
  cache means a blank card instead of yesterday's number, in an app whose whole architecture is
  offline-first.

## Recommendation — and what is deliberately NOT done here

**No code change.** `lib/cache-groups.ts` is untouched, for two reasons:

1. **The group is cheap insurance against a future call site.** The moment anyone adds
   `freshWithinTtl: true` to one of these six keys — a reasonable thing to do for an expensive
   payload — the group becomes load-bearing. Deleting it now would move the failure into a future
   PR that has no reason to look here.
2. **The repo's convention is that every write invalidates through a named group.** A group that is
   currently inert still expresses the dependency correctly, and removing it would make this write
   path the one exception a future reader has to discover.

**What is worth changing is the rule's wording, not the code.** CLAUDE.md says missed invalidation
is "the single most repeated bug class in this project (12+ incidents)", which is true, but it does
not say *what makes an invalidation load-bearing*. Without that, sessions add invalidation calls
believing they prevent staleness that `cachedFetch` already prevents — and, more importantly, may
miss the cases that genuinely need it. Those cases are exactly (a) and (b) above, and both are
checkable in a minute.

An amendment naming the two conditions is proposed in the same PR as this audit.

## What this does not claim

- **It does not say the 12+ historical incidents were imaginary.** Several were `freshWithinTtl`
  keys (`workout-data:all`, `workout-card:<id>` — condition (a), documented in `cache-groups.ts`'s
  own comments) and at least one, Q-260, was condition (b). The mechanism is real; it is narrower
  than "any missed invalidation".
- **It does not audit the other groups.** `invalidateWorkoutSummaries`, `invalidateProgramStructure`
  and the rest may well contain load-bearing keys — `cache-groups.ts` comments explicitly flag
  `freshWithinTtl` keys inside them. Only `invalidateGoalRecommendations` was in scope.
- **The blank-first-paint consequence is reasoned from the code path, not measured on a cold start.**
  It follows directly from `readCacheSync` returning null after an invalidation, and the offline case
  from `cachedFetch` having no fallback — but neither was reproduced in a browser here. The
  *settled-value* claim, which is the one this audit turns on, is both static and measured.
