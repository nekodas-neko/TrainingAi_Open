import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRepository } from '@/lib/data'
import { authorizeAdminRequest } from '@/lib/admin/claude-token-auth'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { normalizeDateParam, shiftDateStr } from '@trainingai/shared/date-utils'
import { REPLAY_FUNCTIONS, summarise } from '@/lib/tuning/replay/registry'

/**
 * TN-56 — re-run a named scoring function over a date range with one of its constants bracketed,
 * and return the distribution per value. Admin-only, same authorisation as `/api/admin/db-query`.
 * **Writes nothing** — see `lib/tuning/replay/registry.ts`. Always includes a run at the defaults,
 * whose agreement with what production stored is the replay's own self-check.
 */

const MAX_BODY_BYTES = 16 * 1024
const MAX_DAYS = 60
const MAX_VALUES = 12

const Body = z.object({
  fn: z.string().min(1).max(64),
  from: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  to: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  param: z.string().min(1).max(64),
  values: z.array(z.number().finite()).min(1).max(MAX_VALUES),
})

export async function POST(req: NextRequest) {
  const authed = await authorizeAdminRequest(req, 'replay-token')
  if (!authed.ok) return NextResponse.json({ error: authed.error }, { status: authed.status })
  if (!rateLimit(`replay:${authed.userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = Body.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { fn: name, param, values } = parsed.data

  const fn = REPLAY_FUNCTIONS[name]
  if (!fn) {
    return NextResponse.json({ error: 'Unknown function', available: Object.keys(REPLAY_FUNCTIONS) }, { status: 400 })
  }
  const spec = fn.params.find(p => p.name === param)
  if (!spec) {
    return NextResponse.json({ error: 'Unknown parameter', available: fn.params.map(p => p.name) }, { status: 400 })
  }
  if (values.some(v => v < spec.min || v > spec.max)) {
    return NextResponse.json({ error: `Values must lie in [${spec.min}, ${spec.max}]` }, { status: 400 })
  }
  // normalizeDateParam validates and returns YYYY/MM/DD; the repository and shiftDateStr take dashes.
  const from = normalizeDateParam(parsed.data.from)?.replaceAll('/', '-') ?? null
  const to = normalizeDateParam(parsed.data.to)?.replaceAll('/', '-') ?? null
  if (!from || !to || from > to) return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  if (shiftDateStr(from, MAX_DAYS - 1) < to) {
    return NextResponse.json({ error: `At most ${MAX_DAYS} days` }, { status: 400 })
  }

  try {
    const repo = await getRepository()
    const inputs = await fn.load({ userId: authed.userId, from, to, repo })
    const defaults = Object.fromEntries(fn.params.map(p => [p.name, p.default]))
    const run = (value: number) => {
      const days = fn.evaluate(inputs as never, { ...defaults, [param]: value })
      return { value, summary: summarise(days), days }
    }
    return NextResponse.json({
      fn: fn.name,
      unit: fn.unit,
      param: spec,
      range: { from, to },
      baseline: run(spec.default),
      results: values.map(run),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    reportServerError(err, { userId: authed.userId, url: req.nextUrl.pathname })
    return NextResponse.json({ error: 'Replay failed' }, { status: 500 })
  }
}
