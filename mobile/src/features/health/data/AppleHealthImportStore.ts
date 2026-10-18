import { acknowledgedUpload, isDeferredUpload } from './health-upload';
import { ApiError } from '../../account/api/client';
import { z } from 'zod';
import {
  appleImportBatch,
  appleTypes,
  type AppleSampleType,
  type AppleImportBatch,
} from '@trainingai/shared/validation/apple-health-import';
import type { ScopedStorage } from '../../../core/storage/LocalStorage';
import type { AccountConnection } from '../../account/session';
const resultSchema = z.object({
  measurements: z.number(),
  nights: z.number(),
  days: z.number(),
  heartRate: z.number(),
  completedAt: z.string(),
  hrv: z
    .object({
      method: z.literal('SDNN'),
      value: z.number(),
      at: z.string(),
      source: z.string(),
    })
    .nullable(),
});
const diskSchema = z.object({
  origin: z.string(),
  userId: z.string(),
  enabled: z.boolean(),
  from: z.string().datetime(),
  historyFrom: z.string().datetime().nullable().default(null),
  anchors: z.record(z.string(), z.string()),
  queue: z.array(
    z.union([
      z.custom<AppleImportBatch>((value) => appleImportBatch.safeParse(value).success),
      z.object({ rebuild: z.literal(true) }),
    ]),
  ),
  completed: resultSchema.nullable(),
  skipped: z.number(),
  needsRebuild: z.boolean(),
});
type Disk = z.infer<typeof diskSchema>;
export const emptyAppleImport = {
  ready: false,
  busy: false,
  error: null as string | null,
  pending: 0,
  enabled: false,
  completed: null as Disk['completed'],
  skipped: 0,
};
export type AppleImportPage = {
  samples: AppleImportBatch['samples'];
  deleted: string[];
  anchor: string;
  more: boolean;
  skipped: number;
};
export class AppleHealthImportStore {
  private disk: Disk;
  private state = emptyAppleImport;
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private canceled = false;
  private lastAttempt = 0;
  constructor(
    private storage: ScopedStorage,
    readonly connection: AccountConnection,
    private reader: (
      type: AppleSampleType,
      from: string,
      anchor?: string,
    ) => Promise<AppleImportPage | null>,
    private changed = () => {},
    private now = Date.now,
  ) {
    this.disk = {
      origin: connection.origin,
      userId: connection.userId,
      enabled: false,
      from: new Date(now() - 7 * 86400000).toISOString(),
      historyFrom: new Date(now() - 35 * 86400000).toISOString(),
      anchors: {},
      queue: [],
      completed: null,
      skipped: 0,
      needsRebuild: true,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(patch: Partial<typeof emptyAppleImport> = {}) {
    this.state = {
      ...this.state,
      enabled: this.disk.enabled,
      pending: this.disk.queue.length + (this.disk.enabled && this.disk.needsRebuild ? 1 : 0),
      completed: this.disk.completed,
      skipped: this.disk.skipped,
      ...patch,
    };
    for (const fn of this.listeners) {
      fn();
    }
  }
  async initialize() {
    if (this.initialization) {
      return this.initialization;
    }
    this.initialization = (async () => {
      try {
        const raw = await this.storage.get('apple-health-import.v1');
        if (raw) {
          const saved = diskSchema.parse(JSON.parse(raw));
          if (
            saved.origin !== this.connection.origin ||
            saved.userId !== this.connection.userId
          ) {
            throw new Error('Different account');
          }
          this.disk = saved;
        }
        if (!this.canceled) {
          this.publish({ ready: true });
        }
      } catch {
        if (!this.canceled) {
          this.publish({ error: 'Could not open saved health imports.' });
        }
      }
    })();
    return this.initialization;
  }
  private async write(next: Disk) {
    if (this.canceled) {
      return;
    }
    await this.storage.set('apple-health-import.v1', JSON.stringify(next));
    if (!this.canceled) {
      this.disk = next;
      this.publish();
    }
  }
  cancel() {
    this.canceled = true;
  }
  async setEnabled(enabled: boolean) {
    await this.initialize();
    await this.running;
    await this.write({ ...this.disk, enabled });
    if (enabled) {
      void this.run(true);
    }
  }
  async importHistory(from: string) {
    await this.initialize();
    await this.running;
    await this.write({
      ...this.disk,
      from,
      historyFrom: null,
      anchors: {},
      enabled: true,
      needsRebuild: true,
    });
    return this.run(true);
  }
  run(manual = false): Promise<void> {
    if (this.running) {
      return this.running;
    }
    if (this.canceled || (!manual && this.now() - this.lastAttempt < 300000)) {
      return Promise.resolve();
    }
    this.lastAttempt = this.now();
    const work = (async () => {
      await this.initialize();
      if (!this.state.ready || !this.disk.enabled || this.canceled) {
        return;
      }
      this.publish({ busy: true, error: null });
      try {
        const flush = async () => {
          let remaining = this.disk.queue.length;
          let rebuilds = 0;
          while (remaining-- > 0 && this.disk.queue.length && !this.canceled) {
            const item = this.disk.queue[0];
            if (!('rebuild' in item) && isDeferredUpload(item, this.now())) {
              await this.write({ ...this.disk, queue: [...this.disk.queue.slice(1), item] });
              continue;
            }

            let reply;
            try {
              reply = await this.connection.post('/api/apple-health/sync', item);
            } catch (error) {
              // #3045: a 400 is the server refusing this batch's shape, the same way every time. Left at
              // the head of the queue it blocked every later upload for good, so it is dropped and
              // counted as skipped. Any other failure (5xx, 429, offline) keeps it for retry.
              if (!('rebuild' in item) && error instanceof ApiError && error.status === 400) {
                await this.write({
                  ...this.disk,
                  queue: this.disk.queue.slice(1),
                  skipped: this.disk.skipped + item.samples.length + item.deleted.length,
                });
                continue;
              }
              if (!('rebuild' in item)) throw error;
              await this.write({ ...this.disk, queue: [...this.disk.queue.slice(1), item] });
              this.publish({ error: 'Health records are saved. Summaries need another sync.' });
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
            if ('rebuild' in item) completed = resultSchema.parse(reply);
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
        };
        await flush();
        let pages = 0;
        let unfinished = false;
        const order: AppleSampleType[] = [
          'HKCategoryTypeIdentifierSleepAnalysis',
          'HKQuantityTypeIdentifierRestingHeartRate',
          'HKQuantityTypeIdentifierStepCount',
          'HKQuantityTypeIdentifierActiveEnergyBurned',
          'HKQuantityTypeIdentifierBodyMass',
          'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
          'HKQuantityTypeIdentifierHeartRate',
        ];
        for (const type of order) {
          let more = true;
          while (more && !this.canceled) {
            const page = await this.reader(type, this.disk.from, this.disk.anchors[type]);
            if (this.canceled) {
              return;
            }
            if (!page) {
              break;
            }
            const queue = [...this.disk.queue];
            for (let i = 0; i < Math.max(page.samples.length, page.deleted.length); i += 500) {
              queue.push({
                type,
                samples: page.samples.slice(i, i + 500),
                deleted: page.deleted.slice(i, i + 500),
              });
            }
            await this.write({
              ...this.disk,
              anchors: { ...this.disk.anchors, [type]: page.anchor },
              queue,
              skipped: this.disk.skipped + page.skipped,
              needsRebuild: this.disk.needsRebuild || queue.length > 0,
            });
            await flush();
            more = page.more;
            if (++pages >= 40 && more) {
              unfinished = true;
              break;
            }
          }
          if (unfinished) {
            break;
          }
        }
        if (this.disk.needsRebuild && !this.canceled) {
          await this.write({
            ...this.disk,
            queue: this.disk.queue.some((item) => 'rebuild' in item)
              ? this.disk.queue
              : [...this.disk.queue, { rebuild: true }],
            needsRebuild: false,
          });
          await flush();
          if (unfinished) {
            await this.write({ ...this.disk, needsRebuild: true });
          } else if (this.disk.historyFrom) {
            await this.write({
              ...this.disk,
              from: this.disk.historyFrom,
              historyFrom: null,
              anchors: {},
              needsRebuild: true,
            });
          }
        }
      } catch {
        if (!this.canceled) {
          this.publish({
            error:
              'Could not sync Apple Health with your account. Saved records are kept for retry.',
          });
        }
      } finally {
        if (!this.canceled) {
          this.publish({ busy: false });
        }
      }
    })();
    this.running = work.finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
