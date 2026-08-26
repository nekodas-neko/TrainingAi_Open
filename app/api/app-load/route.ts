import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { getRepositoryAsync } from "@/lib/data"
import { readJsonLimited } from "@trainingai/shared/http/request-guards"
import { rateLimit } from "@/lib/rate-limit"

const MAX_BODY_BYTES = 2 * 1024

// One row per page load (BF-19). Bounds reject the impossible, not the slow: a 10-minute load is a
// corrupt reading, and a route longer than 200 chars is not a route.
const AppLoadSchema = z.object({
  route:           z.string().min(1).max(200),
  responseStartMs: z.number().int().min(0).max(600_000).nullable().optional(),
  domContentMs:    z.number().int().min(0).max(600_000).nullable().optional(),
  totalMs:         z.number().int().min(0).max(600_000),
  cold:            z.boolean(),
  buildId:         z.string().max(64).nullable().optional(),
}).strict()

/**
 * POST — navigation timing from the device, sent via `navigator.sendBeacon`.
 *
 * Rate limited well above the reporter's own cadence (it fires once per JS context) so a warm limit
 * cannot silently erase a real measurement, but low enough that a loop cannot fill the table.
 *
 * **200 on a rejected body, deliberately.** A beacon's response is unobservable — the client cannot
 * read a 400 and has nothing to do about one — and a 4xx here would only show up as noise in the
 * very error log this feature exists to keep readable. The row is dropped and the reason is logged
 * server-side, where someone can act on it.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`app-load:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const result = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })

  const parsed = AppLoadSchema.safeParse(result.body)
  if (!parsed.success) {
    console.warn('[app-load] dropped a malformed report', parsed.error.issues[0]?.message)
    return NextResponse.json({ ok: true })
  }

  const repo = await getRepositoryAsync()
  await repo.insertAppLoadMetric({ userId, ...parsed.data })

  return NextResponse.json({ ok: true })
}
