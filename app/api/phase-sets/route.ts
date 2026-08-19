import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { EditablePhase } from '@/components/config/phase-editor'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A phase set: a name and its phases.
const MAX_BODY_BYTES = 256 * 1024

async function getUserId() {
  const session = await auth()
  return session?.user?.id
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const phaseSets = await repo.listPhaseSets(userId)
  return NextResponse.json({ phaseSets }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const body = (read.body ?? {}) as { name: string; phases: EditablePhase[] }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const repo = await getRepository()
  const phaseSet = await repo.createPhaseSet(
    userId,
    body.name.trim(),
    (body.phases ?? []).map((p, i) => ({
      position: i,
      name: p.name,
      durationCycles: p.durationCycles,
      phaseType: p.phaseType,
      primaryStyleId: p.primaryStyleId,
      secondaryStyleId: p.secondaryStyleId,
    })),
  )
  return NextResponse.json({ phaseSet })
}
