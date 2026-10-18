// #2986 — reads the rows `tune-against-oura-report.ts` needs and prints its report. READ-ONLY, stdout only.
// Bundled and run by `tune-against-oura.mjs`; see that file for usage.
//
// The same SQL runs in both places; only the schema and the user filter differ. Locally it reads
// `public` for one user. Against production it reads the `claude_ro` views through
// `/api/admin/db-query`, and every view is row-scoped to the owner, so no user filter is needed.
// Nothing is written anywhere: not the database, not a file. The owner's numbers stay on stdout.
import { execFileSync } from 'child_process'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { buildTuneReport, formatTuneReport, type TuneInput } from './tune-against-oura-report'

const DB_QUERY_API = 'https://trainingai-production.up.railway.app/api/admin/db-query'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/

type Row = Record<string, unknown>
type Runner = (sql: string) => Promise<Row[]>

interface Args { local: boolean; prod: boolean; user?: string; from?: string; to?: string; modelVersion?: number; perDay: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { local: false, prod: false, perDay: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--local') args.local = true
    else if (a === '--prod') args.prod = true
    else if (a === '--per-day') args.perDay = true
    else if (a === '--user') args.user = argv[++i]
    else if (a === '--from') args.from = argv[++i]
    else if (a === '--to') args.to = argv[++i]
    else if (a === '--model-version') args.modelVersion = Number(argv[++i])
    else throw new Error(`unknown argument ${a}`)
  }
  if (args.local === args.prod) throw new Error('pass exactly one of --local or --prod')
  if (args.local && !UUID.test(args.user ?? '')) throw new Error('--local needs --user <uuid>')
  for (const d of [args.from, args.to]) if (d != null && !DATE.test(d)) throw new Error(`dates are YYYY-MM-DD, got ${d}`)
  if (args.modelVersion != null && !Number.isInteger(args.modelVersion)) throw new Error('--model-version is an integer')
  return args
}

async function localRunner(): Promise<{ run: Runner; close: () => Promise<void> }> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('pg') as typeof import('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  // Read-only for the whole session, so a mistake in a query can never write.
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  return { run: async sql => (await client.query(sql)).rows, close: () => client.end() }
}

function prodRunner(): Runner {
  const secret = process.env.CLAUDE_DB_QUERY_SECRET
  if (!secret) throw new Error('CLAUDE_DB_QUERY_SECRET is not set')
  return async sql => {
    const res = execFileSync('curl', [
      '-sS', '-X', 'POST', DB_QUERY_API,
      '-H', `Authorization: Bearer ${secret}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ sql }),
    ], { maxBuffer: 1 << 28, encoding: 'utf8' })
    const parsed = JSON.parse(res) as { rows?: Row[]; error?: string; truncated?: boolean }
    if (parsed.error) throw new Error(`db-query: ${parsed.error}`)
    if (parsed.truncated) throw new Error('db-query truncated a read; narrow --from/--to')
    return parsed.rows ?? []
  }
}

const date = (v: unknown) => String(v)
const numOrNull = (v: unknown) => (v == null ? null : Number(v))
const at = (v: unknown) => (v == null ? null : new Date(String(v)))
const json = <T>(v: unknown): T | null => (v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v) as T)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const schema = args.local ? 'public' : 'claude_ro'
  const who = args.local ? `user_id = '${args.user}'` : 'TRUE'
  const { run, close } = args.local ? await localRunner() : { run: prodRunner(), close: async () => {} }
  try {
    const [user] = await run(`SELECT timezone FROM ${schema}.users WHERE ${args.local ? `id = '${args.user}'` : 'TRUE'} LIMIT 1`)
    const tz = String(user?.timezone ?? 'Australia/Brisbane')
    // Today's Oura scores are still moving, so the default range ends yesterday.
    const to = args.to ?? shiftDateStr(todayInTz(tz), -1)
    const from = args.from ?? shiftDateStr(to, -59)
    const inRange = (col: string, lo: string, hi: string) => `${who} AND ${col} BETWEEN '${lo}' AND '${hi}'`

    // One after another: a single `pg` client runs one query at a time.
    const reads: Row[][] = []
    for (const sql of [
      `SELECT date::text AS date, readiness_score::float AS readiness_score, sleep_score::float AS sleep_score,
                  activity_score::float AS activity_score, source_map
           FROM ${schema}.oura_daily WHERE ${inRange('date', from, to)}`,
      `SELECT date::text AS date, readiness_contributors, sleep_contributors, activity_contributors
           FROM ${schema}.oura_cloud_daily WHERE ${inRange('date', from, to)}`,
      `SELECT day::text AS day, bedtime_start::text AS bedtime_start, bedtime_end::text AS bedtime_end, sleep_type
           FROM ${schema}.oura_cloud_sleep_periods WHERE ${inRange('day', from, to)}`,
      // A day either side, so a night is grouped the way the scorers group it.
      `SELECT date::text AS date, sleep_start::text AS sleep_start, sleep_end::text AS sleep_end, duration_hours::float AS duration_hours
           FROM ${schema}.sleep_sessions WHERE ${inRange('date', shiftDateStr(from, -1), shiftDateStr(to, 1))} AND deleted_at IS NULL`,
      `SELECT day::text AS day, sleep_score::float AS sleep_score, sleep_contributors, readiness_score::float AS readiness_score, readiness_contributors
           FROM ${schema}.oura_daily_derived WHERE ${inRange('day', from, to)}`,
      // To + 1: the Activity pillar on readiness date D reads day D − 1.
      `SELECT date::text AS date, model_version, shadow_readiness, sleep_pillar, heart_pillar, activity_pillar, body_pillar, units
           FROM ${schema}.shadow_readiness WHERE ${inRange('date', from, shiftDateStr(to, 1))}`,
    ]) reads.push(await run(sql))
    const [ouraDaily, ouraCloudDaily, periods, sleep, derived, shadow] = reads

    const input: TuneInput = {
      tz, from, to,
      shadowModelVersion: args.modelVersion,
      ouraDaily: ouraDaily.map(r => ({
        date: date(r.date), readinessScore: numOrNull(r.readiness_score), sleepScore: numOrNull(r.sleep_score),
        activityScore: numOrNull(r.activity_score), sourceMap: json(r.source_map),
      })),
      ouraCloudDaily: ouraCloudDaily.map(r => ({
        date: date(r.date), readinessContributors: json(r.readiness_contributors),
        sleepContributors: json(r.sleep_contributors), activityContributors: json(r.activity_contributors),
      })),
      ouraSleepPeriods: periods.map(r => ({
        day: date(r.day), bedtimeStart: at(r.bedtime_start), bedtimeEnd: at(r.bedtime_end), sleepType: r.sleep_type == null ? null : String(r.sleep_type),
      })),
      sleepSessions: sleep.map(r => ({
        date: date(r.date), sleepStart: at(r.sleep_start)!, sleepEnd: at(r.sleep_end)!, durationHours: numOrNull(r.duration_hours),
      })),
      derived: derived.map(r => ({
        day: date(r.day), sleepScore: numOrNull(r.sleep_score), sleepContributors: json(r.sleep_contributors),
        readinessScore: numOrNull(r.readiness_score), readinessContributors: json(r.readiness_contributors),
      })),
      shadow: shadow.map(r => ({
        date: date(r.date), modelVersion: Number(r.model_version), shadowReadiness: numOrNull(r.shadow_readiness),
        sleepPillar: numOrNull(r.sleep_pillar), heartPillar: numOrNull(r.heart_pillar),
        activityPillar: numOrNull(r.activity_pillar), bodyPillar: numOrNull(r.body_pillar), units: json(r.units),
      })),
    }
    process.stdout.write(formatTuneReport(buildTuneReport(input), { perDay: args.perDay }).join('\n') + '\n')
  } finally {
    await close()
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
