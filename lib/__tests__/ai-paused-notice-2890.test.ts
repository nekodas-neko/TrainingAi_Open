import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({}),
  getRepositoryAsync: async () => ({ insertErrorEvent: async () => {} }),
}))

import {
  AI_PAUSED_CODE, AI_PAUSED_MESSAGE, aiPausedMessage, readAiPausedMessage, aiPausedMessageFromError,
} from '../ai-paused-notice'
import { aiPausedResponse } from '../ai/provider-paused'

const paused = () => new Response(JSON.stringify({ error: AI_PAUSED_MESSAGE, code: AI_PAUSED_CODE }), { status: 503 })

describe('aiPausedMessage — the sentence for a parsed response', () => {
  it('is the server sentence for a 503 carrying the code', () => {
    expect(aiPausedMessage(503, { code: AI_PAUSED_CODE, error: 'custom' })).toBe('custom')
  })

  it('falls back to the shared sentence when the body has no text', () => {
    expect(aiPausedMessage(503, { code: AI_PAUSED_CODE })).toBe(AI_PAUSED_MESSAGE)
  })

  it('is null for anything else, so a screen keeps its own failure text', () => {
    expect(aiPausedMessage(500, { code: AI_PAUSED_CODE })).toBeNull()
    expect(aiPausedMessage(503, { error: 'Service unavailable' })).toBeNull()
    expect(aiPausedMessage(503, null)).toBeNull()
    expect(aiPausedMessage(503, 'ai_paused')).toBeNull()
  })

  it('agrees with what the server actually sends', async () => {
    const res = aiPausedResponse(Object.assign(new Error('x'), { statusCode: 402 }))!
    expect(aiPausedMessage(res.status, await res.json())).toBe(AI_PAUSED_MESSAGE)
  })
})

describe('readAiPausedMessage — a response whose body is still unread', () => {
  it('reads the notice and leaves the body readable for the caller', async () => {
    const res = paused()
    expect(await readAiPausedMessage(res)).toBe(AI_PAUSED_MESSAGE)
    expect((await res.json()).code).toBe(AI_PAUSED_CODE)
  })

  it('is null for other failures and for a body that is not JSON', async () => {
    expect(await readAiPausedMessage(new Response('{"error":"x"}', { status: 500 }))).toBeNull()
    expect(await readAiPausedMessage(new Response('<html>', { status: 503 }))).toBeNull()
    expect(await readAiPausedMessage(new Response('', { status: 503 }))).toBeNull()
  })
})

describe('aiPausedMessageFromError — useChat throws the body text as the message', () => {
  it('finds the notice inside the error', () => {
    expect(aiPausedMessageFromError(new Error(JSON.stringify({ error: AI_PAUSED_MESSAGE, code: AI_PAUSED_CODE })))).toBe(AI_PAUSED_MESSAGE)
  })

  it('is null for every other error', () => {
    expect(aiPausedMessageFromError(new Error('Coach failed'))).toBeNull()
    expect(aiPausedMessageFromError(new Error(`not json ${AI_PAUSED_CODE}`))).toBeNull()
    expect(aiPausedMessageFromError(undefined)).toBeNull()
  })
})

/**
 * Discovery: every screen that calls an AI route has to say what a paused notice looks like there.
 * A new caller that neither reads the notice nor shows the server's own sentence reintroduces a
 * fixed "try again" toast for a dead balance.
 */
describe('every client caller of an AI route handles the paused notice', () => {
  const ROOT = path.resolve(__dirname, '../..')
  // A real `fetch` of the route itself: not `/api/coach/apply`, and not a path named in a comment.
  const AI_ROUTE = /fetch\(\s*['"`]\/api\/(nutrition\/scan|exercises\/generate|nutrition-goals\/recommend|generate-program|builder-chat|daily-digest|session-explain\/insight|nutrition\/meal-plans\/generate(?:\/meal)?)(?=[?'"`])/
  const walk = (dir: string): string[] =>
    readdirSync(dir).filter(n => !['node_modules', '__tests__', '__check_fixture__', 'api'].includes(n)).flatMap(n => {
      const p = path.join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
    })
  const callers = ['app', 'components', 'lib']
    .flatMap(d => walk(path.join(ROOT, d)))
    .filter(p => AI_ROUTE.test(stripComments(readFileSync(p, 'utf8'))))
    .map(p => path.relative(ROOT, p).replace(/\\/g, '/'))

  /** These show the server's own `error` sentence, which IS the paused sentence on a 503. */
  const SHOWS_SERVER_TEXT = new Set([
    'components/nutrition/capture-actions.tsx',
    'components/nutrition/end-of-day/meal-backfill-section.tsx',
    'components/workout-builder/builder-review.tsx',
    'components/workout-builder/builder-wizard.tsx',
    'components/nutrition/meal-plan-setup-sheet.tsx',
    'components/nutrition/meal-plan-review-step.tsx',
    'components/nutrition/meal-plan-edit-sheet.tsx',
  ])
  /** Per-row or per-outcome failure states with no sentence to put the notice in; tracked in issue 2890. */
  const KNOWN_GAPS = new Set([
    'components/nutrition/my-meals-picker.tsx',
    'components/nutrition/recipe-import-run.ts',
  ])

  it('Coach, which goes through useChat rather than fetch, reads the notice from the thrown error', () => {
    expect(readFileSync(path.join(ROOT, 'app/coach/coach-content.tsx'), 'utf8')).toMatch(/aiPausedMessageFromError\(error\)/)
  })

  it('finds the callers', () => {
    expect(callers.length).toBeGreaterThanOrEqual(15)
  })

  it.each(callers)('%s', rel => {
    const src = readFileSync(path.join(ROOT, rel), 'utf8')
    const reads = /@\/lib\/ai-paused-notice/.test(src)
    if (SHOWS_SERVER_TEXT.has(rel)) {
      expect(src, 'must still show the server error text').toMatch(/\.error\b/)
    } else if (KNOWN_GAPS.has(rel)) {
      expect(reads, 'now handled — remove it from KNOWN_GAPS').toBe(false)
    } else {
      expect(reads, 'import and use the paused-notice helpers, or add this file to SHOWS_SERVER_TEXT with the reason').toBe(true)
    }
  })
})
