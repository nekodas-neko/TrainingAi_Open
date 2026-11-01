// When the Oura Cloud feed last spoke (#2861): two stamps on `oura_tokens`, read back by
// `GET /api/oura/connection` for the Devices status and the freshness line on the Readiness and
// Sleep cards.
//
// Both are bookkeeping on a delivery Oura will retry if it sees a failure, so neither ever throws:
// a failed stamp is reported (a reason, never a reading) and the delivery carries on.
import { reportOuraCloudIssue } from './report'
import type { OuraTokenStore } from './tokens'

async function stamp(label: string, userId: string, write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (err) {
    reportOuraCloudIssue(`freshness:${label}`, err instanceof Error ? err.message : 'unknown', { userId })
  }
}

/** A verified webhook event for the user's stored data type arrived. */
export function stampOuraWebhook(store: Pick<OuraTokenStore, 'touchOuraCloudWebhook'>, userId: string): Promise<void> {
  return stamp('webhook', userId, () => store.touchOuraCloudWebhook(userId))
}

/** Oura data was written for the user: a webhook document, a backfill or reconciliation, or heart rate. */
export function stampOuraData(store: Pick<OuraTokenStore, 'touchOuraCloudData'>, userId: string): Promise<void> {
  return stamp('data', userId, () => store.touchOuraCloudData(userId))
}
