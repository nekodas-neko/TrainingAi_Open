import { APICallError } from 'ai'
import { NextResponse } from 'next/server'
import { reportServerError } from '@/lib/observability'
import { resolveClaudeRoOwner } from '@/lib/data/postgres/claude-ro-owner'

/**
 * Gemini billing and quota failures (issue 2815).
 *
 * On 2026-10-11 the prepaid credits on the Gemini key ran out and every AI feature failed at once.
 * Two things made it worse than it had to be. The scan route answered `502 AI service unavailable.
 * Please try again.`, which asks the person to retry something that cannot succeed, and the only
 * record of the failure was an `error_events` row under the caller's own user id. Every `claude_ro`
 * view is scoped to the owner's rows, so a failure on another account never reached the health check.
 *
 * A billing failure is not transient and not the person's doing, so it is told apart from the rest
 * here, once, for every AI route.
 */

export const AI_PAUSED_CODE = 'ai_paused'
export const AI_PAUSED_MESSAGE = 'AI features are paused right now. Nothing you did caused this, and retrying will not help.'

/** What a depleted balance or an exhausted quota says. Google words these several ways. */
const BILLING_TEXT = /prepayment credits|credits? (?:are |is )?(?:depleted|exhausted)|billing|exceeded your current quota|quota (?:exceeded|exhausted)|insufficient (?:funds|quota)/i

const CAUSE_DEPTH = 4

/**
 * True when the provider refused because of the account, not the request.
 *
 * 402 is always that. 400, 403 and 429 only count when the provider's own words say billing or
 * quota: a bare 429 is a rate limit that the retry policy already handles and that clears by itself,
 * and calling it "paused" would hide the difference from the person reading the message.
 */
export function isAiBillingError(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < CAUSE_DEPTH && cur != null; i++) {
    if (APICallError.isInstance(cur)) {
      if (cur.statusCode === 402) return true
      if (cur.statusCode === 400 || cur.statusCode === 403 || cur.statusCode === 429) {
        if (BILLING_TEXT.test(`${cur.message} ${cur.responseBody ?? ''}`)) return true
      }
    }
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

/**
 * The 503 an AI route returns for a billing failure, or null for any other error.
 *
 * `code` is what a client keys on; `error` is the sentence to show. Call it where the route would
 * otherwise answer 5xx, after any deterministic fallback the route already offers (the digest and
 * the recap answer with the day's figures instead, which is better than a notice).
 */
export function aiPausedResponse(err: unknown): NextResponse | null {
  if (!isAiBillingError(err)) return null
  return NextResponse.json({ error: AI_PAUSED_MESSAGE, code: AI_PAUSED_CODE }, { status: 503 })
}

export const AI_PAUSED_SIGNAL_PREFIX = 'ai_provider_paused'
const SIGNAL_EVERY_MS = 60 * 60 * 1000
let lastSignalAt = -Infinity

/**
 * Leave one owner-visible record that the provider is refusing on billing.
 *
 * Written to `error_events` under the OWNER's user id, because that is the only scope the health
 * check can read. At most once an hour per server process, so an outage that every request trips
 * leaves one row an hour instead of thousands. The message starts with `AI_PAUSED_SIGNAL_PREFIX`
 * so one `LIKE` finds it. Returns whether the error was a billing one.
 */
export function noteAiBillingError(err: unknown, now: number = Date.now()): boolean {
  if (!isAiBillingError(err)) return false
  if (now - lastSignalAt < SIGNAL_EVERY_MS) return true
  lastSignalAt = now
  const status = APICallError.isInstance(err) ? err.statusCode : null
  const detail = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 300)
  reportServerError(
    new Error(`${AI_PAUSED_SIGNAL_PREFIX}: Gemini refused on billing${status ? ` (HTTP ${status})` : ''}: ${detail}`),
    { userId: resolveClaudeRoOwner()?.owner, url: 'ai-provider' },
  )
  return true
}

/** Test seam: forget the hourly throttle. */
export function resetAiPausedSignalForTests(): void {
  lastSignalAt = -Infinity
}
