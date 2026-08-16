import { describe, it, expect } from 'vitest'
import { KNOWN_STYLES, GOAL_STYLE_RULES } from '../known-styles'

function styleShape(name: string) {
  const s = KNOWN_STYLES.find(k => k.name === name)
  if (!s) throw new Error(`unknown style ${name}`)
  return { sets: s.sets.length, reps: s.sets[0].reps, restSec: s.sets[0].restSec }
}

describe('GOAL_STYLE_RULES', () => {
  it('every referenced style exists in KNOWN_STYLES', () => {
    for (const rule of Object.values(GOAL_STYLE_RULES)) {
      for (const name of [rule.primary, rule.secondary, rule.accessory]) {
        expect(KNOWN_STYLES.some(s => s.name === name), `${name} missing`).toBe(true)
      }
    }
  })

  it('powerbuilding uses one heavy anchor + moderate secondary volume', () => {
    const r = GOAL_STYLE_RULES.powerbuilding
    // Primary is the heavy anchor (4×6), secondary is deliberately MODERATE (higher reps, not 6),
    // so a session doesn't stack multiple near-max compounds.
    expect(styleShape(r.primary).reps).toBe(6)
    expect(styleShape(r.secondary).reps).toBeGreaterThan(6)
    expect(r.secondary).not.toBe(r.primary)
    // Accessories stay lightest of the three.
    expect(styleShape(r.accessory).reps).toBeGreaterThanOrEqual(styleShape(r.secondary).reps)
  })
})
