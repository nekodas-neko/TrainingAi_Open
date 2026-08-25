import { createHash } from 'crypto'
import { generateText, generateObject, streamText } from 'ai'
import { google } from '@ai-sdk/google'
import { withAiRetry, isRetryableAiError, isRetryableObjectError } from './retry'

// ── Model — single source of truth ─────────────────────────────────────────────
// Was inlined as `google('gemini-3.1-flash-lite')` at 14 call sites; centralised
// here so the model id lives in one place and the instrumentation below always
// knows which model was used.
export const AI_MODEL_ID = 'gemini-3.1-flash-lite'
export function aiModel() {
  return google(AI_MODEL_ID)
}

/**
 * AI Coach runs on a stronger model than everything else.
 *
 * Coach is the only route that chooses between tools and emits a typed patch against a real
 * program, and a malformed patch is a user-visible failure in a way a slightly worse insight is
 * not. Verified available on this key 2026-08-08 alongside `gemini-3.5-flash` and
 * `gemini-3.1-pro-preview`; 3.6-flash is **GA rather than preview**, which is the deciding factor
 * for the one route that writes.
 *
 * Deliberately a separate constant rather than moving `AI_MODEL_ID` — the other ~14 AI call sites
 * stay on flash-lite, so the blast radius of this change is one route.
 */
export const COACH_MODEL_ID = 'gemini-3.6-flash'

export function coachModel() {
  return google(COACH_MODEL_ID)
}

// ── Call metadata ───────────────────────────────────────────────────────────────
// `fingerprint` is the KEY INPUTS of the call (a date, sessionId, week key, …) —
// hashed with the section so double-trip detection can spot the same logical call
// firing twice. Pass ids/dates/keys only, never raw prompt text or health data.
export interface AiCallMeta {
  section: string
  userId?: string | null
  // Q-296: what this call ASKED for. `ai_call_log.model` prefers what the provider says it
  // SERVED (`response.modelId`), so this is the fallback — it is what a failed call has, since a
  // call that threw has no response to read. Omit it and the default is assumed, which is what
  // made every Coach call read as flash-lite for the whole life of the column.
  model?: string
  fingerprint?: unknown
  /**
   * The request payload this call carried, in bytes, for the shapes that have one (BF-4).
   *
   * `latencyMs` below is the MODEL's time. The leg the owner reported as slow — "taking the photo to
   * getting the result" — is mostly the one BEFORE it, and nothing measured it. Recording the size
   * beside the model's own latency is what lets the next report be answered by subtraction instead
   * of re-argued.
   *
   * Leave it undefined where a call has no payload; a 0 would read as "measured, and it was empty".
   */
  payloadBytes?: number | null
}

/**
 * Turn free text into a KEY, so it can enter a fingerprint without breaking the rule above.
 *
 * The rule exists because a fingerprint is a diagnostic, not a payload — but several calls are
 * distinguished only by their text inputs, and without them the double-trip metric reads a
 * deliberate repeat as a redundant one. Meal rerolls were the whole top row of the AI-usage screen
 * for exactly this reason (Q-471): three sections fingerprinted on a rounded calorie target alone,
 * so every reroll after the first looked like a double trip.
 *
 * Empty in, empty out — an absent optional input must not shift the key, or a call with no stores
 * configured would fingerprint differently from the same call with `stores: []`.
 */
export function contentKey(...parts: (string | number | null | undefined)[]): string {
  const joined = parts.filter(p => p != null && p !== '').join('\u0000')
  if (joined === '') return ''
  return createHash('sha256').update(joined).digest('hex').slice(0, 8)
}

// Deterministic hash of section + key inputs (16 hex chars). Object keys are
// sorted so `{a,b}` and `{b,a}` fingerprint identically.
export function aiFingerprint(section: string, input: unknown): string {
  return createHash('sha256').update(`${section}\0${stableStringify(input)}`).digest('hex').slice(0, 16)
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const obj = v as Record<string, unknown>
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

// ── Best-effort logging (fire-and-forget) ───────────────────────────────────────
// NEVER awaited on the hot path, NEVER throws — a logging failure must not fail or
// slow the AI call. Metadata only (tokens + fingerprint hash), no prompt bodies.
function readUsage(usage: unknown): { input: number | null; output: number | null; total: number | null; cached: number | null } {
  const u = usage as {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    inputTokenDetails?: { cacheReadTokens?: number }
    cachedInputTokens?: number
  } | null | undefined
  const input = u?.inputTokens ?? null
  const output = u?.outputTokens ?? null
  const total = u?.totalTokens ?? (input != null && output != null ? input + output : null)
  // Q-295. `inputTokenDetails.cacheReadTokens` is the current field; `cachedInputTokens` is the
  // SDK's own deprecated alias, read as a fallback so this keeps working whichever of the two a
  // given provider version populates. `??` and not `||` — a reported 0 is a cache MISS and must
  // survive as 0, where null means the provider said nothing at all.
  const cached = u?.inputTokenDetails?.cacheReadTokens ?? u?.cachedInputTokens ?? null
  return { input, output, total, cached }
}

function logAiCall(meta: AiCallMeta, opts: { usage?: unknown; latencyMs: number; ok: boolean; modelId?: string | null }): void {
  const { input, output, total, cached } = readUsage(opts.usage)
  const fingerprint = meta.fingerprint === undefined ? null : aiFingerprint(meta.section, meta.fingerprint)
  void (async () => {
    try {
      // Lazy import breaks a module-eval cycle (@/lib/data → adapter → … → this
      // module): a static import resolves getRepository as undefined at call time.
      const { getRepository } = await import('@/lib/data')
      const repo = await getRepository()
      await repo.insertAiCallLog({
        userId: meta.userId ?? null,
        section: meta.section,
        // Q-296: this was the constant `AI_MODEL_ID`, so the column recorded an assumption rather
        // than a measurement — 22 Coach calls made after COACH_MODEL_ID shipped all read as
        // flash-lite, and any cost or latency work split by model was reading a column that could
        // not disagree with it.
        model: opts.modelId ?? meta.model ?? AI_MODEL_ID,
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
        latencyMs: Math.round(opts.latencyMs),
        ok: opts.ok,
        fingerprint,
        payloadBytes: meta.payloadBytes ?? null,
        cachedInputTokens: cached,
      })
    } catch {
      // best-effort only — never surface a logging failure
    }
  })()
}

// ── The one chokepoint ──────────────────────────────────────────────────────────
// Wraps any generateText/generateObject call: runs it through the shared retry
// policy, times it, and logs usage on success/failure. Generic over the SDK
// result type so `.object`/`.text` type inference at the call site is preserved.
// What the provider says it actually served. Preferred over anything we asked for: a provider is
// free to route a request elsewhere, and that substitution is exactly what a model column exists to
// make visible.
function responseModelId(result: unknown): string | null {
  const id = (result as { response?: { modelId?: unknown } } | null)?.response?.modelId
  return typeof id === 'string' && id.length > 0 ? id : null
}

export async function withAiLogging<T extends { usage?: unknown }>(
  meta: AiCallMeta,
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean = isRetryableAiError,
): Promise<T> {
  const started = Date.now()
  try {
    const result = await withAiRetry(fn, { shouldRetry })
    logAiCall(meta, { usage: result.usage, modelId: responseModelId(result), latencyMs: Date.now() - started, ok: true })
    return result
  } catch (err) {
    logAiCall(meta, { latencyMs: Date.now() - started, ok: false })
    throw err
  }
}

// generateObject convenience — defaults the retry policy to also re-roll on a
// schema-mismatch (NoObjectGeneratedError), matching the existing call sites.
export function loggedGenerateObject<T extends { usage?: unknown }>(
  meta: AiCallMeta,
  fn: () => Promise<T>,
): Promise<T> {
  return withAiLogging(meta, fn, isRetryableObjectError)
}

// generateText convenience — plain transient-error retry.
export function loggedGenerateText<T extends { usage?: unknown }>(
  meta: AiCallMeta,
  fn: () => Promise<T>,
): Promise<T> {
  return withAiLogging(meta, fn, isRetryableAiError)
}

// streamText chokepoint — streaming has no awaitable result, so usage is captured
// from the SDK's onFinish callback (and onError for failures). The caller's own
// onFinish/onError, if any, still run.
type StreamTextParams = Parameters<typeof streamText>[0]
export function loggedStreamText(meta: AiCallMeta, params: StreamTextParams): ReturnType<typeof streamText> {
  const started = Date.now()
  const callerOnFinish = params.onFinish
  const callerOnError = params.onError
  const merged = {
    ...params,
    onFinish(ev: Parameters<NonNullable<StreamTextParams['onFinish']>>[0]) {
      logAiCall(meta, { usage: ev.totalUsage ?? ev.usage, modelId: responseModelId(ev), latencyMs: Date.now() - started, ok: true })
      return callerOnFinish?.(ev)
    },
    onError(ev: Parameters<NonNullable<StreamTextParams['onError']>>[0]) {
      logAiCall(meta, { latencyMs: Date.now() - started, ok: false })
      return callerOnError?.(ev)
    },
  } as StreamTextParams
  return streamText(merged)
}

export { generateText, generateObject }
