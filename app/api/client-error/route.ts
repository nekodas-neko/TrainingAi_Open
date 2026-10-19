import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getRepositoryAsync } from "@/lib/data"
import { readJsonLimited } from "@trainingai/shared/http/request-guards"
import {
  NativeClientErrorBatchSchema,
  WebClientErrorSchema,
  type NativeClientError,
} from "@trainingai/shared/validation/client-error"
import { rateLimit } from "@/lib/rate-limit"

const MAX_BODY_BYTES = 16 * 1024

// The native app has no page URL or useful user agent, so where it happened is written into those
// two columns in a fixed shape that groups cleanly: `native://Workouts?api=/api/workout-data`.
function nativeRow(event: NativeClientError) {
  return {
    message: event.message,
    stack: null,
    url: `native://${event.screen}${event.apiPath ? `?api=${event.apiPath}` : ""}`.slice(0, 500),
    userAgent: `TrainingAi Preview/${event.appVersion} (${event.buildCode}; ${event.platform})`,
  }
}

// POST — client-side error capture: one event from the web's ErrorReporter and root error
// boundary, or a batch from the native app (#2913). Fail-closed on oversized/malformed input
// rather than best-effort parsing.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`client-error:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const result = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })

  let rows: { message: string; stack: string | null; url: string | null; userAgent: string | null }[]
  const native = NativeClientErrorBatchSchema.safeParse(result.body)
  if (native.success) {
    rows = native.data.events.map(nativeRow)
  } else {
    const web = WebClientErrorSchema.safeParse(result.body)
    if (!web.success) return NextResponse.json({ error: "message is required" }, { status: 400 })
    rows = [{
      message: web.data.message.slice(0, 2000),
      stack: web.data.stack?.slice(0, 8000) ?? null,
      url: web.data.url?.slice(0, 500) ?? null,
      userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    }]
  }

  const repo = await getRepositoryAsync()
  for (const row of rows) await repo.insertErrorEvent({ userId, source: "client", ...row })

  return NextResponse.json({ ok: true })
}
