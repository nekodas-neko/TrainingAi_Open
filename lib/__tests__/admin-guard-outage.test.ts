// Q-548: "not authorised" and "could not check" must not be the same answer.
//
// `requireAdmin` makes a DB round-trip, so a bare `catch {}` around it turned a database outage into
// 403 — the one status a caller neither retries nor escalates. During the 2026-08-18 volume incident
// every /api/admin/db-query call answered {"error":"Forbidden"} while the service was simply
// offline, and the first several minutes of the investigation went to env vars and the admin flag.
import { describe, it, expect } from 'vitest'
import { AdminError, isAdminRefusal, adminFailureStatus, adminFailureOutcome, adminErrorResponse } from '../admin'

describe('isAdminRefusal', () => {
  it('recognises a genuine refusal', () => {
    expect(isAdminRefusal(new AdminError())).toBe(true)
  })

  it('recognises one thrown in another module realm, by name', () => {
    expect(isAdminRefusal(Object.assign(new Error('Forbidden'), { name: 'AdminError' }))).toBe(true)
  })

  it('does NOT claim a connection failure is a refusal', () => {
    const outage = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED', syscall: 'connect',
    })
    expect(isAdminRefusal(outage)).toBe(false)
  })

  it('does not treat an error merely mentioning Forbidden as a refusal', () => {
    expect(isAdminRefusal(new Error('Forbidden'))).toBe(false)
  })
})

describe('the answer a route gives', () => {
  it('403 for a refusal, 503 for anything else', () => {
    expect(adminFailureStatus(new AdminError())).toBe(403)
    expect(adminFailureStatus(new Error('Failed query: select … from users'))).toBe(503)
    expect(adminFailureStatus(undefined)).toBe(503)
  })

  it('adminFailureOutcome carries a message matching its status', () => {
    expect(adminFailureOutcome(new AdminError())).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(adminFailureOutcome(new Error('db down'))).toEqual({ ok: false, status: 503, error: 'Service unavailable' })
  })

  it('adminErrorResponse returns the same two answers as a Response', async () => {
    const refused = adminErrorResponse(new AdminError())
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'Forbidden' })

    const outage = adminErrorResponse(new Error('Connection terminated unexpectedly'))
    expect(outage.status).toBe(503)
    expect(await outage.json()).toEqual({ error: 'Service unavailable' })
  })
})
