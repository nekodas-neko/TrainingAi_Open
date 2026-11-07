// #3654. Which rows of a pulled page change something on this device.
//
// The server's cursor now sits ten minutes behind the pull's start (`SYNC_PULL_OVERLAP_MS`), so an
// incremental pull re-sends the last ten minutes' rows every time. Applying them is a no-op upsert;
// raising their `SyncedDomains` flag is not free, because each flag invalidates that domain's caches
// and the next visit loses its instant first paint. So a flag is raised only by a row the device does
// not already hold at the same `updated_at`.
//
// Conservative by construction: a row is "already held" only when the device holds its key with the
// identical `updated_at` string the pull carries, which is what the previous pull of that row wrote.
// Anything else (a different stamp, a row written on the device with its own stamp, a re-send that
// fills a column the held row lacks, a store that cannot answer) counts as a change, which is exactly
// the behaviour before the overlap existed.
import type { LocalStore } from './index';
import type { HeldTable } from './held-tables';

type PulledRow = { updatedAt?: unknown; deletedAt?: unknown };

export type FreshCheck = <R extends PulledRow>(table: HeldTable, rows: R[], key: (row: R) => string) => Promise<boolean>;

/** True when any row would change what this device holds. */
export function freshnessFor(store: LocalStore): FreshCheck {
  return async (table, rows, key) => {
    if (rows.length === 0) return false;
    if (!store.heldUpdatedAt) return true;
    const held = await store.heldUpdatedAt(table, rows.map(key));
    return rows.some(r => {
      const k = key(r);
      // A tombstone for a row this device never had (or already dropped) changes nothing on screen.
      const have = held.get(k);
      if (!have) return !r.deletedAt;
      if (have.updatedAt !== (r.updatedAt == null ? null : String(r.updatedAt))) return true;
      // An equal-stamp re-send still fills a column an older device schema left empty.
      return have.emptyFields.some(f => (r as Record<string, unknown>)[f] != null);
    });
  };
}

/** Every pulled row counts as a change: full re-pulls and restores, which run rarely and on purpose. */
export const everyRowIsFresh: FreshCheck = async (_table, rows) => rows.length > 0;
