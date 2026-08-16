import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { rateLimit } from "@/lib/rate-limit"
import { sendPushToUser, getVapidPublicKey } from "@/lib/push"

// POST — sends a real test push notification to the caller's own subscriptions.
// Proves the push path end-to-end without waiting for a real trigger to fire
// (there is no cron layer yet — see E6 in planned_upgrades.md).
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!getVapidPublicKey()) {
    return NextResponse.json({ error: "Push is not configured on this server" }, { status: 503 })
  }

  if (!rateLimit(`push-test:${userId}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  await sendPushToUser(userId, { title: "TrainingAI", body: "Test notification" })
  return NextResponse.json({ ok: true })
}
