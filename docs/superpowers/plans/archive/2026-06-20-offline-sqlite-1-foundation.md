# Offline SQLite Foundation — Plan 1: Replace Dexie with SQLite Local Store

**Status:** Pending  
**Branch:** `feat/offline-sqlite`  
**Depends on:** nothing (self-contained)  
**Followed by:** Plan 2 (new domains)

---

## Goal

Replace the Dexie/IndexedDB local store with a single SQLite-based local store using the already-installed `@capacitor-community/sqlite` plugin. After this plan:

- APK: all local data (body metrics, mood logs, sleep, workouts, activity logs, programs, progression styles, outbox) lives in one SQLite database file, with full ACID/WAL guarantees.
- Web: `getLocalStore()` returns `null` (already the correct fallback — web users get online-only behavior, which is what they have today).
- Dexie and its IndexedDB databases are deleted from the codebase entirely.

---

## What Is NOT Changing

- `lib/sqlite/cache.ts` — HTTP response cache (SQLite on APK, localStorage on web). Already correct.
- `lib/sqlite/outbox.ts` — Workout sync outbox (SQLite). Already correct.
- `lib/sqlite/sqlite-service.ts` — `isSQLiteAvailable()`, `initSQLite()`, `runSQL()`, `querySQL()`. Stays as-is.
- `components/sync-provider.tsx` — Still calls `initSQLite(MIGRATIONS)` on mount. The only change: remove Dexie-related imports if any exist there.
- `lib/local-store/sync-engine.ts` — Logic unchanged; `getLocalStore()` returns the new backend automatically.
- `app/api/sync/push/route.ts` and `app/api/sync/pull/route.ts` — No server changes in this plan.

---

## Step 1 — Extend SQLite migrations to version 4

**File:** `lib/sqlite/migrations.ts`

Add `{ toVersion: 4, statements: [...] }` at the end of the `MIGRATIONS` array. The plugin runs only new statements on upgrade — existing devices running v1–v3 apply only the v4 statements.

```ts
{
  toVersion: 4,
  statements: [
    // WAL mode — crash-safe, better concurrent read performance on mobile
    `PRAGMA journal_mode=WAL`,

    `CREATE TABLE IF NOT EXISTS body_metrics (
      date              TEXT PRIMARY KEY,
      weight_kg         REAL,
      body_fat_pct      REAL,
      steps             INTEGER,
      calories          INTEGER,
      protein_g         REAL,
      carbs_g           REAL,
      fat_g             REAL,
      water_ml          INTEGER,
      resting_heart_rate INTEGER,
      hrv_ms            REAL,
      spo2_pct          REAL,
      updated_at        TEXT NOT NULL,
      deleted_at        TEXT,
      sync_status       TEXT NOT NULL DEFAULT 'synced'
    )`,

    `CREATE TABLE IF NOT EXISTS mood_logs (
      log_date      TEXT PRIMARY KEY,
      energy_level  TEXT NOT NULL,
      sleep_quality TEXT NOT NULL,
      body_state    TEXT NOT NULL DEFAULT '[]',
      sore_muscles  TEXT NOT NULL DEFAULT '[]',
      updated_at    TEXT NOT NULL,
      deleted_at    TEXT,
      sync_status   TEXT NOT NULL DEFAULT 'synced'
    )`,

    `CREATE TABLE IF NOT EXISTS sleep_sessions (
      id                TEXT PRIMARY KEY,
      date              TEXT NOT NULL,
      duration_hours    REAL,
      deep_sleep_hours  REAL,
      rem_sleep_hours   REAL,
      light_sleep_hours REAL,
      updated_at        TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS activity_logs (
      id            TEXT PRIMARY KEY,
      date          TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      title         TEXT NOT NULL,
      duration_min  REAL,
      distance_km   REAL,
      updated_at    TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS local_programs (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      is_active  INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS local_progression_styles (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS mutations_outbox (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      domain     TEXT NOT NULL,
      date       TEXT NOT NULL,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,

    `CREATE INDEX IF NOT EXISTS idx_mutations_outbox_user ON mutations_outbox (user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_body_metrics_updated ON body_metrics (updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_mood_logs_updated ON mood_logs (updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sleep_sessions_date ON sleep_sessions (date)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs (date)`,
  ],
},
```

**Why WAL mode here:** `PRAGMA journal_mode=WAL` is idempotent (safe to run in a migration). Running it in v4 means every device gets WAL mode once on first upgrade, without needing a separate migration step.

**Why `local_programs` / `local_progression_styles` (not `programs` / `progression_styles`):** The existing SQLite DB (via `@capacitor-community/sqlite`) shares one file with workout tables. `programs` and `progression_styles` are already used by the server schema — naming the local read-cache tables differently avoids any confusion when doing manual inspection.

---

## Step 2 — Create `lib/local-store/sqlite-backend.ts`

This is the new implementation of `LocalStore` using `runSQL` / `querySQL` from `sqlite-service.ts`.

```ts
import { runSQL, querySQL } from '@/lib/sqlite/sqlite-service';
import type { LocalStore } from './index';
import type {
  LocalBodyMetric, LocalMoodLog, LocalSleepSession, LocalWorkoutSession,
  LocalActivityLog, LocalProgram, LocalProgressionStyle, PendingMutation,
} from './types';

export class SQLiteLocalStore implements LocalStore {
  // getBodyMetrics ─────────────────────────────────────────────────────────
  async getBodyMetrics(cutoffDate: string): Promise<LocalBodyMetric[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM body_metrics WHERE date >= ? AND deleted_at IS NULL ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      date:             String(r.date),
      weightKg:         (r.weight_kg as number) ?? null,
      bodyFatPct:       (r.body_fat_pct as number) ?? null,
      steps:            (r.steps as number) ?? null,
      calories:         (r.calories as number) ?? null,
      proteinG:         (r.protein_g as number) ?? null,
      carbsG:           (r.carbs_g as number) ?? null,
      fatG:             (r.fat_g as number) ?? null,
      waterMl:          (r.water_ml as number) ?? null,
      restingHeartRate: (r.resting_heart_rate as number) ?? null,
      hrvMs:            (r.hrv_ms as number) ?? null,
      spo2Pct:          (r.spo2_pct as number) ?? null,
      updatedAt:        String(r.updated_at),
      deletedAt:        r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:       (r.sync_status as 'pending' | 'synced'),
    }));
  }

  // getMoodLogs ─────────────────────────────────────────────────────────────
  async getMoodLogs(cutoffDate: string): Promise<LocalMoodLog[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM mood_logs WHERE log_date >= ? AND deleted_at IS NULL ORDER BY log_date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      logDate:      String(r.log_date),
      energyLevel:  String(r.energy_level),
      sleepQuality: String(r.sleep_quality),
      bodyState:    JSON.parse(String(r.body_state ?? '[]')),
      soreMuscles:  JSON.parse(String(r.sore_muscles ?? '[]')),
      updatedAt:    String(r.updated_at),
      deletedAt:    r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:   (r.sync_status as 'pending' | 'synced'),
    }));
  }

  // getSleepSessions ─────────────────────────────────────────────────────────
  async getSleepSessions(cutoffDate: string): Promise<LocalSleepSession[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM sleep_sessions WHERE date >= ? ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:              String(r.id),
      date:            String(r.date),
      durationHours:   (r.duration_hours as number) ?? null,
      deepSleepHours:  (r.deep_sleep_hours as number) ?? null,
      remSleepHours:   (r.rem_sleep_hours as number) ?? null,
      lightSleepHours: (r.light_sleep_hours as number) ?? null,
      updatedAt:       String(r.updated_at),
    }));
  }

  // getWorkoutSessions ────────────────────────────────────────────────────────
  async getWorkoutSessions(cutoffDate: string): Promise<LocalWorkoutSession[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM workout_sessions WHERE started_at >= ? ORDER BY started_at`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:          String(r.id),
      sessionName: String(r.session_name),
      startedAt:   String(r.started_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
      updatedAt:   String(r.updated_at),
    }));
  }

  // getActivityLogs ──────────────────────────────────────────────────────────
  async getActivityLogs(cutoffDate: string): Promise<LocalActivityLog[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM activity_logs WHERE date >= ? ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:           String(r.id),
      date:         String(r.date),
      activityType: String(r.activity_type),
      title:        String(r.title),
      durationMin:  (r.duration_min as number) ?? null,
      distanceKm:   (r.distance_km as number) ?? null,
      updatedAt:    String(r.updated_at),
    }));
  }

  // getPrograms ──────────────────────────────────────────────────────────────
  async getPrograms(): Promise<LocalProgram[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM local_programs ORDER BY updated_at DESC`,
      [],
    );
    return rows.map(r => ({
      id:        String(r.id),
      name:      String(r.name),
      isActive:  Number(r.is_active) === 1,
      updatedAt: String(r.updated_at),
    }));
  }

  // getProgressionStyles ──────────────────────────────────────────────────────
  async getProgressionStyles(): Promise<LocalProgressionStyle[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM local_progression_styles ORDER BY updated_at DESC`,
      [],
    );
    return rows.map(r => ({
      id:        String(r.id),
      name:      String(r.name),
      updatedAt: String(r.updated_at),
    }));
  }

  // upsertBodyMetric ──────────────────────────────────────────────────────────
  async upsertBodyMetric(record: LocalBodyMetric): Promise<void> {
    await runSQL(
      `INSERT INTO body_metrics
         (date, weight_kg, body_fat_pct, steps, calories, protein_g, carbs_g, fat_g,
          water_ml, resting_heart_rate, hrv_ms, spo2_pct, updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date) DO UPDATE SET
         weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct,
         steps=excluded.steps, calories=excluded.calories,
         protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g,
         water_ml=excluded.water_ml, resting_heart_rate=excluded.resting_heart_rate,
         hrv_ms=excluded.hrv_ms, spo2_pct=excluded.spo2_pct,
         updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
         sync_status=excluded.sync_status`,
      [
        record.date, record.weightKg, record.bodyFatPct, record.steps,
        record.calories, record.proteinG, record.carbsG, record.fatG,
        record.waterMl, record.restingHeartRate, record.hrvMs, record.spo2Pct,
        record.updatedAt, record.deletedAt, record.syncStatus,
      ],
    );
  }

  // upsertMoodLog ─────────────────────────────────────────────────────────────
  async upsertMoodLog(record: LocalMoodLog): Promise<void> {
    await runSQL(
      `INSERT INTO mood_logs
         (log_date, energy_level, sleep_quality, body_state, sore_muscles,
          updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(log_date) DO UPDATE SET
         energy_level=excluded.energy_level, sleep_quality=excluded.sleep_quality,
         body_state=excluded.body_state, sore_muscles=excluded.sore_muscles,
         updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
         sync_status=excluded.sync_status`,
      [
        record.logDate, record.energyLevel, record.sleepQuality,
        JSON.stringify(record.bodyState), JSON.stringify(record.soreMuscles),
        record.updatedAt, record.deletedAt, record.syncStatus,
      ],
    );
  }

  // applyDelta ────────────────────────────────────────────────────────────────
  // Called by pullDelta() after a successful server sync.
  // For body_metrics and mood_logs: skip if local record is 'pending' (user's write wins).
  // For all other tables: last-write-wins (server is authoritative for these).
  async applyDelta(delta: Parameters<LocalStore['applyDelta']>[0]): Promise<void> {
    for (const r of delta.bodyMetrics ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM body_metrics WHERE date = ?`, [r.date]);
      } else {
        const existing = await querySQL<{ sync_status: string }>(
          `SELECT sync_status FROM body_metrics WHERE date = ?`, [r.date],
        );
        if (!existing.length || existing[0].sync_status === 'synced') {
          await this.upsertBodyMetric({ ...r, syncStatus: 'synced' });
        }
      }
    }

    for (const r of delta.moodLogs ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM mood_logs WHERE log_date = ?`, [r.logDate]);
      } else {
        const existing = await querySQL<{ sync_status: string }>(
          `SELECT sync_status FROM mood_logs WHERE log_date = ?`, [r.logDate],
        );
        if (!existing.length || existing[0].sync_status === 'synced') {
          await this.upsertMoodLog({ ...r, syncStatus: 'synced' });
        }
      }
    }

    for (const r of delta.sleepSessions ?? []) {
      await runSQL(
        `INSERT INTO sleep_sessions
           (id, date, duration_hours, deep_sleep_hours, rem_sleep_hours,
            light_sleep_hours, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           date=excluded.date, duration_hours=excluded.duration_hours,
           deep_sleep_hours=excluded.deep_sleep_hours,
           rem_sleep_hours=excluded.rem_sleep_hours,
           light_sleep_hours=excluded.light_sleep_hours,
           updated_at=excluded.updated_at`,
        [r.id, r.date, r.durationHours, r.deepSleepHours,
         r.remSleepHours, r.lightSleepHours, r.updatedAt],
      );
    }

    for (const r of delta.workoutSessions ?? []) {
      await runSQL(
        `INSERT INTO workout_sessions
           (id, session_name, started_at, completed_at, updated_at, synced)
         VALUES (?,?,?,?,?,1)
         ON CONFLICT(id) DO UPDATE SET
           session_name=excluded.session_name,
           started_at=excluded.started_at,
           completed_at=excluded.completed_at,
           updated_at=excluded.updated_at`,
        [r.id, r.sessionName, r.startedAt, r.completedAt, r.updatedAt],
      );
    }

    for (const r of delta.activityLogs ?? []) {
      await runSQL(
        `INSERT INTO activity_logs
           (id, date, activity_type, title, duration_min, distance_km, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           date=excluded.date, activity_type=excluded.activity_type,
           title=excluded.title, duration_min=excluded.duration_min,
           distance_km=excluded.distance_km, updated_at=excluded.updated_at`,
        [r.id, r.date, r.activityType, r.title, r.durationMin, r.distanceKm, r.updatedAt],
      );
    }

    for (const r of delta.programs ?? []) {
      await runSQL(
        `INSERT INTO local_programs (id, name, is_active, updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, is_active=excluded.is_active, updated_at=excluded.updated_at`,
        [r.id, r.name, r.isActive ? 1 : 0, r.updatedAt],
      );
    }

    for (const r of delta.progressionStyles ?? []) {
      await runSQL(
        `INSERT INTO local_progression_styles (id, name, updated_at)
         VALUES (?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`,
        [r.id, r.name, r.updatedAt],
      );
    }
  }

  // Outbox ────────────────────────────────────────────────────────────────────
  async queueMutation(m: Omit<PendingMutation, 'id' | 'createdAt'>): Promise<void> {
    await runSQL(
      `INSERT OR REPLACE INTO mutations_outbox (id, user_id, domain, date, payload, created_at)
       VALUES (?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      [crypto.randomUUID(), m.userId, m.domain, m.date, JSON.stringify(m.payload)],
    );
  }

  async getPendingMutations(userId: string): Promise<PendingMutation[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM mutations_outbox WHERE user_id = ? ORDER BY created_at`,
      [userId],
    );
    return rows.map(r => ({
      id:        String(r.id),
      userId:    String(r.user_id),
      domain:    String(r.domain) as PendingMutation['domain'],
      date:      String(r.date),
      payload:   JSON.parse(String(r.payload)),
      createdAt: String(r.created_at),
    }));
  }

  async deleteMutations(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    await runSQL(
      `DELETE FROM mutations_outbox WHERE id IN (${placeholders})`,
      ids,
    );
  }

  // Sync meta ─────────────────────────────────────────────────────────────────
  // Reuses the existing `sync_meta` table (created in migration v1) so the
  // lastSyncAt timestamp survives across store implementations.
  async getLastSyncAt(): Promise<Date> {
    const rows = await querySQL<{ value: string }>(
      `SELECT value FROM sync_meta WHERE key = 'lastSyncAt'`,
      [],
    );
    return rows.length ? new Date(rows[0].value) : new Date(0);
  }

  async setLastSyncAt(iso: string): Promise<void> {
    await runSQL(
      `INSERT INTO sync_meta (key, value) VALUES ('lastSyncAt', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [iso],
    );
  }
}
```

---

## Step 3 — Update `lib/local-store/index.ts`

Replace the Dexie dynamic require with an `isSQLiteAvailable()` check.

```ts
import { isSQLiteAvailable } from '@/lib/sqlite/sqlite-service';
import type {
  LocalBodyMetric, LocalMoodLog, LocalSleepSession, LocalWorkoutSession,
  LocalActivityLog, LocalProgram, LocalProgressionStyle, PendingMutation,
} from './types';

export interface LocalStore {
  // ... (unchanged — exact same interface as today)
}

const _stores = new Map<string, LocalStore>();

export function getLocalStore(userId: string): LocalStore | null {
  if (typeof window === 'undefined') return null;
  if (!isSQLiteAvailable()) return null;   // web users get online-only behavior
  if (!_stores.has(userId)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SQLiteLocalStore } = require('./sqlite-backend') as typeof import('./sqlite-backend');
    _stores.set(userId, new SQLiteLocalStore());
  }
  return _stores.get(userId)!;
}
```

Note: `SQLiteLocalStore` takes no constructor argument — it is stateless (all state lives in the SQLite file managed by the Capacitor plugin, which is already initialised by `SyncProvider` before any `getLocalStore()` call).

---

## Step 4 — Delete `lib/local-store/dexie-backend.ts`

Simply delete the file. The `DexieLocalStore` class and `destroyLocalStore` function are no longer referenced anywhere after Step 3.

If `destroyLocalStore` is called anywhere (e.g. a logout flow), replace it with a no-op or a `clearAllCache()` call as appropriate.

---

## Step 5 — Remove Dexie dependency

```bash
pnpm remove dexie
```

Commit `package.json` and `pnpm-lock.yaml` together.

---

## Step 6 — Update `lib/local-store/types.ts` — extend `PendingMutation` domain union

Plan 2 adds new domains, but the `PendingMutation` type already needs to be forward-compatible. After Plan 1 this stays as-is; Plan 2 will widen the `domain` field.

No changes needed here for Plan 1.

---

## Files Changed (summary)

| File | Action |
|------|--------|
| `lib/sqlite/migrations.ts` | Add `toVersion: 4` block |
| `lib/local-store/sqlite-backend.ts` | **Create** (new SQLiteLocalStore) |
| `lib/local-store/index.ts` | Swap Dexie require → SQLite check |
| `lib/local-store/dexie-backend.ts` | **Delete** |
| `package.json` + `pnpm-lock.yaml` | Remove `dexie` |

---

## Testing Checklist

1. **APK build:** Open app cold (no network). Verify mood check-in saves locally, body metric saves locally, both show in UI immediately.
2. **Sync push:** Restore network. `SyncProvider` should call `pushMutations` → pending rows disappear from `mutations_outbox`, server reflects the writes.
3. **Sync pull:** Log a new body weight on Railway directly (via admin UI or SQL). Open APK, wait for pull → weight appears in Health tab without manual refresh.
4. **Web fallback:** Open app in desktop browser. `isSQLiteAvailable()` returns false. All writes go direct to API (same as today). No errors in console.
5. **Dexie gone:** `pnpm build` completes without any Dexie import errors. No IndexedDB databases created in browser DevTools.
6. **WAL mode:** `PRAGMA journal_mode` returns `wal` when running a SQL inspection on the APK's SQLite file.

---

## Notes

- The `sync_meta` table (migration v1) already exists and `SQLiteLocalStore.getLastSyncAt` / `setLastSyncAt` reuse it. The Dexie `syncMeta` table stored the same key (`lastSyncAt`) — on first APK launch after the upgrade, `getLastSyncAt()` will return `new Date(0)` (the SQLite table is empty for this key) and a full pull will happen. This is correct and safe.
- `workout_sessions` already exists in SQLite (migration v1). `SQLiteLocalStore.getWorkoutSessions` reads from it directly — no data migration needed.
- Array fields (`body_state`, `sore_muscles`) are stored as JSON strings in TEXT columns. `JSON.parse()` in the mapper handles deserialization.
