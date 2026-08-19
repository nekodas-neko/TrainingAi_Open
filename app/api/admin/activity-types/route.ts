import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One activity type.
const MAX_BODY_BYTES = 8 * 1024

const ActivityTypeBody = z.object({
  label:           z.string().min(1).max(40),
  icon:            z.string().min(1).max(60),
  isDistanceBased: z.boolean(),
  sortOrder:       z.number().int(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const repo = await getRepository()
  const activityTypes = await repo.listActivityTypes()
  return NextResponse.json({ activityTypes })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = ActivityTypeBody.safeParse(read.body)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  const activityType = await repo.createActivityType(body.data)
  return NextResponse.json({ activityType }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { id, ...rest } = (read.body ?? {}) as Record<string, unknown>
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Typed explicitly now the body is `unknown` rather than `any` — `id` went into the repository
  // on a destructure alone.
  if (typeof id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })
  const body = ActivityTypeBody.partial().safeParse(rest)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  const activityType = await repo.updateActivityType(id, body.data)
  return NextResponse.json({ activityType })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (id === 'other') return NextResponse.json({ error: "Cannot delete the 'other' activity type" }, { status: 400 })

  const repo = await getRepository()
  try {
    await repo.deleteActivityType(id)
  } catch {
    return NextResponse.json({ error: 'Activity type is in use' }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
