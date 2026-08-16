# Stream 2 — Oura pipeline, health signals & AI engine (deep-review batch)

**One implementer agent owns this whole stream.** It is a **serial track** — these items share the
Oura-derivation god-files (`aggregateOuraRawSamples` in `adapter.ts`,
`app/api/readiness-score/route.ts`, `slices/oura.ts`, `ai-periodization/signals.ts`), so they
**cannot** be parallelised among themselves; work strictly top-to-bottom, one PR at a time. Sibling:
[Stream 1](2026-07-19-stream-1-product-offline.md) runs in parallel on a disjoint file set. This doc
is the authoritative refinement of the high-level split in
[`docs/implementation-backlog.md`](../../implementation-backlog.md) → *▶ Deep-review batch → ▷
Two-stream split*.

Source of every finding ID below: [`docs/reviews/2026-07-18-deep-app-review.md`](../../reviews/2026-07-18-deep-app-review.md).

## What this stream is about

The Oura BLE data pipeline, the derived health metrics, the AI periodization/running engines, and
every AI surface that reads readiness. It fixes **two features that are entirely dead in production**
(Time-in-Zone and Training Stress), stops the BLE rollup before it hits a silent statement-timeout
cliff, and cuts the AI layers over from frozen Cloud readiness to the live composite.

## File territory

**Owns (edit freely):**
- `lib/data/postgres/adapter.ts` → `aggregateOuraRawSamples` rollup + the date/MET helpers it uses
  (**exclusive owner of the rollup**)
- `app/api/readiness-score/route.ts`, `lib/data/postgres/slices/oura.ts`
- `lib/ai-periodization/*` (`signals.ts`, `prompt.ts`, `reconcile-prescription.ts`, …)
- `lib/running/*` (the running **engine** — distinct from `components/running/*`, Stream 1)
- `lib/health/*` (fitness-tests, vo2max, zone-minutes, retention helpers, daily-summary)
- `app/api/zone-minutes`, `app/api/training-stress`, `app/api/oura-ble/samples`, `lib/oura-ble/*`
- `app/api/weekly-digest`, `app/api/ai/health-insight`, `app/api/next-session`
- `lib/ai-chat/tools.ts` + `lib/ai-chat/context.ts` — **readiness/signal reads only** (not the chat
  route itself, which is Stream 1)
- `components/fitness-tests/*`, `components/health/zone-breakdown.tsx`, `components/health/time-in-zone-card.tsx`,
  the resilience/training-stress health tiles, `app/baselines` (these are the surfaces you're already
  in for P2 — do their UI polish here too, see task 1)

**Shared — edit with care (coordinate; see Seams):**
- `lib/date-utils.ts` — **add** `normalizeDateParamIso` (dash form); do **not** change the existing
  `normalizeDateParam` behaviour (10 importers across both streams — additive keeps zero blast).
- `package.json`, `lib/changelog.ts`, `projectOverview.md`, the backlog — re-bump / keep-both on rebase.
- `lib/cache-groups.ts` — Stream 1 owns the file; only touch your keys' rows if strictly needed.

**Do NOT touch (Stream 1 territory):** `lib/sync/*`, `lib/local-store/*`, `lib/sqlite/*`,
`lib/nutrition/*`, `slices/nutrition.ts`, `components/*` (except your fitness-test/zone/baselines
surfaces above), `components/running/*`, `app/api/ai-chat/route.ts`, `app/api/generate-program`,
`app/api/builder-chat`, `app/workout/*`, `lib/workout/*`, the `adapter.ts` `food_items` branch +
`reconcilePersonalRecord`.

## Tasks (strictly serial — each its own PR)

| # | Item | Plan / review | Key files | What to do |
|---|---|---|---|---|
| 1 | **P2 — zone-minutes + training-stress revival** | [P2 plan](2026-07-19-zone-training-stress-revival.md); review §J (J-8/J-9/J-1/J-2/J-6), §C (C-5), §H (H-4), §E2 (E2-9/E2-10), §G (G-2), §A (A-4/A-5/A-6) | `lib/date-utils.ts` (+`normalizeDateParamIso`), `app/api/zone-minutes/route.ts`, `app/api/training-stress/route.ts`, `slices/oura.ts` (`getZoneMinutesRange`, `eachDay`), `adapter.ts` date/MET helpers, `components/fitness-tests/*`, `lib/health/fitness-tests.ts`, `app/api/hr-ingest`, `app/baselines`, `components/health/zone-breakdown.tsx` | Fix the slash-form date bug (**additive** `normalizeDateParamIso`) reviving both dead routes (J-8/J-9); backfill + persist zone-minutes/OTS; fix the compute-once-forever zone cache + profile-in-key (J-1/J-2/C-5/H-4); MET-series timestamps (J-6); HRR1 capture window (E2-9) + end-early equations (E2-10); per-sample hr-ingest tolerance (G-2); fold in A-4/A-5/A-6 UI (baselines `bg-page`, fitness-test tokens, ZoneBreakdown labels) since you're in those files. |
| 2 | **P4 — BLE rollup efficiency + retention** | [P4 plan](2026-07-19-ble-rollup-efficiency-and-retention.md); review §C (C-1=H-2, C-2), §H (H-1/H-3/H-5), §K (K6), §G (G-6) | `adapter.ts` `aggregateOuraRawSamples`, `app/api/oura-ble/samples/route.ts`, `lib/data/postgres/retention-throttle.ts`, prune sites | Windowed/dirty-day rollup + gate ONNX to new nights (C-1); debounce per-drain + add `0x50` trigger (C-2); surface rollup failure to `error_events` (K6); retention: protect per-workout HR before the 180d prune (H-3), add `rr_intervals` prune after materialization (H-1), prune hygiene (H-5). **`body_hex`/Lever-5 stays owner-decision — do not implement.** After P2 (shares `slices/oura.ts` + the zone cache). |
| 3 | **P3 — AI readiness cutover** | [P3 plan](2026-07-19-ai-readiness-cutover.md); review §F (F8=E2-1+E2-12, F9), §E2 (E2-8/E2-11) | `lib/ai-periodization/signals.ts`, `lib/ai-chat/tools.ts`+`context.ts`, `app/api/weekly-digest`, `app/api/ai/health-insight`, `app/api/next-session` | One canonical `getLiveReadiness` accessor (reads `oura_daily_derived`, pre-re-key fallback); cut all five surfaces off frozen `oura_daily`; E2-8 degrade-to-neutral, E2-11 retry-signature fix; F9 wire resilience/daytime-stress/OTS into chat tools + prescribe. Fix the running-explain (F6) + health-insight (F7) hygiene sites here. |
| 4 | **Running-gate correctness** | review §E2 (E2-2, E2-4..E2-7), §J (J-3/J-4/J-5); annotated onto F3 Phase-2 in backlog | `lib/running/recovery-gate.ts`, `lib/running/prescription.ts`, `lib/running/fitness-snapshot.ts` | Wire the assembled-but-unread `strain`/`hoursSinceLastRun` (E2-4/J-5); `sleepHoursLastNight` = last night not week-best (E2-5/J-4); anchor elapsed-hours correctly so the 24h heavy-legs check can fire (E2-6/J-3); pending prescribed rows must not advance the 80/20 sequence (E2-7); consumption-day muscleGroups fallback for per-exercise deloads (E2-2). Prerequisite for F3 Phase 2. |
| 5 | **§G — BLE/data hygiene** | review §G (G-1, G-5, G-7) | `lib/oura-ble/raw-storage.ts` (+ its test), `lib/oura-ble/steps-motion-decoder.ts`, `app/api/oura-ble/accel-chunks` | G-1 make the Lever-2 drop-whitelist safety test cover rollup-consumed tags (0x7e/0x7f) and derive from a shared list; G-5 delete the dead duplicate `steps_motion_decoder`; G-7 fix/implement the accel recount comment. |

## Seams (coordination points)

- **`lib/date-utils.ts`** — the ONE genuine cross-stream risk. **Add** `normalizeDateParamIso`;
  leave `normalizeDateParam` untouched so none of Stream 1's 10 importing routes change behaviour.
- **`adapter.ts`** — you own the rollup exclusively; Stream 1 only touches the `food_items` branch +
  `reconcilePersonalRecord` (non-adjacent). Rebase, never force-push, if a conflict appears.
- **`components/fitness-tests/*` / zone surfaces** — assigned to you (P2 opens them for HRR1); Stream 1
  explicitly excludes them, so no tug-of-war.
- **`package.json`/`changelog.ts`/`projectOverview.md`/backlog** — re-bump/keep-both on rebase.

## Per-item discipline (CLAUDE.md)

Each task is **its own PR** off freshly-fetched `main` (`git fetch origin main && git checkout -B
fix/s2-<slug> origin/main`). Full gate + `pnpm dev` smoke of every changed route against the local
seeded DB before presenting. **P2/P3/P4 are standard changes** (tested + CI-green → merge, no
confirmation). **P4's retention prunes touch data lifetime** — the `rr_intervals` prune is
non-destructive-of-derived-data by design, but present the retention-thinning steps and confirm
before merging any prune that removes source rows; **never** touch `body_hex`. Fold journal +
`projectOverview.md` + version/changelog into each PR. **Device gates:** zone/training-stress render,
fitness-test live-HR capture, BLE rollup on real ring data — Known-Issues rows if no device in-session.
