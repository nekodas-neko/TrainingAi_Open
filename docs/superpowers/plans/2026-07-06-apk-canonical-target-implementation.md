# APK Canonical Target — Dual-Path Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the S25 APK as the single canonical runtime (doctrine in CLAUDE.md), and converge every offline-sync domain's two server write paths — the web API route and its `pushMutations` branch — onto one shared repository function each, fixing the concrete drift bugs found in the 2026-07-06 audit.

**Architecture:** Four independently-shippable chunks, one PR each, per the approach doc
`docs/superpowers/plans/2026-07-06-apk-canonical-target-dual-path-tax.md` (read it first — it has
the full rationale, including why the PWA plumbing must NOT be deleted). Chunk 1 is docs-only
doctrine; chunks 2–3 are the code work (5 of 11 sync domains re-implement their writes inline in
`pushMutations` instead of calling the repo function the web route uses); chunk 3 also lands the
CI custom rule that makes the convergence permanent (Batch J pattern — the rule ships in the same
PR that brings violations to zero); chunk 4 is two small read-fallback thinning fixes.

**Tech Stack:** Next.js 15 API routes, Drizzle ORM/Postgres, vitest (the existing
`lib/data/postgres/__tests__/push-mutations-web-parity.test.ts` integration harness — runs against
the local dev Postgres, skips in CI), grep/node-script CI custom rules in
`.github/workflows/ci.yml`.

---

## Audit results this plan is built on (2026-07-06, against `main` @ `8ace9af`)

Resolves the approach doc's three open questions:

1. **WS2/WS3 sequencing — audit ran during planning; no separate audit PR.** Findings are
   embedded below. Write-path convergence is a blanket sweep of all 5 inline domains (chunks 2–3).
   Read-fallback divergences: 2 quick fixes in scope (chunk 4); 3 heavier ones deferred to
   fix-on-touch with Known-Issues rows (added in the same docs PR as this plan — no orphaned
   findings).
2. **CI custom rule — yes.** `scripts/check-push-mutations.js` fails if the `pushMutations` method
   body touches `this.db.` or raw ``sql` `` directly. Ships in chunk 3's PR, when violations hit
   zero (Batch J wave pattern).
3. **Web-only affordances — freeze, don't delete.** Existing manifest/SW/install affordance stays
   (load-bearing for APK offline cold-start + push); no new web-only product work. Doctrine text in
   chunk 1.

### Write-path audit (`pushMutations`, `lib/data/postgres/adapter.ts:2868-3219`)

| Domain | Web route | Shared fn today? | Drift found |
|---|---|---|---|
| `body_metrics` | `body-metadata` | ✅ `upsertBodyMetrics` | none |
| `mood_logs` | `mood` | ✅ `saveMoodLog` | none |
| `day_checkins` | `day-checkin` | ✅ `saveDayCheckin` | none |
| `workout_log` | `log-exercise` | ✅ `logExerciseFromPayload` | none — **the reference pattern** |
| `session_rpe` | `workout-sessions/rpe` | ✅ `setSessionRpe` | none |
| `complete_workout` | `complete-workout` | ✅ `completeWorkoutFromPayload` | none |
| `food_logs` | `nutrition/food-logs` | ❌ inline (adapter.ts:2968) | push delete + conflict-update never bump `updated_at`; push duplicates qm clamp + FK check (raw SQL) |
| `supplement_logs` | `supplements/[id]/log` | ❌ inline (adapter.ts:3009) | push soft-delete/revive never bump `updated_at` (repo fns do) |
| `supplements` | `supplements`, `supplements/[id]` | ❌ inline (adapter.ts:3041) | push delete + conflict-update never bump `updated_at` |
| `activity_logs` | `activity-logs` | ❌ inline (adapter.ts:3071) | **push silently drops `caloriesBurned`** (absent from values/updateSet — offline-logged calories are lost); conflict semantics differ (push last-write-wins vs route `onConflictDoNothing` first-write-wins); no `updated_at` bump on conflict-update |
| `injuries` | `injuries`, `injuries/[id]` | ❌ inline (adapter.ts:3135) | push resolvedDate patch never bumps `updated_at`; push conflict-update omits `startedDate`; web `updateInjury` null-clobbers `notes`/`resolvedDate` on partial patches |

**Why the `updated_at` misses matter:** no table uses Drizzle `$onUpdate` — `updated_at` is
`defaultNow()` on insert only, and `getSyncDelta` cursors on it. Any UPDATE that doesn't set it
explicitly is invisible to cross-device sync: the other device never pulls the change. Two of
these are **web-side** bugs too: `updateFoodLog` (`lib/data/postgres/slices/nutrition.ts:193`) and
`updateInjury` (adapter.ts:3343) never bump it.

### Read-fallback audit (in scope for chunk 4 / deferred)

- **In scope:** `components/health/health-score-detail.tsx:124` duplicates the score-band
  thresholds inline (`>=70 High / >=50 Moderate / Low`) that `lib/health/score-band.ts` exists to
  centralise; `components/nutrition/end-of-day/end-of-day-review.tsx:88` fetches
  `/api/day-checkin?date=` without `phase=evening`, silently relying on the server default.
- **Deferred (fix-on-touch, Known-Issues rows in `projectOverview.md`):** strength-trend math
  duplicated client-side (`app/health/health-content.tsx:413-444` vs `/api/strength-trend`);
  exercise-history device path re-derives entries and hardcodes `isDeload:false`
  (`components/exercise-history-sheet.tsx:31-50`); nutrition `calsBurnedToday` computed from two
  different sources (`app/nutrition/nutrition-content.tsx:192` local sum vs `body-metadata`).
- **False alarm (verified, no action):** water has no push branch because water writes queue as
  `body_metrics` mutations (`components/profile/water-log-sheet.tsx:59`) — covered.

---

## File Map

| File | Action | Chunk | Responsibility |
|---|---|---|---|
| `CLAUDE.md` | Modify | 1 | New "Canonical Runtime" doctrine section + Communication cross-ref |
| `docs/device-smoke-checklist.md` | Modify | 1 | Intro names itself as the merge gate for offline-first/device-only surfaces |
| `lib/data/postgres/adapter.ts` | Modify | 2+3 | `logSupplement` gains ownership check; `createSupplement`/`createInjury` gain optional-id upsert; `updateInjury` becomes truly partial + bumps `updatedAt`; `saveActivityLog` gains `{id, overwrite}`; all 5 push branches become thin delegations |
| `lib/data/repository.ts` | Modify | 2+3 | Signature updates for the four extended methods |
| `lib/data/postgres/slices/nutrition.ts` | Modify | 3 | `createFoodLog` gains optional id/loggedAt + upsert; `updateFoodLog` bumps `updatedAt` |
| `lib/data/postgres/__tests__/push-mutations-web-parity.test.ts` | Modify | 2+3 | New parity tests per converged domain |
| `scripts/check-push-mutations.js` | Add | 3 | CI rule: no `this.db.`/raw sql inside `pushMutations` |
| `.github/workflows/ci.yml` | Modify | 3 | New custom-rules step running the script |
| `components/health/health-score-detail.tsx` | Modify | 4 | Inline band thresholds → `scoreBand()` |
| `components/nutrition/end-of-day/end-of-day-review.tsx` | Modify | 4 | Explicit `phase=evening` on the web fallback fetch |
| `package.json` + `lib/changelog.ts` | Modify | 3+4 | Patch bump + changelog entry per code PR |

Branches: chunk 1 `docs/canonical-runtime-doctrine`, chunk 2
`refactor/one-write-path-supplements-injuries`, chunk 3 `refactor/one-write-path-food-activity`,
chunk 4 `fix/thin-web-read-fallbacks`. Each starts from freshly-fetched `main`
(`git fetch origin main && git remote prune origin && git checkout -B <branch> origin/main`).

**Testing note for chunks 2–3:** the parity suite only runs with a `DATABASE_URL`, so run it as
`DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' pnpm vitest run lib/data/postgres/__tests__/push-mutations-web-parity.test.ts`
(the local dev Postgres from `pnpm db:local`). CI skips it by design — the local run IS the gate,
say so in the PR description. The `pushMutations` code path itself is reachable without a device
(it's the server side of `/api/sync/push`), so these are real executions, not mocks; what stays
un-exercised is the *client* outbox → push wiring, which is already covered by the standing
device-smoke checklist item (Offline round-trip).

---

## Chunk 1 — Doctrine: CLAUDE.md canonical-runtime section (docs-only PR)

### Task 1.1: Add the "Canonical Runtime" section to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (insert between the end of `## Offline-First — the on-device local store is the source of truth (do not violate)` and `## Package Management`, i.e. after the "Read-site status" paragraph and before the `---` that precedes Package Management)

- [ ] **Step 1: Insert the new section**

```markdown
## Canonical Runtime — the S25 APK is the only supported product target

**Policy (2026-07-06, see `docs/superpowers/plans/2026-07-06-apk-canonical-target-dual-path-tax.md`):**
the app's single canonical, supported runtime is the APK on the Samsung S25 Ultra. The web build
exists solely as a dev/QA surface (`pnpm dev` pre-merge testing). This section exists so the
question is never re-litigated per change.

- **When behaviour must diverge, the device wins.** Never add product features or affordances that
  only make sense on web; web-only UI work is frozen.
- **The web online-only read fallback exists only so `pnpm dev` renders.** It must stay
  logic-free: a pure fetch → render pass-through. It must never carry defaults, derivations,
  band/threshold math, or write semantics the device path lacks — a fallback that holds no logic
  structurally cannot drift. Reference pattern: the supplements reads in
  `app/nutrition/nutrition-content.tsx`.
- **One write function per domain.** The web API route and the `pushMutations` branch in
  `lib/data/postgres/adapter.ts` must call the same shared function — `logExerciseFromPayload`
  (`lib/workout/log-exercise.ts`) is the reference. The push branch may parse/validate the payload,
  but every actual write goes through the shared function.
- **Do NOT delete the PWA plumbing** (`app/manifest.ts`, the service worker, the install
  affordance). The APK is a WebView loading the Railway URL remotely (`capacitor.config.ts`
  `server.url`), so the SW is what gives the APK offline cold-start AND is the push-notification
  transport. Removing it is a device regression, not a cleanup. Full PWA removal only makes sense
  as part of the unscoped "bundle the shell into the APK + native FCM push" endgame project (noted
  in `docs/implementation-backlog.md`, not yet planned).
- **Green `pnpm dev` is necessary, never sufficient.** For any change touching an offline-first
  domain, a native plugin, safe-area, gestures, or notifications, the merge gate is the on-device
  smoke run (`docs/device-smoke-checklist.md`) — or, when no device is available in-session, an
  explicit Known-Issues row in `projectOverview.md` marking the change NOT verified on device.
```

- [ ] **Step 2: Add the cross-reference in `## Communication`**

In the Communication section's "state which failure surfaces were NOT exercised" bullet, append one
sentence at the end of that bullet:

```markdown
  The Canonical Runtime section above defines the device-first policy this rule enforces.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: write the APK-canonical-runtime policy into CLAUDE.md"
```

### Task 1.2: Name the checklist as the merge gate

**Files:**
- Modify: `docs/device-smoke-checklist.md` (intro paragraph, lines 3-7)

- [ ] **Step 1: Extend the intro**

Replace the intro's last sentence ("Not every merge needs every section; use judgement, but
default to running the sections relevant to what changed.") with:

```markdown
Not every merge needs every section; use judgement, but default to running the sections relevant
to what changed. Per CLAUDE.md's Canonical Runtime section, this checklist is the **merge gate**
for anything the web sandbox can't exercise — green `pnpm dev` alone is never sufficient for
offline-first domains, native plugins, safe-area, gestures, or notifications.
```

- [ ] **Step 2: Commit, push, open the docs-only PR**

```bash
git add docs/device-smoke-checklist.md
git commit -m "docs: name the device smoke checklist as the offline-first merge gate"
git push -u origin docs/canonical-runtime-doctrine
```

Docs-only PR — no merge-confirmation gate needed once CI is green.

---

## Chunk 2 — One write path: supplements, supplement_logs, injuries

All three are pure delegation swaps: the push branch keeps its payload parsing but every write
goes through the repo function the web route uses. Each swap also fixes the `updated_at`
propagation bugs listed in the audit table. Signature philosophy: extend the existing repo
functions with an optional client-supplied `id` (offline-created rows must keep their local UUID
so outbox confirm + pull dedup match) rather than adding parallel `upsertX` functions.

### Task 2.1: `logSupplement` absorbs the ownership check; push branch delegates

**Files:**
- Modify: `lib/data/postgres/adapter.ts:3403-3424` (`logSupplement`), `adapter.ts:3009-3040` (push branch)
- Test: `lib/data/postgres/__tests__/push-mutations-web-parity.test.ts`

Today the push branch raw-SQL-checks supplement ownership before its inline insert; the web route
(`app/api/supplements/[id]/log/route.ts:12`) calls `logSupplement` with no check (a bad id 500s on
the FK violation). Moving the check into `logSupplement` gives both paths the same, cleaner
failure; the push loop's try/catch turns the throw into a per-mutation error entry exactly like
the old explicit `errors.push`.

- [ ] **Step 1: Write the failing parity test**

Add to `push-mutations-web-parity.test.ts` (inside the existing `describe`, after the
`session_rpe` test). The `beforeAll` already creates the test user; add a supplement fixture in
the test itself:

```ts
it('supplement_logs: push unlog + re-log both bump updated_at (sync-delta visibility)', async () => {
  const sup = await pool.query(
    `INSERT INTO supplements (user_id, name) VALUES ($1, 'Parity Creatine') RETURNING id`,
    [TEST_USER_ID],
  )
  const supplementId = sup.rows[0].id

  await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-sup-log-1', domain: 'supplement_logs', date: '2026-01-10',
    payload: { supplementId, logDate: '2026-01-10' },
  }])
  const created = await pool.query(
    `SELECT updated_at FROM supplement_logs WHERE supplement_id = $1 AND log_date = '2026-01-10'`,
    [supplementId],
  )
  expect(created.rows.length).toBe(1)

  await pool.query(
    `UPDATE supplement_logs SET updated_at = '2020-01-01' WHERE supplement_id = $1`, [supplementId],
  )
  const unlog = await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-sup-log-2', domain: 'supplement_logs', date: '2026-01-10',
    payload: { supplementId, logDate: '2026-01-10', deleted: true },
  }])
  expect(unlog.processed).toBe(1)
  const afterUnlog = await pool.query(
    `SELECT deleted_at, updated_at FROM supplement_logs WHERE supplement_id = $1`, [supplementId],
  )
  expect(afterUnlog.rows[0].deleted_at).not.toBeNull()
  expect(new Date(afterUnlog.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

  await pool.query(
    `UPDATE supplement_logs SET updated_at = '2020-01-01' WHERE supplement_id = $1`, [supplementId],
  )
  const relog = await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-sup-log-3', domain: 'supplement_logs', date: '2026-01-10',
    payload: { supplementId, logDate: '2026-01-10' },
  }])
  expect(relog.processed).toBe(1)
  const afterRelog = await pool.query(
    `SELECT deleted_at, updated_at FROM supplement_logs WHERE supplement_id = $1`, [supplementId],
  )
  expect(afterRelog.rows[0].deleted_at).toBeNull()
  expect(new Date(afterRelog.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

  await pool.query(`DELETE FROM supplements WHERE id = $1`, [supplementId])
})

it('supplement_logs: push rejects a supplement the user does not own', async () => {
  const result = await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-sup-log-4', domain: 'supplement_logs', date: '2026-01-10',
    payload: { supplementId: crypto.randomUUID(), logDate: '2026-01-10' },
  }])
  expect(result.processed).toBe(0)
  expect(result.errors.length).toBe(1)
})
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' pnpm vitest run lib/data/postgres/__tests__/push-mutations-web-parity.test.ts`
Expected: the unlog/re-log assertions on `updated_at` FAIL (year stays 2020 — the inline push
branch never bumps it). The ownership test passes already (the inline check) — it locks the
behavior through the refactor.

- [ ] **Step 3: Move the ownership check into `logSupplement`** (adapter.ts:3403)

```ts
  async logSupplement(supplementId: string, userId: string, date: string): Promise<void> {
    const [owns] = await this.db.select({ id: s.supplements.id }).from(s.supplements)
      .where(and(eq(s.supplements.id, supplementId), eq(s.supplements.userId, userId)))
      .limit(1)
    if (!owns) throw new Error('Supplement not found')
    // onConflictDoUpdate (not DoNothing): a prior unlog on this same date soft-deleted
    // the row via the (supplement_id, log_date) unique constraint — re-logging must
    // revive it (clear deleted_at), not silently no-op.
    await this.db.insert(s.supplementLogs)
      .values({ supplementId, userId, logDate: date })
      .onConflictDoUpdate({
        target: [s.supplementLogs.supplementId, s.supplementLogs.logDate],
        set: { deletedAt: null, updatedAt: new Date() },
        setWhere: eq(s.supplementLogs.userId, userId),
      })
  }
```

- [ ] **Step 4: Replace the push branch** (adapter.ts:3009-3040) with:

```ts
        } else if (mut.domain === 'supplement_logs') {
          const p = clean as Record<string, unknown>
          if (p.deleted) {
            await this.unlogSupplement(String(p.supplementId), userId, String(p.logDate))
          } else {
            await this.logSupplement(String(p.supplementId), userId, String(p.logDate))
          }
          processed++
        }
```

(The discarded `crypto.randomUUID()` id is fine to drop — supplement_logs identity is the
`(supplement_id, log_date)` natural key, not the row id.)

- [ ] **Step 5: Run the tests — all pass**

- [ ] **Step 6: Commit**

```bash
git add lib/data/postgres/adapter.ts lib/data/postgres/__tests__/push-mutations-web-parity.test.ts
git commit -m "refactor: supplement_logs push path delegates to logSupplement/unlogSupplement

Fixes the updated_at propagation gap: the inline push soft-delete/revive never
bumped updated_at, so getSyncDelta (cursored on it) never carried an offline
unlog/re-log to other devices. Ownership check moves into logSupplement so the
web route gets it too."
```

### Task 2.2: `createSupplement` gains optional-id upsert; push branch delegates

**Files:**
- Modify: `lib/data/repository.ts` (createSupplement signature), `lib/data/postgres/adapter.ts:3379-3382` (impl), `adapter.ts:3041-3070` (push branch)
- Test: `lib/data/postgres/__tests__/push-mutations-web-parity.test.ts`

- [ ] **Step 1: Write the failing parity test**

```ts
it('supplements: push delete matches web deleteSupplement (active=false, deleted_at, updated_at)', async () => {
  const id = crypto.randomUUID()
  await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-sup-1', domain: 'supplements', date: '2026-01-11',
    payload: { id, name: 'Parity Mag', sortOrder: 0, active: true },
  }])
  await pool.query(`UPDATE supplements SET updated_at = '2020-01-01' WHERE id = $1`, [id])

  const del = await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-sup-2', domain: 'supplements', date: '2026-01-11',
    payload: { id, deleted: true },
  }])
  expect(del.processed).toBe(1)
  const row = await pool.query(
    `SELECT active, deleted_at, updated_at FROM supplements WHERE id = $1`, [id],
  )
  expect(row.rows[0].active).toBe(false)
  expect(row.rows[0].deleted_at).not.toBeNull()
  expect(new Date(row.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

  await pool.query(`DELETE FROM supplements WHERE id = $1`, [id])
})
```

- [ ] **Step 2: Run — FAIL** (inline push delete sets `active`/`deleted_at` but `updated_at` stays 2020).

- [ ] **Step 3: Extend `createSupplement`**

`lib/data/repository.ts` (Supplements block):

```ts
  createSupplement(userId: string, data: Omit<import('@/lib/types/supplement').Supplement, 'id' | 'userId' | 'createdAt'> & { id?: string }): Promise<import('@/lib/types/supplement').Supplement>
```

`adapter.ts:3379`:

```ts
  async createSupplement(userId: string, data: Omit<Supplement, 'id' | 'userId' | 'createdAt'> & { id?: string }): Promise<Supplement> {
    const { id, ...rest } = data
    // Optional client id: an offline-created supplement keeps its local UUID so the
    // outbox replay is idempotent — a re-push updates in place instead of duplicating.
    const [r] = await this.db.insert(s.supplements)
      .values({ ...(id ? { id } : {}), userId, ...rest })
      .onConflictDoUpdate({
        target: s.supplements.id,
        set: { ...rest, updatedAt: new Date() },
        setWhere: eq(s.supplements.userId, userId),
      })
      .returning()
    return this.rowToSupplement(r)
  }
```

- [ ] **Step 4: Replace the push branch** (adapter.ts:3041-3070) with:

```ts
        } else if (mut.domain === 'supplements') {
          const p = clean as Record<string, unknown>
          if (p.deleted) {
            await this.deleteSupplement(String(p.id), userId)
          } else {
            await this.createSupplement(userId, {
              id:              String(p.id),
              name:            String(p.name),
              dose:            p.dose ? String(p.dose) : null,
              reminderEnabled: Boolean(p.reminderEnabled),
              reminderTime:    p.reminderTime ? String(p.reminderTime) : null,
              sortOrder:       typeof p.sortOrder === 'number' ? p.sortOrder : 0,
              active:          p.active !== false,
            })
          }
          processed++
        }
```

- [ ] **Step 5: Run the parity suite — all pass.** (Delete now goes through `deleteSupplement`,
  which sets all three of `active:false`/`deletedAt`/`updatedAt` — adapter.ts:3393.)

- [ ] **Step 6: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts lib/data/postgres/__tests__/push-mutations-web-parity.test.ts
git commit -m "refactor: supplements push path delegates to createSupplement/deleteSupplement

createSupplement gains an optional client id (idempotent offline replay).
Fixes: push delete and conflict-update never bumped updated_at, so an offline
supplement edit/delete never propagated to other devices."
```

### Task 2.3: Injuries — truly-partial `updateInjury`, optional-id `createInjury`, push delegates

**Files:**
- Modify: `lib/data/repository.ts` (createInjury signature), `lib/data/postgres/adapter.ts:3331-3362` (impls), `adapter.ts:3135-3166` (push branch)
- Test: `lib/data/postgres/__tests__/push-mutations-web-parity.test.ts`

Two pre-existing bugs get fixed here:
1. `updateInjury` (adapter.ts:3343) writes `notes: data.notes ?? null` etc. — a partial PATCH
   (e.g. `{resolvedDate}`) null-clobbers `notes`, `muscleName` becomes `undefined` (Drizzle skips
   it) but `notes`/`resolvedDate` are actively nulled. That's why the push branch grew its own
   resolvedDate-only fast path. Making `updateInjury` truly partial fixes the web PATCH route too.
   (Before implementing, check what `components/health/injury-sheet.tsx`'s web fallback actually
   PATCHes — if it sends `{resolvedDate}` only, this is a live web bug today.)
2. Neither `updateInjury` nor the push resolvedDate patch bumps `updatedAt` → sync-delta misses.

- [ ] **Step 1: Write the failing parity test**

```ts
it('injuries: push resolvedDate patch does not clobber notes and bumps updated_at', async () => {
  const id = crypto.randomUUID()
  await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-inj-1', domain: 'injuries', date: '2026-01-12',
    payload: { id, muscleName: 'Hamstrings', severity: 'mild', notes: 'tweaked on RDLs', startedDate: '2026-01-12' },
  }])
  await pool.query(`UPDATE injuries SET updated_at = '2020-01-01' WHERE id = $1`, [id])

  const patch = await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-inj-2', domain: 'injuries', date: '2026-01-12',
    payload: { id, resolvedDate: '2026-01-20' },
  }])
  expect(patch.processed).toBe(1)
  const row = await pool.query(
    `SELECT notes, resolved_date, updated_at FROM injuries WHERE id = $1`, [id],
  )
  expect(row.rows[0].notes).toBe('tweaked on RDLs')
  expect(row.rows[0].resolved_date).toBe('2026-01-20')
  expect(new Date(row.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

  await pool.query(`DELETE FROM injuries WHERE id = $1`, [id])
})

it('injuries: web PATCH with only resolvedDate must not null-clobber notes', async () => {
  const created = await repo.createInjury(TEST_USER_ID, {
    muscleName: 'Calves', severity: 'mild', notes: 'web parity note',
    startedDate: '2026-01-12', resolvedDate: null,
  })
  const updated = await repo.updateInjury(created.id, TEST_USER_ID, { resolvedDate: '2026-01-21' })
  expect(updated.notes).toBe('web parity note')
  expect(updated.resolvedDate).toBe('2026-01-21')
  await pool.query(`DELETE FROM injuries WHERE id = $1`, [created.id])
})
```

- [ ] **Step 2: Run — both FAIL** (push patch doesn't bump `updated_at`; `updateInjury` nulls `notes`).

- [ ] **Step 3: Fix `updateInjury`** (adapter.ts:3343):

```ts
  async updateInjury(id: string, userId: string, data: Partial<Omit<Injury, 'id' | 'userId' | 'createdAt'>>): Promise<Injury> {
    // Truly partial: only fields present in the patch are written — a
    // resolvedDate-only PATCH must not null-clobber notes (and updated_at must
    // bump, or getSyncDelta never carries the edit to other devices).
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (data.muscleName !== undefined) set.muscleName = data.muscleName
    if (data.notes !== undefined) set.notes = data.notes
    if (data.severity !== undefined) set.severity = data.severity
    if (data.startedDate !== undefined) set.startedDate = data.startedDate
    if (data.resolvedDate !== undefined) set.resolvedDate = data.resolvedDate
    const [r] = await this.db.update(s.injuries)
      .set(set)
      .where(and(eq(s.injuries.id, id), eq(s.injuries.userId, userId)))
      .returning()
    if (!r) throw new Error('Injury not found')
    return this.rowToInjury(r)
  }
```

- [ ] **Step 4: Extend `createInjury`** (adapter.ts:3331) and its `repository.ts` signature
  (`data` gains `& { id?: string }`, same shape as createSupplement in Task 2.2):

```ts
  async createInjury(userId: string, data: Omit<Injury, 'id' | 'userId' | 'createdAt'> & { id?: string }): Promise<Injury> {
    const { id, ...rest } = data
    const [r] = await this.db.insert(s.injuries).values({
      ...(id ? { id } : {}),
      userId,
      muscleName: rest.muscleName,
      notes: rest.notes ?? null,
      severity: rest.severity,
      startedDate: rest.startedDate,
      resolvedDate: rest.resolvedDate ?? null,
    }).onConflictDoUpdate({
      target: s.injuries.id,
      set: {
        muscleName:   rest.muscleName,
        notes:        rest.notes ?? null,
        severity:     rest.severity,
        startedDate:  rest.startedDate,
        resolvedDate: rest.resolvedDate ?? null,
        updatedAt:    new Date(),
      },
      setWhere: eq(s.injuries.userId, userId),
    }).returning()
    return this.rowToInjury(r)
  }
```

(Deliberate change vs the old inline push upsert: `startedDate` is now included in the
conflict-update — its omission was drift, not design; a replayed offline edit should propagate a
corrected start date.)

- [ ] **Step 5: Replace the push branch** (adapter.ts:3135-3166) with:

```ts
        } else if (mut.domain === 'injuries') {
          const p = clean as Record<string, unknown>
          type InjSeverity = import('@/lib/types/injury').Injury['severity']
          if (p.deleted) {
            await this.deleteInjury(String(p.id), userId)
          } else if (p.resolvedDate !== undefined) {
            // Preserve the existing branch order: any payload carrying resolvedDate
            // is a resolve/unresolve patch (full upserts from the outbox never set it).
            await this.updateInjury(String(p.id), userId, {
              resolvedDate: p.resolvedDate ? String(p.resolvedDate) : null,
            })
          } else {
            await this.createInjury(userId, {
              id:           String(p.id),
              muscleName:   String(p.muscleName),
              notes:        p.notes ? String(p.notes) : null,
              severity:     String(p.severity) as InjSeverity,
              startedDate:  String(p.startedDate),
              resolvedDate: null,
            })
          }
          processed++
        }
```

Behavior note: the resolvedDate patch previously no-opped silently on a missing row; it now throws
`Injury not found` → a per-mutation error entry. That's correct poison-pill handling — the outbox
quarantines it after 5 attempts instead of pretending success.

- [ ] **Step 6: Run the parity suite — all pass. Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts lib/data/postgres/__tests__/push-mutations-web-parity.test.ts
git commit -m "refactor: injuries push path delegates to createInjury/updateInjury/deleteInjury

updateInjury becomes truly partial (a resolvedDate-only PATCH no longer
null-clobbers notes) and bumps updated_at so offline resolve/edit propagates
through getSyncDelta. createInjury gains an optional client id for idempotent
offline replay; startedDate now propagates on replayed edits."
```

### Task 2.4: Chunk 2 wrap-up

- [ ] Run the full gate: `pnpm lint && pnpm tsc --noEmit && pnpm vitest run`, then the parity
  suite with `DATABASE_URL` as above.
- [ ] `pnpm dev` smoke: log/unlog a supplement, create+resolve an injury via the UI against the
  local DB; confirm no 500s and rows update (web routes changed shape in Tasks 2.1/2.3).
- [ ] Patch version bump + `lib/changelog.ts` entry (the injuries partial-PATCH fix and the
  cross-device propagation fixes are user-visible bug fixes).
- [ ] Push, open PR. In the description, state: parity suite run locally against dev Postgres
  (CI skips it); client outbox → push wiring NOT exercised (native-only) — covered by the
  device-smoke checklist's Offline round-trip section on the next device pass.

---

## Chunk 3 — One write path: food_logs, activity_logs + the CI rule

### Task 3.1: `createFoodLog`/`updateFoodLog` upgrades; push branch delegates

**Files:**
- Modify: `lib/data/postgres/slices/nutrition.ts:177-206`, `lib/data/postgres/adapter.ts:2533-2536` (wrappers), `lib/data/repository.ts` (createFoodLog signature), `adapter.ts:2968-3008` (push branch)
- Test: `lib/data/postgres/__tests__/push-mutations-web-parity.test.ts`

- [ ] **Step 1: Write the failing parity test** (the existing suite already covers the qm clamp
  and default parity for food_logs — keep those; add the updated_at + delete coverage):

```ts
it('food_logs: push delete and push qm-edit both bump updated_at', async () => {
  const id = crypto.randomUUID()
  await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-food-3', domain: 'food_logs', date: '2026-01-13',
    payload: { id, mealTypeId, foodItemId, quantityMultiplier: 1 },
  }])
  await pool.query(`UPDATE food_logs SET updated_at = '2020-01-01' WHERE id = $1`, [id])

  const edit = await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-food-4', domain: 'food_logs', date: '2026-01-13',
    payload: { id, mealTypeId, foodItemId, quantityMultiplier: 2 },
  }])
  expect(edit.processed).toBe(1)
  let row = await pool.query(`SELECT quantity_multiplier, updated_at FROM food_logs WHERE id = $1`, [id])
  expect(Number(row.rows[0].quantity_multiplier)).toBe(2)
  expect(new Date(row.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

  await pool.query(`UPDATE food_logs SET updated_at = '2020-01-01' WHERE id = $1`, [id])
  const del = await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-food-5', domain: 'food_logs', date: '2026-01-13',
    payload: { id, deleted: true },
  }])
  expect(del.processed).toBe(1)
  row = await pool.query(`SELECT deleted_at, updated_at FROM food_logs WHERE id = $1`, [id])
  expect(row.rows[0].deleted_at).not.toBeNull()
  expect(new Date(row.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

  await pool.query(`DELETE FROM food_logs WHERE id = $1`, [id])
})
```

- [ ] **Step 2: Run — FAIL** (push qm-edit conflict-update sets only `quantity_multiplier`; push
  delete sets only `deleted_at`).

- [ ] **Step 3: Upgrade the slice functions** (`lib/data/postgres/slices/nutrition.ts`):

```ts
export async function createFoodLog(
  db: Db,
  userId: string,
  data: Pick<FoodLog, 'date' | 'mealTypeId' | 'foodItemId' | 'quantityMultiplier'> & { id?: string; loggedAt?: Date },
): Promise<FoodLog> {
  const { id, loggedAt, ...rest } = data
  // Optional client id: offline-created logs keep their local UUID so an outbox
  // replay updates in place (idempotent) instead of duplicating the row.
  const [r] = await db.insert(s.foodLogs)
    .values({ ...(id ? { id } : {}), ...(loggedAt ? { loggedAt } : {}), userId, ...rest })
    .onConflictDoUpdate({
      target: s.foodLogs.id,
      set: { quantityMultiplier: rest.quantityMultiplier, updatedAt: new Date() },
      setWhere: eq(s.foodLogs.userId, userId),
    })
    .returning()
  return rowToFoodLog(r)
}

export async function updateFoodLog(db: Db, id: string, userId: string, quantityMultiplier: number): Promise<FoodLog> {
  const [r] = await db.update(s.foodLogs)
    // updated_at bump: getSyncDelta cursors on it — without this, a web qm edit
    // never reaches other devices.
    .set({ quantityMultiplier, updatedAt: new Date() })
    .where(and(eq(s.foodLogs.id, id), eq(s.foodLogs.userId, userId)))
    .returning()
  if (!r) throw new Error('Food log not found')
  return rowToFoodLog(r)
}
```

Update the adapter wrapper (adapter.ts:2533) and the `repository.ts` interface signature to the
same `& { id?: string; loggedAt?: Date }` shape.

- [ ] **Step 4: Replace the push branch** (adapter.ts:2968-3008) with:

```ts
        } else if (mut.domain === 'food_logs') {
          const p = clean as Record<string, unknown>
          if (p.deleted) {
            await this.deleteFoodLog(String(p.id), userId)
          } else {
            // Matches the web route's `quantityMultiplier must be between 0.01 and 100`
            // check — without it a corrupted local payload could push an out-of-range
            // value straight past the push path.
            const qm = p.quantityMultiplier ?? 1.0
            if (typeof qm !== 'number' || qm < 0.01 || qm > 100) {
              errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'quantityMultiplier must be between 0.01 and 100' })
              continue
            }
            if (!(await this.foodLogRefsValid(userId, String(p.mealTypeId), String(p.foodItemId)))) {
              errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'FK ownership check failed' })
              continue
            }
            await this.createFoodLog(userId, {
              id:                 String(p.id),
              date:               mut.date,
              mealTypeId:         String(p.mealTypeId),
              foodItemId:         String(p.foodItemId),
              quantityMultiplier: qm,
              loggedAt:           p.loggedAt ? new Date(String(p.loggedAt)) : undefined,
            })
          }
          processed++
        }
```

(`loggedAt: undefined` → the column's `defaultNow()` fires, same effect as the old explicit
`new Date()` fallback. The raw-SQL ownership check is replaced by the same `foodLogRefsValid` the
web route uses.)

- [ ] **Step 5: Run the parity suite — all pass** (including the two pre-existing food_logs tests). **Commit**

```bash
git add lib/data/postgres/slices/nutrition.ts lib/data/postgres/adapter.ts lib/data/repository.ts lib/data/postgres/__tests__/push-mutations-web-parity.test.ts
git commit -m "refactor: food_logs push path delegates to createFoodLog/deleteFoodLog

createFoodLog gains optional client id + loggedAt (idempotent offline replay);
updateFoodLog and the replay conflict-update now bump updated_at so qm edits
and deletes propagate through getSyncDelta. Push FK check now uses the same
foodLogRefsValid as the web route."
```

### Task 3.2: `saveActivityLog` gains `{id, overwrite}`; push branch delegates — fixes the caloriesBurned data loss

**Files:**
- Modify: `lib/data/postgres/adapter.ts:1651-1685` (`saveActivityLog`), `lib/data/repository.ts:238` (signature), `adapter.ts:3071-3134` (push branch)
- Test: `lib/data/postgres/__tests__/push-mutations-web-parity.test.ts`

Semantics decision (documented, not accidental): the function keeps **both** conflict behaviors,
explicitly parameterized —
- default (web route `app/api/activity-logs/route.ts:65`, Health Connect ingest
  `app/api/sync-health/route.ts:60`): `onConflictDoNothing` + re-select. First-write-wins protects
  manually-edited rows from being clobbered by an external re-ingest.
- `overwrite: true` (push replay only): the dual-conflict-target upsert. Last-write-wins is
  correct there — it's the user's own explicit save being replayed from the outbox.

- [ ] **Step 1: Write the failing parity test**

```ts
it('activity_logs: push preserves caloriesBurned (regression: inline branch dropped it)', async () => {
  const id = crypto.randomUUID()
  const result = await repo.pushMutations(TEST_USER_ID, [{
    id: 'mut-act-1', domain: 'activity_logs', date: '2026-01-14',
    payload: { id, activityType: 'run', title: 'Parity Run', startTime: '06:30', durationMin: 30, caloriesBurned: 320 },
  }])
  expect(result.processed).toBe(1)
  const row = await pool.query(`SELECT calories_burned FROM activity_logs WHERE id = $1`, [id])
  expect(Number(row.rows[0].calories_burned)).toBe(320)
  await pool.query(`DELETE FROM activity_logs WHERE id = $1`, [id])
})
```

- [ ] **Step 2: Run — FAIL** (`calories_burned` is NULL: the inline values/updateSet omit it).

- [ ] **Step 3: Extend `saveActivityLog`** (adapter.ts:1651). Signature in `repository.ts:238`:

```ts
  saveActivityLog(userId: string, log: Omit<ActivityLog, 'id' | 'userId' | 'createdAt'> & { id?: string }, opts?: { overwrite?: boolean }): Promise<ActivityLog>
```

Implementation:

```ts
  async saveActivityLog(userId: string, log: Omit<ActivityLog, 'id' | 'userId' | 'createdAt'> & { id?: string }, opts?: { overwrite?: boolean }): Promise<ActivityLog> {
    const { id, ...data } = log
    const values = {
      ...(id ? { id } : {}),
      userId, date: data.date, activityType: data.activityType, title: data.title,
      startTime: data.startTime ?? null, endTime: data.endTime ?? null,
      durationMin: data.durationMin ?? null, distanceKm: data.distanceKm ?? null,
      caloriesBurned: data.caloriesBurned ?? null,
      avgHr: data.avgHr ?? null, maxHr: data.maxHr ?? null,
      steps: data.steps ?? null,
      notes: data.notes ?? null,
      routePolyline: data.routePolyline ?? null,
      splits: data.splits ?? null,
      bestEfforts: data.bestEfforts ?? null,
      paceSeries: data.paceSeries ?? null,
      avgPaceSecPerKm: data.avgPaceSecPerKm ?? null,
      elevationGainM: data.elevationGainM ?? null,
      elevationLossM: data.elevationLossM ?? null,
    }

    if (opts?.overwrite) {
      // Outbox replay: the user's own explicit save wins (last-write-wins), and the
      // updated_at bump makes the merge visible to getSyncDelta. activity_logs has two
      // unique constraints — the PK on `id` and a partial index on
      // (user_id, date, start_time) WHERE start_time IS NOT NULL. If another source
      // (Health Connect / Oura) already logged an activity at this minute, an id-only
      // conflict target throws a duplicate-key error, which strands the mutation in
      // the client outbox forever. When start_time is present, target the
      // natural-identity index so a same-minute collision merges instead of failing.
      const set = {
        title: values.title,
        startTime: values.startTime, endTime: values.endTime,
        durationMin: values.durationMin, distanceKm: values.distanceKm,
        caloriesBurned: values.caloriesBurned,
        avgHr: values.avgHr, maxHr: values.maxHr,
        steps: values.steps,
        notes: values.notes,
        routePolyline: values.routePolyline,
        splits: values.splits,
        bestEfforts: values.bestEfforts,
        paceSeries: values.paceSeries,
        avgPaceSecPerKm: values.avgPaceSecPerKm,
        elevationGainM: values.elevationGainM,
        elevationLossM: values.elevationLossM,
        updatedAt: new Date(),
      }
      const [r] = data.startTime
        ? await this.db.insert(s.activityLogs).values(values).onConflictDoUpdate({
            target: [s.activityLogs.userId, s.activityLogs.date, s.activityLogs.startTime],
            targetWhere: isNotNull(s.activityLogs.startTime),
            set,
          }).returning()
        : await this.db.insert(s.activityLogs).values(values).onConflictDoUpdate({
            target: s.activityLogs.id,
            set,
            setWhere: eq(s.activityLogs.userId, userId),
          }).returning()
      return this.rowToActivityLog(r)
    }

    // Default (web create, Health Connect ingest): first-write-wins — an external
    // re-ingest must not clobber a row the user may have edited.
    const [r] = await this.db.insert(s.activityLogs)
      .values(values)
      .onConflictDoNothing()
      .returning()

    if (!r) {
      const [existing] = await this.db.select().from(s.activityLogs)
        .where(and(
          eq(s.activityLogs.userId, userId),
          eq(s.activityLogs.date, data.date),
          data.startTime
            ? eq(s.activityLogs.startTime, data.startTime)
            : isNull(s.activityLogs.startTime),
        ))
        .limit(1)
      return this.rowToActivityLog(existing)
    }
    return this.rowToActivityLog(r)
  }
```

(The `set` invariant: every mutable column — including `caloriesBurned`, the one the old inline
`updateSet` dropped — plus the `updatedAt` bump, and never `id`/`userId`/`date`/`activityType`.)

- [ ] **Step 4: Replace the push branch** (adapter.ts:3071-3134) with:

```ts
        } else if (mut.domain === 'activity_logs') {
          const p = clean as Record<string, unknown>
          await this.saveActivityLog(userId, {
            id:           String(p.id),
            date:         mut.date,
            activityType: String(p.activityType),
            title:        String(p.title),
            startTime:    typeof p.startTime === 'string' ? p.startTime : undefined,
            endTime:      typeof p.endTime === 'string' ? p.endTime : undefined,
            durationMin:  typeof p.durationMin === 'number' ? p.durationMin : undefined,
            distanceKm:   typeof p.distanceKm === 'number' ? p.distanceKm : undefined,
            caloriesBurned: typeof p.caloriesBurned === 'number' ? p.caloriesBurned : undefined,
            steps:        typeof p.steps === 'number' ? p.steps : undefined,
            avgHr:        typeof p.avgHr === 'number' ? p.avgHr : undefined,
            maxHr:        typeof p.maxHr === 'number' ? p.maxHr : undefined,
            notes:        typeof p.notes === 'string' ? p.notes : undefined,
            routePolyline:   typeof p.routePolyline === 'string' ? p.routePolyline : undefined,
            splits:          Array.isArray(p.splits) ? p.splits as { km: number; paceSec: number }[] : undefined,
            bestEfforts:     p.bestEfforts && typeof p.bestEfforts === 'object' ? p.bestEfforts as Record<string, number> : undefined,
            paceSeries:      Array.isArray(p.paceSeries) ? p.paceSeries as { tSec: number; paceSec: number }[] : undefined,
            avgPaceSecPerKm: typeof p.avgPaceSecPerKm === 'number' ? p.avgPaceSecPerKm : undefined,
            elevationGainM:  typeof p.elevationGainM === 'number' ? p.elevationGainM : undefined,
            elevationLossM:  typeof p.elevationLossM === 'number' ? p.elevationLossM : undefined,
          }, { overwrite: true })
          processed++
        }
```

- [ ] **Step 5: Run the parity suite — all pass. Also re-run `pnpm vitest run` in full** (the
  sync-health route and activity-logs route call `saveActivityLog` with the old 2-arg shape —
  additive-optional params, so no call-site changes; typecheck confirms). **Commit**

```bash
git add lib/data/postgres/adapter.ts lib/data/repository.ts lib/data/postgres/__tests__/push-mutations-web-parity.test.ts
git commit -m "fix: offline activity saves no longer drop caloriesBurned; one write fn for activity_logs

The inline pushMutations branch omitted caloriesBurned from both its insert
values and conflict-update set, silently losing calories on every offline
activity save. saveActivityLog now owns both conflict behaviors explicitly:
default first-write-wins (web create, Health Connect re-ingest) and
overwrite:true last-write-wins (outbox replay), with an updated_at bump."
```

### Task 3.3: CI custom rule — `pushMutations` may not touch the DB directly

**Files:**
- Create: `scripts/check-push-mutations.js`
- Modify: `.github/workflows/ci.yml` (custom-rules job, after the `node scripts/check-reconcile.js` step)
- Modify: `CLAUDE.md` (one sentence in the Canonical Runtime section)

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// CI custom rule (CLAUDE.md "Canonical Runtime" / "Offline Sync"): the
// pushMutations method in lib/data/postgres/adapter.ts must delegate every
// domain write to the same shared repo function its web route uses — no inline
// this.db.* calls or raw sql`` templates. Inline writes are how the two paths
// drift (incidents #47, #74, #82, and the caloriesBurned data loss fixed
// 2026-07). Payload parsing/validation in the branch is fine; touching the DB
// is not.
// Limitation: brace-matching is textual (a "}" inside a string literal inside
// pushMutations would confuse it) — acceptable for this one known method body.
const fs = require('fs')

const FILE = 'lib/data/postgres/adapter.ts'
const src = fs.readFileSync(FILE, 'utf8')

const start = src.indexOf('async pushMutations(')
if (start === -1) {
  console.error(`check-push-mutations: could not find pushMutations in ${FILE}`)
  process.exit(1)
}

let depth = 0
let end = -1
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') {
    depth--
    if (depth === 0) { end = i; break }
  }
}
if (end === -1) {
  console.error('check-push-mutations: could not brace-match the pushMutations body')
  process.exit(1)
}

const body = src.slice(start, end)
const startLine = src.slice(0, start).split('\n').length
const violations = []
body.split('\n').forEach((line, idx) => {
  if (/this\.db\./.test(line) || /(^|[^\w`])sql`/.test(line)) {
    violations.push(`${FILE}:${startLine + idx}: ${line.trim()}`)
  }
})

if (violations.length) {
  console.error('pushMutations must not touch this.db / raw sql directly — call the shared repo function the web route uses (CLAUDE.md: Canonical Runtime / Offline Sync):')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('check-push-mutations: OK')
```

- [ ] **Step 2: Run it locally — passes** (chunks 2–3 removed every inline write):
  `node scripts/check-push-mutations.js` → `check-push-mutations: OK`.
  Sanity-check it catches violations: temporarily add `// this.db.test` inside the method → it
  must flag the line (comments are caught too — that's fine, don't write that comment) — then
  revert.

- [ ] **Step 3: Wire into CI** — in `.github/workflows/ci.yml`'s `custom-rules` job, after the
  `Local SQLite reconcile completeness` step:

```yaml
      - name: pushMutations delegates to shared repo functions
        run: node scripts/check-push-mutations.js
```

- [ ] **Step 4: Note the enforcement in CLAUDE.md** — in the Canonical Runtime section's "One
  write function per domain" bullet, append:

```markdown
  CI enforces this: `scripts/check-push-mutations.js` fails the Custom Rules check if
  `pushMutations` touches `this.db` or raw `sql` directly.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/check-push-mutations.js .github/workflows/ci.yml CLAUDE.md
git commit -m "ci: enforce one-write-path-per-domain in pushMutations

Now that every domain branch delegates to its shared repo function, lock it
in: the custom-rules job fails if pushMutations grows a direct this.db call
or raw sql template again."
```

### Task 3.4: Chunk 3 wrap-up

- [ ] Full gate: `pnpm lint && pnpm tsc --noEmit && pnpm vitest run`, parity suite with
  `DATABASE_URL`, `node scripts/check-push-mutations.js`.
- [ ] `pnpm dev` smoke: log a food item and an activity (with calories) via the UI; edit a food
  log quantity; delete both. Confirm no regressions on the web routes.
- [ ] Patch version bump + `lib/changelog.ts` entry (offline activity-calories data loss is a
  user-visible fix).
- [ ] Push, open PR; same "not exercised: client outbox wiring (device-only)" note as chunk 2.

---

## Chunk 4 — Thin the two divergent web read fallbacks

### Task 4.1: `health-score-detail.tsx` uses `scoreBand()` for the device-seed label

**Files:**
- Modify: `components/health/health-score-detail.tsx:124`

- [ ] **Step 1: Replace the inline thresholds**

Line 124 currently:

```ts
          label: (score ?? 0) >= 70 ? 'High' : (score ?? 0) >= 50 ? 'Moderate' : 'Low',
```

becomes:

```ts
          label: scoreBand(score ?? 0).label,
```

with `import { scoreBand } from '@/lib/health/score-band'` added if not already imported (check
the file's imports first — `lib/health/score-band.ts` is the single source of truth for exactly
these thresholds; this inline copy is the drift the file's own header comment warns about).

### Task 4.2: `end-of-day-review.tsx` passes `phase=evening` explicitly

**Files:**
- Modify: `components/nutrition/end-of-day/end-of-day-review.tsx:88`

- [ ] **Step 1: Make the web fallback explicit**

```ts
        : await fetch('/api/day-checkin?date=' + date + '&phase=evening').then(r => (r.ok ? r.json() : null)).catch(() => null)
```

(The device branch reads `store.getDayCheckin(date, 'evening')`; the web branch only matched it
via the server's phase default — every other check-in read passes phase explicitly.)

### Task 4.3: Chunk 4 wrap-up

- [ ] `pnpm lint && pnpm tsc --noEmit && pnpm vitest run`.
- [ ] `pnpm dev` smoke: open Health → readiness detail (web fallback path renders, label matches
  band), open the End of Day review with a saved evening check-in (values pre-fill).
- [ ] Patch bump + changelog only if folded into another user-visible PR; standalone this is a
  no-visible-change hardening pair — bug-fix-class PR, no merge-confirmation gate needed.
- [ ] Push, open PR.

---

## Explicitly out of scope (per the approach doc — do not do these)

- Deleting `app/manifest.ts`, the service worker, or the install affordance.
- Bundling the shell into the APK / dropping `capacitor.config.ts` `server.url`.
- Migrating push to native FCM.
- The WS5 endgame (wasm SQLite on web so `isSQLiteAvailable()` is true everywhere) — recorded in
  `docs/implementation-backlog.md`'s "Not yet queued" section as a successor project.
- Converging the three deferred read-fallback divergences (strength-trend, exercise-history,
  calsBurnedToday) — fix-on-touch; tracked as Known-Issues rows in `projectOverview.md`.

## Self-review checklist (for the implementer, per chunk)

- Diff the changed push branch against its web route one last time — same defaults, same
  validation, same conflict semantics (modulo the documented `overwrite` split for activity_logs).
- Grep for other callers of every function whose signature changed
  (`createSupplement|createInjury|updateInjury|createFoodLog|updateFoodLog|saveActivityLog`) —
  all current call sites are listed in this plan's audit table; new ones may have appeared since.
- Confirm `getSyncDelta` for each touched domain still cursors on `updated_at` and emits
  tombstones (`deleted_at`) — this plan's `updatedAt` fixes assume that contract holds.
- Per CLAUDE.md, state in each PR which failure surfaces were NOT exercised (native SQLite outbox
  wiring; the parity suite covers the server half only).
