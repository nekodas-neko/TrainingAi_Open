import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { reportServerError } from '@/lib/observability'

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    phaseSetId: string
    programName: string
    overrides: Record<number, number>  // position → durationCycles
    includeBaseline?: boolean
  }

  if (!body.phaseSetId) {
    return NextResponse.json({ error: 'phaseSetId is required' }, { status: 400 })
  }
  if (!body.programName?.trim()) {
    return NextResponse.json({ error: 'programName is required' }, { status: 400 })
  }

  const repo = await getRepository()
  const phaseSets = await repo.listPhaseSets(userId)
  const source = phaseSets.find(ps => ps.id === body.phaseSetId)

  if (!source) {
    return NextResponse.json({ error: 'Phase set not found' }, { status: 404 })
  }

  let clonedPhases = source.phases.map(p => ({
    position:       body.includeBaseline ? p.position + 1 : p.position,
    name:           p.name,
    durationCycles: (body.overrides ?? {})[p.position] ?? p.durationCycles,
    phaseType:      p.phaseType,
    primaryStyleId: p.primaryStyleId,
  }))

  if (body.includeBaseline) {
    clonedPhases = [
      { position: 0, name: 'Baseline', durationCycles: 1, phaseType: 'baseline', primaryStyleId: undefined },
      ...clonedPhases,
    ]
  }

  const templateBaseName = source.templateBaseName ?? source.name
  try {
    const cloned = await repo.createOwnedPhaseSetClone(userId, templateBaseName, body.programName.trim(), clonedPhases)
    return NextResponse.json({ id: cloned.id, name: cloned.name })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/phase-sets/clone' })
    console.error('[phase-sets/clone] createOwnedPhaseSetClone failed:', err)
    return NextResponse.json({ error: 'Failed to create phase set' }, { status: 500 })
  }
}
