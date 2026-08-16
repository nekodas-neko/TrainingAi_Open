import { describe, it, expect } from 'vitest'
import {
  computeSupplementReminderActions,
  supplementReminderNotificationId,
  type SupplementReminderAction,
} from '../supplement-reminders'
import type { SupplementWithStatus } from '@trainingai/shared/types/supplement'

function makeSupplement(overrides: Partial<SupplementWithStatus> = {}): SupplementWithStatus {
  return {
    id: 'sup-1',
    userId: 'user-1',
    name: 'Creatine',
    dose: '5g',
    reminderEnabled: true,
    reminderTime: '08:00',
    sortOrder: 0,
    active: true,
    createdAt: new Date().toISOString(),
    loggedToday: false,
    ...overrides,
  }
}

describe('computeSupplementReminderActions', () => {
  it('cancels when supplement is already logged today', () => {
    const sup = makeSupplement({ loggedToday: true })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toEqual<SupplementReminderAction[]>([{ supplementId: 'sup-1', type: 'cancel' }])
  })

  it('cancels when reminderEnabled is false (NUT-5: was silently dropped, not cancelled)', () => {
    const sup = makeSupplement({ reminderEnabled: false })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toEqual<SupplementReminderAction[]>([{ supplementId: 'sup-1', type: 'cancel' }])
  })

  it('cancels supplements with no reminderTime (NUT-5)', () => {
    const sup = makeSupplement({ reminderTime: null })
    const actions = computeSupplementReminderActions([sup])
    expect(actions).toEqual<SupplementReminderAction[]>([{ supplementId: 'sup-1', type: 'cancel' }])
  })

  it('cancels an inactive supplement even with reminders otherwise fully configured (NUT-5)', () => {
    const sup = makeSupplement({ active: false })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toEqual<SupplementReminderAction[]>([{ supplementId: 'sup-1', type: 'cancel' }])
  })

  it('schedules notification before reminder time', () => {
    const sup = makeSupplement({ reminderTime: '08:00' })
    const now = new Date('2026-06-17T07:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toEqual<SupplementReminderAction[]>([{
      supplementId: 'sup-1',
      type: 'scheduled',
      at: new Date('2026-06-17T08:00:00'),
      name: 'Creatine',
    }])
  })

  it('fires immediate when past reminder time and not notified', () => {
    const sup = makeSupplement({ reminderTime: '08:00' })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toEqual<SupplementReminderAction[]>([{
      supplementId: 'sup-1',
      type: 'immediate',
      name: 'Creatine',
    }])
  })

  it('skips when past reminder time but already notified today', () => {
    const sup = makeSupplement({ reminderTime: '08:00' })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now, new Set(['sup-1']))
    expect(actions).toEqual<SupplementReminderAction[]>([{ supplementId: 'sup-1', type: 'skip' }])
  })

  it('fires immediate at exactly reminder time', () => {
    const sup = makeSupplement({ reminderTime: '08:00' })
    const now = new Date('2026-06-17T08:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions[0].type).toBe('immediate')
  })

  it('handles multiple supplements independently', () => {
    const creatine = makeSupplement({ id: 'sup-1', name: 'Creatine', reminderTime: '08:00', loggedToday: true })
    const magnesium = makeSupplement({ id: 'sup-2', name: 'Magnesium', reminderTime: '21:00', loggedToday: false })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([creatine, magnesium], now)
    expect(actions).toEqual<SupplementReminderAction[]>([
      { supplementId: 'sup-1', type: 'cancel' },
      { supplementId: 'sup-2', type: 'scheduled', at: new Date('2026-06-17T21:00:00'), name: 'Magnesium' },
    ])
  })
})

describe('supplementReminderNotificationId', () => {
  it('returns deterministic id for same supplement id', () => {
    expect(supplementReminderNotificationId('sup-abc')).toBe(supplementReminderNotificationId('sup-abc'))
  })

  it('returns id in 8500-8699 range', () => {
    const id = supplementReminderNotificationId('some-uuid-1234')
    expect(id).toBeGreaterThanOrEqual(8500)
    expect(id).toBeLessThanOrEqual(8699)
  })

  it('returns different ids for different supplement ids', () => {
    expect(supplementReminderNotificationId('sup-aaa')).not.toBe(supplementReminderNotificationId('sup-bbb'))
  })
})
