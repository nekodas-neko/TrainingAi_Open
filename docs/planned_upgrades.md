# TrainingAI — Planned Upgrades (open findings ledger)

> **The findings ledger — what's still open.** This is the curated list of uplift ideas/findings
> that have **not** yet fully shipped. Each graduates to
> [`docs/implementation-backlog.md`](implementation-backlog.md) (the ready-to-build queue) once a
> session writes its implementation plan.
>
> **Shipped detail lives in [`docs/overview/uplift-archive.md`](overview/uplift-archive.md)** — the
> full session-176 eight-dimension review + all follow-up audits (batches A–O), with file:line
> evidence and shipped rationale, preserved for later review.
>
> **Origin:** created 2026-07-01 (session 176 full app review), extended by the 2026-07-02 B5/B6/F6/H5/L
> audits and the 2026-07-03 backlog review (session 184). Trimmed to open-only on 2026-07-05
> (session 210 documentation cleanup) — the batches that shipped in full (Quick wins, B1–B4, C, D,
> G, H, I, J2/J3, and F1–F5, E1–E5, A1/A6/A7, L2/L3 sub-items) moved to the archive.

**Corrected 2026-07-30:** this line said "Next Postgres migration: 111 · Local SQLite v13" — 54
migrations and 7 SQLite versions stale. Current state (see `docs/implementation-backlog.md`'s header
for the live number, since this ledger isn't the thing implementers check first): next Postgres
migration is **166**, local SQLite is **v21** (corrected 2026-08-02 — this line said v20;
`lib/sqlite/__tests__/migrations.test.ts` asserts 21). (105 reserved-unused by Batch E; 107 Batch I supersets;
108 workout time-model; 109 Batch N `error_events`; 110 Batch O `body_measurements`.)

---

## Open items by batch

Legend: **📝 open** (no plan yet) · **⚙️ partial** (some sub-items shipped) · **⏳ queued** (in the
implementation backlog) · links point to the plan and the archive section for full context.

### Batch A — Offline-first data integrity ⏳ queued (backlog #1)
Superseded/consolidated by the 2026-07-04 **offline-sync-integrity** plan (backlog item #1). Still-open
findings: A2 outbox confirm keys on `domain:date` not mutation id, A3 no retry cap/dead-letter/visibility,
A4 persistent 5xx wedges the queue, A5 `applyDelta` pull-clobber gaps, A8 sync/DB throughput, A9 make the
local store the single offline read source. ⚠️ Device-only (no native SQLite in the sandbox).
→ `docs/superpowers/plans/2026-07-04-offline-sync-integrity.md` · [archive §Batch A](overview/uplift-archive.md)

### Batch B — Caching & performance ✅ shipped (B5/B6 residuals reconciled 2026-07-20)
B1–B4 shipped (PR #99). **B5 + B6 residuals all verified present on `main` 2026-07-20:**
- **B5 save-latency residuals — DONE:** the stale legacy home seeds are cleared via
  `clearLegacyHomeSeeds()` (`lib/cache-groups.ts`; `ta_streak_v1`/`ta_calendar_v2_*` verified dead in
  source, session 271); the DoneScreen no longer awaits a live Oura Cloud sync on mount (the legacy
  hr-sync POST was removed — `done-screen.tsx:168-169`, now a plain `/api/oura/hr-data` GET); food
  logging queues a client-minted `food_items` outbox mutation instead of awaiting a POST per item
  (SYNC-O2, `lib/nutrition/log-food.ts`).
- **B6 data-store residuals — DONE:** `invalidateNutritionWrite` group present; `exercise-history`
  filters in SQL (`getExerciseHistoryRows(userId,name,20)`); `muscle-recovery` memoises the library
  (`lib/data/exercise-muscle-map-cache.ts`); `admin/pending-count` shares one `cachedFetch` across
  bottom-nav/profile-tab/session-select; mixed TTLs consolidated (`lib/cache-ttl.ts`); in-flight-dedup
  fans out to all waiters (`lib/sqlite/cache.ts` `pendingWaiters`); SWR headers added.
→ `docs/superpowers/plans/2026-07-02-b5-save-latency.md`, `2026-07-02-b6-data-store-fixes.md` · [archive §Batch B](overview/uplift-archive.md)

### Batch E — AI usage ⚙️ partial (E6 open)
E1–E5 shipped. **Open: E6 — proactive cron layer** (`FEAT` MED) — one secret-guarded `/api/cron/*` route
+ Railway cron; unblocks pre-generated morning briefing, enriched weekly digest, PR celebrations, and
pure-code anomaly alerts. Enabler for Batch N's push work. Not yet queued (needs a plan).
→ [archive §Batch E](overview/uplift-archive.md)

### Batch F — Data & analytics ✅ shipped
F1–F6 all shipped (PRs #170–#178 + chunks 2–4). F6 Tier 3–4: persisted the fetched-but-dropped Oura
fields (`resting_time`, MET-minutes, `time_in_bed`; `breathing_disturbance_index` was already stored),
surfaced `avgHeartRate`/`restlessPeriods`/`sleepTimeRecommendation` on the sleep detail view, added
webhook handlers for the already-subscribed spo2/stress/cardiovascular-age/resilience/vo2-max types
(and fixed a pre-existing `vo2_max` webhook path-casing bug found along the way), and added a
sync-freshness indicator + outbox-depth surfacing. ⚠️ Real Oura webhook delivery and native-outbox
depth remain unexercised in the sandbox.
→ [archive §Batch F](overview/uplift-archive.md)

### Batch J — Process & enforcement ⚙️ partial (J1 residual CI checks ⛔ blocked — re-verified 2026-07-20)
J2 (device smoke checklist) and J3 (build-hash SW cache) shipped. **J1 residual CI checks remain ⛔ blocked**
— each would fail CI on pre-existing code, so none is a clean check-add:
- **Ban bare `fetch('/api…`** — 195 hits in client files today, but the CLAUDE.md rule bans bare *GETs*
  only (POST/PUT/DELETE mutations legitimately use `fetch`), and a static scan can't cleanly separate them
  without parsing the `method` option → high false-positive rate. Needs the GET-migration first, not a lint gate.
- **Flag inline `invalidateCache(` literal lists** — down to 10 call sites (from ~30), but they must each be
  migrated to a `cache-groups.ts` helper before a gate can pass. (Good news: the live `invalidateCache('')`
  full-cache nuke is already gone — `more-content.tsx:126` is now only a *comment* warning against it.)
- **Duplicate-migration-number guard** — `081`/`087` still genuinely collide on disk
  (`081_exercise_library_expand.sql`+`081_exercise_media.sql`; `087_oura_webhook_fields.sql`+`087_composite_indexes.sql`),
  so the guard can't be enabled without a confirm-first renumber plan.
→ `docs/superpowers/plans/2026-07-02-batch-j-process-enforcement.md` · [archive §Batch J](overview/uplift-archive.md)

### Batch K — User-requested UI/bug-fix batch ✅ shipped (all 5, reconciled 2026-07-20)
All five items verified present on `main` 2026-07-20:
- **Task 1** (remove exercise names from timeline cards): the `exerciseNames` render block is gone from
  `components/home-day-timeline.tsx` and `app/health/timeline/page.tsx`.
- **Task 2** (training-boost arc on the Activity ring): implemented in the shared ring — the
  `ScoreDisplay` in `components/health/health-score-detail.tsx:47-55` draws a second brand-colored arc,
  wired at `:171-175` (`trainingBoostFrom` gated on `theme === "activity" && activityBlend.adjustment > 0`).
  (The activity page delegates to `HealthScoreDetail` now, which is why the arc lives there, not in
  `activity-content.tsx` as the stale plan assumed.)
- **Task 3** (EOD reminder 30 min before bedtime, minute precision): `lib/meal-reminders.ts` uses
  `bedtimeMinute` + `setMinutes(… − 30)`.
- **Task 4** (colored benchmarked wellness sliders): `components/nutrition/end-of-day/scale-selector.tsx`
  (filled-progress, per-scale colour).
- **Task 5** (themed EOD background): `components/nutrition/end-of-day/end-of-day-review.tsx` renders the
  page gradient.
→ `docs/superpowers/plans/2026-07-02-ui-bugfixes-activity-eod-review.md` · [archive §Batch K](overview/uplift-archive.md)

### Batch L — Per-screen wallpapers ✅ shipped
All chunks shipped: L2 (legibility/light-mode), L3 (opaque-root cleanup), chunk 2 (Health/Nutrition/More
palettes), chunk 3 (Stats/Overview/Workout Select/Why-this-session palettes). ⚠️ On-device Samsung WebView
verification still needed — the real gate for this batch, unexercised in the sandbox.
→ [archive §Batch L](overview/uplift-archive.md)

### Batch M — Per-exercise deload ✅ shipped (reconciled 2026-07-20 — the "never landed" note was stale)
The 2026-07-03 "no branch/PR/code on origin" note is **out of date** — all four blocks are on `main`:
engine `lib/ai-periodization/per-exercise-deload.ts` (`computePerExerciseDeload`, muscle-soreness
quadrant + whole-session escalation), migration `118_exercise_deloaded.sql`, wired at the prescribe
route (`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:20,189`), self-reverting re-eval
(`lib/ai-periodization/reevaluate.ts`), prompt awareness (`lib/ai-periodization/prompt.ts`), UI
(`components/workout/deload-info-sheet.tsx`), and tests (`per-exercise-deload.test.ts`,
`deload-reverts.test.ts`). Deloads just the sore exercises with an amber chip + "use full weights" revert.
→ `docs/superpowers/specs/2026-07-02-per-exercise-deload-design.md` + `plans/2026-07-02-per-exercise-deload-block-*.md` · [archive §Batch M](overview/uplift-archive.md)

### R — 2026-07-03 review correctness findings ✅ shipped (all 8 verified done, reconciled 2026-07-20)
From the session-184 recent-code audit. **Re-verified against `main` 2026-07-20: every task in the
`review-quick-fixes` plan is already fixed** (landed piecemeal across later cache-group/TTL/push-parity
sessions without this ledger line being updated). Confirmations: T1 — `invalidateCache('health-trends:')`
is now fired by the workout-summary / biometric / activity / oura-sync groups in `lib/cache-groups.ts`;
T2 — the `session_rpe` push branch validates via `SessionRpeSchema` and `day_checkins` rejects an
out-of-range scale (`adapter.ts`); T3 — `app/api/health-trends/route.ts` has the standard `rateLimit`
guard; T4 — neither `trends-section.tsx` nor `home-day-timeline.tsx` seeds via `useState(() =>
readCacheSync(...))` any more; T5 — canonical `READINESS_SCORE_TTL`/`MUSCLE_RECOVERY_TTL` in
`lib/cache-ttl.ts` are used at every call site; T6 — `style-editor-sheet.tsx` no longer keys rows by
index; T7 — `components/chat-overlay.tsx` + `app/workout-mockup/` are deleted; T8 — no
`invalidateCache('')` full-cache nuke in `health-content.tsx`.
→ `docs/superpowers/plans/2026-07-03-review-quick-fixes.md` · [archive §2026-07-03 review](overview/uplift-archive.md)

### Batch N — Platform & ops ✅ shipped
Operational safety net: `GET /api/status` healthcheck, throttled `oura_heartrate` retention, DB
backup/account-recovery runbooks + scripts (chunk 1); error tracking (`error_events` migration 109,
client `ErrorReporter` + server `reportServerError`, Admin → Errors tab), `GET /api/version` +
native update banner, fixed a real `sendPushToUser` 410-cleanup bug + a push-test button (chunk 2);
full-data NDJSON export + `pushMutations`↔web-route parity tests for `mood_logs`/`day_checkins`/
`food_logs`/`session_rpe` — found and fixed two more real drift bugs along the way (`day_checkins`
missing phase-enum validation, `food_logs` missing `quantityMultiplier` range clamp) (chunk 3).
→ [archive §N](overview/uplift-archive.md)

### Batch O — Feature candidates ⚙️ phase 1 shipped
Phase 1 shipped: post-session AI recap (cached forever per session, one-tap Generate on the done screen,
deterministic stats + one short Gemini narrative), rest-day active-recovery guidance (deterministic
readiness-based bands, no LLM), and body measurements (waist/chest/arm/thigh/hip/neck as opt-in Overview
widgets, migration 110, full offline-sync chain). **Unplanned remainder** (still open, until asked for):
progress photos, warm-up protocol customization, voice logging, mesocycle retrospective.
→ `docs/superpowers/plans/2026-07-03-batch-o-features-phase-1.md` · [archive §O](overview/uplift-archive.md)

### Saved-meal "Add as new food" always 400s ✅ fixed (verified 2026-07-20)
Found while verifying the nutrition-food-log-live-update fix (2026-07-05): `saved-meals-sheet.tsx`'s
`handleAddFoodAndIngredient` POSTed `barcode: null` to `/api/nutrition/food-items`, whose Zod schema has
`barcode: z.string().max(20).optional()` — `.optional()` rejects `null`, so every call 400d.
**Re-verified against `main` 2026-07-20: fixed.** The POST body now omits `barcode` entirely (sends only
`{ name, calories, proteinG, carbsG, fatG, servingSizeG, source: 'manual' }`), which satisfies the schema
(`.optional()` accepts absent) — matching the sibling `logFoodEntries` create path the original note
recommended.

### Batch S — 2026-07-16 data-efficiency review findings ✅ shipped (all S1–S10, reconciled 2026-07-20)
Full write-up: [`docs/reviews/2026-07-16-data-efficiency-review.md`](reviews/2026-07-16-data-efficiency-review.md)
(severity/effort table in its §6; items already covered by queued P-C/P-D/P-E/etc. are reconciled
in its §7 and deliberately NOT duplicated here). The theme: signals are computed and persisted
but consumed by one surface or none, while siblings run on worse proxies or frozen Cloud data.
**All ten graduated to the backlog 2026-07-16 (same-day planning session):** S1+S2+S6 → item
**3a** (`2026-07-16-derived-scores-read-paths.md`), S3 → **10a** (`illness-signal-wiring`),
S4 → **10b** (`respiratory-illness-biomarker`), S5 → **10c** (`daytime-stress-wiring`),
S7 → **20** (`ai-signal-consistency`), S8+S10 → **21** (`frozen-cloud-display-honesty`),
S9 → **22** (`metric-label-consolidation`).
- ✅ **S1 (High/S) — SHIPPED v1.158.1 (item 3a):** `/api/health/trends` now coalesces
  `oura_daily_derived` scores over the frozen `oura_daily` columns — the first real read-path for
  the write-only derived table.
- ✅ **S2 (High/S) — SHIPPED v1.158.1 (item 3a):** Body Battery anchors on today's derived readiness
  → own sleep score → Cloud → 50; the flat-50 BLE-day anchor is gone (`MODEL_VERSION` v4).
- ✅ **S3 (High/M) — SHIPPED v1.160.0 (item 10a):** the illness radar now reaches every decision
  layer — `PrescriptionSignals.illness` + prompt rest-day gate, deterministic next-session/re-eval
  deloads (elevated→recommended, fever→strong; self-reverting), chat tool + context, digest +
  health-insight lines, and a Home advisory banner. First decision-layer reader of `oura_daily_derived`
  via the shared `latestIllnessFromDerived`.
- ✅ **S4 (High/M) — SHIPPED v1.159.0 (item 10b, migration 125):** nightly respiratory rate gets a
  personal baseline on `oura_daily_summary` and joins the illness radar as the 4th biomarker
  (temp 0.40 / breathing 0.25 / RHR 0.20 / HRV 0.15, one-sided up-bad; weights renormalise). Backfills
  on the first post-deploy rollup.
- ✅ **S5 (High/M) — SHIPPED v1.161.0 (item 10c):** daytime stress (dHRV) persists to
  `oura_daily_derived` and feeds the deload proxy, readiness tiles, chat, weekly digest, and the intraday
  `StressStrip`. (Verified 2026-07-20 via the backlog serial-track ✅ mark.)
- ✅ **S6 (Med/S) — SHIPPED v1.158.1 (item 3a):** the readiness route persists + serves our own
  sleep-score contributors (mapped to Cloud key names) so the Sleep bars stop showing frozen/empty
  Cloud JSONB.
- ✅ **S7 (Med/S) — SHIPPED (item 20):** AI-layer consistency — `sleep-trend.ts` +
  `sleepScoreTrend`/`tempZ` are live in the signal layer. (Verified 2026-07-20 via the backlog
  serial-track ✅ mark.)
- ✅ **S8 (Med/M) — SHIPPED (item 21, reinforced by deep-review P3):** frozen-Cloud display honesty —
  the AI readiness cutover (`lib/health/live-readiness.ts`, v1.176.0) withholds frozen post-re-key Cloud
  and the display surfaces render our own composite; the ring-battery "Not live" marker is the reference
  pattern. (Verified 2026-07-20 via the backlog serial-track ✅ mark + the deep-review batch.)
- ✅ **S9 (Med/S) — SHIPPED (item 22, verified 2026-07-20):** one canonical source + label per metric —
  "HRV (overnight)" everywhere, SleepCard "Lowest HR" (no longer a fake "RHR"), one computed sleep score,
  one `readinessDisplayScore` headline, de-duplicated HRV prompt lines. Every site confirmed present on
  `main`; the `2026-07-16-metric-label-consolidation.md` plan doc is marked RESOLVED.
- ✅ **S10 (Low/XS) — SHIPPED (verified 2026-07-20):** the `0x61` battery subtypes
  (`charging_time`/`battery_level_changed`) are now KEPT at ingest via the `isBatteryDebugEvent` exception
  in `lib/oura-ble/raw-storage.ts` (only non-battery `0x61` telemetry is dropped), so the admin battery
  readout is no longer reading a dropped tag.

### `user_stats` stored-counter drift on edit ✅ fixed (verified 2026-07-20)
From the `api-security-quick-wins` plan (2026-07-04 post-update review, Task 5): `user_stats.total_volume_kg`
/`total_sets` (migration 073) had a replay guard but no reconcile-on-read, and the `workout-entry` PATCH
edit path changed `exercise_logs.volume` without adjusting the counter — it drifted on every edited set.
**Re-verified against `main` 2026-07-20: fixed** — SYNC-T1 shipped `reconcileUserStats`
(`lib/data/postgres/slices/user-stats.ts`), the exact reconcile-on-read self-heal the note recommended.
It is called at the top of `computeAchievements` (`lib/achievements.ts`), which is the **only** reader of
the `user_stats` counter (`/api/profile/[userId]`, `/api/achievements`) — so the counter is always healed
against the source-of-truth queries before it's read. Drift is fully mitigated.

---

## Fully shipped (see the archive for detail)

Quick wins (PR #91) · **Batch B1–B4** (PR #99) · **Batch C** training-engine correctness (PRs #101/#105) ·
**Batch D** security hardening · **Batch E1–E5** AI usage · **Batch F1–F5** + F6 Tier 1–2 data/analytics ·
**Batch G** UI/UX system (PR #134) · **Batch H** swipe navigation + H5 haptics · **Batch I** workout/nutrition
features (all four) · **Batch J2/J3** · **Batch L2/L3** legibility + opaque-root.

Full write-ups with file:line evidence and shipped rationale: [`docs/overview/uplift-archive.md`](overview/uplift-archive.md).
