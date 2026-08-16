# TrainingAI — Post-Update Bug Review (2026-07-04)

Two-part review of the last ~2 days of merges (PRs #146–#193), run as 8 parallel review passes:
**Part 1** — cache correctness · safe-area · timezone/dates · recent-diff bug hunt.
**Part 2** — offline-sync parity · render/Zustand discipline · UI conventions/light mode · formulas + AI/security.

All findings verified against `main` @ 4f45708 by reading the code (file:line cited). Nothing has been fixed yet.

---

## CRITICAL / HIGH (13)

### Cache & data loading

**C1. `weekly-stats` cache written in two incompatible shapes → Stats screen crash.**
Health uses `cachedFetchToday` (stores `{date, data}` envelope) — `app/health/health-content.tsx:341`. Stats uses plain `readCacheSync`/`cachedFetch` — `app/stats/stats-content.tsx:50,68` — and `components/stats/weekly-stats-hub.tsx:33` does `data.days.map(...)` on whatever it gets. Open Health then Stats → truthy envelope, `data.days` undefined → TypeError. The two sites also permanently overwrite each other's shape. Compounding: `components/sync-provider.tsx:22-45` warm-caches **raw** payloads for 4 envelope keys (`weekly-stats`, `progress-summary`, `readiness-score`, `training-load`) — readers reject them as misses, so the cold-start warm round-trip is wasted and it's a third shape-writer.

**C2. `workout-card:*` is a 6h `freshWithinTtl` key that program writes never invalidate.**
Only invalidation: the just-logged session (`components/workout-screen.tsx:700`). Missed writers: config/program saves, builder saves (`components/workout-builder/builder-review.tsx:370`), progression-style edits (`components/config-screen.tsx:193,215`), workout-entry edits (`app/stats/stats-content.tsx:130,148`), cross-device pulls (`components/sync-provider.tsx:104`). `invalidateProgramStructure()` clears `workout-data*` but not `workout-card:` (`lib/cache-groups.ts:66-75`). `freshWithinTtl` skips the network entirely → an edited program shows the old/deleted exercise list for up to 6h with **no SWR correction**. Also `invalidateWorkoutCardCache()` (`lib/utils.ts:32`) never clears the SQLite layer — on the APK the staleness persists even where it is called.

**C3. PR #192's workout-card fallback seed is dead in the flow it targeted.**
`components/workout-screen.tsx:194` reads `workout-card:${sessionType}` where `sessionType` = raw `?session=` param. Home's recommendation card (`recommendation-card.tsx:272,288`) and Overview (`components/overview-screen.tsx:168,175`) navigate by session **name**; all cache writers key by session **id**. Seed only fires from workout-select — where it becomes C2's stale-paint vector. Fix: standardise `?session=<id>` (also fixes a flagged pre-existing inconsistency).

### Safe-area

**C4. AI chat FAB painted under the bottom nav on Home.**
`components/ai-chat-overlay.tsx:166` — `fixed bottom-6 right-6 z-50`; nav is also z-50, later in DOM, 56px + inset tall. On the S25 the FAB is fully covered. Present since PR #144; both safe-area passes missed it (CI only greps the literal `safe-area-inset` string).

### Offline sync (data loss)

**C5. Workout completion has no offline path — completedAt + phase counter silently lost.**
`components/workout-screen.tsx:857-861` — bare `fetch("/api/complete-workout").catch(() => {})`. No local write, no outbox domain, no pushMutations branch. The route carries heavy side effects (complete session, consume prescription, `incrementSessionsInPhase`, AI prescribe). Finish a workout in a no-signal gym → never marked complete, permanently.

**C6. GPS run detail discarded on every on-device save.**
`components/activity/done-activity-screen.tsx:111-140` — the local-store path's `queueMutation` payload omits `routePolyline`/`splits`/`bestEfforts`/`paceSeries`/`avgPace`/elevation; local `activity_logs` has no columns for them (`lib/sqlite/migrations.ts:244-252`); the push branch doesn't accept them (`adapter.ts:2936-2984`). `savedLocally` short-circuits before the web fallback that does send them → route/pace/elevation lost, not stored anywhere.

**C7. Single-field body-metric saves null out the rest of today's local row.**
`components/health/metric-log-sheet.tsx:62-78` and `session-select-content.tsx:751-768` call `store.upsertBodyMetric` with all other fields `null`; local upsert overwrites all columns (`lib/local-store/sqlite-backend.ts:459-480`). Server merges via COALESCE, local doesn't — and local is the read source of truth. Log weight at night → today's steps/water/macros/HRV vanish from Health. The applyDelta `sync_status='synced'` gate blocks self-repair while pending. Correct read-merge pattern exists: `components/profile/water-log-sheet.tsx:33-51`.

**C8. Deletes never propagate cross-device (tombstone branches are dead code).**
Postgres has `deleted_at` only on `body_metrics`/`mood_logs`/`day_checkins`; food logs, activities, supplements, injuries, workouts hard-DELETE (`adapter.ts:2861,1778,3177,…`) and `getSyncDelta` never emits `deletedAt` for them — yet the client maps it and `applyDelta` has delete branches that can never fire (`sync-engine.ts:114,133,151,282,302,315`; `sqlite-backend.ts:634-637,657,687,869,892,912`). Delete a food log on web → the phone renders it forever (local-first reads).

### Formulas

**C9. ACWR: two computations + four band-threshold sets live simultaneously.**
Canonical `computeVolumeAcwr` (`lib/ai-periodization/acwr.ts:15-46`, tz-midnight anchored, real-span divisor, deloads included) vs `app/api/training-load/route.ts:24-79` inline copy (rolling `Date.now()−N×86400000` windows — also the forbidden date pattern; flat ÷4 divisor the canonical file explicitly calls out; deloads excluded from chronic only). Bands: route `>1.5/>1.3/<0.5`; home widget **re-derives** `<0.8 Undertraining/<1.3/<1.5` ignoring the route's `interpretation` (`components/home/home-card-widget.tsx:259-260`); Health explainer says "below 0.8 = detraining" while its route reports low only <0.5 (`health-sections.tsx:786-792`); readiness modifier uses <0.6 (`readiness-score/route.ts:61-64`). Same ACWR value can show "Optimal" on Health and "Undertraining" on Home simultaneously.

### Light mode

**C10. DetailHero decorations paint their own full-bleed dark skies — light mode muddy on Readiness & Activity heroes; moon cutout renders as navy disc on Sleep.**
`components/health/detail-hero.tsx:78` (moon cutout `fill="#060620"`), `:92-114` (Readiness `sunriseSky` full-bleed dark rect), `:150-174` (Activity dusk sky, `#0a0820` mountains). The 0.4-opacity dim wrapper doesn't fix a full-bleed dark rect over a pastel gradient — it renders muddy grey and defeats PR #183's light variants entirely.

**C11. HR chart line defaults to white — invisible in light theme on both surfaces.**
`components/health/hr-day-chart.tsx:140` default `rgba(255,255,255,0.75)`, caller passes no color (`oura-section.tsx:146`); `components/home/home-card-widget.tsx:310` maps the "transparent" card color to the same white.

### Render

**C12. Orchestrator-wide `useShallow` pick includes hot-path dial/RPE fields.**
`components/workout-screen.tsx:69-135` — the 1,077-line orchestrator subscribes to `perSetWeights`, `rpeValues`, `currentSet`, `workoutPhase`, etc. in one pick. Every weight-dial detent / RPE tap re-renders the orchestrator **plus** the un-memoized 749-line `ActiveWorkoutScreen`. (SetCard's memo holds — #160's fixes verified intact.)

**C13. 1 Hz self-tick blast radius in ActiveWorkoutScreen (known open item, now quantified).**
`active-workout-screen.tsx:83-84` — two `useElapsedSec` hooks tick the whole 749-line component. At 1 Hz: full sets grid re-maps; `Live1rmReadout` (`:672-679`) recomputes 1RM from freshly-built array props; `MuscleHeatmap` (`:455-461`) re-renders the full-body SVG with a new inline array — on the compositor-sensitive Samsung WebView surface. #192 did not worsen it.

---

## MEDIUM (28)

### Cache & data loading
- **M1.** Bare `health-trends` key (5 F6 consumers) in no invalidation group — groups invalidate the prefix `health-trends:` which belongs to a *different route* (`/api/health-trends?view=`); prefix match misses the colon-less key (`lib/cache-groups.ts:35,114,158` vs `workout-density-card.tsx:15` et al). Workouts/food/Oura syncs never clear the new sparklines.
- **M2.** `invalidateNutritionWrite()` missing `home-day-timeline` (`cache-groups.ts:164-171`; timeline renders meals) — log lunch → Home timeline first-paints without it. Session-173's exact class.
- **M3.** `home-day-timeline` holds today's data with no date guard, plain `cachedFetch` (`components/home-day-timeline.tsx:210-215`) — 6am paint shows yesterday's meals/workout/sleep.
- **M4.** `body-metadata` today-guard exists on the seed but not the `cachedFetch` onData hit path at 3 sites (`session-select-content.tsx:363`, `health-content.tsx:306`, `nutrition-content.tsx:202`) — 6am Health shows last night's steps/water.
- **M5.** Cross-device pulls invalidate nothing for food/supplements/activities/injuries/Oura/day-checkins — `pullDelta` applies them but `domains` reports only biometrics/programs/workouts (`sync-engine.ts:347-362`; `sync-provider.tsx:103-105`).
- **M6.** TTL divergence regressed same week as the fix: `next-session` 60s (`workout-select-content.tsx:148`) vs 300s elsewhere; `exercise-history:` SHORT vs MEDIUM (`exercise-stats-sheet.tsx:61` vs `exercise-history-sheet.tsx:66`). Neither has a `lib/cache-ttl.ts` constant.
- **M7.** Hand-rolled invalidation lists drifted: style save/delete misses `next-session`/`workout-card:` (`config-screen.tsx:193,215`); body-metric write sites vs `invalidateBodyMetricWrite()` disagree on `day-log:`/`progress-summary`; builder saves miss `phase-sets` (`builder-review.tsx:324`).
- **M8.** `ta_meta_v1`/`ta_recommendation_v1` legacy seeds cleared only by `invalidateWorkoutSummaries()` — rename/delete a session in Config → Home first-paints the old list.

### Safe-area
- **M9.** Chat history drawer (`side="left"`) gets no insets — header under status bar, "New Chat" footer under gesture bar (`components/chat.tsx:508-541`). Only `side="bottom"` bakes padding.
- **M10.** Doubled bottom inset in 6 bottom sheets — `p-0` does NOT strip the baked `pb-safe-action` (verified: tailwind-merge doesn't know custom classes): `manage-friends-sheet.tsx:84`, `title-picker-sheet.tsx:48`, `activity-icon-picker-sheet.tsx:38`, `add-exercise-sheet.tsx:204`, `nutrition-content.tsx:454`, `food-logger-sheet.tsx:282,293,333`.
- **M11.** `pt-safe` on a bottom sheet — ~44-60px dead top padding on device (`activity-detail-sheet.tsx:57`).
- **M12.** Barcode-scanner full-screen overlay hardcodes `pt-12 pb-16` instead of `--safe-top`/`--safe-bottom` (`barcode-scanner.tsx:152`).

### Timezone / dates
- **M13.** `/api/training-load` windows anchored at `Date.now() − N×24h` (`route.ts:24-25`) — ACWR value/band drifts during the day with no new data. PR #185 rewrote these lines and kept the bug. (Merges into the C9 consolidation.)
- **M14.** `hr-day-chart.tsx:121-122` builds midnight in **device** tz against profile-tz windowed data; repo day-window queries (`getDayLog`, `getDayExerciseNames`, `getDaySessionSummaries`, `getUnsyncedHrSessionsForDay` — `adapter.ts:1008-1043`, `slices/oura.ts:427-430`) hardcode Brisbane, ignoring `session.user.timezone`. Three different midnights can be in play for one chart.
- **M15.** Client "today" computed two ways in the same files — `todayInTz()` vs device `Intl.DateTimeFormat()` (`home-card-widget.tsx:169-171`, `session-select-content.tsx:85-93,232-233,256-278`) — keys/guards disagree when device tz ≠ profile tz.

### Offline sync
- **M16.** Push loop: any non-OK response `break`s the queue; only ≥500 backs off. A persistent 413/429 wedges everything behind it, retried with zero backoff, never dead-lettered (`sync-engine.ts:443-449`). `/api/sync/push` also has no rate limit.
- **M17.** `onConflictDoUpdate` arms not user-scoped: food_logs (`adapter.ts:2883-2886`), supplements (`2923-2933`), activity id-path (`2979-2983`), injuries (`3004-3012`); `supplement_logs` insert never verifies supplement ownership. Plain UPDATE/DELETEs are all scoped — the gap is exclusively the conflict arms.
- **M18.** `ensureWorkoutSession` existing-row path selects by id only, no ownership check (`adapter.ts:660-663`) — crafted `workoutSessionId` appends logs to another user's session (web + push).
- **M19.** `setSessionRpe` local write doesn't flip `sync_status` to pending (`sqlite-backend.ts:331-336`) — a pull arriving before the outbox mutation re-nulls the RPE just tapped (session-167 class).
- **M20.** Web/push parity drift: supplements delete = hard DELETE on web vs soft `active=false` on push (`adapter.ts:3177` vs `2909`); activity same-minute conflict = existing-wins on web vs incoming-wins on push (`1568-1599` vs `2972-2977`).
- **M21.** Saved-meal logging never mirrors `food_items` locally (`lib/nutrition/log-meal.ts:17-31`, unlike `log-food.ts:176-184`) — the original food-disappearing mechanism; and `createFoodItem` is network-mandatory, so logging any new food fails entirely offline.
- **M22.** Stranded-workout replay loses `exerciseDeloaded`/`intensityMode`/`wasOverride` (`lib/local-store/sync-helpers.ts:53-86` — local tables don't store them) → deload replays can set inflated PRs, the exact bug the flag prevents.
- **M23.** `markWorkoutSynced` flips the whole session on any one exercise's success (`workout-screen.tsx:686`; `sqlite-backend.ts:338-352`) — a failed sibling exercise becomes invisible to the stranded sweep and dead-letters unrecoverably.

### UI / light mode / conventions
- **M24.** End-of-Day sheet light-mode: save footer `bg-black/30` (`end-of-day-review.tsx:216`); scale digits `#ffffffcc` on pale tints (`scale-selector.tsx:17`) — unreadable in light theme.
- **M25.** Macro palette defined 4× with **two different colour schemes** — nutrition trio green/blue/orange (`macro-ring.tsx:55-57`, `day-summary-card.tsx:11`, `meal-card.tsx:~335`) vs Home neon `#00ff87/#00d4ff/#bf5fff` (`home-card-widget.tsx:154-157`). Protein/carbs/fat colours contradict across screens. Needs one `MACRO_COLORS` in `lib/`.
- **M26.** Light-theme users get a full-screen dark-gradient flash on every navigation to the 4 health detail pages — `useHeroColorScheme` returns "dark" until after mount (`detail-hero.tsx:15-20`; roots paint `PAGE_GRADIENTS[...].dark` first frame).
- **M27.** Sore-muscle picker duplicated into `wellness-section.tsx:6-60` (copy of `mood-checkin-sheet.tsx`) and regressed the token to raw `#ff6a1a`; `MUSCLE_GROUPS` const now defined 5×.
- **M28.** Hypnogram time-axis misaligned on merged nights — ribbon x-positions come from the Oura phase window but hour labels span the merged row's extended `sleepStart→sleepEnd` (Samsung earlier in-bed / split nights keep only the first phase string) — stages can render ~1.5h off (`app/api/sleep-sessions/route.ts` mergeByDate vs `hypnogram.tsx:54-61`).

### Misc medium
- **M29.** Session-202 silent-empty cards still unaddressed — `cachedFetch` swallows `!res.ok` incl. `/api/health/trends`' own 10/min limit (now 5 consumers); F6 cards render `null` with no error/retry. Third time flagged.
- **M30.** TrendSparkline delta chip: up=green for every field incl. RHR (rising RHR shows green ▲, `heart-rate/page.tsx:74`); `Math.round` makes protein/kg & density deltas read "same as last week" almost always (`trend-sparkline.tsx:49-52`).
- **M31.** 1RM duplicate: `exercise-stats-sheet.tsx:113-115` uses pure Epley while `lib/1rm.ts` averages Epley+Brzycki — the "Match 1RM" rep target disagrees with what logging those reps actually saves.
- **M32.** Volume/avgReps/intensity-pct formulas duplicated verbatim across `lib/workout/log-exercise.ts:157-178`, `app/api/workout-entry/route.ts:51-74`, `adapter.ts:128-141` (lbs-fix) — agree today, will desync on any change. New `avgReps()` in pre-workout rounds to integer vs stored 1-dp.
- **M33.** `useCountUp` flashes final value → 0 → counts up when target is cache-seeded at mount; target changes re-animate from 0 (`lib/hooks/use-count-up.ts:13-33`). Also runs at screen level in DoneScreen (`done-screen.tsx:137`) — whole done tree re-renders at ~60fps during the confetti burst.
- **M34.** TabSwipeNavigator: no mid-gesture direction lock (touchend-only `|dx|>|dy|`), and only excludes `[data-swipe-carousel]` — Home's edge-adjacent `overflow-x-auto` metric tiles can scroll *and* switch tabs on finger-up (`tab-swipe-navigator.tsx:33-53`; `metric-tiles-card.tsx:51`). Never captures/preventDefaults, so can't swallow scrolling (the worst mode is avoided).
- **M35.** `activity-store` persists with no `partialize`/`onRehydrateStorage` — `mode:'done'`, `isPaused`, `draftSummary`, `startMs` survive reload indefinitely; a killed app restores a stale done screen days later (`lib/stores/activity-store.ts:96-170`).
- **M36.** Oura webhook does the DB lookup on the **unverified** body before HMAC verification — 200 vs 403 difference is a connected-user enumeration oracle (`app/api/oura/webhook/route.ts:50-62`). Verification itself is fail-closed.
- **M37.** Health Connect ingest has no Zod schema — numeric fields flow to the DB driver unvalidated (`app/api/health-connect/ingest/route.ts:36-70`).
- **M38.** `generateText` unguarded (no try-catch → framework 500 instead of JSON error): `ai/health-insight/route.ts:106-109`, `weekly-digest/route.ts:148-152`.

---

## LOW (~25, condensed)

**Cache:** `body-battery` in no group (mitigated: SHORT TTL + date guard) · F6 cards + `oura-section` seed caches in `useState` lazy initializers (banned pattern; safe only via ssr:false today) — same pattern SSR'd and genuinely mismatch-exposed in `session-select-content.tsx:122-158` (pre-existing) · completing session A leaves other sessions' `workout-card` phaseStatus stale 6h.

**Safe-area:** dead/redundant `pb-safe` on 4 SheetContents · `BottomActionBar` `aboveNav` variant doesn't clear the nav's inset (latent, zero consumers) · CI greps miss reversed-order stacking, `pb-*` combos, `p-*` shorthands, and hardcoded-pixel overlays · `pt-safe`/`pt-safe-or-4` byte-identical duplicates · `admin-content.tsx:149` `p-6 pt-safe pb-nav-safe` works only by CSS definition order.

**Dates:** `getDaySessionSummaries` silently requires `YYYY/MM/DD` slash format (`adapter.ts:1041`) — natural `YYYY-MM-DD` → Invalid Date → empty result · `DEFAULT_TZ` re-declared locally in `day-log/route.ts:8` and `bedtime-estimate/route.ts:8` · `daysSinceStart` rolling-hours count in training-load:59 · hypnogram/sleep hour labels render in device tz (`hypnogram.tsx:22`, `sleep-content.tsx:47`).

**Sync:** validation drift (quantityMultiplier unbounded on push; injury severity unvalidated; web mood forces server-today while push honours `mut.date`) · pull-backoff counter not reset on partial-success exit (`sync-engine.ts:384`) · local `activity_logs` missing `notes`/`end_time`, `body_metrics` missing `distance_km` in pull mapping · `caloriesBurned` "hydrates on next sync" comment is false — nothing computes it for manual activities · `check-reconcile.js` can't catch columns added by editing base CREATE TABLE constants.

**Health/metrics:** `wornHours` assumes complete 86,400s day — wear-time inflates toward 24h intraday, `isLowWearToday` under-flags until evening (`wear-confidence.ts:9`) · 7-day HRV/RHR windows not wear-filtered while the caption claims exclusion (`readiness-score/route.ts:131,143`; `health-sections.tsx:746`) · readiness recent-window asymmetry documented in signals.ts as intentional but UI copy over-claims.

**UI:** chart gridlines/ticks white-alpha literals in `hr-day-chart.tsx:170,176` and `trend-sparkline.tsx:115-127` · hypnogram `awake:#c7ccd9` ~invisible on light cards · `trends-section.tsx:73-76` `bg-brand text-white` pill tabs (contrast + missing `role="tab"`/`aria-selected`) · hex literals in new F6 cards where sibling used `var(--color-brand)` · HRV card colour-only amber-vs-red banding (`health-sections.tsx:734-741`); heart-rate page band colour-only; ScoreDisplay/chip-row colour band without the label `scoreBand()` already returns · full emoji inventory (~40 sites, precise list captured) incl. new End-of-Day 🌙/🔋 entry points · detail-hero back button ≈36dp; trends pills ≈26dp · six inline hand-rolled SVG polyline sparklines bypass `components/ui/sparkline.tsx` (the old "4 sparklines disagree on bands" claim is stale — bands are consolidated in `lib/health/score-band.ts`; the dupes are now just the polyline math) · score-band re-implementations: `ai/health-insight/route.ts:19-24`, `health-score-detail.tsx:122`, `session-explain-content.tsx:94` (same cuts, different labels Good/Fair/Low) · `health-content.tsx:887-907` chevron toggle no `aria-expanded` · auth pages still `bg-background` (likely intentional, unconverted).

**Security/API:** `day-checkin` POST no rate limit + `req.json()` without `.catch()` (500 not 400); `workout-sessions/rpe` no rate limit · webhook `req.text()` unbounded · `syncHrForSession(...).catch(() => {})` swallows without log · `user_stats.total_volume_kg` counter: workout-entry PATCH edits volume without adjusting it, no reconcile-on-read (pre-existing).

**Render:** `SwipeCarousel` consumers don't use `lazyMount` — all 3 Health panels mount+fetch on entry (pre-dates #166) · Meteors 3s interval not `document.hidden`-gated · `sparkline-chart.tsx:52` memoizes resolved brand RGB with `[]` deps · `pre-workout-screen.tsx:282-292` leading `" · 4 Jul"` when reps/1RM absent.

**Component size (info):** `session-select-content.tsx` 1439 · `workout-screen.tsx` 1077 · `health-content.tsx` 1041 · `config-screen.tsx` 968 · `health-sections.tsx` 943 · `program-editor-sheet.tsx` 886. Nothing newly crossed 800 since 07-01.

---

## VERIFIED CLEAN (for the record)

- Zero forbidden `toISOString().slice(0,10)` patterns repo-wide; all date-param routes default tz-correctly; `/api/health/trends` windows/bucketing tz-correct.
- Rest-day 4→3 threshold: no off-by-one. `aggregateWorkoutDay`: no div-by-zero. Hypnogram lib handles empty/malformed strings.
- `exercise-library`/`activity-types`/`progression-styles` `freshWithinTtl` keys: every writer invalidates. All food write paths call `invalidateNutritionWrite()` (the group's key list is the gap, not the call sites).
- New SQL (`getSessionLoadsFrom`, `getExerciseHistoryRows`): user-scoped, NULL-safe, semantics match the old computation.
- **LLM structured output: fully migrated to `generateObject`** — CLAUDE.md's "five routes bare-parse" claim is stale. Prescribe route's deterministic confidence overwrite is a reference implementation. New DB columns (migrations 106/108): every mapper/reconcile entry present.
- `log-exercise` web route and push branch share `logExerciseFromPayload` — the one-function-per-domain ideal. Mood default parity holds. Outbox confirms by mutation id. Cursor pagination correct both ends. applyDelta gates on `sync_status='synced'` everywhere locally-writable.
- #160's memo fixes all hold; home-card call sites survived #192 with stable props. Dynamic-import rule holds since #162. No new `key={index}`. Pull-to-sync direction lock intact. `workout-store`'s #140 deload fields correctly reset on rehydrate.
- Score bands consolidated in `lib/health/score-band.ts`; `normalizeMuscle` and weekly cadence single-sourced.

---

## SUGGESTED FIX BATCHING

1. **PR: cache correctness** (C1, C2, C3, M1–M8) — one coherent PR: fix the weekly-stats shape (one fetch variant per key + fix the sync-provider warmer), add `workout-card:` to the program groups + make `invalidateWorkoutCardCache` clear SQLite, navigate by session id, register `health-trends`, extend `invalidateNutritionWrite`, date-guard `home-day-timeline` + `body-metadata`, canonicalise the two TTLs, replace drifted hand-rolled lists with groups.
2. **PR: safe-area round 3** (C4, M9–M12 + lows) — FAB nav clearance, left-drawer insets, strip the 6 doubled inner paddings, fix `pt-safe`-on-sheet, barcode overlay vars, `BottomActionBar` fix, CI regex upgrades.
3. **Plan doc → backlog: offline-sync integrity** (C5–C8, M16–M23) — the biggest and riskiest batch; needs a design session (tombstones are a schema change; complete-workout needs a new outbox domain; local read-merge helper). Split: (a) quick wins — push-loop 4xx quarantine/backoff, conflict-arm user scoping, `setSessionRpe` pending flag, per-exercise `markWorkoutSynced`; (b) complete-workout outbox domain; (c) activity GPS fields end-to-end; (d) body-metric local read-merge; (e) tombstone design.
4. **PR: ACWR + formula consolidation** (C9, M13, M31, M32, DEFAULT_TZ lows) — move training-load onto `computeVolumeAcwr`, export one `acwrBand()`, widget consumes `interpretation`, replace stats-sheet Epley with `lib/1rm.ts`, extract the volume/avgReps/intensity trio.
5. **PR: light-mode + UI conventions** (C10, C11, M24–M28, UI lows) — decoration sky redesign (mask/clipPath, shapes only), HR chart theme-resolved colors, one `MACRO_COLORS`, scale-selector/footer fixes, hypnogram axis fix, emoji sweep, aria/touch-target fixes.
6. **PR: render + stores** (C12, C13, M33–M35) — leaf selectors for hot-path fields, memoize `MuscleHeatmap`/`Live1rmReadout` with stable props, fix `useCountUp` (animate from previous value), leaf-scope DoneScreen count-up, `activity-store` rehydration policy, TabSwipeNavigator direction lock + scroller exclusion.
7. **PR: security/API quick wins** (M36–M38 + lows) — webhook verify-before-lookup + size cap, ingest Zod schema, try-catch on the two `generateText` routes, day-checkin/rpe rate limits + json `.catch()`.

---

## CLAUDE.md PROPOSED CHANGES

**Updates to stale claims:**
- Strike "five routes bare-parse LLM output today" — all structured routes use `generateObject` now; replace with "keep it that way: prose-only `generateText` routes must never grow a `JSON.parse` of model text, and every `generateText`/`streamText` call is wrapped in try-catch returning a JSON error (health-insight and weekly-digest shipped without)."
- Update the sparkline note: score-band disagreement is fixed (`lib/health/score-band.ts`); the live issue is six inline polyline sparklines bypassing `components/ui/sparkline.tsx` — replace on touch.
- Make the ACWR line concrete: `computeVolumeAcwr` is the only ACWR; `app/api/training-load` carries an inline flat-÷4 copy with different band thresholds — retire it; clients render the route's `interpretation`, never re-band raw numbers.

**Cache rules:**
1. One fetch variant per key — a key is either always `cachedFetch` or always `cachedFetchToday`; converting one means converting every read site *and the sync-provider warm list* in the same commit (the weekly-stats crash).
2. `freshWithinTtl: true` requires a written invalidation proof: list every write that changes the payload and show each one's group contains the key. A missed writer converts a stale flash into hours of hard staleness.
3. Never create a bare key that's a prefix-sibling of an existing group prefix (`health-trends` vs `health-trends:`) — prefix invalidation silently misses it.
4. A today-guard on the seed isn't enough — the `cachedFetch` onData hit path needs the same guard, or use `cachedFetchToday`.
5. A key fetched at ≥2 sites gets a named constant in `lib/cache-ttl.ts`.

**Navigation/identity:**
6. Session identity = DB id extends to navigation params and cache handshakes — `?session=` must always carry the id.

**Safe-area:**
7. `SheetContent side="bottom"`/`SheetFooter` own the bottom inset — never add `pb-safe*` inside a bottom sheet; `p-0` does NOT strip the baked padding (tailwind-merge doesn't know the custom classes). `side="left"/"right"` sheets bake nothing — drawers need explicit insets. Never `pt-safe` on a bottom sheet. Floating `fixed bottom-*` elements on nav screens must clear `3.5rem + var(--safe-bottom)`.

**Dates:**
8. N-day window anchors are `todayMidnightUtc(tz)`, never `Date.now() − N×86400000` — copy `/api/health/trends`' pattern.
9. Client code has two "today" sources (`todayInTz()` vs device tz) — pick one per feature; never mix them for keys that must match server bucketing. Repo day-window helpers currently hardcode `DEFAULT_TZ` — thread the session tz when touching them. Never re-declare `DEFAULT_TZ` locally.

**Offline sync:**
10. Every user-visible write needs an outbox domain — any POST reachable offline must queue a mutation or visibly fail; `fetch("/api/…").catch(() => {})` is the smell (complete-workout shipped this way).
11. The outbox payload must carry every field the web route accepts — adding a route field means updating local table + queueMutation payload + pushMutations branch + pull mapping in the same PR (the GPS-data loss).
12. Local upserts overwrite all columns — single-field saves read-merge first (copy `water-log-sheet`, not `metric-log-sheet`).
13. A server hard DELETE is invisible to devices — any domain with delete UI needs a `deleted_at` tombstone emitted by `getSyncDelta`, or cross-device deletes don't propagate.
14. `onConflictDoUpdate` arms are UPDATEs — scope them to user_id (`setWhere`) or pre-check ownership.
15. Any local write to an already-synced row flips `sync_status='pending'` — otherwise the pull-clobber gate can't protect it.
16. Transport 4xx/429 on sync push needs backoff + eventual quarantine, never a bare `break`.
17. `pullDelta` domain flags must cover every table the delta applies — new synced domain ⇒ domain flag + sync-provider group mapping in the same PR.

**UI/theme:**
18. Hero/decoration SVGs draw shapes only — sky/base gradients live exclusively in `HERO_GRADIENTS`/`PAGE_GRADIENTS`; a full-bleed dark rect or bg-colour "cutout" inside a decoration breaks light mode even under a dim wrapper (use mask/clipPath).
19. Canvas/SVG chart colours are theme hazards — gridlines/ticks/default line colours must never be white/black-alpha literals; resolve tokens via `resolveColor` or scheme-conditional pairs. Any `lineColor ?? 'rgba(255,255,255,…)'` default is a light-mode bug at every call site that omits the prop.
20. `scoreBand()` colour ships with `scoreBand()` label — colouring a value by band without rendering the band's text/icon is the colour-only-state violation.
21. Semantic palettes (macros P/C/F, sleep stages) are defined once in `lib/` and imported (Hypnogram's `STAGE_COLOR` export is the reference; the macro trio currently exists 4× with 2 schemes).
22. `useTheme()` mounted-gates default to dark — any page-root surface coloured from a gated `resolvedTheme` flashes dark for light-theme users on every navigation; prefer CSS-variable/`data-theme`-driven values for page roots.

**Render/stores:**
23. rAF/animation hooks are timers — call `useCountUp`/`useElapsedSec` in the leaf that displays the number, never at the top of a screen; a count-up must animate from the previously displayed value.
24. Every new `persist()` store ships its transient-state policy in the same commit — `partialize` or `onRehydrateStorage`-reset every mode/in-flight flag/payload; date-key daily state (`workout-store` is the reference; `activity-store` has neither).
25. Document-level gesture recognizers exclude scrollable ancestors (`.overflow-x-auto`, not just tagged carousels) and direction-lock during the gesture, not at touchend.
26. When adding a workout-store field, don't grow the orchestrator's `useShallow` pick — add a leaf selector in the component that renders it.

**Security:**
27. Webhooks verify signatures before any DB lookup keyed on unverified payload fields — differing responses pre-verification are an enumeration oracle.
28. Ingest routes get a Zod schema at creation, same as sibling routes — untyped numeric passthrough to the driver is not validation.
29. Self-fetching cards need an explicit failure state — `cachedFetch` swallows `!res.ok` (including your own rate limit); `return null` cards vanish silently.
30. Cumulative per-day fields from Oura must treat today as a partial day (the `wornHours` 86,400s assumption).

---

## COVERAGE — what this review did and didn't touch

**Covered (8 passes):** cache layer + invalidation, safe-area, timezone/dates, functional diffs of PRs #170–#192, offline-sync push/pull/outbox/migrations, render/Zustand/gestures, UI conventions + light mode, formulas + AI/security defaults.

**Not covered (candidates for a part 3, roughly in value order):**
1. **On-device verification** — every safe-area, WebView-rendering, gesture-feel, and native-SQLite finding above is code-verified only; the S25 smoke checklist (`docs/device-smoke-checklist.md`) has never been physically run.
2. **Postgres migration/data-drift audit** — seed-vs-prod drift, the two collided migration-number pairs (081/087), idempotency of recent corrective migrations.
3. **Service-worker/PWA update path** — the new build-hash SW (#156) against a real deploy cycle; offline shell behaviour.
4. **Auth/session surface** — JWT stamping, admin gating consistency (one finding hints: `is_admin` changes need re-login), OAuth refresh path.
5. **Load/perf under realistic data volume** — the local seed is tiny; query plans for the new grouped SQL, outbox backlog behaviour.
6. **Accessibility pass beyond aria-expanded** — focus management in sheets/dialogs, screen-reader labels on icon buttons.
