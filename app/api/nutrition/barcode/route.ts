import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { offProductToNutrition, offFetchJson, OFF_FIELDS, OFF_TIMEOUT_MS } from '@trainingai/shared/nutrition/open-food-facts'

// Built from `searchParams` below, not a raw client body — `.strict()` guards nothing today but
// costs nothing and catches the day this route reads a spread of the query instead (Q-464).
const BarcodeSchema = z.object({
  code: z.string()
    .min(8, 'Barcode too short')
    .max(15, 'Barcode too long')
    .regex(/^\d+$/, 'Barcode must contain only digits'),
}).strict()

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`barcode:${session.user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const code = new URL(req.url).searchParams.get('code') ?? ''
  const validationResult = BarcodeSchema.safeParse({ code })
  if (!validationResult.success) {
    return NextResponse.json({ error: 'Invalid barcode format' }, { status: 400 })
  }

  const validCode = validationResult.data.code

  // `unavailable` and `notFound` are different answers and the UI renders them differently: one
  // offers a retry, the other says the product is not in the database and sends the user to the
  // photo scanner. Collapsing them tells the user their food is unknown when the database is simply
  // down — which is what shipped, and what OFF's 2026-08-13 outage surfaced. The search route has
  // drawn this distinction since it was written; this is the sibling that had not.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS)
  let data: { status?: number; product?: unknown } | null
  try {
    data = await offFetchJson(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(validCode)}.json?fields=${OFF_FIELDS}`,
      { signal: controller.signal, revalidateSec: 86400, label: 'barcode' },
    )
  } catch (e) {
    // Thrown rather than returned: an abort on the timeout, or DNS/TLS failure. Same meaning as a
    // null — OFF did not answer — so it must not fall through to `notFound`.
    console.error('[barcode] Open Food Facts lookup failed', e)
    // Q-218 gave the sibling /api/nutrition/scan route this and stopped here. A console.error is
    // invisible to `error_events`, so when the owner reported barcode scanning broken on
    // 2026-08-13 there was no record to read — the failure had already stopped and its cause is
    // now unrecoverable. A route whose dependency is a third-party API that has already had one
    // outage this month has to say so somewhere durable.
    reportServerError(e, { userId: session.user.id, url: '/api/nutrition/barcode' })
    data = null
  } finally {
    clearTimeout(timeout)
  }

  if (!data) return NextResponse.json({ unavailable: true }, { status: 503 })

  if (data.status !== 1 || !data.product) return NextResponse.json({ notFound: true }, { status: 404 })

  // Shared with the text-search route so the two cannot drift on which OFF fields they read or how
  // they turn a free-text serving size into grams.
  const result = offProductToNutrition(data.product)
  if (!result) return NextResponse.json({ notFound: true }, { status: 404 })
  result.notes = 'From Open Food Facts barcode database'

  return NextResponse.json(result)
}
