// #2417. Who keeps, who is retired, and how a quantity is rescaled when look-alike foods merge.
import { describe, it, expect } from 'vitest'
import { planLookAlikeMerge, groupKind, lookAlikeKey, type MergeFood } from '../food-merge'

let n = 0
const food = (over: Partial<MergeFood> = {}): MergeFood => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  name: 'Greek Yoghurt', brand: 'Chobani', servingSizeG: 100, calories: 60, proteinG: 10, carbsG: 4, fatG: 0.5,
  createdAtMs: 1_000, tombstoned: false, liveLogs: 0, mealItems: 0, ...over,
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
    const a = food(), b = food(), gone = food({ tombstoned: true })
    const key = lookAlikeKey(a)
    expect(planLookAlikeMerge([a, b], { [key]: food().id }).invalidKeepers).toHaveLength(1)
    expect(planLookAlikeMerge([a, b, gone], { [key]: gone.id }).invalidKeepers[0].reason).toMatch(/already been merged/)
    expect(planLookAlikeMerge([a, b], { 'nothing | here': a.id }).invalidKeepers).toHaveLength(1)
  })

  it('the factor is the ratio of serving sizes, and exactly 1 when they are equal', () => {
    const k = food({ servingSizeG: 250, liveLogs: 5 }), e = food({ servingSizeG: 100, liveLogs: 2 }), same = food({ servingSizeG: 250 })
    const g = planLookAlikeMerge([k, e, same]).groups[0]
    expect(g.extras.find(x => x.id === e.id)!.factor).toBeCloseTo(0.4, 12)
    expect(g.extras.find(x => x.id === same.id)!.factor).toBe(1)
  })

  it('moves the live logs of an extra, and its saved-meal ingredients', () => {
    const k = food({ liveLogs: 5 }), e = food({ liveLogs: 4, mealItems: 2 })
    const x = planLookAlikeMerge([k, e]).groups[0].extras[0]
    expect(x).toMatchObject({ logsToMove: 4, mealItemsToMove: 2, tombstone: true })
  })

  it('is idempotent: a merged group plans nothing', () => {
    const k = food({ liveLogs: 12 })
    const done = food({ tombstoned: true, liveLogs: 0, mealItems: 0 })
    expect(planLookAlikeMerge([k, done]).groups).toEqual([])
  })

  it('moves a straggler: a log an unsynced device pushed against a retired row', () => {
    const k = food({ liveLogs: 12 })
    const retired = food({ tombstoned: true, liveLogs: 1 })
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

  describe('automatic means calories and macros come out exactly as before', () => {
    it('is not automatic when the extra carries fibre and sodium the keeper lacks (#3472)', () => {
      const k = food({ liveLogs: 5 })
      const e = food({ liveLogs: 1, fiberG: 4, sodiumMg: 300, quantities: [1] })
      const [g] = planLookAlikeMerge([k, e]).groups
      expect(g.automatic).toBe(false)
      expect(g.worstChange).toMatchObject({ kcal: 0, fiberG: 4, sodiumMg: 300, sugarG: 0, satFatG: 0 })
      expect(g.extras[0].worstChange.fiberG).toBe(4)
    })

    it('the keeper carrying the value the extra lacks is a change too', () => {
      const k = food({ liveLogs: 5, sugarG: 2.5, satFatG: 0.4 })
      const e = food({ liveLogs: 1, quantities: [2] })
      const [g] = planLookAlikeMerge([k, e]).groups
      expect(g.automatic).toBe(false)
      expect(g.worstChange).toMatchObject({ sugarG: 5, satFatG: 0.8 })
    })

    it('null against 0 is no change, since the app totals a missing value as 0', () => {
      const k = food({ liveLogs: 5, fiberG: null, sodiumMg: 0 })
      const e = food({ liveLogs: 1, fiberG: 0, sodiumMg: null, quantities: [1, 2] })
      const [g] = planLookAlikeMerge([k, e]).groups
      expect(g.automatic).toBe(true)
    })

    it('equal micronutrients at another serving size stay automatic when they scale exactly', () => {
      const k = food({ servingSizeG: 100, fiberG: 4, sodiumMg: 300, liveLogs: 5 })
      const e = food({ servingSizeG: 50, calories: 30, proteinG: 5, carbsG: 2, fatG: 0.25, fiberG: 2, sodiumMg: 150, liveLogs: 1, quantities: [1, 3] })
      const [g] = planLookAlikeMerge([k, e]).groups
      expect(g.kind).toBe('same-per-100g')
      expect(g.automatic).toBe(true)
    })

    it('a same-per-100g group is not automatic when a moved log changes by a kcal', () => {
      const k = food({ servingSizeG: 30, calories: 16, proteinG: 1, carbsG: 3, fatG: 0.5, liveLogs: 5 })
      const e = food({ servingSizeG: 100, calories: 52, proteinG: 3.3, carbsG: 10, fatG: 1.7, liveLogs: 1, quantities: [1] })
      const [g] = planLookAlikeMerge([k, e]).groups
      expect(g.kind).toBe('same-per-100g')
      expect(g.automatic).toBe(false)
      expect(g.worstChange.kcal).toBe(1)
      expect(g.extras[0].worstChange.kcal).toBe(1)
    })

    it('a kcal that lands on an exact .5 rounds the way the app does, so it is not automatic', () => {
      // 1.5 x (150 / 250) is 0.8999999999999999: the keeper's 1012.5 shows as 1012, the extra's as 1013.
      const k = food({ servingSizeG: 250, calories: 1125, proteinG: 0, carbsG: 0, fatG: 0, liveLogs: 5 })
      const e = food({ servingSizeG: 150, calories: 675, proteinG: 0, carbsG: 0, fatG: 0, liveLogs: 1, quantities: [1.5] })
      const [g] = planLookAlikeMerge([k, e]).groups
      expect(g.kind).toBe('same-per-100g')
      expect(g.automatic).toBe(false)
      expect(g.worstChange.kcal).toBe(1)
    })

    it('is automatic when the foods agree exactly per 100 g, whatever the quantity', () => {
      const k = food({ servingSizeG: 100, calories: 200, proteinG: 10, carbsG: 25, fatG: 5, liveLogs: 5 })
      const e = food({ servingSizeG: 45, calories: 90, proteinG: 4.5, carbsG: 11.25, fatG: 2.25, liveLogs: 2, quantities: [0.5, 1, 3.25] })
      const [g] = planLookAlikeMerge([k, e]).groups
      expect(g.automatic).toBe(true)
      expect(g.worstChange).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0, satFatG: 0 })
    })

    it('the same rounding disagreement is invisible when the only logs are at a quantity that hides it', () => {
      const k = food({ servingSizeG: 30, calories: 16, proteinG: 1, carbsG: 3, fatG: 0.5, liveLogs: 5 })
      const e = food({ servingSizeG: 100, calories: 52, proteinG: 3.3, carbsG: 10, fatG: 1.7, liveLogs: 0 })
      expect(planLookAlikeMerge([k, e]).groups[0].automatic).toBe(true)
    })

    it('a group that differs is never automatic', () => {
      const k = food({ liveLogs: 5 }), e = food({ calories: 400, liveLogs: 1, quantities: [1] })
      expect(planLookAlikeMerge([k, e]).groups[0]).toMatchObject({ kind: 'differs', automatic: false })
    })
  })
})
