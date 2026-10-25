import { z } from 'zod';
import { MutationSchema } from '@trainingai/shared/sync/mutation-schema';
import {
  BodyMetadataPostSchema,
  validWaterMlDeltaOrNull,
} from '@trainingai/shared/validation/body-metrics';
import {
  parseManualNight,
  ManualSleepRemovePayloadSchema,
} from '@trainingai/shared/health/manual-sleep';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { AccountConnection } from '../../account/session.ts';
import { RefreshPolicy } from '../../../core/sync/RefreshPolicy.ts';
import { ApiError } from '../../account/api/client.ts';
import { toAestDay, weekStartForDay } from '@trainingai/shared/date-utils';
import { morningSchema, checkinSchema } from './checkin.ts';
import { dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin';
import {
  bodySpec,
  sleepSpec,
  bodySchema,
  sleepSchema,
  type BodyData,
  type SleepRow,
} from './models.ts';
import { failureNotice } from '../../../core/reporting/index.ts';
import { withLoggedDeviceSteps } from '@trainingai/shared/health/activity-steps';

const operationSchema = MutationSchema.extend({
  id: z.uuid(),
  domain: z.enum(['body_metrics', 'manual_sleep', 'manual_bedtime', 'day_checkins']),
  acknowledged: z.boolean().default(false),
  attempted: z.boolean().default(true),
}).superRefine((operation, context) => {
  const p = operation.payload;
  const valid =
    operation.domain === 'day_checkins'
      ? morningSchema.safeParse(p).success && dayCheckinHasAnswers(p)
      : operation.domain === 'manual_bedtime'
        ? z
            .object({ at: z.string().datetime({ offset: true }).nullable() })
            .strict()
            .safeParse(p).success
        : operation.domain === 'manual_sleep'
          ? (p.deleted === true
              ? ManualSleepRemovePayloadSchema
              : z
                  .object({
                    id: z.uuid(),
                    sleepStart: z.string().datetime({ offset: true }),
                    sleepEnd: z.string().datetime({ offset: true }),
                  })
                  .strict()
            ).safeParse(p).success
          : 'waterMlDelta' in p
            ? Object.keys(p).length === 1 &&
              typeof p.waterMlDelta === 'number' &&
              validWaterMlDeltaOrNull(p.waterMlDelta) !== null
            : Object.keys(p).length === 1 &&
              BodyMetadataPostSchema.safeParse(
                'bodyFatPct' in p ? { bodyFat: p.bodyFatPct } : p,
              ).success &&
              Object.values(p).every((v) => typeof v === 'number');
  if (!valid) {
    context.addIssue({ code: 'custom', message: 'Invalid health change.' });
  }
});
export type HealthOperation = z.infer<typeof operationSchema>;
const verdictResponseSchema = z.object({
  date: z.string(),
  state: z.enum(['acknowledged', 'corrected']),
});
const readinessResponseSchema = z.object({
  date: z.string(),
  state: z.enum(['rated', 'dismissed']),
});
const savedSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  body: bodySpec('').schema.nullable(),
  sleep: z.array(sleepSchema).nullable(),
  bodyAt: z.number(),
  sleepAt: z.number(),
  stale: z.boolean().default(false),
  operations: z.array(operationSchema),
  checkins: z.record(z.string(), checkinSchema.nullable()).default({}),
  verdictResponses: z.array(verdictResponseSchema).default([]),
  readinessResponses: z.array(readinessResponseSchema).default([]),
});
export type HealthState = {
  ready: boolean;
  body: BodyData | null;
  sleep: SleepRow[] | null;
  operations: HealthOperation[];
  bodyAt: number;
  sleepAt: number;
  syncing: boolean;
  refreshing: boolean;
  error: string | null;
  bodyError: string | null;
  sleepError: string | null;
  denied: boolean;
  stale: boolean;
  checkins: Record<string, z.infer<typeof checkinSchema> | null>;
  verdictResponses: z.infer<typeof verdictResponseSchema>[];
  readinessResponses: z.infer<typeof readinessResponseSchema>[];
};
export const emptyHealthState: HealthState = {
  ready: false,
  body: null,
  sleep: null,
  operations: [],
  bodyAt: 0,
  sleepAt: 0,
  syncing: false,
  refreshing: false,
  error: null,
  bodyError: null,
  sleepError: null,
  denied: false,
  stale: false,
  checkins: {},
  verdictResponses: [],
  readinessResponses: [],
};
const key = 'health-records.v1';
export class HealthStore {
  private current = emptyHealthState;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private canceled = false;
  private revision = 0;
  private initialization: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private reading: Promise<void> | null = null;
  private refreshAgain = false;
  private policy: RefreshPolicy;
  private policyDay: string | null = null;
  constructor(
    private storage: ScopedStorage,
    readonly connection: AccountConnection,
    private uuid: () => string,
    private invalidate = () => {},
    private now = Date.now,
  ) {
    this.policy = new RefreshPolicy(now, 300_000);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.current;
  private publish(patch: Partial<HealthState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  initialize() {
    if (this.initialization) {
      return this.initialization;
    }
    const generation = this.generation;
    this.initialization = (async () => {
      try {
        const raw = await this.storage.get(key);
        const saved = raw ? savedSchema.parse(JSON.parse(raw)) : null;
        if (
          saved &&
          (saved.origin !== this.connection.origin || saved.userId !== this.connection.userId)
        ) {
          throw new Error('Wrong account.');
        }
        if (generation !== this.generation) {
          return;
        }
        this.publish({ ...(saved ?? {}), ready: true, error: null });
        this.policyDay = toAestDay(
          new Date(saved?.bodyAt || this.now()),
          this.connection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
        if (saved?.bodyAt && saved.sleepAt && !saved.stale) {
          this.policy.succeeded(Math.min(saved.bodyAt, saved.sleepAt));
        }
      } catch (failure) {
        if (generation === this.generation) {
          this.publish({
            error: failureNotice(
              'Could not open saved health records. Existing records have been preserved.',
              failure,
            ),
          });
        }
      }
    })();
    return this.initialization;
  }
  private write(change: (state: HealthState) => Partial<HealthState>) {
    const generation = this.generation;
    const result = this.writes.then(async () => {
      if (generation !== this.generation) {
        throw new Error('Account changed.');
      }
      const next = { ...this.current, ...change(this.current) };
      await this.storage.set(
        key,
        JSON.stringify({
          ...next,
          version: 1,
          origin: this.connection.origin,
          userId: this.connection.userId,
        }),
      );
      if (generation === this.generation) {
        this.publish(next);
      }
    });
    this.writes = result.catch(() => undefined);
    return result;
  }
  async logMetric(field: 'weightKg' | 'bodyFat' | 'steps', value: number, date: string) {
    const payload = BodyMetadataPostSchema.parse({ [field]: value });
    await this.enqueue(
      'body_metrics',
      date,
      field === 'bodyFat' ? { bodyFatPct: payload.bodyFat } : payload,
    );
  }
  async addWater(ml: number, date: string) {
    const delta = validWaterMlDeltaOrNull(ml);
    if (delta === null) {
      throw new Error('Enter an amount greater than 0 and up to 5,000 ml.');
    }
    await this.enqueue('body_metrics', date, { waterMlDelta: delta });
  }
  async saveNight(sleepStart: string, sleepEnd: string, timezone: string, id?: string) {
    const input = { id: id ?? this.uuid(), sleepStart, sleepEnd };
    const parsed = parseManualNight(input, timezone, new Date(this.now()));
    if (!parsed.ok) {
      throw new Error(`That night cannot be saved: ${parsed.reason}.`);
    }
    await this.enqueue('manual_sleep', parsed.night.date, input);
  }
  async removeNight(id: string, date: string) {
    const night = overlaySleep(this.current.sleep ?? [], this.current.operations).find(
      (row) => row.id === id,
    );
    if (!night?.manualEntry) {
      throw new Error('Only a night entered by hand can be removed.');
    }
    await this.enqueue('manual_sleep', date, { id, deleted: true });
  }
  async rememberBedtime(date: string, at: string | null) {
    if (
      !overlaySleep(this.current.sleep ?? [], this.current.operations).some(
        (row) => row.date === date && !row.manualEntry,
      )
    ) {
      throw new Error('No measured sleep recorded for that night.');
    }
    await this.enqueue('manual_bedtime', date, { at });
  }
  async saveCheckin(
    date: string,
    payload: z.infer<typeof morningSchema>,
    response?: 'acknowledged' | 'corrected',
  ) {
    const parsed = morningSchema.parse(payload);
    if (!dayCheckinHasAnswers(parsed)) {
      throw new Error('Choose an answer before saving.');
    }
    await this.enqueue('day_checkins', date, parsed, response);
  }
  /**
   * Records that the owner disagreed with (or accepted) a sleep verdict, without a check-in.
   * Queued like the response that rides on a check-in save, so a tap made offline is sent later
   * rather than lost; the value itself is still written by the check-in.
   */
  async respondToVerdict(date: string, state: 'acknowledged' | 'corrected') {
    if (this.canceled || !this.current.ready || this.current.denied) {
      throw new Error('Check your account before responding to a sleep verdict.');
    }
    await this.write((current) => ({
      verdictResponses: [
        ...current.verdictResponses.filter((r) => r.date !== date),
        { date, state },
      ],
    }));
    void this.sync();
  }
  /**
   * Records that the owner answered or skipped the readiness question, queued like a sleep
   * verdict response so a tap made offline is sent later. It records that the question was
   * answered, never that the score was right; the answer itself is the check-in's `vsNormal`.
   */
  async respondToReadiness(date: string, state: 'rated' | 'dismissed') {
    if (this.canceled || !this.current.ready || this.current.denied) {
      throw new Error('Check your account before answering the readiness question.');
    }
    await this.write((current) => ({
      readinessResponses: [
        ...current.readinessResponses.filter((r) => r.date !== date),
        { date, state },
      ],
    }));
    void this.sync();
  }
  async readCheckin(date: string) {
    const generation = this.generation;
    const revision = this.revision;
    const data = checkinSchema
      .nullable()
      .parse(await this.connection.get('/api/day-checkin', { date, phase: 'morning' }));
    if (generation !== this.generation || revision !== this.revision) {
      return false;
    }
    if (
      !data &&
      this.current.operations.some(
        (op) => op.domain === 'day_checkins' && op.date === date && op.acknowledged,
      )
    ) {
      return false;
    }
    const covered = this.current.operations
      .filter((op) => op.domain === 'day_checkins' && op.date === date && op.acknowledged)
      .map((op) => op.id);
    await this.write((state) =>
      revision === this.revision
        ? {
            checkins: { ...state.checkins, [date]: data },
            operations: state.operations.filter((op) => !covered.includes(op.id)),
          }
        : {},
    );
    return revision === this.revision;
  }
  private async enqueue(
    domain: HealthOperation['domain'],
    date: string,
    payload: Record<string, unknown>,
    response?: 'acknowledged' | 'corrected',
  ) {
    if (this.canceled || !this.current.ready || this.current.denied) {
      throw new Error('Check your account before logging health records.');
    }
    const change = operationSchema.parse({
      id: this.uuid(),
      domain,
      date,
      payload,
      attempted: false,
    });
    this.revision++;
    await this.write((state) => ({
      operations: [...state.operations, change],
      error: null,
      ...(response
        ? {
            verdictResponses: [
              ...state.verdictResponses.filter((r) => r.date !== date),
              { date, state: response },
            ],
          }
        : {}),
    }));
    this.invalidate();
    void this.sync();
  }
  // `quiet` forces the read without showing the refreshing spinner, for background polling.
  refresh(manual = false, { quiet = false }: { quiet?: boolean } = {}) {
    if (this.reading) {
      return this.reading;
    }
    this.reading = (async () => {
      await this.initialize();
      const timezone =
        this.connection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const day = toAestDay(new Date(this.now()), timezone);
      if (this.policyDay !== day) {
        this.policyDay = day;
        this.policy.invalidate();
      }
      if (this.canceled || !this.current.ready || (!manual && !this.policy.shouldRefresh())) {
        return;
      }
      this.publish({ refreshing: manual && !quiet });
      const revision = this.revision;
      const results = await Promise.all([this.read('body_metrics'), this.read('manual_sleep')]);
      if (results.every(Boolean) && revision === this.revision) {
        try {
          await this.write(() => (revision === this.revision ? { stale: false } : {}));
          if (revision === this.revision) {
            this.policy.succeeded();
            this.publish({ denied: false });
          }
        } catch (failure) {
          this.publish({
            bodyError: failureNotice(
              'Could not save updated health records.',
              failure,
            ),
          });
          this.policy.failed();
        }
      } else {
        this.policy.failed();
      }
      this.publish({ refreshing: false });
    })().finally(() => {
      this.reading = null;
      if (this.refreshAgain && !this.canceled) {
        this.refreshAgain = false;
        this.policy.invalidate();
        return this.refresh();
      }
    });
    return this.reading;
  }
  private async read(domain: HealthOperation['domain']) {
    const generation = this.generation;
    const revision = this.revision;
    const covered = this.current.operations
      .filter(
        (op) =>
          op.domain !== 'day_checkins' &&
          (op.domain === 'body_metrics') === (domain === 'body_metrics') &&
          op.acknowledged,
      )
      .map((op) => op.id);
    try {
      const data =
        domain === 'body_metrics'
          ? bodySpec('').schema.parse(await this.connection.get('/api/body-metadata'))
          : sleepSpec('').schema.parse(await this.connection.get('/api/sleep-sessions'));
      if (generation !== this.generation || revision !== this.revision) {
        return false;
      }
      if (
        domain === 'body_metrics' &&
        this.current.operations.some(
          (op) =>
            op.domain === 'body_metrics' &&
            'waterMlDelta' in op.payload &&
            op.attempted &&
            !op.acknowledged,
        )
      ) {
        return false;
      }
      await this.write((state) =>
        revision !== this.revision
          ? {}
          : {
              ...(domain === 'body_metrics'
                ? { body: data as BodyData, bodyAt: this.now(), bodyError: null }
                : { sleep: data as SleepRow[], sleepAt: this.now(), sleepError: null }),
              operations: state.operations.filter((op) => !covered.includes(op.id)),
            },
      );
      return revision === this.revision;
    } catch (error) {
      if (generation === this.generation) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          this.publish({ denied: true, error: 'Check your account to access health records.' });
        }
        this.publish(
          domain === 'body_metrics'
            ? { bodyError: failureNotice('Could not refresh body measurements.', error) }
            : { sleepError: failureNotice('Could not refresh sleep records.', error) },
        );
      }
      return false;
    }
  }
  async invalidateRecords() {
    await this.initialize();
    if (this.canceled || !this.current.ready) {
      return;
    }
    this.revision++;
    this.policy.invalidate();
    try {
      await this.write(() => ({ stale: true }));
      this.policy.invalidate();
      if (this.reading) {
        this.refreshAgain = true;
      } else {
        await this.refresh();
      }
    } catch (failure) {
      this.publish({ bodyError: failureNotice('Could not save health refresh status.', failure) });
    }
  }
  sync() {
    if (this.flushing) {
      return this.flushing;
    }
    if (this.canceled || !this.current.ready || this.current.denied) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.publish({ syncing: true });
    this.flushing = (async () => {
      try {
        await this.writes;
        while (generation === this.generation && this.current.operations.length) {
          const change = this.current.operations[0];
          if (!change.acknowledged) {
            if (!change.attempted) {
              this.revision++;
              await this.write((state) => ({
                operations: state.operations.map((op) =>
                  op.id === change.id ? { ...op, attempted: true } : op,
                ),
              }));
            }
            const mutation = {
              id: change.id,
              domain: change.domain,
              date: change.date,
              payload: change.payload,
            };
            if (generation !== this.generation) {
              return;
            }
            const result = (await this.connection.post('/api/sync/push', {
              mutations: [mutation],
            })) as { processed?: number; errors?: unknown[] };
            if (generation !== this.generation) {
              return;
            }
            if (
              result.processed !== 1 ||
              !Array.isArray(result.errors) ||
              result.errors.length
            ) {
              throw new Error('Upload not confirmed.');
            }
            this.revision++;
            await this.write((state) => ({
              operations: state.operations.map((op) =>
                op.id === change.id ? { ...op, acknowledged: true } : op,
              ),
            }));
          }
          if (
            !(change.domain === 'day_checkins'
              ? await this.readCheckin(change.date)
              : await this.read(change.domain))
          ) {
            throw new Error('Readback not confirmed.');
          }
          this.invalidate();
        }
        while (generation === this.generation && this.current.verdictResponses.length) {
          const response = this.current.verdictResponses[0];
          await this.connection.post('/api/sleep-verdict', response);
          if (generation !== this.generation) {
            return;
          }
          await this.write((state) => ({
            verdictResponses: state.verdictResponses.filter((r) => r !== response),
          }));
          this.invalidate();
        }
        while (generation === this.generation && this.current.readinessResponses.length) {
          const response = this.current.readinessResponses[0];
          await this.connection.post('/api/readiness-verdict', response);
          if (generation !== this.generation) {
            return;
          }
          await this.write((state) => ({
            readinessResponses: state.readinessResponses.filter((r) => r !== response),
          }));
          this.invalidate();
        }
        if (generation === this.generation) {
          this.publish({ error: null });
        }
      } catch (failure) {
        if (generation === this.generation) {
          this.publish({
            error: failureNotice(
              'Saved on this phone. Health changes will upload when connected.',
              failure,
            ),
          });
        }
      }
    })().finally(() => {
      if (generation === this.generation) {
        this.flushing = null;
        this.publish({ syncing: false });
      }
    });
    return this.flushing;
  }
  cancel() {
    this.canceled = true;
    this.generation++;
  }
}
export function overlayBody(
  base: BodyData | null,
  operations: HealthOperation[],
  today: string,
): BodyData | null {
  const bodyChanges = operations.filter((op) => op.domain === 'body_metrics');
  if (!base && !bodyChanges.length) {
    return null;
  }
  const result = base
    ? { ...base, recent: [...base.recent] }
    : ({
        today: null,
        recent: [],
        latestWeightKg: null,
        latestWeightDate: null,
        activeEnergyKcalToday: null,
      } as BodyData);
  for (const op of bodyChanges) {
    const index = result.recent.findIndex((row) => row.date === op.date);
    const row = bodySchema.parse(index >= 0 ? result.recent[index] : { date: op.date });
    const previousSteps = row.steps;
    if (typeof op.payload.waterMlDelta === 'number') {
      row.waterMl = base ? (row.waterMl ?? 0) + op.payload.waterMlDelta : null;
    } else if (typeof op.payload.bodyFatPct === 'number') {
      row.bodyFat = op.payload.bodyFatPct;
      row.bodyFatCorrected = null;
      row.bodyFatIsCorrected = false;
    } else {
      // #3095: a logged step count replaces the device's count, not the treadmill-inclusive figure
      // the row may carry, so the tile keeps the session's steps after a save.
      const { steps, ...rest } = op.payload;
      Object.assign(row, rest);
      if (typeof steps === 'number') Object.assign(row, withLoggedDeviceSteps(row, steps));
    }
    if (result.weekToDate && op.date >= weekStartForDay(today) && op.date <= today) {
      result.weekToDate = { ...result.weekToDate };
      if (typeof op.payload.waterMlDelta === 'number' && result.weekToDate.waterMl !== null) {
        result.weekToDate.waterMl += op.payload.waterMlDelta;
      }
      if (typeof op.payload.steps === 'number' && result.weekToDate.steps !== null) {
        result.weekToDate.steps += (row.steps ?? 0) - (previousSteps ?? 0);
      }
    }
    if (index >= 0) {
      result.recent[index] = row;
    } else {
      result.recent.push(row);
    }
    if (op.date === today) {
      result.today = row;
    }
    if (
      row.weightKg !== null &&
      (!result.latestWeightDate || op.date >= result.latestWeightDate)
    ) {
      result.latestWeightKg = row.weightKg;
      result.latestWeightDate = op.date;
    }
    if (typeof op.payload.weightKg === 'number') {
      result.weightTrend = [
        ...(result.weightTrend ?? []).filter((point) => point.date !== op.date),
        { date: op.date, weightKg: op.payload.weightKg },
      ];
    }
  }
  result.recent.sort((a, b) => b.date.localeCompare(a.date));
  if (result.today?.date !== today) {
    result.today = null;
  }
  return result;
}
export function overlaySleep(base: SleepRow[], operations: HealthOperation[]): SleepRow[] {
  let rows = [...base];
  for (const op of operations.filter(
    (op) => op.domain === 'manual_sleep' || op.domain === 'manual_bedtime',
  )) {
    if (op.domain === 'manual_bedtime') {
      rows = rows.map((row) =>
        row.date === op.date
          ? {
              ...row,
              manualSleepStart: typeof op.payload.at === 'string' ? op.payload.at : null,
            }
          : row,
      );
      continue;
    }
    if (op.payload.deleted === true) {
      rows = rows.filter((row) => !(row.id === op.payload.id && row.manualEntry));
      continue;
    }
    if (rows.some((row) => row.date === op.date && !row.manualEntry)) {
      continue;
    }
    rows = rows.filter((row) => row.date !== op.date);
    rows.push(
      sleepSchema.parse({
        ...op.payload,
        date: op.date,
        manualEntry: true,
        durationHours:
          Math.round(
            (Date.parse(String(op.payload.sleepEnd)) -
              Date.parse(String(op.payload.sleepStart))) /
              36_000,
          ) / 100,
      }),
    );
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
