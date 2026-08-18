# 2026-08-16 — the invalidation that wasn't protecting anything

Q-262, the question Q-259's measurement exposed: does `invalidateGoalRecommendations()` do anything,
for any of its six keys? **No — for all six.** Docs and one CLAUDE.md rule; no code change.

## The mechanism, which the rule never stated

`cachedFetchCore` paints the cached value and then **always** revalidates over the network. A stale
entry can therefore only survive as a *settled* value in two cases:

- **(a)** a call site passes `freshWithinTtl: true`, which short-circuits on a fresh entry, or
- **(b)** a read path is **seed-only** — a screen that `readCacheSync`s the key and never fetches it.

Absent both, the cache is a first-paint accelerator and clearing it changes nothing about where the
screen ends up.

## Per-key answer

None of `energy-balance:<date>`, `nutrition-targets`, `body-metadata`, `progress-summary`,
`user-goals` or `more-user-profile` is fetched with `freshWithinTtl`, and none has a seed-only read
path — every screen that seeds one also fetches it, and five are in the sync-provider warm list as
well. **Every `freshWithinTtl` call site in the app was enumerated**; the one inside
`health-content.tsx` is `activity-types`, not a goal key.

The full table is in
[`docs/reviews/2026-08-16-goal-invalidation-audit.md`](../../reviews/2026-08-16-goal-invalidation-audit.md).

One key needed reading rather than grepping: `energy-balance:<date>` is built by `energyKeyFor(date)`,
so no literal search finds it. That is the same static blind spot `check-cache-ttl-divergence.js`
counts and reports — a reminder that a clean sweep is not the same as full coverage.

## What the invalidation actually does

It clears a first-paint seed, so the next visit paints **nothing** where it would have painted a
slightly-stale value that corrects a moment later. By the repo's own instant-paint rule that is the
worse outcome, and it is strictly worse offline, where `cachedFetch` cannot revalidate and the seed
is the only data there is.

## Why no code was deleted

`lib/cache-groups.ts` is untouched, and that is a decision rather than caution:

1. The group becomes load-bearing the instant anyone adds `freshWithinTtl` to one of these six keys —
   a reasonable thing to do for an expensive payload. Removing it now buries the failure in a future
   PR with no reason to look here.
2. The convention that every write invalidates through a named group is worth more than six inert
   lines. A group that is currently inert still states the dependency correctly.

## What did change: the rule

CLAUDE.md stated the bug class — *"missed invalidation is the single most repeated bug class in this
project (12+ incidents)"* — without stating what makes an invalidation load-bearing. So invalidation
calls get added defensively, believing they prevent staleness `cachedFetch` already prevents, while
the cases that genuinely need it go unrecognised.

The amendment names conditions (a) and (b) and explicitly **does not** license skipping invalidation.
Its practical value is triage: a stale-value report is more often condition (b) — a read path with no
fetch — than a missing group entry. **That is exactly what Q-260 turned out to be**, and it was
misdiagnosed twice as a cache-invalidation problem before being measured.

## Honest limits

- **Only this group was audited.** The others are not expected to come out the same way —
  `cache-groups.ts` already flags `workout-data:all` and `workout-card:<id>` as `freshWithinTtl` keys
  that caused a real bug. Filed as **Q-263** with the method.
- **The blank-first-paint consequence is reasoned from the code path, not reproduced in a browser.**
  It follows from `readCacheSync` returning null after an invalidation, and the offline case from
  `cachedFetch` having no fallback. The settled-value claim — the one the audit turns on — is both
  static and, for `user-goals`, directly measured in Q-259.
- **The 12+ historical incidents were not imaginary.** Several were condition (a) and at least one was
  condition (b). The mechanism is real; it is narrower than "any missed invalidation".

## Verification

`npx tsc --noEmit` · `pnpm lint` · `pnpm build` · `pnpm check:rules` · unit suite · E2E. No version
bump — documentation and one rule, no runtime code touched, nothing user-visible.
