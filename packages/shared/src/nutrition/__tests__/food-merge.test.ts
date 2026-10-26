// #2417. Who keeps, who is retired, and how a quantity is rescaled when look-alike foods merge.
import { describe, it, expect } from 'vitest'
import { planLookAlikeMerge, groupKind, lookAlikeKey, type MergeFood } from '../food-merge'

let n = 0
const food = (over: Partial<MergeFood> = {}): MergeFood => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  name: 'Greek Yoghurt', brand: 'Chobani', servingSizeG: 100, calories: 60, proteinG: 10, carbsG: 4, fatG: 0.5,
  createdAtMs: 1_000, tombstoned: false, liveLogs: 0, allLogs: 0, mealItems: 0, ...over,
})

describe('lookAlikeKey', () => {
  it('ignores case and whitespace in name and brand, nothing else', () => {
    expect(lookAlikeKey({ name: '  Greek   YOGHURT ', brand: 'chobani' })).toBe(lookAlikeKey({ name: 'Greek Yoghurt', brand: 'Chobani ' }))
    expect(lookAlikeKey({ name: 'Greek Yoghurt', brand: null })).not.toBe(lookAlikeKey({ name: 'Greek Yoghurt', brand: 'Chobani' }))
    expect(lookAlikeKey({ name: 'Greek Yoghurt Plain' })).not.toBe(lookAlikeKey({ name: 'Greek Yoghurt Vanilla' }))
  })
})

describe('groupKind', () => {
  it('identical: same serving and numbers', () => {
    expect(groupKind([food(), food()])).toBe('identical')
  })
  it('same per 100 g: another serving size, proportional numbers', () => {
    expect(groupKind([food(), food({ servingSizeG: 200, calories: 120, proteinG: 20, carbsG: 8, fatG: 1 })])).toBe('same-per-100g')
  })
  it('same per 100 g survives the rounding stored values carry', () => {
    // 45 g of a 400 kcal/100 g food is 180 kcal; 30 g is 120. Stored as integers either side is
    // within half a kcal, which per 100 g is a couple of kcal at these sizes.
    expect(groupKind([
      food({ servingSizeG: 45, calories: 180, proteinG: 9, carbsG: 27, fatG: 4.5 }),
      food({ servingSizeG: 30, calories: 120, proteinG: 6, carbsG: 18, fatG: 3 }),
    ])).toBe('same-per-100g')
  })
  it('differs: the per-100g numbers disagree (the 137 vs 342 kcal protein bar)', () => {
    expect(groupKind([food({ servingSizeG: 40, calories: 137 }), food({ servingSizeG: 40, calories: 342 })])).toBe('differs')
  })
  it('differs: a serving of 100 g and one of 80 g at the same calories are two densities', () => {
    expect(groupKind([food({ servingSizeG: 100, calories: 53 }), food({ servingSizeG: 80, calories: 42 })])).toBe('differs')
  })
  it('the least alike pair decides', () => {
    expect(groupKind([food(), food(), food({ calories: 200 })])).toBe('differs')
  })
})

describe('planLookAlikeMerge', () => {
  it('keeps the most-logged row; the newest on a tie; and says who chose', () => {
    const a = food({ liveLogs: 3, createdAtMs: 1 }), b = food({ liveLogs: 9, createdAtMs: 2 }), c = food({ liveLogs: 9, createdAtMs: 5 })
    const [g] = planLookAlikeMerge([a, b, c]).groups
    expect(g.keeperId).toBe(c.id)
    expect(g.keeperChosenBy).toBe('most-logged')
    expect(g.extras.map(e => e.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('does not depend on input order', () => {
    const rows = [food({ liveLogs: 2 }), food({ liveLogs: 2 }), food({ liveLogs: 2 })]
    const a = planLookAlikeMerge(rows).groups[0].keeperId
    const b = planLookAlikeMerge([...rows].reverse()).groups[0].keeperId
    expect(a).toBe(b)
  })

  it('an owner pick wins over the log count, and only that group', () => {
    const a = food({ liveLogs: 9, calories: 300 }), b = food({ liveLogs: 1, calories: 100 })
    const other = [food({ name: 'Oats', liveLogs: 1 }), food({ name: 'Oats', liveLogs: 5 })]
    const plan = planLookAlikeMerge([a, b, ...other], { [lookAlikeKey(a)]: b.id })
    const g = plan.groups.find(x => x.groupKey === lookAlikeKey(a))!
    expect(g.keeperId).toBe(b.id)
    expect(g.keeperChosenBy).toBe('owner')
    expect(g.automatic).toBe(false)
    expect(plan.groups.find(x => x.groupKey === lookAlikeKey(other[0]))!.keeperChosenBy).toBe('most-logged')
  })

  it('refuses a keeper that is not in the group, not live, or for no group', () => {
    const a = food(), b = food(), gone = food({ tombstoned: true, allLogs: 0 })
    const key = lookAlikeKey(a)
    expect(planLookAlikeMerge([a, b], { [key]: food().id }).invalidKeepers).toHaveLength(1)
    expect(planLookAlikeMerge([a, b, gone], { [key]: gone.id }).invalidKeepers[0].reason).toMatch(/already been merged/)
    expect(planLookAlikeMerge([a, b], { 'nothing | here': a.id }).invalidKeepers).toHaveLength(1)
  })

  it('the factor is the ratio of serving sizes, and exactly 1 when they are equal', () => {
    const k = food({ servingSizeG: 250, liveLogs: 5 }), e = food({ servingSizeG: 100, allLogs: 2 }), same = food({ servingSizeG: 250 })
    const g = planLookAlikeMerge([k, e, same]).groups[0]
    expect(g.extras.find(x => x.id === e.id)!.factor).toBeCloseTo(0.4, 12)
    expect(g.extras.find(x => x.id === same.id)!.factor).toBe(1)
  })

  it('counts every log of an extra to move, deleted ones included', () => {
    const k = food({ liveLogs: 5 }), e = food({ liveLogs: 1, allLogs: 4, mealItems: 2 })
    const x = planLookAlikeMerge([k, e]).groups[0].extras[0]
    expect(x).toMatchObject({ logsToMove: 4, mealItemsToMove: 2, tombstone: true })
  })

  it('is idempotent: a merged group plans nothing', () => {
    const k = food({ liveLogs: 12 })
    const done = food({ tombstoned: true, liveLogs: 0, allLogs: 0, mealItems: 0 })
    expect(planLookAlikeMerge([k, done]).groups).toEqual([])
  })

  it('moves a straggler: a log an unsynced device pushed against a retired row', () => {
    const k = food({ liveLogs: 12 })
    const retired = food({ tombstoned: true, allLogs: 1 })
    const [g] = planLookAlikeMerge([k, retired]).groups
    expect(g.extras).toEqual([expect.objectContaining({ id: retired.id, logsToMove: 1, tombstone: false })])
  })

  it('leaves a group with an unusable serving size alone and says so', () => {
    const plan = planLookAlikeMerge([food({ servingSizeG: 0 }), food()])
    expect(plan.groups).toEqual([])
    expect(plan.skipped).toHaveLength(1)
  })

  it('a group of one is not a group', () => {
    expect(planLookAlikeMerge([food(), food({ name: 'Other' })]).groups).toEqual([])
  })
})
