import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))

/**
 * Issue 2831 — accepting the AI prescription blanked the exercise list to skeletons for about a
 * minute. The server answered in tens of milliseconds; the time was spent on the phone.
 *
 * The behaviour of the on-device race is covered in local-seed.test.ts. These pin the three call
 * sites that made the blank possible, in the 1800-line screen that cannot be rendered in a unit test.
 */
describe('issue 2831 — a refresh keeps the exercises that are on screen', () => {
  const screen = code('components/workout-screen.tsx')
  const fetchExercises = screen.slice(
    screen.indexOf('const fetchExercises = useCallback'),
    screen.indexOf('const loadPeriodization = useCallback'),
  )

  it('only shows skeletons when nothing is painted for this key', () => {
    // setLoading(true) lives in the branch that is skipped once the key has been painted.
    expect(fetchExercises).toMatch(/else if \(!alreadyPainted\) \{\s*setLoading\(true\)/)
    expect(fetchExercises).toMatch(/alreadyPainted = paintedKeyRef\.current === cacheKey/)
    // and it is the only place a fetch turns the skeleton on
    expect(fetchExercises.match(/setLoading\(true\)/g)).toHaveLength(1)
  })

  it('every paint records the key it painted', () => {
    // seed paint, local-mirror paint and network paint
    expect(fetchExercises.match(/paintedKeyRef\.current = cacheKey/g)).toHaveLength(3)
  })

  it('does not hold the network request behind the on-device read', () => {
    expect(fetchExercises).not.toMatch(/await\s+localStore\.getActiveProgramLocal/)
    expect(fetchExercises).toMatch(/startLocalSeed\(\(\) => localStore\.getActiveProgramLocal\(\)/)
    // the network callback tells the race it has landed, before it paints
    expect(fetchExercises).toMatch(/\(data\) => \{\s*localSeed\?\.networkLanded\(\)/)
  })

  it('a failed refresh over a painted list stays on the list instead of the error screen', () => {
    expect(fetchExercises).toMatch(/await localSeed\?\.settled;\s*if \(paintedKeyRef\.current !== cacheKey\)/)
  })

  it('Accept does not wait on the native SQLite deletes before updating the card', () => {
    const card = code('components/workout/ai-prescription-card.tsx')
    const respond = card.slice(card.indexOf('async function respond'), card.indexOf('async function executeTransition'))
    expect(respond).not.toMatch(/await invalidatePrescriptionChanged/)
    expect(respond.indexOf('invalidatePrescriptionChanged(sessionId)')).toBeGreaterThan(-1)
    expect(respond.indexOf('invalidatePrescriptionChanged(sessionId)')).toBeLessThan(respond.indexOf('onStatusChange('))
  })
})
