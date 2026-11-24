// The count script's character class is generated from the predicate's own regex (#4134 review): the
// committed SQL must equal what the generator prints now.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { invisibleNameRanges, hasVisibleCharacter } from '@trainingai/shared/validation/visible-name'
import { renderSql } from '../../../../../scripts/tuning/blank-exercise-names-4129.mjs'

describe('scripts/tuning/blank-exercise-names-4129.sql', () => {
  it('equals the generated one (run: node scripts/tuning/blank-exercise-names-4129.mjs --write)', () => {
    const committed = readFileSync(join(process.cwd(), 'scripts/tuning/blank-exercise-names-4129.sql'), 'utf8')
    expect(committed).toBe(renderSql())
  })
  it('stays read-only and counts only', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts/tuning/blank-exercise-names-4129.sql'), 'utf8')
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b\s/i)
    expect(sql).not.toMatch(/select\s+(l\.name|e\.exercise_name)/i)
  })
  it('its ranges cover exactly the code points the predicate refuses', () => {
    const inRanges = (cp: number) => invisibleNameRanges().some(([a, b]) => cp >= a && cp <= b)
    for (const cp of [0x17b4, 0x180b, 0x2800, 0x3164, 0x200b, 0x13430, 0xe0100]) expect(inRanges(cp)).toBe(true)
    for (const cp of [0x41, 0x1780, 0x1820, 0x1f4aa, 0xac00]) expect(inRanges(cp)).toBe(false)
    expect(hasVisibleCharacter(String.fromCodePoint(0x41))).toBe(true)
  })
})
