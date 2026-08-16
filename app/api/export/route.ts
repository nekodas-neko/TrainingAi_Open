import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { rateLimit } from "@/lib/rate-limit"
import { exportUserData } from "@/lib/export/full-export"
import { todayInTz, DEFAULT_TZ } from "@trainingai/shared/date-utils"

// GET — full-data takeout. Streams NDJSON (one `{domain, row}` line per record)
// via ReadableStream rather than buffering the whole export in memory.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`export:${userId}`, 2, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const line of exportUserData(userId)) {
          controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"))
        }
      } catch (err) {
        console.error("[export] stream failed", err)
      } finally {
        controller.close()
      }
    },
  })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const date = todayInTz(tz)
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="trainingai-export-${date}.ndjson"`,
    },
  })
}
