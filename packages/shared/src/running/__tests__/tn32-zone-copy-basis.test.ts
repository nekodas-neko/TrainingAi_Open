// TN-32 — what a run's rationale says about its zone must use the engine's basis. The engine's
// Karvonen bands are fractions of heart-rate RESERVE, and the 4×4 prose promised "85–95% max HR":
// about 20 bpm off what it actually prescribed. No framework rationale may state a %-of-max figure.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { HR_ZONE_META } from '../../health/hr-zones'

const dir = join(process.cwd(), 'packages/shared/src/running/frameworks')

describe('zone copy uses the engine basis (TN-32)', () => {
  it('no framework rationale quotes a percentage of max heart rate', () => {
    const offenders = readdirSync(dir).filter(f => f.endsWith('.ts')).flatMap(f =>
      [...readFileSync(join(dir, f), 'utf8').matchAll(/rationale = '([^']*)'/g)]
        .map(m => m[1]).filter(r => /%\s*(max HR|HRmax|of max)/i.test(r)).map(r => `${f}: ${r.slice(0, 60)}`))
    expect(offenders).toEqual([])
  })

  it('zone names come from the one zone table', () => {
    const src = readFileSync(join(process.cwd(), 'packages/shared/src/health/session-picker.ts'), 'utf8')
    expect(src).not.toMatch(/'Recovery',\s*2:\s*'Light'/)
    expect(HR_ZONE_META.map(z => z.name)).toContain('Light')
  })
})
