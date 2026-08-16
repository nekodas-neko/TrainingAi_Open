import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { EditablePhase } from '@/components/config/phase-editor'

async function getUserId() {
  const session = await auth()
  return session?.user?.id
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as { name: string; phases: EditablePhase[] }

  const repo = await getRepository()
  try {
    const ownedStyles = await repo.listProgressionStyles(userId)
    const ownedStyleIds = new Set(ownedStyles.map(s => s.id))
    const phases = (body.phases ?? []).map((p, i) => ({
      position: i,
      name: p.name,
      durationCycles: p.durationCycles,
      phaseType: p.phaseType,
      primaryStyleId: p.primaryStyleId,
      secondaryStyleId: p.secondaryStyleId,
    }))
    for (const p of phases) {
      if (p.primaryStyleId && !ownedStyleIds.has(p.primaryStyleId)) {
        return NextResponse.json({ error: 'Invalid primaryStyleId' }, { status: 400 })
      }
      if (p.secondaryStyleId && !ownedStyleIds.has(p.secondaryStyleId)) {
        return NextResponse.json({ error: 'Invalid secondaryStyleId' }, { status: 400 })
      }
    }
    const phaseSet = await repo.updatePhaseSet(
      id,
      userId,
      body.name?.trim() ?? '',
      phases,
    )
    return NextResponse.json({ phaseSet })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const repo = await getRepository()
  try {
    await repo.deletePhaseSet(id, userId)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    const status = msg.includes('default') ? 403 : msg.includes('In use') ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
