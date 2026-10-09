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
 *   node scripts/tuning/body-battery-replay.cjs --check    # LA-134's pass test on the stored rows
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

// Shipped constants — mirrored from lib/health/body-battery-day.ts. If they change there, change
// them here in the same PR; this file deliberately does not import that module.
// v7 (issue 2235): the charge ceiling is a bpm offset over resting HR, so the reserve fraction the
// walk takes is per day — `buildDay` derives it with the bundled `restThresholdFromOffset`.
const SHIPPED = {
  restOffsetBpm: 9, chargeRate: 0.120, drainRate: 0.080,
  stressDrainRate: 0.020, gapHoldMin: 30, sampleCapMin: 7,
}
// v6 (2026-09-24 → issue 2235): the same rates with the old reserve-fraction ceiling. `--validate`
// against stored v6 rows needs this in place of SHIPPED.
const V6 = {
  restThreshold: 0.05, chargeRate: 0.120, drainRate: 0.080,
  stressDrainRate: 0.020, gapHoldMin: 30, sampleCapMin: 7,
}

// ⚠ `--validate` can only reproduce rows that were computed under the constants AND the walk it is
// replaying. TN-55 changed both on 2026-09-24, and nothing recomputes history — the route rewrites
// today's row and no other path writes the table — so every row stamped `v5:` stays v5 forever.
// Validating against one of those needs V5 below *and* a checkout from before that commit, because
// `bundleShared()` bundles the live walk and the charge ramp is no longer the ramp those rows were
// built with. Once the issue 2235 re-derive has run, every stored row is v7 and `--validate` works
// against the default; before it, validate v6 rows with V6.
const V5 = {
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
          end_value, hr_sample_count, model_version
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
    // Windows has no bare `npx`: it is npx.cmd, which Node only spawns through a shell.
    const win = process.platform === 'win32'
    execFileSync(win ? 'npx.cmd' : 'npx', ['esbuild', path.join(root, 'packages/shared/src', src),
      '--bundle', '--format=cjs', '--platform=node', `--outfile=${file}`],
      { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], shell: win })
    Object.assign(out, require(file))
  }
  return out
}

function load() {
  const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).rows
  // `packages/shared` ships as TypeScript with no build output, so bundle the two shipped modules
  // on the fly. Bundling rather than reimplementing is the whole point: a hand-copied walk would
  // drift from production silently, and the arithmetic being compared is the arithmetic that runs.
  const { walkBodyBattery, restThresholdFromOffset, nightSessions } = bundleShared()
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
  return { days: read('days.json'), wake, hr, walkBodyBattery, restThresholdFromOffset }
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
    params: {
      ...SHIPPED, restThreshold: ctx.restThresholdFromOffset(SHIPPED.restOffsetBpm, reserve),
      anchor: Number(row.anchor), wakeTime, restingHr, reserve, stressAt: () => null,
    },
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

/**
 * LA-134's pass test, run on the STORED rows: no replay, so it needs no bundling and no HR pull.
 *   median daily net within +-5 of zero · days-at-zero under 10% · the spread preserved, not flattened.
 * A day is INFORMATIVE when it has at least MIN_SAMPLES heart-rate samples. Days with a handful of
 * samples hold the battery where it was and say nothing about the constants, and a verdict on
 * them is the calibration-on-a-filling-window error BF-55 spent three weeks on. So the verdict
 * is reported beside how many informative days it rests on, and a window under MIN_INFORMATIVE_DAYS
 * is labelled INSUFFICIENT rather than PASS.
 */
const MIN_SAMPLES = 1000
const MIN_INFORMATIVE_DAYS = 20

function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function summarise(rows, prefix) {
  const mine = rows.filter(r => String(r.model_version || '').startsWith(prefix + ':'))
  const ends = mine.map(r => Number(r.end_value))
  const nets = mine.map(r => Number(r.total_charged) - Number(r.total_drained))
  const informative = mine.filter(r => Number(r.hr_sample_count) >= MIN_SAMPLES)
  const atZero = ends.filter(e => e === 0).length
  const medNet = median(nets)
  const mean = ends.length ? ends.reduce((a, b) => a + b, 0) / ends.length : null
  const sd = ends.length ? Math.sqrt(ends.reduce((a, b) => a + (b - mean) ** 2, 0) / ends.length) : null
  return {
    prefix, days: mine.length, informativeDays: informative.length,
    medianNet: medNet, daysAtZero: atZero, zeroShare: mine.length ? atZero / mine.length : null,
    endMin: ends.length ? Math.min(...ends) : null, endMax: ends.length ? Math.max(...ends) : null, endSd: sd,
    passes: {
      medianNet: medNet != null && Math.abs(medNet) <= 5,
      zeroShare: mine.length > 0 && atZero / mine.length < 0.10,
    },
    sufficient: informative.length >= MIN_INFORMATIVE_DAYS,
  }
}

function check(prefix = 'v7') {
  const rows = JSON.parse(fs.readFileSync(path.join(DIR, 'days.json'), 'utf8')).rows
  const s = summarise(rows, prefix)
  console.log(`Stored ${prefix} rows: ${s.days} days, ${s.informativeDays} informative (>= ${MIN_SAMPLES} HR samples).`)
  console.log(`  median daily net  ${s.medianNet}  (pass: within +-5)            ${s.passes.medianNet ? 'PASS' : 'FAIL'}`)
  console.log(`  days ending at 0  ${s.daysAtZero}/${s.days}  (pass: under 10%)       ${s.passes.zeroShare ? 'PASS' : 'FAIL'}`)
  console.log(`  end value range   ${s.endMin}-${s.endMax}, sd ${s.endSd == null ? 'n/a' : s.endSd.toFixed(1)}  (spread: judge by eye)`)
  console.log(s.sufficient
    ? '\nENOUGH informative days to fit.'
    : `\nINSUFFICIENT: ${s.informativeDays} of the ${MIN_INFORMATIVE_DAYS} informative days a fit needs. Do not fit; re-pull and re-check.`)
  return s
}

if (require.main === module) {
  const arg = process.argv[2]
  if (arg === '--pull') pull(Number(process.argv[3]) || 70)
  else if (arg === '--validate') process.exit(validate(load()) ? 0 : 1)
  else if (arg === '--check') check(process.argv[3] || 'v7')
  else console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0])
}

module.exports = { load, buildDay, validate, summarise, SHIPPED, V6, V5 }
