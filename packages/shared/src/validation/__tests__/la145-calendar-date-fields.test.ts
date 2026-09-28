// LA-145 — a date field whose regex checks the SHAPE accepts `2026-02-31`, which then fails at the
// driver (`22008`) as a bodiless 500. These shared schemas now also require a real day.
import { describe, it, expect } from 'vitest'
import { InjuryCreateSchema, InjuryPatchSchema } from '@trainingai/shared/validation/injury'
import { SupplementCreateSchema } from '@trainingai/shared/validation/supplement'

const impossible = ['2026-02-31', '2026/02/30', '2026-13-01', '2026-00-10']
const real = ['2026-02-28', '2026/02/28', '2024-02-29']

type Field = { safeParse: (v: unknown) => { success: boolean } }
const fields: [string, Field][] = [
  ['injury startedDate', InjuryCreateSchema.shape.startedDate as unknown as Field],
  ['injury resolvedDate', InjuryPatchSchema.shape.resolvedDate as unknown as Field],
  ['supplement startedOn', SupplementCreateSchema.shape.startedOn as unknown as Field],
  ['supplement stoppedOn', SupplementCreateSchema.shape.stoppedOn as unknown as Field],
]

describe('shared date fields require a real calendar day (LA-145)', () => {
  it.each(fields)('%s refuses an impossible day and keeps accepting real ones', (_name, field) => {
    for (const d of impossible) expect(field.safeParse(d).success, d).toBe(false)
    for (const d of real) expect(field.safeParse(d).success, d).toBe(true)
  })
})
