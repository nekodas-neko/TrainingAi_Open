#!/usr/bin/env node
/**
 * Body Battery offline replay: the fit and count harness for #2341 and #3925.
 *
 * It replays the app's OWN finished-day recompute, `finishedBodyBatteryDay` in
 * `lib/health/body-battery-replay.ts` (the function `rederiveBodyBattery` writes through), so it is
 * always on the shipped model: v8's exercise drain, v9's version-keyed baselines, and the readiness
 * anchor on the 75-centred scale (18 Nov). It used to bundle the v7 walk alone and mirror the
 * route's constants by hand, and fell two versions behind (#3925). Nothing here copies a formula.
 *
 *   node scripts/tuning/body-battery-replay.cjs --capture FROM TO [USER_ID]   # local database only
 *   node scripts/tuning/body-battery-replay.cjs --replay [capture.json]       # replay and compare
 *   node scripts/tuning/body-battery-replay.cjs --count [capture.json]        # #3925 item 1's count
 *   node scripts/tuning/body-battery-replay.cjs --count-report report.json    # the same, from production
 *   node scripts/tuning/body-battery-replay.cjs --pull [DAYS]                 # stored rows (claude_ro)
 *   node scripts/tuning/body-battery-replay.cjs --check [PREFIX]              # LA-134's pass test
 *
 * **Capture** runs the real recompute against a repository and records every read it answers
 * (heart rate, sleep, body metrics, workouts, goals, the stored row and the rest), refusing every
 * other method, so it cannot write. It opens `LOCAL_DATABASE_URL` (else `DATABASE_URL`) and refuses
 * any database that is not on this machine: production has no read-only repository connection, so
 * production is counted through the server instead (below). **Replay** runs the same recompute on
 * the recording and throws on any read it did not record. **Count** prints how many finished days
 * would change end value if each were finalised from the full day, and by how much in bands.
 *
 * **Production, read-only (the Orchestrator):** the agent-key job `rederive-body-battery` with
 * `dryRun: true` runs `finishedBodyBatteryDay` on production data and writes nothing (no approval
 * needed; `docs/admin-actions.md` section 12). Save its JSON response, 31 days per call, and run
 * `--count-report` on each file. It prints counts and bands only, never a health value, so the
 * output can go on a public issue. The raw report holds end values: keep it off the repository.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const DIR = process.env.BB_REPLAY_DIR || '/tmp/bb-replay'
const API = 'https://trainingai-production.up.railway.app/api/admin/db-query'
const TZ = 'Australia/Brisbane'
const CAPTURE = path.join(DIR, 'capture.json')

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

/**
 * Bundle `lib/health/body-battery-replay.ts` (and, for a capture, the repository) from the source
 * the app runs. `@/` and `@trainingai/` are bundled; every npm package stays external and loads
 * from the repository's own node_modules, which is why the bundle is written under it.
 */
async function bundleReplay(withRepository = false) {
  const esbuild = require('esbuild')
  const outDir = path.join(ROOT, 'node_modules/.cache/bb-replay')
  fs.mkdirSync(outDir, { recursive: true })
  const outfile = path.join(outDir, withRepository ? 'replay-with-repo.cjs' : 'replay.cjs')
  const contents = "export * from '@/lib/health/body-battery-replay'\n" +
    (withRepository ? "export { getRepository } from '@/lib/data'\n" : '')
  await esbuild.build({
    stdin: { contents, resolveDir: ROOT, sourcefile: 'body-battery-replay-entry.ts', loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'error',
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    plugins: [{
      name: 'npm-external',
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, args =>
          args.path.startsWith('@/') || args.path.startsWith('@trainingai/') ? undefined : { path: args.path, external: true })
      },
    }],
  })
  delete require.cache[outfile]
  return require(outfile)
}

/**
 * True only for a Postgres URL on this machine: a socket (`host=/tmp`, or no host at all),
 * localhost or 127.0.0.1. `new URL` rejects the empty-host socket form, so the host is read by hand.
 */
function isLocalDatabase(url) {
  const m = /^postgres(?:ql)?:\/\/(?:[^@/?#]*@)?([^/?#]*)[^?#]*(?:\?([^#]*))?/.exec(String(url))
  if (!m) return false
  const hostPort = m[1]
  const host = hostPort.startsWith('[') ? hostPort.slice(1, hostPort.indexOf(']')) : hostPort.split(':')[0]
  const query = new URLSearchParams(m[2] || '')
  const socket = query.get('host')
  if (host === '') return socket == null || socket.startsWith('/')
  return ['localhost', '127.0.0.1', '::1'].includes(host) && (socket == null || socket.startsWith('/'))
}

async function capture(from, to, userId, out = CAPTURE) {
  const url = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL
  if (!url || !isLocalDatabase(url)) {
    throw new Error('--capture opens only a database on this machine (LOCAL_DATABASE_URL). Count production with --count-report.')
  }
  process.env.DATABASE_URL = url
  // The day never calls a model, but the repository module may set one up; keep it off.
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = ''
  process.env.AI_DEV_DAILY_CALL_LIMIT = '0'
  const m = await bundleReplay(true)
  const repo = await m.getRepository()
  const uid = userId || process.env.WEBHOOK_USER_ID
  if (!uid) throw new Error('pass USER_ID (or set WEBHOOK_USER_ID)')
  const { recording, dates } = await m.captureFinishedDays(repo, uid, TZ, from, to)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ dates, recording: JSON.parse(m.serialiseRecording(recording)) }))
  console.log(`captured ${dates.length} days (${recording.calls.length} reads) into ${out}`)
}

async function replayFile(file = CAPTURE) {
  const m = await bundleReplay(false)
  const { dates, recording } = JSON.parse(fs.readFileSync(file, 'utf8'))
  const days = await m.replayFinishedDays(m.parseRecording(JSON.stringify(recording)), dates)
  return { m, days }
}

function printCount(count, heading) {
  console.log(heading)
  console.log(`  days examined        ${count.daysExamined}`)
  console.log(`  end value unchanged  ${count.unchanged}`)
  console.log(`  end value changes    ${count.changed}  (${count.up} up, ${count.down} down)`)
  for (const [band, n] of Object.entries(count.bands)) console.log(`    by ${band.padEnd(6)} points  ${n}`)
  console.log(`  no stored row, a recompute would add one  ${count.wouldAdd}`)
  for (const k of ['noRow', 'beforeSignOff', 'keptByWriteGuard']) if (k in count) console.log(`  ${k.padEnd(20)} ${count[k]}`)
  console.log(`  not recomputed       ${count.notRecomputed}`)
}

async function replayCommand(file) {
  const { days } = await replayFile(file)
  let same = 0, compared = 0
  for (const d of days) {
    if (!d.stored || !d.recomputed) continue
    compared++
    if (d.stored.endValue === d.recomputed.endValue && d.stored.totalCharged === d.recomputed.totalCharged
      && d.stored.totalDrained === d.recomputed.totalDrained) same++
  }
  console.log(`replayed ${days.length} days: ${days.filter(d => d.recomputed).length} recomputed, ${days.filter(d => d.error).length} failed`)
  console.log(`${same}/${compared} stored rows match the full-day recompute exactly (a morning snapshot does not).`)
}

async function countCommand(file) {
  const { m, days } = await replayFile(file)
  printCount(m.endValueChangeBands(days.map(d => ({ stored: d.stored?.endValue, recomputed: d.recomputed?.endValue }))),
    'Finished days whose stored end value would change if finalised from the full day:')
}

async function countReportCommand(files) {
  const m = await bundleReplay(false)
  const days = files.flatMap(f => {
    const body = JSON.parse(fs.readFileSync(f, 'utf8'))
    // The agent key wraps the job's result; the admin route returns the report itself.
    const report = body.report ?? body.result?.report ?? body
    if (!Array.isArray(report.days)) throw new Error(`${f}: no \`days\` in this report`)
    if (report.dryRun === false) console.log(`warning: ${f} is a real run, not a dry run`)
    return report.days
  })
  printCount(m.endValueChangeBandsFromReport({ days }), 'Re-derive dry run: finished days whose stored end value would change:')
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

function check(prefix = 'v9') {
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

async function main() {
  const [arg, ...rest] = process.argv.slice(2)
  if (arg === '--pull') pull(Number(rest[0]) || 70)
  else if (arg === '--check') check(rest[0] || 'v9')
  else if (arg === '--capture') await capture(rest[0], rest[1], rest[2])
  else if (arg === '--replay') await replayCommand(rest[0])
  else if (arg === '--count') await countCommand(rest[0])
  else if (arg === '--count-report') await countReportCommand(rest)
  else console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0])
}

if (require.main === module) {
  main().then(() => process.exit(0), err => { console.error(err.message || err); process.exit(1) })
}

module.exports = { summarise, bundleReplay, isLocalDatabase }
