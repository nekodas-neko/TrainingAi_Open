// TN-66 — two surfaces presented a write-path default as the owner's own answer.
//
// `mood_logs.sleep_quality` is `NOT NULL`, the check-in stopped collecting it on 2026-06-25, and the
// write path defaults to `'ok'` so a queued mutation without it can still insert (#47). That default
// is load-bearing and stays. What had to go is reading it back as though someone said it: measured
// 2026-09-24, 93 of 108 rows carry the default, and every row since 2026-06-25 is `'ok'`.
//
// Source-level for the same reason as its sibling `prompt-tdee-not-activity-scaled.test.ts`: the
// prompt is assembled inline in the route, and the only other way to see it is to call an LLM.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const route = readFileSync(join(process.cwd(), 'app/api/nutrition-goals/recommend/route.ts'), 'utf8')
const validator = readFileSync(join(process.cwd(), 'packages/shared/src/validation/mood-log.ts'), 'utf8')
const homeCard = readFileSync(join(process.cwd(), 'components/home/home-card-widget.tsx'), 'utf8')

describe('no surface presents a defaulted sleep quality as reported (TN-66)', () => {
  // The premise, asserted rather than trusted. If the check-in ever collects this field again the
  // value stops being a constant, and this test should fail loudly rather than keep suppressing a
  // field that has become real.
  it('sleepQuality is still optional on the write path, so a stored value may be the default', () => {
    expect(validator).toMatch(/sleepQuality:\s*z\.enum\(\[[^\]]*\]\)\.optional\(\)/)
  })

  it('the prompt no longer states a sleep quality', () => {
    expect(route).not.toContain('sleep quality=')
    expect(route).not.toContain('m.sleepQuality')
  })

  it('but still gives the model the measured sleep and the real energy rating', () => {
    // The removal must not take the honest neighbours with it — `energy_level` is genuinely
    // collected (drained 6, low 18, ok 50, good 34 over the same 108 rows) and the sleep DURATION
    // is measured by the ring.
    const pairLine = route.split('\n').find(l => l.includes('h sleep, energy='))
    expect(pairLine, 'the sleep/energy pair line').toBeDefined()
    expect(pairLine).toContain('durationHours')
    expect(pairLine).toContain('energy=${m.energyLevel}')
  })

  it('Home does not render a sleep line from the same field', () => {
    expect(homeCard).not.toContain('sleepQuality')
    expect(homeCard).not.toContain('SLEEP_LABEL')
  })
})
