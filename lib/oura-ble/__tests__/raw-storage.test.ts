// Raw-storage tag whitelist (Oura data-culling, Sub-plan A Lever 2). The critical invariant: the
// drop-list must never intersect the tags the rollup consumes or any biometric tag — dropping one
// of those at ingest would be silent data loss.
import { describe, it, expect } from 'vitest'
import { RAW_STORAGE_DROP_TAGS, shouldDropRawTag, shouldDropRawEvent, isBatteryDebugEvent } from '../raw-storage'
// Imported, NOT hand-copied — the same list the adapter's rollup queries derive from, so this
// invariant can't silently fall behind the code as the rollup grows (review G-1).
import { ROLLUP_CONSUMED_TAGS, STEP_FEATURE_TAGS } from '../rollup-consumed-tags'
// Tags deliberately kept as archival (plausibly future-decodable) — must NOT be dropped.
const KEEP_ARCHIVAL_TAGS = [0x64, 0x68, 0x49, 0x4c, 0x4f, 0x58, 0x87, 0x88]

describe('RAW_STORAGE_DROP_TAGS (Lever 2)', () => {
  it('drops the pure telemetry/debug/state tags', () => {
    for (const tag of [0x42, 0x43, 0x45, 0x53, 0x56, 0x5b, 0x61, 0x79, 0x82, 0x83]) {
      expect(shouldDropRawTag(tag)).toBe(true)
    }
  })

  it('NEVER drops a tag the rollup consumes (no silent data loss)', () => {
    for (const tag of ROLLUP_CONSUMED_TAGS) {
      expect(RAW_STORAGE_DROP_TAGS.has(tag)).toBe(false)
    }
  })

  it('covers the gait step-feature tags 0x7e/0x7f (the G-1 gap) — never droppable', () => {
    for (const tag of STEP_FEATURE_TAGS) {
      expect(ROLLUP_CONSUMED_TAGS).toContain(tag)
      expect(shouldDropRawTag(tag)).toBe(false)
    }
  })

  it('the drop-set and the rollup-consumed set are disjoint (the whole invariant, set-wise)', () => {
    const intersection = ROLLUP_CONSUMED_TAGS.filter(t => RAW_STORAGE_DROP_TAGS.has(t))
    expect(intersection).toEqual([])
  })

  it('NEVER drops a kept-archival tag (raw PPG / sleep summaries / atlas)', () => {
    for (const tag of KEEP_ARCHIVAL_TAGS) {
      expect(shouldDropRawTag(tag)).toBe(false)
    }
  })
})

describe('shouldDropRawEvent — 0x61 subtype-aware battery keep (Lever 2 exception)', () => {
  it('KEEPS a 0x61 charging_time event (subtype 0x11)', () => {
    expect(shouldDropRawEvent(0x61, { kind: 'charging_time', charging_time: 5400 })).toBe(false)
    expect(isBatteryDebugEvent(0x61, { kind: 'charging_time' })).toBe(true)
  })
  it('KEEPS a 0x61 battery_level_changed event (subtype 0x24)', () => {
    expect(shouldDropRawEvent(0x61, { kind: 'battery_level_changed', battery_pct: 87 })).toBe(false)
  })
  it('still DROPS 0x61 ASCII debug text and other binary subtypes', () => {
    expect(shouldDropRawEvent(0x61, { ascii: 'boot ok' })).toBe(true)
    expect(shouldDropRawEvent(0x61, { kind: 'debug_data', subtype: 0x30 })).toBe(true)
    expect(shouldDropRawEvent(0x61, null)).toBe(true)
  })
  it('is identical to shouldDropRawTag for every non-0x61 tag', () => {
    for (const tag of [0x42, 0x43, 0x45, 0x53, 0x56, 0x5b, 0x79, 0x82, 0x83, 0x76, 0x46, 0x64]) {
      expect(shouldDropRawEvent(tag, null)).toBe(shouldDropRawTag(tag))
    }
  })
})
