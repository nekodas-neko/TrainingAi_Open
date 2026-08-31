// LA-47 — a Coach scope is a boundary made of what the model never receives, not a paragraph
// asking it to stay put. These assert the withholding, because the prose half is untestable and
// the whole design decision is that the prose half is not what holds.
import { describe, it, expect } from 'vitest'
import { COACH_SCOPES, coachScope, pickTools, isCoachScopeId } from '@/lib/coach/scopes'
import { WIDGET_TOOL_NAMES, CHOICE_SOURCES } from '@/lib/coach/widgets'
import { COACH_PATCH_DOMAINS } from '@/lib/coach/patch'

describe('coachScope', () => {
  it('resolves a known id', () => {
    expect(coachScope('nutrition')).toBe(COACH_SCOPES.nutrition)
  })

  // Widening rather than failing is a deliberate choice: a client on a newer build naming a scope
  // this one has not shipped should get a working Coach. Safe because the narrow scopes withhold
  // only tools the general scope offers anyway — they route, they do not authorise.
  it('widens anything it does not recognise to general', () => {
    for (const bad of ['workouts', '', undefined, null, 42, {}]) {
      expect(coachScope(bad), String(bad)).toBe(COACH_SCOPES.general)
    }
  })

  it('recognises exactly the ids it defines', () => {
    expect(isCoachScopeId('general')).toBe(true)
    expect(isCoachScopeId('nutrition')).toBe(true)
    expect(isCoachScopeId('toString')).toBe(false)
  })
})

describe('the general scope withholds nothing', () => {
  // Otherwise adding a scope would silently narrow every existing caller — the route passes
  // `general` for every request that names no scope, which today is all of them.
  it('keeps every widget tool, source and patch domain', () => {
    const g = COACH_SCOPES.general
    expect([...g.widgetTools].sort()).toEqual(Object.keys(WIDGET_TOOL_NAMES).sort())
    expect([...g.choiceSources].sort()).toEqual([...CHOICE_SOURCES].sort())
    expect([...g.patchDomains].sort()).toEqual([...COACH_PATCH_DOMAINS].sort())
    expect(g.readTools).toBeNull()
    expect(g.systemSection).toBe('')
  })
})

describe('the nutrition scope', () => {
  const n = COACH_SCOPES.nutrition

  // The claim that matters: this scope structurally cannot change a program.
  it('cannot propose against a training domain', () => {
    expect(n.patchDomains).not.toContain('session_exercise')
    expect(n.patchDomains).not.toContain('program_phase')
    expect(n.patchDomains).not.toContain('early_deload')
    expect(n.patchDomains).toContain('nutrition_targets')
  })

  it('cannot name a training choice source', () => {
    expect(n.choiceSources).not.toContain('sessions')
    expect(n.choiceSources).not.toContain('exercises')
    expect(n.choiceSources).not.toContain('swap_candidates')
    expect(n.choiceSources).toContain('proteins')
  })

  it('keeps a handoff, so a training question has somewhere to go', () => {
    expect(n.widgetTools).toContain('handOff')
  })

  // Every scope's lists must name things that exist, or the narrowing silently withholds
  // everything — an empty enum is not a schema error, it is a tool nobody can call.
  it('names only real tools, sources and domains', () => {
    for (const w of n.widgetTools) expect(Object.keys(WIDGET_TOOL_NAMES)).toContain(w)
    for (const c of n.choiceSources) expect(CHOICE_SOURCES).toContain(c)
    for (const d of n.patchDomains) expect(COACH_PATCH_DOMAINS).toContain(d)
    expect(n.readTools?.length).toBeGreaterThan(0)
  })
})

describe('pickTools', () => {
  const tools = { a: 1, b: 2, c: 3 }

  it('keeps everything when the scope names no list', () => {
    expect(pickTools(tools, null)).toEqual(tools)
  })

  it('keeps only what the list names', () => {
    expect(pickTools(tools, ['a', 'c'])).toEqual({ a: 1, c: 3 })
  })

  // A name in the list that no tool answers to is a typo, and the failure it causes is a tool
  // quietly missing rather than an error — so it must not also invent an entry.
  it('ignores a name nothing answers to', () => {
    expect(pickTools(tools, ['a', 'getNothing'])).toEqual({ a: 1 })
  })

  it('keeps nothing for an empty list, rather than everything', () => {
    expect(pickTools(tools, [])).toEqual({})
  })
})
