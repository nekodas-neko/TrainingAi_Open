import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getRepositoryAsync } from "@/lib/data"
import { DEFAULT_TZ } from "@trainingai/shared/date-utils"
import { readJsonLimited } from "@trainingai/shared/http/request-guards"
import { parseManualNight, ManualSleepRemoveSchema } from "@trainingai/shared/health/manual-sleep"
import { rateLimit } from "@/lib/rate-limit"
import { invalidBodyResponse, withRouteErrors } from "@/lib/api/route-errors"

const MAX_BODY_BYTES = 1024

/**
 * POST — store a night the user entered by hand: a bed time and a wake time (#2338).
 *
 * Body: `{ sleepStart, sleepEnd, id? }`, instants with their offset (`ManualSleepNightSchema`,
 * strict). The night's DATE is never taken from the client: it is the local date of the wake time
 * in the session user's timezone, the date every `sleep_sessions` row carries. The device's offline
 * path is the `manual_sleep` outbox domain, which calls the same parse and the same repository
 * write, so the two cannot drift.
 *
 * Posting the same night again edits it (the key is user + wake date), never adds a second row.
 * `shadowed: true` says a device already recorded that night: the entry is kept, but readiness, the
 * sleep list and every other reader use the device night (`preferDeviceNights`).
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`manual-sleep:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!body.ok) return NextResponse.json({ error: body.reason }, { status: 400 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const parsed = parseManualNight(body.body, tz, new Date())
  if (!parsed.ok) {
    if (parsed.issues) return invalidBodyResponse(parsed.issues)
    return NextResponse.json({ error: `Not a plausible night: ${parsed.reason}` }, { status: 400 })
  }

  return withRouteErrors(async () => {
    const repo = await getRepositoryAsync()
    const saved = await repo.saveManualSleepNight(userId, parsed.night)
    return NextResponse.json(
      { ok: true, id: saved.id, date: parsed.night.date, shadowed: saved.shadowed },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  })
}

/**
 * DELETE — remove a night the user entered by hand (issue 2606). Body: `{ id }`, strict.
 *
 * A soft delete (`deleted_at`), so a device that has not synced learns of it from the delta pull. The
 * device's offline path is the same `manual_sleep` outbox domain with `{ id, deleted: true }`, which
 * calls the same `deleteManualSleepNight`.
 *
 * - 200 `{ ok, removed: true }`; `alreadyRemoved: true` when it was removed before (idempotent).
 * - 404 when the id is not one of the caller's nights — another user's id reads the same.
 * - 409 when it is the caller's night but a device measured it: only a typed night can be removed.
 *
 * Entering the same night again later brings the removed row back (`saveManualSleepNight`).
 */
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  // The same bucket as POST: one user entering and removing nights is one budget.
  if (!rateLimit(`manual-sleep:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!body.ok) return NextResponse.json({ error: body.reason }, { status: 400 })
  const parsed = ManualSleepRemoveSchema.safeParse(body.body)
  if (!parsed.success) return invalidBodyResponse(parsed.error)

  return withRouteErrors(async () => {
    const repo = await getRepositoryAsync()
    const outcome = await repo.deleteManualSleepNight(userId, parsed.data.id)
    if (outcome === 'not_found') return NextResponse.json({ error: "Night not found" }, { status: 404 })
    if (outcome === 'not_manual') {
      return NextResponse.json({ error: "Only a night you entered can be removed" }, { status: 409 })
    }
    return NextResponse.json(
      { ok: true, removed: true, alreadyRemoved: outcome === 'already_removed' },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  })
}
