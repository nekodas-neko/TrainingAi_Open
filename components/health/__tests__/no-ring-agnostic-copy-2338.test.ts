import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HR_SOURCES, noHrDataCopy, type NoHrDataContext } from '../hr-source-copy'
import { hrEmptyMessage } from '@trainingai/shared/workout/hr-session-state'

const CONTEXTS: NoHrDataContext[] = ['workout', 'window', 'range', 'day']
const root = join(__dirname, '..', '..', '..')
const src = (p: string) => readFileSync(join(root, p), 'utf8')

// #2338 — an empty state must not tell someone to wear a ring they do not own.
describe('heart-rate empty states do not assume a ring', () => {
  it('a user with nothing connected is told what they CAN connect', () => {
    expect(HR_SOURCES).toMatch(/ring/)
    expect(HR_SOURCES).toMatch(/chest strap/)
    expect(HR_SOURCES).toMatch(/Health Connect/)
    for (const c of CONTEXTS) expect(noHrDataCopy(false, c)).toContain(HR_SOURCES)
  })

  // A ring, a strap-only and a Health-Connect-only user all have `hasHrSource === true`: the one
  // definition says "something recorded", not which device, so all three get the same neutral line
  // — one that is true and actionable for each, and names no device the others do not own.
  it('a user with a ring, a strap only, or Health Connect only gets neutral wording', () => {
    for (const c of CONTEXTS) {
      const text = noHrDataCopy(true, c)
      expect(text).not.toContain(HR_SOURCES)
      expect(text).not.toMatch(/wear (your|the) (ring|strap)/i)
      expect(text).not.toMatch(/connect/i)
    }
  })

  it('an unknown source (failed read, older cached payload) is never told to connect one', () => {
    for (const c of CONTEXTS) {
      expect(noHrDataCopy(null, c)).toBe(noHrDataCopy(true, c))
      expect(noHrDataCopy(undefined, c)).toBe(noHrDataCopy(true, c))
    }
  })

  it('keeps each surface\'s wording distinct where the surface differs', () => {
    expect(noHrDataCopy(true, 'window')).toMatch(/in this window/)
    expect(noHrDataCopy(true, 'range')).toMatch(/Still learning your range/)
    expect(noHrDataCopy(true, 'day')).toMatch(/today/)
  })

  it('the workout recovery empty state names no device', () => {
    expect(hrEmptyMessage('none')).toBe('No HR data for this workout yet')
  })
})

describe('no ring-only instruction is left on the surfaces #2338 named', () => {
  const surfaces = [
    'components/cardio/heart-profile-card.tsx',
    'components/cardio/trends-section.tsx',
    'components/cardio/zone-quota-card.tsx',
    'components/health/time-in-zone-card.tsx',
    'components/health/observed-hr-card.tsx',
    'components/health/hr-day-card.tsx',
    'components/workout/hr-recovery-chart.tsx',
    'app/health/heart-rate/page.tsx',
    'app/health/sleep/sleep-content.tsx',
  ]
  it.each(surfaces)('%s does not tell the reader to wear or sync a ring', (file) => {
    const text = src(file)
    expect(text).not.toMatch(/wear (your|the) ring/i)
    expect(text).not.toMatch(/once your ring syncs/i)
    expect(text).not.toMatch(/ring records periodically/i)
  })

  it('the sleep-stage empty state names where stages come from', () => {
    expect(src('app/health/sleep/sleep-content.tsx')).toContain('stages come from a ring or Health Connect')
  })

  it('the hrv-volume insight does not require a ring', () => {
    const route = src('app/api/health-trends/route.ts')
    expect(route).toContain('Log workouts on days with recorded sleep to unlock this.')
    expect(route).not.toContain('the ring recorded your sleep')
  })
})
