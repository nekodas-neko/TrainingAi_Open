import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { SavedMealSchema } from '@trainingai/shared/validators/saved-meal'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// 100 items of a uuid and a multiplier plus a 120-char name is well under 10 KB.
// 64 KB, raised from 32 KB with Q-396. A capped thumbnail is 16 KB DECODED, which is ~21.3 KB of
// base64 characters, and a 100-item meal is ~6 KB on top — 32 KB would have rejected a legitimate
// max-size image with a 413 that looked like a bug in the upload.
const MAX_BODY_BYTES = 64 * 1024

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  return NextResponse.json(await repo.listSavedMeals(userId), { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = SavedMealSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { id, name, items, servings, imageDataUri } = parsed.data
  const repo = await getRepository()
  const meal = await repo.createSavedMeal(userId, name, items, id, servings, imageDataUri)
  return NextResponse.json(meal, { status: 201 })
}
