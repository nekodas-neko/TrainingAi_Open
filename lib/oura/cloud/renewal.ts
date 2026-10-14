// Keeps Oura's webhook subscriptions alive (#2859): runs `ensureOuraWebhookSubscriptions` five minutes
// after boot and every 12 hours after that, in production. Subscriptions are app-level, so one pass covers every user.
//
// It does nothing unless every webhook setting is present and this is production: a dev server or a
// test never reaches Oura from here. Across replicas, a transaction-scoped advisory lock lets one pass
// run at a time, so two replicas booting together cannot both create the same subscription.
import { getPool } from '@/lib/data/postgres/client'
import { ouraOAuthConfig } from './config'
import { ensureOuraWebhookSubscriptions, type SubscriptionReport } from './subscriptions'
import { ouraWebhookConfig } from './webhook'

export const RENEWAL_INTERVAL_MS = 12 * 60 * 60 * 1000
/**
 * The first pass waits this long after boot. Creating a subscription makes Oura call the callback to
 * verify it, and right after a deploy the traffic may still reach the previous container, which (on
 * the first release with this route) has no webhook to answer.
 */
export const FIRST_PASS_DELAY_MS = 5 * 60 * 1000
const LOCK_KEY = 'oura-webhook-renewal'

/** One pass under the lock. `null` when another replica holds it or the settings are missing. */
export async function runOuraWebhookRenewal(dryRun = false): Promise<SubscriptionReport | null> {
  const config = ouraWebhookConfig(ouraOAuthConfig())
  if (!config) return null
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked', [LOCK_KEY])
    if (!rows[0]?.locked) return null
    return await ensureOuraWebhookSubscriptions(config, { dryRun })
  } finally {
    await client.query('COMMIT').catch(() => {})
    client.release()
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Starts the 12-hour renewal in this process. Production only; idempotent. */
export function startOuraWebhookRenewal(env: NodeJS.ProcessEnv = process.env): boolean {
  if (timer || env.NODE_ENV !== 'production' || !ouraWebhookConfig(ouraOAuthConfig(env), env)) return false
  const pass = () => {
    runOuraWebhookRenewal()
      .then(report => {
        if (report && report.failed.length > 0) {
          console.warn(`[oura] webhook renewal: ${report.failed.length} subscription(s) failed: ${report.failed.map(f => `${f.subscription} (${f.status ?? 'no answer'})`).join(', ')}`)
        }
      })
      .catch(err => console.error('[oura] webhook renewal failed:', err instanceof Error ? err.message : 'unknown'))
  }
  timer = setTimeout(() => {
    pass()
    setInterval(pass, RENEWAL_INTERVAL_MS).unref?.()
  }, FIRST_PASS_DELAY_MS)
  timer.unref?.()
  return true
}
