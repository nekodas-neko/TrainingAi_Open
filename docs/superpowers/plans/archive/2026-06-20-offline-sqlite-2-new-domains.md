# Offline SQLite New Domains — Plan 2: Food Logs, Supplements, Injuries

**Status:** Pending  
**Branch:** `feat/offline-sqlite`  
**Depends on:** Plan 1 (SQLite foundation must be complete first)

---

## Goal

Extend the SQLite local store and the server sync layer to cover three additional data domains that currently write directly to the Railway API:

| Domain | Local table | Current UI write path |
|--------|------------|----------------------|
| Food logs | `food_logs` | `food-logger-sheet.tsx` → `/api/nutrition/food-logs` |
| Supplement logs | `supplement_logs` (+ `supplements` read cache) | `supplements-section.tsx` → `/api/supplements/{id}/log` |
| Injuries | `injuries` | `injury-sheet.tsx` → `/api/injuries` |

After this plan, all three domains follow the same pattern as body metrics and mood logs:
1. Write to SQLite immediately → UI reads back from SQLite → shows instantly.
2. Queue a mutation in `mutations_outbox`.
3. `pushMutations()` sends queued mutations to the server on next sync.
4. `pullDelta()` brings server changes back into local SQLite.

---

## What Is NOT Changing

- Food items / meal types / saved meals / nutrition targets — these are reference data, not user daily logs. They remain server-only. The food logger still fetches the food item list from the API; only the act of *logging a portion* goes local-first.
- Water log — water_ml is already part of `body_metrics` (local-first since Plan 1). The `/api/water-log` route writes to `body_metrics.water_ml` server-side; the local write path for water is the existing `upsertBodyMetric` + `queueMutation('body_metrics')` pattern. No changes needed.
- Supplement definitions (`supplements` table) — name, dose, reminder settings are managed by the settings UI and remain server-only. Only the daily log entry (did the user take it today?) goes local-first.

---

## Step 1 — SQLite migration v5 — new tables

**File:** `lib/sqlite/migrations.ts`

```ts
{
  toVersion: 5,
  statements: [
    `CREATE TABLE IF NOT EXISTS food_logs (
      id                  TEXT PRIMARY KEY,
      date                TEXT NOT NULL,
      meal_type_id        TEXT NOT NULL,
      food_item_id        TEXT NOT NULL,
      quantity_multiplier REAL NOT NULL DEFAULT 1,
      logged_at           TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      deleted_at          TEXT,
      sync_status         TEXT NOT NULL DEFAULT 'pending'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_food_logs_date ON food_logs (date)`,

    -- Supplement definitions — read cache only (no offline write for these)
    `CREATE TABLE IF NOT EXISTS supplements (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      dose             TEXT,
      reminder_enabled INTEGER NOT NULL DEFAULT 0,
      reminder_time    TEXT,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      active           INTEGER NOT NULL DEFAULT 1,
      updated_at       TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS supplement_logs (
      id            TEXT PRIMARY KEY,
      supplement_id TEXT NOT NULL,
      log_date      TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      deleted_at    TEXT,
      sync_status   TEXT NOT NULL DEFAULT 'pending',
      UNIQUE(supplement_id, log_date)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_supplement_logs_date ON supplement_logs (log_date)`,

    `CREATE TABLE IF NOT EXISTS injuries (
      id            TEXT PRIMARY KEY,
      muscle_name   TEXT NOT NULL,
      notes         TEXT,
      severity      TEXT NOT NULL,
      started_date  TEXT NOT NULL,
      resolved_date TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      deleted_at    TEXT,
      sync_status   TEXT NOT NULL DEFAULT 'pending'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_injuries_started ON injuries (started_date)`,
  ],
},
```

**Note on `supplement_logs` uniqueness:** `UNIQUE(supplement_id, log_date)` mirrors the server DB constraint. An upsert on `(supplement_id, log_date)` is how we handle "re-log same supplement same day" without creating duplicates.

---

## Step 2 — Extend `LocalStore` types

**File:** `lib/local-store/types.ts`

Add three new interfaces and widen `PendingMutation.domain`:

```ts
export interface LocalFoodLog {
  id:                 string;
  date:               string;        // YYYY-MM-DD
  mealTypeId:         string;
  foodItemId:         string;
  quantityMultiplier: number;
  loggedAt:           string;        // ISO
  updatedAt:          string;
  deletedAt:          string | null;
  syncStatus:         'pending' | 'synced';
}

export interface LocalSupplement {
  id:              string;
  name:            string;
  dose:            string | null;
  reminderEnabled: boolean;
  reminderTime:    string | null;
  sortOrder:       number;
  active:          boolean;
  updatedAt:       string;
}

export interface LocalSupplementLog {
  id:           string;
  supplementId: string;
  logDate:      string;              // YYYY-MM-DD
  updatedAt:    string;
  deletedAt:    string | null;
  syncStatus:   'pending' | 'synced';
}

export interface LocalInjury {
  id:           string;
  muscleName:   string;
  notes:        string | null;
  severity:     'mild' | 'moderate' | 'severe';
  startedDate:  string;              // YYYY-MM-DD
  resolvedDate: string | null;
  createdAt:    string;
  updatedAt:    string;
  deletedAt:    string | null;
  syncStatus:   'pending' | 'synced';
}

// Widen domain union — add the three new domains
export interface PendingMutation {
  id:        string;
  userId:    string;
  domain:    'body_metrics' | 'mood_logs' | 'food_logs' | 'supplement_logs' | 'injuries';
  date:      string;
  payload:   Record<string, unknown>;
  createdAt: string;
}
```

---

## Step 3 — Extend `LocalStore` interface

**File:** `lib/local-store/index.ts`

Add reads and writes for the three new domains. The delta parameter of `applyDelta` also widens.

```ts
// New reads
getFoodLogs(date: string): Promise<LocalFoodLog[]>;
getSupplements(): Promise<LocalSupplement[]>;
getSupplementLogs(date: string): Promise<LocalSupplementLog[]>;
getInjuries(): Promise<LocalInjury[]>;

// New writes
upsertFoodLog(record: LocalFoodLog): Promise<void>;
deleteFoodLog(id: string): Promise<void>;
upsertSupplement(record: LocalSupplement): Promise<void>;
upsertSupplementLog(record: LocalSupplementLog): Promise<void>;
deleteSupplementLog(supplementId: string, logDate: string): Promise<void>;
upsertInjury(record: LocalInjury): Promise<void>;
deleteInjury(id: string): Promise<void>;

// Widen applyDelta
applyDelta(delta: {
  bodyMetrics?:       LocalBodyMetric[];
  moodLogs?:          LocalMoodLog[];
  sleepSessions?:     LocalSleepSession[];
  workoutSessions?:   LocalWorkoutSession[];
  activityLogs?:      LocalActivityLog[];
  programs?:          LocalProgram[];
  progressionStyles?: LocalProgressionStyle[];
  foodLogs?:          LocalFoodLog[];        // NEW
  supplements?:       LocalSupplement[];     // NEW
  supplementLogs?:    LocalSupplementLog[];  // NEW
  injuries?:          LocalInjury[];         // NEW
}): Promise<void>;
```

---

## Step 4 — Implement new methods in `SQLiteLocalStore`

**File:** `lib/local-store/sqlite-backend.ts`

### getFoodLogs

```ts
async getFoodLogs(date: string): Promise<LocalFoodLog[]> {
  const rows = await querySQL<Record<string, unknown>>(
    `SELECT * FROM food_logs WHERE date = ? AND deleted_at IS NULL ORDER BY logged_at`,
    [date],
  );
  return rows.map(r => ({
    id:                 String(r.id),
    date:               String(r.date),
    mealTypeId:         String(r.meal_type_id),
    foodItemId:         String(r.food_item_id),
    quantityMultiplier: Number(r.quantity_multiplier),
    loggedAt:           String(r.logged_at),
    updatedAt:          String(r.updated_at),
    deletedAt:          r.deleted_at ? String(r.deleted_at) : null,
    syncStatus:         String(r.sync_status) as 'pending' | 'synced',
  }));
}
```

### upsertFoodLog / deleteFoodLog

```ts
async upsertFoodLog(record: LocalFoodLog): Promise<void> {
  await runSQL(
    `INSERT INTO food_logs
       (id, date, meal_type_id, food_item_id, quantity_multiplier,
        logged_at, updated_at, deleted_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       quantity_multiplier=excluded.quantity_multiplier,
       updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
       sync_status=excluded.sync_status`,
    [
      record.id, record.date, record.mealTypeId, record.foodItemId,
      record.quantityMultiplier, record.loggedAt, record.updatedAt,
      record.deletedAt, record.syncStatus,
    ],
  );
}

async deleteFoodLog(id: string): Promise<void> {
  const now = new Date().toISOString();
  await runSQL(
    `UPDATE food_logs SET deleted_at=?, sync_status='pending', updated_at=? WHERE id=?`,
    [now, now, id],
  );
}
```

### getSupplements / upsertSupplement

```ts
async getSupplements(): Promise<LocalSupplement[]> {
  const rows = await querySQL<Record<string, unknown>>(
    `SELECT * FROM supplements WHERE active=1 ORDER BY sort_order`,
    [],
  );
  return rows.map(r => ({
    id:              String(r.id),
    name:            String(r.name),
    dose:            r.dose ? String(r.dose) : null,
    reminderEnabled: Number(r.reminder_enabled) === 1,
    reminderTime:    r.reminder_time ? String(r.reminder_time) : null,
    sortOrder:       Number(r.sort_order),
    active:          Number(r.active) === 1,
    updatedAt:       String(r.updated_at),
  }));
}

async upsertSupplement(record: LocalSupplement): Promise<void> {
  await runSQL(
    `INSERT INTO supplements
       (id, name, dose, reminder_enabled, reminder_time, sort_order, active, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, dose=excluded.dose,
       reminder_enabled=excluded.reminder_enabled,
       reminder_time=excluded.reminder_time,
       sort_order=excluded.sort_order,
       active=excluded.active, updated_at=excluded.updated_at`,
    [
      record.id, record.name, record.dose,
      record.reminderEnabled ? 1 : 0, record.reminderTime,
      record.sortOrder, record.active ? 1 : 0, record.updatedAt,
    ],
  );
}
```

### getSupplementLogs / upsertSupplementLog / deleteSupplementLog

```ts
async getSupplementLogs(date: string): Promise<LocalSupplementLog[]> {
  const rows = await querySQL<Record<string, unknown>>(
    `SELECT * FROM supplement_logs WHERE log_date = ? AND deleted_at IS NULL`,
    [date],
  );
  return rows.map(r => ({
    id:           String(r.id),
    supplementId: String(r.supplement_id),
    logDate:      String(r.log_date),
    updatedAt:    String(r.updated_at),
    deletedAt:    r.deleted_at ? String(r.deleted_at) : null,
    syncStatus:   String(r.sync_status) as 'pending' | 'synced',
  }));
}

async upsertSupplementLog(record: LocalSupplementLog): Promise<void> {
  const now = new Date().toISOString();
  await runSQL(
    `INSERT INTO supplement_logs (id, supplement_id, log_date, updated_at, deleted_at, sync_status)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(supplement_id, log_date) DO UPDATE SET
       id=excluded.id, updated_at=excluded.updated_at,
       deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
    [
      record.id, record.supplementId, record.logDate,
      record.updatedAt ?? now, record.deletedAt, record.syncStatus,
    ],
  );
}

async deleteSupplementLog(supplementId: string, logDate: string): Promise<void> {
  const now = new Date().toISOString();
  await runSQL(
    `UPDATE supplement_logs
     SET deleted_at=?, sync_status='pending', updated_at=?
     WHERE supplement_id=? AND log_date=?`,
    [now, now, supplementId, logDate],
  );
}
```

### getInjuries / upsertInjury / deleteInjury

```ts
async getInjuries(): Promise<LocalInjury[]> {
  const rows = await querySQL<Record<string, unknown>>(
    `SELECT * FROM injuries WHERE deleted_at IS NULL ORDER BY started_date DESC`,
    [],
  );
  return rows.map(r => ({
    id:           String(r.id),
    muscleName:   String(r.muscle_name),
    notes:        r.notes ? String(r.notes) : null,
    severity:     String(r.severity) as LocalInjury['severity'],
    startedDate:  String(r.started_date),
    resolvedDate: r.resolved_date ? String(r.resolved_date) : null,
    createdAt:    String(r.created_at),
    updatedAt:    String(r.updated_at),
    deletedAt:    r.deleted_at ? String(r.deleted_at) : null,
    syncStatus:   String(r.sync_status) as 'pending' | 'synced',
  }));
}

async upsertInjury(record: LocalInjury): Promise<void> {
  await runSQL(
    `INSERT INTO injuries
       (id, muscle_name, notes, severity, started_date, resolved_date,
        created_at, updated_at, deleted_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       muscle_name=excluded.muscle_name, notes=excluded.notes,
       severity=excluded.severity, started_date=excluded.started_date,
       resolved_date=excluded.resolved_date, updated_at=excluded.updated_at,
       deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
    [
      record.id, record.muscleName, record.notes, record.severity,
      record.startedDate, record.resolvedDate, record.createdAt,
      record.updatedAt, record.deletedAt, record.syncStatus,
    ],
  );
}

async deleteInjury(id: string): Promise<void> {
  const now = new Date().toISOString();
  await runSQL(
    `UPDATE injuries SET deleted_at=?, sync_status='pending', updated_at=? WHERE id=?`,
    [now, now, id],
  );
}
```

### Extend applyDelta

Add three new delta branches to the `applyDelta` method:

```ts
// food_logs — skip pending (local write wins)
for (const r of delta.foodLogs ?? []) {
  if (r.deletedAt) {
    await runSQL(`DELETE FROM food_logs WHERE id = ?`, [r.id]);
  } else {
    const existing = await querySQL<{ sync_status: string }>(
      `SELECT sync_status FROM food_logs WHERE id = ?`, [r.id],
    );
    if (!existing.length || existing[0].sync_status === 'synced') {
      await this.upsertFoodLog({ ...r, syncStatus: 'synced' });
    }
  }
}

// supplements — always overwrite (server is authoritative for definitions)
for (const r of delta.supplements ?? []) {
  await this.upsertSupplement(r);
}

// supplement_logs — skip pending
for (const r of delta.supplementLogs ?? []) {
  if (r.deletedAt) {
    await runSQL(
      `DELETE FROM supplement_logs WHERE supplement_id=? AND log_date=?`,
      [r.supplementId, r.logDate],
    );
  } else {
    const existing = await querySQL<{ sync_status: string }>(
      `SELECT sync_status FROM supplement_logs WHERE supplement_id=? AND log_date=?`,
      [r.supplementId, r.logDate],
    );
    if (!existing.length || existing[0].sync_status === 'synced') {
      await this.upsertSupplementLog({ ...r, syncStatus: 'synced' });
    }
  }
}

// injuries — skip pending
for (const r of delta.injuries ?? []) {
  if (r.deletedAt) {
    await runSQL(`DELETE FROM injuries WHERE id = ?`, [r.id]);
  } else {
    const existing = await querySQL<{ sync_status: string }>(
      `SELECT sync_status FROM injuries WHERE id = ?`, [r.id],
    );
    if (!existing.length || existing[0].sync_status === 'synced') {
      await this.upsertInjury({ ...r, syncStatus: 'synced' });
    }
  }
}
```

---

## Step 5 — Server: extend `SyncDelta` and `MutationDomain`

**File:** `lib/data/repository.ts`

```ts
export interface SyncDelta {
  programs:          unknown[];
  progressionStyles: unknown[];
  bodyMetrics:       unknown[];
  sleepSessions:     unknown[];
  moodLogs:          unknown[];
  activityLogs:      unknown[];
  workoutSessions:   unknown[];
  foodLogs:          unknown[];       // NEW
  supplements:       unknown[];       // NEW
  supplementLogs:    unknown[];       // NEW
  injuries:          unknown[];       // NEW
  syncedAt:          string;
}

export type MutationDomain =
  | 'body_metrics'
  | 'mood_logs'
  | 'food_logs'       // NEW
  | 'supplement_logs' // NEW
  | 'injuries';       // NEW
```

---

## Step 6 — Server: extend `getSyncDelta` in `lib/data/postgres/adapter.ts`

Find `getSyncDelta` (currently around line 3114) and add queries for the three new domains. The pattern is the same as existing domains — query rows where `updated_at > since`.

```ts
// food_logs
const foodLogs = await db
  .select({
    id:                 foodLogs.id,
    date:               foodLogs.date,
    mealTypeId:         foodLogs.mealTypeId,
    foodItemId:         foodLogs.foodItemId,
    quantityMultiplier: foodLogs.quantityMultiplier,
    loggedAt:           foodLogs.loggedAt,
    updatedAt:          foodLogs.updatedAt,
    deletedAt:          foodLogs.deletedAt,
  })
  .from(schema.foodLogs)
  .where(and(eq(schema.foodLogs.userId, userId), gt(schema.foodLogs.updatedAt, since)));

// supplements (read cache — send all active ones when any changed since last sync)
const supplements = await db
  .select({
    id: schema.supplements.id,
    name: schema.supplements.name,
    dose: schema.supplements.dose,
    reminderEnabled: schema.supplements.reminderEnabled,
    reminderTime: schema.supplements.reminderTime,
    sortOrder: schema.supplements.sortOrder,
    active: schema.supplements.active,
    updatedAt: schema.supplements.updatedAt,
  })
  .from(schema.supplements)
  .where(and(eq(schema.supplements.userId, userId), gt(schema.supplements.updatedAt, since)));

// supplement_logs
const supplementLogs = await db
  .select({
    id:           schema.supplementLogs.id,
    supplementId: schema.supplementLogs.supplementId,
    logDate:      schema.supplementLogs.logDate,
    updatedAt:    schema.supplementLogs.updatedAt,
    deletedAt:    schema.supplementLogs.deletedAt,
  })
  .from(schema.supplementLogs)
  .innerJoin(schema.supplements, eq(schema.supplementLogs.supplementId, schema.supplements.id))
  .where(and(eq(schema.supplements.userId, userId), gt(schema.supplementLogs.updatedAt, since)));

// injuries
const injuries = await db
  .select()
  .from(schema.injuries)
  .where(and(eq(schema.injuries.userId, userId), gt(schema.injuries.updatedAt, since)));

return {
  ...existingFields,
  foodLogs,
  supplements,
  supplementLogs,
  injuries,
  syncedAt: new Date().toISOString(),
};
```

**Check first:** Verify that `food_logs`, `supplements`, `supplement_logs`, `injuries` tables all have an `updated_at` column. If `food_logs` or `supplement_logs` don't have one, add a Drizzle migration to add it (default `now()`). Injuries likely already have `created_at`; add `updated_at` if missing.

---

## Step 7 — Server: extend `pushMutations` in `lib/data/postgres/adapter.ts`

Find `pushMutations` (currently around line 3140) and add three new domain handlers.

```ts
// food_logs — upsert by id
if (mutation.domain === 'food_logs') {
  const p = mutation.payload as {
    id: string; date: string; mealTypeId: string; foodItemId: string;
    quantityMultiplier: number; loggedAt: string;
  };
  await db.insert(schema.foodLogs).values({
    id: p.id, userId, date: p.date,
    mealTypeId: p.mealTypeId, foodItemId: p.foodItemId,
    quantityMultiplier: p.quantityMultiplier,
    loggedAt: new Date(p.loggedAt),
  }).onConflictDoUpdate({
    target: schema.foodLogs.id,
    set: { quantityMultiplier: p.quantityMultiplier, updatedAt: new Date() },
  });
}

// supplement_logs — upsert by (supplementId, logDate)
if (mutation.domain === 'supplement_logs') {
  const p = mutation.payload as { supplementId: string; logDate: string; deleted?: boolean };
  if (p.deleted) {
    await db.delete(schema.supplementLogs)
      .where(and(
        eq(schema.supplementLogs.supplementId, p.supplementId),
        eq(schema.supplementLogs.logDate, p.logDate),
      ));
  } else {
    await db.insert(schema.supplementLogs).values({
      id: crypto.randomUUID(), supplementId: p.supplementId, logDate: p.logDate,
      userId,
    }).onConflictDoNothing();
  }
}

// injuries — upsert by id
if (mutation.domain === 'injuries') {
  const p = mutation.payload as {
    id: string; muscleName: string; notes?: string; severity: string;
    startedDate: string; resolvedDate?: string; deleted?: boolean;
  };
  if (p.deleted) {
    await db.delete(schema.injuries).where(eq(schema.injuries.id, p.id));
  } else {
    await db.insert(schema.injuries).values({
      id: p.id, userId, muscleName: p.muscleName,
      notes: p.notes ?? null, severity: p.severity as Injury['severity'],
      startedDate: p.startedDate, resolvedDate: p.resolvedDate ?? null,
    }).onConflictDoUpdate({
      target: schema.injuries.id,
      set: {
        muscleName: p.muscleName, notes: p.notes ?? null,
        severity: p.severity as Injury['severity'],
        resolvedDate: p.resolvedDate ?? null,
        updatedAt: new Date(),
      },
    });
  }
}
```

---

## Step 8 — Server: extend push route Zod schema

**File:** `app/api/sync/push/route.ts`

```ts
const MutationSchema = z.object({
  domain: z.enum(['body_metrics', 'mood_logs', 'food_logs', 'supplement_logs', 'injuries']),
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payload: z.record(z.string(), z.unknown()),
});
```

---

## Step 9 — Extend `pullDelta` in `lib/local-store/sync-engine.ts`

Add mapping for the four new fields in the `raw` response:

```ts
const foodLogs = (raw.foodLogs as Record<string, unknown>[]).map(r => ({
  id:                 String(r.id),
  date:               String(r.date),
  mealTypeId:         String(r.mealTypeId),
  foodItemId:         String(r.foodItemId),
  quantityMultiplier: Number(r.quantityMultiplier),
  loggedAt:           toIso(r.loggedAt),
  updatedAt:          toIso(r.updatedAt),
  deletedAt:          r.deletedAt ? toIso(r.deletedAt) : null,
  syncStatus:         'synced' as const,
} satisfies LocalFoodLog));

const supplements = (raw.supplements as Record<string, unknown>[]).map(r => ({
  id:              String(r.id),
  name:            String(r.name),
  dose:            r.dose ? String(r.dose) : null,
  reminderEnabled: Boolean(r.reminderEnabled),
  reminderTime:    r.reminderTime ? String(r.reminderTime) : null,
  sortOrder:       Number(r.sortOrder),
  active:          Boolean(r.active),
  updatedAt:       toIso(r.updatedAt),
} satisfies LocalSupplement));

const supplementLogs = (raw.supplementLogs as Record<string, unknown>[]).map(r => ({
  id:           String(r.id),
  supplementId: String(r.supplementId),
  logDate:      String(r.logDate),
  updatedAt:    toIso(r.updatedAt),
  deletedAt:    r.deletedAt ? toIso(r.deletedAt) : null,
  syncStatus:   'synced' as const,
} satisfies LocalSupplementLog));

const injuries = (raw.injuries as Record<string, unknown>[]).map(r => ({
  id:           String(r.id),
  muscleName:   String(r.muscleName),
  notes:        r.notes ? String(r.notes) : null,
  severity:     String(r.severity) as LocalInjury['severity'],
  startedDate:  String(r.startedDate),
  resolvedDate: r.resolvedDate ? String(r.resolvedDate) : null,
  createdAt:    toIso(r.createdAt),
  updatedAt:    toIso(r.updatedAt),
  deletedAt:    r.deletedAt ? toIso(r.deletedAt) : null,
  syncStatus:   'synced' as const,
} satisfies LocalInjury));

await store.applyDelta({
  bodyMetrics, moodLogs, sleepSessions, workoutSessions, activityLogs,
  programs, progressionStyles,
  foodLogs, supplements, supplementLogs, injuries,   // NEW
});
```

Also update the count:
```ts
const count = bodyMetrics.length + moodLogs.length + sleepSessions.length +
  workoutSessions.length + activityLogs.length + programs.length + progressionStyles.length +
  foodLogs.length + supplementLogs.length + injuries.length;
```

Also update `pushMutations` to handle confirmed mutations for new domains — mark local records as `synced`:

```ts
} else if (m.domain === 'food_logs') {
  const existing = await store.getFoodLogs(m.date);
  const rec = existing.find(r => r.id === m.payload.id);
  if (rec) await store.upsertFoodLog({ ...rec, syncStatus: 'synced' });
} else if (m.domain === 'supplement_logs') {
  const logs = await store.getSupplementLogs(m.date);
  const rec = logs.find(r => r.supplementId === (m.payload.supplementId as string));
  if (rec) await store.upsertSupplementLog({ ...rec, syncStatus: 'synced' });
} else if (m.domain === 'injuries') {
  const injs = await store.getInjuries();
  const rec = injs.find(r => r.id === m.payload.id);
  if (rec) await store.upsertInjury({ ...rec, syncStatus: 'synced' });
}
```

---

## Step 10 — Update UI write paths

### 10a — Food logger (`components/nutrition/food-logger-sheet.tsx`)

Current pattern: POST to `/api/nutrition/food-logs` → invalidate cache → refetch.

New pattern:
```ts
const store = getLocalStore(session.user.id);
const id = crypto.randomUUID();
const now = todayInTz(session.user.timezone);
if (store) {
  await store.upsertFoodLog({
    id, date: now, mealTypeId: selectedMeal.id, foodItemId: item.id,
    quantityMultiplier: qty, loggedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), deletedAt: null, syncStatus: 'pending',
  });
  await store.queueMutation({
    userId: session.user.id, domain: 'food_logs', date: now,
    payload: { id, date: now, mealTypeId: selectedMeal.id, foodItemId: item.id,
               quantityMultiplier: qty, loggedAt: new Date().toISOString() },
  });
  // Update UI from local store (no network needed)
  refreshFoodLogsFromLocal();
} else {
  // Web fallback — direct API
  await fetch('/api/nutrition/food-logs', { method: 'POST', ... });
  refreshFoodLogs();
}
```

Delete food log — use `store.deleteFoodLog(id)` + queue a `food_logs` mutation with `deleted: true` in the payload.

### 10b — Supplement log (`components/nutrition/supplements-section.tsx`)

Current: POST/DELETE to `/api/supplements/{id}/log`.

New pattern for toggle-log:
```ts
const store = getLocalStore(session.user.id);
const today = todayInTz(session.user.timezone);
if (store) {
  if (currentlyLogged) {
    await store.deleteSupplementLog(supplement.id, today);
    await store.queueMutation({
      userId: session.user.id, domain: 'supplement_logs', date: today,
      payload: { supplementId: supplement.id, logDate: today, deleted: true },
    });
  } else {
    const id = crypto.randomUUID();
    await store.upsertSupplementLog({
      id, supplementId: supplement.id, logDate: today,
      updatedAt: new Date().toISOString(), deletedAt: null, syncStatus: 'pending',
    });
    await store.queueMutation({
      userId: session.user.id, domain: 'supplement_logs', date: today,
      payload: { supplementId: supplement.id, logDate: today },
    });
  }
  // Toggle logged state from local store (instant)
  setLoggedSupplements(prev => toggled...);
} else {
  // Web fallback
  await fetch(`/api/supplements/${supplement.id}/log`, { method: currentlyLogged ? 'DELETE' : 'POST' });
}
```

The `supplements-section` currently reads supplement definitions from the API. After sync, read definitions from `store.getSupplements()` when available (they're populated by `pullDelta`). Fall back to API fetch when `store` is null or empty.

### 10c — Injury sheet (`components/health/injury-sheet.tsx`)

Current: POST to `/api/injuries`.

New pattern:
```ts
const store = getLocalStore(session.user.id);
const id = crypto.randomUUID();
const now = new Date().toISOString();
if (store) {
  await store.upsertInjury({
    id, muscleName, notes, severity, startedDate, resolvedDate: null,
    createdAt: now, updatedAt: now, deletedAt: null, syncStatus: 'pending',
  });
  await store.queueMutation({
    userId: session.user.id, domain: 'injuries', date: startedDate,
    payload: { id, muscleName, notes, severity, startedDate },
  });
  refreshInjuriesFromLocal();
} else {
  await fetch('/api/injuries', { method: 'POST', ... });
  refreshInjuries();
}
```

For resolving/deleting an injury: update `resolvedDate` or set `deleted: true` in the mutation payload.

---

## Step 11 — Read paths: use local store when available

The UI components that *display* food logs, supplement logs, and injuries should prefer the local SQLite data over API calls when `store` is available. Pattern:

```ts
const store = getLocalStore(userId);
if (store) {
  const logs = await store.getFoodLogs(today);
  // render from logs
} else {
  // fetch from API as today
}
```

This makes reading instant on APK (no network required). On web, falls through to the existing API fetch.

---

## Files Changed (summary)

| File | Action |
|------|--------|
| `lib/sqlite/migrations.ts` | Add `toVersion: 5` block |
| `lib/local-store/types.ts` | Add `LocalFoodLog`, `LocalSupplement`, `LocalSupplementLog`, `LocalInjury`; widen `PendingMutation.domain` |
| `lib/local-store/index.ts` | Extend `LocalStore` interface with new methods; widen `applyDelta` |
| `lib/local-store/sqlite-backend.ts` | Implement 9 new methods; extend `applyDelta` |
| `lib/local-store/sync-engine.ts` | Extend `pullDelta` mapping; extend `pushMutations` post-confirm logic |
| `lib/data/repository.ts` | Widen `SyncDelta`; widen `MutationDomain` |
| `lib/data/postgres/adapter.ts` | Extend `getSyncDelta`; extend `pushMutations` |
| `app/api/sync/push/route.ts` | Widen Zod enum |
| `components/nutrition/food-logger-sheet.tsx` | Local-first write |
| `components/nutrition/supplements-section.tsx` | Local-first write + read |
| `components/health/injury-sheet.tsx` | Local-first write |

---

## Testing Checklist

1. **Food log offline:** Put APK in airplane mode. Log a meal. Verify it appears immediately in the nutrition tab. Restore network. Verify `pushMutations` sends it to the server.
2. **Supplement log offline:** Airplane mode. Toggle a supplement as taken. Verify the checkmark appears instantly. Restore network. Verify the server reflects it.
3. **Injury log offline:** Airplane mode. Log a new injury. Verify it appears in the injuries list. Restore network. Verify server has it.
4. **Conflict handling:** Log food locally while offline. Before syncing, log different food on the server for same day. Verify the local-pending write is preserved and the server's write lands for its entry.
5. **Supplement definitions sync:** Change a supplement name/dose on the server. Open APK. After sync, verify the supplements list shows the updated name (read from local SQLite, populated by `pullDelta`).
6. **Web fallback:** All three features still work in browser (direct API calls, no local store).
7. **Deleted_at propagation:** Delete a food log locally. Verify the soft-delete is pushed to the server and the item disappears on the next pull from a different device.

---

## Notes

- **`supplement_logs` primary key strategy:** The server table uses `(supplement_id, log_date)` as the natural key. The local SQLite table has an `id` field for outbox tracking, but `UNIQUE(supplement_id, log_date)` enforces uniqueness. The `pushMutations` server handler uses `onConflictDoNothing` for inserts — idempotent on retry.
- **`food_items` table not included:** Food item definitions (nutrients, brand, etc.) remain server-only. The food logger fetches the item list from `/api/nutrition/food-items` as before. Only the log entry (which item, how much, when) goes local-first. This avoids syncing thousands of food items to SQLite.
- **`updatedAt` on server tables:** Before implementing Step 6, verify that `food_logs`, `supplement_logs`, and `injuries` Drizzle tables all have an `updated_at` column with a server-side default. If missing, add a Drizzle migration first.
- **Timezone:** All `date` fields use `todayInTz(session.user.timezone)` — not `new Date().toISOString().slice(0, 10)`.
