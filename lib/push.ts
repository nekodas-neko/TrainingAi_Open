import webpush from 'web-push'
import { getDb } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'
import { eq, inArray } from 'drizzle-orm'

const VAPID_CONFIGURED =
  !!process.env.VAPID_PUBLIC_KEY &&
  !!process.env.VAPID_PRIVATE_KEY &&
  !!process.env.VAPID_EMAIL

if (VAPID_CONFIGURED) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL}`,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  icon?: string
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!VAPID_CONFIGURED) return

  const db = getDb()
  const subs = await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, userId))

  const data = JSON.stringify(payload)
  const failed: string[] = []

  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        data,
      )
    } catch (err: unknown) {
      // 410 Gone = subscription expired; collect for cleanup
      if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 410) {
        failed.push(sub.id)
      }
    }
  }))

  if (failed.length > 0) {
    await db.delete(s.pushSubscriptions).where(inArray(s.pushSubscriptions.id, failed))
  }
}
