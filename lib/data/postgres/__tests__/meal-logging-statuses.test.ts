import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import {
  listMealLoggingStatuses,
  listMealLoggingCompleteness,
  setMealLoggingStatus,
  ensureMealLoggingDay,
} from '../slices/meal-logging-statuses'
import { createFoodLog, deleteFoodLog } from '../slices/nutrition'
import { getDb, getPool } from '../client'

const url = process.env.DATABASE_URL
const canRun = !!url && ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)

describe.skipIf(!canRun)('meal status persistence', () => {
  const user = randomUUID(),
    other = randomUUID(),
    breakfast = randomUUID(),
    dinner = randomUUID(),
    food = randomUUID()
  const date = todayInTz('Australia/Brisbane')
  beforeAll(async () => {
    await getPool().query(
      'INSERT INTO users (id, email, name, timezone) VALUES ($1, $2, $3, $4), ($5, $6, $3, $4)',
      [
        user,
        `${user}@example.invalid`,
        'Meal status fixture',
        'Australia/Brisbane',
        other,
        `${other}@example.invalid`,
      ],
    )
    await getPool().query(
      'INSERT INTO meal_types (id, user_id, name, sort_order) VALUES ($1, $3, $4, 0), ($2, $3, $5, 1)',
      [breakfast, dinner, user, 'Breakfast', 'Dinner'],
    )
    await getPool().query(
      'INSERT INTO food_items (id, user_id, name, calories, source) VALUES ($1, $2, $3, 300, $4)',
      [food, user, 'Sample food', 'manual'],
    )
  })
  afterAll(async () => {
    await getPool().query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[user, other]])
    await getPool().end()
  })
  it('keeps an unrecorded breakfast unknown, and accepts an explicit skip', async () => {
    expect(await listMealLoggingStatuses(getDb(), user, date)).toEqual([])
    await createFoodLog(getDb(), user, {
      date,
      mealTypeId: dinner,
      foodItemId: food,
      quantityMultiplier: 1,
    })
    await setMealLoggingStatus(getDb(), user, date, dinner, false, randomUUID())
    expect((await listMealLoggingCompleteness(getDb(), user, date, date))[0].complete).toBe(
      false,
    )
    await setMealLoggingStatus(getDb(), user, date, breakfast, true, randomUUID())
    expect((await listMealLoggingCompleteness(getDb(), user, date, date))[0]).toEqual({
      date,
      complete: true,
      zeroIntake: false,
    })
  })
  it('does not change a skipped decision timestamp when a lost reply is retried', async () => {
    const id = randomUUID()
    await setMealLoggingStatus(getDb(), user, date, breakfast, true, id)
    const read = async () =>
      (
        await getPool().query(
          'SELECT updated_at FROM meal_logging_statuses WHERE user_id=$1 AND meal_type_id=$2',
          [user, breakfast],
        )
      ).rows[0].updated_at
    const first = await read()
    await setMealLoggingStatus(getDb(), user, date, breakfast, true, id)
    expect(await read()).toEqual(first)
  })
  it('rejects skipping recorded food and IDs belonging to another account', async () => {
    await expect(
      setMealLoggingStatus(getDb(), user, date, dinner, true, randomUUID()),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      setMealLoggingStatus(getDb(), other, date, breakfast, true, randomUUID()),
    ).rejects.toMatchObject({ name: 'NotFoundError' })
    expect(await listMealLoggingStatuses(getDb(), other, date)).toEqual([])
  })
  it('does not resurrect a skip after recording and deleting its food', async () => {
    await getPool().query(
      "UPDATE meal_logging_statuses SET decided_at=now()-interval '1 hour' WHERE user_id=$1 AND meal_type_id=$2",
      [user, breakfast],
    )
    const log = await createFoodLog(getDb(), user, {
      date,
      mealTypeId: breakfast,
      foodItemId: food,
      quantityMultiplier: 1,
    })
    expect(
      (await listMealLoggingStatuses(getDb(), user, date)).find(
        (row) => row.mealTypeId === breakfast,
      )?.skipped,
    ).toBe(false)
    await deleteFoodLog(getDb(), log.id, user)
    expect(
      (await listMealLoggingStatuses(getDb(), user, date)).find(
        (row) => row.mealTypeId === breakfast,
      )?.skipped,
    ).toBe(false)
    expect((await listMealLoggingCompleteness(getDb(), user, date, date))[0].complete).toBe(
      false,
    )
  })
  it('moves recorded food to its new meal group on an offline log edit', async () => {
    const id = randomUUID()
    await createFoodLog(getDb(), user, {
      id,
      date,
      mealTypeId: breakfast,
      foodItemId: food,
      quantityMultiplier: 1,
    })
    const moved = await createFoodLog(getDb(), user, {
      id,
      date,
      mealTypeId: dinner,
      foodItemId: food,
      quantityMultiplier: 1,
    })
    expect(moved.mealTypeId).toBe(dinner)
    await deleteFoodLog(getDb(), id, user)
  })
  it('keeps the previous day’s groups when another group is added later', async () => {
    const previous = shiftDateStr(date, -1)
    await setMealLoggingStatus(getDb(), user, previous, breakfast, true, randomUUID())
    await setMealLoggingStatus(getDb(), user, previous, dinner, true, randomUUID())
    const added = randomUUID()
    await getPool().query(
      'INSERT INTO meal_types (id, user_id, name, sort_order) VALUES ($1, $2, $3, 2)',
      [added, user, 'New meal'],
    )
    await ensureMealLoggingDay(getDb(), user, date)
    expect((await listMealLoggingCompleteness(getDb(), user, previous, previous))[0]).toEqual({
      date: previous,
      complete: true,
      zeroIntake: true,
    })
    expect(
      (await listMealLoggingStatuses(getDb(), user, date)).find(
        (row) => row.mealTypeId === added,
      )?.skipped,
    ).toBe(false)
  })
})
