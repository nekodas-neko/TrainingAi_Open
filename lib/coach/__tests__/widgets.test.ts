import { describe, it, expect } from 'vitest'
import { CoachWidgetSchema, WIDGET_TOOL_NAMES, isWidgetToolName, WidgetResultSchema } from '../widgets'
import { CoachPatchSchema, hasUniqueChangeIds } from '../patch'

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

const choiceList = {
  kind: 'choice_list',
  prompt: 'Which session?',
  options: [{ id: VALID_UUID, title: 'Lower', subtitle: 'Wed · 5 exercises', colorKey: 'cyan' }],
}

const changePreview = {
  kind: 'change_preview',
  title: 'Confirm change',
  patch: {
    domain: 'session_exercise',
    targetId: VALID_UUID,
    changes: [{ id: 'c1', field: 'exerciseName', from: 'Deadlift', to: 'Romanian Deadlift' }],
  },
}

describe('CoachWidgetSchema', () => {
  it('accepts every member of the union', () => {
    expect(CoachWidgetSchema.safeParse(choiceList).success).toBe(true)
    expect(CoachWidgetSchema.safeParse(changePreview).success).toBe(true)
  })

  it('rejects an unknown kind rather than passing it through', () => {
    expect(CoachWidgetSchema.safeParse({ kind: 'log_food', foodId: 'x' }).success).toBe(false)
  })

  it('rejects a hex colour, so a model cannot bypass the theme tokens', () => {
    const withHex = { ...choiceList, options: [{ ...choiceList.options[0], colorKey: '#ff0000' }] }
    expect(CoachWidgetSchema.safeParse(withHex).success).toBe(false)
  })

  it('rejects an option with no id — the resolved value feeds a patch, so it must be a real row', () => {
    const noId = { ...choiceList, options: [{ title: 'Lower' }] }
    expect(CoachWidgetSchema.safeParse(noId).success).toBe(false)
  })

  it('has no field for consequences, so the model cannot author one', () => {
    const withConsequences = { ...changePreview, consequences: [{ kind: 'warn', text: 'invented' }] }
    const parsed = CoachWidgetSchema.safeParse(withConsequences)
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'consequences' in parsed.data).toBe(false)
  })
})

describe('CoachPatchSchema', () => {
  it('requires `from` on a value change, so staleness is detectable', () => {
    const noFrom = {
      domain: 'session_exercise',
      targetId: VALID_UUID,
      changes: [{ id: 'c1', field: 'exerciseName', to: 'Romanian Deadlift' }],
    }
    expect(CoachPatchSchema.safeParse(noFrom).success).toBe(false)
  })

  it('rejects an unknown field rather than silently ignoring it', () => {
    const badField = {
      domain: 'session_exercise',
      targetId: VALID_UUID,
      changes: [{ id: 'c1', field: 'sets', from: 4, to: 3 }],
    }
    expect(CoachPatchSchema.safeParse(badField).success).toBe(false)
  })

  it('catches duplicate change ids, which would make a per-row toggle ambiguous', () => {
    const patch = CoachPatchSchema.parse({
      domain: 'session_exercise',
      targetId: VALID_UUID,
      changes: [
        { id: 'c1', field: 'exerciseName', from: 'A', to: 'B' },
        { id: 'c1', field: 'position', from: 1, to: 2 },
      ],
    })
    expect(hasUniqueChangeIds(patch)).toBe(false)
  })
})

describe('tool name mapping', () => {
  it('maps every widget tool to a kind in the union', () => {
    for (const [toolName, kind] of Object.entries(WIDGET_TOOL_NAMES)) {
      expect(isWidgetToolName(toolName)).toBe(true)
      const sample = kind === 'choice_list' ? choiceList : changePreview
      expect(CoachWidgetSchema.safeParse(sample).success).toBe(true)
    }
  })

  it('does not treat a read-only tool as a widget', () => {
    expect(isWidgetToolName('getRecoveryData')).toBe(false)
  })
})

describe('WidgetResultSchema', () => {
  it('accepts each outcome the client can send back', () => {
    expect(WidgetResultSchema.safeParse({ status: 'chose', id: 'x', label: 'Lower' }).success).toBe(true)
    expect(WidgetResultSchema.safeParse({ status: 'applied', summary: 'Swapped' }).success).toBe(true)
    expect(WidgetResultSchema.safeParse({ status: 'cancelled' }).success).toBe(true)
    expect(WidgetResultSchema.safeParse({ status: 'stale', detail: 'moved' }).success).toBe(true)
  })
})
