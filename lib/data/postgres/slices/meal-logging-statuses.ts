import { and, eq, gte, lte, isNull, ne } from 'drizzle-orm';
import { NotFoundError, UserFacingError } from '@trainingai/shared/errors';
import { randomUUID } from 'node:crypto';
import { mealLoggingComplete } from '@trainingai/shared/nutrition/meal-logging-status';
import type { getDb } from '../client';
import * as s from '../schema';

type Db = ReturnType<typeof getDb>;

async function readWindow(db: Db, userId: string, from: string, to: string) {
  const [choices, logs, types] = await Promise.all([
    db
      .select()
      .from(s.mealLoggingStatuses)
      .where(
        and(
          eq(s.mealLoggingStatuses.userId, userId),
          gte(s.mealLoggingStatuses.logDate, from),
          lte(s.mealLoggingStatuses.logDate, to),
        ),
      ),
    db
      .select({
        date: s.foodLogs.date,
        mealTypeId: s.foodLogs.mealTypeId,
        updatedAt: s.foodLogs.updatedAt,
        deletedAt: s.foodLogs.deletedAt,
      })
      .from(s.foodLogs)
      .where(
        and(
          eq(s.foodLogs.userId, userId),
          gte(s.foodLogs.date, from),
          lte(s.foodLogs.date, to),
        ),
      ),
    db
      .select({ id: s.mealTypes.id })
      .from(s.mealTypes)
      .where(and(eq(s.mealTypes.userId, userId), isNull(s.mealTypes.deletedAt))),
  ]);
  return { choices, logs, types };
}

function isSkipped(
  choice: typeof s.mealLoggingStatuses.$inferSelect,
  logs: Awaited<ReturnType<typeof readWindow>>['logs'],
) {
  return (
    choice.skipped &&
    !logs.some(
      (log) =>
        log.date === choice.logDate &&
        log.mealTypeId === choice.mealTypeId &&
        (!log.deletedAt || log.updatedAt >= choice.decidedAt),
    )
  );
}

export async function ensureMealLoggingDay(db: Db, userId: string, date: string) {
  await db.transaction(async (tx) => {
    const types = await tx
      .select({ id: s.mealTypes.id })
      .from(s.mealTypes)
      .where(and(eq(s.mealTypes.userId, userId), isNull(s.mealTypes.deletedAt)));
    if (types.length)
      await tx
        .insert(s.mealLoggingStatuses)
        .values(
          types.map((type) => ({
            userId,
            logDate: date,
            mealTypeId: type.id,
            skipped: false,
            decisionId: randomUUID(),
          })),
        )
        .onConflictDoNothing();
    const existing = await tx
      .select()
      .from(s.mealLoggingStatuses)
      .where(
        and(eq(s.mealLoggingStatuses.userId, userId), eq(s.mealLoggingStatuses.logDate, date)),
      );
    for (const choice of existing) {
      const retired =
        !types.some((type) => type.id === choice.mealTypeId) &&
        (choice.retired || choice.skipped);
      if (retired !== choice.retired)
        await tx
          .update(s.mealLoggingStatuses)
          .set({ retired, updatedAt: new Date() })
          .where(eq(s.mealLoggingStatuses.id, choice.id));
    }
  });
}

export async function listMealLoggingStatuses(db: Db, userId: string, date: string) {
  const rows = await listMealLoggingStatusesRange(db, userId, date, date);
  return rows.map(({ date: _date, ...row }) => row);
}

/** The same rows for `from`..`to` in one read, each tagged with its `date`. */
export async function listMealLoggingStatusesRange(db: Db, userId: string, from: string, to: string) {
  const { choices, logs, types } = await readWindow(db, userId, from, to);
  return choices
    .filter((choice) => !choice.retired && types.some((type) => type.id === choice.mealTypeId))
    .map((choice) => ({
      date: choice.logDate,
      mealTypeId: choice.mealTypeId,
      skipped: isSkipped(choice, logs),
      explicit: choice.explicit,
      decisionId: choice.decisionId,
    }));
}

export async function listMealLoggingCompleteness(
  db: Db,
  userId: string,
  from: string,
  to: string,
) {
  const { choices, logs } = await readWindow(db, userId, from, to);
  return [...new Set(choices.map((choice) => choice.logDate))].map((date) => {
    const recorded = logs
      .filter((log) => log.date === date && !log.deletedAt)
      .map((log) => log.mealTypeId);
    const complete = mealLoggingComplete(
      [
        ...new Set([
          ...choices
            .filter((choice) => choice.logDate === date && !choice.retired)
            .map((choice) => choice.mealTypeId),
          ...recorded,
        ]),
      ],
      recorded,
      choices
        .filter((choice) => choice.logDate === date && isSkipped(choice, logs))
        .map((choice) => choice.mealTypeId),
    );
    const explicit = choices.some((choice) => choice.logDate === date && choice.explicit);
    return {
      date,
      complete: explicit && complete,
      zeroIntake: explicit && complete && recorded.length === 0,
      explicit,
    };
  });
}

export async function setMealLoggingStatus(
  db: Db,
  userId: string,
  date: string,
  mealTypeId: string,
  skipped: boolean,
  decisionId: string,
) {
  const [owned] = await db
    .select({ id: s.mealTypes.id })
    .from(s.mealTypes)
    .where(
      and(
        eq(s.mealTypes.id, mealTypeId),
        eq(s.mealTypes.userId, userId),
        isNull(s.mealTypes.deletedAt),
      ),
    )
    .limit(1);
  if (!owned) throw new NotFoundError('Meal type');
  const { choices } = await readWindow(db, userId, date, date);
  if (!choices.length) await ensureMealLoggingDay(db, userId, date);
  await db.transaction(async (tx) => {
    const [type] = await tx
      .select({ id: s.mealTypes.id })
      .from(s.mealTypes)
      .where(
        and(
          eq(s.mealTypes.id, mealTypeId),
          eq(s.mealTypes.userId, userId),
          isNull(s.mealTypes.deletedAt),
        ),
      )
      .limit(1);
    if (!type) throw new NotFoundError('Meal type');
    if (skipped) {
      const [food] = await tx
        .select({ id: s.foodLogs.id })
        .from(s.foodLogs)
        .where(
          and(
            eq(s.foodLogs.userId, userId),
            eq(s.foodLogs.date, date),
            eq(s.foodLogs.mealTypeId, mealTypeId),
            isNull(s.foodLogs.deletedAt),
          ),
        )
        .limit(1);
      if (food)
        throw new UserFacingError(
          'This meal has recorded food. Remove or move its entries before marking it skipped.',
          409,
        );
    }
    await tx
      .insert(s.mealLoggingStatuses)
      .values({ userId, logDate: date, mealTypeId, skipped, decisionId, explicit: true })
      .onConflictDoUpdate({
        target: [
          s.mealLoggingStatuses.userId,
          s.mealLoggingStatuses.logDate,
          s.mealLoggingStatuses.mealTypeId,
        ],
        set: {
          skipped,
          explicit: true,
          decisionId,
          decidedAt: new Date(),
          retired: false,
          updatedAt: new Date(),
        },
        setWhere: ne(s.mealLoggingStatuses.decisionId, decisionId),
      });
  });
}
