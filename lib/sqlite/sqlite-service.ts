import { Capacitor } from '@capacitor/core';
import { RECONCILE_COLUMNS, RECONCILE_TABLES } from './migrations';

export interface UpgradeStatement {
  toVersion: number;
  statements: string[];
}

// Lazily imported so this module doesn't crash in browser where the plugin is absent
type SQLiteDBConnection = import('@capacitor-community/sqlite').SQLiteDBConnection;

const DB_NAME = 'trainingai';
let _db: SQLiteDBConnection | null = null;
let _initPromise: Promise<void> | null = null;
// K4: the store is "dead" when the plugin is present (isSQLiteAvailable) but init
// tried and failed to open the DB (both the versioned upgrade AND the v1-reopen
// fallback threw). In that state runSQL/querySQL silently no-op, so a live store
// would lose every write behind a success toast. Callers treat this like web
// (getLocalStore returns null → the online API fallback), and a banner + one
// telemetry report make the degraded mode visible.
let _initFailed = false;

export function isSQLiteAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.isPluginAvailable('CapacitorSQLite')
  );
}

// True only on the canonical runtime when the local DB failed to open. False on
// web (plugin absent — that's normal online-only mode, not a failure) and while
// init has not been attempted yet.
export function isLocalStoreDead(): boolean {
  return isSQLiteAvailable() && _initFailed;
}

export async function initSQLite(upgrades: UpgradeStatement[]): Promise<void> {
  if (!isSQLiteAvailable()) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
      const conn = new SQLiteConnection(CapacitorSQLite);
      const dbVersion = upgrades[upgrades.length - 1]?.toVersion ?? 1;

      await conn.addUpgradeStatement(
        DB_NAME,
        upgrades.map(u => ({ toVersion: u.toVersion, statements: u.statements })),
      );

      // A WebView page reload (the offline screen's retry, a renderer restart, a `goto`) throws
      // away the JS side but NOT the native plugin: it still holds the `trainingai` connection
      // the old page opened, possibly with a transaction that page never got to commit. This
      // fresh SQLiteConnection's connection map is empty, and in @capacitor-community/sqlite 8.1.0
      // `isConnection()` only reads that JS map — it never asks native — so the guard that used
      // to sit here could not see the leftover. `createConnection` then threw "Connection
      // trainingai already exists" and every reload was misreported through the upgrade-failure
      // fallback below (#2386; the 2026-08-02 "leaked registration" on the S25 was the same thing,
      // as is a retry after a failed init in the same page).
      //
      // `checkConnectionsConsistency()` is the plugin's own API for this: it sends the JS map to
      // native, and when JS knows of no connection, native closes every one it holds
      // (CapacitorSQLite.java → closeAllConnections). Closing only closes the handle: committed
      // data is already on disk, and a transaction the dead page left open is rolled back by
      // SQLite as a unit (that page can never commit it). The DB file is not touched. If this
      // call fails we carry on exactly as before, and the fallback still recovers. Its result is
      // not logged: with an empty JS map it reports `false` on every cold start too, so it cannot
      // tell a reload from a fresh launch.
      try {
        await conn.checkConnectionsConsistency();
      } catch (e) {
        console.warn('[initSQLite] could not check native connections:', e);
      }

      let usedFallback = false;
      try {
        _db = await conn.createConnection(DB_NAME, false, 'no-encryption', dbVersion, false);
        await _db.open();
      } catch (upgradeErr) {
        // The versioned upgrade transaction failed — e.g. a non-idempotent
        // `ALTER TABLE ADD COLUMN` on a partially-applied version, which SQLite
        // rejects on retry with "duplicate column" and rolls the whole upgrade
        // back. A failed open would otherwise leave the ENTIRE local store dead
        // (every read returns empty), so freshly-logged data looks like it
        // vanished on reload. Instead: drop the half-open handle and reopen at
        // version 1. capacitor-sqlite never downgrades, so this opens the DB
        // as-is WITHOUT running the (broken) upgrade, and the idempotent
        // reconcileSchema() below then brings the schema current — creating any
        // missing table (e.g. food_items) or column via CREATE IF NOT EXISTS /
        // guarded ADD COLUMN. The store stays usable instead of half-broken.
        console.error('[initSQLite] version upgrade failed — reopening without upgrade + reconciling:', upgradeErr);
        usedFallback = true;
        try { await conn.closeConnection(DB_NAME, false); } catch { /* not registered/open — fine */ }
        _db = await conn.createConnection(DB_NAME, false, 'no-encryption', 1, false);
        await _db.open();
      }
      // Enable WAL outside any transaction — SQLite rejects the switch inside one, so it cannot
      // live in the migration statements (the plugin wraps those in a transaction).
      // PRAGMA journal_mode RETURNS a row, so it must go through query() — execute() fails with
      // "Queries can be performed using SQLiteDatabase query or rawQuery methods only" and WAL is
      // then silently never enabled (observed on the S25, 2026-08-02).
      try {
        const res = await _db.query('PRAGMA journal_mode=WAL;');
        const mode = (res.values?.[0] as { journal_mode?: string } | undefined)?.journal_mode;
        if (mode?.toLowerCase() !== 'wal') {
          console.warn('[initSQLite] journal_mode is', mode, '— WAL not active');
        }
      } catch (e) {
        console.warn('[initSQLite] could not enable WAL mode:', e);
      }
      const reconciled = await reconcileSchema(_db);

      // Stamp the schema version forward after a fallback open. Without this the poisoned upgrade
      // re-runs, re-fails and re-falls-back on EVERY launch, forever (observed on the S25 with
      // v13's `ALTER TABLE mutations_outbox ADD COLUMN attempts`, 2026-08-02) — leaving the store
      // permanently one bad moment away from a hard open failure. reconcileSchema is the declared
      // schema authority after a partial upgrade (CLAUDE.md), so once it has completed with no
      // errors the schema IS current and the version should say so. Only on a clean reconcile:
      // stamping over a partial one would retire the repair path with work still outstanding.
      if (usedFallback && reconciled) {
        try {
          await _db.execute(`PRAGMA user_version = ${dbVersion};`, false);
          console.warn('[initSQLite] schema reconciled — stamped user_version to', dbVersion);
        } catch (e) {
          console.error('[initSQLite] could not stamp user_version:', e);
        }
      }
      _initFailed = false; // a retry after a prior failure recovered
    } catch (err) {
      // Surface the real failure in device logs — the version upgrade can fail
      // silently and leave the local store unusable (e.g. missing sync_status).
      console.error('[initSQLite] failed to open/upgrade local DB:', err);
      _db = null;
      _initFailed = true;  // K4: mark the store dead so getLocalStore returns null
      _initPromise = null; // allow a retry on the next call instead of caching the rejection
      throw err;
    }
  })();

  return _initPromise;
}

// Belt-and-suspenders schema check run after every open. ADD COLUMN is not
// idempotent in SQLite, so a partially-applied version upgrade can leave the
// local store permanently missing columns. This adds only what's actually
// absent (guarded by PRAGMA table_info), so it's a safe no-op once the schema
// is whole and cannot corrupt an already-correct DB.
// Returns false if ANY statement failed — the caller must not stamp the schema version forward
// on a partial reconcile, or the missing piece would never be repaired again.
async function reconcileSchema(db: SQLiteDBConnection): Promise<boolean> {
  let ok = true;
  for (const stmt of RECONCILE_TABLES) {
    try {
      await db.execute(stmt);
    } catch (err) {
      ok = false;
      console.error('[reconcileSchema] failed to ensure table:', err);
    }
  }
  for (const { table, column, ddl } of RECONCILE_COLUMNS) {
    try {
      const info = await db.query(`PRAGMA table_info(${table})`);
      const cols = (info.values ?? []) as { name: string }[];
      if (cols.length === 0) continue; // table absent — leave to the migrations
      if (cols.some(c => c.name === column)) continue; // already present
      await db.run(ddl, []);
      console.warn(`[reconcileSchema] added missing column ${table}.${column}`);
    } catch (err) {
      ok = false;
      console.error(`[reconcileSchema] failed to reconcile ${table}.${column}:`, err);
    }
  }
  return ok;
}

// Whether a caller-managed transaction (beginTransaction/commitTransaction below) is
// currently open. The plugin's `run()` defaults its own `transaction` param to `true`,
// which auto-wraps EVERY individual call in its own begin+commit — so a manual
// BEGIN/[write]/[write]/COMMIT sequence built purely from runSQL calls silently
// self-commits after the first write, and the final COMMIT then fails with
// "no current transaction" (confirmed on-device 2026-07-23). Tracking this flag lets
// runSQL tell the plugin not to auto-wrap while a real outer transaction owns the work,
// without threading a parameter through every one of the dozens of call sites inside
// applyDeltaBody/logWorkoutLocally.
let _inTransaction = false;

/**
 * Block until an in-flight `initSQLite` has finished opening the DB.
 *
 * `_db` is null for the WHOLE of init — `open()` runs the versioned upgrade, then the WAL
 * pragma, then a full `reconcileSchema()` pass (a PRAGMA per reconciled column), so on the
 * first launch after a release that adds a migration this is seconds, not milliseconds.
 * `getLocalStore()` hands out a live store during that window (it only screens out the
 * *dead* store, K4), so without this wait every write silently no-ops and every read
 * returns empty — the caller sets `savedLocally = true`, skips its API fallback and shows a
 * success toast for a write that reached nothing. That is the K4 hazard exactly, in the one
 * state K4 did not cover: not-open-yet rather than failed-to-open.
 *
 * A rejected init is swallowed here on purpose — it has already set `_initFailed`, and the
 * `_db`-null check below turns it into the thrown error the write sites catch.
 */
async function awaitOpen(): Promise<void> {
  if (_db || !_initPromise) return;
  try { await _initPromise; } catch { /* init failed; handled by the _db check at the call site */ }
}

/** A local write that cannot reach the DB must fail loudly, never silently succeed. */
function unavailable(op: string): Error {
  return new Error(`Local store unavailable (${op}) — SQLite is not open`);
}

export async function runSQL(sql: string, values?: unknown[]): Promise<void> {
  await awaitOpen();
  // On web the plugin is absent and no store is ever handed out, so a stray call is a
  // genuine no-op. On the canonical runtime it is a lost write, and the write sites all
  // catch and fall back to the API — so throw and let them.
  if (!_db) {
    if (isSQLiteAvailable()) throw unavailable('write');
    return;
  }
  try {
    await _db.run(sql, values ?? [], !_inTransaction);
  } catch (err) {
    // Name the failing statement in the error. The Capacitor plugin's bare messages
    // (e.g. "no current transaction") hide WHICH write failed inside a big applyDelta —
    // so a surfaced sync error can point at the real cause instead of a generic symptom.
    const head = sql.trim().replace(/\s+/g, ' ').slice(0, 140);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SQL failed [${head}]: ${msg}`);
  }
}

// Real native transaction control (SQLiteDBConnection.beginTransaction/commitTransaction/
// rollbackTransaction) — NOT literal "BEGIN"/"COMMIT"/"ROLLBACK" SQL text through runSQL,
// which the plugin's per-call auto-wrap makes unreliable (see the _inTransaction comment
// above). Private on purpose: callers go through withTransaction below, which serialises them.
async function beginTransaction(): Promise<void> {
  await awaitOpen();
  if (!_db) {
    if (isSQLiteAvailable()) throw unavailable('transaction');
    return;
  }
  try {
    await _db.beginTransaction();
    _inTransaction = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SQL failed [BEGIN]: ${msg}`);
  }
}

async function commitTransaction(): Promise<void> {
  if (!_db) return;
  try {
    await _db.commitTransaction();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SQL failed [COMMIT]: ${msg}`);
  } finally {
    _inTransaction = false;
  }
}

async function rollbackTransaction(): Promise<void> {
  if (!_db) return;
  try {
    await _db.rollbackTransaction();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SQL failed [ROLLBACK]: ${msg}`);
  } finally {
    _inTransaction = false;
  }
}

// The tail of the transaction queue. Each withTransaction call chains onto it and replaces it,
// so transactions run strictly one after another. It never rejects.
let _txTail: Promise<void> = Promise.resolve();

/**
 * Run `fn` as ONE native transaction, after every transaction queued before it has finished.
 * The only way to open a local-store transaction.
 *
 * The plugin has one native connection and one transaction slot. Two callers each doing their
 * own begin → writes → commit used to interleave on it (#2386, seen right after a page reload;
 * a sync pull and the nutrition loader's own applyDelta can also overlap): the second BEGIN
 * failed "Already in transaction", its error handler then ROLLED BACK THE FIRST CALLER'S
 * transaction and cleared `_inTransaction`, so the first caller's remaining writes each
 * auto-committed on their own and its COMMIT failed "no current transaction" — half a delta on
 * disk, outside any transaction. Queuing makes that impossible: a BEGIN only runs once the
 * previous transaction has committed or rolled back.
 *
 * Rollback runs only for a transaction this call actually began. A failed BEGIN has nothing of
 * ours to roll back, and rolling back anyway is exactly how the old code destroyed someone
 * else's transaction.
 *
 * Not re-entrant: calling withTransaction from inside `fn` waits on itself forever. Nothing
 * nests today (the native slot would have refused a nested BEGIN anyway).
 *
 * What it does NOT cover: a plain runSQL from elsewhere that lands while a transaction is open
 * still runs inside it (runSQL cannot tell the owner's writes from a stranger's). That was
 * true before this change too.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const previous = _txTail;
  let release!: () => void;
  _txTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    await beginTransaction();
    try {
      const result = await fn();
      await commitTransaction();
      return result;
    } catch (err) {
      // A failed statement may have auto-aborted the transaction already, so ROLLBACK can
      // itself throw "no current transaction" — never let that mask the real error.
      try { await rollbackTransaction(); } catch { /* already rolled back */ }
      throw err;
    }
  } finally {
    release();
  }
}

export async function querySQL<T = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
): Promise<T[]> {
  await awaitOpen();
  // Reads stay soft: an empty result degrades a screen to its API fallback, where a throw
  // would blank it. The silent-loss hazard is on the write side.
  if (!_db) return [];
  const result = await _db.query(sql, values ?? []);
  return (result.values ?? []) as T[];
}
