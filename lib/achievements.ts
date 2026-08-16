import { getDb } from '@/lib/data/postgres/client'
import { sql } from 'drizzle-orm'
import { formatInTimeZone } from 'date-fns-tz'
import type { AchievementResult } from '@/components/profile/achievements-grid'
import { calorieDayHitsGoal } from '@trainingai/shared/achievements-calc'
import { reconcileUserStats } from '@/lib/data/postgres/slices/user-stats'

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5800, 8000]

function getLevelLabel(level: number): string {
  if (level <= 2) return 'Novice'
  if (level <= 4) return 'Beginner'
  if (level <= 6) return 'Intermediate'
  if (level <= 8) return 'Advanced'
  if (level <= 10) return 'Elite'
  return 'Legend'
}

function computeLevel(xp: number): { level: number; levelLabel: string; currentLevelXp: number; nextLevelXp: number } {
  let level = 1
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1
    else break
  }
  const currentLevelXp = LEVEL_THRESHOLDS[level - 1] ?? 0
  const nextLevelXp = LEVEL_THRESHOLDS[level] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]
  return { level, levelLabel: getLevelLabel(level), currentLevelXp, nextLevelXp }
}

export function computeStreak(dates: string[], tz: string, maxRestGap = 0): { best: number; current: number } {
  if (dates.length === 0) return { best: 0, current: 0 }

  const sorted = [...dates].sort()

  let best = 1, streak = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays - 1 <= maxRestGap) {
      streak++
      if (streak > best) best = streak
    } else {
      streak = 1
    }
  }

  // current streak: compare date strings in the user's timezone to avoid UTC-midnight drift
  const todayStr     = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const yesterdayStr = formatInTimeZone(new Date(Date.now() - 86_400_000), tz, 'yyyy-MM-dd')
  const mostRecentStr = sorted[sorted.length - 1]

  if (mostRecentStr !== todayStr && mostRecentStr !== yesterdayStr) return { best, current: 0 }

  let current = 1
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = new Date(sorted[i])
    const b = new Date(sorted[i + 1])
    const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000)
    if (diff - 1 <= maxRestGap) current++
    else break
  }

  return { best, current }
}

export interface AchievementsResult {
  level: number
  levelLabel: string
  xp: number
  currentLevelXp: number
  nextLevelXp: number
  lifetimeStats: { sessions: number; totalVolumeKg: number; bestStreak: number; totalSets: number; totalDistanceKm: number }
  achievements: AchievementResult[]
}

export async function computeAchievements(userId: string, tz: string): Promise<AchievementsResult> {
  const db = getDb()

  // Self-heal the fast-path user_stats counter before reading it (SYNC-T1) —
  // it's only ever incremented, never decremented on delete.
  await reconcileUserStats(db, userId)

  const [
    userStatsRes,
    prCountRes,
    prValuesRes,
    earlyBirdRes,
    nightOwlRes,
    workoutDatesRes,
    foodDatesRes,
    sleepRes,
    weightCountRes,
    calorieDaysRes,
    calorieTargetRes,
    maxStepsRes,
    distanceRes,
    goalDirRes,
  ] = await Promise.all([
    db.execute(sql`
      SELECT total_sessions, total_volume_kg, total_sets
      FROM user_stats WHERE user_id = ${userId}::uuid
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count FROM personal_records WHERE user_id = ${userId}::uuid
    `),
    // Weighted lifts only. The kg milestones below ("Achieve 100kg squat 1RM") compare against a
    // real load, but a bodyweight PR is BW_REF-relative — a Pull-Up sits around 118 with no weight
    // on the bar. `prFor` matches by substring, so a bodyweight movement whose name contains
    // "squat" (a Pistol Squat, say) would unlock Century Squat the moment it was first logged.
    // Nothing in the library does today; this stops it becoming true later (finding Q-19).
    db.execute(sql`
      SELECT pr.exercise_name, pr.estimated_1rm
      FROM personal_records pr
      LEFT JOIN exercise_library el ON el.name = pr.exercise_name
      WHERE pr.user_id = ${userId}::uuid
        AND COALESCE(el.exercise_type, 'weighted') <> 'bodyweight'
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM workout_sessions ws
      JOIN exercise_logs el ON el.workout_session_id = ws.id
      WHERE ws.user_id = ${userId}::uuid
        AND EXTRACT(HOUR FROM ws.started_at AT TIME ZONE ${tz}) < 7
        AND ws.deleted_at IS NULL AND el.deleted_at IS NULL
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM workout_sessions ws
      JOIN exercise_logs el ON el.workout_session_id = ws.id
      WHERE ws.user_id = ${userId}::uuid
        AND EXTRACT(HOUR FROM ws.started_at AT TIME ZONE ${tz}) >= 21
        AND ws.deleted_at IS NULL AND el.deleted_at IS NULL
    `),
    db.execute(sql`
      SELECT DISTINCT (ws.started_at AT TIME ZONE ${tz})::date AS day
      FROM workout_sessions ws
      JOIN exercise_logs el ON el.workout_session_id = ws.id
      WHERE ws.user_id = ${userId}::uuid
        AND ws.deleted_at IS NULL AND el.deleted_at IS NULL
      ORDER BY day DESC
    `),
    db.execute(sql`
      SELECT DISTINCT (fl.logged_at AT TIME ZONE ${tz})::date AS day
      FROM food_logs fl
      WHERE fl.user_id = ${userId}::uuid
      ORDER BY day DESC
    `),
    db.execute(sql`
      SELECT date, duration_hours FROM sleep_sessions WHERE user_id = ${userId}::uuid ORDER BY date DESC
    `),
    db.execute(sql`
      SELECT COUNT(DISTINCT date)::int AS count
      FROM body_metrics
      WHERE user_id = ${userId}::uuid AND weight_kg IS NOT NULL
    `),
    db.execute(sql`
      SELECT (fl.logged_at AT TIME ZONE ${tz})::date AS day, SUM(fi.calories * fl.quantity_multiplier) AS total_cals
      FROM food_logs fl
      JOIN food_items fi ON fl.food_item_id = fi.id
      WHERE fl.user_id = ${userId}::uuid
      GROUP BY day
      ORDER BY day DESC
    `),
    db.execute(sql`
      SELECT calories AS daily_calories FROM nutrition_targets WHERE user_id = ${userId}::uuid LIMIT 1
    `),
    db.execute(sql`
      SELECT COALESCE(MAX(steps), 0)::int AS max_steps
      FROM body_metrics
      WHERE user_id = ${userId}::uuid AND steps IS NOT NULL
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(distance_km), 0)::float AS total
      FROM activity_logs
      WHERE user_id = ${userId}::uuid
    `),
    db.execute(sql`
      SELECT
        (SELECT target_weight_kg FROM users WHERE id = ${userId}::uuid) AS target_weight,
        (SELECT weight_kg FROM body_metrics
          WHERE user_id = ${userId}::uuid AND weight_kg IS NOT NULL
          ORDER BY date DESC LIMIT 1) AS current_weight
    `),
  ])

  const statsRow = userStatsRes.rows[0] as { total_sessions: number; total_volume_kg: number; total_sets: number } | undefined
  const totalSessions = Number(statsRow?.total_sessions ?? 0)
  const totalVolumeKg = Number(statsRow?.total_volume_kg ?? 0)
  const totalSets = Number(statsRow?.total_sets ?? 0)
  const prCount = Number((prCountRes.rows[0] as { count: number })?.count ?? 0)
  const earlyBirdCount = Number((earlyBirdRes.rows[0] as { count: number })?.count ?? 0)
  const nightOwlCount = Number((nightOwlRes.rows[0] as { count: number })?.count ?? 0)
  const weightLogCount = Number((weightCountRes.rows[0] as { count: number })?.count ?? 0)
  const calorieTarget = Number((calorieTargetRes.rows[0] as { daily_calories: number } | undefined)?.daily_calories ?? 0)
  const maxDailySteps = Number((maxStepsRes.rows[0] as { max_steps: number })?.max_steps ?? 0)
  const totalDistanceKm = Number((distanceRes.rows[0] as { total: number })?.total ?? 0)

  const prValues = (prValuesRes.rows as Array<{ exercise_name: string; estimated_1rm: number }>)

  const workoutDates = (workoutDatesRes.rows as Array<{ day: string }>).map(r => String(r.day))
  const foodDates = (foodDatesRes.rows as Array<{ day: string }>).map(r => String(r.day))
  const sleepDates = (sleepRes.rows as Array<{ date: string; duration_hours: number | null }>).map(r => String(r.date))

  const calorieDays = (calorieDaysRes.rows as Array<{ day: string; total_cals: number }>)

  // 1 rest day allowed without breaking the streak — matches the home
  // screen's streak definition (session-select-content.tsx).
  const workoutStreaks = computeStreak(workoutDates, tz, 1)
  const foodStreaks = computeStreak(foodDates, tz)
  const sleepStreaks = computeStreak(sleepDates, tz)

  const goalRow = goalDirRes.rows[0] as { target_weight: number | null; current_weight: number | null } | undefined
  const calorieGoalDates = calorieTarget > 0
    ? calorieDays
        .filter(d => calorieDayHitsGoal(Number(d.total_cals), calorieTarget, goalRow?.target_weight ?? null, goalRow?.current_weight ?? null))
        .map(d => String(d.day))
    : []
  const calorieGoalStreaks = computeStreak(calorieGoalDates, tz)

  const monthsActive = new Set(workoutDates.map(d => d.slice(0, 7))).size

  const bestStreak = workoutStreaks.best

  function prFor(namePart: string, exclude?: string): number {
    const match = prValues.find(p => {
      const n = p.exercise_name.toLowerCase()
      return n.includes(namePart) && (!exclude || !n.includes(exclude))
    })
    return match ? Number(match.estimated_1rm) : 0
  }

  type AchievementDef = {
    id: string
    name: string
    description: string
    icon: string
    category: string
    xpReward: number
    goal: number
    current: number
  }

  const defs: AchievementDef[] = [
    // WORKOUTS
    { id: 'first_session',  name: 'First Rep',         description: 'Complete your first workout',    icon: '🏋️', category: 'Workouts',       xpReward: 10,  goal: 1,      current: totalSessions },
    { id: 'sessions_10',    name: 'Getting Started',   description: '10 sessions done',               icon: '💪', category: 'Workouts',       xpReward: 25,  goal: 10,     current: totalSessions },
    { id: 'sessions_25',    name: 'Regular',           description: '25 sessions done',               icon: '🔄', category: 'Workouts',       xpReward: 50,  goal: 25,     current: totalSessions },
    { id: 'sessions_50',    name: 'Dedicated',         description: '50 sessions done',               icon: '⚡', category: 'Workouts',       xpReward: 100, goal: 50,     current: totalSessions },
    { id: 'sessions_100',   name: 'Century',           description: '100 sessions done',              icon: '🏆', category: 'Workouts',       xpReward: 200, goal: 100,    current: totalSessions },
    { id: 'sessions_250',   name: 'Elite',             description: '250 sessions done',              icon: '👑', category: 'Workouts',       xpReward: 500, goal: 250,    current: totalSessions },
    // VOLUME
    { id: 'volume_1k',      name: 'Foundation',        description: 'Lift 1,000 kg total',            icon: '🏗️', category: 'Volume',         xpReward: 25,  goal: 1000,   current: totalVolumeKg },
    { id: 'volume_10k',     name: 'Ton Club',          description: 'Lift 10,000 kg total',           icon: '💎', category: 'Volume',         xpReward: 75,  goal: 10000,  current: totalVolumeKg },
    { id: 'volume_50k',     name: 'Iron Beast',        description: 'Lift 50,000 kg total',           icon: '🦁', category: 'Volume',         xpReward: 150, goal: 50000,  current: totalVolumeKg },
    { id: 'volume_100k',    name: 'Powerhouse',        description: 'Lift 100,000 kg total',          icon: '🚀', category: 'Volume',         xpReward: 300, goal: 100000, current: totalVolumeKg },
    { id: 'volume_500k',    name: 'Half Million',      description: 'Lift 500,000 kg total',          icon: '⚡', category: 'Volume',         xpReward: 750, goal: 500000, current: totalVolumeKg },
    // SETS
    { id: 'sets_100',       name: 'Hundred Sets',      description: 'Log 100 sets',                   icon: '🎯', category: 'Sets',           xpReward: 15,  goal: 100,    current: totalSets },
    { id: 'sets_1000',      name: 'Thousand Sets',     description: 'Log 1,000 sets',                 icon: '💪', category: 'Sets',           xpReward: 75,  goal: 1000,   current: totalSets },
    { id: 'sets_5000',      name: 'Set Machine',       description: 'Log 5,000 sets',                 icon: '🏋️', category: 'Sets',           xpReward: 300, goal: 5000,   current: totalSets },
    // STREAKS
    { id: 'streak_7',       name: 'Week Warrior',      description: '7-day training streak',          icon: '🔥', category: 'Streaks',        xpReward: 50,  goal: 7,      current: bestStreak },
    { id: 'streak_14',      name: 'Fortnight Fighter', description: '14-day training streak',         icon: '💫', category: 'Streaks',        xpReward: 100, goal: 14,     current: bestStreak },
    { id: 'streak_30',      name: 'Month Strong',      description: '30-day training streak',         icon: '🌟', category: 'Streaks',        xpReward: 200, goal: 30,     current: bestStreak },
    { id: 'streak_60',      name: 'Iron Will',         description: '60-day training streak',         icon: '⚔️', category: 'Streaks',        xpReward: 400, goal: 60,     current: bestStreak },
    // PERSONAL RECORDS
    { id: 'first_pr',       name: 'First PR',          description: 'Break your first personal record', icon: '🏆', category: 'Records',    xpReward: 25,  goal: 1,      current: prCount },
    { id: 'prs_5',          name: 'Record Breaker',    description: 'Break 5 personal records',       icon: '🎯', category: 'Records',        xpReward: 50,  goal: 5,      current: prCount },
    { id: 'prs_10',         name: '10 PRs',            description: 'Break 10 personal records',      icon: '💎', category: 'Records',        xpReward: 100, goal: 10,     current: prCount },
    { id: 'prs_25',         name: 'PR Machine',        description: 'Break 25 personal records',      icon: '🌟', category: 'Records',        xpReward: 250, goal: 25,     current: prCount },
    // TIMING
    { id: 'early_bird',     name: 'Early Bird',        description: 'Complete a workout before 7am',  icon: '🌅', category: 'Timing',         xpReward: 50,  goal: 1,      current: earlyBirdCount },
    { id: 'early_bird_5',   name: 'Dawn Warrior',      description: '5 workouts before 7am',          icon: '🌄', category: 'Timing',         xpReward: 150, goal: 5,      current: earlyBirdCount },
    { id: 'night_owl',      name: 'Night Owl',         description: 'Complete a workout after 9pm',   icon: '🦉', category: 'Timing',         xpReward: 50,  goal: 1,      current: nightOwlCount },
    // CONSISTENCY
    { id: 'months_3',       name: '3-Month Club',      description: 'Train across 3 calendar months', icon: '📅', category: 'Consistency',    xpReward: 100, goal: 3,      current: monthsActive },
    { id: 'months_6',       name: 'Half Year',         description: 'Train across 6 calendar months', icon: '📆', category: 'Consistency',    xpReward: 250, goal: 6,      current: monthsActive },
    { id: 'months_12',      name: 'Full Year',         description: 'Train across 12 calendar months',icon: '🗓️', category: 'Consistency',    xpReward: 750, goal: 12,     current: monthsActive },
    // NUTRITION
    { id: 'food_first',     name: 'Nutrition Start',   description: 'Log food for the first time',    icon: '🥗', category: 'Nutrition',      xpReward: 10,  goal: 1,      current: foodDates.length },
    { id: 'food_streak_7',  name: 'Food Week',         description: 'Log food 7 days in a row',       icon: '🍎', category: 'Nutrition',      xpReward: 50,  goal: 7,      current: foodStreaks.best },
    { id: 'food_streak_30', name: 'Food Month',        description: 'Log food 30 days in a row',      icon: '🥑', category: 'Nutrition',      xpReward: 150, goal: 30,     current: foodStreaks.best },
    { id: 'calorie_goal_7', name: 'Calorie Crusher',   description: 'Hit your calorie goal 7 days straight', icon: '🎯', category: 'Nutrition', xpReward: 100, goal: 7,  current: calorieGoalStreaks.best },
    { id: 'calorie_goal_30',name: 'Macro Master',      description: 'Hit calorie goal 30 days in a row', icon: '💚', category: 'Nutrition', xpReward: 300, goal: 30,      current: calorieGoalStreaks.best },
    // SLEEP
    { id: 'sleep_first',    name: 'First Rest',        description: 'Log your first sleep session',   icon: '😴', category: 'Sleep',          xpReward: 10,  goal: 1,      current: sleepDates.length },
    { id: 'sleep_streak_7', name: 'Sleep Week',        description: 'Track sleep 7 days in a row',    icon: '🌙', category: 'Sleep',          xpReward: 50,  goal: 7,      current: sleepStreaks.best },
    { id: 'sleep_streak_30',name: 'Sleep Month',       description: 'Track sleep 30 days in a row',   icon: '💤', category: 'Sleep',          xpReward: 150, goal: 30,     current: sleepStreaks.best },
    // BODY METRICS
    { id: 'weight_first',   name: 'Weigh In',          description: 'Log your body weight',           icon: '⚖️', category: 'Body Metrics',   xpReward: 10,  goal: 1,      current: weightLogCount },
    { id: 'weight_30',      name: 'Tracked',           description: 'Log body weight on 30 different days', icon: '📊', category: 'Body Metrics', xpReward: 100, goal: 30, current: weightLogCount },
    // STEPS (best single-day count)
    { id: 'steps_5k',  name: 'Walker',        description: 'Hit 5,000 steps in a day',  icon: '🚶', category: 'Steps', xpReward: 25,  goal: 5000,  current: maxDailySteps },
    { id: 'steps_10k', name: 'Day Tripper',   description: 'Hit 10,000 steps in a day', icon: '👟', category: 'Steps', xpReward: 50,  goal: 10000, current: maxDailySteps },
    { id: 'steps_20k', name: 'Pacer',         description: 'Hit 20,000 steps in a day', icon: '🏃', category: 'Steps', xpReward: 100, goal: 20000, current: maxDailySteps },
    { id: 'steps_30k', name: 'Road Runner',   description: 'Hit 30,000 steps in a day', icon: '⚡', category: 'Steps', xpReward: 150, goal: 30000, current: maxDailySteps },
    { id: 'steps_40k', name: 'Iron Legs',     description: 'Hit 40,000 steps in a day', icon: '🦾', category: 'Steps', xpReward: 250, goal: 40000, current: maxDailySteps },
    { id: 'steps_50k', name: 'Ultramarathon', description: 'Hit 50,000 steps in a day', icon: '🏅', category: 'Steps', xpReward: 500, goal: 50000, current: maxDailySteps },
    // LIFT MILESTONES
    { id: 'squat_100',      name: 'Century Squat',     description: 'Achieve 100kg squat 1RM',        icon: '🏋️', category: 'Lift Milestones', xpReward: 10, goal: 100, current: prFor('squat', 'split') },
    { id: 'bench_100',      name: 'Century Bench',     description: 'Achieve 100kg bench press 1RM',  icon: '💪', category: 'Lift Milestones', xpReward: 10, goal: 100, current: prFor('bench') },
    { id: 'deadlift_100',   name: 'Century Pull',      description: 'Achieve 100kg deadlift 1RM',     icon: '🦁', category: 'Lift Milestones', xpReward: 10, goal: 100, current: Math.max(prFor('deadlift'), prFor('rdl')) },
  ]

  const achievements: AchievementResult[] = defs.map(def => {
    const unlocked = def.current >= def.goal
    const progress = Math.min(1, def.current / def.goal)
    return { ...def, unlocked, progress }
  })

  const xp = achievements.filter(a => a.unlocked).reduce((s, a) => s + a.xpReward, 0)
  const { level, levelLabel, currentLevelXp, nextLevelXp } = computeLevel(xp)

  return {
    level,
    levelLabel,
    xp,
    currentLevelXp,
    nextLevelXp,
    lifetimeStats: {
      sessions: totalSessions,
      totalVolumeKg,
      bestStreak,
      totalSets,
      totalDistanceKm,
    },
    achievements,
  }
}
