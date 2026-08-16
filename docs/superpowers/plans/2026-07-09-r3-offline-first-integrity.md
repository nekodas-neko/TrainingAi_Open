# R3 — Offline-First Integrity

**Source review:** `docs/reviews/2026-07-06-full-app-overview-review.md` §3 (batch R3),
re-verified against current `main` on 2026-07-09 (review was 3 days old; every finding
below was re-opened at its cited `file:line`, confirmed still-present, and line numbers
updated — **nothing in §3 has been fixed since the review**). **Branch:**
`fix/offline-first-integrity`. This batch mixes **one Postgres migration** (`117` — see
below) with server (`adapter.ts`), shared-lib (`lib/local-store/`, `lib/sqlite/`,
`lib/nutrition/`) and client (`components/`, `app/`) JS. **Migration number:** on-disk max
is `115`; open plan `2026-07-08-oura-ble-phase-5-own-scores.md` pre-allocates `116`
(`oura_daily_summary`), so this batch claims **`117`** (`117_workout_soft_delete.sql`).

**Most fixes ship via Railway into the WebView with no APK rebuild** (the migration,
`getSyncDelta`, `pushMutations` parity, the counter reconciles). **But the failure
surfaces for Chunks 1–4 are almost all APK-only** — native SQLite (`lib/local-store/`,
`lib/sqlite/`) does not run in the web/dev sandbox (`getLocalStore` returns `null` there),
so web `pnpm dev` cannot reproduce resurrection, pull-clobber, silent no-op writes, or
local-first read gaps. Every task below is tagged **[server/web — dev-DB verifiable]** or
**[APK-only — on-device verify]**; the APK-only ones must run `docs/device-smoke-checklist.md`
or get a Known-Issues "NOT verified on device" row per the Canonical Runtime policy.

**Goal:** stop the recurring offline-first data-loss/resurrection class — deleted workouts
that never die on-device, offline saves that vanish on remount, offline food logging that
throws, pull-clobbered pending edits, silent no-op writes, drifted push/route parity, and
inflatable stored counters — by closing the sync chain (tombstones + local-first reads +
outbox coverage) and reconciling every stored counter on read.

---

**Chunk 1 shipped (v1.124.7, 2026-07-10, session 254).** Tasks 1.1–1.4 all landed — see the
`docs/implementation-backlog.md` item 10 entry for the full summary. Chunks 2–6 are not started;
this doc's task breakdown below still applies to them unchanged.

## Chunk 1 — User-visible data-loss / resurrection (highs)

Governing rules: CLAUDE.md **Offline Sync** ("A server hard DELETE is invisible to devices
that haven't synced — any domain with delete UI needs a `deleted_at` tombstone emitted by
`getSyncDelta`"; "Any local write to an already-synced row must flip
`sync_status='pending'`"), **Offline-First — the on-device local store is the source of
truth** ("if a domain WRITES to the local store, its UI MUST READ from the local store").

### Task 1.1 — SYNC-C1: workout deletes must tombstone, not hard-delete [APK-only failure; migration + server ship via Railway]

**Confirmed still-present.** `lib/workout/delete-session.ts:12-72` hard-DELETEs the session
(comment `:8-10` explicitly defers tombstones: "Cross-device delete propagation is
intentionally out of scope — workout_sessions has no deleted_at tombstone today"); children
cascade via FK. `DELETE /api/workout-entry` is the same class. The delete UI runs on the S25
(`app/health/health-content.tsx:578-597`, `app/stats/stats-content.tsx:135-151`) and never
touches the local store, and `getSyncDelta` (`adapter.ts:2717-2719`) can never emit a
tombstone for a row that no longer exists → deleted sessions **persist in local SQLite
forever** and keep rendering in local-first readers (`store.getWorkoutHistory`,
`health-content.tsx`, `exercise-history-sheet.tsx`). Migration `111_soft_delete_synced_domains.sql`
added `deleted_at` to food_logs/activity_logs/supplements/supplement_logs/injuries **but
deliberately excluded workout_sessions/exercise_logs/set_logs** — this task extends that
exact pattern.

The **local** side is already wired: `RECONCILE_COLUMNS` (`lib/sqlite/migrations.ts:88-93`)
already has `deleted_at`/`sync_status` on all three workout tables, and `applyDelta`
(`sqlite-backend.ts:717-738`) already has the `if (r.deletedAt) DELETE ... WHERE sync_status='synced'`
branch. The only missing pieces are server-side.

1. **Migration `117_workout_soft_delete.sql`** [server]:
```sql
-- Extend the 111 soft-delete pattern to the workout tables it excluded, so
-- getSyncDelta can emit tombstones and cross-device workout deletes propagate.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE exercise_logs    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE set_logs         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
```
Add matching `deletedAt: timestamp('deleted_at', { withTimezone: true })` to the three
`pgTable` defs in `schema.ts` (`workoutSessions:144`, `exerciseLogs:163`, `setLogs:181`).

2. **`deleteWorkoutSession` (`delete-session.ts:47-50`) soft-deletes** instead of
`DELETE FROM workout_sessions`:
```ts
const now = new Date().toISOString()
await client.query(
  `UPDATE workout_sessions SET deleted_at = $3, updated_at = $3 WHERE id = $1 AND user_id = $2`,
  [workoutSessionId, userId, now],
)
await client.query(
  `UPDATE exercise_logs SET deleted_at = $2, updated_at = $2 WHERE workout_session_id = $1`,
  [workoutSessionId, now],
)
await client.query(
  `UPDATE set_logs SET deleted_at = $2 WHERE exercise_log_id IN
     (SELECT id FROM exercise_logs WHERE workout_session_id = $1)`,
  [workoutSessionId, now],
)
```
Keep the ownership pre-check (`:20-27`) and the `sessions_in_phase` decrement (`:55-62`).
Do the same in the `DELETE /api/workout-entry` handler (single-exercise delete → tombstone
that exercise_log + its set_logs, bump the session's `updated_at` so the delta re-emits it).
**Read-site filter:** every SELECT that renders workout history must now add
`AND deleted_at IS NULL` (grep `from(s.workoutSessions)` / `exercise_logs` / `set_logs` in
`adapter.ts` and the recap/day-log/workout-load routes; mirror the existing
`isNull(s.activityLogs.deletedAt)` guards at `adapter.ts:951,1906`). This is the load-bearing
half — a tombstoned row that still passes the render query re-introduces the bug on the
server side.

3. **`getSyncDelta` emits the tombstone** — the workoutSessions/exerciseLogs/setLogs selects
(`adapter.ts:2717-2760`) use `select()`/explicit column maps; add `deletedAt` to each column
map (or confirm `select()` now carries it) so `LocalWorkoutSession.deletedAt` /
`LocalExerciseLog.deletedAt` / `LocalSetLog.deletedAt` populate. Add `deletedAt` to those
three types in `lib/local-store/types.ts` if absent, and to the `applyDelta` upsert column
lists (`sqlite-backend.ts:717-`, exercise_logs + set_logs branches) so a tombstoned child is
soft-deleted locally (pairs with Task 4.5 / SYNC-C6 cascade).

**Verify:** [dev-DB] apply migration to local dev DB, delete a seeded session via
`DELETE /api/workout-entry`, confirm the row survives with `deleted_at` set and
`GET /api/day-log`/recap no longer return it; unit-test `getSyncDelta` emits a
`deletedAt`-bearing workoutSession after a delete. [APK-only] on-device: log a workout,
sync, delete it from Stats/Health, force a pull on a second app-open → the session is gone
from local history and does not resurrect after the next sync. Run
`docs/device-smoke-checklist.md`.

### Task 1.2 — SYNC-R4: history edit/delete must mirror into the local store [APK-only]

**Confirmed still-present.** `app/stats/stats-content.tsx:117-151` (`handleEditSave`,
`handleDelete`) and `app/health/health-content.tsx:537-620` PATCH/DELETE `/api/workout-entry`
**server-only** — no local-store mutation. Local rows stay `sync_status='synced'` and keep
rendering the pre-edit / pre-delete values until a pull happens (and pre-Task-1.1, a delete
never propagated at all). Even with Task 1.1's server tombstone, the *edit* path still leaves
a stale local row until the next pull.

Mirror each mutation into the local store at the call site (guard `getLocalStore(userId)`,
web falls through to the current server-only path unchanged):
- **Delete:** after a successful DELETE (or optimistically, before), call a local soft-delete
  that flips `deleted_at`/`sync_status` on the exercise_log + its set_logs (add
  `store.deleteExerciseLogLocally(exerciseLogId)` to the `LocalStore` interface mirroring the
  `deleteFoodLog` shape). The outbox already carries the workout delete via the server route;
  this is purely the local render fix.
- **Edit:** after a successful PATCH, upsert the edited set_logs locally with
  `sync_status='pending'` (per the rule "Any local write to an already-synced row must flip
  `sync_status='pending'`") so the pull-clobber gate protects it.

**Verify:** [APK-only] on-device edit a past set → the Stats/Health list reflects it
immediately and survives an app restart before sync; delete a past exercise → it vanishes
locally and doesn't resurrect. Note activity_logs already has tombstones (migration 111) so
that domain's delete half self-heals on pull — workouts are the gap.

### Task 1.3 — SYNC-R1: Home metric tiles must seed from the local store [APK-only]

**Confirmed still-present.** `app/session-select/session-select-content.tsx` `fetchMeta`
(`:374-387`) reads **only** `cachedFetch('body-metadata', '/api/body-metadata', TTL_MEDIUM)`
while the same file writes body_metrics locally (the quick-log path, `~:762-787`). An unsynced
offline body-metric save vanishes from Home on remount. The correct pattern is already in
`app/health/health-content.tsx:272-311` (read `getLocalStore(userId).getBodyMetrics(cutoff)`
first, set state, then revalidate from the network).

Add the local fast-path to `session-select-content.tsx` `fetchMeta`, before the `cachedFetch`
call, copying `health-content.tsx:272-311`:
```ts
if (userId) {
  const store = getLocalStore(userId)
  if (store) {
    const cutoffStr = toAestDay(new Date(todayMidnightUtc().getTime() - 30 * 864e5))
    const local = await store.getBodyMetrics(cutoffStr)
    const todayStr = todayInTz(/* session tz */)
    const rows = local.filter(m => !m.deletedAt)
    if (rows.length > 0) {
      setMetaRecent(rows.map(/* → BodyMetaRow, as health-content does */))
      const todayRow = rows.find(m => m.date === todayStr)
      if (todayRow) setMetaToday(/* → BodyMetaRow */)   // avoid SYNC-R2's gap here too
      setMetaLoading(false)
    }
  }
}
```
Keep the `isBodyMetadataFresh` guard on the network `onData` path (`:378`). Do **not** add
band/threshold logic — this is a pure read seed (Canonical Runtime: the local read is
local-first source-of-truth, the network path revalidates).

**Verify:** [APK-only] on-device, go offline, quick-log steps/weight from Home, navigate away
and back → the tile still shows the value; restart the app → still there. [dev-DB] web
`pnpm dev` still renders (store is null → falls through to the network path unchanged).

### Task 1.4 — SYNC-O2: offline food-item creation must not gate on the network [APK-only]

**Confirmed still-present.** `lib/nutrition/log-food.ts:78-100` (`createFoodItem`) is an
unconditional awaited `fetch('/api/nutrition/food-items')` at `:163-166`
(`foodItemId: entry.foodItemId ?? (await createFoodItem(entry))`) that runs **before** the
`if (store)` local branch (`:172-206`). Offline, logging any new/scanned/custom food throws
at `:97` (`if (!res.ok) throw`) and nothing lands locally — total loss of the log. (The local
branch *does* already `upsertFoodItem` + carry item fields once the id resolves, so the only
fix is minting the id offline.)

Mint the food-item id client-side and stop awaiting the POST on the local path:
```ts
const resolved = entries.map(entry => ({
  entry,
  foodItemId: entry.foodItemId ?? crypto.randomUUID(),
  isNew: !entry.foodItemId,
}))
```
On the local branch (`:172`), the existing `store.upsertFoodItem(...)` already writes the
item locally; add a `food_items` outbox mutation for each `isNew` item **before** its
`food_logs` mutation (so the server creates the item on push), carrying every field
`createFoodItem`'s POST body sends (`name, brand, servingSizeG, calories, proteinG, carbsG,
fatG, fiberG, sugarG, sodiumMg, satFatG, source`). Add the `food_items` domain to
`pushMutations` (`adapter.ts`) calling the shared `createFoodItem` repo function with the
client-supplied id (ON CONFLICT DO NOTHING on id — a re-push is idempotent), and to
`applyDelta`'s pull mapping already handles food_items. Keep the web fallback (`:208-234`)
resolving ids via the POST as today (dev-DB only).

Per CLAUDE.md **One write function per domain** + **The outbox payload must carry every field
the web route accepts**: the new push branch must delegate to the same `createFoodItem` repo
fn the web route uses, not raw SQL (CI `check-push-mutations.js` enforces this).

**Verify:** [APK-only] on-device airplane mode, scan/add a brand-new food → it logs, appears
in the day list, survives restart; re-connect → the item + log push and dedup (no duplicate
food_item). [dev-DB] web path unchanged. This is NUT-8's SYNC half — cross-ref NUT batch for
the `barcode: null` (NUT-4) and quick-edit (NUT-1) fixes; do not double-plan those here.

---

## Chunk 2 — Local-first read sweep (mediums)

Governing rule: CLAUDE.md **Offline-First** ("Every UI read site reads local-first
(`store.getX`), API only as fallback/hydration"). The web fallback stays a logic-free
pass-through (Canonical Runtime).

### Task 2.1 — SYNC-R2: health `fetchMeta` local path never sets today's tile [APK-only]

**Confirmed still-present.** `app/health/health-content.tsx:272-311` local fast-path fills
`setMetaRecent` (`:307`) but never `setMetaToday` — only the network branch (`:318`) sets
today. On a fresh offline mount today's tiles are server-only (blank until sync). Fix: within
the local block, find the row where `m.date === todayInTz(tz)` and `setMetaToday(row)` (Task
1.3 does the same for Home; keep the two consistent). Do not gate on network freshness for the
local seed.

**Verify:** [APK-only] offline fresh app-open on Health → today's steps/weight tiles show the
locally-saved value, not blank.

### Task 2.2 — SYNC-R3: home-day-timeline renders today from server aggregate only [APK-only or documented exception]

**Confirmed still-present.** `components/home-day-timeline.tsx:209-216` renders today's
timeline (workouts, food, mood, activity, supplements — all locally-written domains) from
`cachedFetchToday('home-day-timeline', '/api/day-timeline')` only. It is **not** on the
sanctioned server-only exceptions list (CLAUDE.md: `weekly-stats`, `weekly-muscle-sets`,
`weights-summary`, `muscle-recovery` — all cross-session aggregates). Two options, pick one:
- **(preferred)** Assemble today's timeline local-first: read the local stores for the
  displayed day (workouts, food logs, mood, activity, supplements) and merge into
  `TimelineEvent[]`, revalidating from `/api/day-timeline` in the background. This is more
  work (a client-side timeline assembler) — scope it as its own task.
- **(fallback, if the assembler is too large for this batch)** Document it as a sanctioned
  exception in the CLAUDE.md Offline-First read-site status list with a one-line rationale
  ("day-timeline is a cross-domain server aggregate; local-first assembly deferred"), and add
  a `projectOverview.md` Known-Issues row. A documented finding without a queue entry is a
  dropped finding (Process rule) — do **not** leave it silently server-only.

**Verify:** [APK-only] offline, log food/mood → the Home timeline shows it. If taking the
fallback, confirm the CLAUDE.md list + Known-Issues row land in this PR.

### Task 2.3 — SYNC-O5: overview-screen body-metric save is server-only [APK-only]

**Confirmed still-present.** `components/overview-screen.tsx:205-225` (`handleSaveLog`) POSTs
`/api/body-metadata` server-only while three sibling surfaces (session-select quick-log,
metric-log-sheet, health) write local-first. Route the write through the same local-first
path those siblings use: `getLocalStore(userId)?.upsertBodyMetric(...)` +
`queueMutation({ domain: 'body_metrics', ... })` + synchronous toast/`fetchMeta`, web
fallback to the current POST. Use the read-merge upsert (copy `upsertBodyMetric`'s
null-means-keep pattern — a single-field save must not wipe the row's other columns, per the
**Local upserts overwrite all columns by default** rule).

**Verify:** [APK-only] offline single-metric save from the overview/goals screen persists and
survives restart. [dev-DB] web still saves via POST.

### Task 2.4 — SYNC-R5: day-detail overlays use bare `fetch('/api/day-log')` [APK-only, low-med]

**Confirmed still-present.** `app/stats/stats-content.tsx:95-115` (`handleDayClick`,
`refreshDayOverlay`) and `app/health/health-content.tsx:532` use bare
`fetch('/api/day-log?date=...')` — no `cachedFetch` seed, no local-first. For a past day the
server aggregate is acceptable (historical, largely immutable), but **today's** overlay should
seed from the local stores so an offline edit is reflected. Minimum: convert to
`cachedFetch`/`readCacheSync` on a `day-log:<date>` key (reuse the existing key — grep first)
so repeat opens paint instantly; ideally seed today's overlay from local stores. Pair with
CACHE-F15 (R2 batch) which flags the same bare fetches — coordinate the key so the two batches
don't create duplicate keys.

**Verify:** [dev-DB] repeat day-overlay open paints from cache; [APK-only] today's overlay
reflects an offline edit.

---

## Chunk 3 — Outbox coverage & silent failures (mediums/lows)

Governing rules: CLAUDE.md **Offline Sync** ("Every user-visible write needs an outbox
domain — any POST reachable offline must queue a mutation or visibly fail;
`fetch('/api/…').catch(() => {})` is the smell"), **Saves feel instant** ("even web-only
fallback paths show feedback first and reconcile on error"), **Self-fetching cards need an
explicit failure state**.

### Task 3.1 — SYNC-O1: detected walk/run save is server-only [APK-only, med-high]

**Confirmed still-present.** `components/activity/exercise-review-sheet.tsx` `handleSave`
(`:88-149`) POSTs `/api/activity-logs` server-only (`:97-113`), while the sibling
`components/activity/done-activity-screen.tsx:112-162` has the full local-store + outbox path
for the same `activity_logs` domain. Copy `done-activity-screen`'s shape:
`getLocalStore(userId)?.upsertActivityLog(...)` + `queueMutation({ domain: 'activity_logs' })`
+ synchronous `removeSession`/toast, web fallback to the current POST. The activity payload
already flows through the outbox (`adapter.ts:3082-3106`); this is purely making the review
sheet use it.

**Verify:** [APK-only] offline, save a detected walk from the review sheet → it lands in
activity history and survives restart.

### Task 3.2 — SYNC-O3: Oura workout reviewed/dismissed flag is fire-and-forget [APK-only]

**Confirmed still-present.** `PATCH /api/oura/workouts` is `fetch(...).catch(() => {})` at
`exercise-review-sheet.tsx:116-120, 131-135, 154-158` and
`components/activity/exercise-detected-card.tsx:84-90`, while local state clears
(`removeSession`). Offline the "reviewed/dismissed" flag is lost and the card **resurrects
after the next Oura sync**. Give it an outbox domain (`oura_workout_reviewed`) carrying
`{ id }`, queued at each call site with the local `removeSession`; add a `pushMutations`
branch calling the same repo fn the route uses to set the reviewed flag. If a full outbox
domain is deemed too heavy for a dismiss flag, at minimum persist a local "dismissed oura ids"
set that the detection store consults so the card can't reappear before the PATCH lands — but
the outbox domain is the correct fix per the rule.

**Verify:** [APK-only] offline dismiss a detected Oura workout → it stays dismissed across an
Oura sync + restart.

### Task 3.3 — SYNC-O4: early-deload card fires onConfirm on failure [server/web — dev-DB verifiable]

**Confirmed still-present.** `components/home/early-deload-card.tsx:7-12`: no `res.ok` check,
no try/catch, no `finally` — `onConfirm()` fires unconditionally after `await fetch` (silent
false success on a real periodization write, `POST /api/confirm-early-deload`), and a network
rejection throws out of `handleConfirm` leaving `loading` stuck true (button wedged). Fix:
```ts
async function handleConfirm() {
  setLoading(true)
  try {
    const res = await fetch('/api/confirm-early-deload', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    if (!res.ok) throw new Error()
    onConfirm()
  } catch {
    toast.error('Could not start deload — try again')
  } finally {
    setLoading(false)
  }
}
```
This write is a real periodization state change; it is online-only by nature (no offline
deload confirm), so no outbox — just correct success gating + error surface + `finally`.

**Verify:** [dev-DB] with the route stubbed to 500, confirm the card shows an error and the
button re-enables, and `onConfirm` does NOT fire.

### Task 3.4 — SYNC-O6: unchecked `res.ok` / silent failures sweep [server/web — dev-DB verifiable, low]

**Confirmed still-present** at all cited sites — each does `await fetch(...)` then proceeds
(clears UI / calls a success callback) without checking `res.ok`, so a 4xx/5xx reads as
success:
- `components/home/ai-prescription-card.tsx:66-96`
- `components/home/morning-checkin-sheet.tsx:96-100`
- `components/nutrition/end-of-day/end-of-day-review.tsx:174-178`
- `components/workout/done-screen.tsx:117-121` (session-RPE fallback)
- `components/nutrition/manage-supplements-sheet.tsx:159`
- `components/nutrition/supplements-section.tsx:71-73`
- `components/nutrition/saved-meals-sheet.tsx:194-202` (`deleteMeal`)

For each: add `if (!res.ok) throw` inside a try/catch that surfaces a toast and does **not**
advance UI/state on failure; add `finally` where a loading flag is set. For the ones that are
offline-first domains (supplements — see Chunk 4 machinery), prefer routing through the local
store + outbox rather than a bare guarded POST; for the online-only ones (prescription accept,
morning check-in) a guarded POST with error surface is sufficient. Keep feedback synchronous
after the local write where a local write exists (Saves-feel-instant rule).

**Verify:** [dev-DB] stub each route to 500 and confirm an error state shows and no false
success; supplements paths verified on-device (Chunk 4).

---

## Chunk 4 — Local sync machinery (mediums/lows, APK-only)

Governing rules: CLAUDE.md **Offline Sync** ("`applyDelta` branches must gate on
`sync_status === 'synced'` before overwriting — a pull must never revert a pending local
edit"), **Local SQLite Migrations** ("Every new local table/column must be registered in
`RECONCILE_TABLES`/`RECONCILE_COLUMNS` in the same commit"). All failures here are APK-only
(native SQLite); the sandbox cannot exercise them — on-device verify or Known-Issues row.

### Task 4.1 — SYNC-C2: supplements have no local sync machinery [APK-only]

**Confirmed still-present.** The local `supplements` table
(`lib/sqlite/migrations.ts:311-320` and the versioned copy `:570-579`) has **no
`sync_status`/`deleted_at`** columns; `upsertSupplement` (`sqlite-backend.ts:1182-1199`) is an
unconditional `ON CONFLICT DO UPDATE`, and `applyDelta`'s supplements branch
(`sqlite-backend.ts:987-989`) calls it directly — a pull **reverts a pending offline
supplement edit**. (Server delete propagation is fine: `deleteSupplement`,
`adapter.ts:4109`, soft-deletes via `active=false` + `deletedAt` and the pull maps `active`.)

Fix — mirror the `injuries` table, which has the full machinery
(`migrations.ts:330-341`: `deleted_at TEXT`, `sync_status TEXT NOT NULL DEFAULT 'pending'`):
1. Add both columns to `CREATE_SUPPLEMENTS` **and** the versioned CREATE (`:570-579`), and add
   two `RECONCILE_COLUMNS` rows **in the same commit** (the migration authority after a partial
   upgrade):
```ts
{ table: 'supplements', column: 'deleted_at',  ddl: `ALTER TABLE supplements ADD COLUMN deleted_at TEXT` },
{ table: 'supplements', column: 'sync_status', ddl: `ALTER TABLE supplements ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
```
2. Gate `applyDelta`'s supplements upsert like food_logs/workout_sessions — either add a
   `WHERE supplements.sync_status='synced'` arm to `upsertSupplement`'s ON CONFLICT (add a
   variant used by the pull) or inline the gated INSERT in the `applyDelta` branch, with the
   `if (r.deletedAt) DELETE ... WHERE sync_status='synced'` tombstone arm. Local writes
   (manage-supplements sheet) flip `sync_status='pending'`.
3. `getSupplements` read (`sqlite-backend.ts` ~1160) filters `deleted_at IS NULL`; the local
   write path sets `sync_status='pending'`.

**Verify:** [APK-only] offline edit a supplement's dose → a subsequent pull does not revert
it; a server delete propagates and hides it locally.

### Task 4.2 — SYNC-C3: silent no-op writes when the local DB never opened [APK-only]

**Confirmed still-present.** `lib/sqlite/sqlite-service.ts:107-110` — `runSQL` does
`if (!_db) return;` (silent no-op) while `getLocalStore` (`index.ts:105-114`) still returns a
live store whenever `isSQLiteAvailable()` (native + plugin present) even if `initSQLite`
failed and `_db` is null. So `queueMutation` and every `store.upsertX` silently no-op; a write
whose direct POST also failed is **lost with no error**. Fix: make `runSQL` throw when `_db`
is null so the write site's try/catch takes the API fallback (which shows feedback + queues on
the server route):
```ts
export async function runSQL(sql: string, values?: unknown[]): Promise<void> {
  if (!_db) throw new Error('local DB unavailable')
  await _db.run(sql, values ?? [])
}
```
Audit call sites: the food/body/activity write paths already wrap store writes in try/catch
with an API fallback (`log-food.ts:203`), so a throw routes them correctly. `querySQL`'s
`if (!_db) return []` is fine to leave (an empty read is not data loss, and callers treat
empty as "fall back to network"). Confirm no write path treats a `runSQL` throw as fatal
without a fallback.

**Verify:** [APK-only] simulate `initSQLite` failure (temporarily), attempt an offline save →
the write surfaces an error / takes the server route instead of silently vanishing.

### Task 4.3 — SYNC-C4: `clearLocalStoreData` leaves cache + legacy outbox [APK-only]

**Confirmed still-present.** `lib/local-store/index.ts:118-146` deletes 24 tables but **not**
`api_cache` (the `lib/sqlite/cache.ts` store) nor the legacy `sync_outbox` table (the old
outbox name; it clears the current `mutations_outbox` at `:132`). On account switch on a
shared device, the previous user's cached API responses (and any orphaned legacy-outbox rows)
leak. Add:
```ts
runSQL('DELETE FROM api_cache', []),
runSQL('DROP TABLE IF EXISTS sync_outbox', []),   // legacy pre-rename outbox
```
(Use `DELETE`/`DROP IF EXISTS` guarded — the legacy table may not exist on fresh installs.)
Confirm the exact cache table name against `lib/sqlite/cache.ts` before writing the DELETE.

**Verify:** [APK-only] sign out → cached `body-metadata`/day-log responses are gone; sign in
as a second user → no first-user data flashes from cache.

### Task 4.4 — SYNC-C5: `markWorkoutSynced` re-arms the pull-clobber [APK-only]

**Confirmed still-present.** `sqlite-backend.ts:376-389` (`markWorkoutSynced`) flips the
**session** row to `sync_status='synced'` (`:378`) on every exercise confirm — but a
still-queued `complete_workout` (`completeWorkoutLocally:364-368` sets the session
`sync_status='pending'`) or `session_rpe` (`setSessionRpe`) mutation for the same session can
then be reverted by the next pull (`applyDelta` overwrites synced session rows,
`sqlite-backend.ts:734`). The function's own comment (`:371-375`) says it should scope to the
single exercise/set rows, but the session flip contradicts it. Fix: **remove the session-row
UPDATE from `markWorkoutSynced`** (leave lines `:381-388`, the exercise_log + set_logs flips);
the session flip belongs to `markSessionSynced` only, which fires when the session-completing
mutation confirms.

**Verify:** [APK-only] log an exercise (confirms, flips session), then before the
`complete_workout` mutation pushes, force a pull → the session's `completed_at`/`session_rpe`
pending state is not reverted.

### Task 4.5 — SYNC-C6: cascade tombstone to children; food_logs id-edit; food_items gate; version advance [APK-only, low]

**Confirmed still-present** (four sub-items):
- **Session tombstone doesn't cascade to local children.** `applyDelta` workoutSessions
  delete arm (`sqlite-backend.ts:721`) deletes only `workout_sessions` (SQLite FK cascade is
  not guaranteed enabled). Add explicit
  `DELETE FROM exercise_logs WHERE workout_session_id=? AND sync_status='synced'` +
  `DELETE FROM set_logs WHERE exercise_log_id IN (...)`. With Task 1.1 emitting child
  tombstones, prefer soft-deleting children on their own `deletedAt` delta rows; keep the
  cascade as belt-and-suspenders.
- **food_logs conflict arm drops `meal_type_id`/`food_item_id` edits.**
  `sqlite-backend.ts:976-979` only updates `quantity_multiplier`/`updated_at`/`deleted_at` on
  conflict — a server-side meal-type or item reassignment never lands locally. Add
  `meal_type_id=excluded.meal_type_id, food_item_id=excluded.food_item_id` to the DO UPDATE
  set (still gated on `sync_status='synced'`).
- **food_items applyDelta ungated.** `sqlite-backend.ts:963-964` → `upsertFoodItem`
  (`:1106-1124`) is an unconditional overwrite; once Task 1.4 lets a food_item be created
  locally offline, a pull could clobber a pending local item. food_items has no `sync_status`
  today; lowest-risk fix is to make the pull upsert `INSERT ... ON CONFLICT(id) DO NOTHING`
  for items already present locally (items are immutable reference rows — name/macros don't
  change server-side), or add a `sync_status` column if edits become possible. (Note: the
  review's "create-only today" wording is slightly off — the current code *does* DO UPDATE;
  the real issue is it's ungated.)
- **Local fallback reopen never advances the stored DB version.**
  `sqlite-service.ts:53-56` reopens at version `1` after a failed upgrade, so every cold open
  re-pays the failed upgrade attempt + full `reconcileSchema`. `reconcileSchema` is idempotent
  so this is a startup-cost/log-noise issue, not data loss — lowest priority. Option: after a
  successful `reconcileSchema` post-fallback, record the intended version in `sync_meta` and
  skip the upgrade attempt on next open when the schema already reconciles clean. Scope this
  as optional; if deferred, add a `projectOverview.md` note.

**Verify:** [APK-only] delete a synced multi-exercise session → its local exercise_logs/
set_logs are gone (no orphaned child rows render); a server meal-type reassignment reflects
locally after pull.

---

## Chunk 5 — Push / route parity (mediums/lows, dev-DB verifiable)

Governing rule: CLAUDE.md **Offline Sync** ("Sync-push must mirror the web route… update the
`pushMutations` branch in the same PR and diff the two paths"; "Prefer one shared repo
function per domain") and **Canonical Runtime** ("One write function per domain").

### Task 5.1 — SYNC-P1: body_metrics push lacks the web route's Zod bounds [dev-DB]

**Confirmed still-present.** The push branch (`adapter.ts:2953-2981`) mirrors only the
`measurementCm` clamp (`:2958-2959`, `validMeasurementCmOrNull`); the web route validates via
`BodyMetadataPostSchema` (`lib/validation/body-metrics.ts:26-42`: weightKg 20–500, bodyFat
1–80, calories ≤20000, protein/carb/fat ≤2000, steps ≤200000, distanceKm ≤1000). A corrupted
local payload pushes straight past. Fix by running the push payload through the shared schema
(or the shared field validators) before `upsertBodyMetrics` — the cleanest is to extract the
web route's clamp into a shared `sanitizeBodyMetrics(payload)` helper in
`lib/validation/body-metrics.ts` and call it from both the route and the push branch
(one-function-per-domain). Out-of-range fields → clamp-to-null (drop), same as the route.

**Verify:** [dev-DB] unit-test the push branch drops/clamps an out-of-range weight/steps
payload; a parity test asserts route and push produce identical stored rows for the same
input (extend the existing push-parity tests noted clean in the review).

### Task 5.2 — SYNC-P3: activity push skips bounds + endTime derivation; mints `"undefined"` [dev-DB]

**Confirmed still-present.** Activity push (`adapter.ts:3082-3106`) does `String(p.title)`
(`:3088`) → `"undefined"` when title is missing, and skips the web route's Zod bounds and
`endTime` derivation. Whitelist/validate the payload against the activity route's schema (or a
shared `sanitizeActivityLog` helper) before `saveActivityLog`; skip the mutation (leave it for
quarantine) or coerce sensibly when `title`/`activityType` are absent rather than minting
`"undefined"`.

**Verify:** [dev-DB] unit-test a title-less activity payload is rejected/skipped, not stored
as `"undefined"`; bounds match the route.

### Task 5.3 — SYNC-P4/P5: day_checkins, injuries, supplements push validation [dev-DB, low]

**Confirmed still-present.** day_checkins push skips `journal` max-length / `soreMuscles`
element validation; injuries push casts `severity` blindly (`adapter.ts:3107-3109`+);
supplements push accepts a missing name as `"undefined"` (`adapter.ts:3073`, `String(p.name)`).
For each, mirror the corresponding web route's Zod validation in the push branch (prefer the
shared repo fn already doing validation). SYNC-P2 (supplements PATCH mass assignment) **= SEC-6
in batch R1** — do **not** re-plan the fix here; it is a prerequisite/cross-reference (the
whitelist that R1 adds to `updateSupplement` also protects the push path).

**Verify:** [dev-DB] unit-test each push branch rejects the out-of-spec payloads.

### Task 5.4 — SYNC-P7: water has two divergent server write functions [dev-DB, low]

**Confirmed still-present.** Web `POST /api/water` uses `incrementWaterLog` (relative add)
while the outbox path writes an absolute total via `upsertBodyMetrics` — a
"one write function per domain" violation that loses concurrent increments in a multi-device
world. Consolidate on one semantic: since the local store already holds the running total
(read-merge water pattern), the outbox should carry a **delta** and the server should apply it
via `incrementWaterLog`, OR both should upsert an absolute total computed from the local
running value. Pick the delta-add path (matches the web route's add semantics and survives
concurrent devices) and route both through `incrementWaterLog`. Single-device today, so
low-urgency, but it's a standing rule violation — fix or add a Known-Issues row.

**Verify:** [dev-DB] two sequential water adds (web + simulated push) sum correctly rather
than last-writer-wins.

### Task 5.5 — SYNC-Q1: push route silently drops unknown-domain mutations [dev-DB, low]

**Confirmed still-present.** `pushMutations` deliberately drops (confirms-and-deletes
client-side) mutations for domains the server doesn't recognize — correct anti-wedge behavior,
but a **newer client against an older server** (mid-deploy) silently loses data. Add a version
gate or an explicit "unsupported domain" response: when the server sees an unknown domain,
return it as a *retryable* failure (5xx-style, back-off-and-retry per the poison-pill rules)
rather than a poison-pill drop, so the mutation survives until the server catches up — but
bound the retries so a genuinely-removed domain can't wedge forever. Document the chosen
policy inline.

**Verify:** [dev-DB] unit-test an unknown-domain mutation is retried (not dropped) a bounded
number of times, and a known domain is unaffected.

---

## Chunk 6 — Stored counters (mediums, dev-DB verifiable)

Governing rule: CLAUDE.md **Stored Counters** ("Every stored counter in this project has
drifted… Derive counts from source-of-truth queries at read time. If a stored counter is
unavoidable for performance, pair it with a reconcile-on-read self-heal.").

### Task 6.1 — SYNC-T1: `user_stats` totals never decremented, never reconciled [dev-DB]

**Confirmed still-present.** `user_stats.total_sessions/total_volume_kg/total_sets`
(`schema.ts:255-260`) are incremented (replay-guarded) in `logExerciseAndSets`
(`adapter.ts:892-904`) but **never decremented on any delete** (grep confirms no
`total_sessions - `/`total_volume_kg - ` anywhere) and there is **no reconcile-on-read**;
`lib/achievements.ts:95-98` gates XP/achievements on the raw row (`:170-172`). Direct edits or
deletes inflate it permanently → wrong XP/achievements. Fix per the rule: add
`reconcileUserStats(userId)` that derives the three totals from source-of-truth queries
(`COUNT(DISTINCT workout_sessions.id)` for completed sessions where `deleted_at IS NULL` —
coordinate with Task 1.1's tombstone; `SUM(volume)` and `COUNT(set_logs)` over non-deleted
rows) and upserts them, then call it at the top of `computeAchievements`/the XP read in
`achievements.ts` (self-heal on read, mirroring `reconcileSessionsInPhase`). Keep the
increment as a fast-path; the reconcile corrects drift.

**Verify:** [dev-DB] seed a user, log then delete a session, read achievements → totals match
a fresh `COUNT`/`SUM` (not inflated); a direct DB counter edit self-heals on next read.

### Task 6.2 — SYNC-T2: `sessions_in_phase` reconcile runs at only one read site [dev-DB]

**Confirmed still-present.** `reconcileSessionsInPhase` (`slices/periodization.ts:156`, called
via `adapter.ts:4151`) runs at **only** `app/api/ai-periodization/program-overview/route.ts:16`.
The load-bearing readers — the prescribe route's phase-ceiling guards and workout-data's
`completedCycles` — read the raw `sessions_in_phase` counter, so a drifted counter (over-count
on re-sync, no decrement on delete, direct-edit inflation — fixed three times historically)
mis-gates auto-deload / cycle progression. Fix: call `repo.reconcileSessionsInPhase(userId,
programId)` at the top of the prescribe route (and any other load-bearing reader) before it
reads the counter, exactly as program-overview does. It's already idempotent and transactional.

**Verify:** [dev-DB] with an artificially-inflated `sessions_in_phase`, hit the prescribe
route → it reconciles to the true count before applying the phase-ceiling guard.

---

## Cross-references & sequencing

- **Task 1.1 (server tombstone) is a prerequisite for Task 6.1** (the `total_sessions` derive
  must count `deleted_at IS NULL`) — land 1.1's migration + read-filters first, or gate 6.1's
  query on it.
- **SYNC-P2 = SEC-6** (batch R1) — the supplements PATCH whitelist; not re-planned here.
- **SYNC-O2 = NUT-8 (SYNC half)** — the NUT batch owns NUT-1/NUT-4; coordinate the food-item
  outbox domain if both batches land close together (claim the domain name once).
- **SYNC-R5 overlaps CACHE-F15/PERF-10** (R2/R6) — coordinate the `day-log:<date>` cache key
  so the batches don't mint duplicate keys.
- **End-of-session:** fold the journal (`docs/overview/history-*.md`) + `projectOverview.md`
  lean-index update, `package.json` version bump, and `lib/changelog.ts` entry into this PR;
  add a `docs/module-map.md` row if the food_items/oura_workout_reviewed outbox domains are
  genuinely new infrastructure. Any deferred sub-item (SYNC-R3 fallback, SYNC-C6 version
  advance) gets a Known-Issues row rather than being dropped.

## Device-verification summary (Canonical Runtime)

**dev-DB verifiable (web `pnpm dev` + local Postgres):** migration 117, `getSyncDelta`
tombstone emit, all Chunk 5 push-parity tasks, both Chunk 6 counter reconciles, Task 3.3
(early-deload) and the online-only Task 3.4 sites.

**APK-only — require on-device smoke (`docs/device-smoke-checklist.md`) or a
`projectOverview.md` "NOT verified on device" Known-Issues row:** all of Chunk 4 (native
SQLite machinery), Tasks 1.1(local resurrection)/1.2/1.3/1.4, Chunk 2 local-first reads
(2.1–2.4), Tasks 3.1/3.2, and the supplements paths in 3.4. Green `pnpm dev` is necessary but
never sufficient for these — the native path is not exercised by the sandbox.
