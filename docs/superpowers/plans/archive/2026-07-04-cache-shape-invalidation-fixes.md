# Cache correctness — shape collisions, missed invalidation, dead seeds

> Source: post-update review 2026-07-04 (cache pass). All anchors verified against
> `main` @ the review commit; **re-grep before editing** — the cache layer moved a
> lot in PRs #146/#148/#150/#162/#192. Ships as **one PR** (correctness fixes to
> shipped features → patch bump, merge-gate-exempt). This is the highest-urgency
> item in the review: it contains a live render-crash path (C1) and a
> hours-long hard-staleness path (C2).

## Context / root causes

The `freshWithinTtl` short-circuit (#162) and the F6 self-fetching cards (#170–#178)
each added cache keys without wiring every writer into their invalidation groups,
and the `cachedFetchToday` envelope migration (#146) left one reader family and the
sync-provider warmer on the old plain-`cachedFetch` shape. Net effect: one key is
stored in two incompatible shapes, one `freshWithinTtl` key never gets corrected
after a program edit, and several "today" keys serve yesterday's data on the
cache-hit path.

## Task 1 — `weekly-stats`: one fetch variant per key (fixes the Stats crash)

**Root cause:** Health writes the key via `cachedFetchToday` → stores the
`{date, data}` envelope (`app/health/health-content.tsx:341`). Stats seeds + fetches
the *same key* via plain `readCacheSync`/`cachedFetch`
(`app/stats/stats-content.tsx:50,68`) and `components/stats/weekly-stats-hub.tsx:33`
calls `data.days.map(...)` on whatever it gets. Open Health then Stats → the truthy
envelope is handed to render code → `data.days` is `undefined` → TypeError. The two
sites also permanently overwrite each other's stored shape.

**Fix:** make `weekly-stats` an envelope key **everywhere**.
- `app/stats/stats-content.tsx`: switch the seed to `readTodayCacheSync` and the
  fetch to `cachedFetchToday` (match `health-content.tsx`). Confirm the raw payload
  has no top-level `date` (`app/api/weekly-stats/route.ts:16-23`) so the envelope
  guard can't false-pass.
- **`components/sync-provider.tsx:22-60`** — the warm list `setCached`s the *raw*
  response for four envelope keys (`weekly-stats`, `progress-summary`,
  `readiness-score`, `training-load`). Every reader is `cachedFetchToday`/
  `readTodayCacheSync`, whose `unwrapToday` rejects a rawpayload (no `.date`) as a
  miss — so the cold-start warm is wasted for all four *and* it's a third
  shape-writer for `weekly-stats`. Wrap those four in the `{date, data}` envelope in
  `warmCache` (or route them through the same `cachedFetchToday` write path).

**Verify:** open Health, then Stats, on a cold cache and a warm cache — Stats
renders the weekly hub with no console TypeError in both orders. Confirm the four
warmed keys now produce an instant paint (not a re-fetch) on their screens.

## Task 2 — `workout-card:*` invalidation (fixes 6h hard-stale program edits)

**Root cause:** `workout-card:<id>` is prefetched with `freshWithinTtl: true` at
TTL_LONG (6h) (`session-select-content.tsx:435`, `workout-select-content.tsx:167`)
and now also *read* by the #192 fallback seed (`components/workout-screen.tsx:194`).
Its only invalidation anywhere is the just-logged session
(`components/workout-screen.tsx:700`). Because `freshWithinTtl` skips the network
entirely on a fresh hit, an edited program shows the **old/deleted exercise list
for up to 6h with no SWR correction** — the exact unsafe case the flag's own comment
warns about (`lib/sqlite/cache.ts:271-274`).

**Fix:**
- Add `workout-card:` to `invalidateProgramStructure()` (`lib/cache-groups.ts:66-75`)
  and to `invalidateWorkoutSummaries()` (`cache-groups.ts:4-36`) — the two groups
  covering program edits and workout completion (a completion increments
  program-wide phase counters that appear in every session's card).
- Route the ad-hoc `invalidateWorkoutCardCache()` in `lib/utils.ts:32` (which today
  clears sessionStorage + localStorage but **not** the SQLite layer, contradicting
  its own comment) to just call `invalidateCache('workout-card:')`, so the APK
  `freshWithinTtl` check (which reads SQLite `cached_at`) actually re-mirrors after
  a config save. Then confirm every current caller (`config-screen.tsx` ×4) still
  covers its case via the group, and that `builder-review.tsx:370` and
  `sync-provider.tsx:104` (cross-device program pull) now clear it via
  `invalidateProgramStructure()`.

**Verify:** `pnpm dev` → edit a program (swap/remove an exercise) in Config → open
Home/workout-select → the prefetch does **not** short-circuit to the stale card;
navigating into the session shows the edited exercise list on first paint. Repeat
after a builder save.

## Task 3 — Navigate workouts by session id, not name (revives the #192 seed)

**Root cause:** the #192 fallback seed reads `workout-card:${sessionType}` where
`sessionType` is the raw `?session=` param (`app/workout/page.tsx:22`). Home's
recommendation card (`app/session-select/components/recommendation-card.tsx:272,288`)
and Overview (`components/overview-screen.tsx:168,175`) navigate with the session
**name**, while every `workout-card` writer keys by session **id**. So the
instant-paint seed silently never fires from the primary flow, and `?session=` is a
name in some flows and an id in others.

**Fix:** standardise `?session=<id>` across all entry points. Update the home
recommendation card and overview-screen navigation to pass `sess.id` (they already
have it — they build the card from the id-keyed prefetch). Confirm the workout page
resolves the session by id (it already does for workout-select's id-based nav).
This also closes the pre-existing name/id inconsistency flagged in session 208.
Per the no-hardcoded-names rule, session identity in URLs and cache keys is the DB
id — never the name.

**Verify:** navigate into a workout from Home's recommendation card → the fallback
seed hits (no loading-skeleton rows at first paint, same as the workout-select
path). Confirm deload sessions still bypass the seed (`!aiDeload`, line 193).

## Task 4 — Register the bare `health-trends` key

**Root cause:** the five F6 consumers cache `/api/health/trends` under the bare key
`"health-trends"` (`workout-density-card.tsx:15`, `nutrition-activity-trends-card.tsx:15`,
`oura-section.tsx:90`, `health-score-detail.tsx:147`, `heart-rate/page.tsx:27`).
Every invalidation group clears the prefix `'health-trends:'`
(`cache-groups.ts:35,114,158`) — which belongs to a **different route**
(`/api/health-trends?view=`, `trends-section.tsx:25`). `startsWith('health-trends:')`
does not match `"health-trends"`, so workout completion / food logs / Oura syncs
never invalidate the new density/protein/wear sparklines.

**Fix:** add the bare `health-trends` key to the invalidation groups whose writes
change its payload — `invalidateWorkoutSummaries` (workout volume/duration/density),
`invalidateNutritionWrite` (protein/steps/water — see Task 5), and
`invalidateOuraSync` (wear-time/HRV). To avoid the prefix-sibling foot-gun, either
rename the new key to share the older prefix (`health-trends:body` etc.) or add an
explicit entry; document the choice inline. It is already `cachedFetchToday`-guarded
and TTL_LONG-consistent across all five sites, so this is invalidation-only.

**Verify:** log a workout → open Health → the density/duration sparklines repaint
with the new session included without waiting on TTL.

## Task 5 — Extend `invalidateNutritionWrite()` + date-guard the timeline

**Root cause (M2):** `invalidateNutritionWrite()` covers `nutrition-food-logs-`,
`nutrition-weekly-summary`, `body-metadata` (`cache-groups.ts:164-171`) but **not**
`home-day-timeline`, which renders meals (`app/api/day-timeline/route.ts:87,174`;
`components/home-day-timeline.tsx:198`). Log lunch → Home timeline first-paints
without it. (The food *write paths* all call the group correctly — the gap is the
key list.)

**Root cause (M3):** `home-day-timeline` uses plain `cachedFetch`
(`home-day-timeline.tsx:210-215`) with no date in the key and no date guard, but
`setCached` floors localStorage persistence to 24h — at 6am it paints yesterday's
meals/workout/sleep.

**Fix:**
- Add `home-day-timeline` to `invalidateNutritionWrite()`, and to
  `invalidateWorkoutSummaries` (the timeline also shows the day's workout).
- Convert `home-day-timeline` to `cachedFetchToday`/`readTodayCacheSync`.

**Verify:** log a meal → Home timeline shows it immediately; open the app "the next
morning" (temporarily shrink the guard or set the device clock) → the timeline is
empty/loading, not yesterday's data.

## Task 6 — Date-guard `body-metadata` on the fetch-hit path

**Root cause:** the Home seed guards `data.today?.date === todayInTz()`
(`session-select-content.tsx:233-241`), but the `cachedFetch` onData callbacks apply
the cached entry **unguarded** at three sites
(`session-select-content.tsx:363-371`, `health-content.tsx:306-314`,
`nutrition-content.tsx:202`). Open Health at 6am with a late-night cache entry →
today's steps/water/calories-burned paint with yesterday's values.

**Fix:** guard the onData hit path — either move `body-metadata` onto
`cachedFetchToday` (preferred; matches the six keys #146 already converted), or add
`if (data.today?.date === todayInTz())` in each onData callback. Do it once via a
shared helper, not three hand-rolled copies.

**Verify:** as Task 5's morning check — Health's steps/water tiles don't flash
yesterday's numbers before the network lands.

## Task 7 — Cross-device pull invalidation for the missing domains

**Root cause:** `pullDelta` applies `foodLogs`, `supplementLogs`, `activityLogs`,
`injuries`, `ouraDaily`, `dayCheckins` (`lib/local-store/sync-engine.ts:347-351`)
but `domains` reports only `biometrics/programs/workouts`
(`sync-engine.ts:356-362`), and the consumer maps only those three to groups
(`components/sync-provider.tsx:103-105`). Log food or a walk on device A → device B
pulls the rows locally but never invalidates `nutrition-weekly-summary`,
`body-metadata`, `activity-logs`, `home-day-timeline`, `calendar-data:` — the
aggregates show pre-sync data until TTL.

**Fix:** extend the `domains` set emitted by `pullDelta` to include every domain the
delta actually applied, and map each to its invalidation group in `sync-provider`.
Keep it delta-scoped (only invalidate domains present in this pull), not a
full-cache storm.

**Verify:** two-tab/two-session simulation — write food in one, trigger a pull in
the other → the weekly macro chart / activity card / timeline update after the pull,
not on TTL.

## Task 8 — Fold the drifted hand-rolled invalidation lists into groups

Per the strict "writes go through cache groups" rule, replace the ad-hoc
`invalidateCache([...])` lists that have already drifted:
- Progression-style save/delete (`config-screen.tsx:193-194,215-216`) →
  `invalidateProgramStructure()` (currently misses `next-session`, `workout-card:`,
  `phase-sets`).
- Body-metric write sites (`session-select-content.tsx:521-524,824-826,954,1308`;
  `health-content.tsx:716-717,726`) vs `invalidateBodyMetricWrite()`
  (`cache-groups.ts:138-143`) have diverged on `day-log:` vs `progress-summary` —
  reconcile into the group and switch all call sites to it.
- Builder phase-set clone (`builder-review.tsx:324`) → ensure `phase-sets` is in
  `invalidateProgramStructure()`.

**Also (M6 — TTL canonicalisation):** add `next-session` and `exercise-history:` to
`lib/cache-ttl.ts` and fix the divergent sites (`next-session` 60 vs 300 —
`workout-select-content.tsx:148` vs `session-select-content.tsx:415`/
`sync-provider.tsx:23`; `exercise-history:` SHORT vs MEDIUM —
`exercise-stats-sheet.tsx:61` vs `exercise-history-sheet.tsx:66`).

**Verify:** log a body metric via each entry path → the same set of keys clears
regardless of path (inspect `localStorage`); `next-session`/`exercise-history` fetch
with one TTL everywhere.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; add a unit test for the
  `weekly-stats` envelope round-trip and for the `health-trends` group membership
  (extend the existing cache-groups test).
- `pnpm dev` manual passes above; drive the real Log-Food and program-edit flows
  and confirm via `localStorage` inspection.
- **Not exercisable in sandbox (declare in PR):** native SQLite cache layer
  (`freshWithinTtl` SQLite re-mirror is web-fallback-only here), real cross-device
  pull, Samsung WebView.
- Patch bump + `lib/changelog.ts`; merge-gate-exempt (bug fixes to shipped
  features). Remove this backlog entry in the same PR.
