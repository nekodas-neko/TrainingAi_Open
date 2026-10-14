import { PrescribedRunPatchBody } from '@trainingai/shared/validation/prescribed-run';
import { z } from 'zod';
import { msToHHMMInTz, toAestDay } from '@trainingai/shared/date-utils';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { AccountConnection } from '../../account/session.ts';
import {
  activityPayload,
  activityTypeSchema,
  type ActivityPayload,
  type ActivityType,
} from './models.ts';

import {
  guidanceSchema,
  fitnessPayloadSchema,
  fitnessResult,
  walkSegments,
  walkPlan,
  testDuration,
  type Guidance,
  type FitnessProfile,
} from './guidance.ts';

const sessionSchema = z.object({
  id: z.uuid(),
  type: activityTypeSchema,
  title: z.string().max(120),
  mode: z.enum(['pre', 'active', 'done']),
  startMs: z.number().nullable(),
  endMs: z.number().nullable(),
  pausedMs: z.number().nonnegative(),
  pauseStartMs: z.number().nullable(),
  notes: z.string().max(1000),
  distance: z.string(),
  guidance: guidanceSchema.optional(),
  target: z
    .object({
      label: z.string(),
      minutes: z.number().nullable(),
      hrLow: z.number(),
      hrHigh: z.number(),
    })
    .optional(),
});
export type ActivitySession = z.infer<typeof sessionSchema>;
const localRow = z.object({ payload: activityPayload, pending: z.boolean() });
const savedSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  session: sessionSchema.nullable(),
  rows: z.array(localRow),
  runs: z
    .array(
      z.object({ date: z.string(), payload: PrescribedRunPatchBody, pending: z.boolean() }),
    )
    .default([]),
  tests: z.array(z.object({ payload: fitnessPayloadSchema, pending: z.boolean() })).default([]),
});
type Data = Pick<z.infer<typeof savedSchema>, 'session' | 'rows' | 'tests' | 'runs'>;
export type ActivityState = Data & { ready: boolean; syncing: boolean; error: string | null };
export const emptyActivity: ActivityState = {
  session: null,
  rows: [],
  tests: [],
  runs: [],
  ready: false,
  syncing: false,
  error: null,
};
const key = 'activities.v1';
export function elapsedMs(session: ActivitySession, now: number) {
  if (session.startMs === null) {
    return 0;
  }
  return Math.max(
    0,
    (session.pauseStartMs ?? session.endMs ?? now) - session.startMs - session.pausedMs,
  );
}
export function sessionPayload(session: ActivitySession, timezone: string): ActivityPayload {
  if (session.mode !== 'done' || session.startMs === null || session.endMs === null) {
    throw new Error('Finish this activity before saving.');
  }
  const distanceKm = session.distance.trim()
    ? Number(session.distance.replace(',', '.'))
    : undefined;
  return activityPayload.parse({
    id: session.id,
    date: toAestDay(new Date(session.startMs), timezone),
    activityType: session.type.id,
    title: session.title.trim() || session.type.label,
    durationMin: Math.round(elapsedMs(session, session.endMs) / 6000) / 10,
    startTime: msToHHMMInTz(session.startMs, timezone),
    endTime: msToHHMMInTz(session.endMs, timezone),
    ...(distanceKm !== undefined ? { distanceKm } : {}),
    ...(session.guidance?.kind === 'walk'
      ? {
          segments: walkSegments(
            session.guidance.config,
            elapsedMs(session, session.endMs) / 1000,
          ),
        }
      : {}),
    ...(session.notes.trim() ? { notes: session.notes.trim() } : {}),
  });
}
export function sameActivityField(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((value, index) => sameActivityField(value, b[index]))
    );
  }
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const left = Object.entries(a)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const right = Object.entries(b)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return (
      left.length === right.length &&
      left.every(
        ([key, value], index) =>
          key === right[index][0] && sameActivityField(value, right[index][1]),
      )
    );
  }
  return false;
}
export function confirmedActivity(payload: ActivityPayload, rows: Record<string, unknown>[]) {
  return (
    rows.find(
      (row) =>
        z.uuid().safeParse(row.id).success &&
        (row.id === payload.id ||
          (!!payload.startTime && row.startTime === payload.startTime)) &&
        Object.entries(payload).every(
          ([field, value]) =>
            field === 'id' ||
            value === undefined ||
            (field === 'date'
              ? String(row.date).replace(/\//g, '-') === value
              : sameActivityField(row[field], value)),
        ),
    ) ?? null
  );
}
export class ActivityStore {
  private current: ActivityState = emptyActivity;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private generation = 0;
  constructor(
    private storage: ScopedStorage,
    private connection: AccountConnection,
    private uuid: () => string,
    private invalidate: () => void,
    private now = Date.now,
  ) {}
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ActivityState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async initialize() {
    const generation = this.generation;
    try {
      const raw = await this.storage.get(key);
      const data = raw ? savedSchema.parse(JSON.parse(raw)) : null;
      if (
        data &&
        (data.origin !== this.connection.origin || data.userId !== this.connection.userId)
      ) {
        throw new Error('Wrong account.');
      }
      if (generation === this.generation) {
        this.publish({
          ready: true,
          session: data?.session ?? null,
          rows: data?.rows ?? [],
          tests: data?.tests ?? [],
          runs: data?.runs ?? [],
          error: null,
        });
        void this.sync();
      }
    } catch {
      if (generation === this.generation) {
        this.publish({
          error: 'Could not open saved activities. Existing records have been kept.',
        });
      }
    }
  }
  private write(change: (data: Data) => Data) {
    const generation = this.generation;
    const result = this.writes.then(async () => {
      if (!this.current.ready || generation !== this.generation) {
        throw new Error('Account unavailable.');
      }
      const data = change(this.current);
      const value = savedSchema.parse({
        version: 1,
        origin: this.connection.origin,
        userId: this.connection.userId,
        ...data,
      });
      await this.storage.set(key, JSON.stringify(value));
      if (generation !== this.generation) {
        throw new Error('Account changed.');
      }
      this.publish({
        session: value.session,
        rows: value.rows,
        tests: value.tests,
        runs: value.runs,
        error: null,
      });
    });
    this.writes = result.catch(() => undefined);
    return result;
  }
  start(type: ActivityType, guidance?: Guidance) {
    return this.write((data) => {
      if (data.session) {
        throw new Error('Resume or discard your current activity first.');
      }
      return {
        ...data,
        session: {
          id: this.uuid(),
          type,
          title: type.label,
          mode: 'pre',
          startMs: null,
          endMs: null,
          pausedMs: 0,
          pauseStartMs: null,
          notes: '',
          distance: '',
          ...(guidance ? { guidance } : {}),
        },
      };
    });
  }
  update(
    patch: Partial<
      Pick<ActivitySession, 'title' | 'notes' | 'distance' | 'guidance' | 'target'>
    >,
  ) {
    return this.transition((session) => ({ ...session, ...patch }));
  }
  private transition(change: (session: ActivitySession) => ActivitySession) {
    return this.write((data) => {
      if (!data.session) {
        throw new Error('No activity in progress.');
      }
      return { ...data, session: change(data.session) };
    });
  }
  begin() {
    return this.transition((session) =>
      session.mode !== 'pre' ? session : { ...session, mode: 'active', startMs: this.now() },
    );
  }
  pause() {
    return this.transition((session) =>
      session.mode !== 'active'
        ? session
        : {
            ...session,
            pausedMs:
              session.pausedMs +
              (session.pauseStartMs === null
                ? 0
                : Math.max(0, this.now() - session.pauseStartMs)),
            pauseStartMs: session.pauseStartMs === null ? this.now() : null,
          },
    );
  }
  finish() {
    return this.transition((session) =>
      session.mode !== 'active'
        ? session
        : {
            ...session,
            mode: 'done',
            endMs: this.now(),
            pausedMs:
              session.pausedMs +
              (session.pauseStartMs === null
                ? 0
                : Math.max(0, this.now() - session.pauseStartMs)),
            pauseStartMs: null,
          },
    );
  }
  discard() {
    return this.write((data) => ({ ...data, session: null }));
  }
  async save(
    timezone: string,
    metrics: { avgHr?: number | null; maxHr?: number | null; steps?: number | null } = {},
  ) {
    await this.write((data) => {
      if (!data.session) {
        throw new Error('No activity to save.');
      }
      const payload = activityPayload.parse({
        ...sessionPayload(data.session, timezone),
        ...(metrics.avgHr != null ? { avgHr: Math.round(metrics.avgHr) } : {}),
        ...(metrics.maxHr != null ? { maxHr: Math.round(metrics.maxHr) } : {}),
        ...(metrics.steps != null ? { steps: metrics.steps } : {}),
      });
      return {
        ...data,
        session: null,
        rows: [
          ...data.rows.filter((row) => row.payload.id !== payload.id),
          { payload, pending: true },
        ],
      };
    });
    this.invalidate();
    void this.sync();
  }
  async completeRun(date: string, payload: unknown) {
    const record = PrescribedRunPatchBody.parse(payload);
    if (this.current.runs.some((row) => row.payload.id === record.id)) {
      return;
    }
    await this.write((data) => ({
      ...data,
      runs: [...data.runs, { date, payload: record, pending: true }],
    }));
    this.invalidate();
    void this.sync();
  }
  async recordCompleted(type: ActivityType, minutes: number) {
    const duration = z.number().positive().max(1440).parse(minutes);
    await this.start(type);
    await this.transition((session) => ({
      ...session,
      mode: 'done',
      startMs: this.now() - duration * 60000,
      endMs: this.now(),
    }));
  }
  async saveWalk(timezone: string) {
    await this.write((data) => {
      const session = data.session;
      if (!session || session.guidance?.kind !== 'walk' || session.guidance.saved) {
        return data;
      }
      if (elapsedMs(session, this.now()) < 60_000) {
        throw new Error('This walk is too short to save.');
      }
      const payload = sessionPayload(session, timezone);
      return {
        ...data,
        session: { ...session, guidance: { ...session.guidance, saved: true } },
        rows: [
          ...data.rows.filter((row) => row.payload.id !== payload.id),
          { payload, pending: true },
        ],
      };
    });
    this.invalidate();
    void this.sync();
  }
  async saveRecord(payload: unknown) {
    const record = activityPayload.parse(payload);
    await this.write((data) => ({
      ...data,
      rows: [
        ...data.rows.filter((row) => row.payload.id !== record.id),
        { payload: record, pending: true },
      ],
    }));
    this.invalidate();
    void this.sync();
  }
  async saveFitness(timezone: string, profile: FitnessProfile) {
    await this.write((data) => {
      if (!data.session) {
        throw new Error('No test to save.');
      }
      const result = fitnessResult(data.session, timezone, profile);
      const record = result.activity ? activityPayload.parse(result.activity) : null;
      return {
        ...data,
        session: null,
        rows: record
          ? [
              ...data.rows.filter((row) => row.payload.id !== record.id),
              { payload: record, pending: true },
            ]
          : data.rows,
        tests: [
          ...data.tests.filter((row) => row.payload.id !== result.payload.id),
          { payload: result.payload, pending: true },
        ],
      };
    });
    this.invalidate();
    void this.sync();
  }
  async finishGuided() {
    await this.transition((session) => {
      if (session.mode !== 'active' || !session.guidance || session.startMs === null) {
        return session;
      }
      const seconds =
        session.guidance.kind === 'walk'
          ? walkPlan(session.guidance.config).totalSec
          : testDuration(session.guidance.protocol);
      return {
        ...session,
        mode: 'done',
        endMs:
          seconds !== undefined
            ? Math.min(this.now(), session.startMs + seconds * 1000)
            : this.now(),
      };
    });
  }
  sync() {
    if (this.flushing) {
      return this.flushing;
    }
    if (
      !this.current.ready ||
      (!this.current.rows.some((row) => row.pending) &&
        !this.current.tests.some((row) => row.pending) &&
        !this.current.runs.some((row) => row.pending))
    ) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.publish({ syncing: true });
    this.flushing = this.flush(generation).finally(() => {
      if (generation === this.generation) {
        this.flushing = null;
        this.publish({ syncing: false });
      }
    });
    return this.flushing;
  }
  private async flush(generation: number) {
    try {
      await this.writes;
      while (generation === this.generation) {
        await this.writes;
        if (generation !== this.generation) {
          return;
        }
        const activityRow = this.current.rows.find((row) => row.pending);
        const row = activityRow ?? this.current.tests.find((row) => row.pending);
        const domain = activityRow ? 'activity_logs' : 'fitness_tests';
        if (!row) {
          const run = this.current.runs.find((row) => row.pending);
          if (!run) {
            return;
          }
          if (!this.connection.patch) {
            throw new Error('Run completion is unavailable.');
          }
          const response = z
            .object({
              run: z.object({
                id: z.string(),
                status: z.string(),
                activityLogId: z.string().nullish(),
                completedAs: z.string().nullish(),
              }),
            })
            .parse(
              await this.connection.patch(
                `/api/running-plan/runs/${run.payload.id}`,
                run.payload,
              ),
            );
          if (generation !== this.generation) {
            return;
          }
          if (
            Object.entries(run.payload).some(
              ([key, value]) =>
                value !== undefined && response.run[key as keyof typeof response.run] !== value,
            )
          ) {
            throw new Error('Run readback not confirmed.');
          }
          await this.write((data) => ({
            ...data,
            runs: data.runs.map((row) =>
              row.payload.id === run.payload.id ? { ...row, pending: false } : row,
            ),
          }));
          this.invalidate();
          continue;
        }
        const ack = z
          .object({ processed: z.literal(1), errors: z.array(z.unknown()).length(0) })
          .parse(
            await this.connection.post('/api/sync/push', {
              mutations: [
                {
                  id: row.payload.id,
                  domain,
                  date: row.payload.date,
                  payload: row.payload,
                },
              ],
            }),
          );
        if (!ack || generation !== this.generation) {
          return;
        }
        const response = await this.connection.get(
          domain === 'activity_logs' ? '/api/day-log' : '/api/fitness-tests',
          domain === 'activity_logs' ? { date: row.payload.date } : { days: '730' },
        );
        if (generation !== this.generation) {
          return;
        }
        const read = z
          .object({
            date: z.string().optional(),
            activityLogs: z.array(z.object({ id: z.string() }).passthrough()).optional(),
            fitnessTests: z.array(z.object({ id: z.string() }).passthrough()).optional(),
          })
          .parse(response);
        const confirmed = activityRow
          ? confirmedActivity(activityRow.payload, read.activityLogs ?? [])
          : read.fitnessTests?.find((log) => log.id === row.payload.id);
        if (
          !confirmed ||
          (!activityRow &&
            Object.entries(row.payload).some(
              ([field, value]) =>
                value !== undefined &&
                (field === 'date'
                  ? String(confirmed.date).replace(/\//g, '-') !== value
                  : !sameActivityField(confirmed[field], value)),
            ))
        ) {
          throw new Error('Readback not confirmed.');
        }
        await this.write((data) => ({
          ...data,
          rows: data.rows.map((item) =>
            activityRow &&
            item.payload.id === row.payload.id &&
            JSON.stringify(item.payload) === JSON.stringify(row.payload)
              ? {
                  ...item,
                  payload: { ...item.payload, id: String(confirmed.id) },
                  pending: false,
                }
              : item,
          ),
          session:
            activityRow && data.session?.id === activityRow.payload.id
              ? { ...data.session, id: String(confirmed.id) }
              : data.session,
          tests: data.tests.map((item) =>
            !activityRow &&
            item.payload.id === row.payload.id &&
            JSON.stringify(item.payload) === JSON.stringify(row.payload)
              ? { ...item, pending: false }
              : item,
          ),
        }));
        this.invalidate();
      }
    } catch {
      if (generation === this.generation) {
        this.publish({ error: 'Saved on this phone. Activities will upload when connected.' });
      }
    }
  }
  cancel() {
    this.generation++;
  }
  reconcile(ids: string[]) {
    if (!this.current.rows.some((row) => !row.pending && ids.includes(row.payload.id))) {
      return Promise.resolve();
    }
    return this.write((data) => ({
      ...data,
      rows: data.rows.filter((row) => row.pending || !ids.includes(row.payload.id)),
    }));
  }
}
