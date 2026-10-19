import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { clientIp } from '@trainingai/shared/http/client-ip'
import { readTextLimited } from '@trainingai/shared/http/request-guards'
import { ouraOAuthConfig } from '@/lib/oura/cloud/config'
import { hasOuraTokenKey } from '@/lib/oura/cloud/token-cipher'
import { reportOuraCloudIssue } from '@/lib/oura/cloud/report'
import {
  OuraWebhookEvent, handleOuraWebhookEvent, isOurVerificationToken, isRetryableOuraError, ouraWebhookConfig, verifyOuraSignature,
} from '@/lib/oura/cloud/webhook'

// Oura's webhook (#2859), at `OURA_WEBHOOK_CALLBACK_URL`
// (production: https://trainingai-production.up.railway.app/api/oura/webhook).
//
// Public and unauthenticated by nature: Oura calls it. So it is rate limited per IP, every input is
// parsed with Zod, a POST is refused unless its signature (keyed with the client secret) checks out,
// and with any setting missing it answers 503 and does nothing. The work lives in
// `lib/oura/cloud/webhook.ts`; this file is the HTTP edge.
//
// Status codes matter to Oura: a non-2xx is retried (about ten times over an hour), and a **410
// cancels the subscription**, so this route never answers 410. A 503 is reserved for "try again":
// Oura unreachable, or our database failing.

const MAX_BODY_BYTES = 4 * 1024

// Not `.strict()`: a parameter Oura adds later must not fail every subscription's verification. The
// token compare is the check that matters.
const VerifyQuery = z.object({
  verification_token: z.string().min(1).max(512),
  challenge: z.string().min(1).max(512),
})

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function settings() {
  const config = ouraWebhookConfig(ouraOAuthConfig())
  // Without the token key no stored grant can be opened, so no event could be acted on.
  return config && hasOuraTokenKey() ? config : null
}

/** The verification challenge Oura sends when a subscription is created. */
export async function GET(req: NextRequest) {
  if (!rateLimit(`oura-webhook-verify:${clientIp(req)}`, 60, 60 * 1000)) return json({ error: 'Too many requests' }, 429)
  const config = settings()
  if (!config) return json({ error: 'Oura webhooks are not configured on this server.' }, 503)
  const params = req.nextUrl.searchParams
  const query = VerifyQuery.safeParse(Object.fromEntries(params.entries()))
  if (!query.success) return json({ error: 'Invalid request' }, 400)
  if (!isOurVerificationToken(config, query.data.verification_token)) return json({ error: 'Invalid verification token' }, 401)
  return json({ challenge: query.data.challenge })
}

/** One event: a document was created, updated or deleted for a connected Oura account. */
export async function POST(req: NextRequest) {
  // Generous: one sync can fan out into a dozen events within seconds, and Oura retries on a 429.
  if (!rateLimit(`oura-webhook:${clientIp(req)}`, 300, 60 * 1000)) return json({ error: 'Too many requests' }, 429)
  const config = settings()
  if (!config) return json({ error: 'Oura webhooks are not configured on this server.' }, 503)

  const read = await readTextLimited(req, MAX_BODY_BYTES)
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'Request too large' : 'Invalid body' }, read.reason === 'too_large' ? 413 : 400)

  const signature = req.headers.get('x-oura-signature')
  const timestamp = req.headers.get('x-oura-timestamp')
  const verdict = verifyOuraSignature(config.oauth.clientSecret, signature, timestamp, read.text)
  if (verdict !== 'ok') {
    // Which headers came, never their values: a signing format we got wrong would otherwise refuse
    // every real event in silence.
    reportOuraCloudIssue(`webhook-signature:${verdict}`,
      `refused an event (x-oura-signature ${signature ? 'present' : 'absent'}, x-oura-timestamp ${timestamp ? 'present' : 'absent'}, ${read.text.length} bytes)`)
    return json({ error: 'Invalid signature' }, 401)
  }

  let raw: unknown
  try { raw = JSON.parse(read.text) } catch { return json({ error: 'Invalid body' }, 400) }
  const event = OuraWebhookEvent.safeParse(raw)
  if (!event.success) return json({ error: 'Invalid body' }, 400)

  try {
    const repo = await getRepositoryAsync()
    const outcome = await handleOuraWebhookEvent({ repo, config: config.oauth, rescore: repo }, event.data)
    // Only the outcome's name goes back; no user id, no health data.
    return json({ received: true, result: outcome.result })
  } catch (err) {
    if (isRetryableOuraError(err)) {
      console.warn(`[oura] webhook: Oura unavailable, asking for a retry: ${err instanceof Error ? err.message : 'unknown'}`)
      return json({ error: 'Temporarily unavailable' }, 503)
    }
    reportServerError(err, { url: '/api/oura/webhook' })
    return json({ error: 'Temporarily unavailable' }, 503)
  }
}
