/**
 * RV-51 — a merged duplicate is not a separate exercise, and two routes were not filtering it.
 *
 * `listExerciseLibrary` is deliberately UNFILTERED: `exercise_library` is global, and other
 * consumers resolve metadata for rows another user may still have logged. `mergedInto` is exposed
 * so each PICKER filters it. `builder-review.tsx` did; `generate-program` and `builder-chat` did
 * not.
 *
 * **They appeared to, for the wrong reason.** Production holds four merged rows. Two carry
 * `equipment = []`, which `equipmentEligible` rejects on `.some()` — so they were excluded by
 * accident. The other two, `Cable Crunch` and `Straight Arm Pulldown`, carry `['cable']` and were
 * being offered beside the canonical rows they were merged into (verified 2026-09-18).
 *
 * The fixture mirrors that exactly, which is why the merged row here HAS equipment: a merged row
 * with an empty list passes this test against the unfixed route and proves nothing.
 *
 * The assertion is on the PROMPT, per the sibling file in this directory: an instruction not to
 * program a duplicate would pass a helper-level test and still let the model return one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-0000000051a1'

let captured = ''

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generateObject: vi.fn(async (args: { prompt: string }) => {
    captured = args.prompt
    return { object: { programName: 'x', phaseStructureName: 'Linear Progression', sessions: [] } }
  }),
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_meta: unknown, run: () => Promise<unknown>) => run(),
}))

const LIBRARY = [
  // The canonical row.
  { id: 'c1', name: 'Cable Pulldown', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: ['cable'] },
  // Merged into it, and carrying equipment — the shape that was actually leaking.
  { id: 'd1', name: 'Straight Arm Pulldown', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: ['cable'], mergedInto: 'c1' },
  // Merged AND unlabelled — the shape a review mistook for the defect. Excluded either way.
  { id: 'd2', name: 'Cable Lat Pulldown', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: [], mergedInto: 'c1' },
  // An ordinary second exercise, so "the list is not simply empty" is never the reason a name is absent.
  { id: 'c2', name: 'Barbell Row', muscles: [{ muscle: 'Lats', role: 'main' }], equipment: ['barbell'] },
]

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listExerciseLibrary: async () => LIBRARY,
    listProgressionStyles: async () => [],
    listInjuries: async () => [],
    listPrograms: async () => [],
  }),
}))

const BODY = {
  programName: 'Test',
  equipment: ['barbell', 'cable'],
  sessionsPerWeek: 3,
  timePerSessionMinutes: 60,
  musclesToFocus: ['Lats'],
  goal: 'hypertrophy' as const,
  progressionMode: 'linear' as const,
  totalWeeks: 12,
  scheduleType: 'weekly' as const,
  weeklyDays: [0, 2, 4],
}

async function post() {
  const { POST } = await import('@/app/api/generate-program/route')
  return POST(new Request('http://localhost/api/generate-program', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(BODY),
  }))
}

describe('generate-program excludes merged duplicates (RV-51)', () => {
  beforeEach(() => { captured = '' })

  // THE case. This row is equipment-eligible, so only the mergedInto check can remove it.
  it('does not offer a merged duplicate that is equipment-eligible', async () => {
    await post()
    expect(captured).not.toContain('Straight Arm Pulldown')
  })

  it('still offers the canonical row it was merged into', async () => {
    await post()
    expect(captured).toContain('Cable Pulldown')
  })

  /**
   * The deliberately equivalent control: a merged row with no equipment was already excluded by
   * `equipmentEligible`, and must stay excluded for the new reason as well. It passes either way by
   * design — without it, a fix that only ever looked at equipment would be indistinguishable.
   */
  it('keeps excluding a merged duplicate that has no equipment', async () => {
    await post()
    expect(captured).not.toContain('Cable Lat Pulldown')
  })

  /**
   * The guard against over-filtering. `Barbell Row` shares the focus muscle and is not merged, so
   * a fix that dropped too much would take it too — and then "Straight Arm Pulldown is absent"
   * would be true for the wrong reason.
   */
  it('still offers an ordinary exercise', async () => {
    await post()
    expect(captured).toContain('Barbell Row')
  })
})
