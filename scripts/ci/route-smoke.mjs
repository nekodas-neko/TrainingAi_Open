#!/usr/bin/env node
/**
 * Route smoke (#3919): sign in as the seeded local user, GET the main pages and read routes, and
 * fail on any status other than the expected one, or on a server-side error the status hides.
 *
 * Why it exists: #3883 made `GET /api/readiness-score` answer 500 on the dev server and merged with
 * every check green. The unit tests mock around the module graph, and the E2E shards skip a PR that
 * changes only server files (`scripts/e2e-ui-touched.js`), so nothing in CI started the server and
 * asked it. `/api/body-battery` answered 200 the whole time while its readiness read threw, which is
 * why the server log is scanned too.
 *
 * It runs against a server that is already up. CI's "Route smoke" job starts `pnpm dev` the way the
 * E2E job does and passes the server's log here.
 *
 *   BASE_URL     the server (default http://localhost:3000)
 *   SERVER_LOG   optional path to the server's stdout+stderr. Only what the server writes after this
 *                script starts is scanned.
 *
 *   node scripts/ci/route-smoke.mjs
 *
 * Exit 0 when every route answered as expected and the log is clean, 1 otherwise.
 */
import { open, stat } from 'node:fs/promises'
// The app's own "today" helper and the E2E harness's seeded credentials, loaded as TypeScript by
// Node's built-in type stripping (Node 22.18+), so neither has a second copy here.
import { DEFAULT_TZ, todayInTz } from '../../packages/shared/src/date-utils.ts'
import { SEED_EMAIL, SEED_PASSWORD } from '../../e2e/seed-user.ts'

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const SERVER_LOG = process.env.SERVER_LOG || null
// The dev server compiles each route on its first request, and a cold compile of a heavy page has
// taken over a minute on a CI runner. A request that takes longer than this is a hang, not a cost.
const REQUEST_TIMEOUT_MS = 180_000

/**
 * Server-log lines that mean a request threw somewhere, whatever status it answered with.
 * `is not a function` is the #3911 signature (`getRepository is not a function`).
 */
const LOG_ERROR_PATTERNS = [
  /is not a function/,
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /unhandledRejection|Unhandled ?Rejection|UnhandledPromiseRejection/i,
]

/**
 * Every route the seeded user should be able to read. `expect` is the status it must answer: all
 * 200 today, kept per route so a route that legitimately answers something else can say so here
 * rather than being dropped from the list.
 *
 * Params were read from each handler (20 Nov 2026):
 * - `/api/day-log` requires `date` (400 without it); it gets today in the user's zone.
 * - `/api/zone-minutes` reads `from`/`to`, not `days`, and defaults to the last 30 days.
 * - `/api/readiness-verdict` and `/api/day-timeline` default `date` to today.
 */
function routes(today) {
  return [
    // Pages. `redirect: 'manual'`, so a bounce to /sign-in shows up as a 307 and fails.
    { path: '/', expect: 200 },
    { path: '/workout', expect: 200 },
    { path: '/health', expect: 200 },
    { path: '/health/day', expect: 200 },
    { path: '/more', expect: 200 },
    { path: '/nutrition', expect: 200 },
    // Read routes.
    { path: '/api/status', expect: 200 },
    { path: '/api/version', expect: 200 },
    { path: '/api/workout-data', expect: 200 },
    { path: '/api/next-session', expect: 200 },
    { path: '/api/readiness-score', expect: 200 },
    { path: '/api/readiness-verdict', expect: 200 },
    { path: '/api/body-battery', expect: 200 },
    { path: '/api/oura/connection', expect: 200 },
    { path: '/api/zone-minutes', expect: 200 },
    { path: '/api/day-timeline', expect: 200 },
    { path: `/api/day-log?date=${today}`, expect: 200 },
    { path: '/api/user/profile', expect: 200 },
    { path: '/api/ai-periodization/program-overview', expect: 200 },
    { path: '/api/friends/feed', expect: 200 },
    { path: '/api/weights-summary', expect: 200 },
    { path: '/api/program-week', expect: 200 },
  ]
}

/** A minimal cookie jar: name → value, from every response's Set-Cookie. */
const jar = new Map()
function keepCookies(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

async function request(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...init,
    headers: { cookie: cookieHeader(), ...(init.headers ?? {}) },
  })
  keepCookies(res)
  return res
}

/**
 * Sign in through NextAuth's credentials callback, the endpoint the sign-in form posts to. The E2E
 * setup drives the form itself (`e2e/auth.setup.ts`); this needs a session cookie, not a browser.
 */
async function signIn() {
  const csrfRes = await request('/api/auth/csrf')
  if (csrfRes.status !== 200) throw new Error(`GET /api/auth/csrf answered ${csrfRes.status}`)
  const { csrfToken } = await csrfRes.json()
  const body = new URLSearchParams({ csrfToken, email: SEED_EMAIL, password: SEED_PASSWORD, callbackUrl: `${BASE_URL}/` })
  const res = await request('/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  await res.arrayBuffer()
  const location = res.headers.get('location') ?? ''
  if (res.status >= 400 || /error=/.test(location)) {
    throw new Error(`sign-in failed: ${res.status} ${location}`)
  }
  const session = await (await request('/api/auth/session')).json().catch(() => null)
  if (!session?.user?.id) throw new Error('sign-in set no session: is the seeded user in the database?')
}

async function logSize() {
  if (!SERVER_LOG) return 0
  return (await stat(SERVER_LOG).catch(() => ({ size: 0 }))).size
}

async function readLogFrom(offset) {
  const fh = await open(SERVER_LOG, 'r')
  try {
    const { size } = await fh.stat()
    const buf = Buffer.alloc(Math.max(0, size - offset))
    await fh.read(buf, 0, buf.length, offset)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

async function main() {
  const logStart = await logSize()
  const failures = []

  await signIn()
  console.log(`signed in as the seeded user at ${BASE_URL}`)

  // "Today" in the user's own zone, as the app computes it.
  const profileRes = await request('/api/user/profile')
  const tz = profileRes.ok ? ((await profileRes.json()).user?.timezone || DEFAULT_TZ) : DEFAULT_TZ
  const today = todayInTz(tz)

  for (const route of routes(today)) {
    const started = Date.now()
    let status
    try {
      const res = await request(route.path)
      await res.arrayBuffer()
      status = res.status
    } catch (err) {
      status = `no answer (${err?.name ?? 'error'})`
    }
    const ok = status === route.expect
    const ms = Date.now() - started
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(status).padEnd(3)} ${route.path}  (${ms} ms${ok ? '' : `, expected ${route.expect}`})`)
    if (!ok) failures.push(`${route.path} answered ${status}, expected ${route.expect}`)
  }

  if (SERVER_LOG) {
    // Give the server a moment to flush what the last requests logged.
    await new Promise((r) => setTimeout(r, 2000))
    const lines = (await readLogFrom(logStart)).split('\n')
    const hits = lines.filter((line) => LOG_ERROR_PATTERNS.some((re) => re.test(line)))
    if (hits.length > 0) {
      console.log(`\nFAIL server log: ${hits.length} line(s) show a server-side error:`)
      for (const line of hits.slice(0, 30)) console.log(`  ${line}`)
      failures.push(`server log has ${hits.length} error line(s)`)
    } else {
      console.log(`\nok   server log: none of ${LOG_ERROR_PATTERNS.length} error patterns in ${lines.length} new line(s)`)
    }
  } else {
    console.log('\n(no SERVER_LOG given, so the server log was not scanned)')
  }

  if (failures.length > 0) {
    console.log(`\nRoute smoke FAILED (${failures.length}):`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
  console.log(`\nRoute smoke passed: ${routes(today).length} routes`)
}

main().catch((err) => {
  console.error(`Route smoke could not run: ${err?.stack ?? err}`)
  process.exit(1)
})
