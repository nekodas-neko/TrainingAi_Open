// Oura's app-level webhook subscriptions (#2859): one per (data type, event type), all pointing at
// `OURA_WEBHOOK_CALLBACK_URL`. Managed with the app's client credentials (`x-client-id` /
// `x-client-secret`), never a user's token (spec: `/v2/webhook/subscription*`, `ClientIdAuth` +
// `ClientSecretAuth`).
//
// `ensureOuraWebhookSubscriptions` is the renewal job: it lists what Oura holds, renews ours that
// are close to expiry, and creates the ones that are missing. It assumes nothing exists, because
// the old integration's subscriptions have expired. Subscriptions at any other callback URL are
// left alone. Run twice, it does nothing the second time.
import { z } from 'zod'
import { OURA_API_BASE, OURA_REQUEST_TIMEOUT_MS } from './config'
import { OuraUnavailableError } from './client'
import { OURA_DOCUMENT_TYPE_NAMES, type OuraDocumentType } from './documents'
import type { OuraWebhookConfig } from './webhook'

type EventType = 'create' | 'update' | 'delete'

/**
 * What we subscribe to: every stored type on create and update, and `sleep` on delete too, because
 * a deleted sleep period is the one removal we act on (a tombstone).
 */
export const WANTED_SUBSCRIPTIONS: readonly { dataType: OuraDocumentType; eventType: EventType }[] = [
  ...OURA_DOCUMENT_TYPE_NAMES.flatMap(dataType => (['create', 'update'] as const).map(eventType => ({ dataType, eventType }))),
  { dataType: 'sleep', eventType: 'delete' },
]

/** Renew a subscription when it has less than this left. The job runs every 12 hours. */
export const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000

/** Spec `WebhookSubscriptionModel`. */
const Subscription = z.object({
  id: z.string().min(1),
  callback_url: z.string(),
  event_type: z.string(),
  data_type: z.string(),
  expiration_time: z.string().refine(s => !Number.isNaN(Date.parse(s)), 'not a date-time'),
})
type Subscription = z.infer<typeof Subscription>

async function call(config: OuraWebhookConfig, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  let res: Response
  try {
    res = await fetch(`${OURA_API_BASE}/v2/webhook/subscription${path}`, {
      method,
      headers: {
        'x-client-id': config.oauth.clientId,
        'x-client-secret': config.oauth.clientSecret,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(OURA_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    throw new OuraUnavailableError(`Oura could not be reached: ${err instanceof Error ? err.name : 'unknown'}`)
  }
  return { status: res.status, json: await res.json().catch(() => null) }
}

export async function listOuraSubscriptions(config: OuraWebhookConfig): Promise<Subscription[]> {
  const { status, json } = await call(config, 'GET', '')
  if (status !== 200) throw new OuraUnavailableError(`Oura's subscription list answered ${status}`, status)
  const parsed = z.array(Subscription).safeParse(json)
  if (!parsed.success) throw new OuraUnavailableError("Oura's subscription list had an unexpected shape")
  return parsed.data
}

export interface SubscriptionReport {
  dryRun: boolean
  /** Ours and good for more than `RENEW_WITHIN_MS`. */
  current: string[]
  renewed: string[]
  created: string[]
  /** What could not be renewed or created, with Oura's status. The job carries on past each one. */
  failed: { subscription: string; status: number | null; error: string }[]
}

const label = (s: { dataType: string; eventType: string }) => `${s.dataType}:${s.eventType}`

/**
 * Brings Oura's subscriptions for our callback up to `WANTED_SUBSCRIPTIONS`. A dry run lists and
 * reports what it would do, and changes nothing at Oura. Throws `OuraUnavailableError` only when the
 * list itself cannot be read; a single renew or create that fails is reported and the rest go on.
 */
export async function ensureOuraWebhookSubscriptions(
  config: OuraWebhookConfig, opts: { dryRun: boolean; now?: number },
): Promise<SubscriptionReport> {
  const now = opts.now ?? Date.now()
  const existing = (await listOuraSubscriptions(config)).filter(s => s.callback_url === config.callbackUrl)
  const report: SubscriptionReport = { dryRun: opts.dryRun, current: [], renewed: [], created: [], failed: [] }

  for (const want of WANTED_SUBSCRIPTIONS) {
    const name = label(want)
    // The one with the latest expiry, if Oura holds more than one for the same pair.
    const mine = existing
      .filter(s => s.data_type === want.dataType && s.event_type === want.eventType)
      .sort((a, b) => Date.parse(b.expiration_time) - Date.parse(a.expiration_time))[0]

    if (mine && Date.parse(mine.expiration_time) - now > RENEW_WITHIN_MS) {
      report.current.push(name)
      continue
    }
    if (mine) {
      if (opts.dryRun) { report.renewed.push(name); continue }
      try {
        const { status, json } = await call(config, 'PUT', `/renew/${encodeURIComponent(mine.id)}`)
        if (status === 200 && Subscription.safeParse(json).success) { report.renewed.push(name); continue }
        // 403 is the spec's "does not exist"; anything else is a failed renew. Either way a fresh
        // subscription replaces it below rather than leaving the pair uncovered.
        if (status !== 403) report.failed.push({ subscription: name, status, error: 'renew failed; creating a new one' })
      } catch (err) {
        report.failed.push({ subscription: name, status: null, error: err instanceof Error ? err.message : 'renew failed' })
        continue
      }
    }
    if (opts.dryRun) { report.created.push(name); continue }
    try {
      const { status, json } = await call(config, 'POST', '', {
        callback_url: config.callbackUrl,
        verification_token: config.verificationToken,
        event_type: want.eventType,
        data_type: want.dataType,
      })
      if ((status === 201 || status === 200) && Subscription.safeParse(json).success) report.created.push(name)
      else report.failed.push({ subscription: name, status, error: 'create failed' })
    } catch (err) {
      report.failed.push({ subscription: name, status: null, error: err instanceof Error ? err.message : 'create failed' })
    }
  }
  return report
}
