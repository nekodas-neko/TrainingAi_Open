import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../..')
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))
const squash = (s: string) => s.replace(/\s+/g, ' ')

/**
 * #3392 items 1 and 2. The helpers (`withLiveTodayActivity`, `carriedVsNormal`) have their own
 * tests, but reverting the call in a component failed none of them: the Activity trend lost its
 * point for today, and a morning-sheet save wrote null over Home's Better / Same / Worse answer.
 * There is no component renderer in this repo, so these read the component's code (comments
 * stripped) for the call and for where its result goes.
 */
describe('Activity detail: today’s live score reaches the trend (#2435, #3390)', () => {
  it('current app: the sparkline is fed the live-today trend, not the stored one', () => {
    const src = squash(code('components/health/health-score-detail.tsx'))
    expect(src).toMatch(/const sparkTrends = trends\?\.trends && trendField === "activityScore" && score != null \? withLiveTodayActivity\(trends\.trends, today, score\) : trends\?\.trends/)
    expect(src).toContain('<TrendSparkline trends={sparkTrends}')
  })

  it('Preview: the chart points come from the live-today trend, not the stored one', () => {
    const src = squash(code('mobile/src/features/health/screens/HealthDetailScreen.tsx'))
    expect(src).toMatch(/const scoreTrends = trends\.data && trendField === 'activityScore' \? withLiveTodayActivity\(trends\.data\.trends, health\.today, score\) : trends\.data\?\.trends/)
    expect(src).toContain('points={scoreTrends!.map(')
  })
})

describe('Morning check-in sheet: Home’s comparison answer survives a save (#3334, #3390)', () => {
  it('current app: the saved row is read at save time and its vsNormal is spread into the payload', () => {
    const src = squash(code('components/morning-checkin-sheet.tsx'))
    const read = src.indexOf('const saved = await readSaved(date)')
    const payload = src.indexOf("const payload = { phase: 'morning' as const,")
    const carry = src.indexOf('...carriedVsNormal(saved)')
    expect(read, 'saved is read before the payload is built').toBeGreaterThan(-1)
    expect(payload).toBeGreaterThan(read)
    expect(carry, 'the spread is inside the payload').toBeGreaterThan(payload)
    // Nothing else may set vsNormal in the payload after the carry (it would write over the answer).
    const payloadBody = src.slice(payload, src.indexOf('try {', payload))
    expect(payloadBody.match(/vsNormal\s*:/g) ?? []).toEqual([])
  })
})
