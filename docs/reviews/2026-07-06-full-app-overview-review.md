# Full App Overview Review — 2026-07-06

> **Scope:** a full nine-dimension audit of the app requested ahead of the full-APK /
> native-BLE direction: caching & invalidation, offline sync & outbox, performance &
> data trips, UI (safe-area/theme/a11y), security & AI routes, dates/timezones &
> formula duplication, workouts domain, nutrition domain, and APK/BLE future-readiness.
> Every finding below was **verified by reading the actual code** at the cited
> `file:line`. Findings already tracked in `projectOverview.md` Known Issues or the
> backlog were deduped out (a few are noted as "tracked — status confirmed").
>
> **Method:** nine parallel review agents, one per dimension, each grounded in the
> relevant CLAUDE.md rule sections, followed by cross-dimension synthesis. Static
> code audit only — **not exercised:** on-device APK/WebView behaviour, native
> SQLite/Capacitor paths, real Oura tokens, prod-data drift, runtime profiling,
> bundle-size measurement. Several offline-first findings are APK-only failure
> surfaces the web sandbox cannot reproduce.
>
> **How to consume this doc:** each § below ends in a proposed **plan batch** (R1–R8
> plus Tracks A/B). Planning sessions should turn batches into
> `docs/superpowers/plans/` docs + backlog queue entries per the backlog protocol.
> The pointer entries live in `docs/implementation-backlog.md` § "Not yet queued".

---

## Executive summary — top findings by impact

| # | Finding | Where | Batch |
|---|---------|-------|-------|
| 1 | **Ownership bug class:** user-scoped UPDATE with unverified rowcount followed by unscoped child delete/insert — progression styles, saved meals; plus client-supplied exercise/set-log ids upserted with no ownership join | SEC-1..3 | R1 |
| 2 | **Mass assignment:** raw request bodies passed to Drizzle `.set()` — supplements PATCH (`userId` settable!), meal-types PUT | SEC-6 | R1 |
| 3 | **Deleted workouts resurrect on the device** — hard DELETE with no tombstone and no local-store mirror; local rows render forever | SYNC-C1 | R3 |
| 4 | **`progress-summary` fetched with both `cachedFetch` and `cachedFetchToday`** — the two payload shapes clobber each other (weekly-stats-crash class) | CACHE-F1 | R2 |
| 5 | **Quick-edit food sheet saves a stale quantity** (no `key`, state never re-syncs) — silent data corruption | NUT-1 | R5 |
| 6 | **Single-exercise workouts can silently lose completion** — `advance()` stale closure calls `completeWorkout` with a pre-start `workoutSessionId` | WK-1 | R4 |
| 7 | **Offline food logging of any new/scanned item fails entirely** — food-item creation is an unconditional online POST in front of the outbox | SYNC-O2 | R3 |
| 8 | **Home metric tiles read server-first** while the same file writes body metrics locally — offline saves vanish from Home on remount | SYNC-R1 | R3 |
| 9 | **Phase-set edits leave session cards hard-stale up to 6 h** (`freshWithinTtl` + wrong invalidation group) | CACHE-F3 | R2 |
| 10 | **chart.js leaked into the home bundle** via one missed dynamic import; "today" bar painted with a CSS var canvas can't resolve (renders black) | PERF-8 / UI-H1 | R6/R7 |
| 11 | **Supersets with unequal set counts orphan the longer exercise's remaining sets**; rest ring disagrees with the beep after a handoff | WK-2/3 | R4 |
| 12 | **Six AI-chat tools window on raw `Date.now() − N×86400000`** (session-62 class); one splits a single day across comparison buckets | DATE-A3 | R8 |
| 13 | **Bundled-shell blockers:** cross-origin cookie auth, relative `/api/*` everywhere, SW/push/update pipeline all assume the remote Railway origin | APK Track A | A |
| 14 | **BLE architectural inversion:** biometric tables are pull-only mirrors (no `sync_status`) — a device-local BLE write would be clobbered by the next pull; no source/provenance column → cloud-vs-BLE value flapping | APK Track B | B |
| 15 | **`user_stats` totals never decremented, never reconciled** — XP/achievements gate on an inflatable counter | SYNC-T1 | R3 |

**Verified clean across the board** (details per section): auth coverage on all 149 API
routes, SQL parameterization, JWT/session config, AI-route schema+rate-limit
discipline (zero `JSON.parse` of model text), poison-pill outbox handling, local
SQLite migration/reconcile registration (all 26 tables), migration-110 sync chain,
web read-fallback purity, safe-area utility definitions, Zustand persistence hygiene,
timer epoch-correctness, complete-workout idempotency, no hardcoded session names,
forbidden UTC-date patterns at zero, weekly-cadence/1RM/macro-palette consolidation,
and the canonical-runtime doctrine (no new web-only affordances since it landed).

**Status changes to already-tracked items** (verified this review):
- ✅ FIXED: `readiness-score` multi-TTL (all 4 sites use `READINESS_SCORE_TTL`).
- ✅ FIXED: legacy `ta_*` seed survival of `invalidateWorkoutSummaries` (now cleared; residual dead code — CACHE-F14).
- ✅ FIXED: `app/api/training-load`'s inline flat-÷4 ACWR copy is **gone** — the route now uses `computeVolumeAcwr`/`acwrBand`. CLAUDE.md's "retire it on touch" sentence is stale (updated in this PR).
- ✅ HANDLED: `health-trends` prefix-sibling (deliberately `-`-suffixed key).
- Confirmed still open: repo day-window helpers hardcode AEST (`adapter.ts:912,967`); `barcode: null` 400 on "+ Add as new food" (NUT-4, trivial fix identified); dual-path read fallbacks (tracked, fix-on-touch).

---

## §1 Security & ownership (Batch R1)

### Real vulnerabilities

- **SEC-1 (medium) — `saveProgressionStyle` delete-then-insert on unverified id.**
  `lib/data/postgres/slices/programs.ts:678-706`. The `progressionStyles` UPDATE is
  user-scoped but the affected-row count is never checked; `styleId = style.id` is
  used unconditionally, then `tx.delete(styleSets).where(eq(styleId))` (line 696, no
  user scope) + re-insert. A foreign style UUID gets its sets wiped and replaced.
  Reached via `POST /api/progression-styles` (un-Zod'd body). **Fix:** check
  `.returning()`/rowCount from the scoped UPDATE, throw on 0 rows (reference:
  `updateSupplement` `adapter.ts:3371-3378`).
- **SEC-2 (medium) — same class: `updateSavedMeal`.**
  `lib/data/postgres/slices/nutrition.ts:342-350` — scoped name UPDATE, unchecked,
  then unscoped `delete(savedMealItems)` + re-insert via
  `PUT /api/nutrition/saved-meals/[id]`. Same fix. (Also: no validation that
  `items[].foodItemId` belongs to the user — low; and `listSavedMeals` has no
  `ORDER BY` on items so ingredient order shuffles — low.)
- **SEC-3 (medium) — `logExerciseAndSets` upserts by client-supplied id with no
  ownership check.** `lib/data/postgres/adapter.ts:806-874` (+ `logSets`
  `:771-780`). `onConflictDoUpdate` on bare `exercise_logs.id` / `set_logs.id`
  with no `setWhere` and no pre-check; the SET even reassigns
  `workout_session_id`. `ensureWorkoutSession` guards the *session* id
  (`:678-683`) but the log ids got no equivalent; the replay-detection SELECT
  (`:800-804`) checks existence without an ownership join. Direct violation of the
  CLAUDE.md `onConflictDoUpdate` rule — these tables have no `user_id` column, so
  the fix is a pre-check joining `workout_sessions` (reference: `assertOwnership`,
  `app/api/workout-entry/route.ts:8-16`).
- **SEC-4 (low) — read leak: `GET /api/ai-periodization/weekly-volume`** passes a
  query-string `programId` to `listVolumeTargets(programId)` with no user scoping
  (`app/api/ai-periodization/weekly-volume/route.ts:15-23` →
  `slices/periodization.ts:204-210`). Fix: resolve the program via a user-scoped
  lookup first (the `!programId` branch already does). `replaceVolumeTargets`/
  `deleteVolumeTarget` are also unscoped but internal-only today.
- **SEC-5 (low) — internal error details leaked to clients.**
  `app/api/phase-sets/clone/route.ts:53` returns `detail: String(err)`;
  `app/api/ai-chat/route.ts:166-168` returns the stringified raw error. Fix: log
  server-side, return generic messages.
- **SEC-6 (medium) — mass assignment via raw `.set(body)`.**
  `app/api/supplements/[id]/route.ts` → `updateSupplement` (`adapter.ts:3367-3374`)
  and `PUT /api/nutrition/meal-types/[id]` → `updateMealType`
  (`slices/nutrition.ts:75-82`) pass the raw request body into Drizzle `.set()`.
  `userId`, `deletedAt`, `createdAt` are settable column keys — a user can PATCH
  `{"userId":"<other-uuid>"}` and move rows between accounts. Fix: Zod-whitelist
  both bodies (reference: `updateInjury` `adapter.ts:3313-3329`).

### Hardening (defense-in-depth)

- **SEC-H1 (medium)** — Oura token encryption **fails open**: `lib/oura/token-crypto.ts:12-15`
  silently returns plaintext when `TOKEN_ENC_KEY` is absent. Fail closed (or log loudly at startup).
- **SEC-H2 (medium)** — `POST /api/oura/webhooks` **echoes the HMAC signing key** in its
  response (`app/api/oura/webhooks/route.ts:36`) and gates on the stale JWT `isAdmin`
  flag instead of `requireAdmin()`'s DB check. Fix both.
- **SEC-H3 (low)** — no server-side rate limit on `health-connect/ingest` (secret-guess
  throughput), `POST /api/oura/sync`, `POST /api/oura/hr-sync` (client throttle is
  convention only — hammer-through-your-Oura-credentials cost).
- **SEC-H4 (low)** — `POST /api/feedback`: no rate limit, unbounded `title`/`description`
  (500 KB screenshot rows floodable). Match sibling `client-error` (limiter + `readJsonLimited`).
- **SEC-H5 (low)** — `PATCH /api/workout-entry`: no Zod, unbounded `weights`/`reps` arrays →
  100k-iteration insert loop possible (`route.ts:24-31`). Apply `LogExercisePayloadSchema`-style
  bounds. Same-PR: the new `DELETE /api/workout-sessions` repeated the no-schema pattern (WK-17).
- **SEC-H6 (low)** — `POST /api/mood` passes `energyLevel`/`bodyState`/`soreMuscles` untyped;
  `register` `name` unbounded, password no `.max()` before bcrypt.
- **SEC-H7 (info)** — CSP still allows `script-src 'unsafe-inline'` (known follow-up,
  `next.config.ts:10`); rate limiter degrades open across replicas by design; register
  endpoint enumerates accounts (rate-limited, accepted); mobile session cookie maxAge 30 d
  vs JWT 7 d (cosmetic); `lib/admin.ts:11` comment says 30-day staleness, actual is 7 (doc drift).

### Verified clean
All 149 API route files self-check auth (middleware excludes `/api` — per-route checks
are load-bearing and hold); all 17 admin routes use `requireAdmin` (exception SEC-H2);
~61 adapter/slice UPDATE/DELETEs correctly user-scoped apart from SEC-1..3; zero
`JSON.parse` of model output; all 12 AI-SDK call sites rate-limited; all 12 AI-chat
tools read-only and userId-bound; Oura webhook fails closed with no enumeration oracle
(timing-safe compares, identical 403s); export route leak-free and streaming; SQL fully
parameterized (`sql.raw` absent); session JWT config sound; no CORS headers anywhere;
DB pool guard (`pool.on('error')` + timeouts) intact.

---

## §2 Caching & invalidation (Batch R2)

- **CACHE-F1 (critical) — mixed variants on `progress-summary`.**
  `app/health/health-content.tsx:371` + sync-provider warm list use `cachedFetchToday`
  (envelope shape); `app/nutrition/nutrition-content.tsx:223-226` uses plain
  `cachedFetch`. The shapes clobber each other → permanent miss on one side, silent
  `undefined` reads on the other. Fix: convert the nutrition site to `cachedFetchToday`.
- **CACHE-F2 (high) — log-exercise write invalidates via a hand-rolled key list.**
  `components/workout-screen.tsx:827-832` — ad-hoc `invalidateCache()` (forbidden at
  write sites). Misses at minimum `exercise-history:<name>` (the summary screen
  immediately re-reads a pre-log cache), plus `day-log:`, `home-day-timeline`,
  `achievements:`, `workout-sessions-day:`, `calendar-data:`/`streak-data`,
  `training-load`, `muscle-tonnage-trend`. Normal workouts are eventually covered by
  `invalidateWorkoutSummaries()` at complete — **solo re-logs never are**. Fix: new
  `invalidateExerciseLogged(sessionId, exerciseName)` group in `lib/cache-groups.ts`.
- **CACHE-F3 (high) — phase-set CRUD invalidates only `phase-sets`.**
  `components/config-screen.tsx:260,298,318,330`. Phase sets feed `phaseStatus`/
  `phaseName` cached under `workout-card:<id>` — **TTL_LONG + `freshWithinTtl`**, so
  the network fetch is skipped entirely for 6 h → hard-stale phase labels on every
  session card. Fix: call `invalidateProgramStructure()` (already contains `phase-sets`).
- **CACHE-F4 (high) — `workout-card:`/`workout-data:` cache a server-computed
  "today" flag under a date-less TTL_LONG key.** `app/api/workout-data/route.ts:347`
  stamps `loggedTodayInSession`; consumers render/act on it from cache with no date
  validation (`workout-select-content.tsx:31-35`, `workout-screen.tsx:1060`,
  `pre-workout-screen.tsx:113,207,354`, `done-screen.tsx:167`). Crossing midnight
  within the TTL shows yesterday's "trained today" and mis-skips auto-advance. Fix:
  date-stamp the payload and validate on read (mirror `isBodyMetadataFresh`).
- **CACHE-F5 (high) — `nutrition-adherence` registered in no invalidation group.**
  Derived entirely from food logs + required meal types, but absent from
  `invalidateNutritionWrite()` (`lib/cache-groups.ts:182-193`); meal-type CRUD
  invalidates only `nutrition-meal-types` (`meal-type-manager.tsx:90,107,125,150`).
  Stale up to 30 min after logging the last required meal.
- **CACHE-F6 (high) — local (APK) quick-log body-metric write uses the wrong group.**
  `app/session-select/session-select-content.tsx:816` — device path calls only
  `invalidateReadinessInputs()`; the web fallback in the same function also calls
  `invalidateBodyMetricWrite()` (`:849-850`). The canonical runtime path leaves
  `body-metadata`/`day-log:` stale. Fix: add the missing group call at `:816`.
- **CACHE-F7 (high) — `body-metadata` fetch-hit paths without the today-guard.**
  The seed guard exists at 3 documented sites; 3 more `onData` callbacks are
  unguarded: `components/overview-screen.tsx:138-141`,
  `components/profile/goals-section.tsx:87-92`,
  `components/nutrition/end-of-day/end-of-day-review.tsx:78-82`. localStorage entries
  persist ≥24 h → yesterday's steps/water can paint every morning. Fix: wrap in
  `isBodyMetadataFresh(d)`.
- **CACHE-F8 (medium)** — pull-to-sync (`session-select-content.tsx:529-536`) runs a
  full Oura cloud sync then invalidates a hand-rolled list missing the whole
  `invalidateOuraSync()` group (`oura-stats`, `oura-hr-day:`, `home-day-timeline`, …).
  Compare the correct `sync-provider.tsx:183-184`.
- **CACHE-F9 (medium)** — `exercise-history:` fetched at divergent TTLs again
  (readiness-score class, new instance): `exercise-summary-screen.tsx:46` TTL_SHORT vs
  `active-workout-screen.tsx:116` raw TTL_MEDIUM vs the canonical
  `EXERCISE_HISTORY_TTL`. Import the constant at both sites.
- **CACHE-F10 (medium)** — `muscle-tonnage-trend` in no group; add to
  `invalidateWorkoutSummaries()`.
- **CACHE-F11 (medium)** — `invalidateActivityWrites()` misses `day-log:`
  (`app/api/day-log/route.ts:128-130` includes activity logs; group at
  `lib/cache-groups.ts:141-152` doesn't clear it).
- **CACHE-F12 (low-med)** — remaining ad-hoc single-key invalidations at write sites:
  `profile-tab.tsx:257,697`, `oura-section.tsx:139`,
  `ai-periodization-status-card.tsx:72`, `meal-type-manager.tsx` (×4),
  `add-exercise-sheet.tsx:143,170`, admin managers, `workout-screen.tsx:969`.
  Promote each to a named group.
- **CACHE-F13 (medium)** — duplicate keys for `/api/user/profile`:
  `more-user-profile` (TTL_MEDIUM, 3 sites) vs `nutrition-user-profile` (TTL_LONG);
  profile saves invalidate only one → 6 h-stale user object on Nutrition. Collapse to one key.
- **CACHE-F14 (low)** — dead legacy plumbing: `ta_streak_v1`/`ta_calendar_v2_*` are
  read and cleared but **written nowhere** (`session-select-content.tsx:266-277`,
  `lib/utils.ts:26-30`). Delete the reads + helper.
- **CACHE-F15 (low-med)** — bare `fetch()` GETs of cached endpoints:
  `day-review-sheet.tsx:42-51` (`workout-sessions/day` — a key already exists — and
  `workout-load-history`), `app/health/timeline/page.tsx:73` (`day-timeline`).
- **CACHE-F16 (low-med)** — aggregate GET routes with no SWR headers: `day-log`,
  `oura/stats`, `friends/feed`, `friends/leaderboard`,
  `ai-periodization/weekly-volume`, `ai-periodization/program-overview`,
  `activity-logs`, `workout-load-history`; `year-review` lacks the SWR window.
- **CACHE-F17 (low)** — hygiene: `nutrition-food-logs-<date>` raw `60` TTL at 3 sites
  (needs a named constant); raw literals equal to constants at
  `workout-screen.tsx:204`, `profile-tab.tsx:194`, `home-day-timeline.tsx:12`;
  `body-battery`/`mood:<date>`/`year-review`/`admin-pending-count`/`exercise-library`
  (admin media route) group gaps; `tdee-adaptation-card.tsx:25-26` localStorage read
  in a lazy initializer; done-screen HR sync doesn't clear today's `oura-hr-day:`.

**Clean:** `freshWithinTtl` inventory (10 uses, coverage complete except F3/F4 +
admin media); no new prefix-sibling hazards; no `readCacheSync` in lazy initializers;
all other multi-site keys variant- and TTL-consistent; all other domain writes use
named groups.

---

## §3 Offline sync, outbox & local store (Batch R3)

### Sync-chain / tombstones

- **SYNC-C1 (high) — workout deletes never reach the device's local store.**
  `lib/workout/delete-session.ts:47-50` hard-DELETEs (comment `:8-10` explicitly
  defers tombstones); `/api/workout-entry` DELETE same class. The delete UI runs on
  the S25 (`health-content.tsx:578-597`, `stats-content.tsx`), doesn't touch the
  local store, and `getSyncDelta` can never emit a tombstone for a hard-deleted row —
  **deleted sessions persist in local SQLite forever** and keep rendering in
  local-first readers (`store.getWorkoutHistory` `health-content.tsx:416`,
  `exercise-history-sheet.tsx:34`). On the canonical runtime this is user-visible
  data resurrection. Fix: `deleted_at` on workout_sessions/exercise_logs/set_logs
  (extend migration 111's pattern), tombstone in `deleteWorkoutSession`, emit via
  `getSyncDelta`, and/or mirror the delete into the local store at the call sites.
- **SYNC-C2 (medium) — supplements lack the local sync machinery.**
  `applyDelta` supplements branch overwrites unconditionally
  (`sqlite-backend.ts:987-989` → `upsertSupplement :1182-1199`) because the local
  table has no `sync_status`/`deleted_at` (`migrations.ts:311-320`) — a pull can
  revert a pending offline supplement edit. (Server-side delete propagation is OK —
  `deleteSupplement` soft-deletes via `active=false` + `deletedAt` and the pull maps
  `active`.) Fix: add the columns via `RECONCILE_COLUMNS`, gate like injuries.
- **SYNC-C3 (medium) — silent no-op writes when the local DB never opened.**
  `lib/sqlite/sqlite-service.ts:107-110` (`if (!_db) return;`) while `getLocalStore`
  (`index.ts:105-114`) still returns a live store — `queueMutation` silently no-ops;
  a write whose direct POST also failed is lost with no error. Fix: throw from
  `runSQL` when `_db` is null so write sites take their API fallback.
- **SYNC-C4 (medium) — `clearLocalStoreData` doesn't clear `api_cache`/legacy
  `sync_outbox`** (`index.ts:118-146`) — cross-user cache leak on account switch.
- **SYNC-C5 (low-med) — `markWorkoutSynced` re-arms the pull-clobber.**
  `sqlite-backend.ts:376-389` flips the *session* row to `synced` on any exercise
  confirm; a still-queued `complete_workout`/`session_rpe` mutation for the same
  session can then be reverted by the next pull. Fix: leave the session flip to
  `markSessionSynced` only.
- **SYNC-C6 (low)** — session tombstone doesn't cascade to local child rows
  (`sqlite-backend.ts:717-721`); food_logs conflict arm doesn't propagate
  `meal_type_id`/`food_item_id` edits (`:976-979`); `food_items` applyDelta ungated
  (`:963-965`, create-only today); local fallback reopen never advances the stored DB
  version → every cold open re-pays a failed upgrade + reconcile
  (`sqlite-service.ts:53-56`).

### Push/route parity

- **SYNC-P1 (medium)** — body_metrics push branch (`adapter.ts:2955-2975`) mirrors
  only the measurementCm clamp; the web route's Zod bounds (weightKg 20–500, bodyFat
  1–80, calories ≤20 000, steps ≤200 000 …, `lib/validation/body-metrics.ts:26-42`)
  are absent — a corrupted payload poisons trends. Extend the parity test.
- **SYNC-P2** — supplements PATCH mass assignment = SEC-6 (one fix).
- **SYNC-P3 (low-med)** — activity push (`adapter.ts:3077-3100`) skips web Zod bounds
  and the `endTime` derivation; `String(p.title)` mints `"undefined"`.
- **SYNC-P4/P5 (low)** — day_checkins push skips `journal` max/`soreMuscles` element
  validation; injuries push casts `severity` blindly; supplements push accepts a
  missing name as `"undefined"`.
- **SYNC-P6 (info)** — web mood/supplement-log stamp server-today, push honours the
  queued date (currently unreachable divergence).
- **SYNC-P7 (low)** — water has two server write functions (web
  `incrementWaterLog` add vs outbox `upsertBodyMetrics` absolute total) — standing
  "one write function per domain" violation; loses increments in a multi-device world.
- **SYNC-Q1 (low)** — the push route deliberately drops unknown-domain mutations
  (confirmed-and-deleted client-side). Right anti-wedge call, but a newer client
  against an older server silently loses data — version-gate or return an explicit
  "unsupported domain" error when a new domain ships.

### Outbox coverage & local-first reads

- **SYNC-O1 (med-high)** — `exercise-review-sheet.tsx:97` (detected walk/run) POSTs
  `/api/activity-logs` server-only; sibling `done-activity-screen.tsx:112-162` has
  the full local+outbox path for the same domain. Copy it.
- **SYNC-O2 (med-high)** — `lib/nutrition/log-food.ts:78-100,163-166`:
  `createFoodItem` is an unconditional awaited POST **before** the local-store
  branch — offline, logging any new/scanned/custom food throws and nothing lands
  locally. Fix: mint the item id client-side, upsert locally, carry item fields in
  the mutation payload (or add a `food_items` outbox domain).
- **SYNC-O3 (medium)** — `PATCH /api/oura/workouts` (reviewed/dismissed) is
  `fetch(...).catch(() => {})` (`exercise-review-sheet.tsx:116-160`,
  `exercise-detected-card.tsx:84-90`) while local state clears — offline the flag is
  lost and the card resurrects after the next Oura sync.
- **SYNC-O4 (medium)** — `early-deload-card.tsx:9-12`: no `res.ok` check, no
  try/catch — `onConfirm()` fires on 4xx/5xx (silent false success on a real
  periodization write); network rejection wedges the button (no `finally`).
- **SYNC-O5 (medium)** — `overview-screen.tsx:205-225` body-metric save is
  server-only while three sibling surfaces are local-first.
- **SYNC-O6 (low)** — unchecked `res.ok`/silent failures: `ai-prescription-card.tsx:66-96`,
  `morning-checkin-sheet.tsx:96-100`, `end-of-day-review.tsx:174-178`,
  `done-screen.tsx:117-121` (RPE fallback), `manage-supplements-sheet.tsx:159`,
  `supplements-section.tsx:71-73`, `saved-meals-sheet.tsx:194-202` (deleteMeal).
- **SYNC-R1 (high)** — home metric tiles read `cachedFetch('body-metadata')` only
  (`session-select-content.tsx:372-387`) while the same file writes body_metrics
  locally (`:762-787`) — unsynced offline saves vanish from Home on remount. Seed
  from `store.getBodyMetrics()` like `health-content.tsx:273-310`.
- **SYNC-R2 (medium)** — health local fast-path fills `metaRecent` but never
  `setMetaToday` (`health-content.tsx:283-312`) — today's tiles are server-only on a
  fresh offline mount.
- **SYNC-R3 (medium)** — `home-day-timeline.tsx:210-213` renders today's timeline
  (all locally-written domains) from the server aggregate only — not on the
  sanctioned exceptions list. Assemble local-first, or add it to the documented
  exceptions.
- **SYNC-R4 (medium)** — history edit/delete flows mutate the server only
  (`health-content.tsx:537-620`, `stats-content.tsx:117-152`) — local rows stay
  `synced` and keep rendering (pairs with SYNC-C1; activity_logs does have
  tombstones so that half self-heals on pull).
- **SYNC-R5 (low-med)** — day-detail overlays use bare `fetch('/api/day-log')`
  (`stats-content.tsx:96-113`, `health-content.tsx:532`).

### Stored counters

- **SYNC-T1 (medium)** — `user_stats.total_sessions/total_volume_kg/total_sets`
  (`schema.ts:255-260`): incremented (replay-guarded) in `logExerciseAndSets`
  (`adapter.ts:876-899`) but never decremented on any delete and no
  reconcile-on-read; `lib/achievements.ts:97,170-172` gates XP/achievements on the
  raw row. Textbook Stored-Counters violation.
- **SYNC-T2 (medium)** — `sessions_in_phase` has the full trio but the reconcile
  runs at only one read site (program-overview); the load-bearing readers (prescribe
  route phase-ceiling guards, workout-data `completedCycles`) read the raw counter.
  Reconcile at the top of the prescribe route.

**Clean:** CI parity rule (`check-push-mutations.js`) works and passes; all 11
mutation domains delegate to shared repo functions; poison-pill handling end-to-end
(quarantine, id-based confirms, no whole-loop `break`); migration-110 chain complete
column-by-column; cursor pagination both ends; `RECONCILE_TABLES/COLUMNS` complete
for all 26 tables; upsert read-merge protection (`upsertBodyMetric` null-means-keep);
web read-fallback purity (every `if (!store)` branch is a pure pass-through).

---

## §4 Performance & data trips (Batch R6)

- **PERF-1 (med-high) — chart.js in the home bundle.** `day-review-sheet.tsx:9`
  statically imports `WorkoutLoadComparisonChart` (→ chart.js) and the sheet is
  statically imported into home (`session-select-content.tsx:40`). The file already
  dynamic-imports its other heavy children — this one was missed. One-line fix.
- **PERF-2 (med-high) — MuscleHeatmap re-rendered at 1 Hz on the warmup screen.**
  `warmup-screen.tsx:54,134` rebuilds `assignments` every render into the memoized
  heatmap while the component self-ticks (`:23` `useElapsedSec`). The fix already
  exists in `active-workout-screen.tsx:175-180` (memoized with a comment naming this
  exact failure) — missed sibling surface.
- **PERF-3 (medium) — third, rogue Oura sync throttle.**
  `exercise-detected-card.tsx:62-73` fires `POST /api/oura/sync` on home mount behind
  its own **5-minute** key (`ta_oura_workout_sync_ms`), bypassing the shared 6 h
  `OURA_LAST_SYNC_KEY` that SyncProvider/Health deliberately share; plus a bare
  `GET /api/oura/workouts?unreviewed=true` on every home mount (`:51-58`). Each sync
  hits 5 Oura endpoints server-side.
- **PERF-4 (medium) — `health-trends-summary` fetched by 4 sibling cards per Health
  open** (`oura-section.tsx:94`, `workout-density-card.tsx:15`,
  `nutrition-activity-trends-card.tsx:15`, `health-score-detail.tsx:149`) — separate
  dynamic chunks mount at different times so the in-flight dedup can't collapse them.
  Fetch once in health-content and pass down.
- **PERF-5 (medium) — nutrition date-swipe refetch storm.**
  `nutrition-content.tsx:244` re-runs all 8 endpoints on every `selectedDate` change;
  7 are date-independent. Browsing back 5 days ≈ 40 requests. Split
  date-dependent from once-per-mount. (Also `:328-333` blanks the list before
  fetching, defeating the per-date cache.)
- **PERF-6 (medium) — dynamic `loading:` skeletons defeat cache seeds on lightweight
  cards.** `health-sections.tsx:37-64` (`AiWeeklyVolumeCard`, `StrengthProgressCard`,
  `StrengthTrendCard`, `GoalsProgressCard`, `TrendsSection` — verified no heavy deps)
  and `session-select-content.tsx:44-47` (`BodyBatteryCard`). Chunk-load skeleton
  flashes before the seeded card can paint — the CLAUDE.md contradiction rule.
  Static-import them (keep `OuraSection` dynamic — it holds chart.js).
- **PERF-7 (high, latent) — cache reads in `useState` lazy initializers.**
  `oura-section.tsx:73-88` (five `readCacheSync` initializers — currently masked by
  the dynamic ssr:false wrapper; breaks the moment PERF-6's fix static-imports it —
  **convert these first**), `session-select-content.tsx:139-162` and
  `health-content.tsx:171-191` (SSR'd components; the layout-effects re-seed anyway,
  so the initializers are pure hydration risk with no benefit).
- **PERF-8 (low-med)** — timers/rAF in non-leaf components:
  `weekly-stats-hub.tsx:16-17` (two `useCountUp` at hub top re-render chart + tiles),
  `active-activity-screen.tsx:28-41` (1 Hz whole-screen tick; `session-clock.tsx`
  leaf exists), `ui/meteors.tsx:38` (permanent 3 s DOM churn on home).
- **PERF-9 (low-med)** — workout-data N+1 prefetch: per-session
  `/api/workout-data?tab=<name>` each re-runs the full program/library/PR queries
  server-side (`route.ts:82-85,143-148`); cold cache costs N+1 heavy requests. A
  `?tab=all` batch would collapse it. Related light overlaps: `calendar-data` +
  `streak-data` recompute the current month twice; `body-battery` + `readiness-score`
  independently query near-identical rows; admin pending-count fetched at 2 sites.
- **PERF-10 (medium)** — day-overlay edit/delete waits on the network for feedback
  and has no outbox (`health-content.tsx:537-615`), duplicated in
  `stats-content.tsx:117+` (sibling drift; also SYNC-R4). `metric-log-sheet.tsx:120-131`
  web fallback toasts after `await` while the same fallback in session-select is
  feedback-first (drift).
- **PERF-11 (low)** — `key={index}` in the two set-edit dialogs
  (`health-content.tsx:836-853`, `stats-content.tsx:~350`) — controlled inputs and
  fixed row count so no bug today; keying by set number is free.
- **PERF-12 (info)** — file sizes: `session-select-content.tsx` **1502**,
  `workout-screen.tsx` 1252, `health-content.tsx` 1132, `health-sections.tsx` 968,
  `config-screen.tsx` 964, `program-editor-sheet.tsx` 959. No *new* files over 800,
  but session-select keeps absorbing features (recommendation/mood block
  `:1116-1205`, week-day sheet `:1376-1466` are easy extractions). Dead import:
  `OuraBatteryChip` (`session-select-content.tsx:21`).

**Clean:** all main screens cache-seed synchronously; `useCountUp` animates from
previous value; ten React.memo components verified prop-stable at every call site;
Zustand hot-path selector discipline in the workout screen intact; no
`readCacheSync`/`JSON.parse` in timer-rendered bodies; heavy deps otherwise properly
dynamic; server routes parallelize with `Promise.all`; in-flight guards present on
all checked save paths (exception WK-4); no serial awaited POST loops.

---

## §5 Workouts domain (Batch R4)

- **WK-1 (high) — `advance()` stale closure loses single-exercise completions.**
  `workout-screen.tsx:506-559` — `advance` memoized on
  `[currentIdx, effectiveExercises, soloMode]` but calls `completeWorkout()` (`:548`)
  and `handleAddToCalendar()` (`:555`) whose identities depend on
  `store.workoutSessionId` (`:1033`). For a one-exercise session the final
  `advance()` uses a pre-start wsId: `''` → POST fails Zod **and** the
  `if (wsId && userId)` guard skips the outbox → completion silently lost (no
  `completed_at`, no phase increment, no prescription consume). Same root cause as
  the tracked calendar-payload item — fix both together (read via refs /
  `getState()`).
- **WK-2 (high) — supersets with unequal set counts orphan the tail.**
  `workout-screen.tsx:688-693` — the handoff only runs when
  `completedSetIndex + 1 < store.sets`; after the shorter exercise's last set the
  longer partner's stashed remaining sets are skipped with no signal.
  `lib/workout/superset-order.ts` is correct; the consumer drops the tail. Consult
  the sequence/`exerciseBuffers` for unfinished earlier group members before advancing.
- **WK-3 (medium) — rest ring vs beep mismatch in supersets.**
  `active-workout-screen.tsx:154` derives the visible countdown from
  `progressionStyle[currentSet-1].restSec` while the beep/notification/PiP use
  `store.lastSetRestSec` (deliberately superset-aware). After a handoff the ring
  shows the wrong duration. Pass `lastSetRestSec` down (PipView already gets it).
- **WK-4 (medium) — no in-flight guard on `handleCompleteSet`/`handleLogCurrentSet`.**
  `workout-screen.tsx:697-858` — a double-fire mints fresh `clientExerciseLogId`/
  `setLogIds` (`:748-749`) so server replay detection can't dedupe: two
  exercise_logs, doubled `user_stats`. CLAUDE.md mandates the guard (session-86
  incident). Add an `isLoggingRef` (mirror `isCompletingRef`).
- **WK-5** = CACHE-F2 (log-write ad-hoc invalidation; solo-log staleness).
- **WK-6 (medium) — client/server 1RM divergence in baseline (AMRAP) phase.**
  `workout-screen.tsx:726-732` picks the estimator by `exerciseType` only; the server
  (`lib/workout/log-exercise.ts:163-168`) passes `isBaseline` and stores the
  AMRAP-scaled value — the celebrated toast number never persists. Call
  `estimateOneRm(..., { isBaseline })` client-side. Related: the optimistic PR check
  (`:792`) doesn't exclude `phaseStatus.isDeloadActive` though the server's
  `shouldCountTowardPr` does.
- **WK-7 (medium) — per-set-weight init effect clobbers mid-set dial edits.**
  `workout-screen.tsx:390-414` — deps `[currentIdx, effectiveExercises]`, no
  `timerStarted`/mode guard; any `setExercises` (late fetch, injury-swap `:588-595`,
  deload toggle) recomputes `perSetWeights` mid-set. Sibling effect at `:487` has the
  guard. (Injury-swap relies on the refire — guard + explicit recompute on swap.)
- **WK-8 (low)** — `skipPerSetWeightsInitRef` poisoning when Continue-Workout restore
  lands on the same `currentIdx` (`:424-431,636-638`) — the next legitimate init is
  silently skipped once.
- **WK-9 (medium) — session recap cached forever, never invalidated on edit.**
  `app/api/workout-sessions/[id]/recap/route.ts:28-30` caches in
  `ai_health_insights`; `workout-entry` PATCH rewrites weights/reps/PRs but never
  clears it → the recap describes the pre-edit session permanently. Delete the
  insight row in PATCH (and DELETE for hygiene).
- **WK-10** = CACHE-F9 + CACHE-F15 (`exercise-history` TTLs, bare fetch sibling).
- **WK-11** — `workout-load-history` route: no SWR headers (CACHE-F16), matches
  sessions by `sessionName` string (rename breaks continuity — the recap route
  correctly uses `sessionId`); consumer uses bare fetch (CACHE-F15) and
  `day-review-sheet.tsx:60` has `pb-safe` inside a bottom sheet (UI-M1).
- **WK-12 (low-med)** — `reconcilePersonalRecord` (`adapter.ts:2376-2405`) can't
  honour the per-exercise deload gate: `exerciseDeloaded` is never persisted on
  `exercise_logs`, so an edit/delete reconcile can promote a 1RM that
  `shouldCountTowardPr` rejected at log time.
- **WK-13 (low)** — `todayLogged` rollover only enforced at rehydrate
  (`workout-store.ts:311-318`) — an app kept open across midnight keeps yesterday's
  "done" ticks until restart.
- **WK-14 (low)** — voice logging feeds unclamped values (`set-card.tsx:188-191`):
  "0 reps" accepted; weight > 500 → server Zod reject → quarantined poison mutation.
  Clamp like the +/− buttons.
- **WK-15 (low)** — phase counting keys off `sessionName.toLowerCase()`
  (`log-exercise.ts:107-108`, `workout-data/route.ts:109,165`) — against the
  "session identity = DB id" rule; renaming a session resets its phase progress.
- **WK-16 (low)** — mixed "today" sources in one flow: outbox date `todayInTz()` vs
  payload `localDatetimeString()` (device tz) vs optimistic calendar stamps
  device-local (`handleCompleteSet`/`completeWorkout`).
- **WK-17 (low)** — `workout-entry` PATCH/DELETE and the new `workout-sessions`
  DELETE have no Zod schemas (= SEC-H5).
- **WK-18 (low)** — misc: `newPRs`/`xpEarned` unpersisted (mid-workout refresh
  empties the done screen); calendar-add failure has no retry/outbox; `key={ex.name}`
  in pre/warmup lists (duplicate exercise → collision); CLAUDE.md architecture
  section says four modes, code has five (`warmup`) — doc drift, fixed in this PR.

**Clean:** Zustand persistence hygiene (rehydrate resets, atomic commits,
identity-key effects); epoch-based timers survive suspend/refresh; notification
resync + `allowWhileIdle`; complete-workout idempotent both ends with in-flight
guards; no hardcoded session names anywhere; push branches share the web routes'
functions with per-mutation error isolation; delete paths decrement phase counters in
transactions and reconcile PRs; hot-path render discipline (SetCard memo survives
ticks, hot fields via narrow selectors); avgReps floor change correct; safe-area
utilities present on all five workout screens.

---

## §6 Nutrition domain (Batch R5)

- **NUT-1 (high) — quick-edit sheet shows and saves a stale quantity.**
  `quick-edit-log-sheet.tsx:23` — `useState(() => log?.quantityMultiplier ?? 1)`;
  mounted permanently with no `key` (`nutrition-content.tsx:502`) and no re-sync
  effect. Opening a ×2 log shows ×1; **saving untouched overwrites the log to the
  leftover qty** (data corruption); a second edit inherits the first's value. Fix:
  `key={editingLog?.id}` at the call site (or a sync effect).
- **NUT-2 (medium) — quick-edit list update gated on the network push.**
  `:64-67` — `invalidateNutritionWrite()` + `onSaved()` only run inside
  `pushMutations().then()`; offline the list keeps the old quantity. Also violates
  the mutation-callback contract (`onSaved()` parameterless). Invalidate + call
  `onSaved(updatedLog)` synchronously after the local write.
- **NUT-3 (medium) — saved-meal quick-log writes today but the UI appends to the
  selected date.** `saved-meals-sheet.tsx:181-185` always logs `todayInTz()`;
  `handleFoodLogged` (`nutrition-content.tsx:236-242`) appends to the displayed
  (possibly past) day's list and ring. Thread `logDate` (the FoodLoggerSheet already
  does) or filter by date in the callback.
- **NUT-4 (medium, tracked — fix identified)** — `saved-meals-sheet.tsx:126` sends
  `barcode: null` to a `.optional()` Zod field → "+ Add as new food" always 400s.
  Fix: omit the field (copy `lib/nutrition/log-food.ts:78-96`). Null-sweep of all
  other nutrition payloads: clean.
- **NUT-5 (medium) — disabled/deleted supplements' reminders never cancelled.**
  `lib/supplement-reminders.ts:31-32` *filters out* inactive/disabled supplements
  instead of emitting `cancel` actions (contrast `lib/meal-reminders.ts:34-37`), and
  the manage sheet's save/toggle/delete handlers never call
  `cancelSupplementReminder` — a scheduled reminder keeps firing after disable.
  Same-class: `deleteMealType` doesn't cancel that meal's reminder (low).
- **NUT-6 (medium)** — `nutrition-adherence` invalidation gap = CACHE-F5.
- **NUT-7 (medium) — daily digest goes stale after logging more food.**
  `app/api/daily-digest/route.ts:28-30` caches per-day in `ai_health_insights`; the
  only client (`day-review-sheet.tsx:35`) never sends `force` — a lunch-time digest
  reports lunch totals all evening with no regenerate affordance. Decide: staleness
  marker, regenerate button, or invalidate-on-write.
- **NUT-8** = SEC-2/SEC-6 (updateSavedMeal ownership; supplements/meal-types mass
  assignment) and SYNC-O2 (offline food-item creation).
- **NUT-9 (low)** — ingredient-totals math triplicated with drift:
  `lib/nutrition/scan-totals.ts:sumIngredients` (canonical, Atwater cross-check) vs a
  naive local copy in `review-step.tsx:55-69` vs per-ingredient rounding in
  `log-food.ts:37-49`. Review-step should import the canonical one.
- **NUT-10 (low)** — the "Save to my food library" toggle (`review-step.tsx:291-315`)
  is never read — decorative (also a hand-rolled div-switch with a `bg-white`
  literal). Honour it or remove it.
- **NUT-11 (low)** — hygiene: no client-side clamp on qty > 100 (local write
  succeeds → push quarantined as poison); saved-meal items accept unclamped qty
  (fails later at log time); AI-correction refine call omits `region`
  (`review-step.tsx:137-141`); meal types have no local table (offline render depends
  on the cache seed alone); `createFoodLog` foreign-id conflict yields a 500 instead
  of 403/409; meal-type reorder PATCH fires inside a `setMealTypes` functional
  updater (StrictMode double-fire; dnd side-effect rule) `meal-type-manager.tsx:133-153`;
  `assign-step.tsx:38-42` "Today after logging" preview ignores a past `logDate`;
  `⏰` emoji in `manage-supplements-sheet.tsx:291` (file already imports Lucide);
  `water-log-sheet.tsx:127` hex literals; meal-card pencil/trash ~26 px targets.

**Clean:** PR #263 fix intact at all call sites (no bare `onLogged()` remains);
PR #302 supplement ownership check verified; PR #304 client-id upsert correct
(`setWhere` + replay-idempotent); food scan route exemplary (generateObject + Zod,
rate limit, size caps, deterministic totals); date handling `todayInTz()` throughout;
food-item mirror + tombstones + pull-gating verified; `loadFoodLogs` empty-read
guard; water read-merge; no food-item delete path exists (FK `restrict`) so no
dangling references.

---

## §7 UI — safe-area, theme, a11y (Batch R7)

- **UI-H1 (high) — canvas given a CSS variable: today's bar renders black.**
  `workout-load-comparison-chart.tsx:34` — `"var(--color-brand)"` as a chart.js
  `backgroundColor`; canvas can't resolve CSS custom properties. The codebase
  documents this exact failure and ships `resolveColor()`
  (`trend-sparkline.tsx:24-27`). Fix: hoist `resolveColor` to `lib/` (One Formula One
  Place) and use it — the "today" highlight is the whole point of the chart.
- **UI-M1 (medium)** — `day-review-sheet.tsx:60`: `pb-safe` inside
  `SheetContent side="bottom"` (sheet bakes `pb-safe-action`) → double inset. Delete it.
- **UI-M2 (medium) — nested interactive control inside `<button>` + overflow.**
  `session-select-content.tsx:1086-1104` (day-review banner): a real `<button>`
  containing a `<span role="button">` dismisser (~26 px target, escapes the 44 px
  floor, no keyboard support) — Samsung WebView behaviour undefined. **Bonus layout
  bug:** `mx-4` + `w-full` overflows the right edge by 2 rem at ≤640 px. The correct
  sibling pattern is 30 lines above (`:1059-1078`).
- **UI-M3 (medium)** — same nested-control pattern in
  `weekly-recap-banner.tsx:72-96`, plus no `aria-expanded` on the expand toggle.
- **UI-M4** = CACHE-F16/F15 for `workout-load-history` + day-review-sheet fetches.
- **UI-L1 (low)** — hardcoded palette literals in new components:
  `rest-day-card.tsx:33` (`text-indigo-400`), `update-check-card.tsx:36-43` (amber
  ×3), `oura-section.tsx:~198` (inline `rgb(250 204 21)` stale indicator — also
  colour-only state + light-theme contrast fail), `admin/errors-tab.tsx:52`,
  `admin/time-audit-card.tsx:202` (admin-only, labelled).
- **UI-L2 (low)** — emoji: `⚠` in `time-audit-card.tsx:168` (file already imports
  `TriangleAlert`); touched-not-replaced: `home-card-widget.tsx:246`
  (`ENERGY_EMOJI`/`#f97316`), `session-select-content.tsx:1147,1163`
  (`#fbbf24`/`#000`).
- **UI-L3 (low)** — hand-rolled collapsibles without `aria-expanded` grew 18 → 21:
  new offenders `time-audit-card.tsx:98`, `errors-tab.tsx:47`,
  `weekly-recap-banner.tsx:72` (all bypass `components/ui/collapsible.tsx`).
  Codebase-wide `aria-expanded` count: exactly 1.
- **UI-L4 (low)** — the dismissible-banner pattern is now at 4 copies (APK banner,
  day-review banner, weekly-recap banner, early-deload card) and has already drifted
  (UI-M2/M3 are the broken variants). Extract a `DismissibleBanner` primitive when
  fixing M2/M3 (the "extract before a third copy" rule is breached).

**Clean:** no `pt-safe`+`pt-*` co-occurrences; all safe-area utilities defined in
`globals.css:312-365`; fixed bottom elements correct; the one side sheet has explicit
insets; all four newly-wallpapered screens use `bg-page` roots with dark+light
palette variants; sparkline inline-copy count unchanged at 6; `STAGE_COLOR` single
consumer (but see DATE-B6 — a *second* palette copy exists on the home widget);
gesture handlers unchanged at the 2 known files; no new global element selectors;
`hr-day-chart` lineColor default is the prescribed scheme-conditional pattern; no new
colour-only `scoreBand` instances; new sheets/cards otherwise token-compliant.

---

## §8 Dates, timezones & formulas (Batch R8)

### Dates

- **DATE-A3 (medium) — six AI-chat tools window on `Date.now() − N×86400000`.**
  `lib/ai-chat/tools.ts:19,139,181,197-198,236-238,267` — the session-62 banned
  pattern. Worst: `getProgressVsPast` uses raw ms edges as comparison **bucket
  boundaries**, splitting one AEST day across "current" and "past". The same file's
  `getTrainingLoadRisk` does it right (`todayMidnightUtc(tz)`, `:252`). Also `:268`
  `new Date().getFullYear()` = UTC year for "PRs this year"; `:158` inline next-day
  shift instead of `shiftDateStr`.
- **DATE-A6 (medium) — `normalizeDateParam` sibling sweep needed.** The session-212
  fix covered only `/api/day-log`. Same unvalidated-param → date-arithmetic 500s:
  `day-timeline/route.ts:68-74` (also `endMs` NaN guard gap at `:214`),
  `workout-sessions/day/route.ts:11-20`, `oura/hr-day/route.ts:17-19`, and
  `ai-chat`'s `localDate` (`lib/validators/chat.ts:12` — no format constraint).
  Cheap guard also warranted in `lib/workout/log-exercise.ts:125,143` (outbox
  payload dates reach the shared write path).
- **DATE-A5 (medium, tracked-adjacent)** — repo day-window helpers still hardcode
  AEST (`adapter.ts:912,967` raw SQL `AT TIME ZONE 'Australia/Brisbane'`;
  `aestMidnight` defaults; `slices/oura.ts:418`) — confirmed still present. Plus
  `'Australia/Brisbane'` re-declared as a literal instead of importing `DEFAULT_TZ`
  at 6 routes + 3 client files (`next-session`, `workout-data` ×2, `log-exercise`,
  `achievements`, `confirm-early-deload`, `profile/[userId]`, `overview-screen`,
  `session-select-content`, `workout-select-content`).
- **DATE-A7 (medium)** — mixed "today" sources on the home calendar/week-strip:
  server buckets in hardcoded AEST while the client builds matching keys in
  **device** tz (`session-select-content.tsx:94-98,899-905`,
  `workout-select-content.tsx:23-26`), with the morning-checkin marker using
  `todayInTz()` as a third source on the same screen. Also
  `home-card-widget.tsx:172-175` (sleep widget, device-tz `toLocaleDateString('sv')`
  vs server day strings — an idiom the lint rule can't see).
- **DATE-A1 (low)** — lint-rule coverage gaps (no live violations, but these are the
  escape hatches): `.substring(0,10)`, `.split('T')` without literal-`0` index,
  intermediate-variable slice, `.toJSON()`, `toLocaleDateString('sv'/'en-CA')`;
  `scripts/**` fully exempt.

### Formulas

- **DATE-B6 (medium) — sleep-stage palette duplicated with drifted colours.**
  Canonical `STAGE_COLOR` (`hypnogram.tsx:7-12`, deep `#1e3a70`…) vs
  `home-card-widget.tsx:178` inline (Deep `#6366f1`, REM `#8b5cf6`…) — home widget
  and Health hypnogram render the same stages in different colours. Move
  `STAGE_COLOR` to `lib/` (the rule says palettes live in `lib/`) and import.
- **DATE-B4 (medium) — score-band re-derivations.**
  `lib/session-explain/group-signals.ts:27-29` (same 70/50 thresholds, **divergent
  labels** 'Good/Fair' vs 'High/Moderate') and
  `app/api/ai/health-insight/route.ts:19-24` (private `bandLabel`). Both should call
  `scoreBand()`.
- **DATE-B9 (medium) — three linear-regression implementations, two competing
  plateau definitions.** `lib/health/strength-projection.ts:9-50` (day-spaced,
  ≥21-day span) vs `lib/ai-chat/analytics.ts:42-58` `classifyTrend` (index-spaced,
  ±1 %/session) — **the AI chat's "plateaued" verdict can disagree with the Health
  screen's flag for the same exercise**; plus
  `lib/health/long-term-goal-progress.ts:10-19` (index-spaced ×7, assumes one
  reading/day). Build `classifyTrend` on the exported `linearFit`; reconcile the
  plateau definitions.
- **DATE-B1 (low)** — `readiness-score/route.ts:59-64,174-178` hardcodes the ACWR
  band boundaries (0.8/1.3/1.5) twice as score modifiers — export the thresholds
  from `acwr.ts`.
- **DATE-B2 (low)** — `lib/ai-chat/context.ts:57` re-derives target-80 as
  `mround(orm*0.8, 1.25)` (canonical: `target80`, 0.25 rounding, style `targetPct`
  respected) — the AI can quote a working weight disagreeing with the app's own
  prescription. `lib/ai-periodization/signals.ts:144-145` re-implements the ±0.5 kg
  1RM trend classification (canonical `oneRmTrendStatus`).
- **DATE-B5 (low-med)** — `weekly-digest/route.ts:81` folds muscles with bare
  `toLowerCase()` instead of `normalizeMuscle` — synonyms won't fold. The
  main=1.0/secondary=0.5 weighted-set constant exists in ≥4 places (SQL ×2 + JS ×2)
  with the digest copy already diverging.
- **DATE-B7 (low)** — `median` duplicated (`session-recap.ts:26-30` re-implements
  `time-audit.ts:36`'s export); `summarizePeriod` inline equivalent still in
  `weekly-digest/route.ts:58-65` (self-acknowledged); "days since last trained"
  duplicated verbatim (`recommendation-card.tsx:28-38`,
  `workout-select-content.tsx:41-46`); slash-date display formatter ×3
  (`workout/utils.ts:41`, `overview-screen.tsx:72`, `stats-content.tsx:225` inline).

**Clean:** zero forbidden `toISOString` date patterns; `aestMidnight`/`shiftDateStr`
overflow-normalized; all date-param route defaults tz-correct; HH:MM:SS
normalization in place (one `endMs` guard gap); 1RM single-sourced (correct
inversion in expected-rpe); training-load ACWR consolidated (CLAUDE.md stale note
fixed in this PR); band consumers render server `interpretation`; weekly cadence
consolidated; `MACRO_COLORS` single source; bedtime math single implementation;
`pearsonCorrelation` single copy; `buildAutomaticPhaseStatus` reused everywhere.

---

## §9 APK-bundling & native-BLE readiness (Tracks A & B)

*The full architectural analysis. There is **no BLE code today** (zero
bluetooth/GATT hits, no BLUETOOTH_* permissions). One scoping risk to state up
front: Oura publishes no BLE GATT spec — ring→phone data is a proprietary protocol;
**a feasibility spike gates the whole BLE track**.*

### Track A — bundling the shell into the APK (blockers first)

Today the APK is a WebView whose document origin **is** the Railway origin
(`capacitor.config.ts:8-11`, no `webDir`). Bundling flips the origin to
`https://localhost`, which breaks:

1. **Cookie auth (the hard blocker):** the `__Secure-authjs.session-token` cookie is
   set on the Railway domain (`exchange-mobile-token/route.ts:36-45`); from a local
   origin it's third-party and won't ride API calls. → token-based auth (extend the
   existing exchange-mobile-token flow into a stored bearer). **Size L.**
2. **Every client fetch is relative `/api/...`** — no base-URL abstraction exists
   (cachedFetch, sync-engine `:69,474`, all screens, ErrorReporter, push-client,
   update-check-card). → one `apiUrl()` wrapper + lint rule. **Size M.**
3. **The page layer is not statically exportable:** async root layout awaits
   `auth()` (`app/layout.tsx:85-110`); every page calls `auth()`/`redirect()`;
   `middleware.ts` does route protection (doesn't run in export);
   `app/health`/`app/more`/`app/admin` do real SSR DB reads; a `"use server"`
   signOut action; `next.config.ts` `headers()`/images incompatible with export.
   → de-SSR pass. **Size L.**
4. **Web-push dies** (SW-based VAPID, `lib/push-client.ts`) → native FCM migration
   (`@capacitor/push-notifications`). **Size M-L.**
5. **Update model inverts:** today "UI updates without APK rebuild" is the
   deployment model; bundled shell makes `/api/version` + `/api/download-apk` (both
   currently relative → dead under a bundle) the only update channel. **Size M.**
6. SW asset caching replacement (exercise-media cache-first) **S-M**; bundled-shell
   CSP (`connect-src` must include the Railway origin) + `webDir` build **S**;
   ErrorReporter absolute endpoint + offline buffer **S**.

Survives fine: the `trainingai://` deep-link scheme, `google-sign-in.tsx` (already
hardcodes the Railway URL), server-side self-fetches, native JS bridges.

### Track B — BLE ingestion prep (independent; do the spike first)

The architectural inversion: every biometric domain flows **cloud → server → device**
(pull-only), the opposite of offline-first:

- `LocalSleepSession`/`LocalOuraDaily` have **no `syncStatus`/`deletedAt`**
  (`lib/local-store/types.ts:37-45,104-113`) — a local BLE write would be
  **clobbered by the next pull**. The outbox enum has no sleep/oura/HR domain;
  `body_metrics` *is* an outbox domain and already carries `hrvMs`/
  `restingHeartRate`/`spo2Pct` — daily aggregates have a ready path; sleep stages
  and HR series do not.
- **No source/provenance column** on `body_metrics`/`sleep_sessions`/`oura_daily`;
  COALESCE upserts mean last-writer-wins per field — cloud-vs-BLE computation
  differences will make values visibly flap. → `source` column + precedence-ranked
  merge. **Size M.**
- Sleep dedup conflicts on exact `(user_id, sleep_start)` (`slices/oura.ts:333-337`)
  — a BLE-derived session for the same night duplicates unless times match to the
  second. → same-night merge rule. **S-M.**
- `/api/sync-health` is the closest device-ingest template and is the **wrong
  template**: no Zod (raw `as SyncPayload` cast, `route.ts:18-27` — violates the
  ingest rule), direct POST with no local-store write/outbox (offline HC sync just
  drops). Fix it before a BLE route copies it. **S-M.**
- Background BLE needs a foreground service (`FOREGROUND_SERVICE_CONNECTED_DEVICE` +
  `BLUETOOTH_SCAN/CONNECT`) — the project already hit the Android 12+
  background-start wall with GPS walk detection (unresolved). App-open-throttled
  sync fits the existing no-cron pattern but forfeits BLE's freshness advantage.
  **Design decision needed. Size L.**
- Promote sleep/HR to offline-first domains (syncStatus/tombstones, local HR table,
  new outbox domains + Zod + push branches via shared functions, pull-clobber
  gating). **Size L.**
- Plugin hygiene for a future BLE plugin: **exact-pin it** — today all 14 Capacitor
  deps are `^` ranges including the *patched* health-connect plugin (lockfile-drift
  hazard); GATT/record keys from installed source only, end-to-end
  non-null-in-DB proof (the field-name bug class).

Doctrine compliance since 2026-07-06: **clean** — no new web-only affordances.
Housekeeping: CLAUDE.md claims the bundle-shell/FCM endgame is "noted in
`docs/implementation-backlog.md`" but no such entry existed (fixed in this PR);
`AndroidManifest.xml:74` declares `ACCESS_BACKGROUND_LOCATION` that no runtime path
requests (doc'd-vs-actual divergence); stale comment `lib/health-connect-sync.ts:36`
says "SDNN" while the code correctly reads Rmssd.

---

## Proposed plan batches (→ implementation plans)

| Batch | Contents | Priority rationale |
|-------|----------|--------------------|
| **R1 — Security & ownership hardening** | SEC-1..6, SEC-H1..H6 (one bug class + hardening; small diffs, high value) | Real vulnerabilities; single-user app lowers urgency but the fixes are cheap |
| **R2 — Caching correctness** | CACHE-F1..F17 | F1/F3/F4 are hard staleness/data-clobber on the canonical runtime |
| **R3 — Offline-first integrity** | SYNC-C1..C6, P1..P7, O1..O6, R1..R5, T1..T2 | C1/R1/O2 are user-visible data loss/resurrection on the S25 |
| **R4 — Workout-flow correctness** | WK-1..18 (fold in the tracked `advance()` calendar item) | WK-1/2 lose user data; the rest are same-file touch-fixes |
| **R5 — Nutrition fixes** | NUT-1..11 | NUT-1 is live data corruption; several one-liners |
| **R6 — Performance & paint** | PERF-1..12 | Bundle/1 Hz/N-fetch wins; PERF-7 ordering constraint with PERF-6 |
| **R7 — UI polish & a11y** | UI-H1, M1..M4, L1..L4 | H1 is a broken new feature (black bar); banner extraction unblocks M2/M3 |
| **R8 — Dates & formulas consolidation** | DATE-A1..A7, B1..B9 | AI-tool window bugs affect answer correctness; rest is drift-prevention |
| **Track A — bundled-shell APK** | items A1–A8 (§9) | Needs its own planning sessions; auth + apiUrl first |
| **Track B — BLE prep** | items B9–B15 (§9) | Feasibility spike gates everything; provenance/merge work is useful regardless (also benefits Health Connect) |

Suggested sequencing: R1 + the R2/R3/R4/R5 "high" items first (they are bugs users
can hit today), then R6/R7/R8 opportunistically, then Track A/B planning. Many
findings are one-liners that can be batched into a handful of PRs per batch.

---

## CLAUDE.md updates made in this PR (repeat-offender notes)

1. **New rule block** "Write-path ownership — rowcounts, mass assignment, client ids"
   (the SEC-1/2/3/6 bug class recurred across three domains).
2. **Canvas colour rule strengthened**: `resolveColor` must be imported from a shared
   module, never re-implemented; `var(--x)` never passed to chart.js (recurred
   despite an in-repo comment documenting it).
3. **Date-param rule**: every route `date`/`localDate` param goes through
   `normalizeDateParam` (the session-212 fix must not stay single-route).
4. **Stale content fixed**: training-load ACWR "retire on touch" removed (done);
   workout-mode list corrected to five modes; bundle-shell/FCM endgame backlog
   pointer corrected.
5. **Banner/nested-control note**: no interactive content inside `<button>` (incl.
   `span role="button"`); dismissible banners use one shared pattern.
