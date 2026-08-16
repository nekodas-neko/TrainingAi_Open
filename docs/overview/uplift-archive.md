# Uplift Ledger — Archive (full detail, shipped + historical)

> **Archived 2026-07-05 (session 210 documentation cleanup).** This is the complete session-176
> eight-dimension review ledger and all follow-up audit batches (A–O), preserved verbatim for
> later review. The **active, open-items-only** version lives in
> [`../planned_upgrades.md`](../planned_upgrades.md); ready-to-build work is queued in
> [`../implementation-backlog.md`](../implementation-backlog.md).
>
> Most items below shipped (marked ✅ inline). Kept here so the shipped rationale, file:line
> evidence, and design decisions remain searchable without cluttering the active ledger.

---

# TrainingAI — Planned Upgrades (v2)

> **Created:** 2026-07-01 (session 176 — full eight-dimension app review). **Supersedes** the session-170 list (v1). This is the single source of truth for new uplift work: tick items off as they ship and move detailed per-batch plans into `docs/superpowers/plans/`.
>
> **Review dimensions:** offline-first data integrity · performance & caching · training-engine logic · security · AI usage · UI/UX · data & analytics · animations/navigation. Eight parallel deep-audits, each with file:line evidence, reconciled against the v1 list.

**Reconciliation of the v1 (session-170) list:** of ~55 items, **3 shipped** (volume-targets writer + auto-seed, Oura steps → `body_metrics.steps`, RPE autoregulation), **3 partial** (muscle-name case normalization but no shared synonym normalizer; reps-aware `expectedRpe` shipped but the coarse `expectedRpeForPct` still drives the program-wide `rpeTrend`; `temperatureTrendDeviation` surfaced but not `sleep_time_recommendation`). Everything else carried forward below, re-verified with fresh line refs. **Stale numbering fixed:** v1 said "migration 101" for the index batch — 101 (treadmill) and 102 (day_checkins) are taken; **next Postgres migration is 103**, local SQLite schema is at **v12**.

**Detailed implementation plans (session 176):** every batch below has a task-by-task executable plan in `docs/superpowers/plans/`:
[quick wins](../superpowers/plans/archive/2026-07-01-quick-wins.md) ·
[A offline-first](../superpowers/plans/archive/2026-07-01-batch-a-offline-first-integrity.md) ·
[B caching/perf](../superpowers/plans/archive/2026-07-01-batch-b-caching-performance.md) ·
[C engine logic](../superpowers/plans/archive/2026-07-01-batch-c-training-engine-logic.md) ·
[D security](../superpowers/plans/archive/2026-07-01-batch-d-security-hardening.md) ·
[E AI usage](../superpowers/plans/2026-07-01-batch-e-ai-usage.md) ·
[F data/analytics](../superpowers/plans/archive/2026-07-01-batch-f-data-analytics.md) ·
[G UI system](../superpowers/plans/archive/2026-07-01-batch-g-ui-system.md) ·
[H animations/nav](../superpowers/plans/archive/2026-07-01-batch-h-animations-navigation.md) ·
[I workout/nutrition features](../superpowers/plans/archive/2026-07-01-batch-i-workout-nutrition-features.md)

**B5 follow-up audit plans (2026-07-02):**
[B5 save-latency](../superpowers/plans/2026-07-02-b5-save-latency.md) ·
[B5 render fixes](../superpowers/plans/archive/2026-07-02-b5-render-fixes.md) ·
[B5 bundle splits](../superpowers/plans/archive/2026-07-02-b5-bundle-splits.md) ·
[J process & enforcement](../superpowers/plans/2026-07-02-batch-j-process-enforcement.md)

**Session-178 audit plans (2026-07-02):**
[B6 data-store fixes](../superpowers/plans/2026-07-02-b6-data-store-fixes.md) ·
[F6 metrics expansion](../superpowers/plans/2026-07-02-f6-metrics-expansion.md) ·
[H5 perceived-performance & haptics](../superpowers/plans/archive/2026-07-02-h5-perceived-performance-haptics.md) ·
[L wallpapers](../superpowers/plans/2026-07-02-batch-l-wallpapers.md)

**User-requested UI/bug-fix batch (2026-07-02):**
[UI bug fixes — timeline, activity ring, End of Day review](../superpowers/plans/2026-07-02-ui-bugfixes-activity-eod-review.md)

> **🔄 Reviewed 2026-07-03 (session 184 backlog review).** Every open item re-verified against `main` v1.85.0; ticks corrected (A6/A7 had shipped unticked; Batch M never landed and is re-queued). New findings + two new not-yet-planned batches (N ops, O features) in the **"2026-07-03 backlog review"** section near the bottom. **The ready-to-implement queue now lives in [`docs/implementation-backlog.md`](../implementation-backlog.md)** — this file remains the findings ledger.

---

## Executive summary — what matters most

1. **Two root causes of "my data disappeared" are still live** (Batch A): `food_items` never rides the pull delta (food logs sync without their items → past dates/new devices render empty offline), and the outbox confirm protocol keys on `domain:date` instead of mutation id (one failed food log permanently strands every other log from that day in the queue). Plus: no retry cap, no dead-letter, no user-visible sync health, and a persistent 5xx still wedges the whole queue.
2. **Real training-engine bugs** (Batch C): the emergency-deload prescription is stored then immediately nulled (never reaches the bar after a reload); editing a set produces garbage 1RM for bodyweight lifts and never corrects an inflated PR; the Brzycki term explodes for 31–36-rep sets (order-of-magnitude 1RM inflation); the AI's *self-reported* confidence — not the engine's — gates auto-apply.
3. **The caching gaps behind "loads slowly" are now fully mapped** (Batch B): ~17 uncached read sites, 2 high-severity invalidation gaps (Oura sync, injury writes) that show stale data for up to 30 min, and the AI-chat markdown/KaTeX stack still shipping eagerly on 4 screens.
4. **Security posture is strong** (no IDOR/SQLi found; `pushMutations` well-defended) but the Oura webhook signature is bypassable by omitting the header, and the mobile auth deep link uses an interceptable custom scheme (Batch D).
5. **Highest-leverage new capabilities:** a **morning check-in** (the schema already anticipates `phase='morning'`), Oura **tags** sync for lifestyle correlations, AI-chat **tool-calling with Oura context**, and a reusable **SwipeCarousel + edge-swipe tab navigation** (Batches F–H).

---

## ⚡ Quick wins (small, isolated, high value — one PR)

**✅ Shipped 2026-07-02 (PR #91).** Item 7 was changed in flight: rather than cache the `morning-briefing` route, it (and its "Day Recap" evening sheet) was deleted outright — it's fully superseded by the End of Day review shipped in v1.75.0, so optimizing it further wasn't worth it.

| # | Item | Batch | Effort |
|---|------|-------|--------|
| 1 | ✅ `food_items` in `getSyncDelta`/`pullDelta` (stops food vanishing offline) | A | S |
| 2 | ✅ Fix emergency-deload wipe: `advancePhase` before `storePrescription` (or preserve) | C | S |
| 3 | ✅ Oura webhook fail-closed: reject when signature header or signing key missing | D | S |
| 4 | ✅ Migration **103**: `set_logs(updated_at)`, `exercise_logs(updated_at)`, `personal_records(user_id, achieved_at DESC)`, `food_logs(user_id, meal_type_id, logged_at)` | B | S |
| 5 | ✅ Lazy-load `AiChatOverlay` (`next/dynamic`, `ssr:false`) on session-select/done/stats/overview + lazy `Response`/`CodeBlock`; dynamic-import `HrDayChart` in `home-card-widget` | B | S |
| 6 | ✅ Rate-limit `prescribe` + `session-explain/insight` (only AI routes without one) | E | S |
| 7 | ✅ ~~Cache `morning-briefing`~~ — removed instead; superseded by End of Day review | E | S |
| 8 | ✅ `invalidateOuraSync()` group helper + route injury writes through group invalidation (fixes the two worst stale-data paths) | B | S |
| 9 | ✅ Scope the `supplement_logs` delete in `pushMutations` to `user_id` | D | S |
| 10 | ✅ Plate-loading calculator on the "Load the bar to X kg" card | H | S |

---

## Batch A — Offline-first data integrity (the "data disappeared" batch)

**Touches:** `lib/local-store/{sync-engine,sqlite-backend}.ts`, `lib/sqlite/migrations.ts` (local **v13**), `app/api/sync/{push,pull}/route.ts`, `lib/data/postgres/adapter.ts` (`getSyncDelta`, `pushMutations`). ⚠️ Highest correctness-risk batch — test cold-sync, offline replay, and the poison-mutation path explicitly. Device verification required.

### A1 — ✅ SHIPPED (quick wins, PR #91) — `food_items` missing from the pull delta
`applyDelta` supports `delta.foodItems` (`sqlite-backend.ts:756`) and the type declares it (`lib/local-store/index.ts:74`), but `getSyncDelta` never returns it (`adapter.ts:2436-2450`) and `pullDelta` never maps it (`sync-engine.ts:235-245,303`). The pull brings 90 days of `food_logs` without their items; `getFoodLogsWithItems` JOINs and silently omits any log whose item isn't local (`sqlite-backend.ts:886-895`). **Failure:** fresh install / new device / any past date not opened while online → logged food doesn't render offline. **Fix:** include the user's referenced `food_items` (join through their food logs, plus user-created items) in `getSyncDelta`, map in `pullDelta`. This is the #1 fix in the whole document.

### A2 — `FIX` HIGH — Outbox confirm protocol keys on `domain:date`, not mutation id
Client pushes `{domain, date, payload}` dropping the outbox row id (`sync-engine.ts:345`); server echoes errors as `{domain, date, error}` (`adapter.ts:2531,2679,2689`); client retains every row matching a failed `domain:date` key (`sync-engine.ts:356-357`). Multiple rows legitimately share that key (each food log on a day, multiple activities). **Failure:** 3 foods logged, 1 fails FK validation → all 3 retained and re-pushed forever; queue never drains for that date. **Fix:** thread the stable outbox `id` end-to-end — include it in the push envelope, echo it in success *and* error records, confirm/delete by id.

### A3 — `FIX` HIGH — No retry cap, dead-letter, or user visibility for stuck mutations
`mutations_outbox` has only `id,user_id,domain,date,payload,created_at` (`lib/sqlite/migrations.ts:250-257`). A permanently-failing mutation retries forever, invisibly. **Fix (local v13):** add `attempts`, `last_error`, `status ('pending'|'failed')`, `next_retry_at`. On per-item error: increment attempts, exponential `next_retry_at`; after 5 attempts mark `failed` (stop auto-retry). **Surface it:** a small sync-health indicator (e.g. in More or the pull-to-sync sheet) listing dead-lettered rows with per-row Retry / Discard. This converts silent data loss into a visible, recoverable state.

### A4 — `FIX` MED — Persistent 5xx from the oldest chunk wedges the entire queue
`sync-engine.ts:351` `if (!res.ok) break`; the push route doesn't wrap `repo.pushMutations` in try/catch (`push/route.ts:46`) and the pre-loop `getUserById` sits outside the per-mutation try/catch (`adapter.ts:2459-2462`) — any throw there 500s the whole batch, and because chunks drain oldest-first, chunk 1 re-breaks the loop every sync. **Fix:** try/catch the route body into a structured 500; make pre-loop work non-fatal (default the tz); client treats 5xx as transient-with-backoff rather than terminal for the queue (combined with A3's per-item accounting).

### A5 — `FIX` MED — `applyDelta` pull-clobber gaps
- `workout_sessions` branch unconditionally overwrites and forces `sync_status='synced'` (`sqlite-backend.ts:549-560`) while every sibling domain checks `existing.sync_status === 'synced'` first — a pull can clobber a pending local session and tear it from its still-pending children. Add the same guard.
- `activity_logs` has no `sync_status` column at all (`migrations.ts:230-238`) so pulls always clobber; an offline edit can be silently reverted by a stale server copy. Add `sync_status` (local v13) + guard.
- `activity_logs` INSERT in `applyDelta` drops `calories_burned` and `start_time` (`sqlite-backend.ts:646-655`) even though the columns exist (v11), the server sends them, and `sync-engine.ts:166-167` maps them — server-originated activities render offline with no calories/start time. Add both columns to the upsert.

### A6 — ✅ SHIPPED (verified 2026-07-03) — Last-write-wins has no timestamp comparison
*Verified on main: `applyDelta` gates `body_metrics`/`mood_logs`/`day_checkins` upserts on `excluded.updated_at > <table>.updated_at` (`sqlite-backend.ts:586,608,951`), and the `personalRecords` branch takes the server value verbatim (no `MAX()` clamp) so C2 downward corrections propagate.*
No `applyDelta` branch compares `updatedAt` — the guard is binary (pending vs synced). Two devices both synced: last pull wins silently. `personal_records` merges via `MAX(estimated_1rm)` (`sqlite-backend.ts:621`) so a wrongly-high PR can never be corrected downward via sync (interacts with C2). **Fix:** `updatedAt`-gated updates for user-editable singleton-per-day domains (body_metrics, day_checkins, mood_logs); make PR sync respect server-corrected values.

### A7 — ✅ SHIPPED (verified 2026-07-03) — Direct-POST workout logging: verify idempotency on lost response
*Verified on main: `logExerciseFromPayload` threads client-supplied `workoutSessionId`/`exerciseLogId`/`setLogIds` end-to-end and upserts via `ensureWorkoutSession` (`lib/workout/log-exercise.ts:59-60,107-116,167,179`) — a re-push after a lost response upserts rather than double-inserting.*
`workout-screen.tsx:656,685-689` writes locally as pending, POSTs `/api/log-exercise`, queues a `workout_log` mutation on failure — sound offline behaviour. Residual risk: if the server commits but the response is lost, the queued re-push must upsert on the client-supplied `workoutSessionId`/`exerciseLogId`/`setLogIds` rather than double-insert. Verify `logExerciseFromPayload` keys on those ids; also handle the double-failure case (POST throws *and* `queueMutation` throws → local row stranded as pending with no outbox entry).

### A8 — `UPLIFT` MED — Sync/DB throughput (carried from v1 Batch 3, all still open)
- `applyDelta` writes ~19 domains one record at a time with a `SELECT sync_status` before each guarded write, no transaction (`sqlite-backend.ts:501+`). Wrap per-domain in `BEGIN/COMMIT`; fold the guard into `ON CONFLICT … DO UPDATE … WHERE sync_status='synced'` (pattern exists in `logWorkoutLocally:213-287`).
- `saveProgram` N+1 (`slices/programs.ts:238-264`): pre-generate UUIDs + 2 bulk inserts.
- Pull sync is a single un-paginated payload (`/api/sync/pull`): paginate by `updatedAt` cursor (~500/page) or yield between domains.
- `getSyncDelta` `personal_records` filter drops rows with null `achieved_at` (`adapter.ts:2353`) — those PRs never sync.

### A9 — `UPLIFT` LOW — Make the local store the single offline read source *(still open, re-verified 2026-07-03: `nutrition-content.tsx:81,193`)*
Two parallel systems (api_cache stale-while-revalidate vs local-store delta) with hand-wired per-feature hydration is why gaps like A1 recur. Nutrition reads body metrics from `cachedFetch('body-metadata')` instead of the store it already writes to (`nutrition-content.tsx:183`) — offline it can contradict a water log the user just made. Direction: store-backed domains read the store everywhere; `api_cache` only accelerates server-computed aggregates (weights-summary, progress-summary).

**Acceptance:** airplane-mode cold open renders food (any past date), activities with calories/start times, and workout history; a deliberately-poisoned mutation dead-letters after 5 attempts and is visible + discardable in UI; siblings of a failed mutation drain; pull never reverts a pending local edit.

---

## Batch B — Caching & performance (the "loads slowly" batch) — ✅ SHIPPED 2026-07-02 (PR #99)

**Touches:** client components, `lib/sqlite/cache.ts`, `lib/cache-groups.ts`, `next/dynamic`, migration 103.

### B1 — `FIX` HIGH — Stale-cache invalidation gaps (visible today)
| Write | Missing invalidations | Symptom |
|---|---|---|
| ✅ Manual Oura sync (`health-content.tsx:509-511`) | `oura-stats`, `oura-hr-day:*`, `home-day-timeline`, `training-load`, `progress-summary`, `weekly-stats` | Fixed via `invalidateOuraSync()` *(Quick win 8, PR #91)* |
| ✅ Injury add/edit/delete (`injury-sheet.tsx:130,171`) | invalidates **nothing** — `injuries` key stays stale | Fixed via `invalidateInjuryWrites()` *(Quick win 8, PR #91)* |
| ✅ Manual activity add (`health-content.tsx:621-631`) + Oura walk confirm (`exercise-review-sheet.tsx:142-143`) | `home-day-timeline`, `calendar-data:*` | Fixed via `invalidateActivityWrites()` (PR #99) |
| ✅ Water log (`water-log-sheet.tsx:55,76`) | `progress-summary` | Fixed via `invalidateBodyMetricWrite()` (PR #99) |

**Fix:** add `invalidateOuraSync()` and route all injury/supplement/activity writes through group helpers in `lib/cache-groups.ts` — stop hand-rolling partial lists at call sites.

### B2 — `UPLIFT` HIGH — Uncached read-site matrix (add `cachedFetch` + `readCacheSync` seed) — ✅ all shipped PR #99
| Site | Endpoint | Note |
|---|---|---|
| ✅ `friend-feed.tsx:58`, `friend-leaderboard.tsx:33`, `friends-tab.tsx:19` | friends feed/leaderboard/list | Cached via `friends-feed`/`friends-leaderboard`/`friends-list` keys, invalidated by `invalidateFriends()` |
| ✅ Supplements (`nutrition-content.tsx:220,227`, `supplements-section.tsx`, `sync-provider.tsx:207`) | `/api/supplements` | Cached under `supplements` key, invalidated by `invalidateSupplements()` |
| ✅ Pre-workout injuries (`workout-screen.tsx:264`) | `/api/injuries` | Now seeds/reads the shared `injuries` key via `cachedFetch` |
| ✅ `assign-step.tsx:29,41,48`, `macro-targets-pane.tsx:31`, `goals-section.tsx:85` | meal-types / food-logs / targets / body-metadata | All converted to `cachedFetch` reusing existing keys |
| ✅ `exercise-summary-screen.tsx:41`, `exercise-stats-sheet.tsx:58,66` | exercise-history | Unified under `exercise-history:{name}`, invalidated by `invalidateWorkoutSummaries()` |
| ✅ `add-exercise-sheet.tsx:60` | exercise-library | Now `cachedFetch`, writes back to the `exercise-library` key |
| ✅ `home-day-timeline.tsx:203` | day-timeline | `readCacheSync` seed added |
| ✅ `session-select-content.tsx:635,699` | mood / profile | Mood seeded from `mood:{date}`; profile converted to `cachedFetch` under `more-user-profile` |
| ✅ `profile-tab.tsx:167`, `oura-battery-chip.tsx:31`, `end-of-day-review.tsx:66-80` | program-week / oura token / body-battery+metadata | All cached/seeded; `oura-token` added to `invalidateOuraSync()` |

### B3 — `UPLIFT` HIGH — Bundle & render — ✅ all shipped PR #99
- ✅ `AiChatOverlay` static on 4 top screens drags react-markdown + rehype-katex + KaTeX CSS + syntax-highlighter into the initial bundle (`done-screen.tsx:7`, `overview-screen.tsx:12`, `session-select-content.tsx:15`, `stats-content.tsx:9`; `ai-chat-overlay.tsx:8`). → `next/dynamic({ssr:false})` everywhere + lazy `Response`/`CodeBlock`. *(Quick win 5, PR #91)*
- ✅ Per-second `setInterval` re-renders the 1,034-line workout orchestrator at 1 Hz (`workout-screen.tsx:158-181`), rebuilding warmup grid, sparkline, MuscleHeatmap, TimerRing. → extracted `components/workout/session-clock.tsx` (`useElapsedSec`/`SessionClock`) into the leaf screens; the rest-beep effect is now a single scheduled `setTimeout` against `restStartMs`.
- ✅ `HrDayChart` (chart.js) statically imported into the home bundle (`home-card-widget.tsx:10`). → dynamic. *(Quick win 5, PR #91)*
- ✅ `SyncProvider.warmCache` fires ~20 parallel requests on cold start (`sync-provider.tsx:117`) — now chunked 5-at-a-time in `CACHE_TASKS` order.
- ✅ Zero `next/image` (14 raw `<img>`); AVIF/WebP config is dead (`next.config.ts:46`). → `next.config.ts` gained `remotePatterns`; every fixed-size avatar/thumbnail converted to `next/image` (`data:`/`.gif` sources marked `unoptimized`); transient/base64 screenshots stay `<img>`.

### B4 — `UPLIFT` MED — Server-side — ✅ shipped PR #99
- ✅ `day-timeline` fetches **all** Oura workouts unbounded then filters to 2 days (`day-timeline/route.ts:92`) — now passes `{from: yesterday, to: date}`.
- ✅ Missing `Cache-Control` on `day-timeline` (`:271`) and on readiness-score / muscle-recovery / training-load / sleep-sessions / weights-summary / nutrition routes — all now carry `private, max-age=60, stale-while-revalidate=120` (`day-timeline` uses `max-age=30`) so the WebView HTTP cache assists cold starts.
- ✅ Migration **103** indexes *(Quick win 4, PR #91)*: `set_logs(updated_at)` + `exercise_logs(updated_at)` (every sync pull currently scans), `personal_records(user_id, achieved_at DESC)`, `food_logs(user_id, meal_type_id, logged_at)`.

**Acceptance:** no screen shows a skeleton/spinner on a repeat visit; every write is reflected across all consuming screens immediately (no 30-min staleness); sync pull query plans use the new indexes.

---

### B5 — `UPLIFT` HIGH — Render & save-latency audit (2026-07-02, verified post-#91)

Component-level follow-up audit targeting perceived latency ("every page instant, saves instant"). Everything below re-verified against `main` after PR #91's lazy-loading landed. **Executable plans (one PR each):** [save-latency](../superpowers/plans/2026-07-02-b5-save-latency.md) · [render fixes](../superpowers/plans/archive/2026-07-02-b5-render-fixes.md) · [bundle splits](../superpowers/plans/archive/2026-07-02-b5-bundle-splits.md).

**Save latency — the "workout shows as complete slowly" report, root-caused:**
- `FIX` HIGH — **Complete-workout leaves stale home-screen seeds.** The mode flip to "done" is already fully optimistic (`workout-screen.tsx:913` synchronous, POSTs fire-and-forget) — the lag is on the *home screen after*: `invalidateWorkoutSummaries()` clears the `ta_sscache:`/`ta_cache:` keys but never the legacy seeds home paints first — `ta_recommendation_v1`, `ta_meta_v1`, `ta_streak_v1`, `ta_calendar_v2_*` (`session-select-content.tsx:318,435,437,462,472`) — so home re-shows the pre-workout recommendation/week-strip until `/api/next-session` + `/api/calendar-data` round-trip. Fix: delete the legacy keys inside `invalidateWorkoutSummaries()` (or migrate those seeds onto the `ta_sscache:` keys and remove the legacy ones), and optimistically write today's completion into the `calendar-data:`/`streak-data` caches at complete time. Also: `localStorage.setItem('ta_complete_…')` at `workout-screen.tsx:905` is write-only dead code — remove.
- `FIX` MED — **DoneScreen auto-awaits a live Oura Cloud sync on mount** (`done-screen.tsx:59-80`: `POST /api/oura/hr-sync` then the data fetch) — the done screen reads "Fetching HR data…" for seconds right when the user wants to leave. Put it behind the existing manual button, or fire-and-forget + delayed poll.
- `FIX` HIGH — **Food logging serially awaits one POST per new item** (`lib/nutrition/log-food.ts:161-162`) before any local write or toast — a 5-ingredient scan is 5 blocking round-trips, and `food_items` creation has no outbox path so it fails entirely offline (offline-first violation). Fix: client UUIDs + outbox for food items, or one batch POST.
- `FIX` LOW — Web-fallback save paths block the toast on the POST (body metrics on home + health, mood sheet); the local-first branches are correct — align the fallbacks. Health workout delete also awaits the full 18-key invalidation (36 sync storage scans) before refetching.

**Render storms:**
- ✅ shipped (interval extraction, an earlier batch) — zero `setInterval` left in `workout-screen.tsx`'s orchestrator; the rest-beep is a scheduled one-shot `setTimeout`. **Not fully closed:** `ActiveWorkoutScreen` itself still calls `useElapsedSec` directly in its own body (not a further-extracted leaf), so it still self-ticks every second regardless of `React.memo` — flagged as a separate, carefully-scoped follow-up rather than risking the highest-regression-risk screen in the app on a rushed deeper extraction (2026-07-04).
- ✅ shipped (2026-07-04, PR `fix/render-storms`) — Memo-defeating inline props fixed: `active-workout-screen.tsx`'s `onRpeChange` now a `useCallback`; `session-select-content.tsx`'s `onColorChange`/`onColorChangeLeft`/`onColorChangeRight` now a shared stable `updateCardColor` (functional `setCardColors`, no `cardColors` dep) plus per-card wrappers; `hrData` now `useMemo`'d. Also fixed several more of the same class found during the memo pass: `handleSelect`/`handleDeload`/`handleFullSessionOverride`/`handleRestDay`/`openLog` were plain (non-`useCallback`) functions passed to memoized cards, and `visibleDefs` was a fresh `.filter()` array every render — all now stable.
- ✅ shipped (2026-07-04) — `React.memo` added to `RecommendationCard`, `StreakCard`, `WeekStripCard`, `MetricTilesCard`, `HomeDayTimeline`, with the call-site inline-prop fixes above so the memo isn't dead code. The per-section data-hook structural split (home's 54-`useState` wholesale re-render) is **not** done — out of scope per this plan's own Task 3 note (that's G3's structural work).
- ✅ shipped in the review-quick-fixes PR (found already done when re-checked 2026-07-04) — `style-editor-sheet.tsx` already keys editable set rows by a stable `set.key`, not index.
- ✅ shipped (2026-07-04) — `readCacheSync('achievements:…')` in `workout-screen.tsx` moved into a one-time `useEffect`. Also found and fixed the same class in `workout-select-content.tsx`'s `getLastTrainedLabel(currentSession)`, called directly in the render body — now `useMemo`'d.

**Remaining bundle splits (post-#91)** — ✅ shipped (2026-07-04, `perf/bundle-splits`):
- ✅ `DoneScreen` (and its static `HrRecoveryChart`/chart.js) dynamic-imported out of `/workout`'s initial chunk.
- ✅ `components/chat.tsx`'s `ChartMessage` + `Response` (markdown/KaTeX) dynamic-imported, matching `ai-chat-overlay.tsx`'s existing pattern. First Load JS for `/chat`: 681 kB → 234 kB.
- ✅ `components/ai/code-block.tsx` switched from the full Prism barrel to `prism-light` with only 6 registered languages (ts/js/json/sql/bash/python).
- ✅ One shared `components/health/trend-sparkline-lazy.tsx` dynamic wrapper now used by all 4 health detail pages instead of a static import.
- ✅ `MealTypeManager` (@dnd-kit) and the `motion`-bearing `BodyBatteryCard`/`ReadinessCard` are now dynamic-imported with fixed-height skeletons. `/nutrition`: 242 kB → 203 kB; `/overview`: 226 kB → 164 kB.
- ✅ TTL constants moved out of `components/sync-provider` into `lib/cache-ttl.ts`; all 34 importing screens updated, `sync-provider.tsx` now imports from the new file too (no more mini-barrel coupling).
- ✅ `components/chat-overlay.tsx` re-verified — already deleted by an earlier commit (`65b7676`, dead-code removal); only the live `ai-chat-overlay.tsx` exists today. No action needed.
- ✅ `cachedFetch` gained an opt-in `{ freshWithinTtl: true }` option (`lib/sqlite/cache.ts`) that skips the network round-trip when a cache hit is still within its real per-call TTL — applied to `exercise-library`, `activity-types`, `progression-styles`, and the per-session `workout-card:*` prefetch wave (home + workout-select). A write-group invalidation still forces the next read to fetch (the entry is deleted outright, so there's nothing to be "fresh" about). Unit-tested in `lib/__tests__/cache-fetch.test.ts` (fresh hit skips fetch, stale hit still fetches, invalidated entry still fetches).

### B6 — Data-store follow-up audit (2026-07-02, session 178 — verified post-#99, excludes everything in the B5 plans)

**Plan:** [b6-data-store-fixes](../superpowers/plans/2026-07-02-b6-data-store-fixes.md) (3 chunks).

**Invalidation & cache-layer semantics:**
- `FIX` HIGH — **The primary food-log path invalidates nothing.** `lib/nutrition/log-food.ts` (both the local-store branch ~:199 and web branch ~:224) and `lib/nutrition/log-meal.ts` contain zero `invalidate*` calls — logging a meal leaves `nutrition-food-logs-<date>`, `nutrition-weekly-summary`, and `body-metadata` stale until TTL expiry (home calorie/macro tiles + weekly chart show pre-log values). The delete/edit paths (`nutrition-content.tsx:260-278`) invalidate correctly — the log path is the outlier. Add an `invalidateNutritionWrite()` group in `lib/cache-groups.ts` and call it from both loggers.
- `FIX` MED — **Date-less "today" keys + the 24h localStorage floor serve yesterday cross-midnight.** `lib/sqlite/cache.ts:93` persists every entry for `max(ttl, 24h)`, and `readiness-score`, `body-battery`, `training-load`, `weekly-stats`, `progress-summary`, `health-trends` embed no date — a next-day cold start seeds yesterday's values until the refetch lands. `body-metadata` already guards (`session-select-content.tsx:410-421` drops a non-today seed); either embed the local date in these keys or apply the same guard at each seed site. (This is the CLAUDE.md "today data must embed the date" rule — these keys predate it.)
- `FIX` MED — **Same key, three different TTLs → freshness is last-writer-wins.** `readiness-score` is fetched with `TTL_SHORT` (`session-select-content.tsx:764`), `TTL_LONG` (`:658`, all four health detail pages) and `TTL_MEDIUM` (`health-content.tsx:382`); `muscle-recovery` mixes MEDIUM and LONG across 4 sites. Define one canonical TTL per key (pairs with bundle-splits Task 7's cache-ttl module).
- `FIX` LOW — **In-flight dedup starves the second caller.** `cachedFetch` (`cache.ts:160-167`) dedups concurrent fetches by key but only the first caller's `onData` receives the network payload — a second component mounting on a cold cache stays empty until an unrelated re-render. Fan the resolved data out to every awaiter.

**Server-side reads:**
- `FIX` HIGH — **`exercise-history` loads 90 days of full session trees to return 20 rows.** `app/api/exercise-history/route.ts:33-56` → `getWorkoutSessionsFrom` → `buildWorkoutSessions` (3 unbounded `inArray` queries, `adapter.ts:937-981`), then filters by exercise name in JS and `.slice(0,20)`. The `idx_el_name_date_ws` index already exists for exactly `WHERE exercise_name = ? ORDER BY logged_at DESC LIMIT 20` — add a repo method that filters in SQL (mirror `getLastExerciseLogsBatch`, `adapter.ts:1068`).
- `FIX` MED — **`muscle-recovery` re-selects the entire exercise library (incl. `instructions` JSON) per request** (`route.ts:23-26` → `listExerciseLibrary`, `adapter.ts:1519`) on a route fetched from home, health AND workout-select. `computeMuscleRecovery` needs only `name` + `muscles` — add `listExerciseMuscleMap()` and/or a server-side memo (the library is global and near-static).
- `FIX` MED — **`admin/pending-count` loads ALL users to count, and is bare-fetched 3× per navigation** (`bottom-nav.tsx:30`, `profile-tab.tsx:182`, `session-select-content.tsx:768`). `SELECT COUNT(*) WHERE is_active=false` + one shared `cachedFetch('admin-pending-count')`, gated on `isAdmin`.
- `UPLIFT` MED — **SWR `Cache-Control` still missing** on: `exercise-history`, `health/trends`, `weekly-muscle-sets`, `strength-trend`, `sleep-performance-correlation`, `workout-sessions/day`, `oura/hr-day`, `injuries`, `supplements`, `program-week`, `user/goals`, `seasons`. Same `private, max-age=60, stale-while-revalidate=120` recipe as PR #99 (body-battery: `max-age=15` or skip).
- `UPLIFT` LOW — **`workout-sessions/day` hydrates full set/exercise trees to emit 3 summary fields** (`route.ts:17,26-30`) — lightweight session-columns-only query.

**First paint / redundant fetches:**
- `UPLIFT` MED — **Home mount fires overlapping fetch effects for the same keys.** `sleep-sessions`, `readiness-score`, `body-battery`, `training-load`, `muscle-recovery` each appear in both `refetchAll` and a standalone mount effect (`session-select-content.tsx:535-771`); only the in-flight dedup (with its starvation gap above) prevents double network hits. Consolidate into one `refetchAll` invocation (pairs with the B5 render-fixes home split).
- `FIX` LOW — `overview-screen.tsx:154` bare-fetches `/api/workout-data?tab=` on "Train" tap, bypassing the already-warmed `workout-card:<id>` cache. `done-activity-screen.tsx:47` bare-fetches `/api/user/profile` (cached as `more-user-profile` elsewhere). `friends-tab.tsx:18-27` has no `readCacheSync` seed (skeleton every open while feed/leaderboard siblings seed).
- `FIX` LOW — **`sync-provider` reminder reconcilers bypass the cache on every app open/resume**: raw `fetch` of `meal-types` + `food-logs` (`sync-provider.tsx:153-154`) and `next-session` (`:182`) despite both being warmed keys (the supplements reconciler at `:212` already does it right).

**Sync engine:**
- `UPLIFT` LOW — A failing `pullPage` never bumps `lastSyncMs` (`sync-engine.ts:367`), so a persistently-failing pull retries on every mount trigger — add a short backoff mirroring `push5xxUntil`.
- `UPLIFT` LOW — Any delta row triggers whole-group invalidation (`sync-provider.tsx:106-110` → ~24 key prefixes via `invalidateWorkoutSummaries`), forcing a refetch storm after tiny syncs. Consider scoping invalidation to the domains actually present in the delta.

## Batch C — Training-engine logic (1RM + AI periodization correctness)

**Touches:** `lib/1rm.ts`, `lib/workout/log-exercise.ts`, `app/api/workout-entry/route.ts`, `lib/ai-periodization/*`, `app/api/ai-periodization/session/[id]/prescribe/route.ts`, `lib/data/postgres/slices/periodization.ts`, `app/api/readiness-score/route.ts`.

### C1 — ✅ `FIX` HIGH shipped (quick wins, PR #91) / C1b — ✅ shipped (PR #105) — Emergency-deload prescription is wiped immediately after being stored
`prescribe/route.ts:141-142` calls `storePrescription(...)` then `advancePhase(...,'deload')`, and `advancePhase` sets `prescription: null, prescriptionStatus:'none'` (`periodization.ts:87-88`). The HTTP response carries it once; any reload reads null → `aiDrivesLoad` false → the deload never reaches the bar. **Fix:** reorder (or have `advancePhase` preserve the prescription). ✅ Shipped as `persistEmergencyDeload` (advancePhase before storePrescription). ✅ **C1b shipped (PR #105):** re-architected to offer, not impose — generating a prescription no longer mutates persisted phase state; only accepting one does (`shouldTriggerEmergencyDeload` pure trigger + idempotent short-circuit for an already-pending unexpired emergency).

### C2 — ✅ `FIX` HIGH shipped (PR #101) — Edit-path 1RM is wrong for bodyweight/assisted lifts and never fixes PRs
`workout-entry/route.ts:40,52-59` recomputes `estimated_1rm` via `calculate1RM(weights, reps)` — no progression style, no `BW_REF` (bodyweight "weight" is added load; `calc1RM` returns `weight` when ≤0 → ~0 or nonsense), wrong `intensity_pct`, and `personal_records` is never reconciled, so correcting a fat-fingered set leaves an inflated PR forever. **Fix:** extract one shared estimator `(weights, reps, exerciseType, style)` used by both `logExerciseFromPayload` and PATCH; after an edit, re-run PR upsert **and** downward-reconcile if the edited set had set the PR. ✅ Shipped as `estimateOneRm()`, used by both paths; edit path calls `reconcilePersonalRecord`.

### C3 — ✅ `FIX` HIGH shipped (PR #101) — Brzycki explodes for 31–36 reps
`repFactor` (`1rm.ts:13-18`) averages in Brzycki `36/(37−reps)` up to rep 36 (singular at 37): `repFactor(35)≈10`, `repFactor(36)≈19`. `calculate1RM` dodges it by dropping >30 (`:64`), but `bodyweightOneRm` (`:115`, no AMRAP scaling either) and the baseline path (`log-exercise.ts:143`) clamp to 36 and feed it straight in → a 34-rep bodyweight AMRAP yields ~7×BW_REF. **Fix:** one rep ceiling (30) everywhere; Epley-only above ~15–20 reps; apply AMRAP scaling in `bodyweightOneRm`. ✅ Shipped as `REP_CEILING=30`, frozen Brzycki above 20 reps, AMRAP-scaled averaging for bodyweight/baseline.

### C4 — ✅ decision confirmed + `UPLIFT` MED shipped (PR #101) — Unify the three aggregation rules *on averaging*
**AVERAGE is a confirmed design decision (user, session 176), not a bug.** `prescriptionFactor` (`1rm.ts:47-50`) neutralizes formula decay so on-target sets reproduce the prior 1RM exactly; +1 rep on the last set nudges the average up by excess ÷ set count (small smooth gains), missed reps pull it down — self-regulating by design, and the v1.72.0 last-set-push is built on it. Keep it as *the* progression signal. Remaining work:
- **Align the other two paths to the same rule:** bodyweight uses **max of best set** (`1rm.ts:110-117`) and baseline uses **first set only** (`log-exercise.ts:142-144`) — bodyweight lifts currently progress on a different, jumpier philosophy than barbell lifts. ✅ Shipped — bodyweight/baseline aligned to AMRAP-scaled averaging.
- **Decide PR semantics:** `personal_records` stores the best *session average*, so a big AMRAP day is credited at only ~1/N of the demonstrated excess — the displayed "all-time 1RM" understates what was actually proven. Either document that, or store a separate display-only best-single-set estimate (prescriptions stay on the average either way). ✅ Shipped — `bestSetOneRm()` added as a display-only estimate; averaging stays the progression signal.
- **Known property (document, don't fix):** a +1-rep gain scales with 1/set-count, so progression speed is coupled to programmed set volume and to time-budget trims — keep in mind when tuning autoregulation thresholds, since `rm1Trend` deltas are intentionally small under this scheme. ✅ Documented in code comments.

### C5 — ✅ `FIX` HIGH shipped (PR #105) — `signals.acwr` is near-degenerate and mis-divided
`signals.ts:274-288`: (1) counts sessions of a **single session type**, so for a 1×/week session it's ≈1.0 always yet drives the `acwr>1.5` emergency-deload trigger; (2) chronic = 28-day count ÷ 4 even when the program is 14–27 days old → ACWR inflated ~2× on new programs → spurious emergency deloads. `readiness-score/route.ts:177` already does volume-load ACWR with a real `dataSpanWeeks` divisor. **Fix:** extract one shared volume-load ACWR helper; use it in both; fix the prompt's misstated gate text (`prompt.ts:143`). ✅ Shipped as `computeVolumeAcwr()`, used identically by `signals.ts` and `readiness-score`.

### C6 — ✅ `FIX` MED shipped (PR #105) — Auto-apply/confidence gates run on the LLM's self-reported number
`prescribe/route.ts:261,276` + `ai-prescription-card.tsx:52,130`: the model's own `confidence` field is displayed, gates the <0.4 two-step confirm, and gates ≥0.6 auto-apply; the engineered `signals.confidence` (`signals.ts:322-338`) is only prompt text. A hallucinated 0.85 auto-applies. Also the v1 "unreachable gate" fix: `0.5 + sessions×0.1` floor can't drop below 0.4 — lower the cold-start base (~0.3). **Fix:** gate and display on the deterministic `signals.confidence`/tier; treat the LLM number as an input only. ✅ Shipped as `computeConfidence()` with a 0.3 cold-start base, gating both auto-apply and the low-confidence UI.

### C7 — ✅ `FIX` MED shipped (PR #105) — Autoregulation can double-apply on top of the LLM's own adjustment
The prompt hands the model RPE/1RM trends (it picks a lower in-zone pct for a fatigued lift) and `computeRpeAdjustment` then cuts a further 5–10% for the same signals (`prescribe/route.ts:182-206`, `autoregulation.ts:51-95`). **Fix:** instruct the model to prescribe neutral in-zone pct and let the deterministic layer adjust; or clamp combined deviation. ✅ Shipped — prompt instructs neutral in-zone pct; `clampPrescribedPct()` floors the combined LLM+autoreg cut at one back-off below the zone minimum.

### C8 — ✅ `FIX` MED shipped (PR #105) — Load-only back-off silently re-clamps reps
`autoregulation.ts:127-137` clamps reps into the goal band even when `repDelta = 0`, so a pure load cut also chops a legitimately-higher rep prescription. Only clamp when `repDelta !== 0`. ✅ Shipped.

### C9 — ✅ `FIX` MED shipped (PR #105) — No ceiling on intensification/realisation phases
Only accumulation has a ceiling and deload a floor (`phase-guards.ts`). The prompt claims "realisation→deload always after 2 sessions" (`prompt.ts:50`) but nothing enforces it — a lifter can sit at 87.5–92.5%/1–3 reps indefinitely if the model keeps saying `stay`. Add `applyIntensificationCeiling`/`applyRealisationCeiling` mirroring the accumulation guard. ✅ Shipped.

### C10 — ✅ Carried v1 items, all shipped (PR #101 + PR #105)
- **`target80` hardcodes 80%** (`1rm.ts:70`, `log-exercise.ts:141,145`) — derive from the active phase style's `pct`. ✅ Shipped (PR #101) as `targetPct` derived from `styleTargetPct(style)`.
- **Muscle-name normalizer** — case is normalized (migration 080) but no shared synonym fold; `muscle-heatmap.tsx:16-40`, `signals.ts:66`, `volume-targets.ts:21-24` each do their own thing. One canonical util. ✅ Shipped (PR #105) as `lib/muscles.ts` (`normalizeMuscle`/`moodMuscleMatches`), wired into all three call sites plus `muscle-recovery.ts`.
- **Muscle recovery ignores volume/intensity** (`muscle-recovery.ts:33`) — scale the time-constant by session volume/intensity. ✅ Shipped (PR #105) — tau scales 16-48h by latest-bout-vs-median-bout volume ratio.
- **Coarse `expectedRpeForPct` still feeds the program-wide `rpeTrend`** (`signals.ts:56-62,163`) — swap to the shipped reps-aware `expectedRpe`. ✅ Shipped (PR #105) as `rpeTrendFromSets()`.
- **Bodyweight weighted-variation inversion** (`1rm.ts:123-131`): weighted pull-up 1RM inverted at pure BW_REF prescribes inflated bodyweight reps — carry the added-load offset through. ✅ Shipped (PR #101) as `repMaxFromOneRm(oneRm, addedKg)`.

Also shipped in PR #105 but outside the original C-item list: weekly volume-budget divisor now derived from the schedule (`sessionsRemainingThisWeek`, was `ceil(sessions.length/2)`), and MEV/MAV/MRV volume landmarks (`volumeLandmarks()`) bracketing the existing per-muscle goal target with the per-session budget capped at MRV headroom.
- **Per-session volume divisor** `ceil(sessions/2)` (`signals.ts:262`) — derive from schedule + days left in week.
- **MEV/MAV/MRV landmarks** per muscle instead of the fixed 10–20 band (builds on the now-live volume targets).
- **`todayWorkoutVolumeKg` UTC/local midnight boundary** (`readiness-score/route.ts:158`) — add a date-window unit test.

**Acceptance:** one shared 1RM estimator with a single rep ceiling and unit tests covering bodyweight/assisted/AMRAP/edit paths; emergency deload survives a reload and only mutates phase state on acceptance; ACWR identical in signals and readiness; deterministic confidence gates the card.

---

## Batch D — Security hardening

**Touches:** `app/api/oura/webhook/route.ts`, `lib/oura/client.ts` + callback, `app/auth-mobile-bridge/` + `app/api/auth/exchange-mobile-token`, `lib/rate-limit.ts`, `app/api/builder-chat`, `app/api/nutrition/scan`, `next.config.ts`, `lib/admin.ts`, `adapter.ts`. *(Posture strong: auth on every route, ownership at the repo layer, parameterized SQL throughout, `pushMutations` forces `userId`, no secrets in web storage.)*

### D1 — ✅ `FIX` MED shipped (quick wins, PR #91) — Oura webhook signature bypassable by omitting the header
`webhook/route.ts:57` only verifies when `x-oura-signature` is present — omit it and the only gate is knowing a valid Oura `user_id`. Impact is limited (data is re-fetched with the user's own token) but it's an unauthenticated write-trigger. **Fix:** fail closed — `if (!tokenRow?.webhookSigningKey || !sigHeader) return 403`. *(Quick win 3)*

### D2 — ✅ `FIX` MED shipped (`security/batch-d-hardening`) — Mobile auth token over an interceptable custom-scheme deep link
`redirect-client.tsx:10` sends the one-time token via `trainingai://auth-complete?token=…`; any app registering that scheme can capture it and redeem the full session at `exchange-mobile-token`. **Fix:** Android App Links (verified https intent filter) or bind the token to a PKCE verifier so an interceptor can't redeem it. ✅ Shipped as a PKCE verifier binding (`lib/pkce.ts`) — no APK rebuild needed. Android App Links noted as a defence-in-depth follow-up in `projectOverview.md` (needs a native manifest change + APK rebuild).

### D3 — ✅ `UPLIFT` MED shipped — Cost-control set
✅ Rate-limit `session-explain/insight` (no limit today, `route.ts:41`) and `prescribe` *(Quick win 6, shipped PR #91)*. ✅ `lib/rate-limit.ts` backed by a shared Postgres store (`rate_limits` table, migration 104) — the sync `rateLimit(key, limit, windowMs)` signature is unchanged, so all ~15 call sites needed no edits. ✅ `builder-chat`'s `program: z.any()` bounded by `GeneratedProgramSchema` — also fixes its 500 on malformed program.

### D4 — ✅ carried v1 items, all shipped
- ✅ Oura OAuth `state` param (CSRF on callback) — `lib/oura/oauth-state.ts` (jose HS256, signed with `AUTH_SECRET`).
- ✅ `nutrition/scan`: guarded body-size read (`lib/http/request-guards.ts`) before any parse; `mimeType` allowlisted (`isAllowedImageMime`).
- ✅ Numeric clamps on `ai-chat` weight regex and `body-metadata` POST (`lib/validation/body-metrics.ts`).
- ✅ Enforce CSP — dropped report-only + `unsafe-eval` in production (dev keeps `unsafe-eval` for HMR).
- ✅ `lib/admin.ts` `requireAdmin` now throws a typed `AdminError`; all 12 previously-bare call sites wrapped → 403; misleading JWT comment corrected.

### D5 — ✅ `FIX` LOW shipped — Small items
✅ `supplement_logs` delete in `pushMutations` not scoped to `user_id` (`adapter.ts:2550-2555`) *(Quick win 9, shipped PR #91)*. ✅ `fetchDocumentById` — `dataType` allowlisted + `encodeURIComponent(id)` via `ouraDocumentPath()`. ✅ `register` confirmed (regression test) to already create inactive-pending accounts. `next-auth@5-beta` GA tracking remains a watch item, no code.

---

## Batch E — AI usage (prompts, efficiency, capability)

**Touches:** `app/api/{ai-chat,builder-chat,generate-program,nutrition/scan,ai/health-insight,morning-briefing,weekly-digest,session-explain,exercises/generate}/`, `lib/ai-periodization/prompt.ts`, prescribe route. **Guiding principle (already proven by the periodization engine):** deterministic math in code, LLM only for judgment, schema-validated output, cached result.

### E1 — ✅ `FIX` HIGH shipped — Migrate the four hand-parsed routes to `generateObject`
`builder-chat:150-156`, `generate-program:363-368`, `exercises/generate:44-48`, `nutrition/scan:103-110` all bare-`JSON.parse` free text (two even strip markdown fences — evidence the model disobeys). `nutrition-goals/recommend:223` already proves `generateObject` works on this model. Also convert `prescribe` (`:157-177`) — it has the Zod schema already; native `responseSchema` constrained decoding kills the "model invents a session_exercise_id" 502s. ✅ All five routes (`exercises/generate`, `nutrition/scan`, `builder-chat`, `generate-program`, `prescribe`) now use `generateObject` + a shared `withAiRetry` helper (`lib/ai/retry.ts`).

### E2 — ✅ `UPLIFT` HIGH shipped — Cache the deterministic-ish AI outputs (biggest free-tier saving)
`health-insight` has the right pattern (DB cache keyed section+date, cache hits skip the rate limit). Apply it: `morning-briefing` by `(userId, date)` *(Quick win 7, already shipped)*, `weekly-digest` by `(userId, isoWeek)`, `session-explain` by `(userId, programSessionId, date)`. Makes those screens instant, too. Note: `weekly-digest` route appears orphaned (`weekly-ai-summary.tsx:83` calls `/api/ai-chat`) — wire it up or delete it. ✅ `session-explain` and `weekly-digest` now cache via `ai_health_insights`; `weekly-ai-summary.tsx` now calls `/api/weekly-digest` directly (no more `/api/ai-chat` round-trip) and the digest is enriched with HRV/readiness/PRs/per-muscle volume.

### E3 — ✅ `UPLIFT` HIGH shipped — Give AI chat the app's marquee data + tools
`ai-chat/route.ts:198-204` loads program/workouts/body-metrics/food — **no Oura, no sleep, no HRV, no day_checkins** — it can't answer "should I train given my recovery?". Step 1 (cheap): add `getOuraDaily` + `listSleepSessions` + `getDayCheckin` to the `Promise.all` with a Recovery & Wellness context block (mirror morning-briefing's format). Step 2: convert to a tool-calling loop with read-only repo tools (workouts by exercise/range, sleep/HRV/readiness, PRs, nutrition, day-checkins, and a `getReadinessExplanation()` returning the engine's own weighted components) — removes the 10KB static dump (currently silently truncated at `MAX_TRAINING_DATA_CHARS`). ✅ Both stages shipped: `lib/ai-chat/context.ts` (recovery summary + precomputed 1RM targets) and `lib/ai-chat/tools.ts` (six read-only tools, `stopWhen: stepCountIs(6)`).

### E4 — ✅ `UPLIFT` MED shipped — Prompt hygiene (token cost ÷ quality)
- Stop making the model do 1RM arithmetic in chat (`ai-chat:240-247` hands it Epley): inject the stored `est 1RM` + target weight per exercise and instruct "quote, never recompute". ✅ shipped (`build1RmTargets`).
- `generate-program`/`builder-chat`: drop the per-style "ALWAYS use X" prompt blocks that server-side post-processing overrides anyway (`GOAL_STYLE_RULES` at `generate-program:413-424`); stop `JSON.stringify(…, null, 2)` (~30-40% token waste); send the exercise library as compact `name|muscles|equip` lines. ✅ shipped.
- `health-insight`: pre-format contributors into labeled lines instead of `JSON.stringify(data)` raw nested objects. ✅ shipped (`lib/oura/contributors.ts`).
- `nutrition/scan`: drop the unreliable self-verify instruction; always request per-ingredient breakdown and sum deterministically (the Atwater cross-check code already exists). ✅ shipped (`lib/nutrition/scan-totals.ts`).

### E5 — ✅ `UPLIFT` MED shipped — Robustness
Streaming routes have no mid-stream error handling (`ai-chat:274-283`, `session-explain:41-47`) — a mid-stream 429 shows a silent half-sentence; emit a terminal error token + client detection. Add one jittered retry on 429/5xx for the blocking user-initiated routes. (Rate-limiter durability is D3.) ✅ shipped: `lib/ai/stream.ts` (`textStreamResponse`/`splitStreamError`) wired into `ai-chat` and `session-explain`; `lib/ai/retry.ts` gives every `generateObject` call one jittered retry on 429/5xx/`NoObjectGeneratedError`.

### E6 — `FEAT` MED — Proactive layer (enabler)
One secret-guarded `/api/cron/*` route (HC-ingest-secret pattern) + Railway cron → iterate push subscribers. Unblocks: pre-generated ~6am morning briefing (pushed + cached), enriched weekly digest / monthly retrospective, PR celebrations, and the pure-code anomaly alerts ("HRV −20% vs baseline", "RHR +6", "slept 2h under baseline" — inputs all synced, baseline math exists in `signals.ts`/readiness).

---

## Batch F — Data & analytics (new signals, new trends)

**Touches:** `day_checkins` (+ `lib/types/day-checkin.ts`), `mood_logs`, Oura sync + `lib/oura/types.ts`, `set_logs` consumers, new trend routes/views. Migration numbering from **103+**.

### F1 — ✅ `FEAT` HIGH shipped — Morning check-in (the user's "morning mood readings")
The schema already anticipates it: `CheckinPhase = 'evening' | 'morning'` (`lib/types/day-checkin.ts:1-3`), `day_checkins.phase` defaults `'evening'`. Today the only subjective capture is the pre-workout mood gate (training days only) and `mood_logs.sleepQuality` is a dead field hardcoded `'ok'` (`mood-checkin-sheet.tsx:127,142`). **Build:** on first app open of the day, a 20-second sheet of one-tap 1–5 scales — wake mood, perceived recovery, motivation, sleep-quality feel, resting soreness — stored as `phase='morning'` (reuse `ScaleSelector`/`WellnessSection`, offline-first domain already exists). **Payoff:** every subjective reading pairs 1:1 with Oura's objective night → "subjective vs Oura readiness" calibration, "does the ring over/under-rate me", motivation-vs-performance. Feed it into `signals.ts` bodyState and the morning briefing. ✅ Shipped as `components/morning-checkin-sheet.tsx` (first-open-of-day prompt, Oura-prefilled), fully offline-first (local store + outbox + pull delta), fed into `lib/ai-periodization/signals.ts`/`prompt.ts`. Note: the "morning briefing" route referenced in the original spec was deleted in session 177 (superseded by the End of Day review) — that wiring point no longer exists, so only the periodization signals feed applies.

### F2 — ✅ `FEAT` MED shipped — Sync Oura tags + session + BDI + rest-mode
Not yet fetched: **`enhanced_tag`** (caffeine, alcohol, illness, late meal — the Oura-native lifestyle-correlation signal), **`session`** (breathing/meditation/nap with HRV), **spo2 `breathing_disturbance_index`** (already fetching the object, only `average` stored — `sync/route.ts:249`), **`rest_mode_period`** (auto-exclude illness windows from baselines). Small `oura_tags` table + sync branches; surface tags on the day timeline. ✅ Shipped: `oura_tags` table (migration 106, shared with F1) + three new Oura API clients, wired into `oura/sync/route.ts`'s parallel fetch; BDI merged into `oura_daily` from the already-fetched spo2 payload; tags/sessions/rest-mode render as cards on the Home day timeline. Note: excluding rest-mode windows from readiness/HRV baselines (the training-engine half of this item) is deferred to Batch C's baseline work, per the original scope note.

### F3 — ✅ `UPLIFT` MED shipped — Surface the stored-but-unused workout telemetry
Already captured, never shown: `set_logs.restTimeSec` (actual rest taken — compare vs prescribed `style_sets.restSec` → **rest-adherence trend**), `setStartMs/setEndMs` (set duration → intra-session fatigue/TUT proxy), per-set `rpe` (no session-RPE or RPE-drift trend), `exercise_logs.timeToComplete/avgReps/interExerciseRestSec`, `mood/day-checkin` scales (no trend view), `oura_daily.pulseWaveVelocity/nonWearTimeSec/sleepTimeRecommendation`. Add a **session-RPE prompt on the done screen** (one tap; sRPE × volume = session load, the classic Foster method). ✅ Shipped: `lib/workout/rest-adherence.ts` (pure `restAdherencePct()` helper, TDD, capped-ratio mean actual-vs-prescribed rest), `workout_sessions.session_rpe` (migration 106, already on `main`) wired end-to-end (server route, local store/outbox/pull-delta, offline-first), and a one-tap 1–10 RPE prompt on `DoneScreen`. Note: the rest-adherence *helper* is shipped but not yet surfaced in any trend view — that's F4's job (five new trend views, one of which is rest-adherence vs performance).

### F4 — ✅ `FEAT` MED shipped — Five new trend views (data already present; reuse the sleep-performance bucketing engine)
1. Subjective vs objective recovery (needs F1). 2. Session-RPE / RPE-drift over time. 3. Rest-adherence vs performance. 4. HRV/RHR/temp-deviation vs strength (extend `sleep-performance-correlation`). 5. Meal timing (`food_logs.loggedAt` + `lateHeavyMeal`) vs sleep efficiency/onset latency. Honourable mention: workout time-of-day vs performance curve. ✅ Shipped: `lib/health/correlation.ts` (shared bucketing engine, TDD, extracted from `sleep-performance-correlation` with verified byte-identical parity), `GET /api/health-trends?view=<name>` with all five views, and a new Trends card (`components/health/trends-section.tsx`) on Health > Progress with a horizontally-scrollable pill selector. Note: `recovery-vs-strength` defaults to the `hrv` sub-metric in the UI (the API supports `rhr`/`temp` too, but a nested metric-picker was out of scope for this pass — future follow-up).

### F5 — ✅ `UPLIFT` MED shipped — carried v1 data-viz items (Batch 6)
Sleep hypnogram from `sleepPhase5Min` (stored, never rendered as stages); dedupe the 3 copy-paste detail pages into `HealthScoreDetail`; consolidate 4 sparkline implementations + one `scoreBand()` util (fixes the 45-vs-50 threshold inconsistency); training-calendar year heatmap; PR/1RM projection + plateau detector feeding deload logic; tint `MuscleHeatmap` by weekly volume; expand `SET_COLORS` beyond 3; `chartjs-plugin-annotation` for `HrDayChart`. ✅ Shipped (PR #130): `scoreBand()` util + `HealthScoreDetail` dedupe, one `<Sparkline>` component, `setColor()` N-hue generation, `lib/health/hypnogram.ts` stepped-band transform (TDD), `MuscleHeatmap` volume tint, `lib/health/strength-projection.ts` 1RM projection + plateau detector (TDD) feeding `signals.ts`/`prompt.ts`. **Deliberately excluded** (carried forward, per the plan's explicit scope note): training-calendar year heatmap, `chartjs-plugin-annotation` for `HrDayChart`.

### F6 — Metrics expansion (2026-07-02 audit, session 178)

**Plan:** [f6-metrics-expansion](../superpowers/plans/2026-07-02-f6-metrics-expansion.md) (4 tier chunks).

Verified state first: the projectOverview "synced-but-hidden" Oura list is now largely **stale** — sedentary time, wear time ("Time Worn" = 86400 − `nonWearTimeSec`), temperature deviation + trend, stress/recovery, resilience, vascular age, VO₂ max and ring battery all ship in `oura-section.tsx`/`health-sections.tsx`. F3 already covers surfacing the dead set telemetry (TUT from `setStartMs/setEndMs`, rest adherence from `restTimeSec` vs prescribed, session-RPE) and F2 the tags/session/rest-mode endpoints. New items beyond those:

**Tier 1 — pure compute on stored data (S effort):**
- ✅ shipped — **Wear-time data confidence** *(the "Oura ring wearing time" ask)*: `nonWearTimeSec` is displayed but unused as a signal — flag/dim HRV/RHR/readiness on days worn < X h, add a wear-time trend sparkline, and exclude low-wear days from baselines in `signals.ts`/readiness.
- ✅ shipped — **Workout density** (volume ÷ active minutes) and **session-duration trend** — `exercise_logs.volume`, `timeToComplete`, `startedAt→completedAt` all stored.
- ✅ shipped — **User-facing RPE trend per exercise** — `signals.ts` already computes `rpeTrend`/per-exercise deltas for the AI; surface them as a chart.
- ✅ shipped — **HRV baseline-deviation card** — `readiness-score` already computes `baselineHrv` vs `recentHrv`; expose it standalone.
- ✅ shipped — **Protein per kg bodyweight** + **steps/water trends** in `/api/health/trends` (currently omitted).

**Tier 2 — light aggregation (M effort):**
- ✅ shipped — **Training monotony & strain (Foster)** — daily-load SD over 7d from data `training-load` already gathers; shown beside ACWR.
- ✅ shipped — **Nutrition logging adherence** — logged-days ratio from `food_logs` presence vs `meal_types.required`, 7d/28d, new `/api/nutrition/adherence` card.
- ✅ shipped — **Sleep consistency** — bedtime variance (SD of `sleep_sessions.sleepStart`, midnight-wrap-safe), cross-checked against the already-stored `sleep_regularity` contributor.
- ✅ shipped — **Tonnage-per-muscle weekly trend** — new `/api/muscle-tonnage-trend` (6-week series), tap-to-expand sparkline on the weekly muscle-sets card.
- ✅ shipped — **Bodyweight rate-of-change vs goal band** — `lib/health/long-term-goal-progress.ts` extended with a 14-day regression + healthy-pace band check on the Body Weight card.

**Tier 3 — new ingestion (M effort):**
- **Persist the fetched-but-dropped Oura fields**: spo2 `breathing_disturbance_index` (sleep-apnea proxy — the object is already fetched, only `average` stored, `sync/route.ts:249`), `daily_activity.resting_time` + MET-minutes, sleep `time_in_bed`; surface the stored-but-hidden `sleep_sessions.avgHeartRate`, `restlessPeriods`, `oura_daily.sleepTimeRecommendation` text.
- **Webhook handlers for the already-subscribed types** — subscriptions are created for `daily_spo2/daily_stress/daily_cardiovascular_age/daily_resilience/vo2_max` but only readiness/sleep/activity have handlers; data currently arrives only via the pull sync.

**Tier 4 — data-quality surfacing (S–M):**
- **Sync freshness indicator** — "last synced N min ago / stale" from `oura_daily.syncedAt`/`body_metrics.updatedAt`; **outbox depth** (pending-mutation count) on the sync-health card shipped in Batch A.

---

## Batch G — ✅ shipped (PR #134) — UI/UX system (consistency, accessibility, gym ergonomics)

**Touches:** shared `components/ui/*`, headers, forms, dead code, component splits.

### G1 — ✅ `UPLIFT` MED shipped — Extract the missing primitives (kills the most duplication)
- **`<SegmentedTabs>`** — identical pill-tab markup copy-pasted ~17× with drifting font sizes (`health-content.tsx:778-791`, `more-content.tsx:100-114`, stats, macro-targets, goal-targets, assign-step, leaderboard, +10).
- **`<ConfirmDialog>`** — four near-identical leave/confirm dialogs (`confirm-leave-dialog.tsx`, `bottom-nav.tsx:114-136`, builder-wizard, done-activity-screen).
- **`<EmptyState icon title action>`** — 7+ ad-hoc empty-copy variants.
- **Adopt installed-but-unused libs:** Radix `Collapsible` (0 imports vs ~18 hand-rolled chevron toggles with no `aria-expanded`/height animation); `@use-gesture` (0 imports vs 2 hand-rolled swipe implementations — feeds Batch H).
- Migrate high-traffic raw `<button>`s (377 raw vs 138 shadcn) to `<Button>`.
- ✅ Shipped: `components/ui/segmented-tabs.tsx`, `components/ui/confirm-dialog.tsx`, `components/ui/empty-state.tsx` + `skeleton.tsx`, all migrated to their real call sites; Radix `Collapsible` adopted for the 6 highest-traffic hand-rolled toggles (mood check-in, meal card, AI prescription card, profile tab, config screen). Note: the full 377-raw-`<button>`→`<Button>` migration and `@use-gesture` adoption were intentionally left for Batch H/future passes — recorded as out of scope in the PR, not silently dropped.

### G2 — ✅ `UPLIFT` MED shipped — Gym-floor ergonomics & a11y
- **Workout-tab guard gap:** `bottom-nav.tsx:44` skips the leave-confirm when the target starts with `/workout` — tapping the center FAB mid-set exits the live screen unguarded. Intercept when `workoutActive`.
- **Tap targets:** header icon buttons and date-nav chevrons are ~28–32px (`nutrition-content.tsx:304-317`, `health:769`, `session-select:1099-1123`; `globals.css:392` constrains height only). Bump to 44px min via an icon Button variant.
- **Tiny/low-contrast text:** `text-[9px]/[10px] text-muted-foreground` on functional set metadata (`set-card.tsx:156,169,402`, `mood-checkin-sheet.tsx:214`); floor at 11px, nudge dark `--muted-foreground`.
- **Color-only status** (logged-set green fill, RPE color, sore-muscle chips) — pair with icon/label. `aria-label` sweep on nutrition icon-only buttons.
- **Hardcoded colors:** 455 hex literals / 142 palette classes bypass the tuned `--accent-*` tokens (`set-card.tsx:150-153`, `mood-checkin-sheet.tsx:254-268`, `SET_COLORS`) — map semantic uses onto tokens. FAB icon `text-white` breaks on light brand themes (`bottom-nav.tsx:82`).
- ✅ Shipped: FAB taps swallowed instead of remounting the picker mid-workout; global 44px min tap target (with a `tap-dense` opt-out) + `"icon-lg"` Button size; functional text floored at 11px + dark-mode `--muted-foreground` lightened; logged-set/sore-muscle/FAB colors routed through `--accent-green`/`--accent-amber`/`--primary-foreground` tokens; nutrition icon-only buttons (quantity stepper, barcode-scanner close) got `aria-label`s; logged-set status upgraded to `CheckCircle2` + text "RPE n" (never color-only). Note: the sore-muscle overlap-warning and plain-selected colors both collapsed onto `--accent-amber` since no separate orange token exists — a minor, documented loss of that distinction.

### G3 — ✅ `UPLIFT` MED shipped — States & structure
- **No root error boundary** — only `app/workout/error.tsx` exists; add `app/error.tsx` (branded retry card) + per-tab `loading.tsx`.
- **Loading language:** skeletons vs spinners vs nothing (Home has none) — standardize skeletons for content, spinners for buttons.
- **Back-nav paradigms:** detail heroes hard-`Link` to `/health` (`detail-hero.tsx:194-202`) discarding history vs `router.back()` elsewhere — standardize back() with fallback. Extract `<ScreenHeader>` (Home alone diverges from the tab-header contract).
- **Inline form validation** (metric-log, profile/goal forms) instead of toast-only errors.
- **Dead code:** `app/workout-mockup/` (468 lines, no links), legacy `components/chat-overlay.tsx`, `app/overview` — confirm & delete.
- **Component splits (>800 lines):** `session-select-content.tsx` (1617), `health-content.tsx` (1206), `workout-screen.tsx` (1034), `config-screen.tsx` (966), `health-sections.tsx` (890), `program-editor-sheet.tsx` (886) — pull data-fetch into hooks, sheets/banners into children.
- ✅ Shipped: root `app/error.tsx` + a Home first-paint skeleton gated on a genuinely cold cache; `useBackOrFallback` hook wired into `DetailHero`'s back button; shared `<ScreenHeader>` migrated onto Health/Nutrition/More/Home (Workout's header is structurally different — back button, dynamic title, loading skeleton, refresh — and was intentionally left alone, recorded in the PR); inline validation (red border + message, disabled Save) on the Health metric-log sheet; `app/workout-mockup/` + legacy `components/chat-overlay.tsx` deleted after verifying zero references (`app/overview`/`overview-screen.tsx` kept — `/sheet/[id]/overview` still redirects there); `session-select-content.tsx` (1617→1410 lines) and `health-content.tsx` (1206→~1100 lines) both pure-move split. Note: per-tab `loading.tsx` files, the `config-screen.tsx`/`health-sections.tsx`/`program-editor-sheet.tsx` splits, and the profile/goal form validation were out of scope for this pass. Also found in flight: `app/stats/stats-content.tsx` is dead code (`/stats` now redirects to `/health?tab=training`, nothing imports the component) — flagged as a follow-up rather than expanding this batch.

---

## Batch H — Animations & carousel navigation

**Touches:** new `components/ui/swipe-carousel.tsx`, `health-content.tsx`, `workout-select-content.tsx`, shell layout + `bottom-nav.tsx`, `nutrition-content.tsx`, `globals.css`.

### H1 — `UPLIFT` HIGH — Extract `<SwipeCarousel>` from the Health tab — ✅ shipped (2026-07-04, `feat/swipe-navigation`)
New `components/ui/swipe-carousel.tsx` (`<SwipeCarousel index onIndexChange children>`) built on `@use-gesture`'s `useDrag`, with the pure edge-resistance/commit-threshold math split into `swipe-carousel-math.ts` (vitest can't parse JSX in `.tsx` files without `@vitejs/plugin-react`, which isn't installed — this was the first test in the repo to import a `.tsx` component, surfacing the gap; extracting the math avoided adding a new build dependency for one test file). `health-content.tsx`'s inline touch-listener carousel (`dragX`/`isDragging`/`lockedRef`/`carouselRef` state + manual `touchstart`/`touchmove`/`touchend`) replaced with `<SwipeCarousel>`, behavior-identical. `workout-select-content.tsx`'s hand-rolled vertical swipe was **not** consolidated (Batch H's own Task 9, explicitly marked optional/skippable and touching the highest-regression-risk screen — deferred as its own follow-up, matching the pattern already used for `ActiveWorkoutScreen`'s self-tick).

### H2 — `FEAT` MED — Edge-swipe between the 5 bottom-nav tabs — ✅ shipped (2026-07-04, `feat/swipe-navigation`)
New `components/shell/tabs.ts` (hoisted `TABS` + `activeTabIndex`) and `components/shell/tab-swipe-navigator.tsx` — a document-level touch listener mounted once in `app/layout.tsx` (not per-page, since `BottomNav` itself mounts per-page but the edge-swipe gesture needs exactly one global listener) that maps edge-originating swipes to `router.push` wrapped in `document.startViewTransition` with directional slide CSS (`vt-slide-in-right`/`vt-slide-in-left`/`vt-fade-out` keyframes in `globals.css`), feature-detected with a plain-push fallback. Reuses the existing `isWorkoutActive()` helper (not a duplicated inline check) for the same mid-workout guard `bottom-nav.tsx` taps already respect. Yields to inner carousels via the shared `data-swipe-carousel` attribute.

### H3 — `UPLIFT` MED — Apply the carousel within single routes — ✅ shipped (2026-07-04, `feat/swipe-navigation`)
Nutrition date switcher: swipe anywhere in the scrollable content area changes date (`useDrag` + `AnimatePresence`/`motion.div` directional slide scoped to just the date-dependent content — MacroRing + meal cards — not the whole scrollable area, so Saved Meals/Chat/WeeklyChart/Supplements below don't re-animate on every date change). Calendar month nav: swipe on the day grid calls the existing `goBack`/`goForward` handlers. Health metric detail sheets (swipe between Readiness/Sleep/Activity/HR) remains deliberately out of scope per the plan's own self-review (each sheet fetches its own data on open; needs a prefetch design, deferred until Batch F's `HealthScoreDetail` dedup work).

### H4 — `UPLIFT` MED — Motion polish & reduced-motion completeness — ✅ shipped (2026-07-04, `feat/swipe-navigation`)
`app/layout.tsx` now wraps the tree in `<MotionConfig reducedMotion="user">`, covering every `motion` component app-wide. `timer-ring.tsx`'s SVG `<animate>` pulse and `set-card.tsx`'s `.border-run` set-timer border both now freeze under `prefers-reduced-motion` (state stays visible, motion stops — not hidden). `lib/hooks/use-count-up.ts` (`useCountUp`, tested `easeOutCubicValue` helper) applied to `readiness-card.tsx`'s score and `done-screen.tsx`'s volume stat — two call sites only, per the plan's own scope note. `meal-card.tsx`'s logged-item rows now animate in/out via `AnimatePresence`. Verified `workout-select-content.tsx:284`'s `popLayout` usage already animates only `opacity`/`y` (transform) — no change needed. Chart draw-in intentionally left disabled where already off for the cache-seed instant-paint fix (unchanged, not re-enabled).

### H5 — Perceived-performance & haptics sweep (2026-07-02 audit, session 178 — beyond H1–H4)

**Plan:** [h5-perceived-performance-haptics](../superpowers/plans/archive/2026-07-02-h5-perceived-performance-haptics.md) (2 chunks).

Priority order by UX ÷ effort:
1. ✅ shipped (2026-07-04, `feat/haptics-sweep`, chunk 1) — **Haptics coverage.** `hapticLight`/`hapticSuccess` now fire in `pull-to-sync.tsx` (light on crossing the `ready` threshold, success right before the indicator dismisses), `food-logger-sheet.tsx`/`meal-backfill-section.tsx` (food-log save), `mood-checkin-sheet.tsx` (check-in save), `exercise-summary-screen.tsx` (new-PR badge, via `hapticSuccess` in a `useEffect` gated on `isNewPR`), and `bottom-nav.tsx` (every tab tap). Achievement-unlock: no live toast/celebration moment exists in the codebase to wire into (achievements only render as a passive list in Profile/More) — only the PR-unlock half of this line item applies.
2. ✅ shipped (2026-07-04, `feat/haptics-sweep-chunk2`, chunk 2) — **Tap-driven page transitions.** New `lib/navigate-with-transition.ts` extracts `TabSwipeNavigator`'s wrap-in-`startViewTransition` logic into a shared `navigateWithTransition(router, fromPathname, href)` helper, computing direction from the tab order so a tap and an edge-swipe to the same destination feel identical. Applied to `bottom-nav.tsx` taps (and the leave-workout-dialog's confirm push), the home-card "tap to jump to a sibling tab" navigations (`home-card-widget.tsx`'s 7 `router.push` sites), and `overview-screen.tsx`'s two navigations. Deliberately left as plain `router.push`: profile/social-feed navigation, post-action redirects, deep links, and other one-off pushes that don't navigate between the 5 main tabs (no coherent forward/back direction to slide).
3. ✅ shipped (2026-07-04, `feat/haptics-sweep`, chunk 1) — **Collapsible layout animation.** `app/globals.css` now animates `[data-slot="collapsible-content"]` open/close via `--radix-collapsible-content-height` + two keyframes — upgrades every `Collapsible` site at once, no per-site changes.
4. ✅ shipped (2026-07-04, `feat/haptics-sweep`, chunk 1) — **Samsung-WebView animation hazards.** `macro-ring.tsx`'s SVG `stroke-dashoffset` ring replaced with a `conic-gradient` + radial-gradient mask (two layered divs: track + progress arc). All 7 `width`-transition bars (`home-card-widget.tsx` ×4, `macro-ring.tsx`'s `MacroBar`, `day-summary-card.tsx`, `assign-step.tsx`) converted to `transform: scaleX()` with `transform-origin: left`.
5. ✅ shipped (2026-07-04, `feat/haptics-sweep-chunk2`, chunk 2) — **Skeleton→content fade-in** + **in-screen tab-panel crossfades.** New `.content-fade-in` CSS utility applied to Home's section list and Health's day-overlay detail sheet (Nutrition's equivalent swap already fades in via the swipe-navigation batch's `AnimatePresence` wrapper — no double treatment needed). New `<TabPanels>` primitive (pairs with `<SegmentedTabs>`) adopted at `friends-tab.tsx`'s Activity/Leaderboard switch — the other 4 `SegmentedTabs` sites don't fit the "swap between distinct panels" shape it assumes (`more-content.tsx` keeps all 3 tabs mounted via `display:none` for state preservation; `food-logger-sheet.tsx`'s tabs are a linear wizard stepper; `friend-leaderboard.tsx`'s two `SegmentedTabs` are independent filter/sort controls over one continuously-rendered list; `health-content.tsx`'s tab content already transitions via `SwipeCarousel`).
6. ✅ shipped (2026-07-04, `feat/haptics-sweep`, chunk 1) — **Compositor & reduced-motion leftovers.** `muscle-recovery-card.tsx`'s `ta-marquee` now has `content-visibility: auto` (+ a `contain-intrinsic-size` hint) so the browser skips painting/animating it while off-screen. `shimmer-sweep`, `pr-pulse`, `xp-pop` (given stable classNames to hook into: `.pr-pulse-badge`, `.xp-pop-badge`) and all 7 converted progress bars (`motion-reduce:transition-none`) now fully respect `prefers-reduced-motion`.
7. ✅ shipped (2026-07-04, `feat/haptics-sweep-chunk2`, chunk 2), with one deliberate gap — **Count-up beyond H4's two sites.** Applied to `health-score-detail.tsx`'s `ScoreDisplay` (detail-hero scores) and `weekly-stats-hub.tsx`'s Sessions/Sets stat cards. **Not applied to `home-card-widget.tsx`'s stat tiles**: each widget is a `switch`-case branch with an early `return null` before its value is computed — `useCountUp`, like any hook, can't be called after a branch that might skip it, and hoisting every widget's raw value above the switch just to call the hook would duplicate the per-widget derivation logic the switch exists to keep scoped. Needs a different pattern (e.g. a small per-widget wrapper component) rather than a drop-in hook call — left as a future follow-up.

---

## Batch I — Workout & nutrition UX features (carried from v1 Batch 8, all verified open)

**Touches:** `components/workout-screen.tsx` + `active-workout-screen.tsx`, `session_exercises` schema, `lib/nutrition/goal-recommendation.ts`, share-card infra.

- **`FEAT` M — Injury-aware exercise substitution (live, in-workout).** The injury banner warns but offers no alternative; reuse the builder's same-muscle/equipment candidate filter (`builder-review.tsx` `getAlternatives`) as an on-the-spot swap sheet. Deterministic and injury-triggered — distinct from the dropped AI exercise-swap.
- **`FEAT` M — Dynamic TDEE adaptation from weight trend.** Calorie target auto-nudges (user accepts) when the 14-day weight trend diverges from goal. Builds on `lib/nutrition/goal-recommendation.ts` + `body_metrics`.
- **`FEAT` M–L — Supersets / circuit support.** `group` field on `session_exercises` (migration) + builder UI + workout-flow alternation with shared rest. Heaviest item — touches the orchestrator.
- **`FEAT` M–L — Year-in-review / "Wrapped."** Lifetime stats + PRs as a shareable animated page; reuses the done-screen share-image infra.
- *(Plate calculator moved to Quick Wins.)*

---

## Batch L — Per-screen wallpapers & visual identity (user request, 2026-07-02)

**Plan:** [batch-l-wallpapers](../superpowers/plans/2026-07-02-batch-l-wallpapers.md) (3 chunks).

**Goal:** every screen gets a unique background/wallpaper; the Home screen keeps the existing **dynamic** (time-of-day + weather) wallpaper for now. **Hard constraint: the background must never obscure foreground text — in both dark AND light mode.**

**This is an extension, not a greenfield build.** A dynamic wallpaper system already ships: `components/dynamic-background/dynamic-background.tsx` (mounted globally in `app/layout.tsx:99`, single `fixed inset-0 z-[-1]` compositor layer — sky gradient + celestial arc + weather particles + a black readability `ScrimLayer`), section-keyed by `pathnameToSection` (5 buckets: home/health/workout/nutrition/more), user-toggled per section via `components/profile/dynamic-background-settings.tsx` (Zustand `ta_background_settings`, localStorage). The four health detail pages separately ship static themed art via `DetailHero` (`components/health/detail-hero.tsx`: theme gradient + SVG scene + a bottom-anchored black scrim `rgba(0,0,0,.92)→transparent` that guarantees contrast where the score text sits).

### L1 — `FEAT` MED — Per-screen wallpaper keys — ⚙️ chunk 2 shipped (2026-07-04), chunk 3 remains
Home and Workout keep the shared time-of-day/weather sky scene unchanged. Health (list view), Nutrition, and More/Profile now render a static per-screen CSS-gradient palette (`lib/background/screen-palettes.ts`, `{dark, light}` variants, `components/dynamic-background/screen-palette-layer.tsx`) instead of the shared sky scene — `dynamic-background.tsx` branches on section to pick sky-vs-palette rendering, and skips the weather fetch entirely for palette sections. `pathnameToSection` also now excludes the 4 DetailHero routes outright (returns `null`, so `DynamicBackground` doesn't mount at all there — previously it silently computed the sky/weather scene underneath their own opaque art). Kept the existing 5-key `Record<BackgroundSection, boolean>` store shape (no migration needed) rather than exploding into per-URL-route keys, since chunk 2's ship-list didn't call for finer granularity than the existing sections — settings-UI copy updated to describe which sections use weather vs a themed scene. **Remaining (chunk 3):** roll out palettes for the rest (stats, overview, timeline, workout-select, session-explain, admin/config), plus the real gate — on-device Samsung WebView verification.

### L2 — ✅ shipped (2026-07-04) — Text-legibility system (the non-negotiable)
- Reuse the two proven mechanisms: the global `ScrimLayer` and DetailHero's bottom-anchored gradient scrim. Every wallpaper renders **behind a scrim tuned so body text keeps ≥4.5:1 contrast**; cards keep their own `--card` surface so content never sits raw on art.
- **Light mode fixed** (per user direction: dark mode is the reference design, light mode is a supported *lighter variant of the same palette*, not separately-illustrated art). `detail-hero.tsx` gained `useHeroColorScheme()` (reads `next-themes`' `resolvedTheme`, defaults to dark until mounted) driving: `{dark, light}` `HERO_GRADIENTS`/`PAGE_GRADIENTS` per theme (lightened/pastel versions of each hue, e.g. sleep's deep navy → soft lavender), a white-based scrim in light mode (was hardcoded black), dark neutral text instead of `text-white`, and the SVG decorations (stars, sun, mountains — dark-first illustrations) dimmed to 0.4 opacity in light mode rather than recolored, so they read as a subtle watermark instead of vanishing/looking broken against a lighter sky. Verified via Playwright screenshots (`colorScheme: 'light'` context) across all 4 hero themes plus the End of Day review sheet (a 5th consumer of `PAGE_GRADIENTS.sleep`) — all legible, no contrast regressions in dark mode.

### L3 — ✅ shipped (2026-07-04) — Opaque-root cleanup (wallpapers silently hidden today)
Only `bg-page`-rooted screens reveal the fixed layer (`--page-bg: transparent` is set by the orchestrator, `dynamic-background.tsx:80-89`). Screens rooted in opaque `bg-background` — stats, overview, timeline, session-explain, admin, profile — now use `bg-page` to participate (verified in both wallpaper-on and wallpaper-off states via Playwright; falls back to the identical opaque `var(--background)` when the wallpaper is disabled, so no regression for the default-off state). Auth pages (sign-in/register) deliberately **not** converted — they already render a `<Meteors>` decorative particle background inside the same root, and stacking the fixed wallpaper layer behind it would compete visually with no current mechanism to suppress `DynamicBackground` pre-login. DetailHero conflict resolved as recommended: the 4 health detail pages keep their bespoke `PAGE_GRADIENTS` art, decision recorded in `pathnameToSection`.

### L4 — Constraints & gotchas (carry into the plan)
- **Samsung WebView SVG-compositor risk** (CLAUDE.md): per-screen SVG art sits behind card grids — exactly the class that wipes sibling gradients. Prefer CSS gradients/`conic-gradient` over complex SVG; `willChange: 'transform'` promotion where needed; **verify on the APK, not Chrome**.
- ~~Active in-progress workout stays `bg-black` (`workout-screen.tsx:905`)~~ — **correction (2026-07-04):** re-verified against current code; the active-workout main screen is already `bg-page` (participates in the wallpaper), and has been for a while — this line was stale. The actual opaque-black exception is the floating PiP system overlay (`components/workout/pip-view.tsx` + the PiP branch in `workout-screen.tsx`), a small always-black Android window, unrelated to the full-screen wallpaper concern.
- **No raster image assets**: keep the zero-download CSS/SVG approach; a raster wallpaper would be the project's first background image (decode + memory cost on a 6.9" screen).
- Preserve the `--page-bg` set/teardown effect on navigation; settings stay localStorage (no DB column) consistent with theme/brand handling.
- `prefers-reduced-motion` already gates the weather particles — keep new scenes static or gated the same way.

---

## Batch J — Process & enforcement (from the sessions-1–176 recurring-bug review, 2026-07-02)

**Touches:** `.github/workflows/ci.yml`, `public/sw.js`, `docs/`. **Plan:** [batch-j-process-enforcement](../superpowers/plans/2026-07-02-batch-j-process-enforcement.md) (5 chunks, each its own PR).

### J1 — ✅ shipped (PR #154) — Extend the Custom Rules CI job to enforce the codified CLAUDE.md rules

The Custom Rules job enforces exactly two rules today (UTC date slicing, hardcoded PPL names) — and those two classes stopped recurring once enforced. Most of the rules codified in CLAUDE.md from the recurring-bug review are greppable and should regress-proof the same way:

- Bare `fetch('/api` in `components/`/`app/` client files (must be `cachedFetch`) — allowlist the few legitimate non-GET call sites.
- `invalidateCache(` with an inline key/array literal outside `lib/cache-groups.ts` (writes must go through group helpers).
- Nested `<button` inside a `button`/`role="button"` ancestor (WebView strips it) — a simple two-line-window grep catches the common copy-paste form.
- `pt-safe` combined with another `pt-*` class in the same `className` (later class wins, inset lost); plus: every `pt-safe*`/`pb-safe*` class referenced anywhere must be defined in `globals.css` (`.pt-safe-or-4` was referenced-but-undefined for a whole release).
- `JSON.parse` within AI route files (`app/api/ai/`, `app/api/*/generate*`) — structured output must use `generateObject`/a response schema.
- `PRAGMA` inside the `statements` arrays of `lib/sqlite/migrations.ts` (rejected inside the plugin's upgrade transaction).
- New local-SQLite migration adds a table/column not registered in `RECONCILE_TABLES`/`RECONCILE_COLUMNS` (parse both lists and diff — this one is the highest-value check of the set).
- **Duplicate Postgres migration numbers** (added 2026-07-02): the tree already carries two collided pairs (`081_exercise_library_expand` + `081_exercise_media`; `087_composite_indexes` + `087_oura_webhook_fields`) and `migrate.js` applies in filename sort order, so a collision makes apply order ambiguous — a one-line `ls | cut -d_ -f1 | sort | uniq -d` check prevents the next one.

Each check is a self-contained grep step in `ci.yml` with an explanatory failure message pointing at the CLAUDE.md section. Ship incrementally — one PR can add the first three; false-positive allowlists live inline like the existing PPL check.

**Shipped:** PRAGMA-in-migrations, `pt-safe` double-stacking, undefined safe-area classes, nested button-in-role-button, AI-route `JSON.parse` (zero-hit — Batch E's `generateObject` migration already covers it), and `RECONCILE_TABLES`/`RECONCILE_COLUMNS` completeness (`scripts/check-reconcile.js`). **Still open** (real stragglers exist, would fail immediately if enforced): bare `fetch('/api` (73 hits, blocked on B2), `invalidateCache(` inline lists (~30 hits, blocked on a fuller B1 cache-group migration — found a live `invalidateCache('')` full-cache nuke in `more-content.tsx` worth a dedicated fix), and the duplicate-migration-number check (081/087 are still collided today — fixing requires renaming already-applied production migration files, too risky to do as a side effect of a CI-rule PR; needs its own careful migration-renumber plan).

### J2 — ✅ shipped (PR #155) — Device smoke-test checklist doc

The single biggest theme across all 176 sessions is bugs invisible in the sandbox (native SQLite, safe-area insets, Samsung WebView rendering, real Oura data, drifted prod rows). Write `docs/device-smoke-checklist.md`: a one-page, ~5-minute pass to run on the S25 after any APK-affecting merge — safe-area on new/changed screens (status bar + gesture bar), offline write→kill app→reopen round-trip, pull-to-sync doesn't swallow scroll, `[initSQLite]` clean in console, notification timing, SVG/gradient rendering on new cards. Link it from CLAUDE.md's Communication section so "awaiting on-device check" items reference concrete steps instead of ad-hoc lists per session.

### J3 — ✅ shipped (PR #156) — Build-hash service-worker cache names

`public/sw.js` uses a manually-versioned cache name (`ta-vN`); a forgotten bump has shipped invisible changes twice (sessions 55, 74). Derive the cache name from the build id (inject `NEXT_PUBLIC_BUILD_ID`/git SHA at build time) so every deploy invalidates automatically, and delete the manual-bump step from the deploy ritual. Shipped via a Route Handler (`app/sw.js/route.ts`) reading `RAILWAY_GIT_COMMIT_SHA` at request time instead of a build-step file rewrite.

---

## Batch K — User-requested UI/bug-fix batch (2026-07-02)

**Touches:** `components/home-day-timeline.tsx`, `app/health/timeline/page.tsx`, `app/health/activity/activity-content.tsx`, `app/api/user/bedtime-estimate/route.ts`, `lib/meal-reminders.ts`, `lib/types/day-checkin.ts`, `components/nutrition/end-of-day/{scale-selector,wellness-section,end-of-day-review}.tsx`. Five small, independent items called out directly from screenshots of the Home timeline, Activity page, and End of Day review sheet. **Executable plan:** [UI bug fixes — timeline, activity ring, End of Day review](../superpowers/plans/2026-07-02-ui-bugfixes-activity-eod-review.md).

- **`FIX` LOW — Remove exercise names from workout timeline cards** (Home + full Timeline page) — redundant with the existing duration/sets/exercise-count line.
- **`UPLIFT` LOW — Activity ring shows the training-boost segment.** The "+N training" callout banner already exists as text below the ring; add a second brand-colored arc segment on the ring itself for the boosted portion.
- **`FIX` MED — End of Day reminder fires ~60 min before bedtime instead of the documented 30.** `scheduleEndOfDayReminder` (`lib/meal-reminders.ts`) rounds to `bedtimeHour - 1` at `:00`; `GET /api/user/bedtime-estimate` only returns an hour. Add minute precision and subtract exactly 30 minutes.
- **`UPLIFT` LOW — Colored, benchmarked slider for the End of Day 1–5 wellness scales.** Replace the plain black/white toggle buttons (`scale-selector.tsx`) with the same filled-progress "slider" look already used by `RpeSlider`/`GoalSpectrum`, one theme color per scale (blue for hydration, etc.).
- **`UPLIFT` LOW — Themed background on the End of Day sheet.** Reuse `PAGE_GRADIENTS.sleep` (already defined in `components/health/detail-hero.tsx`) instead of a flat `bg-secondary` panel.

**Acceptance:** see the linked plan's acceptance section.

---

## Batch M — Per-exercise deload (2026-07-02) — ⚠️ NOT LANDED (re-queued 2026-07-03)

> Verified 2026-07-03: the parallel agent session implementing blocks 1→4 left **no branch, PR, or code on origin** — `per-exercise-deload.ts`/`deload-constants.ts` don't exist on main and the pre-workout screen has no per-exercise chip. Re-queued in `docs/implementation-backlog.md` (entry 3); the standard dedup check applies if a Batch M branch surfaces later.

**Touches:** `lib/ai-periodization/{per-exercise-deload,deload-constants,prompt}.ts`, `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`, `lib/types/ai-periodization.ts`, `lib/workout/log-exercise.ts`, `app/api/workout-data/route.ts`, `lib/stores/workout-store.ts`, `components/workout/{pre-workout-screen,deload-info-sheet,ai-prescription-card,utils}.tsx|ts`, `components/workout-screen.tsx`. No DB migration.

Muscle-specific soreness currently forces an all-or-nothing rest/swap recommendation even when most of the session trains recovered muscles. This batch deloads **just the affected exercises** (mood-log soreness, main-role muscle matches, deterministic ≤50% rule), escalates to a whole-session deload **offer** when soreness covers more than half the session, keeps deloaded sets out of `personal_records`, and gives each deloaded exercise an amber chip + "Use full weights" revert on the pre-workout screen.

**Spec:** [Per-exercise deload — design](../superpowers/specs/2026-07-02-per-exercise-deload-design.md). **Executable plans (implement in order):**

1. [Block 1 — engine module + shared deload constants](../superpowers/plans/2026-07-02-per-exercise-deload-block-1-engine.md)
2. [Block 2 — prescribe route integration](../superpowers/plans/2026-07-02-per-exercise-deload-block-2-route.md)
3. [Block 3 — PR gate + log payload](../superpowers/plans/2026-07-02-per-exercise-deload-block-3-pr-gate.md)
4. [Block 4 — UI chip, revert sheet, payload wiring](../superpowers/plans/2026-07-02-per-exercise-deload-block-4-ui.md)

**Acceptance:** see each block plan's test/verification steps; Block 4 Task 6 holds the full-flow runtime checklist and the version/changelog bump.

---

## 2026-07-03 backlog review (session 184) — status re-verification + new findings

Four parallel audits against `main` v1.85.0: full open-item re-verification · recent-code audit (PRs #101–#131) · mechanical rule sweep · platform/ops + feature-opportunity scan. Ready-to-implement work is queued in [`docs/implementation-backlog.md`](../implementation-backlog.md).

### Status corrections
- **Shipped but unticked:** A6 (LWW `updatedAt` gating), A7 (log-exercise replay idempotency), the B5 1 Hz-interval extraction — all ticked above.
- **Class closed:** zero `JSON.parse` of LLM output remains anywhere in `app/api` (was 5 pre-Batch E). Also now fully clean: UTC-date slicing, PRAGMA-in-migrations, nested buttons, `RECONCILE_TABLES` registration (all 26 local tables present), orchestrator `setInterval`s, `console.log` in components.
- **Batch M never landed** — the parallel session left nothing on origin. Re-queued (backlog entry 3).
- **Never queued despite existing plans:** `2026-07-02-safe-area-system.md` and `2026-07-02-dependency-audit-cleanup.md` were orphans — now backlog entries 7 and 9.
- **Fully open, re-verified:** B5 save-latency items (legacy home seeds, DoneScreen Oura await on mount, serial food-item POSTs), B6 (nutrition-write invalidation, 90-day `exercise-history` scan, `listUsers()` pending-count), E6 cron, F6 (no tier), all of G/H/I/J/K/L, F5's two residuals (year heatmap, `chartjs-plugin-annotation`).

### R — New correctness findings (plan: [2026-07-03 review quick fixes](../superpowers/plans/2026-07-03-review-quick-fixes.md), backlog entry 2)
- `FIX` MED — **No cache group invalidates `health-trends:*`** — the F4 Trends card reads `health-trends:<view>` but no helper in `lib/cache-groups.ts` clears the prefix, and the done-screen session-RPE tap fires no invalidation at all; RPE taps / morning check-ins / completed workouts leave the trends stale until TTL.
- `FIX` LOW — **`pushMutations` doesn't mirror web-route validation for `session_rpe`/`day_checkins`** (`adapter.ts:2646-2664,2834-2839`) — no 1–10 / 1–5 clamp; a corrupted outbox payload (e.g. `sessionRpe: 42`) writes through and skews the Foster load trend.
- `UPLIFT` LOW — **`health-trends` has no rate limit** despite loading 90-day session trees per hit on 2 of 5 views.
- `FIX` LOW — **Two `readCacheSync`-in-`useState`-lazy-initializer sites** (`trends-section.tsx:47` — new in F4; `home-day-timeline.tsx:212` — the known session-182 issue): the banned hydration-mismatch pattern.
- `FIX` LOW — **`invalidateCache('')` full-cache nuke** at `health-content.tsx:527` — one health refresh drops every warmed key app-wide.
- `UPLIFT` LOW — `health-trends`' `recovery-vs-strength` computes its own 28-day HRV/RHR baseline while `readiness-score` derives `baselineHrv`/`recentHrv` separately — second definition of the same metric (one-formula-one-place smell); share a helper when next touched.
- Otherwise the recent code (F1–F5, session-RPE offline chain, workout guards, morning-checkin race guard, timezone use, SWR headers) audited **clean** — the sync chain for `session_rpe`/morning check-ins is complete and guarded end-to-end.

### Rule-sweep deltas (re-prioritizes J1)
- **Regressed since last audit:** hex literals 455 → **484** (worst: `detail-hero.tsx` 41); emoji in JSX now **36 files** (~145 matches); chevron toggles without `aria-expanded` ~18 → **~21** (exactly 1 `aria-expanded` app-wide).
- **Stalled known issues:** `readiness-score` still fetched with 3 TTLs / `muscle-recovery` with 2 (only mixed-TTL keys left — quick-fixes Task 5); duplicate migration pairs 081/087 unchanged; `style-editor-sheet.tsx:67` `key={i}` unchanged.
- **Structural (gate growth, don't backfill):** 167 bare `fetch('/api` sites; nutrition invalidation hand-rolled in 17 files; 6 components still >800 lines (unchanged set).
- **J1 consequence:** the six now-clean classes can be locked into CI at zero remediation cost — highest-ROI first PR of Batch J (backlog entry 8).

### N — Platform & ops — 📝 planned 2026-07-03 (session 184 continued)
**Plan:** [batch-n-platform-ops](../superpowers/plans/2026-07-03-batch-n-platform-ops.md) (3 chunks) · backlog entry **17** (bottom of queue per user direction — low priority, for later) · claims migration **109**.
The eight-dimension reviews under-weighted ops. For a single user with years of irreplaceable data:
- `FIX` HIGH/M — **No error tracking/observability.** No Sentry/equivalent anywhere; prod 500s and WebView crashes are invisible unless the user notices. Lightweight client + API-route capture (Sentry or self-hosted GlitchTip).
- `UPLIFT` HIGH/M — **No data export/takeout.** No CSV/JSON export route exists for workout history/biometrics — the dataset is locked in one Railway Postgres. One streaming takeout route is cheap insurance.
- `FIX` MED/M — **No account recovery.** No forgot/reset flow (`app/api/auth/` has none); a lost credential + revoked Google grant = permanent lockout.
- `UPLIFT` MED/S — **Wire or delete the dead web-push infra.** `lib/push.ts` `sendPushToUser` is fully built (VAPID, 410 cleanup, `push_subscriptions` migration 098) with **zero callers**; pairs with E6's cron enabler, or serves non-AI triggers (PR celebrations, sync-failure alerts) today.
- `UPLIFT` MED/M — **No APK update prompt.** `@capacitor/app` is installed; compare `App.getInfo().version` to a version endpoint and banner "update available" — sideloaded APKs currently run stale code indefinitely (the sw.js bump only covers the web layer).
- `UPLIFT` MED/S — **No healthcheck endpoint** for external uptime monitoring — a DB-pinging `GET /api/status` would catch pool exhaustion (the session-165 class) before the user does.
- `UPLIFT` MED/S — **`oura_heartrate` grows unbounded** (per-minute rows, no retention); copy the `rate_limits` opportunistic-cleanup pattern (`lib/rate-limit.ts:63`) or downsample old rows.
- `UPLIFT` MED/S — **No DB backup/restore runbook** — document Railway snapshot state + a scheduled `pg_dump` (S3 SDK already a dependency via exercise media).
- `UPLIFT` MED-HIGH/M — **Zero tests on the most incident-prone surfaces**: `lib/data/postgres/adapter.ts` (incl. `pushMutations` — 3 production data-loss incidents), `lib/workout/log-exercise.ts`, `lib/local-store/index.ts`, `lib/push.ts`. A pg-backed web-route ↔ `pushMutations` **parity test** would regression-proof the drift class CLAUDE.md calls out explicitly.

### O — Feature candidates — 📝 phase 1 planned 2026-07-03 (session 184 continued)
**Plan (phase 1 — post-session recap, rest-day guidance, body measurements):** [batch-o-features-phase-1](../superpowers/plans/2026-07-03-batch-o-features-phase-1.md) · backlog entry **18** (bottom of queue per user direction) · claims migration **110**. The user delegated selection; the remaining three candidates below (photos, warm-up customization, voice logging, mesocycle retrospective) stay unplanned until asked for.
All grounded in data/plumbing that already exists; none overlap batches A–M:
- **Body measurements + progress photos** (M) — no circumference fields or photo storage exist; S3 upload plumbing already ships (`lib/exercise-storage.ts`, avatar route).
- **Rest-day active-recovery guidance** (M) — readiness/muscle-recovery engines exist but rest days get zero guidance ("readiness 82 → optional zone-2" vs "61 → true rest"). Distinct from Batch M (training-day, per-exercise).
- **Post-session AI recap note** (M) — narrative done-screen recap from data fully captured (`set_logs.rpe/restTimeSec/setStartMs`, `timeToComplete`, F3's `session_rpe`); `session-explain` only covers the *upcoming* session.
- **Warm-up protocol customization** (S) — warmup ramping is hardcoded; barbell squat vs cable movement want different ramps.
- **Voice logging** (L) — "100 kg for 5 at RPE 8" hands-free capture into the existing log paths; gym-floor ergonomics win, but the heaviest item here.
- **Mesocycle retrospective** (M) — block-level review (phase-by-phase volume/intensity, which lifts stalled, did AI prescriptions move 1RMs) from `session_periodization` + `program_phases` + `personal_records`; weekly digest (E2) stops at week granularity.

---

## Suggested execution order

1. **Quick wins PR** (table above) — the two worst data-loss fixes, the deload bug, webhook fail-close, indexes, lazy AI chat, AI caching + rate limits, plate calculator.
2. **Batch A** (offline-first integrity) — outbox id protocol + dead-letter + sync-health UI + applyDelta guards; then A8 throughput. *Directly targets the recurring data-saving issues; needs device verification.*
3. **Batch B** (caching/perf) — invalidation groups first (B1), then the uncached-site matrix (B2), then bundle/render (B3). **B5's save-latency fixes (legacy home seeds, DoneScreen Oura await, food-item batching) are the most user-visible items in the batch — do them with or before B2.** **B6 (2026-07-02 follow-up audit): the food-log invalidation gap and the unbounded `exercise-history` query are the two HIGH items — fold them into the B5 save-latency PR or ship as a small standalone PR first.**
4. **Batch C** (engine logic) — C2/C3/C4 as one "shared 1RM estimator" PR with tests; C1/C5–C9 as a periodization-correctness PR.
5. **Batch D** (security) — D1/D2 first, then cost controls.
6. **Batch E** (AI) — E1+E2 (structured output + caching) then E3 (chat context/tools), E6 (cron enabler).
7. **Batch F** — F1 morning check-in (pairs with E6's briefing push), F2 tags sync, F3/F4 trends.
8. **Batch G/H** (UI system + carousel) — G1/H1 primitives first, then H2 edge-swipe, then the polish/a11y sweeps. **H5's haptics sweep is a standalone S-effort PR that can ship any time.**
9. **Batch J** (process & enforcement) — J1 (CI rule enforcement) can ship any time and pays off immediately; J2/J3 whenever convenient. J1's first three checks are a good filler PR between batches.
10. **Batch K** (user-requested UI/bug fixes) — fully independent of the batches above; ship any time, e.g. as a filler PR between batches.
11. **Batch L** (per-screen wallpapers) — L2's legibility/light-mode system and L3's opaque-root cleanup come first; then per-screen art incrementally (a screen per PR is fine). Home keeps the dynamic wallpaper.
12. **Batch M** (per-exercise deload) — 🚧 already being implemented in a parallel agent session (blocks 1→4 in order); don't double-start it from here.

Batches are sized so each is one focused plan + PR (or 2–3 for A and C). Write the detailed per-batch plan into `docs/superpowers/plans/` before starting each, per the standing workflow.
