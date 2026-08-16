import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/data/postgres/client"
import { rateLimit } from "@/lib/rate-limit"
import { CHANGELOG } from "@trainingai/shared/changelog"

const DB_PING_TIMEOUT_MS = 3000

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
}

// GET — no-auth liveness endpoint for external uptime monitors.
// Never leak connection details (host, credentials, error messages) in the response.
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  if (!rateLimit(`status:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const version = CHANGELOG[0]?.version ?? "unknown"

  try {
    await Promise.race([getPool().query("SELECT 1"), timeout(DB_PING_TIMEOUT_MS)])
    return NextResponse.json({ ok: true, db: "up", version })
  } catch {
    return NextResponse.json({ ok: false, db: "down", version }, { status: 503 })
  }
}
