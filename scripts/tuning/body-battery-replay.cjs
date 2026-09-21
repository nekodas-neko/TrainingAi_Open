#!/usr/bin/env node
/**
 * Body Battery offline replay — TN-55's fit harness.
 *
 * Replays the SHIPPED `walkBodyBattery()` over real history pulled from production, and a candidate
 * variant beside it, so charge/drain constants can be fitted without an admin replay endpoint.
 * TN-2 asked for exactly this and assumed it needed server infrastructure; it does not, because
 * `packages/shared/src/health/body-battery-walk.ts` is already a pure function of its inputs.
 *
 *   node scripts/tuning/body-battery-replay.cjs --pull     # fetch inputs (needs CLAUDE_DB_QUERY_SECRET)
 *   node scripts/tuning/body-battery-replay.cjs --validate # prove the harness reproduces production
 *   node scripts/tuning/body-battery-replay.cjs --sweep    # grid-search the constants
 *
 * ⚠ RUN --validate AND READ ITS OUTPUT BEFORE BELIEVING ANY SWEEP NUMBER. The first version of
 * this harness took max(sleep_end) per day as the wake time, which picks up NAPS and put wake at
 * 15:05 or 19:00 — discarding the whole day's heart rate and reporting zero drain on days with
 * 3,000 samples. That is the Q-17 shape, reproduced accidentally. It is caught only by checking
 * the replay against stored values, which is why that step is not optional.
 *
 * ⚠ THE STRESS TERM IS RECONSTRUCTED, NOT REPLAYED. `buildDaytimeStressSeriesFromModel` needs the
 * persisted dHRV model and the daytime signal tables, so this harness infers each day's mean
 * |stressLevel| from the residual (stored drain − replayed HR drain) instead. Measured 2026-09-21
 * that residual implies levels of 0.14–0.62, all inside [0,1], which is what makes the
 * reconstruction credible — but it is an inference, and a conclusion that depends on the stress
 * term's *shape* within a day cannot be drawn from it.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DIR = process.env.BB_REPLAY_DIR || '/tmp/bb-replay'
const API = 'https://trainingai-production.up.railway.app/api/admin/db-query'
const TZ = 'Australia/Brisbane'

// Shipped constants — mirrored from app/api/body-battery/route.ts. If they change there, change
// them here in the same PR; this file deliberately does not import the route.
const SHIPPED = {
  restThreshold: 0.05, chargeRate: 0.20, drainRate: 0.60,
  stressDrainRate: 0.2, gapHoldMin: 30, sampleCapMin: 7,
}

function query(sql, out) {
  const secret = process.env.CLAUDE_DB_QUERY_SECRET
  if (!secret) throw new Error('CLAUDE_DB_QUERY_SECRET is not set')
  const body = JSON.stringify({ sql })
  const res = execFileSync('curl', [
    '-sS', '-X', 'POST', API,
    '-H', `Authorization: Bearer ${secret}`,
    '-H', 'Content-Type: application/json',
    '-d', body,
  ], { maxBuffer: 1 << 28, encoding: 'utf8' })
  const parsed = JSON.parse(res)
  if (parsed.error) throw new Error(`db-query: ${parsed.error}`)
  if (parsed.truncated) throw new Error('db-query truncated the result — narrow the window')
  fs.writeFileSync(path.join(DIR, out), res)
  return parsed.rows
}

function pull(daysBack = 70) {
  fs.mkdirSync(DIR, { recursive: true })
  query(`SELECT date::date AS d, anchor, resting_hr, hr_max, total_charged, total_drained,
          end_value, hr_sample_count
         FROM claude_ro.body_battery_daily
         WHERE date > now() - interval '${daysBack} days' ORDER BY date`, 'days.json')
  query(`SELECT extract(epoch from sleep_start)*1000 AS s, extract(epoch from sleep_end)*1000 AS e
         FROM claude_ro.sleep_sessions
         WHERE sleep_end > now() - interval '${daysBack + 2} days'
           AND sleep_start IS NOT NULL AND sleep_end IS NOT NULL ORDER BY sleep_start`, 'sleep.json')
  // Chunked: one 70-day string_agg exceeds the endpoint's response cap and comes back truncated.
  for (let i = 0; i * 10 < daysBack; i++) {
    const hi = daysBack - i * 10, lo = Math.max(0, hi - 10)
    query(`SELECT (timestamp AT TIME ZONE '${TZ}')::date AS d,
             string_agg((extract(epoch from timestamp)*1000)::bigint || ':' || bpm, ',' ORDER BY timestamp) AS s
           FROM claude_ro.oura_heartrate
           WHERE timestamp >= now() - interval '${hi} days' AND timestamp < now() - interval '${lo} days'
           GROUP BY 1`, `hr_${i}.json`)
  }
  console.log(`pulled ${daysBack} days into ${DIR}`)
}

function bundleShared() {
  const root = path.resolve(__dirname, '../..')
  const out = {}
  for (const [key, src] of [['walk', 'health/body-battery-walk.ts'], ['night', 'health/sleep-night.ts']]) {
    const file = path.join(DIR, `${key}.cjs`)
    execFileSync('npx', ['esbuild', path.join(root, 'packages/shared/src', src),
      '--bundle', '--format=cjs', '--platform=node', `--outfile=${file}`],
      { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] })
    Object.assign(out, require(file))
  }
  return out
}

function load() {
  const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).rows
  // `packages/shared` ships as TypeScript with no build output, so bundle the two shipped modules
  // on the fly. Bundling rather than reimplementing is the whole point: a hand-copied walk would
  // drift from production silently, and the arithmetic being compared is the arithmetic that runs.
  const { walkBodyBattery, nightSessions } = bundleShared()
  const brisDay = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })

  const sessions = read('sleep.json').map(x => {
    const s = Number(x.s), e = Number(x.e)
    return { sleepStart: new Date(s), sleepEnd: new Date(e), date: brisDay(s), durationHours: (e - s) / 3600000 }
  })
  const wake = new Map()
  for (const n of nightSessions(sessions, TZ)) wake.set(brisDay(n.sleepEnd.getTime()), n.sleepEnd.getTime())

  const hr = new Map()
  for (const f of fs.readdirSync(DIR).filter(f => /^hr_\d+\.json$/.test(f))) {
    for (const r of read(f)) {
      const k = String(r.d).slice(0, 10)
      const arr = (r.s || '').split(',').filter(Boolean)
        .map(p => { const [t, b] = p.split(':'); return { tsMs: Number(t), bpm: Number(b) } })
      hr.set(k, (hr.get(k) || []).concat(arr))
    }
  }
  for (const v of hr.values()) v.sort((a, b) => a.tsMs - b.tsMs)
  return { days: read('days.json'), wake, hr, walkBodyBattery }
}

function buildDay(ctx, row) {
  const d = String(row.d).slice(0, 10)
  const samples = ctx.hr.get(d) || []
  if (!samples.length) return null
  const restingHr = Number(row.resting_hr)
  const reserve = Number(row.hr_max) - restingHr
  const wakeTime = ctx.wake.get(d) ?? samples[0].tsMs
  return {
    d, samples, restingHr, reserve, wakeTime, anchor: Number(row.anchor),
    stored: { charged: Number(row.total_charged), drained: Number(row.total_drained), n: Number(row.hr_sample_count) },
    params: { ...SHIPPED, anchor: Number(row.anchor), wakeTime, restingHr, reserve, stressAt: () => null },
  }
}

function validate(ctx) {
  console.log('Replaying each day with the SAME sample count the route persisted.\n')
  console.log('date          n   HR-drain  stored  residual  implied|stress|')
  let bad = 0, tested = 0
  for (const row of ctx.days.slice(-14)) {
    const day = buildDay(ctx, row)
    if (!day || !day.stored.n) continue
    const s = day.samples.slice(0, day.stored.n)
    const r = ctx.walkBodyBattery(s, day.params)
    let prev = day.wakeTime, mins = 0
    for (const x of s) {
      const dt = (x.tsMs - prev) / 60000; prev = x.tsMs
      if (dt <= 0 || dt > SHIPPED.gapHoldMin) continue
      mins += Math.min(dt, SHIPPED.sampleCapMin)
    }
    const resid = day.stored.drained - r.drained
    const implied = mins > 0 ? resid / (SHIPPED.stressDrainRate * mins) : NaN
    tested++
    // The residual is the unreplayed stress term. Outside [0,1] it is NOT stress, it is a harness bug.
    if (!(implied >= -0.05 && implied <= 1.05)) bad++
    console.log(`${day.d} ${String(day.stored.n).padStart(5)} ${r.drained.toFixed(1).padStart(10)}` +
      `${String(day.stored.drained).padStart(8)}${resid.toFixed(1).padStart(10)}${implied.toFixed(2).padStart(16)}` +
      (implied >= -0.05 && implied <= 1.05 ? '' : '   <-- OUT OF RANGE: harness bug, not stress'))
  }
  console.log(`\n${tested - bad}/${tested} days imply a stress level inside [0,1].`)
  console.log(bad ? 'FAIL — fix the harness before sweeping.' : 'PASS — the HR half replays faithfully.')
  return bad === 0
}

if (require.main === module) {
  const arg = process.argv[2]
  if (arg === '--pull') pull(Number(process.argv[3]) || 70)
  else if (arg === '--validate') process.exit(validate(load()) ? 0 : 1)
  else console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0])
}

module.exports = { load, buildDay, validate, SHIPPED }
