// Issue 3100. The six Steps achievements counted toward "n / m", total XP and XP Sources but never
// showed in the grid: the grid draws only the categories in ACHIEVEMENT_CATEGORY_ORDER, and "Steps"
// was not in it. A category the server adds has to be drawn by both apps, so this reads the real
// result of computeAchievements and checks each category and id against what the clients draw with.
//
// Runs only against a real local dev Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ACHIEVEMENT_CATEGORY_ORDER } from '@trainingai/shared/achievement-display'
import { ACHIEVEMENT_ICONS, CATEGORY_COLORS } from '@/components/profile/achievements-grid'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003100'

describe.skipIf(!canRun)('every achievement the server returns can be drawn', () => {
  let pool: import('pg').Pool
  let result: Awaited<ReturnType<typeof import('@/lib/achievements').computeAchievements>>

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'ach-3100@example.com','x','Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
    result = await (await import('@/lib/achievements')).computeAchievements(USER, 'Australia/Brisbane')
  })
  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('every category is in the grid order', () => {
    const categories = [...new Set(result.achievements.map(a => a.category))]
    expect(categories.length).toBeGreaterThan(10)
    const order: readonly string[] = ACHIEVEMENT_CATEGORY_ORDER
    expect(categories.filter(c => !order.includes(c))).toEqual([])
  })

  it('the Steps achievements are among them', () => {
    expect(result.achievements.filter(a => a.category === 'Steps')).toHaveLength(6)
  })

  it('every category has a colour and every achievement an icon, so none falls back to the dumbbell', () => {
    const categories = [...new Set(result.achievements.map(a => a.category))]
    expect(categories.filter(c => !(c in CATEGORY_COLORS))).toEqual([])
    expect(result.achievements.map(a => a.id).filter(id => !(id in ACHIEVEMENT_ICONS))).toEqual([])
  })
})
