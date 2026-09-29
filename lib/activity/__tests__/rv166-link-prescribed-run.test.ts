import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = {
  getPrescribedRuns: vi.fn(),
  upsertPrescribedRun: vi.fn(),
  queueMutation: vi.fn(),
}
const getLocalStore = vi.fn()

vi.mock('@/lib/local-store', () => ({ getLocalStore: (id: string) => getLocalStore(id) }))
vi.mock('@/lib/cache-groups', () => ({ invalidateRunningPlan: vi.fn(async () => {}) }))

const { linkPrescribedRun, completedAsFor } = await import('../link-prescribed-run')

const TZ = 'Australia/Brisbane'

beforeEach(() => {
  vi.clearAllMocks()
  store.getPrescribedRuns.mockResolvedValue([{ id: 'run-1', status: 'pending', activityLogId: null }])
  getLocalStore.mockReturnValue(store)
})

describe('RV-166 / LB-179 — a walk must SAY it was a walk', () => {
  it('writes completedAs to the local row and the queued mutation together', async () => {
    await linkPrescribedRun('u1', 'run-1', 'log-9', TZ, 'walk')

    expect(store.upsertPrescribedRun.mock.calls[0][0]).toMatchObject({
      id: 'run-1', status: 'completed', activityLogId: 'log-9', completedAs: 'walk',
    })
    // The outbox payload is what the server actually sees. A row that is right locally and silent
    // on the wire is the shape that re-plans the next quality session off a treadmill walk.
    expect(store.queueMutation.mock.calls[0][0].payload).toEqual({
      id: 'run-1', status: 'completed', activityLogId: 'log-9', completedAs: 'walk',
    })
  })

  it('still records a run as a run', async () => {
    await linkPrescribedRun('u1', 'run-1', 'log-9', TZ, 'run')
    expect(store.queueMutation.mock.calls[0][0].payload.completedAs).toBe('run')
  })

  it('sends it on the web path too, where there is no local store', async () => {
    getLocalStore.mockReturnValue(null)
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await linkPrescribedRun(undefined, 'run-1', 'log-9', TZ, 'walk')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/running-plan/runs/run-1')
    expect(JSON.parse(String(init.body))).toEqual({
      status: 'completed', activityLogId: 'log-9', completedAs: 'walk',
    })
    vi.unstubAllGlobals()
  })

  it('does not invent a row that is not there, but still queues the mutation', async () => {
    store.getPrescribedRuns.mockResolvedValue([])
    await linkPrescribedRun('u1', 'run-1', 'log-9', TZ, 'walk')
    expect(store.upsertPrescribedRun).not.toHaveBeenCalled()
    expect(store.queueMutation).toHaveBeenCalledTimes(1)
  })
})

describe('completedAsFor', () => {
  it('counts only a run as a run — treadmill and walk are both walks', () => {
    expect(completedAsFor('run')).toBe('run')
    expect(completedAsFor('walk')).toBe('walk')
    expect(completedAsFor('treadmill')).toBe('walk')
    expect(completedAsFor(null)).toBe('walk')
  })
})
