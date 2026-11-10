// #3716 — an expired prescription stayed on the workout screen: the card, the Deload default and
// Accept all read the stored prescription without its expiry. These are the shared rules both apps
// and the session-state routes now use, all built on `prescriptionAgedOut`.
import { describe, it, expect } from 'vitest'
import {
  hidePrescriptionAgedOutOnScreen,
  isOneDayPrescription,
  prescribedDeloadDefault,
  prescriptionAgedOut,
  prescriptionAgedOutOnScreen,
  servePrescriptionState,
} from '../prescription-expiry'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

const now = new Date('2026-11-10T00:00:00Z')
const expired = new Date(now.getTime() - 60_000)
const live = new Date(now.getTime() + 60_000)
const p = (phaseAction: AiPrescription['phaseAction'], deload = false) =>
  ({ phaseAction, deload, exercises: [] }) as unknown as AiPrescription
type S = Pick<SessionPeriodization, 'prescription' | 'prescriptionStatus' | 'prescriptionExpiresAt'>
const st = (prescription: AiPrescription | null, prescriptionStatus: S['prescriptionStatus'], prescriptionExpiresAt: Date | null): S =>
  ({ prescription, prescriptionStatus, prescriptionExpiresAt })

describe('a session swap is a one-day answer', () => {
  it('is one-day, and its pending offer ages out at its expiry', () => {
    expect(isOneDayPrescription(p('session_swap_recommended'))).toBe(true)
    expect(prescriptionAgedOut(st(p('session_swap_recommended'), 'pending', expired), now)).toBe(true)
    expect(prescriptionAgedOut(st(p('session_swap_recommended'), 'pending', live), now)).toBe(false)
  })
})

describe('servePrescriptionState — what the session-state routes return', () => {
  it('leaves out an aged-out prescription and flags it; keeps the status', () => {
    const served = servePrescriptionState(st(p('deload_recommended', true), 'pending', expired), now)
    expect(served.prescription).toBeNull()
    expect(served.prescriptionAgedOut).toBe(true)
    expect(served.prescriptionStatus).toBe('pending')
  })

  it('returns a live state as it is, with no flag', () => {
    const state = st(p('deload_recommended', true), 'pending', live)
    expect(servePrescriptionState(state, now)).toBe(state)
  })

  it('follows prescriptionAgedOut for every status', () => {
    for (const status of ['pending', 'accepted', 'auto_applied', 'dismissed', 'consumed', 'none'] as const) {
      const state = st(p('stay'), status, expired)
      expect(servePrescriptionState(state, now).prescriptionAgedOut === true).toBe(prescriptionAgedOut(state, now))
    }
  })
})

describe('prescriptionAgedOutOnScreen — a client reading the wire or a cache', () => {
  it('honours the server flag', () => {
    expect(prescriptionAgedOutOnScreen({ prescriptionStatus: 'pending', prescription: null, prescriptionAgedOut: true }, now)).toBe(true)
  })

  it('reads an ISO expiry when the flag is absent (production 1.518.0, or a cached state)', () => {
    const wire = { prescriptionStatus: 'accepted', prescription: { phaseAction: 'stay' }, prescriptionExpiresAt: expired.toISOString() }
    expect(prescriptionAgedOutOnScreen(wire, now)).toBe(true)
    expect(prescriptionAgedOutOnScreen({ ...wire, prescriptionExpiresAt: live.toISOString() }, now)).toBe(false)
  })

  it('treats a missing or unreadable expiry as live', () => {
    expect(prescriptionAgedOutOnScreen({ prescriptionStatus: 'accepted', prescription: { phaseAction: 'stay' } }, now)).toBe(false)
    expect(prescriptionAgedOutOnScreen({ prescriptionStatus: 'accepted', prescriptionExpiresAt: 'soon' }, now)).toBe(false)
    expect(prescriptionAgedOutOnScreen(null, now)).toBe(false)
  })

  it('hides an aged-out prescription from a held state', () => {
    const wire = { prescriptionStatus: 'accepted', prescription: { phaseAction: 'stay' }, prescriptionExpiresAt: expired.toISOString() }
    expect(hidePrescriptionAgedOutOnScreen(wire, now)).toMatchObject({ prescription: null, prescriptionAgedOut: true })
    const fresh = { ...wire, prescriptionExpiresAt: live.toISOString() }
    expect(hidePrescriptionAgedOutOnScreen(fresh, now)).toBe(fresh)
  })
})

describe('prescribedDeloadDefault — what the Deload toggle adopts', () => {
  const deload = { prescriptionStatus: 'pending', prescription: { phaseAction: 'deload_recommended', deload: true } }

  it('adopts a live deload', () => {
    expect(prescribedDeloadDefault({ ...deload, prescriptionExpiresAt: live.toISOString() }, now)).toBe(true)
  })

  it('reads Full the morning after an illness deload ended', () => {
    expect(prescribedDeloadDefault({ ...deload, prescriptionExpiresAt: expired.toISOString() }, now)).toBe(false)
    expect(prescribedDeloadDefault({ prescriptionStatus: 'pending', prescription: null, prescriptionAgedOut: true }, now)).toBe(false)
  })

  it('adopts nothing from a consumed prescription or no state', () => {
    expect(prescribedDeloadDefault({ ...deload, prescriptionStatus: 'consumed' }, now)).toBeUndefined()
    expect(prescribedDeloadDefault(null, now)).toBeUndefined()
  })
})
