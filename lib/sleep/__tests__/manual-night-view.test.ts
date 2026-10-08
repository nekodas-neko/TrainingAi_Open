/**
 * Issue 2338 — which state the Sleep screen's entry card is in, and how a server reply is made to
 * agree with this device's own unpushed manual-night writes.
 */
import { describe, it, expect } from 'vitest'
import { applyPendingManualWrites, lastNightState, type NightRef } from '../manual-night-view'
import { pendingDeletedIds } from '@trainingai/shared/sync/pending-deletes'

const TODAY = '2026-10-08'
const typed = (over: Partial<NightRef> = {}): NightRef => ({
  id: 'm1', date: TODAY, manualEntry: true, sleepStart: '2026-10-07T13:10:00.000Z', sleepEnd: '2026-10-07T20:40:00.000Z', ...over,
})
const device = (over: Partial<NightRef> = {}): NightRef => ({
  id: 'd1', date: TODAY, manualEntry: false, sleepStart: '2026-10-07T14:00:00.000Z', sleepEnd: '2026-10-07T21:00:00.000Z', ...over,
})

describe('lastNightState', () => {
  it('is none when no row is dated today, even with older nights', () => {
    expect(lastNightState([], TODAY)).toEqual({ kind: 'none' })
    expect(lastNightState([device({ date: '2026-10-07' })], TODAY)).toEqual({ kind: 'none' })
  })
  it('is device when a row that is not hand-entered is dated today', () => {
    expect(lastNightState([device()], TODAY)).toEqual({ kind: 'device' })
  })
  it('is manual, with the id and window, when only a typed night is dated today', () => {
    expect(lastNightState([typed()], TODAY)).toEqual({
      kind: 'manual', night: { id: 'm1', sleepStart: '2026-10-07T13:10:00.000Z', sleepEnd: '2026-10-07T20:40:00.000Z' },
    })
  })
  it('a device row beside a typed one hides the card (the device night wins)', () => {
    expect(lastNightState([typed(), device()], TODAY)).toEqual({ kind: 'device' })
  })
})

describe('applyPendingManualWrites', () => {
  it('drops a server night whose removal is still queued', () => {
    const out = applyPendingManualWrites([typed()], [], new Set(['m1']))
    expect(out).toEqual([])
  })
  it('leaves a device night alone even if its id were listed', () => {
    const out = applyPendingManualWrites([device()], [], new Set(['x']))
    expect(out).toEqual([device()])
  })
  it('adds a typed night the server does not have yet', () => {
    const out = applyPendingManualWrites([device({ date: '2026-10-07', id: 'd0' })], [typed()], new Set())
    expect(out.map(r => r.id)).toEqual(['m1', 'd0'])
  })
  it('a local edit replaces the server\'s older copy of the same typed night', () => {
    const edited = typed({ sleepStart: '2026-10-07T12:00:00.000Z' })
    const out = applyPendingManualWrites([typed()], [edited], new Set())
    expect(out).toEqual([edited])
  })
  it('a removed night entered again (same id) is shown even while the removal is still queued', () => {
    const out = applyPendingManualWrites([typed()], [typed()], new Set(['m1']))
    expect(out).toEqual([typed()])
  })
  it('never lets a local typed night replace a device night on its date', () => {
    const out = applyPendingManualWrites([device()], [typed()], new Set())
    expect(out).toEqual([device()])
  })
  it('reads the pending-removal ids from queued manual_sleep mutations', () => {
    const queued = [
      { domain: 'manual_sleep', payload: { id: 'm1', deleted: true } },
      { domain: 'manual_sleep', payload: { id: 'm2', sleepStart: 'a', sleepEnd: 'b' } },
      { domain: 'food_logs', payload: { id: 'f1', deleted: true } },
    ]
    expect([...pendingDeletedIds(queued, 'manual_sleep')]).toEqual(['m1'])
  })
})
