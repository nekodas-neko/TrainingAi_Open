// #2362 — the session cards printed `exerciseCount x 9` minutes while the session screen, which
// runs the duration model, read ~21 min of work one tap later. Both now go through one helper.
import { describe, it, expect } from 'vitest'
import { estimateSessionDurationSec, transitionSecForEquipment } from '../duration-model'
import { estimateProgramSessionMin, estimateProgramSessionSec } from '../program-session-duration'

const styles = new Map([
  ['heavy', [{ reps: 5, restSec: 180 }, { reps: 5, restSec: 180 }, { reps: 5, restSec: 180 }]],
  ['acc', [{ reps: 12, restSec: 60 }, { reps: 12, restSec: 60 }, { reps: 12, restSec: 60 }]],
])
const equipment: Record<string, string[]> = { Bench: ['barbell'], Fly: ['cable'], Dip: ['bodyweight'] }

describe('estimateProgramSessionSec', () => {
  const exercises = [
    { exerciseName: 'Bench', styleId: 'heavy' },
    { exerciseName: 'Fly', styleId: 'acc' },
    { exerciseName: 'Dip', styleId: 'acc' },
  ]

  it('is the duration model over the styles, not exercises x a constant', () => {
    const expected = estimateSessionDurationSec([
      { sets: 3, reps: 5, restSec: 180, transitionSec: transitionSecForEquipment(['barbell']) },
      { sets: 3, reps: 12, restSec: 60, transitionSec: transitionSecForEquipment(['cable']) },
      { sets: 3, reps: 12, restSec: 60, transitionSec: transitionSecForEquipment(['bodyweight']) },
    ])
    expect(estimateProgramSessionSec(exercises, styles, n => equipment[n])).toBe(expected)
    expect(estimateProgramSessionMin(exercises, styles, n => equipment[n])).toBe(Math.round(expected / 60))
  })

  it('skips an unstyled exercise and returns null when nothing can be priced', () => {
    expect(estimateProgramSessionSec([{ exerciseName: 'Bench' }], styles, () => undefined)).toBeNull()
    expect(estimateProgramSessionSec([], styles, () => undefined)).toBeNull()
    const partial = estimateProgramSessionSec(
      [{ exerciseName: 'Bench', styleId: 'heavy' }, { exerciseName: 'X' }], styles, () => undefined)
    const one = estimateProgramSessionSec([{ exerciseName: 'Bench', styleId: 'heavy' }], styles, () => undefined)
    expect(partial).toBe(one)
  })
})
