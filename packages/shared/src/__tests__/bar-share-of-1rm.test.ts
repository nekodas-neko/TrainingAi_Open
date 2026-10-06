import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { barShareOfOneRm } from '../1rm'

describe('barShareOfOneRm — #2378', () => {
  it('reports what the rounded bar is, not what was prescribed', () => {
    // Skull Crusher, 2026-10-06: 36.5 × 70.5 % = 25.7 kg, rounded up to 27.5 kg.
    expect(barShareOfOneRm(27.5, 36.5)).toBe(75.3)
  })

  it('rounds to one decimal', () => {
    expect(barShareOfOneRm(100, 120)).toBe(83.3)
    expect(barShareOfOneRm(60, 100)).toBe(60)
  })

  it('returns null when there is nothing to divide', () => {
    expect(barShareOfOneRm(null, 100)).toBeNull()
    expect(barShareOfOneRm(60, null)).toBeNull()
    expect(barShareOfOneRm(60, undefined)).toBeNull()
    expect(barShareOfOneRm(0, 100)).toBeNull()
    expect(barShareOfOneRm(60, 0)).toBeNull()
    expect(barShareOfOneRm(Number.NaN, 100)).toBeNull()
  })
})

describe('the workout card prints the bar share, not the prescription — #2378', () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')
  const screen = read('components/workout/active-workout-screen.tsx')
  const setCard = read('components/workout/active-set-card.tsx')

  it('no longer prints a progressionStyle pct directly as "% of 1RM" or in a Set row', () => {
    expect(screen).not.toMatch(/\{exercise\.progressionStyle\[0\]\.pct\}% of 1RM/)
    expect(screen).not.toMatch(/Set \{i \+ 1\} \(\{s\.pct\}%\)/)
    expect(screen).toMatch(/barShareOfOneRm\(workingWeight, exercise\.estimated1rm\)/)
    expect(screen).toMatch(/barShareOfOneRm\(w, exercise\.estimated1rm\)/)
  })

  it('the live set card takes the share of the weight it is showing', () => {
    expect(setCard).toMatch(/barShareOfOneRm\(weight, oneRm\)/)
    expect(setCard).toMatch(/intensityPct=\{shownPct\}/)
  })
})
