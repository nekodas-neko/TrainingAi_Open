import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getRepositoryAsync } from "@/lib/data"
import { readJsonLimited } from "@trainingai/shared/http/request-guards"
import { PartialNightPayloadSchema } from "@trainingai/shared/health/partial-night"
import { rateLimit } from "@/lib/rate-limit"
import { invalidBodyResponse, withRouteErrors } from "@/lib/api/route-errors"
import { withNightRescore } from "@/lib/health/rescore-nights"

const MAX_BODY_BYTES = 1024

/**
 * POST — mark a night partial, or unmark it (#2265). Body: `{ id, partial }`, strict: `id` is the
 * night's row id as the sleep read returns it, `partial: true` marks and `false` unmarks.
 *
 * A marked night keeps its HRV, heart rate and breathing and loses the numbers that depend on how long
 * the ring recorded (`packages/shared/src/health/partial-night.ts`). Manual only: nothing detects a
 * partial night. It is a flag, never a delete, and unmarking returns the night exactly.
 *
 * The write covers every live device row with the same wake date as `id`, so a night split by a
 * wake-up cannot be half marked. The device's offline path is the `partial_night` outbox domain, which
 * calls the same repository write inside the same re-score, so the two cannot drift.
 *
 * - 200 `{ ok, partial }`; marking an already marked night is a success (idempotent).
 * - 404 when `id` is not one of the caller's live device nights. Another user's id reads the same, and
 *   so does a night the caller typed: a typed night's hours are not a measurement to distrust.
 *
 * The re-score is the one an Oura revision gets: the recent days whose night changed have their stored
 * Sleep Score rebuilt (or cleared), and today's readiness is cleared to be read again.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`partial-night:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!body.ok) return NextResponse.json({ error: body.reason }, { status: 400 })
  const parsed = PartialNightPayloadSchema.safeParse(body.body)
  if (!parsed.success) return invalidBodyResponse(parsed.error)

  return withRouteErrors(async () => {
    const repo = await getRepositoryAsync()
    const outcome = await withNightRescore(repo, userId, () =>
      repo.setPartialNight(userId, parsed.data.id, parsed.data.partial ? new Date() : null))
    if (outcome === 'not_found') return NextResponse.json({ error: "Night not found" }, { status: 404 })
    return NextResponse.json(
      { ok: true, partial: parsed.data.partial },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  })
}
