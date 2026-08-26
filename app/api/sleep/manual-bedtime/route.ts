import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { getRepositoryAsync } from "@/lib/data"
import { readJsonLimited } from "@trainingai/shared/http/request-guards"
import { rateLimit } from "@/lib/rate-limit"

const MAX_BODY_BYTES = 1024

// Both separators: the client's `localDateString()` emits `YYYY/MM/DD`, and a dash-only regex
// rejects every real request with a Zod error before the handler runs — the ai-chat `localDate`
// shipped that way for a full release.
const ManualBedtimeSchema = z.object({
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  /** ISO timestamp of the remembered bedtime, or null to clear it. */
  at: z.string().datetime({ offset: true }).nullable(),
}).strict()

/**
 * POST — record the bedtime the user remembers for a night the ring did not observe (Q-519).
 *
 * **This writes `manual_sleep_start` and nothing else** — not `sleep_start`, not a duration, not an
 * efficiency, not a synthesised `sleep_end`. The original design wrote the remembered value into
 * `sleep_start` at `manual` rank and relied on the per-field merge; the audit that entry commissioned
 * found three consumers that derive behaviour from the *window* rather than from the stored duration
 * columns, one of which needs no fragmentation to bite. A 23:00 bedtime over a measured 04:23-08:03
 * night produced 9.05 h at 34% efficiency and moved five awake hours into a nightly training set.
 * `docs/reviews/2026-08-26-manual-bedtime-write-audit.md` has the trace.
 *
 * **404 when no session exists for the date.** A night with no measured sleep has no bedtime to
 * correct, and creating a row here would put a session with no duration into every consumer that
 * counts nights. The user gets told nothing was saved rather than a success that changed no row.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`manual-bedtime:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const result = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })

  const parsed = ManualBedtimeSchema.safeParse(result.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }

  const date = parsed.data.date.replace(/\//g, "-")
  const at = parsed.data.at != null ? new Date(parsed.data.at) : null
  if (at != null && Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 })
  }

  const repo = await getRepositoryAsync()
  const saved = await repo.setManualSleepStart(userId, date, at)
  if (!saved) {
    return NextResponse.json({ error: "No sleep session recorded for that date" }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } })
}
