import { PrescribedRunPatchBody } from '@trainingai/shared/validation/prescribed-run';
import { resolveFailedOutboxIds } from '@trainingai/shared/sync/push-retry';
import { countRefusal, rejectionSchema, type Rejection } from '../../../core/sync/set-aside.ts';
import { z } from 'zod';
import { deadLettered, discardRow, retryRow, type QueueList } from './sync-health.ts';
import { msToHHMMInTz, toAestDay } from '@trainingai/shared/date-utils';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { AccountConnection } from '../../account/session.ts';
import { isRefusedByServer } from '../../account/api/client.ts';
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
import { failureNotice } from '../../../core/reporting/index.ts';
import { routeUntil, summariseRoute } from '@trainingai/shared/activity/route-summary';
import { CadenceLog, WalkPace, walkSegmentStats, type PaceSnapshot } from './walk-pace.ts';
import { hrFields, hrSamples, type HrWindow } from './hr-window.ts';
import { supportsCadence } from '@trainingai/shared/health/cadence';
import {
  keepsFix,
  liveRouteStats,
  routeEligible,
  routePointSchema,
  type RoutePoint,
} from './route-recording.ts';
import { backgroundNotification } from './background-recording.ts';
import type { ServiceClock, ServiceNotification } from '../../../integrations/activity-service/shared-service.ts';

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
// A refused row keeps the server's words on it (`core/sync/set-aside.ts`): backoff, then
// dead-lettered, when the flush skips it and Sync health's Retry / Discard reads it.
const rejection = rejectionSchema;
export type { Rejection };
export { deadLettered };
const localRow = z.object({
  payload: activityPayload,
  pending: z.boolean(),
  rejected: rejection.optional(),
});
const savedSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  session: sessionSchema.nullable(),
  rows: z.array(localRow),
  runs: z
    .array(
      z.object({
        date: z.string(),
        payload: PrescribedRunPatchBody,
        pending: z.boolean(),
        rejected: rejection.optional(),
      }),
    )
    .default([]),
  tests: z
    .array(
      z.object({
        payload: fitnessPayloadSchema,
        pending: z.boolean(),
        rejected: rejection.optional(),
      }),
    )
    .default([]),
});
// The recording's GPS points, kept apart from the main record so a fix every few seconds does not
// rewrite every saved activity with it. Tied to the recording by its start time, which is set once
// at Start and survives the session's ID being replaced by the server's after an upload.
const routeSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  startMs: z.number(),
  points: z.array(routePointSchema),
});
// The guided walk's pacer tally and cadence readings, written with the route at each checkpoint and
// tied to the recording the same way, so a kill mid-walk keeps its adherence and cadence (#3549).
const bandCounts = z.object({
  green: z.number(),
  amber: z.number(),
  red: z.number(),
  stopped: z.number(),
});
const paceSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  startMs: z.number(),
  tallies: z.record(
    z.string(),
    z.object({
      cadence: bandCounts.optional(),
      speed: bandCounts.optional(),
      hr: bandCounts.optional(),
    }),
  ),
  readings: z.array(z.tuple([z.number(), z.number()])),
});
type Data = Pick<z.infer<typeof savedSchema>, 'session' | 'rows' | 'tests' | 'runs'>;
export type ActivityState = Data & {
  route: RoutePoint[];
  ready: boolean;
  syncing: boolean;
  error: string | null;
};
export const emptyActivity: ActivityState = {
  session: null,
  rows: [],
  tests: [],
  runs: [],
  route: [],
  ready: false,
  syncing: false,
  error: null,
};
const key = 'activities.v1';
const routeKey = 'activities.route.v1';
const paceKey = 'activities.pace.v1';
// At most this long between route checkpoints, so a kill loses a few seconds of points at most.
export const ROUTE_CHECKPOINT_MS = 5000;
export function elapsedMs(session: ActivitySession, now: number) {
  if (session.startMs === null) {
    return 0;
  }
  return Math.max(
    0,
    (session.pauseStartMs ?? session.endMs ?? now) - session.startMs - session.pausedMs,
  );
}
/**
 * The notification clock for an activity under way (#3626), from the same `elapsedMs` the screen
 * shows. Running, it counts up from the start moved on by the time already paused, so the system
 * chronometer keeps time with the app suspended; paused, it is the frozen elapsed time. The current
 * app's run chip counts up from a fixed start the same way (`lib/native/run-status-chip.ts`).
 */
export function activityClock(session: ActivitySession): ServiceClock | null {
  if (session.mode !== 'active' || session.startMs === null) {
    return null;
  }
  return {
    startedAt: session.startMs + session.pausedMs,
    pausedElapsedMs: session.pauseStartMs === null ? null : elapsedMs(session, session.pauseStartMs),
  };
}
/** What the activity notification says while the activity runs: the service text and its clock. */
export function activityServiceNotification(session: ActivitySession): ServiceNotification | null {
  const clock = activityClock(session);
  return clock ? { ...backgroundNotification(session), clock } : null;
}
// The recording screen's live readout: distance over active time to now. Measured to now, not to
// the last fix: a pause that ended after the last fix is already subtracted, and measuring to the
// fix then read 0:00/km after every resume.
export function liveRouteReadout(session: ActivitySession, route: RoutePoint[], now: number) {
  return liveRouteStats(route, elapsedMs(session, now) / 1000);
}
/** A free walk, run, hike or treadmill: the recordings that save the strap's cadence (#3648). */
export function logsCadence(session: { type: { id: string }; guidance?: unknown }) {
  return !session.guidance && supportsCadence(session.type.id);
}
/**
 * The route a finished activity keeps: the fixes up to its end. A guided walk that ended with the
 * phone locked kept recording until the screen's timer next ran (#3674); a free activity has no
 * fixes after its end, so this changes nothing there.
 */
export function finishedRoute(session: ActivitySession, route: RoutePoint[]): RoutePoint[] {
  return session.endMs === null ? route : routeUntil(route, session.endMs);
}
export function sessionPayload(
  session: ActivitySession,
  timezone: string,
  allFixes: RoutePoint[] = [],
  pace: WalkPace | null = null,
  recorded: { hr?: HrWindow | null; cadence?: CadenceLog | null } = {},
): ActivityPayload {
  if (session.mode !== 'done' || session.startMs === null || session.endMs === null) {
    throw new Error('Finish this activity before saving.');
  }
  const route = finishedRoute(session, allFixes);
  // The same fields the current app saves for a GPS activity, with the average pace over the
  // activity's active time, the seconds its duration counts (#3092).
  const summary = routeEligible(session)
    ? summariseRoute(route, elapsedMs(session, session.endMs) / 1000)
    : null;
  const { distanceKm: routeKm, ...routeFields } = summary ?? {};
  const distanceKm = summary
    ? routeKm || undefined
    : session.distance.trim()
      ? Number(session.distance.replace(',', '.'))
      : undefined;
  const activeSec = elapsedMs(session, session.endMs) / 1000;
  const cadence =
    recorded.cadence && recorded.cadence.startMs === session.startMs && logsCadence(session)
      ? recorded.cadence
      : null;
  return activityPayload.parse({
    id: session.id,
    date: toAestDay(new Date(session.startMs), timezone),
    activityType: session.type.id,
    title: session.title.trim() || session.type.label,
    durationMin: Math.round(elapsedMs(session, session.endMs) / 6000) / 10,
    startTime: msToHHMMInTz(session.startMs, timezone),
    endTime: msToHHMMInTz(session.endMs, timezone),
    ...(distanceKm !== undefined ? { distanceKm } : {}),
    ...routeFields,
    // The walk's avg and max HR, and any free activity's: the window's strap or ring readings.
    ...hrFields(recorded.hr),
    ...(cadence ? cadence.payload(activeSec) : {}),
    ...(session.guidance?.kind === 'walk'
      ? (() => {
          const segments = walkSegments(session.guidance.config, activeSec);
          const samples = hrSamples(recorded.hr);
          const walkRoute = routeEligible(session) ? route : [];
          // Each block's HR, distance and pace, as the current app's walk saves them (#3641). A walk
          // paced from the strap also stores its cadence and each block's adherence (#2242).
          return pace && pace.startMs === session.startMs
            ? {
                segments: pace.segments(segments, samples, walkRoute),
                ...pace.cadencePayload(activeSec),
              }
            : {
                segments: walkSegmentStats({
                  segments,
                  startMs: session.startMs!,
                  hrSamples: samples,
                  route: walkRoute,
                }),
              };
        })()
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
// Whether a server activity row holds a value this phone saved. The row's date may come back with
// slashes, and its start and end times come back with seconds ("12:07:00", a Postgres `time`)
// where the phone sends "12:07"; compared exactly, no activity upload was ever confirmed.
export function sameActivityValue(field: string, row: unknown, value: unknown) {
  if (field === 'date') {
    return String(row).replace(/\//g, '-') === value;
  }
  if (field === 'startTime' || field === 'endTime') {
    return typeof row === 'string' && row.slice(0, 5) === value;
  }
  return sameActivityField(row, value);
}
export function confirmedActivity(payload: ActivityPayload, rows: Record<string, unknown>[]) {
  return (
    rows.find(
      (row) =>
        z.uuid().safeParse(row.id).success &&
        (row.id === payload.id ||
          (!!payload.startTime &&
            sameActivityValue('startTime', row.startTime, payload.startTime))) &&
        Object.entries(payload).every(
          ([field, value]) =>
            field === 'id' || value === undefined || sameActivityValue(field, row[field], value),
        ),
    ) ?? null
  );
}
export class ActivityStore {
  // The guided walk's live pacer and what it has recorded. Kept in memory and tied to the walk by its
  // start time; a kill mid-walk loses the cadence of that walk, not the walk (#3525).
  pace: WalkPace | null = null;
  // A free walk's, run's, hike's or treadmill's cadence readings, tied to it the same way (#3648).
  cadence: CadenceLog | null = null;
  // What a kill left of the walk's pacer, held until the walk's own pacer is created and restored.
  private savedPace: PaceSnapshot | null = null;
  private current: ActivityState = emptyActivity;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private generation = 0;
  private routeWrites: Promise<unknown> = Promise.resolve();
  private routeSavedMs = -Infinity;
  private routeTimer: ReturnType<typeof setTimeout> | null = null;
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
      const route = await this.loadRoute(data?.session?.startMs ?? null);
      const savedPace = await this.loadPace(data?.session?.startMs ?? null);
      if (generation === this.generation) {
        this.savedPace = savedPace;
        this.publish({
          ready: true,
          session: data?.session ?? null,
          rows: data?.rows ?? [],
          tests: data?.tests ?? [],
          runs: data?.runs ?? [],
          route,
          error: null,
        });
        void this.sync();
      }
    } catch (failure) {
      if (generation === this.generation) {
        this.publish({
          error: failureNotice(
            'Could not open saved activities. Existing records have been kept.',
            failure,
          ),
        });
      }
    }
  }
  // A route from another recording, or another account, is never attached to this one. Leftovers
  // are what a kill between saving an activity and clearing its route leaves behind.
  private async loadRoute(startMs: number | null) {
    const raw = await this.storage.get(routeKey);
    let saved: ReturnType<typeof routeSchema.safeParse> | null = null;
    try {
      saved = raw ? routeSchema.safeParse(JSON.parse(raw)) : null;
    } catch {}
    if (
      saved?.success &&
      startMs !== null &&
      saved.data.startMs === startMs &&
      saved.data.origin === this.connection.origin &&
      saved.data.userId === this.connection.userId
    ) {
      return saved.data.points;
    }
    if (raw) {
      await this.storage.remove(routeKey);
    }
    return [];
  }
  // The same rule for the pacer's tally: only this recording's, only this account's.
  private async loadPace(startMs: number | null) {
    const raw = await this.storage.get(paceKey);
    let saved: ReturnType<typeof paceSchema.safeParse> | null = null;
    try {
      saved = raw ? paceSchema.safeParse(JSON.parse(raw)) : null;
    } catch {}
    if (
      saved?.success &&
      startMs !== null &&
      saved.data.startMs === startMs &&
      saved.data.origin === this.connection.origin &&
      saved.data.userId === this.connection.userId
    ) {
      return { startMs, tallies: saved.data.tallies, readings: saved.data.readings };
    }
    if (raw) {
      await this.storage.remove(paceKey);
    }
    return null;
  }
  // Records one fix from the location adapter. Kept only while a route-recording activity is
  // running and not paused, and only past the current app's 5 m filter.
  appendFix(point: RoutePoint) {
    const session = this.current.session;
    if (
      !this.current.ready ||
      !session ||
      session.mode !== 'active' ||
      session.pauseStartMs !== null ||
      !routeEligible(session) ||
      !keepsFix(this.current.route.at(-1), point)
    ) {
      return false;
    }
    this.publish({ route: [...this.current.route, point] });
    this.scheduleCheckpoint();
    return true;
  }
  // At most one checkpoint per ROUTE_CHECKPOINT_MS: now if the last is old enough, else on a timer.
  private scheduleCheckpoint() {
    if (this.now() - this.routeSavedMs >= ROUTE_CHECKPOINT_MS) {
      void this.checkpoint().catch(() => {});
    } else if (!this.routeTimer) {
      this.routeTimer = setTimeout(
        () => {
          this.routeTimer = null;
          void this.checkpoint().catch(() => {});
        },
        ROUTE_CHECKPOINT_MS - (this.now() - this.routeSavedMs),
      );
    }
  }
  // The guided walk's pacer has counted another second, or a free activity's cadence has a new
  // reading. A recording with no route (a treadmill) has no fixes to trigger a checkpoint, so the
  // tally asks for one here.
  pacerUpdated() {
    const session = this.current.session;
    if (
      this.current.ready &&
      session?.mode === 'active' &&
      (this.pace?.startMs === session.startMs || this.cadence?.startMs === session.startMs)
    )
      this.scheduleCheckpoint();
  }
  // Writes the route as it stands. Called on a timer while recording, and on pause, finish and the
  // app leaving the foreground, so the points survive the app being killed or the phone restarting.
  checkpoint() {
    const generation = this.generation;
    if (this.routeTimer) {
      clearTimeout(this.routeTimer);
      this.routeTimer = null;
    }
    this.routeSavedMs = this.now();
    const result = this.routeWrites.then(async () => {
      const session = this.current.session;
      if (generation !== this.generation || !session || session.startMs === null) {
        return;
      }
      await this.storage.set(
        routeKey,
        JSON.stringify(
          routeSchema.parse({
            version: 1,
            origin: this.connection.origin,
            userId: this.connection.userId,
            startMs: session.startMs,
            points: this.current.route,
          }),
        ),
      );
      // The pacer's tally rides along, and a failure to keep it never costs the route above.
      const pace = this.pace;
      const cadence = this.cadence;
      const snapshot =
        pace && pace.startMs === session.startMs && pace.hasData
          ? () => pace.snapshot()
          : cadence && cadence.startMs === session.startMs && cadence.hasData
            ? () => ({ startMs: cadence.startMs, tallies: {}, readings: cadence.snapshot() })
            : null;
      if (snapshot) {
        // Built inside the guard too: a bad number in the snapshot must not reject the checkpoint.
        await Promise.resolve()
          .then(() =>
            this.storage.set(
              paceKey,
              JSON.stringify(
                paceSchema.parse({
                  version: 1,
                  origin: this.connection.origin,
                  userId: this.connection.userId,
                  ...snapshot(),
                }),
              ),
            ),
          )
          .catch(() => {});
      }
    });
    this.routeWrites = result.catch(() => undefined);
    return result;
  }
  private clearRoute() {
    if (this.routeTimer) {
      clearTimeout(this.routeTimer);
      this.routeTimer = null;
    }
    this.routeSavedMs = -Infinity;
    if (this.current.route.length) {
      this.publish({ route: [] });
    }
    const result = this.routeWrites.then(async () => {
      await this.storage.remove(routeKey);
      await this.storage.remove(paceKey);
    });
    this.routeWrites = result.catch(() => undefined);
    return result;
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
  async pause() {
    // A failed route write must not hold up the recording; the points are still in memory.
    await this.checkpoint().catch(() => {});
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
  async finish() {
    // A failed route write must not hold up the recording; the points are still in memory.
    await this.checkpoint().catch(() => {});
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
  /** The pacer for the running guided walk, created on first use and dropped with the walk. */
  paceFor(session: ActivitySession): WalkPace | null {
    if (session.guidance?.kind !== 'walk' || session.startMs === null) return null;
    if (this.pace?.startMs !== session.startMs) {
      this.pace = new WalkPace(session.startMs, session.guidance.config);
      // A walk resumed after a kill carries on with what it had counted.
      if (this.savedPace?.startMs === session.startMs) this.pace.restore(this.savedPace);
      this.savedPace = null;
    }
    return this.pace;
  }
  /** The cadence log for a running free walk, run, hike or treadmill, created on first use (#3648). */
  cadenceFor(session: ActivitySession): CadenceLog | null {
    if (!logsCadence(session) || session.startMs === null) return null;
    if (this.cadence?.startMs !== session.startMs) {
      this.cadence = new CadenceLog(session.startMs);
      // A recording resumed after a kill carries on with the readings it had.
      if (this.savedPace?.startMs === session.startMs) this.cadence.restore(this.savedPace.readings);
      this.savedPace = null;
    }
    return this.cadence;
  }
  async discard() {
    this.pace = null;
    this.cadence = null;
    await this.write((data) => ({ ...data, session: null }));
    await this.clearRoute();
  }
  async save(
    timezone: string,
    metrics: { avgHr?: number | null; maxHr?: number | null; steps?: number | null } = {},
  ) {
    await this.write((data) => {
      if (!data.session) {
        throw new Error('No activity to save.');
      }
      const session = data.session;
      // The strap's cadence and covered steps, as the current app saves them for every foot
      // activity (#3648); a treadmill's own distance-based steps take precedence, as there. The
      // cadence is extra: if it ever fails the save schema, the activity is still saved.
      const cadence = this.current.session ? this.cadenceFor(session) : null;
      const build = (withCadence: boolean) =>
        activityPayload.parse({
          ...sessionPayload(session, timezone, this.current.route, null, {
            cadence: withCadence ? cadence : null,
          }),
          ...(metrics.avgHr != null ? { avgHr: Math.round(metrics.avgHr) } : {}),
          ...(metrics.maxHr != null ? { maxHr: Math.round(metrics.maxHr) } : {}),
          ...(metrics.steps != null ? { steps: metrics.steps } : {}),
        });
      let payload: ActivityPayload;
      try {
        payload = build(true);
      } catch {
        payload = build(false);
      }
      return {
        ...data,
        session: null,
        rows: [
          ...data.rows.filter((row) => row.payload.id !== payload.id),
          { payload, pending: true },
        ],
      };
    });
    this.cadence = null;
    await this.clearRoute().catch(() => {});
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
  /**
   * Saves the finished guided walk, once when it ends and again whenever more of its heart rate has
   * reached the server (#3641): the strap's samples upload on their own timer, so the done screen
   * hands over the window's readings as they arrive and the walk and its blocks are saved with them.
   */
  async saveWalk(timezone: string, hr: HrWindow | null = null) {
    await this.write((data) => {
      const session = data.session;
      if (!session || session.guidance?.kind !== 'walk') {
        return data;
      }
      const guidance = session.guidance;
      const readings = hrSamples(hr).length;
      if (guidance.saved && readings <= (guidance.hrReadings ?? 0)) {
        return data;
      }
      if (!guidance.saved && elapsedMs(session, this.now()) < 60_000) {
        throw new Error('This walk is too short to save.');
      }
      // After a kill the pacer is rebuilt from its checkpoint, so a later save keeps its cadence.
      const pace = session.startMs !== null ? this.paceFor(session) : null;
      // The pacer's numbers and the heart rate are extra: if either ever fails the save schema, the
      // walk is still saved without it.
      let payload: ActivityPayload;
      try {
        payload = sessionPayload(session, timezone, this.current.route, pace, { hr });
      } catch {
        try {
          payload = sessionPayload(session, timezone, this.current.route, null, { hr });
        } catch {
          payload = sessionPayload(session, timezone, this.current.route);
        }
      }
      return {
        ...data,
        session: {
          ...session,
          guidance: { ...guidance, saved: true, hrReadings: Math.max(readings, guidance.hrReadings ?? 0) },
        },
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
  async saveFitness(timezone: string, profile: FitnessProfile, hr: HrWindow | null = null) {
    await this.write((data) => {
      if (!data.session) {
        throw new Error('No test to save.');
      }
      // The test's heart rate and, for a distance test, its GPS route, as the current app records
      // them (#3641).
      const result = fitnessResult(data.session, timezone, profile, {
        hr,
        route: this.current.route,
      });
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
    await this.clearRoute().catch(() => {});
    this.invalidate();
    void this.sync();
  }
  async finishGuided() {
    // A failed route write must not hold up the recording; the points are still in memory.
    await this.checkpoint().catch(() => {});
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
      (!this.current.rows.some((row) => row.pending && !deadLettered(row)) &&
        !this.current.tests.some((row) => row.pending && !deadLettered(row)) &&
        !this.current.runs.some((row) => row.pending && !deadLettered(row)))
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
    // A run whose PATCH failed without counting (5xx, 429, no connection) is passed over for the
    // rest of this flush so the runs behind it still upload; the failure is reported at the end.
    const deferred = new Set<string>();
    let deferredFailure: unknown;
    try {
      await this.writes;
      while (generation === this.generation) {
        await this.writes;
        if (generation !== this.generation) {
          return;
        }
        // A dead-lettered row, or one waiting out its backoff, is passed over so the rows behind
        // it still upload.
        const ready = (row: { pending: boolean; rejected?: Rejection }) =>
          row.pending &&
          !deadLettered(row) &&
          (row.rejected?.retryAt === undefined || row.rejected.retryAt <= this.now());
        const activityRow = this.current.rows.find(ready);
        const row = activityRow ?? this.current.tests.find(ready);
        const domain = activityRow ? 'activity_logs' : 'fitness_tests';
        if (!row) {
          const run = this.current.runs.find((row) => ready(row) && !deferred.has(row.payload.id));
          if (!run) {
            if (deferredFailure !== undefined) {
              throw deferredFailure;
            }
            return;
          }
          if (!this.connection.patch) {
            throw new Error('Run completion is unavailable.');
          }
          let response: unknown;
          try {
            response = await this.connection.patch(
              `/api/running-plan/runs/${run.payload.id}`,
              run.payload,
            );
          } catch (failure) {
            // Our own JSON 4xx (not a 429) counts against this run, so one run cannot hold the ones behind
            // it. A 5xx (the server's own trouble, as with pushes), a 429 or a lost connection says
            // nothing about it: it is not counted and is retried on the next sync, as is a 4xx from a proxy.
            if (isRefusedByServer(failure)) {
              if (generation !== this.generation) {
                return;
              }
              await this.reject('runs', run, failure.message);
              continue;
            }
            deferred.add(run.payload.id);
            deferredFailure ??= failure;
            continue;
          }
          if (generation !== this.generation) {
            return;
          }
          const parsed = z
            .object({
              run: z.object({
                id: z.string(),
                status: z.string(),
                activityLogId: z.string().nullish(),
                completedAs: z.string().nullish(),
              }),
            })
            .safeParse(response);
          if (
            !parsed.success ||
            Object.entries(run.payload).some(
              ([key, value]) =>
                value !== undefined &&
                parsed.data.run[key as keyof typeof parsed.data.run] !== value,
            )
          ) {
            await this.reject('runs', run, 'Run readback not confirmed.');
            continue;
          }
          await this.write((data) => ({
            ...data,
            runs: data.runs.map((row) =>
              row.payload.id === run.payload.id
                ? { ...row, pending: false, rejected: undefined }
                : row,
            ),
          }));
          this.invalidate();
          continue;
        }
        let answer: unknown;
        try {
          answer = await this.connection.post('/api/sync/push', {
            mutations: [
              {
                id: row.payload.id,
                domain,
                date: row.payload.date,
                payload: row.payload,
              },
            ],
          });
        } catch (failure) {
          // Our own JSON 4xx other than 429 refused the request itself, so it counts against this row, as the
          // current app does. A 429, a 5xx, a proxy's 4xx or a lost connection says nothing about it and retries.
          if (isRefusedByServer(failure)) {
            if (generation !== this.generation) {
              return;
            }
            await this.reject(
              activityRow ? 'rows' : 'tests',
              row,
              `push rejected: HTTP ${failure.status}`,
            );
            continue;
          }
          throw failure;
        }
        const ack = z
          .object({
            processed: z.number(),
            errors: z.array(
              z.object({
                id: z.string().optional(),
                domain: z.string(),
                date: z.string(),
                error: z.string().optional(),
                retryable: z.boolean().optional(),
              }),
            ),
          })
          .parse(answer);
        if (generation !== this.generation) {
          return;
        }
        const failure = resolveFailedOutboxIds(
          [{ id: row.payload.id, domain, date: row.payload.date }],
          ack.errors,
        ).get(row.payload.id);
        if (failure?.retryable) {
          // The server could not write (its database is down): says nothing about this row.
          throw new Error(failure.error);
        }
        if (failure) {
          await this.reject(activityRow ? 'rows' : 'tests', row, failure.error);
          continue;
        }
        if (ack.processed !== 1 || ack.errors.length) {
          throw new Error('Upload not confirmed.');
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
          // The server took the push but its day does not show it (#3638): an edit of a row deleted
          // elsewhere stays deleted. It counts like a refusal, so the rows behind it still upload.
          await this.reject(activityRow ? 'rows' : 'tests', row, 'Readback not confirmed.');
          continue;
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
                  rejected: undefined,
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
              ? { ...item, pending: false, rejected: undefined }
              : item,
          ),
        }));
        this.invalidate();
      }
    } catch (failure) {
      if (generation === this.generation) {
        this.publish({
          error: failureNotice(
            'Saved on this phone. Activities will upload when connected.',
            failure,
          ),
        });
      }
    }
  }
  // Counts one server refusal against a queued item (an unchanged copy, in case it was edited
  // meanwhile): backoff until the fifth, then it is dead-lettered and the flush passes it over.
  private async reject(
    list: 'rows' | 'tests' | 'runs',
    row: { payload: { id: string }; rejected?: Rejection },
    error: string,
  ) {
    const rejected = countRefusal(row.rejected, error, this.now());
    const unchanged = (item: { payload: { id: string } }) =>
      item.payload.id === row.payload.id &&
      JSON.stringify(item.payload) === JSON.stringify(row.payload);
    await this.write((data) => ({
      ...data,
      [list]: (data[list] as { payload: { id: string } }[]).map((item) =>
        unchanged(item) ? { ...item, rejected } : item,
      ),
    }));
  }
  // Sync health's Retry: forget the refusals on one dead-lettered row and send it again now.
  async retryRejected(list: QueueList, id: string) {
    await this.write((data) => retryRow(data, list, id));
    await this.sync();
  }
  // Sync health's Discard: drop one dead-lettered row from this phone's queue only.
  async discardRejected(list: QueueList, id: string) {
    await this.write((data) => discardRow(data, list, id));
    this.invalidate();
  }
  cancel() {
    this.generation++;
    if (this.routeTimer) {
      clearTimeout(this.routeTimer);
      this.routeTimer = null;
    }
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
