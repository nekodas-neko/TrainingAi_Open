// Oura is one source, not the product (owner, 3 Nov; CLAUDE.md): a feature reads the generic shapes of
// `docs/data-source-connector-guide.md` §3, never an Oura field or table, so a second source feeds it
// the same way. #3610, #3616 and #3620 moved the readiness, Body Battery, weekly digest and coach
// readers; #3875 found three more reading Oura's rows straight off and moved them:
//   - the next-session AI input's daytime stress (`stressHigh` → `DaytimeHighStress`),
//   - the health insight's temperature deviation (`temperatureDeviation` → `DailyTemperatureDeviation`),
//   - the energy budget and the heart-rate recovery profile (`oura_workouts` → `SourceActivitySession`),
// and #3884 moved the day timeline and the walk offer the same way, renamed the budget's activity names and
// moved the coach tool's resilience level (`lib/ai-chat/tools.ts`) onto `DailyResilienceLevel`.
//
// A source-text sweep, because the mistake is a field name on a row typed loosely enough to compile.
// Whole-line comments are dropped: the history of where a value came from is worth keeping in them.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')
const read = (f: string) => readFileSync(join(REPO, f), 'utf8')

function codeOf(src: string): string {
  return src
    .split('\n')
    .filter(line => {
      const t = line.trimStart()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

/** The next-session AI input's block of `adapter.ts`: the file also holds the Oura storage mappings,
 *  which are the connector's own and may name its fields. */
function aiDynamicBlock(): string {
  const src = read('lib/data/postgres/adapter.ts')
  const start = src.indexOf("if (program.phaseMode === 'ai_dynamic') {")
  expect(start, 'the AI Dynamic block has moved; update this guard').toBeGreaterThan(0)
  return codeOf(src.slice(start, start + 40_000))
}

// Oura's own field and table names, as a reader would touch them.
// Dot access, bracket access and destructuring all count: a reader that destructures is the same mistake.
const field = (name: string, tail = '') =>
  new RegExp(`\\.${name}\\b${tail}|\\[\\s*['"\`]${name}['"\`]\\s*\\]|\\{[^{}]*\\b${name}\\b${tail}[^{}]*\\}\\s*=(?!=)`)
const OURA_STRESS = field('stressHigh', '(?!Minutes)')
const OURA_TEMPERATURE = field('temperatureDeviation')
const OURA_WORKOUTS = /\bgetOuraWorkouts\b|\boura_workouts\b|\bouraWorkouts\b/
const OURA_WORKOUT_FIELDS = /\.(?:distanceM|reviewed)\b/

describe('readers take the generic shapes, never Oura\'s fields (#3875)', () => {
  it('the next-session AI input reads daytime stress through DaytimeHighStress', () => {
    const block = aiDynamicBlock()
    // Sanity: the slice is the block that reads stress at all.
    expect(block).toContain('stressHighMinutes')
    expect(block).not.toMatch(OURA_STRESS)
    expect(block).toContain('ouraDaytimeHighStress(')
  })

  it('the health insight reads the temperature deviation through DailyTemperatureDeviation', () => {
    const code = codeOf(read('app/api/ai/health-insight/route.ts'))
    expect(code).not.toMatch(OURA_TEMPERATURE)
    expect(code).not.toMatch(OURA_STRESS)
    expect(code).toContain('ouraTemperatureDeviations(')
  })

  it('the energy budget and the heart-rate recovery profile read activity sessions, not oura_workouts', () => {
    const readers = ['lib/health/oura-budget-activities.ts', 'packages/shared/src/health/compute-hr-recovery-profile.ts']
    for (const f of readers) {
      const code = codeOf(read(f))
      expect(code, f).not.toMatch(OURA_WORKOUTS)
      expect(code, f).toContain('getSourceActivitySessions(')
    }
    // The budget's rules take the generic session: no Oura row field reaches them.
    const rules = codeOf(read('packages/shared/src/health/oura-workout-activities.ts'))
    expect(rules).not.toMatch(OURA_WORKOUTS)
    expect(rules).not.toMatch(OURA_WORKOUT_FIELDS)
    expect(rules).toContain('SourceActivitySession')
  })

  // #3884: the two routes that still read `getOuraWorkouts`, and the budget's Oura-named vocabulary.
  it('the day timeline and the walk offer read activity sessions, not oura_workouts', () => {
    for (const f of ['app/api/day-timeline/route.ts', 'app/api/activity-detection/walks/route.ts']) {
      const code = codeOf(read(f))
      expect(code, f).not.toMatch(OURA_WORKOUTS)
      expect(code, f).not.toMatch(OURA_WORKOUT_FIELDS)
      expect(code, f).toContain('getSourceActivitySessions(')
    }
  })

  it('the coach recovery tool reads Oura\'s resilience word through DailyResilienceLevel', () => {
    const code = codeOf(read('lib/ai-chat/tools.ts'))
    expect(code).toContain('ouraResilienceLevels(')
    // Its own (ring) level is read off `oura_daily_derived`; Oura's word only through the mapping.
        expect(code).not.toMatch(/\br\.resilienceLevel\b/)
    expect(code).not.toMatch(OURA_STRESS)
    expect(code).not.toMatch(OURA_TEMPERATURE)
    expect(code).toContain('ouraTemperatureDeviations(')
  })

  it('the energy budget costs an unmapped activity by the generic name, never Oura\'s', () => {
    for (const f of [
      'packages/shared/src/health/daily-energy.ts', 'packages/shared/src/health/workout-energy.ts',
      'packages/shared/src/health/oura-workout-activities.ts', 'packages/shared/src/nutrition/day-budget.ts',
    ]) {
      expect(codeOf(read(f)), f).not.toMatch(/\bouraActivity\b|OURA_ON_FOOT_ACTIVITIES|metIdForOuraActivity|OuraBudgetActivity/)
    }
  })
})
