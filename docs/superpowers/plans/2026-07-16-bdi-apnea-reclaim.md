# BDI / Apnea Reclaim from SleepNet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim the breathing-disturbance index (BDI / apnea) from **our own** SleepNet model instead of the frozen Oura-Cloud value. The `sleepnet_moonstone_1_2_0_core.onnx` forward pass that already runs every night for sleep staging **also emits a per-epoch apnea head** (`apnea: boolean[]`, `sigmoid(logit) > 0.61`) — the production rollup runs it, uses the stages, and **throws the apnea array away**. This plan captures that already-computed head, derives a per-night BDI (disturbed asleep-epochs per hour of sleep), persists it to `oura_daily_derived.bdi_derived`, and exposes it on the derived read path — so the app has a live BDI again after the frozen Cloud column died at re-key. Observational, **not** a diagnosis (the assembler already flags this, `sleepnet-assemble.ts:42`) — every persisted value and label carries that caveat.

**Architecture:** No new model, no new inference pass, no new decoder. The apnea head is a *free byproduct* of the staging pass. Three moves: (1) extract the BDI-from-apnea math into one shared pure helper (`bdiFromApnea`) — it lives today only inside the admin-only `sleepNetDump` (`sleepnet-assemble.ts:215-225`) — and have the production helper `sleepNetStages5Min` return the BDI alongside the stages instead of discarding `result.apnea`; (2) capture the per-night BDI in the BLE sleep rollup (`aggregateOuraRawSamples`) and persist it to `oura_daily_derived.bdi_derived` via the same best-effort COALESCE-upsert step-pattern the illness radar already uses two blocks down; (3) expose `bdiDerived` through the `getOuraDailyDerived` read path (repo row type + slices mapper) so consumers read our derived value, never the frozen Cloud one. **The frozen `oura_daily.breathing_disturbance_index` column is left completely untouched — never reused, never written, never read for this.**

**Device caveat (state this everywhere — it gates "correct"):** the neural stager and its apnea head are only validated against **real ring nights on the S25 APK**. The per-beat IBI timestamp reconstruction that feeds the model (`beatTimes`, `sleepnet-assemble.ts:54-67`) is an explicit device-validation *assumption*, not a proven fact — `sleepnet-assemble.ts:1-9` says the neural path itself must be confirmed against a real-night dump before it's trusted. In the sandbox the model only ever runs against the synthetic pinned test vectors in `lib/oura-models/__tests__/`, which are **not** realistic nights. Therefore: the *plumbing* (capture → persist → read) is fully verifiable in-sandbox (typecheck + the BDI-math unit test against a fixed apnea/stage array), but **any real-night BDI number is NOT trustworthy until the owner runs the on-device SleepNet dump on a worn-overnight drain** (`components/oura-ble/sleepnet-dump-console.tsx`, admin Oura page) and confirms a sane value. This is exactly why the user-facing display is deferred (Task 6) and a NOT-verified-on-device Known-Issues row ships with this PR.

**Tech Stack:** TypeScript, `lib/oura-models/sleepnet-assemble.ts` (+ its `runSleepNet` core in `lib/oura-models/inference/sleepnet.ts`), the BLE sleep rollup in `lib/data/postgres/adapter.ts` (`aggregateOuraRawSamples`), the repository/slice pair (`lib/data/repository.ts` + `lib/data/postgres/slices/oura.ts`), a Postgres migration, vitest (DB integration tests run against local/CI Postgres).

**Lane:** Oura-derivation serial track (touches the adapter rollup + `slices/oura.ts` — serialize against other Oura-derivation PRs; do not run this in parallel with a PR editing `aggregateOuraRawSamples` or `getOuraDailyDerived`).

**Branch:** `feat/bdi-apnea-reclaim`

---

## Why now

The Oura Cloud gets no new data from this ring ever since the re-key (`CLAUDE.md`, Oura Direct-BLE section). `oura_daily.breathing_disturbance_index` (migration 106, written only by `/api/oura/sync` + the webhook) has therefore been **frozen dead since the re-key** — the same class as every other Cloud-frozen metric. Meanwhile the moonstone core we run nightly for staging computes the apnea head on the very same forward pass and we discard it. This is a "the output already exists in production and is being thrown away" reclaim: near-zero marginal compute, one already-loaded model, and it restores a health signal we shipped a column for and then lost.

Backlog context: `docs/implementation-backlog.md` lists "**VO₂max + BDI reclaim via BLE derivation**" as an unblock for the frozen-Cloud metrics (line ~188) and "reclaim now-frozen Oura **Cloud** metrics (respiratory rate, BDI, stress/recovery minutes, …)" (line ~1667). This plan delivers the BDI half.

## Design decisions (made in the planning session — encode, don't re-litigate)

1. **Source = SleepNet's moonstone apnea head, never the frozen Cloud value, never the `sleepnet_bdi_0_3_0/0_4_0` ONNX cores.** Those `_bdi_` cores are an IBI-only fallback model; moonstone's head is the source and it already runs. Do not load a second model.
2. **Storage = `oura_daily_derived.bdi_derived` (a new column, migration 128), NOT the frozen `oura_daily.breathing_disturbance_index` and NOT a new `sleep_sessions` column.** `oura_daily_derived` is the established completed-form derived-metrics table (one row/user/day, COALESCE-partial upsert), it's already written in this exact rollup (the `illness_radar` step at `adapter.ts:4415-4424`), it's per-day like the Cloud BDI it replaces, and it already has a live read path (`getOuraDailyDerived`) that the derived-scores work uses. A `sleep_sessions` column would be per-session and would fork the read path. Reusing the frozen Cloud column is forbidden by the Oura Direct-BLE rules (never let derived BLE data masquerade as Cloud data).
3. **One scalar persisted: `bdi_derived` = disturbed asleep-epochs per hour of sleep** (the `perHour` field of the existing dump math) — a single index matching the Cloud BDI's single-scalar shape. `disturbedEpochs` and `pctOfSleep` stay in the admin live-dump only (recomputable from the same apnea array; not worth a column each). One `ADD COLUMN`, kept lean.
4. **BDI math lives once, in `bdiFromApnea`** (One Formula, One Place). It exists today only inline in `sleepNetDump`; extract it and call it from both `sleepNetDump` and the production `sleepNetStages5Min`. No second copy of the disturbed-epoch / per-hour / pct-of-sleep logic.
5. **The apnea head is only meaningful for *asleep* epochs.** A flag during an awake epoch (stage code 4) is discarded — the existing dump logic (`apneaWin[i] && codes[i] !== 4`) is the reference and must be preserved exactly.
6. **BDI is null when the neural stager didn't run for a night.** It's derivable only from a SleepNet pass; on heuristic-fallback nights (`disableNeuralStager`, unusable preprocess, inference unavailable) there's no apnea head → `bdi_derived` stays null (COALESCE preserves any prior value). Consumers treat null as "no BDI for this night", never 0.
7. **User-facing display is deferred until device-validated** (Task 6). The owner already sees a live BDI in the admin SleepNet dump console; this PR makes it durable + queryable and ships a NOT-verified-on-device Known-Issues row. A user-facing Health surface is a follow-up backlog entry gated on the on-device smoke run, because per the device caveat above the real-night number isn't trustworthy yet.

## Verified current state (2026-07-16)

- `runSleepNet` (`lib/oura-models/inference/sleepnet.ts:38-84`) returns `{ stageCodes: StageCode[]; apnea: boolean[] }` — both length 1800, apnea = `sigmoid(apnea_logits) > APNEA_THRESHOLD (0.61)`. Same forward pass as staging. Infallible: returns `null` on any failure.
- `sleepNetStages5Min` (`lib/oura-models/sleepnet-assemble.ts:120-145`) calls `runSleepNet`, slices `result.stageCodes` to the real window (`pre.realEpochStart`..`+realEpochCount`), majority-votes into 5-min `SleepStage[]`, and **returns only the stages — `result.apnea` is discarded**.
- `sleepNetDump` (`sleepnet-assemble.ts:164-227`, admin-only, gated on `opts.debugDate`) is the ONLY place BDI is computed today: `apneaWin = result.apnea.slice(realEpochStart, +realEpochCount)`; `disturbed` = count of `apneaWin[i] && codes[i] !== 4`; `asleep` = non-awake `codes`; `sleepHours = asleep*0.5/60`; `perHour = disturbed/sleepHours`; `pctOfSleep = disturbed/asleep*100` (lines 215-225). It renders in `components/oura-ble/sleepnet-dump-console.tsx:113-116` ("Breathing disturbance (observational, not a diagnosis)") and is never persisted.
- Production call site: `aggregateOuraRawSamples` in `lib/data/postgres/adapter.ts`. The `snInput` is assembled once at `:3997-4027`; the neural stager runs at `:4034-4046` (`const sn = await sleepNetStages5Min(snInput, modelStages.length)` → `if (sn && sn.length === modelStages.length) { modelStages = sn; … }`); `wakeDate` is computed later at `:4093`; `sleepRows.push({…})` at `:4095-4117`. The per-day derived writes happen at `:4406-4425` (`daily_summary` step then `illness_radar` step, both keyed off `summaryRows`), and `body_comp` at `:4430`. Each write is wrapped in the isolated `step(name, fn)` helper (`:4166-4172`) so one failure can't starve the others.
- `upsertOuraDailyDerived` (`slices/oura.ts:643-658`): COALESCE-partial upsert on `(user_id, day)`; writes only fields present in the patch, driven by the `DERIVED_COLS` allow-list (`:630-641`). `getOuraDailyDerived` (`:660-696`): `SELECT * … ORDER BY day ASC`, mapped field-by-field into `OuraDailyDerivedRow`.
- `OuraDailyDerivedRow` (`repository.ts:868-897`) + `OuraDailyDerivedPatch = Partial<Omit<OuraDailyDerivedRow,'day'>>` (`:900`).
- Schema: `ouraDailyDerived` table (`schema.ts:792-…`), all columns nullable. Highest migration on disk is `124_rr_intervals.sql`; **`125_breathing_baseline.sql` is reserved by `docs/superpowers/plans/2026-07-16-respiratory-illness-biomarker.md`** — so this plan claims **128** (re-verify at implementation time, see Task 3 Step 1).
- Frozen Cloud BDI: `oura_daily.breathing_disturbance_index` (`schema.ts:671`, migration 106); written by `app/api/oura/sync/route.ts:214-218` and `app/api/oura/webhook/route.ts:193-196`; mapped into `OuraDailyRow.breathingDisturbanceIndex` in `slices/oura.ts:239`; typed as the Cloud API field in `lib/oura/types.ts:113`. **Grep confirms NO frontend component reads `breathingDisturbanceIndex`** — the Cloud BDI is plumbed into the row type but has never been rendered in any UI. So "surface wherever the Cloud BDI was shown" resolves to the reader layer only; there is no existing user-facing BDI display to replace (this is why Task 6 is read-path + admin + deferred display, not a swap).
- `sleepNetStages5Min` callers: `adapter.ts:4036` and the test `lib/oura-models/__tests__/sleepnet-assemble.test.ts:49` (`const stages = await sleepNetStages5Min(synthInput(), nEpochs)`). Changing its return type touches exactly these two.
- `oura_daily_derived` is a **Postgres-only server-derived table** — not a synced local-store table, so no `RECONCILE_TABLES`/`RECONCILE_COLUMNS` registration and no local-SQLite migration is involved.

## File structure

**Create:**
- `lib/data/postgres/migrations/128_bdi_derived.sql` — `ADD COLUMN IF NOT EXISTS bdi_derived` on `oura_daily_derived` (re-verify 128 is free first).
- `lib/data/postgres/__tests__/bdi-derived-read.test.ts` (or extend an existing derived-read DB test) — DB integration test for the read path.

**Modify:**
- `lib/oura-models/sleepnet-assemble.ts` — export `SleepNetBdi` + `bdiFromApnea`; refactor `sleepNetDump` to use it; `sleepNetStages5Min` returns `{ stages, bdi }`.
- `lib/oura-models/__tests__/sleepnet-assemble.test.ts` — update the `sleepNetStages5Min` caller for the new return shape + add `bdiFromApnea` unit cases.
- `lib/data/postgres/schema.ts` — `bdiDerived: doublePrecision('bdi_derived')` on `ouraDailyDerived`.
- `lib/data/repository.ts` — `bdiDerived: number | null` on `OuraDailyDerivedRow`.
- `lib/data/postgres/slices/oura.ts` — `bdiDerived: 'bdi_derived'` in `DERIVED_COLS`; `bdiDerived: r.bdiDerived` in the `getOuraDailyDerived` mapper.
- `lib/data/postgres/adapter.ts` — capture per-night BDI in the neural-stager block; persist via a new isolated `bdi_derived` step.
- `components/oura-ble/sleepnet-dump-console.tsx` — clarify the caveat copy now that the value is persisted (small).
- `projectOverview.md` (Known Issues row: BDI-derived NOT device-verified), `docs/implementation-backlog.md` (add the deferred user-facing-display follow-up; remove this plan's own backlog entry per the two-PR protocol), `lib/changelog.ts` + `package.json` version, journal — final task.

---

### Task 1: Extract `bdiFromApnea` — one place for the BDI math

**Files:**
- Modify: `lib/oura-models/sleepnet-assemble.ts`
- Test: `lib/oura-models/__tests__/sleepnet-assemble.test.ts`

The disturbed-epoch / per-hour / pct-of-sleep computation lives inline in `sleepNetDump` today. Extract it verbatim into a pure exported helper so the production path (Task 2) and the admin dump share one implementation.

- [ ] **Step 1: Write the failing test** (append to `lib/oura-models/__tests__/sleepnet-assemble.test.ts`)

```typescript
import { bdiFromApnea } from '../sleepnet-assemble'

describe('bdiFromApnea', () => {
  // codes: 1=deep 2=light 3=rem 4=awake. apneaWin index-aligned to codes.
  it('counts flags only on asleep epochs and reports per-hour + pct-of-sleep', () => {
    // 10 asleep epochs (5 min sleep), 2 awake; 3 flags on asleep, 1 flag on awake (ignored).
    const codes = [2, 2, 1, 1, 3, 2, 2, 1, 3, 2, 4, 4]
    const apneaWin = [true, false, true, false, false, true, false, false, false, false, true, false]
    const r = bdiFromApnea(apneaWin, codes)
    expect(r.disturbedEpochs).toBe(3)
    expect(r.pctOfSleep).toBe(30) // 3 / 10 asleep
    // sleepHours = 10 * 0.5 / 60 = 0.08333h → perHour = 3 / 0.08333 = 36 (rounded 0.1)
    expect(r.perHour).toBe(36)
  })

  it('returns zeros for a fully-awake window (no asleep epochs — no divide-by-zero)', () => {
    const r = bdiFromApnea([true, true], [4, 4])
    expect(r).toEqual({ disturbedEpochs: 0, perHour: 0, pctOfSleep: 0 })
  })

  it('returns zeros when nothing is flagged', () => {
    expect(bdiFromApnea([false, false, false], [1, 2, 3])).toEqual({ disturbedEpochs: 0, perHour: 0, pctOfSleep: 0 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/oura-models/__tests__/sleepnet-assemble.test.ts`
Expected: FAIL — `bdiFromApnea` is not exported.

- [ ] **Step 3: Implement.** In `lib/oura-models/sleepnet-assemble.ts`, add near `SleepNetDump` (reuse its `apnea` field shape):

```typescript
/** Breathing-disturbance estimate from SleepNet's apnea head. Observational, not a diagnosis. */
export interface SleepNetBdi {
  /** asleep epochs (30-s each) flagged as disturbed breathing within the real window */
  disturbedEpochs: number
  /** disturbed epochs per hour of sleep — the breathing-disturbance index */
  perHour: number
  /** % of asleep epochs flagged */
  pctOfSleep: number
}

/**
 * BDI from SleepNet's apnea head over the REAL sleep window. `apneaWin` and `codes` are both
 * sliced to [realEpochStart, +realEpochCount) and index-aligned. A flag during an awake epoch
 * (stage code 4) is meaningless and ignored. Observational, NOT a diagnosis.
 */
export function bdiFromApnea(apneaWin: boolean[], codes: number[]): SleepNetBdi {
  let disturbed = 0
  let asleep = 0
  for (let i = 0; i < codes.length; i++) {
    if (codes[i] === 4) continue // awake — apnea flag meaningless
    asleep++
    if (apneaWin[i]) disturbed++
  }
  const sleepHours = (asleep * 0.5) / 60
  return {
    disturbedEpochs: disturbed,
    perHour: sleepHours > 0 ? Math.round((disturbed / sleepHours) * 10) / 10 : 0,
    pctOfSleep: asleep ? Math.round((disturbed / asleep) * 1000) / 10 : 0,
  }
}
```

Then replace the inline block in `sleepNetDump` (`:215-225`) with a call to it, keeping the `SleepNetDump.apnea` field's shape identical (it is structurally `SleepNetBdi` — you may narrow the field's type to `SleepNetBdi | null`):

```typescript
  const apneaWin = result.apnea.slice(pre.realEpochStart, pre.realEpochStart + pre.realEpochCount)
  dump.apnea = bdiFromApnea(apneaWin, codes)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/oura-models/__tests__/sleepnet-assemble.test.ts`
Expected: PASS (existing dump/stages tests + 3 new). No number changed in the dump output — this is a pure extraction.

- [ ] **Step 5: Commit**

```bash
git add lib/oura-models/sleepnet-assemble.ts lib/oura-models/__tests__/sleepnet-assemble.test.ts
git commit -m "Extract bdiFromApnea — one implementation of the SleepNet BDI math"
```

---

### Task 2: `sleepNetStages5Min` returns the BDI instead of discarding it

**Files:**
- Modify: `lib/oura-models/sleepnet-assemble.ts`, `lib/data/postgres/adapter.ts`, `lib/oura-models/__tests__/sleepnet-assemble.test.ts`

The production staging helper already computes the sliced `codes` and holds `result.apnea` — it just drops the latter. Return the BDI so the rollup can persist it. Changing the return type touches exactly two callers (adapter + test); update both so the tree compiles at this commit.

- [ ] **Step 1: Update the helper's return type.** In `sleepNetStages5Min` (`:120-145`), after `const codes = result.stageCodes.slice(pre.realEpochStart, pre.realEpochStart + pre.realEpochCount)`, add:

```typescript
  const apneaWin = result.apnea.slice(pre.realEpochStart, pre.realEpochStart + pre.realEpochCount)
  const bdi = bdiFromApnea(apneaWin, codes)
```

and change the signature + final `return out` to:

```typescript
export async function sleepNetStages5Min(
  input: SleepNetAssembleInput,
  nEpochs: number,
): Promise<{ stages: SleepStage[]; bdi: SleepNetBdi } | null> {
  // …unchanged body…
  return { stages: out, bdi }
}
```

Both early returns (`if (!pre) return null`, `if (!result) return null`) stay `null` — no BDI without a model pass (design decision 6).

- [ ] **Step 2: Update the adapter call site.** In `lib/data/postgres/adapter.ts` neural-stager block (`:4034-4046`):

```typescript
        if (!opts?.disableNeuralStager) {
          try {
            const sn = await sleepNetStages5Min(snInput, modelStages.length)
            if (sn && sn.stages.length === modelStages.length) {
              modelStages = sn.stages
              foldedWakeBouts = 0
              const firstSleep = sn.stages.findIndex(s => s !== 'awake')
              modelOnsetSec = firstSleep > 0 ? firstSleep * EPOCH_MIN * 60 : 0
              nightBdi = sn.bdi.perHour   // captured; persisted after wakeDate is known (Task 4)
            }
          } catch (err) {
            console.error('[oura-ble] SleepNet staging failed, using heuristic:', err)
          }
        }
```

(`nightBdi` is declared/consumed in Task 4 — declare `let nightBdi: number | null = null` at the top of the per-window loop body now so this compiles; it's wired to the map in Task 4.)

- [ ] **Step 3: Update the assemble test caller.** In `lib/oura-models/__tests__/sleepnet-assemble.test.ts:49`, change the `sleepNetStages5Min` assertion for the new shape (e.g. `const res = await sleepNetStages5Min(synthInput(), nEpochs)` then assert `res?.stages.length` / `res?.bdi` where it previously used `stages`). Keep the existing behavioural assertions on `res.stages`.

- [ ] **Step 4: Typecheck + test + commit**

Run: `npx vitest run lib/oura-models/__tests__/sleepnet-assemble.test.ts && npx tsc --noEmit 2>&1 | grep -E "sleepnet-assemble|adapter" || echo clean`
Expected: PASS; `clean`.

```bash
git add lib/oura-models/sleepnet-assemble.ts lib/data/postgres/adapter.ts lib/oura-models/__tests__/sleepnet-assemble.test.ts
git commit -m "Return the SleepNet BDI from the production staging helper"
```

---

### Task 3: Migration 128 + schema column

**Files:**
- Create: `lib/data/postgres/migrations/128_bdi_derived.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Re-confirm the migration number.**

1. `ls lib/data/postgres/migrations/` — highest on disk must still be `124_rr_intervals.sql`; `125_*` may exist if the respiratory-illness plan merged first (it reserves 125). If `128_*` already exists, bump to the next free number and note it in the PR.
2. `grep -rn "128_\|migration 128" docs/superpowers/plans/ docs/implementation-backlog.md` (excluding this plan) — must be empty. If a parallel plan grabbed 128, take the next free number (Postgres Data Migrations rule: claim against directory AND open plans/PRs).

- [ ] **Step 2: Write the migration** (idempotent `ADD COLUMN IF NOT EXISTS` — assume partial application):

```sql
-- 128_bdi_derived.sql
-- Our own breathing-disturbance index, reclaimed from SleepNet's apnea head (moonstone core),
-- computed per night in the BLE sleep rollup as disturbed asleep-epochs per hour of sleep.
-- Distinct from the frozen Cloud oura_daily.breathing_disturbance_index (Cloud-only, dead since
-- the ring re-key — never reused here). Observational, NOT a diagnosis. Nullable: only present
-- for nights the neural stager ran; heuristic-fallback nights stay null.
ALTER TABLE oura_daily_derived ADD COLUMN IF NOT EXISTS bdi_derived DOUBLE PRECISION;
```

- [ ] **Step 3: Add the Drizzle column.** In `lib/data/postgres/schema.ts`, in the `ouraDailyDerived` table def, add (e.g. after `bodyComp`):

```typescript
  bdiDerived: doublePrecision('bdi_derived'), // breathing-disturbance index (SleepNet apnea head) — observational, not a diagnosis
```

- [ ] **Step 4: Apply locally + commit**

Run: `pnpm db:local` (applies migrations to the local Postgres; idempotent) then `npx tsc --noEmit 2>&1 | grep schema || echo clean`
Expected: migration applies; `clean`.

```bash
git add lib/data/postgres/migrations/128_bdi_derived.sql lib/data/postgres/schema.ts
git commit -m "Add oura_daily_derived.bdi_derived column (migration 128)"
```

---

### Task 4: Persist the per-night BDI in the sleep rollup

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

Capture the BDI keyed by wake-date and write it in its own isolated `step`, mirroring the `illness_radar` step so a failure here can never block the sleep/summary/illness writes (and vice-versa). COALESCE-upsert means a null-BDI night never clobbers a prior good value.

- [ ] **Step 1: Declare the capture map.** Near the other rollup accumulators (before the per-window loop, alongside `sleepRows` / `nightInputsByDate`):

```typescript
    const bdiByDate = new Map<string, number>() // wake-date → derived BDI (per-hour), last window wins
```

- [ ] **Step 2: Record it once `wakeDate` is known.** `nightBdi` was captured in the neural block (Task 2). After `const wakeDate = toAestDay(toDate(w.endDs), timezone)` (`:4093`), add:

```typescript
      if (nightBdi != null) bdiByDate.set(wakeDate, nightBdi) // last window for a wake-day wins, matching nightInputsByDate
```

- [ ] **Step 3: Persist in an isolated step.** After the `illness_radar` step block (`:4415-4424`) and before `body_comp` (`:4430`), add:

```typescript
    // Breathing-disturbance index reclaimed from SleepNet's apnea head (this rollup's neural
    // stager already ran the model — we just stopped discarding result.apnea). Observational,
    // NOT a diagnosis. Own step + COALESCE upsert so a failure can't block the writes above and
    // a heuristic-fallback night (nightBdi null → absent from the map) never nulls a good value.
    // Deliberately NOT written to the frozen Cloud oura_daily.breathing_disturbance_index.
    if (bdiByDate.size > 0) await step('bdi_derived', async () => {
      for (const [day, perHour] of bdiByDate) {
        await this.upsertOuraDailyDerived(userId, day, { bdiDerived: perHour })
      }
    })
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep adapter || echo clean`
Expected: `clean` (`bdiDerived` is a valid `OuraDailyDerivedPatch` key after Task 5's repo change — if you commit Task 4 before Task 5, expect a transient type error on the patch key and land them together; recommended to run Task 5 immediately after).

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Persist the reclaimed per-night BDI to oura_daily_derived in the sleep rollup"
```

---

### Task 5: Read path — repo row + slice mapper

**Files:**
- Modify: `lib/data/repository.ts`, `lib/data/postgres/slices/oura.ts`
- Test: `lib/data/postgres/__tests__/bdi-derived-read.test.ts` (or extend an existing derived-read DB test)

- [ ] **Step 1: Extend the row type.** In `lib/data/repository.ts`, add to `OuraDailyDerivedRow` (`:868-897`, e.g. after `bodyComp`):

```typescript
  bdiDerived: number | null
```

(`OuraDailyDerivedPatch` picks this up automatically via `Partial<Omit<…,'day'>>`.)

- [ ] **Step 2: Extend the write allow-list + read mapper.** In `lib/data/postgres/slices/oura.ts`:
  - `DERIVED_COLS` (`:630-641`): add `bdiDerived: 'bdi_derived',`.
  - `getOuraDailyDerived` mapper (`:666-695`): add `bdiDerived: r.bdiDerived,`.

- [ ] **Step 3: DB integration test.** Assert an upsert-then-read round-trips the value and that a null-BDI patch never clobbers a prior value (COALESCE):

```typescript
// upsert bdiDerived: 12.5 for a day, read it back via getOuraDailyDerived → 12.5
// upsert the SAME day with { illnessFlag: 'normal' } (no bdi) → read back still 12.5 (COALESCE preserves)
// upsert a different day with no bdi → bdiDerived null
```

(Model it on the existing derived-row DB tests; runs against the local/CI Postgres.)

- [ ] **Step 4: Run + typecheck + commit**

Run: `npx vitest run lib/data/postgres/__tests__/bdi-derived-read.test.ts && npx tsc --noEmit 2>&1 | grep -E "repository|slices/oura" || echo clean`
Expected: PASS; `clean`.

```bash
git add lib/data/repository.ts lib/data/postgres/slices/oura.ts lib/data/postgres/__tests__/bdi-derived-read.test.ts
git commit -m "Expose bdiDerived on the oura_daily_derived read path"
```

---

### Task 6: Surface — admin caveat now that BDI is persisted; defer the user-facing display

**Files:**
- Modify: `components/oura-ble/sleepnet-dump-console.tsx`

The owner already sees a live BDI in the admin SleepNet dump (`:113-116`, "Breathing disturbance (observational, not a diagnosis)"). This PR makes that value durable + queryable via the read path (Tasks 4-5). **A user-facing Health display is deliberately deferred** (design decision 7 + the device caveat) — the real-night number isn't trustworthy until the on-device dump confirms it, and there is no existing user-facing BDI surface to regress (verified: no component reads `breathingDisturbanceIndex`).

- [ ] **Step 1: Clarify the dump-console line.** Update the existing caveat copy so it reads as the now-persisted metric, e.g. append " · persisted to oura_daily_derived.bdi_derived (index = /h)". Keep the "observational, not a diagnosis" wording verbatim. This is a copy-only change; no data path added.

- [ ] **Step 2: File the deferred display as a backlog follow-up** (no orphaned findings). Add one entry to `docs/implementation-backlog.md`: "User-facing derived-BDI display in the Health sleep detail — gated on on-device SleepNet validation (per `docs/superpowers/plans/2026-07-16-bdi-apnea-reclaim.md` device caveat). Read `oura_daily_derived.bdi_derived` via `getOuraDailyDerived`; render with the 'observational, not a diagnosis' caveat; never read the frozen Cloud column." (Priority: low — behind device validation.)

- [ ] **Step 3: Lint + commit**

Run: `npx eslint components/oura-ble/sleepnet-dump-console.tsx`
Expected: clean.

```bash
git add components/oura-ble/sleepnet-dump-console.tsx docs/implementation-backlog.md
git commit -m "Note the persisted BDI in the admin dump; queue the device-gated user display"
```

---

### Task Final: Gate + dev-server smoke + version/docs

- [ ] **Step 1: Full gate**

Run: `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`
Expected: all green (DB integration tests run against the local Postgres).

- [ ] **Step 2: Dev-server smoke against the local DB** (`pnpm dev`, log in as `test@local.dev` / `testpass123`)

The neural model does not run a *real* night in the sandbox (see the device caveat) — so the smoke validates the **plumbing and read path**, not a real BDI value:

1. Seed a derived row directly (psql on port 5433, `trainingai_dev`; `:uid` = the test user's id) and confirm the read path returns it:

```sql
INSERT INTO oura_daily_derived (user_id, day, bdi_derived)
VALUES (:uid, CURRENT_DATE, 12.5)
ON CONFLICT (user_id, day) DO UPDATE SET bdi_derived = excluded.bdi_derived;
-- then in a second statement, an unrelated partial upsert MUST NOT clobber it:
INSERT INTO oura_daily_derived (user_id, day, illness_flag)
VALUES (:uid, CURRENT_DATE, 'normal')
ON CONFLICT (user_id, day) DO UPDATE SET illness_flag = excluded.illness_flag;
SELECT bdi_derived FROM oura_daily_derived WHERE user_id = :uid AND day = CURRENT_DATE; -- expect 12.5 (COALESCE preserved)
```

2. Any route that reads `getOuraDailyDerived` returns `bdiDerived: 12.5` for today (verify via the derived read used by an admin/derived endpoint if one is wired, else assert via the DB test in Task 5).
3. Admin Oura page (`/admin/oura-ble`) renders without error and the dump console's caveat copy shows the updated "persisted…" wording.

- [ ] **Step 3: Version + changelog + Known Issues + journal**

- Bump `package.json` **minor** (new persisted health metric + read path). `lib/changelog.ts` entry: "Reclaimed the breathing-disturbance index (BDI) from our own on-device sleep model — the ring's apnea signal is computed nightly and stored again, after the Oura Cloud value went stale. Observational, not a diagnosis, and still being validated on real nights."
- Add a `projectOverview.md` **Known Issues** row: "Derived BDI (`oura_daily_derived.bdi_derived`) is captured/persisted/read but the real-night value is **NOT device-verified** — the SleepNet apnea head + per-beat IBI reconstruction only run against synthetic vectors in-sandbox; needs the on-device SleepNet dump smoke run before any user-facing display."
- Append the session note to the current `docs/overview/history-*.md`; update `projectOverview.md` status.
- **Remove this plan's own backlog entry** from `docs/implementation-backlog.md` (two-PR protocol), keeping the new deferred-display follow-up added in Task 6.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/bdi-apnea-reclaim
```

Standard change with a migration — the migration is a single additive nullable `ADD COLUMN IF NOT EXISTS` (reversible, non-data-dropping), so it is **not** in the destructive/irreversible carve-out; merge on green per the CI/CD workflow once the gate + smoke pass. (If the reviewer wants the device-validation row treated as a blocker, hold the user-facing display — already deferred — not the plumbing.)

---

## Verification summary

- **Automated (sandbox):** `bdiFromApnea` math (3 cases against fixed apnea/stage arrays); `sleepNetStages5Min` new return shape; derived read-path round-trip + COALESCE-preserve DB test; full existing suites (sleepnet-assemble, derived reads) green; full gate.
- **Dev-server (sandbox):** derived-row upsert/read round-trip, COALESCE non-clobber, admin page renders.
- **Deferred to on-device (NOT exercisable in sandbox — state in the PR):**
  - **The real-night BDI value itself.** The moonstone apnea head + the `beatTimes` IBI reconstruction only run against synthetic vectors here; a correct BDI number requires the owner's on-device SleepNet dump on a worn-overnight drain (`components/oura-ble/sleepnet-dump-console.tsx`) — this is the same device-validation gate the neural stager itself carries (`sleepnet-assemble.ts:1-9`). Ships with a NOT-verified Known-Issues row.
  - **The full rollup path writing `bdi_derived`** — `aggregateOuraRawSamples` runs the neural stager only over real ring samples; the sandbox has none. The persist step is covered structurally by typecheck + the read-path DB test, but the end-to-end "worn night → non-null `bdi_derived`" is on-device only.

## Notes for the implementer

- **Never touch `oura_daily.breathing_disturbance_index`.** It's frozen Cloud data; reusing or writing it violates the Oura Direct-BLE rules. The derived value lives only on `oura_daily_derived.bdi_derived`.
- **Never load the `sleepnet_bdi_0_3_0/0_4_0` cores.** The moonstone apnea head already runs; a second model is wasted compute (design decision 1).
- **`bdi_derived` is null, never 0, when the neural stager didn't run.** Don't coerce; COALESCE upsert + null map-absence handle it.
- **Keep `bdiFromApnea` the only copy of the math.** If you find yourself recomputing disturbed-epochs-per-hour anywhere else, import the helper.
- Re-anchor by symbol name, not line number, if the fast-moving Oura files (`adapter.ts`, `slices/oura.ts`, `sleepnet-assemble.ts`) have drifted at implementation time.
- Serialize against other Oura-derivation PRs (this edits `aggregateOuraRawSamples` + `getOuraDailyDerived`); expect `package.json`/`lib/changelog.ts` conflicts if one lands in parallel and re-bump on the fresh base.
