import { describe, it, expect } from 'vitest'
import { CoachWidgetSchema, WIDGET_TOOL_NAMES, isWidgetToolName, WidgetResultSchema, ChoiceListSchema, CHOICE_SOURCES, PLAN_CARD_ACTIONS } from '../widgets'
import { GROCERY_CATALOGUE } from '@trainingai/shared/nutrition/grocery-catalogue'
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

// LA-47 — the plan card. Its whole point is what it does NOT carry: the model names a plan and the
// client renders the meals, so the calories on screen cannot disagree with the ones stored.
describe('PlanCardSchema', () => {
  it('accepts a title with no plan id — that is the active plan', () => {
    expect(CoachWidgetSchema.safeParse({ kind: 'plan_card', title: 'Your plan' }).success).toBe(true)
  })

  it('accepts a named plan', () => {
    const parsed = CoachWidgetSchema.safeParse({ kind: 'plan_card', title: 'Your plan', planId: VALID_UUID })
    expect(parsed.success && parsed.data.kind === 'plan_card' && parsed.data.planId).toBe(VALID_UUID)
  })

  // The token argument and the honesty argument are the same field. A model that could write the
  // meals could write different ones from the plan the app holds, and nothing downstream would
  // notice — so there is nowhere to put them.
  it('has no field for meals, calories or macros', () => {
    const withMeals = {
      kind: 'plan_card',
      title: 'Your plan',
      meals: [{ name: 'Invented breakfast', calories: 700 }],
      targetCalories: 2400,
    }
    const parsed = CoachWidgetSchema.safeParse(withMeals)
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'meals' in parsed.data).toBe(false)
    expect(parsed.success && 'targetCalories' in parsed.data).toBe(false)
  })

  it('rejects an empty title rather than rendering a headerless card', () => {
    expect(CoachWidgetSchema.safeParse({ kind: 'plan_card', title: '' }).success).toBe(false)
  })

  // Both buttons resolve through `chose`, which is why no `WidgetResultSchema` member was added.
  // If that ever stops holding, this is what says so.
  it('resolves its actions as ordinary chose results', () => {
    for (const id of Object.values(PLAN_CARD_ACTIONS)) {
      expect(WidgetResultSchema.safeParse({ status: 'chose', id, label: 'Saved 4 meals to My Foods' }).success).toBe(true)
    }
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
      const sample =
        kind === 'choice_list' ? choiceList
        : kind === 'plan_card' ? { kind: 'plan_card', title: 'Your plan' }
        : changePreview
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

  // Q-407 — a multi-select answer, which had no shape at all before.
  it('accepts several ids with a joined label', () => {
    expect(WidgetResultSchema.safeParse({
      status: 'chose', ids: ['Coles', 'Aldi'], label: 'Coles and Aldi',
    }).success).toBe(true)
  })

  // An answer that names nothing is not an answer — the model would read "chose" and have no idea
  // what was chosen.
  it('rejects a chose with neither id nor ids', () => {
    expect(WidgetResultSchema.safeParse({ status: 'chose', label: 'Coles' }).success).toBe(false)
  })

  it('bounds the list rather than letting a client post an unbounded array', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`)
    expect(WidgetResultSchema.safeParse({ status: 'chose', ids, label: 'lots' }).success).toBe(false)
    expect(WidgetResultSchema.safeParse({ status: 'chose', ids: [], label: 'none' }).success).toBe(false)
  })
})

// Q-407. The owner's complaint was literal — "there should be options for 'select all' as I keep
// clicking each grocery store" — and no configuration produced it: the widget resolved one option
// and its callback was singular.
describe('ChoiceListSchema multi-select', () => {
  const base = { kind: 'choice_list' as const, prompt: 'Where do you shop?' }

  it('accepts multi and selectAll, and both default absent', () => {
    expect(ChoiceListSchema.safeParse({ ...base, source: 'grocery_stores', multi: true, selectAll: true }).success).toBe(true)
    const plain = ChoiceListSchema.safeParse({ ...base, source: 'sessions' })
    expect(plain.success).toBe(true)
    // Absent, not false: every existing call site is byte-identical, which is the point of adding
    // them as optional flags rather than a second widget.
    expect(plain.success && plain.data.multi).toBeUndefined()
    expect(plain.success && plain.data.selectAll).toBeUndefined()
  })

  it('serves the meal-plan catalogues as sources, so the model never types them out', () => {
    for (const source of ['grocery_stores', 'proteins', 'carbs', 'fats', 'vegetables', 'dietary_restrictions']) {
      expect(CHOICE_SOURCES as readonly string[], source).toContain(source)
      expect(ChoiceListSchema.safeParse({ ...base, source }).success, source).toBe(true)
    }
  })

  it('still rejects a source it does not serve', () => {
    expect(ChoiceListSchema.safeParse({ ...base, source: 'groceries' }).success).toBe(false)
  })
})

// The catalogue is the reference case for the token saving, so its contents are pinned: a list that
// silently shrinks would make the Coach's picker quietly incomplete rather than fail.
describe('the grocery catalogue behind those sources', () => {
  it('covers every catalogue source with a non-empty list', () => {
    for (const key of ['grocery_stores', 'proteins', 'carbs', 'fats', 'vegetables'] as const) {
      expect(GROCERY_CATALOGUE[key].length, key).toBeGreaterThan(0)
    }
  })

  it('has no duplicates within a list — a duplicate id makes two rows resolve to one', () => {
    for (const [key, list] of Object.entries(GROCERY_CATALOGUE)) {
      expect(new Set(list).size, key).toBe(list.length)
    }
  })

  // MAX_VISIBLE_ROWS is 6 and the list scrolls beyond it, but a "Select all" over a list longer
  // than the widget's own cap would offer to pick options the route never returns.
  it('stays inside the 24-option cap the widget and the route both enforce', () => {
    for (const [key, list] of Object.entries(GROCERY_CATALOGUE)) {
      expect(list.length, key).toBeLessThanOrEqual(24)
    }
  })
})
