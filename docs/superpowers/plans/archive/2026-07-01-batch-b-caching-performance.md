# Batch B — Caching & Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Batch B gaps from `docs/planned_upgrades.md` — B1 stale-invalidation gaps routed through `lib/cache-groups.ts` helpers, B2 the full uncached read-site matrix (`cachedFetch` + `readCacheSync` seeds so no screen shows a spinner on repeat visit), B3 render/bundle perf (extract the 1 Hz tick out of the workout orchestrator, stagger `SyncProvider.warmCache`, adopt `next/image`), and B4 server-side wins (bounded `getOuraWorkouts` + `Cache-Control` headers on the heavy read routes).

**Architecture:** The client cache (`lib/sqlite/cache.ts`) is stale-while-revalidate: `cachedFetch(key, url, ttl, onData)` calls `onData` with the cached value, then again with the network response; `readCacheSync(key)` serves the sessionStorage/localStorage mirror synchronously before first paint; `invalidateCache(prefix)` is prefix-based. The bug classes here are (a) writes that hand-roll partial invalidation lists — fixed by group helpers in `lib/cache-groups.ts`, (b) read sites doing bare `fetch()` for data that is (or should be) cached — fixed by converting to `cachedFetch` + seeding initial state from `readCacheSync`, (c) the workout orchestrator re-rendering 1,034 lines at 1 Hz — fixed by moving the tick into leaf components, and (d) routes recomputing on every request with no HTTP-cache assist.

**Tech Stack:** Next.js 15 + React 19 + TypeScript, Tailwind v4, client SQLite/localStorage cache, Drizzle ORM, vitest, pnpm.

---

## Explicitly excluded (already in the quick-wins plan — do NOT duplicate)

- **Migration 103 indexes** (`set_logs(updated_at)`, `exercise_logs(updated_at)`, `personal_records(user_id, achieved_at DESC)`, `food_logs(user_id, meal_type_id, logged_at)`) — quick win 4.
- **Lazy-loading `AiChatOverlay`** (`next/dynamic`, `ssr:false`) on session-select/done/stats/overview + lazy `Response`/`CodeBlock`, and **dynamic-importing `HrDayChart`** in `home-card-widget` — quick win 5.
- **`invalidateOuraSync()` group helper** (fixes `health-content.tsx:509-511` post-sync staleness) and **injury-write invalidation** (`injury-sheet.tsx:130,171`) — quick win 8. Where this plan touches adjacent code (e.g. the `oura-token` key in Task 3.7), a coordination note is included instead of re-implementing.

## Deliberate scope decisions

- **No SWR HTTP headers on `nutrition/food-logs`, `nutrition/targets`, `nutrition/meal-types`, `body-metadata`**: these are written by the user and then immediately re-read; a browser-level `max-age` serves the pre-write response for up to 60 s *after* the client cache was correctly invalidated. The 2026-06-21 saving audit (H2) already identified this exact failure on `body-metadata`. B4's "nutrition routes" is satisfied by `nutrition/weekly-summary` (a server-computed aggregate).
- **`day-timeline` gets the shorter `max-age=30` header** (matching `calendar-data`/`workout-data`) rather than 60, because activity/meal writes invalidate its client key and expect a fresh refetch.
- **Blob/data-URL preview `<img>`s stay `<img>`** (camera capture preview, feedback screenshot, admin GIF generation preview, hidden GIF preloader) — `next/image` adds nothing for transient in-memory previews and does not optimize animated GIFs.

## New / changed cache keys

| Key | URL | TTL | Invalidated by |
|---|---|---|---|
| `friends-list` | `/api/friends` | `TTL_MEDIUM` | `invalidateFriends()` (prefix `friends-`) |
| `friends-feed` | `/api/friends/feed` | `TTL_SHORT` | `invalidateFriends()` + TTL (others' activity) |
| `friends-leaderboard` | `/api/friends/leaderboard` | `TTL_SHORT` | `invalidateFriends()`, `invalidateWorkoutSummaries()` |
| `supplements` | `/api/supplements` | `TTL_MEDIUM` | `invalidateSupplements()` |
| `exercise-history:{name}` | `/api/exercise-history?name=…` | `TTL_MEDIUM` | `invalidateWorkoutSummaries()` (prefix `exercise-history:`) |
| `program-week` | `/api/program-week` | `TTL_MEDIUM` | `invalidateWorkoutSummaries()`, `invalidateProgramStructure()` |
| `oura-token` | `/api/oura/token` | `TTL_MEDIUM` | connect/disconnect write sites (+ quick-wins `invalidateOuraSync()` — see Task 3.7) |
| `morning-briefing:{date}` | `/api/morning-briefing` | `TTL_LONG` | date-scoped key; TTL only |
| *(reused, no new key)* `injuries`, `nutrition-meal-types`, `nutrition-targets`, `nutrition-food-logs-{date}` (TTL **60 s**, matches `nutrition-content.tsx:113`), `body-metadata`, `body-battery`, `exercise-library`, `more-user-profile`, `mood:{date}`, `home-day-timeline` | — | existing groups unchanged |

## New cache-group helpers (Task 1/2)

| Helper | Clears |
|---|---|
| `invalidateActivityWrites()` | `activity-logs`, `weekly-stats`, `muscle-recovery`, `achievements:`, `calendar-data:`, `home-day-timeline`, `body-metadata` |
| `invalidateBodyMetricWrite()` | `body-metadata`, `progress-summary` |
| `invalidateFriends()` | `friends-` (prefix → list + feed + leaderboard) |
| `invalidateSupplements()` | `supplements` |

**Branch:** `perf/batch-b-caching` off `main`. Commit after each task with plain human messages (e.g. "route activity and water writes through cache-group helpers"), no AI attribution. All work goes to `main` via PR with green CI; the merge needs explicit user confirmation.

---

### Task 1: Invalidation-group refactor (B1 remainder)

**Files:**
- `lib/cache-groups.ts` (append after `invalidateGoalRecommendations`, line 73)
- `lib/__tests__/cache-groups.test.ts`
- `components/activity/done-activity-screen.tsx:27-41` (local `invalidateActivityCaches`)
- `components/activity/exercise-review-sheet.tsx:141-144` (Oura walk confirm)
- `app/health/health-content.tsx:629-631` (activity delete)
- `components/profile/water-log-sheet.tsx:55,76`

- [ ] Add two helpers to `lib/cache-groups.ts`:

```ts
/** Every cache that renders a saved activity (walk/run/treadmill). Extracted from
 *  done-activity-screen — the other activity write sites were missing
 *  `home-day-timeline` and `calendar-data:` and stayed stale for up to 30 min. */
export async function invalidateActivityWrites(): Promise<void> {
  await Promise.all([
    invalidateCache('activity-logs'),
    invalidateCache('weekly-stats'),
    invalidateCache('muscle-recovery'),
    invalidateCache('achievements:'),
    invalidateCache('calendar-data:'),
    invalidateCache('home-day-timeline'),
    // treadmill steps fold into the day/week step totals (body-metadata)
    invalidateCache('body-metadata'),
  ])
}

/** Caches that render body-metric quick logs (water, weight, steps). */
export async function invalidateBodyMetricWrite(): Promise<void> {
  await Promise.all([
    invalidateCache('body-metadata'),
    invalidateCache('progress-summary'),
  ])
}
```

- [ ] `components/activity/done-activity-screen.tsx`: delete the local `invalidateActivityCaches` function (lines 27-41 incl. its comment), import `invalidateActivityWrites` from `@/lib/cache-groups`, and replace every `invalidateActivityCaches()` call in the file (grep the file — there are multiple call sites) with `invalidateActivityWrites()`. Remove the now-unused `invalidateCache` import if nothing else in the file uses it.
- [ ] `components/activity/exercise-review-sheet.tsx:141-144`: replace

```ts
      await Promise.all([
        invalidateCache('activity-logs'),
        invalidateCache('weekly-stats'),
      ])
```
with `await invalidateActivityWrites()` (import from `@/lib/cache-groups`; drop the `invalidateCache` import if unused).
- [ ] `app/health/health-content.tsx` `handleDeleteActivity` (lines 629-631): replace the three `invalidateCache(...)` calls with `await invalidateActivityWrites();` (the file already imports `invalidateWorkoutSummaries` from `@/lib/cache-groups` — extend that import).
- [ ] `components/profile/water-log-sheet.tsx`: replace both `invalidateCache('body-metadata')` calls (line 55 local-store path, line 76 web fallback) with `invalidateBodyMetricWrite().catch(() => {})` (import from `@/lib/cache-groups`; remove the `invalidateCache` import).
- [ ] Extend `lib/__tests__/cache-groups.test.ts` (mirror the existing mock style exactly):

```ts
  it('invalidateActivityWrites clears timeline + calendar alongside the activity caches', async () => {
    await invalidateActivityWrites()
    expect(invalidated).toEqual(expect.arrayContaining([
      'activity-logs', 'weekly-stats', 'muscle-recovery', 'achievements:',
      'calendar-data:', 'home-day-timeline', 'body-metadata',
    ]))
  })

  it('invalidateBodyMetricWrite clears body-metadata and progress-summary', async () => {
    await invalidateBodyMetricWrite()
    expect(invalidated).toEqual(expect.arrayContaining(['body-metadata', 'progress-summary']))
  })
```
(add the new names to the import at line 9).
- [ ] Run `pnpm test` (cache-groups suite green), `pnpm lint`, `npx tsc --noEmit`.
- [ ] **Manual verification** (`pnpm dev`, local DB, test@local.dev / testpass123): log a water entry from the profile/goals water sheet, then open the Health progress summary — the water figure must reflect the new total immediately (no 30-min lag). Delete an activity from the Health day overlay — the home timeline and training calendar must drop it on next visit without waiting for TTL.
- [ ] Commit.

---

### Task 2: New cache keys — friends + supplements (B2 rows 1-2)

**Files:**
- `lib/cache-groups.ts`, `lib/__tests__/cache-groups.test.ts`
- `components/more/friend-feed.tsx:53-63`
- `components/more/friend-leaderboard.tsx:25-38`
- `components/more/friends-tab.tsx:18-25`
- `components/more/manage-friends-sheet.tsx:25-70`
- `app/nutrition/nutrition-content.tsx:219-232`
- `components/nutrition/supplements-section.tsx:26-72` (`toggleLog`)
- `components/nutrition/manage-supplements-sheet.tsx` (`handleSave` ~40, `handleDelete` ~120, `toggleActive` ~163)
- `components/sync-provider.tsx:201-215` (supplement-reminder reconcile)

- [ ] Add to `lib/cache-groups.ts`:

```ts
/** Friend graph changed (request sent/accepted/declined/removed) — clear list, feed, leaderboard. */
export async function invalidateFriends(): Promise<void> {
  await invalidateCache('friends-')
}

/** Supplement definitions or today's logs changed. */
export async function invalidateSupplements(): Promise<void> {
  await invalidateCache('supplements')
}
```
Also add `invalidateCache('friends-leaderboard'),` to the `Promise.all` inside `invalidateWorkoutSummaries` (the user's own sessions/volume/streak feed the board).
- [ ] Extend `lib/__tests__/cache-groups.test.ts`: `invalidateFriends` → `['friends-']`; `invalidateSupplements` → `['supplements']`; add `'friends-leaderboard'` to the `invalidateWorkoutSummaries` expectation.
- [ ] `components/more/friend-feed.tsx` — replace the effect (lines 57-63) with a seeded `cachedFetch`:

```ts
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_SHORT } from "@/components/sync-provider";
// …
  const [events, setEvents] = useState<FeedEvent[]>(
    () => readCacheSync<{ events: FeedEvent[] }>('friends-feed')?.events ?? [],
  );
  const [loading, setLoading] = useState(events.length === 0);

  useEffect(() => {
    cachedFetch<{ events: FeedEvent[] }>(
      'friends-feed', '/api/friends/feed', TTL_SHORT,
      d => { if (d?.events) setEvents(d.events); },
    ).catch(() => {}).finally(() => setLoading(false));
  }, []);
```
- [ ] `components/more/friend-leaderboard.tsx` — same shape (lines 32-38):

```ts
  const [entries, setEntries] = useState<LeaderboardEntry[]>(
    () => readCacheSync<{ entries: LeaderboardEntry[] }>('friends-leaderboard')?.entries ?? [],
  );
  const [loading, setLoading] = useState(entries.length === 0);

  useEffect(() => {
    cachedFetch<{ entries: LeaderboardEntry[] }>(
      'friends-leaderboard', '/api/friends/leaderboard', TTL_SHORT,
      d => { if (d?.entries) setEntries(d.entries); },
    ).catch(() => {}).finally(() => setLoading(false));
  }, []);
```
(`loading` is used by the skeleton further down — keep its semantics.)
- [ ] `components/more/friends-tab.tsx` — convert `fetchFriendships` (lines 18-23):

```ts
  const fetchFriendships = () => {
    cachedFetch<{ friendships: Friendship[] }>(
      'friends-list', '/api/friends', TTL_MEDIUM,
      d => { if (d?.friendships) setFriendships(d.friendships); },
    ).catch(() => {});
  };
```
- [ ] `components/more/manage-friends-sheet.tsx` — after each successful write, invalidate before `onRefresh()` so the refetch bypasses the fresh-looking cache. Import `invalidateFriends` from `@/lib/cache-groups` and in `handleAdd` (after `toast.success('Friend request sent')`), `handleAccept`, `handleDecline`, and `handleRemove` insert `await invalidateFriends();` immediately before `onRefresh();`.
- [ ] `app/nutrition/nutrition-content.tsx:219-232` — replace **both** raw `/api/supplements` fetches (local-store-empty fallback at :220 and the no-store branch at :227) with:

```ts
        cachedFetch<SupplementWithStatus[]>(
          'supplements', '/api/supplements', TTL_MEDIUM,
          d => setSupplements(Array.isArray(d) ? d : []),
        ).catch(() => {}).finally(() => setSupplementsLoading(false));
```
(`cachedFetch`, `TTL_MEDIUM` are already imported in this file.)
- [ ] `components/nutrition/supplements-section.tsx` `toggleLog` — after the optimistic `onChanged(...)` in **both** the local-store path (:54) and the API fallback (:65), add `invalidateSupplements().catch(() => {})` (import from `@/lib/cache-groups`). The server's `loggedToday` flags change on every toggle; without this the new `supplements` cache re-serves the pre-toggle state.
- [ ] `components/nutrition/manage-supplements-sheet.tsx` — in `handleSave`, `handleDelete`, and `toggleActive`, add `invalidateSupplements().catch(() => {})` after each successful write (both local-store and API branches).
- [ ] `components/sync-provider.tsx:201-215` — the supplement-reminder reconcile refetches `/api/supplements` on **every** app resume; route it through the same key:

```ts
    async function reconcile() {
      try {
        let supplements: unknown = null;
        await cachedFetch('supplements', '/api/supplements', TTL_MEDIUM, d => { supplements = d; });
        await reconcileSupplementReminders(
          Array.isArray(supplements) ? supplements : [],
          new Date(),
        );
      } catch {
        // Network unavailable — skip
      }
    }
```
(add `cachedFetch` to the existing `@/lib/sqlite/cache` import at line 6; `cachedFetch` awaits the network refresh before resolving, so `supplements` holds the freshest available copy.)
- [ ] `pnpm test`, `pnpm lint`, `npx tsc --noEmit`.
- [ ] **Manual verification** (`pnpm dev`): More → Friends — first visit shows the skeleton once; navigate away and back — feed/leaderboard/list paint instantly with no skeleton. Send/remove a friend request — the list updates immediately after the action. Nutrition tab: toggle a supplement, kill and reopen the tab — the checkbox state is correct (not the pre-toggle cached state).
- [ ] Commit.

---

### Task 3: Seed-only fixes — re-use existing keys, kill repeat-visit spinners (B2 rows 3-10)

**Files:** each sub-step lists its own. All imports follow the same pattern: `cachedFetch`/`readCacheSync` from `@/lib/sqlite/cache`, TTLs from `@/components/sync-provider`. The reference `readCacheSync`-seed pattern is `app/nutrition/nutrition-content.tsx:75,113`.

- [ ] **3.1 Pre-workout injuries** — `components/workout-screen.tsx:262-267`: the API fallback ignores the `injuries` key that health-content already populates (`health-content.tsx:435,450`). Replace `loadFromApi`:

```ts
    const loadFromApi = () =>
      cachedFetch<Injury[]>('injuries', '/api/injuries', TTL_MEDIUM,
        d => setActiveInjuries((Array.isArray(d) ? d : []).filter((i: Injury) => !i.resolvedDate)),
      ).catch(() => {});
```
(add `TTL_MEDIUM` to this file's `@/components/sync-provider` import if absent; `cachedFetch` is already imported). The local-store-first branch above it stays untouched.
- [ ] **3.2 Assign step** — `components/nutrition/assign-step.tsx:28-53`: all three fetches hit keys that are already cached elsewhere. Replace the effect body:

```ts
    cachedFetch<MealType[]>('nutrition-meal-types', '/api/nutrition/meal-types', TTL_LONG, (data) => {
      setMealTypes(data)
      const hour = new Date().getHours()
      const match = data.find(m => hour >= m.timeStartHour && hour < m.timeEndHour)
      // functional update: onData fires twice (cached + fresh) — don't clobber a user pick
      setSelectedId(prev => prev ?? (match?.id ?? data[0]?.id ?? null))
    }).catch(() => {}).finally(() => setLoadingTypes(false))
    const today = todayInTz()
    cachedFetch<FoodLogWithItem[]>(
      `nutrition-food-logs-${today}`, `/api/nutrition/food-logs?date=${today}`, 60,
      logs => setTodayCalories(Array.isArray(logs) ? logs.reduce((sum, l) => sum + l.calories, 0) : 0),
    ).catch(() => {})
    cachedFetch<NutritionTargets>('nutrition-targets', '/api/nutrition/targets', TTL_LONG,
      t => setCalorieTarget(t?.calories ?? null),
    ).catch(() => {})
```
(the 60 s TTL matches `nutrition-content.tsx:113` exactly — do not lengthen it). Imports: `cachedFetch`, `TTL_LONG`.
- [ ] **3.3 Macro targets pane** — `components/profile/macro-targets-pane.tsx:29-44`: replace the raw `fetch('/api/nutrition/targets')` with `cachedFetch<NutritionTargets>('nutrition-targets', '/api/nutrition/targets', TTL_LONG, (t) => { setForm({ …existing mapping unchanged… }) }).catch(() => {}).finally(() => setLoading(false))`. The save path already calls `invalidateGoalRecommendations()` (which clears `nutrition-targets`), so the `refreshKey` refetch stays fresh.
- [ ] **3.4 Goals section** — `components/profile/goals-section.tsx:85-111`: replace `fetch('/api/body-metadata')` with `cachedFetch('body-metadata', '/api/body-metadata', TTL_MEDIUM, (d) => { …existing handler body unchanged… }).catch(() => {})`, keeping the exact response type annotation currently inline.
- [ ] **3.5 Exercise-history unification** — one key `exercise-history:{name}` for both consumers:
  - `components/workout/exercise-summary-screen.tsx:40-52`:

```ts
  useEffect(() => {
    cachedFetch<{ entries: Array<{ estimated1rm: number | null }> }>(
      `exercise-history:${exName}`,
      `/api/exercise-history?name=${encodeURIComponent(exName)}`,
      TTL_MEDIUM,
      d => {
        const vals = (d?.entries ?? [])
          .map(e => e.estimated1rm)
          .filter((v): v is number => v != null && v > 0)
          .reverse(); // chronological, current session is last
        setRmHistory(vals);
      },
    ).catch(() => {});
  }, [exName]);
```
  - `components/workout/exercise-stats-sheet.tsx:57-65`: replace the history fetch inside the `Promise.all` (keep the AbortController for the gif fetch only — `cachedFetch` dedupes in-flight requests itself):

```ts
      (async () => {
        let got = false;
        const hit = await cachedFetch<{ entries: ExerciseHistoryEntry[] }>(
          `exercise-history:${exercise.name}`,
          `/api/exercise-history?name=${encodeURIComponent(exercise.name)}`,
          TTL_MEDIUM,
          d => { got = true; setEntries(d?.entries ?? []); },
        ).catch(() => false);
        if (!got && !hit) { setError(true); setEntries([]); }
      })(),
```
  - Add `invalidateCache('exercise-history:'),` to `invalidateWorkoutSummaries` in `lib/cache-groups.ts` (and to its unit-test expectation) so history refreshes after a workout completes. Mid-workout the SWR refetch already appends the just-logged session.
- [ ] **3.6 Add-exercise sheet re-caching** — `components/exercises/add-exercise-sheet.tsx:58-64`: the raw fetch never writes back to the `exercise-library` cache it seeds from. Replace:

```ts
  useEffect(() => {
    if (!open || library.length > 0) return
    cachedFetch<{ exercises: ExerciseLibraryEntry[] }>(
      'exercise-library', '/api/exercise-library', TTL_LONG,
      d => { if (d?.exercises) setLibrary(d.exercises) },
    ).catch(() => {})
  }, [open, library.length])
```
- [ ] **3.7 Oura battery chip** — `components/oura-battery-chip.tsx:27-39`: add key + seed:

```ts
type TokenStatus = { connected?: boolean; batteryLevel?: number | null; batteryCharging?: boolean | null }

export function OuraBatteryChip() {
  const [battery, setBattery] = useState<BatteryState | null>(() => {
    const d = readCacheSync<TokenStatus>('oura-token')
    return d?.connected && d.batteryLevel != null
      ? { level: d.batteryLevel, charging: d.batteryCharging ?? null }
      : null
  })

  useEffect(() => {
    cachedFetch<TokenStatus>('oura-token', '/api/oura/token', TTL_MEDIUM, d => {
      if (d?.connected && d.batteryLevel != null) {
        setBattery({ level: d.batteryLevel, charging: d.batteryCharging ?? null })
      } else {
        setBattery(null)
      }
    }).catch(() => {})
  }, [])
```
  Then grep for the `/api/oura/token` POST/DELETE call sites (the Oura connect/disconnect UI under Health settings) and add `invalidateCache('oura-token').catch(() => {})` after each successful write so a disconnect doesn't show a phantom battery for 30 min. **Coordination note:** when the quick-wins `invalidateOuraSync()` helper lands, add `'oura-token'` to it (battery level updates on sync).
- [ ] **3.8 Home timeline seed** — `components/home-day-timeline.tsx:199-209`: the `cachedFetch` is there but first paint is blank. Seed the state:

```ts
  const [events, setEvents] = useState<TimelineEvent[] | null>(() =>
    readCacheSync<{ events: TimelineEvent[] }>("home-day-timeline")?.events ?? null,
  );
```
(add `readCacheSync` to the `@/lib/sqlite/cache` import at line 9).
- [ ] **3.9 Session-select: mood seed** — `app/session-select/session-select-content.tsx:336`: `loadTodayMood` writes `mood:{date}` (see :629,:640) but the state starts `undefined`, so the check-in card flashes. Seed it:

```ts
  const [moodLog, setMoodLog] = useState<import("@/lib/types/mood").MoodLog | null | undefined>(
    () => readCacheSync<import("@/lib/types/mood").MoodLog>(`mood:${todayInTz()}`) ?? undefined,
  );
```
(`readCacheSync` and `todayInTz` are already imported in this file.)
- [ ] **3.10 Session-select: profile** — `app/session-select/session-select-content.tsx:698-711`: replace the `fetch('/api/user/profile', { cache: 'no-store' })` effect with the key SyncProvider already warms:

```ts
  useEffect(() => {
    cachedFetch<{ user: { displayName?: string | null; name?: string | null; avatar?: string | null; activityLevel?: string | null; fitnessGoal?: string | null; lastGoalReviewAt?: string | null } }>(
      'more-user-profile', '/api/user/profile', TTL_MEDIUM,
      d => {
        setDisplayName(d.user?.displayName ?? d.user?.name ?? null);
        if (d.user?.avatar) setUserAvatar(d.user.avatar);
        setGoalsProfile({
          activityLevel: d.user?.activityLevel ?? null,
          fitnessGoal: d.user?.fitnessGoal ?? null,
          lastGoalReviewAt: d.user?.lastGoalReviewAt ?? null,
        });
      },
    ).catch(() => {});
  }, []);
```
  Because home now *reads* this key, profile edits must invalidate it: in `components/more/profile-tab.tsx`, after a successful `patchProfile` PATCH and after the avatar save (`/api/user/avatar`, ~:211-216), add `invalidateCache('more-user-profile').catch(() => {})` (grep the file first — add only where missing).
- [ ] **3.11 Session-select: day-recap briefing** — `app/session-select/session-select-content.tsx:775-807`: move the hand-rolled per-date localStorage cache onto the shared cache (server-side caching of this route is quick win 7; the key is date-scoped so no invalidation needed):

```ts
  const briefingCacheKey = `morning-briefing:${today}`;
  const BRIEFING_SEEN_KEY = `ta_day_recap_seen_${today}`;   // unchanged

  const fetchBriefing = useCallback(async () => {
    const hour = new Date().getHours();
    if (hour < 18) return;
    const alreadySeen = (() => { try { return localStorage.getItem(BRIEFING_SEEN_KEY) === "1"; } catch { return false; } })();
    const cached = readCacheSync<string>(briefingCacheKey);
    if (cached) {
      setBriefing(cached);
      if (!alreadySeen) setBriefingSheetOpen(true);
      return;
    }
    if (alreadySeen) return;
    setBriefingLoading(true);
    try {
      const res = await fetch('/api/morning-briefing');
      if (res.ok) {
        const d = await res.json();
        if (d.briefing) {
          setBriefing(d.briefing);
          setCached(briefingCacheKey, d.briefing, TTL_LONG).catch(() => {});
          setBriefingSheetOpen(true);
        }
      }
    } catch { /* ignore */ }
    finally { setBriefingLoading(false); }
  }, [briefingCacheKey, BRIEFING_SEEN_KEY]);
```
(delete the old `BRIEFING_KEY` const and its `localStorage` get/set; `setCached` is already imported in this file.)
- [ ] **3.12 Profile tab: program-week** — `components/more/profile-tab.tsx:167-170`:

```ts
    cachedFetch<ProgramWeeks>('program-week', '/api/program-week', TTL_MEDIUM,
      d => { if (d) setProgramWeeks(d) },
    ).catch(() => {})
```
(reuse the existing type of the `programWeeks` state for the generic — check its declaration; import `TTL_MEDIUM`). Add `invalidateCache('program-week'),` to **both** `invalidateWorkoutSummaries` (week progress ticks per logged session) and `invalidateProgramStructure` (program edits change the week layout) in `lib/cache-groups.ts`, and extend both unit-test expectations.
- [ ] **3.13 End-of-day review seeds** — `components/nutrition/end-of-day/end-of-day-review.tsx:65-75`: both keys are cached elsewhere; keep the awaited flow by capturing via the callback (cachedFetch resolves only after the network refresh):

```ts
    async function init() {
      const seedBattery = readCacheSync<BodyBattery>('body-battery')
      if (seedBattery && !cancelled) setBattery(seedBattery)
      let bb: BodyBattery | null = seedBattery
      await cachedFetch<BodyBattery>('body-battery', '/api/body-battery', TTL_SHORT, d => { bb = d })
        .catch(() => {})
      if (!cancelled) setBattery(bb)

      let meta: { today?: { steps?: number | null; waterMl?: number | null } | null } | null =
        readCacheSync('body-metadata')
      await cachedFetch<typeof meta>('body-metadata', '/api/body-metadata', TTL_MEDIUM, d => { meta = d })
        .catch(() => {})
      const steps: number | null = meta?.today?.steps ?? null
      const waterMl: number | null = meta?.today?.waterMl ?? null
      // …rest of init() unchanged
```
(imports: `cachedFetch`, `readCacheSync`, `TTL_SHORT`, `TTL_MEDIUM`.)
- [ ] `pnpm test`, `pnpm lint`, `npx tsc --noEmit`.
- [ ] **Manual verification** (`pnpm dev`): (1) open Home twice — on the second visit the timeline, mood card, greeting name, and Oura battery chip all paint instantly with no blank frame; (2) open the workout pre-screen twice — injuries banner needs no refetch flash; (3) Nutrition → photo capture → assign step — meal-type pills render without the spinner on any visit after the first; (4) open an exercise's stats sheet, then log that exercise and reach the summary screen — the sparkline seeds instantly from the shared `exercise-history:` key, then updates with the new point; (5) edit display name in More → Profile, go Home — the greeting updates immediately.
- [ ] Commit (feel free to split into 2-3 commits, e.g. "seed home-screen reads from the shared cache", "unify exercise-history cache key", "cache program-week and oura token status").

---

### Task 4: SessionClock extraction + warmCache stagger (B3 render/startup)

**Files:**
- `components/workout/session-clock.tsx` (new)
- `components/workout-screen.tsx:153-185` (tick states), `:187` (`beepFiredRef`), `:322-333` (beep effect), `:925,948,1017-1018` (props)
- `components/workout/warmup-screen.tsx:13-20,54,70,84`
- `components/workout/exercise-summary-screen.tsx:17-23,96-103`
- `components/workout/active-workout-screen.tsx:33-34,66-67,84-93`
- `components/sync-provider.tsx:115-118` (Phase 3)

- [ ] Create `components/workout/session-clock.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { formatTime } from "./utils";

/** 1 Hz elapsed-seconds ticker. Lives in leaf components so the 1,034-line
 *  workout orchestrator no longer re-renders every second. */
export function useElapsedSec(startMs: number | null): number {
  const [elapsed, setElapsed] = useState(() =>
    startMs ? Math.floor((Date.now() - startMs) / 1000) : 0,
  );
  useEffect(() => {
    if (!startMs) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startMs]);
  return elapsed;
}

export function SessionClock({ startMs, className, style }: {
  startMs: number | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const elapsed = useElapsedSec(startMs);
  if (startMs == null) return null;
  return <span className={className} style={style}>{formatTime(elapsed)}</span>;
}
```
- [ ] `components/workout-screen.tsx`: delete the `sessionElapsedSec` state + effect (lines 153-164) and the `exerciseElapsedSec` state + effect (lines 173-185), and delete `beepFiredRef` (:187). Replace the rest-beep effect (lines 322-333) with a scheduled timeout — no per-second dependency:

```ts
  useEffect(() => {
    if (store.workoutPhase !== "rest" || currentRestSec <= 0 || store.restStartMs === null) return;
    const delayMs = store.restStartMs + currentRestSec * 1000 - Date.now();
    if (delayMs <= 0) return; // rest already over when (re)mounted — notification path covers it
    const id = setTimeout(() => { playBeep(); hapticSuccess(); }, delayMs);
    return () => clearTimeout(id);
  }, [store.workoutPhase, currentRestSec, store.restStartMs]);
```
- [ ] Update the child props in `workout-screen.tsx`: `WarmupScreen` (:925) `sessionElapsedSec={sessionElapsedSec}` → `workoutStartMs={store.workoutStartMs}`; `ExerciseSummaryScreen` (:948) likewise; `ActiveWorkoutScreen` (:1017-1018) `exerciseElapsedSec`/`sessionElapsedSec` → `exerciseStartMs={store.exerciseStartMs}` and `workoutStartMs={store.workoutStartMs}`. (`PipView` already self-ticks — `pip-view.tsx:38-39` — no change.)
- [ ] `components/workout/warmup-screen.tsx`: change the prop from `sessionElapsedSec: number` to `workoutStartMs: number | null`, and derive locally: `const sessionElapsedSec = useElapsedSec(workoutStartMs);` (import from `./session-clock`). Lines 54/70/84 then compile unchanged. The warmup screen keeps ticking (its progress bar needs it) but the orchestrator no longer does.
- [ ] `components/workout/exercise-summary-screen.tsx`: change the prop to `workoutStartMs: number | null` and replace the elapsed chip (lines 96-103) with the pure leaf — this screen stops re-rendering entirely:

```tsx
        {workoutStartMs != null && (
          <div
            className="flex-none rounded-xl px-2.5 py-1 text-xs font-mono font-bold tabular-nums"
            style={{ background: "color-mix(in oklch, var(--color-brand) 15%, transparent)", color: "var(--color-brand)" }}
          >
            ⏱ <SessionClock startMs={workoutStartMs} />
          </div>
        )}
```
- [ ] `components/workout/active-workout-screen.tsx`: replace props `exerciseElapsedSec: number; sessionElapsedSec: number` (:33-34, :66-67) with `exerciseStartMs: number | null; workoutStartMs: number | null`, then at the top of the component body derive `const sessionElapsedSec = useElapsedSec(workoutStartMs);` and `const exerciseElapsedSec = useElapsedSec(exerciseStartMs);`. Everything downstream (`sessionElapsedSecRef` at :86-87, `readyElapsedSec` :143-145, the rest-elapsed recompute :128-131, the ring :179-198) compiles unchanged. This screen still ticks at 1 Hz while mounted — the win is the orchestrator (and its whole subtree: MuscleHeatmap, sparkline, warmup grid) no longer does.
- [ ] `components/sync-provider.tsx` Phase 3 (:115-118): bound the cold-start fan-out to 5 concurrent requests instead of ~20 (order already puts home-screen keys first in `CACHE_TASKS`, and `warmCache` skips fresh entries, so the first chunk covers the visible tab):

```ts
      // Phase 3: Refresh stale cache entries and fetch any that were missing.
      // Chunked (5 at a time, in CACHE_TASKS order — home-screen keys first) so a
      // cold start doesn't fire ~20 parallel requests and starve the visible tab.
      const WARM_CHUNK = 5;
      for (let i = 0; i < CACHE_TASKS.length; i += WARM_CHUNK) {
        if (cancelled) break;
        await Promise.all(CACHE_TASKS.slice(i, i + WARM_CHUNK).map(warmCache));
      }
```
- [ ] `pnpm lint`, `npx tsc --noEmit`, `pnpm test`.
- [ ] **Manual verification** (`pnpm dev`, run a workout end-to-end): start a session → warmup timer counts up; begin exercises → header exercise timer and session ring tick every second; start a set with a rest period after it → the beep fires exactly when the rest expires (test one full rest interval); log all sets → the summary screen shows the ticking session chip; complete the workout. With React DevTools "Highlight updates" on, confirm the orchestrator's static children (pre-screen content, summary sparkline card) no longer flash every second — only the clock leaves do. Reload mid-workout: timers resume from the persisted `workoutStartMs`. Cold-load the app with DevTools Network open: initial burst is ≤5 concurrent `/api/*` warm requests, in waves.
- [ ] Commit ("move the 1Hz workout tick into leaf components", "chunk cold-start cache warming").

---

### Task 5: next/image adoption (B3 images)

**Files:**
- `next.config.ts:46-49`
- The raw `<img>` sites: `app/session-select/session-select-content.tsx:1132`, `app/profile/[userId]/page.tsx:76`, `app/admin/admin-content.tsx:281,352`, `components/config/exercise-preview-sheet.tsx:64`, `components/admin/exercise-manager.tsx:480,535`, `components/workout/warmup-screen.tsx:154`, `components/more/manage-friends-sheet.tsx:134`, `components/more/friend-feed.tsx:28`, `components/more/friend-leaderboard.tsx:106`, `components/more/profile-tab.tsx:258`, `components/workout-builder/builder-review.tsx:512`

- [ ] `next.config.ts` — the AVIF/WebP config is dead until sources allow remote hosts. Extend `images`:

```ts
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    remotePatterns: [
      { protocol: 'https', hostname: '*.googleusercontent.com' },   // Google OAuth avatars
      { protocol: 'https', hostname: 'raw.githubusercontent.com' }, // exercise dataset media (lib/exercise-gif-matcher.ts DATASET_BASE)
    ],
  },
```
- [ ] Convert the avatar `<img>`s (fixed-size circles; avatars may be `data:` URLs from the in-app upload — `next/image` requires `unoptimized` for those). Pattern, using `friend-feed.tsx:28` as the template:

```tsx
import Image from "next/image";
// …
        <Image
          src={event.avatar} alt="" width={32} height={32}
          unoptimized={event.avatar.startsWith('data:')}
          className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-0.5"
        />
```
  Apply the same shape (adjusting `width`/`height` to the Tailwind size: `w-8 h-8` → 32, `h-8 w-8` → 32) at: `manage-friends-sheet.tsx:134`, `friend-leaderboard.tsx:106`, `admin-content.tsx:352`, `profile-tab.tsx:258` (avatar container is a sized circle — use its pixel size, keep `object-cover`).
- [ ] Convert the fill-style avatars (parent is a sized, `overflow-hidden` rounded container): `session-select-content.tsx:1132` and `app/profile/[userId]/page.tsx:76` →

```tsx
<Image src={userAvatar} alt="avatar" fill sizes="40px"
  unoptimized={userAvatar.startsWith('data:')} className="object-cover" />
```
  (check the actual container size for `sizes`; add `relative` to the container class if not already positioned).
- [ ] Convert the exercise-media thumbnails (mixed local `/exercise-media/...` and remote dataset URLs; PNG frames — optimizable): `warmup-screen.tsx:154` (`fill` in its thumb container, keep the lazy behaviour — `next/image` lazy-loads by default), `exercise-manager.tsx:535` (thumb), `exercise-manager.tsx:480` (reference figure, `width={80} height={80}`), `exercise-preview-sheet.tsx:64`, `builder-review.tsx:512`, `admin-content.tsx:281` (inspect each `src` while converting: if a site can receive an animated `.gif` URL, pass `unoptimized={src.endsWith('.gif')}`; if it renders a `data:`/`blob:` preview, leave it as `<img>` per the scope decision above).
- [ ] Leave as `<img>` (transient/base64/animated — document with a one-line comment only where non-obvious): `capture-step.tsx:227` (blob preview), `feedback-sheet.tsx:146` (data-URL screenshot), `exercise-manager.tsx:175` (GIF generation preview), `exercise-stats-sheet.tsx:27,36` (animated exercise GIF + hidden preloader).
- [ ] `pnpm lint` (the `@next/next/no-img-element` warnings should now be only the deliberate keeps), `npx tsc --noEmit`, and `pnpm build` once — `next/image` misconfiguration (unlisted remote host) fails at runtime, so also do the manual pass below.
- [ ] **Manual verification** (`pnpm dev`, 412×915 viewport ≈ Galaxy S25 Ultra): Home header avatar, More → profile avatar, Friends feed/leaderboard avatars, warmup thumbnails, config exercise preview, builder review, admin users list — every image renders (no broken-image icon, no `next/image` hostname error in the console), circles stay circular (no stretching). Check the Network tab: dataset PNGs are served as `/_next/image?...` AVIF/WebP.
- [ ] Commit.

---

### Task 6: Server-side — bounded day-timeline query + SWR headers (B4)

**Files:**
- `lib/data/repository.ts:429`
- `lib/data/postgres/slices/oura.ts:316-331`
- `app/api/day-timeline/route.ts:92,271`
- `app/api/readiness-score/route.ts:234`, `app/api/muscle-recovery/route.ts:31`, `app/api/training-load/route.ts:45,62,80`, `app/api/sleep-sessions/route.ts:127` (GET only), `app/api/weights-summary/route.ts:88`, `app/api/nutrition/weekly-summary/route.ts` (final success return)

- [ ] `lib/data/repository.ts:429`: widen the signature — `getOuraWorkouts(userId: string, opts: { unreviewed?: boolean; from?: string; to?: string }): Promise<...>` (return type unchanged). The adapter passthrough at `lib/data/postgres/adapter.ts:2885` needs no change.
- [ ] `lib/data/postgres/slices/oura.ts:316`: apply the bounds (add `lte` to the file's `drizzle-orm` import if missing):

```ts
export async function getOuraWorkouts(db: Db, userId: string, opts: { unreviewed?: boolean; from?: string; to?: string }) {
  const conditions = [eq(s.ouraWorkouts.userId, userId)]
  if (opts.unreviewed) {
    conditions.push(eq(s.ouraWorkouts.reviewed, false))
    conditions.push(gte(s.ouraWorkouts.day, shiftDateStr(todayInTz(DEFAULT_TZ), -30)))
  }
  if (opts.from) conditions.push(gte(s.ouraWorkouts.day, opts.from))
  if (opts.to) conditions.push(lte(s.ouraWorkouts.day, opts.to))
  // …rest unchanged
```
- [ ] `app/api/day-timeline/route.ts:92`: `repo.getOuraWorkouts(userId, {})` → `repo.getOuraWorkouts(userId, { from: yesterday, to: date })`. The in-route filter at :244 (`w.day === date || w.day === yesterday`) stays as a belt-and-braces guard. The only other caller, `app/api/oura/workouts/route.ts:20`, passes `{ unreviewed }` and is unaffected.
- [ ] `app/api/day-timeline/route.ts:271`: add the header (short max-age — activity/meal writes invalidate the client key and expect a fresh refetch; matches `calendar-data/route.ts:22`):

```ts
  return NextResponse.json({ date, events }, {
    headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
  })
```
- [ ] Add the aggregate-route header — exact string copied from `app/api/weekly-stats/route.ts:111` / `app/api/progress-summary/route.ts:59`:

```ts
  { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" } }
```
  as the second argument to the **success** `NextResponse.json(...)` returns at: `readiness-score/route.ts:234`, `muscle-recovery/route.ts:31`, `training-load/route.ts:45,62,80` (all three payload returns), `sleep-sessions/route.ts:127` (GET handler only — do not touch any POST/mutation handler in that file), `weights-summary/route.ts:88`, and the final success return in `nutrition/weekly-summary/route.ts`. Leave the 401/429 error returns headerless.
- [ ] `pnpm lint`, `npx tsc --noEmit`, `pnpm test`.
- [ ] **Manual verification** (`pnpm dev`): `curl -si` each route with a valid session cookie (or check the Network tab response headers in the browser) — every listed route returns `Cache-Control: private, max-age=60, stale-while-revalidate=120` (day-timeline: `max-age=30…`). Home timeline still renders workouts, meals, walks, and sleep events for today + yesterday identically to before the query bound (compare against a pre-change screenshot). Log a food entry, revisit Home — the meal appears (client invalidation + 30 s max-age don't block it beyond one refresh).
- [ ] Commit.

---

### Task 7: Full regression pass + wrap-up

**Files:** none new.

- [ ] `pnpm test && pnpm lint && npx tsc --noEmit && pnpm build` — all green.
- [ ] `pnpm dev` full sweep against the local DB: Home (timeline/mood/briefing/battery chip), Nutrition (supplements, capture→assign, end-of-day review), Health (activity delete, water log → progress summary), More (friends, profile, program week), full workout flow (injuries banner, timers, beep, summary, done). Fix anything broken before presenting.
- [ ] Push the branch, open the PR (describe the caching model changes and the key/TTL table), let CI run. **Do not merge without explicit user confirmation** — this is functional code that deploys to production. Note in the PR that offline/`getLocalStore` paths are unchanged and that seed behaviour on the APK (native SQLite) still needs on-device verification per the offline-first checklist.

---

## Coverage check (every Batch-B item → task)

| planned_upgrades.md item | Task |
|---|---|
| B1 manual activity add + Oura walk confirm missing `home-day-timeline`/`calendar-data:` | 1 |
| B1 water log missing `progress-summary`; writes via group helpers | 1 |
| B1 Oura-sync + injury invalidation | *excluded (quick win 8)* |
| B2 friends feed/leaderboard/list | 2 |
| B2 supplements key creation + invalidation (incl. `sync-provider.tsx:207`) | 2 |
| B2 pre-workout injuries seeding | 3.1 |
| B2 assign-step / macro-targets / goals-section already-cached keys | 3.2-3.4 |
| B2 exercise-history unification (`exercise-history:{name}`) | 3.5 |
| B2 add-exercise re-caching | 3.6 |
| B2 oura-battery-chip | 3.7 |
| B2 home-day-timeline `readCacheSync` seed | 3.8 |
| B2 session-select mood / profile / morning-briefing | 3.9-3.11 |
| B2 profile-tab program-week | 3.12 |
| B2 end-of-day-review seeds | 3.13 |
| B3 `<SessionClock>` leaf extraction | 4 |
| B3 warmCache stagger | 4 |
| B3 AiChatOverlay/HrDayChart lazy-load | *excluded (quick win 5)* |
| B3 next/image + remotePatterns | 5 |
| B4 bounded `getOuraWorkouts` + day-timeline `Cache-Control` | 6 |
| B4 SWR headers on readiness-score/muscle-recovery/training-load/sleep-sessions/weights-summary/nutrition | 6 |
| B4 migration 103 indexes | *excluded (quick win 4)* |
