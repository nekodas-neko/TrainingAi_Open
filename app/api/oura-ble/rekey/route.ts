import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

// Q-314 — declare that the ring was deliberately re-keyed.
//
// A re-key restarts the ring's own clock, and the server cannot tell that apart from a history
// re-drain by counter shape alone: both make a batch's max ds fall below the epoch's high-water
// mark. Inferring it from the shape re-timed the owner's entire sleep history twice (+12.17 h, then
// +14.16 h), because the spurious epoch became the current one and its offset was estimated from a
// burst where >90% of anchors carried re-drain backlog.
//
// So it is declared. A re-key is a deliberate act performed with `open_oura` on a laptop — the app
// can be told rather than left to guess. The NEXT ingest batch consumes the declaration and opens
// the epoch, because the new ds is not knowable until the ring reports.
//
//   GET    — is one pending?
//   POST   — declare (idempotent; optional {note})
//   DELETE — cancel one made by mistake, before any drain has acted on it
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const repo = await getRepositoryAsync()
  const pending = await repo.getPendingRekeyDeclaration(session.user.id)
  return NextResponse.json(
    { pending: pending ? { id: pending.id, declaredAt: pending.declaredAt.toISOString() } : null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!rateLimit(`oura-ble-rekey-declare:${session.user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let note: string | null = null
  try {
    const body = await req.json() as { note?: unknown }
    if (typeof body?.note === 'string') note = body.note.slice(0, 500)
  } catch {
    // No body is the normal case.
  }

  const repo = await getRepositoryAsync()
  const result = await repo.declareOuraRekey(session.user.id, note)
  return NextResponse.json(
    {
      id: result.id,
      declaredAt: result.declaredAt.toISOString(),
      alreadyPending: result.alreadyPending,
      // Said back explicitly because the effect is deferred: nothing changes until the ring next
      // reports, and without this the owner cannot tell "accepted" from "already done".
      note: result.alreadyPending
        ? 'A declaration was already waiting; this did not queue a second one.'
        : 'Declared. The next ingest batch from the ring will open a new clock epoch.',
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const repo = await getRepositoryAsync()
  const cancelled = await repo.cancelPendingRekeyDeclaration(session.user.id)
  return NextResponse.json(
    // A consumed declaration is deliberately NOT cancellable — the epoch it opened already exists
    // and every timestamp derived from it depends on that row being the audit trail.
    { cancelled, note: cancelled ? 'Pending declaration removed.' : 'Nothing was pending.' },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
