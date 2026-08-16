# Wiring & Load-Performance Audit — planning session

**Date:** 2026-07-20 · **Scope:** end-to-end wiring correctness (all `app/api/*` routes, AI/health
subsystems) and load performance (caching, invalidation, TTL discipline, instant paint, render
discipline) across the whole app. Owner ask: audit is separate from and additional to the
2026-07-18 deep-app-review batch (§A–§K), whose findings have already shipped as of this session
per `docs/implementation-backlog.md`'s 2026-07-20 status banner.

**Method:** six parallel code-mapping sweeps (dead/unwired API routes across all four route
families; cache invalidation/TTL discipline; instant-paint/render discipline; AI subsystem wiring;
workout/running/progression wiring incl. re-verifying four previously-uncertain deep-review items;
nutrition + general waterfall/over-fetching), each finding verified against source with file:line
evidence. Findings already covered by the 2026-07-18 review or its shipped fix batches are not
re-raised.

---

## 1. Cache staleness — real, user-visible (HIGH)

### 1.1 `achievements:` cache group missing from two writers whose data feeds it
`computeAchievements()` (`lib/achievements.ts:77-160`) reads `food_logs`/`nutrition_targets`
(food-streak, calorie-target achievements) and `body_metrics` (weight/step achievements). Neither
`invalidateNutritionWrite()` (`lib/cache-groups.ts:319-337`) nor `invalidateBodyMetricWrite()`
(`lib/cache-groups.ts:233-244`) invalidates `achievements:` — while `invalidateActivityWrites()`
(`lib/cache-groups.ts:192-214`) correctly does, for the identical dependency shape
(`activity_logs` → achievements). Logging a meal or a weight/step entry doesn't refresh an
already-open Profile achievements card until the 5-minute TTL lapses.

### 1.2 `supplements` cache key holds "today's" status with no date embed / no read guard
`SupplementWithStatus.loggedToday` (`lib/types/supplement.ts:13-15`) carries no date field; the
cache key is the bare literal `'supplements'`, fetched with plain `cachedFetch` (not
`cachedFetchToday`) at 30-min TTL. The seed-read in `app/nutrition/nutrition-content.tsx:105-113`
has no freshness guard (contrast the `body-metadata` seed four lines above it, which correctly
checks `isBodyMetadataFresh`). A supplement checked off late at night paints as "already taken"
on first load the next day — worse, indefinitely offline (`OFFLINE_SEED_TTL_FLOOR` = 7 days).
Writes correctly invalidate (`invalidateSupplements()`), so this is a read-time gap only.

### 1.3 `body-battery` TTL has no named constant (cosmetic, LOW)
Used at 3 sites (`session-select-content.tsx:697-700`, `sync-provider.tsx:357`,
`end-of-day-review.tsx:75`) via raw `TTL_SHORT` instead of a named constant, inconsistent with
every other multi-site "today" key in `lib/cache-ttl.ts`. No observed drift; fix while touched.

---

## 2. Render discipline (HIGH + MEDIUM)

### 2.1 Workout orchestrator's broad `useShallow` pick includes hot-path fields
`components/workout-screen.tsx:104-178`'s single `useShallow` selector includes `reps`,
`setWeights`, `lapTimes`, `restTimes` alongside ~20 other fields. Every weight-dial tick
(`handleWeightChange`, line 927) or rep change re-renders the entire 1680-line orchestrator —
exactly the pattern CLAUDE.md's render-discipline rule names verbatim. `SetCard` itself is
already correctly memoed with stabilized props; the bug is one level up, at the subscription.

### 2.2 `useState` lazy-initializer cache reads (hydration-mismatch pattern)
Three sites read `readCacheSync` inside a `useState(() => ...)` initializer instead of
`useEffect`/`useLayoutEffect` — the exact pattern CLAUDE.md bans (session 165):
`components/more/friend-leaderboard.tsx:33-35`, `components/more/friend-feed.tsx:59-61`,
`app/health/heart-rate/page.tsx:24-29` (`hrReadings`/`sleepWindow` only — `data`/`trends` in the
same file are correctly seeded elsewhere).

### 2.3 Achievements card shows a spinner instead of instant-paint
`components/more/profile-tab.tsx:101,205` seeds from `readCacheSync` inside a plain `useEffect`
(not `useLayoutEffect`), so `AchievementsSection`'s `Loader2` spinner renders for one frame even
with a warm cache — same bug class as the already-fixed Health-tab skeletons.

### 2.4 Minor: `key={index}` in a reorderable list
`components/workout-builder/builder-review.tsx:504` keys exercise rows by index while
`moveExercise`/`swapExercise` reorder in place. Low actual impact (no uncontrolled per-row input
state), fix opportunistically.

### 2.5 New unnamed hotspot approaching the 800-line guidance
`components/workout/active-workout-screen.tsx` is now 814 lines (confirmed `wc -l`), not on
CLAUDE.md's named hotspot list. Advisory only — recorded as a Known Issue, not a fix (no single
extraction is obviously correct yet; watch it).

---

## 3. AI subsystem wiring (HIGH + MEDIUM)

### 3.1 LLM self-reported confidence drives an auto-apply safety gate
`app/api/workout-review/session/[sessionId]/apply/route.ts:19,107` stores the client-supplied
`body.confidence` (sourced from the workout-review `generateObject` call's own `parsed.confidence`)
directly into `AiPrescription.confidence`. This is the same field
`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:446-449` deliberately fills with
the *deterministic* `signals.confidence`, with an explicit comment that a hallucinated score must
never gate auto-apply. `components/workout/ai-prescription-card.tsx:59` reads this field to decide
whether the mandatory low-confidence confirmation checkbox appears — so after a Workout Review
apply, that safety gate is driven by the model's own self-assessment instead of the engine score,
violating CLAUDE.md's "no LLM self-reported number may gate an automatic action" rule verbatim.
The route also never sets `confidenceReasons`, so when the gate does trigger the card shows a bare
percentage with no explanation.

### 3.2 session-explain reads the dead frozen Oura Cloud column, not `live-readiness`
`lib/data/postgres/adapter.ts:1628` (`signals.ouraReadiness: ouraToday?.readinessScore ?? null`)
reads the raw `oura_daily` Cloud row directly, bypassing `liveReadinessForDay` — even though three
lines earlier (`:1612`) the *scoring* engine correctly reads `liveReadinessForDay`. This value
flows into the "Why this?" page (`lib/session-explain/group-signals.ts:47-48`) and the
`session-explain/insight` LLM prompt (`app/api/session-explain/insight/route.ts:60`), so post-re-key
the explain narration always says "no data"/"not connected" even when a real BLE composite existed
and was the very number used to compute the recommendation being explained. A 6th AI-adjacent
surface the P3 readiness cutover missed.

### 3.3 next-session ignores prescription expiry when filtering dropped exercises
`app/api/next-session/route.ts:18-27` filters by `droppedExerciseIds` gated only on
`prescriptionDrivesLoad(...)`, never checking `prescriptionExpiresAt` the way
`app/api/workout-data/route.ts:222-226` does. After a Workout Review "drop this cycle" prescription
(7-day expiry) goes stale, the home card keeps showing the reduced exercise count/duration while
the workout screen has already reverted to the full list. Low severity (self-heals on next
completion) but a real, verifiable cross-surface inconsistency.

---

## 4. Deload correctness (HIGH + MEDIUM)

### 4.1 "Confirm early deload" never actually reduces training load
`isDeloadActive()` (`lib/phase-engine.ts:109-118`) returns true both for a real `phaseType==='deload'`
phase and for the 7-day `program.earlyDeloadWeekStart` window set by
`POST /api/confirm-early-deload`. But `currentPhase` (`app/api/workout-data/route.ts:167-172`,
consumed by `resolveStyleForExercise`) is the *natural* phase from `getCurrentPhase`, unaffected by
`earlyDeloadWeekStart` — so a manually-confirmed early deload never swaps in a lighter style; full
normal-phase weights/reps/sets keep being prescribed. Every consumer of `isDeloadActive` only uses
it to suppress PR writes and render a banner. The home card's copy
(`components/home/early-deload-card.tsx:23-36`, "Take deload week now") promises an actual deload
the code doesn't deliver — a real product-behavior gap (present since the original design, not a
regression) that directly contradicts current UI copy.

### 4.2 Emergency-deload can trigger on the session that just completed (E2-3, re-verified still open)
`lib/ai-periodization/signals.ts:235-238` still computes `hoursSinceLastSession` from the most
recent completed session with no exclusion of the one that just triggered `/prescribe` (fired
immediately after completion by `complete-workout/route.ts:44-52`), so `hoursSinceLastSession ≈ 0`
by construction and can spuriously satisfy `shouldTriggerEmergencyDeload`'s `<36h` condition. This
was flagged in the 2026-07-18 review and explicitly deferred as a Phase-2 prerequisite, not shipped
— re-confirmed still live against current `main`.

**Re-verified as genuinely fixed (no action needed):** E2-8 (running-gate provisional flag),
E2-9 (HRR1 structurally null), E2-10 ("end test early" VO2max poisoning) — all three now correctly
implemented in `app/api/running-plan/route.ts`, `lib/health/fitness-tests.ts`, and
`components/fitness-tests/test-result.tsx` respectively.

---

## 5. Dead routes / dead fields (HIGH + MEDIUM + LOW)

| # | Finding | File:line | Severity |
|---|---|---|---|
| 5.1 | Leaderboard "Streak" tab is a fully-wired UI feature backed by a route that hardcodes `weeklyStreak`/`allTimeStreak` to `0` | `app/api/friends/leaderboard/route.ts:75,78` | **High** — user-visible fake data |
| 5.2 | `app/api/sync-workout/route.ts` — entire route has zero callers anywhere in the repo (grepped app/components/lib/android), yet received real bug-fix effort *today* (commit `30200c0`, WK-15) | whole file | **Medium** — wasted maintenance on unreachable code |
| 5.3 | `app/api/running-plan/explain/route.ts` — built (Gemini narration) but never fetched; `prescribed-run-card.tsx` renders the raw deterministic `rationale`/`gateReasons` instead | `components/running/prescribed-run-card.tsx:32,52,54-67` | Medium |
| 5.4 | `GET /api/program-phases` — its own comment claims callers that don't exist; every real caller (`workout-data`, `weights-summary`, `readiness-score`, `nutrition-goals/recommend`, `program-week`, `sync-workout`, `daily-digest`) calls `repo.listProgramPhases()` directly | `app/api/program-phases/route.ts` | Medium |
| 5.5 | `AiPrescription.weeklyVolumeContribution` computed + persisted, never rendered by `ai-prescription-card.tsx` | `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:84-92,100,414-423,443` | Medium |
| 5.6 | `readiness-score` route ships `ownReadinessContributors`/`recoveryIndexHours`/`baselineNights` every response; only consumer nulls them out in a cache-fallback placeholder | `app/api/readiness-score/route.ts:443-445` | Low/Medium |
| 5.7 | `ExerciseHistoryEntry.sessionName`/`.isDeload` computed with a join, never rendered (no deload badge exists) | `app/api/exercise-history/route.ts:41-51` | Low/Medium |
| 5.8 | workout-review POST response `.phase` field typed, stored, never read | `app/api/workout-review/session/[sessionId]/route.ts:142` | Low |

**Swept and confirmed clean (~65 routes across sync/stats/workout/nutrition/body/admin families):**
nutrition/food/supplements (20 routes), `sync/pull`, `sync/push`, `sync-health`, `calendar-data`,
`day-log`, `day-timeline`, `complete-workout`, `log-exercise`, `next-session`, `workout-data`,
`workout-sessions*`, `health-trends` vs `health/trends` (confirmed NOT duplicates — different
payloads, both wired), `muscle-recovery`, `training-load`, `weekly-stats`, `running-plan`,
`hr-profile`, and the full body/health/social/admin family. `hr-ingest`, `status`, `version`,
`client-error`, `download-apk`, `auth/*` confirmed as intentional non-UI-triggered infra routes,
not dead.

---

## 6. Nutrition & offline-first (MEDIUM + LOW)

### 6.1 Food-item search/reuse is server-only despite the domain writing locally
`components/nutrition/food-library-sheet.tsx:39-48` and `saved-meals-sheet.tsx:93-103` search via
`cachedFetch`/bare `fetch` only. `lib/local-store/index.ts` has `upsertFoodItem` (write) but no
`getFoodItems`/`searchFoodItems` read method, so a previously-logged food can't be browsed/reused
offline even though the write path (`lib/nutrition/log-food.ts:199-206`) upserts it locally
specifically to support offline reads. A real, partial recurrence of the `food_items` incident
CLAUDE.md documents — new-food logging works offline, but the primary "quick re-log a usual meal"
path doesn't.

### 6.2 Duplicate BMR + age-from-DOB formulas
Canonical Mifflin-St Jeor + `SEX_OFFSET` (`lib/nutrition/goal-recommendation.ts:24,48-56`) has an
independent second copy in `app/health/hooks/use-health-calcs.ts:52-53` (inline re-hardcoded sex
offsets), feeding the health-page energy-balance widget. Age-from-DOB arithmetic is also
duplicated verbatim between `use-health-calcs.ts:47-49` and
`app/api/nutrition-goals/recommend/route.ts:188`. No observed drift today (constants currently
match) — exactly the shape of the 1RM/weekly-cadence incidents CLAUDE.md's One-Formula rule
exists to prevent.

### 6.3 Banned ms-offset date pattern (currently harmless)
`app/api/nutrition/weekly-summary/route.ts:13` uses `Date.now() - 6 * 86_400_000` instead of
`shiftDateStr(today, -6)` (used correctly by the sibling `adherence` route). Numerically
equivalent under fixed-offset AEST today — no observed bug — but it's the exact pattern that bit
`lib/ai-chat/tools.ts` six times per CLAUDE.md's own history.

**Nutrition write paths, N+1s, and over-fetching:** all checked clean — every reachable write uses
the store+outbox pattern or shows a toast on failure; no N+1 query patterns found in
`slices/nutrition.ts`; `nutrition-content.tsx`'s mount fetches are already correctly batched
(PERF-5).

---

## 7. Priority map

| # | Finding | Severity | Queue status |
|---|---|---|---|
| 1.1/1.2/1.3 | Cache staleness (achievements group, supplements date-guard, body-battery TTL) | High/Low | **new — Plan: cache-staleness-fixes** |
| 2.1 | Workout-screen hot-path selector re-render | High | **new — Plan: workout-screen-render-perf** |
| 2.2/2.3/2.4 | Hydration-mismatch cache reads + spinner flash + index-key | Medium/Low | **new — Plan: cache-seed-hydration-fixes** |
| 2.5 | active-workout-screen.tsx new hotspot | Low | Known-Issues row (advisory only) |
| 3.1/3.2/3.3 | AI safety-gate leak, session-explain dead source, next-session expiry gap | High/Medium/Low | **new — Plan: ai-wiring-safety-fixes** |
| 4.1/4.2 | Early-deload doesn't reduce load; emergency-deload self-trigger | High/Medium | **new — Plan: deload-correctness-fixes** |
| 5.1–5.8 | Dead routes/fields batch | High→Low | **new — Plan: dead-route-field-cleanup** |
| 6.1/6.2/6.3 | Nutrition offline-first + formula dup + date pattern | Medium/Low | **new — Plan: nutrition-offline-formula-fixes** |

## 8. Not exercised / verify at implementation

Static code review only — no on-device timing or APK smoke run this session. Per CLAUDE.md,
render-discipline and cache-hydration claims for APK surfaces (workout screen re-render feel,
achievements-card paint) are only truly judged on the S25 device; each linked plan's verification
section names the device-smoke gate explicitly. The sync/stats/misc and AI/program/schedule route
groups received a full pass (all ~85 routes now covered cumulatively across this review and the
2026-07-18 one); nothing was left unaudited.
