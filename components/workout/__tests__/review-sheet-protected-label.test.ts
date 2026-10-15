import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// #2864. The Workout Review is rules-based (RV-204): a protected row was a drop the time-budget
// allocator proposed and a training guard kept. No model is involved, so the row must not say one was.
const source = readFileSync(join(__dirname, '..', 'review', 'workout-review-sheet.tsx'), 'utf8')

describe('workout review sheet: protected row label', () => {
  it('names the time budget, not an AI', () => {
    expect(source).toContain('Over your time budget, but kept to protect your training')
    expect(source).not.toMatch(/AI wanted/)
  })
})
