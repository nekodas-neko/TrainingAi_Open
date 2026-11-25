// #4114: an early deload week applies to automatic and AI-planned programs. A direct call for a
// manual program is a plain 400 and the repository is never asked to write.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EarlyDeloadNotAvailableError } from '@trainingai/shared/phase-engine'

const repo = { getActiveProgram: vi.fn(), confirmEarlyDeload: vi.fn(async () => {}) }
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user-1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
import { POST } from '../route'

const call = (body: object = {}) => POST(new NextRequest('http://localhost/api/confirm-early-deload', { method: 'POST', body: JSON.stringify(body) }))

describe('POST /api/confirm-early-deload by program kind (#4114)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('refuses a manual program with a 400 and writes nothing', async () => {
    repo.getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'manual' })
    const res = await call()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/automatic and AI-planned programs/)
    expect(repo.confirmEarlyDeload).not.toHaveBeenCalled()
  })

  it.each(['automatic', 'ai_dynamic'])('still confirms a %s program', async phaseMode => {
    repo.getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode })
    const res = await call()
    expect(res.status).toBe(200)
    expect(repo.confirmEarlyDeload).toHaveBeenCalledTimes(1)
  })

  it('maps the repository refusal to a 400 too (a mode switched between the read and the write)', async () => {
    repo.getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'automatic' })
    repo.confirmEarlyDeload.mockRejectedValueOnce(new EarlyDeloadNotAvailableError())
    expect((await call()).status).toBe(400)
  })
})
