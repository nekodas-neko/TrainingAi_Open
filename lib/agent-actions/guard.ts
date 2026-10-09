import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { clientIp } from '@trainingai/shared/http/client-ip'

/**
 * The agent key (issue 2381, part b): the ONE place that reads `AGENT_ACTIONS_SECRET`.
 *
 * An agent runs an allow-listed maintenance job (`lib/agent-actions/jobs.ts`) by sending
 * `Authorization: Bearer <AGENT_ACTIONS_SECRET>` to `/api/agent-actions`. This guard decides whether
 * it may, and it is deliberately synchronous: it touches no database, so a missing or wrong key is
 * refused before any lookup and before any log row exists.
 *
 * - **Fails closed.** No secret configured, or one shorter than `AGENT_SECRET_MIN_LENGTH`, refuses
 *   everything. Deleting the variable on Railway is the off switch.
 * - **Never the session cookie.** It reads only the Authorization header. A signed-in browser that
 *   calls an agent route without the key gets the same 401 as anyone else, and an agent route never
 *   calls `auth()`; a source-scan test holds both.
 * - **Rate-limited per IP before the compare**, so the key cannot be guessed quickly, and a trip
 *   returns the same 401 as a wrong key.
 * - **Constant-time compare** (`safeCompare`).
 * - **The key names no user.** It acts on the owner's account only: `ADMIN_EXPORT_USER_ID`, falling
 *   back to `WEBHOOK_USER_ID`, as the other owner-scoped bearer routes resolve it. The route then
 *   requires the request to name that account explicitly and checks it is still an admin.
 */
export const AGENT_SECRET_MIN_LENGTH = 32

/** Attempts per IP per minute, counted before the compare. */
export const AGENT_KEY_ATTEMPTS_PER_MINUTE = 10

export type AgentAuthOutcome =
  | { ok: true; ownerUserId: string }
  | { ok: false; status: 401; error: 'Unauthorized' }

const REFUSED: AgentAuthOutcome = { ok: false, status: 401, error: 'Unauthorized' }

export function authorizeAgentRequest(req: Request): AgentAuthOutcome {
  const header = req.headers.get('authorization')
  const bearer = header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1]
  if (!bearer) return REFUSED

  if (!rateLimit(`agent-actions-key:${clientIp(req)}`, AGENT_KEY_ATTEMPTS_PER_MINUTE, 60_000)) return REFUSED

  const expected = process.env.AGENT_ACTIONS_SECRET
  const ownerUserId = process.env.ADMIN_EXPORT_USER_ID || process.env.WEBHOOK_USER_ID
  if (!expected || expected.length < AGENT_SECRET_MIN_LENGTH || !ownerUserId) return REFUSED
  if (!safeCompare(bearer, expected)) return REFUSED
  return { ok: true, ownerUserId }
}
