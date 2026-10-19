import { dateStrMidnightInTz, toAestDay } from '@trainingai/shared/date-utils';
import { RetryLater } from '../../../core/sync/HistoryDownload.ts';
import { NutritionPersistence } from './nutrition-persistence.ts';
import { resolveEatenAt } from '@trainingai/shared/nutrition/eaten-at';
import {
  mealLoggingStatus,
  mealLoggingComplete,
} from '@trainingai/shared/nutrition/meal-logging-status';
import { findDuplicateFoodItem } from '@trainingai/shared/nutrition/food-item-identity';
import {
  FOOD_ITEM_IMAGE_MAX_BYTES,
  rejectMealImage,
} from '@trainingai/shared/nutrition/meal-image';
import { MutationSchema } from '@trainingai/shared/sync/mutation-schema';
import { dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin';
import { SupplementLogSchema } from '@trainingai/shared/validation/supplement';
import { z } from 'zod';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import { RefreshPolicy } from '../../../core/sync/RefreshPolicy.ts';
import { ApiError } from '../../account/api/client.ts';
import type { AccountConnection } from '../../account/session.ts';
import { normaliseFood, type FoodEntry } from './food-values.ts';
import {
  answerSchema,
  coreSpecs,
  eveningSchema,
  FoodItemPushSchema,
  foodLogsSpec,
  foodSchema,
  logSchema,
  mealSchema,
  mealTypeSchema,
  mealLoggingChoiceSchema,
  SavedMealSchema,
  scaledLog,
  scaleFood,
  SupplementCreateSchema,
  supplementSchema,
  targetsBody,
  targetsSchema,
  totals,
  type Food,
  type FoodLog,
  type SavedMeal,
  type Supplement,
} from './models.ts';
import { failureNotice, reportError } from '../../../core/reporting/index.ts';
const logBody = z.object({
  id: z.uuid(),
  mealTypeId: z.uuid(),
  foodItemId: z.uuid(),
  quantityMultiplier: z.number().min(0.01).max(100),
  loggedAt: z.string().datetime({ offset: true }),
  savedMealId: z.string().nullable().optional(),
  mealGroupId: z.string().nullable().optional(),
  mealGroupName: z.string().nullable().optional(),
});
const operationSchema = MutationSchema.extend({
  id: z.uuid(),
  domain: z.enum([
    'food_items',
    'food_logs',
    'saved_meals',
    'supplements',
    'supplement_logs',
    'day_checkins',
    'plan_meal_answers',
  ]),
  acknowledged: z.boolean().default(false),
}).superRefine((op, ctx) => {
  let valid = false;
  const p = op.payload;
  switch (op.domain) {
    case 'food_items':
      valid = FoodItemPushSchema.safeParse(p).success;
      break;
    case 'food_logs':
      valid =
        p.deleted === true
          ? z
              .object({ id: z.uuid(), deleted: z.literal(true) })
              .strict()
              .safeParse(p).success
          : logBody.safeParse(p).success;
      break;
    case 'saved_meals':
      valid =
        p.deleted === true
          ? z
              .object({ id: z.uuid(), deleted: z.literal(true) })
              .strict()
              .safeParse(p).success
          : SavedMealSchema.safeParse(p).success;
      break;
    case 'supplements':
      valid =
        typeof p.id === 'string' &&
        (p.deleted === true ||
          SupplementCreateSchema.safeParse(
            Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'id')),
          ).success);
      break;
    case 'supplement_logs':
      valid =
        typeof p.supplementId === 'string' &&
        p.logDate === op.date &&
        (p.deleted === true ||
          SupplementLogSchema.safeParse({
            amount: p.amount,
            unit: p.unit,
            doseText: p.doseText,
          }).success);
      break;
    case 'day_checkins':
      valid = eveningSchema.safeParse(p).success && dayCheckinHasAnswers(p);
      break;
    case 'plan_meal_answers':
      valid = answerSchema.safeParse(p).success;
      break;
  }
  if (!valid) {
    ctx.addIssue({ code: 'custom', message: 'Invalid nutrition change.' });
  }
});
export type NutritionOperation = z.infer<typeof operationSchema>;
const dataSchema = z.object({
  supplementDate: z.string().nullable().default(null),
  mealTypes: z.array(mealTypeSchema),
  foods: z.array(foodSchema),
  meals: z.array(mealSchema),
  supplements: z.array(supplementSchema),
  targets: targetsSchema,
  days: z.record(z.string(), z.array(logSchema)),
  planLinks: z.record(z.string(), z.string()).default({}),
  checkins: z.record(z.string(), z.unknown()),
  answers: z.record(z.string(), z.array(answerSchema)),
  mealStatuses: z.record(z.string(), z.array(mealLoggingChoiceSchema)).default({}),
});
const httpBodies = {
  'meal-status': z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mealTypeId: z.uuid(),
      skipped: z.boolean(),
    })
    .strict(),
  targets: targetsBody,
  complete: z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), complete: z.boolean() })
    .strict(),
  restrictions: z
    .object({
      entries: z
        .array(
          z
            .object({ restrictionId: z.uuid(), severity: z.enum(['avoid', 'allergy']) })
            .strict(),
        )
        .max(60),
    })
    .strict(),
  'plan-link': z.object({ planMealId: z.uuid(), savedMealId: z.uuid() }).strict(),
};
const httpSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['targets', 'complete', 'restrictions', 'plan-link', 'meal-status']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((op, ctx) => {
    if (
      !httpBodies[op.kind].safeParse(op.payload).success ||
      ((op.kind === 'complete' || op.kind === 'meal-status') && op.payload.date !== op.date)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid nutrition request.' });
    }
  });
const savedSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  data: dataSchema,
  operations: z.array(operationSchema),
  loaded: z.array(z.string()),
  savedAt: z.record(z.string(), z.number()),
  http: z.array(httpSchema).default([]),
});
export type NutritionState = {
  ready: boolean;
  data: z.infer<typeof dataSchema>;
  operations: NutritionOperation[];
  loaded: string[];
  savedAt: Record<string, number>;
  loading: string[];
  errors: Record<string, string>;
  syncing: boolean;
  error: string | null;
  denied: boolean;
  http: {
    id: string;
    kind: 'targets' | 'complete' | 'restrictions' | 'plan-link' | 'meal-status';
    date: string;
    payload: Record<string, unknown>;
  }[];
};
export const emptyNutrition: NutritionState = {
  ready: false,
  data: {
    supplementDate: null,
    mealTypes: [],
    foods: [],
    meals: [],
    supplements: [],
    targets: {},
    days: {},
    planLinks: {},
    checkins: {},
    answers: {},
    mealStatuses: {},
  },
  operations: [],
  loaded: [],
  savedAt: {},
  loading: [],
  errors: {},
  syncing: false,
  error: null,
  denied: false,
  http: [],
};
function matches(row: unknown, expected: Record<string, unknown>) {
  if (!row || typeof row !== 'object') {
    return false;
  }
  return Object.entries(expected).every(
    ([key, value]) =>
      value === undefined ||
      JSON.stringify((row as Record<string, unknown>)[key]) === JSON.stringify(value),
  );
}
function confirmedOperation(state: NutritionState, op: NutritionOperation) {
  const p = op.payload;
  if (op.domain === 'food_items') {
    const food = state.data.foods.find((x) => x.id === p.id);
    return (
      food != null &&
      ['name', 'calories', 'proteinG', 'carbsG', 'fatG', 'servingSizeG'].every(
        (key) => p[key] == null || food[key] === p[key],
      )
    );
  }
  if (op.domain === 'saved_meals') {
    const meal = state.data.meals.find((x) => x.id === p.id);
    if (p.deleted) {
      return !meal;
    }
    const expected = SavedMealSchema.parse(p);
    return (
      !!meal &&
      meal.name === expected.name &&
      meal.servings === expected.servings &&
      meal.items.length === expected.items.length &&
      JSON.stringify(
        expected.items.map((i) => `${i.foodItemId}:${i.quantityMultiplier}`).sort(),
      ) ===
        JSON.stringify(meal.items.map((i) => `${i.foodItemId}:${i.quantityMultiplier}`).sort())
    );
  }
  if (op.domain === 'supplements') {
    const s = state.data.supplements.find((x) => x.id === p.id);
    return p.deleted ? !s : matches(s, p);
  }
  if (op.domain === 'supplement_logs') {
    const s = state.data.supplements.find((x) => x.id === p.supplementId);
    return p.deleted
      ? !!s && !s.loggedToday
      : !!s?.loggedToday &&
          matches(s.loggedDose, {
            amount: p.amount ?? null,
            unit: p.unit ?? null,
            doseText: p.doseText ?? null,
          });
  }
  if (op.domain === 'day_checkins') {
    return matches(state.data.checkins[op.date], p);
  }
  if (op.domain === 'plan_meal_answers') {
    const answer = state.data.answers[op.date]?.find((x) => x.planMealId === p.planMealId);
    return p.deleted
      ? !answer
      : !!answer &&
          matches(
            answer,
            Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'deleted')),
          );
  }
  return true;
}
function overlayDose(s: Supplement, p: Record<string, unknown>): Supplement {
  const dose = p.deleted
    ? null
    : {
        amount: typeof p.amount === 'number' ? p.amount : null,
        unit: typeof p.unit === 'string' ? p.unit : null,
        doseText: typeof p.doseText === 'string' ? p.doseText : null,
        takenAt: typeof p.takenAt === 'string' ? p.takenAt : null,
      };
  const old = s.loggedDose;
  const count =
    Math.max(
      0,
      (s.loggedAmount?.contributions ?? (s.loggedToday ? 1 : 0)) - (s.loggedToday ? 1 : 0),
    ) + (dose ? 1 : 0);
  const mixed = Boolean(
    s.loggedAmount?.mixedUnits ||
    (dose?.amount != null &&
      s.loggedAmount?.unit &&
      dose.unit &&
      s.loggedAmount.unit !== dose.unit),
  );
  const otherCount = count - (dose ? 1 : 0);
  const others =
    otherCount === 0
      ? null
      : s.loggedAmount?.amount == null
        ? null
        : s.loggedAmount.amount - (old?.amount ?? 0);
  const amount = mixed
    ? null
    : others != null
      ? others + (dose?.amount ?? 0)
      : otherCount === 0
        ? (dose?.amount ?? null)
        : null;
  return {
    ...s,
    loggedToday: !!dose,
    loggedDose: dose,
    loggedAmount: count
      ? {
          amount,
          unit: mixed ? null : (s.loggedAmount?.unit ?? dose?.unit ?? null),
          contributions: count,
          mixedUnits: mixed,
        }
      : null,
  };
}
type Collection = keyof typeof coreSpecs;
function nutritionRefreshError(
  kind: Collection | 'logs' | 'checkin' | 'answers' | 'mealStatuses',
  cause: unknown,
) {
  const label = {
    mealTypes: 'meal groups',
    foods: 'your food library',
    meals: 'saved meals',
    supplements: 'supplements',
    targets: 'nutrition goals',
    logs: 'food logs',
    checkin: 'your day review',
    answers: 'meal-plan answers',
    mealStatuses: 'meal statuses',
  }[kind];
  if (cause instanceof ApiError) {
    if ([401, 403].includes(cause.status)) {
      return `Check your sign-in and account access to refresh ${label}.`;
    }
    return `Could not refresh ${label}: the service returned ${cause.status}. Saved records have been kept.`;
  }
  if (cause instanceof z.ZodError) {
    return `The server returned unreadable ${label}. Saved records have been kept.`;
  }
  if (cause instanceof Error && cause.name === 'AbortError') {
    return `Refreshing ${label} timed out. Saved records have been kept.`;
  }
  return `Could not refresh ${label}. Saved records have been kept. Check your connection and retry.`;
}
export type { FoodEntry } from './food-values.ts';
export class NutritionBusy extends RetryLater {
  constructor() {
    super('Nutrition changed during refresh.');
  }
}
export class NutritionStore {
  private current = emptyNutrition;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private initializing: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private requests = new Map<string, Promise<boolean | undefined>>();
  private failures = new Map<string, unknown>();
  private persistence: NutritionPersistence;
  private policies = new Map<string, RefreshPolicy>();
  private generation = 0;
  private revision = 0;
  private canceled = false;
  private denialRevision = 0;
  constructor(
    private storage: ScopedStorage,
    readonly connection: AccountConnection,
    private uuid: () => string,
    private changed = () => {},
    private now = Date.now,
  ) {
    this.persistence = new NutritionPersistence(storage);
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.current;
  private publish(patch: Partial<NutritionState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  initialize() {
    if (this.initializing) {
      return this.initializing;
    }
    const generation = this.generation;
    this.initializing = (async () => {
      try {
        const raw = await this.persistence.read();
        const frame = raw ? savedSchema.parse(raw) : null;
        if (
          frame &&
          (frame.origin !== this.connection.origin || frame.userId !== this.connection.userId)
        ) {
          throw new Error('Wrong account.');
        }
        if (frame) {
          await this.persistence.opened(frame);
        }
        if (generation === this.generation) {
          this.publish({ ...frame, ready: true });
        }
      } catch (failure) {
        if (generation === this.generation) {
          this.initializing = null;
          this.publish({
            error: failureNotice(
              'Could not open saved nutrition records. Existing records are preserved.',
              failure,
            ),
          });
        }
      }
    })();
    return this.initializing;
  }
  private write(change: (state: NutritionState) => Partial<NutritionState>) {
    const generation = this.generation;
    const work = this.writes.then(async () => {
      if (this.canceled || generation !== this.generation) {
        throw new Error('Account changed.');
      }
      const patch = change(this.current);
      const next = { ...this.current, ...patch };
      const denialRevision = this.denialRevision;
      await this.persistence.write({
        version: 1,
        origin: this.connection.origin,
        userId: this.connection.userId,
        data: next.data,
        operations: next.operations,
        loaded: next.loaded,
        savedAt: next.savedAt,
        http: next.http,
      });
      if (generation === this.generation) {
        this.publish({
          ...patch,
          denied:
            this.denialRevision !== denialRevision
              ? this.current.denied
              : (patch.denied ?? this.current.denied),
        });
      }
    });
    this.writes = work.catch(() => {});
    return work;
  }
  async enqueue(
    changes: {
      domain: NutritionOperation['domain'];
      date: string;
      payload: Record<string, unknown>;
    }[],
    knownFoods: Food[] = [],
  ) {
    if (!this.current.ready || this.current.denied || this.canceled) {
      throw new Error('Check your account before saving nutrition.');
    }
    const operations = changes.map((change) =>
      operationSchema.parse({ ...change, id: this.uuid() }),
    );
    const recorded = operations.filter(
      (op) => op.domain === 'food_logs' && !op.payload.deleted,
    );
    const statusWrites = [
      ...new Map(recorded.map((op) => [`${op.date}:${op.payload.mealTypeId}`, op])).values(),
    ].map((op) => ({
      id: this.uuid(),
      kind: 'meal-status' as const,
      date: op.date,
      payload: { date: op.date, mealTypeId: String(op.payload.mealTypeId), skipped: false },
    }));
    await this.write((state) => ({
      data: {
        ...state.data,
        foods: mergeIds(
          state.data.foods,
          knownFoods.filter(
            (food) => !state.data.foods.some((existing) => existing.id === food.id),
          ),
        ),
      },
      operations: [...state.operations, ...operations],
      http: [
        ...state.http.filter(
          (op) =>
            !statusWrites.some(
              (status) =>
                op.kind === 'meal-status' &&
                op.date === status.date &&
                op.payload.mealTypeId === status.payload.mealTypeId,
            ),
        ),
        ...statusWrites,
      ],
      error: null,
    }));
    this.revision++;
    this.changed();
    void this.sync();
  }
  refresh(
    kind: Collection | 'logs' | 'checkin' | 'answers' | 'mealStatuses',
    date: string,
    manual = false,
  ): Promise<boolean | undefined> {
    if (kind === 'supplements') {
      date = toAestDay(
        new Date(this.now()),
        this.connection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    }
    const key =
      kind +
      (kind === 'logs' ||
      kind === 'checkin' ||
      kind === 'answers' ||
      kind === 'supplements' ||
      kind === 'mealStatuses'
        ? ':' + date
        : '');
    const active = this.requests.get(key);
    if (active) {
      return manual ? active.then(() => this.refresh(kind, date, true)) : active;
    }
    const work = (async () => {
      await this.initialize();
      if (!this.current.ready || this.canceled) {
        return;
      }
      let policy = this.policies.get(key);
      if (!policy) {
        policy = new RefreshPolicy(this.now, 300000);
        if (this.current.savedAt[key]) {
          policy.succeeded(this.current.savedAt[key]);
        }
        this.policies.set(key, policy);
      }
      if (!manual && !policy.shouldRefresh()) {
        return;
      }
      const generation = this.generation;
      const revision = this.revision;
      const denialRevision = this.denialRevision;
      this.publish({ loading: [...this.current.loading, key] });
      try {
        const spec =
          kind === 'mealStatuses'
            ? {
                path: '/api/nutrition/meal-statuses',
                query: { date },
                schema: z.object({
                  date: z.string(),
                  statuses: z.array(mealLoggingChoiceSchema),
                }),
              }
            : kind === 'logs'
              ? foodLogsSpec(date)
              : kind === 'checkin'
                ? {
                    path: '/api/day-checkin',
                    query: { date, phase: 'evening' },
                    schema: z.unknown(),
                  }
                : kind === 'answers'
                  ? {
                      path: '/api/nutrition/plan-meal-answers',
                      query: { date },
                      schema: z.object({ answers: z.array(answerSchema) }),
                    }
                  : coreSpecs[kind];
        const response = spec.schema.parse(
          await this.connection.get(spec.path, 'query' in spec ? spec.query : undefined),
        );
        if (generation !== this.generation || revision !== this.revision) {
          return;
        }
        await this.write((state) => {
          if (revision !== this.revision) {
            throw new NutritionBusy();
          }
          return {
            data: {
              ...state.data,
              ...(kind === 'mealStatuses'
                ? {
                    mealStatuses: {
                      ...state.data.mealStatuses,
                      [date]: (
                        response as { statuses: z.infer<typeof mealLoggingChoiceSchema>[] }
                      ).statuses,
                    },
                  }
                : kind === 'logs'
                  ? { days: { ...state.data.days, [date]: response } }
                  : kind === 'checkin'
                    ? { checkins: { ...state.data.checkins, [date]: response } }
                    : kind === 'answers'
                      ? {
                          answers: {
                            ...state.data.answers,
                            [date]: (response as { answers: unknown }).answers,
                          },
                        }
                      : kind === 'foods'
                        ? { foods: mergeIds(state.data.foods, response as Food[]) }
                        : {
                            [kind]: response,
                            ...(kind === 'supplements' ? { supplementDate: date } : {}),
                          }),
            } as NutritionState['data'],
            savedAt: { ...state.savedAt, [key]: this.now() },
            http:
              kind === 'mealTypes'
                ? state.http.filter(
                    (op) =>
                      op.kind !== 'meal-status' ||
                      (response as z.infer<typeof mealTypeSchema>[]).some(
                        (type) => type.id === op.payload.mealTypeId,
                      ),
                  )
                : state.http,
            loaded: [...new Set([...state.loaded, key])],
            errors: Object.fromEntries(Object.entries(state.errors).filter(([k]) => k !== key)),
            denied: state.denied && (!manual || denialRevision !== this.denialRevision),
          };
        });
        policy.succeeded();
        return true;
      } catch (cause) {
        this.failures.set(key, cause);
        if (generation === this.generation) {
          policy.failed();
          if (kind === 'mealStatuses' && cause instanceof ApiError && cause.status === 404) {
            this.publish({
              errors: Object.fromEntries(
                Object.entries(this.current.errors).filter(([k]) => k !== key),
              ),
            });
            return;
          }
          const denied = cause instanceof ApiError && [401, 403].includes(cause.status);
          if (denied) {
            this.denialRevision++;
          }
          reportError(cause);
          this.publish({
            denied: this.current.denied || denied,
            errors: {
              ...this.current.errors,
              [key]: nutritionRefreshError(kind, cause),
            },
          });
        }
      } finally {
        if (generation === this.generation) {
          this.publish({ loading: this.current.loading.filter((k) => k !== key) });
        }
      }
    })();
    this.requests.set(key, work);
    void work.finally(() => this.requests.delete(key));
    return work;
  }
  // A history download's read of one day. A read that a nutrition change on this phone overtook
  // is not saved, so it is read again; any other failure is thrown for the download to judge.
  async download(kind: 'logs' | 'checkin', date: string) {
    const key = `${kind}:${date}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      this.failures.delete(key);
      if (await this.refresh(kind, date, true)) {
        return;
      }
      const cause = this.failures.get(key);
      if (this.canceled) {
        throw new Error('Account changed.');
      }
      if (cause !== undefined && !(cause instanceof NutritionBusy)) {
        throw cause;
      }
      await this.writes;
    }
    throw new NutritionBusy();
  }
  async logFoods(
    entries: FoodEntry[],
    date: string,
    mealTypeId: string,
    group?: { savedMealId?: string; name?: string },
  ) {
    const mealType = this.current.data.mealTypes.find((mt) => mt.id === mealTypeId);
    if (!mealType) {
      throw new Error('Choose an available meal group.');
    }
    const at = resolveEatenAt({
      date,
      window: mealType,
      at: new Date(this.now()),
      tz: this.connection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).toISOString();
    const groupId = entries.length > 1 || group?.savedMealId ? this.uuid() : null;
    const changes: {
      domain: NutritionOperation['domain'];
      date: string;
      payload: Record<string, unknown>;
    }[] = [];
    const available = this.view(date).foods.slice();
    const knownFoods: Food[] = [];
    for (const entry of entries) {
      let foodId = entry.id;
      if (foodId && !available.some((food) => food.id === foodId)) {
        knownFoods.push(
          foodSchema.parse({ source: 'manual', ...normaliseFood(entry, foodId) }),
        );
      }
      if (!foodId) {
        foodId = this.uuid();
        const valid = normaliseFood(entry, foodId);
        if (rejectMealImage(valid.imageDataUri, FOOD_ITEM_IMAGE_MAX_BYTES)) {
          throw new Error('That thumbnail is too large. Remove or resize it.');
        }
        const snapshot = foodSchema.parse({ source: 'manual', ...valid });
        const duplicate = findDuplicateFoodItem(snapshot, available);
        if (
          duplicate &&
          (!valid.imageDataUri || duplicate.imageDataUri === valid.imageDataUri) &&
          (!valid.barcode || duplicate.barcode === valid.barcode)
        ) {
          foodId = duplicate.id;
        } else {
          changes.push({ domain: 'food_items', date, payload: valid });
          available.push(snapshot);
        }
      }
      changes.push({
        domain: 'food_logs',
        date,
        payload: {
          id: this.uuid(),
          mealTypeId,
          foodItemId: foodId,
          quantityMultiplier: entry.quantityMultiplier,
          loggedAt: at,
          savedMealId: group?.savedMealId ?? null,
          mealGroupId: groupId,
          mealGroupName: group?.name ?? null,
        },
      });
    }
    await this.enqueue(changes, knownFoods);
  }
  async queueHttp(
    kind: 'targets' | 'complete' | 'restrictions' | 'plan-link' | 'meal-status',
    date: string,
    payload: Record<string, unknown>,
  ) {
    if (!this.current.ready || this.current.denied || this.canceled) {
      throw new Error('Check your account before saving.');
    }
    const parsed = httpBodies[kind].parse(payload);
    const op = httpSchema.parse({ id: this.uuid(), kind, date, payload: parsed });
    await this.write((state) => ({
      http: [
        ...state.http.filter(
          (prior) =>
            !(
              kind === 'meal-status' &&
              prior.kind === kind &&
              prior.date === date &&
              prior.payload.mealTypeId === op.payload.mealTypeId
            ),
        ),
        op,
      ],
      error: null,
    }));
    this.revision++;
    this.changed();
    void this.sync();
  }
  async setMealSkipped(mealTypeId: string, date: string, skipped: boolean) {
    if (!this.current.data.mealTypes.some((type) => type.id === mealTypeId)) {
      throw new Error('This meal group is no longer available.');
    }
    if (skipped && this.view(date).logs.some((log) => log.mealTypeId === mealTypeId)) {
      throw new Error('This meal already has recorded food.');
    }
    await this.queueHttp('meal-status', date, { date, mealTypeId, skipped });
  }
  async editLog(log: FoodLog, quantityMultiplier: number, mealTypeId = log.mealTypeId) {
    await this.enqueue([
      {
        domain: 'food_logs',
        date: log.date,
        payload: {
          id: log.id,
          mealTypeId,
          foodItemId: log.foodItemId,
          quantityMultiplier,
          loggedAt: log.loggedAt,
          savedMealId: log.savedMealId,
          mealGroupId: log.mealGroupId,
          mealGroupName: log.mealGroupName,
        },
      },
    ]);
  }
  async removeLogs(logs: FoodLog[]) {
    await this.enqueue(
      logs.map((log) => ({
        domain: 'food_logs',
        date: log.date,
        payload: { id: log.id, deleted: true },
      })),
    );
  }
  async restoreLogs(logs: FoodLog[]) {
    await this.enqueue(
      logs.map((log) => ({
        domain: 'food_logs' as const,
        date: log.date,
        payload: {
          id: log.id,
          mealTypeId: log.mealTypeId,
          foodItemId: log.foodItemId,
          quantityMultiplier: log.quantityMultiplier,
          loggedAt: log.loggedAt,
          savedMealId: log.savedMealId,
          mealGroupId: log.mealGroupId,
          mealGroupName: log.mealGroupName,
        },
      })),
      logs.map((log) => log.foodItem),
    );
  }
  async saveMeal(
    payload: z.infer<typeof SavedMealSchema>,
    date: string,
    foods: FoodEntry[] = [],
  ) {
    const available = this.view(date).foods.slice();
    const aliases = new Map<string, string>();
    const changes: { domain: 'food_items'; date: string; payload: Record<string, unknown> }[] =
      [];
    for (const food of foods) {
      const id = food.id ?? this.uuid();
      const valid = normaliseFood(food, id);
      const snapshot = foodSchema.parse({ source: 'manual', ...valid });
      const duplicate = findDuplicateFoodItem(snapshot, available);
      if (
        duplicate &&
        (!valid.imageDataUri || duplicate.imageDataUri === valid.imageDataUri) &&
        (!valid.barcode || duplicate.barcode === valid.barcode)
      ) {
        aliases.set(id, duplicate.id);
      } else {
        available.push(snapshot);
        changes.push({ domain: 'food_items', date, payload: valid });
      }
    }
    const value = SavedMealSchema.parse({
      ...payload,
      id: payload.id ?? this.uuid(),
      items: payload.items.map((i) => ({
        ...i,
        foodItemId: aliases.get(i.foodItemId) ?? i.foodItemId,
      })),
    });
    await this.enqueue([...changes, { domain: 'saved_meals', date, payload: value }]);
    return value.id!;
  }
  async logMeal(meal: SavedMeal, date: string, mealTypeId: string, portions = 1) {
    await this.logFoods(
      meal.items.map((item) => ({
        ...item.foodItem,
        quantityMultiplier: (item.quantityMultiplier * portions) / meal.servings,
      })),
      date,
      mealTypeId,
      { savedMealId: meal.id, name: meal.name },
    );
  }
  async editGroup(logs: FoodLog[], scale: number, mealTypeId: string) {
    await this.enqueue(
      logs.map((log) => ({
        domain: 'food_logs',
        date: log.date,
        payload: {
          id: log.id,
          mealTypeId,
          foodItemId: log.foodItemId,
          quantityMultiplier: log.quantityMultiplier * scale,
          loggedAt: log.loggedAt,
          savedMealId: log.savedMealId,
          mealGroupId: log.mealGroupId,
          mealGroupName: log.mealGroupName,
        },
      })),
    );
  }
  async logSupplement(s: Supplement, date: string, amount?: number) {
    const dose = s.defaultAmount ?? null;
    await this.enqueue([
      {
        domain: 'supplement_logs',
        date,
        payload: s.loggedToday
          ? { supplementId: s.id, logDate: date, deleted: true }
          : {
              supplementId: s.id,
              logDate: date,
              amount: amount ?? dose,
              unit: s.unit ?? null,
              doseText: s.dose ?? null,
              takenAt: new Date(this.now()).toISOString(),
            },
      },
    ]);
  }
  sync() {
    if (this.flushing) {
      return this.flushing;
    }
    if (!this.current.ready || this.current.denied || this.canceled) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.publish({ syncing: true });
    this.flushing = (async () => {
      try {
        await this.writes;
        while (generation === this.generation && this.current.operations.length) {
          const op = this.current.operations[0];
          if (!op.acknowledged) {
            const result = z
              .object({ processed: z.number(), errors: z.array(z.unknown()) })
              .parse(
                await this.connection.post('/api/sync/push', {
                  mutations: [
                    { id: op.id, domain: op.domain, date: op.date, payload: op.payload },
                  ],
                }),
              );
            if (result.processed !== 1 || result.errors.length) {
              throw new Error('Upload not confirmed.');
            }
            if (generation !== this.generation) {
              return;
            }
            await this.write((state) => ({
              operations: state.operations.map((x) =>
                x.id === op.id ? { ...x, acknowledged: true } : x,
              ),
            }));
          }
          if (
            op.domain === 'supplement_logs' &&
            op.date !==
              toAestDay(
                new Date(this.now()),
                this.connection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
              )
          ) {
            await this.confirmHistoricalDose(op);
            if (generation !== this.generation) {
              return;
            }
            await this.write((state) => ({
              operations: state.operations.filter((x) => x.id !== op.id),
            }));
            this.changed();
            continue;
          }
          const kind =
            op.domain === 'food_logs'
              ? 'logs'
              : op.domain === 'food_items'
                ? 'foods'
                : op.domain === 'saved_meals'
                  ? 'meals'
                  : op.domain === 'day_checkins'
                    ? 'checkin'
                    : op.domain === 'plan_meal_answers'
                      ? 'answers'
                      : 'supplements';
          const refreshed = await this.refresh(kind, op.date, true);
          if (generation !== this.generation) {
            return;
          }
          const key =
            kind +
            (['logs', 'checkin', 'answers', 'supplements'].includes(kind) ? ':' + op.date : '');
          if (!refreshed || this.current.errors[key]) {
            throw new Error('Readback failed.');
          }
          if (
            kind === 'foods' &&
            !this.current.data.foods.some((food) => food.id === op.payload.id)
          ) {
            const items = coreSpecs.foods.schema.parse(
              await this.connection.get(coreSpecs.foods.path, { q: String(op.payload.name) }),
            );
            if (generation !== this.generation) {
              return;
            }
            if (!items.some((food) => food.id === op.payload.id)) {
              throw new Error('Food-item readback not confirmed.');
            }
            await this.write((state) => ({
              data: { ...state.data, foods: mergeIds(state.data.foods, items) },
            }));
          }
          if (kind === 'logs') {
            const found = (this.current.data.days[op.date] ?? []).find(
              (x) => x.id === op.payload.id,
            );
            if (
              op.payload.deleted
                ? found
                : !found ||
                  found.quantityMultiplier !== op.payload.quantityMultiplier ||
                  found.mealTypeId !== op.payload.mealTypeId
            ) {
              throw new Error('Readback not confirmed.');
            }
          }
          if (!confirmedOperation(this.current, op)) {
            throw new Error('Readback not confirmed.');
          }
          await this.write((state) => ({
            operations: state.operations.filter((x) => x.id !== op.id),
          }));
          this.changed();
        }
        const deferredStatuses = new Set<string>();
        while (
          generation === this.generation &&
          this.current.http.some((op) => !deferredStatuses.has(op.id))
        ) {
          const op = this.current.http.find((op) => !deferredStatuses.has(op.id))!;
          const path =
            op.kind === 'plan-link'
              ? `/api/nutrition/meal-plans/meals/${op.payload.planMealId}`
              : op.kind === 'targets'
                ? '/api/nutrition/targets'
                : op.kind === 'complete'
                  ? '/api/food-logging-complete'
                  : op.kind === 'meal-status'
                    ? '/api/nutrition/meal-statuses'
                    : '/api/nutrition/dietary-restrictions';
          const method =
            op.kind === 'plan-link'
              ? this.connection.patch
              : op.kind === 'complete' || op.kind === 'meal-status'
                ? this.connection.post
                : this.connection.put;
          if (!method) {
            throw new Error('This action is unavailable.');
          }
          try {
            await method(
              path,
              op.kind === 'plan-link'
                ? { savedMealId: op.payload.savedMealId }
                : op.kind === 'meal-status'
                  ? { ...op.payload, decisionId: op.id }
                  : op.payload,
            );
          } catch (cause) {
            if (
              op.kind === 'meal-status' &&
              cause instanceof ApiError &&
              cause.status === 404
            ) {
              deferredStatuses.add(op.id);
              continue;
            }
            throw cause;
          }
          if (generation !== this.generation) {
            return;
          }
          if (op.kind === 'targets') {
            const refreshed = await this.refresh('targets', op.date, true);
            if (
              !refreshed ||
              this.current.errors.targets ||
              !matches(this.current.data.targets, op.payload)
            ) {
              throw new Error('Readback failed.');
            }
          }
          if (op.kind === 'complete') {
            // Preserve queued completion requests from earlier app versions.
            const refreshed = await this.refresh('checkin', op.date, true);
            const checkin = this.current.data.checkins[op.date] as {
              foodLoggingCompletedAt?: unknown;
            } | null;
            if (
              !refreshed ||
              this.current.errors['checkin:' + op.date] ||
              Boolean(checkin?.foodLoggingCompletedAt) !== op.payload.complete
            ) {
              throw new Error('Readback failed.');
            }
          }
          if (op.kind === 'meal-status') {
            const refreshed = await this.refresh('mealStatuses', op.date, true);
            const row = this.current.data.mealStatuses[op.date]?.find(
              (choice) => choice.mealTypeId === op.payload.mealTypeId,
            );
            if (
              !refreshed ||
              !row ||
              row.decisionId !== op.id ||
              row.skipped !== op.payload.skipped
            ) {
              throw new Error('Meal-status readback failed.');
            }
          }
          if (op.kind === 'restrictions') {
            const response = z
              .object({
                mine: z.array(z.object({ restrictionId: z.string(), severity: z.string() })),
              })
              .parse(await this.connection.get('/api/nutrition/dietary-restrictions'));
            const entries = op.payload.entries as { restrictionId: string; severity: string }[];
            if (
              response.mine.length !== entries.length ||
              !entries.every((entry) => response.mine.some((row) => matches(row, entry)))
            ) {
              throw new Error('Readback failed.');
            }
          }
          if (op.kind === 'plan-link') {
            const plans = z
              .object({
                plans: z.array(
                  z.object({
                    variants: z.array(
                      z.object({
                        meals: z.array(
                          z.object({ id: z.string(), savedMealId: z.string().nullable() }),
                        ),
                      }),
                    ),
                  }),
                ),
              })
              .parse(await this.connection.get('/api/nutrition/meal-plans'));
            if (
              !plans.plans.some((plan) =>
                plan.variants.some((v) =>
                  v.meals.some(
                    (m) =>
                      m.id === op.payload.planMealId &&
                      m.savedMealId === op.payload.savedMealId,
                  ),
                ),
              )
            ) {
              throw new Error('Meal link readback failed.');
            }
            await this.write((state) => ({
              data: {
                ...state.data,
                planLinks: {
                  ...state.data.planLinks,
                  [String(op.payload.planMealId)]: String(op.payload.savedMealId),
                },
              },
            }));
          }
          if (generation !== this.generation) {
            return;
          }
          await this.write((state) => ({ http: state.http.filter((x) => x.id !== op.id) }));
          this.changed();
        }
        this.publish({ error: null });
      } catch (cause) {
        if (generation === this.generation) {
          const denied = cause instanceof ApiError && [401, 403].includes(cause.status);
          if (denied) {
            this.denialRevision++;
          }
          this.publish({
            denied: this.current.denied || denied,
            error: failureNotice(
              'Saved on this phone. Nutrition changes will upload when connected.',
              cause,
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
  view(date: string) {
    return nutritionView(this.current.denied ? emptyNutrition : this.current, date);
  }
  async forgetPlanLink(id: string) {
    await this.write((state) => ({
      data: {
        ...state.data,
        planLinks: Object.fromEntries(
          Object.entries(state.data.planLinks).filter(([key]) => key !== id),
        ),
      },
    }));
  }
  private async confirmHistoricalDose(op: NutritionOperation) {
    const rowSchema = z.object({
      supplementId: z.string(),
      logDate: z.string(),
      source: z.string().nullish(),
      amount: z.coerce.number().nullable(),
      unit: z.string().nullable(),
      doseText: z.string().nullable(),
      deletedAt: z.string().nullish(),
    });
    const deltaSchema = z.object({
      supplementLogs: z.array(rowSchema),
      syncedAt: z.string(),
      hasMore: z.boolean(),
    });
    let since = dateStrMidnightInTz(
      op.date,
      this.connection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ).toISOString();
    for (let page = 0; page < 60; page++) {
      const response = deltaSchema.parse(
        await this.connection.get('/api/sync/pull', { since, mode: 'restore' }),
      );
      if (this.canceled) {
        throw new Error('Account changed.');
      }
      const row = response.supplementLogs.find(
        (x) =>
          x.supplementId === op.payload.supplementId &&
          x.logDate === op.date &&
          (x.source ?? 'manual') === 'manual',
      );
      if (
        row &&
        (op.payload.deleted
          ? !!row.deletedAt
          : !row.deletedAt &&
            matches(row, {
              amount: op.payload.amount ?? null,
              unit: op.payload.unit ?? null,
              doseText: op.payload.doseText ?? null,
            }))
      ) {
        return;
      }
      if (!response.hasMore || Date.parse(response.syncedAt) <= Date.parse(since)) {
        break;
      }
      since = response.syncedAt;
    }
    throw new Error('Historical dose readback not confirmed.');
  }
  cancel() {
    this.canceled = true;
    this.generation++;
  }
}
function mergeIds<T extends { id: string }>(base: T[], updated: T[]) {
  return [...new Map([...base, ...updated].map((row) => [row.id, row])).values()];
}
export function nutritionView(state: NutritionState, date: string) {
  let foods = [
    ...state.data.meals.flatMap((meal) => meal.items.map((item) => item.foodItem)),
    ...Object.values(state.data.days)
      .flat()
      .map((log) => log.foodItem),
    ...state.data.foods,
  ];
  let meals = state.data.meals.slice();
  let supplements = state.data.supplements.map((s) =>
    state.data.supplementDate === date
      ? s
      : { ...s, loggedToday: false, loggedDose: null, loggedAmount: null },
  );
  let logs = (state.data.days[date] ?? []).slice();
  let checkin = state.data.checkins[date];
  let answers = (state.data.answers[date] ?? []).slice();
  for (const op of state.operations) {
    const p = op.payload;
    if (op.domain === 'food_items') {
      foods = mergeIds(foods, [foodSchema.parse(p)]);
    }
    if (op.domain === 'saved_meals') {
      meals = meals.filter((x) => x.id !== p.id);
      if (!p.deleted) {
        const input = SavedMealSchema.parse(p);
        const items = input.items.flatMap((item) => {
          const food = foods.find((x) => x.id === item.foodItemId);
          return food ? [{ ...item, foodItem: food }] : [];
        });
        meals.push(
          mealSchema.parse({
            ...input,
            items,
            totals: totals(
              items.map((item) => scaleFood(item.foodItem, item.quantityMultiplier)),
            ),
          }),
        );
      }
    }
    if (op.domain === 'supplements') {
      supplements = supplements.filter((x) => x.id !== p.id);
      if (!p.deleted) {
        const prior = state.data.supplements.find((s) => s.id === p.id);
        supplements.push(
          supplementSchema.parse({
            ...prior,
            ...p,
            loggedToday: prior?.loggedToday ?? false,
            reminderEnabled: p.reminderEnabled ?? false,
            reminderTime: p.reminderTime ?? null,
            sortOrder: p.sortOrder ?? 0,
            active: p.active ?? true,
          }),
        );
      }
    }
    if (op.date !== date) {
      continue;
    }
    if (op.domain === 'food_logs') {
      logs = logs.filter((x) => x.id !== p.id);
      if (!p.deleted) {
        const food = foods.find((x) => x.id === p.foodItemId);
        if (food) {
          logs.push(scaledLog(food, { ...logBody.parse(p), date: op.date }));
        }
      }
    }
    if (op.domain === 'supplement_logs') {
      supplements = supplements.map((s) => (s.id === p.supplementId ? overlayDose(s, p) : s));
    }
    if (op.domain === 'day_checkins') {
      checkin = { ...(checkin && typeof checkin === 'object' ? checkin : {}), ...p };
    }
    if (op.domain === 'plan_meal_answers') {
      answers = answers.filter((a) => a.planMealId !== p.planMealId);
      if (!p.deleted) {
        answers.push(answerSchema.parse(p));
      }
    }
  }
  const targetChanges = state.http.filter((op) => op.kind === 'targets');
  const choices = new Map(
    (state.data.mealStatuses[date] ?? []).map((choice) => [choice.mealTypeId, choice.skipped]),
  );
  for (const op of state.http.filter((op) => op.kind === 'meal-status' && op.date === date)) {
    choices.set(String(op.payload.mealTypeId), op.payload.skipped === true);
  }
  const skipped = [...choices].filter(([, value]) => value).map(([id]) => id);
  const recorded = logs.map((log) => log.mealTypeId);
  const mealStatuses = Object.fromEntries(
    state.data.mealTypes.map((type) => [
      type.id,
      mealLoggingStatus(type.id, recorded, skipped),
    ]),
  );
  const targetView = Object.assign(
    {},
    state.data.targets,
    ...targetChanges.map((op) => op.payload),
  );
  const completion = state.http
    .filter((op) => op.kind === 'complete' && op.date === date)
    .at(-1);
  if (completion) {
    checkin = {
      ...(checkin && typeof checkin === 'object' ? checkin : {}),
      foodLoggingCompletedAt: completion.payload.complete ? 'pending' : null,
    };
  }
  return {
    planLinks: Object.assign(
      {},
      state.data.planLinks,
      ...state.http
        .filter((op) => op.kind === 'plan-link')
        .map((op) => ({ [String(op.payload.planMealId)]: String(op.payload.savedMealId) })),
    ),
    mealTypes: state.data.mealTypes.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    mealStatuses,
    loggingComplete:
      state.loaded.includes('logs:' + date) &&
      mealLoggingComplete(
        state.data.mealTypes.map((type) => type.id),
        recorded,
        skipped,
      ),
    foods: mergeIds([], foods),
    meals,
    supplements,
    targets: targetView,
    logs,
    checkin,
    answers,
    totals: state.loaded.includes('logs:' + date) ? totals(logs) : null,
  };
}
