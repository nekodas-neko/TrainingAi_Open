import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MoodFieldsSchema } from '@trainingai/shared/validation/mood-log'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * LB-116 — the check-in sheet knew which sore ticks it had suggested and threw it away.
 *
 * BF-173 shipped the engine: `mood_logs.suggested_sore_muscles`, the repository write, and a scorer
 * that clamps only ticks NOT in that list. `saveMoodLog` derives the list when a caller sends none,
 * so the feature was not inert — but the derivation cannot tell a muscle the lifter volunteered from
 * one it would have suggested anyway, and for a queued offline check-in it runs hours later against
 * a recovery feed that has moved on. The sheet knows exactly what it drew.
 */
describe('LB-116 — the sheet sends the provenance it already has', () => {
  const sheet = code('components/mood-checkin-sheet.tsx')

  it('puts it on leanPayload, which is what reaches all three writes', () => {
    // `leanPayload` is spread into `store.upsertMoodLog`, `store.queueMutation` and the
    // `/api/mood` fallback POST — so one field covers the local store, the outbox and the server.
    expect(sheet).toContain('suggestedSoreMuscles: suggested')
    const payloadAt = sheet.indexOf('const leanPayload')
    const fieldAt = sheet.indexOf('suggestedSoreMuscles: suggested')
    expect(fieldAt, 'the field must be inside leanPayload, not only on the optimistic log')
      .toBeGreaterThan(payloadAt)
    expect(fieldAt).toBeLessThan(sheet.indexOf('const log: MoodLog'))
  })

  it('sends the list the sheet actually drew its pills from', () => {
    // `suggested` is the same state the pills render from, so provenance cannot drift from the UI.
    expect(sheet).toMatch(/const \[suggested, setSuggested\]\s*=\s*useState<string\[\]>/)
    expect(sheet).toContain('suggested={suggested}')
  })

  it('and the optimistic log carries it too, so the card does not flash a different shape', () => {
    expect(sheet.slice(sheet.indexOf('const log: MoodLog'))).toContain('suggestedSoreMuscles: suggested')
  })
})

describe('LB-116 — the validation schema accepts it', () => {
  it('keeps the field instead of stripping it', () => {
    // The schema has no `.strict()`, so an unknown key is DROPPED rather than rejected: without this
    // entry the sheet's value would vanish silently on both the route and the outbox branch.
    const parsed = MoodFieldsSchema.parse({
      energyLevel: 'ok',
      soreMuscles: ['quads', 'chest'],
      suggestedSoreMuscles: ['quads'],
    })
    expect(parsed.suggestedSoreMuscles).toEqual(['quads'])
  })

  it('stays optional, so an older client still validates', () => {
    // `saveMoodLog` derives the list when it is absent. That fallback has to keep working.
    const parsed = MoodFieldsSchema.parse({ energyLevel: 'ok', soreMuscles: ['quads'] })
    expect(parsed.suggestedSoreMuscles).toBeUndefined()
  })

  it('bounds it like its sibling, rather than accepting an unbounded array', () => {
    expect(() => MoodFieldsSchema.parse({
      energyLevel: 'ok', suggestedSoreMuscles: Array(31).fill('quads'),
    })).toThrow()
    expect(() => MoodFieldsSchema.parse({
      energyLevel: 'ok', suggestedSoreMuscles: ['x'.repeat(41)],
    })).toThrow()
  })
})
