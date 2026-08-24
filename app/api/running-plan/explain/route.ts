import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { generateText } from 'ai'
import { aiModel, loggedGenerateText } from '@/lib/ai/instrument'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One explain request.
const MAX_BODY_BYTES = 16 * 1024

const Body = z.object({
  type: z.string().max(40),
  durationMin: z.number().nullable(),
  // F6: these are joined straight into the prompt — cap them (like ai-chat's history caps) so a
  // buggy/replayed client can't ship a megabyte prompt (token spend / 502s).
  rationale: z.string().max(500),
  gateReasons: z.array(z.string().max(500)).max(12),
}).strict()

// Rephrases the already-computed deterministic rationale into one warm sentence.
// Prose only — never parses the model text as structured data. The AI is never
// load-bearing: on any failure the caller falls back to the deterministic rationale.
export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`running-explain:${userId}`, 15, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = Body.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { type, durationMin, rationale, gateReasons } = parsed.data

  try {
    const { text } = await loggedGenerateText(
      { section: 'running-plan-explain', userId, fingerprint: { type, durationMin } },
      () => generateText({
        model: aiModel(),
        prompt: `You are a supportive running coach. In ONE encouraging sentence (no numbers you invent, no medical claims), restate why today's run is a "${type}" run${durationMin ? ` of about ${durationMin} minutes` : ''}. Base it ONLY on this reasoning: ${[rationale, ...gateReasons].join(' ')}`,
      }),
    )
    return NextResponse.json({ message: text.trim() })
  } catch {
    return NextResponse.json({ message: rationale, degraded: true }, { status: 200 })
  }
}
