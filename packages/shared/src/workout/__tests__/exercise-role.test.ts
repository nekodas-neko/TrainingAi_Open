import { describe, it, expect } from 'vitest'
import { recommendExerciseRole, UNCLASSIFIED_EXERCISE_ROLE, capPrimariesPerSession } from '../exercise-role'

/**
 * Q-405 — the role selects the progression style, so these are prescription decisions rather than
 * labels. The fixtures are real catalogue rows, copied from the seeded `exercise_library`.
 */
const m = (...names: string[]) => names.map(muscle => ({ muscle }))

describe('recommendExerciseRole', () => {
  it('makes the barbell compounds primary', () => {
    // Bench Press carries ONE main muscle plus two secondary — the case that breaks a
    // "2+ main muscles = compound" rule, which is why the count is over all muscles.
    expect(recommendExerciseRole({ muscles: m('chest', 'shoulders', 'triceps'), equipment: ['barbell'] })).toBe('primary')
    expect(recommendExerciseRole({ muscles: m('hamstrings', 'glutes', 'lower back', 'quads', 'traps'), equipment: ['barbell'] })).toBe('primary')
    expect(recommendExerciseRole({ muscles: m('quads', 'glutes', 'hamstrings', 'lower back'), equipment: ['barbell'] })).toBe('primary')
  })

  it('does not promote an isolation just because it uses a barbell', () => {
    // Barbell Preacher Curl and Barbell Wrist Curl. If the equipment check ran first, both would be
    // primary and would be prescribed a session-anchor loading.
    expect(recommendExerciseRole({ muscles: m('biceps', 'forearms'), equipment: ['barbell'] })).toBe('accessory')
    expect(recommendExerciseRole({ muscles: m('forearms'), equipment: ['barbell'] })).toBe('accessory')
  })

  it('makes a non-barbell compound secondary', () => {
    // Dumbbell Bench Press: same movement pattern, not the thing the session is built around.
    expect(recommendExerciseRole({ muscles: m('chest', 'shoulders', 'triceps'), equipment: ['dumbbell'] })).toBe('secondary')
    expect(recommendExerciseRole({ muscles: m('lats', 'biceps', 'rear delts'), equipment: ['cable', 'machine'] })).toBe('secondary')
  })

  it('makes an isolation accessory whatever it is loaded with', () => {
    expect(recommendExerciseRole({ muscles: m('shoulders'), equipment: ['cable'] })).toBe('accessory')
    expect(recommendExerciseRole({ muscles: m('biceps'), equipment: ['dumbbell'] })).toBe('accessory')
    expect(recommendExerciseRole({ muscles: m('calves'), equipment: ['machine'] })).toBe('accessory')
  })

  it('returns null when there is nothing to recommend from, rather than guessing', () => {
    // Null means ASK. Turning it into a default is the bug this replaces, wearing new clothes.
    expect(recommendExerciseRole({ muscles: [], equipment: ['barbell'] })).toBeNull()
    expect(recommendExerciseRole(null)).toBeNull()
  })

  it('is case-insensitive about the equipment string', () => {
    expect(recommendExerciseRole({ muscles: m('chest', 'shoulders', 'triceps'), equipment: ['Barbell'] })).toBe('primary')
  })

  it('the unclassified fallback is the LIGHTEST role, so being wrong under-loads', () => {
    // This is the role a swap writes when the incoming exercise was just invented by the Coach and
    // its muscles are model-proposed. Anything heavier would launder model output into a
    // prescription — the Jefferson Curl case, which arrived at 60 kg x 6 at 80%.
    expect(UNCLASSIFIED_EXERCISE_ROLE).toBe('accessory')
  })

  it('counts every listed muscle, main and secondary alike', () => {
    const three = m('a', 'b', 'c')
    expect(recommendExerciseRole({ muscles: three, equipment: ['barbell'] })).toBe('primary')
    expect(recommendExerciseRole({ muscles: three.slice(0, 2), equipment: ['barbell'] })).toBe('accessory')
    // The role field on each muscle is deliberately not read — 117 of 142 catalogue entries carry
    // exactly one `main`, so it does not discriminate.
    const oneMainTwoSecondary = [
      { muscle: 'chest', role: 'main' }, { muscle: 'shoulders', role: 'secondary' }, { muscle: 'triceps', role: 'secondary' },
    ]
    expect(recommendExerciseRole({ muscles: oneMainTwoSecondary, equipment: ['barbell'] })).toBe('primary')
  })
})

/**
 * BF-126 — the role picks the progression style in both /api/generate-program and /api/builder-chat,
 * so an extra primary is an extra exercise at the goal's heaviest band. The shapes below are the
 * owner's real sessions and the generator's real output, not invented ones.
 */
describe('capPrimariesPerSession', () => {
  const ex = (name: string, exerciseRole: string) => ({ name, exerciseRole })
  const roles = (out: { exerciseRole?: string }[]) => out.map(e => e.exerciseRole)

  it('demotes the second primary and every one after it, to secondary not accessory', () => {
    const out = capPrimariesPerSession([
      ex('Barbell Bench Press', 'primary'),
      ex('Barbell Overhead Press', 'primary'),
      ex('Weighted Dip', 'primary'),
      ex('Cable Fly', 'accessory'),
    ])
    expect(roles(out)).toEqual(['primary', 'secondary', 'secondary', 'accessory'])
  })

  it('leaves the generator\'s actual output untouched — 1/2/2 was 44 of 44 sampled sessions', () => {
    const session = [
      ex('Barbell Bench Press', 'primary'),
      ex('Incline Bench Press', 'secondary'),
      ex('Weighted Dip', 'secondary'),
      ex('Cable Fly', 'accessory'),
      ex('Triceps Pushdown', 'accessory'),
    ]
    expect(capPrimariesPerSession(session)).toEqual(session)
  })

  it('does NOT cap secondaries — two per session is the owner\'s normal in 10 of his 22 sessions', () => {
    const out = capPrimariesPerSession([
      ex('Barbell Squat', 'primary'),
      ex('Romanian Deadlift', 'secondary'),
      ex('Bulgarian Split Squat', 'secondary'),
    ])
    expect(roles(out)).toEqual(['primary', 'secondary', 'secondary'])
  })

  // The case above cannot see a cap that counts secondaries too, because demoting a secondary TO
  // secondary is invisible. This one can: a secondary BEFORE the primary is the owner's own
  // ordering — a lighter compound ramping into the main lift — and a shared "first compound wins"
  // counter would spend the allowance on the ramp and demote the main lift behind it.
  it('a secondary before the primary does not consume the primary allowance', () => {
    const out = capPrimariesPerSession([
      ex('Pull-Up', 'secondary'),
      ex('Barbell Row', 'primary'),
      ex('Face Pull', 'accessory'),
    ])
    expect(roles(out)).toEqual(['secondary', 'primary', 'accessory'])
  })

  it('does NOT promote when a session has no primary — the owner keeps one such session', () => {
    const out = capPrimariesPerSession([
      ex('Romanian Deadlift', 'secondary'),
      ex('Leg Curl', 'accessory'),
    ])
    expect(roles(out)).toEqual(['secondary', 'accessory'])
  })

  it('keeps the FIRST primary, and never reorders — the owner confirmed the order is deliberate', () => {
    const out = capPrimariesPerSession([
      ex('Pull-Up', 'accessory'),
      ex('Barbell Row', 'primary'),
      ex('Deadlift', 'primary'),
    ])
    expect(out.map(e => e.name)).toEqual(['Pull-Up', 'Barbell Row', 'Deadlift'])
    expect(roles(out)).toEqual(['accessory', 'primary', 'secondary'])
  })

  it('does not mutate its input', () => {
    const session = [ex('A', 'primary'), ex('B', 'primary')]
    capPrimariesPerSession(session)
    expect(roles(session)).toEqual(['primary', 'primary'])
  })
})
