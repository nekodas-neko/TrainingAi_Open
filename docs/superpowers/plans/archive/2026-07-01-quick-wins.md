# Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship all 10 items from the "⚡ Quick wins" table in `docs/planned_upgrades.md` as one PR: `food_items` in the pull delta (stops food vanishing offline), emergency-deload persist-order fix, Oura webhook fail-closed signature check, migration 103 indexes, lazy-loading `AiChatOverlay`/`Response`/`HrDayChart`, rate limits on the two unprotected AI routes, a `(userId, date)` DB cache for the morning briefing, `invalidateOuraSync()`/`invalidateInjuryWrites()` cache groups, user-scoping the `supplement_logs` delete, and a plate-loading calculator on the "Load the bar to X kg" card.

**Architecture:** Each item is small and isolated. Server changes live in the Drizzle adapter (`lib/data/postgres/adapter.ts`), route handlers (`app/api/**`), and one new SQL migration (`lib/data/postgres/migrations/103_performance_indexes.sql`, auto-applied by `ensureSchema`). Client changes touch the local-store sync engine (`lib/local-store/sync-engine.ts`), cache groups (`lib/cache-groups.ts`), and a handful of components. Wherever a change has calculable logic (webhook signature, deload persist order, plate math, cache groups) it is extracted into a pure function with a vitest unit test in `lib/__tests__/`, mirroring the existing test style (e.g. `lib/__tests__/apply-prescription.test.ts`). UI-only changes get manual dev-server verification steps.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript, Drizzle ORM/PostgreSQL, Capacitor SQLite local store, vitest (`pnpm test`), eslint (`pnpm lint`), pnpm only.

---

**Setup (before Task 1):**

- [ ] Create the feature branch:
  ```bash
  git checkout main && git pull origin main && git checkout -b feat/quick-wins
  ```
- [ ] Ensure the local dev DB is up (idempotent): `pnpm db:local`
- [ ] Baseline: `pnpm test` (all green) and `npx tsc --noEmit` (clean) before starting.

---

### Task 1: `food_items` in the sync pull delta

The #1 fix in the upgrade doc. `applyDelta` already supports `delta.foodItems` (`lib/local-store/sqlite-backend.ts:756` — it runs **before** the `foodLogs` branch at `:760`, so ordering is already correct) and `LocalStore.applyDelta` declares the field (`lib/local-store/index.ts:74`), but `getSyncDelta` never returns food items and `pullDelta` never maps them. Result: `getFoodLogsWithItems` (`sqlite-backend.ts:889`) JOINs `food_logs` to `food_items` and silently drops any log whose item isn't local — fresh installs and past dates render empty offline.

Note: `food_items` has no `updated_at` column (only `created_at` — `lib/data/postgres/schema.ts:385-403`), so the server maps `createdAt` → `updatedAt`, the same trick `getSyncDelta` already uses for `personal_records` (`adapter.ts:2440-2443`).

**Files:**
- Modify: `lib/data/repository.ts` (`SyncDelta` interface, lines 31-54)
- Modify: `lib/data/postgres/adapter.ts` (`getSyncDelta`, lines 2261-2451)
- Modify: `lib/local-store/sync-engine.ts` (type import lines 3-10; mapping block ~line 233; count lines 295-301; `applyDelta` call lines 303-307)
- Test: manual against the local dev DB (server-side query has no pure seam; the on-device apply path is exercised via the existing `applyDelta`/`upsertFoodItem` code, which is already written and tested on-device)

**Steps:**

- [ ] Add `foodItems` to the `SyncDelta` interface in `lib/data/repository.ts`. After line 48 (`foodLogs: unknown[];`) add:
  ```ts
  foodItems?:         unknown[];
  ```
- [ ] In `lib/data/postgres/adapter.ts` `getSyncDelta`, define the shared column set just after `effectiveSince` (line 2263):
  ```ts
    const foodItemCols = {
      id: s.foodItems.id, name: s.foodItems.name, brand: s.foodItems.brand,
      servingSizeG: s.foodItems.servingSizeG, calories: s.foodItems.calories,
      proteinG: s.foodItems.proteinG, carbsG: s.foodItems.carbsG, fatG: s.foodItems.fatG,
      fiberG: s.foodItems.fiberG, sugarG: s.foodItems.sugarG, sodiumMg: s.foodItems.sodiumMg,
      satFatG: s.foodItems.satFatG, source: s.foodItems.source, createdAt: s.foodItems.createdAt,
    }
  ```
- [ ] Extend the first `Promise.all` destructure (lines 2265-2268) with two new names at the end:
  ```ts
    const [programs, progressionStyles, bodyMetrics, sleepSessions,
           moodLogs, activityLogs, workoutSessions,
           foodLogs, supplements, supplementLogs, injuries,
           exerciseLogs, setLogs, personalRecords, ouraDaily, dayCheckins,
           foodItemsReferenced, foodItemsCreated] = await Promise.all([
  ```
  and append the two queries at the end of the array (after the `dayCheckins` select at lines 2365-2366):
  ```ts
      // food_items referenced by this user's food logs in the window — a log whose
      // item isn't local can't render offline (getFoodLogsWithItems JOINs and drops it)
      this.db.selectDistinct(foodItemCols).from(s.foodItems)
        .innerJoin(s.foodLogs, eq(s.foodLogs.foodItemId, s.foodItems.id))
        .where(and(eq(s.foodLogs.userId, userId), gt(s.foodLogs.updatedAt, effectiveSince))),
      // plus items the user created since the cutoff but hasn't logged yet
      this.db.select(foodItemCols).from(s.foodItems)
        .where(and(eq(s.foodItems.userId, userId), gt(s.foodItems.createdAt, effectiveSince))),
  ```
- [ ] Merge + dedupe the two lists and add `foodItems` to the return object. Just before the `return` at line 2436:
  ```ts
    const foodItemsById = new Map<string, (typeof foodItemsReferenced)[number]>()
    for (const fi of [...foodItemsReferenced, ...foodItemsCreated]) foodItemsById.set(fi.id, fi)
  ```
  and in the returned object, directly after the `foodLogs, supplements, supplementLogs, injuries, dayCheckins,` line (2449), add:
  ```ts
             // food_items has no updated_at; created_at stands in (same as personal_records)
             foodItems: [...foodItemsById.values()].map(fi => ({
               ...fi,
               updatedAt: fi.createdAt,
             })),
  ```
- [ ] Run `npx tsc --noEmit` — expect clean (the `SyncDelta` field is optional, nothing else changes shape).
- [ ] In `lib/local-store/sync-engine.ts`, add `LocalFoodItem` to the type import (lines 3-10):
  ```ts
  import type {
    LocalBodyMetric, LocalMoodLog, LocalSleepSession,
    LocalWorkoutSession, LocalActivityLog, LocalProgram, LocalProgressionStyle,
    LocalFoodLog, LocalFoodItem, LocalDayCheckin, LocalSupplement, LocalSupplementLog, LocalInjury,
    LocalExerciseLog, LocalSetLog, LocalPersonalRecord, LocalOuraDaily,
    LocalProgramSession, LocalSessionExercise, LocalSchedule, LocalScheduleDay,
    LocalStyleSet,
  } from './types';
  ```
- [ ] Add the mapping between the `styleSets` block (ends line 233) and the `foodLogs` block (line 235):
  ```ts
    const foodItems = ((raw.foodItems ?? []) as Record<string, unknown>[]).map(r => ({
      id:           String(r.id),
      name:         String(r.name),
      brand:        r.brand ? String(r.brand) : null,
      servingSizeG: Number(r.servingSizeG),
      calories:     Number(r.calories),
      proteinG:     Number(r.proteinG),
      carbsG:       Number(r.carbsG),
      fatG:         Number(r.fatG),
      fiberG:       (r.fiberG as number) ?? null,
      sugarG:       (r.sugarG as number) ?? null,
      sodiumMg:     (r.sodiumMg as number) ?? null,
      satFatG:      (r.satFatG as number) ?? null,
      source:       r.source ? String(r.source) : null,
      updatedAt:    toIso(r.updatedAt),
    } satisfies LocalFoodItem));
  ```
- [ ] Include the new domain in the count (line 299) — change:
  ```ts
      foodLogs.length + supplementLogs.length + injuries.length +
  ```
  to:
  ```ts
      foodItems.length + foodLogs.length + supplementLogs.length + injuries.length +
  ```
  and in the `applyDelta` call (lines 303-307) change `foodLogs, supplements, supplementLogs, injuries,` to `foodItems, foodLogs, supplements, supplementLogs, injuries,`.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean.
- [ ] Verify against the local dev DB. Seed one food item + log for the test user:
  ```bash
  psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" <<'SQL'
  INSERT INTO meal_types (user_id, name) SELECT id, 'Lunch' FROM users WHERE email = 'test@local.dev' ON CONFLICT DO NOTHING;
  INSERT INTO food_items (user_id, name, calories, protein_g, carbs_g, fat_g, source)
    SELECT id, 'Chicken breast', 165, 31, 0, 3.6, 'manual' FROM users WHERE email = 'test@local.dev';
  INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier)
    SELECT u.id, CURRENT_DATE, mt.id, fi.id, 1.5
    FROM users u
    JOIN meal_types mt ON mt.user_id = u.id
    JOIN food_items fi ON fi.user_id = u.id AND fi.name = 'Chicken breast'
    WHERE u.email = 'test@local.dev' LIMIT 1;
  SQL
  ```
  Then start `pnpm dev`, log in via the credentials flow, and pull the delta:
  ```bash
  BASE=http://localhost:3000
  CSRF=$(curl -s -c /tmp/ta-jar "$BASE/api/auth/csrf" | jq -r .csrfToken)
  curl -s -b /tmp/ta-jar -c /tmp/ta-jar -X POST "$BASE/api/auth/callback/credentials" \
    --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=test@local.dev" \
    --data-urlencode "password=testpass123" -o /dev/null
  curl -s -b /tmp/ta-jar "$BASE/api/sync/pull?since=1970-01-01T00:00:00.000Z" \
    | jq '{foodItems: .foodItems, foodLogCount: (.foodLogs | length)}'
  ```
  Expected: `foodItems` is a non-empty array whose entry has `name: "Chicken breast"` and a non-null `updatedAt`; before the change the key is absent entirely.
- [ ] Offline-first checklist note: the final authoritative check is on the APK (native SQLite doesn't run in the web sandbox) — after this PR ships, cold-install the APK, sync once online, go airplane-mode, and confirm food logs render for today and a past date. Record this in the PR description as a pending device check.
- [ ] Commit:
  ```bash
  git add lib/data/repository.ts lib/data/postgres/adapter.ts lib/local-store/sync-engine.ts
  git commit -m "Include food_items in the sync pull delta

  Food logs synced to a device without their food_items rows, so
  getFoodLogsWithItems dropped them and logged food vanished offline on
  fresh installs and past dates. Send every item referenced by the logs
  in the delta window (plus newly created ones) and hydrate the local
  food_items table on pull."
  ```

---

### Task 2: Emergency deload — advance phase before storing the prescription

`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:141-142` calls `storePrescription(...)` then `advancePhase(..., 'deload')` — but `advancePhase` resets `prescription: null, prescriptionStatus: 'none'` (`lib/data/postgres/slices/periodization.ts:87-88`), so the stored deload is wiped immediately. The HTTP response carries it once; any reload reads null and the deload never reaches the bar. Fix: extract a `persistEmergencyDeload` helper that enforces the order, unit-test the call order, use it in the route. (C1b — not mutating phase state until acceptance — is deliberately out of scope; it's a behaviour redesign, not a quick win.)

**Files:**
- Modify: `lib/ai-periodization/apply-prescription.ts` (append after `prescriptionStyleForExercise`, line 33)
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` (import block lines 1-13; emergency branch lines 140-142)
- Test: `lib/__tests__/apply-prescription.test.ts` (append a new `describe`)

**Steps:**

- [ ] Write the failing test. Append to `lib/__tests__/apply-prescription.test.ts` (it already imports `AiPrescriptionExercise`; extend the type import and the function import):
  ```ts
  import { prescriptionDrivesLoad, prescriptionStyleForExercise, persistEmergencyDeload } from '@/lib/ai-periodization/apply-prescription'
  ```
  ```ts
  import type { AiPrescription, AiPrescriptionExercise } from '@/lib/types/ai-periodization'
  ```
  and add:
  ```ts
  describe('persistEmergencyDeload', () => {
    const prescription: AiPrescription = {
      phase: 'deload',
      phaseAction: 'deload_recommended',
      exercises: [],
      estimatedSessionDurationMin: 30,
      weeklyVolumeContribution: {},
      deload: true,
      reasoning: 'Emergency deload triggered due to overtraining signals.',
      confidence: 1.0,
    }

    it('advances the phase BEFORE storing the prescription, so the store is not wiped', async () => {
      const calls: string[] = []
      const repo = {
        advancePhase: async () => { calls.push('advancePhase') },
        storePrescription: async () => { calls.push('storePrescription') },
      }
      await persistEmergencyDeload(repo, 'user-1', 'ps-1', prescription, new Date())
      expect(calls).toEqual(['advancePhase', 'storePrescription'])
    })
  })
  ```
- [ ] Run it: `pnpm test lib/__tests__/apply-prescription.test.ts` — expect failure: `persistEmergencyDeload` is not exported.
- [ ] Implement in `lib/ai-periodization/apply-prescription.ts`. Change the type import (line 2) to:
  ```ts
  import type { AiPrescription, AiPrescriptionExercise, PrescriptionStatus } from '@/lib/types/ai-periodization'
  ```
  and append:
  ```ts
  // Persist an emergency deload. advancePhase resets all prescription state
  // (prescription: null, prescriptionStatus: 'none' — slices/periodization.ts), so it
  // must run BEFORE storePrescription; the reverse order stores the deload and then
  // immediately wipes it, so it never reaches the bar after a reload.
  export async function persistEmergencyDeload(
    repo: {
      advancePhase(userId: string, programSessionId: string, newPhase: 'deload'): Promise<unknown>
      storePrescription(userId: string, programSessionId: string, prescription: AiPrescription, expiresAt: Date): Promise<void>
    },
    userId: string,
    programSessionId: string,
    prescription: AiPrescription,
    expiresAt: Date,
  ): Promise<void> {
    await repo.advancePhase(userId, programSessionId, 'deload')
    await repo.storePrescription(userId, programSessionId, prescription, expiresAt)
  }
  ```
- [ ] Run `pnpm test lib/__tests__/apply-prescription.test.ts` — expect pass.
- [ ] Wire the route. In `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` add to the imports:
  ```ts
  import { persistEmergencyDeload } from '@/lib/ai-periodization/apply-prescription'
  ```
  and replace lines 140-142:
  ```ts
      const expiresAt = new Date(Date.now() + 7 * 86_400_000)
      await repo.storePrescription(userId, programSessionId, prescription, expiresAt)
      await repo.advancePhase(userId, programSessionId, 'deload')
  ```
  with:
  ```ts
      const expiresAt = new Date(Date.now() + 7 * 86_400_000)
      await persistEmergencyDeload(repo, userId, programSessionId, prescription, expiresAt)
  ```
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean (the full `Repository` is structurally assignable to the narrow repo parameter).
- [ ] Commit:
  ```bash
  git add lib/ai-periodization/apply-prescription.ts lib/__tests__/apply-prescription.test.ts "app/api/ai-periodization/session/[sessionId]/prescribe/route.ts"
  git commit -m "Persist emergency deload after advancing phase, not before

  advancePhase nulls the stored prescription, so storing the emergency
  deload first meant it was wiped immediately — it survived only in the
  HTTP response and never drove the bar weight after a reload. Extract
  persistEmergencyDeload so the order is enforced and unit-tested."
  ```

---

### Task 3: Oura webhook — fail closed on missing signature or signing key

`app/api/oura/webhook/route.ts:57` only verifies the HMAC when both the `x-oura-signature` header **and** a stored signing key exist — omit the header and the only gate is knowing a valid Oura `user_id`. Extract a pure `verifyOuraWebhookSignature` that fails closed, unit-test it, and make the route reject on failure.

**Files:**
- Create: `lib/oura/webhook-signature.ts`
- Modify: `app/api/oura/webhook/route.ts` (imports lines 1-2; verification block lines 55-64)
- Test: `lib/__tests__/oura-webhook-signature.test.ts`

**Steps:**

- [ ] Write the failing test at `lib/__tests__/oura-webhook-signature.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { createHmac } from 'crypto'
  import { verifyOuraWebhookSignature } from '@/lib/oura/webhook-signature'

  const KEY = 'test-signing-key'
  const BODY = JSON.stringify({ event_type: 'create', data_type: 'daily_readiness', user_id: 'oura-u1', id: 'doc-1' })
  const sign = (body: string, key: string) => createHmac('sha256', key).update(body).digest('hex')

  describe('verifyOuraWebhookSignature', () => {
    it('accepts a valid signature', () => {
      expect(verifyOuraWebhookSignature(BODY, sign(BODY, KEY), KEY)).toBe(true)
    })

    it('accepts a valid signature carrying the sha256= prefix', () => {
      expect(verifyOuraWebhookSignature(BODY, `sha256=${sign(BODY, KEY)}`, KEY)).toBe(true)
    })

    it('rejects a signature made with the wrong key', () => {
      expect(verifyOuraWebhookSignature(BODY, sign(BODY, 'other-key'), KEY)).toBe(false)
    })

    it('rejects a tampered body', () => {
      expect(verifyOuraWebhookSignature(BODY + 'x', sign(BODY, KEY), KEY)).toBe(false)
    })

    it('fails closed when the signature header is missing', () => {
      expect(verifyOuraWebhookSignature(BODY, null, KEY)).toBe(false)
    })

    it('fails closed when no signing key is on record', () => {
      expect(verifyOuraWebhookSignature(BODY, sign(BODY, KEY), null)).toBe(false)
      expect(verifyOuraWebhookSignature(BODY, sign(BODY, KEY), undefined)).toBe(false)
    })
  })
  ```
- [ ] Run it: `pnpm test lib/__tests__/oura-webhook-signature.test.ts` — expect failure: cannot resolve `@/lib/oura/webhook-signature`.
- [ ] Create `lib/oura/webhook-signature.ts`:
  ```ts
  import { createHmac, timingSafeEqual } from 'crypto'

  // Fail-closed HMAC verification for Oura webhook payloads. A request with no
  // signature header, or a user with no signing key on record, is rejected —
  // otherwise omitting the header bypasses verification entirely.
  export function verifyOuraWebhookSignature(
    rawBody: string,
    sigHeader: string | null,
    signingKey: string | null | undefined,
  ): boolean {
    if (!sigHeader || !signingKey) return false
    const sigBuf = Buffer.from(sigHeader.replace(/^sha256=/, ''), 'hex')
    const computed = createHmac('sha256', signingKey).update(rawBody).digest()
    return sigBuf.length === computed.length && timingSafeEqual(sigBuf, computed)
  }
  ```
- [ ] Run `pnpm test lib/__tests__/oura-webhook-signature.test.ts` — expect pass (6 tests).
- [ ] Wire the route. In `app/api/oura/webhook/route.ts` change line 2 (the GET handler still needs `timingSafeEqual`) and add the helper import:
  ```ts
  import { timingSafeEqual } from "crypto"
  import { verifyOuraWebhookSignature } from "@/lib/oura/webhook-signature"
  ```
  and replace the open-verification block (lines 55-64):
  ```ts
    // Verify HMAC after we know the user (we need their signing key)
    const tokenRow = await repo.getOuraTokenRow(userId)
    if (tokenRow?.webhookSigningKey && sigHeader) {
      const sigBuf = Buffer.from(sigHeader.replace(/^sha256=/, ""), "hex")
      const computed = createHmac("sha256", tokenRow.webhookSigningKey)
        .update(rawBody)
        .digest()
      const valid = sigBuf.length === computed.length && timingSafeEqual(sigBuf, computed)
      if (!valid) return new NextResponse("Forbidden", { status: 403 })
    }
  ```
  with:
  ```ts
    // Verify HMAC after we know the user (we need their signing key).
    // Fail closed: no signature header or no signing key on record → reject.
    const tokenRow = await repo.getOuraTokenRow(userId)
    if (!verifyOuraWebhookSignature(rawBody, sigHeader, tokenRow?.webhookSigningKey)) {
      return new NextResponse("Forbidden", { status: 403 })
    }
  ```
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean (`createHmac` is no longer imported by the route; confirm no unused-import warning).
- [ ] Manual check on the dev server (`pnpm dev`): `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/oura/webhook -H 'Content-Type: application/json' -d '{"event_type":"create","data_type":"sleep","user_id":"nobody","id":"x","operation_type":"create"}'` — expect `200` (unknown Oura user is still acknowledged before the signature gate; that path is unchanged and writes nothing).
- [ ] Commit:
  ```bash
  git add lib/oura/webhook-signature.ts lib/__tests__/oura-webhook-signature.test.ts app/api/oura/webhook/route.ts
  git commit -m "Fail closed on missing Oura webhook signature

  The webhook only verified the HMAC when the x-oura-signature header was
  present, so omitting it bypassed verification and left knowledge of an
  Oura user_id as the only gate on an unauthenticated sync trigger.
  Reject when either the header or the stored signing key is absent."
  ```

---

### Task 4: Migration 103 — sync-pull and hot-path indexes

Every sync pull scans `set_logs`/`exercise_logs` by `updated_at` with no index (`adapter.ts:2327,2346`); `personal_records` is filtered by `(user_id, achieved_at)` (`adapter.ts:2353`); food-log reads hit `(user_id, meal_type_id, logged_at)`. Migration numbering: 101 (treadmill) and 102 (day_checkins) are taken — **this file must be 103**.

**Files:**
- Create: `lib/data/postgres/migrations/103_performance_indexes.sql`
- Test: applied via `pnpm db:local` + `psql \di` check (migrations are plain SQL, auto-applied by `ensureSchema` in production)

**Steps:**

- [ ] Create `lib/data/postgres/migrations/103_performance_indexes.sql`:
  ```sql
  -- Sync-pull scans set_logs/exercise_logs by updated_at on every pull; PR and
  -- food-log reads filter on these column sets with no covering index.
  CREATE INDEX IF NOT EXISTS idx_sl_updated_at        ON set_logs (updated_at);
  CREATE INDEX IF NOT EXISTS idx_el_updated_at        ON exercise_logs (updated_at);
  CREATE INDEX IF NOT EXISTS idx_pr_user_achieved     ON personal_records (user_id, achieved_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fl_user_meal_logged  ON food_logs (user_id, meal_type_id, logged_at);
  ```
- [ ] Apply and verify against the local dev DB:
  ```bash
  pnpm db:local
  psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "\di idx_sl_updated_at" -c "\di idx_el_updated_at" -c "\di idx_pr_user_achieved" -c "\di idx_fl_user_meal_logged"
  ```
  Expected: all four indexes listed. Then confirm the pull query uses one:
  ```bash
  psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "EXPLAIN SELECT * FROM set_logs WHERE updated_at > now() - interval '1 day';"
  ```
  Expected: plan mentions `idx_sl_updated_at` (Bitmap/Index Scan; a Seq Scan on the tiny seeded table is acceptable — the point is the index exists and is valid).
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean (SQL-only change; this confirms nothing else broke).
- [ ] Commit:
  ```bash
  git add lib/data/postgres/migrations/103_performance_indexes.sql
  git commit -m "Add indexes for sync-pull scans and hot PR/food-log reads

  Every pull delta scans set_logs and exercise_logs by updated_at, and
  personal_records/food_logs are repeatedly filtered on column sets that
  had no covering index."
  ```

---

### Task 5: Lazy-load `AiChatOverlay`, `Response`, and `HrDayChart`

`AiChatOverlay` is statically imported on four top-level screens (`components/workout/done-screen.tsx:7`, `components/overview-screen.tsx:12`, `app/session-select/session-select-content.tsx:15`, `app/stats/stats-content.tsx:9`), dragging react-markdown + rehype-katex + KaTeX CSS + syntax-highlighter into those initial bundles via `components/ai/response.tsx` (which imports `CodeBlock` — lazy-loading `Response` covers it). `weekly-ai-summary.tsx:7` also imports `Response` statically and is mounted on overview + stats. `HrDayChart` (chart.js) is statically imported into the home bundle (`components/home/home-card-widget.tsx:10`).

UI-only — no unit-testable logic. Verified by build-size comparison + manual dev-server checks.

**Files:**
- Modify: `components/workout/done-screen.tsx:7`
- Modify: `components/overview-screen.tsx:12`
- Modify: `app/session-select/session-select-content.tsx:15` (already imports `dynamic` at line 16)
- Modify: `app/stats/stats-content.tsx:9`
- Modify: `components/ai-chat-overlay.tsx:8`
- Modify: `components/weekly-ai-summary.tsx:7`
- Modify: `components/home/home-card-widget.tsx:10`
- Test: manual (`pnpm build` route sizes + `pnpm dev` smoke test)

**Steps:**

- [ ] Baseline: run `pnpm build` and note the "First Load JS" figures for `/session-select` (or `/`), `/stats`, and the workout route.
- [ ] In `components/workout/done-screen.tsx` replace line 7:
  ```ts
  import { AiChatOverlay } from "@/components/ai-chat-overlay";
  ```
  with:
  ```ts
  import dynamic from "next/dynamic";

  const AiChatOverlay = dynamic(() => import("@/components/ai-chat-overlay").then(m => m.AiChatOverlay), { ssr: false });
  ```
  (Place the `const` after the import block, before the first interface/component.)
- [ ] In `components/overview-screen.tsx` replace line 12 (`import { AiChatOverlay } from "@/components/ai-chat-overlay";`) the same way: delete the import, add `import dynamic from "next/dynamic";` to the import block, and add the `const AiChatOverlay = dynamic(...)` line (identical expression as above) after the imports.
- [ ] In `app/session-select/session-select-content.tsx` delete line 15 (`import { AiChatOverlay } from "@/components/ai-chat-overlay";`) — `dynamic` is already imported on line 16 — and add after the import block:
  ```ts
  const AiChatOverlay = dynamic(() => import("@/components/ai-chat-overlay").then(m => m.AiChatOverlay), { ssr: false });
  ```
- [ ] In `app/stats/stats-content.tsx` replace line 9 the same way as done-screen (add `import dynamic from "next/dynamic";` + the `const AiChatOverlay = dynamic(...)` line).
- [ ] In `components/ai-chat-overlay.tsx` replace line 8:
  ```ts
  import { Response } from "@/components/ai/response";
  ```
  with (below the existing `const ChartMessage = dynamic(...)` on line 11 — `dynamic` is already imported):
  ```ts
  const Response = dynamic(() => import("@/components/ai/response").then(m => m.Response), { ssr: false });
  ```
- [ ] In `components/weekly-ai-summary.tsx` replace line 7 (`import { Response } from "@/components/ai/response";`) with:
  ```ts
  import dynamic from "next/dynamic";

  const Response = dynamic(() => import("@/components/ai/response").then(m => m.Response), { ssr: false });
  ```
  (If the file already imports `dynamic`, only add the `const`.)
- [ ] In `components/home/home-card-widget.tsx` replace line 10:
  ```ts
  import { HrDayChart } from '@/components/health/hr-day-chart'
  ```
  with:
  ```ts
  import dynamic from 'next/dynamic'

  const HrDayChart = dynamic(() => import('@/components/health/hr-day-chart').then(m => m.HrDayChart), { ssr: false })
  ```
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean.
- [ ] Run `pnpm build` again and compare First Load JS for the same routes — expect a visible drop on `/session-select`, `/stats`, and the workout route (KaTeX + markdown + chart.js moved to async chunks).
- [ ] Manual smoke test with `pnpm dev` (target viewport: Samsung Galaxy S25 Ultra, but any mobile viewport works):
  1. Open `/session-select` — page renders; tap the AI chat FAB — overlay opens after a brief chunk load and markdown renders in a reply.
  2. Open `/stats` — the weekly AI summary card still renders its markdown text.
  3. On the home screen with the HR chart widget enabled — the HR chart still draws (or shows "No Oura HR data today" on the seeded DB).
  Broken outcome to watch for: a crash like "Element type is invalid" (wrong named-export mapping) or an overlay that never mounts.
- [ ] Commit:
  ```bash
  git add components/workout/done-screen.tsx components/overview-screen.tsx app/session-select/session-select-content.tsx app/stats/stats-content.tsx components/ai-chat-overlay.tsx components/weekly-ai-summary.tsx components/home/home-card-widget.tsx
  git commit -m "Lazy-load AI chat overlay, markdown renderer and HR chart

  AiChatOverlay was statically imported on four top screens, shipping
  react-markdown, KaTeX and syntax-highlighter in their initial bundles;
  chart.js rode the home bundle via HrDayChart. Load them on demand with
  next/dynamic (ssr: false)."
  ```

---

### Task 6: Rate-limit `prescribe` and `session-explain/insight`

These are the only two AI routes without a rate limit. Both changes follow the existing per-user pattern (`app/api/morning-briefing/route.ts:19-21`, `app/api/ai/health-insight/route.ts:55-57`). The in-memory limiter (`lib/rate-limit.ts:23`) is already unit-tested by usage elsewhere; no new pure logic is introduced, so verification is route-level.

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` (imports lines 1-13; after the auth check at line 60)
- Modify: `app/api/session-explain/insight/route.ts` (imports lines 1-6; after the auth check at line 12)
- Test: manual curl loop against the dev server

**Steps:**

- [ ] In `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` add to the imports:
  ```ts
  import { rateLimit } from '@/lib/rate-limit'
  ```
  and insert directly after line 60 (`if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`):
  ```ts
    if (!rateLimit(`prescribe:${userId}`, 10, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
  ```
- [ ] In `app/api/session-explain/insight/route.ts` add to the imports:
  ```ts
  import { rateLimit } from '@/lib/rate-limit'
  ```
  and insert directly after line 12 (`if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`):
  ```ts
      if (!rateLimit(`session-explain:${userId}`, 20, 60 * 60 * 1000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
      }
  ```
  (Note the deeper indentation — this route's body is inside a `try` block.)
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean.
- [ ] Verify on the dev server (reuse the `/tmp/ta-jar` login from Task 1, or repeat those three curl commands first):
  ```bash
  for i in $(seq 1 22); do
    curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/ta-jar http://localhost:3000/api/session-explain/insight
  done | sort | uniq -c
  ```
  Expected: the first 20 requests return a non-429 status (404 on the seeded DB — no AI-dynamic recommendation — which is fine, it proves the limiter sits before the handler work), and requests 21-22 return `429`.
- [ ] Commit:
  ```bash
  git add "app/api/ai-periodization/session/[sessionId]/prescribe/route.ts" app/api/session-explain/insight/route.ts
  git commit -m "Rate-limit the prescribe and session-explain AI routes

  These were the only Gemini-backed routes without a per-user limit,
  leaving free-tier quota exposed to a stuck client loop. 10/h for
  prescribe, 20/h for session-explain, matching the existing pattern."
  ```

---

### Task 7: Cache the morning briefing by `(userId, date)`

`app/api/morning-briefing/route.ts` calls Gemini on every uncached client hit (the client only memoises in `localStorage` per device). Reuse the `ai_health_insights` DB-cache pattern (`app/api/ai/health-insight/route.ts:49-57` + `repo.getAiHealthInsight`/`upsertAiHealthInsight`, `adapter.ts:2238-2257`) with section `'morning-briefing'` — no new table or migration needed, and cache hits skip the rate limit, same as health-insight. Dates come from `todayInTz(tz)` (already used in the route — never `toISOString().slice`).

**Files:**
- Modify: `app/api/morning-briefing/route.ts` (lines 14-30 for the reorder + cache check; lines 99-108 for the write-through)
- Test: manual — seed the cache row via psql, confirm the route returns it without an AI call

**Steps:**

- [ ] Reorder the top of the handler so the repo/date exist before the cache check, and check the cache before the rate limit. Replace lines 19-30:
  ```ts
    if (!rateLimit(`${userId}:morning-briefing`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const repo = await getRepository()
    const tz = session.user.timezone ?? DEFAULT_TZ
    const todayIso    = todayInTz(tz)
  ```
  with:
  ```ts
    const repo = await getRepository()
    const tz = session.user.timezone ?? DEFAULT_TZ
    const todayIso    = todayInTz(tz)

    // DB-cache by (userId, date) — same pattern as ai/health-insight. Cache hits
    // don't cost an AI call, so they don't count against the rate limit.
    const cached = await repo.getAiHealthInsight(userId, 'morning-briefing', todayIso)
    if (cached) {
      return NextResponse.json({
        briefing: cached,
        generatedAt: new Date().toISOString(),
      } satisfies MorningBriefingResponse)
    }

    if (!rateLimit(`${userId}:morning-briefing`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
  ```
  (The remaining date derivations — `todayMid`, `yesterdayMs`, etc. — stay where they are, immediately after this block.)
- [ ] Write through after generation. Replace the tail (lines 104-107):
  ```ts
    return NextResponse.json({
      briefing: text.trim(),
      generatedAt: new Date().toISOString(),
    } satisfies MorningBriefingResponse)
  ```
  with:
  ```ts
    const briefing = text.trim()
    await repo.upsertAiHealthInsight(userId, 'morning-briefing', todayIso, briefing)

    return NextResponse.json({
      briefing,
      generatedAt: new Date().toISOString(),
    } satisfies MorningBriefingResponse)
  ```
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean.
- [ ] Verify without needing a Gemini key. Seed a cache row for today (note: the DB `date` column compares against the same `todayInTz` string the route computes; `CURRENT_DATE` on the local DB may differ from AEST around midnight UTC — use the literal):
  ```bash
  TODAY=$(TZ=Australia/Brisbane date +%F)
  psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c \
    "INSERT INTO ai_health_insights (user_id, section, date, insight)
     SELECT id, 'morning-briefing', '$TODAY', 'CACHED-BRIEFING-SENTINEL' FROM users WHERE email = 'test@local.dev'
     ON CONFLICT (user_id, section, date) DO UPDATE SET insight = EXCLUDED.insight;"
  curl -s -b /tmp/ta-jar http://localhost:3000/api/morning-briefing | jq .briefing
  ```
  Expected: `"CACHED-BRIEFING-SENTINEL"` returned instantly (no Gemini call — the dev server logs show no AI request/error). Before the change, this returned a fresh generation attempt (a 500 without an API key).
- [ ] Commit:
  ```bash
  git add app/api/morning-briefing/route.ts
  git commit -m "Cache the morning briefing per user and day

  The briefing is deterministic for a given day's data but was
  regenerated on every uncached client hit, burning free-tier Gemini
  quota. Store it in ai_health_insights keyed (user, 'morning-briefing',
  date) and serve cache hits without touching the rate limit, matching
  the health-insight pattern."
  ```

---

### Task 8: `invalidateOuraSync()` group + injury write invalidation

The two worst stale-data paths (upgrade doc B1): after a manual Oura sync, `app/health/health-content.tsx:509-511` hand-invalidates only 3 keys, leaving `oura-stats`, `oura-hr-day:*`, `home-day-timeline`, `training-load`, `progress-summary`, `weekly-stats` stale for up to 30 min; injury add/edit/resolve/delete (`components/health/injury-sheet.tsx`) invalidates **nothing**, so the `injuries` cache key (populated at `health-content.tsx:450`) shows deleted injuries for up to 30 min. Add two group helpers to `lib/cache-groups.ts` (tested in `lib/__tests__/cache-groups.test.ts`, mirroring the existing tests) and route the call sites through them.

**Files:**
- Modify: `lib/cache-groups.ts` (append two helpers)
- Modify: `app/health/health-content.tsx` (import line 24; `handleSyncOura` lines 504-516)
- Modify: `components/more/oura-section.tsx` (imports ~line 3; `handleSync` success path ~line 110)
- Modify: `components/health/injury-sheet.tsx` (imports lines 1-11; `handleSave`/`handleResolve`/`handleDelete` success paths)
- Test: `lib/__tests__/cache-groups.test.ts`

**Steps:**

- [ ] Write the failing tests. In `lib/__tests__/cache-groups.test.ts` extend the import (line 9):
  ```ts
  import { invalidateWorkoutSummaries, invalidateReadinessInputs, invalidateProgramStructure, invalidateGoalRecommendations, invalidateOuraSync, invalidateInjuryWrites } from '../cache-groups'
  ```
  and append inside the `describe` block:
  ```ts
    it('invalidateOuraSync clears every Oura-derived cache including the oura-hr-day prefix', async () => {
      await invalidateOuraSync()
      expect(invalidated).toEqual(expect.arrayContaining([
        'body-metadata', 'sleep-sessions', 'readiness-score',
        'oura-stats', 'oura-hr-day:', 'home-day-timeline',
        'training-load', 'progress-summary', 'weekly-stats',
      ]))
    })

    it('invalidateInjuryWrites clears the injuries cache', async () => {
      await invalidateInjuryWrites()
      expect(invalidated).toEqual(expect.arrayContaining(['injuries']))
    })
  ```
- [ ] Run `pnpm test lib/__tests__/cache-groups.test.ts` — expect failure: the two helpers are not exported.
- [ ] Implement in `lib/cache-groups.ts` (append after `invalidateGoalRecommendations`):
  ```ts
  /** Caches that derive from Oura data — invalidate after a manual/automatic Oura sync. */
  export async function invalidateOuraSync(): Promise<void> {
    await Promise.all([
      invalidateCache('body-metadata'),
      invalidateCache('sleep-sessions'),
      invalidateCache('readiness-score'),
      invalidateCache('oura-stats'),
      // prefix-invalidate every `oura-hr-day:<date>` entry
      invalidateCache('oura-hr-day:'),
      invalidateCache('home-day-timeline'),
      invalidateCache('training-load'),
      invalidateCache('progress-summary'),
      invalidateCache('weekly-stats'),
    ])
  }

  /** Caches that derive from injuries — invalidate after injury add/edit/resolve/delete. */
  export async function invalidateInjuryWrites(): Promise<void> {
    await invalidateCache('injuries')
  }
  ```
- [ ] Run `pnpm test lib/__tests__/cache-groups.test.ts` — expect pass (6 tests).
- [ ] Wire `handleSyncOura` in `app/health/health-content.tsx`. Extend the import on line 24:
  ```ts
  import { invalidateReadinessInputs, invalidateWorkoutSummaries, invalidateOuraSync } from "@/lib/cache-groups";
  ```
  and replace the hand-rolled list (lines 509-511):
  ```ts
          invalidateCache('body-metadata')
          invalidateCache('sleep-sessions')
          invalidateCache('readiness-score')
  ```
  with:
  ```ts
          invalidateOuraSync().catch(() => {})
  ```
  (`handlePullSync` at line 529 already nukes everything via `invalidateCache('')` — leave it.)
- [ ] Wire the More-tab sync in `components/more/oura-section.tsx`. Add the import:
  ```ts
  import { invalidateOuraSync } from "@/lib/cache-groups"
  ```
  and in `handleSync`, insert before `await loadStatus()` (line ~110, just after the `toast.success(...)` / `toast.error(...)` if-else closes):
  ```ts
        invalidateOuraSync().catch(() => {})
  ```
- [ ] Wire `components/health/injury-sheet.tsx`. Add the import:
  ```ts
  import { invalidateInjuryWrites } from "@/lib/cache-groups";
  ```
  Then add `invalidateInjuryWrites().catch(() => {})` immediately after each of the six success `toast.success(...)` calls — two per handler (local-store branch + API-fallback branch):
  - `handleSave`, local branch — after `toast.success(injury ? 'Injury updated' : 'Injury logged')` (before `savedLocally = true`)
  - `handleSave`, API branch — after the second `toast.success(injury ? 'Injury updated' : 'Injury logged')`
  - `handleResolve`, local branch — after `toast.success('Injury marked as resolved')` (before `savedLocally = true`)
  - `handleResolve`, API branch — after the second `toast.success('Injury marked as resolved')`
  - `handleDelete`, local branch — after `toast.success('Injury deleted')` (before `savedLocally = true`)
  - `handleDelete`, API branch — after the second `toast.success('Injury deleted')`

  Example (the `handleSave` local branch — the other five are the same one-line insertion at the stated points):
  ```ts
            onOpenChange(false)
            toast.success(injury ? 'Injury updated' : 'Injury logged')
            invalidateInjuryWrites().catch(() => {})
            savedLocally = true
  ```
- [ ] Run `pnpm test`, `pnpm lint`, and `npx tsc --noEmit` — expect all clean.
- [ ] Manual check with `pnpm dev`: on `/health`, add an injury, navigate away to `/` and back to `/health` — the injury appears immediately (previously the cached `injuries` list could show the pre-write state); delete it and repeat — it's gone immediately.
- [ ] Commit:
  ```bash
  git add lib/cache-groups.ts lib/__tests__/cache-groups.test.ts app/health/health-content.tsx components/more/oura-section.tsx components/health/injury-sheet.tsx
  git commit -m "Route Oura-sync and injury writes through cache groups

  A manual Oura sync only invalidated 3 of the 9 caches derived from
  Oura data, and injury writes invalidated nothing, so both showed stale
  data for up to 30 minutes. Add invalidateOuraSync and
  invalidateInjuryWrites group helpers and use them at the call sites
  instead of hand-rolled key lists."
  ```

---

### Task 9: Scope the `supplement_logs` delete in `pushMutations` to `user_id`

`lib/data/postgres/adapter.ts:2550-2555` deletes by `(supplement_id, log_date)` only. Ownership is implied by the FK chain in practice, but every sibling branch (e.g. `food_logs` delete at `:2520-2521`) scopes to `userId` — a forged `supplementId` in a pushed mutation could delete another user's log row. The table has a `user_id` column (`schema.ts:523`).

**Files:**
- Modify: `lib/data/postgres/adapter.ts:2550-2555`
- Test: covered by tsc/lint (one-line predicate addition; no pure seam — mirrors the untested sibling branches)

**Steps:**

- [ ] In `pushMutations`, replace:
  ```ts
          if (p.deleted) {
            await this.db.delete(s.supplementLogs)
              .where(and(
                eq(s.supplementLogs.supplementId, String(p.supplementId)),
                eq(s.supplementLogs.logDate, String(p.logDate)),
              ))
  ```
  with:
  ```ts
          if (p.deleted) {
            await this.db.delete(s.supplementLogs)
              .where(and(
                eq(s.supplementLogs.supplementId, String(p.supplementId)),
                eq(s.supplementLogs.logDate, String(p.logDate)),
                eq(s.supplementLogs.userId, userId),
              ))
  ```
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean.
- [ ] Commit:
  ```bash
  git add lib/data/postgres/adapter.ts
  git commit -m "Scope supplement_logs delete in pushMutations to the user

  Every other delete branch in pushMutations constrains on user_id; this
  one deleted by (supplement_id, log_date) alone, so a forged id in a
  pushed mutation could remove another user's row."
  ```

---

### Task 10: Plate-loading calculator on the "Load the bar to X kg" card

The bar-loading card (`components/workout/active-workout-screen.tsx:262-278`) shows the target weight but the user still does plate math in their head. Add a pure `plateBreakdown` helper (greedy, one pair of each plate: 25/20/15/10/5/2.5/1.25 kg + 20 kg bar) in `components/workout/utils.ts`, unit-test it, and render the per-side breakdown under the weight. Weights are `mround125` multiples of 1.25 kg, so the per-side value can land on a 0.625 step that no plate set reaches — the helper reports the closest achievable load and the UI flags it.

**Files:**
- Modify: `components/workout/utils.ts` (append after `defaultRpeFromPct`, line 50)
- Modify: `components/workout/active-workout-screen.tsx` (import line 7; card lines 274-277)
- Test: `lib/__tests__/plate-breakdown.test.ts`

**Steps:**

- [ ] Write the failing test at `lib/__tests__/plate-breakdown.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { plateBreakdown } from '@/components/workout/utils'

  describe('plateBreakdown', () => {
    it('breaks a simple load into one plate per side', () => {
      expect(plateBreakdown(60)).toEqual({ perSide: [20], achievableKg: 60, exact: true })
    })

    it('combines plates greedily, heaviest first', () => {
      expect(plateBreakdown(100)).toEqual({ perSide: [25, 15], achievableKg: 100, exact: true })
      expect(plateBreakdown(102.5)).toEqual({ perSide: [25, 15, 1.25], achievableKg: 102.5, exact: true })
      expect(plateBreakdown(67.5)).toEqual({ perSide: [20, 2.5, 1.25], achievableKg: 67.5, exact: true })
    })

    it('returns an empty bar for exactly the bar weight', () => {
      expect(plateBreakdown(20)).toEqual({ perSide: [], achievableKg: 20, exact: true })
    })

    it('returns null below the bar weight', () => {
      expect(plateBreakdown(15)).toBeNull()
    })

    it('reports the closest achievable load when the per-side value is not reachable', () => {
      // 61.25 kg → 20.625 kg per side; best is a single 20 → 60 kg total
      expect(plateBreakdown(61.25)).toEqual({ perSide: [20], achievableKg: 60, exact: false })
    })

    it('caps at one pair of each plate size', () => {
      // (177.5 − 20) / 2 = 78.75 = every plate once
      expect(plateBreakdown(177.5)).toEqual({ perSide: [25, 20, 15, 10, 5, 2.5, 1.25], achievableKg: 177.5, exact: true })
      // beyond the rack: all plates on, flagged inexact
      expect(plateBreakdown(197.5)).toEqual({ perSide: [25, 20, 15, 10, 5, 2.5, 1.25], achievableKg: 177.5, exact: false })
    })
  })
  ```
- [ ] Run it: `pnpm test lib/__tests__/plate-breakdown.test.ts` — expect failure: `plateBreakdown` is not exported.
- [ ] Implement in `components/workout/utils.ts` (append at the end):
  ```ts
  export const BAR_WEIGHT_KG = 20;
  // One pair of each size — the plates available on the user's rack.
  export const PLATE_PAIRS_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

  export interface PlateBreakdown {
    perSide: number[];    // plates on each side, heaviest first
    achievableKg: number; // bar + 2 × sum(perSide); equals the target when exact
    exact: boolean;
  }

  // Greedy per-side breakdown. Returns null when the target is below the empty bar.
  // Weights are 1.25 kg multiples but the per-side value can land on a 0.625 step,
  // so a breakdown may be inexact — achievableKg is then the closest load below.
  export function plateBreakdown(targetKg: number, barKg: number = BAR_WEIGHT_KG): PlateBreakdown | null {
    if (targetKg < barKg) return null;
    let remaining = (targetKg - barKg) / 2;
    const perSide: number[] = [];
    for (const plate of PLATE_PAIRS_KG) {
      if (remaining >= plate - 1e-9) {
        perSide.push(plate);
        remaining -= plate;
      }
    }
    const achievableKg = barKg + 2 * perSide.reduce((sum, p) => sum + p, 0);
    return { perSide, achievableKg, exact: Math.abs(achievableKg - targetKg) < 1e-9 };
  }
  ```
- [ ] Run `pnpm test lib/__tests__/plate-breakdown.test.ts` — expect pass (6 tests).
- [ ] Render it on the card. In `components/workout/active-workout-screen.tsx` extend the import on line 7:
  ```ts
  import { formatSheetDate, mround125, mround125Up, formatTime, formatSetLoad, plateBreakdown } from "./utils";
  ```
  and inside the bar-loading card, replace lines 274-276:
  ```tsx
                  {exercise?.progressionStyle?.[0]?.pct && (
                    <p className="text-xs text-muted-foreground mt-1.5">{exercise.progressionStyle[0].pct}% of 1RM · {exercise.progressionStyle[0].reps} reps per set</p>
                  )}
  ```
  with:
  ```tsx
                  {exercise?.progressionStyle?.[0]?.pct && (
                    <p className="text-xs text-muted-foreground mt-1.5">{exercise.progressionStyle[0].pct}% of 1RM · {exercise.progressionStyle[0].reps} reps per set</p>
                  )}
                  {(() => {
                    const plates = plateBreakdown(perSetWeights[0]);
                    if (!plates) return null;
                    return (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {plates.perSide.length === 0
                          ? "Empty bar"
                          : `${plates.perSide.join(" + ")} per side`}
                        {!plates.exact && ` · closest ${plates.achievableKg} kg`}
                      </p>
                    );
                  })()}
  ```
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — expect clean.
- [ ] Manual check with `pnpm dev` (mobile viewport): start a workout from `/session-select` (seeded Push/Pull/Legs program) on a barbell exercise with a working weight — the ready screen's brand-tinted "Load the bar to X kg" card now shows a line like `20 + 2.5 per side` under the percentage line; for an unreachable weight it appends `· closest N kg`; the card is unchanged for bodyweight exercises (it isn't rendered there at all, `!isBodyweight` guard at line 263).
- [ ] Commit:
  ```bash
  git add components/workout/utils.ts components/workout/active-workout-screen.tsx lib/__tests__/plate-breakdown.test.ts
  git commit -m "Show the per-side plate breakdown on the bar-load card

  The card told the user what to load but left the plate math to them
  mid-session. Greedy breakdown over one pair each of 25/20/15/10/5/
  2.5/1.25 kg plates on a 20 kg bar, flagging loads the rack can't hit
  exactly with the closest achievable weight."
  ```

---

## Final verification (whole PR)

- [ ] `pnpm test` — full suite green (including the new `apply-prescription`, `oura-webhook-signature`, `cache-groups`, `plate-breakdown` tests).
- [ ] `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] `pnpm build` — succeeds.
- [ ] `pnpm dev` end-to-end pass per the standing instructions: exercise `/api/sync/pull` (Task 1), `/api/morning-briefing` (Task 7), `/api/session-explain/insight` rate limit (Task 6), the Health tab Oura-sync + injury flows (Task 8), the workout ready screen plate line (Task 10), and the AI chat overlay on home/stats (Task 5).
- [ ] Push the branch, open the PR (title: "Quick wins: offline food fix, deload persistence, webhook hardening, perf + caching"), let CI run, and **ask the user before merging** — this PR deploys code. Flag the pending APK verification for Task 1 in the PR body.
