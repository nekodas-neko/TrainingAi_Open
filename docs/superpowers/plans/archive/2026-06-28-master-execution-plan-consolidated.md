# TrainingAI — Master Execution Plan (Consolidated)

**Written:** 2026-06-28
**Current app version:** 1.61.0
**Next DB migration:** `087_` (highest existing is `086_oura_body_enhancements.sql`)

## Purpose

Single authoritative execution queue merging every open workstream:

- Sprints 1–11 + future backlog — `docs/superpowers/plans/2026-06-17-consolidated-remaining-sprints.md`
- 14 perf/UX/feature areas — `docs/superpowers/plans/2026-06-28-perf-ux-activity-nutrition-fixes.md`
- Per-session phase tracking full spec — `docs/superpowers/plans/2026-06-17-per-session-phase-tracking.md`
- Nav restructure + friends full spec — `docs/superpowers/plans/2026-06-08-nav-restructure-friends-system.md`
- Master review (Sprints 1–7 detail) — `docs/superpowers/plans/2026-06-16-implementation-tasks-master-review.md`
- New security/perf audit findings (Phase 0 / Phase 1 below)

Where a source doc already carries the step-by-step detail, this plan **references it** ("execute spec as written in …") rather than re-deriving. Where the source is terse or the item is new, full detail is inline.

---

## Audit Corrections — False Positives (do NOT re-add as action items)

Verified against source — already correct, no work required:

- ❌ **Friendship IDOR is NOT a vulnerability.** `acceptFriendRequest` / `declineFriendRequest` / `removeFriend` (`lib/data/postgres/adapter.ts:3166–3187`) already scope the Drizzle WHERE clause by `addresseeId` / `requesterId = userId`.
- ❌ **Health Connect ingest timing-safe compare is ALREADY DONE** — `app/api/health-connect/ingest/route.ts:32` already uses `crypto.timingSafeEqual`.

Verified facts to reuse:

- ✅ **Rate limiter exists:** `lib/rate-limit.ts` exports `rateLimit(key: string, limit: number, windowMs: number): boolean`. Reuse everywhere — never write a new one.
- ✅ **Highest migration:** `086_oura_body_enhancements.sql` — next is `087_`.
- ✅ **Current version:** `1.61.0`.

---

## Non-Negotiable Rules (from CLAUDE.md) — apply to EVERY item

- **Never commit to `main` directly for code.** Feature branch per session; ask before merge/push. Exceptions: `.md`-only changes, planning docs, and bug fixes to already-merged features go straight to `main`.
- **Timezone rule:** every date string MUST use `todayInTz()` (client+server) or `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` in routes. **Never** `new Date().toISOString().slice(0,10)` or `.split('T')[0]`. This rule is flagged again inline wherever an item writes a date.
- **No hardcoded session names** (`"Push"`/`"Pull"`/`"Legs"`). Session identity = DB `id`/`position`, never name.
- **Samsung WebView compositor bug:** never add an inline SVG to a home-screen card without **Fix A** (CSS `conic-gradient` + `mask-image`) **or Fix B** (`willChange:'transform'` on the card container). Flagged inline wherever a home-card SVG is introduced.
- **No comments** unless the *why* is non-obvious. **No backwards-compat hacks. No features beyond what the task requires.** Prefer editing existing files; prefer pre-made libs (`motion`, `react-chartjs-2`, `@dnd-kit`, shadcn/ui) over hand-rolling.
- **Packages:** `pnpm` only; commit `package.json` + `pnpm-lock.yaml` together.
- **DB migrations** must be idempotent (`IF NOT EXISTS`). **`CONCURRENTLY` cannot be used** — `ensureSchema` runs migrations outside an explicit transaction-per-statement context and a from-scratch `pnpm db:local` applies them serially; `CREATE INDEX CONCURRENTLY` will error there.
- **Version + changelog** (`package.json` + `lib/changelog.ts`) after every user-visible change on `main`; tick the item in `projectOverview.md` immediately on push (⚠️ inline if device-verification pending).
- **Local testing:** `pnpm db:local` (Postgres port 5433) + `pnpm dev`; log in as `test@local.dev` / `testpass123`. TypeScript/lint passing is **not** sufficient — exercise the actual route/UI.

---

## Execution Order

```
Phase 0   Security hardening              (front-loaded)
Phase 1   Performance infrastructure      (benefits everything after)
Phase 2   Correctness bugs                (wrong data shown daily)
Phase 3   Cache & logic polish            (Sprint 2 remainder)
Phase 4   UI polish quick wins            (Sprint 3, frontend-only)
Phase 5   Performance infrastructure 2    (Sprint 4)
Phase 6   UI accessibility                (Sprint 6)
Phase 7   Sync code quality               (Sprint 7)
Phase 8   Component breakup               (Sprint 8, tech debt)
Phase 9   Remaining perf/UX               (Areas 1 + 9)
Phase 10  Nav restructure + friends       (Sprint 9)
Phase 11  Oura detail screens             (Areas 10–13)
Phase 12  Large new features              (Area 8, F-12, F-1, F-2, F-4)
Phase 13  Device-only / native            (Sprints 10–11)
Phase 14  Future backlog                  (no spec yet)
```

---

## Phase 0 — Security Hardening

### 0.1 — Security headers + CSP · HIGH
**File:** `next.config.ts` (currently only `optimizePackageImports`; no headers).

Add async `headers()` for `source: '/(.*)'`:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self)
Content-Security-Policy-Report-Only: <see below>
```
Also set `poweredByHeader: false`.

**CSP:** start in **report-only**. `script-src` / `connect-src` / `img-src` must allow Gemini, Google OAuth, Oura, Leaflet tiles, and Tailwind inline styles. Click through every tab with DevTools open; only switch to enforcing `Content-Security-Policy` after zero violations.

**Verify:**
```bash
curl -sI http://localhost:3000/ | grep -iE 'strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy|content-security'
```
All headers present; console shows zero CSP violations across all tabs before enforcing.

### 0.2 — JWT session maxAge · MEDIUM
**File:** `auth.config.ts:9` — `session: { strategy: "jwt" }` has no `maxAge` (defaults to 30 days for biometric data).
```typescript
session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 }
```
Confirm `lib/session.ts` cookie lifetime matches if it issues its own cookie.

**Verify:** sign in; in DevTools → Application → Cookies inspect the session cookie `Expires/Max-Age` ≈ 7 days. No unexpected logouts during a normal session.

### 0.3 — Rate-limit sensitive mutation endpoints · MEDIUM
Reuse `rateLimit(key, limit, windowMs)`; return 429 when it returns false.

| Route | Key | Limit |
|---|---|---|
| `app/api/user/password/route.ts` PATCH | `pw-change:${userId}` | 5 / hour |
| `app/api/auth/exchange-mobile-token/route.ts` | `mobile-token:${ip}` | 10 / 5 min |

Mobile-token route: log failed attempts generically (don't leak whether a token existed).

**Verify:**
```bash
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3000/api/user/password -H 'Content-Type: application/json' -d '{"current":"x","next":"y"}'; done
```
Returns 429 after the 5th within the window.

### 0.4 — Oura webhook GET constant-time compare · LOW (defense-in-depth)
**File:** `app/api/oura/webhook/route.ts` GET handler. POST already uses HMAC + `timingSafeEqual`; bring the GET `verification_token` compare to the same pattern (length-guard first, then `timingSafeEqual`).

**Verify:** GET with correct token → 200; wrong token → 403.

### 0.5 — Encrypt Oura tokens at rest · MEDIUM
**Files:** `lib/data/postgres/schema.ts` (`oura_tokens`), `lib/data/postgres/adapter.ts` (read/write), `app/api/oura/token/route.ts`.

`personal_access_token` / `access_token` / `refresh_token` are plaintext. Add AES-GCM (Node `crypto`), key from new `TOKEN_ENC_KEY` env (32-byte hex). Encrypt on write, decrypt on read; nonce-prefix ciphertext so rows lacking the prefix are detected as legacy plaintext and re-encrypted on next write. **No backwards-compat read-path beyond the one-time detection** — keep it minimal.

**Verify:** set `TOKEN_ENC_KEY`, connect Oura with a PAT, run a sync, inspect the DB column (ciphertext). Restart server; sync still works.

### 0.6 — Repository-pattern bypass · LOW
**Source:** MR S-DD-7. Routes constructing `new PostgresWorkoutRepository(...)` instead of `getRepository()`: `workout-entry/route.ts`, `exercise-gif/route.ts`, `friends/feed`, `friends/leaderboard`, `admin/exercises`, `program-week/route.ts` (plus `admin/seed-exercise-gifs`, `profile/[userId]` per MR). Move queries into repo methods or switch to `await getRepository()`. Confirm the exact route list with `grep -rn "new PostgresWorkoutRepository" app/` before editing.

**Verify:** `grep -rn "new PostgresWorkoutRepository" app/` returns nothing.

### 0.7 — AI SDK CVE bump · LOW
**Packages:** `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/react`, `ai`. Low-severity uncontrolled-resource-consumption advisory in `@ai-sdk/provider-utils <=3.0.97`. `pnpm up` these, pin, commit `package.json` + `pnpm-lock.yaml` together. The AI SDK has had breaking major bumps — pin and smoke-test rather than blind-upgrade.

**Verify:** `pnpm build` clean; AI chat and AI periodization work end-to-end on `pnpm dev`.

---

## Phase 1 — Performance Infrastructure

### 1.1 — Migration tracking table (cold-start fix) · HIGH
**File:** `lib/data/postgres/client.ts:32–46`. `ensureSchema()` re-runs all ~87 `.sql` files every boot, swallowing "already ran" errors.

Add `schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`. On boot: `SELECT filename` of applied, run only missing, record each. Keep the try/catch safety net (now only fires on genuinely new migrations). **`CONCURRENTLY` cannot be used in this runner** (no transaction guarantees per statement).

**Before/after:** capture cold-boot timing from server logs on two consecutive boots. After: second boot logs "0 migrations to apply" and is measurably faster. From-scratch `pnpm db:local` still applies all.

### 1.2 — Parallelise / batch hot adapter paths · HIGH
**File:** `lib/data/postgres/adapter.ts`.

- **a) `listPrograms()` (~675–749):** after fetching program IDs, fire sessions/exercises/schedules in `Promise.all()`.
- **b) Phase/set creation (~1072–1358):** `createPhaseSet` / `updatePhaseSet` / `saveProgressionStyle` loop single-row inserts → one multi-row `insert().values([...])`.
- **c) `listProgressionStyles()` (~1306–1326):** two queries + JS `.filter()` → single JOIN or batched `WHERE style_id IN (...)`.
- **d) `getLastExerciseLogsBatch()` (~1768–1818):** O(n·m) JS filtering → grouped query (`json_agg` or `IN (ids)` keyed by `exerciseLogId`).

**Before/after:** identical results opening a program / saving a style / logging an exercise; compare server timing logs or `EXPLAIN`.

### 1.3 — Composite indexes (migration 087) · MEDIUM
**New file:** `lib/data/postgres/migrations/087_composite_indexes.sql`. Confirm column names against `schema.ts` first.
```sql
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_started ON workout_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user_exercise_date ON exercise_logs(user_id, exercise_name, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_set_logs_exercise_log ON set_logs(exercise_log_id, set_number);
CREATE INDEX IF NOT EXISTS idx_body_metrics_user_date ON body_metrics(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sleep_sessions_user_date ON sleep_sessions(user_id, date DESC);
```
**Do NOT use `CONCURRENTLY`** — `ensureSchema` runs outside a transaction context.

**Before/after:** `EXPLAIN ANALYZE` on day-log / last-exercise / history queries on seeded local DB shows index scans replacing seq scans.

### 1.4 — next.config build optimisations · MEDIUM
**File:** `next.config.ts` (same edit as 0.1).
```typescript
poweredByHeader: false,
images: { formats: ['image/avif','image/webp'], deviceSizes: [640,750,828,1080,1200] },
```
Add static-asset cache headers in `headers()`:
```
/_next/static/(.*) → Cache-Control: public, max-age=31536000, immutable
/icons/(.*)        → Cache-Control: public, max-age=86400
```
Extend `optimizePackageImports` to any other icon/animation lib in the bundle.

**Before/after:** `pnpm build` route-JS sizes; static assets show `immutable` in DevTools.

### 1.5 — Lazy-load heavy components + motion audit · MEDIUM/HIGH
`dynamic(() => import(...), { ssr: false, loading: () => <Skeleton/> })` for: remaining non-lazy charts, config/program editors (`components/config/config-screen.tsx` sections), `components/more/friend-leaderboard.tsx`, off-critical-path sheets/modals. (`app/health/health-content.tsx` already lazy-loads 6 charts — extend the pattern.)

**Motion audit:** grep `from 'motion'` / `from 'motion/react'` across `components/`. `motion` is ~120KB — for trivial entrance animations replace with CSS `transition`/`animation`; lazy-import where unavoidable.

**Before/after:** smaller initial route JS in `pnpm build`; chart areas show skeletons (no layout shift); motion still plays where genuinely used.

### 1.6 — Scoped cache invalidation + tab loading · HIGH (biggest perceived-perf win)
Execute **Areas 2, 3, 4** as written in `docs/superpowers/plans/2026-06-28-perf-ux-activity-nutrition-fixes.md`:

- **Area 2 (home widgets):** replace `invalidateCache('')` in `components/pull-to-sync.tsx` with targeted `lib/cache-groups.ts` group invalidations; raise TTLs for `readiness-score`/`weekly-stats`/`streak-data` to `TTL_LONG`; confirm home fetches in `session-select-content.tsx` run in `Promise.all`; confirm `readCacheSync` seeds initial state.
- **Area 3 (muscle SVG):** bare `fetch('/api/muscle-recovery')` → `cachedFetch('muscle-recovery', …, TTL_LONG)`; wrap SVG in `React.memo`; `useRef` last data + background refresh; add `muscle-recovery` to `invalidateReadinessInputs()`.
- **Area 4 (training tab):** 4 bare fetches in `app/health/health-content.tsx:261–276` (training-load, sleep-correlation, weekly-stats, workout-data:meta) → `cachedFetch` seeded from `readCacheSync` (TTL 15 min); add those keys to `invalidateWorkoutSummaries()`.

**Before/after:** repeatedly switch home↔Health↔Training; widgets render instantly from cache with no skeleton flash after first load. After logging a workout/meal, data refreshes within one TTL.

### 1.7 — Connection pool sizing · LOW
**File:** `lib/data/postgres/client.ts:19` — `max: 10`. Raise to 20 in prod only (`NODE_ENV === 'production'`); check Railway Postgres connection ceiling first.

**Verify:** concurrent background syncs locally — no pool-timeout errors in logs.

---

## Phase 2 — Correctness Bugs (Wrong Data Shown Daily)

### 2.1 — Sleep data discrepancy (prefer Oura) · P1
**Source:** Area 14. Two `sleep_sessions` rows per night (Samsung Health logs in-bed time; Oura logs sleep onset); `mergeByDate` can't distinguish them and inflates duration.

Steps (full detail in source Area 14):
1. DB query to confirm two rows for the date (one `oura_id` null, one non-null).
2. `listSleepSessions` (adapter) returns `ouraId` on the `SleepSession`; add `ouraId?: string` to the type.
3. `app/api/sleep-sessions/route.ts` `mergeByDate`: if exactly one of two same-date rows has `ouraId`, treat the Oura row as authoritative for duration fields (no additive merge); only additive-merge when both rows share source type.
4. Add `ouraId` to the API response so the UI can render an "Oura verified" badge.

**Verify:** app shows ~7h 53m (matches Oura), not 8h 1m; 7-day chart no longer inflated; Samsung row preserved (display preference only).

### 2.2 — Walk-detection quality filters · P1
**Source:** Area 6. **File:** `app/api/oura/workouts/route.ts`.
```typescript
const MIN_DISTANCE_M = 500
const MIN_AVG_SPEED_KMH = 1.5
const MAX_DURATION_SEC = 3 * 3600
```
Filter out sessions failing any of: distance < 500 m, avg speed < 1.5 km/h, duration > 3 h. Compute `durationSec` once (consolidate). Confirm the `OuraWorkout` distance field name against `lib/oura/types.ts` / schema (`distanceMeters` vs `distance_meters`).

**Verify:** 0.01 km/260 min and 0.39 km/145 min sessions no longer appear as "Walk Detected"; a 3 km/40 min walk still passes.

### 2.3 — Mood log date-format bug · HIGH (silent data bug)
**Source:** Sprint 2 uplift 3.4. **Files:** `components/mood-checkin-sheet.tsx`, `components/workout/warmup-screen.tsx` (+ `session-select-content.tsx` read path per source).

These write `YYYY/MM/DD` while the API/cache reads `YYYY-MM-DD`, so mood never loads from cache. Replace with `todayInTz()` (returns `YYYY-MM-DD`). Invalidate the `mood:` cache key on save.

**Timezone rule:** while in these files, audit every nearby date string — none may use `toISOString().slice(0,10)` / `.split('T')[0]`; all must use `todayInTz()` or `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')`.

**Verify:** submit a mood check-in, reload, re-open the sheet — today's entry loads immediately from cache. `GET /api/mood?date=<dash-format>` returns the saved object.

### 2.4 — Per-session phase tracking · HIGH
**Source:** Execute the full 9-task spec as written in `docs/superpowers/plans/2026-06-17-per-session-phase-tracking.md`. Summary:

| # | Task | File(s) |
|---|---|---|
| 0 | `completeWorkout` widen `invalidateCache('workout-data:meta')` → `invalidateCache('workout-data')` | `components/workout-screen.tsx` |
| 1 | Add `countAllSessionsSinceStart(userId, programId): Promise<Map<string,number>>`; relax `getActiveProgramWithPhases` `sessionsPerCycle` guard | `lib/data/repository.ts`, `lib/data/postgres/adapter.ts` |
| 2 | workout-data session path: per-session count + `sessionsPerCycle=1`; per-session weekly frequency | `app/api/workout-data/route.ts` |
| 3 | workout-data meta path: `perSessionPhaseStatus[]` + leader phase | `app/api/workout-data/route.ts` |
| 4 | log-exercise: per-session count for phase resolution | `app/api/log-exercise/route.ts` |
| 5 | sync-workout: per-session count map, increment per new session row | `app/api/sync-workout/route.ts` |
| 6 | Home card: today's session phase from `perSessionPhaseStatus` | `app/workout-select/workout-select-content.tsx` |
| 7 | Session-select: per-session phase badge per card; leader phase in progress card | `app/session-select/session-select-content.tsx` |
| 8 | Done screen: phase-completion banner when session advances | `components/workout-screen.tsx`, `components/workout/done-screen.tsx` |
| 9 | E2E verification (Push/Pull/Legs baseline scenario) + linear-program regression | local dev |

**No hardcoded session names** — all keying off `session.name` snapshots stored in `workout_sessions.session_name`; do not introduce literals.

**Verify:** complete a Push, then log another Push — phase advances for Push only, not Pull/Legs.

### 2.5 — AI periodization "Baseline Needed" not clearing · P3 (investigate first)
**Source:** Area 5. Investigate `session_periodization` rows + whether `POST /api/ai-periodization/baseline/complete` fires after AMRAP.
- **Part A:** `app/api/ai-periodization/baseline/complete/route.ts` — allow empty `amrapResults` when `useExisting: true`; build `baseline1rm` from `personal_records` with `source:'existing'`.
- **Part B:** `components/health/ai-periodization-status-card.tsx` — "Use prior data →" label for stuck baseline sessions; POSTs `{ sessionId, useExisting: true, amrapResults: [] }` and refreshes.

**Verify:** tapping "Use prior data" moves the session to "Accum. · 0 sessions".

### 2.6 — Health Connect HRV key fix · HIGH (data never populated) · DEVICE-VERIFICATION PENDING
**Source:** H7 / N-DD-4. **File:** `lib/health-connect-sync.ts`. `'HeartRateVariabilitySdnn'` → `'HeartRateVariabilityRmssd'` in the permissions array, all `canRead.has(...)`, and `readRecords({type:...})` (3-line class). Overlaps Phase 13.1 N-DD-4.

**⚠️ Code-only here; full verification requires APK on S25 Ultra.** Do NOT tick complete in `projectOverview.md` until verified on device (note H6 may still require the native Kotlin patch — Phase 13.1).

---

## Phase 3 — Cache & Logic Polish (Sprint 2 Remainder)

| # | ID | Priority | Item | File(s) |
|---|---|---|---|---|
| 3.1 | uplift 4.2 | MEDIUM | Cross-month streak gap (resets on month boundary); align streak with achievements (1 rest-day tolerance). New/updated `/api/streak-data/route.ts` | `lib/data/repository.ts`, `adapter.ts`, `app/api/streak-data/route.ts`, `session-select-content.tsx`, `app/api/achievements/route.ts`. **Timezone rule** — streak date math must use `todayInTz`/tz-aware boundaries |
| 3.2 | uplift 4.1 | MEDIUM | Clear `ta_wc_*` sessionStorage keys on program config save (stale session cards after edit) | `lib/utils.ts`, `components/config/config-screen.tsx` |
| 3.3 | C-DD-8 | LOW | `stats-content.tsx` bare fetches → `cachedFetch` + visible error/retry state | `app/stats/stats-content.tsx:54,73,98` |
| 3.4 | C-SESSION-2 | LOW | Exercise-history N+1 uncached fetches → `cachedFetch('exercise-history:${name}', TTL_MEDIUM)` | active workout screen |
| 3.5 | L-DD-2 | LOW | Offline 1RM `reps > 30` guard in workout-screen snapshot | `components/workout-screen.tsx:438` |
| 3.6 | L-DD-3 | TRIVIAL | Drop redundant `.replace(/-/g,"/")` on already-slash date string | `components/stats/weekly-stats-hub.tsx:27` |

> Note: the 4 health-content training-tab bare fetches (uplift 3.3) are already covered by Phase 1.6 Area 4 — confirm all 4 are converted, don't double-implement.

---

## Phase 4 — UI Polish Quick Wins (Sprint 3, Frontend-Only)

All browser-verifiable, no API/DB changes; ship each as an independent commit.

| # | ID | Priority | Item | File(s) |
|---|---|---|---|---|
| 1 | uplift 1.10 | MED | `pt-safe` on chat header | `components/chat.tsx:501` |
| 2 | uplift 1.11 | MED | Back-navigation header on activity pre-screen | `components/activity/pre-activity-screen.tsx` |
| 3 | uplift 2.1 | MED | `--card-tint-pct` CSS var + `accentCardStyle` light-mode fix | `lib/utils.ts:53`, `app/globals.css` |
| 4 | uplift 2.2 | MED | Health info-button `aria-label` + touch target `p-2`→`p-2.5` (4 buttons) | `app/health/health-content.tsx:589,732,765,792` |
| 5 | U-DD-5 | LOW | `@media (prefers-reduced-motion: reduce)` global block — zero meteor + ta-marquee + weather keyframes (keep timer-ring/border-run) | `app/globals.css` |
| 6 | U-DD-4 | LOW | Chart.js ticks/gridlines use `var(--muted-foreground)`/`var(--border)`; drop `bg-white` wrapper | `components/chart-message.tsx`, `components/nutrition/weekly-nutrition-chart.tsx` |
| 7 | uplift 1.4 | LOW | Weather-chip loading skeleton (`h-[26px] w-14 rounded-full bg-muted/60 animate-pulse`) | `components/weather-chip.tsx` |
| 8 | uplift 1.3 | LOW | Activity done-screen stat tiles `bg-muted`→`bg-muted/60 border border-border` | `done-activity-screen.tsx:78,83,89,100,104,119` |
| 9 | U-DD-6 | LOW | WeeklyNutritionChart metric toggles `min-h-[40px] py-2 text-xs` (≥44dp) | `weekly-nutrition-chart.tsx:96–106` |
| 10 | U-DD-7 | TRIVIAL | `<p>`/`<div>` section titles → `<h3>` (2 locations) | `strength-progress-card.tsx:41,46`, `weekly-nutrition-chart.tsx:93` |
| 11 | U-MISC-1 | TRIVIAL | Dedupe `weeklyTarget` — import `getScheduledSessionsPerWeek` from `lib/schedule-utils` | `session-select-content.tsx:570–574` |
| 12 | uplift 1.1 | LOW | Delete dead `app/history/history-content.tsx` (H4) | `app/history/` |
| 13 | uplift 1.2 | LOW | Delete orphaned `components/nutrition/saved-meals-section.tsx` | `components/nutrition/` |
| 14 | Area 7 | MED | Completed-session visual indicator: green ring `ring-1 ring-green-500/40`, `CheckCircle2` pill badge, green tint overlay, green "Start Again" border | locate via search for `"Trained today"` (Workout-tab session card / `pre-workout-screen.tsx`) |

**Samsung WebView rule:** item 14 adds a `CheckCircle2` SVG to a session card — if that card is a home-screen card, apply Fix A (conic-gradient+mask) or Fix B (`willChange:'transform'` on the card).

---

## Phase 5 — Performance Infrastructure 2 (Sprint 4)

| # | ID | Priority | Item | File(s) |
|---|---|---|---|---|
| 1 | uplift 2.4 | MED | `getDayExerciseNames(userId, date)` repo method — lighter "done today" check than `getDayLog`. **Timezone:** the `date` default must be tz-aware | `lib/data/repository.ts`, `adapter.ts`, `workout-data/route.ts:122–135` |
| 2 | P-DD-3 | MED | Gate per-login progression-style seeding behind one `SELECT 1 … LIMIT 1`; multi-row insert only when absent (kills N+1 per login) | `lib/data/postgres/adapter.ts:171–198,247–257,360–367` |
| 3 | uplift 2.3 | MED | GPS distance O(n²)→O(n): `appendPoint` accumulates last-two-points delta only. **Before/after:** distance identical on a replayed track; profile re-render cost | `lib/stores/activity-store.ts:99–108` |
| 4 | uplift 3.1 | MED | Debounce activity-store `localStorage` writes to 2s (was every GPS point) | `lib/stores/activity-store.ts:140–145` |
| 5 | uplift 1.5 | MED | Gate `useWeather` behind `enabled` param + dedup in-flight fetches | `lib/weather/use-weather.ts`, `dynamic-background.tsx:45–56` |
| 6 | uplift 1.6 | MED | Throttle Leaflet route map re-renders to 2s + offline tile fallback message | `components/activity/activity-route-map.tsx` |
| 7 | P-DD-4 | LOW | `useMemo` BMI, BF%, weight-trend regression, energy-balance (computed inline every render) | `app/health/health-content.tsx:392–436` |

---

## Phase 6 — UI Accessibility (Sprint 6)

| # | ID | Priority | Item |
|---|---|---|---|
| 1 | U-DD-1 | MED | Migrate 4 hand-rolled nutrition sheets to Radix `<Sheet side="bottom">` + focus-trap + back-dismiss + safe-area pad. One at a time: `food-logger-sheet.tsx`, `food-library-sheet.tsx`, `quick-edit-log-sheet.tsx`, `components/ai/chat-overlay.tsx` |
| 2 | U-DD-2 | MED | Replace 11 hand-rolled `<button className="rounded-xl bg-foreground …">` in nutrition with shadcn `<Button>` |
| 3 | U-DD-3 | MED | Create `lib/ui/fetch-with-toast.ts`; replace silent `catch(() => {})` on user-initiated write paths with `toast.error(...)` (leave background reads silent) — `health-content.tsx`, `nutrition-content.tsx`, food/meal sheets |

---

## Phase 7 — Sync Code Quality (Sprint 7)

| # | ID | Priority | Item | File(s) |
|---|---|---|---|---|
| 1 | LS-3 | MED | Audit `onSaved` callers returning `id='local-pending'`; guard ID-dependent server ops | `mood-checkin-sheet.tsx`, `warmup-screen.tsx` |
| 2 | LS-2 | MED | Body-metrics Dexie fast-path — seed `metaRecent` from `LocalBodyMetric[]` synchronously before `cachedFetch` (sleep-session pattern, session 124) | `app/health/health-content.tsx` |
| 3 | LS-4 | LOW | "Sync now" in Profile > About — reset `lastSyncAt` to epoch + `pullDelta()` | `components/more/profile-tab.tsx` |
| 4 | N-DD-6 | LOW | Extract `computeRestNotificationAction(phase, restStartMs, restSec, now)` → `lib/notifications.ts` + Vitest (zero Capacitor dep) | `lib/notifications.ts` (new), `workout-screen.tsx:260–271` |
| 5 | N-DD-7 | LOW | Export `HC_READ_TYPES` + Vitest parity test (permissions array == `canRead` keys == `readRecords` types) | `lib/health-connect-sync.ts`, new test |

---

## Phase 8 — Component Breakup (Sprint 8, Tech Debt)

Each its own commit/branch; no user-visible behaviour change. Priority by line count.

| # | ID | Lines | Priority | File → approach |
|---|---|---|---|---|
| 1 | CB-1 | 2407 | HIGH | `lib/data/postgres/adapter.ts` → per-domain modules; facade delegates. Start Nutrition + Social slices |
| 2 | CB-3 | 1602 | HIGH | `app/session-select/session-select-content.tsx` → per-widget components + localStorage/persist hooks |
| 3 | CB-2 | 1639 | HIGH | `components/config/config-screen.tsx` → `ProgramEditorSheet`, `StyleEditorSheet`, `PhaseSetsSection`, `ProgramListCard`, `useStyleEditor`/`useProgramEditor` |
| 4 | CB-4 | 1342 | HIGH | `app/health/health-content.tsx` → per-card components + `useWeightTrend`/`useBmiClassification`/`useEnergyBalance` (pairs with Phase 5 P-DD-4) |
| 5 | CB-5 | 777 | MED | `components/workout-builder/builder-wizard.tsx` → per-step components under `steps/` |
| 6 | CB-6 | 775 | MED | `components/more/profile-tab.tsx` → per-section components |
| 7 | CB-7 | 802 | LOW | `components/chat.tsx` → extract `getSessionSuggestions` + weight-dial sub-UI |

---

## Phase 9 — Remaining Perf/UX (Areas 1 + 9)

### 9.1 — Mood collapsible sections (Area 1) · MEDIUM
**File:** `components/mood-checkin-sheet.tsx`. Execute spec as written in Area 1 of `docs/superpowers/plans/2026-06-28-perf-ux-activity-nutrition-fixes.md`: Energy always visible; Sore Muscles and Issues collapsed by default with `ChevronDown/Up` header rows; auto-expand when editing a log that has data in those sections; overlap warning only when Sore Muscles expanded; selection persists across collapse.

### 9.2 — Oura score chip row on home (Area 9) · MEDIUM
**New file:** `components/oura-score-chip-row.tsx`. Execute spec as written in Area 9. Four tappable pills (Readiness / Heart Rate / Sleep / Activity) from existing `readiness` state (`ouraScore`, `hrCurrent`, `sleepScore`, `activityScore`); band-tinted (≥70 green, 50–69 amber, <50 red); each `router.push('/health/readiness|heart-rate|sleep|activity')`. Render null when `readiness` is null. Place above `ReadinessCard` in `app/session-select/session-select-content.tsx` (~line 1158).

**Samsung WebView rule:** the chips render Lucide SVGs on a home card — apply Fix B (`willChange:'transform'` on the chip-row container) or a CSS `mask-image` icon approach.

---

## Phase 10 — Nav Restructure + Friends (Sprint 9, Large Feature)

**Execute the full 24-task spec as written in `docs/superpowers/plans/2026-06-08-nav-restructure-friends-system.md`.** 2–3 sessions; run when no active firefights. All locally testable (`test@local.dev`).

**Migration number correction:** the source names the migration `055_friends_and_titles.sql`, but the next free number in this codebase is `087+`. Use the **next available number at execution time** (after Phase 1.3's 087 and any earlier-shipped migrations) — do not literally create `055`.

**Delivers:** 5-tab nav (Home/Nutrition/Workout/Health/More); `/nutrition` standalone; `/workout` (session-select moved, `/session-select` redirects); `/more` (Profile/Achievements/Friends/Config); friend system (requests by email/friend-code, feed, leaderboard); achievement tier borders (bronze/silver/gold), trophy case (3 pinnable slots), equippable titles; season badges.

**Rate limiting (do in the same commit as the route):** when creating `app/api/friends/route.ts` (Task 5), add `rateLimit('friend-request:${userId}', 10, 15*60*1000)` to the POST handler. (This is Sprint 5 uplift 1.9 — the roadmap explicitly defers it to here to avoid creating the file twice.)

**Push notifications are deferred** (no service-worker push infra) — see Phase 12.4 / F-2.

---

## Phase 11 — Oura Detail Screens (Areas 10–13, Large Feature)

Build in order; start each only after the prior is stable on `main`. Full per-page detail in source Areas 10–13.

### 11.1 — Four detail pages (Area 10) · HIGH
New routes: `app/health/readiness/page.tsx`, `app/health/sleep/page.tsx`, `app/health/heart-rate/page.tsx`, `app/health/activity/page.tsx`. Shared infra first:
- Extract `ScoreArc` from `components/readiness-card.tsx` → `components/ui/score-arc.tsx`.
- `components/health/contributor-bars.tsx` (reusable labelled progress bars; readiness-card imports it).
- `components/health/detail-page-header.tsx` (sticky back-button header).

Each page: sticky header → large score arc (band colour + label) → labelled contributor bars → page-specific chart (sleep staging/7-day duration; HR day chart `components/health/hr-day-chart.tsx`; activity steps/calories from `/api/body-metadata`) → AI insight card (11.4). Fetch via `cachedFetch` seeded by `readCacheSync`. Chip row from 9.2 links in.

### 11.2 — De-duplication (Area 11) · MEDIUM
Only after 11.1 stable. Simplify (don't delete) home `ReadinessCard` (collapse contributors by default; optionally make it tappable → `/health/readiness`). Health > Body: replace inline sleep-staging + HRV charts with "Sleep detail →" / "Heart Rate →" link cards. Verify no broken links / orphaned data.

### 11.3 — Day timeline (Area 12) · HIGH
New route `app/health/timeline/page.tsx` + `GET /api/day-timeline`. API aggregates in parallel: wakeup (`sleep_sessions`), meals (`food_logs`+`meal_types`, grouped per meal type), workouts (`workout_sessions`), walks (`oura_workouts` with the Phase 2.2 filters), bedtime target (`/api/readiness-score`). Returns `TimelineEvent[]` sorted by time. Add repo methods if missing (`getWorkoutSessionsByDate`, `getOuraWorkoutsByDate`). **Timezone:** `?date` defaults to `todayInTz(tz)`. UI: vertical list, left time column, dot connector, right event card; icons Sunrise/Utensils/Dumbbell/Footprints/Moon; time `h:mm a`; `cachedFetch('day-timeline', …, 5*60)`. Link from home.

### 11.4 — Per-section AI insights (Area 13) · MEDIUM
**New migration `088_ai_health_insights.sql`** (idempotent):
```sql
CREATE TABLE IF NOT EXISTS ai_health_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  section TEXT NOT NULL,
  date DATE NOT NULL,
  insight TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, section, date)
);
```
**New route `app/api/ai/health-insight/route.ts`** POST `{ section, date, force? }`: check DB first (return cached if present & `!force`); else fetch section data, build prompt, call `gemini-3.1-flash-lite` (`maxTokens: 150`), upsert, return. **Rate limit `rateLimit('ai-insight:${userId}', 5, 60*60*1000)`** (5/hr) — applies even with `force`. Effective cache: 24h per section/date via the unique row.
**New component `components/health/ai-insight-card.tsx`** — lazy-loaded; POST on mount; skeleton while generating; "↻ Refresh" → `force=true`. Imported into each 11.1 page.
Add `getAiHealthInsight`/`upsertAiHealthInsight` to `lib/data/repository.ts` + `adapter.ts`. **Timezone:** `date` is `todayInTz(tz)`.

**Verify:** insight generates ~3s first visit; instant from DB on revisit; refresh regenerates; `>5/hr` → 429.

---

## Phase 12 — Large New Features

### 12.1 — End-of-day nutrition reminder + AI backfill (Area 8) · HIGH
Execute the 6 sub-steps as written in Area 8. Summary:
- **8a — migration `089_meal_types_required.sql`:** `ALTER TABLE meal_types ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT true;` + `mealTypes.required` in schema/adapter/`MealType` type.
- **8b — `GET /api/user/bedtime-estimate`:** avg `sleep_start` over last 14 days (tz-aware via `formatInTimeZone`/`subDays`), fallback hour 22. **Timezone:** `since` and `todayInTz(tz)` must be tz-aware.
- **8c — `scheduleEndOfDayReminder()` in `lib/meal-reminders.ts`:** notification ID `9100` ~30 min before bedtime if any `required` meal type unlogged; cancel if all logged; native-only guard.
- **8d — wire into `components/sync-provider.tsx`** meal-reminder reconcile.
- **8e — backfill deep-link:** `app/nutrition/nutrition-content.tsx` reads `?chat=backfill` → open AI chat pre-filled.
- **8f — `components/nutrition/meal-type-manager.tsx`:** "Required" toggle row.

**Verify (web):** Required toggle persists; `/nutrition?chat=backfill` opens chat pre-filled; notification calls are no-ops on web (device verification of the actual notification is Phase 13).

### 12.2 — Denormalised user_stats (F-12) · MEDIUM
New `user_stats` table (or columns on `users`) with `total_volume`/`total_sets`/`total_sessions`, updated inside `logExerciseAndSets`. Prerequisite for a single-read `/api/achievements` (removes full-table aggregate scans — P-AUDIT-2 durable fix). Idempotent migration.

### 12.3 — Exercise ID FK refactor (F-1, large) · MEDIUM
Add `exercise_id UUID FK` to `session_exercises`, `exercise_logs`, `personal_records`, `exercise_gif_cache`; backfill from `exercise_library`; brief dual-path during migration; then remove name-keying. **No backwards-compat hacks** beyond the migration window. Needs its own dedicated plan before execution.

### 12.4 — Push notifications (F-2) · MEDIUM
Service worker + server push infra; pattern from meal reminders. Scope: workout reminders + goal nudges. Requires `/api/push/subscribe`, DB subscription storage, and a trigger in the feed write path.

### 12.5 — Voice logging (F-4) · MEDIUM
Reps/weight via dictation (Gemini STT or Web Speech API) in the active workout screen.

---

## Phase 13 — Device-Only / Native (Cannot Verify in a Web Session)

**Rule:** code-only portions may be written, but flag "device-verification pending" in `projectOverview.md` and do **NOT** tick complete until verified on S25 Ultra.

### 13.1 — Health Connect native fixes
| ID | Priority | Change | File | Device check |
|---|---|---|---|---|
| N-DD-3 | MED | Add `'TotalCaloriesBurned'` to `requestPermissions` read array; gate each `aggregateRecords` behind `canRead.has('TotalCaloriesBurned')` | `lib/health-connect-sync.ts:120,258` | calories-burned populates after sync |
| N-DD-4 | MED | `'HeartRateVariabilitySdnn'` → `'HeartRateVariabilityRmssd'` (perms array, `canRead.has`, `readRecords`) — overlaps Phase 2.6 | `lib/health-connect-sync.ts:312,315` | HRV reads + lands in body-metadata |
| N-DD-5 | MED | `App.addListener('resume', …)` re-derives `remainingMs` from `store.restStartMs`, reschedules/cancels rest-timer notif | `components/workout-screen.tsx:260–271` | rest timer reconciles after suspend mid-rest |
| H6 | MED | Native Kotlin: `RecordConverter.kt` add `HeartRate`/`OxygenSaturation`/`HeartRateVariabilityRmssd` conversions; APK rebuild via `patches/@devmaxime__capacitor-health-connect.patch` | native patch | HRV/SpO₂ structured records arrive |

### 13.2 — Local-first on-device validation
- **LS-1 · HIGH:** install latest build on S25 Ultra; DevTools → IndexedDB → confirm `trainingai-local-db` with `bodyMetrics`/`moodLogs`; log a body weight → Dexie write immediate → sync push to Railway within window.
- **LS-5 · LOW (prereq LS-1 + F-13):** unify Capacitor-SQLite outbox + Dexie `mutationsOutbox` into a single `LocalStore`-backed outbox.
- **LS-6 · LOW (prereq LS-1):** nutrition food-log local-first (complex FK — defer until body-metric/mood proven on device).

### 13.3 — Workout reminders APK verification (F-3)
Already shipped in v1.45.0 (toggle + time picker, reconcile on open/resume, cancel on workout start). ⚠️ Verify on S25 Ultra, then tick in `projectOverview.md`.

---

## Phase 14 — Future Backlog (No Spec Yet)

| ID | Feature | Notes |
|---|---|---|
| F-11 | `weekly` schedule branch verification for Goals card | Workouts target not end-to-end verified (session 122 gap) |
| F-10 | Mobile token pruning | cleanup on expired-token detection |
| F-13 | APK SQLite parity (`SQLiteLocalStore`) | implements `LocalStore` via Capacitor SQLite; prereq for LS-5 |

(Lower-priority product ideas F-5–F-9 remain in the master review backlog; promote only after a spec exists.)

---

## DB Migration Reservations

Current highest: `086_oura_body_enhancements.sql`. All migrations idempotent (`IF NOT EXISTS`); **no `CONCURRENTLY`** (ensureSchema constraint).

| # | Purpose | Phase |
|---|---|---|
| `087_composite_indexes.sql` | composite indexes | 1.3 |
| `088_ai_health_insights.sql` | AI insights table | 11.4 |
| `089_meal_types_required.sql` | `meal_types.required` | 12.1 / 8a |
| `090_friends_and_titles.sql` (or next free) | friendships/seasons/friend_code/equipped_title (source says 055 — use next free) | 10 |
| `091_+` | user_stats (F-12), exercise_id FK (F-1), … | 12.2+ |

---

## Verification Checklist (apply to every item)

1. `pnpm lint` + `pnpm tsc --noEmit` clean.
2. `pnpm build` clean.
3. `pnpm db:local` + `pnpm dev`; exercise the actual changed route/UI (types alone are insufficient).
4. **Security items:** prove with `curl -sI` (headers), `curl` loop → 429 (rate limit), or cookie inspection (maxAge), or DB-column ciphertext check (token encryption).
5. **Performance items:** record before/after (cold-boot log, `EXPLAIN ANALYZE`, bundle size, or tab-switch skeleton behaviour).
6. **DB migrations:** apply cleanly on from-scratch `pnpm db:local`; `schema_migrations` (Phase 1.1) records it; no `CONCURRENTLY`.
7. **Device items:** commit, flag ⚠️ "device-verification pending" in `projectOverview.md`, do NOT tick complete.
8. **Timezone:** any new date string uses `todayInTz()` / `formatInTimeZone`, never `toISOString().slice/split`.
9. **Samsung WebView:** any new home-card SVG has Fix A or Fix B applied.

---

## Version & Changelog (every user-visible change on main)

- Bump `package.json` (patch = bug/polish, minor = feature, major = breaking).
- Add `lib/changelog.ts` entry.
- Tick the item in `projectOverview.md` on push (⚠️ inline if device-verification pending).
