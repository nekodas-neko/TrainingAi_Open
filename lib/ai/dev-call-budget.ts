/**
 * #2816 — a hard cap on live Gemini requests made anywhere but production.
 *
 * Every Gemini key we hold, on Railway and on agents' machines, draws on ONE prepaid Google balance,
 * and when it reaches $0 Google stops every key at once. On 2026-10-11 agents testing the Coach on
 * `pnpm dev` (#2793, #2796) made ~460 `gemini-3.6-flash` requests and ~3.8M input tokens, which
 * emptied it, and every AI feature in the live app failed (#2815, #2814). The owner chose to keep the
 * one key and make testing safer instead, so this fuse sits at the chokepoint every call passes:
 * `withAiLogging` and `loggedStreamText` in `instrument.ts`, plus the direct `@google/genai` calls in
 * `lib/exercise-image-gen.ts`.
 *
 * It counts model REQUESTS, not logical calls: a retry is a request, and so is each step of a Coach
 * turn. The rules for agents are in `docs/rules/ai-security-and-integrations.md`.
 *
 * A dev fuse, not a security control. It fails open — an unreadable or unwritable store never blocks
 * a call — and it is off in production by two independent signals, so it can never cap real users.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

export const DEFAULT_DEV_AI_CALL_LIMIT = 100

// A rolling window because this caps a RATE. It is not a user-facing date window, so the
// local-midnight rule in docs/rules/dates-and-timezones.md does not apply.
const WINDOW_MS = 24 * 60 * 60 * 1000

type Env = Record<string, string | undefined>

/**
 * Off in production and in the unit-test suite, on everywhere else: `pnpm dev`
 * (`NODE_ENV=development`) and plain node scripts (`NODE_ENV` unset).
 *
 * The one exception inside vitest is `RUN_LIVE_AI_TESTS=1`, the opt-in that makes the `*.live.test.ts`
 * files call the real model — that run spends the same balance as a dev server does.
 */
export function devAiBudgetActive(env: Env = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  if (env.NODE_ENV === 'test' && env.RUN_LIVE_AI_TESTS !== '1') return false
  // Belt and braces: Railway sets these on the live app, so a misconfigured NODE_ENV there still
  // cannot cap real users.
  if (env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT_ID) return false
  return true
}

/** `AI_DEV_DAILY_CALL_LIMIT`, or the default. `0` is valid: no live calls at all, mocks only. */
export function devAiCallLimit(env: Env = process.env): number {
  const raw = env.AI_DEV_DAILY_CALL_LIMIT?.trim()
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_DEV_AI_CALL_LIMIT
  return Number(raw)
}

function storePath(env: Env): string {
  return env.AI_DEV_CALL_LOG_PATH?.trim() || path.join(os.tmpdir(), 'trainingai-dev-ai-calls.json')
}

// Call timestamps (epoch ms) inside the window. A missing or corrupt file reads as empty.
function readCalls(env: Env, now: number): number[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(storePath(env), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > now - WINDOW_MS && t <= now)
  } catch {
    return []
  }
}

// Best effort: a dev fuse fails open, so a write failure never throws into the AI call.
function writeCalls(env: Env, calls: number[]): void {
  try {
    const file = storePath(env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(calls))
  } catch {
    // not a security control — an unwritable store just stops counting
  }
}

export class DevAiBudgetError extends Error {
  readonly used: number
  readonly limit: number
  constructor(used: number, limit: number) {
    super(
      `Live AI call limit reached: ${used} model requests in the last 24 hours, limit ${limit} ` +
        '(AI_DEV_DAILY_CALL_LIMIT). This machine uses the same Gemini key and prepaid balance as the ' +
        'live app, and an empty balance stops AI for every user. Use mocks for logic; read ' +
        'docs/rules/ai-security-and-integrations.md before raising the limit.',
    )
    this.name = 'DevAiBudgetError'
    this.used = used
    this.limit = limit
  }
}

/** Throws {@link DevAiBudgetError} when the window is already full. Records nothing. */
export function assertDevAiBudget(env: Env = process.env, now: number = Date.now()): void {
  if (!devAiBudgetActive(env)) return
  const limit = devAiCallLimit(env)
  const used = readCalls(env, now).length
  if (used >= limit) throw new DevAiBudgetError(used, limit)
}

/** Counts one model request. Never throws. */
export function recordDevAiCall(env: Env = process.env, now: number = Date.now()): void {
  if (!devAiBudgetActive(env)) return
  writeCalls(env, [...readCalls(env, now), now])
}

/** Check, then count — for a single request made up front. */
export function takeDevAiCall(env: Env = process.env, now: number = Date.now()): void {
  assertDevAiBudget(env, now)
  recordDevAiCall(env, now)
}
