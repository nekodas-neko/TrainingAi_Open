import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { EditablePhase } from '@/components/config/phase-editor'

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

  const body = await req.json() as { name: string; phases: EditablePhase[] }
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
