import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { invalidUuidResponse } from '@/lib/api/route-errors'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const { quantityMultiplier } = await req.json()
  if (typeof quantityMultiplier !== 'number' || quantityMultiplier < 0.01 || quantityMultiplier > 100) {
    return NextResponse.json({ error: 'quantityMultiplier must be between 0.01 and 100' }, { status: 400 })
  }
  const repo = await getRepository()
  const log = await repo.updateFoodLog(id, userId, quantityMultiplier)
  return NextResponse.json(log)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const repo = await getRepository()
  await repo.deleteFoodLog(id, userId)
  return NextResponse.json({ success: true })
}
