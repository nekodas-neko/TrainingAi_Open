import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { analyteKey } from '@trainingai/shared/health/analyte-keys'

/**
 * BF-1 — storing a blood panel, de-identified.
 *
 * **This is the manual path, and it is deliberately the first one built.** Extraction prefills and
 * the owner corrects, so this route is the confirm target either way; building it first is what
 * keeps the extraction call optional rather than load-bearing. A fully typed panel with no
 * extraction must work.
 *
 * **No patient identifiers are accepted.** The schema is `.strict()`, so a body carrying a name or
 * a date of birth is a 400 rather than a column nobody noticed. `labName` is instrument metadata.
 */

// 63 analytes with labels, units and ranges is a few kB; 128 kB is generous and still bounded.
const MAX_BODY_BYTES = 128 * 1024

const Analyte = z.object({
  /** The provider's own wording. The normalised key is derived here, never sent by the client. */
  label: z.string().min(1).max(120),
  unit: z.string().max(40).nullable().optional(),
  valueNum: z.number().finite().nullable().optional(),
  valueOperator: z.enum(['<', '>']).nullable().optional(),
  refLow: z.number().finite().nullable().optional(),
  refHigh: z.number().finite().nullable().optional(),
  /** Stored verbatim and displayed as the provider's words — never parsed into a verdict. */
  flagText: z.string().max(200).nullable().optional(),
}).strict()

const Body = z.object({
  // Both separators: the client fills date params from localDateString(), which emits slashes —
  // a dash-only regex rejects every real request before the handler runs (Q-130).
  collectedOn: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  /** A month-precision panel stores the 1st and says so, rather than claiming a day it lacks. */
  datePrecision: z.enum(['day', 'month']).default('day'),
  labName: z.string().max(120).nullable().optional(),
  source: z.enum(['manual', 'extracted']).default('manual'),
  analytes: z.array(Analyte).max(200),
}).strict()

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`blood-panel:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Body too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = Body.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const collectedOn = normalizeDateParamIso(parsed.data.collectedOn)
  if (!collectedOn) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  // Two labels that normalise to one key would collide on `(panel_id, analyte_key)` and the insert
  // would fail as a driver error. Rejecting here names the problem instead.
  const analytes = parsed.data.analytes.map(a => ({
    analyteKey: analyteKey(a.label),
    label: a.label,
    unit: a.unit ?? null,
    valueNum: a.valueNum ?? null,
    valueOperator: a.valueOperator ?? null,
    refLow: a.refLow ?? null,
    refHigh: a.refHigh ?? null,
    flagText: a.flagText ?? null,
  }))
  const keys = analytes.map(a => a.analyteKey)
  const dupe = keys.find((k, i) => keys.indexOf(k) !== i)
  if (dupe) return NextResponse.json({ error: `Two results normalise to the same analyte: ${dupe}` }, { status: 400 })

  const repo = await getRepository()
  const saved = await repo.saveBloodPanel(userId, {
    collectedOn,
    datePrecision: parsed.data.datePrecision,
    labName: parsed.data.labName ?? null,
    source: parsed.data.source,
    analytes,
  })
  return NextResponse.json(saved, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  return NextResponse.json({ panels: await repo.listBloodPanels(userId) }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function DELETE(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const repo = await getRepository()
  // `false` means the panel is not this user's, which answers the same as not existing — a 404
  // either way, so an id from another account cannot be probed for existence.
  const ok = await repo.deleteBloodPanel(userId, id)
  return ok
    ? NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
