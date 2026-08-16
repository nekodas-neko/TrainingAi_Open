# Health Tab Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the health tab's post-re-key dead/vanished data surfaces, close its cache-invalidation and staleness gaps, make repeat-visit paint instant, render HR gaps honestly, and consolidate the Body tab's duplicated/incoherently-grouped cards.

**Architecture:** Six independent chunks, ordered by user value: (1) cache-group/route hygiene, (2) post-re-key data honesty + surfacing BLE data the app already decodes, (3) instant paint & fetch efficiency, (4) Body-tab information-architecture cleanup, (5) offline-first sibling gaps R3 doesn't cover, (6) missing-data states. Each chunk is a shippable PR slice; chunks 1–2 are the high-value core if the item is worked across multiple sessions.

**Tech Stack:** Next.js 15 / React 19, Drizzle + Postgres (rollup in `lib/data/postgres/adapter.ts`), client SQLite cache (`lib/sqlite/cache.ts`), chart.js via react-chartjs-2, vitest.

---

## Context — how this plan was scoped (review of 2026-07-10)

A full review of the health tab (three parallel code sweeps: UI structure, caching/data flow,
Oura BLE data coverage) produced the findings below. Every claim load-bearing for a task was
re-verified by hand against `main` @ `3f7dd47`. **Re-verify against current `main` before
implementing** — especially if R6/R7 (queue items) have landed since, which touch neighbouring
lines.

### Deliberately NOT in this plan (already owned by other queue items — do not duplicate)

| Finding | Owned by |
|---|---|
| `health-trends-summary` fetched 3–4× per Health open (hoist to parent), oura-section `useState` lazy-init seeds, dynamic-import `loading:` skeletons defeating cache seeds on 5 health cards, `localStorage` initializers in health-content, chart.js in home bundle | **R6** (`2026-07-09-r6-performance-and-paint.md`, PERF-4/-7/-6 etc.) |
| Canvas `var(--color-brand)` renders black in `trend-chart.tsx:27` + `workout-load-comparison-chart.tsx:34`, `resolveColor` hoist to `lib/`, `aria-expanded` sweep, palette-literal → token and emoji → Lucide sweeps | **R7** (`2026-07-09-r7-ui-polish-a11y.md`) |
| Health `fetchMeta` today-tile local gap (SYNC-R2), day-log overlay bare fetch (SYNC-R5), `home-day-timeline` local-first question (SYNC-R3) | **R3** remaining chunks (`2026-07-09-r3-offline-first-integrity.md`) |
| `normalizeDateParam` missing on `/api/oura/hr-day`, `/api/day-timeline`, `/api/workout-sessions/day` | **R8** (`2026-07-09-r8-dates-formulas-consolidation.md`, DATE-B sweep) |
| HR smoothing shared helper (`lib/health/hr-smoothing.ts`), live sparkline + done-screen recovery chart | **UB5/UB6** (`2026-07-10-ub5-6-live-hr-ux-and-smoothing.md`) |
| BLE ring battery on the Body/Health card (plugin `OuraBleStatus.battery`), battery time-series | **UB4 Chunk 3** (`2026-07-10-ub4-oura-battery-wear-time.md`) |
| Nightly temperature-deviation baseline from BLE temp, `oura_daily_summary` rolling baselines (migration 116), baseline-relative Readiness | **Item 1 / Phase 5 addendum A3–A4** (`2026-07-08-oura-ble-phase-5-own-scores.md`) |

### Key verified facts driving the tasks

- **Post-re-key, `/api/oura/stats` serves only *today's* `oura_daily` row** (`app/api/oura/stats/route.ts:40`), and BLE writes only `non_wear_time_sec` to it (`lib/data/postgres/adapter.ts:3918-3945`). Today's score/stress/advanced fields are null → the OuraSection **Activity, Stress & Recovery, and Advanced sub-cards have silently vanished** since 2026-07-07 (each is conditionally rendered: `components/health/oura-section.tsx:211/287/305`). Same for the Body tab's `ouraIndicators` card — gated on `readiness?.ouraScore != null` (`app/health/health-sections.tsx:153`), which is null for every post-re-key day. These are dead UI, not stale UI.
- **Breathing rate is computed and thrown away**: `breathingFromIbi` runs per sleep epoch but only its `variability` is consumed by the stager (`lib/data/postgres/adapter.ts:3685`); `rateBrpm` is never written. The BLE sleep-row literal omits `respiratoryRate` (`adapter.ts:3718-3739`), so the sleep card's "br/m" chip (`health-sections.tsx:384`) is dead for BLE nights.
- **Five cache-invalidation gaps** in `lib/cache-groups.ts` (verified by reading the groups): `weekly-muscle-sets` missing from `invalidateExerciseLogged` (`:65-82`); `health-trends-summary` missing from `invalidateBodyMetricWrite` (`:176-182`) and `invalidateActivityWrites` (`:161-173`); `health-trends:` prefix missing from `invalidateNutritionWrite` (`:238-250` — the meal-timing view depends on food logs); `sleep-performance-correlation` in no sleep-bearing group (`invalidateBiometrics` `:111-119`, `invalidateOuraSync` `:135-153`); `training-load` missing from `invalidateActivityWrites`.
- **`oura-stats` is a bare `cachedFetch` key holding today-specific data** (`oura-section.tsx:91`) — no date in key or envelope; across midnight it serves yesterday's wear/battery until the network lands.
- **The two trends routes share one rate-limit bucket with different limits**: `` `${userId}:health-trends` `` at 10/60s (`app/api/health/trends/route.ts:32`) vs 20/60s (`app/api/health-trends/route.ts:87`) — they contend against each other.
- **`AiInsightCard` fires a bare POST `/api/ai/health-insight` on every detail-page mount** (`components/health/ai-insight-card.tsx:20-36`) — no cache; the route allows 10/hr, so a few detail-page visits exhaust the budget and later cards show errors.
- **HR day chart draws straight interpolated segments across power-gating gaps** (`components/health/hr-day-chart.tsx` — plots only present 5-min buckets on a linear 0–1440 axis; no null breaks), and the card **vanishes entirely** when a day has no readings (`oura-section.tsx:156`). The `/health/heart-rate` detail page never renders the day series at all (`app/health/heart-rate/page.tsx:41-81` — tiles + two sparklines only).
- **`weekly-stats` is never seeded synchronously** (`health-content.tsx:350`, no `readTodayCacheSync` in the `useLayoutEffect` at `:238-270`) → `WeeklyStatsHub` shows a skeleton on every open. **`metaLoading` stays `true` when a `body-metadata` cache entry exists but isn't today-fresh** (`health-content.tsx:241-246`) → all 13 Body-card skeletons pulse on repeat visits instead of painting last-known data.
- **`fetchMeta` serially awaits the local-store read before its network fetches** (`health-content.tsx:272-335`).
- **Body tab IA**: 16 cards; heart-data in 4 places (rhr/hrv/spo2 grid, hrvBaseline card, ouraIndicators chips, ouraSection advanced grid); steps in 3, water in 3, weight-trend in 3; the card-reorder edit mode is a no-op (`components/health/sortable-health-card.tsx:11` ignores `editMode`); bodyFat hand-rolls an inline SVG polyline (`health-sections.tsx:264-278`) while its siblings use `<Sparkline>`.
- **Offline-first siblings R3 does not cover**: the sleep detail page reads `sleep-sessions` server-only (`app/health/sleep/sleep-content.tsx:22-28`) while `health-content.tsx:310` reads the same domain local-first; injuries are **written** server-only (`components/health/injury-sheet.tsx:88/134/177` — no local write, no outbox) while `health-content.tsx:388-402` **reads** them local-first, so an offline injury add is silently lost.

---

## Chunk 1 — Cache correctness & route hygiene

*Staleness-bug class (the project's most repeated bug class). Small, high-confidence edits. Fully dev-DB + unit-test verifiable.*

### Task 1.1: Close the five invalidation-group gaps

**Files:**
- Modify: `lib/cache-groups.ts:65-82, 111-119, 135-153, 161-182, 238-250`
- Test: `lib/__tests__/cache-groups.test.ts`

- [ ] **Step 1: Extend the group test first** — in `lib/__tests__/cache-groups.test.ts`, add assertions (matching the file's existing style of spying on `invalidateCache`) that:
  - `invalidateExerciseLogged()` clears `weekly-muscle-sets`
  - `invalidateBodyMetricWrite()` clears `health-trends-summary`
  - `invalidateActivityWrites()` clears `health-trends-summary` and `training-load`
  - `invalidateNutritionWrite()` clears the `health-trends:` prefix
  - `invalidateBiometrics()` and `invalidateOuraSync()` clear `sleep-performance-correlation`
- [ ] **Step 2: Run to verify they fail** — `pnpm vitest run lib/__tests__/cache-groups.test.ts` → new assertions FAIL.
- [ ] **Step 3: Add the keys** in `lib/cache-groups.ts`:

```ts
// in invalidateExerciseLogged()
    invalidateCache('weekly-muscle-sets'),   // Muscle Volume This Week card — was only cleared on full workout completion

// in invalidateBodyMetricWrite()
    invalidateCache('health-trends-summary'), // steps/water sparklines read this payload

// in invalidateActivityWrites()
    invalidateCache('health-trends-summary'),
    invalidateCache('training-load'),         // walks/runs feed load

// in invalidateNutritionWrite()
    invalidateCache('health-trends:'),        // meal-timing correlation view buckets food logs

// in invalidateBiometrics() AND invalidateOuraSync()
    invalidateCache('sleep-performance-correlation'),
```

- [ ] **Step 4: Run tests** — `pnpm vitest run lib/__tests__/cache-groups.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Close health-tab cache invalidation gaps (weekly-muscle-sets, trends, correlation, training-load)"`

### Task 1.2: `oura-stats` becomes a today-keyed cache

**Files:**
- Modify: `components/health/oura-section.tsx:74-91` (the only read site — verified; also `grep -rn "'oura-stats'" components/ app/ lib/` to confirm, and check `components/sync-provider.tsx` `CACHE_TASKS` does not warm it)
- Modify: `lib/cache-groups.ts:140` (`invalidateOuraSync` already clears `oura-stats` — prefix match keeps working, no change needed; verify)

- [ ] **Step 1:** Convert the fetch at `oura-section.tsx:91` from `cachedFetch('oura-stats', …)` to `cachedFetchToday('oura-stats', '/api/oura/stats', TTL_MEDIUM, …)` and the seed from `readCacheSync` to `readTodayCacheSync`. **Rule: one fetch variant per key — every read site and the sync-provider warm list convert in the same commit** (there is exactly one read site and it is not warmed; re-verify with the greps above). If R6's PERF-7 (lazy-init → effect seeds) has already landed, edit its effect instead of the initializer; if not, land this as part of the same conversion R6 will do — coordinate, don't fight.
- [ ] **Step 2:** `pnpm dev`, open `/health`, check the Oura card renders; in DevTools set the cached entry's date to yesterday (or fake the clock) and confirm the seed is rejected rather than painting yesterday's wear/battery.
- [ ] **Step 3:** Commit.

### Task 1.3: Canonicalize the multi-site TTL

**Files:**
- Modify: `lib/cache-ttl.ts`
- Modify: the 5 `health-trends-summary` call sites (`components/health/oura-section.tsx:94`, `components/health/workout-density-card.tsx:15`, `components/health/nutrition-activity-trends-card.tsx:15`, `components/health/health-score-detail.tsx:150`, `app/health/heart-rate/page.tsx:27`)

- [ ] **Step 1:** Add to `lib/cache-ttl.ts` (matching the file's existing pattern):

```ts
/** /api/health/trends summary payload — fetched by 5 sibling cards. */
export const HEALTH_TRENDS_SUMMARY_TTL = TTL_LONG
```

- [ ] **Step 2:** Replace the raw `TTL_LONG` at all 5 sites with `HEALTH_TRENDS_SUMMARY_TTL`. (If R6's PERF-4 hoist has landed, there will be fewer sites — update whatever remains.)
- [ ] **Step 3:** `pnpm exec tsc --noEmit` clean; commit.

### Task 1.4: Split the shared rate-limit bucket

**Files:**
- Modify: `app/api/health/trends/route.ts:32`, `app/api/health-trends/route.ts:87`

- [ ] **Step 1:** Rename the buckets so the two routes stop contending:

```ts
// app/api/health/trends/route.ts
if (!rateLimit(`${userId}:health-trends-summary`, 10, 60_000)) {
// app/api/health-trends/route.ts — keep `${userId}:health-trends`, 20, 60_000
```

- [ ] **Step 2:** `pnpm dev`; `for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -b "$COOKIE" localhost:3000/api/health/trends; done` → 429 after 10; then hit `/api/health-trends?view=session-rpe` and confirm it still returns 200 (independent bucket).
- [ ] **Step 3:** Commit.

### Task 1.5: Cache the AI health insight per (section, day)

**Files:**
- Modify: `components/health/ai-insight-card.tsx:20-36`

- [ ] **Step 1:** Key the insight and read-before-POST using the cache lib's `getCached`/`setCached` (`lib/sqlite/cache.ts:88/101`):

```tsx
const key = `ai-health-insight:${section}:${date ?? todayInTz()}`
useEffect(() => {
  let cancelled = false
  ;(async () => {
    const cached = await getCached<string>(key)
    if (cached) { if (!cancelled) setInsight(cached); return }
    // existing POST logic; on success:
    await setCached(key, text, 6 * 60 * 60) // one insight per section per day-ish
    if (!cancelled) setInsight(text)
  })()
  return () => { cancelled = true }
}, [key])
```

  Keep the existing error state; a failed POST must still render the card's error branch (self-fetching-card rule), never a silent null.
- [ ] **Step 2:** `pnpm dev`, open `/health/readiness` twice — Network panel shows **one** POST total; second open paints from cache. Open `/health/sleep` — its own POST fires (different section).
- [ ] **Step 3:** Commit.

**Chunk 1 gate:** `pnpm lint && pnpm exec tsc --noEmit && pnpm test` green; dev-server pass: log water → NutritionActivityTrends water sparkline updates without waiting for TTL; log an exercise → Muscle Volume card updates.

---

## Chunk 2 — Post-re-key data honesty + surface decoded BLE data

*The user-facing core: the health tab quietly lost most of its Oura content at the 2026-07-07 re-key. Restore what BLE can feed; delete what it can't (dead conditional branches), so the tab reflects reality.*

### Task 2.1: Write respiratory rate from BLE IBI into `sleep_sessions`

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (rollup, around `:3680-3739`)
- Test: `lib/data/postgres/__tests__/oura-ble-sleep-fallback.test.ts` (extend — it already drives synthetic nights through the real rollup)

- [ ] **Step 1: Extend the DB-backed regression** — in the existing fallback test's synthetic night, IBI samples already exist; assert the resulting `sleep_sessions` row has `respiratoryRate` between 8 and 22 (the `breathingFromIbi` plausibility band). Run: `pnpm vitest run lib/data/postgres/__tests__/oura-ble-sleep-fallback.test.ts` → FAIL (null).
- [ ] **Step 2: Compute once per epoch, reuse for both consumers.** At `adapter.ts:3685` the stager maps bins → epochs calling `breathingFromIbi(b.ibi).variability`. Hoist the call so `rateBrpm` isn't discarded:

```ts
const breath = acc.map(b => breathingFromIbi(b.ibi))
const epochs: SleepEpoch[] = acc.map((b, i) => ({ movement: avg(b.mv), hr: avg(b.hr), hrv: avg(b.hv), temp: avg(b.tp), hrVar: std(b.hr), breathVar: breath[i].variability }))
const epochRates = breath.map(x => x.rateBrpm).filter((r): r is number => r != null)
const respiratoryRate = epochRates.length >= 6
  ? [...epochRates].sort((a, b) => a - b)[Math.floor(epochRates.length / 2)]  // night median; ≥6 epochs (~30 min) of signal
  : null
```

  Add `respiratoryRate` to the sleep-row literal (`:3718-3739`). `upsertOuraSleep`'s existing `COALESCE(EXCLUDED.respiratory_rate, …)` (`lib/data/postgres/slices/oura.ts:352`) means old Cloud rows are never clobbered by null and BLE nights now populate.
- [ ] **Step 3:** Run the test → PASS. Full gate: `pnpm test`.
- [ ] **Step 4:** Confirm the display chain: the sleep card's "br/m" chip (`health-sections.tsx:384`) and any sleep-detail consumer read `respiratoryRate` off `/api/sleep-sessions` — no UI change needed. `pnpm dev` + seeded night → chip renders.
- [ ] **Step 5:** Commit. Note in the PR: existing stored nights need one owner **Redecode** to backfill (decoder-change → redecode pass, per the Oura BLE rules).

### Task 2.2: Delete the dead OuraSection sub-cards; keep what's live

**Files:**
- Modify: `components/health/oura-section.tsx:211-361`

- [ ] **Step 1:** Remove the three conditionally-dead sub-cards — Activity (`:211-266`), Stress & Recovery (`:287-302`), Advanced (`:305-361`) — and their now-unused field plumbing. They render only when today's `oura_daily` has Cloud scores, which can never happen again (Cloud frozen; BLE writes only `non_wear_time_sec`). None of their fields (TDEE, walking-distance, activity-time split, stress/recovery minutes, VO₂/vascular-age/PWV/resilience) is BLE-derivable today; when a future BLE derivation exists (e.g. MET-based activity split from decoded `0x50`, already flagged as a future input in `lib/health/activity-score.ts:9-11`), it gets rebuilt against BLE data, not resurrected against a dead Cloud row.
- [ ] **Step 2:** Keep: the 24h HR chart, Time Worn tile + Wear sparkline, battery (UB4 owns its BLE upgrade), ring info, and the Readiness/Sleep contributor links (repoint their labels — see Task 2.5).
- [ ] **Step 3:** `pnpm dev` → `/health` Body tab: Oura card renders HR/wear/battery cleanly, no blank gaps. `pnpm exec tsc --noEmit` catches orphaned types.
- [ ] **Step 4:** Commit.

### Task 2.3: Remove the dead `ouraIndicators` Body-tab card

**Files:**
- Modify: `app/health/health-sections.tsx:153, 449-508`; `app/health/health-content.tsx:65-83` (order array)

- [ ] **Step 1:** Delete the `ouraIndicators` case and its entry in the Body order array. It is gated on `readiness?.ouraScore != null` — permanently null post-re-key — and every chip inside (temp deviation, resilience, day summary, VO₂, vascular age, recommended bedtime) is frozen-Cloud-only. (Item 1's A3/A4 will reintroduce a *BLE* temp-deviation signal with its own surface.)
- [ ] **Step 2:** `pnpm dev` → Body tab renders without the card; no key errors in console.
- [ ] **Step 3:** Commit.

### Task 2.4: Honest labels on own-score surfaces

**Files:**
- Modify: `app/health/activity/activity-content.tsx:19-28`, `app/health/sleep/sleep-content.tsx:48-61, 89-91`, `app/health/readiness/readiness-content.tsx:24-31`

- [ ] **Step 1:** Activity detail: the blend card labels its base "Oura N" but post-re-key the base is `computeActivityScore` (own). Relabel to "Base (app-computed)" / keep "+ training". Sleep detail: remove the `recommendedBedtimeStart/End` + `sleepTimeStatus` extra card and the `sleep_regularity` mention (frozen Cloud contributors, null for new days — dead branches). Readiness detail: remove the `temperatureDeviation` extra card (same; A3 re-adds from BLE later).
- [ ] **Step 2:** `pnpm dev` → all three detail pages render, no dead cards, disclaimer copy still shows on readiness.
- [ ] **Step 3:** Commit.

### Task 2.5: HR day chart — render gaps, don't interpolate; never vanish

**Files:**
- Modify: `components/health/hr-day-chart.tsx` (`toBuckets`/dataset, `:46-56, 124-184`)
- Modify: `components/health/oura-section.tsx:156-161` (card visibility)
- Test: `components/health/__tests__/hr-day-chart-gaps.test.ts` (new — pure function test)

- [ ] **Step 1: Extract + test the gap logic as a pure function** in the same file:

```ts
export function withGapBreaks(points: { x: number; y: number }[], gapMin = 20): ({ x: number; y: number } | null)[] {
  const out: ({ x: number; y: number } | null)[] = []
  points.forEach((p, i) => {
    if (i > 0 && p.x - points[i - 1].x > gapMin) out.push(null)
    out.push(p)
  })
  return out
}
```

  Test: buckets at x = 0, 5, 60 with `gapMin: 20` → `[p0, p1, null, p2]`; contiguous buckets → no nulls. Run `pnpm vitest run components/health/__tests__/hr-day-chart-gaps.test.ts` → FAIL, implement, PASS.
- [ ] **Step 2:** Feed the dataset through it and set `spanGaps: false` on the line dataset — the ring's power-gating gaps now render as visible breaks instead of fake straight lines. Keep the workout 15-s bins intact (they're contiguous by construction).
- [ ] **Step 3:** Replace the vanish-when-empty behaviour: `oura-section.tsx:156` renders the card whenever the ring is connected, with a "No HR captured yet today — the ring records periodically while worn" empty line when `hrReadings.length === 0` (self-fetching-card failure-state rule).
- [ ] **Step 4:** `pnpm dev` with seeded sparse HR → visible line breaks; empty day → empty state, not a missing card. Commit.

### Task 2.6: Heart-rate detail page gets the day series

**Files:**
- Modify: `app/health/heart-rate/page.tsx:41-107`

- [ ] **Step 1:** Add the `HrDayChart` (dynamic import, `ssr: false` — it's chart.js) under the stat grid, fed by the same `oura-hr-day:${today}` key/endpoint OuraSection uses (`cachedFetch`, `TTL_MEDIUM`, `readCacheSync` seed — copy `oura-section.tsx:78-106`'s pattern including the date-in-key). The page currently shows only Current/Min/Avg/Max tiles + two sparklines; the actual 24h series lives only on the main-screen Oura card.
- [ ] **Step 2:** `pnpm dev` → `/health/heart-rate` renders the chart with gap breaks; no data → the Task 2.5 empty state.
- [ ] **Step 3:** Commit.

**Chunk 2 gate:** full test suite + dev-server pass on `/health` and all four detail pages. **State in the PR: BLE-night respiratory-rate values and the HR-gap rendering are only truly verifiable on the owner's real data — sandbox uses synthetic frames** (device/redecode note).

---

## Chunk 3 — Instant paint & fetch efficiency

*Composes with R6 — if R6 hasn't landed yet, do its PERF-4 (trends hoist) and PERF-7 (lazy-init seeds) first or fold them in here; don't implement around them twice.*

### Task 3.1: Seed `weekly-stats` synchronously

**Files:**
- Modify: `app/health/health-content.tsx:238-270` (the `useLayoutEffect` seed block)

- [ ] **Step 1:** Add alongside the existing seeds:

```ts
const ws = readTodayCacheSync<WeeklyStatsResponse>('weekly-stats')
if (ws) setWeeklyStats(ws)
```

  (`weekly-stats` is fetched via `cachedFetchToday` at `:350`, so `readTodayCacheSync` is the matching reader.)
- [ ] **Step 2:** `pnpm dev` → open Health Training tab, reload — WeeklyStatsHub paints numbers instantly on the repeat visit, no skeleton.
- [ ] **Step 3:** Commit.

### Task 3.2: Stale cache paints; skeleton only when empty

**Files:**
- Modify: `app/health/health-content.tsx:238-270`

- [ ] **Step 1:** Today the seed block only accepts `body-metadata` when `isBodyMetadataFresh` passes, and `metaLoading` stays `true` otherwise → 13 pulsing Body cards on any not-today cache. Change to: always paint the cached payload's *non-today-specific* parts (`recent` trend arrays) immediately and clear `metaLoading`; keep the freshness guard only for `metaToday` (today's tiles), which stays null until network/local store confirms — the tiles already render "—" for null. Concretely: split `setMetaFromPayload(data, { todayFresh: isBodyMetadataFresh(data) })` so a stale entry sets `metaRecent` + `metaLoading=false` but not `metaToday`.
- [ ] **Step 2:** `pnpm dev`, warm the cache, fake the cached entry's date to yesterday, reload → sparklines/trends paint instantly, today tiles show "—" then fill from network; no full-card skeletons.
- [ ] **Step 3:** Commit.

### Task 3.3: Unserialize `fetchMeta`'s local-store read

**Files:**
- Modify: `app/health/health-content.tsx:272-335`

- [ ] **Step 1:** `fetchMeta` currently `await`s `Promise.all([store.getBodyMetrics…, store.getSleepSessions…])` before firing its three network fetches. Restructure so the local-store read and the network `Promise.all` start together; the local results apply first (seed), network results apply on arrival (they win — they're fresher). Preserve R3 Task 2.1's contract if it has landed (local path setting today's tile).
- [ ] **Step 2:** `pnpm dev` → Network panel: the three fetches start immediately on open (no ~local-read delay before them).
- [ ] **Step 3:** Commit.

### Task 3.4: Stable section identity — stop rebuilding every card every render

**Files:**
- Modify: `app/health/health-content.tsx:664-673` (ctx construction), `app/health/health-sections.tsx` (section renderers), `components/health/sortable-health-card.tsx`

- [ ] **Step 1:** `getHealthSections(ctx)` is called with a fresh object literal every render and returns fresh closures — with ~30 state hooks in the orchestrator, every keystroke/sheet-open re-renders all ~27 cards across all three mounted tab panels. Do the minimal stabilization that doesn't restructure the file (that's Chunk 4): `React.memo` the extracted child cards (`OuraSection`, `InjuryCard`, `NutritionActivityTrendsCard`, `WorkoutDensityCard`, `StrengthProgressCard`, `StrengthTrendCard`, `GoalsProgressCard`, `TrendsSection`, `AiPeriodizationStatusCard`, `AiWeeklyVolumeCard`, `WeeklyMuscleSetsCard`, `ActivityHistoryCard`) and fix their call sites to pass stable props (`useCallback` handlers; hoist the 7 `HealthMetricSheet`s' inline `[...metaRecent].reverse()` to a single `useMemo`d value at `health-content.tsx:786-846`).
- [ ] **Step 2:** Verify with React DevTools profiler on `pnpm dev`: opening the water-log sheet no longer re-renders OuraSection/TrendsSection.
- [ ] **Step 3:** Commit.

**Chunk 3 gate:** `pnpm lint && tsc && pnpm test` + the R6-overlap check (grep R6's plan tasks — anything it already landed, don't re-do).

---

## Chunk 4 — Body-tab information architecture

*The "display and grouping of sections" half of the review. Do after Chunk 2 (which deletes two dead cards) so the regroup works with the real card set.*

### Task 4.1: Regroup the Body tab under labelled sections

**Files:**
- Modify: `app/health/health-content.tsx:65-83` (order arrays), `app/health/health-sections.tsx` (render map)
- Create: `components/health/section-header.tsx` (tiny: `({ label }) => <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">{label}</h2>` — grep `components/ui/` first for an existing list-section-header primitive and reuse it if one exists)

- [ ] **Step 1:** Replace the flat 14-card scroll (post-Chunk-2 count) with grouped order (a `{ header: string; cards: string[] }[]` structure rendered by the existing map):
  - **Body** — bodyWeight, bodyFat, leanMass, bmi + caloriesBurned grid, weightTrend + energyBalance grid
  - **Sleep** — sleep
  - **Heart & recovery** — rhr/hrv/spo2 grid, hrvBaseline, trainingLoad, sleepVsPerformance
  - **Activity & intake** — steps/distance grid, waterIntake, nutritionActivityTrends
  - **Ring** — ouraSection
  - **Injuries** — injury
  This fixes the scattered heart data (was positions 11, 12, 6, 16) and puts sleep next to its correlation card's group. Keep ids stable — cache keys and sheets key off them.
- [ ] **Step 2:** `pnpm dev` at ≤640px viewport → scroll the Body tab: sections read coherently, no duplicate metric appears twice outside Goals (Progress tab is untouched).
- [ ] **Step 3:** Commit.

### Task 4.2: Remove the dead card-reorder mode

**Files:**
- Modify: `app/health/health-content.tsx:682-689` (LayoutGrid toggle), delete `components/health/sortable-health-card.tsx`

- [ ] **Step 1:** `SortableHealthCard` ignores `id` and `editMode` (a passthrough `<div>`) — the header's reorder toggle has never done anything. Delete the toggle, the `cardEditMode` state, and the wrapper (replace usages with plain `<div>`/fragment). If the owner wants real reordering later it's a fresh feature (persisted order + @dnd-kit), not this no-op.
- [ ] **Step 2:** `tsc` clean; dev-render; commit.

### Task 4.3: bodyFat sparkline uses the shared primitive

**Files:**
- Modify: `app/health/health-sections.tsx:264-278`

- [ ] **Step 1:** Replace the hand-rolled `<svg><polygon/><polyline/></svg>` with the `<Sparkline>` the bodyWeight/leanMass cards already use (`:191, 318`) — same data array, same accent prop.
- [ ] **Step 2:** Visual check both themes on `pnpm dev`; commit.

### Task 4.4: Split the two hotspot files under the ~800-line ceiling

**Files:**
- Modify: `app/health/health-content.tsx` (1149 lines), `app/health/health-sections.tsx` (972 lines)
- Create: `components/health/day-overlay-sheet.tsx`, `components/health/metric-sheets.tsx`, `components/health/body-cards/*.tsx` (as needed)

- [ ] **Step 1:** Extract from `health-content.tsx`: the ~230-line inline day-overlay `<Sheet>` (`:913-1139`) → `components/health/day-overlay-sheet.tsx` (props: overlay state + the existing handlers), and the 7 inline `HealthMetricSheet` instances (`:786-846`) → one `components/health/metric-sheets.tsx` that takes `metaRecent` + open-state. Extract from `health-sections.tsx` the largest inline card bodies (sleep, ouraIndicators is gone, rhr/hrv/spo2 grid) into `components/health/body-cards/`. Pure moves — no behaviour change; keep prop shapes identical.
- [ ] **Step 2:** `wc -l app/health/health-content.tsx app/health/health-sections.tsx` → both < 800. Full gate + dev-render of every moved surface (open each metric sheet, the day overlay, edit/delete dialogs).
- [ ] **Step 3:** Commit.

---

## Chunk 5 — Offline-first siblings (not covered by R3)

### Task 5.1: Sleep detail page reads local-first

**Files:**
- Modify: `app/health/sleep/sleep-content.tsx:22-28`

- [ ] **Step 1:** Mirror `health-content.tsx:310`'s pattern: try `getLocalStore(userId)` → `store.getSleepSessions(...)` first, fall back to the existing `cachedFetch('sleep-sessions', …)`. Same domain, sibling surface — the sibling-surface sweep rule.
- [ ] **Step 2:** Web sandbox renders the fallback path (local store is null on web — expected); `pnpm dev` → `/health/sleep` unchanged. **APK is the real gate** — add to the PR's not-exercised list.
- [ ] **Step 3:** Commit.

### Task 5.2: Injury writes get a local + outbox path

**Files:**
- Modify: `components/health/injury-sheet.tsx:88, 134, 177`, `lib/local-store/` (injuries table already exists — reads work), `lib/sync/` outbox (`queueMutation` domains), `lib/data/postgres/adapter.ts` (`pushMutations` branch), the injuries API route (shared write function)
- Test: extend the sync parity tests that cover other outbox domains

- [ ] **Step 1:** Injuries are read local-first (`health-content.tsx:388-402`) but written server-only — an offline add/edit/resolve is lost and never appears. Give the domain the standard shape, following the checklist in CLAUDE.md's Offline-First section and the one-write-function rule: extract the route's write logic into a shared `lib/` function; `injury-sheet.tsx` writes `store.upsertInjury` + `queueMutation('injuries', …)` with fire-and-forget POST; add the `pushMutations` branch calling the shared function (user-scoped, poison-pill-safe); verify the full chain (local columns = payload = `getSyncDelta` = `pullDelta` = `applyDelta`, tombstones for delete, `sync_status` gating).
- [ ] **Step 2:** Run the CI custom rule locally: `node scripts/check-push-mutations.js` → the new branch must use the shared function, not raw `this.db`/`sql`.
- [ ] **Step 3:** DB-backed test: queue an injury mutation → push → row lands user-scoped; a malformed one quarantines without wedging the queue. **On-device APK verify required** — sandbox can't run native SQLite.
- [ ] **Step 4:** Commit.

---

## Chunk 6 — Missing-data states sweep

### Task 6.1: No silent vanishes on self-fetching health cards

**Files:**
- Modify: `components/health/oura-section.tsx:118`, plus any card found by: `grep -n "return null" components/health/*.tsx app/health/**/*.tsx`

- [ ] **Step 1:** Audit each `return null` against the rule "self-fetching cards need an explicit failure state": distinguish *legitimately hidden* (feature not applicable, e.g. no ring connected → OuraSection hidden is fine) from *data-fetch-failed/empty* (must show an error/empty line). Task 2.5 already fixed the HR card; apply the same treatment to any other card whose `null` can be reached by a failed fetch (`cachedFetch` swallows `!res.ok`).
- [ ] **Step 2:** `pnpm dev` with the API forced to 500 (temporarily throw in one route) → the affected card shows its error line instead of disappearing.
- [ ] **Step 3:** Commit.

---

## Verification summary (per session working this plan)

- Gate every chunk: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`, plus `pnpm dev` exercising `/health` (all three tabs), `/health/sleep`, `/health/readiness`, `/health/activity`, `/health/heart-rate`, `/health/timeline` at ≤640px.
- **Not exercisable in-sandbox (state in every PR):** real BLE-night respiratory rate + HR-gap shapes (synthetic data only), local-store paths (5.1/5.2 — `getLocalStore` is null on web), Samsung WebView paint, safe-area. Run `docs/device-smoke-checklist.md` items on the S25 for chunks 2, 4, 5.
- Owner action after Chunk 2 deploys: one **Redecode** to backfill respiratory rate onto stored nights.
- Version bump: minor (user-visible feature restoration + IA change) in the completing PR, with a `lib/changelog.ts` entry.

## Self-review notes (2026-07-10)

- Findings→tasks coverage checked against the three review sweeps; every finding either has a task above or is mapped to its owning queue item in the dedup table.
- The plan deliberately does **not** restructure the Training/Progress tabs (no findings there beyond what R6 owns) and does not touch the timeline page beyond what R8 owns (date param) — YAGNI.
- Line numbers are `main`@`3f7dd47`-accurate; R6/R7 landing first will shift them — re-verify at implementation time (the standard stale-plan check in the backlog protocol).
