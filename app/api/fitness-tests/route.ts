import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, toAestDay, todayInTz, todayMidnightUtc } from '@trainingai/shared/date-utils'
import { z } from 'zod'
import { FitnessTestCreateBody } from '@trainingai/shared/validation/fitness-test'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One fitness-test result.
const MAX_BODY_BYTES = 8 * 1024

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const { searchParams } = new URL(req.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '365', 10) || 365, 730)

  const today = todayInTz(tz)
  const from = toAestDay(new Date(todayMidnightUtc(tz).getTime() - (days - 1) * 86_400_000), tz)

  const repo = await getRepository()
  const fitnessTests = await repo.listFitnessTests(session.user.id, from, today)
  return NextResponse.json({ fitnessTests }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = FitnessTestCreateBody.safeParse(read.body)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  const fitnessTest = await repo.saveFitnessTest(session.user.id, {
    ...body.data,
    id: body.data.id ?? crypto.randomUUID(),
  })
  return NextResponse.json({ fitnessTest }, { status: 201 })
}

const DeleteBody = z.object({ id: z.string().uuid() }).strict()

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = DeleteBody.safeParse(read.body)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  await repo.deleteFitnessTest(session.user.id, body.data.id)
  return NextResponse.json({ success: true })
}
