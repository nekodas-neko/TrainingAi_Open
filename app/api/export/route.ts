import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { rateLimit } from "@/lib/rate-limit"
import { exportUserData } from "@/lib/export/full-export"
import { EXPORT_COMPLETE_TRAILER, EXPORT_ERROR_TRAILER } from "@/lib/export/trailer"
import { reportServerError } from "@/lib/observability"
import { todayInTz, DEFAULT_TZ } from "@trainingai/shared/date-utils"

// GET — full-data takeout. Streams NDJSON (one `{domain, row}` line per record), starting with a
// `_manifest` line naming every excluded table and why, and ending with a trailer (#2427):
// `{"_complete":true}` when every line was written, `{"_error":{code,message}}` when the export threw
// part-way. A file with neither as its last line was cut off (dropped connection, killed request).
// The contract lives in `lib/export/trailer.ts`.
//
// Q-288: this comment used to claim the export streamed "rather than buffering the whole export in
// memory", and only the enqueue below was ever true — `exportUserData` read each table with a
// single buffering `pool.query`. It now paginates by primary key, so the claim holds.
//
// #2427: the stream used to drain the generator inside `start()`, which enqueues every line as fast
// as Postgres returns it, whatever the client is reading. On a slow phone link that re-buffered the
// whole export in server memory and undid the pagination above. It now `pull`s, so the generator
// (and so the next keyset page) advances only when the queue has room.

/** Bytes queued ahead of the client before the generator is paused. */
const HIGH_WATER_BYTES = 256 * 1024

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`export:${userId}`, 2, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const encoder = new TextEncoder()
  const encode = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n")
  const lines = exportUserData(userId)[Symbol.asyncIterator]()
  let finished = false

  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (finished) return
        try {
          // Fill to the high-water mark per pull rather than one line per pull: a row is ~100 bytes
          // and a production export is around a million of them.
          while ((controller.desiredSize ?? 0) > 0) {
            const next = await lines.next()
            if (next.done) {
              finished = true
              controller.enqueue(encode(EXPORT_COMPLETE_TRAILER))
              controller.close()
              return
            }
            controller.enqueue(encode(next.value))
          }
        } catch (err) {
          // The status and headers are already sent, so the trailer is the only place a failure can
          // be said. The detail goes to the owner's error log, never into the user's file.
          finished = true
          reportServerError(err, { userId, url: "/api/export" })
          controller.enqueue(encode(EXPORT_ERROR_TRAILER))
          controller.close()
        }
      },
      async cancel() {
        // The client went away. Stop reading tables for nobody; the generator's `finally` paths run.
        finished = true
        await lines.return?.(undefined)
      },
    },
    { highWaterMark: HIGH_WATER_BYTES, size: (chunk) => chunk.byteLength },
  )

  const tz = session.user.timezone ?? DEFAULT_TZ
  const date = todayInTz(tz)
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="trainingai-export-${date}.ndjson"`,
      "Cache-Control": "private, no-store",
    },
  })
}
