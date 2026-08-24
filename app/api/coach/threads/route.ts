import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { rateLimit } from '@/lib/rate-limit'
import { listThreads, listAppliedChanges, saveThread, loadThread } from '@/lib/coach/threads'
import { errorLog } from '@trainingai/shared/logger'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// The same payload `coach` takes, on the way back to storage: 120 messages of up to 80 `z.unknown()`
// parts each. Sized by the same production measurement (max message 52,571 bytes) and the same
// reasoning — see `app/api/coach/route.ts`.
const MAX_BODY_BYTES = 8 * 1024 * 1024

const SaveSchema = z.object({
  threadId: z.string().uuid().nullable(),
  messages: z
    .array(z.object({ role: z.string().min(1).max(20), parts: z.array(z.unknown()).max(80) }).strict())
    .max(120),
}).strict()

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

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = SaveSchema.safeParse(read.body)
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
