#!/usr/bin/env node
/**
 * Issue 2690 — how many past days change their calorie-goal award when each day is judged against
 * that day's budget instead of the typed `nutrition_targets.calories`. READ-ONLY.
 *
 *   node scripts/tuning/calorie-award-replay-2690.cjs --pull     # production, via /api/admin/db-query
 *                                                                #   (needs CLAUDE_DB_QUERY_SECRET)
 *   node scripts/tuning/calorie-award-replay-2690.cjs --local <userId>
 *                                                                # the same reads against DATABASE_URL
 *   node scripts/tuning/calorie-award-replay-2690.cjs --count    # judge both ways and print the diff
 *
 * The reads mirror the repository calls `pastDayCalorieBudgets` makes (`lib/achievements.ts`) and the
 * calorie-day query in `computeAchievements`, column for column. The judging is NOT reimplemented:
 * `--count` bundles the shipped `calorieBudgetsByDay`, `buildBodyFatCalibration`,
 * `calorieDayHitsGoal` and `computeEntryStreak` (see `calorie-award-replay-entry.ts`).
 *
 * Every `claude_ro` view is row-scoped to the owner, so production output is the owner's days only.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DIR = process.env.CAL_REPLAY_DIR || '/tmp/calorie-award-replay'
const API = 'https://trainingai-production.up.railway.app/api/admin/db-query'

// One query per input, all against the owner-scoped views. `::text` on every date keeps the shape a
// `YYYY-MM-DD` string whichever driver reads it.
const QUERIES = {
  user: `SELECT height_cm, date_of_birth::text AS date_of_birth, sex, fitness_goal, target_weight_kg::float AS target_weight_kg,
                calorie_goal, calorie_goal_type, timezone
         FROM claude_ro.users`,
  target: `SELECT calories FROM claude_ro.nutrition_targets LIMIT 1`,
  // `listBodyMetrics` skips tombstoned rows (#2802); this mirrors it.
  metrics: `SELECT date::text AS date, weight_kg::float AS weight_kg, body_fat_pct::float AS body_fat_pct,
                   source_map->>'body_fat_pct' AS body_fat_source, steps, bmr_kcal::float AS bmr_kcal
            FROM claude_ro.body_metrics WHERE deleted_at IS NULL ORDER BY date`,
  dexa: `SELECT scanned_on::text AS scanned_on, pct_fat::float AS pct_fat FROM claude_ro.dexa_scans WHERE pct_fat IS NOT NULL`,
  rmr: `SELECT measured_on::text AS measured_on, rmr_kcal::float AS rmr_kcal, ffm_kg_at_test::float AS ffm_kg_at_test
        FROM claude_ro.measured_rmr`,
  workouts: `SELECT id, started_at, completed_at, session_rpe::float AS session_rpe
             FROM claude_ro.workout_sessions WHERE deleted_at IS NULL`,
  hr: `SELECT workout_session_id, avg_bpm::float AS avg_bpm FROM claude_ro.workout_hr_stats WHERE avg_bpm IS NOT NULL`,
  activities: `SELECT date::text AS date, activity_type, duration_min::float AS duration_min, distance_km::float AS distance_km
               FROM claude_ro.activity_logs WHERE deleted_at IS NULL`,
  // `computeAchievements`'s calorie-day and goal-direction reads, in the user's own timezone.
  days: `SELECT ((fl.logged_at AT TIME ZONE u.timezone)::date)::text AS day, SUM(fi.calories * fl.quantity_multiplier)::float AS total_cals
         FROM claude_ro.food_logs fl JOIN claude_ro.food_items fi ON fl.food_item_id = fi.id CROSS JOIN claude_ro.users u
         WHERE fl.deleted_at IS NULL GROUP BY 1 ORDER BY 1`,
  current: `SELECT weight_kg::float AS current_weight FROM claude_ro.body_metrics
            WHERE weight_kg IS NOT NULL AND deleted_at IS NULL ORDER BY date DESC LIMIT 1`,
}

function save(name, rows) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify({ rows }))
}

function pullProduction() {
  const secret = process.env.CLAUDE_DB_QUERY_SECRET
  if (!secret) throw new Error('CLAUDE_DB_QUERY_SECRET is not set')
  for (const [name, sql] of Object.entries(QUERIES)) {
    const res = execFileSync('curl', [
      '-sS', '-X', 'POST', API,
      '-H', `Authorization: Bearer ${secret}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ sql }),
    ], { maxBuffer: 1 << 28, encoding: 'utf8' })
    const parsed = JSON.parse(res)
    if (parsed.error) throw new Error(`db-query (${name}): ${parsed.error}`)
    if (parsed.truncated) throw new Error(`db-query truncated ${name} — the replay needs every row`)
    save(name, parsed.rows)
  }
  console.log(`pulled ${Object.keys(QUERIES).length} reads into ${DIR}`)
}

async function pullLocal(userId) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  if (!/^[0-9a-f-]{36}$/.test(userId || '')) throw new Error('--local needs a user id')
  const { Client } = require('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    // The views scope themselves to this setting, exactly as they do for the owner in production.
    await client.query(`SELECT set_config('app.claude_ro_owner', $1, false)`, [userId])
    for (const [name, sql] of Object.entries(QUERIES)) save(name, (await client.query(sql)).rows)
  } finally {
    await client.end()
  }
  console.log(`pulled ${Object.keys(QUERIES).length} local reads for ${userId} into ${DIR}`)
}

function bundle() {
  const root = path.resolve(__dirname, '../..')
  // Inside the repo's node_modules, not DIR: the bundle keeps its packages external, and Node resolves
  // them from the bundle's own location.
  const file = path.join(root, 'node_modules/.cache/calorie-award-replay/replay-entry.cjs')
  const win = process.platform === 'win32'
  execFileSync(win ? 'npx.cmd' : 'npx', ['esbuild', path.join(__dirname, 'calorie-award-replay-entry.ts'),
    '--bundle', '--format=cjs', '--platform=node', '--external:pg-native', '--tsconfig=tsconfig.json', '--log-level=error', `--outfile=${file}`],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], shell: win })
  return require(file)
}

/**
 * Movement kcal reads the energy model's constants, which production downloads at boot and the repo
 * does not carry. Use the real ones when they are on disk (`OURA_CONSTANTS_DIR`, or `.oura-constants`
 * after a `pnpm dev` boot); otherwise fall back to the test fixtures and say so, because then the
 * movement half of every budget — and so the count — is approximate.
 */
function resolveConstants() {
  const root = path.resolve(__dirname, '../..')
  if (process.env.OURA_CONSTANTS_DIR) return true
  for (const dir of [path.join(root, '.oura-constants'), path.join(root, 'lib/oura-models/constants')]) {
    if (fs.existsSync(path.join(dir, 'MANIFEST.json'))) { process.env.OURA_CONSTANTS_DIR = dir; return true }
  }
  process.env.OURA_CONSTANTS_DIR = path.join(root, 'lib/oura-models/__fixtures__/constants')
  return false
}

function count() {
  const read = name => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8')).rows
  if (!resolveConstants()) {
    console.log('⚠ Real energy constants not found: movement uses the TEST FIXTURES, so the count is approximate.')
    console.log('  Set OURA_CONSTANTS_DIR, or run `pnpm dev` once so boot downloads them into .oura-constants.')
  }
  const num = v => (v == null ? null : Number(v))
  const lib = bundle()

  const user = read('user')[0]
  if (!user) throw new Error('no user row — check the pull')
  const tz = user.timezone || 'Australia/Brisbane'
  const typed = Number(read('target')[0]?.calories ?? 0)
  const currentWeight = num(read('current')[0]?.current_weight)
  const targetWeight = num(user.target_weight_kg)
  const days = read('days').map(d => ({ day: String(d.day), total: Number(d.total_cals) }))
  const metrics = read('metrics').map(m => ({
    date: m.date, weightKg: num(m.weight_kg), bodyFatPct: num(m.body_fat_pct),
    bodyFatSource: m.body_fat_source ?? null, steps: num(m.steps), bmrKcal: num(m.bmr_kcal),
  }))
  const calibration = lib.buildBodyFatCalibration({
    scans: read('dexa').map(s => ({ scannedOn: s.scanned_on, pctFat: Number(s.pct_fat) })),
    readings: metrics.filter(m => m.bodyFatPct != null).map(m => ({
      date: m.date, bodyFatPct: m.bodyFatPct, source: m.bodyFatSource, weightKg: m.weightKg, bmrKcal: m.bmrKcal,
    })),
    profile: { heightCm: num(user.height_cm), dateOfBirth: user.date_of_birth, sex: user.sex },
    source: lib.DEFAULT_CALIBRATED_SOURCE,
  })
  const workouts = read('workouts').map(w => ({
    id: w.id, startedAt: new Date(w.started_at), completedAt: w.completed_at ? new Date(w.completed_at) : null,
    sessionRpe: num(w.session_rpe),
  }))
  const budgets = lib.calorieBudgetsByDay({
    days: days.map(d => d.day), tz, metrics, bodyFatCalibration: calibration,
    measuredRmrs: read('rmr').map(r => ({ measuredOn: r.measured_on, rmrKcal: Number(r.rmr_kcal), ffmKgAtTest: num(r.ffm_kg_at_test) })),
    heightCm: num(user.height_cm), dateOfBirth: user.date_of_birth,
    sex: user.sex === 'male' || user.sex === 'female' ? user.sex : null,
    goal: user.fitness_goal ?? null, targetWeightKg: targetWeight,
    ownTargetKcal: lib.ownTargetFromGoals({ calorieGoal: num(user.calorie_goal), calorieGoalType: user.calorie_goal_type }),
    workouts, avgBpmBySession: new Map(read('hr').map(h => [h.workout_session_id, Number(h.avg_bpm)])),
    activities: read('activities').map(a => ({
      date: a.date, activityType: a.activity_type, durationMin: num(a.duration_min), distanceKm: num(a.distance_km),
    })),
  })

  const hit = (total, target) => target != null && lib.calorieDayHitsGoal(total, target, targetWeight, currentWeight)
  const rows = days.map(d => {
    const budget = budgets.get(d.day) ?? null
    const was = typed > 0 ? hit(d.total, typed) : false
    const now = hit(d.total, budget ?? (typed > 0 ? typed : null))
    return { ...d, budget, was, now }
  })
  const before = lib.computeEntryStreak(rows.filter(r => r.was).map(r => r.day), tz)
  const after = lib.computeEntryStreak(rows.filter(r => r.now).map(r => r.day), tz)

  const gained = rows.filter(r => !r.was && r.now)
  const lost = rows.filter(r => r.was && !r.now)
  const noBudget = rows.filter(r => r.budget == null).length
  const unlock = (best, goal) => (best >= goal ? 'unlocked' : 'locked')
  const fmt = r => `${r.day}  ate ${Math.round(r.total)}  typed ${typed || '—'}  budget ${r.budget ?? '— (typed used)'}`

  console.log(`Food-logged days: ${rows.length} (${noBudget} with no budget, judged against the typed target as before)`)
  console.log(`Typed target: ${typed || 'none'} kcal · own target: ${user.calorie_goal_type === 'own' ? user.calorie_goal : 'none'}`)
  console.log(`Days that change: ${gained.length + lost.length} — ${gained.length} become hits, ${lost.length} stop being hits`)
  for (const r of gained) console.log(`  + ${fmt(r)}`)
  for (const r of lost) console.log(`  − ${fmt(r)}`)
  console.log(`Best streak: ${before.best} → ${after.best} · current: ${before.current} → ${after.current}`)
  console.log(`Calorie Crusher (7): ${unlock(before.best, 7)} → ${unlock(after.best, 7)}`)
  console.log(`Macro Master (30):   ${unlock(before.best, 30)} → ${unlock(after.best, 30)}`)
}

const [, , mode, arg] = process.argv
if (mode === '--pull') pullProduction()
else if (mode === '--local') pullLocal(arg).catch(e => { console.error(e.message); process.exit(1) })
else if (mode === '--count') count()
else {
  console.error('usage: --pull | --local <userId> | --count')
  process.exit(1)
}
