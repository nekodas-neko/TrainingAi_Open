import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getRepositoryAsync } from "@/lib/data"
import { readJsonLimited } from "@trainingai/shared/http/request-guards"
import { rateLimit } from "@/lib/rate-limit"

const MAX_BODY_BYTES = 16 * 1024

// POST — client-side error capture, sent via navigator.sendBeacon/fetch from
// the ErrorReporter component and the root error boundary. Fail-closed on
// oversized/malformed input rather than best-effort parsing.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`client-error:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const result = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })

  const body = result.body as { message?: unknown; stack?: unknown; url?: unknown }
  if (typeof body.message !== "string" || body.message.length === 0) {
    return NextResponse.json({ error: "message is required" }, { status: 400 })
  }

  const repo = await getRepositoryAsync()
  await repo.insertErrorEvent({
    userId,
    source: "client",
    message: body.message.slice(0, 2000),
    stack: typeof body.stack === "string" ? body.stack.slice(0, 8000) : null,
    url: typeof body.url === "string" ? body.url.slice(0, 500) : null,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  })

  return NextResponse.json({ ok: true })
}
