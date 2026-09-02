// LA-47 piece 1 — the plan widget.
//
// The entry's structural claims were checked against the code before building and all three held:
// `widget-registry.tsx` narrows by early return and its fallthrough reads `widget.patch`, so an
// unhandled union member is a **type error**; `savePlanMealsToLibrary` exists and is idempotent;
// and `WIDGET_TOOL_NAMES` is the tool-name → kind map. That is why this shipped as one change
// across two lanes rather than the schema alone.
//
// What these assertions protect is the pair of properties that are invisible in a diff and fatal
// at runtime: a widget the model can call but the registry cannot render, and a widget the
// nutrition scope withholds from itself.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CoachWidgetSchema, WIDGET_TOOL_NAMES, PLAN_CARD_ACTIONS, WidgetResultSchema } from '../widgets'
import { COACH_SCOPES } from '../scopes'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('the plan widget (LA-47)', () => {
  it('parses with a title alone — no meals, which is the whole point', () => {
    const parsed = CoachWidgetSchema.safeParse({ kind: 'plan_card', title: 'Your week' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toEqual({ kind: 'plan_card', title: 'Your week' })
  })

  /**
   * A model that restates the plan anyway has its meals STRIPPED, not rejected — and that is the
   * behaviour we want, which is worth writing down because `.strict()` looks like the stricter and
   * therefore better choice here. It is not.
   *
   * The reason this widget carries no meals is LATENCY: output tokens are essentially all of
   * Coach's cost, so the goal is for the model not to write them. By the time a schema sees them
   * they are already written and already paid for. Rejecting would trigger an SDK retry — another
   * full round trip — making the exact number this design exists to protect strictly worse. So the
   * defence is the tool description, and the schema's job is only to not make it worse.
   */
  it('strips a restated plan rather than rejecting it, so a wasteful turn is not also a slow one', () => {
    const parsed = CoachWidgetSchema.safeParse({
      kind: 'plan_card', title: 'Your week', meals: [{ name: 'Oats' }],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'meals' in parsed.data).toBe(false)
  })

  it('is reachable as a tool and renderable as a kind', () => {
    expect(WIDGET_TOOL_NAMES.renderPlan).toBe('plan_card')
  })

  // The failure this guards is silent and total: the nutrition scope names its widgets explicitly
  // while the general scope derives them from WIDGET_TOOL_NAMES, so a widget added FOR meal
  // planning is withheld from meal planning unless someone remembers this list.
  it('is offered by the nutrition scope, which is the one that plans meals', () => {
    expect(COACH_SCOPES.nutrition.widgetTools).toContain('renderPlan')
    expect(COACH_SCOPES.general.widgetTools).toContain('renderPlan')
  })

  // The design decision the entry settled: two buttons are a choice list with a rich body, so
  // there is no third result shape to keep in step.
  it('resolves as an ordinary chose result, needing no new WidgetResult member', () => {
    for (const id of Object.values(PLAN_CARD_ACTIONS)) {
      expect(WidgetResultSchema.safeParse({ status: 'chose', id, label: 'x' }).success).toBe(true)
    }
  })

  // Source-level because the registry is a React component and both vitest projects run in `node`.
  // A branch rendering `null` would be worse than no branch: a client-side tool call with no result
  // wedges every following turn, because the provider refuses a request containing an unanswered
  // tool call.
  it('the registry renders it, and the card sends a result back', () => {
    const registry = read('components/coach/widget-registry.tsx')
    expect(registry).toContain('widget.kind === "plan_card"')
    expect(registry).toMatch(/<PlanCard[\s\S]{0,220}onChoose=/)
    expect(registry).toMatch(/status: "chose"/)

    const card = read('components/coach/plan-card.tsx')
    // The ids the system prompt tells the model to expect. A typo in either place is a dead button.
    expect(card).toContain('PLAN_CARD_ACTIONS.saveAll')
    expect(card).toContain('PLAN_CARD_ACTIONS.redo')
  })

  it('the model is told the tool exists and what its two answers mean', () => {
    const prompt = read('app/api/coach/route.ts')
    expect(prompt).toContain('renderPlan')
    expect(prompt).toContain('save_all')
    expect(prompt).toContain('redo')
  })
})
