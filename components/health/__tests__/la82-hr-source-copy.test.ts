import { describe, it, expect } from 'vitest'
import { maxHrSourceNote, restingHrSourceNote } from '../hr-source-copy'

describe('LA-82 — a stand-in must not read like a real measurement', () => {
  it('⛔ separates an age-UNREAD max from an ordinary age estimate', () => {
    // The defect: `=== "observed"` printed everything else as "age-estimated", so the generic 190
    // used when the age could not be read looked exactly like 220 − age. For this owner that moves
    // every zone boundary by 6 bpm.
    const unread = maxHrSourceNote('estimated-age-unread')
    const estimated = maxHrSourceNote('estimated')
    expect(unread.standIn).toBe(true)
    expect(estimated.standIn).toBe(false)
    expect(unread.label).not.toBe(estimated.label)
    expect(unread.detail).toBeTruthy()
    expect(estimated.detail).toBeUndefined()
  })

  it('leaves a recorded max unqualified', () => {
    const observed = maxHrSourceNote('observed')
    expect(observed).toEqual({ label: 'your recorded max', standIn: false })
  })

  it('⛔ tells "never measured" apart from "could not be read"', () => {
    // The entry is explicit that `'default'` still means "no readings", which is a different thing
    // to tell someone than a failed read — one is actionable, the other is transient.
    const none = restingHrSourceNote('default')!
    const failed = restingHrSourceNote('unavailable')!
    expect(none.detail).not.toBe(failed.detail)
    expect(none.detail).toMatch(/wear your ring/i)
    expect(failed.detail).toMatch(/couldn’t be read/i)
    expect([none.standIn, failed.standIn]).toEqual([true, true])
  })

  it('says nothing at all when the resting rate is genuinely measured', () => {
    expect(restingHrSourceNote('measured')).toBeNull()
  })

  it('degrades quietly on a payload cached before the route sent a source', () => {
    // Both fields are optional on the client types, so an older cached `cardio-week` must not be
    // described as a stand-in on the strength of an absent field.
    expect(maxHrSourceNote(undefined).standIn).toBe(false)
    expect(maxHrSourceNote(null).standIn).toBe(false)
    expect(restingHrSourceNote(undefined)).toBeNull()
    expect(restingHrSourceNote(null)).toBeNull()
  })

  it('every stand-in explains what it means for the zones', () => {
    for (const note of [maxHrSourceNote('estimated-age-unread'), restingHrSourceNote('unavailable')!]) {
      expect(note.detail, note.label).toMatch(/zone boundaries are approximate/)
    }
  })
})
