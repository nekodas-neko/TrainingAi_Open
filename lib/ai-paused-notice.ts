/**
 * The client half of the "AI is paused" notice (issue 2890).
 *
 * `lib/ai/provider-paused.ts` makes every AI route answer a depleted Gemini balance with
 * `503 {code: 'ai_paused', error: '<sentence>'}`. Most screens ignore the response text and show a
 * fixed toast of their own ("Could not refine — try rephrasing"), which blames the person for
 * something no retry fixes. These read the notice so a screen can show it instead.
 *
 * Pure, with no server imports, so a component can use it. It sits beside `lib/`, not in `lib/ai/`, on
 * purpose: it makes no model call, and an import from `@/lib/ai/` marks a file as one that does
 * (`check-llm-json-parse`), which would put a component's unrelated `JSON.parse` of storage under a
 * rule about model output. The constants live here and the server
 * module re-exports them, so the code and the sentence are written once.
 */

export const AI_PAUSED_CODE = 'ai_paused'
export const AI_PAUSED_MESSAGE = 'AI features are paused right now. Nothing you did caused this, and retrying will not help.'

/** The sentence to show when a response (already parsed) is the paused notice, else null. */
export function aiPausedMessage(status: number, body: unknown): string | null {
  if (status !== 503 || typeof body !== 'object' || body === null) return null
  const { code, error } = body as { code?: unknown; error?: unknown }
  return code === AI_PAUSED_CODE ? (typeof error === 'string' && error ? error : AI_PAUSED_MESSAGE) : null
}

/** For a response whose body is still unread: reads a clone, so the caller's own read still works. */
export async function readAiPausedMessage(res: Response): Promise<string | null> {
  if (res.status !== 503) return null
  return aiPausedMessage(res.status, await res.clone().json().catch(() => null))
}

/**
 * For a library that throws on a non-ok response with the body text as the message (`useChat`
 * does), so the notice arrives as a JSON string inside an Error.
 */
export function aiPausedMessageFromError(err: unknown): string | null {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (!text.includes(AI_PAUSED_CODE)) return null
  try { return aiPausedMessage(503, JSON.parse(text)) } catch { return null }
}
