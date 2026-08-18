# 2026-08-18 — Review: which cache invalidations are actually load-bearing

**Agent:** Review 📖 · **Branch:** `claude/review-cache-invalidation-live` · **Docs-only.**
**Filed:** nothing · **Review:** [`docs/reviews/2026-08-18-load-bearing-cache-audit.md`](../../reviews/2026-08-18-load-bearing-cache-audit.md)

## Why

`CLAUDE.md` calls missed invalidation the single most repeated bug class in this project, and Q-262
established the test for whether an invalidation matters at all: `cachedFetchCore` always
revalidates, so a stale entry survives as a *settled* value only when a call site passes
`freshWithinTtl: true` or a read path is seed-only. That file then records that only
`invalidateGoalRecommendations` was ever audited — *"the other groups are not audited."*

## Case (a), audited and clean

Sixteen `freshWithinTtl: true` occurrences resolve to seven keys, all `TTL_LONG` (6 h):
`exercise-library`, `activity-types`, `progression-styles`, `workout-templates`, `progress-summary`,
and `workout-data:all`/`workout-card:<id>`.

Every one is in an invalidation group, and every client writer of the endpoint behind it calls that
group — `add-exercise-sheet.tsx`, `config-screen.tsx` (5 sites), `workout-builder/builder-review.tsx`,
`admin/activity-type-manager.tsx`. **No gap found.**

## The one that reads as a live defect and is not

`session-select-content.tsx:896` says the `workout-data` caches are *"never invalidated … for up to 6
hours"*. That is the comment on the **Q-117 fix**, and `invalidatePrescriptionChanged()` is the line
below it. Recorded because the next person to grep `never invalidated` will find it and reach for the
alarm, as I did.

## A design property, deliberately not filed

The invalidations are **device-local** — `cache-groups.ts` clears the writing client's cache and
cannot reach another device. `exercise_library` and `activity_types` are shared tables, so a change on
one device leaves other clients serving the old list as a settled value for up to 6 h.

Not filed: `TTL_LONG` is documented as *"slow-changing config"*, so that is the stated trade, and the
current user base has no second writer. Worth knowing when multi-user lands — the answer then is a
version/etag or a shorter TTL for shared config, not more invalidation call sites, which cannot help
across devices.

## Case (b) is still unaudited

Seed-only read paths — a screen that `readCacheSync`s a key and never fetches it, the Q-260 shape.
That half leaves no revalidation at all and is the likelier source of a stale-value report. The
obvious next sweep in this lens.

## Not verified

Static audit plus local dev. Not on the APK. Cross-device staleness was reasoned about, not
reproduced — this harness has one client.
