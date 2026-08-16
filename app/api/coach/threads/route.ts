import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { rateLimit } from '@/lib/rate-limit'
import { listThreads, listAppliedChanges, saveThread, loadThread } from '@/lib/coach/threads'
import { errorLog } from '@trainingai/shared/logger'

const SaveSchema = z.object({
  threadId: z.string().uuid().nullable(),
  messages: z
    .array(z.object({ role: z.string().min(1).max(20), parts: z.array(z.unknown()).max(80) }))
    .max(120),
})

/** History: applied changes (nearly free — the rows already exist) plus recent conversations. */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await ensureSchema()
    const db = getDb()
    const threadId = new URL(req.url).searchParams.get('threadId')

    if (threadId) {
      const messages = await loadThread(db, userId, threadId)
      if (!messages) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ messages }, { headers: { 'Cache-Control': 'private, no-store' } })
    }

    const [threads, changes] = await Promise.all([
      listThreads(db, userId),
      listAppliedChanges(db, userId),
    ])
    return NextResponse.json({ threads, changes }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    errorLog(error, 'API /coach/threads GET')
    return NextResponse.json({ error: 'Could not load history' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:coach-threads`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = SaveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  try {
    await ensureSchema()
    const id = await saveThread(getDb(), userId, parsed.data.threadId, parsed.data.messages)
    return NextResponse.json({ threadId: id })
  } catch (error) {
    errorLog(error, 'API /coach/threads POST')
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
