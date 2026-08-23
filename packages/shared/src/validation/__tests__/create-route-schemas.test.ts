// Q-484: the create routes had no schema while their PATCH siblings had complete ones — same table,
// same fields. Measured before the fix:
//
//   POST /api/injuries     muscleName 200,002 + notes 500,000  →  201, both stored in full
//   POST /api/injuries     notes 10,000,000 (a 10 MB body)     →  201, 10,000,000 stored
//   POST /api/supplements  name 300,002 + dose 100,000         →  201, both stored in full
//   POST /api/injuries     {"startedDate":"not-a-date"}        →  500
//
// These pin that create and patch now share ONE definition, so the pair cannot drift back apart —
// which is the actual failure here, not any single missing bound.
import { describe, it, expect } from 'vitest'
import { InjuryCreateSchema, InjuryPatchSchema } from '../injury'
import { SupplementCreateSchema, SupplementPatchSchema } from '../supplement'

describe('InjuryCreateSchema', () => {
  it('accepts an ordinary injury', () => {
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild', notes: 'tight' }).success).toBe(true)
  })

  it('rejects the measured oversized payloads', () => {
    expect(InjuryCreateSchema.safeParse({ muscleName: 'x'.repeat(200_002), severity: 'mild' }).success).toBe(false)
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild', notes: 'y'.repeat(500_000) }).success).toBe(false)
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild', notes: 'z'.repeat(10_000_000) }).success).toBe(false)
  })

  it('rejects the startedDate that used to 500 rather than 400', () => {
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild', startedDate: 'not-a-date' }).success).toBe(false)
  })

  // The client's localDateString() emits YYYY/MM/DD. A dash-only regex rejects every such request
  // with a Zod error before the handler runs — which is invisible until some client fills the field
  // from that helper, and is how it bit ai-chat's localDate for a full release.
  it('accepts BOTH separators, because localDateString() emits slashes', () => {
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild', startedDate: '2026-08-09' }).success).toBe(true)
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild', startedDate: '2026/08/09' }).success).toBe(true)
    expect(InjuryPatchSchema.safeParse({ startedDate: '2026/08/09' }).success).toBe(true)
    expect(InjuryPatchSchema.safeParse({ resolvedDate: '2026/08/09' }).success).toBe(true)
  })

  it('requires what the row cannot be written without', () => {
    expect(InjuryCreateSchema.safeParse({ severity: 'mild' }).success).toBe(false)
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf' }).success).toBe(false)
    expect(InjuryCreateSchema.safeParse({ muscleName: '', severity: 'mild' }).success).toBe(false)
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'catastrophic' }).success).toBe(false)
  })

  it('is strict — an unknown key is a rejection, not a silent drop (Q-464)', () => {
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild', userId: 'someone-else' }).success).toBe(false)
  })

  it('leaves startedDate optional, because the route defaults it to today in the user tz', () => {
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild' }).success).toBe(true)
  })
})

describe('SupplementCreateSchema', () => {
  it('accepts an ordinary supplement and rejects the measured oversized one', () => {
    expect(SupplementCreateSchema.safeParse({ name: 'Creatine', dose: '5g' }).success).toBe(true)
    expect(SupplementCreateSchema.safeParse({ name: 'n'.repeat(300_002) }).success).toBe(false)
    expect(SupplementCreateSchema.safeParse({ name: 'Creatine', dose: 'd'.repeat(100_000) }).success).toBe(false)
  })

  it('requires a non-empty name and is strict', () => {
    expect(SupplementCreateSchema.safeParse({}).success).toBe(false)
    expect(SupplementCreateSchema.safeParse({ name: '' }).success).toBe(false)
    expect(SupplementCreateSchema.safeParse({ name: 'Creatine', deletedAt: 'now' }).success).toBe(false)
  })
})

// The point of extracting these was that create and patch stop being able to disagree. If someone
// widens one bound, these fail unless they widen the other — which is the whole reason the pair
// drifted in the first place.
describe('create and patch share their bounds', () => {
  it.each([
    ['muscleName', 'x'.repeat(101)],
    ['notes', 'y'.repeat(1001)],
  ])('injuries: %s is refused by BOTH', (field, value) => {
    expect(InjuryCreateSchema.safeParse({ muscleName: 'calf', severity: 'mild', [field]: value }).success).toBe(false)
    expect(InjuryPatchSchema.safeParse({ [field]: value }).success).toBe(false)
  })

  it.each([
    ['name', 'n'.repeat(201)],
    ['dose', 'd'.repeat(201)],
  ])('supplements: %s is refused by BOTH', (field, value) => {
    expect(SupplementCreateSchema.safeParse({ name: 'Creatine', [field]: value }).success).toBe(false)
    expect(SupplementPatchSchema.safeParse({ [field]: value }).success).toBe(false)
  })

  it('the largest value each still accepts is the same on both', () => {
    expect(InjuryCreateSchema.safeParse({ muscleName: 'x'.repeat(100), severity: 'mild' }).success).toBe(true)
    expect(InjuryPatchSchema.safeParse({ muscleName: 'x'.repeat(100) }).success).toBe(true)
    expect(SupplementCreateSchema.safeParse({ name: 'n'.repeat(200) }).success).toBe(true)
    expect(SupplementPatchSchema.safeParse({ name: 'n'.repeat(200) }).success).toBe(true)
  })
})
