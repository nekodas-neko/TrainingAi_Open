import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  regeneratePrescriptionInBackground,
  __clearPrescriptionInFlight,
} from '../regenerate-in-background'

const settle = () => new Promise(r => setTimeout(r, 0))

const deps = (run: () => Promise<unknown>, allow = () => true) => ({
  today: '2026-08-23',
  allow,
  run,
  onError: () => {},
})

beforeEach(() => __clearPrescriptionInFlight())

describe('regeneratePrescriptionInBackground', () => {
  it('runs the first call for a (user, session, day)', () => {
    const run = vi.fn(async () => {})
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(run))).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  // The defect: two screen opens seconds apart, the second before the first generation lands.
  it('does not start a second while the first is still running', () => {
    let release!: () => void
    const run = vi.fn(() => new Promise<void>(r => { release = r }))
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(run))).toBe(true)
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(run))).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
    release()
  })

  it('lets the next call through once the first settles — it is a lease, not a cooldown', async () => {
    const run = vi.fn(async () => {})
    regeneratePrescriptionInBackground('u1', 's1', deps(run))
    await settle()
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(run))).toBe(true)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('releases the marker when the generation REJECTS, not just when it resolves', async () => {
    const boom = vi.fn(async () => { throw new Error('gemini 502') })
    regeneratePrescriptionInBackground('u1', 's1', deps(boom))
    await settle()
    const ok = vi.fn(async () => {})
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(ok))).toBe(true)
  })

  it('reports the rejection rather than swallowing it', async () => {
    const err = new Error('gemini 502')
    const onError = vi.fn()
    regeneratePrescriptionInBackground('u1', 's1', {
      ...deps(async () => { throw err }),
      onError,
    })
    await settle()
    expect(onError).toHaveBeenCalledWith(err)
  })

  it('keys on the session and the day, not just the user', () => {
    const run = vi.fn(() => new Promise<void>(() => {}))
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(run))).toBe(true)
    expect(regeneratePrescriptionInBackground('u1', 's2', deps(run))).toBe(true)
    expect(regeneratePrescriptionInBackground('u2', 's1', deps(run))).toBe(true)
    expect(regeneratePrescriptionInBackground('u1', 's1', { ...deps(run), today: '2026-08-24' })).toBe(true)
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(run))).toBe(false)
    expect(run).toHaveBeenCalledTimes(4)
  })

  // The order matters: two screen opens used to burn two of the twenty-per-hour budget for one
  // logical generation.
  it('does not spend rate-limit budget on a call the guard already refused', () => {
    const allow = vi.fn(() => true)
    const run = vi.fn(() => new Promise<void>(() => {}))
    regeneratePrescriptionInBackground('u1', 's1', deps(run, allow))
    regeneratePrescriptionInBackground('u1', 's1', deps(run, allow))
    expect(allow).toHaveBeenCalledTimes(1)
  })

  it('leaves no marker behind when the rate limit refuses, so the next call is not wedged', async () => {
    const run = vi.fn(async () => {})
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(run, () => false))).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(regeneratePrescriptionInBackground('u1', 's1', deps(run))).toBe(true)
  })
})
