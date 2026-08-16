# Stream 1 — Product & offline-first surfaces (deep-review batch)

**One implementer agent owns this whole stream.** Work the tasks **top-to-bottom** (later items
share files with earlier ones). Sibling: [Stream 2](2026-07-19-stream-2-oura-health-ai.md) runs in
parallel on a disjoint file set. This doc is the authoritative refinement of the high-level split in
[`docs/implementation-backlog.md`](../../implementation-backlog.md) → *▶ Deep-review batch → ▷
Two-stream split*.

Source of every finding ID below: [`docs/reviews/2026-07-18-deep-app-review.md`](../../reviews/2026-07-18-deep-app-review.md).

## What this stream is about

The product-facing, offline-first, and client surfaces: the sync outbox + local store, nutrition
save/load, the workout flow UI, general UI polish, the conversational-AI routes, security hygiene,
and the app-wide error-surfacing standard. It **leads with the one CRITICAL finding** in the whole
review (P1 — new-food logs silently never reach the server).

## File territory

**Owns (edit freely):**
- `lib/sync/*` (esp. `mutation-schema.ts`), `lib/local-store/*`, `lib/sqlite/*`
- `lib/nutrition/*`, `lib/data/postgres/slices/nutrition.ts`
- `components/*` **except** `components/fitness-tests/*`, `components/health/zone-breakdown.tsx`,
  and the zone/training-stress/resilience health tiles owned by Stream 2 (see Do-not-touch)
- `components/running/*` (the running **UI** — distinct from `lib/running/*`, which is Stream 2)
- `app/workout/*`, `lib/workout/*`
- `app/api/ai-chat/*`, `app/api/generate-program/*`, `app/api/builder-chat/*`
- `lib/observability.ts`, `lib/cache-groups.ts`, `lib/cache-ttl.ts`
- security-relevant write routes outside the Oura/health cluster (see task 6)

**Shared — edit with care (coordinate; see Seams):**
- `lib/data/postgres/adapter.ts` — **only** the `food_items` `pushMutations` branch (~L3322) and
  `reconcilePersonalRecord`. **Never** the `aggregateOuraRawSamples` rollup (~L3974, Stream 2).
- `package.json`, `lib/changelog.ts`, `projectOverview.md`, the backlog — expected parallel-merge
  conflicts; re-bump / keep-both on rebase.

**Do NOT touch (Stream 2 territory):** `lib/data/postgres/slices/oura.ts`,
`app/api/readiness-score/route.ts`, `lib/ai-periodization/*`, `lib/running/*`, `lib/health/*`,
`app/api/zone-minutes`, `app/api/training-stress`, `app/api/oura-ble/*`, `lib/oura-ble/*`,
`app/api/weekly-digest`, `app/api/ai/health-insight`, `app/api/next-session`,
`lib/date-utils.ts` `normalizeDateParam`, `components/fitness-tests/*`, `lib/ai-chat/tools.ts` +
`context.ts` (readiness reads).

## Tasks (in order)

| # | Item | Plan / review | Key files | What to do |
|---|---|---|---|---|
| 1 | **P1 — food_items sync envelope (CRITICAL)** | [P1 plan](2026-07-19-food-items-sync-envelope.md); review §D (D-1/D-2/D-5) | `lib/sync/mutation-schema.ts:9`, `app/api/sync/push/route.ts`, `lib/local-store/sync-engine.ts`, `lib/nutrition/log-food.ts`, `slices/nutrition.ts`, `adapter.ts` food_items branch | Add `'food_items'` to the envelope enum; add a CI-runnable domain-coverage test; add a bounded dead-letter re-queue sweep for already-stranded rows. |
| 2 | **P5 — error-surfacing standard** | [P5 plan](2026-07-19-error-surfacing-standard.md); review §K (K1–K9, K5) | `lib/sqlite/cache.ts`, `lib/sqlite/sqlite-backend.ts`, `lib/local-store/index.ts`, `app/workout/error.tsx`, `lib/observability.ts`, `components/more/sync-health-card.tsx`, `components/pull-to-sync.tsx`, health/home cards | Adopt the §K standard verbatim, then: dead-store banner+telemetry+fallback (K4, high), dead-letter toast/badge (K3), cachedFetch failure channel + workout screen (K2), strap-flush re-buffer (K5), workout error→telemetry (K1), extend `reportServerError` (K8), pull-to-sync failure state (K7), self-fetching card sweep (K9). **K6 is Stream 2's** (rollup telemetry) — do not duplicate. |
| 3 | **§E1 — workout-flow batch** | review §E1 (E1-1..E1-7) | `components/workout-screen.tsx`, `components/workout/*`, `lib/workout/*`, `adapter.ts` `reconcilePersonalRecord`, `app/api/log-calendar-event` | Calendar UUID→name title (E1-1), sync-time date-stamp on replayed logs (E1-2), completed-session CTA reappears (E1-3), stale multi-day resume reset (E1-4), PR-badge vs all-time PR (E1-7), `reconcilePersonalRecord` `achievedAt` (E1-6), offline id-fallback residual of v1.171.0 (R-2/E1-5). Reconcile: "advance() stale-closure" row appears already-fixed — verify & retire. |
| 4 | **§A — UI polish** | review §A (A-1, A-2, A-3, A-7, A-8, A-9, A-10) | `components/running/*`, general components, `app/globals.css` | A-1 **first** — running UI styles accents with undefined `--accent-3/6/9/11` vars (no-op). Then A-2 (PlanSetupSheet silent submit), A-3 (running screen blank/no states), A-7 (emoji→Lucide), A-8 (sub-44px consequential buttons), A-9 (dark-only `-400` text), A-10 (sparkline skeleton on cache-seeded card). **A-4/A-5/A-6 are Stream 2's** (baselines/fitness-test/zone surfaces). |
| 5 | **§F — AI-route hygiene (chat/builder/program only)** | review §F (F1, F2, F4, F5, F10, F11; F6/F7 partial) | `app/api/ai-chat/route.ts`, `lib/parse-chart-blocks.ts`, `app/api/generate-program`, `app/api/builder-chat`, nutrition-goals/recommend | F1 body-weight regex confirm/undo, F2 `<sheet_chart>` shape-validate + canvas var(), F4 generate-program exercise-count self-contradiction, F5 builder-chat missing exercise whitelist, F10 `ta_session` cookie into chat prompt, F11 TTS env note. **F6/F7 split by site:** fix the *builder-chat history* (F6) and *nutrition-goals/recommend* (F7) sites here; running-explain (F6) and health-insight (F7) are Stream 2. |
| 6 | **§I security + §B caching + misc** | review §I (SEC-I1..I8), §B (B1–B8), §D (D-3/D-4), §J (J-7) | security write routes (avatar, health-connect, injuries PATCH, prescribed-run, pg client), `lib/cache-groups.ts`, `lib/cache-ttl.ts` | All-low security hygiene; caching group/TTL gaps (coordinate running-plan/zone/training-stress *rows* with Stream 2 — those keys' data is theirs); D-3 outbox rebuild style snapshot, D-4 ActivityHistoryCard repaint, J-7 dual "Session Load" naming. |

## Seams (coordination points)

- **`adapter.ts`** — you touch the `food_items` branch and `reconcilePersonalRecord`; Stream 2
  touches the rollup + date helpers. Non-adjacent, so textual conflicts are unlikely, but if a
  merge conflict appears, **rebase onto fresh `main`** and re-apply — never force-push over Stream 2.
- **`lib/cache-groups.ts`** — you own the file; if you add a group that a Stream 2 route consumes,
  leave the existing zone/training-stress/running-plan rows intact.
- **`package.json`/`changelog.ts`/`projectOverview.md`/backlog** — re-bump/keep-both on rebase.

## Per-item discipline (CLAUDE.md)

Each task is **its own PR** off freshly-fetched `main` (`git fetch origin main && git checkout -B
fix/s1-<slug> origin/main`). Full gate before presenting: `pnpm lint && pnpm exec tsc --noEmit &&
pnpm test`, plus a `pnpm dev` smoke of every changed route/flow against the local seeded DB. Merge
on green per CLAUDE.md (docs/plan/shipped-bugfix = zero ceremony; the food_items fix is a standard
change → merge on tested+green; nothing here is destructive/auth/secrets). Fold the journal entry
(new file in `docs/overview/entries/`) + `projectOverview.md` + version/changelog bump into the same
PR. **Device gates:** P1 (native SQLite), P5 dead-store/dead-letter (APK), §A safe-area/WebView — if
no device in-session, add a Known-Issues row per the Canonical Runtime rule.
