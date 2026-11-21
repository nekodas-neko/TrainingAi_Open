import { createHash } from 'crypto'
import { generateText, generateObject, streamText } from 'ai'
import { google } from '@ai-sdk/google'
import { withAiRetry, isRetryableAiError, isRetryableObjectError } from './retry'
import { AI_CALL_BUDGET_MS, runWithDeadline } from './deadline'
import { assertDevAiBudget, recordDevAiCall } from './dev-call-budget'
import { noteAiBillingError } from './provider-paused'

// ── Call settings — one table, keyed by section ────────────────────────────────
// Which model, how hard it thinks, how many times the SDK retries and how long the call may run
// were once chosen by each route (`maxRetries: 0` was typed at ten call sites, the Coach set a
// thinking level inline). A route now names its SECTION and passes none of these: the wrapper reads
// them from here and hands them to the call.
//
// There is deliberately no temperature. Google's guidance for these models is to leave it at the
// default, and newer ones ignore it. A repeatable answer has to come from code deciding more.
//
// `retries` is the SDK's own `maxRetries`. Every object call is 0, because the one jittered retry
// lives in `withAiRetry` and a second layer would multiply with it (lib/ai/retry.ts). The Coach is
// the exception only by omission: it never set the option, so the SDK's default of 2 has always
// applied, and the table records that rather than changing it. `timeLimitMs` is the wall-clock
// budget for one logical call including its wrapper retry (lib/ai/deadline.ts); null means the
// wrapper sets none (a stream has no awaitable result, and the image tool has its own loop).
export const AI_MODEL_ID = 'gemini-3.1-flash-lite'

/**
 * AI Coach runs on a stronger model than everything else.
 *
 * Coach is the only route that chooses between tools and emits a typed patch against a real
 * program, and a malformed patch is a user-visible failure in a way a slightly worse insight is
 * not. Verified available on this key 2026-08-08 alongside `gemini-3.5-flash` and
 * `gemini-3.1-pro-preview`; 3.6-flash is **GA rather than preview**, which is the deciding factor
 * for the one route that writes.
 *
 * Deliberately a separate constant rather than moving `AI_MODEL_ID` — the other call sites stay on
 * flash-lite, so the blast radius of this change is one route.
 */
export const COACH_MODEL_ID = 'gemini-3.6-flash'

/** The admin exercise-picture tool's default image model (it may be asked for another one). */
export const IMAGE_MODEL_ID = 'gemini-3.1-flash-image-preview'

export type AiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export interface AiSectionSettings {
  readonly model: string
  /** null leaves the model's own default. */
  readonly thinking: AiThinkingLevel | null
  readonly retries: number
  readonly timeLimitMs: number | null
}

/** A structured-output call: flash-lite, model default thinking, no SDK retry, the shared budget. */
const OBJECT_CALL = {
  model: AI_MODEL_ID,
  thinking: null,
  retries: 0,
  timeLimitMs: AI_CALL_BUDGET_MS,
} as const satisfies AiSectionSettings

export const AI_SECTIONS = {
  prescription: OBJECT_CALL,
  'exercises-generate': OBJECT_CALL,
  'generate-program': OBJECT_CALL,
  'builder-chat': OBJECT_CALL,
  'meal-plan-generate': OBJECT_CALL,
  'meal-plan-generate-meal': OBJECT_CALL,
  'meal-plan-edit-meal': OBJECT_CALL,
  'meal-plan-top-up': OBJECT_CALL,
  'nutrition-scan': OBJECT_CALL,
  coach: { model: COACH_MODEL_ID, thinking: 'minimal', retries: 2, timeLimitMs: null },
  // Not a language-model call: `lib/exercise-image-gen.ts` reads `retries` as its extra attempts
  // and logs under this name. It is in the table so every call that spends the key has one entry.
  'exercise-image': { model: IMAGE_MODEL_ID, thinking: null, retries: 2, timeLimitMs: null },
} as const satisfies Record<string, AiSectionSettings>

export type AiSection = keyof typeof AI_SECTIONS

export function aiSectionSettings(section: AiSection): AiSectionSettings {
  // Own keys only: 'constructor', 'toString' and the like are on every object and are not sections.
  const settings = Object.hasOwn(AI_SECTIONS, section) ? (AI_SECTIONS as Record<string, AiSectionSettings>)[section] : undefined
  if (!settings) throw new Error(`No AI call settings for section "${section}" — add it to AI_SECTIONS in lib/ai/instrument.ts`)
  return settings
}

/** What the wrapper hands a call, to spread into the SDK options. */
export interface AiCallSettings {
  model: ReturnType<typeof google>
  maxRetries: number
  providerOptions?: { google: { thinkingConfig: { thinkingLevel: AiThinkingLevel } } }
}

export function aiCallSettings(section: AiSection): AiCallSettings {
  const s = aiSectionSettings(section)
  return {
    model: google(s.model),
    maxRetries: s.retries,
    ...(s.thinking && { providerOptions: { google: { thinkingConfig: { thinkingLevel: s.thinking } } } }),
  }
}

// ── Call metadata ───────────────────────────────────────────────────────────────
// `fingerprint` is the KEY INPUTS of the call (a date, sessionId, week key, …) —
// hashed with the section so double-trip detection can spot the same logical call
// firing twice. Pass ids/dates/keys only, never raw prompt text or health data.
export interface AiCallMeta {
  /** A key of {@link AI_SECTIONS}: the table decides the model, thinking, retries and time limit. */
  section: AiSection
  userId?: string | null
  // Q-296: what this call ASKED for. `ai_call_log.model` prefers what the provider says it
  // SERVED (`response.modelId`), so this is the fallback — it is what a failed call has, since a
  // call that threw has no response to read. Omit it and the default is assumed, which is what
  // made every Coach call read as flash-lite for the whole life of the column. Defaults to the
  // section's model in the table.
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

/**
 * `contentKey` for bytes: the same 8-hex key, over a photo rather than a string (#2195).
 *
 * The image scan fingerprinted on `{mode, imageKind, note}`, so two DIFFERENT photos with the same
 * (usually empty) note shared one fingerprint and the AI-usage double-trip metric read a second,
 * deliberate scan as a redundant repeat. A hash of the bytes tells them apart without storing
 * anything of the photo.
 */
export function bytesKey(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return ''
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8)
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

export function logAiCall(meta: AiCallMeta, opts: { usage?: unknown; latencyMs: number; ok: boolean; modelId?: string | null }): void {
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
        model: opts.modelId ?? meta.model ?? aiSectionSettings(meta.section).model,
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

/**
 * One attempt at the underlying SDK call.
 *
 * It takes the abort signal rather than closing over nothing (RV-70) so the attempt can be
 * cancelled when the budget runs out. A zero-argument thunk still satisfies this type, and
 * `runWithDeadline` bounds it either way — wiring the signal is what makes an abandoned call
 * actually stop, not what makes the ceiling hold.
 */
export type AiCall<T> = (signal: AbortSignal, settings: AiCallSettings) => Promise<T>

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
  fn: AiCall<T>,
  shouldRetry: (err: unknown) => boolean = isRetryableAiError,
  budgetMs: number = aiSectionSettings(meta.section).timeLimitMs ?? AI_CALL_BUDGET_MS,
): Promise<T> {
  // #2816. Off production only. Outside the try, so a refused call makes no request and is not
  // logged to `ai_call_log` as a failure; thrown before the retry loop, so it is never retried.
  assertDevAiBudget()
  const settings = aiCallSettings(meta.section)
  const started = Date.now()
  const deadlineAt = started + budgetMs
  try {
    // RV-70. The budget is TOTAL, so each attempt gets whatever is left rather than a fresh
    // ceiling, and `deadlineAt` stops a retry starting that could not finish inside it.
    const result = await withAiRetry(
      () => {
        // Each attempt is a billed request, the retry included.
        recordDevAiCall()
        return runWithDeadline(signal => fn(signal, settings), Math.max(0, deadlineAt - Date.now()))
      },
      { shouldRetry, deadlineAt },
    )
    logAiCall(meta, { usage: result.usage, modelId: responseModelId(result), latencyMs: Date.now() - started, ok: true })
    return result
  } catch (err) {
    logAiCall(meta, { latencyMs: Date.now() - started, ok: false })
    // Issue 2815. A billing refusal is not retried, so retry.ts never reports it.
    noteAiBillingError(err)
    throw err
  }
}

// generateObject convenience — defaults the retry policy to also re-roll on a
// schema-mismatch (NoObjectGeneratedError), matching the existing call sites.
export function loggedGenerateObject<T extends { usage?: unknown }>(
  meta: AiCallMeta,
  fn: AiCall<T>,
): Promise<T> {
  return withAiLogging(meta, fn, isRetryableObjectError)
}

// generateText convenience — plain transient-error retry.
export function loggedGenerateText<T extends { usage?: unknown }>(
  meta: AiCallMeta,
  fn: AiCall<T>,
): Promise<T> {
  return withAiLogging(meta, fn, isRetryableAiError)
}

// streamText chokepoint — streaming has no awaitable result, so usage is captured
// from the SDK's onFinish callback (and onError for failures). The caller's own
// onFinish/onError/onStepFinish, if any, still run.
type StreamTextParams = Parameters<typeof streamText>[0]
// The table owns these three, so a caller cannot pass them.
type StreamCallerParams = Omit<StreamTextParams, 'model' | 'maxRetries' | 'providerOptions'>
export function loggedStreamText(meta: AiCallMeta, callerParams: StreamCallerParams): ReturnType<typeof streamText> {
  const params = { ...callerParams, ...aiCallSettings(meta.section) } as StreamTextParams
  // #2816. One Coach turn is up to COACH_MAX_STEPS model requests, each counted as its step
  // finishes, so a turn started just under the limit can overshoot it by a few. Accepted: the
  // alternative is refusing a turn halfway through its tool calls.
  assertDevAiBudget()
  const started = Date.now()
  const callerOnFinish = params.onFinish
  const callerOnError = params.onError
  const callerOnStepFinish = params.onStepFinish
  const merged = {
    ...params,
    onStepFinish(ev: Parameters<NonNullable<StreamTextParams['onStepFinish']>>[0]) {
      recordDevAiCall()
      return callerOnStepFinish?.(ev)
    },
    onFinish(ev: Parameters<NonNullable<StreamTextParams['onFinish']>>[0]) {
      logAiCall(meta, { usage: ev.totalUsage ?? ev.usage, modelId: responseModelId(ev), latencyMs: Date.now() - started, ok: true })
      return callerOnFinish?.(ev)
    },
    onError(ev: Parameters<NonNullable<StreamTextParams['onError']>>[0]) {
      logAiCall(meta, { latencyMs: Date.now() - started, ok: false })
      noteAiBillingError(ev.error)
      return callerOnError?.(ev)
    },
  } as StreamTextParams
  return streamText(merged)
}

export { generateText, generateObject }
