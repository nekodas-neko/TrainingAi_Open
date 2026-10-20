import { acknowledgedUpload, isDeferredUpload } from './health-upload';
import { ApiError } from '../../account/api/client.ts';
import { z } from 'zod';
import {
  healthConnectBatch,
  healthConnectTypes,
  type HealthConnectType,
  type HealthConnectBatch,
  type HealthConnectRecord,
} from '@trainingai/shared/validation/health-connect-import';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { AccountConnection } from '../../account/session.ts';
import type { HealthConnectReader } from '../../../integrations/health-connect/types.ts';
import { failureNotice, reportError } from '../../../core/reporting/index.ts';
import { HealthConnectPersistence } from './health-connect-persistence.ts';
import { DEFAULT_TZ, midnightDaysAgoInTz } from '@trainingai/shared/date-utils';
import {
  FirstHandFilter,
  type FirstHandSources,
} from '@trainingai/shared/health/health-connect-origin';
/**
 * Health Connect's own read limit, an instant rule rather than a calendar window: without the
 * history permission an app reads back to 30 days before its first grant.
 */
const READ_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;
/** Records held back for a revoked permission are dropped, and counted as skipped, after this. */
const BLOCKED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A rescan after an expired token starts this many local days before the last good token,
 *  because a watch can sync a day's records to Health Connect days late. */
const RESCAN_OVERLAP_DAYS = 7;
const RESTORE_PERMISSION =
  'Restore the relevant Health Connect permissions to upload saved records.';
const completedSchema = z.object({
  measurements: z.number(),
  nights: z.number(),
  days: z.number(),
  heartRate: z.number(),
  completedAt: z.string(),
  hrv: z
    .object({
      method: z.literal('RMSSD'),
      value: z.number(),
      at: z.string(),
      source: z.string(),
    })
    .nullable(),
});
const scanSchema = z.object({
  types: z.array(z.enum(healthConnectTypes)),
  index: z.number().int().nonnegative(),
  pageToken: z.string().nullable(),
  from: z.string(),
  end: z.string(),
  oldIds: z.array(z.string()),
  seen: z.array(z.string()),
  token: z.string(),
});
const diskSchema = z.object({
  origin: z.string(),
  userId: z.string(),
  enabled: z.boolean(),
  from: z.string().datetime(),
  records: z.record(
    z.string(),
    z.object({
      id: z.string(),
      type: z.enum(healthConnectTypes),
      start: z.string(),
      modifiedAt: z.string(),
    }),
  ),
  queue: z.array(
    z.union([
      z.custom<HealthConnectBatch>((value) => healthConnectBatch.safeParse(value).success),
      z.object({ rebuild: z.literal(true) }),
    ]),
  ),
  token: z.string().nullable(),
  // When the token was last read successfully, so an expired one rescans from there (#3117).
  tokenAt: z.string().nullable().default(null),
  rescanFrom: z.string().nullable().default(null),
  // First seen with a permission granted: the floor of what Health Connect lets us read.
  grantedAt: z.string().nullable().default(null),
  // Records whose type lost its permission, held until it returns (#3117).
  blocked: z
    .array(
      z.object({
        batch: z.custom<HealthConnectBatch>((value) => healthConnectBatch.safeParse(value).success),
        since: z.string(),
      }),
    )
    .default([]),
  permissionKey: z.string(),
  scan: scanSchema.nullable(),
  needsRebuild: z.boolean(),
  skipped: z.number(),
  // Records left out as copies of data the server reads first-hand, per type (#3115). The last
  // sync's, not a running total (#3197).
  skippedFirstHand: z.record(z.string(), z.number()).default({}),
  // When records were first left out, kept until Oura Cloud reads as disconnected, then rescanned
  // from here so they are read after all (#3197).
  firstHandSince: z.string().nullable().default(null),
  completed: completedSchema.nullable(),
});
type Disk = z.infer<typeof diskSchema>;
export const emptyHealthConnectImport = {
  ready: false,
  busy: false,
  error: null as string | null,
  pending: 0,
  enabled: false,
  completed: null as Disk['completed'],
  skipped: 0,
  skippedFirstHand: {} as Record<string, number>,
};
const newFilter = (sources: FirstHandSources | null) =>
  new FirstHandFilter<HealthConnectRecord>(
    sources,
    (row) => row.sourcePackage,
    (row) => row.id,
  );
export class HealthConnectImportStore {
  private disk: Disk;
  private state = emptyHealthConnectImport;
  private listeners = new Set<() => void>();
  private initializing: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private canceled = false;
  private lastAttempt = 0;
  private persistence: HealthConnectPersistence;
  // One per run, so its counts are that run's (#3197); filters nothing until the run knows the connection.
  private filter = newFilter(null);
  constructor(
    storage: ScopedStorage,
    readonly connection: AccountConnection,
    private reader: HealthConnectReader,
    private changed = () => {},
    private now = Date.now,
    // `connectedSources` from the readiness payload; null when unknown, which filters nothing.
    private firstHandSources: () => Promise<FirstHandSources | null> = async () => null,
  ) {
    this.persistence = new HealthConnectPersistence(storage);
    this.disk = {
      origin: connection.origin,
      userId: connection.userId,
      enabled: false,
      from: midnightDaysAgoInTz(
        connection.timezone ?? DEFAULT_TZ,
        30,
        new Date(now()),
      ).toISOString(),
      records: {},
      queue: [],
      token: null,
      tokenAt: null,
      rescanFrom: null,
      grantedAt: null,
      blocked: [],
      permissionKey: '',
      scan: null,
      needsRebuild: false,
      skipped: 0,
      skippedFirstHand: {},
      firstHandSince: null,
      completed: null,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(patch: Partial<typeof emptyHealthConnectImport> = {}) {
    this.state = {
      ...this.state,
      ...patch,
      enabled: this.disk.enabled,
      pending:
        this.disk.queue.length +
        (this.disk.needsRebuild || this.disk.scan || (this.disk.enabled && !this.disk.token)
          ? 1
          : 0),
      skipped: this.disk.skipped,
      skippedFirstHand: this.disk.skippedFirstHand,
      completed: this.disk.completed,
    };
    for (const fn of this.listeners) fn();
  }
  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        const raw = await this.persistence.read();
        if (raw) {
          const saved = diskSchema.parse(raw);
          if (
            saved.origin !== this.connection.origin ||
            saved.userId !== this.connection.userId
          )
            throw new Error('Wrong account');
          this.disk = saved;
          // Moves the old single value across, or clears leftovers; a failure keeps what is saved
          // readable and the next write retries (#3121).
          await this.persistence.opened(saved).catch(reportError);
        }
        if (!this.canceled) this.publish({ ready: true });
      } catch (failure) {
        if (!this.canceled)
          this.publish({
            error: failureNotice(
              'Could not open saved Health Connect imports.',
              failure,
            ),
          });
      }
    })();
    return this.initializing;
  }
  private async write(next: Disk) {
    if (this.canceled) return;
    await this.persistence.write(next);
    if (!this.canceled) {
      this.disk = next;
      this.publish();
    }
  }
  cancel() {
    this.canceled = true;
  }
  private guard() {
    if (!this.state.ready || this.canceled)
      throw new Error('Saved Health Connect data is unavailable. Reopen the app to retry.');
  }
  async setEnabled(enabled: boolean) {
    try {
      await this.initialize();
      await this.running;
      this.guard();
      await this.write({ ...this.disk, enabled });
      if (enabled) void this.run(true);
    } catch (cause) {
      if (!this.canceled)
        this.publish({
          error:
            cause instanceof Error
              ? cause.message
              : 'Could not save Health Connect preferences.',
        });
      throw cause;
    }
  }
  async importHistory(from: string) {
    await this.initialize();
    await this.running;
    this.guard();
    if (!Number.isFinite(Date.parse(from)) || Date.parse(from) > this.now())
      throw new Error('Choose a valid history start date.');
    if (Date.parse(from) < Date.parse(this.disk.from)) {
      if (!this.reader.historyPermission) throw new Error('Extended history is unavailable.');
      await this.reader.historyPermission();
    }
    await this.write({
      ...this.disk,
      from,
      token: null,
      rescanFrom: null,
      scan: null,
      enabled: true,
    });
    return this.run(true);
  }
  private async append(
    records: HealthConnectRecord[],
    deleted: string[],
    patch: Partial<Disk> = {},
  ) {
    const latest = new Map<string, HealthConnectRecord>();
    for (const row of records) {
      const previous = latest.get(row.id);
      if (!previous || Date.parse(previous.modifiedAt) <= Date.parse(row.modifiedAt))
        latest.set(row.id, row);
    }
    const removed = new Set(deleted);
    // #3115: with Oura Cloud connected, the Oura app's own records are a second copy of what the
    // server reads from Oura's API. Left out and counted here, after the scan has marked them seen,
    // so a record imported before the connection is never read as deleted.
    // This is the one gate every record passes to be uploaded: the initial read, each scan page and
    // each change page all come through here (#3197).
    let firstHandSince = this.disk.firstHandSince;
    records = [...latest.values()].filter((row) => {
      if (removed.has(row.id)) return false;
      if (this.filter.admit(row.type, row)) return true;
      // Where a later rescan has to reach back to: the oldest record left out.
      if (!firstHandSince || Date.parse(row.start) < Date.parse(firstHandSince))
        firstHandSince = row.start;
      return false;
    });
    const skippedFirstHand = this.filter.counts();
    deleted = [...removed];
    const cache = { ...this.disk.records };
    for (const row of records) {
      if (!cache[row.id] || Date.parse(cache[row.id].modifiedAt) <= Date.parse(row.modifiedAt))
        cache[row.id] = {
          id: row.id,
          type: row.type,
          start: row.start,
          modifiedAt: row.modifiedAt,
        };
    }
    for (const id of deleted) delete cache[id];
    const queue = [...this.disk.queue];
    let chunk: HealthConnectRecord[] = [];
    let bytes = 0;
    const flush = () => {
      if (chunk.length) {
        queue.push({ records: chunk, deleted: [] });
        chunk = [];
        bytes = 0;
      }
    };
    for (const row of records) {
      const size = new TextEncoder().encode(JSON.stringify(row)).length;
      if (chunk.length && (chunk.length >= 100 || bytes + size > 1024 * 1024)) flush();
      chunk.push(row);
      bytes += size;
    }
    flush();
    for (let i = 0; i < deleted.length; i += 500)
      queue.push({ records: [], deleted: deleted.slice(i, i + 500) });
    await this.write({
      ...this.disk,
      ...patch,
      records: cache,
      queue,
      skippedFirstHand,
      firstHandSince,
      needsRebuild: this.disk.needsRebuild || records.length > 0 || deleted.length > 0,
    });
  }
  private async flush(types: HealthConnectType[]) {
    let remaining = this.disk.queue.length;
    let rebuilds = 0;
    while (remaining-- > 0 && this.disk.queue.length && !this.canceled) {
      const item = this.disk.queue[0];
      if ('records' in item && item.records.some((row) => !types.includes(row.type))) {
        // #3117: one revoked type used to stop the whole queue here, every run. Its records are
        // set aside until the permission returns, and the rest of the batch carries on (keeping
        // any retry backoff it had, which is checked next).
        const held = item.records.filter((row) => !types.includes(row.type));
        const ids = new Set(held.map((row) => row.id));
        const rest = { ...item, records: item.records.filter((row) => types.includes(row.type)) };
        const keep = rest.records.length || rest.deleted.length;
        await this.write({
          ...this.disk,
          queue: [...(keep ? [rest] : []), ...this.disk.queue.slice(1)],
          blocked: [
            // A record held again replaces its earlier copy rather than being held twice.
            ...this.disk.blocked.flatMap((entry) => {
              const records = entry.batch.records.filter((row) => !ids.has(row.id));
              return records.length ? [{ ...entry, batch: { records, deleted: [] } }] : [];
            }),
            { batch: { records: held, deleted: [] }, since: new Date(this.now()).toISOString() },
          ],
        });
        if (keep) remaining++;
        continue;
      }
      if (!('rebuild' in item) && isDeferredUpload(item, this.now())) {
        await this.write({ ...this.disk, queue: [...this.disk.queue.slice(1), item] });
        continue;
      }
      let reply;
      try {
        reply = await this.connection.post('/api/health-connect/sync', item);
      } catch (error) {
        // #2828 N3: a 400 is the server refusing this batch's shape, and it refuses it the same way
        // every time. Left at the head of the queue it blocked every later upload for good, so it is
        // dropped and counted as skipped. Any other failure keeps it for retry.
        if (!('rebuild' in item) && error instanceof ApiError && error.status === 400) {
          await this.write({
            ...this.disk,
            queue: this.disk.queue.slice(1),
            skipped: this.disk.skipped + item.records.length + item.deleted.length,
          });
          continue;
        }
        if (!('rebuild' in item)) throw error;
        await this.write({ ...this.disk, queue: [...this.disk.queue.slice(1), item] });
        this.publish({
          error: failureNotice(
            'Health records are saved. Summaries need another sync.',
            error,
          ),
        });
        continue;
      }
      if (this.canceled) return;
      let completed = this.disk.completed;
      const retry =
        'rebuild' in item
          ? (reply as { pending?: boolean }).pending
            ? item
            : null
          : acknowledgedUpload(item, reply);
      if ('rebuild' in item) completed = completedSchema.parse(reply);
      const refused =
        'rebuild' in item ? 0 : ((reply as { rejected?: unknown[] }).rejected?.length ?? 0);
      await this.write({
        ...this.disk,
        queue: [...this.disk.queue.slice(1), ...(retry ? [retry] : [])],
        skipped: this.disk.skipped + refused,
        completed,
        needsRebuild:
          this.disk.needsRebuild ||
          (!('rebuild' in item) &&
            ((reply as { accepted: number; deleted: number }).accepted > 0 ||
              item.deleted.length > 0)),
      });
      if ('rebuild' in item) {
        this.changed();
        if (retry && ++rebuilds < 8) remaining++;
      }
    }
  }
  /**
   * Puts set-aside records whose permission is back into the queue, and drops the ones held past
   * `BLOCKED_TTL_MS`, counting them as skipped.
   */
  private async release(types: HealthConnectType[]) {
    if (!this.disk.blocked.length) return;
    const now = this.now();
    const blocked: Disk['blocked'] = [];
    const queue: Disk['queue'] = [];
    let dropped = 0;
    for (const entry of this.disk.blocked) {
      const allowed = entry.batch.records.filter((row) => types.includes(row.type));
      const held = entry.batch.records.filter((row) => !types.includes(row.type));
      if (allowed.length) queue.push({ records: allowed, deleted: [] });
      if (!held.length) continue;
      if (now - Date.parse(entry.since) > BLOCKED_TTL_MS) dropped += held.length;
      else blocked.push({ ...entry, batch: { records: held, deleted: [] } });
    }
    if (!queue.length && !dropped) return;
    await this.write({
      ...this.disk,
      queue: [...this.disk.queue, ...queue],
      blocked,
      skipped: this.disk.skipped + dropped,
    });
  }
  /**
   * Where a full rescan starts (#3117). Without the history permission it reads the last 30
   * days; after a gap (`resumeFrom`: an expired token, or a permission change on a stale one) it
   * reaches back to the local midnight a week before the last good read instead, but never past
   * what Health Connect allows, 30 days before the first grant. Never before `disk.from`.
   */
  private rescanStart(hasHistory: boolean, resumeFrom: string | null) {
    const resume = resumeFrom
      ? midnightDaysAgoInTz(
          this.connection.timezone ?? DEFAULT_TZ,
          RESCAN_OVERLAP_DAYS,
          new Date(resumeFrom),
        ).getTime()
      : Infinity;
    const grantedAt = Date.parse(this.disk.grantedAt ?? new Date(this.now()).toISOString());
    const floor = hasHistory
      ? 0
      : Math.max(grantedAt - READ_LIMIT_MS, Math.min(this.now() - READ_LIMIT_MS, resume));
    return Math.max(Date.parse(this.disk.from), floor);
  }
  /**
   * Drops cached record ids older than any later rescan can start (#3121, #3143), so the cache
   * holds about the rescan window rather than everything since the grant. A record still queued
   * or held keeps its id, and so does anything during a scan, whose deletion check reads the
   * cache.
   */
  private async prune(hasHistory: boolean) {
    if (this.disk.scan) return;
    // #3143: where a rescan would start now. `now` and `tokenAt` only move forward, so while
    // the history permission stays as it is, a later rescan resuming from the last good read (or
    // from a gap already waiting) starts no earlier, and the floor advances with each sync
    // instead of staying at the grant.
    //
    // One accepted exception (the Orchestrator's ruling on #3145): granting the history
    // permission after no-history syncs starts that rescan at `disk.from`, below this floor. A
    // record older than the floor that was deleted in Health Connect since the last good read is
    // then not removed on the server. Records it still has are re-uploaded harmlessly (the server
    // keys on the record id). Keeping every id forever to close that is not worth it.
    const floor = this.rescanStart(hasHistory, this.disk.rescanFrom ?? this.disk.tokenAt);
    const waiting = new Set<string>();
    for (const item of this.disk.queue)
      if ('records' in item) for (const row of item.records) waiting.add(row.id);
    for (const entry of this.disk.blocked)
      for (const row of entry.batch.records) waiting.add(row.id);
    const records = Object.fromEntries(
      Object.entries(this.disk.records).filter(
        ([id, row]) => Date.parse(row.start) >= floor || waiting.has(id),
      ),
    );
    if (Object.keys(records).length !== Object.keys(this.disk.records).length)
      await this.write({ ...this.disk, records });
  }
  run(manual = false): Promise<void> {
    if (this.running) return this.running;
    if (this.canceled || (!manual && this.now() - this.lastAttempt < 300000))
      return Promise.resolve();
    this.lastAttempt = this.now();
    this.running = (async () => {
      await this.initialize();
      if (!this.state.ready || !this.disk.enabled || this.canceled) return;
      this.publish({ busy: true, error: null });
      try {
        const types = await this.reader.permissions();
        if (this.canceled) return;
        if (!types.length) throw new Error('No Health Connect read permissions are granted.');
        const firstHand = await this.firstHandSources().catch(() => null);
        if (this.canceled) return;
        // A new filter each run, so its counts are that sync's: a rescan reads records again and
        // must not count them twice.
        this.filter = newFilter(firstHand);
        // Oura Cloud reads as disconnected while records were left out: the change token is past
        // them, so rescan from when the first was left out. Server-side Oura Cloud rows stay.
        if (firstHand?.ouraCloud === false && this.disk.firstHandSince)
          await this.write({
            ...this.disk,
            token: null,
            scan: null,
            rescanFrom: this.disk.firstHandSince,
            firstHandSince: null,
          });
        if (!this.disk.grantedAt)
          await this.write({ ...this.disk, grantedAt: new Date(this.now()).toISOString() });
        const hasHistory = (await this.reader.hasHistoryPermission?.()) ?? false;
        await this.release(types);
        // Before the uploads, so an offline run still keeps the cache in bounds.
        await this.prune(hasHistory);
        await this.flush(types);
        const permissionKey = [...types].sort().join(',') + (hasHistory ? ':history' : '');
        if (permissionKey !== this.disk.permissionKey)
          await this.write({
            ...this.disk,
            token: null,
            // A stale token as well as a permission change still covers the gap since it.
            rescanFrom: this.disk.rescanFrom ?? this.disk.tokenAt,
            scan: null,
            permissionKey,
          });
        if (!this.disk.token && !this.disk.scan) {
          const initial = await this.reader.changes(types);
          if (this.canceled) return;
          const from = new Date(this.rescanStart(hasHistory, this.disk.rescanFrom)).toISOString();
          await this.write({
            ...this.disk,
            rescanFrom: null,
            scan: {
              types,
              index: 0,
              pageToken: null,
              from,
              end: new Date(this.now()).toISOString(),
              oldIds: Object.values(this.disk.records)
                .filter(
                  (row) =>
                    types.includes(row.type) && Date.parse(row.start) >= Date.parse(from),
                )
                .map((row) => row.id),
              seen: [],
              token: initial.token,
            },
          });
          await this.append(initial.records, initial.deleted, {
            skipped: this.disk.skipped + initial.skipped,
          });
          await this.flush(types);
        }
        let pages = 0;
        while (this.disk.scan && !this.canceled && pages++ < 40) {
          const scan = this.disk.scan;
          if (scan.index === scan.types.length) {
            const seen = new Set(scan.seen);
            await this.append(
              [],
              scan.oldIds.filter((id) => !seen.has(id)),
              { scan: null, token: scan.token, tokenAt: scan.end, needsRebuild: true },
            );
            await this.flush(types);
            break;
          }
          const page = await this.reader.history(
            scan.types[scan.index],
            scan.from,
            scan.end,
            scan.pageToken ?? undefined,
          );
          if (this.canceled) return;
          await this.append(page.records, [], {
            skipped: this.disk.skipped + page.skipped,
            scan: {
              ...scan,
              seen: [
                ...new Set([
                  ...scan.seen,
                  ...(page.seenIds ?? page.records.map((row) => row.id)),
                ]),
              ],
              pageToken: page.pageToken,
              index: scan.index + (page.pageToken ? 0 : 1),
            },
          });
          await this.flush(types);
        }
        let more = true;
        while (!this.disk.scan && this.disk.token && more && !this.canceled && pages++ < 40) {
          const page = await this.reader.changes(types, this.disk.token);
          if (this.canceled) return;
          if (page.expired) {
            await this.write({ ...this.disk, token: null, rescanFrom: this.disk.tokenAt });
            break;
          }
          await this.append(page.records, page.deleted, {
            token: page.token,
            tokenAt: new Date(this.now()).toISOString(),
            skipped: this.disk.skipped + page.skipped,
          });
          await this.flush(types);
          more = page.more;
        }
        if (this.disk.needsRebuild && !this.canceled) {
          await this.write({
            ...this.disk,
            queue: this.disk.queue.some((item) => 'rebuild' in item)
              ? this.disk.queue
              : [...this.disk.queue, { rebuild: true }],
            needsRebuild: false,
          });
          await this.flush(types);
        }
        // Everything else has gone; say what is still waiting on a permission.
        if (this.disk.blocked.length && !this.canceled)
          this.publish({ error: RESTORE_PERMISSION });
      } catch (error) {
        if (!this.canceled)
          this.publish({
            error:
              error instanceof Error
                ? error.message
                : 'Could not sync Health Connect. Saved records are kept for retry.',
          });
      } finally {
        if (!this.canceled) this.publish({ busy: false });
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
