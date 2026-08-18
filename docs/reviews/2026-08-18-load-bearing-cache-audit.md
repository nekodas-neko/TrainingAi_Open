# Review — which cache invalidations are actually load-bearing

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** cache invalidation, the repo's most repeated bug class
**Findings filed:** none · **Closes an audit `CLAUDE.md` names as never done**

## Why

`CLAUDE.md` calls missed invalidation *"the single most repeated bug class in this project (12+
incidents, sessions 5→176)"*, and Q-262 established the test for whether an invalidation matters:

> `cachedFetchCore` paints the cached value and then **always** revalidates, so a stale entry can only
> survive as a *settled* value in two cases: **(a)** a call site passes `freshWithinTtl: true`, or
> **(b)** a read path is **seed-only**.

It then says only one group was audited against that test — *"Audited for one group: all six keys of
`invalidateGoalRecommendations()` are inert … The other groups are **not** audited."*

This sweep audits case (a) — every `freshWithinTtl: true` call site — which is the subset where a
missed invalidation causes hours of hard staleness rather than a brief flash.

## The audit

Sixteen `freshWithinTtl: true` occurrences resolve to **seven distinct keys**, all on `TTL_LONG`
(6 hours):

| Key | Group covering it | Client writers | Writer invalidates? |
|---|---|---|---|
| `exercise-library` | `invalidateExerciseLibrary` | `add-exercise-sheet.tsx` | ✅ (`:144`, `:171`) |
| `activity-types` | `invalidateActivityTypes` | *(none — admin manager only)* | ✅ `admin/activity-type-manager.tsx` |
| `progression-styles` | `invalidateProgramStructure` | `config-screen.tsx` | ✅ (5 call sites) |
| `workout-templates` | `invalidateProgramStructure` | `config-screen.tsx`, `workout-builder/builder-review.tsx` | ✅ (`:385`) |
| `progress-summary` | `invalidateBodyMetricWrite` | — | ✅ (in group, 6 refs) |
| `workout-data:all` / `workout-card:<id>` | `invalidatePrescriptionChanged` | — | ✅ (see below) |

**Every load-bearing key is in a group, and every client writer of the endpoint behind it calls that
group.** No gap found.

### The one that looked like a gap and is history

`app/session-select/session-select-content.tsx:896` carries:

> *"Q-117: `/api/confirm-early-deload` changes what's prescribed … but this handler only updated local
> readiness state — the `workout-data:all` / `workout-card:<id>` caches (freshWithinTtl, TTL_LONG)
> **never invalidated**, so every card kept showing full-intensity target weights for up to 6 hours."*

That reads as a live defect and is not — it is the **comment on the fix**, and the line immediately
below it is `invalidatePrescriptionChanged()`. Recorded here because the next person to grep
`never invalidated` will find it and reach for the alarm, as I did.

## Recorded as a design property, deliberately not filed

**These invalidations are device-local.** `lib/cache-groups.ts` clears the *writing client's* cache;
it has no way to reach another device. `exercise_library` and `activity_types` are **shared** tables
that every user reads, so a change made on one device leaves every other client serving the old list
as a *settled* value — `freshWithinTtl` means it is not merely a first paint — for up to **6 hours**.

I am not filing this, for two reasons. `TTL_LONG` is documented in `packages/shared/src/cache-ttl.ts`
as *"6 h — slow-changing config"*, so a catalogue being ≤6 h stale across devices is the stated
trade, not an oversight. And with the current user base a second device changing the catalogue is not
a thing that happens.

**It is worth knowing when multi-user lands**, which `projectOverview.md`'s 2026-08-02 amendment names
as the direction: at that point "the writer invalidates its own cache" stops being sufficient for a
shared table, and the answer is a version/etag on the payload or a shorter TTL for shared config —
not more invalidation call sites, which cannot help across devices.

## Case (b) is still unaudited

This sweep covered `freshWithinTtl` only. The other half of Q-262's test — **seed-only read paths**, a
screen that `readCacheSync`s a key and never fetches it — was not enumerated. That is the Q-260 shape
and it is the likelier source of a stale-value report, because it leaves no revalidation at all. It is
the obvious next sweep in this lens.

## Not verified

Static audit plus the local dev server. Not on the APK. Cross-device staleness was reasoned about, not
reproduced — this harness has one client.
