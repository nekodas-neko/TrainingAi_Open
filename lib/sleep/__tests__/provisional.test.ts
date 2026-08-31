// BF-83: the same night read 6 h 15 m at 6:44 and 7 h 40 m at 6:48, and nothing marked the first
// reading as unfinished. These pin the definition of "unfinished" — see lib/sleep/provisional.ts
// for why it is measured against the rollup's reach and not the raw table's.
import { describe, it, expect } from 'vitest'
import {
  isNightProvisional,
  PROVISIONAL_COVERAGE_MARGIN_MS,
} from '@/lib/sleep/provisional'
import { DEFAULT_EPOCH_DS, DEFAULT_MAX_BRIDGE_GAP_EPOCHS } from '@/lib/sleep/sensing-span'

const WAKE = Date.parse('2026-09-01T20:08:00.000Z')
const MIN = 60_000

describe('isNightProvisional', () => {
  // Not a restatement of the expression: the point is that the margin IS the sensing-span bridge
  // gap, so a change to one that forgot the other would fail here rather than silently start
  // calling still-growing nights final.
  it('is the sensing-span bridge gap, in milliseconds', () => {
    expect(PROVISIONAL_COVERAGE_MARGIN_MS).toBe(DEFAULT_MAX_BRIDGE_GAP_EPOCHS * DEFAULT_EPOCH_DS * 100)
    expect(PROVISIONAL_COVERAGE_MARGIN_MS).toBe(60 * MIN)
  })

  it('a night the rollup has only reached the end of is still filling', () => {
    expect(isNightProvisional(WAKE, WAKE)).toBe(true)
  })

  // The 6:44 reading: the row ended at 4:46 because that is as far as the derivation had got.
  it('a night whose derived end sits at the coverage edge is provisional', () => {
    const truncatedEnd = WAKE - 82 * MIN
    expect(isNightProvisional(truncatedEnd, truncatedEnd)).toBe(true)
  })

  it('stays provisional until coverage clears the bridge gap', () => {
    expect(isNightProvisional(WAKE, WAKE + 59 * MIN)).toBe(true)
    expect(isNightProvisional(WAKE, WAKE + 60 * MIN)).toBe(false)
    expect(isNightProvisional(WAKE, WAKE + 61 * MIN)).toBe(false)
  })

  it('a night from weeks ago is final', () => {
    expect(isNightProvisional(WAKE - 30 * 24 * 60 * MIN, WAKE)).toBe(false)
  })

  // Coverage BEHIND the night's end is not a contradiction to resolve — a manual or Health Connect
  // row can be written for a night the ring never saw. It is further from settled, not closer.
  it('coverage behind the night is provisional, not final', () => {
    expect(isNightProvisional(WAKE, WAKE - 3 * 60 * MIN)).toBe(true)
  })

  // No usable watermark is "we cannot tell", and badging every historical night as still-filling
  // would be a worse answer than saying nothing.
  it('no coverage at all resolves to final', () => {
    expect(isNightProvisional(WAKE, null)).toBe(false)
  })
})
