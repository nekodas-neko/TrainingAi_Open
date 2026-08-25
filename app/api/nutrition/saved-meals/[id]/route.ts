import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { SavedMealSchema } from '@trainingai/shared/validators/saved-meal'
import { invalidUuidResponse, withRouteErrors } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Same shape as the create route.
// 64 KB, raised from 32 KB with Q-396. A capped thumbnail is 16 KB DECODED, which is ~21.3 KB of
// base64 characters, and a 100-item meal is ~6 KB on top — 32 KB would have rejected a legitimate
// max-size image with a 413 that looked like a bug in the upload.
const MAX_BODY_BYTES = 64 * 1024

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
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
  const { name, items, servings, imageDataUri, mealTypeIds } = parsed.data
  const repo = await getRepository()
  // Same reasoning as the POST route: a refused write answers 400 with a message, not 500 — which
  // also keeps the offline outbox quarantining it instead of retrying it forever.
  return withRouteErrors(async () => {
    const updated = await repo.updateSavedMeal(id, userId, name, items, servings, imageDataUri, mealTypeIds)
    return NextResponse.json(updated)
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const repo = await getRepository()
  await repo.deleteSavedMeal(id, userId)
  return NextResponse.json({ success: true })
}
