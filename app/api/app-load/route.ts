import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getRepositoryAsync } from "@/lib/data"
import { readJsonLimited } from "@trainingai/shared/http/request-guards"
import { rateLimit } from "@/lib/rate-limit"
import { AppLoadSchema } from "@trainingai/shared/validation/app-load"

const MAX_BODY_BYTES = 2 * 1024

/**
 * POST — navigation timing from the web shell, sent via `navigator.sendBeacon`, or one native
 * start-up mark (#3774). Body shape: `AppLoadSchema`.
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
