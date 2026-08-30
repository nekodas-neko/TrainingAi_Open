// BF-47 — the deleted food comes back.
//
// Reported from the device: *"Delete worked; when I click delete the item vanishes then re-appears;
// then when you swap screens - it dissapears."* The delete is queued, the push has not run, so the
// server still holds the row, and the loader hydrates from that copy.
//
// The rule tested here is deliberately narrow: drop **only** rows the user has actually asked to
// delete. A filter that dropped anything else would hide food that had just been logged, which is
// the same class of bug pointing the other way.
import { describe, it, expect } from 'vitest'
import { pendingDeletedIds, withoutPendingDeletes } from '../pending-deletes'

const del = (domain: string, id: string) => ({ domain, payload: { id, deleted: true } })
const add = (domain: string, id: string) => ({ domain, payload: { id, quantityMultiplier: 1 } })

describe('pendingDeletedIds', () => {
  it('collects the ids of queued deletes for the domain asked for', () => {
    expect(pendingDeletedIds([del('food_logs', 'a'), del('food_logs', 'b')], 'food_logs'))
      .toEqual(new Set(['a', 'b']))
  })

  // The half that keeps this safe: an add and an edit look identical apart from `deleted`.
  it('ignores adds and edits, which must never be filtered out of a server response', () => {
    expect(pendingDeletedIds([add('food_logs', 'a'), del('food_logs', 'b')], 'food_logs'))
      .toEqual(new Set(['b']))
  })

  it('ignores another domain queued at the same time', () => {
    // Ids are UUIDs and cannot collide across domains in practice, but a rule that reads every
    // domain would be wrong the day two do.
    expect(pendingDeletedIds([del('activity_logs', 'a'), del('food_logs', 'b')], 'food_logs'))
      .toEqual(new Set(['b']))
  })

  it('tolerates a payload with no usable id rather than throwing mid-render', () => {
    const mutations = [
      { domain: 'food_logs', payload: { deleted: true } },
      { domain: 'food_logs', payload: { id: 42, deleted: true } },
      { domain: 'food_logs', payload: { id: '', deleted: true } },
      del('food_logs', 'real'),
    ]
    expect(pendingDeletedIds(mutations, 'food_logs')).toEqual(new Set(['real']))
  })

  it('does not treat a falsy or string `deleted` as a delete', () => {
    const mutations = [
      { domain: 'food_logs', payload: { id: 'a', deleted: false } },
      { domain: 'food_logs', payload: { id: 'b', deleted: 'true' } },
    ]
    expect(pendingDeletedIds(mutations, 'food_logs').size).toBe(0)
  })

  it('is empty when nothing is queued', () => {
    expect(pendingDeletedIds([], 'food_logs').size).toBe(0)
  })
})

describe('withoutPendingDeletes', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('drops exactly the deleted rows', () => {
    expect(withoutPendingDeletes(rows, new Set(['b']), r => r.id)).toEqual([{ id: 'a' }, { id: 'c' }])
  })

  it('returns the rows untouched when nothing is queued — the ordinary load', () => {
    expect(withoutPendingDeletes(rows, new Set(), r => r.id)).toEqual(rows)
  })

  it('can empty the list, because deleting your only entry is a real thing to do', () => {
    expect(withoutPendingDeletes([{ id: 'a' }], new Set(['a']), r => r.id)).toEqual([])
  })

  it('ignores a queued delete for a row this day does not hold', () => {
    expect(withoutPendingDeletes(rows, new Set(['zz']), r => r.id)).toEqual(rows)
  })
})
