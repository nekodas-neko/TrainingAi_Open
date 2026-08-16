# Respiratory-Rate Illness Biomarker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nightly respiratory rate the illness radar's fourth biomarker. The BLE rollup already computes a real breaths/min per night (median of per-epoch `breathingFromIbi` rates, `lib/data/postgres/adapter.ts:3936-3943`) into `sleep_sessions.respiratory_rate` — but its only consumer is one display chip. Breathing rate is one of Oura's own 7 illness biomarkers, and `lib/health/illness-radar.ts:12-13` explicitly documents the omission ("we carry no breathing baseline yet"). Give it a personal baseline on `oura_daily_summary` (mirroring the five existing metrics) and feed its one-sided higher-is-worse z into the shared radar.

**Architecture:** One new migration (**125** — re-verify, see Task 2) adds `breath_avg_rpm` + `breath_baseline_mean_x8`/`breath_baseline_dev_x8` to `oura_daily_summary`, exactly mirroring the per-metric baseline pattern from migration 116. `NightInput` gains `breathAvgRpm`, fed in the rollup from the *same* `respiratoryRate` value already written to `sleep_sessions`; `computeDailySummaries` replays its asymmetric-EMA baseline (`updateBaseline`, rpm×10 integer samples — the MET ×10 trick) night-by-night like every other metric. The radar's shared `illnessZScores` gains `breathZ` (one-sided up-bad, like RHR), `ILLNESS_WEIGHTS` becomes temperature 0.40 / breathing 0.25 / restingHeartRate 0.20 / hrvBalance 0.15, still renormalised over whichever biomarkers are present — so nights without a breathing signal behave (near-)identically to today. Both consumers of the shared z — the readiness route's live path and the rollup's per-night illness persist — pick the change up from the same two functions, so stored and displayed illness cannot diverge (verified: the rollup calls `illnessFromSummaries`, which calls `illnessZScores`; the route calls `illnessZScores` + `computeIllnessRadar` directly).

**Tech Stack:** TypeScript, Drizzle/Postgres (idempotent SQL migration, auto-applied by `ensureSchema` on cold start), vitest (pure unit tests + local-Postgres integration tests), Next.js API route.

---

## Why now

Data-efficiency review **S4 / §1.2** (`docs/reviews/2026-07-16-data-efficiency-review.md`, High severity): "Respiratory rate: computed nightly, baselined nowhere." The radar renormalises weights over present biomarkers (`illness-radar.ts:110-114`), which makes a fourth biomarker near-drop-in once a baseline column exists. This closes the radar's own documented gap and strengthens the app's strongest "don't train hard today" signal (elevated nocturnal breathing is a classic early respiratory-infection marker).

**Branch:** `feat/respiratory-illness-biomarker`

## Cold start / backfill behaviour (investigated — this decides when the biomarker goes live)

**Answer: full historical backfill on the first post-deploy rollup; no extra maturation wait beyond the radar's existing gate.**

- `aggregateOuraRawSamples` reads the **entire** `oura_raw_samples` table per user — `rowsByTags` (`adapter.ts:3691-3700`) has no time cursor — and reassembles every night from raw IBI on every pass. `replaceOuraDailySummary` (`lib/data/postgres/slices/oura.ts:563-594`) **deletes all summary rows and reinserts** the full replayed history (`repository.ts:716-718` documents this derive-don't-drift contract).
- Therefore the breathing baseline is **backfilled for every historical night** whose raw IBI supports a rate (raw `body_hex` is archival and never pruned; BLE ingest has run since the 2026-07-07 re-key). The breathing baseline matures in lockstep with the shared `n_history` counter — it does *not* start cold on deploy day.
- The radar's only gate is the existing shared `nHistory >= BASELINE_MIN_NIGHTS` (14, `lib/health/readiness-composite.ts:15`). For the owner (history since 2026-07-07) the whole radar is `learning` until ~2026-07-21; breathing participates from the very night the radar itself matures.
- Nights with sparse/no IBI simply skip the breathing update (same as every other metric); `breathZ` is null-guarded (`prior?.breathBaseline` + `baselineZ`'s `devX8 === 0` guard) and the weights renormalise — the existing mechanism, no new code path.

**Asymmetric-EMA config choice (investigated):** `updateBaseline` has no per-metric knobs — the "config" is the integer sample scaling. `breathingFromIbi` rounds `rateBrpm` to 0.1 (`breathing-rate.ts:101`), so breathing uses **rpm×10** samples (`Math.round(rpm * 10)`), the same sub-unit-resolution trick as MET ×10 (`daily-summary.ts:65-70`). Deviation direction for the radar: **elevated breathing = illness-consistent** (`up-bad`, like RHR; Oura's `illness_detection` biomarker guide agrees — see `docs/superpowers/plans/2026-07-15-oura-recovery-readiness-and-health-events.md:241-244`).

**Deliberately NOT a readiness contributor:** breathing feeds the illness radar only, never `computeReadinessComposite` — it is an illness biomarker in Oura's model, not a readiness contributor, and the radar's no-double-count rule (`illness-radar.ts:14-16`) stays intact.

## File structure

**Create:**
- `lib/data/postgres/migrations/125_breathing_baseline.sql` — three `ADD COLUMN IF NOT EXISTS` on `oura_daily_summary`.

**Modify:**
- `lib/health/daily-summary.ts` — `NightInput.breathAvgRpm`, `DailySummaryRow.breathBaseline`, replay line.
- `lib/health/personal-baseline.ts` — header comment only ("all five baselines" → six).
- `lib/health/illness-radar.ts` — weights, `breathZ`, `IllnessSummaryInput`, advisory copy, header caveat removed.
- `lib/data/postgres/adapter.ts` — feed `breathAvgRpm: respiratoryRate` into `nightInputsByDate` (2 call sites).
- `lib/data/postgres/schema.ts`, `lib/data/repository.ts`, `lib/data/postgres/slices/oura.ts` — column + row type + persist/read mappings.
- `app/api/readiness-score/route.ts` — destructure + pass `breathZ` (live consumer).
- Tests: `lib/health/__tests__/daily-summary.test.ts`, `lib/health/__tests__/illness-radar.test.ts`, `lib/data/postgres/__tests__/oura-ble-daily-summary.test.ts`.
- Final task: `package.json` + `lib/changelog.ts` (minor bump), `projectOverview.md` (ledger + status), journal (`docs/overview/history-*.md`), `docs/module-map.md` (baseline row lists metrics), `docs/planned_upgrades.md` (S4), `docs/implementation-backlog.md` (remove this plan's entry).

**Repo-rule notes for the implementer:** repository pattern (all DB access through `repo.*`/slices — no raw SQL at call sites); **One Formula, One Place** — `illnessZScores`/`illnessFromSummaries` stay the single shared implementation, never fork or inline the z math anywhere; **sibling-surface sweep** — both illness consumers (route + rollup) land in the same PR (Task 4 verifies); stored-counter rule N/A (baselines are replayed, not incremented); migration number claimed against the directory AND open plans AND the projectOverview ledger (Task 2).

---

### Task 1: Breathing baseline in the pure replay layer

**Files:**
- Modify: `lib/health/daily-summary.ts`, `lib/health/personal-baseline.ts`, `lib/data/postgres/adapter.ts`
- Test: `lib/health/__tests__/daily-summary.test.ts`

- [ ] **Step 1: Write the failing tests**

In `lib/health/__tests__/daily-summary.test.ts`, add `breathAvgRpm: 14.5,` to the `night()` helper defaults (after `metAvg: 1.2,`), and append to the describe block:

```typescript
  it('accrues a breathing baseline from breathAvgRpm in rpm×10 sample units', () => {
    const rows = computeDailySummaries([night('2026-07-01'), night('2026-07-02', { breathAvgRpm: 15.0 })])
    // First-ever sample: 14.5 rpm → integer sample 145 → sampleX8 1160; warm-up band
    // (age 0) takes half the delta → mean 580, dev 73. Deterministic — pins the ×10 units.
    expect(rows[0].breathBaseline).toEqual({ meanX8: 580, devX8: 73 })
    expect(rows[1].breathBaseline).not.toEqual(rows[0].breathBaseline)
  })

  it('skips the breathing baseline on a null-breath night, but still advances n_history', () => {
    const rows = computeDailySummaries([
      night('2026-07-01'),
      night('2026-07-02', { breathAvgRpm: null }),
      night('2026-07-03'),
    ])
    expect(rows[1].breathBaseline).toEqual(rows[0].breathBaseline) // unchanged — no sample that night
    expect(rows[2].nHistory).toBe(3)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/health/__tests__/daily-summary.test.ts`
Expected: FAIL — TS error, `breathAvgRpm` not in `NightInput` (and `breathBaseline` not on `DailySummaryRow`).

- [ ] **Step 3: Implement**

In `lib/health/daily-summary.ts`:

`NightInput` (after `metAvg: number | null`):

```typescript
  /** Night median breaths/min — the SAME value the rollup stores on
   *  sleep_sessions.respiratory_rate (median of per-epoch breathingFromIbi rates). */
  breathAvgRpm: number | null
```

`DailySummaryRow` (after `metBaseline: Baseline | null`):

```typescript
  breathBaseline: Baseline | null
```

In `computeDailySummaries`, add `let breathBaseline: Baseline | null = null` beside the other five, and after the MET update line (`daily-summary.ts:70`):

```typescript
    // Breathing in rpm×10 for integer-sample resolution (same trick as MET ×10) —
    // rateBrpm carries 0.1-rpm precision that a bare Math.round would destroy.
    if (night.breathAvgRpm != null) breathBaseline = updateBaseline(breathBaseline, Math.round(night.breathAvgRpm * 10), ageDays)
```

Add `breathBaseline` to the `rows.push({...})` baseline list. Update the `nHistory` doc comment ("shared age counter across all five metrics" → "all six metrics") — same phrase in `DailySummaryRow`'s comment.

In `lib/health/personal-baseline.ts` header comment: "Used for all five Oura BLE Phase 5 baselines (HRV, RHR, temperature, sleep, MET)" → "…all six … (HRV, RHR, temperature, sleep, MET, breathing rate)".

In `lib/data/postgres/adapter.ts` — `NightInput` is now a required field, so both constructor sites must feed it in this same commit:

1. The per-night push (`adapter.ts:4097-4111`), after `tempMeanC,`:

```typescript
        breathAvgRpm: respiratoryRate,
```

(`respiratoryRate` is the local computed at `adapter.ts:3912/3941-3943` — the same value pushed onto `sleepRows` at `:4068`. No recomputation: one formula, one place.)

2. The MET-only fallback branch (`adapter.ts:4352-4356`), add `breathAvgRpm: null` to the null-shell object.

- [ ] **Step 4: Run to verify pass + typecheck + commit**

Run: `npx vitest run lib/health/__tests__/daily-summary.test.ts && npx tsc --noEmit`
Expected: tests green; tsc clean (`DailySummaryRow` structurally still satisfies `replaceOuraDailySummary`'s param — extra `breathBaseline` prop is ignored until Task 2 persists it).

```bash
git add lib/health/daily-summary.ts lib/health/personal-baseline.ts lib/data/postgres/adapter.ts lib/health/__tests__/daily-summary.test.ts
git commit -m "Accrue a nightly breathing-rate personal baseline in the daily-summary replay"
```

---

### Task 2: Migration 125 + schema + repo type + persist/read mappings

**Files:**
- Create: `lib/data/postgres/migrations/125_breathing_baseline.sql`
- Modify: `lib/data/postgres/schema.ts`, `lib/data/repository.ts`, `lib/data/postgres/slices/oura.ts`

- [ ] **Step 1: Re-verify the migration number (do NOT skip)**

125 was verified free on 2026-07-16 against all three sources, but the repo moves fast — re-verify **now**:

1. `ls lib/data/postgres/migrations/` — highest on disk must still be `124_rr_intervals.sql`. (**120 is pencilled for the ring-triggered walk-detection plan's Chunk 3** — never take 120.)
2. The `projectOverview.md` ledger line (search "Next free Postgres migration number") — currently says **125**.
3. Open plan docs: `grep -rn "125_\|migration 125" docs/superpowers/plans/ docs/implementation-backlog.md` (excluding this plan) — must be empty.

If 125 has been claimed meanwhile, renumber to the next free (filename + this plan's references) — `migrate.js` applies in plain filename sort order, so a duplicate number makes apply order ambiguous. Update the ledger line in this same PR (final task).

- [ ] **Step 2: Write the migration**

```sql
-- 125_breathing_baseline.sql
-- Respiratory-rate illness biomarker (data-efficiency review 2026-07-16 §1.2 / S4).
-- The rollup already computes a nightly breaths/min (median of per-epoch
-- breathingFromIbi rates) into sleep_sessions.respiratory_rate; this gives it a
-- personal baseline on oura_daily_summary, mirroring the five existing metrics
-- (116_oura_daily_summary_baselines.sql). breath_avg_rpm is this night's raw value;
-- the baseline is the same ×8 fixed-point asymmetric-EMA state, carried in rpm×10
-- sample units (integer-sample resolution, same trick as met ×10). Backfills for
-- all history on the next rollup pass — the summary table is a full replay from
-- oura_raw_samples, so the baseline matures in lockstep with n_history.
ALTER TABLE oura_daily_summary ADD COLUMN IF NOT EXISTS breath_avg_rpm          DOUBLE PRECISION;
ALTER TABLE oura_daily_summary ADD COLUMN IF NOT EXISTS breath_baseline_mean_x8 INTEGER;
ALTER TABLE oura_daily_summary ADD COLUMN IF NOT EXISTS breath_baseline_dev_x8  INTEGER;
```

Idempotent (`IF NOT EXISTS`), additive-only, no destructive steps, auto-applied by `ensureSchema` on cold start and by `scripts/local-db/migrate.js` locally.

- [ ] **Step 3: Schema + row type + slice mappings**

`lib/data/postgres/schema.ts`, `ouraDailySummary` (`~:750-783`): after `metAvg` add

```typescript
  breathAvgRpm:       doublePrecision('breath_avg_rpm'),
```

and after `metBaselineDevX8` add

```typescript
  breathBaselineMeanX8: integer('breath_baseline_mean_x8'),
  breathBaselineDevX8:  integer('breath_baseline_dev_x8'),
```

Update the table's "all five metrics" comment to six.

`lib/data/repository.ts`, `OuraDailySummaryRow` (`:817-838`): add `breathAvgRpm: number | null` after `metAvg` and `breathBaseline: BaselineStateRow | null` after `metBaseline`.

`lib/data/postgres/slices/oura.ts`:

- `replaceOuraDailySummary` (`:563-594`) insert mapping — add, mirroring MET exactly:

```typescript
    breathAvgRpm:        r.breathAvgRpm,
    breathBaselineMeanX8: r.breathBaseline?.meanX8 ?? null,
    breathBaselineDevX8:  r.breathBaseline?.devX8 ?? null,
```

- `getOuraDailySummary` (`:596-624`) read mapping — add:

```typescript
    breathAvgRpm: r.breathAvgRpm,
    breathBaseline: r.breathBaselineMeanX8 != null ? { meanX8: r.breathBaselineMeanX8, devX8: r.breathBaselineDevX8 ?? 0 } : null,
```

(Missing either mapping is the classic "save doesn't persist" silent failure — both sides in this one commit, per the row-mapper rule.)

- [ ] **Step 4: Apply + typecheck + commit**

Run: `node scripts/local-db/migrate.js` (or `pnpm db:local`) — expect 125 applied, idempotent on re-run. Then `npx tsc --noEmit` — clean (`DailySummaryRow` now persists `breathBaseline`; `getOuraDailySummary` rows carry it back).

```bash
git add lib/data/postgres/migrations/125_breathing_baseline.sql lib/data/postgres/schema.ts lib/data/repository.ts lib/data/postgres/slices/oura.ts
git commit -m "Persist the nightly breathing rate + baseline on oura_daily_summary (migration 125)"
```

---

### Task 3: Fourth biomarker in the illness radar (+ both consumers)

**Files:**
- Modify: `lib/health/illness-radar.ts`, `app/api/readiness-score/route.ts`
- Test: `lib/health/__tests__/illness-radar.test.ts`

- [ ] **Step 1: Write the failing tests**

In `lib/health/__tests__/illness-radar.test.ts`:

Add `breathZ: null,` to **every existing** `computeIllnessRadar({...})` literal (the field is required, like its siblings), and `breathBaseline: null, breathAvgRpm: null,` to the base `prior: IllnessSummaryInput` fixture (`:75-80`). The existing flag assertions all survive the reweight — with breathing absent the three weights renormalise 0.40/0.20/0.15 → 0.533/0.267/0.200 (vs today's 0.50/0.30/0.20): the "watch" fixture scores 46 (was 47), "elevated" scores 82 (was 83), "normal"/"fever"/healthy-direction/renormalise-to-100 are unchanged in band.

Append new tests:

```typescript
  it('treats elevated breathing as illness-consistent (one-sided, up-bad like RHR)', () => {
    const up = computeIllnessRadar({ tempZ: null, rhrZ: null, hrvZ: null, breathZ: 3, nHistory: MATURE })
    expect(up.score).toBe(100) // sole biomarker → weight renormalised to 1
    expect(up.flag).toBe('elevated')
    const down = computeIllnessRadar({ tempZ: null, rhrZ: null, hrvZ: null, breathZ: -3, nHistory: MATURE })
    expect(down.score).toBe(0) // slower breathing is not an illness signal
  })

  it('gives breathing its 0.25 weighted share when all four biomarkers are present', () => {
    const r = computeIllnessRadar({ tempZ: 0, rhrZ: 0, hrvZ: 0, breathZ: 3, nHistory: MATURE })
    expect(r.score).toBe(25)
    expect(r.biomarkers.breathing?.contribution).toBe(25)
  })
```

And in the `illnessFromSummaries` describe:

```typescript
  it('derives a breathing z from the prior night\'s baseline, in rpm×10 units', () => {
    // breath baseline: mean_x8 1160 → 145 units (14.5 rpm); dev_x8 40 → 5 units (0.5 rpm).
    const p: IllnessSummaryInput = { ...prior, breathBaseline: { meanX8: 1160, devX8: 40 }, breathAvgRpm: 14.5 }
    const current: IllnessSummaryInput = { ...p, breathAvgRpm: 16.0, nHistory: 21 }
    const r = illnessFromSummaries(p, current)
    expect(r.biomarkers.breathing?.z).toBe(3) // (160 − 145) / 5
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/health/__tests__/illness-radar.test.ts`
Expected: FAIL — `breathZ` not in `IllnessInputs`, `breathing` not a weight key.

- [ ] **Step 3: Implement the radar changes**

In `lib/health/illness-radar.ts`:

Header comment (`:12-13`): replace the caveat bullet with:

```
//  - Breathing rate joined as the 4th biomarker (2026-07-16, review S4): nightly
//    respiratory rate vs its own personal baseline, one-sided higher-is-worse.
//    Weights still renormalise over whichever biomarkers a night actually has.
```

Weights (`:24-28`) — temperature stays first (fever is still the strongest signal), breathing second per Oura's `illness_detection` biomarker ordering:

```typescript
export const ILLNESS_WEIGHTS = {
  temperature:      0.40,
  breathing:        0.25,
  restingHeartRate: 0.20,
  hrvBalance:       0.15,
} as const
```

`IllnessInputs` — after `hrvZ`:

```typescript
  /** Same, for nightly respiratory rate. Up = illness-consistent. */
  breathZ: number | null
```

`computeIllnessRadar` — insert after the `tempZ` push (`:99`), keeping biomarker order = weight order:

```typescript
  if (input.breathZ != null) signals.push({ key: 'breathing', z: input.breathZ, signal: illnessSignal(input.breathZ, 'up-bad') })
```

`IllnessSummaryInput` (`:135-143`) — add:

```typescript
  breathBaseline: Baseline | null
  breathAvgRpm: number | null
```

`illnessZScores` (`:148-156`) — extend the return type with `breathZ: number | null` and add (comment: breathing is compared in rpm×10 to match the baseline units, same pattern as temp's centi-°C):

```typescript
    breathZ: prior?.breathBaseline && current.breathAvgRpm != null ? baselineZ(prior.breathBaseline, Math.round(current.breathAvgRpm * 10)) : null,
```

`illnessFromSummaries` (`:159-162`) — destructure and pass `breathZ` through to `computeIllnessRadar`.

`illnessAdvisory` `'elevated'` copy — biomarker list mentions what the radar watches, so include breathing (the `/fighting/i` test assertion still passes):

```typescript
      return 'Signs your body may be fighting something (temperature, resting HR, HRV, breathing rate moving together) — readiness lowered.'
```

- [ ] **Step 4: Update BOTH consumers of the shared z (sibling-surface sweep)**

**Consumer 1 — readiness route (live path).** `app/api/readiness-score/route.ts:255-257` and `:275-277`:

```typescript
  const { rhrZ, hrvZ, tempZ, breathZ } = latestSummary
    ? illnessZScores(priorSummary, latestSummary)
    : { rhrZ: null, hrvZ: null, tempZ: null, breathZ: null }
```

```typescript
  const illness = latestSummary
    ? computeIllnessRadar({ tempZ, rhrZ, hrvZ, breathZ, nHistory: latestSummary.nHistory })
    : null
```

**`breathZ` goes ONLY to the radar** — do NOT add it to the `computeReadinessComposite` inputs (`:258-269`). Breathing is an illness biomarker, not a readiness contributor; the composite is untouched.

**Consumer 2 — rollup illness persist.** `adapter.ts:4367-4376` calls `illnessFromSummaries(summaryRows[i-1], summaryRows[i])` — **no code change needed**: `DailySummaryRow` now carries `breathAvgRpm` (via `NightInput`, Task 1) and `breathBaseline` (Task 1), so it structurally satisfies the extended `IllnessSummaryInput` (the structural contract documented at `illness-radar.ts:132-134` — the route's `OuraDailySummaryRow` satisfies it too via Task 2). Verify by reading the call site and letting `tsc` prove it — if tsc flags either shape, fix the shape, never fork the function.

- [ ] **Step 5: Run to verify pass + typecheck + commit**

Run: `npx vitest run lib/health/__tests__/illness-radar.test.ts && npx tsc --noEmit`
Expected: all green (tsc covers both consumers).

```bash
git add lib/health/illness-radar.ts app/api/readiness-score/route.ts lib/health/__tests__/illness-radar.test.ts
git commit -m "Add breathing rate as the illness radar's 4th biomarker"
```

---

### Task 4: Rollup integration test — breathing lands in the summary end-to-end

**Files:**
- Modify: `lib/data/postgres/__tests__/oura-ble-daily-summary.test.ts`

The existing seed's 0x80 rows carry only `hr_bpm` (no `ibi_ms`), so `breathingFromIbi` returns null there. Give the seed a real respiratory oscillation — copy the RSA synthesis from `oura-ble-sleep-fallback.test.ts:52-68` (an ~800 ms beat interval modulated by a 4.2 s breathing cycle ≈ 14.3 br/min).

- [ ] **Step 1: Extend the seed with an RSA IBI stream**

In `seedNight` (`oura-ble-daily-summary.test.ts:24-61`), synthesize the night's beat train once and slice a chunk into each of the 400 existing 0x80 rows (each row spans ~72 s → ~90 beats — comfortably above `breathingFromIbi`'s 40-beat epoch minimum when pooled into 5-min epochs):

```typescript
    const BASE_IBI_MS = 800, AMP_IBI_MS = 60, BREATH_PERIOD_MS = 4200 // ≈14.3 br/min RSA
    const totalMs = ((endDs - startDs) / 10) * 1000
    const beats: { t: number; ibi: number }[] = []
    for (let t = 0; t < totalMs; ) {
      const ibi = Math.round(BASE_IBI_MS + AMP_IBI_MS * Math.sin((2 * Math.PI * t) / BREATH_PERIOD_MS))
      beats.push({ t, ibi })
      t += ibi
    }
```

Then, inside the existing 400-row loop, replace the shared `decoded` constant with a per-row object that adds the row's slice:

```typescript
      const rowStartMs = (r / rowCount) * totalMs
      const rowEndMs = rowStartMs + totalMs / rowCount
      const ibiChunk = beats.filter(b => b.t >= rowStartMs && b.t < rowEndMs).map(b => b.ibi)
      const decoded = JSON.stringify({ hr_bpm: hr, rmssd_ms: [42, 44, 46], ibi_ms: ibiChunk })
```

(The existing assertions — temp values, `nHistory`, idempotency, `sleepSessions: 2` — assert nothing the IBI stream perturbs; re-run them to confirm.)

- [ ] **Step 2: Write the failing assertion**

Append:

```typescript
  it('computes a nightly breathing rate and accrues its baseline (review S4)', async () => {
    const rows = await repo.getOuraDailySummary(TEST_USER_ID, '2000-01-01', '2100-01-01')
    // Night value in the plausibility band around the seeded ~14.3 br/min RSA.
    expect(rows[0].breathAvgRpm).not.toBeNull()
    expect(rows[0].breathAvgRpm!).toBeGreaterThanOrEqual(8)
    expect(rows[0].breathAvgRpm!).toBeLessThanOrEqual(22)
    // Baseline seeded by night 1, carried into night 2 (rpm×10 fixed-point state).
    expect(rows[1].breathBaseline).not.toBeNull()
  })
```

Run **before** re-seeding (i.e. with Task 1-3 code but the old seed) if convenient to see it fail on `breathAvgRpm: null`; with the new seed it must pass.

The sibling `oura-illness-persist.test.ts` needs **no change**: its 2-night cold-baseline path asserts `learning`/score 0, which stays exactly right (mature-path breathing math is covered by the Task 3 unit tests).

- [ ] **Step 3: Run the DB integration suite + commit**

Run (local Postgres must be up — `pnpm db:local`):
`npx vitest run lib/data/postgres/__tests__/oura-ble-daily-summary.test.ts lib/data/postgres/__tests__/oura-illness-persist.test.ts lib/data/postgres/__tests__/oura-ble-sleep-fallback.test.ts`
Expected: all green (fallback test is the respiratory-rate regression guard — unchanged, must stay green).

```bash
git add lib/data/postgres/__tests__/oura-ble-daily-summary.test.ts
git commit -m "Integration-cover the breathing baseline through the BLE rollup"
```

---

### Task Final: Gate + dev-server smoke + version + docs

- [ ] **Step 1: Full gate**

Run: `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`
Expected: all green (DB integration tests run against the local Postgres, matching CI's Lint / Type Check / Tests / Build / Custom Rules / Migration Check).

- [ ] **Step 2: Dev-server smoke — seeded elevated breathing flags the radar**

Against the local DB (port 5433, auto-set-up; `pnpm dev`):

1. Seed two mature summary nights for the test user (baselines on the *prior* night are what `illnessZScores` reads; breathing baseline 14.5 rpm = mean_x8 1160 / dev_x8 40; tonight's breathing 18 rpm → z = 7 → clipped signal 100; RHR 58 vs baseline 50±3 → z ≈ 2.67 → signal ~89; temp/HRV on baseline):

```bash
psql postgresql://postgres:postgres@localhost:5433/trainingai_dev <<'SQL'
WITH u AS (SELECT id FROM users WHERE email = 'test@local.dev'),
     d AS (DELETE FROM oura_daily_summary WHERE user_id = (SELECT id FROM u))
INSERT INTO oura_daily_summary (user_id, date, hrv_avg_ms, rhr_low_bpm, temp_mean_c, breath_avg_rpm,
  hrv_baseline_mean_x8, hrv_baseline_dev_x8, rhr_baseline_mean_x8, rhr_baseline_dev_x8,
  temp_baseline_mean_x8, temp_baseline_dev_x8, breath_baseline_mean_x8, breath_baseline_dev_x8, n_history)
SELECT id, CURRENT_DATE - 1, 60, 50, 35.0, 14.5, 480, 64, 400, 24, 28000, 160, 1160, 40, 20 FROM u
UNION ALL
SELECT id, CURRENT_DATE,     60, 58, 35.0, 18.0, 480, 64, 400, 24, 28000, 160, 1160, 40, 21 FROM u;
SQL
```

2. Log in as `test@local.dev` / `testpass123`, hit `GET /api/readiness-score`. **Expected:** `illnessFlag: "watch"` (score ≈ 25 from breathing + ~18 from RHR ≈ 43), `illnessBiomarkers.breathing` present with `z: 7` and `contribution: 25`, `illnessAdvisory` the watch copy. **Broken looks like:** no `breathing` key (slice read mapping missed) or `illnessFlag: "normal"` with score < 40 sans breathing share (route not passing `breathZ`).
3. Revert tonight's breathing to baseline — `UPDATE oura_daily_summary SET breath_avg_rpm = 14.5 WHERE date = CURRENT_DATE AND user_id = (SELECT id FROM users WHERE email='test@local.dev');` — re-hit the route: breathing z drops to 0 contribution and the flag falls back (RHR alone ≈ 18 → `normal`).
4. Open Health → Readiness in the browser (S25 viewport ≤ 640px) with the elevated seed — the advisory block renders the flag + copy (it reads `illnessFlag`/`illnessAdvisory` only; no UI change was needed).
5. Clean up: re-run `DELETE FROM oura_daily_summary WHERE user_id = (SELECT id FROM users WHERE email='test@local.dev');` (the next real rollup fully replaces this table anyway).

**Not exercised in the sandbox (state in the PR):** real ring IBI through the native drain path (the rollup itself is exercised by the Task 4 integration test against captured-shape events, and this change is JS/server-only — no Kotlin, no APK rebuild; prod backfill behaviour rides the first post-deploy rollup). Prod-vs-local data drift: prod summary rows are wholesale-replaced by the replay, so no drifted-row corrective migration is needed — 125 is additive-only.

- [ ] **Step 3: Version + changelog + docs (before merge, same PR)**

- `package.json`: bump **minor** (user-visible: a better illness flag — e.g. 1.154.1 → 1.155.0; re-check the current version at implementation time and re-bump on the fresh base if PRs landed in parallel).
- `lib/changelog.ts`: "The illness radar now watches your breathing rate as a fourth biomarker — your nightly respiratory rate (which the ring already measures) gets its own personal baseline, and a sustained rise now counts toward the illness flag alongside skin temperature, resting heart rate and HRV. Fully backfilled from your existing ring history."
- `projectOverview.md`: update the migration ledger line ("Next free Postgres migration number: **126**", noting 125 = `breathing_baseline`; keep the 120-pencilled note), tick/annotate the roadmap item, note in Current Status.
- `docs/module-map.md`: the personal-baseline row (`:189`) lists "(HRV/RHR/temp/sleep/MET)" — add breathing (sibling-surface sweep on docs).
- `docs/planned_upgrades.md`: mark Batch S item **S4** shipped by this PR; `docs/implementation-backlog.md`: **remove this plan's entry**.
- Append the session journal entry to the most recent `docs/overview/history-*.md`.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/respiratory-illness-biomarker
```

Open the PR, let CI run (Lint / Type Check / Tests / Build / Custom Rules / Migration Check). Standard, non-destructive change (additive migration, no auth/security/secrets): merge or auto-merge once green and the dev-smoke above has passed — no confirmation gate applies.

---

## Verification summary

- **Automated:** 2 new daily-summary unit tests (rpm×10 replay, null-skip), 3 new + all-updated illness-radar unit tests (up-bad one-sidedness, 0.25 share, rpm×10 z via `illnessFromSummaries`, renormalised 3-biomarker flags stable), 1 new rollup integration test (raw RSA IBI → `breath_avg_rpm` + baseline in the DB), existing respiratory-rate regression (`oura-ble-sleep-fallback`) and cold-path illness persist stay green; full gate.
- **Manual:** dev-server smoke — seeded elevated breathing (+RHR) flips the radar to `watch` with `biomarkers.breathing.contribution = 25`, reverts to `normal` on baseline breathing; readiness detail page renders the advisory at the S25 viewport.
- **Design invariants held:** one shared `illnessZScores`/`illnessFromSummaries` for both consumers (never forked); breathing is radar-only, never a readiness contributor (no double-count); weights renormalise so breathing-absent nights keep today's behaviour (flags verified in-band); baselines replayed, never incremented (stored-counter rule N/A by construction).
