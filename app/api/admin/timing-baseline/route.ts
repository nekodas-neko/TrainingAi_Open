import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const repo = await getRepository()
  const date = await repo.getTimingBaselineDate(session.user.id)
  return NextResponse.json({ date })
}

// Both separators — see Q-130; localDateString() emits slashes.
const bodySchema = z.object({ date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).nullable() })

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepository()
  await repo.setTimingBaselineDate(session.user.id, parsed.data.date)
  return NextResponse.json({ date: parsed.data.date })
}
