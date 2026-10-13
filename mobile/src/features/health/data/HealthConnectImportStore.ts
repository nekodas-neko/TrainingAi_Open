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
  permissionKey: z.string(),
  scan: scanSchema.nullable(),
  needsRebuild: z.boolean(),
  skipped: z.number(),
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
};
export class HealthConnectImportStore {
  private disk: Disk;
  private state = emptyHealthConnectImport;
  private listeners = new Set<() => void>();
  private initializing: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private canceled = false;
  private lastAttempt = 0;
  constructor(
    private storage: ScopedStorage,
    readonly connection: AccountConnection,
    private reader: HealthConnectReader,
    private changed = () => {},
    private now = Date.now,
  ) {
    this.disk = {
      origin: connection.origin,
      userId: connection.userId,
      enabled: false,
      from: new Date(now() - 30 * 86400000).toISOString(),
      records: {},
      queue: [],
      token: null,
      permissionKey: '',
      scan: null,
      needsRebuild: false,
      skipped: 0,
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
      completed: this.disk.completed,
    };
    for (const fn of this.listeners) fn();
  }
  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        const raw = await this.storage.get('health-connect-import.v1');
        if (raw) {
          const saved = diskSchema.parse(JSON.parse(raw));
          if (
            saved.origin !== this.connection.origin ||
            saved.userId !== this.connection.userId
          )
            throw new Error('Wrong account');
          this.disk = saved;
        }
        if (!this.canceled) this.publish({ ready: true });
      } catch {
        if (!this.canceled)
          this.publish({ error: 'Could not open saved Health Connect imports.' });
      }
    })();
    return this.initializing;
  }
  private async write(next: Disk) {
    if (this.canceled) return;
    await this.storage.set('health-connect-import.v1', JSON.stringify(next));
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
    await this.write({ ...this.disk, from, token: null, scan: null, enabled: true });
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
    records = [...latest.values()].filter((row) => !removed.has(row.id));
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
      needsRebuild: this.disk.needsRebuild || records.length > 0 || deleted.length > 0,
    });
  }
  private async flush(types: HealthConnectType[]) {
    while (this.disk.queue.length && !this.canceled) {
      const item = this.disk.queue[0];
      if ('records' in item && item.records.some((row) => !types.includes(row.type)))
        throw new Error(
          'Restore the relevant Health Connect permissions to upload saved records.',
        );
      const reply = await this.connection.post('/api/health-connect/sync', item);
      if (this.canceled) return;
      let completed = this.disk.completed;
      if ('rebuild' in item) {
        completed = completedSchema.parse(reply);
      } else {
        const ack = z.object({ accepted: z.number(), deleted: z.number() }).parse(reply);
        if (ack.accepted !== item.records.length || ack.deleted !== item.deleted.length)
          throw new Error('Health records were not confirmed');
      }
      await this.write({ ...this.disk, queue: this.disk.queue.slice(1), completed });
      if ('rebuild' in item) this.changed();
    }
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
        await this.flush(types);
        const hasHistory = (await this.reader.hasHistoryPermission?.()) ?? false;
        const permissionKey = [...types].sort().join(',') + (hasHistory ? ':history' : '');
        if (permissionKey !== this.disk.permissionKey)
          await this.write({ ...this.disk, token: null, scan: null, permissionKey });
        if (!this.disk.token && !this.disk.scan) {
          const initial = await this.reader.changes(types);
          if (this.canceled) return;
          const from = new Date(
            Math.max(Date.parse(this.disk.from), hasHistory ? 0 : this.now() - 30 * 86400000),
          ).toISOString();
          await this.write({
            ...this.disk,
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
              { scan: null, token: scan.token, needsRebuild: true },
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
            await this.write({ ...this.disk, token: null });
            break;
          }
          await this.append(page.records, page.deleted, {
            token: page.token,
            skipped: this.disk.skipped + page.skipped,
          });
          await this.flush(types);
          more = page.more;
        }
        if (this.disk.needsRebuild && !this.canceled) {
          await this.write({
            ...this.disk,
            queue: [...this.disk.queue, { rebuild: true }],
            needsRebuild: false,
          });
          await this.flush(types);
        }
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
