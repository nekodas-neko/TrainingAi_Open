# The deload confirm on Home evicts neither key the screen in front of you reads

**Date:** 2026-09-06 · **Agent:** Review 📖 (sweep 49) · **Pillars:** `[workouts]` `[app-shell]` `[nutrition]`
**Lens:** the owner's — "a lot of pages don't reset from what's cached when a change is applied",
naming two examples: adding nutrition foods, and selecting a deload.

The deload half reproduces at mechanism level and is two defects stacked. The nutrition half came
back **clean at source** — every food-add surface is wired — so either the owner's nutrition symptom
is these same two mechanisms seen from Home, or it is a device-path case this sandbox cannot reach;
the write-up ends with the one question that would settle it.

---

## 1. RV-49 — `invalidatePrescriptionChanged()` called without a sessionId skips the keys Home reads

`handleEarlyDeloadConfirm` (`app/session-select/session-select-content.tsx:887-892`) carries
Q-117's own fix comment — *"the workout-data:all / workout-card:<id> caches … never invalidated, so
every card kept showing full-intensity target weights for up to 6 hours"* — and then calls
`invalidatePrescriptionChanged()` **with no argument**. In the group
(`lib/cache-groups.ts:369-384`):

- `workout-card:<id>` eviction is **conditional on the id** (`...(programSessionId ? [...] : [])`),
  so the id-less call evicts **no** workout cards — the exact keys Q-117 names;
- **`next-session` is not in the group at all** (it lives in `invalidateProgramStructure` and
  three other groups) — and `next-session` is the Home recommendation's key
  (`session-select-content.tsx:550`, seeded at `:215/:289`).

So after tapping **Start deload week** on Home: the server re-prescribes, the card's own local state
flips, and the recommendation card plus every per-session card keep pre-deload weights out of cache
— `TTL_LONG` is 6 hours. Q-117's fix reached the *other* caller (`ai-prescription-card.tsx:106`
passes `sessionId`); the surface Q-117 was filed about still misses.

**The fix is one line each way:** add `invalidateCache('next-session')` to the group, and make the
`workout-card:` eviction a prefix drop when no id is given (the injuries group at `:238` already
does exactly that).

## 2. RV-50 — the reader half: raw seed-only `readCacheSync` turns any missed eviction into hard staleness

`cachedFetch` always revalidates, so an evicted key normally heals on the next fetch. A **raw
`readCacheSync` with no fetch of the same key** never revalidates: it serves whatever snapshot the
cache holds — stale if the eviction missed, blank if it hit — until something else happens to
refill the key. Scanned all 80 `readCacheSync` sites (43 files): 25 candidates, and after
discarding the ones paired with a loader or fallback in the same component, the live cluster is the
**workout-card family**, self-documented at two of the three sites:

| Site | Key | Its own comment |
|---|---|---|
| `app/session-select/components/recommendation-card.tsx:23` | `workout-card:<id>` | `:84` — "raw readCacheSync … rather than subscribing" |
| `app/workout-select/workout-select-content.tsx:32` | `workout-card:<id>` | `:99` — same wording |
| `components/workout-screen.tsx` | `workout-card:<id>` | — |

These are the Q-260 seed-only shape and the reason RV-49 bites for a full TTL rather than one
paint: the readers of the very keys the deload changes are the ones that can never revalidate on
their own. Fix travels with RV-49 — either subscribe (`useCachedValue`) or accept that these reads
are only as fresh as the write-side groups are complete, which RV-49 shows they are not.

Checked and **not** in this class (fallbacks present): `food-logger-sheet`'s `nutrition-meal-types`
(empty → fetch) and `saved-meals` (device → local store); `nutrition-content`'s seeds (paired with
`useFoodLogsLoader`); `session-select`'s seeds (paired with `useInvalidationRefetch`).

## 3. The nutrition half — clean at source, with method

Every food-add surface was enumerated and each one closes the loop:

- The three sheet mounts in `nutrition-content` pass `onLogged={handleFoodLogged}` (:638/:714);
  `saved-meals-sheet` forwards per-log (`:455`); the plan card's `usePlanMealLogging` takes
  `onLogged` typed with the written entity; `quick-edit-log-sheet` carries 4 callbacks + 4
  invalidations; supplements/water wired.
- `invalidateNutritionWrite` (`cache-groups.ts:454-474`) evicts eleven keys including
  `home-day-timeline`, and Home repaints it via `useInvalidationRefetch`.
- `use-day-entry-mutations` has **no food branch** — food edits from the day views ride
  `quick-edit-log-sheet`, which is wired.
- The tab-visibility `epoch` re-runs each tab's fetches on re-entry, so cross-tab staleness heals
  on navigation by design (`components/shell/tab-visibility.tsx:33-36`).

**What would settle the owner's nutrition report:** one concrete reproduction — which screen the
food was added FROM, and which screen failed to update. If it is Home's timeline or recommendation
immediately after the add, RV-49/RV-50's mechanisms cover it; if it is the nutrition tab itself on
the APK, it is a local-store path this sandbox cannot exercise (`getLocalStore()` is null here) and
goes to the device checklist.

## 4. Not exercised

Rendered repaints were not observed in a browser — the mechanism evidence is source-level
(key-by-key group membership, the conditional, the raw-read sites and their own comments) plus the
owner's live report; a Playwright DOM assertion would close it fully and belongs with the fix's
test. The device (local-first reads, the APK's persistent shell lifecycle) was not exercised.

## 5. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-49** | `[workouts]` `[app-shell]` | The Home deload confirm calls `invalidatePrescriptionChanged()` id-less, which skips `workout-card:*` by the group's own conditional and never touches `next-session` — the two keys the visible screen reads; Q-117's fix reached only the id-passing caller |
| **RV-50** | `[app-shell]` | Three raw seed-only `readCacheSync('workout-card:<id>')` reads never revalidate, converting any missed eviction into TTL-long staleness — the reader half of RV-49, two sites self-documented |

## 6. Method notes

- **When a fix comment sits directly above the call it doesn't cover, test the call, not the
  comment.** Q-117's narrative is accurate about the mechanism and wrong about being fixed on this
  surface — the group's conditional made the id-less call a no-op for the named keys.
- **Scan for the reader class mechanically**: `readCacheSync` keys with no `cachedFetch`/
  `useCachedValue` of the same key in the file — 80 sites reduce to 3 live ones once fallbacks are
  discarded by reading each candidate.
- **A clean writer surface is a real result**: all nine nutrition writers close the callback loop,
  which localises the owner's symptom to the deload mechanisms or the device path rather than a
  missing group entry.
