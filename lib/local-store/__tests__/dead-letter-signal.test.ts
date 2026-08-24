// @vitest-environment jsdom
// K3: the dead-letter badge count + one-time toast for dead-lettered workouts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingMutation } from '../types'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const fakeStore = { getFailedMutations: vi.fn() }
vi.mock('../index', () => ({ getLocalStore: () => fakeStore }))

import {
  reconcileDeadLetters,
  getDeadLetterCount,
  setDeadLetterCount,
  subscribeDeadLetterCount,
  reportEnqueueFailure,
} from '../dead-letter-signal'

function failed(id: string, domain: PendingMutation['domain']): PendingMutation {
  return { id, userId: 'u1', domain, date: '2026-07-01', payload: {}, createdAt: '', attempts: 5, lastError: 'x', status: 'failed', nextRetryAt: null }
}

describe('dead-letter signal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setDeadLetterCount(0)
  })

  it('notifies subscribers when the count changes', () => {
    const listener = vi.fn()
    const unsub = subscribeDeadLetterCount(listener)
    setDeadLetterCount(3)
    expect(getDeadLetterCount()).toBe(3)
    expect(listener).toHaveBeenCalledTimes(1)
    setDeadLetterCount(3) // no change → no re-notify
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('sets the badge count and toasts once per newly dead-lettered workout', async () => {
    fakeStore.getFailedMutations.mockResolvedValue([failed('m1', 'workout_log'), failed('m2', 'food_logs')])
    await reconcileDeadLetters('u1')
    expect(getDeadLetterCount()).toBe(2)       // badge counts every domain
    expect(toastError).toHaveBeenCalledTimes(1) // but only the Tier-A workout toasts

    // A second reconcile with the same failed set must not re-toast.
    await reconcileDeadLetters('u1')
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('does not toast for Tier-B-only failures (badge only)', async () => {
    fakeStore.getFailedMutations.mockResolvedValue([failed('f1', 'food_logs'), failed('f2', 'mood_logs')])
    await reconcileDeadLetters('u1')
    expect(getDeadLetterCount()).toBe(2)
    expect(toastError).not.toHaveBeenCalled()
  })
})

// Q-486: an enqueue that THREW leaves no outbox row, so nothing else in the app can ever see it.
describe('reportEnqueueFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setDeadLetterCount(0)
  })

  it('warns and toasts for a Tier-A domain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportEnqueueFailure('workout_log', new Error('no such table: outbox'))
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('names the loss differently for a finished workout than for a set', async () => {
    reportEnqueueFailure('complete_workout', new Error('db closed'))
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(String(toastError.mock.calls[0][0])).toContain('Finishing this workout')
  })

  it('warns but does not interrupt for a Tier-B domain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportEnqueueFailure('food_logs', new Error('db closed'))
    await new Promise(r => setTimeout(r, 10))
    expect(toastError).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  // The badge counts rows the Data & Sync card can retry or discard; this failure has no row, so a
  // count lit from here would be one that card could neither explain nor clear.
  it('leaves the badge alone', async () => {
    reportEnqueueFailure('workout_log', new Error('db closed'))
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(getDeadLetterCount()).toBe(0)
  })
})
